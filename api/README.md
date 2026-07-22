# Wavey Gist API

Standalone Flask backend for self-hosted multi-file text gists.

## Local Development

Install dependencies:

```sh
uv sync
npm ci
cp .env.example .env
```

Run the development server:

```sh
SQLITE_DB_PATH=.local/gists.sqlite3 \
PUBLIC_GIST_BASE_URL=http://localhost:3000 \
uv run flask --app 'gist_api.app:create_app' run --port 3001
```

## Production

Run Gunicorn from this directory:

```sh
uv sync --no-dev --frozen
npm ci --omit=dev
uv run gunicorn 'gist_api.wsgi:app' --bind 127.0.0.1:8015
```

Required settings are read from environment variables. `SQLITE_DB_PATH` must
point at the dedicated gist SQLite database. `MAX_GIST_TEXT_BYTES` defaults to
1 MiB across a complete snapshot, `MAX_GIST_FILES` defaults to 32, and
`MAX_REQUEST_BYTES` independently caps JSON bodies and multipart `payload`
fields. `GIST_EXTERNAL_ID_LENGTH` controls new random gist IDs and defaults to
`16`.

Web Push is optional. Configure the API and worker with
`WEB_PUSH_VAPID_PUBLIC_KEY`; optionally override the comma-separated
`WEB_PUSH_ALLOWED_ENDPOINT_HOSTS`. The worker additionally requires
`WEB_PUSH_VAPID_PRIVATE_KEY_FILE` and a `mailto:` or HTTPS
`WEB_PUSH_VAPID_SUBJECT`. Keep the private key file outside the repository with
mode `0600`.

Run the single delivery worker separately from Gunicorn:

```sh
uv run push-worker
```

Use `uv run push-worker --once` to drain rows that are currently due and exit.
Run only one worker process.

Run the service with `umask 077` so the SQLite database and WAL files are not
readable by other local users. If a reverse proxy fronts the API, configure it
to append or overwrite `X-Forwarded-For`; the app trusts forwarded client IPs
only from loopback proxy remotes and uses the rightmost valid forwarded IP for
rate limits.

## Migrations

Run migrations during app startup with the configured `SQLITE_DB_PATH`. Back up
the SQLite database before upgrading.

## API Keys

Create gist API keys from this directory with `SQLITE_DB_PATH` set:

```sh
uv run admin keys create --name <name> --github-login <github_login>
uv run admin keys create --name <name> --avatar-file <path_to_image>
uv run admin keys rotate <key_prefix_or_id> --github-login <github_login>
uv run admin keys rotate <key_prefix_or_id> --avatar-url <https_url>
```

A gist API key can create gists and update/delete gists owned by that key. The
`github_login` value can derive a browser avatar
URL for key-backed web sessions. `--avatar-url` or `--avatar-file` stores an
explicit avatar for the account and public gist bylines. Rotation changes the
secret in place, preserves gist ownership, and revokes existing web sessions.

## Auth Routes

The browser login flow mints an HttpOnly `wg_session` cookie from an existing
gist API key. Authenticated session responses include the current cleartext key
so the frontend account page can display it:

```text
POST   /api/v1/auth/session
GET    /api/v1/auth/session
DELETE /api/v1/auth/session
GET    /api/v1/me/gists
GET    /api/v1/me/gists/export
DELETE /api/v1/me/gists/{gist_id}
GET    /api/v1/me/notification-settings
PUT    /api/v1/me/notification-settings
PUT    /api/v1/me/push-subscriptions
DELETE /api/v1/me/push-subscriptions
```

`/api/v1/me/gists` returns gists owned by the logged-in key plus aggregate
active-gist statistics. It does not include file content or rendered HTML.
`/api/v1/me/gists/export` returns a ZIP containing a versioned JSON manifest
and every file from each active gist's latest snapshot.

## Image Uploads

Upload one reusable image with:

```text
POST /api/v1/images
```

Use `multipart/form-data` field `image`. The response includes a public
`img_...` URL and Markdown image snippet.

Create or update a gist with new images in one request by sending
`multipart/form-data` to `POST /api/v1/gists` or
`PATCH /api/v1/gists/{gist_id}`. Include exactly one `payload` field containing
the normal JSON request and repeated `images[]` file fields.
`attachment:<filename>` references in any Markdown file are replaced with the
stored image URL; unreferenced uploads are appended to the Markdown lead file.

`PATCH /api/v1/gists/{gist_id}` only updates gists owned by the authenticated
key.

`DELETE /api/v1/me/gists/{gist_id}` only deletes gists owned by the
authenticated session key.

## Request Contracts

Unknown fields and duplicate multipart `payload` fields return
`400 invalid_request`. Accepted input fields are:

| Route | Scalar fields | File fields |
| --- | --- | --- |
| `POST /api/v1/auth/session` | JSON `api_key` | none |
| `POST /api/v1/gists` | JSON `title`, `files`; multipart JSON `payload` | repeated `images[]` |
| `PATCH /api/v1/gists/{gist_id}` | JSON `title`, `files`, `expected_snapshot_sha256`; multipart JSON `payload` | repeated `images[]` |
| `POST /api/v1/images` | none | one `image` |

`files` is an object keyed by flat filename; each value contains one string
`content` field. A gist has 1–32 NFC-normalized UTF-8 text files, at most 1 MiB
combined. Filenames are at most 255 UTF-8 bytes and reject separators, dot
segments, surrounding whitespace, control/format characters, and case-fold
collisions.

The primary file is exact `README.md` when present, otherwise the first
Markdown filename alphabetically, otherwise the first filename alphabetically.

Direct PATCH requires `expected_snapshot_sha256` even for title-only updates.
A supplied `files` object is the complete replacement snapshot, not an overlay;
omitting it keeps the current files. Public latest and historical render
responses include the exact revision's `snapshot_sha256` and per-file digests,
raw URLs, content, kind, language, and sanitized rendered HTML.
