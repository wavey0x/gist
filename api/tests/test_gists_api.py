import hashlib
import io
import json
import zipfile

import pytest
from werkzeug.datastructures import MultiDict
from werkzeug.test import EnvironBuilder

from gist_api.app import create_app
from gist_api.db import gist_connection
from gist_api.external_ids import DEFAULT_EXTERNAL_ID_LENGTH
from gist_api import markdown as markdown_module

from .conftest import auth_header, create_gist, make_key

ETH_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678"
ETH_TX_HASH = "0x" + "a1" * 32


def test_create_public_render_raw_read_patch_and_delete(client, app):
    write_key = make_key(app, name="creator")
    read_key = make_key(app)

    denied = client.post(
        "/api/v1/gists",
        json={"files": {"README.md": {"content": "# Nope"}}},
    )
    assert denied.status_code == 401

    created = client.post(
        "/api/v1/gists",
        headers=auth_header(write_key),
        json={
            "title": "Title",
            "files": {
                "README.md": {"content": "# Hello\n\n- [x] done"},
                "hello.py": {"content": "print('hello')\n"},
            },
        },
    )
    assert created.status_code == 201
    body = created.get_json()
    assert set(body) == {
        "id", "url", "title", "display_title", "author_name", "primary_file",
        "snapshot_sha256", "revision_number", "latest_revision_number",
        "created_at", "updated_at", "files",
    }
    assert len(body["id"]) == DEFAULT_EXTERNAL_ID_LENGTH
    assert body["id"].isascii()
    assert body["id"].isalnum()
    assert body["url"] == f"https://gist.example.com/{body['id']}"
    assert body["author_name"] == "creator"
    assert body["display_title"] == "Title"
    assert body["primary_file"] == "README.md"
    assert set(body["files"]) == {"README.md", "hello.py"}
    assert body["files"]["README.md"]["content"] == "# Hello\n\n- [x] done"
    assert body["files"]["hello.py"]["content"] == "print('hello')\n"
    assert body["revision_number"] == 1
    assert body["latest_revision_number"] == 1

    public = client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    public_body = public.get_json()
    readme = public_body["files"]["README.md"]
    source = public_body["files"]["hello.py"]
    assert readme["content"] == "# Hello\n\n- [x] done"
    assert readme["content_sha256"] == hashlib.sha256(readme["content"].encode()).hexdigest()
    assert readme["kind"] == "markdown"
    assert readme["language"] == "Markdown"
    assert readme["raw_url"] == f"{body['url']}/raw/README.md"
    assert source["kind"] == "source"
    assert source["language"] == "python"
    assert source["raw_url"] == f"{body['url']}/raw/hello.py"
    assert public_body["snapshot_sha256"] == body["snapshot_sha256"]
    assert public_body["author_name"] == "creator"
    assert public_body["revision_number"] == 1
    assert public_body["latest_revision_number"] == 1
    assert public_body["created_at"] == body["created_at"]
    assert "<h1>Hello</h1>" in readme["rendered_html"]
    assert "disabled" in readme["rendered_html"]
    assert public_body["url"] == body["url"]
    assert public_body["history"] == [
        {
            "revision_number": 1,
            "created_at": public_body["history"][0]["created_at"],
            "author_name": "creator",
            "snapshot_sha256": body["snapshot_sha256"],
            "file_count": 2,
            "is_latest": True,
            "url": body["url"],
        }
    ]

    raw = client.get(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key))
    assert raw.status_code == 200
    raw_body = raw.get_json()
    assert raw_body["files"]["README.md"]["content"] == "# Hello\n\n- [x] done"
    assert raw_body["author_name"] == "creator"

    stale = client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
        json={
            "files": {"README.md": {"content": "# Stale"}},
            "expected_snapshot_sha256": "a" * 64,
        },
    )
    assert stale.status_code == 409

    other_key = make_key(app, name="other")
    hidden_patch = client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(other_key),
        json={
            "title": None,
            "files": {"README.md": {"content": "# Updated"}},
            "expected_snapshot_sha256": body["snapshot_sha256"],
        },
    )
    assert hidden_patch.status_code == 404

    updated = client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
        json={
            "title": None,
            "files": {"README.md": {"content": "# Updated"}},
            "expected_snapshot_sha256": body["snapshot_sha256"],
        },
    )
    assert updated.status_code == 200
    updated_body = updated.get_json()
    assert updated_body["title"] is None
    assert updated_body["author_name"] == "creator"
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
            "select latest_revision_number from gists where external_id = ?",
            (body["id"],),
        ).fetchone()
    assert [dict(row) for row in revision_rows] == [
        {"revision_number": 1, "author_name": "creator"},
        {"revision_number": 2, "author_name": "creator"},
    ]
    assert dict(gist_row) == {"latest_revision_number": 2}

    latest = client.get(f"/api/v1/gists/{body['id']}/render")
    assert latest.status_code == 200
    latest_body = latest.get_json()
    assert latest_body["files"]["README.md"]["content"] == "# Updated"
    assert set(latest_body["files"]) == {"README.md"}
    assert latest_body["author_name"] == "creator"
    assert latest_body["revision_number"] == 2
    assert latest_body["latest_revision_number"] == 2
    assert latest_body["created_at"] == body["created_at"]
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
    assert first_revision_body["files"]["README.md"]["content"] == "# Hello\n\n- [x] done"
    assert first_revision_body["snapshot_sha256"] != latest_body["snapshot_sha256"]
    assert first_revision_body["files"]["README.md"]["raw_url"] == (
        f"{body['url']}/revisions/1/raw/README.md"
    )
    assert first_revision_body["author_name"] == "creator"
    assert first_revision_body["revision_number"] == 1
    assert first_revision_body["latest_revision_number"] == 2
    assert first_revision_body["created_at"] == body["created_at"]

    assert client.get(f"/api/v1/gists/{body['id']}/revisions/0/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}/revisions/nope/render").status_code == 404

    other_delete = client.delete(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(other_key),
    )
    assert other_delete.status_code == 404

    deleted = client.delete(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key))
    assert deleted.status_code == 204

    assert client.get(f"/api/v1/gists/{body['id']}/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}/revisions/1/render").status_code == 404
    assert client.get(f"/api/v1/gists/{body['id']}", headers=auth_header(read_key)).status_code == 404
    assert client.delete(f"/api/v1/gists/{body['id']}", headers=auth_header(write_key)).status_code == 404


def test_patch_is_full_snapshot_title_only_noop_and_conflict_safe(client, app):
    key = make_key(app, name="owner")
    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "files": {
                "README.md": {"content": "# First\n"},
                "old.txt": {"content": "remove me\n"},
            }
        },
    ).get_json()

    title_only = client.patch(
        f"/api/v1/gists/{created['id']}",
        headers=auth_header(key),
        json={
            "title": "Explicit",
            "expected_snapshot_sha256": created["snapshot_sha256"],
        },
    )
    assert title_only.status_code == 200
    title_body = title_only.get_json()
    assert title_body["revision_number"] == 2
    assert title_body["files"] == created["files"]

    no_op = client.patch(
        f"/api/v1/gists/{created['id']}",
        headers=auth_header(key),
        json={
            "title": "Explicit",
            "expected_snapshot_sha256": title_body["snapshot_sha256"],
        },
    )
    assert no_op.status_code == 200
    assert no_op.get_json()["revision_number"] == 2

    replacement = client.patch(
        f"/api/v1/gists/{created['id']}",
        headers=auth_header(key),
        json={
            "files": {"main.py": {"content": "print('new')\n"}},
            "expected_snapshot_sha256": title_body["snapshot_sha256"],
        },
    )
    assert replacement.status_code == 200
    replacement_body = replacement.get_json()
    assert replacement_body["revision_number"] == 3
    assert replacement_body["primary_file"] == "main.py"
    assert set(replacement_body["files"]) == {"main.py"}

    stale = client.patch(
        f"/api/v1/gists/{created['id']}",
        headers=auth_header(key),
        json={
            "title": "Lost update",
            "expected_snapshot_sha256": title_body["snapshot_sha256"],
        },
    )
    assert stale.status_code == 409

    with gist_connection(app) as conn:
        revisions = conn.execute(
            """
            select count(*) from gist_revisions
            where gist_id = (select id from gists where external_id = ?)
            """,
            (created["id"],),
        ).fetchone()[0]
    assert revisions == 3


def test_lead_changes_are_derived_from_complete_file_snapshot(client, app):
    key = make_key(app)
    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "files": {
                "z.py": {"content": "pass\n"},
                "guide.md": {"content": "# Guide\n"},
            }
        },
    ).get_json()
    assert created["primary_file"] == "guide.md"

    updated = client.patch(
        f"/api/v1/gists/{created['id']}",
        headers=auth_header(key),
        json={
            "files": {
                "z.py": {"content": "pass\n"},
                "guide.md": {"content": "# Guide\n"},
                "README.md": {"content": "# Read me\n"},
            },
            "expected_snapshot_sha256": created["snapshot_sha256"],
        },
    ).get_json()
    assert updated["primary_file"] == "README.md"
    assert client.get(
        f"/api/v1/gists/{created['id']}/revisions/1/render"
    ).get_json()["primary_file"] == "guide.md"


def test_source_and_plain_files_are_safely_rendered_under_one_highlight_budget(
    client, app, monkeypatch
):
    monkeypatch.setattr(markdown_module, "MAX_HIGHLIGHT_BLOCKS", 1)
    key = make_key(app)
    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "files": {
                "a.py": {"content": "print('<script>')\n"},
                "b.py": {"content": "print('second')\n"},
                "notes.log": {"content": "<script>alert(1)</script>\n"},
            }
        },
    )
    assert created.status_code == 201
    rendered = client.get(
        f"/api/v1/gists/{created.get_json()['id']}/render"
    ).get_json()
    html_fragments = [file["rendered_html"] for file in rendered["files"].values()]
    assert sum('class="highlight ' in fragment for fragment in html_fragments) == 1
    assert "<script>" not in rendered["files"]["notes.log"]["rendered_html"]
    assert "&lt;script&gt;" in rendered["files"]["notes.log"]["rendered_html"]


def test_configured_external_id_length_create_render_patch_and_delete(tmp_path):
    configured_app = create_app(
        {
            "SQLITE_DB_PATH": str(tmp_path / "configured-id-length.sqlite3"),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "PUBLIC_API_BASE_URL": "https://api.example.com",
            "MAX_GIST_TEXT_BYTES": 1024 * 1024,
            "MAX_GIST_FILES": 32,
            "SQLITE_BUSY_TIMEOUT_MS": 5000,
            "API_WRITE_LIMIT_PER_24H": 1000,
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE": 1000,
            "GIST_EXTERNAL_ID_LENGTH": 24,
        }
    )
    configured_client = configured_app.test_client()
    write_key = make_key(configured_app, name="configured")

    created = configured_client.post(
        "/api/v1/gists",
        headers=auth_header(write_key),
        json={
            "title": "Configured",
            "files": {"README.md": {"content": "# Configured"}},
        },
    )
    assert created.status_code == 201
    body = created.get_json()
    assert len(body["id"]) == 24
    assert body["id"].isascii()
    assert body["id"].isalnum()

    public = configured_client.get(f"/api/v1/gists/{body['id']}/render")
    assert public.status_code == 200
    assert public.get_json()["files"]["README.md"]["content"] == "# Configured"

    updated = configured_client.patch(
        f"/api/v1/gists/{body['id']}",
        headers=auth_header(write_key),
        json={
            "files": {"README.md": {"content": "# Updated configured"}},
            "expected_snapshot_sha256": body["snapshot_sha256"],
        },
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


def test_public_deployment_requires_public_api_base_url(tmp_path):
    with pytest.raises(RuntimeError, match="PUBLIC_API_BASE_URL must be set"):
        create_app(
            {
                "SQLITE_DB_PATH": str(tmp_path / "public-with-local-api.sqlite3"),
                "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
                "PUBLIC_API_BASE_URL": "http://localhost:3001",
            }
        )


def test_api_ethereum_entity_rendering_is_always_enabled(client, app):
    write_key = make_key(app, name="ethereum")

    created = create_gist(client, write_key, markdown=f"Address {ETH_ADDRESS}")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    public = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    assert "eth-entity" in public["files"]["README.md"]["rendered_html"]
    assert "eth-address" in public["files"]["README.md"]["rendered_html"]

    updated = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(write_key),
        json={
            "files": {"README.md": {"content": f"Tx {ETH_TX_HASH}"}},
            "expected_snapshot_sha256": created.get_json()["snapshot_sha256"],
        },
    )
    assert updated.status_code == 200
    latest = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    assert "eth-entity" in latest["files"]["README.md"]["rendered_html"]
    assert "eth-tx" in latest["files"]["README.md"]["rendered_html"]



def test_delete_gist_requires_original_creator(client, app):
    owner_key = make_key(app, name="owner")
    other_key = make_key(app, name="other")

    owner_created = create_gist(client, owner_key, "# Owner")
    other_created = create_gist(client, other_key, "# Other")
    assert owner_created.status_code == 201
    assert other_created.status_code == 201
    owner_body = owner_created.get_json()

    assert client.delete(f"/api/v1/gists/{owner_body['id']}").status_code == 401

    invalid = client.delete(
        "/api/v1/gists/not-a-valid-id",
        headers=auth_header(owner_key),
    )
    assert invalid.status_code == 404

    hidden = client.delete(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(other_key),
    )
    assert hidden.status_code == 404
    assert client.get(f"/api/v1/gists/{owner_body['id']}/render").status_code == 200

    deleted = client.delete(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(owner_key),
    )
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/gists/{owner_body['id']}/render").status_code == 404


def test_me_gists_lists_only_gists_created_by_session_key(client, app):
    owner_key = make_key(
        app,
        name="owner",
        github_login="owner",
    )
    editor_key = make_key(app, name="editor")

    owner_created = create_gist(client, owner_key, "# Owner", title="Owner")
    other_created = create_gist(client, editor_key, "# Other", title="Other")
    assert owner_created.status_code == 201
    assert other_created.status_code == 201
    owner_body = owner_created.get_json()
    other_body = other_created.get_json()

    hidden_owner_update = client.patch(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(editor_key),
        json={
            "title": "Edited by someone else",
            "expected_snapshot_sha256": owner_body["snapshot_sha256"],
        },
    )
    assert hidden_owner_update.status_code == 404
    hidden_other_update = client.patch(
        f"/api/v1/gists/{other_body['id']}",
        headers=auth_header(owner_key),
        json={
            "title": "Edited by owner",
            "expected_snapshot_sha256": other_body["snapshot_sha256"],
        },
    )
    assert hidden_other_update.status_code == 404
    updated_owner = client.patch(
        f"/api/v1/gists/{owner_body['id']}",
        headers=auth_header(owner_key),
        json={
            "title": "Edited by owner",
            "expected_snapshot_sha256": owner_body["snapshot_sha256"],
        },
    )
    assert updated_owner.status_code == 200

    assert client.get("/api/v1/me/gists").status_code == 401

    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    response = client.get("/api/v1/me/gists")
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["gists"]) == 1
    assert body["stats"] == {
        "gist_count": 1,
        "revision_count": 2,
        "last_updated_at": body["gists"][0]["updated_at"],
    }
    assert body["gists"][0] == {
        "id": owner_body["id"],
        "url": owner_body["url"],
        "title": "Edited by owner",
        "display_title": "Edited by owner",
        "author_name": "owner",
        "revision_number": 2,
        "file_count": 1,
        "created_at": owner_body["created_at"],
        "updated_at": body["gists"][0]["updated_at"],
    }
    assert "markdown" not in body["gists"][0]
    assert "rendered_html" not in body["gists"][0]


def test_me_gist_export_contains_only_current_owned_gists(client, app):
    owner_key = make_key(app, name="owner")
    other_key = make_key(app, name="other")

    first = create_gist(
        client,
        owner_key,
        markdown="# First\n\nInitial",
        title="First title",
    ).get_json()
    second = create_gist(
        client,
        owner_key,
        markdown="# Second\n\nKeep",
        title=None,
    ).get_json()
    removed = create_gist(
        client,
        owner_key,
        markdown="# Removed",
        title="Removed",
    ).get_json()
    other = create_gist(
        client,
        other_key,
        markdown="# Other",
        title="Other",
    ).get_json()

    updated = client.patch(
        f"/api/v1/gists/{first['id']}",
        headers=auth_header(owner_key),
        json={
            "files": {"README.md": {"content": "# First\n\nLatest ✓"}},
            "expected_snapshot_sha256": first["snapshot_sha256"],
        },
    )
    assert updated.status_code == 200
    deleted = client.delete(
        f"/api/v1/gists/{removed['id']}",
        headers=auth_header(owner_key),
    )
    assert deleted.status_code == 204

    assert client.get("/api/v1/me/gists/export").status_code == 401
    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    response = client.get("/api/v1/me/gists/export")
    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert response.headers["Content-Disposition"].startswith(
        "attachment; filename=waveygist-export-"
    )
    assert response.headers["Cache-Control"] == "private, no-store"

    with zipfile.ZipFile(io.BytesIO(response.data)) as exported:
        assert set(exported.namelist()) == {
            "wavey-gist-export.json",
            f"gists/{first['id']}/README.md",
            f"gists/{second['id']}/README.md",
        }
        assert (
            exported.read(f"gists/{first['id']}/README.md").decode()
            == "# First\n\nLatest ✓"
        )
        assert (
            exported.read(f"gists/{second['id']}/README.md").decode()
            == "# Second\n\nKeep"
        )
        manifest = json.loads(exported.read("wavey-gist-export.json"))

    assert manifest["format"] == "waveygist-export"
    assert manifest["manifest_version"] == 2
    assert manifest["gist_count"] == 2
    assert [gist["id"] for gist in manifest["gists"]] == [
        first["id"],
        second["id"],
    ]
    assert manifest["gists"][0]["revision_number"] == 2
    assert manifest["gists"][0]["primary_file"] == "README.md"
    assert manifest["gists"][0]["files"] == [
        {
            "filename": "README.md",
            "path": f"gists/{first['id']}/README.md",
            "content_sha256": hashlib.sha256("# First\n\nLatest ✓".encode()).hexdigest(),
            "byte_size": len("# First\n\nLatest ✓".encode()),
        }
    ]
    assert manifest["gists"][0]["display_title"] == "First title"
    assert manifest["gists"][1]["display_title"] == "Second"
    assert removed["id"] not in response.data.decode("latin-1")
    assert other["id"] not in response.data.decode("latin-1")
    assert owner_key not in response.data.decode("latin-1")


def test_me_gist_stats_are_zero_for_an_empty_account(client, app):
    owner_key = make_key(app, name="owner")
    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    body = client.get("/api/v1/me/gists").get_json()
    assert body == {
        "gists": [],
        "stats": {
            "gist_count": 0,
            "revision_count": 0,
            "last_updated_at": None,
        },
    }


def test_custom_key_avatar_is_returned_with_public_and_account_gists(client, app):
    avatar_url = "https://api.example.com/api/v1/avatars/ted.png"
    owner_key = make_key(
        app,
        name="ted-mckinsey",
        avatar_url=avatar_url,
    )

    created = create_gist(client, owner_key, "# Ted", title="Ted")
    assert created.status_code == 201
    created_body = created.get_json()

    public = client.get(f"/api/v1/gists/{created_body['id']}/render")
    assert public.status_code == 200
    public_body = public.get_json()
    assert public_body["author_name"] == "ted-mckinsey"
    assert public_body["author_avatar_url"] == avatar_url
    assert public_body["history"][0]["author_avatar_url"] == avatar_url

    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    response = client.get("/api/v1/me/gists")
    assert response.status_code == 200
    body = response.get_json()
    assert body["gists"][0]["author_avatar_url"] == avatar_url


def test_me_gists_display_title_falls_back_to_latest_heading(client, app):
    owner_key = make_key(app, name="owner")

    created = create_gist(
        client,
        owner_key,
        markdown="# Initial heading\n\nBody",
        title=None,
    )
    assert created.status_code == 201
    created_body = created.get_json()

    updated = client.patch(
        f"/api/v1/gists/{created_body['id']}",
        headers=auth_header(owner_key),
        json={
            "files": {
                "README.md": {"content": "# Latest *Heading* & Title\n\nBody"}
            },
            "expected_snapshot_sha256": created_body["snapshot_sha256"],
        },
    )
    assert updated.status_code == 200

    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

    response = client.get("/api/v1/me/gists")
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["gists"]) == 1
    assert body["gists"][0]["id"] == created_body["id"]
    assert body["gists"][0]["title"] is None
    assert body["gists"][0]["display_title"] == "Latest Heading & Title"
    assert body["gists"][0]["revision_number"] == 2
    assert "markdown" not in body["gists"][0]
    assert "rendered_html" not in body["gists"][0]


def test_me_gist_delete_requires_session_ownership(client, app):
    owner_key = make_key(app, name="owner")
    other_key = make_key(app, name="other")

    owner_created = create_gist(client, owner_key, "# Owner")
    other_created = create_gist(client, other_key, "# Other")
    assert owner_created.status_code == 201
    assert other_created.status_code == 201
    owner_body = owner_created.get_json()
    other_body = other_created.get_json()

    assert client.delete(f"/api/v1/me/gists/{owner_body['id']}").status_code == 401

    login = client.post("/api/v1/auth/session", json={"api_key": owner_key})
    assert login.status_code == 200

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
    write_key = make_key(app)
    markdown = """
<script>alert(1)</script>
<img src="javascript:alert(1)" onerror="alert(1)">
![tracker](https://tracker.example/pixel.png)
<a href="javascript:alert(1)" onclick="alert(1)">bad</a>
<svg><script>alert(1)</script></svg>
"""

    created = create_gist(client, write_key, markdown)
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    public = client.get(f"/api/v1/gists/{gist_id}/render").get_json()
    html = public["files"]["README.md"]["rendered_html"].lower()
    assert "<script" not in html
    assert "alert(1)" not in html
    assert "javascript:" not in html
    assert "tracker.example" not in html
    assert "<img" not in html
    assert "onerror" not in html
    assert "onclick" not in html
    assert "<svg" not in html


def test_public_history_is_bounded_to_latest_50_revisions(client, app):
    write_key = make_key(app, name="historian")
    created = create_gist(client, write_key, "# First")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]
    snapshot = created.get_json()["snapshot_sha256"]

    for index in range(52):
        updated = client.patch(
            f"/api/v1/gists/{gist_id}",
            headers=auth_header(write_key),
            json={
                "title": f"Revision {index + 2}",
                "expected_snapshot_sha256": snapshot,
            },
        )
        assert updated.status_code == 200
        snapshot = updated.get_json()["snapshot_sha256"]

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
    key = make_key(app)

    assert client.get("/api/v1/other").status_code == 200
    assert client.get("/api/v1/gists/not-a-valid-id/render").status_code == 404

    empty = create_gist(client, key, "   ")
    assert empty.status_code == 400

    long_title = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "title": "x" * 201,
            "files": {"README.md": {"content": "ok"}},
        },
    )
    assert long_title.status_code == 400


def test_gist_routes_reject_unknown_and_route_inappropriate_json_fields(
    client,
    app,
):
    key = make_key(app)
    created = create_gist(client, key, "# Existing")
    gist_id = created.get_json()["id"]

    unknown_create = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "files": {"README.md": {"content": "# New"}},
            "author_name": "spoofed",
        },
    )
    create_concurrency = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={
            "files": {"README.md": {"content": "# New"}},
            "expected_snapshot_sha256": "a" * 64,
        },
    )
    unknown_update = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        json={
            "files": {"README.md": {"content": "# Updated"}},
            "expected_snapshot_sha256": created.get_json()["snapshot_sha256"],
            "extra": True,
        },
    )

    for response in (unknown_create, create_concurrency, unknown_update):
        assert response.status_code == 400
        assert response.get_json()["error"]["code"] == "invalid_request"
        assert "unknown field" in response.get_json()["error"]["message"]


def test_multipart_gist_requires_exactly_one_json_payload(client, app):
    key = make_key(app)

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data=MultiDict(
            [
                ("payload", '{"files":{"README.md":{"content":"# One"}}}'),
                ("payload", '{"files":{"README.md":{"content":"# Two"}}}'),
            ]
        ),
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == {
        "code": "invalid_request",
        "message": "exactly one payload field is required",
    }


def test_oversized_request_body_returns_json_413(client, app):
    key = make_key(app)
    markdown = "x" * (app.config["MAX_REQUEST_BYTES"] + 1)

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data=json.dumps({"files": {"README.md": {"content": markdown}}}),
        content_type="application/json",
    )

    assert app.config["MAX_CONTENT_LENGTH"] >= app.config["MAX_MULTIPART_REQUEST_BYTES"]
    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "payload_too_large"


def test_chunked_json_body_uses_the_json_stream_limit(client, app):
    key = make_key(app)
    content = "x" * (app.config["MAX_REQUEST_BYTES"] + 1)
    body = json.dumps({"files": {"README.md": {"content": content}}}).encode()

    builder = EnvironBuilder(
        path="/api/v1/gists",
        method="POST",
        headers={**auth_header(key), "Content-Type": "application/json"},
        input_stream=io.BytesIO(body),
        content_length=len(body),
    )
    environ = builder.get_environ()
    environ.pop("CONTENT_LENGTH")
    environ["wsgi.input_terminated"] = True
    response = client.open(environ)

    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "payload_too_large"


def test_oversized_multipart_payload_field_returns_json_413(client, app):
    key = make_key(app)
    content = "x" * app.config["MAX_REQUEST_BYTES"]

    response = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        data={
            "payload": json.dumps(
                {"files": {"README.md": {"content": content}}}
            )
        },
        content_type="multipart/form-data",
    )

    assert app.config["MAX_FORM_MEMORY_SIZE"] == app.config["MAX_REQUEST_BYTES"]
    assert app.config["MAX_FORM_PARTS"] == app.config["IMAGE_MAX_PER_REQUEST"] + 1
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
