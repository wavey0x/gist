import base64

import pytest

from gist_api.auth import create_api_key, revoke_api_key
from gist_api.db import gist_connection
from gist_api.errors import GistError
from gist_api import service as service_module

from .conftest import auth_header, create_gist, make_key


def _base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


VAPID_PUBLIC_KEY = _base64url(bytes([4]) + bytes(range(1, 65)))
P256DH = _base64url(bytes([4]) + bytes(range(64)))
AUTH = _base64url(bytes(range(16)))


def _enable_push(app):
    app.config.update(
        WEB_PUSH_VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY,
        WEB_PUSH_ALLOWED_ENDPOINT_HOSTS=("push.example.com",),
    )


def _login(client, key):
    response = client.post("/api/v1/auth/session", json={"api_key": key})
    assert response.status_code == 200


def _subscription(endpoint="https://push.example.com/send/device-one"):
    return {
        "endpoint": endpoint,
        "keys": {
            "p256dh": P256DH,
            "auth": AUTH,
        },
    }


def test_notification_settings_require_session_and_report_availability(client, app):
    assert client.get("/api/v1/me/notification-settings").status_code == 401

    key = make_key(app)
    _login(client, key)

    unavailable = client.get("/api/v1/me/notification-settings")
    assert unavailable.status_code == 200
    assert unavailable.get_json() == {
        "available": False,
        "new_gist": True,
        "edited_gist": False,
    }

    _enable_push(app)
    available = client.get("/api/v1/me/notification-settings")
    assert available.get_json() == {
        "available": True,
        "application_server_key": VAPID_PUBLIC_KEY,
        "new_gist": True,
        "edited_gist": False,
    }


def test_notification_settings_replace_both_flags_and_reject_bad_bodies(client, app):
    key = make_key(app)
    _login(client, key)

    for body in (
        {"new_gist": True},
        {"new_gist": 1, "edited_gist": False},
        {"new_gist": True, "edited_gist": False, "extra": True},
    ):
        response = client.put(
            "/api/v1/me/notification-settings",
            json=body,
        )
        assert response.status_code == 400

    response = client.put(
        "/api/v1/me/notification-settings",
        json={"new_gist": False, "edited_gist": True},
    )
    assert response.status_code == 200
    assert response.get_json() == {
        "new_gist": False,
        "edited_gist": True,
    }

    stored = client.get("/api/v1/me/notification-settings").get_json()
    assert stored["new_gist"] is False
    assert stored["edited_gist"] is True


def test_subscription_enrollment_is_validated_idempotent_and_deletable(client, app):
    key = make_key(app)
    _login(client, key)

    unavailable = client.put(
        "/api/v1/me/push-subscriptions",
        json=_subscription(),
    )
    assert unavailable.status_code == 503
    assert unavailable.get_json()["error"]["code"] == "push_not_configured"

    _enable_push(app)
    bad_provider = client.put(
        "/api/v1/me/push-subscriptions",
        json=_subscription("https://not-allowed.example/send/one"),
    )
    assert bad_provider.status_code == 400

    for _ in range(2):
        enabled = client.put(
            "/api/v1/me/push-subscriptions",
            json=_subscription(),
        )
        assert enabled.status_code == 200
        assert enabled.get_json() == {"enabled": True}

    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_subscriptions").fetchone()[0] == 1

    for _ in range(2):
        deleted = client.delete(
            "/api/v1/me/push-subscriptions",
            json={"endpoint": _subscription()["endpoint"]},
        )
        assert deleted.status_code == 204


def test_subscription_validation_and_account_limit(client, app):
    _enable_push(app)
    key = make_key(app)
    _login(client, key)
    invalid_payloads = (
        {
            **_subscription(),
            "keys": {
                **_subscription()["keys"],
                "extra": "not-allowed",
            },
        },
        {
            **_subscription(),
            "keys": {
                "p256dh": "***",
                "auth": AUTH,
            },
        },
        {
            **_subscription(),
            "keys": {
                "p256dh": P256DH,
                "auth": _base64url(b"short"),
            },
        },
        _subscription("http://push.example.com/send/not-https"),
        _subscription("https://user@push.example.com/send/credentials"),
    )
    for payload in invalid_payloads:
        response = client.put(
            "/api/v1/me/push-subscriptions",
            json=payload,
        )
        assert response.status_code == 400
        body = response.get_data(as_text=True)
        assert payload.get("endpoint", "") not in body
        assert P256DH not in body
        assert AUTH not in body

    for index in range(10):
        response = client.put(
            "/api/v1/me/push-subscriptions",
            json=_subscription(
                f"https://push.example.com/send/device-{index}"
            ),
        )
        assert response.status_code == 200
    limited = client.put(
        "/api/v1/me/push-subscriptions",
        json=_subscription("https://push.example.com/send/device-10"),
    )
    assert limited.status_code == 409
    assert limited.get_json()["error"]["code"] == "device_limit_reached"


def test_existing_endpoint_rebinds_to_current_account_and_clears_deliveries(
    client,
    app,
):
    _enable_push(app)
    first_key = make_key(app, "first")
    second_key = make_key(app, "second")

    _login(client, first_key)
    client.put("/api/v1/me/push-subscriptions", json=_subscription())
    created = create_gist(client, first_key)
    assert created.status_code == 201

    with gist_connection(app) as conn:
        first_id = conn.execute(
            "select id from api_keys where name = 'first'"
        ).fetchone()["id"]
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 1

    client.delete("/api/v1/auth/session")
    _login(client, second_key)
    moved = client.put("/api/v1/me/push-subscriptions", json=_subscription())
    assert moved.status_code == 200

    with gist_connection(app) as conn:
        subscription = conn.execute(
            "select api_key_id from push_subscriptions"
        ).fetchone()
        second_id = conn.execute(
            "select id from api_keys where name = 'second'"
        ).fetchone()["id"]
        assert subscription["api_key_id"] == second_id
        assert subscription["api_key_id"] != first_id
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0


def test_gist_writes_enqueue_enabled_events_transactionally(client, app):
    _enable_push(app)
    key = make_key(app)
    _login(client, key)
    client.put("/api/v1/me/push-subscriptions", json=_subscription())

    created = create_gist(client, key, markdown="# First")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]
    snapshot = created.get_json()["snapshot_sha256"]

    first_edit = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        json={
            "files": {"README.md": {"content": "# Second"}},
            "expected_snapshot_sha256": snapshot,
        },
    )
    assert first_edit.status_code == 200

    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select event_type, gist_revisions.revision_number
            from push_deliveries
            join gist_revisions
              on gist_revisions.id = push_deliveries.gist_revision_id
            order by push_deliveries.id
            """
        ).fetchall()
    assert [tuple(row) for row in rows] == [("gist.published", 1)]

    settings = client.put(
        "/api/v1/me/notification-settings",
        json={"new_gist": True, "edited_gist": True},
    )
    assert settings.status_code == 200
    second_edit = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(key),
        json={
            "title": "Changed",
            "expected_snapshot_sha256": first_edit.get_json()["snapshot_sha256"],
        },
    )
    assert second_edit.status_code == 200

    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select event_type, gist_revisions.revision_number
            from push_deliveries
            join gist_revisions
              on gist_revisions.id = push_deliveries.gist_revision_id
            order by push_deliveries.id
            """
        ).fetchall()
    assert [tuple(row) for row in rows] == [
        ("gist.published", 1),
        ("gist.updated", 3),
    ]


def test_enqueue_failure_rolls_back_gist_and_revision(
    client,
    app,
    monkeypatch,
):
    key = make_key(app)

    def fail_enqueue(*_args, **_kwargs):
        raise GistError("internal_error", "Internal error", 500)

    monkeypatch.setattr(
        service_module,
        "enqueue_push_deliveries",
        fail_enqueue,
    )
    response = create_gist(client, key)
    assert response.status_code == 500
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from gists").fetchone()[0] == 0
        assert conn.execute("select count(*) from gist_revisions").fetchone()[0] == 0
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0


def test_disabling_event_and_deleting_gist_remove_pending_deliveries(client, app):
    _enable_push(app)
    key = make_key(app)
    _login(client, key)
    client.put("/api/v1/me/push-subscriptions", json=_subscription())

    first = create_gist(client, key, title="First")
    assert first.status_code == 201
    assert create_gist(client, key, title="Second").status_code == 201

    client.put(
        "/api/v1/me/notification-settings",
        json={"new_gist": False, "edited_gist": False},
    )
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0

    client.put(
        "/api/v1/me/notification-settings",
        json={"new_gist": True, "edited_gist": False},
    )
    third = create_gist(client, key, title="Third")
    assert third.status_code == 201
    deleted = client.delete(
        f"/api/v1/gists/{third.get_json()['id']}",
        headers=auth_header(key),
    )
    assert deleted.status_code == 204
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0


@pytest.mark.parametrize("selector", ("id", "prefix"))
def test_logout_preserves_subscription_and_key_revocation_removes_it(
    client,
    app,
    selector,
):
    _enable_push(app)
    with gist_connection(app) as conn:
        created = create_api_key(conn, "owner")

    _login(client, created["key"])
    client.put("/api/v1/me/push-subscriptions", json=_subscription())
    assert client.delete("/api/v1/auth/session").status_code == 204

    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_subscriptions").fetchone()[0] == 1
        revoke_api_key(
            conn,
            created["id"] if selector == "id" else created["key_prefix"],
        )
        assert conn.execute("select count(*) from push_subscriptions").fetchone()[0] == 0
