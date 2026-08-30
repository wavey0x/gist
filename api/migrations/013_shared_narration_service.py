import hashlib
import uuid
from pathlib import Path

NAMESPACE = uuid.UUID("861249f2-3da7-4ee8-89bf-ac7e20102b1f")


def _storage_directory(conn):
    database_file = conn.execute("pragma database_list").fetchone()["file"]
    return Path(database_file).resolve().parent / "narrations"


def _retained_ready_rows(conn):
    storage = _storage_directory(conn)
    rows = conn.execute(
        """
        select * from narrations
        where status = 'ready'
        order by gist_revision_id, finished_at desc, id desc
        """
    ).fetchall()
    retained = {}
    for row in rows:
        if row["gist_revision_id"] in retained:
            continue
        filename = row["audio_filename"]
        if not filename or Path(filename).name != filename:
            continue
        path = storage / filename
        try:
            if not path.is_file() or path.stat().st_size != row["byte_size"]:
                continue
            audio_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        text_sha256 = row["text_sha256"]
        if (
            not isinstance(text_sha256, str)
            or len(text_sha256) != 64
            or any(char not in "0123456789abcdef" for char in text_sha256)
        ):
            continue
        retained[row["gist_revision_id"]] = {
            "id": row["id"],
            "gist_revision_id": row["gist_revision_id"],
            "requested_by_key_id": row["requested_by_key_id"],
            "service_job_id": str(
                uuid.uuid5(NAMESPACE, f"waveygist:narration:{row['id']}")
            ),
            "text_sha256": text_sha256,
            "engine_fingerprint": row["recipe_version"],
            "audio_filename": filename,
            "audio_sha256": audio_sha256,
            "byte_size": row["byte_size"],
            "duration_ms": row["duration_ms"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "finished_at": row["finished_at"],
        }
    return retained


def upgrade(conn):
    retained = _retained_ready_rows(conn)
    watcher_rows = conn.execute(
        """
        select n.gist_revision_id, w.api_key_id, min(w.created_at) as created_at
        from narration_watchers w
        join narrations n on n.id = w.narration_id
        group by n.gist_revision_id, w.api_key_id
        """
    ).fetchall()

    conn.execute("delete from push_deliveries where narration_id is not null")
    conn.execute("drop table narration_watchers")
    conn.execute("drop table narrations")

    conn.execute(
        """
        create table narrations (
            id integer primary key,
            gist_revision_id integer not null unique
                references gist_revisions(id) on delete cascade,
            requested_by_key_id integer not null references api_keys(id),
            service_job_id text not null unique check (length(service_job_id) = 36),
            text_sha256 text not null check (
                length(text_sha256) = 64
                and text_sha256 not glob '*[^0-9a-f]*'
            ),
            status text not null default 'pending'
                check (status in ('pending', 'publishing', 'ready', 'failed')),
            retry_count integer not null default 0 check (retry_count in (0, 1)),
            publish_started_at text null,
            engine_fingerprint text null,
            audio_filename text null check (
                audio_filename is null or (
                    length(audio_filename) between 1 and 255
                    and instr(audio_filename, '/') = 0
                    and instr(audio_filename, char(92)) = 0
                    and audio_filename not in ('.', '..')
                )
            ),
            audio_sha256 text null check (
                audio_sha256 is null or (
                    length(audio_sha256) = 64
                    and audio_sha256 not glob '*[^0-9a-f]*'
                )
            ),
            mime_type text null check (mime_type is null or mime_type = 'audio/mpeg'),
            byte_size integer null check (byte_size is null or byte_size > 0),
            duration_ms integer null check (duration_ms is null or duration_ms > 0),
            error_code text null check (
                error_code is null or error_code in (
                    'source_mismatch', 'source_unavailable', 'access_revoked',
                    'invalid_service_output', 'input_mismatch', 'encoder_failed',
                    'storage_full', 'file_too_large', 'generation_failed',
                    'storage_io', 'worker_interrupted', 'audio_missing'
                )
            ),
            created_at text not null,
            updated_at text not null,
            finished_at text null,
            check (
                (status = 'publishing' and publish_started_at is not null)
                or (status != 'publishing' and publish_started_at is null)
            ),
            check (
                (status = 'ready'
                    and engine_fingerprint is not null
                    and audio_filename is not null
                    and audio_sha256 is not null
                    and mime_type = 'audio/mpeg'
                    and byte_size is not null
                    and duration_ms is not null
                    and error_code is null
                    and finished_at is not null)
                or
                (status != 'ready'
                    and engine_fingerprint is null
                    and audio_filename is null
                    and audio_sha256 is null
                    and mime_type is null
                    and byte_size is null
                    and duration_ms is null)
            ),
            check (
                (status = 'failed'
                    and error_code is not null
                    and finished_at is not null)
                or (status != 'failed' and error_code is null)
            ),
            check (
                (status in ('pending', 'publishing') and finished_at is null)
                or (status in ('ready', 'failed') and finished_at is not null)
            )
        )
        """
    )
    conn.execute(
        """
        create index idx_narrations_status_updated
        on narrations(status, updated_at, id)
        """
    )
    conn.execute(
        """
        create index idx_narrations_requester_created
        on narrations(requested_by_key_id, created_at)
        """
    )
    conn.execute(
        """
        create table narration_watchers (
            narration_id integer not null references narrations(id) on delete cascade,
            api_key_id integer not null references api_keys(id),
            created_at text not null,
            primary key (narration_id, api_key_id)
        )
        """
    )
    conn.execute(
        """
        create index idx_narration_watchers_key
        on narration_watchers(api_key_id, narration_id)
        """
    )
    conn.execute(
        """
        create table narration_cleanup_jobs (
            service_job_id text primary key,
            audio_filename text null unique check (
                audio_filename is null or (
                    length(audio_filename) between 1 and 255
                    and instr(audio_filename, '/') = 0
                    and instr(audio_filename, char(92)) = 0
                    and audio_filename not in ('.', '..')
                )
            ),
            attempt_count integer not null default 0 check (attempt_count >= 0),
            next_attempt_at text not null,
            created_at text not null
        )
        """
    )
    conn.execute(
        """
        create index idx_narration_cleanup_due
        on narration_cleanup_jobs(next_attempt_at, service_job_id)
        """
    )
    conn.execute(
        """
        create trigger enqueue_narration_cleanup_before_delete
        before delete on narrations
        begin
            insert into narration_cleanup_jobs(
                service_job_id, audio_filename, attempt_count,
                next_attempt_at, created_at
            ) values (
                old.service_job_id, old.audio_filename, 0,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
            on conflict(service_job_id) do nothing;
        end
        """
    )

    for row in retained.values():
        conn.execute(
            """
            insert into narrations(
                id, gist_revision_id, requested_by_key_id, service_job_id,
                text_sha256, status, retry_count, publish_started_at,
                engine_fingerprint, audio_filename, audio_sha256, mime_type,
                byte_size, duration_ms, error_code, created_at, updated_at,
                finished_at
            ) values (
                ?, ?, ?, ?, ?, 'ready', 0, null, ?, ?, ?, 'audio/mpeg',
                ?, ?, null, ?, ?, ?
            )
            """,
            (
                row["id"],
                row["gist_revision_id"],
                row["requested_by_key_id"],
                row["service_job_id"],
                row["text_sha256"],
                row["engine_fingerprint"],
                row["audio_filename"],
                row["audio_sha256"],
                row["byte_size"],
                row["duration_ms"],
                row["created_at"],
                row["updated_at"],
                row["finished_at"],
            ),
        )

    for watcher in watcher_rows:
        narration = retained.get(watcher["gist_revision_id"])
        if narration is not None:
            conn.execute(
                """
                insert into narration_watchers(narration_id, api_key_id, created_at)
                values (?, ?, ?)
                on conflict(narration_id, api_key_id) do nothing
                """,
                (narration["id"], watcher["api_key_id"], watcher["created_at"]),
            )

    if conn.execute("pragma foreign_key_check").fetchall():
        raise RuntimeError("shared narration service migration broke foreign keys")
