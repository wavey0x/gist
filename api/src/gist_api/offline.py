import hashlib

from .auth import utc_now
from .db import gist_connection
from .gist_files import file_kind, lead_filename
from .narration import _ready_audio_is_valid
from .service import _load_revision_files, display_title


def _account_marker(key_value):
    value = f"waveygist-offline-account-v1\0{key_value}".encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def _manifest_item(app, conn, row, *, owned, narration=None):
    file_rows = _load_revision_files(conn, row["revision_id"])
    lead = lead_filename(file_rows)
    lead_html = (
        file_rows[lead]["rendered_html"]
        if file_kind(lead) == "markdown"
        else None
    )
    item = {
        "id": row["external_id"],
        "revision_number": row["revision_number"],
        "owned": bool(owned),
        "snapshot_sha256": row["snapshot_sha256"],
        "display_title": display_title(
            row["title"],
            lead_html,
            lead,
            row["external_id"],
        ),
        "author_name": row["author_name"],
        "updated_at": row["updated_at"],
        "narration": narration,
    }
    if row["author_avatar_url"]:
        item["author_avatar_url"] = row["author_avatar_url"]
    return item


def get_offline_manifest(app, auth):
    with gist_connection(app) as conn:
        owned_rows = conn.execute(
            """
            select
                g.external_id,
                r.id as revision_id,
                r.revision_number,
                r.title,
                r.author_name,
                r.snapshot_sha256,
                g.updated_at,
                author_key.avatar_url as author_avatar_url
            from gists g
            join gist_revisions r
              on r.gist_id = g.id
             and r.revision_number = g.latest_revision_number
            left join api_keys author_key on author_key.id = r.created_by_key_id
            where g.owner_key_id = ? and g.deleted_at is null
            order by g.updated_at desc, g.id desc
            """,
            (auth.key_id,),
        ).fetchall()
        narration_rows = conn.execute(
            """
            select
                g.external_id,
                g.owner_key_id,
                r.id as revision_id,
                r.revision_number,
                r.title,
                r.author_name,
                r.snapshot_sha256,
                r.created_at as updated_at,
                author_key.avatar_url as author_avatar_url,
                n.id as narration_id,
                n.audio_filename,
                n.byte_size,
                n.mime_type,
                n.status,
                n.updated_at as narration_updated_at,
                n.finished_at
            from narration_watchers watchers
            join narrations n on n.id = watchers.narration_id
            join gist_revisions r on r.id = n.gist_revision_id
            join gists g on g.id = r.gist_id
            left join api_keys author_key on author_key.id = r.created_by_key_id
            where watchers.api_key_id = ?
              and n.status = 'ready'
              and g.deleted_at is null
            order by n.finished_at desc, n.id desc
            """,
            (auth.key_id,),
        ).fetchall()

        items = {}
        for row in owned_rows:
            key = (row["external_id"], row["revision_number"])
            items[key] = _manifest_item(app, conn, row, owned=True)

        for row in narration_rows:
            if not _ready_audio_is_valid(app, row):
                continue
            narration = {
                "etag": hashlib.sha256(
                    (
                        f"{row['narration_id']}\0{row['narration_updated_at']}\0"
                        f"{row['byte_size']}"
                    ).encode("utf-8")
                ).hexdigest(),
                "byte_size": row["byte_size"],
            }
            key = (row["external_id"], row["revision_number"])
            existing = items.get(key)
            if existing is not None:
                existing["narration"] = narration
                continue
            items[key] = _manifest_item(
                app,
                conn,
                row,
                owned=row["owner_key_id"] == auth.key_id,
                narration=narration,
            )

    return {
        "account_marker": _account_marker(auth.key_value),
        "generated_at": utc_now(),
        "gists": list(items.values()),
    }
