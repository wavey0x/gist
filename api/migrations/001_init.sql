create table if not exists api_keys (
    id integer primary key,
    domain text not null,
    name text not null,
    key_hash text not null,
    key_prefix text not null unique,
    scopes_json text not null,
    created_at text not null,
    last_used_at text null,
    revoked_at text null
);

create table if not exists gists (
    id integer primary key,
    external_id text not null unique,
    title text null,
    author_name text not null,
    markdown text not null,
    rendered_html text not null,
    render_version text not null,
    content_sha256 text not null,
    latest_revision_number integer not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text null
);

create table if not exists gist_revisions (
    id integer primary key,
    gist_id integer not null references gists(id),
    revision_number integer not null,
    title text null,
    author_name text not null,
    markdown text not null,
    rendered_html text not null,
    render_version text not null,
    content_sha256 text not null,
    created_at text not null,
    created_by_key_id integer not null references api_keys(id)
);

create index if not exists idx_gist_revisions_gist_id
    on gist_revisions(gist_id);

create unique index if not exists idx_gist_revisions_gist_id_revision_number
    on gist_revisions(gist_id, revision_number);

create unique index if not exists idx_api_keys_key_prefix
    on api_keys(key_prefix);
