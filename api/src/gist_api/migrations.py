import importlib.util
import re
from dataclasses import dataclass
from contextlib import contextmanager
from pathlib import Path

from .db import get_gist_db_path, gist_connection

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is unavailable on Windows.
    fcntl = None


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION_RE = re.compile(r"^(\d{3})_[A-Za-z0-9_]+\.(sql|py)$")


@dataclass(frozen=True)
class Migration:
    version: int
    path: Path
    kind: str


def _load_python_migration(migration):
    module_name = f"gist_api_migration_{migration.version}_{migration.path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, migration.path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load migration {migration.path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    upgrade = getattr(module, "upgrade", None)
    if not callable(upgrade):
        raise RuntimeError(f"Python migration has no upgrade(conn): {migration.path}")
    return upgrade


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
    versions = set()
    for path in sorted(MIGRATIONS_DIR.iterdir()):
        if not path.is_file():
            continue
        match = MIGRATION_RE.fullmatch(path.name)
        if not match:
            continue
        version = int(match.group(1))
        if version in versions:
            raise RuntimeError(f"duplicate migration version: {version}")
        versions.add(version)
        migrations.append(Migration(version, path, match.group(2)))
    if not migrations:
        raise RuntimeError(f"no migrations found in {MIGRATIONS_DIR}")
    return sorted(migrations, key=lambda migration: migration.version)


def _apply_sql_migration(conn, migration):
    sql = migration.path.read_text("utf-8")
    with conn:
        conn.executescript(sql)
        conn.execute(
            "insert into gist_schema_migrations(version) values (?)",
            (migration.version,),
        )


def _apply_python_migration(conn, migration):
    upgrade = _load_python_migration(migration)
    conn.commit()
    conn.execute("begin immediate")
    try:
        upgrade(conn)
        conn.execute(
            "insert into gist_schema_migrations(version) values (?)",
            (migration.version,),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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

            for migration in migrations:
                if migration.version in applied:
                    continue
                if migration.kind == "sql":
                    _apply_sql_migration(conn, migration)
                else:
                    _apply_python_migration(conn, migration)
