from pathlib import Path

import gist_api.markdown as markdown_module
from gist_api.db import gist_connection
from gist_api.markdown import render_markdown_result, render_version
from gist_api.service import rerender_gists

from .conftest import create_gist, make_key


FIXTURE_DIR = Path(__file__).with_name("fixtures")


def test_markdown_rendering_uses_gfm_highlighting_links_and_sanitizer():
    markdown = (FIXTURE_DIR / "github_like_gist.md").read_text(encoding="utf-8")
    result = render_markdown_result(markdown)
    html = result.html

    assert "<table>" in html
    assert html.count("<table>") == 2
    assert "<th>Field</th>" in html
    assert "highlight highlight-source-solidity" in html
    assert html.count("highlight highlight-source-solidity") == 2
    assert "highlight highlight-source-vyper" in html
    assert "highlight highlight-source-go" in html
    assert "highlight highlight-source-python" in html
    assert "highlight highlight-source-shell" in html
    assert "highlight highlight-source-json" in html
    assert "highlight highlight-source-yaml" in html
    assert "highlight highlight-source-ts" in html
    assert "highlight highlight-text-md" in html
    assert "highlight highlight-source-sql" in html
    assert "highlight highlight-source-rust" in html
    assert "highlight highlight-source-diff" in html
    assert 'class="pl-' in html
    assert '<input type="checkbox" checked disabled>' in html
    assert '<input type="checkbox" disabled>' in html
    assert "<del>deprecated</del>" in html
    assert '<code class="language-unknownlang">&lt;tag onclick="bad()"&gt;' in html
    assert "<code>indented code remains plain\n</code>" in html
    assert '<a href="https://example.com" rel="nofollow">https://example.com</a>' in html
    assert "javascript:" not in html
    assert "<a>bad</a>" in html
    assert "alert(" not in html
    assert "<script" not in html
    assert "<style" not in html
    assert "<svg" not in html
    assert "<math" not in html
    assert "<iframe" not in html
    assert 'class="bad"' not in html
    assert 'class="pl-c bad"' not in html
    assert "cmarkgfm/" in render_version()
    assert "starry-night/" in render_version()
    assert "syntax-css/" in render_version()
    assert "highlight/ok" in result.version


def test_markdown_rendering_marks_degraded_when_node_is_missing(monkeypatch):
    monkeypatch.setenv("GIST_NODE_BIN", "/does/not/exist/node")
    result = render_markdown_result("```python\nprint('hi')\n```")

    assert '<code class="language-python">print(\'hi\')\n</code>' in result.html
    assert "highlight/degraded" in result.version


def test_markdown_highlighting_degrades_after_aggregate_block_cap(monkeypatch):
    monkeypatch.setattr(markdown_module, "MAX_HIGHLIGHT_BLOCKS", 1)
    result = render_markdown_result(
        "```python\nprint('one')\n```\n\n```python\nprint('two')\n```"
    )

    assert result.html.count("highlight highlight-source-python") == 1
    assert '<code class="language-python">print(\'two\')\n</code>' in result.html
    assert "highlight/degraded" in result.version


def test_rerender_gists_updates_current_rows_and_revisions(client, app):
    write_key = make_key(app, ["gist:write"], name="renderer")
    created = create_gist(
        client,
        write_key,
        markdown="```python\nprint('hi')\n```",
    )
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    with gist_connection(app) as conn:
        with conn:
            conn.execute(
                """
                update gists
                set rendered_html = 'old', render_version = 'old'
                where external_id = ?
                """,
                (gist_id,),
            )
            conn.execute(
                """
                update gist_revisions
                set rendered_html = 'old', render_version = 'old'
                where gist_id = (select id from gists where external_id = ?)
                """,
                (gist_id,),
            )

    dry_run = rerender_gists(app, external_id=gist_id, dry_run=True)
    assert dry_run["dry_run"] is True
    assert dry_run["gists"] == 1
    assert dry_run["revisions"] == 1

    with gist_connection(app) as conn:
        row = conn.execute(
            "select rendered_html, render_version from gists where external_id = ?",
            (gist_id,),
        ).fetchone()
        assert dict(row) == {"rendered_html": "old", "render_version": "old"}

    result = rerender_gists(app, external_id=gist_id)
    assert result["dry_run"] is False
    assert result["gists"] == 1
    assert result["revisions"] == 1

    with gist_connection(app) as conn:
        row = conn.execute(
            "select rendered_html, render_version from gists where external_id = ?",
            (gist_id,),
        ).fetchone()
        revision = conn.execute(
            """
            select rendered_html, render_version
            from gist_revisions
            where gist_id = (select id from gists where external_id = ?)
            """,
            (gist_id,),
        ).fetchone()

    assert "highlight highlight-source-python" in row["rendered_html"]
    assert "cmarkgfm/" in row["render_version"]
    assert "highlight/ok" in row["render_version"]
    assert "highlight highlight-source-python" in revision["rendered_html"]
    assert "cmarkgfm/" in revision["render_version"]
    assert "highlight/ok" in revision["render_version"]
