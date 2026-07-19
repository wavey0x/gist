create table notification_settings (
    api_key_id integer primary key references api_keys(id),
    new_gist_enabled integer not null default 1
        check (new_gist_enabled in (0, 1)),
    edited_gist_enabled integer not null default 0
        check (edited_gist_enabled in (0, 1)),
    created_at text not null,
    updated_at text not null
);

insert into notification_settings(
    api_key_id,
    new_gist_enabled,
    edited_gist_enabled,
    created_at,
    updated_at
)
select
    id,
    1,
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from api_keys;

create table push_subscriptions (
    id integer primary key,
    api_key_id integer not null references api_keys(id),
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    created_at text not null,
    updated_at text not null
);

create index idx_push_subscriptions_api_key
    on push_subscriptions(api_key_id);

create table push_deliveries (
    id integer primary key,
    subscription_id integer not null
        references push_subscriptions(id) on delete cascade,
    event_type text not null
        check (event_type in ('gist.published', 'gist.updated')),
    gist_revision_id integer not null references gist_revisions(id),
    status text not null default 'pending'
        check (status in ('pending', 'delivered', 'dead')),
    attempt_count integer not null default 0
        check (attempt_count >= 0),
    next_attempt_at text not null,
    last_result text null,
    created_at text not null,
    completed_at text null,
    unique (subscription_id, event_type, gist_revision_id),
    check (
        (status = 'pending' and completed_at is null)
        or
        (status in ('delivered', 'dead') and completed_at is not null)
    )
);

create index idx_push_deliveries_due
    on push_deliveries(next_attempt_at, id)
    where status = 'pending';
