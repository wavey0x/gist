import importlib
import sqlite3
from pathlib import Path

from gist_api.app import create_app
from gist_api.db import gist_connection
from gist_api import migrations as migration_module


def test_fresh_database_uses_current_schema_baseline(tmp_path):
    app = create_app(
        {
            "SQLITE_DB_PATH": str(tmp_path / "fresh.sqlite3"),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "PUBLIC_API_BASE_URL": "https://api.example.com",
        }
    )

    with gist_connection(app) as conn:
        versions = [
            row["version"]
            for row in conn.execute(
                "select version from gist_schema_migrations order by version"
            )
        ]
        api_key_columns = [
            row["name"]
            for row in conn.execute("select name from pragma_table_info('api_keys')")
        ]
        tables = {
            row["name"]
            for row in conn.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        indexes = {
            row["name"]
            for row in conn.execute(
                "select name from sqlite_master where type = 'index'"
            )
        }

    assert versions == [1, 8, 9, 10]
    assert api_key_columns == [
        "id",
        "name",
        "github_login",
        "key_value",
        "key_prefix",
        "created_at",
        "last_used_at",
        "revoked_at",
        "avatar_url",
    ]
    assert "web_sessions" in tables
    assert "api_write_events" in tables
    assert "api_auth_failure_events" in tables
    assert "image_blobs" in tables
    assert "image_assets" in tables
    assert "notification_settings" in tables
    assert "push_subscriptions" in tables
    assert "push_deliveries" in tables
    assert "idx_gist_revisions_creator_revision" in indexes
    assert "idx_image_assets_public_id" in indexes
    assert "idx_push_subscriptions_api_key" in indexes
    assert "idx_push_deliveries_due" in indexes


def test_migrations_ignore_current_working_directory(monkeypatch, tmp_path):
    cwd_migrations = tmp_path / "migrations"
    cwd_migrations.mkdir()
    (cwd_migrations / "999_bad.sql").write_text(
        "create table should_not_run(id integer primary key);",
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    reloaded = importlib.reload(migration_module)

    assert reloaded.MIGRATIONS_DIR.name == "migrations"
    assert reloaded.MIGRATIONS_DIR.parent.name == "api"


def test_existing_migration_ledger_is_not_replayed(monkeypatch, tmp_path):
    database_path = tmp_path / "existing.sqlite3"
    config = {
        "SQLITE_DB_PATH": str(database_path),
        "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
        "PUBLIC_API_BASE_URL": "https://api.example.com",
    }
    app = create_app(config)
    with gist_connection(app) as conn:
        assert conn.execute(
            "select 1 from gist_schema_migrations where version = 1"
        ).fetchone()

    replacement_migrations = tmp_path / "replacement-migrations"
    replacement_migrations.mkdir()
    (replacement_migrations / "001_initial.sql").write_text(
        "create table should_not_run(id integer primary key);",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        migration_module,
        "MIGRATIONS_DIR",
        replacement_migrations,
    )

    reopened = create_app(config)
    with gist_connection(reopened) as conn:
        assert (
            conn.execute(
                """
                select name
                from sqlite_master
                where type = 'table' and name = 'should_not_run'
                """
            ).fetchone()
            is None
        )


def test_migration_10_seeds_existing_api_keys(tmp_path):
    database_path = tmp_path / "upgrade.sqlite3"
    migrations_dir = Path(__file__).resolve().parents[1] / "migrations"
    conn = sqlite3.connect(database_path)
    conn.execute(
        """
        create table gist_schema_migrations (
            version integer primary key,
            applied_at text not null default (
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
        )
        """
    )
    for version, filename in (
        (1, "001_init.sql"),
        (8, "008_api_key_avatar_url.sql"),
        (9, "009_image_assets.sql"),
    ):
        conn.executescript((migrations_dir / filename).read_text("utf-8"))
        conn.execute(
            """
            insert into gist_schema_migrations(version, applied_at)
            values (?, '2026-07-19T00:00:00.000Z')
            """,
            (version,),
        )
    conn.execute(
        """
        insert into api_keys(
            name, key_value, key_prefix, created_at
        )
        values (
            'existing',
            'not-a-real-key',
            'test-prefix',
            '2026-07-19T00:00:00.000Z'
        )
        """
    )
    conn.commit()
    conn.close()

    app = create_app(
        {
            "SQLITE_DB_PATH": str(database_path),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "PUBLIC_API_BASE_URL": "https://api.example.com",
        }
    )
    with gist_connection(app) as migrated:
        settings = migrated.execute(
            """
            select new_gist_enabled, edited_gist_enabled
            from notification_settings
            """
        ).fetchone()
        version = migrated.execute(
            """
            select version
            from gist_schema_migrations
            order by version desc
            limit 1
            """
        ).fetchone()["version"]

    assert dict(settings) == {
        "new_gist_enabled": 1,
        "edited_gist_enabled": 0,
    }
    assert version == 10
