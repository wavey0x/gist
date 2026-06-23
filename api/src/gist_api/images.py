import base64
import errno
import hashlib
import os
import re
import secrets
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import Path

from flask import current_app, send_file

from .auth import utc_now
from .db import get_gist_db_path, gist_connection
from .errors import GistError


IMAGE_ID_RE = re.compile(r"^img_[A-Za-z0-9_-]{16,64}$")
SUPPORTED_IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
}
IMAGE_RETRY_HINT = "Try publishing again without images or with smaller images."
IMAGE_STORAGE_CAPACITY_ERRNOS = {
    errno.EDQUOT,
    errno.EFBIG,
    errno.ENOSPC,
}


@dataclass(frozen=True)
class StagedImage:
    tmp_path: Path
    original_filename: str
    sha256: str
    mime_type: str
    extension: str
    byte_size: int
    width: int
    height: int


def _image_storage_dir(app=None):
    configured = None
    if app is not None:
        configured = app.config.get("IMAGE_STORAGE_DIR")
    if configured:
        return Path(configured).expanduser()

    db_path = get_gist_db_path(app)
    if db_path == ":memory:":
        raise RuntimeError("IMAGE_STORAGE_DIR must be set for in-memory databases")
    return Path(db_path).expanduser().resolve().parent / "images"


def _public_api_base_url(app):
    return app.config.get("PUBLIC_API_BASE_URL", "http://localhost:3001").rstrip("/")


def _image_url(app, public_id):
    return f"{_public_api_base_url(app)}/api/v1/images/{public_id}"


def _base64url_random(byte_count):
    return base64.urlsafe_b64encode(secrets.token_bytes(byte_count)).rstrip(b"=").decode(
        "ascii"
    )


def _new_public_id():
    return f"img_{_base64url_random(16)}"


def _raise_if_storage_capacity_error(exc):
    if getattr(exc, "errno", None) in IMAGE_STORAGE_CAPACITY_ERRNOS:
        raise GistError(
            "image_storage_unavailable",
            f"Server image storage capacity was reached. {IMAGE_RETRY_HINT}",
            507,
        ) from exc


def _normalize_filename(filename):
    filename = (filename or "").strip().replace("\\", "/").rsplit("/", 1)[-1]
    filename = "".join(
        char
        for char in filename
        if char.isprintable() and char not in {"\x00", "\r", "\n"}
    ).strip()
    if not filename:
        raise GistError("invalid_request", "image filename is required", 400)
    if len(filename.encode("utf-8")) > 255:
        raise GistError("invalid_request", "image filename is too long", 400)
    return filename


def _markdown_alt_text(filename):
    return (
        filename.replace("\\", "\\\\")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def _image_markdown(asset):
    return f"![{_markdown_alt_text(asset['original_filename'])}]({asset['url']})"


def _blob_relative_path(sha256, extension):
    return str(Path("sha256") / sha256[:2] / sha256[2:4] / f"{sha256}.{extension}")


def _blob_absolute_path(app, storage_path):
    return _image_storage_dir(app) / storage_path


def _read_exact(data, start, length):
    end = start + length
    if len(data) < end:
        raise ValueError("truncated image")
    return data[start:end]


def _u16be(data, start):
    return int.from_bytes(_read_exact(data, start, 2), "big")


def _u24le(data, start):
    raw = _read_exact(data, start, 3)
    return raw[0] | (raw[1] << 8) | (raw[2] << 16)


def _png_metadata(data):
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    if _read_exact(data, 12, 4) != b"IHDR":
        raise ValueError("invalid PNG image")
    width = int.from_bytes(_read_exact(data, 16, 4), "big")
    height = int.from_bytes(_read_exact(data, 20, 4), "big")
    return "png", SUPPORTED_IMAGE_TYPES["png"], width, height


def _jpeg_metadata(data):
    if not data.startswith(b"\xff\xd8"):
        return None
    offset = 2
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while offset < len(data):
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        segment_length = _u16be(data, offset)
        if segment_length < 2:
            raise ValueError("invalid JPEG image")
        if marker in sof_markers:
            height = _u16be(data, offset + 3)
            width = _u16be(data, offset + 5)
            return "jpg", SUPPORTED_IMAGE_TYPES["jpg"], width, height
        offset += segment_length
    raise ValueError("invalid JPEG image")


def _webp_metadata(data):
    if not (data.startswith(b"RIFF") and _read_exact(data, 8, 4) == b"WEBP"):
        return None
    chunk = _read_exact(data, 12, 4)
    if chunk == b"VP8X":
        width = _u24le(data, 24) + 1
        height = _u24le(data, 27) + 1
        return "webp", SUPPORTED_IMAGE_TYPES["webp"], width, height
    if chunk == b"VP8L":
        bits = int.from_bytes(_read_exact(data, 21, 4), "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return "webp", SUPPORTED_IMAGE_TYPES["webp"], width, height
    if chunk == b"VP8 ":
        frame = data.find(b"\x9d\x01\x2a", 20)
        if frame == -1:
            raise ValueError("invalid WebP image")
        width = int.from_bytes(_read_exact(data, frame + 3, 2), "little") & 0x3FFF
        height = int.from_bytes(_read_exact(data, frame + 5, 2), "little") & 0x3FFF
        return "webp", SUPPORTED_IMAGE_TYPES["webp"], width, height
    raise ValueError("invalid WebP image")


def _image_metadata(data):
    try:
        metadata = (
            _png_metadata(data)
            or _jpeg_metadata(data)
            or _webp_metadata(data)
        )
    except ValueError as exc:
        raise GistError("invalid_request", str(exc), 400) from exc
    if metadata is None:
        raise GistError("invalid_request", "unsupported image type", 400)
    extension, mime_type, width, height = metadata
    if width <= 0 or height <= 0:
        raise GistError("invalid_request", "invalid image dimensions", 400)
    return extension, mime_type, width, height


def _validate_dimensions(app, width, height):
    max_dimension = int(app.config.get("IMAGE_MAX_DIMENSION", 4096))
    if width > max_dimension or height > max_dimension:
        raise GistError("invalid_request", "image dimensions are too large", 400)


def _stage_image(app, file_storage):
    filename = _normalize_filename(getattr(file_storage, "filename", None))
    max_bytes = int(app.config.get("IMAGE_MAX_BYTES", 20 * 1024 * 1024))
    storage_dir = _image_storage_dir(app)
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        tmp_file = tempfile.NamedTemporaryFile(
            prefix=".upload-",
            suffix=".tmp",
            dir=storage_dir,
            delete=False,
        )
    except OSError as exc:
        _raise_if_storage_capacity_error(exc)
        raise

    digest = hashlib.sha256()
    byte_count = 0
    tmp_path = Path(tmp_file.name)
    try:
        with tmp_file:
            while True:
                chunk = file_storage.stream.read(1024 * 1024)
                if not chunk:
                    break
                byte_count += len(chunk)
                if byte_count > max_bytes:
                    raise GistError(
                        "payload_too_large",
                        (
                            "Image is too large. Try publishing again without this "
                            "image or with a smaller image."
                        ),
                        413,
                    )
                digest.update(chunk)
                tmp_file.write(chunk)

        if byte_count == 0:
            raise GistError("invalid_request", "image file is empty", 400)

        data = tmp_path.read_bytes()
        extension, mime_type, width, height = _image_metadata(data)
        _validate_dimensions(app, width, height)
        return StagedImage(
            tmp_path=tmp_path,
            original_filename=filename,
            sha256=digest.hexdigest(),
            mime_type=mime_type,
            extension=extension,
            byte_size=byte_count,
            width=width,
            height=height,
        )
    except Exception as exc:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        if isinstance(exc, OSError):
            _raise_if_storage_capacity_error(exc)
        raise


def _stage_images(app, file_storages):
    files = [file for file in file_storages if getattr(file, "filename", None)]
    max_count = int(app.config.get("IMAGE_MAX_PER_REQUEST", 10))
    if len(files) > max_count:
        raise GistError("invalid_request", "too many images", 400)

    staged = []
    filenames = set()
    try:
        for file_storage in files:
            staged_image = _stage_image(app, file_storage)
            if staged_image.original_filename in filenames:
                raise GistError("invalid_request", "duplicate attachment filename", 400)
            filenames.add(staged_image.original_filename)
            staged.append(staged_image)
    except Exception:
        cleanup_staged_images(staged)
        raise
    return staged


def cleanup_staged_images(staged_images):
    for staged in staged_images:
        try:
            staged.tmp_path.unlink()
        except FileNotFoundError:
            pass


def _quota_bytes(conn):
    row = conn.execute(
        """
        select coalesce(sum(byte_size), 0) as total
        from image_blobs
        where deleted_at is null
        """
    ).fetchone()
    return int(row["total"])


def _new_blob_bytes(conn, staged_images):
    by_sha = {}
    for staged in staged_images:
        by_sha.setdefault(staged.sha256, staged)
    if not by_sha:
        return 0

    existing = {
        row["sha256"]
        for row in conn.execute(
            f"""
            select sha256
            from image_blobs
            where deleted_at is null
              and sha256 in ({','.join('?' for _ in by_sha)})
            """,
            tuple(by_sha),
        )
    }
    return sum(
        staged.byte_size
        for sha256, staged in by_sha.items()
        if sha256 not in existing
    )


def _ensure_quota(conn, app, staged_images):
    limit = int(app.config.get("IMAGE_STORAGE_LIMIT_BYTES", 5 * 1024 * 1024 * 1024))
    if _quota_bytes(conn) + _new_blob_bytes(conn, staged_images) > limit:
        raise GistError(
            "storage_quota_exceeded",
            f"Server image storage quota was reached. {IMAGE_RETRY_HINT}",
            413,
        )


def _install_blob_file(app, staged):
    relative_path = _blob_relative_path(staged.sha256, staged.extension)
    final_path = _blob_absolute_path(app, relative_path)
    try:
        final_path.parent.mkdir(parents=True, exist_ok=True)
        if final_path.exists():
            staged.tmp_path.unlink()
        else:
            os.replace(staged.tmp_path, final_path)
            final_path.chmod(0o600)
    except OSError as exc:
        _raise_if_storage_capacity_error(exc)
        raise
    return relative_path


def _asset_body(app, public_id, staged):
    url = _image_url(app, public_id)
    body = {
        "id": public_id,
        "url": url,
        "original_filename": staged.original_filename,
        "mime_type": staged.mime_type,
        "byte_size": staged.byte_size,
        "width": staged.width,
        "height": staged.height,
    }
    body["markdown"] = _image_markdown(body)
    return body


def plan_image_assets(app, staged_images):
    return [_asset_body(app, _new_public_id(), staged) for staged in staged_images]


def insert_image_assets(conn, app, key_id, staged_images, assets):
    if not staged_images:
        return []
    if len(staged_images) != len(assets):
        raise GistError("internal_error", "Internal error", 500)

    _ensure_quota(conn, app, staged_images)
    now = utc_now()
    for staged, asset in zip(staged_images, assets):
        storage_path = _install_blob_file(app, staged)
        conn.execute(
            """
            insert or ignore into image_blobs(
                sha256, storage_path, mime_type, file_extension, byte_size,
                width, height, ref_count, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                staged.sha256,
                storage_path,
                staged.mime_type,
                staged.extension,
                staged.byte_size,
                staged.width,
                staged.height,
                now,
            ),
        )
        try:
            conn.execute(
                """
                insert into image_assets(
                    public_id, owner_key_id, sha256, original_filename,
                    created_at
                )
                values (?, ?, ?, ?, ?)
                """,
                (
                    asset["id"],
                    key_id,
                    staged.sha256,
                    staged.original_filename,
                    now,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise GistError("internal_error", "Internal error", 500) from exc

        conn.execute(
            """
            update image_blobs
            set ref_count = ref_count + 1
            where sha256 = ?
            """,
            (staged.sha256,),
        )
    return assets


def stage_images(app, file_storages):
    return _stage_images(app, file_storages)


def create_image_assets(app, key_id, file_storages):
    staged_images = _stage_images(app, file_storages)
    assets = plan_image_assets(app, staged_images)
    try:
        with gist_connection(app) as conn:
            with conn:
                return insert_image_assets(conn, app, key_id, staged_images, assets)
    except Exception:
        cleanup_staged_images(staged_images)
        raise


def create_image_asset(app, key_id, file_storage):
    assets = create_image_assets(app, key_id, [file_storage])
    if not assets:
        raise GistError("invalid_request", "image file is required", 400)
    return assets[0]


def rewrite_attachment_markdown(markdown, assets):
    if not assets:
        return markdown

    referenced = set()
    for asset in assets:
        token = f"attachment:{asset['original_filename']}"
        if token in markdown:
            markdown = markdown.replace(token, asset["url"])
            referenced.add(asset["id"])

    unreferenced = [
        asset["markdown"]
        for asset in assets
        if asset["id"] not in referenced
    ]
    if unreferenced:
        suffix = "\n".join(unreferenced)
        markdown = f"{markdown.rstrip()}\n\n{suffix}" if markdown.strip() else suffix
    return markdown


def get_image_asset(app, public_id):
    if not IMAGE_ID_RE.fullmatch(public_id or ""):
        raise GistError("not_found", "Not found", 404)

    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select image_blobs.storage_path, image_blobs.mime_type
            from image_assets
            join image_blobs on image_blobs.sha256 = image_assets.sha256
            where image_assets.public_id = ?
              and image_assets.deleted_at is null
              and image_blobs.deleted_at is null
            """,
            (public_id,),
        ).fetchone()

    if row is None:
        raise GistError("not_found", "Not found", 404)

    path = _blob_absolute_path(app, row["storage_path"])
    if not path.exists():
        raise GistError("not_found", "Not found", 404)
    return path, row["mime_type"]


def send_image_asset(public_id):
    path, mime_type = get_image_asset(current_app, public_id)
    return send_file(
        path,
        mimetype=mime_type,
        max_age=31536000,
        conditional=True,
        etag=True,
    )
