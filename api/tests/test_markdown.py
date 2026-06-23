import re
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
ETH_TOKEN_ADDRESS = "0xd533a949740bb3306d119cc777fa900ba034cd52"
ETH_ATTACKER_ADDRESS = "0x6952d9246e9aFE8B887B2877225163436F78E97F"
ETH_PROCESSOR_ADDRESS = "0x737901bea3eeb88459df9ef1BE8fF3Ae1B42A2ba"
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


def _relative_luminance(color):
    channels = [
        int(color[index : index + 2], 16) / 255
        for index in (1, 3, 5)
    ]
    linear_channels = [
        channel / 12.92
        if channel <= 0.03928
        else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    ]
    red, green, blue = linear_channels
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast_ratio(foreground, background):
    lighter, darker = sorted(
        [_relative_luminance(foreground), _relative_luminance(background)],
        reverse=True,
    )
    return (lighter + 0.05) / (darker + 0.05)


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


def test_markdown_rendering_drops_images_without_allowed_prefix():
    markdown = (
        "![tracked](https://tracker.example/pixel.png)\n"
        "![kept](https://api.example.com/api/v1/images/img_abc1234567890abc)"
    )

    result = render_markdown_result(markdown)
    assert "<img" not in result.html

    allowed = render_markdown_result(
        markdown,
        allowed_image_src_prefixes=("https://api.example.com/api/v1/images/",),
    )
    assert "tracker.example" not in allowed.html
    assert (
        '<img src="https://api.example.com/api/v1/images/img_abc1234567890abc" alt="kept">'
        in allowed.html
    )


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


def test_ethereum_entity_rendering_assigns_party_colors_and_keeps_txs_neutral():
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

    for element in [*tx_entities, *short_tx_links, *second_tx]:
        assert _class_token_with_prefix(element, "eth-party-color-") is None
        assert _class_token_with_prefix(element, "eth-tx-color-") is None

    assert "eth-selector" not in result.html
    assert "eth-block" not in result.html


def test_ethereum_entity_rendering_uses_document_local_party_colors():
    result = render_markdown_result(
        f"""
[attacker EOA (0x695..97F)](https://etherscan.io/address/{ETH_ATTACKER_ADDRESS})
[RollupProcessor (0x737..2ba)](https://etherscan.io/address/{ETH_PROCESSOR_ADDRESS})
[same attacker (0x695..97F)](https://etherscan.io/address/{ETH_ATTACKER_ADDRESS})
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    attacker_links = root.xpath('.//a[contains(normalize-space(), "0x695..97F")]')
    processor_links = root.xpath('.//a[contains(normalize-space(), "0x737..2ba")]')
    assert len(attacker_links) == 2
    assert len(processor_links) == 1

    attacker_colors = {
        _class_token_with_prefix(element, "eth-party-color-")
        for element in attacker_links
    }
    processor_color = _class_token_with_prefix(
        processor_links[0], "eth-party-color-"
    )

    assert len(attacker_colors) == 1
    assert next(iter(attacker_colors)) is not None
    assert processor_color is not None
    assert processor_color not in attacker_colors


def test_ethereum_entity_rendering_inferrs_compact_abbreviated_links():
    short_address = f"{ETH_ADDRESS[:5]}..{ETH_ADDRESS[-3:]}"
    medium_address = f"{ETH_ADDRESS[:6]}...{ETH_ADDRESS[-4:]}"
    ellipsis_address = f"0x{ETH_ADDRESS_2[2:7].upper()}…{ETH_ADDRESS_2[-3:].upper()}"
    mismatched_address = f"{ETH_ADDRESS[:5]}..999"
    short_tx = f"{ETH_TX_HASH[:5]}..{ETH_TX_HASH[-3:]}"
    medium_tx = f"{ETH_TX_HASH[:6]}...{ETH_TX_HASH[-4:]}"
    mismatched_tx = f"{ETH_TX_HASH[:5]}..b2b"
    result = render_markdown_result(
        f"""
Short address [{short_address}](https://etherscan.io/address/{ETH_ADDRESS})
Medium address [{medium_address}](https://etherscan.io/address/{ETH_ADDRESS})
Ellipsis address [{ellipsis_address}](https://etherscan.io/address/{ETH_ADDRESS_2})
Mismatched address [{mismatched_address}](https://etherscan.io/address/{ETH_ADDRESS})
Short tx [{short_tx}](https://etherscan.io/tx/{ETH_TX_HASH})
Medium tx [{medium_tx}](https://etherscan.io/tx/{ETH_TX_HASH})
Mismatched tx [{mismatched_tx}](https://etherscan.io/tx/{ETH_TX_HASH})
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    address_labels = [short_address, medium_address, ellipsis_address]
    tx_labels = [short_tx, medium_tx]

    for label in address_labels:
        links = root.xpath(f'.//a[normalize-space()="{label}"]')
        assert len(links) == 1
        assert "eth-address" in _class_tokens(links[0])

    for label in tx_labels:
        links = root.xpath(f'.//a[normalize-space()="{label}"]')
        assert len(links) == 1
        assert "eth-tx" in _class_tokens(links[0])

    mismatched_address_links = root.xpath(
        f'.//a[normalize-space()="{mismatched_address}"]'
    )
    mismatched_tx_links = root.xpath(f'.//a[normalize-space()="{mismatched_tx}"]')
    assert len(mismatched_address_links) == 1
    assert len(mismatched_tx_links) == 1
    assert "eth-address" not in _class_tokens(mismatched_address_links[0])
    assert "eth-tx" not in _class_tokens(mismatched_tx_links[0])


def test_ethereum_entity_rendering_colors_labeled_address_links():
    short_address = f"{ETH_ADDRESS[:5]}..{ETH_ADDRESS[-3:]}"
    short_token = f"{ETH_TOKEN_ADDRESS[:7]}..{ETH_TOKEN_ADDRESS[-4:]}"
    short_second_address = f"{ETH_ADDRESS_2[:6]}..{ETH_ADDRESS_2[-4:]}"
    result = render_markdown_result(
        f"""
Address label [attacker EOA ({short_address})](https://etherscan.io/address/{ETH_ADDRESS})
Token label [CRV token ({short_token})](https://etherscan.io/token/{ETH_TOKEN_ADDRESS})
Token href only [CRV token](https://etherscan.io/token/{ETH_TOKEN_ADDRESS})
Text-only address [standalone {ETH_ADDRESS_2}](https://example.com/report)
Mismatched label [bad ({short_second_address})](https://etherscan.io/address/{ETH_ADDRESS})
Ambiguous href [ambiguous](https://etherscan.io/token/{ETH_TOKEN_ADDRESS}?a={ETH_ADDRESS_2})
Disambiguated href [recipient ({short_second_address})](https://etherscan.io/token/{ETH_TOKEN_ADDRESS}?a={ETH_ADDRESS_2})
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    labeled_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [
            f"attacker EOA ({short_address})",
            f"CRV token ({short_token})",
            "CRV token",
            f"standalone {ETH_ADDRESS_2}",
            f"recipient ({short_second_address})",
        ]
    ]

    for link in labeled_links:
        assert "eth-address" in _class_tokens(link)
        assert "eth-labeled-entity" in _class_tokens(link)
        assert _class_token_with_prefix(link, "eth-party-color-") is not None

    token_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [f"CRV token ({short_token})", "CRV token"]
    ]
    assert len({_entity_id(link) for link in token_links}) == 1
    assert len(
        {_class_token_with_prefix(link, "eth-party-color-") for link in token_links}
    ) == 1

    second_address_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [
            f"standalone {ETH_ADDRESS_2}",
            f"recipient ({short_second_address})",
        ]
    ]
    assert len({_entity_id(link) for link in second_address_links}) == 1

    mismatched_link = root.xpath(
        f'.//a[normalize-space()="bad ({short_second_address})"]'
    )[0]
    ambiguous_link = root.xpath('.//a[normalize-space()="ambiguous"]')[0]
    assert "eth-entity" not in _class_tokens(mismatched_link)
    assert "eth-entity" not in _class_tokens(ambiguous_link)


def test_ethereum_entity_rendering_colors_labeled_transaction_links():
    short_tx = f"{ETH_TX_HASH[:5]}..{ETH_TX_HASH[-3:]}"
    short_second_tx = f"{ETH_TX_HASH_2[:6]}..{ETH_TX_HASH_2[-4:]}"
    result = render_markdown_result(
        f"""
Tx label [ETH drain ({short_tx})](https://etherscan.io/tx/{ETH_TX_HASH})
Tx href only [ETH drain](https://etherscan.io/tx/{ETH_TX_HASH})
Text-only tx [standalone {ETH_TX_HASH_2}](https://example.com/report)
Mismatched tx label [bad ({short_second_tx})](https://etherscan.io/tx/{ETH_TX_HASH})
Ambiguous tx href [ambiguous](https://etherscan.io/tx/{ETH_TX_HASH}?related={ETH_TX_HASH_2})
Disambiguated tx href [related ({short_second_tx})](https://etherscan.io/tx/{ETH_TX_HASH}?related={ETH_TX_HASH_2})
"""
    )

    root = html_parser.fragment_fromstring(result.html, create_parent="div")
    labeled_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [
            f"ETH drain ({short_tx})",
            "ETH drain",
            f"standalone {ETH_TX_HASH_2}",
            f"related ({short_second_tx})",
        ]
    ]

    for link in labeled_links:
        assert "eth-tx" in _class_tokens(link)
        assert "eth-labeled-entity" in _class_tokens(link)
        assert _class_token_with_prefix(link, "eth-party-color-") is None

    repeated_tx_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [f"ETH drain ({short_tx})", "ETH drain"]
    ]
    assert len({_entity_id(link) for link in repeated_tx_links}) == 1

    second_tx_links = [
        root.xpath(f'.//a[normalize-space()="{label}"]')[0]
        for label in [
            f"standalone {ETH_TX_HASH_2}",
            f"related ({short_second_tx})",
        ]
    ]
    assert len({_entity_id(link) for link in second_tx_links}) == 1

    mismatched_link = root.xpath(
        f'.//a[normalize-space()="bad ({short_second_tx})"]'
    )[0]
    ambiguous_link = root.xpath('.//a[normalize-space()="ambiguous"]')[0]
    assert "eth-entity" not in _class_tokens(mismatched_link)
    assert "eth-entity" not in _class_tokens(ambiguous_link)


def test_ethereum_entity_rendering_marks_ens_but_leaves_selectors_and_blocks_plain():
    result = render_markdown_result(
        f"""
ENS {ENS_NAME} and linked [Yearn.ETH](https://app.ens.domains/Yearn.ETH).

Selector {ETH_SELECTOR} and repeated {ETH_SELECTOR}.

At block 22481234 and later block #22,481,234.
Linked block [22481235](https://etherscan.io/block/22481235)

Bare number should stay plain 22481236.
Bare short hex should stay plain 0x123456789.

Inline selector `{ETH_SELECTOR}` stays plain.
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

    assert len(ens_entities) == 3

    linked_block = root.xpath('.//a[normalize-space()="22481235"]')
    assert len(linked_block) == 1
    assert "eth-entity" not in _class_tokens(linked_block[0])

    assert ETH_SELECTOR in result.html
    assert "22481234" in result.html
    assert "22,481,234" in result.html
    assert "22481236" in result.html
    assert "0x123456789" in result.html
    assert "eth-id-nope" not in result.html
    assert "eth-selector" not in result.html
    assert "eth-block" not in result.html

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
        '<span class="eth-entity eth-selector eth-block eth-id-nope eth-weird '
        'eth-party-color-48 eth-tx-color-15 eth-tx-color-16">'
        "not an address</span>"
    )

    assert "eth-selector" not in result.html
    assert "eth-block" not in result.html
    assert "eth-id-nope" not in result.html
    assert "eth-weird" not in result.html
    assert "eth-party-color-48" not in result.html
    assert "eth-tx-color-15" not in result.html
    assert "eth-tx-color-16" not in result.html
    assert "<span>not an address</span>" in result.html

    allowed = render_markdown_result(
        '<span class="eth-entity eth-ens eth-labeled-entity '
        'eth-id-abcdef123456 eth-party-color-47">'
        "entity</span>"
    )

    assert "eth-ens" in allowed.html
    assert "eth-labeled-entity" in allowed.html
    assert "eth-party-color-00" in allowed.html

    non_party = render_markdown_result(
        '<span class="eth-entity eth-tx eth-id-abcdef123456 '
        'eth-party-color-47">selector</span>'
    )

    assert "eth-tx" in non_party.html
    assert "eth-party-color-47" not in non_party.html


def test_markdown_theme_uses_strict_grayscale_for_transaction_hashes():
    theme_css = (
        Path(__file__).resolve().parents[2] / "ui/app/markdown-theme.css"
    ).read_text(encoding="utf-8")

    assert "eth-tx-color-" not in theme_css

    tx_foregrounds = re.findall(
        r"--eth-tx-fg:\s*(#[0-9A-Fa-f]{6});",
        theme_css,
    )
    assert len(tx_foregrounds) == 2

    tx_backgrounds = re.findall(
        r"--eth-tx-bg:\s*(#[0-9A-Fa-f]{6});",
        theme_css,
    )
    assert len(tx_backgrounds) == 2

    for foreground, background in zip(tx_foregrounds, tx_backgrounds):
        for color in (foreground, background):
            channels = [color[index : index + 2].lower() for index in (1, 3, 5)]
            assert channels[0] == channels[1] == channels[2]

        assert _contrast_ratio(foreground, background) >= 7


def test_markdown_theme_uses_generated_party_color_palette():
    theme_css = (
        Path(__file__).resolve().parents[2] / "ui/app/markdown-theme.css"
    ).read_text(encoding="utf-8")

    assert "--eth-party-color-" not in theme_css
    assert "--eth-block-fg" not in theme_css
    assert "--eth-selector-fg" not in theme_css
    assert ".eth-block" not in theme_css
    assert ".eth-selector" not in theme_css
    assert theme_css.count("--eth-party-lightness:") == 2
    assert theme_css.count("--eth-party-chroma:") == 2
    assert (
        "var(--eth-party-lightness) var(--eth-party-chroma) "
        "var(--eth-party-hue)"
    ) in theme_css
    assert ".markdown-body a.eth-labeled-entity" in theme_css
    assert '.eth-address[class*="eth-party-color-"]' in theme_css
    assert '.eth-ens[class*="eth-party-color-"]' in theme_css

    hue_classes = re.findall(
        r"\.markdown-body \.eth-party-color-([0-9]{2}) "
        r"\{ --eth-party-hue: ([0-9]+)deg; \}",
        theme_css,
    )
    assert len(hue_classes) == 48
    assert {index for index, _hue in hue_classes} == {
        f"{index:02d}" for index in range(48)
    }
    assert len({hue for _index, hue in hue_classes}) == 48


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
    write_key = make_key(app, name="renderer")
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
    write_key = make_key(app, name="renderer")
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
