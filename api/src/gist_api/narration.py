import hashlib
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lxml import html as lxml_html

from .db import gist_connection
from .errors import GistError
from .external_ids import validate_external_id
from .gist_files import file_kind, lead_filename
from .service import display_title, parse_revision_number


POCKET_TTS_VERSION = "3.0.2"
POCKET_LANGUAGE = "english_2026-04"
POCKET_MODEL_REVISION = "d29db7978e464fb90cb3359ee0c69a273b9142cc"
POCKET_VOICE = "peter_yearsley"
POCKET_VOICE_REVISION = "e81d79e8194ad4c7ce879c87a4258ef20cbf2487"
POCKET_MAX_TOKENS = 50
MP3_BITRATE_KBPS = 64
RECIPE_VERSION = (
    "html-v1:pocket-tts-3.0.2:english-2026-04-d29db797:"
    "peter-yearsley-e81d79e:max50:mp3-cbr64"
)
MAX_ATTEMPTS = 2
MIME_TYPE = "audio/mpeg"
RETRYABLE_ERROR_CODES = frozenset(
    {
        "encoder_failed",
        "generation_failed",
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
        classes = set(candidate.attrib.get("class", "").split())
        if classes & _SKIPPED_CLASSES:
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
        root = lxml_html.fragment_fromstring(
            rendered_html or "",
            create_parent="div",
        )
    except (TypeError, ValueError) as exc:
        raise GistError("not_narratable", "Article content is not narratable", 422) from exc

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
        block = _sentence_block(text)
        if block:
            blocks.append(block)

    narration_text = "\n\n".join(blocks).strip()
    if not narration_text:
        raise GistError("not_narratable", "Article content is not narratable", 422)
    if len(narration_text) > int(max_chars):
        raise GistError("narration_too_long", "Article is too long to narrate", 422)
    return narration_text


def _load_source_row(conn, external_id, revision_number):
    revision = conn.execute(
        """
        select
            g.id as gist_id,
            g.external_id,
            r.id as gist_revision_id,
            r.revision_number,
            r.title
        from gists g
        join gist_revisions r on r.gist_id = g.id
        where g.external_id = ?
          and g.deleted_at is null
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
        where gist_revision_id = ?
        order by filename
        """,
        (revision["gist_revision_id"],),
    ).fetchall()
    if not file_rows:
        raise GistError("internal_error", "Gist revision has no files", 500)
    files = {row["filename"]: row for row in file_rows}
    filename = lead_filename(files)
    if file_kind(filename) != "markdown":
        raise GistError(
            "not_narratable",
            "The primary file is not Markdown",
            422,
        )
    file_row = files[filename]
    title = display_title(
        revision["title"],
        file_row["rendered_html"],
        filename,
        external_id,
    )
    return revision, file_row, filename, title


def load_narration_source(conn, app, external_id, revision_number):
    if not validate_external_id(external_id):
        raise GistError("not_found", "Not found", 404)
    revision_number = parse_revision_number(revision_number)
    revision, file_row, filename, title = _load_source_row(
        conn,
        external_id,
        revision_number,
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


def narration_storage_dir(app):
    configured = app.config.get("NARRATION_STORAGE_DIR")
    if configured:
        path = Path(configured).expanduser().resolve()
    else:
        database_path = Path(app.config["SQLITE_DB_PATH"]).expanduser().resolve()
        path = database_path.parent / "narrations"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)
    return path


def _audio_path(app, filename):
    if not filename or Path(filename).name != filename or filename in {".", ".."}:
        raise GistError("not_found", "Not found", 404)
    return narration_storage_dir(app) / filename


def _ready_audio_is_valid(app, row):
    if row["status"] != "ready":
        return False
    try:
        path = _audio_path(app, row["audio_filename"])
        return path.is_file() and path.stat().st_size == row["byte_size"]
    except (GistError, OSError):
        return False


def _status_body(app, source, row):
    status = row["status"]
    if status == "ready" and not _ready_audio_is_valid(app, row):
        return {"status": "failed", "retryable": False}
    body = {
        "status": status,
        "retryable": bool(
            status == "failed"
            and row["error_code"] in RETRYABLE_ERROR_CODES
            and row["attempt_count"] < MAX_ATTEMPTS
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
        """
        select *
        from narrations
        where gist_revision_id = ?
          and source_render_version = ?
          and recipe_version = ?
        """,
        (source.gist_revision_id, source.render_version, RECIPE_VERSION),
    ).fetchone()


def _require_matching_digest(source, row):
    if row["text_sha256"] != source.text_sha256:
        raise GistError(
            "source_mismatch",
            "Stored article source changed unexpectedly",
            409,
        )


def _insert_watcher(conn, narration_id, api_key_id, created_at):
    conn.execute(
        """
        insert into narration_watchers(narration_id, api_key_id, created_at)
        values (?, ?, ?)
        on conflict(narration_id, api_key_id) do nothing
        """,
        (narration_id, api_key_id, created_at),
    )


def _queue_is_full(conn, limit):
    count = conn.execute(
        """
        select count(*)
        from narrations
        where status in ('pending', 'processing')
        """
    ).fetchone()[0]
    return count >= int(limit)


def _rolling_cutoff(now_datetime):
    return (now_datetime - timedelta(hours=24)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def start_narration(app, auth, external_id, revision_number, *, now_datetime=None):
    now_datetime = now_datetime or datetime.now(timezone.utc)
    created_at = now_datetime.isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    with gist_connection(app) as conn:
        conn.execute("begin immediate")
        try:
            key = conn.execute(
                """
                select audio_generation_daily_limit, revoked_at
                from api_keys
                where id = ?
                """,
                (auth.key_id,),
            ).fetchone()
            if key is None or key["revoked_at"] is not None:
                raise GistError("unauthorized", "Unauthorized", 401)
            limit = key["audio_generation_daily_limit"]
            if limit == 0:
                raise GistError("forbidden", "Audio access is disabled", 403)

            source = load_narration_source(
                conn,
                app,
                external_id,
                revision_number,
            )
            row = _matching_narration(conn, source)
            if row is not None:
                _require_matching_digest(source, row)
                if row["status"] in {"pending", "processing"}:
                    _insert_watcher(conn, row["id"], auth.key_id, created_at)
                elif (
                    row["status"] == "failed"
                    and row["error_code"] in RETRYABLE_ERROR_CODES
                    and row["attempt_count"] < MAX_ATTEMPTS
                ):
                    if _queue_is_full(conn, app.config["NARRATION_QUEUE_LIMIT"]):
                        raise GistError("queue_full", "Audio queue is full", 429)
                    conn.execute(
                        """
                        update narrations
                        set status = 'pending', error_code = null,
                            updated_at = ?, started_at = null, finished_at = null
                        where id = ? and status = 'failed'
                        """,
                        (created_at, row["id"]),
                    )
                    _insert_watcher(conn, row["id"], auth.key_id, created_at)
                    row = conn.execute(
                        "select * from narrations where id = ?",
                        (row["id"],),
                    ).fetchone()
                conn.commit()
                return _status_body(app, source, row)

            if _queue_is_full(conn, app.config["NARRATION_QUEUE_LIMIT"]):
                raise GistError("queue_full", "Audio queue is full", 429)
            if limit is not None:
                used = conn.execute(
                    """
                    select count(*)
                    from narrations
                    where requested_by_key_id = ? and created_at > ?
                    """,
                    (auth.key_id, _rolling_cutoff(now_datetime)),
                ).fetchone()[0]
                if used >= limit:
                    raise GistError(
                        "daily_limit",
                        "Daily audio generation limit reached",
                        429,
                    )
            cursor = conn.execute(
                """
                insert into narrations(
                    gist_revision_id, requested_by_key_id, recipe_version,
                    source_render_version, text_sha256, status, attempt_count,
                    created_at, updated_at
                )
                values (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
                """,
                (
                    source.gist_revision_id,
                    auth.key_id,
                    RECIPE_VERSION,
                    source.render_version,
                    source.text_sha256,
                    created_at,
                    created_at,
                ),
            )
            _insert_watcher(conn, cursor.lastrowid, auth.key_id, created_at)
            row = conn.execute(
                "select * from narrations where id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            conn.commit()
            return _status_body(app, source, row)
        except Exception:
            conn.rollback()
            raise


def get_narration_status(app, external_id, revision_number):
    with gist_connection(app) as conn:
        source = load_narration_source(conn, app, external_id, revision_number)
        row = _matching_narration(conn, source)
        if row is None:
            raise GistError("narration_not_found", "Audio has not been requested", 404)
        _require_matching_digest(source, row)
        return _status_body(app, source, row)


def get_narration_audio(app, external_id, revision_number):
    with gist_connection(app) as conn:
        source = load_narration_source(conn, app, external_id, revision_number)
        row = _matching_narration(conn, source)
        if row is None or row["status"] != "ready":
            raise GistError("not_found", "Not found", 404)
        _require_matching_digest(source, row)
        path = _audio_path(app, row["audio_filename"])
        if not path.is_file() or path.stat().st_size != row["byte_size"]:
            raise GistError("not_found", "Not found", 404)
        return path


def directory_usage(path):
    total = 0
    for entry in path.iterdir():
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except FileNotFoundError:
            continue
    return total


def prune_narrations(app, target_bytes):
    target_bytes = int(target_bytes)
    if target_bytes < 0 or target_bytes > app.config["NARRATION_STORAGE_LIMIT_BYTES"]:
        raise ValueError("target bytes must be within the narration storage limit")
    storage_dir = narration_storage_dir(app)
    deleted_rows = 0
    deleted_files = 0
    freed_bytes = 0
    with gist_connection(app) as conn:
        rows = conn.execute(
            """
            select
                n.id, n.audio_filename, n.byte_size,
                exists (
                    select 1 from narrations newer
                    where newer.gist_revision_id = n.gist_revision_id
                      and newer.id > n.id
                ) as superseded
            from narrations n
            where n.status = 'ready'
            order by superseded desc, n.finished_at, n.id
            """
        ).fetchall()
        for row in rows:
            if directory_usage(storage_dir) <= target_bytes:
                break
            filename = row["audio_filename"]
            with conn:
                cursor = conn.execute(
                    "delete from narrations where id = ? and status = 'ready'",
                    (row["id"],),
                )
            if cursor.rowcount != 1:
                continue
            deleted_rows += 1
            path = _audio_path(app, filename)
            try:
                size = path.stat().st_size
                path.unlink()
                deleted_files += 1
                freed_bytes += size
            except FileNotFoundError:
                pass

        referenced = {
            row["audio_filename"]
            for row in conn.execute(
                """
                select audio_filename from narrations
                where status = 'ready' and audio_filename is not null
                """
            )
        }
    for entry in storage_dir.glob("narration-*.mp3"):
        if entry.name in referenced:
            continue
        try:
            size = entry.stat().st_size
            entry.unlink()
            deleted_files += 1
            freed_bytes += size
        except FileNotFoundError:
            pass
    return {
        "deleted_rows": deleted_rows,
        "deleted_files": deleted_files,
        "freed_bytes": freed_bytes,
        "remaining_bytes": directory_usage(storage_dir),
        "target_bytes": target_bytes,
    }
