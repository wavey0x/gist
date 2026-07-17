import errno
import io

from gist_api.db import gist_connection

from .conftest import auth_header, create_gist, make_key


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x00\x00\x00\x00"
)
JPEG_1X1 = (
    b"\xff\xd8\xff\xc0\x00\x11\x08\x00\x01\x00\x01"
    b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00\xff\xd9"
)
WEBP_1X1 = (
    b"RIFF\x16\x00\x00\x00WEBPVP8X"
    b"\x0a\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00"
)


def _upload_tuple(data=PNG_1X1, filename="chart.png"):
    return io.BytesIO(data), filename


def test_image_upload_and_public_serving(client, app):
    key = make_key(app)

    denied = client.post("/api/v1/images")
    assert denied.status_code == 401

    uploaded = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple()},
    )
    assert uploaded.status_code == 201
    body = uploaded.get_json()
    assert body["id"].startswith("img_")
    assert body["url"] == f"https://api.example.com/api/v1/images/{body['id']}"
    assert body["original_filename"] == "chart.png"
    assert body["mime_type"] == "image/png"
    assert body["byte_size"] == len(PNG_1X1)
    assert body["width"] == 1
    assert body["height"] == 1
    assert body["markdown"] == f"![chart.png]({body['url']})"

    public = client.get(f"/api/v1/images/{body['id']}")
    assert public.status_code == 200
    assert public.content_type == "image/png"
    assert public.data == PNG_1X1

    with gist_connection(app) as conn:
        conn.execute(
            "update image_assets set deleted_at = '2026-01-01T00:00:00.000Z'",
        )
        conn.commit()

    assert client.get(f"/api/v1/images/{body['id']}").status_code == 404
    assert client.get("/api/v1/images/not-an-image").status_code == 404


def test_image_upload_accepts_jpeg_and_webp(client, app):
    key = make_key(app)

    jpeg = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(JPEG_1X1, "photo.jpg")},
    )
    webp = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(WEBP_1X1, "preview.webp")},
    )

    assert jpeg.status_code == 201
    assert jpeg.get_json()["mime_type"] == "image/jpeg"
    assert webp.status_code == 201
    assert webp.get_json()["mime_type"] == "image/webp"


def test_image_upload_rejects_aliases_and_extra_fields(client, app):
    key = make_key(app)

    extra_scalar = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(), "title": "not allowed"},
    )
    extra_file = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={
            "image": _upload_tuple(),
            "other": _upload_tuple(filename="other.png"),
        },
    )
    gist_image_alias = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "markdown": "# Alias",
            "images": _upload_tuple(),
        },
    )

    for response in (extra_scalar, extra_file, gist_image_alias):
        assert response.status_code == 400
        assert response.get_json()["error"]["code"] == "invalid_request"
        assert "unknown field" in response.get_json()["error"]["message"]


def test_image_upload_rejects_invalid_type_size_dimensions_and_quota(client, app):
    key = make_key(app)

    invalid = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(b"not image", "bad.txt")},
    )
    assert invalid.status_code == 400
    assert invalid.get_json()["error"]["code"] == "invalid_request"

    app.config["IMAGE_MAX_BYTES"] = len(PNG_1X1) - 1
    too_large = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(PNG_1X1, "large.png")},
    )
    assert too_large.status_code == 413
    too_large_error = too_large.get_json()["error"]
    assert too_large_error["code"] == "payload_too_large"
    assert "without this image" in too_large_error["message"]
    app.config["IMAGE_MAX_BYTES"] = 20 * 1024 * 1024

    app.config["IMAGE_MAX_DIMENSION"] = 0
    dimensions = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(PNG_1X1, "wide.png")},
    )
    assert dimensions.status_code == 400
    app.config["IMAGE_MAX_DIMENSION"] = 4096

    app.config["IMAGE_STORAGE_LIMIT_BYTES"] = len(PNG_1X1) - 1
    quota = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(PNG_1X1, "quota.png")},
    )
    assert quota.status_code == 413
    quota_error = quota.get_json()["error"]
    assert quota_error["code"] == "storage_quota_exceeded"
    assert "without images" in quota_error["message"]


def test_image_upload_storage_capacity_errors_are_actionable(client, app, monkeypatch):
    key = make_key(app)

    def fail_replace(_source, _destination):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr("gist_api.images.os.replace", fail_replace)

    response = client.post(
        "/api/v1/images",
        headers=auth_header(key),
        data={"image": _upload_tuple(PNG_1X1, "full.png")},
    )

    assert response.status_code == 507
    error = response.get_json()["error"]
    assert error["code"] == "image_storage_unavailable"
    assert "without images" in error["message"]


def test_multipart_size_error_is_image_actionable(client, app):
    key = make_key(app)
    app.config["MAX_MULTIPART_REQUEST_BYTES"] = 1

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "markdown": "# Too large",
            "images[]": [_upload_tuple(PNG_1X1, "large.png")],
        },
    )

    assert response.status_code == 413
    error = response.get_json()["error"]
    assert error["code"] == "payload_too_large"
    assert "without images" in error["message"]


def test_multipart_gist_replaces_attachment_references(client, app):
    key = make_key(app, name="agent")

    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "title": "Chart",
            "markdown": "# Chart\n\n![Revenue](attachment:chart.png)",
            "images[]": [_upload_tuple(PNG_1X1, "chart.png")],
        },
    )

    assert created.status_code == 201
    body = created.get_json()
    image = body["images"][0]
    assert body["markdown"] == f"# Chart\n\n![Revenue]({image['url']})"
    assert "attachment:chart.png" not in body["markdown"]
    assert body["id"]

    public = client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    public_body = public.get_json()
    assert public_body["markdown"] == body["markdown"]
    assert f'<img src="{image["url"]}" alt="Revenue">' in public_body["rendered_html"]


def test_multipart_gist_appends_unreferenced_images(client, app):
    key = make_key(app)

    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "markdown": "# With image",
            "images[]": [_upload_tuple(PNG_1X1, "chart.png")],
        },
    )

    assert created.status_code == 201
    body = created.get_json()
    image = body["images"][0]
    assert body["markdown"] == f"# With image\n\n![chart.png]({image['url']})"


def test_multipart_gist_can_be_image_only(client, app):
    key = make_key(app)

    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "title": "Image only",
            "images[]": [_upload_tuple(PNG_1X1, "chart.png")],
        },
    )

    assert created.status_code == 201
    body = created.get_json()
    image = body["images"][0]
    assert body["markdown"] == f"![chart.png]({image['url']})"

    public = client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    public_body = public.get_json()
    assert f'<img src="{image["url"]}" alt="chart.png">' in public_body["rendered_html"]


def test_multipart_gist_rejects_duplicate_attachment_filenames(client, app):
    key = make_key(app)

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "markdown": "# Duplicate",
            "images[]": [
                _upload_tuple(PNG_1X1, "same.png"),
                _upload_tuple(JPEG_1X1, "same.png"),
            ],
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_request"
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from gists").fetchone()[0] == 0
        assert conn.execute("select count(*) from image_assets").fetchone()[0] == 0


def test_multipart_patch_can_append_image_to_existing_gist(client, app):
    key = make_key(app)
    created = create_gist(client, key, "# Start")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    patched = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        data={"images[]": [_upload_tuple(PNG_1X1, "patch.png")]},
    )

    assert patched.status_code == 200
    body = patched.get_json()
    image = body["images"][0]
    assert body["revision_number"] == 2
    assert body["markdown"] == f"# Start\n\n![patch.png]({image['url']})"
