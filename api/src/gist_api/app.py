from flask import Flask
from werkzeug.exceptions import RequestEntityTooLarge

from .errors import error_response
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


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.update(load_settings())
    if config_overrides:
        app.config.update(config_overrides)
    if app.config.get("MAX_REQUEST_BYTES") is None:
        app.config["MAX_REQUEST_BYTES"] = (
            app.config.get("MAX_MARKDOWN_BYTES", 1048576) + 2048
        )
    app.config["MAX_CONTENT_LENGTH"] = app.config.get("MAX_REQUEST_BYTES")

    init_gist_database(app)
    app.register_blueprint(gists_api)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_entity_too_large(_error):
        return error_response("payload_too_large", "Payload too large", 413)

    @app.after_request
    def add_security_headers(response):
        for name, value in SECURITY_HEADERS.items():
            if name not in response.headers:
                response.headers[name] = value
        return response

    return app
