import hashlib

from gist_api.db import gist_connection
from gist_api.narration import narration_storage_dir

from .conftest import auth_header, create_gist, make_key


def _login(client, key):
    response = client.post("/api/v1/auth/session", json={"api_key": key})
    assert response.status_code == 200


def _request_narration(client, gist_id, revision_number=1):
    response = client.post(
        f"/api/v1/gists/{gist_id}/revisions/{revision_number}/narration",
        json={},
    )
    assert response.status_code == 202


def _mark_only_narration_ready(app, audio=b"ID3offline-audio"):
    with gist_connection(app) as conn:
        row = conn.execute(
            "select id from narrations order by id desc limit 1"
        ).fetchone()
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
    path = narration_storage_dir(app) / filename
    path.write_bytes(audio)
    path.chmod(0o600)
    return len(audio)


def test_offline_manifest_requires_web_session(client):
    response = client.get("/api/v1/me/offline-manifest")

    assert response.status_code == 401


def test_offline_manifest_projects_owned_latest_and_watched_ready_audio(client, app):
    owner_key = make_key(app, "owner")
    reader_key = make_key(app, "reader")
    owned = create_gist(client, reader_key, markdown="# Mine", title="Mine")
    foreign = create_gist(client, owner_key, markdown="# Shared", title="Shared")
    assert owned.status_code == 201
    assert foreign.status_code == 201

    owned_body = owned.get_json()
    edited = client.patch(
        f"/api/v1/gists/{owned_body['id']}",
        headers=auth_header(reader_key),
        json={
            "title": "Mine updated",
            "expected_snapshot_sha256": owned_body["snapshot_sha256"],
        },
    )
    assert edited.status_code == 200

    _login(client, reader_key)
    _request_narration(client, foreign.get_json()["id"])
    audio_size = _mark_only_narration_ready(app)

    response = client.get("/api/v1/me/offline-manifest")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "private, no-store"
    payload = response.get_json()
    assert len(payload["account_marker"]) == 64
    assert reader_key not in response.get_data(as_text=True)
    assert payload["generated_at"].endswith("Z")
    identities = [
        (item["display_title"], item["revision_number"]) for item in payload["gists"]
    ]
    assert identities == [
        ("Mine updated", 2),
        ("Shared", 1),
    ]
    assert payload["gists"][0]["owned"] is True
    assert payload["gists"][0]["narration"] is None
    assert payload["gists"][1]["owned"] is False
    assert payload["gists"][1]["narration"]["byte_size"] == audio_size
    assert len(payload["gists"][1]["narration"]["etag"]) == 64

    marker = payload["account_marker"]
    client.delete("/api/v1/auth/session")
    _login(client, reader_key)
    assert (
        client.get("/api/v1/me/offline-manifest").get_json()["account_marker"] == marker
    )


def test_offline_manifest_skips_missing_ready_audio_and_deleted_gists(client, app):
    key = make_key(app)
    created = create_gist(client, key, markdown="# Article", title="Article")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]
    _login(client, key)
    _request_narration(client, gist_id)
    _mark_only_narration_ready(app)
    with gist_connection(app) as conn:
        row = conn.execute("select audio_filename from narrations").fetchone()
    (narration_storage_dir(app) / row["audio_filename"]).unlink()

    manifest = client.get("/api/v1/me/offline-manifest").get_json()
    assert manifest["gists"][0]["narration"] is None

    deleted = client.delete(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
    )
    assert deleted.status_code == 204
    assert client.get("/api/v1/me/offline-manifest").get_json()["gists"] == []
