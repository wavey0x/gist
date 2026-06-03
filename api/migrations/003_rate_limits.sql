create table if not exists api_write_events (
    id integer primary key,
    key_prefix text not null,
    source_ip text not null,
    created_at text not null
);

create index if not exists idx_api_write_events_key_created
    on api_write_events(key_prefix, created_at);

create index if not exists idx_api_write_events_ip_created
    on api_write_events(source_ip, created_at);

create table if not exists api_auth_failure_events (
    id integer primary key,
    source_ip text not null,
    created_at text not null
);

create index if not exists idx_api_auth_failure_events_ip_created
    on api_auth_failure_events(source_ip, created_at);
