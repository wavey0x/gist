from gist_api.app import create_app
from gist_api.external_ids import DEFAULT_EXTERNAL_ID_LENGTH

from .conftest import auth_header, make_key


VALID_LOOKING_GIST_ID = "A" * DEFAULT_EXTERNAL_ID_LENGTH


def _limited_app(db_path, *, write_limit=2, auth_failure_limit=2):
    return create_app(
        {
            "SQLITE_DB_PATH": str(db_path),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "MAX_MARKDOWN_BYTES": 1024 * 1024,
            "ALLOW_EMPTY_MARKDOWN": False,
            "SQLITE_BUSY_TIMEOUT_MS": 5000,
            "API_WRITE_LIMIT_PER_24H": write_limit,
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE": auth_failure_limit,
        }
    )


def test_write_rate_limits_persist_by_key_after_restart(tmp_path):
    db_path = tmp_path / "limits.sqlite3"
    app = _limited_app(db_path, write_limit=2)
    key = make_key(app, name="writer")
    client = app.test_client()

    for index in range(2):
        response = client.post(
            "/api/v1/gists",
            headers=auth_header(key),
            json={"markdown": f"# {index}"},
        )
        assert response.status_code == 201

    restarted = _limited_app(db_path, write_limit=2)
    response = restarted.test_client().post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={"markdown": "# limited"},
    )
    assert response.status_code == 429
    assert response.get_json()["error"]["code"] == "rate_limited"


def test_write_rate_limits_persist_by_source_ip_after_restart(tmp_path):
    db_path = tmp_path / "ip-limits.sqlite3"
    app = _limited_app(db_path, write_limit=2)
    first_key = make_key(app, name="first")
    second_key = make_key(app, name="second")
    third_key = make_key(app, name="third")
    client = app.test_client()
    headers = {"X-Forwarded-For": "203.0.113.9"}

    assert client.post(
        "/api/v1/gists",
        headers={**auth_header(first_key), **headers},
        json={"markdown": "# one"},
    ).status_code == 201
    assert client.post(
        "/api/v1/gists",
        headers={**auth_header(second_key), **headers},
        json={"markdown": "# two"},
    ).status_code == 201

    restarted = _limited_app(db_path, write_limit=2)
    response = restarted.test_client().post(
        "/api/v1/gists",
        headers={**auth_header(third_key), **headers},
        json={"markdown": "# limited"},
    )
    assert response.status_code == 429


def test_write_rate_limit_uses_rightmost_forwarded_ip_from_trusted_proxy(tmp_path):
    db_path = tmp_path / "spoofed-forwarded-limits.sqlite3"
    app = _limited_app(db_path, write_limit=1)
    first_key = make_key(app, name="first")
    second_key = make_key(app, name="second")
    client = app.test_client()

    first = client.post(
        "/api/v1/gists",
        headers={
            **auth_header(first_key),
            "X-Forwarded-For": "192.0.2.1, 203.0.113.44",
        },
        json={"markdown": "# one"},
    )
    assert first.status_code == 201

    response = client.post(
        "/api/v1/gists",
        headers={
            **auth_header(second_key),
            "X-Forwarded-For": "192.0.2.2, 203.0.113.44",
        },
        json={"markdown": "# limited"},
    )
    assert response.status_code == 429


def test_auth_failure_rate_limits_persist_by_source_ip_after_restart(tmp_path):
    db_path = tmp_path / "auth-limits.sqlite3"
    app = _limited_app(db_path, auth_failure_limit=2)
    client = app.test_client()
    headers = {"X-Forwarded-For": "198.51.100.7"}

    for _ in range(2):
        response = client.get(f"/api/v1/gists/{VALID_LOOKING_GIST_ID}", headers=headers)
        assert response.status_code == 401

    restarted = _limited_app(db_path, auth_failure_limit=2)
    response = restarted.test_client().get(
        f"/api/v1/gists/{VALID_LOOKING_GIST_ID}",
        headers=headers,
    )
    assert response.status_code == 429
    assert response.get_json()["error"]["code"] == "rate_limited"


def test_auth_failure_limit_uses_rightmost_forwarded_ip_from_trusted_proxy(tmp_path):
    db_path = tmp_path / "spoofed-auth-limits.sqlite3"
    app = _limited_app(db_path, auth_failure_limit=2)
    client = app.test_client()

    for spoofed_ip in ("192.0.2.1", "192.0.2.2"):
        response = client.get(
            f"/api/v1/gists/{VALID_LOOKING_GIST_ID}",
            headers={"X-Forwarded-For": f"{spoofed_ip}, 198.51.100.77"},
        )
        assert response.status_code == 401

    response = client.get(
        f"/api/v1/gists/{VALID_LOOKING_GIST_ID}",
        headers={"X-Forwarded-For": "192.0.2.3, 198.51.100.77"},
    )
    assert response.status_code == 429
    assert response.get_json()["error"]["code"] == "rate_limited"
