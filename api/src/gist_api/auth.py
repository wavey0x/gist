import base64
import hashlib
import json
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash


KEY_RE = re.compile(
    r"^wapi_([a-z][a-z0-9-]{0,31})_([A-Za-z0-9_-]{8,})_([A-Za-z0-9_-]{43,})$"
)


@dataclass(frozen=True)
class AuthResult:
    key_id: int
    domain: str
    name: str
    github_login: str | None
    key_prefix: str
    scopes: frozenset[str]


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
    domain, public_prefix, _secret = match.groups()
    return domain, f"wapi_{domain}_{public_prefix}"


def _normalize_key_input(domain, name, scopes):
    domain = (domain or "").strip()
    name = (name or "").strip()
    scopes = [scope.strip() for scope in scopes if scope and scope.strip()]

    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", domain):
        raise ValueError("domain must be a short lowercase slug")
    if not name:
        raise ValueError("name is required")
    if not scopes:
        raise ValueError("at least one scope is required")
    return domain, name, scopes


def _normalize_github_login(github_login):
    if github_login is None:
        return None
    github_login = github_login.strip()
    if not github_login:
        return None
    if not GITHUB_LOGIN_RE.fullmatch(github_login):
        raise ValueError("github_login must be a valid GitHub username")
    return github_login


def _new_key_material(domain):
    public_prefix = _base64url_random(6)
    secret = _base64url_random(32)
    full_key = f"wapi_{domain}_{public_prefix}_{secret}"
    key_prefix = f"wapi_{domain}_{public_prefix}"
    key_hash = generate_password_hash(full_key)
    return full_key, key_prefix, key_hash


def _token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _avatar_url(github_login):
    if not github_login:
        return None
    return f"https://github.com/{github_login}.png?size=64"


def session_identity(auth):
    body = {
        "name": auth.name,
    }
    if auth.github_login:
        body["github_login"] = auth.github_login
        body["avatar_url"] = _avatar_url(auth.github_login)
    return body


def create_api_key(conn, domain, name, scopes, github_login=None):
    domain, name, scopes = _normalize_key_input(domain, name, scopes)
    github_login = _normalize_github_login(github_login)
    now = utc_now()
    for _ in range(8):
        full_key, key_prefix, key_hash = _new_key_material(domain)

        try:
            with conn:
                cursor = conn.execute(
                    """
                    insert into api_keys(
                        domain, name, github_login, key_hash, key_prefix,
                        scopes_json, created_at
                    )
                    values (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        domain,
                        name,
                        github_login,
                        key_hash,
                        key_prefix,
                        json.dumps(scopes),
                        now,
                    ),
                )
            return {
                "id": cursor.lastrowid,
                "key": full_key,
                "key_prefix": key_prefix,
                "domain": domain,
                "name": name,
                "github_login": github_login,
                "scopes": scopes,
                "created_at": now,
            }
        except sqlite3.IntegrityError:
            continue

    raise RuntimeError("could not allocate unique api key prefix")


def verify_api_key_value(conn, api_key, required_domain, required_scope):
    parsed = _parse_key(api_key)
    if not parsed:
        return None, "unauthorized"

    domain, key_prefix = parsed
    if domain != required_domain:
        return None, "unauthorized"

    row = conn.execute(
        """
        select id, domain, name, github_login, key_hash, key_prefix, scopes_json
        from api_keys
        where key_prefix = ? and revoked_at is null
        """,
        (key_prefix,),
    ).fetchone()
    if row is None or row["domain"] != required_domain:
        return None, "unauthorized"
    if not check_password_hash(row["key_hash"], api_key):
        return None, "unauthorized"

    scopes = frozenset(json.loads(row["scopes_json"]))
    if required_scope not in scopes:
        return None, "forbidden"

    with conn:
        conn.execute(
            "update api_keys set last_used_at = ? where id = ?",
            (utc_now(), row["id"]),
        )

    return (
        AuthResult(
            key_id=row["id"],
            domain=row["domain"],
            name=row["name"],
            github_login=row["github_login"],
            key_prefix=row["key_prefix"],
            scopes=scopes,
        ),
        None,
    )


def verify_api_key(conn, authorization_header, required_domain, required_scope):
    if not authorization_header or not authorization_header.startswith("Bearer "):
        return None, "unauthorized"

    api_key = authorization_header[len("Bearer ") :].strip()
    return verify_api_key_value(conn, api_key, required_domain, required_scope)


def create_web_session(conn, api_key):
    auth, error_code = verify_api_key_value(conn, api_key, "gist", "gist:read")
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
            api_keys.domain,
            api_keys.name,
            api_keys.github_login,
            api_keys.key_prefix,
            api_keys.scopes_json
        from web_sessions
        join api_keys on api_keys.id = web_sessions.api_key_id
        where web_sessions.token_hash = ?
          and web_sessions.revoked_at is null
          and web_sessions.expires_at > ?
          and api_keys.revoked_at is null
        """,
        (_token_hash(token), now),
    ).fetchone()
    if row is None or row["domain"] != "gist":
        return None, "unauthorized"

    scopes = frozenset(json.loads(row["scopes_json"]))
    if "gist:read" not in scopes:
        return None, "forbidden"

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
            domain=row["domain"],
            name=row["name"],
            github_login=row["github_login"],
            key_prefix=row["key_prefix"],
            scopes=scopes,
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


def list_api_keys(conn, domain=None):
    if domain:
        rows = conn.execute(
            """
            select
                id, domain, name, github_login, key_prefix, scopes_json,
                created_at, last_used_at, revoked_at
            from api_keys
            where domain = ?
            order by id
            """,
            (domain,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            select
                id, domain, name, github_login, key_prefix, scopes_json,
                created_at, last_used_at, revoked_at
            from api_keys
            order by id
            """
        ).fetchall()

    return [
        {
            "id": row["id"],
            "domain": row["domain"],
            "name": row["name"],
            "github_login": row["github_login"],
            "key_prefix": row["key_prefix"],
            "scopes": json.loads(row["scopes_json"]),
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
            "select id, domain, name, github_login, scopes_json from api_keys where id = ?",
            (int(key_prefix_or_id),),
        ).fetchone()
    else:
        row = conn.execute(
            "select id, domain, name, github_login, scopes_json from api_keys where key_prefix = ?",
            (key_prefix_or_id,),
        ).fetchone()

    if row is None:
        raise ValueError("key not found")

    domain, new_name, scopes = _normalize_key_input(
        row["domain"],
        name or row["name"],
        json.loads(row["scopes_json"]),
    )
    if github_login is _PRESERVE:
        new_github_login = row["github_login"]
    else:
        new_github_login = _normalize_github_login(github_login)
    now = utc_now()

    for _ in range(8):
        full_key, key_prefix, key_hash = _new_key_material(domain)
        try:
            with conn:
                cursor = conn.execute(
                    """
                    insert into api_keys(
                        domain, name, github_login, key_hash, key_prefix,
                        scopes_json, created_at
                    )
                    values (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        domain,
                        new_name,
                        new_github_login,
                        key_hash,
                        key_prefix,
                        json.dumps(scopes),
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
                "domain": domain,
                "name": new_name,
                "github_login": new_github_login,
                "scopes": scopes,
                "created_at": now,
            }
        except sqlite3.IntegrityError:
            continue

    raise RuntimeError("could not allocate unique api key prefix")
