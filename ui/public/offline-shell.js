(() => {
  "use strict";

  let disposeGallery = () => {};
  let galleryRender = 0;
  function refreshGalleries() {
    const render = ++galleryRender;
    disposeGallery();
    disposeGallery = () => {};
    const roots = [...document.querySelectorAll("article.markdown-body")]
      .filter((root) => !root.closest("[hidden]"));
    if (!roots.length) return;
    void import("/gallery-viewer.mjs").then(({ mountGallery }) => {
      if (render === galleryRender) disposeGallery = mountGallery(roots);
    }).catch(() => {});
  }
  window.addEventListener("pagehide", () => { ++galleryRender; disposeGallery(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) refreshGalleries(); });

  const DATABASE_NAME = "waveygist-offline";
  const DATABASE_VERSION = 1;
  const CONTENT_CACHE = "waveygist-content-v1";
  const AUDIO_CACHE = "waveygist-audio-v1";
  const ITEMS_PER_PAGE = 20;
  const GIST_ID_RE = /^[A-Za-z0-9]{16,64}$/;
  const ROUTE_RE = /^\/([A-Za-z0-9]{16,64})(?:\/revisions\/([1-9][0-9]*))?\/?$/;
  const THEME_KEY = "theme";
  const TAB_KEY = "waveygist:home-tab:v1";
  const OFFLINE_IDENTITY_KEY = "waveygist:offline-identity:v1";
  const AUDIO_RATE_KEY = "waveygist:audio-rate:v1";
  const RECONNECT_RELOAD_KEY = "waveygist:reconnect-reload:v1";
  const RECONNECT_RELOAD_INTERVAL_MS = 60 * 1000;
  const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const MONTH_MS = 30 * DAY_MS;
  const YEAR_MS = 365 * DAY_MS;
  const GITHUB_LOGIN_RE =
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const ETH_ENTITY_ID_CLASS_RE = /^eth-id-[a-f0-9]{12}$/;
  const ETH_ENTITY_GROUP_HOVER_CLASS = "eth-entity-group-hover";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    check: ['<path d="m9 11 3 3L22 4" />'],
    chevronDown: ['<path d="m6 9 6 6 6-6" />'],
    chevronLeft: ['<path d="m15 18-6-6 6-6" />'],
    copy: [
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />',
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />'
    ],
    fileCode: [
      '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />',
      '<polyline points="14 2 14 8 20 8" />',
      '<path d="m10 13-2 2 2 2M14 17l2-2-2-2" />'
    ],
    diff: [
      '<path d="M12 3v14"/>',
      '<path d="M5 10h14"/>',
      '<path d="M5 21h14"/>'
    ],
    history: [
      '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />',
      '<path d="M3 3v5h5M12 7v5l3 2" />'
    ],
    moon: ['<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />'],
    pause: [
      '<rect width="4" height="16" x="6" y="4" rx="1" />',
      '<rect width="4" height="16" x="14" y="4" rx="1" />'
    ],
    play: ['<polygon points="6 3 20 12 6 21 6 3" />'],
    rotateBack: [
      '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />',
      '<path d="M3 3v5h5" />'
    ],
    rotateForward: [
      '<path d="M21 12a9 9 0 1 1-3-6.7L21 8" />',
      '<path d="M21 3v5h-5" />'
    ],
    search: ['<circle cx="11" cy="11" r="8" />', '<path d="m21 21-4.3-4.3" />'],
    share: [
      '<circle cx="18" cy="5" r="3" />',
      '<circle cx="6" cy="12" r="3" />',
      '<circle cx="18" cy="19" r="3" />',
      '<line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />',
      '<line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />'
    ],
    sun: [
      '<circle cx="12" cy="12" r="4" />',
      '<path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />'
    ],
    x: ['<path d="M18 6 6 18" />', '<path d="m6 6 12 12" />'],
    volume: [
      '<path d="M11 5 6 9H2v6h4l5 4V5Z" />',
      '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />',
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />'
    ],
    textSearch: [
      '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5" />',
      '<polyline points="14 2 14 8 20 8" />',
      '<path d="M8 13h2M8 17h1" />',
      '<circle cx="16" cy="17" r="3" />',
      '<path d="m18.5 19.5 2 2" />'
    ],
    textWrap: [
      '<path d="m16 16-3 3 3 3" />',
      '<path d="M3 12h14.5a1 1 0 0 1 0 7H13" />',
      '<path d="M3 19h6" />',
      '<path d="M3 5h18" />'
    ]
  };

  const app = document.getElementById("offline-app");
  const connectionStatus = document.querySelector(".offline-status");

  let activeAudio = null;
  let databasePromise = null;
  let reconnectProbe = null;
  let reconnectVerified = false;

  function openDatabase() {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("entries")) {
          database.createObjectStore("entries", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).then(async (database) => {
      // A failed repair must not take offline storage down with it; the marker
      // is only written on success, so it runs again on the next open.
      try {
        const { migrateSavedTables } = await import("/offline-table-migration.mjs");
        await migrateSavedTables(database, CONTENT_CACHE);
      } catch {
        // Saved copies stay as they were.
      }
      return database;
    });
    return databasePromise;
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function allEntries() {
    const database = await openDatabase();
    const transaction = database.transaction("entries", "readonly");
    const entries = await requestValue(transaction.objectStore("entries").getAll());
    await transactionDone(transaction);
    return entries;
  }

  async function putEntry(entry) {
    const database = await openDatabase();
    const transaction = database.transaction("entries", "readwrite");
    transaction.objectStore("entries").put(entry);
    await transactionDone(transaction);
  }

  function element(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) {
      node.className = options.className;
    }
    if (options.text !== undefined) {
      node.textContent = options.text;
    }
    if (options.href) {
      node.href = options.href;
    }
    return node;
  }

  function icon(name, size = 18, strokeWidth = 1.8) {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("class", "offline-control-icon");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", String(strokeWidth));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICON_PATHS[name].join("");
    return svg;
  }

  function replaceIcon(button, name, size = 18, strokeWidth = 1.8) {
    button.querySelector(".offline-control-icon")?.remove();
    button.prepend(icon(name, size, strokeWidth));
  }

  function formatDate(value, variant = "long") {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return "saved offline";
    }
    const dateOptions = variant === "long"
      ? { month: "long", day: "numeric", year: "numeric" }
      : variant === "compact"
        ? { month: "short", day: "numeric", year: "numeric" }
        : { month: "short", day: "numeric" };
    const timeOptions = variant === "short"
      ? { hour: "numeric", minute: "2-digit", hour12: true }
      : {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZoneName: "short"
        };
    const separator = variant === "short" ? " · " : " ";
    return `${new Intl.DateTimeFormat("en-US", dateOptions).format(date)}${separator}${new Intl.DateTimeFormat("en-US", timeOptions).format(date)}`;
  }

  function pluralize(value, singular) {
    return `${value} ${singular}${value === 1 ? "" : "s"} ago`;
  }

  function formatRelativeDate(value, now = Date.now()) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return value;
    }
    const elapsed = Math.max(0, now - date.valueOf());
    if (elapsed < MINUTE_MS) return "just now";
    if (elapsed < HOUR_MS) return pluralize(Math.floor(elapsed / MINUTE_MS), "min");
    if (elapsed < DAY_MS) return pluralize(Math.floor(elapsed / HOUR_MS), "hour");
    if (elapsed < MONTH_MS) return pluralize(Math.floor(elapsed / DAY_MS), "day");
    if (elapsed < YEAR_MS) return pluralize(Math.floor(elapsed / MONTH_MS), "month");
    return pluralize(Math.floor(elapsed / YEAR_MS), "year");
  }

  function formatByteSize(byteSize) {
    if (byteSize < 1024) {
      return `${byteSize} B`;
    }
    return `${(byteSize / 1024).toFixed(byteSize < 10 * 1024 ? 1 : 0)} KB`;
  }

  function timestamp(value, variant = "long") {
    const time = element("time", { text: formatDate(value, variant) });
    time.dateTime = value;
    return time;
  }

  function formatPlaybackRate(rate) {
    return `${rate.toFixed(rate % 1 === 0 ? 0 : 2).replace(/0$/, "")}×`;
  }

  function formatPlaybackTime(value) {
    if (!Number.isFinite(value) || value < 0) {
      return "0:00";
    }
    const totalSeconds = Math.floor(value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#111212" : "#fafafa"
    );
  }

  function readTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") {
        return saved;
      }
    } catch {
      // Use the system preference.
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function themeButton() {
    const button = element("button", {
      className: "icon-button theme-toggle-button"
    });
    button.type = "button";

    function paint() {
      const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", `Switch to ${next} mode`);
      button.title = next === "dark" ? "Dark" : "Light";
      button.replaceChildren(icon(theme === "dark" ? "sun" : "moon", 16));
    }

    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      paint();
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Theme persistence is best effort.
      }
    });
    paint();
    return button;
  }

  function paintWrapButton(button, wrapped) {
    button.setAttribute("aria-pressed", String(wrapped));
    button.title = wrapped ? "Stop wrapping code lines" : "Wrap code lines";
  }

  function wrapButton(label, wrapped, onToggle, className = "code-wrap-button") {
    const button = element("button", { className });
    button.type = "button";
    button.append(icon("textWrap", 16));
    button.setAttribute("aria-label", label);
    paintWrapButton(button, wrapped);
    button.addEventListener("click", onToggle);
    return button;
  }

  function addMarkdownWrapControls(root) {
    let number = 0;
    for (const pre of root.querySelectorAll("article.markdown-body pre")) {
      if (pre.closest(".code-wrap-block, .mermaid-render, .math-display")) continue;
      const code = pre.parentElement?.classList.contains("highlight")
        ? pre.parentElement
        : pre;
      if (!code) continue;
      const shell = element("div", { className: "code-wrap-block" });
      let wrapped = false;
      const button = wrapButton(`Wrap lines in code block ${++number}`, false, () => {
        wrapped = !wrapped;
        shell.classList.toggle("code-lines-wrapped", wrapped);
        paintWrapButton(button, wrapped);
      });
      code.replaceWith(shell);
      const actions = element("div", { className: "code-block-actions" });
      actions.append(button, codeCopyControl(pre.textContent || "", `Copy code block ${number}`));
      shell.append(code, actions);
    }
  }

  async function backedGistEntries() {
    const cache = await caches.open(CONTENT_CACHE);
    const entries = (await allEntries()).filter((entry) => entry.kind === "gist");
    const results = [];
    for (const entry of entries) {
      if ((await cache.keys(entry.cacheKey)).length) {
        results.push(entry);
      }
    }
    return results;
  }

  function entryTitle(entry) {
    return entry.displayTitle || entry.gistId;
  }

  function authorInitial(value) {
    return (value || "?").trim().slice(0, 1).toUpperCase() || "?";
  }

  function fallbackAuthorAvatarUrl(authorName) {
    return GITHUB_LOGIN_RE.test(authorName || "")
      ? `https://github.com/${authorName}.png?size=64`
      : null;
  }

  function authorAvatar(authorName, avatarUrl, className, size) {
    const resolvedUrl = avatarUrl || fallbackAuthorAvatarUrl(authorName);
    const placeholder = () => {
      const fallback = element("span", {
        className: `${className} ${className}-placeholder`,
        text: authorInitial(authorName)
      });
      fallback.setAttribute("aria-hidden", "true");
      return fallback;
    };
    if (!resolvedUrl) {
      return placeholder();
    }
    const image = element("img", { className });
    image.src = resolvedUrl;
    image.alt = "";
    image.width = image.height = size;
    image.addEventListener("error", () => image.replaceWith(placeholder()), {
      once: true
    });
    return image;
  }

  function readOfflineIdentity() {
    try {
      const value = JSON.parse(localStorage.getItem(OFFLINE_IDENTITY_KEY) || "null");
      if (
        value &&
        typeof value.name === "string" &&
        value.name.length > 0 &&
        value.name.length <= 100 &&
        typeof value.canGenerateAudio === "boolean" &&
        (value.avatarUrl === null ||
          value.avatarUrl === undefined ||
          typeof value.avatarUrl === "string")
      ) {
        return value;
      }
    } catch {
      // Identity is a visual convenience; invalid state can be ignored.
    }
    return null;
  }

  function showStandaloneNotice(message) {
    document.querySelector(".standalone-action-notice")?.remove();
    const notice = element("div", {
      className: "standalone-action-notice",
      text: message
    });
    notice.setAttribute("role", "status");
    document.body.append(notice);
    window.setTimeout(() => notice.remove(), 1600);
  }

  async function shareCurrentPage(button) {
    const url = location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      button.replaceChildren(icon("check", 16, 2));
      button.setAttribute("aria-label", "Link copied");
      showStandaloneNotice("Link copied");
      window.setTimeout(() => {
        button.replaceChildren(icon("share", 16, 1.9));
        button.setAttribute("aria-label", "Share this page");
      }, 1600);
    } catch {
      showStandaloneNotice("Unable to share");
    }
  }

  let standaloneNavigation;
  async function setupOfflineHeader() {
    const nav = document.querySelector(".app-nav");
    if (!nav) {
      return;
    }
    const identity = readOfflineIdentity();
    if (identity) {
      const link = element("a", {
        className: "app-identity app-identity-link",
        href: "/me"
      });
      link.setAttribute("aria-label", `${identity.name} account`);
      if (identity.avatarUrl) {
        const avatar = element("img", { className: "app-avatar" });
        avatar.src = identity.avatarUrl;
        avatar.alt = "";
        avatar.width = avatar.height = 20;
        avatar.addEventListener("error", () => avatar.remove(), { once: true });
        link.append(avatar);
      }
      link.append(element("span", { className: "app-name", text: identity.name }));
      nav.append(link);
    }

    const shareButton = element("button", {
      className: "icon-button standalone-share-button"
    });
    shareButton.type = "button";
    shareButton.title = "Share";
    shareButton.setAttribute("aria-label", "Share this page");
    shareButton.append(icon("share", 16, 1.9));
    shareButton.addEventListener("click", () => void shareCurrentPage(shareButton));
    nav.append(themeButton(), shareButton);

    if (
      matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true
    ) {
      document.documentElement.classList.add("standalone-app");
      const { installStandaloneNavigation } = await import("/standalone-navigation.mjs");
      const back = element("button", { className: "icon-button standalone-back-button" });
      back.type = "button";
      back.append(icon("chevronLeft", 18, 1.7));
      standaloneNavigation = installStandaloneNavigation(({ canGoBack, isHome }) => {
        back.hidden = isHome;
        back.title = canGoBack ? "Back" : "Back to home";
        back.setAttribute("aria-label", back.title);
      });
      back.addEventListener("click", () => standaloneNavigation.back(() => location.replace("/")));
      document.querySelector(".app-brand-group").prepend(back);
    }
  }

  // Same row layout and dates as the online home page.
  function libraryRowTime(value, now) {
    const time = Date.parse(value || "");
    if (Number.isNaN(time)) {
      return "";
    }
    const date = new Date(time);
    const today = new Date(now);
    const options = date.toDateString() === today.toDateString()
      ? { hour: "numeric", minute: "2-digit" }
      : date.getFullYear() === today.getFullYear()
        ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric", year: "numeric" };
    return date.toLocaleString("en-US", options);
  }

  function libraryDate(entry, tab) {
    return tab === "recent"
      ? entry.lastViewedAt || entry.updatedAt
      : entry.updatedAt;
  }

  function gistListRow(entry, tab, now) {
    const item = element("li", { className: "library-item" });
    const row = element("div", { className: "library-row" });
    const href = tab === "recent"
      ? `/${entry.gistId}/revisions/${entry.revisionNumber}`
      : `/${entry.gistId}`;
    const link = element("a", { className: "library-link", href });
    link.append(element("span", {
      className: "library-title",
      text: entryTitle(entry)
    }));
    const dateValue = libraryDate(entry, tab);
    const meta = element("span", { className: "library-meta" });
    if (entry.authorName) {
      const byline = element("span", { className: "library-byline" });
      byline.append(
        authorAvatar(entry.authorName, entry.authorAvatarUrl, "library-avatar", 16),
        element("span", { className: "library-byline-name", text: entry.authorName })
      );
      meta.append(byline);
    }
    const aside = element("span", { className: "library-aside" });
    const time = element("time", { text: libraryRowTime(dateValue, now) });
    if (dateValue) {
      time.dateTime = dateValue;
      time.title = formatDate(dateValue);
    }
    aside.append(time);
    if (entry.revisionNumber > 1) {
      const revision = element("span", {
        className: "library-revision",
        text: `r${entry.revisionNumber}`
      });
      revision.setAttribute("aria-label", `revision ${entry.revisionNumber}`);
      aside.append(revision);
    }
    meta.append(aside);
    link.append(meta);
    row.append(link);
    item.append(row);
    return item;
  }

  function readTab() {
    try {
      return localStorage.getItem(TAB_KEY) === "mine" ? "mine" : "recent";
    } catch {
      return "recent";
    }
  }

  function saveTab(tab) {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Tab persistence is best effort.
    }
  }

  async function renderLibrary() {
    const entries = await backedGistEntries();
    app.className = "home-shell home-shell-authenticated offline-library-shell";
    app.replaceChildren();

    const library = element("section", { className: "library" });
    library.setAttribute("aria-label", "Saved gists");
    const bar = element("div", { className: "library-bar" });
    const tabs = element("div", { className: "library-tabs" });
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Library");
    const mineButton = element("button", { className: "library-tab", text: "My gists" });
    const recentButton = element("button", {
      className: "library-tab",
      text: "Recently viewed"
    });
    for (const button of [mineButton, recentButton]) {
      button.type = "button";
      button.setAttribute("role", "tab");
    }
    tabs.append(mineButton, recentButton);
    const searchToggle = element("button", { className: "library-search-toggle" });
    searchToggle.type = "button";
    bar.append(tabs, searchToggle);

    const search = element("div", { className: "library-search" });
    const searchInput = element("input", { className: "library-search-input" });
    searchInput.type = "search";
    searchInput.placeholder = "Search saved gists";
    searchInput.autocomplete = "off";
    searchInput.setAttribute("aria-label", "Search saved gists");
    search.append(searchInput);
    search.hidden = true;

    const panel = element("div");
    panel.setAttribute("role", "tabpanel");
    const list = element("ul", { className: "library-list" });
    const empty = element("p", { className: "library-empty" });
    const more = element("button", { className: "home-more-button", text: "Show more" });
    more.type = "button";
    panel.append(list, empty, more);
    library.append(bar, search, panel);
    app.append(library);

    let tab = readTab();
    let count = ITEMS_PER_PAGE;

    function paintSearchToggle() {
      const open = !search.hidden;
      searchToggle.setAttribute("aria-label", open ? "Close search" : "Search");
      searchToggle.setAttribute("aria-expanded", String(open));
      replaceIcon(searchToggle, open ? "x" : "search", 17);
    }

    function selectTab(nextTab) {
      tab = nextTab;
      count = ITEMS_PER_PAGE;
      saveTab(tab);
      paint();
    }

    function paint() {
      mineButton.setAttribute("aria-selected", String(tab === "mine"));
      recentButton.setAttribute("aria-selected", String(tab === "recent"));
      mineButton.tabIndex = tab === "mine" ? 0 : -1;
      recentButton.tabIndex = tab === "recent" ? 0 : -1;
      const query = searchInput.value.trim().toLocaleLowerCase();
      const filtered = entries
        .filter((entry) => tab === "recent" ? entry.recentlyViewed : entry.owned)
        .filter((entry) => {
          if (!query) {
            return true;
          }
          return `${entryTitle(entry)} ${entry.authorName || ""} ${entry.gistId}`
            .toLocaleLowerCase()
            .includes(query);
        })
        .sort((left, right) => {
          const leftDate = Date.parse(libraryDate(left, tab) || "");
          const rightDate = Date.parse(libraryDate(right, tab) || "");
          return (Number.isNaN(rightDate) ? 0 : rightDate) -
            (Number.isNaN(leftDate) ? 0 : leftDate);
        });
      const visible = filtered.slice(0, count);
      const now = Date.now();
      list.replaceChildren(...visible.map((entry) => gistListRow(entry, tab, now)));
      empty.hidden = visible.length > 0;
      empty.textContent = query
        ? "No saved gists match."
        : tab === "recent"
          ? "No recently viewed gists are saved offline."
          : "None of your gists are saved offline.";
      more.hidden = filtered.length <= count;
    }

    mineButton.addEventListener("click", () => selectTab("mine"));
    recentButton.addEventListener("click", () => selectTab("recent"));
    for (const button of [mineButton, recentButton]) {
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const nextTab = tab === "recent" ? "mine" : "recent";
        selectTab(nextTab);
        (nextTab === "recent" ? recentButton : mineButton).focus();
      });
    }
    searchToggle.addEventListener("click", () => {
      search.hidden = !search.hidden;
      if (search.hidden && searchInput.value) {
        searchInput.value = "";
        paint();
      }
      paintSearchToggle();
      if (!search.hidden) {
        searchInput.focus();
      }
    });
    searchInput.addEventListener("input", () => {
      count = ITEMS_PER_PAGE;
      paint();
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        searchToggle.click();
      }
    });
    more.addEventListener("click", () => {
      count += ITEMS_PER_PAGE;
      paint();
    });
    paintSearchToggle();
    paint();
  }

  async function cachedGistEntry(gistId, revisionNumber) {
    const entries = (await backedGistEntries()).filter(
      (entry) => entry.gistId === gistId
    );
    if (revisionNumber !== null) {
      return entries.find((entry) => entry.revisionNumber === revisionNumber) || null;
    }
    return entries.sort((left, right) => right.revisionNumber - left.revisionNumber)[0] || null;
  }

  async function cachedPayload(entry) {
    const response = await (await caches.open(CONTENT_CACHE)).match(entry.cacheKey);
    if (!response) {
      return null;
    }
    const payload = await response.json().catch(() => null);
    if (
      !payload ||
      payload.id !== entry.gistId ||
      payload.revision_number !== entry.revisionNumber ||
      !payload.files ||
      typeof payload.files !== "object"
    ) {
      return null;
    }
    return payload;
  }

  function positionKey(gistId, revisionNumber) {
    return `waveygist:audio-position:v1:${gistId}:${revisionNumber}`;
  }

  function readPlaybackRate() {
    try {
      const value = Number(localStorage.getItem(AUDIO_RATE_KEY));
      return PLAYBACK_RATES.includes(value) ? value : 1;
    } catch {
      return 1;
    }
  }

  async function updatePlayedAt(entry) {
    await putEntry({ ...entry, lastPlayedAt: new Date().toISOString() });
  }

  function setupMediaSession(audio, payload, play, pause, seek) {
    if (!("mediaSession" in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: payload.display_title || "Article audio",
        artist: payload.author_name || "",
        album: "waveygist",
        artwork: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      });
    } catch {
      // Metadata support varies by browser.
    }
    const actions = {
      play,
      pause,
      stop: pause,
      nexttrack: null,
      previoustrack: null,
      seekbackward: () => seek(audio.currentTime - 10),
      seekforward: () => seek(audio.currentTime + 10),
      seekto: (details) => {
        if (typeof details.seekTime === "number") {
          seek(details.seekTime);
        }
      }
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Individual actions are optional.
      }
    }
  }

  function audioIsPlaying() {
    return Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended);
  }

  async function cachedAudioEntry(payload) {
    const entry = (await allEntries()).find(
      (candidate) => candidate.key === `audio:${payload.id}:${payload.revision_number}`
    );
    if (!entry) {
      return null;
    }
    const cache = await caches.open(AUDIO_CACHE);
    return (await cache.keys(entry.cacheKey)).length
      ? entry
      : null;
  }

  async function revisionHistoryControl(payload) {
    const control = element("div", { className: "history-control" });
    const button = element("button", { className: "icon-button" });
    const menu = element("div", { className: "history-menu" });
    const menuId = `revision-history-${payload.id}-${payload.revision_number}`;
    const cachedRevisions = new Set(
      (await backedGistEntries())
        .filter((entry) => entry.gistId === payload.id)
        .map((entry) => entry.revisionNumber)
    );
    let relativeDateInterval = null;

    button.type = "button";
    button.title = "History";
    button.setAttribute("aria-label", "View revision history");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", menuId);
    button.append(icon("history"));

    menu.id = menuId;
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Revision history");

    function paintRelativeDates() {
      const now = Date.now();
      for (const time of menu.querySelectorAll("time[data-created-at]")) {
        time.textContent = formatRelativeDate(time.dataset.createdAt, now);
      }
    }

    function closeHistory(focus = false) {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (relativeDateInterval !== null) {
        window.clearInterval(relativeDateInterval);
        relativeDateInterval = null;
      }
      if (focus) {
        button.focus();
      }
    }

    const label = element("div", { className: "history-menu-label", text: "History" });
    label.setAttribute("aria-hidden", "true");
    menu.append(label);

    for (const item of payload.history) {
      const row = element("div", { className: "history-item-row" });
      row.setAttribute("role", "none");
      const revisionIsCached = cachedRevisions.has(item.revision_number);
      const revision = element(revisionIsCached ? "a" : "span", {
        className: "history-item",
        ...(revisionIsCached
          ? { href: `/${payload.id}/revisions/${item.revision_number}` }
          : {})
      });
      revision.setAttribute("role", "menuitem");
      if (item.revision_number === payload.revision_number) {
        revision.setAttribute("aria-current", "page");
      }
      if (!revisionIsCached) {
        revision.setAttribute("aria-disabled", "true");
        revision.title = "This revision isn’t saved offline";
      }
      const title = element("span", {
        className: "history-item-title",
        text: `Revision ${item.revision_number}`
      });
      if (item.is_latest) {
        title.append(element("span", {
          className: "history-item-latest",
          text: "Latest"
        }));
      }
      revision.append(title);
      const metadata = element("span", { className: "history-item-meta" });
      metadata.append(document.createTextNode(item.author_name));
      const date = element("span", { className: "history-item-date" });
      const time = element("time");
      time.dateTime = item.created_at;
      time.dataset.createdAt = item.created_at;
      date.append(document.createTextNode(" · "), time);
      metadata.append(date);
      if (!revisionIsCached) {
        metadata.append(element("span", {
          className: "history-item-availability",
          text: " · not saved"
        }));
      }
      revision.append(metadata);
      row.append(revision);

      if (item.revision_number > 1) {
        const diff = element("span", { className: "history-diff-link" });
        diff.setAttribute("role", "menuitem");
        diff.setAttribute("aria-disabled", "true");
        diff.setAttribute(
          "aria-label",
          `Compare revision ${item.revision_number} with previous revision (requires a connection)`
        );
        diff.title = "Diff requires a connection";
        diff.append(icon("diff", 16));
        row.append(diff);
      }
      menu.append(row);
    }
    paintRelativeDates();

    button.addEventListener("click", () => {
      const open = menu.hidden;
      if (!open) {
        closeHistory(false);
        return;
      }
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      paintRelativeDates();
      relativeDateInterval = window.setInterval(paintRelativeDates, MINUTE_MS);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!menu.hidden && !control.contains(event.target)) {
        closeHistory(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!menu.hidden && event.key === "Escape") {
        closeHistory(true);
      }
    });
    control.append(button, menu);
    return control;
  }

  async function articleToolbar(payload, singleFile, onRawToggle) {
    const group = element("div", { className: "article-audio-toolbar-group" });
    const toolbar = element("div", { className: "toolbar" });
    toolbar.setAttribute("aria-label", "Display controls");
    const audioEntry = await cachedAudioEntry(payload);
    const narrationEligible = payload.files[payload.primary_file]?.kind === "markdown";
    let audio = null;
    let audioButton = null;
    let overlay = null;
    let updateDocked = () => undefined;
    let stopPlayback = () => undefined;

    if (audioEntry && narrationEligible) {
      audioButton = element("button", {
        className: "icon-button article-audio-button article-audio-button-ready"
      });
      audioButton.type = "button";
      audioButton.title = "Play article audio (available offline)";
      audioButton.setAttribute("aria-label", "Play article audio");
      audioButton.setAttribute("aria-expanded", "false");
      audioButton.setAttribute("aria-pressed", "false");
      audioButton.append(icon("volume"));

      audio = document.createElement("audio");
      audio.className = "article-audio-engine";
      audio.preload = "metadata";
      audio.crossOrigin = "anonymous";
      audio.src = audioEntry.cacheKey;
      audio.setAttribute("aria-hidden", "true");

      overlay = element("div", { className: "article-audio-overlay" });
      overlay.hidden = true;
      overlay.setAttribute("role", "group");
      overlay.setAttribute("aria-label", "Article audio player");
      const playerId = `offline-article-audio-${payload.id}-${payload.revision_number}`;
      overlay.id = playerId;
      audioButton.setAttribute("aria-controls", playerId);

      const transport = element("div", { className: "article-audio-transport" });
      const back = element("button", { className: "article-audio-skip-button" });
      const play = element("button", { className: "article-audio-play-button" });
      const forward = element("button", { className: "article-audio-skip-button" });
      back.type = play.type = forward.type = "button";
      back.disabled = forward.disabled = true;
      back.setAttribute("aria-label", "Skip back 10 seconds");
      forward.setAttribute("aria-label", "Skip forward 10 seconds");
      play.setAttribute("aria-label", "Play article audio");
      back.append(
        icon("rotateBack", 19),
        element("span", { className: "article-audio-skip-label", text: "10" })
      );
      play.append(icon("play", 16, 2));
      forward.append(
        icon("rotateForward", 19),
        element("span", { className: "article-audio-skip-label", text: "10" })
      );
      transport.append(back, play, forward);

      const savedRate = readPlaybackRate();
      audio.playbackRate = savedRate;
      const speedControl = element("div", { className: "article-audio-speed-control" });
      const speedButton = element("button", { className: "article-audio-speed-button" });
      speedButton.type = "button";
      speedButton.textContent = formatPlaybackRate(savedRate);
      speedButton.setAttribute("aria-label", `Playback speed ${formatPlaybackRate(savedRate)}`);
      speedButton.setAttribute("aria-expanded", "false");
      const speedMenu = element("div", { className: "article-audio-speed-menu" });
      speedMenu.hidden = true;
      speedMenu.setAttribute("role", "group");
      speedMenu.setAttribute("aria-label", "Playback speed");
      const speedMenuId = `${playerId}-speeds`;
      speedMenu.id = speedMenuId;

      function paintSpeedOptions() {
        for (const option of speedMenu.querySelectorAll("button")) {
          const selected = Number(option.dataset.rate) === audio.playbackRate;
          option.setAttribute("aria-pressed", String(selected));
          option.querySelector(".offline-control-icon")?.remove();
          if (selected) {
            option.append(icon("check", 13, 2));
          }
        }
        const label = formatPlaybackRate(audio.playbackRate);
        speedButton.textContent = label;
        speedButton.setAttribute("aria-label", `Playback speed ${label}`);
      }

      function closeSpeedMenu(focus = false) {
        speedMenu.hidden = true;
        speedButton.setAttribute("aria-expanded", "false");
        speedButton.removeAttribute("aria-controls");
        if (focus) {
          speedButton.focus();
        }
      }

      for (const rate of PLAYBACK_RATES) {
        const option = element("button", { className: "article-audio-speed-option" });
        option.type = "button";
        option.dataset.rate = String(rate);
        option.append(element("span", { text: formatPlaybackRate(rate) }));
        option.addEventListener("click", () => {
          audio.playbackRate = rate;
          try {
            localStorage.setItem(AUDIO_RATE_KEY, String(rate));
          } catch {
            // Playback preference is best effort.
          }
          paintSpeedOptions();
          closeSpeedMenu(true);
        });
        speedMenu.append(option);
      }
      paintSpeedOptions();
      speedButton.addEventListener("click", () => {
        const open = speedMenu.hidden;
        speedMenu.hidden = !open;
        speedButton.setAttribute("aria-expanded", String(open));
        if (open) {
          speedButton.setAttribute("aria-controls", speedMenuId);
        } else {
          speedButton.removeAttribute("aria-controls");
        }
      });
      document.addEventListener("pointerdown", (event) => {
        if (!speedMenu.hidden && !speedControl.contains(event.target)) {
          closeSpeedMenu(false);
        }
      });
      speedControl.append(speedButton, speedMenu);

      const timeline = element("div", { className: "article-audio-timeline" });
      const current = element("span", {
        className: "article-audio-time",
        text: "0:00"
      });
      current.setAttribute("aria-hidden", "true");
      const seek = element("input", { className: "article-audio-seek" });
      seek.type = "range";
      seek.min = "0";
      seek.max = "0";
      seek.step = "0.1";
      seek.value = "0";
      seek.disabled = true;
      seek.setAttribute("aria-label", "Article audio position");
      seek.style.setProperty("--audio-progress", "0%");
      const duration = element("span", {
        className: "article-audio-time article-audio-duration",
        text: "0:00"
      });
      duration.setAttribute("aria-hidden", "true");
      timeline.append(current, seek, duration);
      const playbackError = element("span", {
        className: "article-audio-playback-error"
      });
      playbackError.hidden = true;
      playbackError.setAttribute("role", "status");
      overlay.append(transport, speedControl, timeline, playbackError);

      const storageKey = positionKey(payload.id, payload.revision_number);
      let lastSaved = 0;

      function finiteDuration() {
        return Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0;
      }

      function paintTimeline() {
        const total = finiteDuration();
        const position = total > 0 ? Math.min(audio.currentTime, total) : 0;
        current.textContent = formatPlaybackTime(position);
        duration.textContent = formatPlaybackTime(total);
        seek.max = String(total);
        seek.value = String(position);
        seek.disabled = total <= 0;
        back.disabled = forward.disabled = total <= 0;
        seek.setAttribute(
          "aria-valuetext",
          `${formatPlaybackTime(position)} of ${formatPlaybackTime(total)}`
        );
        seek.style.setProperty(
          "--audio-progress",
          `${total > 0 ? Math.min(100, Math.max(0, position / total * 100)) : 0}%`
        );
      }

      function savePosition(force = false) {
        const position = sourceSwap?.position ?? audio.currentTime;
        if (!force && Math.abs(position - lastSaved) < 5) {
          return;
        }
        try {
          const total = finiteDuration();
          if (position <= 0.5 || (total > 0 && total - position <= 10)) {
            localStorage.removeItem(storageKey);
          } else {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ position: Math.round(position * 10) / 10 })
            );
            lastSaved = position;
          }
        } catch {
          // Playback position is best effort.
        }
      }

      function restorePosition() {
        try {
          const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
          const position = Number(stored?.position);
          const total = finiteDuration();
          if (Number.isFinite(position) && position > 0 && position < total - 10) {
            audio.currentTime = position;
            lastSaved = position;
          }
        } catch {
          // Ignore invalid playback state.
        }
      }

      let playbackWanted = false;
      let playAttempt = 0;

      function syncMediaPosition() {
        const total = finiteDuration();
        if (!("mediaSession" in navigator) || total <= 0 || overlay.hidden) return;
        try {
          navigator.mediaSession.setPositionState({
            duration: total,
            playbackRate: audio.playbackRate,
            position: Math.min(total, Math.max(0, audio.currentTime))
          });
        } catch { /* Optional API. */ }
      }

      function paintPlayback(loading = false, message = "") {
        replaceIcon(play, playbackWanted ? "pause" : "play", 16, 2);
        play.setAttribute("aria-label", playbackWanted ? "Pause article audio" : "Play article audio");
        play.setAttribute("aria-busy", String(loading));
        playbackError.textContent = message || (loading ? "Loading audio…" : "");
        playbackError.hidden = !playbackError.textContent;
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = overlay.hidden ? "none" : playbackWanted ? "playing" : "paused";
          if (overlay.hidden) navigator.mediaSession.metadata = null;
        }
        syncMediaPosition();
      }

      function pauseAudio() {
        playbackWanted = false;
        ++playAttempt;
        audio.pause();
        savePosition(true);
        paintPlayback();
      }
      stopPlayback = pauseAudio;

      function seekAudio(value) {
        if (!Number.isFinite(value)) return;
        const position = Math.min(finiteDuration() || Infinity, Math.max(0, value));
        if (sourceSwap) sourceSwap.position = position;
        audio.currentTime = position;
        paintTimeline();
        savePosition(true);
        syncMediaPosition();
      }

      async function playAudio() {
        if (overlay.hidden) return;
        playbackWanted = true;
        const attempt = ++playAttempt;
        if (navigator.audioSession) {
          try { navigator.audioSession.type = "playback"; } catch { /* Optional API. */ }
        }
        if (audio.error) {
          sourceSwap = { position: sourceSwap?.position ?? audio.currentTime };
          audio.load();
        }
        setupMediaSession(audio, payload, playAudio, pauseAudio, seekAudio);
        paintPlayback(audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
        try {
          await audio.play();
          if (attempt === playAttempt && playbackWanted) paintPlayback();
        } catch (error) {
          // Swapping the source aborts this attempt and resumes on the new one.
          if (attempt === playAttempt && playbackWanted && error?.name !== "AbortError") {
            if (audio.error) {
              handleAudioError();
              return;
            }
            playbackWanted = false;
            paintPlayback(false, "Audio could not be played. Tap play to retry.");
          }
        }
      }

      let localAudioUrl = null;
      let pendingLocalAudioUrl = null;
      let localCopyLoading = null;
      let localCopyFailed = false;
      let sourceSwap = null;

      // iOS can suspend the service worker while locked, so playback must not
      // need it once the recording is in memory.
      function adoptLocalAudio() {
        if (!pendingLocalAudioUrl) return;
        if (document.visibilityState !== "visible" && (audio.paused || audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)) return;
        sourceSwap = {
          position: audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio.currentTime : null
        };
        localAudioUrl = pendingLocalAudioUrl;
        pendingLocalAudioUrl = null;
        audio.src = localAudioUrl;
        if (playbackWanted) void playAudio();
      }

      async function prepareLocalAudio() {
        try {
          const cache = await caches.open(AUDIO_CACHE);
          const blob = await (await cache.match(audioEntry.cacheKey)).blob();
          pendingLocalAudioUrl = URL.createObjectURL(
            blob.type ? blob : new Blob([blob], { type: "audio/mpeg" })
          );
          adoptLocalAudio();
        } catch {
          localCopyFailed = true;
        } finally {
          localCopyLoading = null;
        }
      }

      function playFromLocalCopy() {
        void playAudio();
        if (!localAudioUrl && !pendingLocalAudioUrl && !localCopyFailed && !localCopyLoading) {
          localCopyLoading = prepareLocalAudio();
        }
      }

      audioButton.addEventListener("click", () => {
        const open = overlay.hidden;
        overlay.hidden = !open;
        audioButton.setAttribute("aria-expanded", String(open));
        audioButton.setAttribute("aria-pressed", String(open));
        audioButton.setAttribute(
          "aria-label",
          open ? "Hide article audio player" : "Play article audio"
        );
        audioButton.title = `${open ? "Hide audio player" : "Play article audio"} (available offline)`;
        if (open) {
          void playFromLocalCopy();
        } else {
          pauseAudio();
          closeSpeedMenu(false);
          savePosition(true);
        }
        updateDocked();
      });
      play.addEventListener("click", () => {
        if (playbackWanted || !audio.paused) pauseAudio();
        else playFromLocalCopy();
      });
      back.addEventListener("click", () => {
        seekAudio((sourceSwap?.position ?? audio.currentTime) - 10);
      });
      forward.addEventListener("click", () => {
        seekAudio((sourceSwap?.position ?? audio.currentTime) + 10);
      });
      seek.addEventListener("input", () => {
        seekAudio(Number(seek.value));
      });
      seek.addEventListener("change", () => savePosition(true));
      seek.addEventListener("pointerup", () => savePosition(true));
      audio.addEventListener("loadedmetadata", () => {
        const position = sourceSwap?.position ?? null;
        sourceSwap = null;
        audio.playbackRate = readPlaybackRate();
        if (position === null) {
          restorePosition();
        } else {
          audio.currentTime = position;
        }
        paintTimeline();
        syncMediaPosition();
      });
      audio.addEventListener("durationchange", paintTimeline);
      audio.addEventListener("ratechange", syncMediaPosition);
      audio.addEventListener("seeked", syncMediaPosition);
      audio.addEventListener("waiting", () => {
        if (playbackWanted) paintPlayback(true);
        adoptLocalAudio();
      });
      audio.addEventListener("stalled", adoptLocalAudio);
      audio.addEventListener("playing", () => paintPlayback());
      function handleAudioError() {
        if (!audio.error) return;
        if (!localAudioUrl) {
          playbackWanted = false;
          paintPlayback(false, "Audio could not be played. Tap play to retry.");
          return;
        }
        // Fall back to the worker-served recording, including when an old
        // cached shell's policy still blocks local audio.
        URL.revokeObjectURL(localAudioUrl);
        localAudioUrl = null;
        localCopyFailed = true;
        sourceSwap = { position: sourceSwap?.position ?? audio.currentTime };
        audio.src = audioEntry.cacheKey;
        if (playbackWanted) {
          void playAudio();
        }
      }
      audio.addEventListener("error", handleAudioError);
      audio.addEventListener("timeupdate", () => {
        if (sourceSwap) {
          return;
        }
        paintTimeline();
        savePosition(false);
      });
      audio.addEventListener("play", () => {
        if (!playbackWanted) {
          audio.pause();
          return;
        }
        activeAudio = audio;
        void updatePlayedAt(audioEntry);
      });
      audio.addEventListener("pause", () => {
        if (sourceSwap || !audio.paused) return;
        playbackWanted = false;
        ++playAttempt;
        paintPlayback();
        savePosition(true);
      });
      audio.addEventListener("ended", () => {
        playbackWanted = false;
        paintPlayback();
        try { localStorage.removeItem(storageKey); } catch { /* Best effort. */ }
      });
      window.addEventListener("pagehide", () => savePosition(true), { once: true });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          adoptLocalAudio();
          syncMediaPosition();
        } else {
          savePosition(true);
        }
      });

      toolbar.append(audioButton);
    } else if (narrationEligible && readOfflineIdentity()?.canGenerateAudio === true) {
      audioButton = element("button", { className: "icon-button article-audio-button" });
      audioButton.type = "button";
      audioButton.disabled = true;
      audioButton.title = "Audio isn’t saved offline";
      audioButton.setAttribute("aria-label", "Article audio isn’t saved offline");
      audioButton.append(icon("volume"));
      toolbar.append(audioButton);
    }

    let rawVisible = false;
    let rawButton = null;
    if (singleFile) {
      rawButton = element("button", { className: "icon-button" });
      rawButton.type = "button";
      rawButton.addEventListener("click", () => {
        rawVisible = !rawVisible;
        setRawVisible(rawVisible);
        onRawToggle(rawVisible);
      });
      setRawVisible(false);
      toolbar.append(rawButton);
    }
    toolbar.append(await revisionHistoryControl(payload));

    const dockSentinel = element("span", {
      className: "article-audio-dock-sentinel"
    });
    const dockTopProbe = element("span", {
      className: "article-audio-dock-top-probe"
    });
    dockSentinel.setAttribute("aria-hidden", "true");
    dockTopProbe.setAttribute("aria-hidden", "true");
    group.append(toolbar, dockSentinel, dockTopProbe);
    if (audio && overlay) {
      group.append(audio, overlay);
      let dockFrame = null;
      updateDocked = () => {
        if (dockFrame !== null) {
          return;
        }
        dockFrame = window.requestAnimationFrame(() => {
          dockFrame = null;
          const docked =
            !overlay.hidden &&
            dockSentinel.getBoundingClientRect().top <=
              dockTopProbe.getBoundingClientRect().top;
          overlay.classList.toggle("article-audio-overlay-docked", docked);
        });
      };
      window.addEventListener("scroll", updateDocked, { passive: true });
      window.addEventListener("resize", updateDocked);
      window.visualViewport?.addEventListener("scroll", updateDocked, {
        passive: true
      });
      window.visualViewport?.addEventListener("resize", updateDocked);
    }

    function setRawVisible(visible) {
      rawVisible = visible;
      if (rawButton) {
        rawButton.title = visible ? "Rendered" : "Raw";
        rawButton.setAttribute(
          "aria-label",
          visible ? "View rendered file" : "View raw file"
        );
        rawButton.replaceChildren(icon(visible ? "textSearch" : "fileCode"));
      }
      if (audioButton) {
        audioButton.hidden = visible;
      }
      if (visible && audio && overlay) {
        overlay.hidden = true;
        stopPlayback();
        overlay.classList.remove("article-audio-overlay-docked");
        audioButton?.setAttribute("aria-expanded", "false");
        audioButton?.setAttribute("aria-pressed", "false");
        audioButton?.setAttribute("aria-label", "Play article audio");
        if (audioButton) {
          audioButton.title = "Play article audio (available offline)";
        }
      }
    }

    return group;
  }

  function sourceLineNumbers(content) {
    if (!content) {
      return "1";
    }
    const lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    return Array.from({ length: Math.max(1, lines) }, (_, index) => index + 1).join("\n");
  }

  // Mirrors tightenTableCells in lib/table-cells.ts: short table cells keep
  // their lines whole so a long prose column cannot squeeze them.
  function tightenTableCells(html) {
    if (!html || !html.includes("<table")) {
      return html;
    }
    return html.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (cell, tag, attrs, inner) => {
      if (/\bclass\s*=/.test(attrs) || /<(?:p|ul|ol|li|pre|div|blockquote|table|img|h[1-6])\b/i.test(inner)) {
        return cell;
      }
      const lines = inner
        .split(/<br\s*\/?>/i)
        .map((line) => line.replace(/<[^>]*>/g, "").replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, "x").trim());
      if (!lines.some(Boolean) || lines.some((line) => line.length > 18)) {
        return cell;
      }
      return `<${tag}${attrs} class="cell-tight">${inner}</${tag}>`;
    });
  }

  function fileContent(file, panel = false) {
    if (file.kind === "markdown") {
      const article = element("article", {
        className: panel ? "markdown-body gist-file-markdown" : "markdown-body"
      });
      article.innerHTML = tightenTableCells(file.rendered_html);
      return article;
    }
    const codeView = element("div", { className: "gist-code-view" });
    const lineNumbers = element("pre", {
      className: "gist-line-numbers",
      text: sourceLineNumbers(file.content || "")
    });
    lineNumbers.setAttribute("aria-hidden", "true");
    const content = element("div", {
      className: "markdown-body gist-code-content"
    });
    content.innerHTML = file.rendered_html;
    codeView.append(lineNumbers, content);
    return codeView;
  }

  function rawFileContent(file, panel = false) {
    const pre = element("pre", {
      className: panel ? "raw-markdown gist-file-raw" : "raw-markdown"
    });
    pre.setAttribute("aria-label", "Raw file");
    pre.append(element("code", { text: file.content || "" }));
    return pre;
  }

  function codeCopyControl(content, label, compact = false) {
    const control = element("span", { className: "code-copy-control" });
    const button = element("button", {
      className: compact ? "gist-file-action gist-file-copy" : "code-copy-button"
    });
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    const status = element("span", { className: "sr-only" });
    status.setAttribute("role", "status");
    const paint = (message = "") => {
      button.replaceChildren(icon(message === "Copied" ? "check" : "copy", 16));
      status.className = message && message !== "Copied" ? "code-copy-status" : "sr-only";
    };
    paint();
    let timer;
    let attempt = 0;
    button.addEventListener("click", async () => {
      const current = ++attempt;
      clearTimeout(timer);
      let message;
      try {
        await navigator.clipboard.writeText(content);
        message = "Copied";
      } catch {
        message = "Couldn’t copy. Select the code and copy manually.";
      }
      if (current !== attempt || !button.isConnected) return;
      paint(message);
      status.textContent = button.title = message;
      control.dataset.feedback = "true";
      timer = setTimeout(() => {
        paint();
        status.textContent = "";
        button.title = label;
        delete control.dataset.feedback;
      }, message === "Copied" ? 1500 : 4000);
    });
    control.append(button, status);
    return control;
  }

  function singleRawViewer(file, wrapState) {
    const viewer = element("div", { className: "raw-viewer gist-single-file" });
    viewer.dataset.codeWrap = String(wrapState.value);
    const wrap = wrapButton(`Wrap lines in ${file.filename}`, wrapState.value, () => {
      wrapState.value = !wrapState.value;
      viewer.dataset.codeWrap = String(wrapState.value);
      paintWrapButton(wrap, wrapState.value);
    });
    const actions = element("div", { className: "code-block-actions" });
    actions.append(wrap, codeCopyControl(file.content || "", `Copy ${file.filename}`));
    viewer.append(actions, rawFileContent(file));
    return viewer;
  }

  function filePanel(file, rawUrl) {
    const panel = element("section", { className: "gist-file-panel" });
    const safeId = file.content_sha256?.slice(0, 12) || Math.random().toString(36).slice(2);
    const headingId = `offline-file-heading-${safeId}`;
    const bodyId = `offline-file-body-${safeId}`;
    panel.dataset.gistFilename = file.filename;
    panel.dataset.collapsed = "false";
    panel.setAttribute("aria-labelledby", headingId);
    const header = element("header", { className: "gist-file-header" });
    const disclosure = element("button", { className: "gist-file-disclosure" });
    disclosure.type = "button";
    disclosure.setAttribute("aria-expanded", "true");
    disclosure.setAttribute("aria-controls", bodyId);
    disclosure.setAttribute("aria-label", `Collapse ${file.filename}`);
    const identity = element("span", { className: "gist-file-identity" });
    const filename = element("span", {
      className: "gist-file-name",
      text: file.filename
    });
    filename.id = headingId;
    const metadata = [file.language, formatByteSize(file.byte_size)]
      .filter(Boolean)
      .join(" · ");
    identity.append(
      filename,
      element("span", { className: "gist-file-meta", text: metadata })
    );
    const chevron = icon("chevronDown", 15, 1.9);
    chevron.classList.add("gist-file-chevron");
    disclosure.append(chevron, identity);

    const actions = element("div", { className: "gist-file-actions" });
    const raw = element("a", { className: "gist-file-action", text: "Raw", href: rawUrl });
    let wrapped = false;
    const wrap = wrapButton(`Wrap lines in ${file.filename}`, false, () => {
      wrapped = !wrapped;
      body.firstElementChild.dataset.codeWrap = String(wrapped);
      paintWrapButton(wrap, wrapped);
    }, "gist-file-action gist-file-wrap");
    wrap.hidden = file.kind === "markdown";
    const copy = codeCopyControl(file.content || "", `Copy ${file.filename}`, true);
    raw.setAttribute("aria-label", `View raw ${file.filename}`);
    actions.append(raw, wrap, copy);
    header.append(disclosure, actions);
    const body = element("div", { className: "gist-file-body" });
    body.id = bodyId;
    body.append(fileContent(file, true));
    body.firstElementChild.dataset.codeWrap = String(wrapped);

    disclosure.addEventListener("click", () => {
      const collapsed = panel.dataset.collapsed !== "true";
      panel.dataset.collapsed = String(collapsed);
      body.hidden = collapsed;
      disclosure.setAttribute("aria-expanded", String(!collapsed));
      disclosure.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} ${file.filename}`
      );
      refreshGalleries();
    });
    panel.append(header, body);
    return panel;
  }

  function topLevelHeading(file) {
    return file?.kind === "markdown" && /<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/i.test(file.rendered_html);
  }

  function gistHeading(payload, toolbar) {
    const header = element("header", { className: "page-header page-header-no-brand" });
    const heading = element("div", { className: "gist-heading" });
    const primary = payload.files[payload.primary_file];
    if (!topLevelHeading(primary) && payload.title) {
      heading.append(element("h1", { className: "gist-title", text: payload.title }));
    }

    const metadata = element("div", { className: "gist-meta" });
    const dateRow = element("div", { className: "gist-date-row" });
    const dateLine = element("span", {
      className: "gist-date-line gist-date-line-with-tooltip"
    });
    const latestRevision = payload.history.find((item) => item.is_latest);
    const edited = payload.latest_revision_number > 1;
    const lastEditedAt = edited
      ? latestRevision?.created_at || payload.updated_at
      : null;
    const dateValue = lastEditedAt || payload.created_at;
    const desktopDate = element("span", { className: "gist-date-desktop" });
    const mobileDate = element("span", { className: "gist-date-mobile" });
    desktopDate.append(timestamp(dateValue));
    mobileDate.append(timestamp(dateValue, "short"));
    dateLine.append(
      element("span", {
        className: "gist-date-label",
        text: edited ? "edited:" : "created:"
      }),
      document.createTextNode(" "),
      desktopDate,
      mobileDate
    );
    const tooltip = element("span", { className: "gist-date-tooltip" });
    tooltip.setAttribute("aria-hidden", "true");
    const createdRow = element("span", { className: "gist-date-tooltip-row" });
    createdRow.append(document.createTextNode("created: "), timestamp(payload.created_at));
    tooltip.append(createdRow);
    if (lastEditedAt) {
      const editedRow = element("span", { className: "gist-date-tooltip-row" });
      editedRow.append(document.createTextNode("edited: "), timestamp(lastEditedAt));
      tooltip.append(editedRow);
    }
    dateLine.append(tooltip);
    dateRow.append(dateLine);

    const authorRow = element("div", { className: "gist-author-row" });
    const authorLine = element("span", { className: "gist-author-line" });
    authorLine.append(
      authorAvatar(
        payload.author_name,
        payload.author_avatar_url,
        "gist-author-avatar",
        18
      ),
      document.createTextNode("by "),
      element("span", {
        className: "gist-author-name",
        text: payload.author_name || "Unknown"
      })
    );
    authorRow.append(authorLine);
    if (payload.revision_number < payload.latest_revision_number) {
      authorRow.append(element("span", { text: `Revision ${payload.revision_number}` }));
    }
    metadata.append(dateRow, authorRow);
    heading.append(metadata);
    header.append(heading, toolbar);
    return header;
  }

  function setupEntityGroupHover(root) {
    let activeEntityId = null;

    function entityIdForTarget(target) {
      if (!(target instanceof Element)) {
        return null;
      }
      const entity = target.closest(".eth-entity");
      if (!entity || !root.contains(entity)) {
        return null;
      }
      return Array.from(entity.classList).find((className) =>
        ETH_ENTITY_ID_CLASS_RE.test(className)
      ) || null;
    }

    function clearGroupHover() {
      if (!activeEntityId) {
        return;
      }
      root.querySelectorAll(`.${activeEntityId}`).forEach((node) => {
        node.classList.remove(ETH_ENTITY_GROUP_HOVER_CLASS);
      });
      activeEntityId = null;
    }

    function setGroupHover(entityId) {
      if (!entityId || entityId === activeEntityId) {
        return;
      }
      clearGroupHover();
      activeEntityId = entityId;
      root.querySelectorAll(`.${entityId}`).forEach((node) => {
        node.classList.add(ETH_ENTITY_GROUP_HOVER_CLASS);
      });
    }

    function relatedTargetHasEntityId(target, entityId) {
      return target instanceof Element &&
        root.contains(target) &&
        Boolean(target.closest(`.${entityId}`));
    }

    root.addEventListener("pointerover", (event) => {
      setGroupHover(entityIdForTarget(event.target));
    });
    root.addEventListener("pointerout", (event) => {
      if (
        activeEntityId &&
        entityIdForTarget(event.target) === activeEntityId &&
        !relatedTargetHasEntityId(event.relatedTarget, activeEntityId)
      ) {
        clearGroupHover();
      }
    });
    root.addEventListener("focusin", (event) => {
      setGroupHover(entityIdForTarget(event.target));
    });
    root.addEventListener("focusout", (event) => {
      if (
        activeEntityId &&
        entityIdForTarget(event.target) === activeEntityId &&
        !relatedTargetHasEntityId(event.relatedTarget, activeEntityId)
      ) {
        clearGroupHover();
      }
    });
  }

  async function renderGist(gistId, revisionNumber) {
    const entry = await cachedGistEntry(gistId, revisionNumber);
    if (!entry) {
      renderUnavailable("This gist isn’t available offline.");
      return;
    }
    const payload = await cachedPayload(entry);
    if (!payload) {
      renderUnavailable("This saved gist could not be opened.");
      return;
    }
    await putEntry({ ...entry, lastViewedAt: new Date().toISOString() });
    document.title = `gist: ${payload.display_title || "untitled"}`;
    const files = Object.values(payload.files);
    files.sort((left, right) => {
      if (left.filename === payload.primary_file) return -1;
      if (right.filename === payload.primary_file) return 1;
      return left.filename.localeCompare(right.filename);
    });
    const singleFile = files.length === 1 ? files[0] : null;
    app.className = files.length > 1 ? "page-shell page-shell-gist" : "page-shell";
    app.replaceChildren();

    let currentContent = null;
    let rawVisible = false;
    const singleWrap = { value: false };

    function paintContent() {
      let nextContent;
      if (singleFile && rawVisible) {
        nextContent = singleRawViewer(singleFile, singleWrap);
      } else if (singleFile) {
        nextContent = element("div", {
          className: singleFile.kind === "markdown"
            ? "gist-single-file"
            : "gist-single-file gist-code-container"
        });
        const content = fileContent(singleFile);
        if (singleFile.kind !== "markdown") {
          content.dataset.codeWrap = String(singleWrap.value);
          const wrap = wrapButton(`Wrap lines in ${singleFile.filename}`, singleWrap.value, () => {
            singleWrap.value = !singleWrap.value;
            content.dataset.codeWrap = String(singleWrap.value);
            paintWrapButton(wrap, singleWrap.value);
          });
          const actions = element("div", { className: "code-block-actions" });
          actions.append(wrap, codeCopyControl(singleFile.content || "", `Copy ${singleFile.filename}`));
          nextContent.append(actions);
        }
        nextContent.append(content);
      } else {
        nextContent = element("div", { className: "gist-files" });
        nextContent.append(...files.map((file) => filePanel(file,
          `/${payload.id}/revisions/${payload.revision_number}/raw/${encodeURIComponent(file.filename)}`
        )));
      }
      if (currentContent) {
        currentContent.replaceWith(nextContent);
      } else {
        app.append(nextContent);
      }
      currentContent = nextContent;
      addMarkdownWrapControls(nextContent);
      if (!rawVisible) {
        setupEntityGroupHover(nextContent);
      }
      refreshGalleries();
    }

    const toolbar = await articleToolbar(payload, singleFile, (visible) => {
      rawVisible = visible;
      paintContent();
    });
    app.append(gistHeading(payload, toolbar));
    paintContent();
  }

  function renderUnavailable(message) {
    document.title = "Unavailable offline - Wavey Gist";
    if (!app) {
      return;
    }
    app.className = "auth-shell offline-unavailable";
    app.replaceChildren(
      element("h1", { text: "Unavailable offline" }),
      element("p", { text: message }),
      element("a", {
        className: "offline-back-link",
        text: "Back to saved gists",
        href: "/"
      })
    );
  }

  function showOffline() {
    reconnectVerified = false;
    if (connectionStatus) {
      connectionStatus.textContent = "Offline";
      connectionStatus.disabled = true;
      connectionStatus.removeAttribute("aria-label");
      connectionStatus.title = "";
    }
  }

  function showBackOnline() {
    reconnectVerified = true;
    if (connectionStatus) {
      connectionStatus.textContent = "Back online";
      connectionStatus.disabled = false;
      connectionStatus.setAttribute("aria-label", "Back online. Refresh this page");
      connectionStatus.title = "Refresh";
    }
  }

  function readReconnectReload() {
    try {
      return Number(sessionStorage.getItem(RECONNECT_RELOAD_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function writeReconnectReload() {
    try {
      sessionStorage.setItem(RECONNECT_RELOAD_KEY, String(Date.now()));
    } catch {
      // Without session storage the probe keeps its reload behavior.
    }
  }

  let pullingRefresh = false;
  async function verifyReconnect() {
    if (reconnectProbe || navigator.onLine === false) {
      return reconnectProbe;
    }
    reconnectProbe = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(location.href, {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Connectivity probe failed: ${response.status}`);
        }
        showBackOnline();
        // A slow link can pass this probe and then time out the page again, so
        // reload at most once a minute and leave the Refresh control otherwise.
        const lastReload = readReconnectReload();
        if (!pullingRefresh && !audioIsPlaying() && Date.now() - lastReload > RECONNECT_RELOAD_INTERVAL_MS) {
          writeReconnectReload();
          location.reload();
        }
      } catch {
        showOffline();
      } finally {
        window.clearTimeout(timeout);
        reconnectProbe = null;
      }
    })();
    return reconnectProbe;
  }

  async function start() {
    applyTheme(readTheme());
    await setupOfflineHeader();
    const { mountPullRefresh } = await import("/pull-refresh.mjs");
    if (location.pathname !== "/login") mountPullRefresh(async (signal) => {
      pullingRefresh = true;
      try {
        await verifyReconnect();
        signal.throwIfAborted();
        // Keep the saved reader (and its audio) alive. The existing Back online
        // action opens the live app when the reader chooses to leave this copy.
        return reconnectVerified ? "Back online. Live updates are available." : "You’re offline";
      } finally {
        pullingRefresh = false;
      }
    });
    showOffline();
    connectionStatus?.addEventListener("click", () => {
      if (reconnectVerified) {
        location.reload();
      }
    });
    window.addEventListener("online", () => void verifyReconnect());
    window.addEventListener("offline", showOffline);

    if (!app || !("indexedDB" in window) || !("caches" in window)) {
      renderUnavailable("Offline storage is not supported in this browser.");
      return;
    }
    if (location.pathname === "/" || location.pathname === "/me") {
      await renderLibrary();
    } else {
      const match = ROUTE_RE.exec(location.pathname);
      if (!match || !GIST_ID_RE.test(match[1])) {
        renderUnavailable("Connect to the internet to open this page.");
      } else {
        await renderGist(match[1], match[2] ? Number(match[2]) : null);
      }
    }

    if (navigator.onLine !== false) {
      window.setTimeout(() => void verifyReconnect(), 750);
    }
  }

  // Mirrors mountCodeActionReveal in lib/code-wrap.ts: on touch screens the
  // code block buttons appear on a tap and leave on a tap elsewhere.
  (function mountCodeActionReveal() {
    const blocks = ".code-wrap-block, .gist-code-container, .raw-viewer";
    let start = null;
    function onDown(event) {
      start = event.isPrimary ? { x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
    }
    function onUp(event) {
      const began = start;
      start = null;
      const target = event.target instanceof Element ? event.target : null;
      const block = target ? target.closest(blocks) : null;
      for (const shown of document.querySelectorAll("[data-code-actions]")) {
        if (shown !== block) shown.removeAttribute("data-code-actions");
      }
      if (!block || !began) return;
      // A drag or a long press is scrolling or selecting, not a tap.
      const moved = Math.hypot(event.clientX - began.x, event.clientY - began.y);
      if (moved > 10 || event.timeStamp - began.time > 500) return;
      if (target.closest(".code-block-actions")) {
        block.setAttribute("data-code-actions", "shown");
      } else {
        block.toggleAttribute("data-code-actions");
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
  })();

  void start().catch(() => {
    renderUnavailable("Saved content could not be loaded on this device.");
  });
})();
