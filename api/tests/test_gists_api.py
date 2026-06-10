import json

import pytest

from gist_api.app import create_app
from gist_api.db import gist_connection
from gist_api.external_ids import DEFAULT_EXTERNAL_ID_LENGTH

from .conftest import auth_header, create_gist, make_key

ETH_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678"
ETH_TX_HASH = "0x" + "a1" * 32


def test_create_public_render_raw_read_patch_and_delete(client, app):
    write_key = make_key(app, ["gist:write", "gist:delete"], name="creator")
    read_key = make_key(app, ["gist:read"])

    denied = client.post("/api/v1/gists", json={"markdown": "# Nope"})
    assert denied.status_code == 401

    created = client.post(
        "/api/v1/gists",
        headers=auth_header(write_key),
        json={
            "title": "Title",
            "markdown": "# Hello\n\n- [x] done",
            "author_name": "spoofed",
        },
    )
    assert created.status_code == 201
    body = created.get_json()
    assert set(body) == {
        "id",
        "url",
        "title",
        "author_name",
        "content_sha256",
        "revision_number",
        "latest_revision_number",
        "created_at",
        "updated_at",
    }
    assert len(body["id"]) == DEFAULT_EXTERNAL_ID_LENGTH
    assert body["id"].isascii()
    assert body["id"].isalnum()
    assert body["url"] == f"https://gist.example.com/{body['id']}"
    assert body["author_name"] == "creator"
    assert body["revision_number"] == 1
    assert body["latest_revision_number"] == 1

    public = client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    public_body = public.get_json()
    assert public_body["markdown"] == "# Hello\n\n- [x] done"
    assert public_body["author_name"] == "creator"
    assert public_body["revision_number"] == 1
    assert public_body["latest_revision_number"] == 1
    assert "<h1>Hello</h1>" in public_body["rendered_html"]
    assert "disabled" in public_body["rendered_html"]
    assert "url" not in public_body
    assert public_body["history"] == [
        {
            "revision_number": 1,
            "created_at": public_body["history"][0]["created_at"],
            "author_name": "creator",
            "is_latest": True,
            "url": body["url"],
        }
    ]

    forbidden = client.get(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key))
    assert forbidden.status_code == 403

    raw = client.get(f"/api/v1/gists/{body['id']}", headers=auth_header(read_key))
    assert raw.status_code == 200
    raw_body = raw.get_json()
    assert raw_body["markdown"] == "# Hello\n\n- [x] done"
    assert raw_body["author_name"] == "creator"

    stale = client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
        json={"markdown": "# Stale", "expected_content_sha256": "a" * 64},
    )
    assert stale.status_code == 409

    editor_key = make_key(app, ["gist:write", "gist:delete"], name="editor")
    updated = client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(editor_key),
        json={"title": None, "markdown": "# Updated"},
    )
    assert updated.status_code == 200
    updated_body = updated.get_json()
    assert updated_body["title"] is None
    assert updated_body["author_name"] == "editor"
    assert updated_body["revision_number"] == 2
    assert updated_body["latest_revision_number"] == 2

    with gist_connection(app) as conn:
        revision_rows = conn.execute(
            """
            select gist_revisions.revision_number, gist_revisions.author_name
            from gist_revisions
            join gists on gists.id = gist_revisions.gist_id
            where gists.external_id = ?
            order by revision_number
            """,
            (body["id"],),
        ).fetchall()
        gist_row = conn.execute(
            "select author_name, latest_revision_number from gists where external_id = ?",
            (body["id"],),
        ).fetchone()
    assert [dict(row) for row in revision_rows] == [
        {"revision_number": 1, "author_name": "creator"},
        {"revision_number": 2, "author_name": "editor"},
    ]
    assert dict(gist_row) == {"author_name": "editor", "latest_revision_number": 2}

    latest = client.get(f"/api/v1/gists/{body['id']}/render")
    assert latest.status_code == 200
    latest_body = latest.get_json()
    assert latest_body["markdown"] == "# Updated"
    assert latest_body["author_name"] == "editor"
    assert latest_body["revision_number"] == 2
    assert latest_body["latest_revision_number"] == 2
    assert len(latest_body["history"]) == 2
    assert latest_body["history"][0]["revision_number"] == 2
    assert latest_body["history"][0]["is_latest"] is True
    assert latest_body["history"][0]["url"] == body["url"]
    assert latest_body["history"][1]["revision_number"] == 1
    assert latest_body["history"][1]["is_latest"] is False
    assert latest_body["history"][1]["url"] == f"{body['url']}/revisions/1"

    first_revision = client.get(f"/api/v1/gists/{body['id']}/revisions/1/render")
    assert first_revision.status_code == 200
    first_revision_body = first_revision.get_json()
    assert first_revision_body["markdown"] == "# Hello\n\n- [x] done"
    assert first_revision_body["author_name"] == "creator"
    assert first_revision_body["revision_number"] == 1
    assert first_revision_body["latest_revision_number"] == 2

    assert client.get(f"/api/v1/gists/{body['id']}/revisions/0/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}/revisions/nope/render").status_code == 404

    other_delete = client.delete(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(editor_key),
    )
    assert other_delete.status_code == 404

    deleted = client.delete(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key))
    assert deleted.status_code == 204

    assert client.get(f"/api/v1/gists/{body['id']}/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}/revisions/1/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}", headers=auth_header(read_key)).status_code == 404
    assert client.delete(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key)).status_code == 404


def test_configured_external_id_length_create_render_patch_and_delete(tmp_path):
    configured_app = create_app(
        {
            "SQLITE_DB_PATH": str(tmp_path / "configured-id-length.sqlite3"),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "MAX_MARKDOWN_BYTES": 1024 * 1024,
            "ALLOW_EMPTY_MARKDOWN": False,
            "SQLITE_BUSY_TIMEOUT_MS": 5000,
            "API_WRITE_LIMIT_PER_24H": 1000,
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE": 1000,
            "GIST_EXTERNAL_ID_LENGTH": 24,
        }
    )
    configured_client = configured_app.test_client()
    write_key = make_key(
        configured_app,
        ["gist:read", "gist:write", "gist:delete"],
        name="configured",
    )

    created = configured_client.post(
        "/api/v1/gists",
        headers=auth_header(write_key),
        json={"title": "Configured", "markdown": "# Configured"},
    )
    assert created.status_code == 201
    body = created.get_json()
    assert len(body["id"]) == 24
    assert body["id"].isascii()
    assert body["id"].isalnum()

    public = configured_client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    assert public.get_json()["markdown"] == "# Configured"

    updated = configured_client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
        json={"markdown": "# Updated configured"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["revision_number"] == 2

    deleted = configured_client.delete(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
    )
    assert deleted.status_code == 204


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (15, "between 16 and 64"),
        (65, "between 16 and 64"),
        ("24", "must be an integer"),
    ],
)
def test_external_id_length_config_is_validated(tmp_path, value, message):
    with pytest.raises(RuntimeError, match=message):
        create_app(
            {
                "SQLITE_DB_PATH": str(tmp_path / "bad-id-length.sqlite3"),
                "GIST_EXTERNAL_ID_LENGTH": value,
            }
        )


def test_api_ethereum_entity_rendering_defaults_on_and_can_be_disabled(client, app):
    write_key = make_key(app, ["gist:write"], name="ethereum")

    created = create_gist(client, write_key, markdown=f"Address {ETH_ADDRESS}")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    public = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    assert "eth-entity" in public["rendered_html"]
    assert "eth-address" in public["rendered_html"]

    updated = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(write_key),
        json={"markdown": f"Tx {ETH_TX_HASH}"},
    )
    assert updated.status_code == 200
    latest = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    assert "eth-entity" in latest["rendered_html"]
    assert "eth-tx" in latest["rendered_html"]

    app.config["ETHEREUM_ENTITY_RENDERING"] = False
    disabled = create_gist(client, write_key, markdown=f"Address {ETH_ADDRESS}")
    assert disabled.status_code == 201
    disabled_id = disabled.get_json()["id"]
    disabled_public = client.get(f"/api/v1/gists/{disabled_id}/render").get_json()
    assert ETH_ADDRESS in disabled_public["rendered_html"]
    assert "eth-entity" not in disabled_public["rendered_html"]

    disabled_update = client.patch(
        f"/api/v1/gists/{disabled_id}",
        headers=auth_header(write_key),
        json={"markdown": f"Tx {ETH_TX_HASH}"},
    )
    assert disabled_update.status_code == 200
    disabled_latest = client.get(f"/api/v1/gists/{disabled_id}/render").get_json()
    assert ETH_TX_HASH in disabled_latest["rendered_html"]
    assert "eth-entity" not in disabled_latest["rendered_html"]


def test_delete_gist_requires_delete_scope_and_original_creator(client, app):
    owner_key = make_key(
        app,
        ["gist:read", "gist:write", "gist:delete"],
        name="owner",
    )
    other_delete_key = make_key(app, ["gist:delete"], name="other")
    writer_key = make_key(app, ["gist:read", "gist:write"], name="writer")

    owner_created = create_gist(client, owner_key, "# Owner")
    writer_created = create_gist(client, writer_key, "# Writer")
    assert owner_created.status_code == 201
    assert writer_created.status_code == 201
    owner_body = owner_created.get_json()
    writer_body = writer_created.get_json()

    assert client.delete(f"/api/v1/gists/{owner_body['id']}").status_code == 401

    forbidden = client.delete(
        f"/api/v1/gists/{writer_body['id']}",
        headers=auth_header(writer_key),
    )
    assert forbidden.status_code == 403

    invalid = client.delete(
        "/api/v1/gists/not-a-valid-id",
        headers=auth_header(owner_key),
    )
    assert invalid.status_code == 404

    hidden = client.delete(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(other_delete_key),
    )
    assert hidden.status_code == 404
    assert client.get(f"/api/v1/gists/{owner_body['id']}/render").status_code == 200

    deleted = client.delete(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(owner_key),
    )
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/gists/{owner_body['id']}/render").status_code == 404


def test_existing_32_character_gist_ids_remain_readable(client, app):
    write_key = make_key(app, ["gist:write"], name="creator")
    created = client.post(
        "/api/v1/gists",
        json={"markdown": "# Legacy ID"},
        headers=auth_header(write_key),
    )
    assert created.status_code == 201
    original_id = created.get_json()["id"]
    existing_id = "B" * 32

    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "update gists set external_id = ? where external_id = ?",
                (existing_id, original_id),
            )

    public = client.get(f"/api/v1/gists/{existing_id}/render")
    assert public.status_code == 200
    body = public.get_json()
    assert body["id"] == existing_id
    assert body["markdown"] == "# Legacy ID"


def test_legacy_base64url_gist_ids_remain_readable(client, app):
    write_key = make_key(app, ["gist:write"], name="creator")
    created = client.post(
        "/api/v1/gists",
        json={"markdown": "# Legacy ID"},
        headers=auth_header(write_key),
    )
    assert created.status_code == 201
    original_id = created.get_json()["id"]
    legacy_id = ("A" * 30) + "_-"

    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "update gists set external_id = ? where external_id = ?",
                (legacy_id, original_id),
            )

    public = client.get(f"/api/v1/gists/{legacy_id}/render")
    assert public.status_code == 200
    body = public.get_json()
    assert body["id"] == legacy_id
    assert body["markdown"] == "# Legacy ID"


def test_me_gists_lists_only_gists_created_by_session_key(client, app):
    owner_key = make_key(
        app,
        ["gist:read", "gist:write"],
        name="owner",
        github_login="owner",
    )
    editor_key = make_key(app, ["gist:read", "gist:write"], name="editor")

    owner_created = create_gist(client, owner_key, "# Owner", title="Owner")
    other_created = create_gist(client, editor_key, "# Other", title="Other")
    assert owner_created.status_code == 201
    assert other_created.status_code == 201
    owner_body = owner_created.get_json()
    other_body = other_created.get_json()

    updated_owner = client.patch(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(editor_key),
        json={"title": "Edited by someone else"},
    )
    assert updated_owner.status_code == 200
    updated_other = client.patch(
        f"/api/v1/gists/{other_body['id']}",
        headers=auth_header(owner_key),
        json={"title": "Edited by owner"},
    )
    assert updated_other.status_code == 200

    assert client.get("/api/v1/me/gists").status_code == 401

    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    response = client.get("/api/v1/me/gists")
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["gists"]) == 1
    assert body["gists"][0] == {
        "id": owner_body["id"],
        "url": owner_body["url"],
        "title": "Edited by someone else",
        "author_name": "editor",
        "revision_number": 2,
        "updated_at": body["gists"][0]["updated_at"],
    }
    assert "markdown" not in body["gists"][0]
    assert "rendered_html" not in body["gists"][0]


def test_me_gist_delete_requires_session_delete_scope_and_ownership(client, app):
    owner_key = make_key(
        app,
        ["gist:read", "gist:write", "gist:delete"],
        name="owner",
    )
    other_key = make_key(
        app,
        ["gist:read", "gist:write", "gist:delete"],
        name="other",
    )
    read_write_key = make_key(
        app,
        ["gist:read", "gist:write"],
        name="reader-writer",
    )

    owner_created = create_gist(client, owner_key, "# Owner")
    other_created = create_gist(client, other_key, "# Other")
    read_write_created = create_gist(client, read_write_key, "# Read write")
    assert owner_created.status_code == 201
    assert other_created.status_code == 201
    assert read_write_created.status_code == 201
    owner_body = owner_created.get_json()
    other_body = other_created.get_json()
    read_write_body = read_write_created.get_json()

    assert client.delete(f"/api/v1/me/gists/{owner_body['id']}").status_code == 401

    login = client.post("/api/v1/auth/session", json={"api_key": read_write_key})
    assert login.status_code == 200
    assert login.get_json()["can_delete_gists"] is False
    forbidden = client.delete(f"/api/v1/me/gists/{read_write_body['id']}")
    assert forbidden.status_code == 403

    assert client.delete("/api/v1/auth/session").status_code == 204
    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200
    assert login.get_json()["can_delete_gists"] is True

    hidden = client.delete(f"/api/v1/me/gists/{other_body['id']}")
    assert hidden.status_code == 404

    listed_before = client.get("/api/v1/me/gists")
    assert listed_before.status_code == 200
    assert [gist["id"] for gist in listed_before.get_json()["gists"]] == [
        owner_body["id"]
    ]

    deleted = client.delete(f"/api/v1/me/gists/{owner_body['id']}")
    assert deleted.status_code == 204

    listed_after = client.get("/api/v1/me/gists")
    assert listed_after.status_code == 200
    assert listed_after.get_json()["gists"] == []
    assert client.get(f"/api/v1/gists/{owner_body['id']}/render").status_code == 404
    assert client.delete(f"/api/v1/me/gists/{owner_body['id']}").status_code == 404


def test_sanitizer_strips_scriptable_content(client, app):
    write_key = make_key(app, ["gist:write"])
    markdown = """
<script>alert(1)</script>
<img src="javascript:alert(1)" onerror="alert(1)">
<a href="javascript:alert(1)" onclick="alert(1)">bad</a>
<svg><script>alert(1)</script></svg>
"""

    created = create_gist(client, write_key, markdown)
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    public = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    html = public["rendered_html"].lower()
    assert "<script" not in html
    assert "alert(1)" not in html
    assert "javascript:" not in html
    assert "onerror" not in html
    assert "onclick" not in html
    assert "<svg" not in html


def test_public_history_is_bounded_to_latest_50_revisions(client, app):
    write_key = make_key(app, ["gist:write"], name="historian")
    created = create_gist(client, write_key, "# First")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    for index in range(52):
        updated = client.patch(
            f"/api/v1/gists/{gist_id}",
            headers=auth_header(write_key),
            json={"title": f"Revision {index + 2}"},
        )
        assert updated.status_code == 200

    public = client.get(f"/api/v1/gists/{gist_id}/render")
    assert public.status_code == 200
    history = public.get_json()["history"]
    assert len(history) == 50
    assert history[0]["revision_number"] == 53
    assert history[0]["is_latest"] is True
    assert history[-1]["revision_number"] == 4

    first_revision = client.get(f"/api/v1/gists/{gist_id}/revisions/1/render")
    assert first_revision.status_code == 200
    assert first_revision.get_json()["revision_number"] == 1


def test_validation_and_non_gist_routes_are_not_globally_authed(client, app):
    key = make_key(app, ["gist:write"])

    assert client.get("/api/v1/other").status_code == 200
    assert client.get("/api/v1/gists/not-a-valid-id/render").status_code == 404

    empty = create_gist(client, key, "   ")
    assert empty.status_code == 400

    long_title = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={"title": "x" * 201, "markdown": "ok"},
    )
    assert long_title.status_code == 400


def test_oversized_request_body_returns_json_413(client, app):
    key = make_key(app, ["gist:write"])
    markdown = "x" * (app.config["MAX_REQUEST_BYTES"] + 1)

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data=json.dumps({"markdown": markdown}),
        content_type="application/json",
    )

    assert app.config["MAX_CONTENT_LENGTH"] == app.config["MAX_REQUEST_BYTES"]
    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "payload_too_large"


def test_api_responses_include_security_headers(client):
    response = client.get("/api/v1/healthz")

    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert response.headers["Content-Security-Policy"] == (
        "default-src 'none'; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'"
    )
