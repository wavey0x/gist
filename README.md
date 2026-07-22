# Wavey Gist

[![CI](https://github.com/wavey0x/gist/actions/workflows/ci.yml/badge.svg)](https://github.com/wavey0x/gist/actions/workflows/ci.yml)

A small self-hosted text gist renderer. API keys create and update multi-file
gists; anyone with a random gist URL can read the rendered files and raw text.

![Wavey Gist Markdown demo](docs/hello-markdown-demo.png)

## Features

- Server-rendered public gist pages.
- GitHub-like multi-file presentation for Markdown, source code, and plain text.
- GitHub-flavored Markdown rendering.
- GitHub-style Mermaid diagram rendering for Markdown fences.
- Sanitized stored HTML.
- Immutable revision and revision-diff URLs.
- Read-only rendered/raw browser views.
- Home-page tabs for browser-local recent views and the logged-in key's gists.
- Account settings for browser Web Push enrollment and publication alerts.
- Gist API keys with owner-scoped mutation.
- SQLite persistence by default.

## Architecture

This repository has two deployable apps:

- `ui/`: Next.js frontend for public gist pages.
- `api/`: Flask backend for persistence, API keys, rendering, sanitization, and
  gist API routes.

The frontend fetches rendered gist payloads from the backend. The backend stores
complete immutable file snapshots, sanitized rendered HTML, API keys, web
sessions, and rate-limit events in a dedicated SQLite database.

## Local Development

Requirements:

- Node.js and npm.
- Python 3.10+.
- `uv`.

Install backend dependencies:

```sh
cd api
uv sync
npm ci
cp .env.example .env
```

Run the backend:

```sh
cd api
SQLITE_DB_PATH=.local/gists.sqlite3 \
PUBLIC_GIST_BASE_URL=http://localhost:3000 \
uv run flask --app 'gist_api.app:create_app' run --port 3001
```

Install frontend dependencies:

```sh
cd ui
npm ci
cp .env.example .env
```

Run the frontend:

```sh
cd ui
GIST_API_BASE_URL=http://localhost:3001 \
GIST_SITE_BASE_URL=http://localhost:3000 \
npm run dev
```

Open `http://localhost:3000`.

## Create An API Key

In another terminal, create a gist API key:

```sh
cd api
SQLITE_DB_PATH=.local/gists.sqlite3 uv run admin keys create \
  --name <name> \
  --github-login <github_login>
```

Save the printed key securely. Logged-in users can also view their current key
from the account page.

## Create A Gist

The repository helper is the recommended interface for text publishing. It uses
`WAVEY_GIST_API_KEY`, reads from repeated `--file` options or stdin, and has no
third-party Python dependencies:

```sh
export WAVEY_GIST_API_KEY=<api_key>
scripts/publish-gist --file README.md --file example.py --verify --json
```

Read a public gist as JSON, or materialize all its files:

```sh
scripts/publish-gist --read --gist <url-or-id> --json
scripts/publish-gist --read --gist <url-or-id> --output-dir <empty-dir>
```

Safely update it. The helper reads the latest snapshot, overlays the named
files, and sends one conflict-safe full snapshot:

```sh
scripts/publish-gist \
  --gist <url-or-id> \
  --file README.md \
  --file example.py \
  --verify \
  --json
```

Use repeated `--delete-file <filename>` options to remove files. `--json`
returns the complete API representation. `--verify` checks every exact raw
file, the snapshot digest, public render payload, and rendered page. If
verification fails after the API accepted the write, the command exits nonzero
and identifies the already-created revision; inspect it before taking further
action.

Supported helper options include `--file`, `--stdin-name`, `--delete-file`,
`--title`, `--clear-title`, `--gist`, `--read`, `--output-dir`, `--verify`,
`--json`, `--api-base-url`, and `--check-key`. It uses
`WAVEY_GIST_API_BASE_URL` to override the default API origin. Credential lookup
checks `WAVEY_GIST_API_KEY`, then the file named by `WAVEY_GIST_ENV_FILE`
(default `~/.config/wavey/gist.env`), then the existing macOS Keychain service.
Read mode never discovers credentials.

The underlying API remains available for direct integrations:

```sh
curl -sS http://localhost:3001/api/v1/gists \
  -H "Authorization: Bearer $WAVEY_GIST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","files":{"README.md":{"content":"# Hello\n\nThis is a gist."},"example.py":{"content":"print(42)\n"}}}'
```

Open the returned `url` in the browser.

## List Your Gists

Visit `/` to see recently viewed gists stored in this browser. Log in at
`http://localhost:3000/login` with an API key to use the `MY GISTS` home-page
tab. The browser stores an HttpOnly `wg_session` cookie. The linked account page
at `/me` contains collapsed notification settings, account stats, a ZIP export,
and API-key and logout actions.

## Configuration

Backend environment variables:

| Name | Default | Description |
| --- | --- | --- |
| `SQLITE_DB_PATH` | required | Path to the dedicated SQLite database. |
| `PUBLIC_GIST_BASE_URL` | deployment-specific | Public frontend base URL used in API responses. |
| `PUBLIC_API_BASE_URL` | `http://localhost:3001` | Public backend base URL used when generating stored avatar and image URLs. |
| `AVATAR_STORAGE_DIR` | sibling `avatars/` directory next to the SQLite database | Directory for avatar images saved by the admin CLI. |
| `GIST_IMAGE_STORAGE_DIR` | sibling `images/` directory next to the SQLite database | Directory for uploaded gist image files. |
| `GIST_IMAGE_STORAGE_LIMIT_BYTES` | `5368709120` | Global image storage cap. |
| `GIST_IMAGE_MAX_BYTES` | `20971520` | Maximum size for one uploaded image. |
| `GIST_IMAGE_MAX_DIMENSION` | `4096` | Maximum image width or height. |
| `GIST_IMAGE_MAX_PER_REQUEST` | `10` | Maximum images accepted in one multipart request. |
| `MAX_MULTIPART_REQUEST_BYTES` | text plus image upload limits | Maximum multipart request body size accepted by Flask. |
| `MAX_GIST_TEXT_BYTES` | `1048576` | Maximum aggregate UTF-8 bytes across a gist snapshot. |
| `MAX_GIST_FILES` | `32` | Maximum files in one gist snapshot. |
| `MAX_REQUEST_BYTES` | `MAX_GIST_TEXT_BYTES + 65536` | Maximum JSON body or multipart `payload` field accepted by Flask. |
| `GIST_EXTERNAL_ID_LENGTH` | `16` | Length for newly generated random gist IDs. Must be between 16 and 64. |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout. |
| `API_WRITE_LIMIT_PER_24H` | `150` | Write limit per key and source IP. |
| `API_AUTH_FAILURE_LIMIT_PER_MINUTE` | `20` | Auth failure limit per source IP. |
| `GIST_HIGHLIGHT_TIMEOUT_SECONDS` | `8` | Syntax highlighter subprocess timeout. |
| `GIST_MAX_HIGHLIGHT_BLOCK_BYTES` | `204800` | Maximum bytes for one highlighted code block. |
| `GIST_MAX_HIGHLIGHT_BLOCKS` | `64` | Maximum highlighted code blocks per render. |
| `GIST_MAX_HIGHLIGHT_TOTAL_BYTES` | `524288` | Maximum total highlighted code bytes per render. |

For public deployments, set `PUBLIC_API_BASE_URL` to the externally reachable
backend origin, for example `https://api.wavey.info`. Image URL generation and
the Markdown image sanitizer use this value; a localhost API base is rejected
when `PUBLIC_GIST_BASE_URL` is public.

Frontend environment variables:

| Name | Default | Description |
| --- | --- | --- |
| `GIST_API_BASE_URL` | `http://localhost:3001` | Backend base URL used by server-rendered pages. Set this explicitly in production. |
| `GIST_SITE_BASE_URL` | `https://gist.wavey.info` in production; `http://localhost:3000` otherwise | Public frontend base URL used for absolute social-preview metadata. Set this for self-hosted production deployments. |
| `GIST_BRAND_NAME` | `wavey` | Brand name shown before `gist` in the compact gist-page brand mark. |
| `GIST_SHOW_BRANDING` | `false` | Show the compact gist-page brand mark. Use `true`, `1`, `yes`, or `on` to enable it. |

## Admin CLI

Run admin commands from `api/` with `SQLITE_DB_PATH` set.

```sh
uv run admin keys create --name <name>
uv run admin keys create --name <name> --github-login <github_login>
uv run admin keys create --name <name> --avatar-file <path_to_image>
uv run admin keys list
uv run admin keys revoke <key_prefix_or_id>
uv run admin keys rotate <key_prefix_or_id> --name <new_name>
uv run admin keys rotate <key_prefix_or_id> --github-login <github_login>
uv run admin keys rotate <key_prefix_or_id> --avatar-url <https_url>
uv run admin gists rerender --all
```

A gist API key can create gists, read authenticated API metadata, and
update/delete only gists originally created by that key.

## API

Base path:

```text
/api/v1
```

Routes:

```text
GET    /api/v1/healthz
POST   /api/v1/auth/session
GET    /api/v1/auth/session
DELETE /api/v1/auth/session
GET    /api/v1/me/gists
GET    /api/v1/me/gists/export
DELETE /api/v1/me/gists/{gist_id}
POST   /api/v1/images
GET    /api/v1/images/{image_id}
POST   /api/v1/gists
GET    /api/v1/gists/{gist_id}
GET    /api/v1/gists/{gist_id}/render
GET    /api/v1/gists/{gist_id}/revisions/{revision_number}/render
PATCH  /api/v1/gists/{gist_id}
DELETE /api/v1/gists/{gist_id}
```

Protected routes use:

```text
Authorization: Bearer <api_key>
```

`POST /api/v1/images` accepts multipart form field `image` and returns an
`img_...` URL plus ready-to-paste Markdown.

`POST /api/v1/gists` and `PATCH /api/v1/gists/{gist_id}` accept JSON with a
`files` object keyed by flat filename. Each value is an object containing
`content`. PATCH treats a supplied `files` object as the complete replacement
snapshot and requires the current `expected_snapshot_sha256`.

For image uploads, send `multipart/form-data` with exactly one `payload` field
containing that JSON object plus repeated `images[]` file fields. Markdown
references like `attachment:chart.png` are replaced with the stored image URL.
Unreferenced images are appended to the Markdown lead file.

Requests reject unknown fields. The accepted fields are:

- auth session create: JSON `api_key`;
- gist create: JSON `title` and `files`, or multipart `payload` plus `images[]`;
- gist update: JSON `title`, `files`, and required
  `expected_snapshot_sha256`, or multipart `payload` plus `images[]`;
- standalone image upload: multipart `image`.

The web-session routes use the `wg_session` HttpOnly cookie minted from a gist
API key.

Update and delete routes only mutate gists owned by the authenticated key. A
non-owned gist returns `404`.

Public render routes do not require auth because anyone with the random gist
URL can view every rendered and raw file. Their JSON payloads include the exact
revision's `snapshot_sha256` plus per-file content digests.

## Deployment

For a small self-hosted deployment, run:

- the backend with Gunicorn or another WSGI server;
- the frontend with a Next.js host;
- a dedicated SQLite database path on persistent storage;
- a reverse proxy or platform routing rule that exposes the backend API and the
  frontend on your chosen domains.

Back up the SQLite database before upgrades. If the database uses WAL mode,
include the database, WAL, and shared-memory files or use SQLite's online
backup tooling.

Run the backend service with `umask 077` and keep the SQLite database directory
owned by the service user. If the backend sits behind a reverse proxy, configure
that proxy to append or overwrite `X-Forwarded-For`; the API only trusts
forwarded client IPs from loopback proxy remotes and uses the rightmost valid
forwarded IP for rate limits.

## Security Model

Gist URLs are bearer-capability URLs: anyone with the URL can read that gist.
The home page stores recently viewed gists only in browser `localStorage`.
When authenticated, the home page lists only gists created by that key. `/me`
can copy the current API key, manage notification settings, show account stats,
and export current owned gists. There is no public listing, account system,
editor, comments, analytics, or social graph.

The backend sanitizes rendered HTML before storage. API keys are stored in
cleartext for account-page disclosure; web session tokens are stored only as
hashes. Do not log Markdown bodies, rendered HTML, authorization headers,
session cookies, or raw API keys in production.

## License

MIT
