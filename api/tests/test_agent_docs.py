import json
import re
from pathlib import Path


LLMS_SOURCE = (
    Path(__file__).resolve().parents[2]
    / "ui"
    / "app"
    / "llms.txt"
    / "llms.txt.ts"
)


def _generated_llms_text():
    source = LLMS_SOURCE.read_text(encoding="utf-8")
    encoded_lines = re.findall(
        r'^\s+"((?:[^"\\]|\\.)*)",?\s*$',
        source,
        flags=re.MULTILINE,
    )
    return "\n".join(json.loads(f'"{line}"') for line in encoded_lines)


def test_llms_text_teaches_current_agent_safe_workflow():
    text = _generated_llms_text()

    assert "publish-gist read <url-or-id>" in text
    assert "publish-gist create README.md" in text
    assert "publish-gist create README.md --image chart.png" in text
    assert "publish-gist update <url-or-id> README.md" in text
    assert "--delete <filename>" in text
    assert "publish-gist check" in text
    assert "do not stream generated Markdown" in text
    assert "WAVEY_GIST_API_KEY" in text
    assert "snapshot_sha256" in text
    assert "expected_snapshot_sha256" in text
    assert "complete replacement snapshot" in text
    assert "not an overlay" in text
    assert "published under its basename" in text
    assert "repeated `images[]`" in text
    assert "return the public gist URL" in text
    assert "default to one self-contained `README.md`" in text
    assert "language-tagged fenced code blocks" in text
    assert "Use separate files only for standalone artifacts" in text
    assert "Do not publish a separate `.mmd` file" in text
    assert "base62 strings containing 16–64 ASCII letters or digits" in text
    assert "https://gist.wavey.info/{gist_id}/raw/{filename}" in text
    assert "## Find Your Gists" in text
    assert "--data-urlencode 'q=vault fees'" in text
    assert "pagination.next_offset" in text
    assert "does not search old revisions" in text


def test_llms_text_omits_removed_helper_and_environment_aliases():
    text = _generated_llms_text()

    for removed in (
        "WAVEY_API_KEY",
        "WAVEY_API_BASE_URL",
        "--filename",
        "--old-filename",
        "--input-file",
        "--expected-content-sha256",
        "expected_content_sha256",
        "--public",
        "--stdin-name",
        "--output-dir",
        "--summary-json",
        "--verify",
        "--clear-title",
        "--delete-file",
        "SITE_BASE_URL",
        "ALLOW_EMPTY_MARKDOWN",
    ):
        assert removed not in text
