import argparse
import logging
import os
import shutil
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from .app import create_app
from .auth import utc_now
from .db import gist_connection
from .errors import GistError
from .narration import (
    MAX_ATTEMPTS,
    MIME_TYPE,
    MP3_BITRATE_KBPS,
    POCKET_LANGUAGE,
    POCKET_MAX_TOKENS,
    POCKET_MODEL_REVISION,
    POCKET_VOICE,
    POCKET_VOICE_REVISION,
    RECIPE_VERSION,
    directory_usage,
    load_narration_source,
    narration_storage_dir,
)
from .notifications import enqueue_narration_ready_deliveries


logger = logging.getLogger(__name__)

MODEL_ASSETS = (
    (
        "kyutai/pocket-tts-without-voice-cloning",
        "languages/english_2026-04/model.safetensors",
        POCKET_MODEL_REVISION,
    ),
    (
        "kyutai/pocket-tts-without-voice-cloning",
        "languages/english_2026-04/tokenizer.model",
        POCKET_MODEL_REVISION,
    ),
    (
        "kyutai/pocket-tts-without-voice-cloning",
        "languages/english_2026-04/embeddings/peter_yearsley.safetensors",
        POCKET_VOICE_REVISION,
    ),
)


class WorkerFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class EncodedAudio:
    filename: str
    byte_size: int
    duration_ms: int


class PocketRuntime:
    def __init__(self, *, offline=True):
        if offline:
            os.environ["HF_HUB_OFFLINE"] = "1"
        import torch
        from pocket_tts import TTSModel

        torch.set_num_threads(2)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            pass
        self.model = TTSModel.load_model(language=POCKET_LANGUAGE)
        self.voice_state = self.model.get_state_for_audio_prompt(POCKET_VOICE)
        self.sample_rate = int(self.model.sample_rate)

    def audio_chunks(self, text):
        yield from self.model.generate_audio_stream(
            model_state=self.voice_state,
            text_to_generate=text,
            max_tokens=POCKET_MAX_TOKENS,
            copy_state=True,
        )


def _encoder_path(app):
    configured = (app.config.get("NARRATION_FFMPEG_PATH") or "").strip()
    path = shutil.which(configured or "ffmpeg")
    if path is None or not os.access(path, os.X_OK):
        raise RuntimeError("a working ffmpeg executable is required")
    return path


def _validate_encoder(path):
    try:
        result = subprocess.run(
            [path, "-nostdin", "-hide_banner", "-encoders"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("ffmpeg encoder check failed") from exc
    if result.returncode != 0 or "libmp3lame" not in result.stdout:
        raise RuntimeError("ffmpeg must provide the libmp3lame encoder")


def validate_worker_settings(app):
    positive_settings = (
        "NARRATION_FILE_LIMIT_BYTES",
        "NARRATION_QUEUE_LIMIT",
        "NARRATION_STORAGE_LIMIT_BYTES",
        "NARRATION_TEXT_LIMIT_CHARS",
        "NARRATION_WORKER_POLL_SECONDS",
    )
    for name in positive_settings:
        if int(app.config.get(name, 0)) <= 0:
            raise RuntimeError(f"{name} must be positive")
    if (
        app.config["NARRATION_FILE_LIMIT_BYTES"]
        > app.config["NARRATION_STORAGE_LIMIT_BYTES"]
    ):
        raise RuntimeError(
            "NARRATION_FILE_LIMIT_BYTES cannot exceed the storage limit"
        )
    narration_storage_dir(app)
    encoder_path = _encoder_path(app)
    _validate_encoder(encoder_path)
    return encoder_path


def provision_model_assets():
    os.environ.pop("HF_HUB_OFFLINE", None)
    from huggingface_hub import hf_hub_download

    for repo_id, filename, revision in MODEL_ASSETS:
        hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            revision=revision,
        )


def recover_stranded_jobs(app, *, now=None):
    now = now or utc_now()
    with gist_connection(app) as conn:
        with conn:
            recipe_cursor = conn.execute(
                """
                update narrations
                set status = 'failed', error_code = 'recipe_changed',
                    updated_at = ?, finished_at = ?
                where status in ('pending', 'processing')
                  and recipe_version != ?
                """,
                (now, now, RECIPE_VERSION),
            )
            failed_cursor = conn.execute(
                """
                update narrations
                set status = 'failed', error_code = 'worker_interrupted',
                    updated_at = ?, finished_at = ?
                where status in ('pending', 'processing') and attempt_count >= ?
                """,
                (now, now, MAX_ATTEMPTS),
            )
            pending_cursor = conn.execute(
                """
                update narrations
                set status = 'pending', error_code = null,
                    updated_at = ?, started_at = null, finished_at = null
                where status = 'processing' and attempt_count < ?
                """,
                (now, MAX_ATTEMPTS),
            )
    return {
        "recipe_failed": recipe_cursor.rowcount,
        "attempts_failed": failed_cursor.rowcount,
        "requeued": pending_cursor.rowcount,
    }


def cleanup_stale_temporary_files(app):
    deleted = 0
    storage_dir = narration_storage_dir(app)
    for path in storage_dir.glob(".narration-*.mp3.*.tmp"):
        try:
            path.unlink()
            deleted += 1
        except FileNotFoundError:
            pass
    return deleted


def claim_next_job(app, *, now=None):
    now = now or utc_now()
    with gist_connection(app) as conn:
        conn.execute("begin immediate")
        try:
            row = conn.execute(
                """
                select
                    n.*,
                    g.external_id,
                    r.revision_number,
                    r.title
                from narrations n
                join gist_revisions r on r.id = n.gist_revision_id
                join gists g on g.id = r.gist_id
                where n.status = 'pending' and n.recipe_version = ?
                  and n.attempt_count < ?
                order by n.created_at, n.id
                limit 1
                """,
                (RECIPE_VERSION, MAX_ATTEMPTS),
            ).fetchone()
            if row is None:
                conn.commit()
                return None
            cursor = conn.execute(
                """
                update narrations
                set status = 'processing',
                    attempt_count = attempt_count + 1,
                    updated_at = ?, started_at = ?, finished_at = null,
                    error_code = null
                where id = ? and status = 'pending' and attempt_count < ?
                """,
                (now, now, row["id"], MAX_ATTEMPTS),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                return None
            claimed = dict(row)
            claimed["status"] = "processing"
            claimed["attempt_count"] += 1
            claimed["started_at"] = now
            conn.commit()
            return claimed
        except Exception:
            conn.rollback()
            raise


def _recheck_source(app, job):
    with gist_connection(app) as conn:
        key = conn.execute(
            """
            select revoked_at, audio_generation_daily_limit
            from api_keys where id = ?
            """,
            (job["requested_by_key_id"],),
        ).fetchone()
        if (
            key is None
            or key["revoked_at"] is not None
            or key["audio_generation_daily_limit"] == 0
        ):
            raise WorkerFailure("access_revoked")
        try:
            source = load_narration_source(
                conn,
                app,
                job["external_id"],
                job["revision_number"],
            )
        except GistError as exc:
            if exc.status == 404:
                raise WorkerFailure("source_deleted") from exc
            raise WorkerFailure("source_unavailable") from exc
    if (
        source.gist_revision_id != job["gist_revision_id"]
        or source.render_version != job["source_render_version"]
        or source.text_sha256 != job["text_sha256"]
    ):
        raise WorkerFailure("source_mismatch")
    return source


def _safe_unlink(path):
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _write_pcm(process, chunk):
    try:
        pcm = (
            chunk.detach()
            .to("cpu")
            .contiguous()
            .numpy()
            .astype("<f4", copy=False)
        )
        process.stdin.write(pcm.tobytes())
        return int(pcm.size)
    except (BrokenPipeError, OSError) as exc:
        raise WorkerFailure("encoder_failed") from exc


def encode_audio(app, runtime, text, narration_id):
    storage_dir = narration_storage_dir(app)
    total_limit = int(app.config["NARRATION_STORAGE_LIMIT_BYTES"])
    file_limit = int(app.config["NARRATION_FILE_LIMIT_BYTES"])
    filename = f"narration-{narration_id}.mp3"
    final_path = storage_dir / filename
    _safe_unlink(final_path)
    used_before = directory_usage(storage_dir)
    if used_before >= total_limit:
        raise WorkerFailure("storage_full")

    temporary_path = storage_dir / f".{filename}.{uuid.uuid4().hex}.tmp"
    command = [
        _encoder_path(app),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "f32le",
        "-ar",
        str(runtime.sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-map_metadata",
        "-1",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        f"{MP3_BITRATE_KBPS}k",
        "-f",
        "mp3",
        "-fs",
        str(file_limit),
        "-y",
        str(temporary_path),
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    sample_count = 0
    try:
        if process.stdin is None:
            raise WorkerFailure("encoder_failed")
        for chunk in runtime.audio_chunks(text):
            sample_count += _write_pcm(process, chunk)
            if (
                temporary_path.is_file()
                and used_before + temporary_path.stat().st_size > total_limit
            ):
                raise WorkerFailure("storage_full")
        process.stdin.close()
        process.stdin = None
        if process.wait() != 0:
            raise WorkerFailure("encoder_failed")
        if sample_count <= 0 or not temporary_path.is_file():
            raise WorkerFailure("generation_failed")
        expected_audio_bytes = (
            sample_count * MP3_BITRATE_KBPS * 1000 // (runtime.sample_rate * 8)
        )
        if expected_audio_bytes > file_limit:
            raise WorkerFailure("file_too_large")
        byte_size = temporary_path.stat().st_size
        if byte_size <= 0 or byte_size > file_limit:
            raise WorkerFailure("file_too_large")
        if used_before + byte_size > total_limit:
            raise WorkerFailure("storage_full")
        temporary_path.chmod(0o600)
        with temporary_path.open("rb") as audio_file:
            os.fsync(audio_file.fileno())
        os.replace(temporary_path, final_path)
        final_path.chmod(0o600)
        directory_fd = os.open(storage_dir, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        duration_ms = max(1, round(sample_count * 1000 / runtime.sample_rate))
        return EncodedAudio(filename, byte_size, duration_ms)
    except Exception:
        if process.poll() is None:
            process.kill()
            process.wait()
        _safe_unlink(temporary_path)
        raise


def _mark_failed(app, narration_id, error_code, *, now=None):
    now = now or utc_now()
    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update narrations
                set status = 'failed', error_code = ?,
                    updated_at = ?, finished_at = ?
                where id = ? and status = 'processing'
                """,
                (error_code, now, now, narration_id),
            )


def _mark_ready(app, job, encoded, *, now=None):
    now = now or utc_now()
    with gist_connection(app) as conn:
        conn.execute("begin immediate")
        try:
            cursor = conn.execute(
                """
                update narrations
                set status = 'ready', audio_filename = ?, mime_type = ?,
                    byte_size = ?, duration_ms = ?, error_code = null,
                    updated_at = ?, finished_at = ?
                where id = ? and status = 'processing'
                """,
                (
                    encoded.filename,
                    MIME_TYPE,
                    encoded.byte_size,
                    encoded.duration_ms,
                    now,
                    now,
                    job["id"],
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("narration ready transition was lost")
            enqueue_narration_ready_deliveries(
                conn,
                narration_id=job["id"],
                gist_revision_id=job["gist_revision_id"],
                created_at=now,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _queue_time_ms(created_at):
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(
        0,
        int((datetime.now(timezone.utc) - created).total_seconds() * 1000),
    )


def process_next_job(app, runtime, *, encoder=encode_audio):
    job = claim_next_job(app)
    if job is None:
        return False
    started = time.monotonic()
    character_count = None
    queue_time_ms = _queue_time_ms(job["created_at"])
    result = "ready"
    encoded = None
    try:
        source = _recheck_source(app, job)
        character_count = len(source.text)
        encoded = encoder(app, runtime, source.text, job["id"])
        _mark_ready(app, job, encoded)
    except WorkerFailure as exc:
        result = exc.code
        _mark_failed(app, job["id"], result)
    except Exception as exc:
        result = "generation_failed"
        _mark_failed(app, job["id"], result)
        logger.error(
            "narration worker failure narration_id=%s error_type=%s",
            job["id"],
            type(exc).__name__,
        )
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        (
            "narration_job narration_id=%s key_id=%s gist_id=%s revision=%s "
            "characters=%s attempt=%s result=%s queue_ms=%s generation_ms=%s "
            "audio_duration_ms=%s byte_size=%s"
        ),
        job["id"],
        job["requested_by_key_id"],
        job["external_id"],
        job["revision_number"],
        character_count if character_count is not None else "-",
        job["attempt_count"],
        result,
        queue_time_ms if queue_time_ms is not None else "-",
        duration_ms,
        encoded.duration_ms if encoded is not None else "-",
        encoded.byte_size if encoded is not None else "-",
    )
    return True


def run_worker(app, runtime, *, once=False, stop_event=None):
    stop_event = stop_event or threading.Event()
    stale_files = cleanup_stale_temporary_files(app)
    recovery = recover_stranded_jobs(app)
    logger.info(
        (
            "narration_recovery stale_files=%s recipe_failed=%s "
            "attempts_failed=%s requeued=%s"
        ),
        stale_files,
        recovery["recipe_failed"],
        recovery["attempts_failed"],
        recovery["requeued"],
    )
    while not stop_event.is_set():
        processed = process_next_job(app, runtime)
        if once:
            if processed:
                continue
            return
        if not processed:
            stop_event.wait(app.config["NARRATION_WORKER_POLL_SECONDS"])


def main(argv=None):
    parser = argparse.ArgumentParser(prog="narration-worker")
    commands = parser.add_mutually_exclusive_group()
    commands.add_argument("--check", action="store_true")
    commands.add_argument("--once", action="store_true")
    commands.add_argument("--provision", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # Pocket's long-text warning includes a source excerpt. Keep article text
    # out of production logs; this worker records only counts and safe codes.
    logging.getLogger("pocket_tts").setLevel(logging.ERROR)
    if args.provision:
        provision_model_assets()
    app = create_app()
    validate_worker_settings(app)
    runtime = PocketRuntime(offline=True)
    if args.check or args.provision:
        logger.info(
            "narration_runtime recipe=%s sample_rate=%s",
            RECIPE_VERSION,
            runtime.sample_rate,
        )
        return

    stop_event = threading.Event()

    def request_stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    run_worker(app, runtime, once=args.once, stop_event=stop_event)


if __name__ == "__main__":
    main()
