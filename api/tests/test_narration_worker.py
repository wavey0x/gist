import array
import json
import shutil
import stat
from types import SimpleNamespace

import pytest

from gist_api.auth import set_audio_generation_daily_limit
from gist_api.db import gist_connection
from gist_api.narration import POCKET_MAX_TOKENS, RECIPE_VERSION, narration_storage_dir
from gist_api.narration_worker import (
    EncodedAudio,
    WorkerFailure,
    claim_next_job,
    cleanup_stale_temporary_files,
    encode_audio,
    process_next_job,
    recover_stranded_jobs,
    validate_worker_settings,
)
from gist_api.push_worker import process_delivery

from .conftest import create_gist, make_key
from .test_notifications import (
    VAPID_PUBLIC_KEY,
    _login,
    _subscription,
)


def _enqueue(client, app, key, *, markdown="# Article\n\nSpoken prose."):
    created = create_gist(client, key, markdown=markdown, title="Article")
    assert created.status_code == 201
    gist_id = created.get_json()["id"]
    response = client.post(
        f"/api/v1/gists/{gist_id}/revisions/1/narration",
        json={},
    )
    assert response.status_code == 202
    with gist_connection(app) as conn:
        row = conn.execute(
            """
            select narrations.*, gist_revisions.revision_number,
                   gists.external_id
            from narrations
            join gist_revisions on gist_revisions.id = narrations.gist_revision_id
            join gists on gists.id = gist_revisions.gist_id
            where gists.external_id = ?
            """,
            (gist_id,),
        ).fetchone()
    return gist_id, dict(row)


def test_worker_claims_oldest_job_and_increments_attempt(client, app):
    app.config["NARRATION_QUEUE_LIMIT"] = 10
    key = make_key(app)
    _login(client, key)
    _first_id, first = _enqueue(client, app, key, markdown="# First\n\nOne.")
    _second_id, second = _enqueue(client, app, key, markdown="# Second\n\nTwo.")

    claimed = claim_next_job(app, now="2026-08-28T12:00:00.000Z")
    assert claimed["id"] == first["id"]
    assert claimed["attempt_count"] == 1
    with gist_connection(app) as conn:
        assert conn.execute(
            "select status from narrations where id = ?", (first["id"],)
        ).fetchone()["status"] == "processing"
        assert conn.execute(
            "select status from narrations where id = ?", (second["id"],)
        ).fetchone()["status"] == "pending"


def test_worker_recovery_requeues_once_then_fails_exhausted_jobs(client, app):
    app.config["NARRATION_QUEUE_LIMIT"] = 10
    key = make_key(app)
    _login(client, key)
    _one, first = _enqueue(client, app, key)
    _two, second = _enqueue(client, app, key, markdown="# Other\n\nText.")
    _three, third = _enqueue(client, app, key, markdown="# Old\n\nRecipe.")
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "update narrations set status = 'processing', attempt_count = 1 where id = ?",
                (first["id"],),
            )
            conn.execute(
                "update narrations set status = 'processing', attempt_count = 2 where id = ?",
                (second["id"],),
            )
            conn.execute(
                "update narrations set recipe_version = 'retired-recipe' where id = ?",
                (third["id"],),
            )

    recovered = recover_stranded_jobs(app, now="2026-08-28T12:00:00.000Z")
    assert recovered == {"recipe_failed": 1, "attempts_failed": 1, "requeued": 1}
    with gist_connection(app) as conn:
        rows = {
            row["id"]: (row["status"], row["error_code"])
            for row in conn.execute(
                "select id, status, error_code from narrations order by id"
            )
        }
    assert rows[first["id"]] == ("pending", None)
    assert rows[second["id"]] == ("failed", "worker_interrupted")
    assert rows[third["id"]] == ("failed", "recipe_changed")


def test_worker_startup_removes_only_its_stale_temporary_files(app):
    storage = narration_storage_dir(app)
    stale = storage / ".narration-12.mp3.abc123.tmp"
    unrelated = storage / ".keep.tmp"
    stale.write_bytes(b"partial")
    unrelated.write_bytes(b"keep")

    assert cleanup_stale_temporary_files(app) == 1
    assert stale.exists() is False
    assert unrelated.read_bytes() == b"keep"


def test_worker_rechecks_account_capability_before_generation(client, app):
    key = make_key(app)
    _login(client, key)
    _gist_id, job = _enqueue(client, app, key)
    with gist_connection(app) as conn:
        key_id = conn.execute(
            "select id from api_keys where key_value = ?", (key,)
        ).fetchone()["id"]
        set_audio_generation_daily_limit(conn, key_id, 0)

    called = False

    def encoder(*_args):
        nonlocal called
        called = True

    assert process_next_job(app, object(), encoder=encoder) is True
    assert called is False
    with gist_connection(app) as conn:
        row = conn.execute(
            "select status, error_code from narrations where id = ?", (job["id"],)
        ).fetchone()
    assert tuple(row) == ("failed", "access_revoked")


def test_worker_rechecks_source_digest_before_generation(client, app):
    key = make_key(app)
    _login(client, key)
    _gist_id, job = _enqueue(client, app, key)
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                "update gist_revision_files set rendered_html = '<p>changed</p>'"
            )

    assert process_next_job(app, object(), encoder=lambda *_args: None) is True
    with gist_connection(app) as conn:
        row = conn.execute(
            "select status, error_code from narrations where id = ?", (job["id"],)
        ).fetchone()
    assert tuple(row) == ("failed", "source_mismatch")


def test_successful_worker_publication_is_atomic_with_ready_push(client, app):
    app.config.update(
        WEB_PUSH_VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY,
        WEB_PUSH_ALLOWED_ENDPOINT_HOSTS=("push.example.com",),
    )
    key = make_key(app)
    _login(client, key)
    assert client.put(
        "/api/v1/me/push-subscriptions", json=_subscription()
    ).status_code == 200
    gist_id, job = _enqueue(client, app, key)
    with gist_connection(app) as conn:
        with conn:
            conn.execute("delete from push_deliveries")

    audio = b"ID3-worker-output"

    def encoder(worker_app, _runtime, _text, narration_id):
        filename = f"narration-{narration_id}.mp3"
        path = narration_storage_dir(worker_app) / filename
        path.write_bytes(audio)
        path.chmod(0o600)
        return EncodedAudio(filename, len(audio), 1800)

    assert process_next_job(app, object(), encoder=encoder) is True
    assert process_next_job(app, object(), encoder=encoder) is False
    with gist_connection(app) as conn:
        narration = conn.execute(
            "select * from narrations where id = ?", (job["id"],)
        ).fetchone()
        deliveries = conn.execute(
            "select id, event_type, narration_id from push_deliveries"
        ).fetchall()
    assert narration["status"] == "ready"
    assert narration["byte_size"] == len(audio)
    assert [(row["event_type"], row["narration_id"]) for row in deliveries] == [
        ("narration.ready", job["id"])
    ]
    status = client.get(
        f"/api/v1/gists/{gist_id}/revisions/1/narration"
    ).get_json()
    assert status["status"] == "ready"

    sent = {}

    def sender(**kwargs):
        sent.update(kwargs)
        return SimpleNamespace(status_code=201)

    assert process_delivery(
        app, deliveries[0]["id"], object(), sender=sender
    ) == "accepted"
    assert json.loads(sent["data"]) == {
        "type": "narration.ready",
        "title": "🔊 Audio ready",
        "body": "Article",
        "path": f"/{gist_id}/revisions/1?audio=ready",
        "tag": f"narration:{gist_id}:1",
    }


def test_worker_failure_is_recorded_without_exposing_exception(client, app):
    key = make_key(app)
    _login(client, key)
    _gist_id, job = _enqueue(client, app, key)

    def fail(*_args):
        raise WorkerFailure("encoder_failed")

    assert process_next_job(app, object(), encoder=fail) is True
    with gist_connection(app) as conn:
        row = conn.execute(
            "select status, attempt_count, error_code from narrations where id = ?",
            (job["id"],),
        ).fetchone()
    assert tuple(row) == ("failed", 1, "encoder_failed")


class _FakePcmChunk:
    def __init__(self, sample_count):
        self.values = array.array("f", [0.0]) * sample_count
        self.size = sample_count

    def detach(self):
        return self

    def to(self, _device):
        return self

    def contiguous(self):
        return self

    def numpy(self):
        return self

    def astype(self, _dtype, copy=False):
        assert copy is False
        return self

    def tobytes(self):
        return self.values.tobytes()


class _FakeRuntime:
    sample_rate = 24000

    def audio_chunks(self, _text):
        yield _FakePcmChunk(self.sample_rate)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_worker_startup_requires_the_configured_mp3_encoder(app):
    assert validate_worker_settings(app) == shutil.which("ffmpeg")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_encoder_streams_pcm_to_a_private_bounded_mp3(app):
    encoded = encode_audio(app, _FakeRuntime(), "test", 99)
    path = narration_storage_dir(app) / encoded.filename

    assert path.is_file()
    assert path.stat().st_size == encoded.byte_size
    assert encoded.duration_ms == 1000
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert encoded.byte_size <= app.config["NARRATION_FILE_LIMIT_BYTES"]
    assert not list(path.parent.glob(".*.tmp"))


def test_encoder_refuses_generation_when_total_storage_is_full(app):
    storage = narration_storage_dir(app)
    (storage / "existing.mp3").write_bytes(b"full")
    app.config["NARRATION_STORAGE_LIMIT_BYTES"] = 4

    with pytest.raises(WorkerFailure) as exc_info:
        encode_audio(app, _FakeRuntime(), "test", 100)
    assert exc_info.value.code == "storage_full"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_encoder_rejects_output_over_the_file_limit_and_removes_partial(app):
    app.config["NARRATION_FILE_LIMIT_BYTES"] = 1000

    with pytest.raises(WorkerFailure) as exc_info:
        encode_audio(app, _FakeRuntime(), "test", 102)

    assert exc_info.value.code == "file_too_large"
    storage = narration_storage_dir(app)
    assert not (storage / "narration-102.mp3").exists()
    assert not list(storage.glob(".*.tmp"))


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_encoder_streams_a_100k_fixture_without_collecting_pcm(app):
    class LongTextRuntime:
        sample_rate = 24000

        def audio_chunks(self, text):
            assert len(text) == 100000
            for _ in range(20):
                yield _FakePcmChunk(1200)

    encoded = encode_audio(app, LongTextRuntime(), "a" * 100000, 101)

    assert encoded.duration_ms == 1000
    assert (narration_storage_dir(app) / encoded.filename).is_file()
    assert POCKET_MAX_TOKENS == 50
    assert "max50" in RECIPE_VERSION
