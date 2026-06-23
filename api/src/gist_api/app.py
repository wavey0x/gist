from urllib.parse import urlparse

from flask import Flask, request
from werkzeug.exceptions import RequestEntityTooLarge

from .errors import error_response
from .external_ids import DEFAULT_EXTERNAL_ID_LENGTH, validate_external_id_length
from .migrations import init_gist_database
from .routes import gists_api
from .settings import load_settings


SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
}


def _is_local_base_url(value):
    parsed = urlparse((value or "").strip())
    return parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def _validate_public_api_base_url(app):
    gist_base_url = app.config.get("PUBLIC_GIST_BASE_URL")
    api_base_url = app.config.get("PUBLIC_API_BASE_URL")
    if not _is_local_base_url(gist_base_url) and _is_local_base_url(api_base_url):
        raise RuntimeError(
            "PUBLIC_API_BASE_URL must be set for public deployments; "
            "image URLs and sanitizer allowlists cannot use localhost"
        )


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.update(load_settings())
    if config_overrides:
        app.config.update(config_overrides)
    _validate_public_api_base_url(app)
    app.config["GIST_EXTERNAL_ID_LENGTH"] = validate_external_id_length(
        app.config.get("GIST_EXTERNAL_ID_LENGTH", DEFAULT_EXTERNAL_ID_LENGTH)
    )
    if app.config.get("MAX_REQUEST_BYTES") is None:
        app.config["MAX_REQUEST_BYTES"] = (
            app.config.get("MAX_MARKDOWN_BYTES", 1048576) + 2048
        )
    app.config["MAX_CONTENT_LENGTH"] = max(
        app.config.get("MAX_REQUEST_BYTES"),
        app.config.get("MAX_MULTIPART_REQUEST_BYTES"),
    )

    init_gist_database(app)
    app.register_blueprint(gists_api)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_entity_too_large(_error):
        if request.mimetype == "multipart/form-data":
            return error_response(
                "payload_too_large",
                (
                    "Multipart upload is too large. Try publishing again without "
                    "images or with smaller images."
                ),
                413,
            )
        return error_response("payload_too_large", "Payload too large", 413)

    @app.after_request
    def add_security_headers(response):
        for name, value in SECURITY_HEADERS.items():
            if name not in response.headers:
                response.headers[name] = value
        return response

    return app
