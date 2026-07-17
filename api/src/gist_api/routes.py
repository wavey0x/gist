import re
from ipaddress import ip_address

from flask import Blueprint, current_app, jsonify, request

from .avatars import AVATAR_FILE_RE, send_avatar_file
from .auth import (
    WEB_SESSION_COOKIE_NAME,
    WEB_SESSION_TTL_DAYS,
    create_web_session,
    revoke_web_session,
    session_identity,
    verify_api_key,
    verify_web_session,
)
from .db import gist_connection
from .errors import GistError, error_response
from .images import IMAGE_RETRY_HINT, create_image_asset, send_image_asset
from .rate_limits import check_write_rate_limit, record_auth_failure_and_check_limit
from .service import (
    create_gist,
    delete_gist_created_by_key,
    get_gist,
    get_public_render,
    list_gists_created_by_key,
    patch_gist,
)


gists_api = Blueprint("gists_api", __name__)
AVATAR_ROUTE_RE = re.compile(f"^{AVATAR_FILE_RE}$")
CREATE_GIST_FIELDS = frozenset({"title", "markdown"})
UPDATE_GIST_FIELDS = frozenset(
    {"title", "markdown", "expected_content_sha256"}
)
TRUSTED_PROXY_REMOTES = {
    str(ip_address(value))
    for value in ("127.0.0.1", "::1", "::ffff:127.0.0.1")
}


def _normalize_ip(value):
    try:
        return str(ip_address(value.strip()))
    except ValueError:
        return None


def _rightmost_forwarded_ip(header_value):
    for value in reversed(header_value.split(",")):
        parsed = _normalize_ip(value)
        if parsed:
            return parsed
    return None


def _client_ip():
    remote_addr = request.remote_addr or "unknown"
    normalized_remote_addr = _normalize_ip(remote_addr) or remote_addr
    if normalized_remote_addr in TRUSTED_PROXY_REMOTES:
        forwarded = _rightmost_forwarded_ip(request.headers.get("X-Forwarded-For", ""))
        if forwarded:
            return forwarded
        real_ip = _normalize_ip(request.headers.get("X-Real-IP", ""))
        if real_ip:
            return real_ip
    return normalized_remote_addr


def _validate_fields(values, allowed_fields):
    unknown_fields = sorted(set(values.keys()) - set(allowed_fields))
    if unknown_fields:
        raise GistError(
            "invalid_request",
            f"unknown field: {unknown_fields[0]}",
            400,
        )


def parse_json_body(allowed_fields):
    max_bytes = current_app.config.get("MAX_REQUEST_BYTES", 1048576 + 2048)
    if request.content_length is not None and request.content_length > max_bytes:
        raise GistError("payload_too_large", "Payload too large", 413)
    if not request.is_json:
        raise GistError("invalid_request", "JSON body required", 400)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise GistError("invalid_request", "JSON object required", 400)
    _validate_fields(data, allowed_fields)
    return data


def _check_multipart_size():
    max_bytes = current_app.config.get("MAX_MULTIPART_REQUEST_BYTES")
    if request.content_length is not None and request.content_length > max_bytes:
        raise GistError(
            "payload_too_large",
            f"Multipart upload is too large. {IMAGE_RETRY_HINT}",
            413,
        )


def parse_multipart_gist_body(allowed_fields):
    _check_multipart_size()
    if not request.mimetype == "multipart/form-data":
        raise GistError("invalid_request", "multipart form required", 400)

    _validate_fields(request.form, allowed_fields)
    _validate_fields(request.files, {"images[]"})

    payload = {}
    for field in allowed_fields:
        values = request.form.getlist(field)
        if len(values) > 1:
            raise GistError("invalid_request", f"duplicate field: {field}", 400)
        if values:
            payload[field] = values[0]
    image_uploads = request.files.getlist("images[]")
    return payload, image_uploads


def parse_gist_body(allowed_fields):
    if request.mimetype == "multipart/form-data":
        return parse_multipart_gist_body(allowed_fields)
    return parse_json_body(allowed_fields), []


def require_gist_auth():
    with gist_connection(current_app) as conn:
        auth, error_code = verify_api_key(
            conn,
            request.headers.get("Authorization"),
        )
        if error_code == "unauthorized":
            limited = record_auth_failure_and_check_limit(
                conn,
                _client_ip(),
                current_app.config.get("API_AUTH_FAILURE_LIMIT_PER_MINUTE", 20),
            )
            if limited:
                return None, error_response("rate_limited", "Rate limited", 429)
            return None, error_response("unauthorized", "Unauthorized", 401)

    return auth, None


def _set_session_cookie(response, token):
    response.set_cookie(
        WEB_SESSION_COOKIE_NAME,
        token,
        max_age=WEB_SESSION_TTL_DAYS * 24 * 60 * 60,
        path="/",
        secure=True,
        httponly=True,
        samesite="Lax",
    )


def _clear_session_cookie(response):
    response.delete_cookie(
        WEB_SESSION_COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="Lax",
    )


def _clear_session_cookie_on_error(code, message, status):
    response, status = error_response(code, message, status)
    _clear_session_cookie(response)
    return response, status


def require_web_session():
    with gist_connection(current_app) as conn:
        auth, error_code = verify_web_session(
            conn,
            request.cookies.get(WEB_SESSION_COOKIE_NAME),
        )

    if error_code:
        return None, _clear_session_cookie_on_error(
            "unauthorized",
            "Unauthorized",
            401,
        )
    return auth, None


def check_write_limit(auth):
    with gist_connection(current_app) as conn:
        limited = check_write_rate_limit(
            conn,
            auth.key_prefix,
            _client_ip(),
            current_app.config.get("API_WRITE_LIMIT_PER_24H", 150),
        )
    if limited:
        return error_response("rate_limited", "Rate limited", 429)
    return None


@gists_api.route("/api/v1/healthz", methods=["GET"])
def healthz():
    return jsonify({"ok": True})


@gists_api.route("/api/v1/avatars/<filename>", methods=["GET"])
def avatar(filename):
    if not AVATAR_ROUTE_RE.fullmatch(filename):
        return error_response("not_found", "Not found", 404)
    return send_avatar_file(filename)


@gists_api.route("/api/v1/images/<image_id>", methods=["GET"])
def image(image_id):
    try:
        return send_image_asset(image_id)
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/auth/session", methods=["POST"])
def post_auth_session():
    try:
        payload = parse_json_body({"api_key"})
    except GistError as error:
        return error_response(error.code, error.message, error.status)

    api_key = payload.get("api_key")
    if not isinstance(api_key, str):
        return error_response("unauthorized", "Unauthorized", 401)

    with gist_connection(current_app) as conn:
        token, auth, error_code = create_web_session(conn, api_key)
        if error_code == "unauthorized":
            limited = record_auth_failure_and_check_limit(
                conn,
                _client_ip(),
                current_app.config.get("API_AUTH_FAILURE_LIMIT_PER_MINUTE", 20),
            )
            if limited:
                return error_response("rate_limited", "Rate limited", 429)
            return error_response("unauthorized", "Unauthorized", 401)

    response = jsonify(session_identity(auth))
    _set_session_cookie(response, token)
    return response


@gists_api.route("/api/v1/auth/session", methods=["GET"])
def get_auth_session():
    auth, response = require_web_session()
    if response:
        return response
    return jsonify(session_identity(auth))


@gists_api.route("/api/v1/auth/session", methods=["DELETE"])
def delete_auth_session():
    with gist_connection(current_app) as conn:
        revoke_web_session(conn, request.cookies.get(WEB_SESSION_COOKIE_NAME))
    response = current_app.response_class(status=204)
    _clear_session_cookie(response)
    return response


@gists_api.route("/api/v1/images", methods=["POST"])
def post_image():
    auth, response = require_gist_auth()
    if response:
        return response
    response = check_write_limit(auth)
    if response:
        return response

    try:
        _check_multipart_size()
        if request.mimetype != "multipart/form-data":
            raise GistError("invalid_request", "multipart form required", 400)
        _validate_fields(request.form, set())
        _validate_fields(request.files, {"image"})
        image_uploads = request.files.getlist("image")
        if len(image_uploads) > 1:
            raise GistError("invalid_request", "duplicate field: image", 400)
        if not image_uploads:
            raise GistError("invalid_request", "image file is required", 400)
        return jsonify(
            create_image_asset(current_app, auth.key_id, image_uploads[0])
        ), 201
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/me/gists", methods=["GET"])
def list_my_gists():
    auth, response = require_web_session()
    if response:
        return response
    return jsonify(list_gists_created_by_key(current_app, auth.key_id))


@gists_api.route("/api/v1/me/gists/<gist_id>", methods=["DELETE"])
def remove_my_gist(gist_id):
    auth, response = require_web_session()
    if response:
        return response
    response = check_write_limit(auth)
    if response:
        return response

    try:
        delete_gist_created_by_key(current_app, auth.key_id, gist_id)
        return "", 204
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/gists", methods=["POST"])
def post_gist():
    auth, response = require_gist_auth()
    if response:
        return response
    response = check_write_limit(auth)
    if response:
        return response

    try:
        payload, image_uploads = parse_gist_body(CREATE_GIST_FIELDS)
        body = create_gist(
            current_app,
            auth.key_id,
            auth.name,
            payload,
            image_uploads=image_uploads,
        )
        return jsonify(body), 201
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/gists/<gist_id>", methods=["GET"])
def read_gist(gist_id):
    auth, response = require_gist_auth()
    if response:
        return response

    try:
        return jsonify(get_gist(current_app, gist_id, include_markdown=True))
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/gists/<gist_id>/render", methods=["GET"])
def render_gist(gist_id):
    try:
        return jsonify(get_public_render(current_app, gist_id))
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route(
    "/api/v1/gists/<gist_id>/revisions/<revision_number>/render",
    methods=["GET"],
)
def render_gist_revision(gist_id, revision_number):
    try:
        return jsonify(get_public_render(current_app, gist_id, revision_number))
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/gists/<gist_id>", methods=["PATCH"])
def update_gist(gist_id):
    auth, response = require_gist_auth()
    if response:
        return response
    response = check_write_limit(auth)
    if response:
        return response

    try:
        body = patch_gist(
            current_app,
            auth.key_id,
            auth.name,
            gist_id,
            *parse_gist_body(UPDATE_GIST_FIELDS),
        )
        return jsonify(body)
    except GistError as error:
        return error_response(error.code, error.message, error.status)


@gists_api.route("/api/v1/gists/<gist_id>", methods=["DELETE"])
def remove_gist(gist_id):
    auth, response = require_gist_auth()
    if response:
        return response
    response = check_write_limit(auth)
    if response:
        return response

    try:
        delete_gist_created_by_key(current_app, auth.key_id, gist_id)
        return "", 204
    except GistError as error:
        return error_response(error.code, error.message, error.status)
