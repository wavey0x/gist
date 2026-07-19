import base64
import binascii
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

from .auth import utc_now
from .db import gist_connection
from .errors import GistError


EVENT_GIST_PUBLISHED = "gist.published"
EVENT_GIST_UPDATED = "gist.updated"
EVENT_TYPES = frozenset({EVENT_GIST_PUBLISHED, EVENT_GIST_UPDATED})
MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT = 10
MAX_ENDPOINT_BYTES = 2048
MAX_P256DH_CHARS = 100
MAX_AUTH_CHARS = 32
BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _decode_base64url(value, *, field, max_chars):
    if not isinstance(value, str) or not value or len(value) > max_chars:
        raise GistError("invalid_request", f"{field} is invalid", 400)
    if not BASE64URL_RE.fullmatch(value):
        raise GistError("invalid_request", f"{field} is invalid", 400)
    try:
        decoded = base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))
    except (ValueError, binascii.Error):
        raise GistError("invalid_request", f"{field} is invalid", 400) from None
    canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
    if canonical != value:
        raise GistError("invalid_request", f"{field} is invalid", 400)
    return decoded


def validate_application_server_key(value):
    decoded = _decode_base64url(
        value,
        field="application server key",
        max_chars=100,
    )
    if len(decoded) != 65 or decoded[0] != 0x04:
        raise GistError("invalid_request", "application server key is invalid", 400)
    return value


def _configured_allowed_hosts(app):
    configured = app.config.get("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", ())
    if isinstance(configured, str):
        configured = configured.split(",")
    hosts = []
    for value in configured or ():
        host = str(value).strip().lower()
        if not host:
            continue
        if host.startswith("*."):
            host = host[1:]
        hosts.append(host)
    return tuple(hosts)


def _host_is_allowed(host, allowed_hosts):
    for allowed in allowed_hosts:
        if allowed.startswith("."):
            suffix = allowed[1:]
            if host == suffix or host.endswith(allowed):
                return True
        elif host == allowed:
            return True
    return False


def validate_push_endpoint(app, value, *, require_allowed_host=True):
    if not isinstance(value, str):
        raise GistError("invalid_request", "endpoint is invalid", 400)
    endpoint = value.strip()
    if (
        not endpoint
        or len(endpoint.encode("utf-8")) > MAX_ENDPOINT_BYTES
        or any(ord(character) <= 32 or ord(character) == 127 for character in endpoint)
    ):
        raise GistError("invalid_request", "endpoint is invalid", 400)
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError:
        raise GistError("invalid_request", "endpoint is invalid", 400) from None
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or port not in (None, 443)
        or not parsed.path.startswith("/")
    ):
        raise GistError("invalid_request", "endpoint is invalid", 400)
    try:
        host = parsed.hostname.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise GistError("invalid_request", "endpoint is invalid", 400) from None
    if require_allowed_host and not _host_is_allowed(
        host,
        _configured_allowed_hosts(app),
    ):
        raise GistError("invalid_request", "endpoint provider is not allowed", 400)
    return urlunsplit(("https", host, parsed.path, parsed.query, ""))


def validate_subscription_payload(app, payload):
    if not isinstance(payload, dict):
        raise GistError("invalid_request", "JSON object required", 400)
    unknown = sorted(set(payload) - {"endpoint", "keys"})
    if unknown:
        raise GistError("invalid_request", f"unknown field: {unknown[0]}", 400)
    if set(payload) != {"endpoint", "keys"}:
        raise GistError("invalid_request", "endpoint and keys are required", 400)
    keys = payload["keys"]
    if not isinstance(keys, dict):
        raise GistError("invalid_request", "keys must be an object", 400)
    unknown_keys = sorted(set(keys) - {"p256dh", "auth"})
    if unknown_keys:
        raise GistError(
            "invalid_request",
            f"unknown field: keys.{unknown_keys[0]}",
            400,
        )
    if set(keys) != {"p256dh", "auth"}:
        raise GistError("invalid_request", "p256dh and auth are required", 400)
    endpoint = validate_push_endpoint(app, payload["endpoint"])
    p256dh = keys["p256dh"]
    auth = keys["auth"]
    decoded_p256dh = _decode_base64url(
        p256dh,
        field="p256dh",
        max_chars=MAX_P256DH_CHARS,
    )
    if len(decoded_p256dh) != 65 or decoded_p256dh[0] != 0x04:
        raise GistError("invalid_request", "p256dh is invalid", 400)
    decoded_auth = _decode_base64url(
        auth,
        field="auth",
        max_chars=MAX_AUTH_CHARS,
    )
    if len(decoded_auth) != 16:
        raise GistError("invalid_request", "auth is invalid", 400)
    return {
        "endpoint": endpoint,
        "p256dh": p256dh,
        "auth": auth,
    }


def validate_web_push_config(app):
    public_key = (app.config.get("WEB_PUSH_VAPID_PUBLIC_KEY") or "").strip()
    if not public_key:
        return
    try:
        validate_application_server_key(public_key)
    except GistError as exc:
        raise RuntimeError("WEB_PUSH_VAPID_PUBLIC_KEY is invalid") from exc
    if not _configured_allowed_hosts(app):
        raise RuntimeError("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS must not be empty")
    app.config["WEB_PUSH_VAPID_PUBLIC_KEY"] = public_key


def web_push_available(app):
    return bool((app.config.get("WEB_PUSH_VAPID_PUBLIC_KEY") or "").strip())


def insert_default_notification_settings(conn, api_key_id, created_at):
    conn.execute(
        """
        insert into notification_settings(
            api_key_id, new_gist_enabled, edited_gist_enabled,
            created_at, updated_at
        )
        values (?, 1, 0, ?, ?)
        """,
        (api_key_id, created_at, created_at),
    )


def _settings_row(conn, api_key_id):
    row = conn.execute(
        """
        select new_gist_enabled, edited_gist_enabled
        from notification_settings
        where api_key_id = ?
        """,
        (api_key_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError("notification settings invariant violated")
    return row


def get_notification_settings(app, api_key_id):
    with gist_connection(app) as conn:
        row = _settings_row(conn, api_key_id)
    body = {
        "available": web_push_available(app),
        "new_gist": bool(row["new_gist_enabled"]),
        "edited_gist": bool(row["edited_gist_enabled"]),
    }
    if body["available"]:
        body["application_server_key"] = app.config["WEB_PUSH_VAPID_PUBLIC_KEY"]
    return body


def validate_settings_payload(payload):
    if not isinstance(payload, dict):
        raise GistError("invalid_request", "JSON object required", 400)
    unknown = sorted(set(payload) - {"new_gist", "edited_gist"})
    if unknown:
        raise GistError("invalid_request", f"unknown field: {unknown[0]}", 400)
    if set(payload) != {"new_gist", "edited_gist"}:
        raise GistError(
            "invalid_request",
            "new_gist and edited_gist are required",
            400,
        )
    if type(payload["new_gist"]) is not bool or type(payload["edited_gist"]) is not bool:
        raise GistError(
            "invalid_request",
            "notification settings must be booleans",
            400,
        )
    return payload


def update_notification_settings(app, api_key_id, payload):
    settings = validate_settings_payload(payload)
    now = utc_now()
    with gist_connection(app) as conn:
        with conn:
            current = _settings_row(conn, api_key_id)
            conn.execute(
                """
                update notification_settings
                set new_gist_enabled = ?, edited_gist_enabled = ?, updated_at = ?
                where api_key_id = ?
                """,
                (
                    int(settings["new_gist"]),
                    int(settings["edited_gist"]),
                    now,
                    api_key_id,
                ),
            )
            disabled_events = []
            if current["new_gist_enabled"] and not settings["new_gist"]:
                disabled_events.append(EVENT_GIST_PUBLISHED)
            if current["edited_gist_enabled"] and not settings["edited_gist"]:
                disabled_events.append(EVENT_GIST_UPDATED)
            for event_type in disabled_events:
                conn.execute(
                    """
                    delete from push_deliveries
                    where status = 'pending'
                      and event_type = ?
                      and subscription_id in (
                          select id
                          from push_subscriptions
                          where api_key_id = ?
                      )
                    """,
                    (event_type, api_key_id),
                )
    return {
        "new_gist": settings["new_gist"],
        "edited_gist": settings["edited_gist"],
    }


def upsert_push_subscription(app, api_key_id, payload):
    if not web_push_available(app):
        raise GistError(
            "push_not_configured",
            "Push notifications are not configured",
            503,
        )
    subscription = validate_subscription_payload(app, payload)
    now = utc_now()
    with gist_connection(app) as conn:
        with conn:
            existing = conn.execute(
                """
                select id, api_key_id, p256dh, auth
                from push_subscriptions
                where endpoint = ?
                """,
                (subscription["endpoint"],),
            ).fetchone()
            if existing is None:
                count = conn.execute(
                    "select count(*) from push_subscriptions where api_key_id = ?",
                    (api_key_id,),
                ).fetchone()[0]
                if count >= MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT:
                    raise GistError(
                        "device_limit_reached",
                        "Device limit reached",
                        409,
                    )
                conn.execute(
                    """
                    insert into push_subscriptions(
                        api_key_id, endpoint, p256dh, auth, created_at, updated_at
                    )
                    values (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        api_key_id,
                        subscription["endpoint"],
                        subscription["p256dh"],
                        subscription["auth"],
                        now,
                        now,
                    ),
                )
            elif existing["api_key_id"] != api_key_id:
                count = conn.execute(
                    "select count(*) from push_subscriptions where api_key_id = ?",
                    (api_key_id,),
                ).fetchone()[0]
                if count >= MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT:
                    raise GistError(
                        "device_limit_reached",
                        "Device limit reached",
                        409,
                    )
                conn.execute(
                    "delete from push_deliveries where subscription_id = ?",
                    (existing["id"],),
                )
                conn.execute(
                    """
                    update push_subscriptions
                    set api_key_id = ?, p256dh = ?, auth = ?, updated_at = ?
                    where id = ?
                    """,
                    (
                        api_key_id,
                        subscription["p256dh"],
                        subscription["auth"],
                        now,
                        existing["id"],
                    ),
                )
            elif (
                existing["p256dh"] != subscription["p256dh"]
                or existing["auth"] != subscription["auth"]
            ):
                conn.execute(
                    """
                    update push_subscriptions
                    set p256dh = ?, auth = ?, updated_at = ?
                    where id = ?
                    """,
                    (
                        subscription["p256dh"],
                        subscription["auth"],
                        now,
                        existing["id"],
                    ),
                )
    return {"enabled": True}


def delete_push_subscription(app, api_key_id, payload):
    if not isinstance(payload, dict):
        raise GistError("invalid_request", "JSON object required", 400)
    unknown = sorted(set(payload) - {"endpoint"})
    if unknown:
        raise GistError("invalid_request", f"unknown field: {unknown[0]}", 400)
    if set(payload) != {"endpoint"}:
        raise GistError("invalid_request", "endpoint is required", 400)
    endpoint = validate_push_endpoint(
        app,
        payload["endpoint"],
        require_allowed_host=False,
    )
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                delete from push_subscriptions
                where api_key_id = ? and endpoint = ?
                """,
                (api_key_id, endpoint),
            )


def delete_push_subscriptions_for_key(conn, api_key_id):
    conn.execute(
        "delete from push_subscriptions where api_key_id = ?",
        (api_key_id,),
    )


def enqueue_push_deliveries(
    conn,
    *,
    api_key_id,
    event_type,
    gist_revision_id,
    created_at,
):
    if event_type not in EVENT_TYPES:
        raise ValueError("unsupported notification event")
    settings = _settings_row(conn, api_key_id)
    enabled = (
        settings["new_gist_enabled"]
        if event_type == EVENT_GIST_PUBLISHED
        else settings["edited_gist_enabled"]
    )
    if not enabled:
        return 0
    cursor = conn.execute(
        """
        insert into push_deliveries(
            subscription_id, event_type, gist_revision_id,
            status, attempt_count, next_attempt_at,
            last_result, created_at, completed_at
        )
        select id, ?, ?, 'pending', 0, ?, null, ?, null
        from push_subscriptions
        where api_key_id = ?
        on conflict(subscription_id, event_type, gist_revision_id) do nothing
        """,
        (
            event_type,
            gist_revision_id,
            created_at,
            created_at,
            api_key_id,
        ),
    )
    return cursor.rowcount


def delete_pending_deliveries_for_gist(conn, gist_id):
    conn.execute(
        """
        delete from push_deliveries
        where status = 'pending'
          and gist_revision_id in (
              select id
              from gist_revisions
              where gist_id = ?
          )
        """,
        (gist_id,),
    )


def due_delivery_ids(app, *, now, limit):
    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select id
            from push_deliveries
            where status = 'pending' and next_attempt_at <= ?
            order by next_attempt_at, id
            limit ?
            """,
            (now, limit),
        ).fetchall()
    return [row["id"] for row in rows]


def load_pending_delivery(app, delivery_id):
    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select
                push_deliveries.id,
                push_deliveries.event_type,
                push_deliveries.attempt_count,
                push_deliveries.created_at,
                push_subscriptions.id as subscription_id,
                push_subscriptions.api_key_id,
                push_subscriptions.endpoint,
                push_subscriptions.p256dh,
                push_subscriptions.auth,
                api_keys.revoked_at,
                notification_settings.new_gist_enabled,
                notification_settings.edited_gist_enabled,
                gists.external_id,
                gists.deleted_at,
                gist_revisions.revision_number,
                gist_revisions.title,
                gist_revisions.rendered_html
            from push_deliveries
            join push_subscriptions
              on push_subscriptions.id = push_deliveries.subscription_id
            join api_keys
              on api_keys.id = push_subscriptions.api_key_id
            join notification_settings
              on notification_settings.api_key_id = push_subscriptions.api_key_id
            join gist_revisions
              on gist_revisions.id = push_deliveries.gist_revision_id
            join gists
              on gists.id = gist_revisions.gist_id
            where push_deliveries.id = ?
              and push_deliveries.status = 'pending'
            """,
            (delivery_id,),
        ).fetchone()
    return dict(row) if row is not None else None


def delete_pending_delivery(app, delivery_id):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "delete from push_deliveries where id = ? and status = 'pending'",
                (delivery_id,),
            )


def delete_subscription_by_id(app, subscription_id):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "delete from push_subscriptions where id = ?",
                (subscription_id,),
            )


def delete_subscriptions_for_key(app, api_key_id):
    with gist_connection(app) as conn:
        with conn:
            delete_push_subscriptions_for_key(conn, api_key_id)


def mark_delivery_delivered(app, delivery_id, *, result, completed_at):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update push_deliveries
                set status = 'delivered',
                    attempt_count = attempt_count + 1,
                    last_result = ?,
                    completed_at = ?
                where id = ? and status = 'pending'
                """,
                (result, completed_at, delivery_id),
            )


def schedule_delivery_retry(app, delivery_id, *, result, next_attempt_at):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update push_deliveries
                set attempt_count = attempt_count + 1,
                    last_result = ?,
                    next_attempt_at = ?
                where id = ? and status = 'pending'
                """,
                (result, next_attempt_at, delivery_id),
            )


def mark_delivery_dead(app, delivery_id, *, result, completed_at):
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update push_deliveries
                set status = 'dead',
                    attempt_count = attempt_count + 1,
                    last_result = ?,
                    completed_at = ?
                where id = ? and status = 'pending'
                """,
                (result, completed_at, delivery_id),
            )


def cleanup_terminal_deliveries(app, *, completed_before):
    with gist_connection(app) as conn:
        with conn:
            cursor = conn.execute(
                """
                delete from push_deliveries
                where status in ('delivered', 'dead')
                  and completed_at < ?
                """,
                (completed_before,),
            )
    return cursor.rowcount


def pending_queue_health(app, *, now):
    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select count(*) as pending_count, min(created_at) as oldest_created_at
            from push_deliveries
            where status = 'pending'
            """
        ).fetchone()
    oldest_age_seconds = None
    if row["oldest_created_at"]:
        oldest = datetime.fromisoformat(
            row["oldest_created_at"].replace("Z", "+00:00")
        )
        oldest_age_seconds = max(
            0,
            int((datetime.now(timezone.utc) - oldest).total_seconds()),
        )
    return {
        "pending_count": row["pending_count"],
        "oldest_age_seconds": oldest_age_seconds,
        "checked_at": now,
    }
