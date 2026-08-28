(() => {
  "use strict";

  const DATABASE_NAME = "waveygist-offline";
  const DATABASE_VERSION = 1;
  const CONTENT_CACHE = "waveygist-content-v1";
  const AUDIO_CACHE = "waveygist-audio-v1";
  const ITEMS_PER_PAGE = 20;
  const GIST_ID_RE = /^[A-Za-z0-9]{16,64}$/;
  const ROUTE_RE = /^\/([A-Za-z0-9]{16,64})(?:\/revisions\/([1-9][0-9]*))?\/?$/;
  const THEME_KEY = "theme";
  const TAB_KEY = "waveygist:home-tab:v1";
  const AUDIO_RATE_KEY = "waveygist:audio-rate:v1";
  const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const app = document.getElementById("offline-app");
  const connectionStatus = document.querySelector(".offline-status");

  let databasePromise = null;

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

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return "Saved offline";
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#0d1117" : "#ffffff"
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
      className: "theme-button",
      text: readTheme() === "dark" ? "Light" : "Dark"
    });
    button.type = "button";
    button.setAttribute("aria-label", "Change color theme");
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      button.textContent = next === "dark" ? "Light" : "Dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Theme persistence is best effort.
      }
    });
    return button;
  }

  async function backedGistEntries() {
    const cache = await caches.open(CONTENT_CACHE);
    const entries = (await allEntries()).filter((entry) => entry.kind === "gist");
    const results = [];
    for (const entry of entries) {
      if (await cache.match(entry.cacheKey)) {
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

  function gistListRow(entry, tab) {
    const item = element("li");
    const href = tab === "recent"
      ? `/${entry.gistId}/revisions/${entry.revisionNumber}`
      : `/${entry.gistId}`;
    const link = element("a", { className: "gist-row", href });
    const title = element("span", { className: "gist-title", text: entryTitle(entry) });
    const author = element("span", { className: "gist-author" });
    const avatar = element("span", {
      className: "avatar-placeholder",
      text: authorInitial(entry.authorName)
    });
    avatar.setAttribute("aria-hidden", "true");
    author.append(avatar, document.createTextNode(entry.authorName || "Unknown"));
    const date = element("time", {
      className: "gist-date",
      text: formatDate(entry.lastViewedAt || entry.updatedAt)
    });
    date.dateTime = entry.lastViewedAt || entry.updatedAt || "";
    link.append(title, author, date);
    item.append(link);
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
    app.className = "page-shell library-shell";
    app.replaceChildren();

    const heading = element("header", { className: "library-heading" });
    heading.append(element("h1", { text: "Saved gists" }));
    heading.append(
      element("p", {
        className: "saved-meta",
        text: `${entries.length} ${entries.length === 1 ? "gist" : "gists"} available offline`
      })
    );
    app.append(heading);

    const tools = element("div", { className: "library-tools" });
    const tabs = element("div", { className: "tabs" });
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Saved gist views");
    const recentButton = element("button", { className: "tab", text: "RECENTLY VIEWED" });
    const mineButton = element("button", { className: "tab", text: "MY GISTS" });
    recentButton.type = mineButton.type = "button";
    recentButton.setAttribute("role", "tab");
    mineButton.setAttribute("role", "tab");
    tabs.append(recentButton, element("span", { className: "tab-separator", text: "|" }), mineButton);
    const search = element("input", { className: "library-search" });
    search.type = "search";
    search.placeholder = "Search saved gists";
    search.setAttribute("aria-label", "Search saved gists");
    tools.append(tabs, search);
    app.append(tools);

    const list = element("ul", { className: "gist-list" });
    const empty = element("p", { className: "empty-state" });
    const pager = element("div", { className: "pager" });
    const previous = element("button", { text: "Prev" });
    const next = element("button", { text: "Next" });
    previous.type = next.type = "button";
    pager.append(previous, next);
    app.append(list, empty, pager);

    let tab = readTab();
    let page = 0;

    function paint() {
      recentButton.setAttribute("aria-selected", String(tab === "recent"));
      mineButton.setAttribute("aria-selected", String(tab === "mine"));
      const query = search.value.trim().toLocaleLowerCase();
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
          const leftDate = Date.parse(
            tab === "recent" ? left.lastViewedAt || "" : left.updatedAt || ""
          );
          const rightDate = Date.parse(
            tab === "recent" ? right.lastViewedAt || "" : right.updatedAt || ""
          );
          return (Number.isNaN(rightDate) ? 0 : rightDate) -
            (Number.isNaN(leftDate) ? 0 : leftDate);
        });
      const pages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
      page = Math.min(page, pages - 1);
      const visible = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
      list.replaceChildren(...visible.map((entry) => gistListRow(entry, tab)));
      empty.hidden = visible.length > 0;
      empty.textContent = query
        ? "No saved gists match your search."
        : tab === "recent"
          ? "No recently viewed gists are saved offline."
          : "No owned gists are saved offline.";
      previous.disabled = page === 0;
      next.disabled = page >= pages - 1;
      pager.hidden = filtered.length <= ITEMS_PER_PAGE;
    }

    recentButton.addEventListener("click", () => {
      tab = "recent";
      page = 0;
      saveTab(tab);
      paint();
    });
    mineButton.addEventListener("click", () => {
      tab = "mine";
      page = 0;
      saveTab(tab);
      paint();
    });
    search.addEventListener("input", () => {
      page = 0;
      paint();
    });
    previous.addEventListener("click", () => {
      page = Math.max(0, page - 1);
      paint();
    });
    next.addEventListener("click", () => {
      page += 1;
      paint();
    });
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

  function setupMediaSession(audio, payload) {
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
      play: () => audio.play(),
      pause: () => audio.pause(),
      seekbackward: () => { audio.currentTime = Math.max(0, audio.currentTime - 10); },
      seekforward: () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10); },
      seekto: (details) => {
        if (typeof details.seekTime === "number") {
          audio.currentTime = details.seekTime;
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

  async function offlineAudioPlayer(payload) {
    const audioEntry = (await allEntries()).find(
      (entry) => entry.key === `audio:${payload.id}:${payload.revision_number}`
    );
    if (!audioEntry) {
      return null;
    }
    const cached = await (await caches.open(AUDIO_CACHE)).match(audioEntry.cacheKey);
    if (!cached) {
      return null;
    }

    const player = element("section", { className: "audio-player" });
    player.setAttribute("aria-label", "Saved article audio");
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.src = audioEntry.cacheKey;
    const actions = element("div", { className: "audio-actions" });
    const back = element("button", { className: "audio-skip", text: "−10s" });
    const forward = element("button", { className: "audio-skip", text: "+10s" });
    back.type = forward.type = "button";
    back.addEventListener("click", () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    forward.addEventListener("click", () => {
      audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10);
    });
    const rate = document.createElement("select");
    rate.setAttribute("aria-label", "Playback speed");
    const savedRate = readPlaybackRate();
    for (const value of PLAYBACK_RATES) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value}×`;
      option.selected = value === savedRate;
      rate.append(option);
    }
    audio.playbackRate = savedRate;
    rate.addEventListener("change", () => {
      audio.playbackRate = Number(rate.value);
      try {
        localStorage.setItem(AUDIO_RATE_KEY, rate.value);
      } catch {
        // Playback preference is best effort.
      }
    });
    actions.append(back, forward, rate);
    player.append(audio, actions);

    const storageKey = positionKey(payload.id, payload.revision_number);
    let lastSaved = 0;
    function savePosition(force = false) {
      if (!force && Math.abs(audio.currentTime - lastSaved) < 5) {
        return;
      }
      try {
        if (
          audio.currentTime <= 0.5 ||
          (Number.isFinite(audio.duration) && audio.duration - audio.currentTime <= 10)
        ) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(
            storageKey,
            JSON.stringify({ position: Math.round(audio.currentTime * 10) / 10 })
          );
          lastSaved = audio.currentTime;
        }
      } catch {
        // Playback position is best effort.
      }
    }
    audio.addEventListener("loadedmetadata", () => {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
        const position = Number(stored?.position);
        if (Number.isFinite(position) && position > 0 && position < audio.duration - 10) {
          audio.currentTime = position;
          lastSaved = position;
        }
      } catch {
        // Ignore invalid playback state.
      }
      setupMediaSession(audio, payload);
    });
    audio.addEventListener("timeupdate", () => savePosition(false));
    audio.addEventListener("pause", () => savePosition(true));
    audio.addEventListener("play", () => {
      const audioSession = navigator.audioSession;
      if (audioSession) {
        try { audioSession.type = "playback"; } catch { /* Optional API. */ }
      }
      void updatePlayedAt(audioEntry);
    });
    window.addEventListener("pagehide", () => savePosition(true), { once: true });
    return player;
  }

  function filePanel(file, primary) {
    const details = element("details", { className: "gist-file" });
    details.open = primary;
    const summary = element("summary", { text: file.filename });
    const content = element("div", { className: "gist-file-content markdown-body" });
    content.innerHTML = file.rendered_html;
    details.append(summary, content);
    return details;
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
    document.title = `${payload.display_title || payload.id} - Wavey Gist`;
    app.className = "page-shell";
    app.replaceChildren();

    const heading = element("header", { className: "gist-heading" });
    const row = element("div", { className: "gist-heading-row" });
    row.append(
      element("p", {
        className: "byline",
        text: `by ${payload.author_name || "Unknown"}`
      }),
      themeButton()
    );
    heading.append(
      row,
      element("p", {
        className: "saved-meta",
        text: `Saved revision ${payload.revision_number} · ${formatDate(entry.updatedAt)}`
      })
    );
    app.append(heading);

    const audio = await offlineAudioPlayer(payload);
    if (audio) {
      app.append(audio);
    }

    const files = Object.values(payload.files);
    if (files.length === 1) {
      const content = element("article", { className: "markdown-body" });
      content.innerHTML = files[0].rendered_html;
      app.append(content);
    } else {
      const container = element("div", { className: "gist-files" });
      for (const file of files.sort((left, right) => {
        if (left.filename === payload.primary_file) return -1;
        if (right.filename === payload.primary_file) return 1;
        return left.filename.localeCompare(right.filename);
      })) {
        container.append(filePanel(file, file.filename === payload.primary_file));
      }
      app.append(container);
    }
  }

  function renderUnavailable(message) {
    document.title = "Unavailable offline - Wavey Gist";
    app.className = "page-shell library-shell";
    app.replaceChildren(
      element("h1", { text: "Unavailable offline" }),
      element("p", { className: "unavailable-copy", text: message }),
      element("a", { className: "back-link", text: "Back to offline library", href: "/" })
    );
  }

  async function start() {
    applyTheme(readTheme());
    window.addEventListener("online", () => {
      if (connectionStatus) {
        connectionStatus.textContent = "Back online";
      }
    });
    window.addEventListener("offline", () => {
      if (connectionStatus) {
        connectionStatus.textContent = "Offline";
      }
    });
    if (!app || !("indexedDB" in window) || !("caches" in window)) {
      renderUnavailable("Offline storage is not supported in this browser.");
      return;
    }
    if (location.pathname === "/" || location.pathname === "/me") {
      await renderLibrary();
      return;
    }
    const match = ROUTE_RE.exec(location.pathname);
    if (!match || !GIST_ID_RE.test(match[1])) {
      renderUnavailable("Connect to the internet to open this page.");
      return;
    }
    await renderGist(match[1], match[2] ? Number(match[2]) : null);
  }

  void start().catch(() => {
    renderUnavailable("Saved content could not be loaded on this device.");
  });
})();
