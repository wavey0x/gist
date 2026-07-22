import importlib.machinery
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest


HELPER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "publish-gist"
GIST_ID = "A" * 16
GIST_URL = f"https://gist.wavey.info/{GIST_ID}"
TOKEN = "wapi_gist_testpref_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
FILES = {
    "README.md": "# Plan\n\nSafe changes.\n",
    "check.py": "print('safe')\n",
}


def _load_helper():
    loader = importlib.machinery.SourceFileLoader(
        "wavey_publish_gist_test",
        str(HELPER_PATH),
    )
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules[loader.name] = module
    loader.exec_module(module)
    return module


publish_gist = _load_helper()


def _json_bytes(value):
    return json.dumps(value).encode()


def _gist_payload(
    *,
    revision_number=2,
    latest_revision_number=2,
    title="Plan",
    files=None,
    digest=None,
    gist_id=GIST_ID,
    pin_raw_revision=False,
):
    files = dict(FILES if files is None else files)
    digest = digest or publish_gist.snapshot_sha256(title, files)
    raw_prefix = f"{GIST_URL}/revisions/{revision_number}" if pin_raw_revision else GIST_URL
    return {
        "id": gist_id,
        "url": GIST_URL,
        "title": title,
        "display_title": title or "Plan",
        "author_name": "owner",
        "primary_file": publish_gist.ordered_filenames(files)[0],
        "snapshot_sha256": digest,
        "revision_number": revision_number,
        "latest_revision_number": latest_revision_number,
        "created_at": "2026-07-22T10:00:00.000Z",
        "updated_at": "2026-07-22T10:01:00.000Z",
        "files": {
            filename: {
                "filename": filename,
                "content": content,
                "content_sha256": publish_gist.content_sha256(content),
                "byte_size": len(content.encode()),
                "raw_url": (
                    f"{raw_prefix}/raw/{publish_gist.urllib.parse.quote(filename, safe='')}"
                ),
            }
            for filename, content in files.items()
        },
        "history": [],
    }


def _run(monkeypatch, capsys, argv, handler, *, stdin=FILES["README.md"]):
    monkeypatch.setattr(publish_gist, "_request", handler)
    monkeypatch.setattr(publish_gist, "wavey_token", lambda: TOKEN)
    monkeypatch.setattr(publish_gist.sys, "stdin", io.StringIO(stdin))
    result = publish_gist.main(argv)
    captured = capsys.readouterr()
    return result, captured.out, captured.err


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        (GIST_ID, (GIST_ID, None)),
        (GIST_URL, (GIST_ID, None)),
        (f"{GIST_URL}/", (GIST_ID, None)),
        (f"{GIST_URL}/revisions/2", (GIST_ID, 2)),
        (f"{GIST_URL}/revisions/2/", (GIST_ID, 2)),
    ],
)
def test_parse_gist_target_accepts_only_canonical_targets(target, expected):
    assert publish_gist.parse_gist_target(target) == expected


@pytest.mark.parametrize(
    "target",
    [
        "legacy_id_with_underscores_1234",
        f"prefix-{GIST_ID}-suffix",
        f"{GIST_URL}?revision=2",
        f"{GIST_URL}#raw",
        f"https://gist.wavey.info/gists/{GIST_ID}",
        f"{GIST_URL}/revisions/0",
        f"{GIST_URL}/raw/README.md",
    ],
)
def test_parse_gist_target_rejects_legacy_or_ambiguous_targets(target):
    with pytest.raises(publish_gist.CliError):
        publish_gist.parse_gist_target(target)


@pytest.mark.parametrize(
    ("target", "expected_revision"),
    [
        (GIST_URL, 2),
        (f"{GIST_URL}/revisions/1", 1),
    ],
)
def test_read_json_is_public_and_reads_requested_revision(
    monkeypatch,
    capsys,
    target,
    expected_revision,
):
    def no_credentials():
        raise AssertionError("read mode must not discover credentials")

    response = _gist_payload(
        revision_number=expected_revision,
        latest_revision_number=2,
        pin_raw_revision=expected_revision != 2,
    )

    def handler(url, **kwargs):
        expected_suffix = (
            f"/{GIST_ID}/revisions/1/render"
            if expected_revision == 1
            else f"/{GIST_ID}/render"
        )
        assert url.endswith(expected_suffix)
        assert kwargs["token"] is None
        return _json_bytes(response), "application/json"

    monkeypatch.setattr(publish_gist, "wavey_token", no_credentials)
    monkeypatch.setattr(publish_gist, "_request", handler)

    result = publish_gist.main(["--read", "--gist", target, "--json"])
    output = json.loads(capsys.readouterr().out)

    assert result == 0
    assert output == response


def test_read_without_json_prints_only_primary_file(monkeypatch, capsys):
    def handler(_url, **_kwargs):
        return _json_bytes(_gist_payload()), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--read", "--gist", GIST_ID],
        handler,
        stdin="",
    )

    assert result == 0
    assert output == FILES["README.md"]
    assert error == ""


def test_read_output_dir_materializes_every_file(monkeypatch, capsys, tmp_path):
    output_dir = tmp_path / "gist"

    def handler(_url, **_kwargs):
        return _json_bytes(_gist_payload()), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--read", "--gist", GIST_ID, "--output-dir", str(output_dir)],
        handler,
        stdin="",
    )

    assert result == 0
    assert output == ""
    assert error == ""
    assert {path.name: path.read_text() for path in output_dir.iterdir()} == FILES


def test_create_sends_multi_file_snapshot(monkeypatch, capsys, tmp_path):
    readme = tmp_path / "README.md"
    script = tmp_path / "check.py"
    readme.write_text(FILES["README.md"])
    script.write_text(FILES["check.py"])
    response = _gist_payload(revision_number=1, latest_revision_number=1)

    def handler(url, **kwargs):
        assert url == "https://api.wavey.info/api/v1/gists"
        assert kwargs["method"] == "POST"
        assert kwargs["token"] == TOKEN
        assert kwargs["payload"] == {
            "title": "Plan",
            "files": {
                "README.md": {"content": FILES["README.md"]},
                "check.py": {"content": FILES["check.py"]},
            },
        }
        return _json_bytes(response), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        [
            "--file",
            str(readme),
            "--file",
            str(script),
            "--title",
            "Plan",
            "--json",
        ],
        handler,
    )

    assert result == 0
    assert json.loads(output) == response
    assert error == ""


def test_update_reads_latest_and_sends_resolved_full_snapshot(
    monkeypatch,
    capsys,
    tmp_path,
):
    current_files = {
        "README.md": FILES["README.md"],
        "old.py": "print('old')\n",
    }
    next_files = {
        "README.md": FILES["README.md"],
        "new.py": "print('new')\n",
    }
    current = _gist_payload(files=current_files)
    published = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        files=next_files,
    )
    new_file = tmp_path / "new.py"
    new_file.write_text(next_files["new.py"])
    calls = []

    def handler(url, **kwargs):
        calls.append((url, kwargs))
        if kwargs.get("method") == "GET":
            return _json_bytes(current), "application/json"
        assert url == f"https://api.wavey.info/api/v1/gists/{GIST_ID}"
        assert kwargs["method"] == "PATCH"
        assert kwargs["payload"] == {
            "files": {
                "README.md": {"content": FILES["README.md"]},
                "new.py": {"content": next_files["new.py"]},
            },
            "expected_snapshot_sha256": current["snapshot_sha256"],
        }
        return _json_bytes(published), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        [
            "--gist",
            f"{GIST_URL}/revisions/1",
            "--file",
            str(new_file),
            "--delete-file",
            "old.py",
            "--json",
        ],
        handler,
        stdin="",
    )

    assert result == 0
    assert json.loads(output) == published
    assert error == ""
    assert calls[0][0].endswith(f"/{GIST_ID}/render")


def test_title_only_update_does_not_require_stdin(monkeypatch, capsys):
    current = _gist_payload(title="Old")
    published = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="New",
    )

    def handler(_url, **kwargs):
        if kwargs.get("method") == "GET":
            return _json_bytes(current), "application/json"
        assert kwargs["payload"] == {
            "files": {
                filename: {"content": content} for filename, content in FILES.items()
            },
            "expected_snapshot_sha256": current["snapshot_sha256"],
            "title": "New",
        }
        return _json_bytes(published), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--title", "New", "--json"],
        handler,
        stdin="",
    )

    assert result == 0
    assert json.loads(output)["title"] == "New"
    assert error == ""


def test_http_conflict_preserves_status_and_backend_code(monkeypatch):
    response = io.BytesIO(
        _json_bytes({"error": {"code": "conflict", "message": "Conflict"}})
    )
    error = urllib.error.HTTPError(GIST_URL, 409, "Conflict", {}, response)

    def fail(_request, timeout):
        assert timeout == 30
        raise error

    monkeypatch.setattr(publish_gist.urllib.request, "urlopen", fail)

    with pytest.raises(
        publish_gist.ApiError,
        match="Wavey API error 409: conflict: Conflict",
    ):
        publish_gist._request(GIST_URL)


def test_update_conflict_reports_latest_snapshot_without_success_output(
    monkeypatch,
    capsys,
):
    current = _gist_payload()
    latest = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        files={**FILES, "late.txt": "late\n"},
    )
    reads = 0

    def handler(_url, **kwargs):
        nonlocal reads
        if kwargs.get("method") == "GET":
            reads += 1
            return _json_bytes(current if reads == 1 else latest), "application/json"
        raise publish_gist.ApiError(409, "conflict", "Conflict")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--json"],
        handler,
    )

    assert result == 1
    assert output == ""
    assert latest["snapshot_sha256"] in error
    assert reads == 2


def test_ambiguous_update_is_reconciled_but_not_retried(monkeypatch, capsys):
    current = _gist_payload(title="Old")
    desired = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="New",
    )
    reads = 0
    writes = 0

    def handler(_url, **kwargs):
        nonlocal reads, writes
        if kwargs.get("method") == "GET":
            reads += 1
            return _json_bytes(current if reads == 1 else desired), "application/json"
        writes += 1
        raise publish_gist.AmbiguousWriteError("unknown")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--title", "New", "--json"],
        handler,
        stdin="",
    )

    assert result == 0
    assert json.loads(output) == desired
    assert error == ""
    assert reads == 2
    assert writes == 1


def test_ambiguous_create_is_not_retried(monkeypatch, capsys):
    writes = 0

    def handler(_url, **kwargs):
        nonlocal writes
        writes += 1
        raise publish_gist.AmbiguousWriteError("unknown")

    result, output, error = _run(monkeypatch, capsys, ["--json"], handler)

    assert result == 1
    assert output == ""
    assert "unknown" in error
    assert writes == 1


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda data: data.update(id="B" * 16), "invalid gist response"),
        (lambda data: data.update(revision_number=1), "invalid gist response"),
        (lambda data: data.update(snapshot_sha256="b" * 64), "invalid gist response"),
        (
            lambda data: data["files"]["README.md"].update(content="# Changed\n"),
            "invalid gist response",
        ),
        (
            lambda data: data["files"].update(
                {"readme.MD": data["files"]["README.md"]}
            ),
            "invalid gist response",
        ),
        (
            lambda data: data["files"]["README.md"].update(
                raw_url="http://127.0.0.1/private"
            ),
            "invalid gist response",
        ),
    ],
)
def test_read_response_rejects_wrong_identity_digest_or_files(mutate, message):
    response = _gist_payload()
    mutate(response)

    with pytest.raises(publish_gist.CliError, match=message):
        publish_gist.validate_gist_response(response, GIST_ID, 2)


def test_verify_checks_each_raw_file_render_and_public_revision(monkeypatch, capsys):
    current = _gist_payload(title="Old")
    published = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="Plan",
    )
    exact = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="Plan",
        pin_raw_revision=True,
    )
    revision_url = f"{GIST_URL}/revisions/3"
    seen = []

    def handler(url, **kwargs):
        method = kwargs.get("method", "GET")
        accept = kwargs.get("accept", "application/json")
        seen.append((url, method, accept))
        if method == "PATCH":
            return _json_bytes(published), "application/json"
        if url.endswith(f"/{GIST_ID}/render"):
            return _json_bytes(current), "application/json"
        if url.endswith(f"/{GIST_ID}/revisions/3/render"):
            return _json_bytes(exact), "application/json"
        for filename, content in FILES.items():
            if url == exact["files"][filename]["raw_url"]:
                return content.encode(), "text/plain; charset=utf-8"
        if url == revision_url:
            page = f"<html><body>Plan {' '.join(FILES)}</body></html>"
            return page.encode(), "text/html; charset=utf-8"
        raise AssertionError(url)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--title", "Plan", "--verify", "--json"],
        handler,
        stdin="",
    )

    assert result == 0
    assert json.loads(output) == published
    assert error == ""
    raw_calls = [call for call in seen if call[2] == "text/plain"]
    assert len(raw_calls) == len(FILES)
    assert all(call[1] == "GET" for call in raw_calls)


def test_verify_failure_reports_already_created_revision(monkeypatch, capsys):
    current = _gist_payload(title="Old")
    published = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="Plan",
    )
    bad_exact = _gist_payload(
        revision_number=3,
        latest_revision_number=3,
        title="Plan",
        files={**FILES, "check.py": "changed\n"},
        pin_raw_revision=True,
    )

    def handler(url, **kwargs):
        if kwargs.get("method") == "PATCH":
            return _json_bytes(published), "application/json"
        if url.endswith(f"/{GIST_ID}/render"):
            return _json_bytes(current), "application/json"
        if url.endswith(f"/{GIST_ID}/revisions/3/render"):
            return _json_bytes(bad_exact), "application/json"
        raise AssertionError(url)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--title", "Plan", "--verify", "--json"],
        handler,
        stdin="",
    )

    assert result == 1
    assert output == ""
    assert "Published revision was already created" in error
    assert GIST_URL in error
    assert "revision 3" in error
    assert f"snapshot {published['snapshot_sha256']}" in error


@pytest.mark.parametrize(
    "filename",
    ["../secret", "folder/file.md", "folder\\file.md", ".", "..", " name.md", "a\u202eb.md"],
)
def test_unsafe_filenames_are_rejected(filename):
    with pytest.raises(publish_gist.CliError):
        publish_gist.validate_files({filename: "content"})


def test_casefold_and_normalization_collisions_are_rejected():
    with pytest.raises(publish_gist.CliError, match="colliding"):
        publish_gist.validate_files({"README.md": "one", "readme.MD": "two"})
    with pytest.raises(publish_gist.CliError, match="colliding"):
        publish_gist.validate_files({"café.md": "one", "café.md": "two"})


def test_output_dir_must_be_empty(tmp_path):
    output_dir = tmp_path / "gist"
    output_dir.mkdir()
    (output_dir / "keep.txt").write_text("keep")

    with pytest.raises(publish_gist.CliError, match="empty"):
        publish_gist.materialize_files(_gist_payload(), str(output_dir))

    assert (output_dir / "keep.txt").read_text() == "keep"


@pytest.mark.parametrize(
    "argv",
    [
        ["--read"],
        ["--read", "--gist", GIST_ID, "--verify"],
        ["--read", "--gist", GIST_ID, "--delete-file", "README.md"],
        ["--clear-title"],
        ["--delete-file", "README.md"],
        ["--output-dir", "out"],
        ["--check-key", "--json"],
        ["--title", "one", "--clear-title", "--gist", GIST_ID],
    ],
)
def test_option_conflicts_return_usage_error(monkeypatch, capsys, argv):
    monkeypatch.setattr(
        publish_gist,
        "wavey_token",
        lambda: (_ for _ in ()).throw(AssertionError("must not discover key")),
    )

    assert publish_gist.main(argv) == 2
    assert capsys.readouterr().err


@pytest.mark.parametrize(
    ("argv", "response"),
    [
        (["--read", "--gist", GIST_ID, "--json"], {"id": GIST_ID}),
        (["--gist", GIST_ID, "--json"], {"id": GIST_ID, "url": GIST_URL}),
    ],
)
def test_malformed_api_responses_fail_without_partial_output(
    monkeypatch,
    capsys,
    argv,
    response,
):
    def handler(_url, **_kwargs):
        return _json_bytes(response), "application/json"

    result, output, error = _run(monkeypatch, capsys, argv, handler)

    assert result == 1
    assert output == ""
    assert "invalid" in error.lower()


def test_errors_redact_discovered_secret(monkeypatch, capsys):
    def handler(_url, **_kwargs):
        raise publish_gist.CliError(f"backend echoed {TOKEN}")

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID],
        handler,
    )

    assert result == 1
    assert output == ""
    assert TOKEN not in error
    assert "[REDACTED]" in error
