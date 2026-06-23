import stat

from gist_api.app import create_app


def test_sqlite_database_file_is_owner_only(tmp_path):
    db_path = tmp_path / "private.sqlite3"

    create_app(
        {
            "SQLITE_DB_PATH": str(db_path),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "PUBLIC_API_BASE_URL": "https://api.example.com",
        }
    )

    assert stat.S_IMODE(db_path.stat().st_mode) == 0o600
