from gist_api.auth import (
    WEB_SESSION_COOKIE_NAME,
    create_api_key,
    create_web_session,
    list_api_keys,
    revoke_api_key,
    rotate_api_key,
    verify_api_key,
    verify_web_session,
)
from gist_api.db import gist_connection


def test_key_rotation_revokes_old_key_and_returns_new_secret(app):
    with gist_connection(app) as conn:
        created = create_api_key(
            conn,
            "gist",
            "rotate",
            ["gist:read"],
            github_login="rotate",
        )
        rotated = rotate_api_key(conn, created["key_prefix"], "rotated")

        old_auth, old_error = verify_api_key(
            conn,
            f"Bearer {created['key']}",
            "gist",
            "gist:read",
        )
        new_auth, new_error = verify_api_key(
            conn,
            f"Bearer {rotated['key']}",
            "gist",
            "gist:read",
        )

    assert old_auth is None
    assert old_error == "unauthorized"
    assert new_auth is not None
    assert new_error is None
    assert rotated["key"].startswith("wapi_gist_")
    assert rotated["github_login"] == "rotate"


def test_key_verification_enforces_domain_scope_and_revocation(app):
    with gist_connection(app) as conn:
        gist_key = create_api_key(conn, "gist", "reader", ["gist:read"])
        price_key = create_api_key(conn, "prices", "reader", ["prices:read"])

        auth, error = verify_api_key(
            conn,
            f"Bearer {gist_key['key']}",
            "gist",
            "gist:write",
        )
        assert auth is None
        assert error == "forbidden"

        auth, error = verify_api_key(
            conn,
            f"Bearer {price_key['key']}",
            "gist",
            "gist:read",
        )
        assert auth is None
        assert error == "unauthorized"

        assert list_api_keys(conn, "gist")[0]["key_prefix"] == gist_key["key_prefix"]
        revoke_api_key(conn, gist_key["key_prefix"])
        auth, error = verify_api_key(
            conn,
            f"Bearer {gist_key['key']}",
            "gist",
            "gist:read",
        )

    assert auth is None
    assert error == "unauthorized"


def test_key_rotation_can_replace_github_login(app):
    with gist_connection(app) as conn:
        created = create_api_key(
            conn,
            "gist",
            "rotate",
            ["gist:read"],
            github_login="first-login",
        )
        rotated = rotate_api_key(
            conn,
            created["key_prefix"],
            github_login="second-login",
        )

    assert rotated["name"] == "rotate"
    assert rotated["github_login"] == "second-login"


def test_web_session_rejects_revoked_or_scope_changed_keys(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "gist", "reader", ["gist:read"])
        token, auth, error = create_web_session(conn, created["key"])
        assert error is None
        assert auth.name == "reader"

        revoke_api_key(conn, created["key_prefix"])
        auth, error = verify_web_session(conn, token)
        assert auth is None
        assert error == "unauthorized"

        changed = create_api_key(conn, "gist", "changed", ["gist:read"])
        token, auth, error = create_web_session(conn, changed["key"])
        assert error is None
        with conn:
            conn.execute(
                "update api_keys set scopes_json = ? where id = ?",
                ('["gist:write"]', changed["id"]),
            )

        auth, error = verify_web_session(conn, token)
        assert auth is None
        assert error == "forbidden"


def test_auth_session_routes_mint_safe_cookie_identity_and_logout(client, app):
    with gist_connection(app) as conn:
        created = create_api_key(
            conn,
            "gist",
            "wavey0x",
            ["gist:read", "gist:write"],
            github_login="wavey0x",
        )

    invalid = client.post("/api/v1/auth/session", json={"api_key": "nope"})
    assert invalid.status_code == 401

    response = client.post(
        "/api/v1/auth/session",
        json={"api_key": created["key"]},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "name": "wavey0x",
        "github_login": "wavey0x",
        "avatar_url": "https://github.com/wavey0x.png?size=64",
    }
    assert "key" not in body
    assert "token" not in body

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


def test_auth_session_login_forbids_gist_key_without_read_scope(client, app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "gist", "writer", ["gist:write"])

    response = client.post(
        "/api/v1/auth/session",
        json={"api_key": created["key"]},
    )

    assert response.status_code == 403
