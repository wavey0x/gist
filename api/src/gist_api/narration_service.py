from dataclasses import dataclass
from urllib.parse import urlparse

import requests


@dataclass(frozen=True)
class ServiceJob:
    id: str
    status: str
    engine_fingerprint: str | None = None
    audio_sha256: str | None = None
    byte_size: int | None = None
    duration_ms: int | None = None
    error_code: str | None = None


class NarrationServiceError(Exception):
    def __init__(self, status, code, *, transient):
        super().__init__("Narration service request failed")
        self.status = status
        self.code = code
        self.transient = transient


def narration_service_config(app):
    origin = (app.config.get("NARRATION_SERVICE_ORIGIN") or "").strip().rstrip("/")
    token = (app.config.get("NARRATION_SERVICE_TOKEN") or "").strip()
    parsed = urlparse(origin)
    local_http = parsed.scheme == "http" and parsed.hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }
    if (
        not origin
        or not token
        or (parsed.scheme != "https" and not local_http)
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError(
            "NARRATION_SERVICE_ORIGIN and NARRATION_SERVICE_TOKEN are required"
        )
    return origin, token


def _request(app, path, *, method="GET", json=None, stream=False, timeout=15):
    try:
        origin, token = narration_service_config(app)
        response = requests.request(
            method,
            f"{origin}{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=json,
            stream=stream,
            timeout=(5, timeout),
            allow_redirects=False,
        )
    except (OSError, requests.RequestException, RuntimeError) as exc:
        raise NarrationServiceError(0, "service_unavailable", transient=True) from exc
    if 200 <= response.status_code <= 299:
        return response
    code = "service_error"
    try:
        body = response.json()
        candidate = body.get("error", {}).get("code")
        if isinstance(candidate, str):
            code = candidate
    except (TypeError, ValueError, requests.RequestException):
        pass
    status = response.status_code
    response.close()
    raise NarrationServiceError(
        status,
        code,
        transient=status == 429 or status >= 500,
    )


def _parse_job(response, expected_id):
    try:
        body = response.json()
    except (TypeError, ValueError, requests.RequestException) as exc:
        raise NarrationServiceError(
            502, "invalid_service_output", transient=False
        ) from exc
    finally:
        response.close()
    if not isinstance(body, dict) or body.get("id") != expected_id:
        raise NarrationServiceError(502, "invalid_service_output", transient=False)
    status = body.get("status")
    if status in {"queued", "running"}:
        return ServiceJob(expected_id, status)
    if status == "failed" and isinstance(body.get("error_code"), str):
        return ServiceJob(expected_id, status, error_code=body["error_code"])
    if status == "ready" and isinstance(body.get("audio"), dict):
        audio = body["audio"]
        fingerprint = body.get("engine_fingerprint")
        sha256 = audio.get("sha256")
        byte_size = audio.get("byte_size")
        duration_ms = audio.get("duration_ms")
        if (
            isinstance(fingerprint, str)
            and 0 < len(fingerprint) <= 200
            and isinstance(sha256, str)
            and len(sha256) == 64
            and all(char in "0123456789abcdef" for char in sha256)
            and isinstance(byte_size, int)
            and not isinstance(byte_size, bool)
            and byte_size > 0
            and isinstance(duration_ms, int)
            and not isinstance(duration_ms, bool)
            and duration_ms > 0
        ):
            return ServiceJob(
                expected_id,
                status,
                engine_fingerprint=fingerprint,
                audio_sha256=sha256,
                byte_size=byte_size,
                duration_ms=duration_ms,
            )
    raise NarrationServiceError(502, "invalid_service_output", transient=False)


def put_service_job(app, job_id, text, text_sha256):
    response = _request(
        app,
        f"/jobs/{job_id}",
        method="PUT",
        json={"text": text, "text_sha256": text_sha256},
    )
    return _parse_job(response, job_id)


def get_service_audio(app, job_id):
    return _request(
        app,
        f"/jobs/{job_id}/audio",
        stream=True,
        timeout=60,
    )


def delete_service_job(app, job_id):
    try:
        response = _request(app, f"/jobs/{job_id}", method="DELETE")
    except NarrationServiceError as exc:
        if exc.status == 404:
            return
        raise
    response.close()
