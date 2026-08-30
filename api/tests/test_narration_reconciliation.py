import hashlib

from gist_api import narration as narration_module
from gist_api.db import gist_connection
from gist_api.narration import (
    cleanup_narration_jobs,
    narration_storage_dir,
    run_narration_pass,
)
from gist_api.narration_service import NarrationServiceError, ServiceJob

from .conftest import auth_header, create_gist, make_key


class AudioResponse:
    def __init__(self, audio, sha256):
        self.audio = audio
        self.headers = {
            "Content-Type": "audio/mpeg",
            "Content-Length": str(len(audio)),
            "X-Content-SHA256": sha256,
            "X-Audio-Duration-Ms": "1200",
            "X-Engine-Fingerprint": "sha256:test-engine",
        }

    def iter_content(self, chunk_size):
        assert chunk_size == 64 * 1024
        yield self.audio

    def close(self):
        pass


def _request(client, app):
    key = make_key(app)
    created = create_gist(
        client,
        key,
        markdown="# Article\n\nNarratable prose.",
        title="Article",
    )
    gist_id = created.get_json()["id"]
    assert client.post("/api/v1/auth/session", json={"api_key": key}).status_code == 200
    response = client.post(f"/api/v1/gists/{gist_id}/revisions/1/narration", json={})
    assert response.status_code == 202
    return key, gist_id


def test_reconciliation_publishes_verified_audio_once(monkeypatch, client, app):
    _key, gist_id = _request(client, app)
    audio = b"ID3-shared-service-audio"
    sha256 = hashlib.sha256(audio).hexdigest()
    submissions = []
    acknowledgements = []

    def put_job(_app, job_id, text, text_sha256):
        submissions.append((job_id, text, text_sha256))
        assert hashlib.sha256(text.encode("utf-8")).hexdigest() == text_sha256
        return ServiceJob(
            job_id,
            "ready",
            engine_fingerprint="sha256:test-engine",
            audio_sha256=sha256,
            byte_size=len(audio),
            duration_ms=1200,
        )

    monkeypatch.setattr(narration_module, "put_service_job", put_job)
    monkeypatch.setattr(
        narration_module,
        "get_service_audio",
        lambda _app, _job_id: AudioResponse(audio, sha256),
    )
    monkeypatch.setattr(
        narration_module,
        "delete_service_job",
        lambda _app, job_id: acknowledgements.append(job_id),
    )

    assert run_narration_pass(app) == 1
    assert run_narration_pass(app) == 0
    with gist_connection(app) as conn:
        row = conn.execute("select * from narrations").fetchone()
    assert row["status"] == "ready"
    assert row["audio_sha256"] == sha256
    assert row["engine_fingerprint"] == "sha256:test-engine"
    assert (narration_storage_dir(app) / row["audio_filename"]).read_bytes() == audio
    assert len(submissions) == 1
    assert acknowledgements == [row["service_job_id"]]

    status = client.get(f"/api/v1/gists/{gist_id}/revisions/1/narration").get_json()
    assert status["status"] == "ready"
    response = client.get(f"/api/v1/gists/{gist_id}/revisions/1/narration/audio")
    assert response.data == audio
    assert response.headers["X-Content-SHA256"] == sha256
    assert response.headers["ETag"] == f'"{sha256}"'


def test_transient_service_failure_stays_pending(monkeypatch, client, app):
    _request(client, app)

    def unavailable(*_args):
        raise NarrationServiceError(503, "service_error", transient=True)

    monkeypatch.setattr(narration_module, "put_service_job", unavailable)
    assert run_narration_pass(app) == 1
    with gist_connection(app) as conn:
        row = conn.execute("select status, error_code from narrations").fetchone()
    assert tuple(row) == ("pending", None)


def test_gist_deletion_cleans_product_audio_and_service_job(monkeypatch, client, app):
    key, gist_id = _request(client, app)
    audio = b"ID3-delete-me"
    sha256 = hashlib.sha256(audio).hexdigest()
    monkeypatch.setattr(
        narration_module,
        "put_service_job",
        lambda _app, job_id, _text, _hash: ServiceJob(
            job_id,
            "ready",
            engine_fingerprint="sha256:test-engine",
            audio_sha256=sha256,
            byte_size=len(audio),
            duration_ms=1200,
        ),
    )
    monkeypatch.setattr(
        narration_module,
        "get_service_audio",
        lambda _app, _job_id: AudioResponse(audio, sha256),
    )
    monkeypatch.setattr(narration_module, "delete_service_job", lambda *_args: None)
    run_narration_pass(app)
    with gist_connection(app) as conn:
        filename = conn.execute("select audio_filename from narrations").fetchone()[0]

    assert (
        client.delete(f"/api/v1/gists/{gist_id}", headers=auth_header(key)).status_code
        == 204
    )
    deleted_jobs = []
    monkeypatch.setattr(
        narration_module,
        "delete_service_job",
        lambda _app, job_id: deleted_jobs.append(job_id),
    )
    assert cleanup_narration_jobs(app) == 1
    with gist_connection(app) as conn:
        assert conn.execute("select count(*) from narrations").fetchone()[0] == 0
        assert (
            conn.execute("select count(*) from narration_cleanup_jobs").fetchone()[0]
            == 0
        )
    assert deleted_jobs
    assert not (narration_storage_dir(app) / filename).exists()
