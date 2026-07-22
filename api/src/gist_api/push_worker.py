import argparse
import base64
import json
import logging
import signal
import stat
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush
from requests import Session
from requests.exceptions import RequestException

from .app import create_app
from .notifications import (
    EVENT_GIST_PUBLISHED,
    cleanup_terminal_deliveries,
    delete_pending_delivery,
    delete_subscription_by_id,
    delete_subscriptions_for_key,
    due_delivery_ids,
    load_pending_delivery,
    mark_delivery_dead,
    mark_delivery_delivered,
    pending_queue_health,
    schedule_delivery_retry,
    validate_push_endpoint,
)
from .service import display_title
from .gist_files import file_kind


logger = logging.getLogger(__name__)

DELIVERY_BATCH_SIZE = 25
EMPTY_POLL_SECONDS = 2
PROVIDER_TIMEOUT_SECONDS = 10
PUSH_TTL_SECONDS = 24 * 60 * 60
TERMINAL_RETENTION_DAYS = 30
RETRY_DELAYS_SECONDS = (30, 2 * 60, 10 * 60, 60 * 60)
MAX_RETRY_AFTER_SECONDS = 60 * 60
HEALTH_LOG_INTERVAL_SECONDS = 5 * 60
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


class _NoRedirectSession(Session):
    def post(self, url, data=None, json=None, **kwargs):
        kwargs["allow_redirects"] = False
        return super().post(url, data=data, json=json, **kwargs)


NO_REDIRECT_SESSION = _NoRedirectSession()


def _parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_timestamp(value):
    return value.astimezone(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _decode_public_key(value):
    return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))


def validate_worker_config(app):
    public_key = (app.config.get("WEB_PUSH_VAPID_PUBLIC_KEY") or "").strip()
    private_key_value = (
        app.config.get("WEB_PUSH_VAPID_PRIVATE_KEY_FILE") or ""
    ).strip()
    subject = (app.config.get("WEB_PUSH_VAPID_SUBJECT") or "").strip()
    if not public_key or not private_key_value or not subject:
        raise RuntimeError(
            "WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY_FILE, "
            "and WEB_PUSH_VAPID_SUBJECT are required"
        )
    if not (
        subject.startswith("mailto:")
        or subject.startswith("https://")
    ):
        raise RuntimeError("WEB_PUSH_VAPID_SUBJECT must use mailto: or https://")

    private_key_path = Path(private_key_value).expanduser()
    if not private_key_path.is_file():
        raise RuntimeError("WEB_PUSH_VAPID_PRIVATE_KEY_FILE must be an existing file")
    if stat.S_IMODE(private_key_path.stat().st_mode) & 0o077:
        raise RuntimeError("Web Push private key file permissions must be 0600 or stricter")

    try:
        vapid = Vapid02.from_file(str(private_key_path))
        derived_public_key = vapid.public_key.public_bytes(
            Encoding.X962,
            PublicFormat.UncompressedPoint,
        )
    except Exception as exc:
        raise RuntimeError("Web Push private key could not be loaded") from exc
    if derived_public_key != _decode_public_key(public_key):
        raise RuntimeError("Web Push public and private keys do not match")
    return vapid


def build_payload(row):
    revision_number = row["revision_number"]
    external_id = row["external_id"]
    tag = f"gist:{external_id}"
    body = " ".join(
        display_title(
            row["title"],
            (
                row["lead_rendered_html"]
                if file_kind(row["lead_filename"]) == "markdown"
                else None
            ),
            row["lead_filename"],
            external_id,
        ).split()
    )[:160]
    if row["event_type"] == EVENT_GIST_PUBLISHED:
        return {
            "type": EVENT_GIST_PUBLISHED,
            "title": "New gist published",
            "body": body,
            "path": f"/{external_id}",
            "tag": tag,
        }
    return {
        "type": row["event_type"],
        "title": "Gist edited",
        "body": body,
        "path": f"/{external_id}",
        "tag": tag,
    }


def _retry_after_seconds(response, now):
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            seconds = int((retry_at - now).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0, min(seconds, MAX_RETRY_AFTER_SECONDS))


def _retry_delay(attempt_count):
    index = min(attempt_count, len(RETRY_DELAYS_SECONDS) - 1)
    return RETRY_DELAYS_SECONDS[index]


def _record_retry_or_expiry(
    app,
    row,
    *,
    result,
    now,
    retry_after_seconds=None,
):
    expires_at = _parse_timestamp(row["created_at"]) + timedelta(
        seconds=PUSH_TTL_SECONDS
    )
    delay_seconds = (
        retry_after_seconds
        if retry_after_seconds is not None
        else _retry_delay(row["attempt_count"])
    )
    next_attempt = now + timedelta(seconds=delay_seconds)
    if next_attempt >= expires_at:
        mark_delivery_dead(
            app,
            row["id"],
            result="expired",
            completed_at=_format_timestamp(now),
        )
        return "expired", None
    next_attempt_at = _format_timestamp(next_attempt)
    schedule_delivery_retry(
        app,
        row["id"],
        result=result,
        next_attempt_at=next_attempt_at,
    )
    return result, next_attempt_at


def process_delivery(app, delivery_id, vapid, *, sender=webpush, now=None):
    started = time.monotonic()
    now = now or datetime.now(timezone.utc)
    row = load_pending_delivery(app, delivery_id)
    if row is None:
        return "missing"

    event_enabled = (
        row["new_gist_enabled"]
        if row["event_type"] == EVENT_GIST_PUBLISHED
        else row["edited_gist_enabled"]
    )
    if row["revoked_at"]:
        delete_subscriptions_for_key(app, row["api_key_id"])
        result = "account_revoked"
        next_attempt_at = None
    elif not event_enabled:
        delete_pending_delivery(app, row["id"])
        result = "setting_disabled"
        next_attempt_at = None
    elif row["deleted_at"]:
        delete_pending_delivery(app, row["id"])
        result = "gist_deleted"
        next_attempt_at = None
    elif now >= _parse_timestamp(row["created_at"]) + timedelta(
        seconds=PUSH_TTL_SECONDS
    ):
        mark_delivery_dead(
            app,
            row["id"],
            result="expired",
            completed_at=_format_timestamp(now),
        )
        result = "expired"
        next_attempt_at = None
    else:
        try:
            validate_push_endpoint(app, row["endpoint"])
        except Exception:
            delete_subscription_by_id(app, row["subscription_id"])
            result = "endpoint_invalid"
            next_attempt_at = None
        else:
            payload = json.dumps(
                build_payload(row),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            try:
                sender(
                    subscription_info={
                        "endpoint": row["endpoint"],
                        "keys": {
                            "p256dh": row["p256dh"],
                            "auth": row["auth"],
                        },
                    },
                    data=payload,
                    vapid_private_key=vapid,
                    vapid_claims={
                        "sub": app.config["WEB_PUSH_VAPID_SUBJECT"],
                    },
                    timeout=PROVIDER_TIMEOUT_SECONDS,
                    ttl=PUSH_TTL_SECONDS,
                    requests_session=NO_REDIRECT_SESSION,
                )
            except WebPushException as exc:
                response = exc.response
                status = response.status_code if response is not None else None
                if status is not None and 200 <= status <= 299:
                    mark_delivery_delivered(
                        app,
                        row["id"],
                        result="accepted",
                        completed_at=_format_timestamp(now),
                    )
                    result = "accepted"
                    next_attempt_at = None
                elif status in (404, 410):
                    delete_subscription_by_id(app, row["subscription_id"])
                    result = "endpoint_expired"
                    next_attempt_at = None
                elif status == 429:
                    result, next_attempt_at = _record_retry_or_expiry(
                        app,
                        row,
                        result="rate_limited",
                        now=now,
                        retry_after_seconds=_retry_after_seconds(response, now),
                    )
                elif status in (401, 403):
                    result, next_attempt_at = _record_retry_or_expiry(
                        app,
                        row,
                        result="provider_auth",
                        now=now,
                    )
                elif status is not None and 500 <= status <= 599:
                    result, next_attempt_at = _record_retry_or_expiry(
                        app,
                        row,
                        result="provider_error",
                        now=now,
                    )
                else:
                    mark_delivery_dead(
                        app,
                        row["id"],
                        result="provider_rejected",
                        completed_at=_format_timestamp(now),
                    )
                    result = "provider_rejected"
                    next_attempt_at = None
            except RequestException:
                result, next_attempt_at = _record_retry_or_expiry(
                    app,
                    row,
                    result="network_error",
                    now=now,
                )
            else:
                mark_delivery_delivered(
                    app,
                    row["id"],
                    result="accepted",
                    completed_at=_format_timestamp(now),
                )
                result = "accepted"
                next_attempt_at = None

    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        (
            "push_delivery delivery_id=%s event_type=%s attempt=%s "
            "result=%s duration_ms=%s next_attempt_at=%s"
        ),
        row["id"],
        row["event_type"],
        row["attempt_count"] + 1,
        result,
        duration_ms,
        next_attempt_at or "-",
    )
    return result


def run_due_pass(app, vapid, *, sender=webpush, now=None):
    now = now or datetime.now(timezone.utc)
    ids = due_delivery_ids(
        app,
        now=_format_timestamp(now),
        limit=DELIVERY_BATCH_SIZE,
    )
    for delivery_id in ids:
        process_delivery(
            app,
            delivery_id,
            vapid,
            sender=sender,
            now=now,
        )
    return len(ids)


def _log_health(app, now):
    health = pending_queue_health(app, now=_format_timestamp(now))
    logger.info(
        "push_queue pending_count=%s oldest_age_seconds=%s",
        health["pending_count"],
        (
            health["oldest_age_seconds"]
            if health["oldest_age_seconds"] is not None
            else "-"
        ),
    )


def run_worker(app, vapid, *, once=False, stop_event=None):
    stop_event = stop_event or threading.Event()
    next_health_at = datetime.min.replace(tzinfo=timezone.utc)
    next_cleanup_at = datetime.min.replace(tzinfo=timezone.utc)
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        if now >= next_cleanup_at:
            deleted = cleanup_terminal_deliveries(
                app,
                completed_before=_format_timestamp(
                    now - timedelta(days=TERMINAL_RETENTION_DAYS)
                ),
            )
            logger.info("push_cleanup deleted_count=%s", deleted)
            next_cleanup_at = now + timedelta(seconds=CLEANUP_INTERVAL_SECONDS)
        if now >= next_health_at:
            _log_health(app, now)
            next_health_at = now + timedelta(seconds=HEALTH_LOG_INTERVAL_SECONDS)

        processed = run_due_pass(app, vapid, now=now)
        if once:
            if processed == DELIVERY_BATCH_SIZE:
                continue
            return
        if processed == 0:
            stop_event.wait(EMPTY_POLL_SECONDS)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="push-worker")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    app = create_app()
    vapid = validate_worker_config(app)
    stop_event = threading.Event()

    def request_stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    run_worker(app, vapid, once=args.once, stop_event=stop_event)


if __name__ == "__main__":
    main()
