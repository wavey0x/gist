import importlib
import sqlite3

from gist_api.app import create_app
from gist_api.db import gist_connection
from gist_api import migrations as migration_module


def test_fresh_database_records_all_known_migration_slots(tmp_path):
    app = create_app(
        {
            "SQLITE_DB_PATH": str(tmp_path / "fresh.sqlite3"),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
        }
    )

    with gist_connection(app) as conn:
        versions = [
            row["version"]
            for row in conn.execute(
                "select version from gist_schema_migrations order by version"
            )
        ]

    assert versions == [1, 2, 3]


def test_existing_production_schema_history_migrates_forward_without_reset(tmp_path):
    db_path = tmp_path / "existing.sqlite3"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        create table gist_schema_migrations (
            version integer primary key,
            applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        insert into gist_schema_migrations(version) values (1);
        insert into gist_schema_migrations(version) values (2);

        create table api_keys (
            id integer primary key,
            domain text not null,
            name text not null,
            key_hash text not null,
            key_prefix text not null unique,
            scopes_json text not null,
            created_at text not null,
            last_used_at text null,
            revoked_at text null
        );

        create table gists (
            id integer primary key,
            external_id text not null unique,
            title text null,
            author_name text not null,
            markdown text not null,
            rendered_html text not null,
            render_version text not null,
            content_sha256 text not null,
            latest_revision_number integer not null,
            created_at text not null,
            updated_at text not null,
            deleted_at text null
        );

        create table gist_revisions (
            id integer primary key,
            gist_id integer not null references gists(id),
            revision_number integer not null,
            title text null,
            author_name text not null,
            markdown text not null,
            rendered_html text not null,
            render_version text not null,
            content_sha256 text not null,
            created_at text not null,
            created_by_key_id integer not null references api_keys(id)
        );

        insert into api_keys(
            id, domain, name, key_hash, key_prefix, scopes_json, created_at
        )
        values (
            1, 'gist', 'existing', 'redacted', 'wapi_gist_existing', '["gist:read"]', '2026-01-01T00:00:00.000Z'
        );
        insert into gists(
            id, external_id, title, author_name, markdown, rendered_html,
            render_version, content_sha256, latest_revision_number, created_at, updated_at
        )
        values (
            1, 'AAAAAAAAAAAAAAAA', null, 'existing', '# Existing', '<h1>Existing</h1>',
            'old', '0', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        insert into gist_revisions(
            gist_id, revision_number, title, author_name, markdown, rendered_html,
            render_version, content_sha256, created_at, created_by_key_id
        )
        values (
            1, 1, null, 'existing', '# Existing', '<h1>Existing</h1>',
            'old', '0', '2026-01-01T00:00:00.000Z', 1
        );
        """
    )
    conn.commit()
    conn.close()

    app = create_app(
        {
            "SQLITE_DB_PATH": str(db_path),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
        }
    )

    with gist_connection(app) as migrated:
        versions = [
            row["version"]
            for row in migrated.execute(
                "select version from gist_schema_migrations order by version"
            )
        ]
        existing = migrated.execute(
            "select external_id, markdown from gists where external_id = 'AAAAAAAAAAAAAAAA'"
        ).fetchone()
        write_table = migrated.execute(
            """
            select name
            from sqlite_master
            where type = 'table' and name = 'api_write_events'
            """
        ).fetchone()

    assert versions == [1, 2, 3]
    assert dict(existing) == {
        "external_id": "AAAAAAAAAAAAAAAA",
        "markdown": "# Existing",
    }
    assert write_table["name"] == "api_write_events"


def test_migrations_ignore_current_working_directory(monkeypatch, tmp_path):
    cwd_migrations = tmp_path / "migrations"
    cwd_migrations.mkdir()
    (cwd_migrations / "999_bad.sql").write_text(
        "create table should_not_run(id integer primary key);",
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    reloaded = importlib.reload(migration_module)

    assert reloaded.MIGRATIONS_DIR == reloaded.SOURCE_MIGRATIONS_DIR
