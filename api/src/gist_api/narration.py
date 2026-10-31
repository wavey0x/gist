import hashlib
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from lxml import html as lxml_html

from .auth import utc_now
from .db import gist_connection
from .errors import GistError
from .external_ids import validate_external_id
from .gist_files import file_kind, lead_filename
from .listen_queue import append_to_listen_queue
from .narration_service import (
    NarrationServiceError,
    delete_service_job,
    get_service_audio,
    get_service_job,
    put_service_job,
)
from .notifications import enqueue_narration_ready_deliveries
from .service import display_title, parse_revision_number

MIME_TYPE = "audio/mpeg"
MAX_RETRIES = 1
RECONCILE_BATCH_SIZE = 3
CLEANUP_BATCH_SIZE = 10
RETRYABLE_ERROR_CODES = frozenset(
    {
        "audio_missing",
        "encoder_failed",
        "generation_failed",
        "storage_full",
        "storage_io",
        "worker_interrupted",
    }
)
SERVICE_FAILURE_CODES = frozenset(
    {
        "encoder_failed",
        "file_too_large",
        "generation_failed",
        "input_mismatch",
        "storage_full",
        "storage_io",
        "worker_interrupted",
    }
)

_SEMANTIC_TAGS = frozenset(
    {"h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "li"}
)
_SKIPPED_TAGS = frozenset(
    {"code", "img", "math", "pre", "script", "style", "svg", "table"}
)
_SKIPPED_CLASSES = frozenset(
    {
        "katex",
        "katex-display",
        "math",
        "math-display",
        "mermaid",
        "mermaid-render",
        "mermaid-source",
        "sr-only",
        "visually-hidden",
    }
)


@dataclass(frozen=True)
class NarrationSource:
    gist_revision_id: int
    gist_id: int
    external_id: str
    revision_number: int
    title: str
    filename: str
    rendered_html: str
    render_version: str
    text: str
    text_sha256: str


def _normalize_block_text(value):
    normalized = unicodedata.normalize("NFC", value or "")
    normalized = "".join(
        " " if unicodedata.category(char).startswith("C") else char
        for char in normalized
    )
    return " ".join(normalized.split())


def _sentence_block(value):
    value = _normalize_block_text(value)
    if value and value[-1] not in ".?!:;":
        value += "."
    return value


def _is_skipped(element):
    for candidate in (element, *element.iterancestors()):
        tag = candidate.tag.lower() if isinstance(candidate.tag, str) else ""
        if tag in _SKIPPED_TAGS:
            return True
        if "hidden" in candidate.attrib:
            return True
        if candidate.attrib.get("aria-hidden", "").strip().lower() == "true":
            return True
        if set(candidate.attrib.get("class", "").split()) & _SKIPPED_CLASSES:
            return True
    return False


def _semantic_text(element):
    pieces = []
    for text_node in element.xpath(".//text()"):
        parent = text_node.getparent()
        context = parent.getparent() if text_node.is_tail else parent
        if context is None or _is_skipped(context):
            continue
        candidate = context
        nested_semantic = False
        while candidate is not None and candidate is not element:
            tag = candidate.tag.lower() if isinstance(candidate.tag, str) else ""
            if tag in _SEMANTIC_TAGS:
                nested_semantic = True
                break
            candidate = candidate.getparent()
        if not nested_semantic:
            pieces.append(str(text_node))
    return "".join(pieces)


def extract_narration_text(rendered_html, title, *, max_chars=100000):
    try:
        root = lxml_html.fragment_fromstring(rendered_html or "", create_parent="div")
    except (TypeError, ValueError) as exc:
        raise GistError(
            "not_narratable", "Article content is not narratable", 422
        ) from exc

    resolved_title = _normalize_block_text(title)
    blocks = [_sentence_block(resolved_title)] if resolved_title else []
    first_heading_seen = False
    for element in root.iterdescendants():
        tag = element.tag.lower() if isinstance(element.tag, str) else ""
        if tag not in _SEMANTIC_TAGS or _is_skipped(element):
            continue
        text = _normalize_block_text(_semantic_text(element))
        if not text:
            continue
        if tag == "h1" and not first_heading_seen:
            first_heading_seen = True
            if resolved_title and text.casefold() == resolved_title.casefold():
                continue
        blocks.append(_sentence_block(text))

    narration_text = "\n\n".join(filter(None, blocks)).strip()
    if not narration_text:
        raise GistError("not_narratable", "Article content is not narratable", 422)
    if len(narration_text) > int(max_chars):
        raise GistError("narration_too_long", "Article is too long to narrate", 422)
    return narration_text


def _load_source_row(conn, external_id, revision_number):
    revision = conn.execute(
        """
        select g.id as gist_id, g.external_id, r.id as gist_revision_id,
               r.revision_number, r.title
        from gists g
        join gist_revisions r on r.gist_id = g.id
        where g.external_id = ? and g.deleted_at is null
          and r.revision_number = ?
        """,
        (external_id, revision_number),
    ).fetchone()
    if revision is None:
        raise GistError("not_found", "Not found", 404)
    file_rows = conn.execute(
        """
        select filename, rendered_html, render_version
        from gist_revision_files
        where gist_revision_id = ? order by filename
        """,
        (revision["gist_revision_id"],),
    ).fetchall()
    if not file_rows:
        raise GistError("internal_error", "Gist revision has no files", 500)
    files = {row["filename"]: row for row in file_rows}
    filename = lead_filename(files)
    if file_kind(filename) != "markdown":
        raise GistError("not_narratable", "The primary file is not Markdown", 422)
    file_row = files[filename]
    title = display_title(
        revision["title"], file_row["rendered_html"], filename, external_id
    )
    return revision, file_row, filename, title


def load_narration_source(conn, app, external_id, revision_number):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    revision_number = parse_revision_number(revision_number)
    revision, file_row, filename, title = _load_source_row(
        conn, external_id, revision_number
    )
    text = extract_narration_text(
        file_row["rendered_html"],
        title,
        max_chars=app.config["NARRATION_TEXT_LIMIT_CHARS"],
    )
    return NarrationSource(
        gist_revision_id=revision["gist_revision_id"],
        gist_id=revision["gist_id"],
        external_id=revision["external_id"],
        revision_number=revision["revision_number"],
        title=title,
        filename=filename,
        rendered_html=file_row["rendered_html"],
        render_version=file_row["render_version"],
        text=text,
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def _ready_audio_is_valid(row):
    return bool(
        row["status"] == "ready"
        and row["audio_sha256"]
        and row["byte_size"]
        and row["mime_type"] == MIME_TYPE
    )


def _status_body(source, row):
    status = row["status"]
    body = {
        "status": status,
        "retryable": bool(
            status == "failed"
            and row["error_code"] in RETRYABLE_ERROR_CODES
            and row["retry_count"] < MAX_RETRIES
        ),
    }
    if status == "ready":
        body["audio_url"] = (
            f"/api/gists/{source.external_id}/revisions/"
            f"{source.revision_number}/narration/audio"
        )
    return body


def _matching_narration(conn, source):
    return conn.execute(
        "select * from narrations where gist_revision_id = ?",
        (source.gist_revision_id,),
    ).fetchone()


def _insert_watcher(conn, narration_id, api_key_id, created_at):
    conn.execute(
        """
        insert into narration_watchers(narration_id, api_key_id, created_at)
        values (?, ?, ?)
        on conflict(narration_id, api_key_id) do nothing
        """,
        (narration_id, api_key_id, created_at),
    )


def _enqueue_cleanup(conn, row, created_at):
    conn.execute(
        """
        insert into narration_cleanup_jobs(
            service_job_id, attempt_count, next_attempt_at, created_at
        ) values (?, 0, ?, ?)
        on conflict(service_job_id) do nothing
        """,
        (
            row["service_job_id"],
            created_at,
            created_at,
        ),
    )


def _rolling_cutoff(now_datetime):
    return (
        (now_datetime - timedelta(hours=24))
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def start_narration(app, auth, external_id, revision_number, *, now_datetime=None):
    now_datetime = now_datetime or datetime.now(timezone.utc)
    created_at = now_datetime.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    with gist_connection(app) as conn:
        conn.execute("begin immediate")
        try:
            key = conn.execute(
                """
                select audio_generation_daily_limit, revoked_at
                from api_keys where id = ?
                """,
                (auth.key_id,),
            ).fetchone()
            if key is None or key["revoked_at"] is not None:
                raise GistError("unauthorized", "Unauthorized", 401)
            limit = key["audio_generation_daily_limit"]
            if limit == 0:
                raise GistError("forbidden", "Audio access is disabled", 403)

            source = load_narration_source(conn, app, external_id, revision_number)
            # Asking for audio means wanting to hear it: queue the gist.
            append_to_listen_queue(conn, auth.key_id, source.gist_id, created_at)
            row = _matching_narration(conn, source)
            if row is not None and row["text_sha256"] != source.text_sha256:
                conn.execute("delete from narrations where id = ?", (row["id"],))
                row = None
            if row is not None:
                if row["status"] == "pending":
                    _insert_watcher(conn, row["id"], auth.key_id, created_at)
                elif (
                    row["status"] == "failed"
                    and row["error_code"] in RETRYABLE_ERROR_CODES
                    and row["retry_count"] < MAX_RETRIES
                ):
                    _enqueue_cleanup(conn, row, created_at)
                    service_job_id = str(uuid.uuid4())
                    conn.execute(
                        """
                        update narrations
                        set service_job_id = ?, text_sha256 = ?, status = 'pending',
                            retry_count = retry_count + 1,
                            engine_fingerprint = null,
                            audio_sha256 = null, mime_type = null,
                            byte_size = null, duration_ms = null,
                            error_code = null, updated_at = ?, finished_at = null
                        where id = ? and status = 'failed' and retry_count < ?
                        """,
                        (
                            service_job_id,
                            source.text_sha256,
                            created_at,
                            row["id"],
                            MAX_RETRIES,
                        ),
                    )
                    _insert_watcher(conn, row["id"], auth.key_id, created_at)
                    row = conn.execute(
                        "select * from narrations where id = ?", (row["id"],)
                    ).fetchone()
                conn.commit()
                return _status_body(source, row)

            if limit is not None:
                used = conn.execute(
                    """
                    select count(*) from narrations
                    where requested_by_key_id = ? and created_at > ?
                    """,
                    (auth.key_id, _rolling_cutoff(now_datetime)),
                ).fetchone()[0]
                if used >= limit:
                    raise GistError(
                        "daily_limit", "Daily audio generation limit reached", 429
                    )
            cursor = conn.execute(
                """
                insert into narrations(
                    gist_revision_id, requested_by_key_id, service_job_id,
                    text_sha256, status, retry_count, created_at, updated_at
                ) values (?, ?, ?, ?, 'pending', 0, ?, ?)
                """,
                (
                    source.gist_revision_id,
                    auth.key_id,
                    str(uuid.uuid4()),
                    source.text_sha256,
                    created_at,
                    created_at,
                ),
            )
            _insert_watcher(conn, cursor.lastrowid, auth.key_id, created_at)
            row = conn.execute(
                "select * from narrations where id = ?", (cursor.lastrowid,)
            ).fetchone()
            conn.commit()
            return _status_body(source, row)
        except Exception:
            conn.rollback()
            raise


def get_narration_status(app, external_id, revision_number):
    with gist_connection(app) as conn:
        source = load_narration_source(conn, app, external_id, revision_number)
        row = _matching_narration(conn, source)
        if row is None:
            raise GistError("narration_not_found", "Audio has not been requested", 404)
        if row["text_sha256"] != source.text_sha256:
            raise GistError(
                "source_mismatch", "Stored article source changed unexpectedly", 409
            )
        return _status_body(source, row)


def get_narration_audio(app, external_id, revision_number, *, method, headers):
    with gist_connection(app) as conn:
        source = load_narration_source(conn, app, external_id, revision_number)
        row = _matching_narration(conn, source)
        if (
            row is None
            or row["status"] != "ready"
            or row["text_sha256"] != source.text_sha256
        ):
            raise GistError("not_found", "Not found", 404)
        if not _ready_audio_is_valid(row):
            raise GistError("not_found", "Not found", 404)
        metadata = dict(row)
    try:
        response = get_service_audio(
            app,
            metadata["service_job_id"],
            method=method,
            headers=headers,
        )
    except NarrationServiceError as exc:
        raise GistError(
            "audio_unavailable", "Audio is temporarily unavailable", 503
        ) from exc
    if response.status_code in {304, 416}:
        return response, metadata
    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
    try:
        duration_ms = int(response.headers.get("X-Audio-Duration-Ms", ""))
        content_length = int(response.headers.get("Content-Length", ""))
    except ValueError:
        response.close()
        raise GistError("audio_unavailable", "Audio is temporarily unavailable", 503)
    if (
        response.status_code not in {200, 206}
        or content_type != MIME_TYPE
        or response.headers.get("X-Content-SHA256") != metadata["audio_sha256"]
        or response.headers.get("X-Engine-Fingerprint")
        != metadata["engine_fingerprint"]
        or duration_ms != metadata["duration_ms"]
        or (response.status_code == 200 and content_length != metadata["byte_size"])
    ):
        response.close()
        raise GistError("audio_unavailable", "Audio is temporarily unavailable", 503)
    return response, metadata


def _mark_failed(app, narration_id, service_job_id, error_code):
    now = utc_now()
    with gist_connection(app) as conn:
        with conn:
            row = conn.execute(
                "select * from narrations where id = ? and service_job_id = ?",
                (narration_id, service_job_id),
            ).fetchone()
            if row is None or row["status"] != "pending":
                return
            _enqueue_cleanup(conn, row, now)
            conn.execute(
                """
                update narrations
                set status = 'failed', engine_fingerprint = null, audio_sha256 = null,
                    mime_type = null, byte_size = null,
                    duration_ms = null, error_code = ?, updated_at = ?,
                    finished_at = ?
                where id = ? and service_job_id = ?
                  and status = 'pending'
                """,
                (error_code, now, now, narration_id, service_job_id),
            )
            conn.execute(
                """
                delete from push_deliveries
                where narration_id = ? and status = 'pending'
                """,
                (narration_id,),
            )


def _publish_ready_audio(app, row, job):
    if job.byte_size > app.config["NARRATION_FILE_LIMIT_BYTES"]:
        _mark_failed(app, row["id"], row["service_job_id"], "file_too_large")
        return
    finished_at = utc_now()
    with gist_connection(app) as conn:
        with conn:
            committed = conn.execute(
                """
                update narrations
                set status = 'ready',
                    engine_fingerprint = ?, audio_sha256 = ?,
                    mime_type = 'audio/mpeg',
                    byte_size = ?, duration_ms = ?, error_code = null,
                    updated_at = ?, finished_at = ?
                where id = ? and service_job_id = ? and status = 'pending'
                """,
                (
                    job.engine_fingerprint,
                    job.audio_sha256,
                    job.byte_size,
                    job.duration_ms,
                    finished_at,
                    finished_at,
                    row["id"],
                    row["service_job_id"],
                ),
            )
            if committed.rowcount == 1:
                enqueue_narration_ready_deliveries(
                    conn,
                    narration_id=row["id"],
                    gist_revision_id=row["gist_revision_id"],
                    created_at=finished_at,
                )


def reconcile_narration(app, narration_id):
    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select n.*, g.external_id, r.revision_number
            from narrations n
            join gist_revisions r on r.id = n.gist_revision_id
            join gists g on g.id = r.gist_id
            where n.id = ? and g.deleted_at is null
            """,
            (narration_id,),
        ).fetchone()
        if row is None or row["status"] in {"ready", "failed"}:
            return
        key = conn.execute(
            """
            select revoked_at, audio_generation_daily_limit
            from api_keys where id = ?
            """,
            (row["requested_by_key_id"],),
        ).fetchone()
        if (
            key is None
            or key["revoked_at"] is not None
            or key["audio_generation_daily_limit"] == 0
        ):
            _mark_failed(app, row["id"], row["service_job_id"], "access_revoked")
            return
        # Move checked jobs behind other pending work, including on service errors.
        with conn:
            conn.execute(
                "update narrations set updated_at = ? where id = ? and status = 'pending'",
                (utc_now(), row["id"]),
            )
    try:
        job = get_service_job(app, row["service_job_id"])
    except NarrationServiceError as exc:
        if exc.status != 404:
            if not exc.transient:
                _mark_failed(
                    app, row["id"], row["service_job_id"], "invalid_service_output"
                )
            return
        with gist_connection(app) as conn:
            try:
                source = load_narration_source(
                    conn, app, row["external_id"], row["revision_number"]
                )
            except GistError:
                _mark_failed(
                    app, row["id"], row["service_job_id"], "source_unavailable"
                )
                return
        if source.text_sha256 != row["text_sha256"]:
            _mark_failed(app, row["id"], row["service_job_id"], "source_mismatch")
            return
        try:
            job = put_service_job(
                app, row["service_job_id"], source.text, row["text_sha256"]
            )
        except NarrationServiceError as submit_error:
            if not submit_error.transient:
                _mark_failed(
                    app, row["id"], row["service_job_id"], "invalid_service_output"
                )
            return
    if job.status in {"queued", "running"}:
        return
    if job.status == "failed":
        error_code = (
            job.error_code
            if job.error_code in SERVICE_FAILURE_CODES
            else "invalid_service_output"
        )
        _mark_failed(app, row["id"], row["service_job_id"], error_code)
        return
    _publish_ready_audio(app, row, job)


def due_narration_ids(app, *, limit=RECONCILE_BATCH_SIZE):
    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select id from narrations
            where status = 'pending'
            order by updated_at, id limit ?
            """,
            (limit,),
        ).fetchall()
    return [row["id"] for row in rows]


def run_narration_pass(app, *, limit=RECONCILE_BATCH_SIZE):
    ids = due_narration_ids(app, limit=limit)
    for narration_id in ids:
        reconcile_narration(app, narration_id)
    return len(ids)


def cleanup_narration_jobs(app, *, limit=CLEANUP_BATCH_SIZE):
    now = utc_now()
    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select * from narration_cleanup_jobs
            where next_attempt_at <= ?
            order by next_attempt_at, service_job_id limit ?
            """,
            (now, limit),
        ).fetchall()
    for row in rows:
        try:
            delete_service_job(app, row["service_job_id"])
        except NarrationServiceError:
            delay = min(3600, 30 * (2 ** min(row["attempt_count"], 7)))
            next_attempt = (
                (datetime.now(timezone.utc) + timedelta(seconds=delay))
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            )
            with gist_connection(app) as conn:
                with conn:
                    conn.execute(
                        """
                        update narration_cleanup_jobs
                        set attempt_count = attempt_count + 1, next_attempt_at = ?
                        where service_job_id = ?
                        """,
                        (next_attempt, row["service_job_id"]),
                    )
        else:
            with gist_connection(app) as conn:
                with conn:
                    conn.execute(
                        "delete from narration_cleanup_jobs where service_job_id = ?",
                        (row["service_job_id"],),
                    )
    return len(rows)
