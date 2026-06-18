import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import bleach
import cmarkgfm
from cmarkgfm import Options
from lxml import etree, html


logger = logging.getLogger(__name__)

SANITIZER_CONFIG_VERSION = "2026-06-18.3"
SYNTAX_CSS_VERSION = "2026-06-02.1"
ETHEREUM_ENTITY_RENDER_VERSION = "2026-06-18.3"
HIGHLIGHT_GRAMMAR_SET = "all"
HIGHLIGHT_SCRIPT = Path(__file__).with_name("render_highlight.mjs")
REPO_ROOT = Path(__file__).resolve().parents[2]

HIGHLIGHT_TIMEOUT_SECONDS = float(os.getenv("GIST_HIGHLIGHT_TIMEOUT_SECONDS", "8"))
MAX_HIGHLIGHT_BLOCK_BYTES = int(
    os.getenv("GIST_MAX_HIGHLIGHT_BLOCK_BYTES", str(200 * 1024))
)
MAX_HIGHLIGHT_BLOCKS = int(os.getenv("GIST_MAX_HIGHLIGHT_BLOCKS", "64"))
MAX_HIGHLIGHT_TOTAL_BYTES = int(
    os.getenv("GIST_MAX_HIGHLIGHT_TOTAL_BYTES", str(512 * 1024))
)
DEFAULT_NODE_BIN_CANDIDATES = (
    "/usr/local/bin/node",
    "/usr/bin/node",
    "/opt/nodejs/current/bin/node",
)

SCRIPTABLE_TAGS = {"script", "style", "svg", "math", "iframe"}
SCRIPTABLE_TEXT_RE = re.compile(
    r"<(script|style|svg|math|iframe)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)

ALLOWED_TAGS = {
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "input",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
}

SAFE_REL_TOKENS = {"nofollow", "noopener", "noreferrer"}
SAFE_DIR_VALUES = {"auto", "ltr", "rtl"}
SAFE_TASK_CLASSES = {"contains-task-list", "task-list-item"}
SAFE_ETHEREUM_CLASSES = {
    "eth-entity",
    "eth-address",
    "eth-ens",
    "eth-labeled-entity",
    "eth-tx",
}
SAFE_EXACT_CLASSES = {"highlight", *SAFE_ETHEREUM_CLASSES}
ETHEREUM_ID_CLASS_RE = re.compile(r"^eth-id-[a-f0-9]{12}$")
ETHEREUM_PARTY_COLOR_CLASS_RE = re.compile(
    r"^eth-party-color-(?:[0-3][0-9]|4[0-7])$"
)
SAFE_CLASS_PATTERNS = (
    re.compile(r"^highlight-(source|text)-[A-Za-z0-9_.+-]+$"),
    re.compile(r"^language-[A-Za-z0-9_.+-]+$"),
    re.compile(r"^pl-[A-Za-z0-9_-]+$"),
    ETHEREUM_ID_CLASS_RE,
    ETHEREUM_PARTY_COLOR_CLASS_RE,
)
ETHEREUM_PARTY_COLOR_KINDS = {"address", "ens"}
ETHEREUM_PARTY_COLOR_COUNT = 48
ETHEREUM_HREF_ENTITY_PRIORITY = ("tx", "address", "ens")
ETHEREUM_FULL_VALUE_PATTERN = r"0x(?:[0-9A-Fa-f]{64}|[0-9A-Fa-f]{40})"
ETHEREUM_FULL_ENTITY_RE = re.compile(
    rf"(?<![0-9A-Za-z])({ETHEREUM_FULL_VALUE_PATTERN})(?![0-9A-Za-z])"
)
ETHEREUM_FULL_VALUE_RE = re.compile(rf"^{ETHEREUM_FULL_VALUE_PATTERN}$")
ETHEREUM_ABBREVIATED_VALUE_RE = re.compile(
    r"^(?P<head>0x[0-9A-Fa-f]{3,})(?:\.{2,3}|…)(?P<tail>[0-9A-Fa-f]{3,})$"
)
ETHEREUM_ABBREVIATED_ENTITY_RE = re.compile(
    r"(?<![0-9A-Za-z])(0x[0-9A-Fa-f]{3,}(?:\.{2,3}|…)[0-9A-Fa-f]{3,})"
    r"(?![0-9A-Za-z])"
)
ETHEREUM_ENS_LABEL_PATTERN = (
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
)
ETHEREUM_ENS_NAME_PATTERN = (
    rf"{ETHEREUM_ENS_LABEL_PATTERN}(?:\.{ETHEREUM_ENS_LABEL_PATTERN})*\.eth"
)
ETHEREUM_ENS_NAME_RE = re.compile(
    rf"(?<![A-Za-z0-9_.-])({ETHEREUM_ENS_NAME_PATTERN})(?![A-Za-z0-9_.-])",
    re.IGNORECASE,
)
ETHEREUM_ENS_VALUE_RE = re.compile(
    rf"^{ETHEREUM_ENS_NAME_PATTERN}$",
    re.IGNORECASE,
)
ETHEREUM_TX_HREF_RE = re.compile(
    r"/tx/(0x[0-9A-Fa-f]{64})(?=$|[/?#])",
    re.IGNORECASE,
)
ETHEREUM_ADDRESS_HREF_RE = re.compile(
    r"/address/(0x[0-9A-Fa-f]{40})(?=$|[/?#])",
    re.IGNORECASE,
)
ETHEREUM_TOKEN_HREF_RE = re.compile(
    r"/token/(0x[0-9A-Fa-f]{40})(?=$|[/?#])",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RenderedMarkdown:
    html: str
    version: str


@dataclass(frozen=True)
class EthereumEntity:
    kind: str
    value: str


@dataclass(frozen=True)
class EthereumEntityTextMatch:
    start: int
    end: int
    entity: EthereumEntity


@dataclass
class HighlightStats:
    candidates: int = 0
    highlighted: int = 0
    fallbacks: int = 0
    degraded: bool = False

    @property
    def status(self):
        if self.degraded:
            return "degraded"
        return "ok" if self.candidates else "none"


def _package_version(package_name):
    try:
        return version(package_name)
    except PackageNotFoundError:
        return "missing"


def _node_package_version(package_name):
    package_json = REPO_ROOT / "node_modules" / package_name / "package.json"
    if package_json.exists():
        try:
            return json.loads(package_json.read_text(encoding="utf-8")).get(
                "version", "unknown"
            )
        except (OSError, json.JSONDecodeError):
            return "unknown"

    return "missing"


def _is_executable_file(path):
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def _node_binary():
    configured = os.getenv("GIST_NODE_BIN")
    if configured:
        return configured if _is_executable_file(configured) else None

    candidates = [shutil.which("node"), *DEFAULT_NODE_BIN_CANDIDATES]
    for candidate in candidates:
        if _is_executable_file(candidate):
            return candidate

    return None


def _render_gfm(markdown):
    return cmarkgfm.github_flavored_markdown_to_html(
        markdown,
        options=Options.CMARK_OPT_UNSAFE,
    )


def _is_code_context(element):
    current = element
    while current is not None:
        if current.tag in {"pre", "code"}:
            return True
        current = current.getparent()
    return False


def _is_link_context(element):
    current = element
    while current is not None:
        if current.tag == "a":
            return True
        current = current.getparent()
    return False


def _is_code_block_context(element):
    current = element
    while current is not None:
        if current.tag == "pre":
            return True
        current = current.getparent()
    return False


def _is_inline_code_element(element):
    return element.tag == "code" and not _is_code_block_context(element)


def _strip_scriptable_text(value):
    if not value:
        return value
    return SCRIPTABLE_TEXT_RE.sub("", value)


def _drop_scriptable_content(root):
    for element in list(root.iter()):
        if element is root:
            continue
        if isinstance(element.tag, str) and element.tag.lower() in SCRIPTABLE_TAGS:
            element.drop_tree()

    for element in root.iter():
        if _is_code_context(element):
            continue
        element.text = _strip_scriptable_text(element.text)
        element.tail = _strip_scriptable_text(element.tail)


def _is_external_href(href):
    return href.startswith("http://") or href.startswith("https://")


def _post_process_links(root):
    for element in root.iter("a"):
        href = element.attrib.get("href", "")
        if not _is_external_href(href):
            continue
        rel = {
            token
            for token in element.attrib.get("rel", "").split()
            if token in SAFE_REL_TOKENS
        }
        rel.add("nofollow")
        element.attrib["rel"] = " ".join(sorted(rel))


def _ethereum_kind(value):
    hex_length = len(value) - 2
    if hex_length == 64:
        return "tx"
    if hex_length == 40:
        return "address"
    return None


def _ethereum_entity_from_value(value):
    if not ETHEREUM_FULL_VALUE_RE.fullmatch(value):
        if ETHEREUM_ENS_VALUE_RE.fullmatch(value):
            return EthereumEntity(kind="ens", value=value.lower())
        return None
    kind = _ethereum_kind(value)
    if kind is None:
        return None
    return EthereumEntity(kind=kind, value=value.lower())


def _unique_entities(entities):
    unique = []
    seen = set()
    for entity in entities:
        if entity is None:
            continue
        key = (entity.kind, entity.value)
        if key in seen:
            continue
        unique.append(entity)
        seen.add(key)
    return unique


def _ethereum_entities_from_href(href):
    entities = []
    for pattern, kind in (
        (ETHEREUM_TX_HREF_RE, "tx"),
        (ETHEREUM_ADDRESS_HREF_RE, "address"),
        (ETHEREUM_TOKEN_HREF_RE, "address"),
    ):
        match = pattern.search(href)
        if match:
            entities.append(EthereumEntity(kind=kind, value=match.group(1).lower()))

    entities.extend(
        _ethereum_entity_from_value(match.group(1))
        for match in ETHEREUM_FULL_ENTITY_RE.finditer(href)
    )

    match = ETHEREUM_ENS_NAME_RE.search(href)
    if match:
        entities.append(EthereumEntity(kind="ens", value=match.group(1).lower()))
    return _unique_entities(entities)


def _preferred_ethereum_entity(entities):
    for kind in ETHEREUM_HREF_ENTITY_PRIORITY:
        for entity in entities:
            if entity.kind == kind:
                return entity
    return None


def _ethereum_abbreviated_value_matches_entity(value, entity):
    if entity.kind not in {"address", "tx"}:
        return False
    match = ETHEREUM_ABBREVIATED_VALUE_RE.fullmatch(value)
    if match is None:
        return False
    head = match.group("head").lower()
    tail = match.group("tail").lower()
    return entity.value.startswith(head) and entity.value.endswith(tail)


def _ethereum_link_text_matches_href_entity(text, entity):
    return _ethereum_abbreviated_value_matches_entity(text, entity)


def _ethereum_full_text_entities(text):
    return _unique_entities(
        _ethereum_entity_from_value(match.group(1))
        for match in ETHEREUM_FULL_ENTITY_RE.finditer(text)
    )


def _ethereum_abbreviated_text_values(text):
    return [match.group(1) for match in ETHEREUM_ABBREVIATED_ENTITY_RE.finditer(text)]


def _matching_entity_from_label(
    text_entities,
    abbreviated_values,
    href_entities,
    kind,
):
    href_matches = [entity for entity in href_entities if entity.kind == kind]
    text_matches = [entity for entity in text_entities if entity.kind == kind]
    if len(text_matches) == 1:
        text_match = text_matches[0]
        if not href_matches or text_match in href_matches:
            return text_match
        return None
    if len(text_matches) > 1:
        return None

    if abbreviated_values:
        matches = _unique_entities(
            entity
            for entity in href_matches
            if any(
                _ethereum_abbreviated_value_matches_entity(value, entity)
                for value in abbreviated_values
            )
        )
        if len(matches) == 1:
            return matches[0]
        return None

    if text_entities:
        return None

    href_matches = _unique_entities(href_matches)
    if len(href_matches) == 1:
        return href_matches[0]
    return None


def _ethereum_link_entity(text, href):
    entity = _ethereum_entity_from_value(text)
    if entity is not None:
        return entity, False

    href_entities = _ethereum_entities_from_href(href)
    href_entity = _preferred_ethereum_entity(href_entities)
    if (
        href_entity is not None
        and _ethereum_link_text_matches_href_entity(text, href_entity)
    ):
        return href_entity, False

    text_entities = _ethereum_full_text_entities(text)
    abbreviated_values = _ethereum_abbreviated_text_values(text)
    for kind in ("address", "tx"):
        labeled_entity = _matching_entity_from_label(
            text_entities,
            abbreviated_values,
            href_entities,
            kind,
        )
        if labeled_entity is not None:
            return labeled_entity, True

    return None, False


def _ethereum_entity_digest(entity):
    return hashlib.sha256(entity.value.encode("ascii")).hexdigest()


def _ethereum_entity_classes(entity, *, labeled=False):
    digest = _ethereum_entity_digest(entity)
    classes = ["eth-entity", f"eth-{entity.kind}", f"eth-id-{digest[:12]}"]
    if labeled:
        classes.append("eth-labeled-entity")
    return " ".join(classes)


def _set_ethereum_entity_classes(element, entity, *, labeled=False):
    element.attrib["class"] = _ethereum_entity_classes(entity, labeled=labeled)


def _element_class_tokens(element):
    return element.attrib.get("class", "").split()


def _ethereum_entity_id_class(classes):
    return next(
        (
            class_name
            for class_name in classes
            if ETHEREUM_ID_CLASS_RE.fullmatch(class_name)
        ),
        None,
    )


def _has_ethereum_party_color_kind(classes):
    return any(f"eth-{kind}" in classes for kind in ETHEREUM_PARTY_COLOR_KINDS)


def _assign_ethereum_party_colors(root):
    color_by_entity_id = {}
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        classes = _element_class_tokens(element)
        next_classes = [
            class_name
            for class_name in classes
            if not ETHEREUM_PARTY_COLOR_CLASS_RE.fullmatch(class_name)
        ]
        entity_id = _ethereum_entity_id_class(classes)
        if entity_id is None or not _has_ethereum_party_color_kind(classes):
            if len(next_classes) != len(classes):
                element.attrib["class"] = " ".join(next_classes)
            continue

        color_class = color_by_entity_id.get(entity_id)
        if color_class is None:
            color_class = (
                f"eth-party-color-"
                f"{len(color_by_entity_id) % ETHEREUM_PARTY_COLOR_COUNT:02d}"
            )
            color_by_entity_id[entity_id] = color_class

        next_classes.append(color_class)
        element.attrib["class"] = " ".join(next_classes)


def _ethereum_text_matches(value):
    candidates = []

    for match in ETHEREUM_FULL_ENTITY_RE.finditer(value):
        entity = _ethereum_entity_from_value(match.group(1))
        if entity is not None:
            candidates.append(
                EthereumEntityTextMatch(match.start(1), match.end(1), entity)
            )

    for match in ETHEREUM_ENS_NAME_RE.finditer(value):
        entity = _ethereum_entity_from_value(match.group(1))
        if entity is not None:
            candidates.append(
                EthereumEntityTextMatch(match.start(1), match.end(1), entity)
            )

    candidates.sort(key=lambda candidate: (candidate.start, -candidate.end))
    matches = []
    previous_end = 0
    for candidate in candidates:
        if candidate.start < previous_end:
            continue
        matches.append(candidate)
        previous_end = candidate.end
    return matches


def _ethereum_span_for_entity(text, entity):
    span = etree.Element("span")
    _set_ethereum_entity_classes(span, entity)
    span.text = text
    return span


def _ethereum_fragments(value):
    if not value:
        return None

    fragments = []
    previous_end = 0
    for match in _ethereum_text_matches(value):
        if match.start > previous_end:
            fragments.append(value[previous_end:match.start])
        entity_span = _ethereum_span_for_entity(
            value[match.start:match.end],
            match.entity,
        )
        fragments.append(entity_span)
        previous_end = match.end

    if not fragments:
        return None
    if previous_end < len(value):
        fragments.append(value[previous_end:])
    return fragments


def _replace_element_text(element, fragments):
    element.text = None
    insert_at = 0
    previous_element = None
    for fragment in fragments:
        if isinstance(fragment, str):
            if previous_element is None:
                element.text = (element.text or "") + fragment
            else:
                previous_element.tail = (previous_element.tail or "") + fragment
            continue

        element.insert(insert_at, fragment)
        insert_at += 1
        previous_element = fragment


def _replace_child_tail(parent, child, fragments):
    child.tail = None
    insert_at = parent.index(child) + 1
    previous_element = child
    for fragment in fragments:
        if isinstance(fragment, str):
            previous_element.tail = (previous_element.tail or "") + fragment
            continue

        parent.insert(insert_at, fragment)
        insert_at += 1
        previous_element = fragment


def _post_process_ethereum_links(root):
    for element in root.iter("a"):
        if _is_code_block_context(element):
            continue
        text = element.text_content().strip()
        entity, labeled = _ethereum_link_entity(text, element.attrib.get("href", ""))
        if entity is not None:
            _set_ethereum_entity_classes(element, entity, labeled=labeled)


def _post_process_ethereum_inline_code(root):
    for element in root.iter("code"):
        if _is_code_block_context(element):
            continue
        entity = _ethereum_entity_from_value(element.text_content().strip())
        if entity is not None:
            _set_ethereum_entity_classes(element, entity)


def _wrap_plain_ethereum_entities(root):
    for element in list(root.iter()):
        if not isinstance(element.tag, str):
            continue
        if (
            _is_code_block_context(element)
            or _is_link_context(element)
            or _is_inline_code_element(element)
        ):
            continue

        text_fragments = _ethereum_fragments(element.text)
        if text_fragments is not None:
            _replace_element_text(element, text_fragments)

        for child in list(element):
            tail_fragments = _ethereum_fragments(child.tail)
            if tail_fragments is not None:
                _replace_child_tail(element, child, tail_fragments)


def _post_process_ethereum_entities(root):
    _post_process_ethereum_links(root)
    _post_process_ethereum_inline_code(root)
    _wrap_plain_ethereum_entities(root)
    _assign_ethereum_party_colors(root)


def _code_text(pre):
    code = pre.find("code")
    if code is None:
        return pre.text_content()
    return code.text_content()


def _language_class(language):
    safe_language = re.sub(r"[^A-Za-z0-9_.+-]", "-", language.strip().lower())
    return f"language-{safe_language}" if safe_language else None


def _plain_code_block(language, code):
    pre = etree.Element("pre")
    code_element = etree.SubElement(pre, "code")
    language_class = _language_class(language)
    if language_class:
        code_element.attrib["class"] = language_class
    code_element.text = code
    return pre


def _scope_to_highlight_class(scope):
    safe_scope = re.sub(r"[^A-Za-z0-9_.+-]", "-", scope)
    return f"highlight-{safe_scope.replace('.', '-')}"


def _highlight_payload(blocks):
    node_binary = _node_binary()
    if node_binary is None:
        logger.warning(
            "Gist code highlighting failed",
            extra={"reason": "node_binary_missing"},
        )
        return {}, True

    process = subprocess.run(
        [node_binary, str(HIGHLIGHT_SCRIPT)],
        cwd=str(REPO_ROOT),
        input=json.dumps(
            {
                "grammar_set": HIGHLIGHT_GRAMMAR_SET,
                "blocks": blocks,
            }
        ),
        text=True,
        capture_output=True,
        timeout=HIGHLIGHT_TIMEOUT_SECONDS,
        check=False,
    )
    if process.returncode != 0:
        logger.warning(
            "Gist code highlighting failed",
            extra={"returncode": process.returncode, "reason": "process_error"},
        )
        return {}, True

    try:
        data = json.loads(process.stdout)
    except json.JSONDecodeError:
        logger.warning("Gist code highlighting failed", extra={"reason": "bad_json"})
        return {}, True

    highlighted = {}
    for item in data.get("blocks", []):
        if not item.get("ok"):
            continue
        index = item.get("index")
        if not isinstance(index, int):
            continue
        highlighted[index] = item
    return highlighted, False


def _highlight_blocks(root):
    stats = HighlightStats()
    candidates = []
    total_candidate_bytes = 0
    pre_elements = list(root.xpath(".//pre[@lang]"))
    for index, pre in enumerate(pre_elements):
        language = pre.attrib.get("lang", "")
        code = _code_text(pre)
        byte_count = len(code.encode("utf-8"))
        if byte_count > MAX_HIGHLIGHT_BLOCK_BYTES:
            stats.fallbacks += 1
            stats.degraded = True
            logger.info(
                "Skipping gist code highlighting",
                extra={
                    "language": language,
                    "byte_count": byte_count,
                    "reason": "too_large",
                },
            )
            continue
        if len(candidates) >= MAX_HIGHLIGHT_BLOCKS:
            stats.fallbacks += 1
            stats.degraded = True
            logger.info(
                "Skipping gist code highlighting",
                extra={
                    "language": language,
                    "byte_count": byte_count,
                    "reason": "too_many_blocks",
                },
            )
            continue
        if total_candidate_bytes + byte_count > MAX_HIGHLIGHT_TOTAL_BYTES:
            stats.fallbacks += 1
            stats.degraded = True
            logger.info(
                "Skipping gist code highlighting",
                extra={
                    "language": language,
                    "byte_count": byte_count,
                    "reason": "highlight_budget_exceeded",
                },
            )
            continue
        candidates.append({"index": index, "language": language, "code": code})
        total_candidate_bytes += byte_count
    stats.candidates = len(candidates)

    highlighted = {}
    if candidates and not HIGHLIGHT_SCRIPT.exists():
        stats.degraded = True
        logger.warning(
            "Gist code highlighting failed",
            extra={"reason": "highlight_script_missing"},
        )
    elif candidates:
        try:
            highlighted, degraded = _highlight_payload(candidates)
            stats.degraded = stats.degraded or degraded
        except (
            OSError,
            subprocess.SubprocessError,
            subprocess.TimeoutExpired,
            ValueError,
        ) as exc:
            highlighted = {}
            stats.degraded = True
            logger.warning(
                "Gist code highlighting failed",
                extra={
                    "reason": "highlight_exception",
                    "error_type": type(exc).__name__,
                },
            )

    for index, pre in enumerate(pre_elements):
        language = pre.attrib.get("lang", "")
        item = highlighted.get(index)

        if not item:
            stats.fallbacks += 1
            logger.info(
                "Using plain gist code block",
                extra={
                    "language": language,
                    "byte_count": len(_code_text(pre).encode("utf-8")),
                    "reason": "unrecognized_or_failed",
                },
            )
            replacement = _plain_code_block(language, _code_text(pre))
            pre.getparent().replace(pre, replacement)
            continue

        wrapper = etree.Element("div")
        highlight_class = item.get("class_name") or _scope_to_highlight_class(
            item["scope"]
        )
        wrapper.attrib["class"] = (
            f"highlight {highlight_class}"
        )
        wrapper.attrib["dir"] = "auto"
        highlighted_pre = etree.SubElement(wrapper, "pre")
        fragments = html.fragments_fromstring(item["html"])
        for fragment in fragments:
            if isinstance(fragment, str):
                if len(highlighted_pre):
                    last = highlighted_pre[-1]
                    last.tail = (last.tail or "") + fragment
                else:
                    highlighted_pre.text = (highlighted_pre.text or "") + fragment
            else:
                highlighted_pre.append(fragment)

        pre.getparent().replace(pre, wrapper)
        stats.highlighted += 1

    return stats


def _parse_fragment(raw_html):
    return html.fragment_fromstring(raw_html, create_parent="div")


def _serialize_fragment(root):
    return "".join(
        html.tostring(child, encoding="unicode", method="html") for child in root
    )


def _safe_class_token(token):
    if token in SAFE_EXACT_CLASSES or token in SAFE_TASK_CLASSES:
        return True
    return any(pattern.fullmatch(token) for pattern in SAFE_CLASS_PATTERNS)


def _safe_class_value(value):
    tokens = value.split()
    return bool(tokens) and all(_safe_class_token(token) for token in tokens)


def _allow_attribute(tag, name, value):
    if name == "class":
        return tag in {"a", "code", "div", "li", "pre", "span", "ul"} and _safe_class_value(
            value
        )

    if name == "dir":
        return value in SAFE_DIR_VALUES

    if tag == "a":
        if name in {"href", "title"}:
            return True
        if name == "rel":
            tokens = value.split()
            return bool(tokens) and all(token in SAFE_REL_TOKENS for token in tokens)
        return False

    if tag == "img":
        if name == "src":
            return value.startswith("https://")
        return name in {"alt", "title", "width", "height"}

    if tag == "input":
        if name == "type":
            return value == "checkbox"
        return name in {"checked", "disabled"}

    if tag in {"td", "th"} and name == "align":
        return value in {"left", "right", "center"}

    return False


def render_markdown_result(markdown, *, ethereum_entities=True):
    raw_html = _render_gfm(markdown)
    root = _parse_fragment(raw_html)
    _drop_scriptable_content(root)
    highlight_stats = _highlight_blocks(root)
    _post_process_links(root)
    if ethereum_entities:
        _post_process_ethereum_entities(root)
    processed_html = _serialize_fragment(root)

    cleaned_html = bleach.clean(
        processed_html,
        tags=ALLOWED_TAGS,
        attributes=_allow_attribute,
        protocols=["http", "https", "mailto"],
        strip=True,
        strip_comments=True,
    )
    return RenderedMarkdown(
        html=cleaned_html,
        version=render_version(
            highlight_stats.status,
            ethereum_entities=ethereum_entities,
        ),
    )


def render_version(highlight_status="unknown", *, ethereum_entities=True):
    ethereum_status = (
        f"on@{ETHEREUM_ENTITY_RENDER_VERSION}" if ethereum_entities else "off"
    )
    return (
        f"cmarkgfm/{_package_version('cmarkgfm')};"
        f"starry-night/{_node_package_version('@wooorm/starry-night')};"
        f"grammar/{HIGHLIGHT_GRAMMAR_SET};"
        f"highlight/{highlight_status};"
        f"ethereum-entities/{ethereum_status};"
        f"bleach/{_package_version('bleach')};"
        f"lxml/{_package_version('lxml')};"
        f"syntax-css/{SYNTAX_CSS_VERSION};"
        f"sanitizer/{SANITIZER_CONFIG_VERSION}"
    )
