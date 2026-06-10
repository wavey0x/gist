import importlib
import json
import sqlite3

from gist_api.app import create_app
from gist_api.auth import verify_api_key
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

    assert versions == [1, 2, 3, 4, 5, 6]


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
            1, 'gist', 'wavey', 'redacted', 'wapi_gist_existing', '["gist:read","gist:write"]', '2026-01-01T00:00:00.000Z'
        );
        insert into gists(
            id, external_id, title, author_name, markdown, rendered_html,
            render_version, content_sha256, latest_revision_number, created_at, updated_at
        )
        values (
            1, 'AAAAAAAAAAAAAAAA', null, 'wavey', '# Existing', '<h1>Existing</h1>',
            'old', '0', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        insert into gist_revisions(
            gist_id, revision_number, title, author_name, markdown, rendered_html,
            render_version, content_sha256, created_at, created_by_key_id
        )
        values (
            1, 1, null, 'wavey', '# Existing', '<h1>Existing</h1>',
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
            """
            select external_id, markdown, author_name
            from gists
            where external_id = 'AAAAAAAAAAAAAAAA'
            """
        ).fetchone()
        existing_key = migrated.execute(
            """
            select name, github_login, key_value, scopes_json
            from api_keys
            where id = 1
            """
        ).fetchone()
        api_key_columns = {
            row["name"]
            for row in migrated.execute("select name from pragma_table_info('api_keys')")
        }
        existing_revision = migrated.execute(
            """
            select author_name
            from gist_revisions
            where gist_id = 1 and revision_number = 1
            """
        ).fetchone()
        write_table = migrated.execute(
            """
            select name
            from sqlite_master
            where type = 'table' and name = 'api_write_events'
            """
        ).fetchone()
        session_table = migrated.execute(
            """
            select name
            from sqlite_master
            where type = 'table' and name = 'web_sessions'
            """
        ).fetchone()
        github_login_column = migrated.execute(
            """
            select name
            from pragma_table_info('api_keys')
            where name = 'github_login'
            """
        ).fetchone()
        auth, auth_error = verify_api_key(
            migrated,
            f"Bearer wapi_gist_existing_{'A' * 43}",
            "gist",
            "gist:read",
        )
        ownership_index = migrated.execute(
            """
            select name
            from sqlite_master
            where type = 'index'
              and name = 'idx_gist_revisions_creator_revision'
            """
        ).fetchone()

    assert versions == [1, 2, 3, 4, 5, 6]
    assert dict(existing) == {
        "external_id": "AAAAAAAAAAAAAAAA",
        "markdown": "# Existing",
        "author_name": "wavey0x",
    }
    assert dict(existing_key) == {
        "name": "wavey0x",
        "github_login": "wavey0x",
        "key_value": existing_key["key_value"],
        "scopes_json": '["gist:read","gist:write","gist:delete"]',
    }
    assert existing_key["key_value"].startswith("migrated_unusable_1_")
    assert "key_value" in api_key_columns
    assert "key_hash" not in api_key_columns
    assert auth is None
    assert auth_error == "unauthorized"
    assert existing_revision["author_name"] == "wavey0x"
    assert write_table["name"] == "api_write_events"
    assert session_table["name"] == "web_sessions"
    assert github_login_column["name"] == "github_login"
    assert ownership_index["name"] == "idx_gist_revisions_creator_revision"


def test_scope_migration_standardizes_existing_gist_keys_only(tmp_path):
    db_path = tmp_path / "scopes.sqlite3"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        create table gist_schema_migrations (
            version integer primary key,
            applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        insert into gist_schema_migrations(version) values (1);
        insert into gist_schema_migrations(version) values (2);
        insert into gist_schema_migrations(version) values (3);
        insert into gist_schema_migrations(version) values (4);
        insert into gist_schema_migrations(version) values (5);

        create table api_keys (
            id integer primary key,
            domain text not null,
            name text not null,
            github_login text null,
            key_value text not null,
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

        create table web_sessions (
            id integer primary key,
            token_hash text not null unique,
            api_key_id integer not null references api_keys(id),
            created_at text not null,
            last_used_at text null,
            expires_at text not null,
            revoked_at text null
        );

        create table api_write_events (
            id integer primary key,
            key_prefix text not null,
            source_ip text not null,
            created_at text not null
        );

        create table api_auth_failure_events (
            id integer primary key,
            source_ip text not null,
            created_at text not null
        );

        insert into api_keys(
            id, domain, name, github_login, key_value, key_prefix,
            scopes_json, created_at
        )
        values
            (
                1,
                'gist',
                'writer',
                null,
                'wapi_gist_existing_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'wapi_gist_existing',
                '["gist:read","gist:write"]',
                '2026-01-01T00:00:00.000Z'
            ),
            (
                2,
                'prices',
                'reader',
                null,
                'wapi_prices_existing_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                'wapi_prices_existing',
                '["prices:read"]',
                '2026-01-01T00:00:00.000Z'
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
        rows = migrated.execute(
            "select domain, scopes_json from api_keys order by id"
        ).fetchall()

    assert [row["domain"] for row in rows] == ["gist", "prices"]
    assert json.loads(rows[0]["scopes_json"]) == [
        "gist:read",
        "gist:write",
        "gist:delete",
    ]
    assert json.loads(rows[1]["scopes_json"]) == ["prices:read"]


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
