pragma foreign_keys = off;

create table api_keys_new (
    id integer primary key,
    domain text not null,
    name text not null,
    github_login text null,
    key_value text not null,
    key_prefix text not null unique,
    scopes_json text not null,
    created_at text not null,
    last_used_at text null,
    revoked_at text null
);

insert into api_keys_new(
    id,
    domain,
    name,
    github_login,
    key_value,
    key_prefix,
    scopes_json,
    created_at,
    last_used_at,
    revoked_at
)
select
    id,
    domain,
    name,
    github_login,
    'migrated_unusable_' || id || '_' || lower(hex(randomblob(16))),
    key_prefix,
    scopes_json,
    created_at,
    last_used_at,
    revoked_at
from api_keys;

drop table api_keys;

alter table api_keys_new rename to api_keys;

create unique index if not exists idx_api_keys_key_prefix
    on api_keys(key_prefix);

update web_sessions
set revoked_at = coalesce(
    revoked_at,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

pragma foreign_keys = on;
