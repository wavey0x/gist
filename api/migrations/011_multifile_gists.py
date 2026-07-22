import hashlib
import json

from gist_api.gist_files import NormalizedFile, snapshot_sha256


EXPECTED_GISTS_COLUMNS = {
    "id",
    "external_id",
    "title",
    "author_name",
    "markdown",
    "rendered_html",
    "render_version",
    "content_sha256",
    "latest_revision_number",
    "created_at",
    "updated_at",
    "deleted_at",
}
EXPECTED_REVISIONS_COLUMNS = {
    "id",
    "gist_id",
    "revision_number",
    "title",
    "author_name",
    "markdown",
    "rendered_html",
    "render_version",
    "content_sha256",
    "created_at",
    "created_by_key_id",
}


def _columns(conn, table):
    return {row["name"] for row in conn.execute(f"pragma table_info({table})")}


def _count(conn, table):
    return conn.execute(f"select count(*) as value from {table}").fetchone()["value"]


def _assert_equal_sets(conn, left_sql, right_sql, message):
    left_only = conn.execute(
        f"select exists(select 1 from ({left_sql} except {right_sql})) as value"
    ).fetchone()["value"]
    right_only = conn.execute(
        f"select exists(select 1 from ({right_sql} except {left_sql})) as value"
    ).fetchone()["value"]
    if left_only or right_only:
        raise RuntimeError(message)


def _table_fingerprint(conn, table):
    schema = conn.execute(
        "select sql from sqlite_master where type = 'table' and name = ?",
        (table,),
    ).fetchone()["sql"]
    columns = [row["name"] for row in conn.execute(f"pragma table_info({table})")]
    digest = hashlib.sha256()
    digest.update(
        json.dumps({"schema": schema, "columns": columns}).encode("utf-8")
    )
    for row in conn.execute(f"select * from {table} order by rowid"):
        values = []
        for value in row:
            if isinstance(value, bytes):
                values.append({"bytes_sha256": hashlib.sha256(value).hexdigest()})
            else:
                values.append(value)
        digest.update(
            json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
    return digest.hexdigest()


def _verify_source_latest_rows(conn):
    mismatches = conn.execute(
        """
        select count(*) as value
        from gists g
        left join gist_revisions r
          on r.gist_id = g.id and r.revision_number = g.latest_revision_number
        where r.id is null
           or not (g.title is r.title)
           or g.author_name != r.author_name
           or g.markdown != r.markdown
           or g.rendered_html != r.rendered_html
           or g.render_version != r.render_version
           or g.content_sha256 != r.content_sha256
        """
    ).fetchone()["value"]
    if mismatches:
        raise RuntimeError("legacy latest gist rows do not match revision history")


def _create_temporary_snapshots(conn):
    conn.execute(
        """
        create temp table _mf_gists (
            id integer primary key,
            external_id text not null,
            owner_key_id integer not null,
            latest_revision_number integer not null,
            created_at text not null,
            updated_at text not null,
            deleted_at text null
        )
        """
    )
    conn.execute(
        """
        insert into _mf_gists
        select
            g.id,
            g.external_id,
            owner.created_by_key_id,
            g.latest_revision_number,
            g.created_at,
            g.updated_at,
            g.deleted_at
        from gists g
        join gist_revisions owner
          on owner.gist_id = g.id and owner.revision_number = 1
        """
    )
    if _count(conn, "_mf_gists") != _count(conn, "gists"):
        raise RuntimeError("every gist must have exactly one revision 1 owner")

    conn.execute(
        """
        create temp table _mf_revisions (
            id integer primary key,
            gist_id integer not null,
            revision_number integer not null,
            title text null,
            author_name text not null,
            snapshot_sha256 text not null,
            created_at text not null,
            created_by_key_id integer not null
        )
        """
    )
    conn.execute(
        """
        create temp table _mf_files (
            gist_revision_id integer not null,
            filename text not null,
            content text not null,
            rendered_html text not null,
            render_version text not null,
            content_sha256 text not null,
            byte_size integer not null
        )
        """
    )

    revision_rows = conn.execute(
        """
        select
            id, gist_id, revision_number, title, author_name, markdown,
            rendered_html, render_version, content_sha256, created_at,
            created_by_key_id
        from gist_revisions
        order by id
        """
    ).fetchall()
    for row in revision_rows:
        encoded = row["markdown"].encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        if digest != row["content_sha256"]:
            raise RuntimeError(f"revision {row['id']} has an invalid content hash")
        legacy_file = NormalizedFile(
            filename="README.md",
            content=row["markdown"],
            content_sha256=digest,
            byte_size=len(encoded),
        )
        revision_digest = snapshot_sha256(
            row["title"],
            {"README.md": legacy_file},
        )
        conn.execute(
            """
            insert into _mf_revisions(
                id, gist_id, revision_number, title, author_name,
                snapshot_sha256, created_at, created_by_key_id
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["gist_id"],
                row["revision_number"],
                row["title"],
                row["author_name"],
                revision_digest,
                row["created_at"],
                row["created_by_key_id"],
            ),
        )
        conn.execute(
            """
            insert into _mf_files(
                gist_revision_id, filename, content, rendered_html,
                render_version, content_sha256, byte_size
            ) values (?, 'README.md', ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["markdown"],
                row["rendered_html"],
                row["render_version"],
                digest,
                len(encoded),
            ),
        )

    conn.execute(
        """
        create temp table _mf_push_deliveries as
        select * from push_deliveries
        """
    )


def _replace_tables(conn):
    conn.execute("drop table push_deliveries")
    conn.execute("drop table gist_revisions")
    conn.execute("drop table gists")

    conn.execute(
        """
        create table gists (
            id integer primary key,
            external_id text not null unique,
            owner_key_id integer not null references api_keys(id),
            latest_revision_number integer not null,
            created_at text not null,
            updated_at text not null,
            deleted_at text null
        )
        """
    )
    conn.execute(
        """
        create table gist_revisions (
            id integer primary key,
            gist_id integer not null references gists(id),
            revision_number integer not null,
            title text null,
            author_name text not null,
            snapshot_sha256 text not null,
            created_at text not null,
            created_by_key_id integer not null references api_keys(id)
        )
        """
    )
    conn.execute(
        """
        create table gist_revision_files (
            id integer primary key,
            gist_revision_id integer not null
                references gist_revisions(id) on delete cascade,
            filename text not null,
            content text not null,
            rendered_html text not null,
            render_version text not null,
            content_sha256 text not null,
            byte_size integer not null check (byte_size >= 0),
            unique (gist_revision_id, filename)
        )
        """
    )
    conn.execute(
        """
        create table push_deliveries (
            id integer primary key,
            subscription_id integer not null
                references push_subscriptions(id) on delete cascade,
            event_type text not null
                check (event_type in ('gist.published', 'gist.updated')),
            gist_revision_id integer not null references gist_revisions(id),
            status text not null default 'pending'
                check (status in ('pending', 'delivered', 'dead')),
            attempt_count integer not null default 0
                check (attempt_count >= 0),
            next_attempt_at text not null,
            last_result text null,
            created_at text not null,
            completed_at text null,
            unique (subscription_id, event_type, gist_revision_id),
            check (
                (status = 'pending' and completed_at is null)
                or
                (status in ('delivered', 'dead') and completed_at is not null)
            )
        )
        """
    )

    conn.execute("insert into gists select * from _mf_gists")
    conn.execute("insert into gist_revisions select * from _mf_revisions")
    conn.execute(
        """
        insert into gist_revision_files(
            gist_revision_id, filename, content, rendered_html,
            render_version, content_sha256, byte_size
        )
        select
            gist_revision_id, filename, content, rendered_html,
            render_version, content_sha256, byte_size
        from _mf_files
        """
    )
    conn.execute("insert into push_deliveries select * from _mf_push_deliveries")

    conn.execute(
        "create index idx_gists_owner_created on gists(owner_key_id, created_at desc, id desc)"
    )
    conn.execute(
        "create index idx_gist_revisions_gist_id on gist_revisions(gist_id)"
    )
    conn.execute(
        "create unique index idx_gist_revisions_gist_id_revision_number "
        "on gist_revisions(gist_id, revision_number)"
    )
    conn.execute(
        "create index idx_gist_revisions_creator_revision "
        "on gist_revisions(created_by_key_id, revision_number, gist_id)"
    )
    conn.execute(
        "create index idx_gist_revision_files_revision "
        "on gist_revision_files(gist_revision_id)"
    )
    conn.execute(
        "create index idx_push_deliveries_due on push_deliveries(next_attempt_at, id) "
        "where status = 'pending'"
    )


def _verify(conn, before_counts):
    if _count(conn, "gists") != before_counts["gists"]:
        raise RuntimeError("gist row count changed")
    if _count(conn, "gist_revisions") != before_counts["gist_revisions"]:
        raise RuntimeError("revision row count changed")
    if _count(conn, "gist_revision_files") != before_counts["gist_revisions"]:
        raise RuntimeError("legacy revisions did not map one-to-one to files")
    if _count(conn, "push_deliveries") != before_counts["push_deliveries"]:
        raise RuntimeError("push delivery row count changed")

    _assert_equal_sets(
        conn,
        "select id, external_id, owner_key_id, latest_revision_number, created_at, updated_at, deleted_at from gists",
        "select id, external_id, owner_key_id, latest_revision_number, created_at, updated_at, deleted_at from _mf_gists",
        "gist metadata changed",
    )
    _assert_equal_sets(
        conn,
        "select id, gist_id, revision_number, title, author_name, snapshot_sha256, created_at, created_by_key_id from gist_revisions",
        "select id, gist_id, revision_number, title, author_name, snapshot_sha256, created_at, created_by_key_id from _mf_revisions",
        "revision metadata changed",
    )
    _assert_equal_sets(
        conn,
        "select gist_revision_id, filename, content, rendered_html, render_version, content_sha256, byte_size from gist_revision_files",
        "select gist_revision_id, filename, content, rendered_html, render_version, content_sha256, byte_size from _mf_files",
        "revision file data changed",
    )
    _assert_equal_sets(
        conn,
        "select * from push_deliveries",
        "select * from _mf_push_deliveries",
        "push delivery data changed",
    )

    invalid_latest = conn.execute(
        """
        select count(*) as value
        from gists g
        left join gist_revisions r
          on r.gist_id = g.id
         and r.revision_number = g.latest_revision_number
        where r.id is null
        """
    ).fetchone()["value"]
    if invalid_latest:
        raise RuntimeError("latest revision pointer is invalid")

    invalid_sequences = conn.execute(
        """
        select count(*) as value
        from (
            select gist_id
            from gist_revisions
            group by gist_id
            having min(revision_number) != 1
                or max(revision_number) != count(*)
        )
        """
    ).fetchone()["value"]
    if invalid_sequences:
        raise RuntimeError("revision sequence is invalid")

    for row in conn.execute(
        """
        select r.id, r.title, r.snapshot_sha256, f.content,
               f.content_sha256, f.byte_size
        from gist_revisions r
        join gist_revision_files f on f.gist_revision_id = r.id
        order by r.id
        """
    ):
        encoded = row["content"].encode("utf-8")
        if len(encoded) != row["byte_size"]:
            raise RuntimeError(f"revision {row['id']} byte size changed")
        digest = hashlib.sha256(encoded).hexdigest()
        if digest != row["content_sha256"]:
            raise RuntimeError(f"revision {row['id']} content hash changed")
        legacy_file = NormalizedFile(
            filename="README.md",
            content=row["content"],
            content_sha256=digest,
            byte_size=len(encoded),
        )
        if snapshot_sha256(row["title"], {"README.md": legacy_file}) != row[
            "snapshot_sha256"
        ]:
            raise RuntimeError(f"revision {row['id']} snapshot hash is invalid")

    foreign_key_errors = conn.execute("pragma foreign_key_check").fetchall()
    if foreign_key_errors:
        raise RuntimeError("foreign key check failed")
    integrity = conn.execute("pragma integrity_check").fetchall()
    if [row[0] for row in integrity] != ["ok"]:
        raise RuntimeError("integrity check failed")


def upgrade(conn):
    if _columns(conn, "gists") != EXPECTED_GISTS_COLUMNS:
        raise RuntimeError("unexpected source gists schema")
    if _columns(conn, "gist_revisions") != EXPECTED_REVISIONS_COLUMNS:
        raise RuntimeError("unexpected source gist_revisions schema")
    if _columns(conn, "push_deliveries") == set():
        raise RuntimeError("push delivery schema is missing")

    all_tables = {
        row["name"]
        for row in conn.execute(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
        )
    }
    _verify_source_latest_rows(conn)
    before_counts = {table: _count(conn, table) for table in all_tables}
    changed_tables = {"gists", "gist_revisions", "push_deliveries"}
    before_fingerprints = {
        table: _table_fingerprint(conn, table)
        for table in all_tables
        if table not in changed_tables
    }

    _create_temporary_snapshots(conn)
    _replace_tables(conn)
    _verify(conn, before_counts)

    for table, expected_count in before_counts.items():
        if table in changed_tables:
            continue
        if _count(conn, table) != expected_count:
            raise RuntimeError(f"unaffected table row count changed: {table}")
        if _table_fingerprint(conn, table) != before_fingerprints[table]:
            raise RuntimeError(f"unaffected table data changed: {table}")

    conn.execute("drop table _mf_push_deliveries")
    conn.execute("drop table _mf_files")
    conn.execute("drop table _mf_revisions")
    conn.execute("drop table _mf_gists")
