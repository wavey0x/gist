def upgrade(conn):
    conn.execute(
        """
        create table listen_queue (
            api_key_id integer not null references api_keys(id) on delete cascade,
            gist_id integer not null references gists(id) on delete cascade,
            position integer not null check (position >= 0),
            added_at text not null,
            primary key (api_key_id, gist_id)
        )
        """
    )
    conn.execute(
        "create index idx_listen_queue_key_position on listen_queue(api_key_id, position)"
    )
