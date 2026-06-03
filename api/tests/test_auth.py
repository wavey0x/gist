from gist_api.auth import (
    create_api_key,
    list_api_keys,
    revoke_api_key,
    rotate_api_key,
    verify_api_key,
)
from gist_api.db import gist_connection


def test_key_rotation_revokes_old_key_and_returns_new_secret(app):
    with gist_connection(app) as conn:
        created = create_api_key(conn, "gist", "rotate", ["gist:read"])
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
