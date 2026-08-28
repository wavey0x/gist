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
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    check: ['<path d="m9 11 3 3L22 4" />'],
    chevronDown: ['<path d="m6 9 6 6 6-6" />'],
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
    sun: [
      '<circle cx="12" cy="12" r="4" />',
      '<path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />'
    ],
    volume: [
      '<path d="M11 5 6 9H2v6h4l5 4V5Z" />',
      '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />',
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />'
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

  function formatDate(value, compact = false) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return "saved offline";
    }
    return new Intl.DateTimeFormat(undefined, compact
      ? { dateStyle: "medium" }
      : { dateStyle: "medium", timeStyle: "short" }
    ).format(date);
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
    const item = element("li", { className: "gist-list-item" });
    const row = element("div", { className: "gist-list-row" });
    const content = element("div", { className: "gist-list-content" });
    const href = tab === "recent"
      ? `/${entry.gistId}/revisions/${entry.revisionNumber}`
      : `/${entry.gistId}`;
    const titleLink = element("a", { className: "gist-list-title-link", href });
    titleLink.append(element("span", {
      className: "gist-list-title",
      text: entryTitle(entry)
    }));

    const metadata = element("span", { className: "gist-list-meta" });
    const author = element("span", { className: "gist-list-author" });
    author.append(
      element("span", {
        className: "gist-list-avatar gist-list-avatar-placeholder",
        text: authorInitial(entry.authorName)
      }),
      element("span", {
        className: "gist-list-author-name",
        text: entry.authorName || "Unknown"
      })
    );
    const revisionLink = element("a", {
      className: "gist-list-meta-link",
      href,
      text: `revision ${entry.revisionNumber}`
    });
    const dateValue = tab === "recent"
      ? entry.lastViewedAt || entry.updatedAt
      : entry.updatedAt;
    metadata.append(
      author,
      document.createTextNode(" - "),
      revisionLink,
      document.createTextNode(` - ${tab === "recent" ? "viewed" : "updated"} ${formatDate(dateValue, true)}`)
    );
    content.append(titleLink, metadata);
    row.append(content);
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

    const summary = element("section", { className: "offline-library-summary" });
    summary.setAttribute("aria-label", "Offline library");
    summary.append(
      element("h1", { text: "Saved gists" }),
      element("p", {
        text: `${entries.length} ${entries.length === 1 ? "gist" : "gists"} available offline`
      })
    );

    const history = element("section", {
      className: "home-gist-history offline-library-history"
    });
    history.setAttribute("aria-label", "Saved gist history");
    const tabsSection = element("div", { className: "me-tabs-section" });
    const tabsHeader = element("div", { className: "me-tabs-header" });
    const tabs = element("div", { className: "me-tabs" });
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Saved gist views");
    const recentButton = element("button", {
      className: "me-tab-button",
      text: "RECENTLY VIEWED"
    });
    const mineButton = element("button", {
      className: "me-tab-button",
      text: "MY GISTS"
    });
    recentButton.type = mineButton.type = "button";
    recentButton.setAttribute("role", "tab");
    mineButton.setAttribute("role", "tab");
    tabs.append(
      recentButton,
      element("span", { className: "me-tab-separator", text: "|" }),
      mineButton
    );
    tabsHeader.append(tabs);

    const search = element("div", {
      className: "gist-search offline-library-search"
    });
    const searchInput = element("input", { className: "gist-search-input" });
    searchInput.type = "search";
    searchInput.placeholder = "Search saved gists";
    searchInput.autocomplete = "off";
    searchInput.setAttribute("aria-label", "Search saved gists");
    const searchStatus = element("span", { className: "gist-search-status" });
    searchStatus.setAttribute("aria-live", "polite");
    search.append(searchInput, searchStatus);

    const panel = element("div", { className: "offline-library-panel" });
    panel.setAttribute("role", "tabpanel");
    const list = element("ul", { className: "gist-list" });
    const empty = element("p", { className: "empty-list offline-library-empty" });
    const pager = element("div", { className: "gist-pagination" });
    pager.setAttribute("aria-label", "Pagination");
    const previous = element("button", {
      className: "gist-pagination-button",
      text: "Prev"
    });
    const pageStatus = element("span", { className: "gist-pagination-status" });
    const next = element("button", {
      className: "gist-pagination-button",
      text: "Next"
    });
    previous.type = next.type = "button";
    pager.append(previous, pageStatus, next);
    panel.append(list, empty, pager);
    tabsSection.append(tabsHeader, search, panel);
    history.append(tabsSection);
    app.append(summary, history);

    let tab = readTab();
    let page = 0;

    function selectTab(nextTab) {
      tab = nextTab;
      page = 0;
      saveTab(tab);
      paint();
    }

    function paint() {
      recentButton.setAttribute("aria-selected", String(tab === "recent"));
      mineButton.setAttribute("aria-selected", String(tab === "mine"));
      recentButton.tabIndex = tab === "recent" ? 0 : -1;
      mineButton.tabIndex = tab === "mine" ? 0 : -1;
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
      const visible = filtered.slice(
        page * ITEMS_PER_PAGE,
        (page + 1) * ITEMS_PER_PAGE
      );
      list.replaceChildren(...visible.map((entry) => gistListRow(entry, tab)));
      empty.hidden = visible.length > 0;
      empty.textContent = query
        ? "No saved gists match your search."
        : tab === "recent"
          ? "No recently viewed gists are saved offline."
          : "No owned gists are saved offline.";
      searchStatus.textContent = query
        ? `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`
        : "";
      previous.disabled = page === 0;
      next.disabled = page >= pages - 1;
      pageStatus.textContent = `Page ${page + 1} of ${pages}`;
      pager.hidden = filtered.length <= ITEMS_PER_PAGE;
    }

    recentButton.addEventListener("click", () => selectTab("recent"));
    mineButton.addEventListener("click", () => selectTab("mine"));
    for (const button of [recentButton, mineButton]) {
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
    searchInput.addEventListener("input", () => {
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
    return await (await caches.open(AUDIO_CACHE)).match(entry.cacheKey)
      ? entry
      : null;
  }

  async function articleToolbar(payload) {
    const group = element("div", { className: "article-audio-toolbar-group" });
    const toolbar = element("div", { className: "toolbar" });
    toolbar.setAttribute("aria-label", "Display controls");
    const audioEntry = await cachedAudioEntry(payload);

    if (audioEntry) {
      const audioButton = element("button", {
        className: "icon-button article-audio-button-ready"
      });
      audioButton.type = "button";
      audioButton.title = "Play article audio";
      audioButton.setAttribute("aria-label", "Play article audio");
      audioButton.setAttribute("aria-expanded", "false");
      audioButton.setAttribute("aria-pressed", "false");
      audioButton.append(icon("volume"));

      const audio = document.createElement("audio");
      audio.className = "article-audio-engine";
      audio.preload = "metadata";
      audio.crossOrigin = "anonymous";
      audio.src = audioEntry.cacheKey;
      audio.setAttribute("aria-hidden", "true");

      const overlay = element("div", { className: "article-audio-overlay" });
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
      overlay.append(transport, speedControl, timeline);

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
        if (!force && Math.abs(audio.currentTime - lastSaved) < 5) {
          return;
        }
        try {
          const total = finiteDuration();
          if (audio.currentTime <= 0.5 || (total > 0 && total - audio.currentTime <= 10)) {
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

      audioButton.addEventListener("click", () => {
        const open = overlay.hidden;
        overlay.hidden = !open;
        audioButton.setAttribute("aria-expanded", String(open));
        audioButton.setAttribute("aria-pressed", String(open));
        audioButton.setAttribute(
          "aria-label",
          open ? "Hide article audio player" : "Play article audio"
        );
        audioButton.title = open ? "Hide audio player" : "Play article audio";
        audioButton.classList.toggle("article-audio-button-ready", !open);
      });
      play.addEventListener("click", () => {
        if (audio.paused) {
          void audio.play().catch(() => undefined);
        } else {
          audio.pause();
        }
      });
      back.addEventListener("click", () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
        paintTimeline();
      });
      forward.addEventListener("click", () => {
        audio.currentTime = Math.min(finiteDuration() || Infinity, audio.currentTime + 10);
        paintTimeline();
      });
      seek.addEventListener("input", () => {
        audio.currentTime = Number(seek.value);
        paintTimeline();
      });
      seek.addEventListener("change", () => savePosition(true));
      seek.addEventListener("pointerup", () => savePosition(true));
      audio.addEventListener("loadedmetadata", () => {
        restorePosition();
        paintTimeline();
        setupMediaSession(audio, payload);
      });
      audio.addEventListener("durationchange", paintTimeline);
      audio.addEventListener("timeupdate", () => {
        paintTimeline();
        savePosition(false);
      });
      audio.addEventListener("play", () => {
        activeAudio = audio;
        replaceIcon(play, "pause", 16, 2);
        play.setAttribute("aria-label", "Pause article audio");
        const audioSession = navigator.audioSession;
        if (audioSession) {
          try { audioSession.type = "playback"; } catch { /* Optional API. */ }
        }
        void updatePlayedAt(audioEntry);
      });
      audio.addEventListener("pause", () => {
        replaceIcon(play, "play", 16, 2);
        play.setAttribute("aria-label", "Play article audio");
        savePosition(true);
      });
      audio.addEventListener("ended", () => {
        replaceIcon(play, "play", 16, 2);
        play.setAttribute("aria-label", "Play article audio");
        try { localStorage.removeItem(storageKey); } catch { /* Best effort. */ }
      });
      window.addEventListener("pagehide", () => savePosition(true), { once: true });

      toolbar.append(audioButton);
      group.append(toolbar, audio, overlay);
    } else {
      group.append(toolbar);
    }

    toolbar.append(themeButton());
    return group;
  }

  function sourceLineNumbers(content) {
    if (!content) {
      return "1";
    }
    const lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    return Array.from({ length: Math.max(1, lines) }, (_, index) => index + 1).join("\n");
  }

  function fileContent(file, panel = false) {
    if (file.kind === "markdown") {
      const article = element("article", {
        className: panel ? "markdown-body gist-file-markdown" : "markdown-body"
      });
      article.innerHTML = file.rendered_html;
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

  function filePanel(file) {
    const panel = element("section", { className: "gist-file-panel" });
    panel.dataset.collapsed = "false";
    const header = element("header", { className: "gist-file-header" });
    const disclosure = element("button", { className: "gist-file-disclosure" });
    disclosure.type = "button";
    disclosure.setAttribute("aria-expanded", "true");
    disclosure.setAttribute("aria-label", `Collapse ${file.filename}`);
    const identity = element("span", { className: "gist-file-identity" });
    identity.append(element("span", { className: "gist-file-name", text: file.filename }));
    if (file.language) {
      identity.append(element("span", { className: "gist-file-meta", text: file.language }));
    }
    disclosure.append(icon("chevronDown", 15, 1.9), identity);
    header.append(disclosure);
    const body = element("div", { className: "gist-file-body" });
    body.append(fileContent(file, true));
    disclosure.addEventListener("click", () => {
      const collapsed = panel.dataset.collapsed !== "true";
      panel.dataset.collapsed = String(collapsed);
      body.hidden = collapsed;
      disclosure.setAttribute("aria-expanded", String(!collapsed));
      disclosure.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} ${file.filename}`
      );
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
    const dateLine = element("span", { className: "gist-date-line" });
    const edited = payload.revision_number > 1;
    const dateValue = payload.updated_at || payload.created_at;
    dateLine.append(
      element("span", {
        className: "gist-date-label",
        text: edited ? "edited:" : "created:"
      }),
      document.createTextNode(" "),
      element("span", {
        className: "gist-date-desktop",
        text: formatDate(dateValue)
      }),
      element("span", {
        className: "gist-date-mobile",
        text: formatDate(dateValue, true)
      })
    );
    dateRow.append(dateLine);

    const authorRow = element("div", { className: "gist-author-row" });
    const authorLine = element("span", { className: "gist-author-line" });
    const avatar = element("span", {
      className: "gist-author-avatar gist-author-avatar-placeholder",
      text: authorInitial(payload.author_name)
    });
    avatar.setAttribute("aria-hidden", "true");
    authorLine.append(
      avatar,
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
    app.className = "page-shell page-shell-gist";
    app.replaceChildren();

    const toolbar = await articleToolbar(payload);
    app.append(gistHeading(payload, toolbar));

    const files = Object.values(payload.files);
    if (files.length === 1) {
      const content = element("div", { className: "gist-single-file" });
      content.append(fileContent(files[0]));
      app.append(content);
      return;
    }

    const container = element("div", { className: "gist-files" });
    files.sort((left, right) => {
      if (left.filename === payload.primary_file) return -1;
      if (right.filename === payload.primary_file) return 1;
      return left.filename.localeCompare(right.filename);
    });
    container.append(...files.map(filePanel));
    app.append(container);
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
        if (!audioIsPlaying()) {
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

  void start().catch(() => {
    renderUnavailable("Saved content could not be loaded on this device.");
  });
})();
