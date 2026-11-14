// Code files as real lines, and links to them.
//
// The backend stores a code file as one highlighted block. This module turns
// that block into one element per line (number and text together), and gives
// those lines GitHub-style links: #L24, #L24-L31, and #file-<slug>-L24-L31 in
// a gist with several files. The app and the offline shell both use it.

const BLOCK_RE =
  /^\s*(<div class="highlight[^"]*"[^>]*>)?\s*<pre[^>]*>(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?<\/pre>\s*(?:<\/div>)?\s*$/;
const TOKEN_RE = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
const FRAGMENT_RE = /^#?(?:file-([a-z0-9-]+?)-)?L([1-9][0-9]{0,6})(?:-L([1-9][0-9]{0,6}))?$/;
const FILE_FRAGMENT_RE = /^#?file-([a-z0-9-]+)$/;

/**
 * Split a stored code block into one HTML string per line. A colour span that
 * crosses a line break is closed at the break and reopened on the next line.
 * Returns null for anything that is not the stored shape, so the caller can
 * show the block untouched instead of risking wrong output.
 */
export function splitHighlightedLines(html) {
  const block = BLOCK_RE.exec(typeof html === "string" ? html : "");
  if (!block) {
    return null;
  }
  const wrapperClass = block[1] ? (/class="([^"]*)"/.exec(block[1])?.[1] ?? "highlight") : "";
  const inner = block[2];
  const lines = [];
  const open = [];
  let current = "";
  let consumed = 0;
  TOKEN_RE.lastIndex = 0;
  let token;
  while ((token = TOKEN_RE.exec(inner))) {
    consumed += token[0].length;
    if (token[4] !== undefined) {
      const parts = token[4].split("\n");
      for (let index = 0; index < parts.length; index += 1) {
        current += parts[index];
        if (index < parts.length - 1) {
          lines.push(current + "</span>".repeat(open.length));
          current = open.join("");
        }
      }
    } else if (token[2].toLowerCase() !== "span") {
      return null;
    } else if (token[1]) {
      if (!open.length) {
        return null;
      }
      open.pop();
      current += "</span>";
    } else {
      open.push(token[0]);
      current += token[0];
    }
  }
  if (consumed !== inner.length || open.length) {
    return null;
  }
  // Text after the last line break is a final line; a trailing break is not.
  if (current.replace(/<[^>]*>/g, "") !== "" || !lines.length) {
    lines.push(current);
  }
  return { wrapperClass, lines };
}

/** GitHub Gist style anchors for filenames, unique within one gist. */
export function fileSlugs(filenames) {
  const used = new Map();
  const slugs = {};
  for (const filename of filenames) {
    const base =
      String(filename).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "file";
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    slugs[filename] = seen ? `${base}-${seen}` : base;
  }
  return slugs;
}

/** "#L24-L31" or "#file-calc-py-L3" to { slug, start, end }; null when not one. */
export function parseLineFragment(hash) {
  const value = typeof hash === "string" ? hash : "";
  const lines = FRAGMENT_RE.exec(value);
  if (lines) {
    const first = Number(lines[2]);
    const second = lines[3] ? Number(lines[3]) : first;
    return {
      slug: lines[1] ?? null,
      start: Math.min(first, second),
      end: Math.max(first, second)
    };
  }
  const file = FILE_FRAGMENT_RE.exec(value);
  return file ? { slug: file[1], start: null, end: null } : null;
}

export function formatLineFragment({ slug, start, end }) {
  const prefix = slug ? `file-${slug}-` : "";
  if (!start) {
    return slug ? `#file-${slug}` : "";
  }
  return end && end !== start ? `#${prefix}L${start}-L${end}` : `#${prefix}L${start}`;
}

/**
 * The HTML for a code file as numbered lines, or null when the stored block
 * cannot be split. `slug` is the file's anchor in a gist with several files
 * and empty for a single file.
 */
export function codeLinesHtml(html, slug = "") {
  const split = splitHighlightedLines(html);
  if (!split) {
    return null;
  }
  const prefix = slug ? `file-${slug}-` : "";
  const digits = String(split.lines.length).length;
  const body = split.lines
    .map(
      (line, index) =>
        `<span class="code-line" id="${prefix}L${index + 1}">` +
        `<span class="code-line-number" data-line="${index + 1}"></span>${line}\n</span>`
    )
    .join("");
  const pre =
    `<pre class="code-lines" data-line-prefix="${prefix}" data-line-slug="${slug}" ` +
    `style="--line-digits:${digits}">${body}</pre>`;
  return split.wrapperClass ? `<div class="${split.wrapperClass}" dir="auto">${pre}</div>` : pre;
}

const LINK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// The address a page last scrolled for, so a re-mount (a file expanding, a
// refresh of the same page) does not pull the reader back to the lines.
let scrolledFor = "";

/**
 * Make the code files under `root` linkable by line. Reads the address,
 * marks the targeted lines, scrolls to them, and lets the reader pick lines
 * from the numbers. `options.expandFile(slug)` is called when a link names a
 * file whose lines are not on the page (a collapsed panel). Returns cleanup.
 */
export function mountLineLinks(root, options = {}) {
  if (!root || typeof window === "undefined") {
    return () => {};
  }
  let button = null;
  let feedbackTimer = null;
  let lastPointerType = "mouse";
  let selection = null;

  const pres = () => [...root.querySelectorAll("pre.code-lines")];
  const lineOf = (pre, number) => pre.children[number - 1] ?? null;

  function findPre(target) {
    const all = pres();
    if (target.slug) {
      const named = all.find((pre) => pre.dataset.lineSlug === target.slug);
      if (named) {
        return named;
      }
      // A file link into a gist that has since become a single file.
      return all.length === 1 && !all[0].dataset.lineSlug ? all[0] : null;
    }
    return all[0] ?? null;
  }

  function removeButton() {
    window.clearTimeout(feedbackTimer);
    button?.remove();
    button = null;
  }

  function placeButton() {
    if (!button || !selection) {
      return;
    }
    const host = button.parentElement;
    const first = lineOf(selection.pre, selection.start);
    const last = lineOf(selection.pre, selection.end);
    if (!host || !first || !last) {
      return;
    }
    const hostBox = host.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const height = button.offsetHeight || 26;
    const width = button.offsetWidth || 26;
    // With a page margin beside the code (a single file on a wide screen) the
    // button sits in it, level with the first line and covering nothing.
    if (host.classList.contains("gist-code-container") && hostBox.left >= width + 8) {
      button.style.top = `${Math.round(firstBox.top - hostBox.top + (Math.min(firstBox.height, parseFloat(getComputedStyle(first).lineHeight) || firstBox.height) - height) / 2)}px`;
      button.style.left = `${-(width + 4)}px`;
      return;
    }
    // Otherwise it sits at the right end of the first line, clear of the
    // numbers, or under the block when the file's own buttons are there.
    const row = Math.min(firstBox.height, parseFloat(getComputedStyle(first).lineHeight) || firstBox.height);
    let top = firstBox.top - hostBox.top + (row - height) / 2;
    if (top < 34 && host.classList.contains("gist-code-container")) {
      top = last.getBoundingClientRect().bottom - hostBox.top + 2;
    }
    button.style.top = `${Math.round(top)}px`;
    button.style.left = `${Math.round(hostBox.width - width - 8)}px`;
  }

  function showButton() {
    const view = selection?.pre.closest(".gist-code-view");
    const host = view?.parentElement;
    if (!host) {
      removeButton();
      return;
    }
    if (!button || button.parentElement !== host) {
      removeButton();
      button = document.createElement("button");
      button.type = "button";
      button.className = "code-line-link";
      button.innerHTML = LINK_ICON;
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          button.innerHTML = CHECK_ICON;
          button.dataset.copied = "true";
        } catch {
          button.dataset.copied = "false";
        }
        window.clearTimeout(feedbackTimer);
        feedbackTimer = window.setTimeout(() => {
          if (button) {
            button.innerHTML = LINK_ICON;
            delete button.dataset.copied;
          }
        }, 1400);
      });
      host.append(button);
    }
    const label =
      selection.start === selection.end
        ? `Copy link to line ${selection.start}`
        : `Copy link to lines ${selection.start} to ${selection.end}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    placeButton();
  }

  function clearMarks() {
    for (const line of root.querySelectorAll(".code-line[data-selected]")) {
      line.removeAttribute("data-selected");
    }
    for (const view of root.querySelectorAll(".gist-code-view[data-line-target]")) {
      view.removeAttribute("data-line-target");
    }
  }

  function scrollToSelection() {
    const first = lineOf(selection.pre, selection.start);
    const last = lineOf(selection.pre, selection.end);
    if (!first || !last) {
      return;
    }
    const header = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--header-h")
    ) || 48;
    const top = first.getBoundingClientRect().top;
    const height = last.getBoundingClientRect().bottom - top;
    const room = window.innerHeight - header;
    const offset = height > room * 0.6 ? header + 12 : header + Math.max(12, room * 0.25);
    window.scrollTo({ top: Math.max(0, window.scrollY + top - offset) });
  }

  function apply(scroll) {
    clearMarks();
    selection = null;
    const target = parseLineFragment(window.location.hash);
    if (!target) {
      removeButton();
      return;
    }
    const key = window.location.pathname + window.location.hash;
    if (!target.start) {
      // A link to a whole file.
      removeButton();
      if (scroll && scrolledFor !== key) {
        scrolledFor = key;
        document.getElementById(`file-${target.slug}`)?.scrollIntoView();
      }
      return;
    }
    const pre = findPre(target);
    if (!pre) {
      removeButton();
      if (target.slug) {
        options.expandFile?.(target.slug);
      }
      return;
    }
    const count = pre.children.length;
    const start = Math.min(target.start, count);
    const end = Math.min(target.end, count);
    for (let number = start; number <= end; number += 1) {
      lineOf(pre, number)?.setAttribute("data-selected", "true");
    }
    pre.closest(".gist-code-view")?.setAttribute("data-line-target", "true");
    selection = { pre, start, end };
    showButton();
    if (scroll && scrolledFor !== key) {
      scrolledFor = key;
      scrollToSelection();
    }
  }

  function setAddress(fragment) {
    const url = window.location.pathname + window.location.search + fragment;
    window.history.replaceState(window.history.state, "", url);
    // The reader chose these lines where they are; do not move the page.
    scrolledFor = window.location.pathname + window.location.hash;
    apply(false);
  }

  function onPointerDown(event) {
    lastPointerType = event.pointerType || "mouse";
  }

  function onClick(event) {
    const number = event.target instanceof Element ? event.target.closest(".code-line-number") : null;
    const pre = number?.closest("pre.code-lines");
    if (!number || !pre || !root.contains(pre)) {
      return;
    }
    event.preventDefault();
    const line = Number(number.dataset.line);
    const slug = pre.dataset.lineSlug || null;
    const same = selection && selection.pre === pre;
    const single = same && selection.start === selection.end;
    if (same && (event.shiftKey || (lastPointerType === "touch" && single && selection.start !== line))) {
      // Shift-click, or a second tap on a phone, extends to a block.
      const anchor = selection.start;
      setAddress(formatLineFragment({ slug, start: Math.min(anchor, line), end: Math.max(anchor, line) }));
    } else if (single && selection.start === line) {
      setAddress("");
    } else {
      setAddress(formatLineFragment({ slug, start: line, end: line }));
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && selection && !event.defaultPrevented) {
      setAddress("");
    }
  }

  const onHashChange = () => apply(true);
  const onResize = () => placeButton();
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(() => placeButton()) : null;
  for (const pre of pres()) {
    observer?.observe(pre);
  }

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("resize", onResize);
  apply(true);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("resize", onResize);
    observer?.disconnect();
    removeButton();
    clearMarks();
  };
}
