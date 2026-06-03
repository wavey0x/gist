import os


def _int_env(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return int(value)


def _bool_env(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_settings():
    max_markdown_bytes = _int_env("MAX_MARKDOWN_BYTES", 1048576)
    return {
        "SQLITE_DB_PATH": os.getenv("SQLITE_DB_PATH"),
        "PUBLIC_GIST_BASE_URL": os.getenv(
            "PUBLIC_GIST_BASE_URL",
            "http://localhost:3000",
        ),
        "PORT": _int_env("PORT", 3001),
        "MAX_MARKDOWN_BYTES": max_markdown_bytes,
        "MAX_REQUEST_BYTES": _int_env("MAX_REQUEST_BYTES", None),
        "ALLOW_EMPTY_MARKDOWN": _bool_env("ALLOW_EMPTY_MARKDOWN", False),
        "SQLITE_BUSY_TIMEOUT_MS": _int_env("SQLITE_BUSY_TIMEOUT_MS", 5000),
        "API_WRITE_LIMIT_PER_24H": _int_env("API_WRITE_LIMIT_PER_24H", 150),
        "API_AUTH_FAILURE_LIMIT_PER_MINUTE": _int_env(
            "API_AUTH_FAILURE_LIMIT_PER_MINUTE",
            20,
        ),
    }
