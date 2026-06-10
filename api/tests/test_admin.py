import json

from gist_api.admin import main as admin_main


def _admin_json(output):
    return json.loads(output.split("\nSave this key securely.", 1)[0])


def test_admin_key_create_always_uses_standard_gist_scopes(
    monkeypatch,
    tmp_path,
    capsys,
):
    monkeypatch.setenv("SQLITE_DB_PATH", str(tmp_path / "admin.sqlite3"))

    admin_main(["keys", "create", "--name", "Alice", "--github-login", "alice"])

    body = _admin_json(capsys.readouterr().out)
    assert body["domain"] == "gist"
    assert body["name"] == "Alice"
    assert body["github_login"] == "alice"
    assert body["scopes"] == ["gist:read", "gist:write", "gist:delete"]
    assert body["key"].startswith("wapi_gist_")


def test_admin_key_list_revoke_and_rotate(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("SQLITE_DB_PATH", str(tmp_path / "admin.sqlite3"))
    admin_main(["keys", "create", "--name", "Alice"])

    created = _admin_json(capsys.readouterr().out)

    admin_main(["keys", "list", "--domain", "gist"])
    listed = json.loads(capsys.readouterr().out)
    assert listed[0]["key_prefix"] == created["key_prefix"]
    assert listed[0]["github_login"] is None
    assert listed[0]["scopes"] == ["gist:read", "gist:write", "gist:delete"]
    assert "key" not in listed[0]

    admin_main(
        [
            "keys",
            "rotate",
            created["key_prefix"],
            "--name",
            "Rotated",
            "--github-login",
            "rotated",
        ]
    )
    rotated = _admin_json(capsys.readouterr().out)
    assert rotated["key"] != created["key"]
    assert rotated["name"] == "Rotated"
    assert rotated["github_login"] == "rotated"
    assert rotated["scopes"] == ["gist:read", "gist:write", "gist:delete"]

    admin_main(["keys", "rotate", rotated["key_prefix"], "--name", "Preserved"])
    preserved = _admin_json(capsys.readouterr().out)
    assert preserved["name"] == "Preserved"
    assert preserved["github_login"] == "rotated"

    admin_main(["keys", "revoke", preserved["key_prefix"]])
    revoked = json.loads(capsys.readouterr().out)
    assert revoked == {"revoked": True}
