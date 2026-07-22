import pytest

from gist_api.errors import GistError
from gist_api.gist_files import (
    file_kind,
    lead_filename,
    normalize_files,
    snapshot_sha256,
    validate_file_contents,
)


def files(payload):
    return normalize_files(
        {filename: {"content": content} for filename, content in payload.items()}
    )


def test_filename_normalization_and_collision_rules():
    normalized = files({"cafe\u0301.md": "hello", ".env.example": "A=1"})
    assert set(normalized) == {"café.md", ".env.example"}

    for payload in (
        {"Readme.md": "one", "README.MD": "two"},
        {"café.md": "one", "cafe\u0301.md": "two"},
    ):
        with pytest.raises(GistError, match="duplicate filename"):
            files(payload)


@pytest.mark.parametrize(
    "filename",
    ["", ".", "..", "../x", "a/b", "a\\b", " leading", "trailing ", "bad\nname", "bad\u200dname"],
)
def test_unsafe_filenames_are_rejected(filename):
    with pytest.raises(GistError):
        files({filename: "content"})


def test_filename_and_file_count_limits():
    files({"é" * 127: "ok"})
    with pytest.raises(GistError, match="too long"):
        files({"é" * 128: "no"})
    assert len(files({f"file-{index}.txt": "x" for index in range(32)})) == 32
    with pytest.raises(GistError, match="too many files"):
        files({f"file-{index}.txt": "x" for index in range(33)})
    with pytest.raises(GistError, match="at least one file"):
        files({})


def test_content_normalization_and_aggregate_byte_limit():
    normalized = files({"README.md": "a\r\nb\rc", "empty.txt": ""})
    assert normalized["README.md"].content == "a\nb\nc"
    assert normalized["empty.txt"].byte_size == 0

    validate_file_contents(files({"a.txt": "é" * 5}), max_text_bytes=10)
    with pytest.raises(GistError) as error:
        validate_file_contents(files({"a.txt": "é" * 5 + "x"}), max_text_bytes=10)
    assert error.value.status == 413
    with pytest.raises(GistError, match="gist content is required"):
        validate_file_contents(files({"a.txt": "", "b.txt": " \n"}))
    with pytest.raises(GistError, match="NUL"):
        files({"bad.txt": "a\x00b"})


def test_lead_file_and_classification_are_deterministic():
    assert lead_filename(["z.py", "b.md", "a.markdown"]) == "a.markdown"
    assert lead_filename(["z.py", "README.md", "a.md"]) == "README.md"
    assert lead_filename(["z.txt", "a.py"]) == "a.py"
    assert file_kind("README.MD") == "markdown"
    assert file_kind("test.py") == "source"
    assert file_kind("LICENSE") == "text"


def test_snapshot_digest_is_order_independent_and_covers_all_editable_state():
    first = files({"b.py": "print(2)\n", "README.md": "# One\n"})
    reordered = files({"README.md": "# One\n", "b.py": "print(2)\n"})
    baseline = snapshot_sha256(None, first)
    assert baseline == snapshot_sha256(None, reordered)
    assert baseline == "7da63446e5bf5c558e51b5b9af7c60bc119bc51b13fee5b12aba8272c26ad39a"

    assert snapshot_sha256("Title", first) != baseline
    assert snapshot_sha256(None, files({"README.md": "# One\n"})) != baseline
    assert snapshot_sha256(
        None, files({"README.md": "# One\n", "renamed.py": "print(2)\n"})
    ) != baseline
    assert snapshot_sha256(
        None, files({"README.md": "# Two\n", "b.py": "print(2)\n"})
    ) != baseline
