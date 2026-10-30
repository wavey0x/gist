def _row_dicts(rows):
    return [dict(row) for row in rows]


def _insert_rows(conn, table, rows):
    if not rows:
        return
    columns = tuple(rows[0])
    placeholders = ", ".join("?" for _ in columns)
    names = ", ".join(columns)
    conn.executemany(
        f"insert into {table}({names}) values ({placeholders})",
        [tuple(row[column] for column in columns) for row in rows],
    )


def upgrade(conn):
    narrations = _row_dicts(conn.execute("select * from narrations").fetchall())
    watchers = _row_dicts(conn.execute("select * from narration_watchers").fetchall())
    deliveries = _row_dicts(
        conn.execute(
            "select * from push_deliveries where narration_id is not null"
        ).fetchall()
    )
    cleanup_rows = _row_dicts(
        conn.execute(
            """
            select service_job_id, attempt_count, next_attempt_at, created_at
            from narration_cleanup_jobs
            """
        ).fetchall()
    )

    conn.execute("drop trigger enqueue_narration_cleanup_before_delete")
    conn.execute("drop table narration_cleanup_jobs")
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
                check (status in ('pending', 'ready', 'failed')),
            retry_count integer not null default 0 check (retry_count in (0, 1)),
            engine_fingerprint text null,
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
                (status = 'ready'
                    and engine_fingerprint is not null
                    and audio_sha256 is not null
                    and mime_type = 'audio/mpeg'
                    and byte_size is not null
                    and duration_ms is not null
                    and error_code is null
                    and finished_at is not null)
                or
                (status != 'ready'
                    and engine_fingerprint is null
                    and audio_sha256 is null
                    and mime_type is null
                    and byte_size is null
                    and duration_ms is null)
            ),
            check (
                (status = 'failed' and error_code is not null and finished_at is not null)
                or (status != 'failed' and error_code is null)
            ),
            check (
                (status = 'pending' and finished_at is null)
                or (status in ('ready', 'failed') and finished_at is not null)
            )
        )
        """
    )
    conn.execute(
        "create index idx_narrations_status_updated on narrations(status, updated_at, id)"
    )
    conn.execute(
        """
        create index idx_narrations_requester_created
        on narrations(requested_by_key_id, created_at)
        """
    )
    conn.execute(
        """
        create table narration_cleanup_jobs (
            service_job_id text primary key,
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
                service_job_id, attempt_count, next_attempt_at, created_at
            ) values (
                old.service_job_id, 0,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
            on conflict(service_job_id) do nothing;
        end
        """
    )

    clean_narrations = []
    for row in narrations:
        clean = {
            key: value
            for key, value in row.items()
            if key not in {"audio_filename", "publish_started_at"}
        }
        if clean["status"] == "publishing":
            clean["status"] = "pending"
        clean_narrations.append(clean)
    _insert_rows(conn, "narrations", clean_narrations)
    _insert_rows(conn, "narration_watchers", watchers)
    _insert_rows(conn, "push_deliveries", deliveries)
    _insert_rows(conn, "narration_cleanup_jobs", cleanup_rows)

    if conn.execute("pragma foreign_key_check").fetchall():
        raise RuntimeError("service-owned audio migration broke foreign keys")
