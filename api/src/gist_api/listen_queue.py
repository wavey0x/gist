"""Per-account ordered listening queue.

A queue entry names a gist, never a revision. Each read resolves the entry to
the newest revision with ready audio, so a newer recording always supersedes
an older one without the client having to know revisions changed.
"""

from .auth import utc_now
from .db import gist_connection
from .errors import GistError
from .external_ids import validate_external_id
from .gist_files import file_kind, lead_filename
from .service import display_title

MAX_QUEUE_ITEMS = 200
AUDIO_MIME_TYPE = "audio/mpeg"


def _audio_is_ready(row):
    return bool(
        row["status"] == "ready"
        and row["audio_sha256"]
        and row["byte_size"]
        and row["mime_type"] == AUDIO_MIME_TYPE
    )


def _revision_title(conn, revision_row, external_id):
    file_rows = {
        row["filename"]: row
        for row in conn.execute(
            """
            select filename, rendered_html
            from gist_revision_files
            where gist_revision_id = ?
            order by filename
            """,
            (revision_row["revision_id"],),
        )
    }
    if not file_rows:
        return revision_row["title"] or external_id
    lead = lead_filename(file_rows)
    lead_html = (
        file_rows[lead]["rendered_html"] if file_kind(lead) == "markdown" else None
    )
    return display_title(revision_row["title"], lead_html, lead, external_id)


def _resolve_item(conn, queue_row):
    revisions = conn.execute(
        """
        select
            r.id as revision_id,
            r.revision_number,
            r.title,
            r.author_name,
            author_key.avatar_url as author_avatar_url,
            n.status,
            n.audio_sha256,
            n.byte_size,
            n.mime_type,
            n.duration_ms
        from gist_revisions r
        left join narrations n on n.gist_revision_id = r.id
        left join api_keys author_key on author_key.id = r.created_by_key_id
        where r.gist_id = ?
        order by r.revision_number desc
        """,
        (queue_row["gist_id"],),
    ).fetchall()
    if not revisions:
        return None

    ready = next((row for row in revisions if _audio_is_ready(row)), None)
    ready_number = ready["revision_number"] if ready else 0
    pending = next(
        (
            row
            for row in revisions
            if row["status"] == "pending" and row["revision_number"] > ready_number
        ),
        None,
    )
    shown = ready or pending or revisions[0]
    external_id = queue_row["external_id"]

    if ready:
        status = "ready"
    elif pending:
        status = "pending"
    else:
        status = "none"

    item = {
        "gist_id": external_id,
        "title": _revision_title(conn, shown, external_id),
        "author_name": shown["author_name"],
        "latest_revision_number": queue_row["latest_revision_number"],
        "status": status,
        "revision_number": ready["revision_number"] if ready else None,
        "duration_ms": ready["duration_ms"] if ready else None,
        "audio_url": (
            f"/api/gists/{external_id}/revisions/{ready['revision_number']}"
            "/narration/audio"
            if ready
            else None
        ),
        "updating": bool(ready and pending),
        "added_at": queue_row["added_at"],
    }
    if shown["author_avatar_url"]:
        item["author_avatar_url"] = shown["author_avatar_url"]
    return item


def _queue_rows(conn, key_id):
    return conn.execute(
        """
        select q.gist_id, q.position, q.added_at, g.external_id,
               g.latest_revision_number
        from listen_queue q
        join gists g on g.id = q.gist_id
        where q.api_key_id = ? and g.deleted_at is null
        order by q.position, q.added_at
        """,
        (key_id,),
    ).fetchall()


def _payload(conn, key_id):
    items = []
    for row in _queue_rows(conn, key_id):
        item = _resolve_item(conn, row)
        if item is not None:
            items.append(item)
    return {"items": items}


def get_listen_queue(app, key_id):
    with gist_connection(app) as conn:
        return _payload(conn, key_id)


def _parse_gist_ids(value):
    if not isinstance(value, list):
        raise GistError("invalid_request", "gist_ids must be a list", 400)
    if len(value) > MAX_QUEUE_ITEMS:
        raise GistError(
            "invalid_request",
            f"The queue holds at most {MAX_QUEUE_ITEMS} gists",
            400,
        )
    seen = set()
    gist_ids = []
    for gist_id in value:
        if not isinstance(gist_id, str) or not validate_external_id(gist_id):
            raise GistError("invalid_request", "Invalid gist id", 400)
        if gist_id not in seen:
            seen.add(gist_id)
            gist_ids.append(gist_id)
    return gist_ids


def replace_listen_queue(app, key_id, payload):
    gist_ids = _parse_gist_ids(payload.get("gist_ids"))
    now = utc_now()
    with gist_connection(app) as conn:
        with conn:
            existing = {
                row["gist_id"]: row["added_at"]
                for row in conn.execute(
                    "select gist_id, added_at from listen_queue where api_key_id = ?",
                    (key_id,),
                )
            }
            internal_ids = {}
            if gist_ids:
                placeholders = ",".join("?" for _ in gist_ids)
                for row in conn.execute(
                    f"""
                    select id, external_id from gists
                    where deleted_at is null and external_id in ({placeholders})
                    """,
                    tuple(gist_ids),
                ):
                    internal_ids[row["external_id"]] = row["id"]
            conn.execute("delete from listen_queue where api_key_id = ?", (key_id,))
            position = 0
            for gist_id in gist_ids:
                internal_id = internal_ids.get(gist_id)
                if internal_id is None:
                    continue
                conn.execute(
                    """
                    insert into listen_queue(api_key_id, gist_id, position, added_at)
                    values (?, ?, ?, ?)
                    """,
                    (key_id, internal_id, position, existing.get(internal_id, now)),
                )
                position += 1
        return _payload(conn, key_id)


def append_to_listen_queue(conn, key_id, gist_internal_id, now=None):
    """Add a gist to the end of a key's queue unless it is already queued."""
    if conn.execute(
        "select 1 from listen_queue where api_key_id = ? and gist_id = ?",
        (key_id, gist_internal_id),
    ).fetchone():
        return
    count, last = conn.execute(
        """
        select count(*), coalesce(max(position), -1)
        from listen_queue where api_key_id = ?
        """,
        (key_id,),
    ).fetchone()
    if count >= MAX_QUEUE_ITEMS:
        return
    conn.execute(
        """
        insert into listen_queue(api_key_id, gist_id, position, added_at)
        values (?, ?, ?, ?)
        """,
        (key_id, gist_internal_id, last + 1, now or utc_now()),
    )
