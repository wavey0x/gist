# Wavey Gist

[![CI](https://github.com/wavey0x/gist/actions/workflows/ci.yml/badge.svg)](https://github.com/wavey0x/gist/actions/workflows/ci.yml)

A small self-hosted Markdown gist renderer. API keys create and update gists;
anyone with a random gist URL can read the rendered page and raw source.

![Wavey Gist Markdown demo](docs/hello-markdown-demo.png)

## Features

- Server-rendered public gist pages.
- GitHub-flavored Markdown rendering.
- Sanitized stored HTML.
- Immutable revision and revision-diff URLs.
- Read-only rendered/raw browser views.
- Browser-local recently viewed gist list.
- Key-backed private list of gists created by the logged-in API key.
- Gist API keys with owner-scoped mutation.
- SQLite persistence by default.

## Architecture

This repository has two deployable apps:

- `ui/`: Next.js frontend for public gist pages.
- `api/`: Flask backend for persistence, API keys, rendering, sanitization, and
  gist API routes.

The frontend fetches rendered gist payloads from the backend. The backend stores
Markdown, sanitized rendered HTML, revision snapshots, API keys, web sessions,
and rate-limit events in a dedicated SQLite database.

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
GIST_API_BASE_URL=http://localhost:3001 npm run dev
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

Use the key from the previous step:

```sh
curl -sS http://localhost:3001/api/v1/gists \
  -H "Authorization: Bearer $GIST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","markdown":"# Hello\n\nThis is a gist."}'
```

Open the returned `url` in the browser.

## List Your Gists

Visit `/me` to see recently viewed gists stored in this browser. To list your
own gists, open `http://localhost:3000/login` and enter the API key once. The
browser stores an HttpOnly `wg_session` cookie, and the authenticated `/me`
page can copy the current API key.

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
| `MAX_MULTIPART_REQUEST_BYTES` | markdown plus image upload limits | Maximum multipart request body size accepted by Flask. |
| `PORT` | `3001` | Backend port when using the module entrypoint. |
| `MAX_MARKDOWN_BYTES` | `1048576` | Maximum Markdown payload size. |
| `MAX_REQUEST_BYTES` | `MAX_MARKDOWN_BYTES + 2048` | Maximum JSON request body size accepted by Flask. |
| `GIST_EXTERNAL_ID_LENGTH` | `16` | Length for newly generated random gist IDs. Must be between 16 and 64. |
| `ALLOW_EMPTY_MARKDOWN` | `false` | Allow empty Markdown documents. |
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
| `SITE_BASE_URL` | deployment-specific | Canonical public frontend base URL. |
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

`POST /api/v1/gists` and `PATCH /api/v1/gists/{gist_id}` also accept
`multipart/form-data` with optional `title`, optional `markdown`, and repeated
`images[]` file fields. Markdown references like `attachment:chart.png` are
replaced with the stored image URL. Uploaded images that are not referenced are
appended to the saved Markdown as image blocks, so image-only gist creation is
valid.

The web-session routes use the `wg_session` HttpOnly cookie minted from a gist
API key.

Update and delete routes only mutate gists whose first revision was created by
the authenticated key. A non-owned gist returns `404`.

Public render routes do not require auth because anyone with the random gist
URL can view the rendered page and raw Markdown source.

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
The `/me` page stores recently viewed gists only in browser `localStorage`.
When authenticated, `/me` can copy the current API key and lists only gists
created by that key. There is no public listing, account system, editor,
comments, analytics, or social graph.

The backend sanitizes rendered HTML before storage. API keys are stored in
cleartext for account-page disclosure; web session tokens are stored only as
hashes. Do not log Markdown bodies, rendered HTML, authorization headers,
session cookies, or raw API keys in production.

## License

MIT
