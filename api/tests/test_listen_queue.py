import hashlib

from gist_api.db import gist_connection

from .conftest import auth_header, create_gist, make_key

QUEUE = "/api/v1/me/listen-queue"


def _login(client, key):
    response = client.post("/api/v1/auth/session", json={"api_key": key})
    assert response.status_code == 200


def _request_narration(client, gist_id, revision_number=1):
    response = client.post(
        f"/api/v1/gists/{gist_id}/revisions/{revision_number}/narration",
        json={},
    )
    assert response.status_code == 202


def _mark_ready(app, gist_id, revision_number, audio=b"ID3queue-audio"):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update narrations
                set status = 'ready', engine_fingerprint = 'test-engine',
                    audio_sha256 = ?, mime_type = 'audio/mpeg',
                    byte_size = ?, duration_ms = 61000, error_code = null,
                    updated_at = ?, finished_at = ?
                where gist_revision_id = (
                    select r.id from gist_revisions r
                    join gists g on g.id = r.gist_id
                    where g.external_id = ? and r.revision_number = ?
                )
                """,
                (
                    hashlib.sha256(audio).hexdigest(),
                    len(audio),
                    "2026-10-31T12:00:00.000Z",
                    "2026-10-31T12:00:00.000Z",
                    gist_id,
                    revision_number,
                ),
            )


def _edit(client, key, gist_id, markdown):
    current = client.get(
        f"/api/v1/gists/{gist_id}", headers=auth_header(key)
    ).get_json()
    response = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        json={
            "files": {"README.md": {"content": markdown}},
            "expected_snapshot_sha256": current["snapshot_sha256"],
        },
    )
    assert response.status_code == 200


def _new_gist(client, key, title):
    response = create_gist(client, key, markdown=f"# {title}\n\nBody text.", title=title)
    assert response.status_code == 201
    return response.get_json()["id"]


def _queue(client):
    response = client.get(QUEUE)
    assert response.status_code == 200
    return response.get_json()["items"]


def test_listen_queue_requires_web_session(client):
    assert client.get(QUEUE).status_code == 401
    assert client.put(QUEUE, json={"gist_ids": []}).status_code == 401


def test_requesting_audio_appends_gist_once(client, app):
    key = make_key(app, "listener")
    first = _new_gist(client, key, "First")
    second = _new_gist(client, key, "Second")
    _login(client, key)

    _request_narration(client, first)
    _request_narration(client, second)
    _request_narration(client, first)

    items = _queue(client)
    assert [item["gist_id"] for item in items] == [first, second]
    assert items[0]["status"] == "pending"
    assert items[0]["audio_url"] is None
    assert items[0]["title"] == "First"


def test_newer_revision_audio_supersedes_older(client, app):
    key = make_key(app, "listener")
    gist_id = _new_gist(client, key, "Plan")
    _login(client, key)
    _request_narration(client, gist_id, 1)
    _mark_ready(app, gist_id, 1)

    [item] = _queue(client)
    assert item["status"] == "ready"
    assert item["revision_number"] == 1
    assert item["duration_ms"] == 61000
    assert item["audio_url"] == f"/api/gists/{gist_id}/revisions/1/narration/audio"

    # A new revision without audio keeps the old recording playable.
    _edit(client, key, gist_id, "# Plan\n\nRevised body.")
    [item] = _queue(client)
    assert item["latest_revision_number"] == 2
    assert item["revision_number"] == 1
    assert item["updating"] is False

    # Requested audio for the new revision is flagged while it generates.
    _request_narration(client, gist_id, 2)
    [item] = _queue(client)
    assert item["revision_number"] == 1
    assert item["updating"] is True

    # Once ready, only the newest recording is offered.
    _mark_ready(app, gist_id, 2, audio=b"ID3newer-audio")
    [item] = _queue(client)
    assert item["revision_number"] == 2
    assert item["updating"] is False
    assert item["audio_url"].endswith("/revisions/2/narration/audio")


def test_put_reorders_removes_and_ignores_unknown_gists(client, app):
    key = make_key(app, "listener")
    ids = [_new_gist(client, key, name) for name in ("A", "B", "C")]
    _login(client, key)
    for gist_id in ids:
        _request_narration(client, gist_id)
    added = {item["gist_id"]: item["added_at"] for item in _queue(client)}

    response = client.put(
        QUEUE, json={"gist_ids": [ids[2], ids[0], "Unknown0000000000Gist", ids[2]]}
    )
    assert response.status_code == 200
    items = response.get_json()["items"]
    assert [item["gist_id"] for item in items] == [ids[2], ids[0]]
    assert all(item["added_at"] == added[item["gist_id"]] for item in items)
    assert [item["gist_id"] for item in _queue(client)] == [ids[2], ids[0]]

    assert client.put(QUEUE, json={"gist_ids": "nope"}).status_code == 400
    assert client.put(QUEUE, json={"gist_ids": [1]}).status_code == 400
    assert client.put(QUEUE, json={"order": []}).status_code == 400


def test_queue_is_per_key_and_hides_deleted_gists(client, app):
    owner = make_key(app, "owner")
    other = make_key(app, "other")
    gist_id = _new_gist(client, owner, "Shared")
    _login(client, owner)
    _request_narration(client, gist_id)
    assert len(_queue(client)) == 1

    _login(client, other)
    assert _queue(client) == []

    _login(client, owner)
    deleted = client.delete(f"/api/v1/me/gists/{gist_id}")
    assert deleted.status_code == 204
    assert _queue(client) == []
