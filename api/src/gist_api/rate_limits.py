from datetime import datetime, timedelta, timezone

from .auth import utc_now


def _cutoff(delta):
    return (
        datetime.now(timezone.utc) - delta
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def check_write_rate_limit(conn, key_prefix, source_ip, limit):
    limit = int(limit)
    if limit <= 0:
        return True

    cutoff = _cutoff(timedelta(hours=24))
    with conn:
        conn.execute("delete from api_write_events where created_at < ?", (cutoff,))
        key_count = conn.execute(
            """
            select count(*) as count
            from api_write_events
            where key_prefix = ? and created_at >= ?
            """,
            (key_prefix, cutoff),
        ).fetchone()["count"]
        ip_count = conn.execute(
            """
            select count(*) as count
            from api_write_events
            where source_ip = ? and created_at >= ?
            """,
            (source_ip, cutoff),
        ).fetchone()["count"]
        if key_count >= limit or ip_count >= limit:
            return True
        conn.execute(
            """
            insert into api_write_events(key_prefix, source_ip, created_at)
            values (?, ?, ?)
            """,
            (key_prefix, source_ip, utc_now()),
        )
    return False


def record_auth_failure_and_check_limit(conn, source_ip, limit):
    limit = int(limit)
    if limit <= 0:
        return True

    cutoff = _cutoff(timedelta(minutes=1))
    with conn:
        conn.execute(
            "delete from api_auth_failure_events where created_at < ?",
            (cutoff,),
        )
        failure_count = conn.execute(
            """
            select count(*) as count
            from api_auth_failure_events
            where source_ip = ? and created_at >= ?
            """,
            (source_ip, cutoff),
        ).fetchone()["count"]
        if failure_count >= limit:
            return True
        conn.execute(
            """
            insert into api_auth_failure_events(source_ip, created_at)
            values (?, ?)
            """,
            (source_ip, utc_now()),
        )
    return False
