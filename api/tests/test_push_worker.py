import base64
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid02
from pywebpush import WebPushException

from gist_api.auth import utc_now
from gist_api.db import gist_connection
from gist_api.push_worker import (
    PUSH_TTL_SECONDS,
    build_payload,
    process_delivery,
    validate_worker_config,
)

from .conftest import create_gist, make_key
from .test_notifications import VAPID_PUBLIC_KEY, _login, _subscription


def _prepare_delivery(client, app):
    app.config.update(
        WEB_PUSH_VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY,
        WEB_PUSH_ALLOWED_ENDPOINT_HOSTS=("push.example.com",),
        WEB_PUSH_VAPID_SUBJECT="mailto:alerts@example.com",
    )
    key = make_key(app)
    _login(client, key)
    assert (
        client.put(
            "/api/v1/me/push-subscriptions",
            json=_subscription(),
        ).status_code
        == 200
    )
    created = create_gist(
        client,
        key,
        markdown="# Worker title\n\nSecret markdown body",
        title=None,
    )
    assert created.status_code == 201
    with gist_connection(app) as conn:
        delivery_id = conn.execute("select id from push_deliveries").fetchone()["id"]
    return key, created.get_json()["id"], delivery_id


def _delivery(app, delivery_id):
    with gist_connection(app) as conn:
        return dict(
            conn.execute(
                "select * from push_deliveries where id = ?",
                (delivery_id,),
            ).fetchone()
        )


def _provider_error(status, retry_after=None):
    headers = {}
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return WebPushException(
        "provider error",
        response=SimpleNamespace(status_code=status, headers=headers),
    )


def test_build_payload_uses_immutable_revision_without_markdown():
    payload = build_payload(
        {
            "event_type": "gist.updated",
            "external_id": "AbCdEf0123456789",
            "revision_number": 4,
            "title": None,
            "rendered_html": "<h1>  A useful title </h1><p>hidden</p>",
        }
    )

    assert payload == {
        "type": "gist.updated",
        "title": "Gist edited",
        "body": "A useful title",
        "path": "/AbCdEf0123456789/revisions/4",
        "tag": "gist:AbCdEf0123456789",
    }
    assert "markdown" not in payload


def test_build_payload_reuses_tag_for_newer_gist_event():
    published = build_payload(
        {
            "event_type": "gist.published",
            "external_id": "AbCdEf0123456789",
            "revision_number": 1,
            "title": "First",
            "rendered_html": "<h1>First</h1>",
        }
    )
    updated = build_payload(
        {
            "event_type": "gist.updated",
            "external_id": "AbCdEf0123456789",
            "revision_number": 2,
            "title": "Second",
            "rendered_html": "<h1>Second</h1>",
        }
    )

    assert published["tag"] == updated["tag"] == "gist:AbCdEf0123456789"
    assert updated["path"] == "/AbCdEf0123456789/revisions/2"


def test_worker_success_sends_safe_payload_and_marks_delivery(client, app):
    _key, gist_id, delivery_id = _prepare_delivery(client, app)
    sent = {}

    def sender(**kwargs):
        sent.update(kwargs)
        return SimpleNamespace(status_code=201)

    result = process_delivery(
        app,
        delivery_id,
        object(),
        sender=sender,
        now=datetime(2026, 7, 19, 12, tzinfo=timezone.utc),
    )

    assert result == "accepted"
    assert sent["timeout"] == 10
    assert sent["ttl"] == PUSH_TTL_SECONDS
    assert sent["requests_session"] is not None
    payload = json.loads(sent["data"])
    assert payload == {
        "type": "gist.published",
        "title": "New gist published",
        "body": "Worker title",
        "path": f"/{gist_id}",
        "tag": f"gist:{gist_id}",
    }
    assert "Secret markdown body" not in sent["data"]
    stored = _delivery(app, delivery_id)
    assert stored["status"] == "delivered"
    assert stored["attempt_count"] == 1
    assert stored["last_result"] == "accepted"


def test_worker_accepts_any_provider_2xx(client, app):
    _key, _gist_id, delivery_id = _prepare_delivery(client, app)

    def sender(**_kwargs):
        raise _provider_error(204)

    assert process_delivery(app, delivery_id, object(), sender=sender) == "accepted"
    assert _delivery(app, delivery_id)["status"] == "delivered"


@pytest.mark.parametrize(
    ("status", "expected_result"),
    (
        (401, "provider_auth"),
        (403, "provider_auth"),
        (429, "rate_limited"),
        (500, "provider_error"),
        (503, "provider_error"),
    ),
)
def test_worker_retries_transient_provider_results(
    client,
    app,
    status,
    expected_result,
):
    _key, _gist_id, delivery_id = _prepare_delivery(client, app)
    now = datetime.now(timezone.utc).replace(microsecond=123000)

    def sender(**_kwargs):
        raise _provider_error(status, retry_after="90" if status == 429 else None)

    result = process_delivery(
        app,
        delivery_id,
        object(),
        sender=sender,
        now=now,
    )

    assert result == expected_result
    stored = _delivery(app, delivery_id)
    assert stored["status"] == "pending"
    assert stored["attempt_count"] == 1
    expected_delay = 90 if status == 429 else 30
    next_attempt = datetime.fromisoformat(
        stored["next_attempt_at"].replace("Z", "+00:00")
    )
    assert next_attempt == now + timedelta(seconds=expected_delay)


@pytest.mark.parametrize("status", (404, 410))
def test_worker_removes_expired_provider_endpoint(client, app, status):
    _key, _gist_id, delivery_id = _prepare_delivery(client, app)

    def sender(**_kwargs):
        raise _provider_error(status)

    result = process_delivery(app, delivery_id, object(), sender=sender)

    assert result == "endpoint_expired"
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_subscriptions").fetchone()[0] == 0
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0


def test_worker_marks_other_provider_rejection_dead(client, app):
    _key, _gist_id, delivery_id = _prepare_delivery(client, app)

    def sender(**_kwargs):
        raise _provider_error(400)

    result = process_delivery(app, delivery_id, object(), sender=sender)

    assert result == "provider_rejected"
    stored = _delivery(app, delivery_id)
    assert stored["status"] == "dead"
    assert stored["attempt_count"] == 1


def test_worker_expires_delivery_without_sending(client, app):
    _key, _gist_id, delivery_id = _prepare_delivery(client, app)
    sent = False
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update push_deliveries
                set created_at = ?, next_attempt_at = ?
                where id = ?
                """,
                (
                    "2026-07-18T00:00:00.000Z",
                    "2026-07-18T00:00:00.000Z",
                    delivery_id,
                ),
            )

    def sender(**_kwargs):
        nonlocal sent
        sent = True

    result = process_delivery(
        app,
        delivery_id,
        object(),
        sender=sender,
        now=datetime(2026, 7, 19, 0, 0, 1, tzinfo=timezone.utc),
    )

    assert result == "expired"
    assert sent is False
    assert _delivery(app, delivery_id)["status"] == "dead"


def test_worker_rechecks_disabled_setting_and_deleted_gist(client, app):
    _key, gist_id, delivery_id = _prepare_delivery(client, app)
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "update notification_settings set new_gist_enabled = 0"
            )

    assert process_delivery(app, delivery_id, object()) == "setting_disabled"
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from push_deliveries").fetchone()[0] == 0
        with conn:
            conn.execute(
                "update notification_settings set new_gist_enabled = 1"
            )

    key = make_key(app, "second")
    _login(client, key)
    client.put(
        "/api/v1/me/push-subscriptions",
        json=_subscription("https://push.example.com/send/device-two"),
    )
    created = create_gist(client, key, title="Deleted")
    second_id = created.get_json()["id"]
    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select push_deliveries.id
            from push_deliveries
            join gist_revisions
              on gist_revisions.id = push_deliveries.gist_revision_id
            join gists on gists.id = gist_revisions.gist_id
            where gists.external_id = ?
            """,
            (second_id,),
        ).fetchone()
        with conn:
            conn.execute(
                "update gists set deleted_at = ? where external_id = ?",
                (utc_now(), second_id),
            )

    assert process_delivery(app, row["id"], object()) == "gist_deleted"
    assert gist_id != second_id


def test_worker_configuration_requires_matching_private_key(tmp_path, app):
    vapid = Vapid02()
    vapid.generate_keys()
    private_path = tmp_path / "vapid-private.pem"
    vapid.save_key(str(private_path))
    private_path.chmod(0o600)
    public_key = base64.urlsafe_b64encode(
        vapid.public_key.public_bytes(
            Encoding.X962,
            PublicFormat.UncompressedPoint,
        )
    ).rstrip(b"=").decode("ascii")
    app.config.update(
        WEB_PUSH_VAPID_PUBLIC_KEY=public_key,
        WEB_PUSH_VAPID_PRIVATE_KEY_FILE=str(private_path),
        WEB_PUSH_VAPID_SUBJECT="mailto:alerts@example.com",
    )

    loaded = validate_worker_config(app)
    assert loaded.public_key.public_numbers() == vapid.public_key.public_numbers()

    app.config["WEB_PUSH_VAPID_PUBLIC_KEY"] = VAPID_PUBLIC_KEY
    with pytest.raises(RuntimeError, match="do not match"):
        validate_worker_config(app)

    private_path.chmod(0o644)
    with pytest.raises(RuntimeError, match="permissions"):
        validate_worker_config(app)
