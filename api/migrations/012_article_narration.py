def _count(conn, table):
    return conn.execute(f"select count(*) from {table}").fetchone()[0]


def upgrade(conn):
    delivery_count = _count(conn, "push_deliveries")

    conn.execute(
        """
        alter table api_keys
        add column audio_generation_daily_limit integer null default 3
            check (
                audio_generation_daily_limit is null
                or audio_generation_daily_limit >= 0
            )
        """
    )

    conn.execute(
        """
        create table narrations (
            id integer primary key,
            gist_revision_id integer not null
                references gist_revisions(id) on delete cascade,
            requested_by_key_id integer not null references api_keys(id),
            recipe_version text not null,
            source_render_version text not null,
            text_sha256 text not null
                check (length(text_sha256) = 64),
            status text not null default 'pending'
                check (status in ('pending', 'processing', 'ready', 'failed')),
            attempt_count integer not null default 0
                check (attempt_count between 0 and 2),
            audio_filename text null
                check (
                    audio_filename is null
                    or (
                        length(audio_filename) between 1 and 255
                        and instr(audio_filename, '/') = 0
                        and instr(audio_filename, char(92)) = 0
                        and audio_filename not in ('.', '..')
                    )
                ),
            mime_type text null
                check (mime_type is null or mime_type = 'audio/mpeg'),
            byte_size integer null
                check (byte_size is null or byte_size > 0),
            duration_ms integer null
                check (duration_ms is null or duration_ms > 0),
            error_code text null,
            created_at text not null,
            updated_at text not null,
            started_at text null,
            finished_at text null,
            unique (gist_revision_id, source_render_version, recipe_version),
            check (
                (
                    status = 'ready'
                    and audio_filename is not null
                    and mime_type = 'audio/mpeg'
                    and byte_size is not null
                    and duration_ms is not null
                    and error_code is null
                    and finished_at is not null
                )
                or
                (
                    status != 'ready'
                    and audio_filename is null
                    and mime_type is null
                    and byte_size is null
                    and duration_ms is null
                )
            )
        )
        """
    )
    conn.execute(
        """
        create index idx_narrations_status_created
        on narrations(status, created_at, id)
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
            narration_id integer not null
                references narrations(id) on delete cascade,
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

    conn.execute("alter table push_deliveries rename to _audio_old_push_deliveries")
    conn.execute(
        """
        create table push_deliveries (
            id integer primary key,
            subscription_id integer not null
                references push_subscriptions(id) on delete cascade,
            event_type text not null
                check (
                    event_type in (
                        'gist.published', 'gist.updated', 'narration.ready'
                    )
                ),
            gist_revision_id integer not null
                references gist_revisions(id) on delete cascade,
            narration_id integer null
                references narrations(id) on delete cascade,
            status text not null default 'pending'
                check (status in ('pending', 'delivered', 'dead')),
            attempt_count integer not null default 0
                check (attempt_count >= 0),
            next_attempt_at text not null,
            last_result text null,
            created_at text not null,
            completed_at text null,
            check (
                (
                    event_type in ('gist.published', 'gist.updated')
                    and narration_id is null
                )
                or
                (event_type = 'narration.ready' and narration_id is not null)
            ),
            check (
                (status = 'pending' and completed_at is null)
                or
                (status in ('delivered', 'dead') and completed_at is not null)
            )
        )
        """
    )
    conn.execute(
        """
        insert into push_deliveries(
            id, subscription_id, event_type, gist_revision_id, narration_id,
            status, attempt_count, next_attempt_at, last_result,
            created_at, completed_at
        )
        select
            id, subscription_id, event_type, gist_revision_id, null,
            status, attempt_count, next_attempt_at, last_result,
            created_at, completed_at
        from _audio_old_push_deliveries
        """
    )
    conn.execute("drop table _audio_old_push_deliveries")
    conn.execute(
        """
        create unique index idx_push_deliveries_gist_event
        on push_deliveries(subscription_id, event_type, gist_revision_id)
        where narration_id is null
        """
    )
    conn.execute(
        """
        create unique index idx_push_deliveries_narration_event
        on push_deliveries(subscription_id, event_type, narration_id)
        where narration_id is not null
        """
    )
    conn.execute(
        """
        create index idx_push_deliveries_due
        on push_deliveries(next_attempt_at, id)
        where status = 'pending'
        """
    )

    if _count(conn, "push_deliveries") != delivery_count:
        raise RuntimeError("push delivery row count changed")
    if conn.execute("pragma foreign_key_check").fetchall():
        raise RuntimeError("article narration migration broke foreign keys")
