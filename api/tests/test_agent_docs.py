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

    assert "publish-gist --read --gist <url-or-id> --json" in text
    assert "--expected-content-sha256 <sha-from-read>" in text
    assert "--verify" in text
    assert "already-created revision" in text
    assert "WAVEY_GIST_API_KEY" in text
    assert "content_sha256" in text
    assert "repeated `images[]`" in text
    assert "base62 strings containing 16–64 ASCII letters or digits" in text
    assert "https://gist.wavey.info/{gist_id}/raw" in text


def test_llms_text_omits_removed_helper_and_environment_aliases():
    text = _generated_llms_text()

    for removed in (
        "WAVEY_API_KEY",
        "WAVEY_API_BASE_URL",
        "--filename",
        "--old-filename",
        "--input-file",
        "--public",
        "SITE_BASE_URL",
        "ALLOW_EMPTY_MARKDOWN",
    ):
        assert removed not in text
