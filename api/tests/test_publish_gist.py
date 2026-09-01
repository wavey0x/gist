import importlib.machinery
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest


HELPER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "publish-gist"
GIST_ID = "A" * 16
GIST_URL = f"https://gist.wavey.info/{GIST_ID}"
TOKEN = "wapi_gist_testpref_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
IMAGE_ID = f"img_{'I' * 22}"
IMAGE_URL = f"https://api.wavey.info/api/v1/images/{IMAGE_ID}"
PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x00\x00\x00\x00"
)
SVG_2X1 = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1">'
    b'<rect width="2" height="1"/>'
    b"</svg>"
)
FILES = {
    "README.md": "# Plan\n\nSafe changes.\n",
    "check.py": "print('safe')\n",
}


def _load_helper():
    loader = importlib.machinery.SourceFileLoader(
        "wavey_publish_gist_test",
        str(HELPER_PATH),
    )
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules[loader.name] = module
    loader.exec_module(module)
    return module


publish_gist = _load_helper()


def _json_bytes(value):
    return json.dumps(value).encode()


def _gist_payload(
    *,
    revision_number=2,
    latest_revision_number=2,
    title="Plan",
    files=None,
    gist_id=GIST_ID,
    images=None,
):
    files = dict(FILES if files is None else files)
    payload = {
        "id": gist_id,
        "url": f"https://gist.wavey.info/{gist_id}",
        "title": title,
        "display_title": title or next(iter(files)),
        "primary_file": "README.md" if "README.md" in files else next(iter(files)),
        "snapshot_sha256": "a" * 64,
        "revision_number": revision_number,
        "latest_revision_number": latest_revision_number,
        "files": {
            filename: {
                "filename": filename,
                "content": content,
                "content_sha256": "b" * 64,
                "byte_size": len(content.encode()),
                "raw_url": f"{GIST_URL}/raw/{filename}",
                "rendered_html": f"<pre>{content}</pre>",
            }
            for filename, content in files.items()
        },
        "history": [{"revision_number": revision_number}],
    }
    if images is not None:
        payload["images"] = images
    return payload


def _image_asset(filename="chart.png", content=PNG_1X1):
    return {
        "id": IMAGE_ID,
        "url": IMAGE_URL,
        "original_filename": filename,
        "mime_type": "image/png",
        "byte_size": len(content),
        "width": 1,
        "height": 1,
        "markdown": f"![{filename}]({IMAGE_URL})",
    }


def _run(monkeypatch, capsys, argv, handler):
    monkeypatch.delenv("WAVEY_GIST_API_BASE_URL", raising=False)
    monkeypatch.setattr(publish_gist, "_request", handler)
    monkeypatch.setattr(publish_gist, "wavey_token", lambda: TOKEN)
    result = publish_gist.main(argv)
    captured = capsys.readouterr()
    return result, captured.out, captured.err


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        (GIST_ID, (GIST_ID, None)),
        (GIST_URL, (GIST_ID, None)),
        (f"{GIST_URL}/", (GIST_ID, None)),
        (f"{GIST_URL}/revisions/2", (GIST_ID, 2)),
    ],
)
def test_parse_gist_target_accepts_current_targets(target, expected):
    assert publish_gist.parse_gist_target(target) == expected


@pytest.mark.parametrize(
    "target",
    [
        "short",
        f"{GIST_URL}?revision=2",
        f"{GIST_URL}#raw",
        f"https://user:pass@gist.wavey.info/{GIST_ID}",
        f"{GIST_URL}/revisions/0",
        f"{GIST_URL}/raw/README.md",
    ],
)
def test_parse_gist_target_rejects_ambiguous_targets(target):
    with pytest.raises(publish_gist.CliError):
        publish_gist.parse_gist_target(target)


def test_read_returns_one_compact_complete_snapshot_without_credentials(
    monkeypatch,
    capsys,
):
    response = _gist_payload()

    def no_credentials():
        raise AssertionError("public reads must not discover credentials")

    def handler(url, **kwargs):
        assert url.endswith(f"/{GIST_ID}/render")
        assert kwargs.get("token") is None
        return _json_bytes(response)

    monkeypatch.setattr(publish_gist, "wavey_token", no_credentials)
    monkeypatch.setattr(publish_gist, "_request", handler)

    assert publish_gist.main(["read", GIST_ID]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output == {
        "id": GIST_ID,
        "url": GIST_URL,
        "title": "Plan",
        "display_title": "Plan",
        "primary_file": "README.md",
        "snapshot_sha256": "a" * 64,
        "revision_number": 2,
        "latest_revision_number": 2,
        "files": FILES,
    }
    assert "history" not in output
    assert "rendered_html" not in json.dumps(output)


def test_read_revision_requires_the_requested_revision(monkeypatch, capsys):
    def handler(_url, **_kwargs):
        return _json_bytes(_gist_payload(revision_number=3, latest_revision_number=3))

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["read", f"{GIST_URL}/revisions/2"],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "wrong gist revision" in error


def test_create_reads_markdown_from_disk_without_shell_interpretation(
    monkeypatch,
    capsys,
    tmp_path,
):
    content = (
        "# Literal Markdown\n\n"
        "`inline` and **bold**\n\n"
        "```sh\n"
        "printf '%s\\n' \"$HOME\"\n"
        "echo $(date) && echo `uname`\n"
        "printf 'C:\\\\tmp\\\\file'\n"
        "```\n"
    )
    readme = tmp_path / "README.md"
    readme.write_bytes(content.encode())
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title=None,
        files={"README.md": content},
    )

    def handler(url, **kwargs):
        assert url.endswith("/api/v1/gists")
        assert kwargs["method"] == "POST"
        assert kwargs["token"] == TOKEN
        assert kwargs["payload"] == {
            "files": {"README.md": {"content": content}}
        }
        assert kwargs["image_uploads"] == []
        return _json_bytes(response)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme)],
        handler,
    )

    assert result == 0
    assert output == f"{GIST_URL}\n"
    assert error == ""


def test_create_does_not_require_a_markdown_heading(monkeypatch, capsys, tmp_path):
    readme = tmp_path / "README.md"
    readme.write_text("plain but intentional\n")
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title=None,
        files={"README.md": "plain but intentional\n"},
    )

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme)],
        lambda _url, **_kwargs: _json_bytes(response),
    )

    assert result == 0
    assert output == f"{GIST_URL}\n"
    assert error == ""


def test_create_requires_a_disk_file():
    with pytest.raises(SystemExit) as error:
        publish_gist.main(["create"])
    assert error.value.code == 2


def test_multipart_encoder_preserves_payload_and_unicode_image_name():
    from werkzeug.formparser import parse_form_data

    payload = {"files": {"README.md": {"content": "# Chart"}}}
    upload = publish_gist.ImageUpload(
        filename="résumé [1].png",
        content=PNG_1X1,
        content_type="image/png",
    )

    content_type, body = publish_gist.encode_multipart_form_data(payload, [upload])
    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_TYPE": content_type,
        "CONTENT_LENGTH": str(len(body)),
        "wsgi.input": io.BytesIO(body),
    }
    _stream, form, files = parse_form_data(environ)
    stored = files.getlist("images[]")

    assert json.loads(form["payload"]) == payload
    assert len(stored) == 1
    assert stored[0].filename == upload.filename
    assert stored[0].read() == upload.content


def test_image_reader_preserves_svg_bytes_and_type(tmp_path):
    image = tmp_path / "diagram.svg"
    image.write_bytes(SVG_2X1)

    assert publish_gist.read_image_uploads([str(image)]) == [
        publish_gist.ImageUpload("diagram.svg", SVG_2X1, "image/svg+xml")
    ]


def test_create_passes_images_to_the_api(monkeypatch, capsys, tmp_path):
    source = "# Chart\n\n![Chart](attachment:chart.png)\n"
    resolved = source.replace("attachment:chart.png", IMAGE_URL)
    readme = tmp_path / "README.md"
    image = tmp_path / "chart.png"
    readme.write_text(source)
    image.write_bytes(PNG_1X1)
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title=None,
        files={"README.md": resolved},
        images=[_image_asset()],
    )

    def handler(_url, **kwargs):
        assert kwargs["payload"] == {
            "files": {"README.md": {"content": source}}
        }
        assert kwargs["image_uploads"] == [
            publish_gist.ImageUpload("chart.png", PNG_1X1, "image/png")
        ]
        return _json_bytes(response)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme), "--image", str(image)],
        handler,
    )

    assert result == 0
    assert output == f"{GIST_URL}\n"
    assert error == ""


@pytest.mark.parametrize(
    "images",
    [
        [],
        [{**_image_asset(), "original_filename": "other.png"}],
        [{**_image_asset(), "byte_size": len(PNG_1X1) + 1}],
        [{**_image_asset(), "url": ""}],
    ],
)
def test_image_writes_require_matching_metadata(
    monkeypatch,
    capsys,
    tmp_path,
    images,
):
    readme = tmp_path / "README.md"
    image = tmp_path / "chart.png"
    readme.write_text("# Chart\n")
    image.write_bytes(PNG_1X1)
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title=None,
        files={"README.md": "# Chart\n"},
        images=images,
    )

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme), "--image", str(image)],
        lambda _url, **_kwargs: _json_bytes(response),
    )

    assert result == 1
    assert output == ""
    assert "invalid image metadata" in error
    assert "do not retry" in error
    assert GIST_URL in error


def test_image_writes_require_the_expected_title(monkeypatch, capsys, tmp_path):
    readme = tmp_path / "README.md"
    image = tmp_path / "chart.png"
    readme.write_text("# Chart\n")
    image.write_bytes(PNG_1X1)
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title="Unexpected",
        files={"README.md": "# Chart\n"},
        images=[_image_asset()],
    )

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme), "--image", str(image)],
        lambda _url, **_kwargs: _json_bytes(response),
    )

    assert result == 1
    assert output == ""
    assert "differs from the submitted files" in error
    assert "do not retry" in error
    assert GIST_URL in error


def test_update_overlays_deletes_and_clears_title(monkeypatch, capsys, tmp_path):
    current_files = {
        "README.md": FILES["README.md"],
        "old.py": "print('old')\n",
    }
    next_files = {
        "README.md": FILES["README.md"],
        "new.py": "print('new')\n",
    }
    current = _gist_payload(files=current_files)
    published = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title=None,
        files=next_files,
    )
    new_file = tmp_path / "new.py"
    new_file.write_text(next_files["new.py"])
    calls = []

    def handler(url, **kwargs):
        calls.append((url, kwargs))
        if kwargs.get("method", "GET") == "GET":
            assert url.endswith(f"/api/v1/gists/{GIST_ID}")
            assert kwargs["token"] == TOKEN
            return _json_bytes(current)
        assert kwargs["method"] == "PATCH"
        assert kwargs["payload"] == {
            "files": {
                filename: {"content": content}
                for filename, content in next_files.items()
            },
            "expected_snapshot_sha256": current["snapshot_sha256"],
            "title": "",
        }
        return _json_bytes(published)

    result, output, error = _run(
        monkeypatch,
        capsys,
        [
            "update",
            GIST_ID,
            str(new_file),
            "--delete",
            "old.py",
            "--title",
            "",
        ],
        handler,
    )

    assert result == 0
    assert output == f"{GIST_URL}\n"
    assert error == ""
    assert len(calls) == 2


def test_update_rejects_revision_url_without_reading(monkeypatch, capsys):
    def handler(_url, **_kwargs):
        raise AssertionError("revision update must not call the API")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["update", f"{GIST_URL}/revisions/1", "--title", "New"],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "latest gist URL" in error


def test_update_conflict_does_not_reread_or_retry(monkeypatch, capsys):
    reads = 0
    writes = 0

    def handler(_url, **kwargs):
        nonlocal reads, writes
        if kwargs.get("method", "GET") == "GET":
            reads += 1
            return _json_bytes(_gist_payload())
        writes += 1
        raise publish_gist.ApiError(409, "conflict", "Conflict")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["update", GIST_ID, "--title", "New"],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "read it and retry" in error
    assert reads == 1
    assert writes == 1


def test_ambiguous_update_reconciles_without_retry(monkeypatch, capsys):
    current = _gist_payload(title="Old")
    desired = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="New",
    )
    reads = 0
    writes = 0

    def handler(_url, **kwargs):
        nonlocal reads, writes
        if kwargs.get("method", "GET") == "GET":
            reads += 1
            return _json_bytes(current if reads == 1 else desired)
        writes += 1
        raise publish_gist.AmbiguousWriteError("unknown")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["update", GIST_ID, "--title", "New"],
        handler,
    )

    assert result == 0
    assert output == f"{GIST_URL}\n"
    assert error == ""
    assert reads == 2
    assert writes == 1


def test_ambiguous_create_is_not_retried(monkeypatch, capsys, tmp_path):
    readme = tmp_path / "README.md"
    readme.write_text("# Test\n")
    writes = 0

    def handler(_url, **_kwargs):
        nonlocal writes
        writes += 1
        raise publish_gist.AmbiguousWriteError("unknown write")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme)],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "unknown write" in error
    assert writes == 1


def test_ambiguous_image_update_is_not_reconciled(monkeypatch, capsys, tmp_path):
    image = tmp_path / "chart.png"
    image.write_bytes(PNG_1X1)
    reads = 0

    def handler(_url, **kwargs):
        nonlocal reads
        if kwargs.get("method", "GET") == "GET":
            reads += 1
            return _json_bytes(_gist_payload())
        raise publish_gist.AmbiguousWriteError("unknown image write")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["update", GIST_ID, "--image", str(image)],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "unknown image write" in error
    assert reads == 1


def test_write_response_mismatch_reports_the_existing_gist(
    monkeypatch,
    capsys,
    tmp_path,
):
    readme = tmp_path / "README.md"
    readme.write_text("# Intended\n")
    response = _gist_payload(
        revision_number=1,
        latest_revision_number=1,
        title=None,
        files={"README.md": "# Different\n"},
    )

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme)],
        lambda _url, **_kwargs: _json_bytes(response),
    )

    assert result == 1
    assert output == ""
    assert "do not retry" in error
    assert GIST_URL in error
    assert "revision 1" in error


def test_check_reports_credentials_without_printing_them(monkeypatch, capsys):
    monkeypatch.setattr(publish_gist, "wavey_token", lambda: TOKEN)

    assert publish_gist.main(["check"]) == 0
    captured = capsys.readouterr()
    assert captured.out == "Wavey Gist API key found.\n"
    assert TOKEN not in captured.out


def test_check_does_not_validate_the_api_base_url(monkeypatch, capsys):
    monkeypatch.setenv("WAVEY_GIST_API_BASE_URL", "")
    monkeypatch.setattr(publish_gist, "wavey_token", lambda: TOKEN)

    assert publish_gist.main(["check"]) == 0
    captured = capsys.readouterr()
    assert captured.out == "Wavey Gist API key found.\n"
    assert captured.err == ""


def test_errors_redact_discovered_secret(monkeypatch, capsys, tmp_path):
    readme = tmp_path / "README.md"
    readme.write_text("# Test\n")

    def handler(_url, **_kwargs):
        raise publish_gist.CliError(f"backend echoed {TOKEN}")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["create", str(readme)],
        handler,
    )

    assert result == 1
    assert output == ""
    assert TOKEN not in error
    assert "[REDACTED]" in error


def test_environment_api_base_url_is_used(monkeypatch, capsys):
    monkeypatch.setenv("WAVEY_GIST_API_BASE_URL", "http://localhost:9999/")
    monkeypatch.setattr(publish_gist, "wavey_token", lambda: TOKEN)

    def handler(url, **_kwargs):
        assert url.startswith("http://localhost:9999/api/v1/")
        return _json_bytes(_gist_payload())

    monkeypatch.setattr(publish_gist, "_request", handler)
    assert publish_gist.main(["read", GIST_ID]) == 0
    assert json.loads(capsys.readouterr().out)["id"] == GIST_ID


def test_http_errors_preserve_status_and_backend_code(monkeypatch):
    response = io.BytesIO(
        _json_bytes({"error": {"code": "conflict", "message": "Conflict"}})
    )
    error = urllib.error.HTTPError(GIST_URL, 409, "Conflict", {}, response)

    def fail(_request, timeout):
        assert timeout == 30
        raise error

    monkeypatch.setattr(publish_gist.urllib.request, "urlopen", fail)

    with pytest.raises(
        publish_gist.ApiError,
        match="Wavey API error 409: conflict: Conflict",
    ):
        publish_gist._request(GIST_URL)
