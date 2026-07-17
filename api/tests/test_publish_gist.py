import hashlib
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
MARKDOWN = "# Plan\n\nSafe changes.\n"
DIGEST = hashlib.sha256(MARKDOWN.encode()).hexdigest()
TOKEN = "wapi_gist_testpref_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"


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


def _read_payload(revision_number=2, markdown=MARKDOWN, digest=DIGEST):
    return {
        "id": GIST_ID,
        "revision_number": revision_number,
        "latest_revision_number": 2,
        "content_sha256": digest,
        "markdown": markdown,
        "rendered_html": "<h1>Plan</h1>",
        "history": [],
    }


def _write_payload(revision_number=2, digest=DIGEST):
    return {
        "id": GIST_ID,
        "url": GIST_URL,
        "revision_number": revision_number,
        "content_sha256": digest,
    }


def _run(monkeypatch, capsys, argv, handler, *, stdin=MARKDOWN):
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
        f"{GIST_URL}/raw",
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
def test_read_json_is_public_and_reads_the_requested_revision(
    monkeypatch,
    capsys,
    target,
    expected_revision,
):
    def no_credentials():
        raise AssertionError("read mode must not discover credentials")

    def handler(url, **kwargs):
        if expected_revision == 1:
            assert url.endswith(f"/{GIST_ID}/revisions/1/render")
        else:
            assert url.endswith(f"/{GIST_ID}/render")
        assert kwargs["token"] is None
        return _json_bytes(
            _read_payload(revision_number=expected_revision)
        ), "application/json"

    monkeypatch.setattr(publish_gist, "wavey_token", no_credentials)
    monkeypatch.setattr(publish_gist, "_request", handler)

    result = publish_gist.main(["--read", "--gist", target, "--json"])
    output = json.loads(capsys.readouterr().out)

    assert result == 0
    assert output == {
        "id": GIST_ID,
        "revision_number": expected_revision,
        "latest_revision_number": 2,
        "content_sha256": DIGEST,
        "markdown": MARKDOWN,
    }


def test_read_without_json_prints_only_markdown(monkeypatch, capsys):
    def handler(_url, **_kwargs):
        return _json_bytes(_read_payload()), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--read", "--gist", GIST_ID],
        handler,
        stdin="",
    )

    assert result == 0
    assert output == MARKDOWN
    assert error == ""


def test_create_json_success(monkeypatch, capsys):
    def handler(url, **kwargs):
        assert url == "https://api.wavey.info/api/v1/gists"
        assert kwargs["method"] == "POST"
        assert kwargs["token"] == TOKEN
        assert kwargs["payload"] == {"markdown": MARKDOWN, "title": "Plan"}
        return _json_bytes(_write_payload(revision_number=1)), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--title", "Plan", "--json"],
        handler,
    )

    assert result == 0
    assert json.loads(output) == {
        "url": GIST_URL,
        "revision_number": 1,
        "content_sha256": DIGEST,
    }
    assert error == ""


def test_update_sends_expected_digest_and_uses_latest_gist_target(
    monkeypatch,
    capsys,
):
    def handler(url, **kwargs):
        assert url == f"https://api.wavey.info/api/v1/gists/{GIST_ID}"
        assert kwargs["method"] == "PATCH"
        assert kwargs["payload"] == {
            "markdown": MARKDOWN,
            "expected_content_sha256": "b" * 64,
        }
        return _json_bytes(_write_payload()), "application/json"

    result, output, error = _run(
        monkeypatch,
        capsys,
        [
            "--gist",
            f"{GIST_URL}/revisions/1",
            "--expected-content-sha256",
            "b" * 64,
            "--json",
        ],
        handler,
    )

    assert result == 0
    assert json.loads(output)["revision_number"] == 2
    assert error == ""


def test_http_conflict_preserves_status_and_backend_code(monkeypatch):
    response = io.BytesIO(
        _json_bytes({"error": {"code": "conflict", "message": "Conflict"}})
    )
    error = urllib.error.HTTPError(
        GIST_URL,
        409,
        "Conflict",
        {},
        response,
    )

    def fail(_request, timeout):
        assert timeout == 30
        raise error

    monkeypatch.setattr(publish_gist.urllib.request, "urlopen", fail)

    with pytest.raises(
        publish_gist.CliError,
        match="Wavey API error 409: conflict: Conflict",
    ):
        publish_gist._request(GIST_URL)


def test_update_conflict_exits_nonzero_without_success_output(
    monkeypatch,
    capsys,
):
    def handler(_url, **_kwargs):
        raise publish_gist.CliError(
            "Wavey API error 409: conflict: Conflict"
        )

    result, output, error = _run(
        monkeypatch,
        capsys,
        [
            "--gist",
            GIST_ID,
            "--expected-content-sha256",
            "b" * 64,
            "--json",
        ],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "409: conflict: Conflict" in error


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "B" * 16),
        ("revision_number", 1),
    ],
)
def test_exact_revision_read_rejects_wrong_identity(field, value):
    response = _read_payload()
    response[field] = value

    with pytest.raises(
        publish_gist.CliError,
        match="invalid gist read response",
    ):
        publish_gist.validate_read_response(response, GIST_ID, 2)


def test_verify_checks_exact_raw_render_and_public_revision(monkeypatch, capsys):
    revision_url = f"{GIST_URL}/revisions/2"
    seen = []

    def handler(url, **kwargs):
        method = kwargs.get("method", "GET")
        accept = kwargs.get("accept", "application/json")
        seen.append((url, method, accept))
        if method == "PATCH":
            return _json_bytes(_write_payload()), "application/json"
        if url == f"{revision_url}/raw":
            return MARKDOWN.encode(), "text/plain; charset=utf-8"
        if url.endswith(f"/{GIST_ID}/revisions/2/render"):
            return _json_bytes(_read_payload()), "application/json"
        if url == revision_url:
            return b"<!doctype html>", "text/html; charset=utf-8"
        raise AssertionError(url)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--verify", "--json"],
        handler,
    )

    assert result == 0
    assert json.loads(output)["content_sha256"] == DIGEST
    assert error == ""
    assert seen == [
        (
            f"https://api.wavey.info/api/v1/gists/{GIST_ID}",
            "PATCH",
            "application/json",
        ),
        (f"{revision_url}/raw", "GET", "text/plain"),
        (
            f"https://api.wavey.info/api/v1/gists/{GIST_ID}/revisions/2/render",
            "GET",
            "application/json",
        ),
        (revision_url, "GET", "text/html"),
    ]


@pytest.mark.parametrize(
    ("write_digest", "raw_body", "render_markdown", "render_digest", "page_type"),
    [
        ("b" * 64, MARKDOWN.encode(), MARKDOWN, DIGEST, "text/html"),
        (DIGEST, b"# Different\n", MARKDOWN, DIGEST, "text/html"),
        (DIGEST, MARKDOWN.encode(), "# Different\n", DIGEST, "text/html"),
        (DIGEST, MARKDOWN.encode(), MARKDOWN, "b" * 64, "text/html"),
        (DIGEST, MARKDOWN.encode(), MARKDOWN, DIGEST, "text/plain"),
    ],
)
def test_verify_failure_reports_the_already_created_revision(
    monkeypatch,
    capsys,
    write_digest,
    raw_body,
    render_markdown,
    render_digest,
    page_type,
):
    revision_url = f"{GIST_URL}/revisions/2"

    def handler(url, **kwargs):
        if kwargs.get("method", "GET") == "PATCH":
            return _json_bytes(_write_payload(digest=write_digest)), "application/json"
        if url == f"{revision_url}/raw":
            return raw_body, "text/plain"
        if url.endswith(f"/{GIST_ID}/revisions/2/render"):
            return _json_bytes(
                _read_payload(
                    markdown=render_markdown,
                    digest=render_digest,
                )
            ), "application/json"
        if url == revision_url:
            return b"page", page_type
        raise AssertionError(url)

    result, output, error = _run(
        monkeypatch,
        capsys,
        ["--gist", GIST_ID, "--verify", "--json"],
        handler,
    )

    assert result == 1
    assert output == ""
    assert "Published revision was already created" in error
    assert GIST_URL in error
    assert "revision 2" in error
    assert f"sha256 {write_digest}" in error


@pytest.mark.parametrize(
    "argv",
    [
        ["--read"],
        ["--read", "--gist", GIST_ID, "--verify"],
        ["--expected-content-sha256", "a" * 64],
        ["--gist", GIST_ID, "--expected-content-sha256", "A" * 64],
        ["--check-key", "--json"],
    ],
)
def test_option_conflicts_and_invalid_digests_return_usage_error(
    monkeypatch,
    capsys,
    argv,
):
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
        (
            ["--read", "--gist", GIST_ID, "--json"],
            {"id": GIST_ID, "markdown": MARKDOWN},
        ),
        (
            ["--gist", GIST_ID, "--json"],
            {"id": GIST_ID, "url": GIST_URL},
        ),
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
    assert "invalid" in error


def test_errors_redact_the_discovered_secret(monkeypatch, capsys):
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
