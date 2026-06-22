import json

from gist_api.admin import main as admin_main


def _admin_json(output):
    return json.loads(output.split("\nSave this key securely.", 1)[0])


def test_admin_key_create_mints_gist_key_with_current_fields(
    monkeypatch,
    tmp_path,
    capsys,
):
    monkeypatch.setenv("SQLITE_DB_PATH", str(tmp_path / "admin.sqlite3"))

    admin_main(
        [
            "keys",
            "create",
            "--name",
            "Alice",
            "--github-login",
            "alice",
            "--avatar-url",
            "https://api.example.com/alice.png",
        ]
    )

    body = _admin_json(capsys.readouterr().out)
    assert body["name"] == "Alice"
    assert body["github_login"] == "alice"
    assert body["avatar_url"] == "https://api.example.com/alice.png"
    assert body["key"].startswith("wapi_gist_")
    assert "domain" not in body
    assert "scopes" not in body


def test_admin_key_create_can_store_avatar_file(
    monkeypatch,
    tmp_path,
    capsys,
):
    monkeypatch.setenv("SQLITE_DB_PATH", str(tmp_path / "admin.sqlite3"))
    monkeypatch.setenv("PUBLIC_API_BASE_URL", "https://api.example.com")
    avatar = tmp_path / "avatar.png"
    avatar.write_bytes(b"\x89PNG\r\n\x1a\navatar")

    admin_main(
        [
            "keys",
            "create",
            "--name",
            "Ted",
            "--avatar-file",
            str(avatar),
        ]
    )

    body = _admin_json(capsys.readouterr().out)
    assert body["avatar_url"].startswith(
        "https://api.example.com/api/v1/avatars/"
    )
    assert body["avatar_url"].endswith(".png")
    assert len(list((tmp_path / "avatars").glob("*.png"))) == 1


def test_admin_key_list_revoke_and_rotate(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("SQLITE_DB_PATH", str(tmp_path / "admin.sqlite3"))
    admin_main(["keys", "create", "--name", "Alice"])

    created = _admin_json(capsys.readouterr().out)

    admin_main(["keys", "list"])
    listed = json.loads(capsys.readouterr().out)
    assert listed[0]["key_prefix"] == created["key_prefix"]
    assert listed[0]["github_login"] is None
    assert "domain" not in listed[0]
    assert "scopes" not in listed[0]
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
    assert "domain" not in rotated
    assert "scopes" not in rotated

    admin_main(["keys", "rotate", rotated["key_prefix"], "--name", "Preserved"])
    preserved = _admin_json(capsys.readouterr().out)
    assert preserved["name"] == "Preserved"
    assert preserved["github_login"] == "rotated"

    admin_main(["keys", "revoke", preserved["key_prefix"]])
    revoked = json.loads(capsys.readouterr().out)
    assert revoked == {"revoked": True}
