from pathlib import Path

import gist_api.markdown as markdown_module
from gist_api.db import gist_connection
from gist_api.markdown import render_markdown_result, render_version
from gist_api.service import rerender_gists
from lxml import html as html_parser

from .conftest import create_gist, make_key


FIXTURE_DIR = Path(__file__).with_name("fixtures")
ETH_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678"
ETH_ADDRESS_2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
ETH_TX_HASH = "0x" + "a1" * 32
ETH_TX_HASH_2 = "0x" + "b2" * 32
ETH_SELECTOR = "0xa9059cbb"
ENS_NAME = "vaults.yearn.eth"


def _class_tokens(element):
    return set(element.attrib.get("class", "").split())


def _entity_id(element):
    return next(
        token for token in _class_tokens(element) if token.startswith("eth-id-")
    )


def _class_token_with_prefix(element, prefix):
    return next(
        (token for token in _class_tokens(element) if token.startswith(prefix)),
        None,
    )


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


def test_ethereum_entity_rendering_marks_plain_linked_and_abbreviated_values():
    short_address = f"{ETH_ADDRESS[:8]}...{ETH_ADDRESS[-6:]}"
    short_tx = f"{ETH_TX_HASH[:8]}...{ETH_TX_HASH[-6:]}"
    result = render_markdown_result(
        f"""
Plain address {ETH_ADDRESS} and repeated {ETH_ADDRESS}.

Plain tx {ETH_TX_HASH}.

Linked full [{ETH_ADDRESS}](https://etherscan.io/address/{ETH_ADDRESS})
Linked short [{short_address}](https://etherscan.io/address/{ETH_ADDRESS})
Linked tx [{short_tx}](https://etherscan.io/tx/{ETH_TX_HASH})

Inline code `{ETH_ADDRESS}` gets colored.

```
{ETH_TX_HASH}
```
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    address_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-address ")]'
    )
    tx_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-tx ")]'
    )

    assert len(address_entities) == 5
    assert len(tx_entities) == 2
    assert len({_entity_id(element) for element in address_entities}) == 1
    assert len({_entity_id(element) for element in tx_entities}) == 1
    assert _entity_id(address_entities[0]) != _entity_id(tx_entities[0])

    short_address_links = root.xpath(f'.//a[normalize-space()="{short_address}"]')
    short_tx_links = root.xpath(f'.//a[normalize-space()="{short_tx}"]')
    assert len(short_address_links) == 1
    assert len(short_tx_links) == 1
    assert "eth-address" in _class_tokens(short_address_links[0])
    assert "eth-tx" in _class_tokens(short_tx_links[0])

    inline_code = root.xpath(f'.//code[normalize-space()="{ETH_ADDRESS}"]')
    assert len(inline_code) == 1
    assert "eth-address" in _class_tokens(inline_code[0])
    code_block = root.xpath(".//pre/code")
    assert len(code_block) == 1
    assert "eth-entity" not in html_parser.tostring(
        code_block[0],
        encoding="unicode",
        method="html",
    )
    assert "ethereum-entities/on@" in result.version


def test_ethereum_entity_rendering_assigns_stable_categorical_colors():
    short_address = f"{ETH_ADDRESS[:5]}..{ETH_ADDRESS[-3:]}"
    short_tx = f"{ETH_TX_HASH[:5]}..{ETH_TX_HASH[-3:]}"
    result = render_markdown_result(
        f"""
Address {ETH_ADDRESS} repeated {ETH_ADDRESS}.
Different address {ETH_ADDRESS_2}.
Linked short address [{short_address}](https://etherscan.io/address/{ETH_ADDRESS})

ENS {ENS_NAME} repeated {ENS_NAME}.

Tx {ETH_TX_HASH} repeated {ETH_TX_HASH}.
Different tx {ETH_TX_HASH_2}.
Linked short tx [{short_tx}](https://etherscan.io/tx/{ETH_TX_HASH})

Selector {ETH_SELECTOR}.
At block 22481234.
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    address_entities = root.xpath(
        f'.//*[normalize-space()="{ETH_ADDRESS}" and '
        'contains(concat(" ", @class, " "), " eth-address ")]'
    )
    short_address_links = root.xpath(f'.//a[normalize-space()="{short_address}"]')
    second_address = root.xpath(
        f'.//*[normalize-space()="{ETH_ADDRESS_2}" and '
        'contains(concat(" ", @class, " "), " eth-address ")]'
    )
    ens_entities = root.xpath(
        f'.//*[normalize-space()="{ENS_NAME}" and '
        'contains(concat(" ", @class, " "), " eth-ens ")]'
    )
    tx_entities = root.xpath(
        f'.//*[normalize-space()="{ETH_TX_HASH}" and '
        'contains(concat(" ", @class, " "), " eth-tx ")]'
    )
    short_tx_links = root.xpath(f'.//a[normalize-space()="{short_tx}"]')
    second_tx = root.xpath(
        f'.//*[normalize-space()="{ETH_TX_HASH_2}" and '
        'contains(concat(" ", @class, " "), " eth-tx ")]'
    )
    selector_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-selector ")]'
    )
    block_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-block ")]'
    )

    address_color = _class_token_with_prefix(address_entities[0], "eth-party-color-")
    assert address_color is not None
    assert {address_color} == {
        _class_token_with_prefix(element, "eth-party-color-")
        for element in [*address_entities, *short_address_links]
    }
    assert _class_token_with_prefix(second_address[0], "eth-party-color-") not in {
        None,
        address_color,
    }
    assert {
        _class_token_with_prefix(element, "eth-party-color-")
        for element in ens_entities
    } == {_class_token_with_prefix(ens_entities[0], "eth-party-color-")}

    tx_color = _class_token_with_prefix(tx_entities[0], "eth-tx-color-")
    assert tx_color is not None
    assert {tx_color} == {
        _class_token_with_prefix(element, "eth-tx-color-")
        for element in [*tx_entities, *short_tx_links]
    }
    assert _class_token_with_prefix(second_tx[0], "eth-tx-color-") not in {
        None,
        tx_color,
    }
    assert _class_token_with_prefix(tx_entities[0], "eth-party-color-") is None

    for element in [*selector_entities, *block_entities]:
        assert _class_token_with_prefix(element, "eth-party-color-") is None
        assert _class_token_with_prefix(element, "eth-tx-color-") is None


def test_ethereum_entity_rendering_inferrs_compact_abbreviated_links():
    short_address = f"{ETH_ADDRESS[:5]}..{ETH_ADDRESS[-3:]}"
    short_tx = f"{ETH_TX_HASH[:5]}..{ETH_TX_HASH[-3:]}"
    result = render_markdown_result(
        f"""
Short address [{short_address}](https://etherscan.io/address/{ETH_ADDRESS})
Short tx [{short_tx}](https://etherscan.io/tx/{ETH_TX_HASH})
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    short_address_links = root.xpath(f'.//a[normalize-space()="{short_address}"]')
    short_tx_links = root.xpath(f'.//a[normalize-space()="{short_tx}"]')

    assert len(short_address_links) == 1
    assert len(short_tx_links) == 1
    assert "eth-address" in _class_tokens(short_address_links[0])
    assert "eth-tx" in _class_tokens(short_tx_links[0])


def test_ethereum_entity_rendering_marks_ens_selectors_and_blocks():
    result = render_markdown_result(
        f"""
ENS {ENS_NAME} and linked [Yearn.ETH](https://app.ens.domains/Yearn.ETH).

Selector {ETH_SELECTOR} and repeated {ETH_SELECTOR}.

At block 22481234 and later block #22,481,234.
Linked block [22481235](https://etherscan.io/block/22481235)

Bare number should stay plain 22481236.
Bare short hex should stay plain 0x123456789.

Inline selector `{ETH_SELECTOR}` gets colored.
Inline ENS `{ENS_NAME}` gets colored.

```
{ENS_NAME}
{ETH_SELECTOR}
block 22481234
```
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    ens_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-ens ")]'
    )
    selector_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-selector ")]'
    )
    block_entities = root.xpath(
        './/*[contains(concat(" ", @class, " "), " eth-block ")]'
    )

    assert len(ens_entities) == 3
    assert len(selector_entities) == 3
    assert len(block_entities) == 3

    repeated_selectors = root.xpath(
        f'.//*[normalize-space()="{ETH_SELECTOR}" and '
        'contains(concat(" ", @class, " "), " eth-selector ")]'
    )
    assert len({_entity_id(element) for element in repeated_selectors}) == 1

    repeated_blocks = root.xpath(
        './/*[normalize-space()="22481234" or normalize-space()="22,481,234"]'
    )
    repeated_blocks = [
        element
        for element in repeated_blocks
        if "eth-block" in _class_tokens(element)
    ]
    assert len(repeated_blocks) == 2
    assert len({_entity_id(element) for element in repeated_blocks}) == 1

    linked_block = root.xpath('.//a[normalize-space()="22481235"]')
    assert len(linked_block) == 1
    assert "eth-block" in _class_tokens(linked_block[0])

    assert "22481236" in result.html
    assert "0x123456789" in result.html
    assert "eth-id-nope" not in result.html

    code_block = root.xpath(".//pre/code")
    assert len(code_block) == 1
    code_block_html = html_parser.tostring(
        code_block[0],
        encoding="unicode",
        method="html",
    )
    assert "eth-entity" not in code_block_html


def test_ethereum_entity_rendering_can_be_disabled():
    result = render_markdown_result(
        f"{ETH_ADDRESS} {ETH_TX_HASH} {ENS_NAME} {ETH_SELECTOR} block 22481234",
        ethereum_entities=False,
    )

    assert "eth-entity" not in result.html
    assert ETH_ADDRESS in result.html
    assert ETH_TX_HASH in result.html
    assert ENS_NAME in result.html
    assert ETH_SELECTOR in result.html
    assert "22481234" in result.html
    assert "ethereum-entities/off" in result.version


def test_ethereum_entity_rendering_leaves_unlinked_abbreviations_plain():
    result = render_markdown_result("Not enough context: 0x1234...5678 and 0x123..678")

    assert "0x1234...5678" in result.html
    assert "0x123..678" in result.html
    assert "eth-entity" not in result.html


def test_ethereum_entity_sanitizer_allows_only_expected_classes():
    result = render_markdown_result(
        '<span class="eth-entity eth-id-nope eth-weird eth-party-color-48 '
        'eth-tx-color-16">not an address</span>'
    )

    assert "eth-id-nope" not in result.html
    assert "eth-weird" not in result.html
    assert "eth-party-color-48" not in result.html
    assert "eth-tx-color-16" not in result.html
    assert "<span>not an address</span>" in result.html

    allowed = render_markdown_result(
        '<span class="eth-entity eth-ens eth-selector eth-block '
        'eth-id-abcdef123456 eth-party-color-47 eth-tx-color-15">'
        "entity</span>"
    )

    assert "eth-ens" in allowed.html
    assert "eth-selector" in allowed.html
    assert "eth-block" in allowed.html
    assert "eth-party-color-47" in allowed.html
    assert "eth-tx-color-15" in allowed.html


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


def test_rerender_gists_honors_ethereum_entity_rendering_config(client, app):
    write_key = make_key(app, ["gist:write"], name="renderer")
    created = create_gist(client, write_key, markdown=ETH_ADDRESS)
    assert created.status_code == 201
    gist_id = created.get_json()["id"]

    with gist_connection(app) as conn:
        assert "eth-address" in conn.execute(
            "select rendered_html from gists where external_id = ?",
            (gist_id,),
        ).fetchone()["rendered_html"]
        with conn:
            conn.execute(
                "update gists set rendered_html = 'old' where external_id = ?",
                (gist_id,),
            )
            conn.execute(
                """
                update gist_revisions
                set rendered_html = 'old'
                where gist_id = (select id from gists where external_id = ?)
                """,
                (gist_id,),
            )

    app.config["ETHEREUM_ENTITY_RENDERING"] = False
    result = rerender_gists(app, external_id=gist_id)
    assert "ethereum-entities/off" in result["render_version"]

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

    assert "eth-entity" not in row["rendered_html"]
    assert "ethereum-entities/off" in row["render_version"]
    assert "eth-entity" not in revision["rendered_html"]
    assert "ethereum-entities/off" in revision["render_version"]
