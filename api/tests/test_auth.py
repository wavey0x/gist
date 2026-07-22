from gist_api.auth import (
    WEB_SESSION_COOKIE_NAME,
    create_api_key,
    create_web_session,
    list_api_keys,
    revoke_api_key,
    rotate_api_key,
    session_identity,
    verify_api_key,
    verify_web_session,
)
from gist_api.db import gist_connection

from .conftest import auth_header, create_gist


def test_api_keys_are_stored_and_verified_as_cleartext(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "reader")
        stored = conn.execute(
            "select key_value, key_prefix from api_keys where id = ?",
            (created["id"],),
        ).fetchone()
        settings = conn.execute(
            """
            select new_gist_enabled, edited_gist_enabled
            from notification_settings
            where api_key_id = ?
            """,
            (created["id"],),
        ).fetchone()

        auth, error = verify_api_key(conn, f"Bearer {created['key']}")

    assert stored["key_value"] == created["key"]
    assert stored["key_prefix"] == created["key_prefix"]
    assert auth is not None
    assert auth.key_value == created["key"]
    assert auth.name == "reader"
    assert error is None
    assert "domain" not in created
    assert "scopes" not in created
    assert dict(settings) == {
        "new_gist_enabled": 1,
        "edited_gist_enabled": 0,
    }


def test_hash_only_key_storage_is_not_accepted(app):
    old_key = "wapi_gist_oldprefx_" + ("A" * 43)
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                insert into api_keys(
                    name, github_login, key_value, key_prefix, created_at
                )
                values (
                    'old',
                    null,
                    'scrypt:32768:8:1$redacted$redacted',
                    'wapi_gist_oldprefx',
                    '2026-01-01T00:00:00.000Z'
                )
                """
            )

        auth, error = verify_api_key(conn, f"Bearer {old_key}")

    assert auth is None
    assert error == "unauthorized"


def test_key_rotation_revokes_old_key_and_returns_new_secret(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "rotate", github_login="rotate")
        rotated = rotate_api_key(conn, created["key_prefix"], "rotated")

        old_auth, old_error = verify_api_key(conn, f"Bearer {created['key']}")
        new_auth, new_error = verify_api_key(conn, f"Bearer {rotated['key']}")
        key_rows = conn.execute("select count(*) from api_keys").fetchone()[0]

    assert old_auth is None
    assert old_error == "unauthorized"
    assert new_auth is not None
    assert new_error is None
    assert rotated["key"].startswith("wapi_gist_")
    assert rotated["id"] == created["id"]
    assert rotated["created_at"] == created["created_at"]
    assert key_rows == 1
    assert rotated["github_login"] == "rotate"
    assert "domain" not in rotated
    assert "scopes" not in rotated


def test_key_verification_rejects_non_gist_key_format_and_revocation(app):
    with gist_connection(app) as conn:
        gist_key = create_api_key(conn, "reader")
        non_gist_key = gist_key["key"].replace("wapi_gist_", "wapi_prices_", 1)
        long_prefix_key = gist_key["key"].replace("wapi_gist_", "wapi_gist_long", 1)
        long_secret_key = f"{gist_key}A"

        auth, error = verify_api_key(conn, f"Bearer {non_gist_key}")
        assert auth is None
        assert error == "unauthorized"
        auth, error = verify_api_key(conn, f"Bearer {long_prefix_key}")
        assert auth is None
        assert error == "unauthorized"
        auth, error = verify_api_key(conn, f"Bearer {long_secret_key}")
        assert auth is None
        assert error == "unauthorized"

        listed = list_api_keys(conn)
        assert listed[0]["key_prefix"] == gist_key["key_prefix"]
        assert "domain" not in listed[0]
        assert "scopes" not in listed[0]

        revoke_api_key(conn, gist_key["key_prefix"])
        auth, error = verify_api_key(conn, f"Bearer {gist_key['key']}")

    assert auth is None
    assert error == "unauthorized"


def test_key_rotation_can_replace_github_login(app):
    with gist_connection(app) as conn:
        created = create_api_key(
            conn,
            "rotate",
            github_login="first-login",
        )
        rotated = rotate_api_key(
            conn,
            created["key_prefix"],
            github_login="second-login",
        )

    assert rotated["name"] == "rotate"
    assert rotated["github_login"] == "second-login"


def test_key_creation_and_rotation_can_set_custom_avatar_url(app):
    avatar_url = "https://api.example.com/api/v1/avatars/ted.png"
    replacement_avatar_url = "https://api.example.com/api/v1/avatars/new.png"
    with gist_connection(app) as conn:
        created = create_api_key(
            conn,
            "ted-mckinsey",
            avatar_url=avatar_url,
        )
        preserved = rotate_api_key(conn, created["key_prefix"])
        token, auth, error = create_web_session(conn, preserved["key"])

        replaced = rotate_api_key(
            conn,
            preserved["key_prefix"],
            avatar_url=replacement_avatar_url,
        )
        cleared = rotate_api_key(
            conn,
            replaced["key_prefix"],
            avatar_url="",
        )

        revoked_token, revoked_auth, revoked_error = create_web_session(
            conn,
            created["key"],
        )
        assert revoked_token is None
        assert revoked_auth is None
        assert revoked_error == "unauthorized"

    assert created["avatar_url"] == avatar_url
    assert preserved["avatar_url"] == avatar_url
    assert replaced["avatar_url"] == replacement_avatar_url
    assert cleared["avatar_url"] is None
    assert error is None
    assert auth.avatar_url == avatar_url
    assert session_identity(auth) == {
        "name": "ted-mckinsey",
        "key": preserved["key"],
        "key_prefix": preserved["key_prefix"],
        "avatar_url": avatar_url,
    }


def test_web_session_rejects_revoked_keys(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "reader")
        token, auth, error = create_web_session(conn, created["key"])
        assert error is None
        assert auth.name == "reader"

        revoke_api_key(conn, created["key_prefix"])
        auth, error = verify_web_session(conn, token)

    assert auth is None
    assert error == "unauthorized"


def test_web_session_stores_only_hash_and_rejects_expired_sessions(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "reader")
        token, auth, error = create_web_session(conn, created["key"])
        assert error is None
        assert auth.name == "reader"

        session = conn.execute(
            "select token_hash from web_sessions where api_key_id = ?",
            (auth.key_id,),
        ).fetchone()
        assert session["token_hash"] != token
        assert len(session["token_hash"]) == 64

        with conn:
            conn.execute(
                "update web_sessions set expires_at = ? where token_hash = ?",
                ("2000-01-01T00:00:00.000Z", session["token_hash"]),
            )

        auth, error = verify_web_session(conn, token)

    assert auth is None
    assert error == "unauthorized"


def test_web_session_reads_do_not_write_session_last_used_at(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "reader")
        token, auth, error = create_web_session(conn, created["key"])
        assert error is None
        with conn:
            conn.execute(
                "update api_keys set last_used_at = ? where id = ?",
                ("2000-01-01T00:00:00.000Z", auth.key_id),
            )

        verified, error = verify_web_session(conn, token)
        row = conn.execute(
            """
            select web_sessions.last_used_at as session_last_used_at,
                   api_keys.last_used_at as key_last_used_at
            from web_sessions
            join api_keys on api_keys.id = web_sessions.api_key_id
            where web_sessions.api_key_id = ?
            """,
            (auth.key_id,),
        ).fetchone()

    assert error is None
    assert verified.key_id == auth.key_id
    assert row["session_last_used_at"] is None
    assert row["key_last_used_at"] != "2000-01-01T00:00:00.000Z"


def test_rotation_reactivates_same_identity_and_preserves_gist_ownership(
    client,
    app,
):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "owner")
        token, _auth, error = create_web_session(conn, created["key"])
        assert error is None

    gist = create_gist(client, created["key"], "# Before rotation")
    assert gist.status_code == 201
    gist_id = gist.get_json()["id"]

    with gist_connection(app) as conn:
        revoke_api_key(conn, created["id"])
        rotated = rotate_api_key(conn, created["id"])
        key_rows = conn.execute("select count(*) from api_keys").fetchone()[0]
        stored = conn.execute(
            "select id, created_at, revoked_at from api_keys"
        ).fetchone()
        session = conn.execute(
            "select revoked_at from web_sessions where api_key_id = ?",
            (created["id"],),
        ).fetchone()
        old_session_auth, old_session_error = verify_web_session(conn, token)

    assert rotated["id"] == created["id"]
    assert rotated["created_at"] == created["created_at"]
    assert key_rows == 1
    assert stored["id"] == created["id"]
    assert stored["created_at"] == created["created_at"]
    assert stored["revoked_at"] is None
    assert session["revoked_at"] is not None
    assert old_session_auth is None
    assert old_session_error == "unauthorized"

    read = client.get(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(rotated["key"]),
    )
    updated = client.patch(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(rotated["key"]),
        json={
            "files": {"README.md": {"content": "# After rotation"}},
            "expected_snapshot_sha256": gist.get_json()["snapshot_sha256"],
        },
    )
    deleted = client.delete(
        f"/api/v1/gists/{gist_id}",
        headers=auth_header(rotated["key"]),
    )

    assert read.status_code == 200
    assert updated.status_code == 200
    assert deleted.status_code == 204


def test_web_session_rejects_non_ascii_cookie_without_error(app):
    with gist_connection(app) as conn:
        auth, error = verify_web_session(conn, "not-a-token-\N{SNOWMAN}")

    assert auth is None
    assert error == "unauthorized"


def test_auth_session_routes_mint_safe_cookie_identity_and_logout(client, app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "wavey0x", github_login="wavey0x")

    invalid = client.post("/api/v1/auth/session", json={"api_key": "nope"})
    assert invalid.status_code == 401

    unknown = client.post(
        "/api/v1/auth/session",
        json={"api_key": created["key"], "extra": True},
    )
    assert unknown.status_code == 400
    assert unknown.get_json()["error"] == {
        "code": "invalid_request",
        "message": "unknown field: extra",
    }

    response = client.post(
        "/api/v1/auth/session",
        json={"api_key": created["key"]},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "name": "wavey0x",
        "key": created["key"],
        "key_prefix": created["key_prefix"],
        "github_login": "wavey0x",
        "avatar_url": "https://github.com/wavey0x.png?size=64",
    }
    assert "token" not in body
    assert set(body) == {
        "name",
        "key",
        "key_prefix",
        "github_login",
        "avatar_url",
    }

    cookie = response.headers["Set-Cookie"]
    assert cookie.startswith(f"{WEB_SESSION_COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=Lax" in cookie
    assert "Path=/" in cookie
    assert "Domain=" not in cookie

    current = client.get("/api/v1/auth/session")
    assert current.status_code == 200
    assert current.get_json() == body

    logout = client.delete("/api/v1/auth/session")
    assert logout.status_code == 204
    assert f"{WEB_SESSION_COOKIE_NAME}=;" in logout.headers["Set-Cookie"]

    after_logout = client.get("/api/v1/auth/session")
    assert after_logout.status_code == 401
