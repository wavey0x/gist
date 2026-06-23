create table if not exists image_blobs (
    sha256 text primary key,
    storage_path text not null,
    mime_type text not null,
    file_extension text not null,
    byte_size integer not null,
    width integer not null,
    height integer not null,
    ref_count integer not null default 0,
    created_at text not null,
    deleted_at text null
);

create table if not exists image_assets (
    id integer primary key,
    public_id text not null unique,
    owner_key_id integer not null references api_keys(id),
    sha256 text not null references image_blobs(sha256),
    original_filename text not null,
    created_at text not null,
    deleted_at text null
);

create unique index if not exists idx_image_assets_public_id
    on image_assets(public_id);

create index if not exists idx_image_assets_owner_created
    on image_assets(owner_key_id, created_at);

create index if not exists idx_image_assets_sha256
    on image_assets(sha256);
