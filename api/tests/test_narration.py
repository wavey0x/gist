import hashlib
from concurrent.futures import ThreadPoolExecutor

import pytest

from gist_api.auth import set_audio_generation_daily_limit, verify_api_key_value
from gist_api.db import gist_connection
from gist_api.errors import GistError
from gist_api.narration import (
    extract_narration_text,
    narration_storage_dir,
    prune_narrations,
    start_narration,
)

from .conftest import auth_header, create_gist, make_key


def _login(client, key):
    response = client.post("/api/v1/auth/session", json={"api_key": key})
    assert response.status_code == 200


def _narration_path(gist_id, revision_number=1):
    return f"/api/v1/gists/{gist_id}/revisions/{revision_number}/narration"


def _create_markdown_gist(client, key, *, markdown="# Article\n\nReadable prose."):
    response = create_gist(client, key, markdown=markdown, title="Article")
    assert response.status_code == 201
    return response.get_json()["id"]


def _auth(app, key):
    with gist_connection(app) as conn:
        auth, error = verify_api_key_value(conn, key)
    assert error is None
    return auth


def test_extract_narration_text_uses_semantics_and_skips_non_prose():
    rendered = """
    <h1>Article title</h1>
    <p>Hello <strong>reader</strong>. <code>secret()</code> Continue.</p>
    <pre>hidden preformatted text</pre>
    <ul><li>First item<ul><li>Nested item</li></ul></li></ul>
    <blockquote><p>A useful quotation</p></blockquote>
    <table><tr><td>hidden table</td></tr></table>
    <p hidden>hidden paragraph</p>
    <p aria-hidden="true">hidden aria paragraph</p>
    <div class="mermaid"><p>hidden diagram</p></div>
    """

    assert extract_narration_text(rendered, "Article title") == (
        "Article title.\n\n"
        "Hello reader. Continue.\n\n"
        "First item.\n\n"
        "Nested item.\n\n"
        "A useful quotation."
    )


def test_extract_narration_text_enforces_exact_character_limit():
    text = extract_narration_text("<p>abc</p>", "", max_chars=4)
    assert text == "abc."
    with pytest.raises(GistError) as exc_info:
        extract_narration_text("<p>abc</p>", "", max_chars=3)
    assert exc_info.value.code == "narration_too_long"


def test_narration_is_on_demand_and_requires_a_web_session(client, app):
    key = make_key(app)
    created = create_gist(
        client,
        key,
        markdown="# Article\n\nReadable prose.",
        title="Article",
    )
    assert created.status_code == 201
    gist_id = created.get_json()["id"]
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from narrations").fetchone()[0] == 0
    edited = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        json={
            "title": "Edited title",
            "expected_snapshot_sha256": created.get_json()["snapshot_sha256"],
        },
    )
    assert edited.status_code == 200
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from narrations").fetchone()[0] == 0

    path = _narration_path(gist_id)
    assert (
        client.post("/api/v1/gists/bad/revisions/0/narration", json={}).status_code
        == 404
    )
    assert client.post(path, json={}).status_code == 401
    assert client.post(path, headers=auth_header(key), json={}).status_code == 401

    _login(client, key)
    bad_body = client.post(path, json={"text": "caller supplied"})
    assert bad_body.status_code == 400
    created = client.post(path, json={})
    assert created.status_code == 202
    assert created.get_json() == {"status": "pending", "retryable": False}

    with gist_connection(app) as conn:
        row = conn.execute("select * from narrations").fetchone()
        assert len(row["service_job_id"]) == 36
        assert row["status"] == "pending"
        assert conn.execute("select count(*) from narrations").fetchone()[0] == 1
        assert (
            conn.execute("select count(*) from narration_watchers").fetchone()[0] == 1
        )


def test_non_markdown_primary_file_is_not_narratable(client, app):
    key = make_key(app)
    created = client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={"title": "Notes", "files": {"notes.txt": {"content": "hello"}}},
    )
    assert created.status_code == 201
    _login(client, key)

    response = client.post(_narration_path(created.get_json()["id"]), json={})
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "not_narratable"


def test_narration_requests_are_idempotent_under_concurrency(client, app):
    key = make_key(app)
    gist_id = _create_markdown_gist(client, key)
    auth = _auth(app, key)

    def request_once():
        return start_narration(app, auth, gist_id, 1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: request_once(), range(2)))

    assert results == [
        {"status": "pending", "retryable": False},
        {"status": "pending", "retryable": False},
    ]
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from narrations").fetchone()[0] == 1
        assert (
            conn.execute("select count(*) from narration_watchers").fetchone()[0] == 1
        )


def test_daily_limit_ignores_display_name_and_does_not_count_cache_hits(client, app):
    key = make_key(app, "wavey0x")
    gist_ids = [_create_markdown_gist(client, key) for _ in range(4)]
    _login(client, key)

    for gist_id in gist_ids[:3]:
        assert client.post(_narration_path(gist_id), json={}).status_code == 202
    assert client.post(_narration_path(gist_ids[0]), json={}).status_code == 202

    limited = client.post(_narration_path(gist_ids[3]), json={})
    assert limited.status_code == 429
    assert limited.get_json()["error"]["code"] == "daily_limit"


def test_audio_limit_zero_disables_capability_and_null_is_unlimited(client, app):
    disabled_key = make_key(app, "disabled")
    with gist_connection(app) as conn:
        disabled_id = conn.execute(
            "select id from api_keys where name = 'disabled'"
        ).fetchone()["id"]
        set_audio_generation_daily_limit(conn, disabled_id, 0)
    _login(client, disabled_key)
    assert client.get("/api/v1/auth/session").get_json()["can_generate_audio"] is False
    gist_id = _create_markdown_gist(client, disabled_key)
    assert client.post(_narration_path(gist_id), json={}).status_code == 403

    client.delete("/api/v1/auth/session")
    unlimited_key = make_key(app, "unlimited")
    with gist_connection(app) as conn:
        unlimited_id = conn.execute(
            "select id from api_keys where name = 'unlimited'"
        ).fetchone()["id"]
        set_audio_generation_daily_limit(conn, unlimited_id, None)
    _login(client, unlimited_key)
    for _ in range(4):
        gist_id = _create_markdown_gist(client, unlimited_key)
        assert client.post(_narration_path(gist_id), json={}).status_code == 202


def test_ready_audio_supports_head_and_byte_ranges(client, app):
    key = make_key(app)
    gist_id = _create_markdown_gist(client, key)
    _login(client, key)
    path = _narration_path(gist_id)
    assert client.post(path, json={}).status_code == 202

    audio = b"ID3article-audio-bytes"
    with gist_connection(app) as conn:
        row = conn.execute("select id from narrations").fetchone()
        filename = f"narration-{row['id']}.mp3"
        with conn:
            conn.execute(
                """
                update narrations
                set status = 'ready', engine_fingerprint = 'test-engine',
                    audio_filename = ?, audio_sha256 = ?, mime_type = 'audio/mpeg',
                    byte_size = ?, duration_ms = 1200, error_code = null,
                    updated_at = ?, finished_at = ?
                where id = ?
                """,
                (
                    filename,
                    hashlib.sha256(audio).hexdigest(),
                    len(audio),
                    "2026-08-28T12:00:00.000Z",
                    "2026-08-28T12:00:00.000Z",
                    row["id"],
                ),
            )
    audio_path = narration_storage_dir(app) / filename
    audio_path.write_bytes(audio)
    audio_path.chmod(0o600)

    status = client.get(path)
    assert status.status_code == 200
    assert status.get_json() == {
        "status": "ready",
        "retryable": False,
        "audio_url": f"/api/gists/{gist_id}/revisions/1/narration/audio",
    }
    audio_url = f"{path}/audio"
    head = client.head(audio_url)
    assert head.status_code == 200
    assert head.headers["Content-Length"] == str(len(audio))
    assert head.headers["Cache-Control"] == "private, no-store"
    partial = client.get(audio_url, headers={"Range": "bytes=3-9"})
    assert partial.status_code == 206
    assert partial.data == audio[3:10]
    assert partial.headers["Content-Range"] == f"bytes 3-9/{len(audio)}"
    invalid = client.get(audio_url, headers={"Range": "bytes=999-"})
    assert invalid.status_code == 416


def test_failed_job_has_one_explicit_retry(client, app):
    key = make_key(app)
    gist_id = _create_markdown_gist(client, key)
    _login(client, key)
    path = _narration_path(gist_id)
    client.post(path, json={})
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update narrations
                set status = 'failed', retry_count = 0,
                    error_code = 'generation_failed', finished_at = updated_at
                """
            )

    failed = client.get(path)
    assert failed.get_json() == {"status": "failed", "retryable": True}
    retried = client.post(path, json={})
    assert retried.status_code == 202
    assert retried.get_json() == {"status": "pending", "retryable": False}

    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update narrations
                set status = 'failed', retry_count = 1,
                    error_code = 'generation_failed', finished_at = updated_at
                """
            )
    terminal = client.post(path, json={})
    assert terminal.status_code == 200
    assert terminal.get_json() == {"status": "failed", "retryable": False}


def test_source_digest_change_is_rejected(client, app):
    key = make_key(app)
    gist_id = _create_markdown_gist(client, key)
    _login(client, key)
    path = _narration_path(gist_id)
    client.post(path, json={})
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update gist_revision_files
                set rendered_html = '<h1>Article</h1><p>Changed in place.</p>'
                """
            )

    response = client.get(path)
    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "source_mismatch"


def test_new_source_render_replaces_the_single_narration_identity(client, app):
    key = make_key(app)
    gist_id = _create_markdown_gist(client, key)
    _login(client, key)
    path = _narration_path(gist_id)
    assert client.post(path, json={}).status_code == 202

    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update gist_revision_files
                set render_version = 'test-render-v2',
                    rendered_html = '<h1>Article</h1><p>New rendering.</p>'
                """
            )

    assert client.post(path, json={}).status_code == 202
    with gist_connection(app) as conn:
        rows = conn.execute("select text_sha256 from narrations").fetchall()
        cleanup_count = conn.execute(
            "select count(*) from narration_cleanup_jobs"
        ).fetchone()[0]
    assert len(rows) == 1
    assert cleanup_count == 1


def test_admin_prune_deletes_oldest_ready_cache_row_before_file(client, app):
    key = make_key(app)
    _login(client, key)
    gist_ids = [_create_markdown_gist(client, key) for _ in range(2)]
    for gist_id in gist_ids:
        client.post(_narration_path(gist_id), json={})

    storage = narration_storage_dir(app)
    with gist_connection(app) as conn:
        rows = conn.execute("select id from narrations order by id").fetchall()
        for index, row in enumerate(rows):
            filename = f"narration-{row['id']}.mp3"
            (storage / filename).write_bytes(b"four")
            with conn:
                conn.execute(
                    """
                    update narrations
                    set status = 'ready', engine_fingerprint = 'test-engine',
                        audio_filename = ?, audio_sha256 = ?, mime_type = 'audio/mpeg',
                        byte_size = 4, duration_ms = 500,
                        updated_at = ?, finished_at = ?
                    where id = ?
                    """,
                    (
                        filename,
                        hashlib.sha256(b"four").hexdigest(),
                        f"2026-08-28T12:00:0{index}.000Z",
                        f"2026-08-28T12:00:0{index}.000Z",
                        row["id"],
                    ),
                )

    result = prune_narrations(app, 4)
    assert result["deleted_rows"] == 1
    assert result["deleted_files"] == 1
    assert result["remaining_bytes"] == 4
    with gist_connection(app) as conn:
        remaining = conn.execute("select id from narrations").fetchall()
    assert [row["id"] for row in remaining] == [rows[1]["id"]]

    orphan = storage / "narration-999.mp3"
    orphan.write_bytes(b"orphan")
    cleanup = prune_narrations(app, app.config["NARRATION_STORAGE_LIMIT_BYTES"])
    assert cleanup["deleted_rows"] == 0
    assert cleanup["deleted_files"] == 1
    assert orphan.exists() is False
