import os

from .external_ids import DEFAULT_EXTERNAL_ID_LENGTH


def _int_env(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return int(value)


def load_settings():
    max_markdown_bytes = _int_env("MAX_MARKDOWN_BYTES", 1048576)
    image_max_bytes = _int_env("GIST_IMAGE_MAX_BYTES", 20 * 1024 * 1024)
    image_max_per_request = _int_env("GIST_IMAGE_MAX_PER_REQUEST", 10)
    return {
        "SQLITE_DB_PATH": os.getenv("SQLITE_DB_PATH"),
        "PUBLIC_GIST_BASE_URL": os.getenv(
            "PUBLIC_GIST_BASE_URL",
            "http://localhost:3000",
        ),
        "PUBLIC_API_BASE_URL": os.getenv(
            "PUBLIC_API_BASE_URL",
            "http://localhost:3001",
        ),
        "AVATAR_STORAGE_DIR": os.getenv("AVATAR_STORAGE_DIR"),
        "IMAGE_STORAGE_DIR": os.getenv("GIST_IMAGE_STORAGE_DIR"),
        "IMAGE_STORAGE_LIMIT_BYTES": _int_env(
            "GIST_IMAGE_STORAGE_LIMIT_BYTES",
            5 * 1024 * 1024 * 1024,
        ),
        "IMAGE_MAX_BYTES": image_max_bytes,
        "IMAGE_MAX_DIMENSION": _int_env("GIST_IMAGE_MAX_DIMENSION", 4096),
        "IMAGE_MAX_PER_REQUEST": image_max_per_request,
        "MAX_MULTIPART_REQUEST_BYTES": _int_env(
            "MAX_MULTIPART_REQUEST_BYTES",
            max_markdown_bytes + (image_max_bytes * image_max_per_request) + 8192,
        ),
        "MAX_MARKDOWN_BYTES": max_markdown_bytes,
        "MAX_REQUEST_BYTES": _int_env("MAX_REQUEST_BYTES", None),
        "SQLITE_BUSY_TIMEOUT_MS": _int_env("SQLITE_BUSY_TIMEOUT_MS", 5000),
        "API_WRITE_LIMIT_PER_24H": _int_env("API_WRITE_LIMIT_PER_24H", 150),
        "API_AUTH_FAILURE_LIMIT_PER_MINUTE": _int_env(
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE",
            20,
        ),
        "GIST_EXTERNAL_ID_LENGTH": _int_env(
            "GIST_EXTERNAL_ID_LENGTH",
            DEFAULT_EXTERNAL_ID_LENGTH,
        ),
    }
