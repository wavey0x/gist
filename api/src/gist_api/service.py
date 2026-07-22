import html
import io
import json
import re
import sqlite3
import zipfile
from dataclasses import dataclass
from urllib.parse import quote

from .auth import utc_now
from .db import gist_connection
from .errors import GistError
from .external_ids import generate_external_id, validate_external_id
from .gist_files import (
    NormalizedFile,
    content_sha256,
    file_kind,
    file_language,
    lead_filename,
    normalize_filename,
    normalize_files,
    normalized_file,
    ordered_filenames,
    snapshot_sha256,
    validate_file_contents,
)
from .images import (
    cleanup_staged_images,
    insert_image_assets,
    plan_image_assets,
    stage_images,
)
from .markdown import (
    HighlightBudget,
    render_markdown_result,
    render_plain_text_result,
    render_source_result,
    render_version,
)
from .notifications import (
    EVENT_GIST_PUBLISHED,
    EVENT_GIST_UPDATED,
    delete_pending_deliveries_for_gist,
    enqueue_push_deliveries,
)


REVISION_RE = re.compile(r"^[1-9][0-9]*$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
FIRST_H1_RE = re.compile(r"<h1(?:\s[^>]*)?>([\s\S]*?)</h1>", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]*>")


@dataclass(frozen=True)
class PreparedFile:
    normalized: NormalizedFile
    rendered_html: str
    render_version: str


def public_url(app, external_id):
    base_url = app.config["PUBLIC_GIST_BASE_URL"].rstrip("/")
    return f"{base_url}/{external_id}"


def revision_url(app, external_id, revision_number):
    return f"{public_url(app, external_id)}/revisions/{revision_number}"


def raw_file_url(app, external_id, filename, *, revision_number=None):
    encoded_filename = quote(filename, safe="")
    if revision_number is None:
        return f"{public_url(app, external_id)}/raw/{encoded_filename}"
    return (
        f"{revision_url(app, external_id, revision_number)}"
        f"/raw/{encoded_filename}"
    )


def normalize_title(value, *, present=True):
    if not present or value is None:
        return None
    if not isinstance(value, str):
        raise GistError("invalid_request", "title must be a string or null", 400)
    title = value.strip()
    if not title:
        return None
    if len(title) > 200:
        raise GistError("invalid_request", "title is too long", 400)
    return title


def normalize_author_name(value):
    author_name = (value or "").strip()
    if not author_name:
        raise GistError("invalid_request", "API key name is required", 400)
    return author_name


def _top_level_heading(rendered_html):
    match = FIRST_H1_RE.search(rendered_html or "")
    if not match:
        return None
    text = html.unescape(TAG_RE.sub("", match.group(1)))
    title = " ".join(text.split())
    return title or None


def display_title(title, lead_rendered_html, lead_name, external_id):
    return title or _top_level_heading(lead_rendered_html) or lead_name or external_id


def parse_revision_number(revision_number):
    if isinstance(revision_number, int):
        if revision_number > 0:
            return revision_number
        raise GistError("not_found", "Not found", 404)
    if not isinstance(revision_number, str) or not REVISION_RE.fullmatch(
        revision_number
    ):
        raise GistError("not_found", "Not found", 404)
    return int(revision_number)


def _max_file_count(app):
    return int(app.config.get("MAX_GIST_FILES", 32))


def _max_text_bytes(app):
    return int(app.config.get("MAX_GIST_TEXT_BYTES", 1024 * 1024))


def _normalize_payload_files(app, value):
    files = normalize_files(value, max_file_count=_max_file_count(app))
    validate_file_contents(
        files,
        max_text_bytes=_max_text_bytes(app),
        require_non_whitespace=False,
    )
    return files


def _image_prefix(app):
    return (
        f"{app.config.get('PUBLIC_API_BASE_URL', 'http://localhost:3001').rstrip('/')}"
        "/api/v1/images/"
    )


def _rewrite_image_attachments(files, assets):
    if not assets:
        return files

    rewritten = dict(files)
    referenced_ids = set()
    for filename in ordered_filenames(files):
        if file_kind(filename) != "markdown":
            continue
        content = files[filename].content
        for asset in assets:
            token = f"attachment:{asset['original_filename']}"
            if token in content:
                content = content.replace(token, asset["url"])
                referenced_ids.add(asset["id"])
        rewritten[filename] = normalized_file(filename, content)

    unreferenced = [
        asset["markdown"] for asset in assets if asset["id"] not in referenced_ids
    ]
    if unreferenced:
        lead = lead_filename(rewritten)
        if file_kind(lead) != "markdown":
            raise GistError(
                "invalid_request",
                "unreferenced images require a Markdown lead file",
                400,
            )
        content = rewritten[lead].content
        suffix = "\n".join(unreferenced)
        content = f"{content.rstrip()}\n\n{suffix}" if content.strip() else suffix
        rewritten[lead] = normalized_file(lead, content)
    return rewritten


def _render_files(app, files):
    highlight_budget = HighlightBudget()
    image_prefix = _image_prefix(app)
    prepared = {}
    for filename in ordered_filenames(files):
        normalized = files[filename]
        kind = file_kind(filename)
        if kind == "markdown":
            rendered = render_markdown_result(
                normalized.content,
                allowed_image_src_prefixes=(image_prefix,),
                highlight_budget=highlight_budget,
            )
        elif kind == "source":
            rendered = render_source_result(
                normalized.content,
                file_language(filename) or "text",
                highlight_budget=highlight_budget,
            )
        else:
            rendered = render_plain_text_result(normalized.content)
        prepared[filename] = PreparedFile(
            normalized=normalized,
            rendered_html=rendered.html,
            render_version=rendered.version,
        )
    return prepared


def _prepared_normalized_files(prepared_files):
    return {name: prepared.normalized for name, prepared in prepared_files.items()}


def _insert_revision(
    conn,
    *,
    gist_id,
    revision_number,
    title,
    author_name,
    digest,
    key_id,
    created_at,
    prepared_files,
):
    cursor = conn.execute(
        """
        insert into gist_revisions(
            gist_id, revision_number, title, author_name, snapshot_sha256,
            created_at, created_by_key_id
        ) values (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            gist_id,
            revision_number,
            title,
            author_name,
            digest,
            created_at,
            key_id,
        ),
    )
    revision_id = cursor.lastrowid
    conn.executemany(
        """
        insert into gist_revision_files(
            gist_revision_id, filename, content, rendered_html,
            render_version, content_sha256, byte_size
        ) values (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                revision_id,
                filename,
                prepared.normalized.content,
                prepared.rendered_html,
                prepared.render_version,
                prepared.normalized.content_sha256,
                prepared.normalized.byte_size,
            )
            for filename, prepared in prepared_files.items()
        ],
    )
    return revision_id


def _select_revision(conn, external_id, revision_number=None, *, owner_key_id=None):
    clauses = ["g.external_id = ?", "g.deleted_at is null"]
    values = [external_id]
    if revision_number is None:
        clauses.append("r.revision_number = g.latest_revision_number")
    else:
        clauses.append("r.revision_number = ?")
        values.append(revision_number)
    if owner_key_id is not None:
        clauses.append("g.owner_key_id = ?")
        values.append(owner_key_id)
    return conn.execute(
        f"""
        select
            g.id as gist_id,
            g.external_id,
            g.owner_key_id,
            g.latest_revision_number,
            g.created_at as gist_created_at,
            g.updated_at as gist_updated_at,
            r.id as revision_id,
            r.revision_number,
            r.title,
            r.author_name,
            r.snapshot_sha256,
            r.created_at as revision_created_at,
            r.created_by_key_id,
            author_key.avatar_url as author_avatar_url
        from gists g
        join gist_revisions r on r.gist_id = g.id
        left join api_keys author_key on author_key.id = r.created_by_key_id
        where {' and '.join(clauses)}
        """,
        tuple(values),
    ).fetchone()


def _load_revision_files(conn, revision_id):
    rows = conn.execute(
        """
        select
            id, filename, content, rendered_html, render_version,
            content_sha256, byte_size
        from gist_revision_files
        where gist_revision_id = ?
        order by filename
        """,
        (revision_id,),
    ).fetchall()
    if not rows:
        raise GistError("internal_error", "Gist revision has no files", 500)
    return {row["filename"]: row for row in rows}


def _normalized_from_rows(file_rows):
    return {
        filename: NormalizedFile(
            filename=filename,
            content=row["content"],
            content_sha256=row["content_sha256"],
            byte_size=row["byte_size"],
        )
        for filename, row in file_rows.items()
    }


def _prepared_from_rows(file_rows):
    return {
        filename: PreparedFile(
            normalized=NormalizedFile(
                filename=filename,
                content=row["content"],
                content_sha256=row["content_sha256"],
                byte_size=row["byte_size"],
            ),
            rendered_html=row["rendered_html"],
            render_version=row["render_version"],
        )
        for filename, row in file_rows.items()
    }


def _history_payload(app, conn, external_id, gist_id, latest_revision_number):
    rows = conn.execute(
        """
        select
            r.revision_number,
            r.created_at,
            r.author_name,
            r.snapshot_sha256,
            count(f.id) as file_count,
            author_key.avatar_url as author_avatar_url
        from gist_revisions r
        join gist_revision_files f on f.gist_revision_id = r.id
        left join api_keys author_key on author_key.id = r.created_by_key_id
        where r.gist_id = ?
        group by r.id
        order by r.revision_number desc
        limit 50
        """,
        (gist_id,),
    ).fetchall()
    history = []
    for row in rows:
        is_latest = row["revision_number"] == latest_revision_number
        item = {
            "revision_number": row["revision_number"],
            "created_at": row["created_at"],
            "author_name": row["author_name"],
            "snapshot_sha256": row["snapshot_sha256"],
            "file_count": row["file_count"],
            "is_latest": is_latest,
            "url": (
                public_url(app, external_id)
                if is_latest
                else revision_url(app, external_id, row["revision_number"])
            ),
        }
        if row["author_avatar_url"]:
            item["author_avatar_url"] = row["author_avatar_url"]
        history.append(item)
    return history


def _revision_body(
    app,
    conn,
    revision,
    *,
    include_content,
    include_rendered,
    include_history=False,
    pin_raw_revision=False,
):
    file_rows = _load_revision_files(conn, revision["revision_id"])
    ordered = ordered_filenames(file_rows)
    lead = ordered[0]
    lead_row = file_rows[lead]
    lead_html = lead_row["rendered_html"] if file_kind(lead) == "markdown" else None
    is_latest = revision["revision_number"] == revision["latest_revision_number"]
    body = {
        "id": revision["external_id"],
        "url": public_url(app, revision["external_id"]),
        "title": revision["title"],
        "display_title": display_title(
            revision["title"],
            lead_html,
            lead,
            revision["external_id"],
        ),
        "author_name": revision["author_name"],
        "primary_file": lead,
        "snapshot_sha256": revision["snapshot_sha256"],
        "revision_number": revision["revision_number"],
        "latest_revision_number": revision["latest_revision_number"],
        "created_at": revision["gist_created_at"],
        "updated_at": (
            revision["gist_updated_at"] if is_latest else revision["revision_created_at"]
        ),
        "files": {},
    }
    if revision["author_avatar_url"]:
        body["author_avatar_url"] = revision["author_avatar_url"]
    raw_revision = revision["revision_number"] if pin_raw_revision else None
    for filename in ordered:
        row = file_rows[filename]
        item = {
            "filename": filename,
            "content_sha256": row["content_sha256"],
            "byte_size": row["byte_size"],
            "raw_url": raw_file_url(
                app,
                revision["external_id"],
                filename,
                revision_number=raw_revision,
            ),
        }
        if include_content:
            item["content"] = row["content"]
        if include_rendered:
            item.update(
                {
                    "kind": file_kind(filename),
                    "language": file_language(filename),
                    "rendered_html": row["rendered_html"],
                }
            )
        body["files"][filename] = item
    if include_history:
        body["history"] = _history_payload(
            app,
            conn,
            revision["external_id"],
            revision["gist_id"],
            revision["latest_revision_number"],
        )
    return body


def create_gist(app, key_id, author_name, payload, image_uploads=None):
    author_name = normalize_author_name(author_name)
    title = normalize_title(payload.get("title"), present="title" in payload)
    files = _normalize_payload_files(app, payload.get("files"))
    staged_images = stage_images(app, image_uploads or [])
    try:
        image_assets = plan_image_assets(app, staged_images)
        files = _rewrite_image_attachments(files, image_assets)
        validate_file_contents(files, max_text_bytes=_max_text_bytes(app))
        prepared_files = _render_files(app, files)
        digest = snapshot_sha256(title, files)
        now = utc_now()

        with gist_connection(app) as conn:
            for _ in range(8):
                external_id = generate_external_id(app.config["GIST_EXTERNAL_ID_LENGTH"])
                try:
                    with conn:
                        cursor = conn.execute(
                            """
                            insert into gists(
                                external_id, owner_key_id, latest_revision_number,
                                created_at, updated_at
                            ) values (?, ?, 1, ?, ?)
                            """,
                            (external_id, key_id, now, now),
                        )
                        gist_id = cursor.lastrowid
                        revision_id = _insert_revision(
                            conn,
                            gist_id=gist_id,
                            revision_number=1,
                            title=title,
                            author_name=author_name,
                            digest=digest,
                            key_id=key_id,
                            created_at=now,
                            prepared_files=prepared_files,
                        )
                        insert_image_assets(
                            conn,
                            app,
                            key_id,
                            staged_images,
                            image_assets,
                        )
                        enqueue_push_deliveries(
                            conn,
                            api_key_id=key_id,
                            event_type=EVENT_GIST_PUBLISHED,
                            gist_revision_id=revision_id,
                            created_at=now,
                        )
                    revision = _select_revision(conn, external_id)
                    body = _revision_body(
                        app,
                        conn,
                        revision,
                        include_content=True,
                        include_rendered=False,
                    )
                    if image_assets:
                        body["images"] = image_assets
                    return body
                except sqlite3.IntegrityError as exc:
                    if "gists.external_id" not in str(exc):
                        raise
                    continue
    except Exception:
        cleanup_staged_images(staged_images)
        raise
    raise GistError("internal_error", "Internal error", 500)


def get_gist(app, external_id, *, include_files=False):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    with gist_connection(app) as conn:
        revision = _select_revision(conn, external_id)
        if revision is None:
            raise GistError("not_found", "Not found", 404)
        return _revision_body(
            app,
            conn,
            revision,
            include_content=include_files,
            include_rendered=False,
        )


def get_public_render(app, external_id, revision_number=None):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    parsed_revision = (
        parse_revision_number(revision_number) if revision_number is not None else None
    )
    with gist_connection(app) as conn:
        revision = _select_revision(conn, external_id, parsed_revision)
        if revision is None:
            raise GistError("not_found", "Not found", 404)
        return _revision_body(
            app,
            conn,
            revision,
            include_content=True,
            include_rendered=True,
            include_history=True,
            pin_raw_revision=parsed_revision is not None,
        )


def get_public_raw_file(app, external_id, *, revision_number=None, filename=None):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    parsed_revision = (
        parse_revision_number(revision_number) if revision_number is not None else None
    )
    with gist_connection(app) as conn:
        revision = _select_revision(conn, external_id, parsed_revision)
        if revision is None:
            raise GistError("not_found", "Not found", 404)
        file_rows = _load_revision_files(conn, revision["revision_id"])
        selected = filename or lead_filename(file_rows)
        row = file_rows.get(selected)
        if row is None:
            raise GistError("not_found", "Not found", 404)
        return selected, row["content"]


def _summary_rows(app, conn, key_id, limit):
    rows = conn.execute(
        """
        select
            g.id as gist_id,
            g.external_id,
            g.latest_revision_number,
            g.created_at,
            g.updated_at,
            r.id as revision_id,
            r.title,
            r.author_name,
            author_key.avatar_url as author_avatar_url,
            count(f.id) as file_count
        from gists g
        join gist_revisions r
          on r.gist_id = g.id and r.revision_number = g.latest_revision_number
        join gist_revision_files f on f.gist_revision_id = r.id
        left join api_keys author_key on author_key.id = r.created_by_key_id
        where g.owner_key_id = ? and g.deleted_at is null
        group by g.id, r.id
        order by g.updated_at desc
        limit ?
        """,
        (key_id, limit),
    ).fetchall()
    revision_ids = [row["revision_id"] for row in rows]
    files_by_revision = {revision_id: {} for revision_id in revision_ids}
    if revision_ids:
        placeholders = ",".join("?" for _ in revision_ids)
        for file_row in conn.execute(
            f"""
            select gist_revision_id, filename, rendered_html
            from gist_revision_files
            where gist_revision_id in ({placeholders})
            order by filename
            """,
            tuple(revision_ids),
        ):
            files_by_revision[file_row["gist_revision_id"]][
                file_row["filename"]
            ] = file_row
    return rows, files_by_revision


def list_gists_created_by_key(app, key_id, *, limit=100):
    limit = max(1, min(int(limit), 100))
    with gist_connection(app) as conn:
        rows, files_by_revision = _summary_rows(app, conn, key_id, limit)
        stats_row = conn.execute(
            """
            select
                count(*) as gist_count,
                coalesce(sum(latest_revision_number), 0) as revision_count,
                max(updated_at) as last_updated_at
            from gists
            where owner_key_id = ? and deleted_at is null
            """,
            (key_id,),
        ).fetchone()

    gists = []
    for row in rows:
        file_rows = files_by_revision[row["revision_id"]]
        lead = lead_filename(file_rows)
        lead_html = (
            file_rows[lead]["rendered_html"]
            if file_kind(lead) == "markdown"
            else None
        )
        item = {
            "id": row["external_id"],
            "url": public_url(app, row["external_id"]),
            "title": row["title"],
            "display_title": display_title(
                row["title"], lead_html, lead, row["external_id"]
            ),
            "author_name": row["author_name"],
            "revision_number": row["latest_revision_number"],
            "file_count": row["file_count"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        if row["author_avatar_url"]:
            item["author_avatar_url"] = row["author_avatar_url"]
        gists.append(item)
    return {
        "gists": gists,
        "stats": {
            "gist_count": stats_row["gist_count"],
            "revision_count": stats_row["revision_count"],
            "last_updated_at": stats_row["last_updated_at"],
        },
    }


def export_gists_created_by_key(app, key_id):
    with gist_connection(app) as conn:
        complete_rows = conn.execute(
            """
            select
                g.external_id, g.latest_revision_number, g.created_at, g.updated_at,
                r.id as revision_id, r.title, r.author_name, r.snapshot_sha256
            from gists g
            join gist_revisions r
              on r.gist_id = g.id and r.revision_number = g.latest_revision_number
            where g.owner_key_id = ? and g.deleted_at is null
            order by g.created_at, g.id
            """,
            (key_id,),
        ).fetchall()
        revision_ids = [row["revision_id"] for row in complete_rows]
        content_by_revision = {revision_id: {} for revision_id in revision_ids}
        if revision_ids:
            placeholders = ",".join("?" for _ in revision_ids)
            for file_row in conn.execute(
                f"""
                select gist_revision_id, filename, content, rendered_html,
                       content_sha256, byte_size
                from gist_revision_files
                where gist_revision_id in ({placeholders})
                order by filename
                """,
                tuple(revision_ids),
            ):
                content_by_revision[file_row["gist_revision_id"]][
                    file_row["filename"]
                ] = file_row

    exported_at = utc_now()
    manifest_gists = []
    archive = io.BytesIO()
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
    ) as export_zip:
        for row in complete_rows:
            gist_id = row["external_id"]
            file_rows = content_by_revision[row["revision_id"]]
            ordered = ordered_filenames(file_rows)
            lead = ordered[0]
            lead_html = (
                file_rows[lead]["rendered_html"]
                if file_kind(lead) == "markdown"
                else None
            )
            manifest_files = []
            for filename in ordered:
                try:
                    safe_filename = normalize_filename(filename)
                except GistError as exc:
                    raise GistError(
                        "internal_error", "Unsafe export filename", 500
                    ) from exc
                if safe_filename != filename:
                    raise GistError("internal_error", "Unsafe export filename", 500)
                file_path = f"gists/{gist_id}/{safe_filename}"
                if not file_path.startswith(f"gists/{gist_id}/"):
                    raise GistError("internal_error", "Unsafe export filename", 500)
                file_row = file_rows[filename]
                export_zip.writestr(file_path, file_row["content"])
                manifest_files.append(
                    {
                        "filename": filename,
                        "path": file_path,
                        "content_sha256": file_row["content_sha256"],
                        "byte_size": file_row["byte_size"],
                    }
                )
            manifest_gists.append(
                {
                    "id": gist_id,
                    "url": public_url(app, gist_id),
                    "title": row["title"],
                    "display_title": display_title(
                        row["title"], lead_html, lead, gist_id
                    ),
                    "author_name": row["author_name"],
                    "primary_file": lead,
                    "snapshot_sha256": row["snapshot_sha256"],
                    "revision_number": row["latest_revision_number"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "files": manifest_files,
                }
            )

        manifest = {
            "format": "waveygist-export",
            "manifest_version": 2,
            "exported_at": exported_at,
            "gist_count": len(manifest_gists),
            "gists": manifest_gists,
        }
        export_zip.writestr(
            "wavey-gist-export.json",
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        )
    archive.seek(0)
    return archive, f"waveygist-export-{exported_at[:10]}.zip"


def patch_gist(app, key_id, author_name, external_id, payload, image_uploads=None):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    if "files" not in payload and "title" not in payload and not image_uploads:
        raise GistError("invalid_request", "files or title is required", 400)
    expected_digest = payload.get("expected_snapshot_sha256")
    if not isinstance(expected_digest, str) or not SHA_RE.fullmatch(expected_digest):
        raise GistError(
            "invalid_request", "expected_snapshot_sha256 is required", 400
        )
    author_name = normalize_author_name(author_name)
    staged_images = stage_images(app, image_uploads or [])
    try:
        image_assets = plan_image_assets(app, staged_images)
        with gist_connection(app) as conn:
            current = _select_revision(conn, external_id, owner_key_id=key_id)
            if current is None:
                raise GistError("not_found", "Not found", 404)
            if expected_digest != current["snapshot_sha256"]:
                raise GistError("conflict", "Conflict", 409)
            current_rows = _load_revision_files(conn, current["revision_id"])

        if "files" in payload:
            next_files = _normalize_payload_files(app, payload["files"])
            files_changed = True
        else:
            next_files = _normalized_from_rows(current_rows)
            files_changed = bool(image_assets)
        next_files = _rewrite_image_attachments(next_files, image_assets)
        validate_file_contents(next_files, max_text_bytes=_max_text_bytes(app))
        next_title = (
            normalize_title(payload.get("title"), present=True)
            if "title" in payload
            else current["title"]
        )
        next_digest = snapshot_sha256(next_title, next_files)
        if files_changed:
            prepared_files = _render_files(app, next_files)
        else:
            prepared_files = _prepared_from_rows(current_rows)
        now = utc_now()

        with gist_connection(app) as conn:
            conn.execute("begin immediate")
            try:
                locked = _select_revision(conn, external_id, owner_key_id=key_id)
                if locked is None:
                    raise GistError("not_found", "Not found", 404)
                if locked["snapshot_sha256"] != expected_digest:
                    raise GistError("conflict", "Conflict", 409)
                if next_digest == locked["snapshot_sha256"]:
                    conn.rollback()
                    current_body = get_gist(app, external_id, include_files=True)
                    return current_body

                next_revision_number = locked["latest_revision_number"] + 1
                insert_image_assets(
                    conn,
                    app,
                    key_id,
                    staged_images,
                    image_assets,
                )
                revision_id = _insert_revision(
                    conn,
                    gist_id=locked["gist_id"],
                    revision_number=next_revision_number,
                    title=next_title,
                    author_name=author_name,
                    digest=next_digest,
                    key_id=key_id,
                    created_at=now,
                    prepared_files=prepared_files,
                )
                conn.execute(
                    """
                    update gists
                    set latest_revision_number = ?, updated_at = ?
                    where id = ?
                    """,
                    (next_revision_number, now, locked["gist_id"]),
                )
                enqueue_push_deliveries(
                    conn,
                    api_key_id=key_id,
                    event_type=EVENT_GIST_UPDATED,
                    gist_revision_id=revision_id,
                    created_at=now,
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise

            revision = _select_revision(conn, external_id)
            body = _revision_body(
                app,
                conn,
                revision,
                include_content=True,
                include_rendered=False,
            )
            if image_assets:
                body["images"] = image_assets
            return body
    except Exception:
        cleanup_staged_images(staged_images)
        raise


def delete_gist_created_by_key(app, key_id, external_id):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    now = utc_now()
    with gist_connection(app) as conn:
        with conn:
            current = conn.execute(
                """
                select id from gists
                where external_id = ? and owner_key_id = ? and deleted_at is null
                """,
                (external_id, key_id),
            ).fetchone()
            if current is None:
                raise GistError("not_found", "Not found", 404)
            conn.execute(
                "update gists set deleted_at = ? where id = ?",
                (now, current["id"]),
            )
            delete_pending_deliveries_for_gist(conn, current["id"])


def rerender_gists(app, *, external_id=None, dry_run=False):
    if external_id is not None and not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    with gist_connection(app) as conn:
        values = ()
        where = ""
        if external_id is not None:
            where = "where g.external_id = ?"
            values = (external_id,)
        rows = conn.execute(
            f"""
            select f.id, f.gist_revision_id, f.filename, f.content,
                   f.content_sha256, f.byte_size, g.id as gist_id
            from gist_revision_files f
            join gist_revisions r on r.id = f.gist_revision_id
            join gists g on g.id = r.gist_id
            {where}
            order by f.gist_revision_id, f.filename
            """,
            values,
        ).fetchall()
        if external_id is not None and not rows:
            raise GistError("not_found", "Not found", 404)

        updates = []
        gist_ids = set()
        revision_count = 0
        current_revision_id = None
        budget = None
        for row in rows:
            gist_ids.add(row["gist_id"])
            if row["gist_revision_id"] != current_revision_id:
                current_revision_id = row["gist_revision_id"]
                revision_count += 1
                budget = HighlightBudget()
            encoded = row["content"].encode("utf-8")
            if len(encoded) != row["byte_size"] or content_sha256(
                row["content"]
            ) != row["content_sha256"]:
                raise GistError("database_corrupt", "Stored file digest mismatch", 500)
            kind = file_kind(row["filename"])
            if kind == "markdown":
                rendered = render_markdown_result(
                    row["content"],
                    allowed_image_src_prefixes=(_image_prefix(app),),
                    highlight_budget=budget,
                )
            elif kind == "source":
                rendered = render_source_result(
                    row["content"],
                    file_language(row["filename"]) or "text",
                    highlight_budget=budget,
                )
            else:
                rendered = render_plain_text_result(row["content"])
            updates.append((rendered.html, rendered.version, row["id"]))

        if not dry_run:
            with conn:
                conn.executemany(
                    """
                    update gist_revision_files
                    set rendered_html = ?, render_version = ?
                    where id = ?
                    """,
                    updates,
                )
    return {
        "dry_run": dry_run,
        "gists": len(gist_ids),
        "files": len(updates),
        "revisions": revision_count,
        "render_version": render_version(),
    }
