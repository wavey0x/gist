pragma foreign_keys = off;

delete from web_sessions
where api_key_id in (
    select id from api_keys where domain <> 'gist'
);

create table api_keys_new (
    id integer primary key,
    name text not null,
    github_login text null,
    key_value text not null,
    key_prefix text not null unique,
    created_at text not null,
    last_used_at text null,
    revoked_at text null
);

insert into api_keys_new(
    id,
    name,
    github_login,
    key_value,
    key_prefix,
    created_at,
    last_used_at,
    revoked_at
)
select
    id,
    name,
    github_login,
    key_value,
    key_prefix,
    created_at,
    last_used_at,
    revoked_at
from api_keys
where domain = 'gist';

drop table api_keys;

alter table api_keys_new rename to api_keys;

create unique index if not exists idx_api_keys_key_prefix
    on api_keys(key_prefix);

pragma foreign_keys = on;
