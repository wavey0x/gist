import pytest
from flask import jsonify

from gist_api.app import create_app
from gist_api.auth import create_api_key
from gist_api.db import gist_connection


@pytest.fixture()
def app(tmp_path):
    app = create_app(
        {
            "SQLITE_DB_PATH": str(tmp_path / "gists.sqlite3"),
            "PUBLIC_GIST_BASE_URL": "https://gist.example.com",
            "PUBLIC_API_BASE_URL": "https://api.example.com",
            "MAX_MARKDOWN_BYTES": 1024 * 1024,
            "ALLOW_EMPTY_MARKDOWN": False,
            "SQLITE_BUSY_TIMEOUT_MS": 5000,
            "API_WRITE_LIMIT_PER_24H": 1000,
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE": 1000,
        }
    )

    @app.route("/api/v1/other")
    def other():
        return jsonify({"ok": True})

    return app


@pytest.fixture()
def client(app):
    return app.test_client()


def make_key(app, name="test", github_login=None, avatar_url=None):
    with gist_connection(app) as conn:
        return create_api_key(
            conn,
            name,
            github_login=github_login,
            avatar_url=avatar_url,
        )["key"]


def auth_header(key):
    return {"Authorization": f"Bearer {key}"}


def create_gist(client, key, markdown="# Hello", title="Title"):
    return client.post(
        "/api/v1/gists",
        headers=auth_header(key),
        json={"title": title, "markdown": markdown},
    )
