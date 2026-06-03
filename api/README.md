# Wavey Gist API

Standalone Flask backend for self-hosted Markdown gists.

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
point at the dedicated gist SQLite database. `MAX_REQUEST_BYTES` caps the JSON
body accepted by Flask and defaults to `MAX_MARKDOWN_BYTES + 2048`.

Run the service with `umask 077` so the SQLite database and WAL files are not
readable by other local users. If a reverse proxy fronts the API, configure it
to append or overwrite `X-Forwarded-For`; the app trusts forwarded client IPs
only from loopback proxy remotes and uses the rightmost valid forwarded IP for
rate limits.

## Migrations

Run migrations during app startup with the configured `SQLITE_DB_PATH`. Back up
the SQLite database before upgrading.
