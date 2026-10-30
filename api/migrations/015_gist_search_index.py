def upgrade(conn):
    conn.execute(
        "create virtual table gist_search using fts5(body, tokenize = 'trigram')"
    )
    conn.execute(
        """
        insert into gist_search(rowid, body)
        select
            g.id,
            wg_casefold(g.external_id) || char(10)
                || wg_casefold(coalesce(r.title, '')) || char(10)
                || (
                    select group_concat(
                        wg_casefold(f.filename) || char(10) || wg_casefold(f.content),
                        char(10)
                    )
                    from gist_revision_files f
                    where f.gist_revision_id = r.id
                )
        from gists g
        join gist_revisions r
          on r.gist_id = g.id and r.revision_number = g.latest_revision_number
        where g.deleted_at is null
        """
    )
