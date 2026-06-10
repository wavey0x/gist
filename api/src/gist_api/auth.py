import base64
import hashlib
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


KEY_RE = re.compile(
    r"^wapi_gist_([A-Za-z0-9_-]{8,})_([A-Za-z0-9_-]{43,})$"
)


@dataclass(frozen=True)
class AuthResult:
    key_id: int
    name: str
    github_login: str | None
    key_value: str
    key_prefix: str


GITHUB_LOGIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
WEB_SESSION_COOKIE_NAME = "wg_session"
WEB_SESSION_TTL_DAYS = 30
_PRESERVE = object()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _utc_now_datetime():
    return datetime.now(timezone.utc)


def _format_datetime(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _base64url_random(byte_count):
    return base64.urlsafe_b64encode(secrets.token_bytes(byte_count)).rstrip(b"=").decode(
        "ascii"
    )


def _parse_key(api_key):
    match = KEY_RE.match(api_key or "")
    if not match:
        return None
    public_prefix, _secret = match.groups()
    return f"wapi_gist_{public_prefix}"


def _normalize_key_name(name):
    name = (name or "").strip()

    if not name:
        raise ValueError("name is required")
    return name


def _normalize_github_login(github_login):
    if github_login is None:
        return None
    github_login = github_login.strip()
    if not github_login:
        return None
    if not GITHUB_LOGIN_RE.fullmatch(github_login):
        raise ValueError("github_login must be a valid GitHub username")
    return github_login


def _new_key_material():
    public_prefix = _base64url_random(6)
    secret = _base64url_random(32)
    full_key = f"wapi_gist_{public_prefix}_{secret}"
    key_prefix = f"wapi_gist_{public_prefix}"
    return full_key, key_prefix


def _token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _avatar_url(github_login):
    if not github_login:
        return None
    return f"https://github.com/{github_login}.png?size=64"


def session_identity(auth):
    body = {
        "name": auth.name,
        "key": auth.key_value,
        "key_prefix": auth.key_prefix,
    }
    if auth.github_login:
        body["github_login"] = auth.github_login
        body["avatar_url"] = _avatar_url(auth.github_login)
    return body


def create_api_key(conn, name, github_login=None):
    name = _normalize_key_name(name)
    github_login = _normalize_github_login(github_login)
    now = utc_now()
    for _ in range(8):
        full_key, key_prefix = _new_key_material()

        try:
            with conn:
                cursor = conn.execute(
                    """
                    insert into api_keys(
                        name, github_login, key_value, key_prefix, created_at
                    )
                    values (?, ?, ?, ?, ?)
                    """,
                    (
                        name,
                        github_login,
                        full_key,
                        key_prefix,
                        now,
                    ),
                )
            return {
                "id": cursor.lastrowid,
                "key": full_key,
                "key_prefix": key_prefix,
                "name": name,
                "github_login": github_login,
                "created_at": now,
            }
        except sqlite3.IntegrityError:
            continue

    raise RuntimeError("could not allocate unique api key prefix")


def verify_api_key_value(conn, api_key):
    key_prefix = _parse_key(api_key)
    if not key_prefix:
        return None, "unauthorized"

    row = conn.execute(
        """
        select id, name, github_login, key_value, key_prefix
        from api_keys
        where key_prefix = ? and revoked_at is null
        """,
        (key_prefix,),
    ).fetchone()
    if row is None:
        return None, "unauthorized"
    if not secrets.compare_digest(row["key_value"], api_key):
        return None, "unauthorized"

    with conn:
        conn.execute(
            "update api_keys set last_used_at = ? where id = ?",
            (utc_now(), row["id"]),
        )

    return (
        AuthResult(
            key_id=row["id"],
            name=row["name"],
            github_login=row["github_login"],
            key_value=row["key_value"],
            key_prefix=row["key_prefix"],
        ),
        None,
    )


def verify_api_key(conn, authorization_header):
    if not authorization_header or not authorization_header.startswith("Bearer "):
        return None, "unauthorized"

    api_key = authorization_header[len("Bearer ") :].strip()
    return verify_api_key_value(conn, api_key)


def create_web_session(conn, api_key):
    auth, error_code = verify_api_key_value(conn, api_key)
    if error_code is not None:
        return None, None, error_code

    now_dt = _utc_now_datetime()
    now = _format_datetime(now_dt)
    expires_at = _format_datetime(now_dt + timedelta(days=WEB_SESSION_TTL_DAYS))

    for _ in range(8):
        token = _base64url_random(48)
        try:
            with conn:
                conn.execute(
                    """
                    insert into web_sessions(
                        token_hash, api_key_id, created_at, expires_at
                    )
                    values (?, ?, ?, ?)
                    """,
                    (_token_hash(token), auth.key_id, now, expires_at),
                )
            return token, auth, None
        except sqlite3.IntegrityError:
            continue

    raise RuntimeError("could not allocate unique web session token")


def verify_web_session(conn, token):
    if not token:
        return None, "unauthorized"

    now = utc_now()
    row = conn.execute(
        """
        select
            web_sessions.id as session_id,
            api_keys.id as api_key_id,
            api_keys.name,
            api_keys.github_login,
            api_keys.key_value,
            api_keys.key_prefix
        from web_sessions
        join api_keys on api_keys.id = web_sessions.api_key_id
        where web_sessions.token_hash = ?
          and web_sessions.revoked_at is null
          and web_sessions.expires_at > ?
          and api_keys.revoked_at is null
        """,
        (_token_hash(token), now),
    ).fetchone()
    if row is None:
        return None, "unauthorized"

    with conn:
        conn.execute(
            "update web_sessions set last_used_at = ? where id = ?",
            (now, row["session_id"]),
        )
        conn.execute(
            "update api_keys set last_used_at = ? where id = ?",
            (now, row["api_key_id"]),
        )

    return (
        AuthResult(
            key_id=row["api_key_id"],
            name=row["name"],
            github_login=row["github_login"],
            key_value=row["key_value"],
            key_prefix=row["key_prefix"],
        ),
        None,
    )


def revoke_web_session(conn, token):
    if not token:
        return
    with conn:
        conn.execute(
            """
            update web_sessions
            set revoked_at = coalesce(revoked_at, ?)
            where token_hash = ?
            """,
            (utc_now(), _token_hash(token)),
        )


def list_api_keys(conn):
    rows = conn.execute(
        """
        select
            id, name, github_login, key_prefix,
            created_at, last_used_at, revoked_at
        from api_keys
        order by id
        """
    ).fetchall()

    return [
        {
            "id": row["id"],
            "name": row["name"],
            "github_login": row["github_login"],
            "key_prefix": row["key_prefix"],
            "created_at": row["created_at"],
            "last_used_at": row["last_used_at"],
            "revoked_at": row["revoked_at"],
        }
        for row in rows
    ]


def revoke_api_key(conn, key_prefix_or_id):
    now = utc_now()
    with conn:
        if str(key_prefix_or_id).isdigit():
            conn.execute(
                "update api_keys set revoked_at = coalesce(revoked_at, ?) where id = ?",
                (now, int(key_prefix_or_id)),
            )
        else:
            conn.execute(
                "update api_keys set revoked_at = coalesce(revoked_at, ?) where key_prefix = ?",
                (now, key_prefix_or_id),
            )


def rotate_api_key(conn, key_prefix_or_id, name=None, github_login=_PRESERVE):
    selector_is_id = str(key_prefix_or_id).isdigit()
    if str(key_prefix_or_id).isdigit():
        row = conn.execute(
            "select id, name, github_login from api_keys where id = ?",
            (int(key_prefix_or_id),),
        ).fetchone()
    else:
        row = conn.execute(
            "select id, name, github_login from api_keys where key_prefix = ?",
            (key_prefix_or_id,),
        ).fetchone()

    if row is None:
        raise ValueError("key not found")

    new_name = _normalize_key_name(name or row["name"])
    if github_login is _PRESERVE:
        new_github_login = row["github_login"]
    else:
        new_github_login = _normalize_github_login(github_login)
    now = utc_now()

    for _ in range(8):
        full_key, key_prefix = _new_key_material()
        try:
            with conn:
                cursor = conn.execute(
                    """
                    insert into api_keys(
                        name, github_login, key_value, key_prefix, created_at
                    )
                    values (?, ?, ?, ?, ?)
                    """,
                    (
                        new_name,
                        new_github_login,
                        full_key,
                        key_prefix,
                        now,
                    ),
                )
                if selector_is_id:
                    conn.execute(
                        "update api_keys set revoked_at = coalesce(revoked_at, ?) where id = ?",
                        (now, row["id"]),
                    )
                else:
                    conn.execute(
                        "update api_keys set revoked_at = coalesce(revoked_at, ?) where key_prefix = ?",
                        (now, key_prefix_or_id),
                    )
            return {
                "id": cursor.lastrowid,
                "key": full_key,
                "key_prefix": key_prefix,
                "name": new_name,
                "github_login": new_github_login,
                "created_at": now,
            }
        except sqlite3.IntegrityError:
            continue

    raise RuntimeError("could not allocate unique api key prefix")
