alter table api_keys add column github_login text null;

create table if not exists web_sessions (
    id integer primary key,
    token_hash text not null unique,
    api_key_id integer not null references api_keys(id),
    created_at text not null,
    last_used_at text null,
    expires_at text not null,
    revoked_at text null
);

create index if not exists idx_web_sessions_api_key_id
    on web_sessions(api_key_id);

create index if not exists idx_gist_revisions_creator_revision
    on gist_revisions(created_by_key_id, revision_number, gist_id);

update api_keys
set name = 'wavey0x',
    github_login = 'wavey0x'
where domain = 'gist'
  and (name = 'wavey' or github_login is null);

update gists
set author_name = 'wavey0x'
where author_name = 'wavey';

update gist_revisions
set author_name = 'wavey0x'
where author_name = 'wavey';
