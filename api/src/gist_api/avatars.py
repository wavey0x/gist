import hashlib
from pathlib import Path
from urllib.parse import urlparse

from flask import current_app, send_from_directory

from .db import get_gist_db_path


AVATAR_FILE_RE = r"[a-f0-9]{64}\.(?:png|jpg|webp)"
MAX_AVATAR_BYTES = 2 * 1024 * 1024


def _avatar_storage_dir(app=None):
    configured = None
    if app is not None:
        configured = app.config.get("AVATAR_STORAGE_DIR")
    if configured:
        return Path(configured).expanduser()

    db_path = get_gist_db_path(app)
    if db_path == ":memory:":
        raise RuntimeError("AVATAR_STORAGE_DIR must be set for in-memory databases")
    return Path(db_path).expanduser().resolve().parent / "avatars"


def _public_api_base_url(app):
    return app.config.get("PUBLIC_API_BASE_URL", "http://localhost:3001").rstrip("/")


def avatar_url_for_filename(app, filename):
    return f"{_public_api_base_url(app)}/api/v1/avatars/{filename}"


def normalize_avatar_url(avatar_url):
    if avatar_url is None:
        return None
    avatar_url = avatar_url.strip()
    if not avatar_url:
        return None
    if len(avatar_url) > 2048:
        raise ValueError("avatar_url is too long")
    parsed = urlparse(avatar_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("avatar_url must be an http(s) URL")
    return avatar_url


def _avatar_image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ValueError("avatar_file must be a PNG, JPEG, or WebP image")


def save_avatar_file(app, avatar_file):
    source = Path(avatar_file).expanduser()
    data = source.read_bytes()
    if not data:
        raise ValueError("avatar_file is empty")
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError("avatar_file is too large")

    extension = _avatar_image_type(data)
    digest = hashlib.sha256(data).hexdigest()
    filename = f"{digest}.{extension}"
    storage_dir = _avatar_storage_dir(app)
    storage_dir.mkdir(parents=True, exist_ok=True)
    target = storage_dir / filename
    if not target.exists():
        target.write_bytes(data)
        target.chmod(0o600)
    return avatar_url_for_filename(app, filename)


def send_avatar_file(filename):
    return send_from_directory(
        _avatar_storage_dir(current_app),
        filename,
        max_age=31536000,
    )
