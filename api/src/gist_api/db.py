import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


logger = logging.getLogger(__name__)


def get_gist_db_path(app=None):
    if app is not None:
        value = app.config.get("SQLITE_DB_PATH")
        if value:
            return value

    value = os.getenv("SQLITE_DB_PATH")
    if value:
        return value

    raise RuntimeError("SQLITE_DB_PATH must be set")


def _set_private_file_permissions(db_path):
    if db_path == ":memory:":
        return

    db_file = Path(db_path)
    for path in (db_file, Path(f"{db_path}-wal"), Path(f"{db_path}-shm")):
        try:
            if path.exists() and path.is_file():
                path.chmod(0o600)
        except OSError as exc:
            logger.warning(
                "Could not tighten SQLite file permissions",
                extra={"path": str(path), "error_type": type(exc).__name__},
            )


def _connect(db_path, busy_timeout_ms=5000):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    conn.execute(f"pragma busy_timeout = {int(busy_timeout_ms)}")
    if db_path != ":memory:":
        conn.execute("pragma journal_mode = wal")
        _set_private_file_permissions(db_path)
    return conn


@contextmanager
def gist_connection(app=None):
    db_path = get_gist_db_path(app)
    busy_timeout_ms = 5000
    if app is not None:
        busy_timeout_ms = app.config.get("SQLITE_BUSY_TIMEOUT_MS", 5000)

    conn = _connect(db_path, busy_timeout_ms)
    try:
        yield conn
    finally:
        conn.close()
