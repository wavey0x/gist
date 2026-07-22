import importlib
import hashlib
import sqlite3
from pathlib import Path

import pytest

from gist_api.app import create_app
from gist_api.db import gist_connection
from gist_api import migrations as migration_module
from gist_api.gist_files import NormalizedFile, snapshot_sha256


def _apply_sql_migration(conn, migrations_dir, version, filename):
    conn.executescript((migrations_dir / filename).read_text("utf-8"))
    conn.execute(
        "insert into gist_schema_migrations(version, applied_at) values (?, ?)",
        (version, "2026-07-19T00:00:00.000Z"),
    )


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

    assert versions == [1, 8, 9, 10, 11]
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
    assert "gist_revision_files" in tables
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
    assert version == 11


def test_multifile_migration_preserves_all_legacy_history_and_references(tmp_path):
    database_path = tmp_path / "legacy.sqlite3"
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
        _apply_sql_migration(conn, migrations_dir, version, filename)

    conn.execute(
        """
        insert into api_keys(id, name, key_value, key_prefix, created_at)
        values (7, 'owner', 'secret-not-logged', 'prefix', ?)
        """,
        ("2026-07-19T00:00:00.000Z",),
    )
    contents = {10: "# First\r\n", 11: "# First\r\n", 20: "deleted\n"}
    digests = {
        revision_id: hashlib.sha256(content.encode("utf-8")).hexdigest()
        for revision_id, content in contents.items()
    }
    conn.executemany(
        """
        insert into gists(
            id, external_id, title, author_name, markdown, rendered_html,
            render_version, content_sha256, latest_revision_number,
            created_at, updated_at, deleted_at
        ) values (?, ?, ?, 'owner', ?, ?, 'render-v1', ?, ?, ?, ?, ?)
        """,
        [
            (
                1, "AbCdEf0123456789", "Second title", contents[11],
                "<h1>First</h1>\n", digests[11], 2,
                "2026-07-19T01:00:00.000Z", "2026-07-19T02:00:00.000Z", None,
            ),
            (
                2, "ZyXwVu9876543210", None, contents[20], "<p>deleted</p>\n",
                digests[20], 1, "2026-07-19T03:00:00.000Z",
                "2026-07-19T03:00:00.000Z", "2026-07-20T00:00:00.000Z",
            ),
        ],
    )
    conn.executemany(
        """
        insert into gist_revisions(
            id, gist_id, revision_number, title, author_name, markdown,
            rendered_html, render_version, content_sha256, created_at,
            created_by_key_id
        ) values (?, ?, ?, ?, 'owner', ?, ?, 'render-v1', ?, ?, 7)
        """,
        [
            (10, 1, 1, "First title", contents[10], "<h1>First</h1>\n", digests[10], "2026-07-19T01:00:00.000Z"),
            (11, 1, 2, "Second title", contents[11], "<h1>First</h1>\n", digests[11], "2026-07-19T02:00:00.000Z"),
            (20, 2, 1, None, contents[20], "<p>deleted</p>\n", digests[20], "2026-07-19T03:00:00.000Z"),
        ],
    )
    conn.execute(
        """
        insert into image_blobs(
            sha256, storage_path, mime_type, file_extension, byte_size,
            width, height, ref_count, created_at
        ) values ('blob', 'blob.png', 'image/png', '.png', 3, 1, 1, 1, ?)
        """,
        ("2026-07-19T00:00:00.000Z",),
    )
    conn.execute(
        """
        insert into image_assets(
            id, public_id, owner_key_id, sha256, original_filename, created_at
        ) values (5, 'img_public', 7, 'blob', 'chart.png', ?)
        """,
        ("2026-07-19T00:00:00.000Z",),
    )
    _apply_sql_migration(conn, migrations_dir, 10, "010_push_notifications.sql")
    conn.execute(
        """
        insert into push_subscriptions(
            id, api_key_id, endpoint, p256dh, auth, created_at, updated_at
        ) values (3, 7, 'https://push.example/sub', 'p256dh', 'auth', ?, ?)
        """,
        ("2026-07-19T00:00:00.000Z", "2026-07-19T00:00:00.000Z"),
    )
    conn.executemany(
        """
        insert into push_deliveries(
            id, subscription_id, event_type, gist_revision_id, status,
            attempt_count, next_attempt_at, last_result, created_at, completed_at
        ) values (?, 3, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (31, "gist.published", 10, "pending", 0, "2026-07-19T04:00:00.000Z", None, "2026-07-19T04:00:00.000Z", None),
            (32, "gist.updated", 11, "delivered", 1, "2026-07-19T04:00:00.000Z", "201", "2026-07-19T04:00:00.000Z", "2026-07-19T04:01:00.000Z"),
            (33, "gist.published", 20, "dead", 5, "2026-07-19T04:00:00.000Z", "410", "2026-07-19T04:00:00.000Z", "2026-07-19T04:02:00.000Z"),
        ],
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
        gist_rows = migrated.execute(
            "select * from gists order by id"
        ).fetchall()
        revision_rows = migrated.execute(
            "select * from gist_revisions order by id"
        ).fetchall()
        file_rows = migrated.execute(
            "select * from gist_revision_files order by gist_revision_id"
        ).fetchall()
        delivery_rows = migrated.execute(
            "select id, gist_revision_id, status from push_deliveries order by id"
        ).fetchall()
        old_gist_columns = {
            row["name"] for row in migrated.execute("pragma table_info(gists)")
        }
        old_revision_columns = {
            row["name"]
            for row in migrated.execute("pragma table_info(gist_revisions)")
        }
        temp_tables = migrated.execute(
            "select name from sqlite_temp_master where name like '_mf_%'"
        ).fetchall()
        assert migrated.execute("pragma foreign_key_check").fetchall() == []
        assert migrated.execute("pragma integrity_check").fetchone()[0] == "ok"
        assert migrated.execute("select count(*) from image_assets").fetchone()[0] == 1

    assert [(row["id"], row["owner_key_id"], row["deleted_at"]) for row in gist_rows] == [
        (1, 7, None),
        (2, 7, "2026-07-20T00:00:00.000Z"),
    ]
    assert [row["id"] for row in revision_rows] == [10, 11, 20]
    assert [row["filename"] for row in file_rows] == ["README.md"] * 3
    assert [row["content"] for row in file_rows] == [contents[10], contents[11], contents[20]]
    assert [row["id"] for row in delivery_rows] == [31, 32, 33]
    assert [row["gist_revision_id"] for row in delivery_rows] == [10, 11, 20]
    assert revision_rows[0]["snapshot_sha256"] != revision_rows[1]["snapshot_sha256"]
    for revision, file_row in zip(revision_rows, file_rows, strict=True):
        normalized = NormalizedFile(
            filename="README.md",
            content=file_row["content"],
            content_sha256=file_row["content_sha256"],
            byte_size=file_row["byte_size"],
        )
        assert revision["snapshot_sha256"] == snapshot_sha256(
            revision["title"], {"README.md": normalized}
        )
    assert "markdown" not in old_gist_columns
    assert "rendered_html" not in old_revision_columns
    assert temp_tables == []


def test_failed_python_migration_rolls_back_schema_and_ledger(monkeypatch, tmp_path):
    migrations_dir = tmp_path / "failing-migrations"
    migrations_dir.mkdir()
    (migrations_dir / "011_forced_failure.py").write_text(
        "def upgrade(conn):\n"
        "    conn.execute('create table should_roll_back(id integer)')\n"
        "    raise RuntimeError('forced migration failure')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(migration_module, "MIGRATIONS_DIR", migrations_dir)
    database_path = tmp_path / "failure.sqlite3"

    with pytest.raises(RuntimeError, match="forced migration failure"):
        create_app({"SQLITE_DB_PATH": str(database_path)})

    conn = sqlite3.connect(database_path)
    assert conn.execute(
        "select name from sqlite_master where name = 'should_roll_back'"
    ).fetchone() is None
    assert conn.execute(
        "select count(*) from gist_schema_migrations where version = 11"
    ).fetchone()[0] == 0
    conn.close()
