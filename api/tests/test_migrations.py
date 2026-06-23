import importlib

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

    assert versions == [1, 8, 9]
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
    assert "idx_gist_revisions_creator_revision" in indexes
    assert "idx_image_assets_public_id" in indexes


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
