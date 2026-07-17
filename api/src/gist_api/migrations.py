import re
from contextlib import contextmanager
from pathlib import Path

from .db import get_gist_db_path, gist_connection

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is unavailable on Windows.
    fcntl = None


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION_RE = re.compile(r"^(\d{3})_[A-Za-z0-9_]+\.sql$")


@contextmanager
def _init_lock(db_path):
    if db_path == ":memory:" or fcntl is None:
        yield
        return

    lock_path = f"{db_path}.init.lock"
    with open(lock_path, "w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _read_migrations():
    migrations = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = MIGRATION_RE.fullmatch(path.name)
        if not match:
            continue
        migrations.append((int(match.group(1)), path, path.read_text("utf-8")))
    if not migrations:
        raise RuntimeError(f"no migrations found in {MIGRATIONS_DIR}")
    return migrations


def init_gist_database(app):
    db_path = get_gist_db_path(app)
    if db_path != ":memory:":
        Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)

    migrations = _read_migrations()
    with _init_lock(db_path):
        with gist_connection(app) as conn:
            conn.execute(
                """
                create table if not exists gist_schema_migrations (
                    version integer primary key,
                    applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
                """
            )
            applied = {
                row["version"]
                for row in conn.execute("select version from gist_schema_migrations")
            }

            for version, _path, sql in migrations:
                if version in applied:
                    continue
                with conn:
                    conn.executescript(sql)
                    conn.execute(
                        "insert into gist_schema_migrations(version) values (?)",
                        (version,),
                    )
