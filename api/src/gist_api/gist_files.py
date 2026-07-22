import hashlib
import json
import unicodedata
from dataclasses import dataclass

from .errors import GistError


DEFAULT_MAX_FILE_COUNT = 32
DEFAULT_MAX_TEXT_BYTES = 1024 * 1024
MAX_FILENAME_BYTES = 255
MARKDOWN_EXTENSIONS = frozenset({".md", ".markdown"})
LANGUAGE_BY_EXTENSION = {
    ".bash": "shell",
    ".c": "c",
    ".cc": "cpp",
    ".cfg": "ini",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".go": "go",
    ".h": "c",
    ".hpp": "cpp",
    ".html": "html",
    ".ini": "ini",
    ".java": "java",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "jsx",
    ".kt": "kotlin",
    ".md": "markdown",
    ".markdown": "markdown",
    ".mjs": "javascript",
    ".php": "php",
    ".pl": "perl",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".sh": "shell",
    ".sol": "solidity",
    ".sql": "sql",
    ".toml": "toml",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".txt": "text",
    ".vy": "vyper",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".zsh": "shell",
}


@dataclass(frozen=True)
class NormalizedFile:
    filename: str
    content: str
    content_sha256: str
    byte_size: int


def _invalid_filename(message):
    raise GistError("invalid_request", message, 400)


def normalize_filename(value):
    if not isinstance(value, str):
        _invalid_filename("filename must be a string")
    filename = unicodedata.normalize("NFC", value)
    try:
        byte_size = len(filename.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise GistError("invalid_request", "filename must be valid UTF-8", 400) from exc
    if not filename:
        _invalid_filename("filename is required")
    if byte_size > MAX_FILENAME_BYTES:
        _invalid_filename("filename is too long")
    if filename in {".", ".."}:
        _invalid_filename("filename is not allowed")
    if filename != filename.strip():
        _invalid_filename("filename cannot start or end with whitespace")
    if "/" in filename or "\\" in filename:
        _invalid_filename("filename must not contain path separators")
    if any(unicodedata.category(char) in {"Cc", "Cf"} for char in filename):
        _invalid_filename("filename contains unsupported control characters")
    return filename


def filename_collision_key(filename):
    return unicodedata.normalize("NFC", filename.casefold())


def normalize_content(value):
    if not isinstance(value, str):
        raise GistError("invalid_request", "file content must be a string", 400)
    if "\x00" in value:
        raise GistError("invalid_request", "file content must not contain NUL", 400)
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    try:
        normalized.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise GistError(
            "invalid_request", "file content must be valid UTF-8", 400
        ) from exc
    return normalized


def content_sha256(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def normalized_file(filename, content):
    normalized_content = normalize_content(content)
    encoded = normalized_content.encode("utf-8")
    return NormalizedFile(
        filename=filename,
        content=normalized_content,
        content_sha256=hashlib.sha256(encoded).hexdigest(),
        byte_size=len(encoded),
    )


def normalize_files(value, *, max_file_count=DEFAULT_MAX_FILE_COUNT):
    if not isinstance(value, dict):
        raise GistError("invalid_request", "files must be an object", 400)
    if not value:
        raise GistError("invalid_request", "at least one file is required", 400)
    if len(value) > int(max_file_count):
        raise GistError("invalid_request", "too many files", 400)

    normalized = {}
    collision_keys = set()
    for raw_filename, file_value in value.items():
        filename = normalize_filename(raw_filename)
        collision_key = filename_collision_key(filename)
        if filename in normalized or collision_key in collision_keys:
            raise GistError("invalid_request", "duplicate filename", 400)
        if not isinstance(file_value, dict):
            raise GistError(
                "invalid_request", f"file entry must be an object: {filename}", 400
            )
        unknown = sorted(set(file_value) - {"content"})
        if unknown:
            raise GistError(
                "invalid_request",
                f"unknown file field: {unknown[0]}",
                400,
            )
        if "content" not in file_value:
            raise GistError(
                "invalid_request", f"file content is required: {filename}", 400
            )
        normalized[filename] = normalized_file(filename, file_value["content"])
        collision_keys.add(collision_key)
    return normalized


def validate_file_contents(
    files,
    *,
    max_text_bytes=DEFAULT_MAX_TEXT_BYTES,
    require_non_whitespace=True,
):
    total_bytes = sum(file.byte_size for file in files.values())
    if total_bytes > int(max_text_bytes):
        raise GistError("payload_too_large", "Payload too large", 413)
    if require_non_whitespace and not any(
        file.content.strip() for file in files.values()
    ):
        raise GistError("invalid_request", "gist content is required", 400)
    return total_bytes


def file_extension(filename):
    dot = filename.rfind(".")
    if dot <= 0:
        return ""
    return filename[dot:].lower()


def file_kind(filename):
    extension = file_extension(filename)
    if extension in MARKDOWN_EXTENSIONS:
        return "markdown"
    if extension in LANGUAGE_BY_EXTENSION and LANGUAGE_BY_EXTENSION[extension] != "text":
        return "source"
    return "text"


def file_language(filename):
    extension = file_extension(filename)
    if extension in MARKDOWN_EXTENSIONS:
        return "Markdown"
    language = LANGUAGE_BY_EXTENSION.get(extension)
    if not language or language == "text":
        return None
    return language


def ordered_filenames(filenames):
    names = sorted(filenames)
    if "README.md" in names:
        lead = "README.md"
    else:
        markdown_names = [name for name in names if file_kind(name) == "markdown"]
        lead = markdown_names[0] if markdown_names else names[0]
    return [lead, *(name for name in names if name != lead)]


def lead_filename(filenames):
    names = list(filenames)
    if not names:
        raise ValueError("at least one filename is required")
    return ordered_filenames(names)[0]


def snapshot_manifest(title, files):
    return {
        "files": [
            {
                "content_sha256": files[filename].content_sha256,
                "filename": filename,
            }
            for filename in sorted(files)
        ],
        "title": title,
        "version": 1,
    }


def snapshot_sha256(title, files):
    serialized = json.dumps(
        snapshot_manifest(title, files),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()
