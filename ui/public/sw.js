const SHELL_CACHE = "waveygist-shell";
const CONTENT_CACHE = "waveygist-content-v1";
const AUDIO_CACHE = "waveygist-audio-v1";
const SHELL_URL = "/offline-shell.html";
// Only a truly stuck request falls back to the offline page. A merely slow
// server must not swap in a different page and then reload over it.
const NAVIGATION_TIMEOUT_MS = 8000;
const SHARED_SHELL_ASSETS = [
  "/github-markdown.css",
  "/markdown-theme.css",
  "/app.css",
  "/syntax.css",
  "/gallery-model.mjs",
  "/code-lines.mjs",
  "/offline-table-migration.mjs",
  "/gallery-viewer.mjs",
  "/gallery-viewer.css",
  "/vendor/photoswipe/photoswipe.esm.js",
  "/vendor/photoswipe/photoswipe.css"
];
const OFFLINE_SHELL_ASSETS = [
  SHELL_URL,
  "/offline-shell.css",
  "/offline-shell.js",
  "/standalone-navigation.mjs",
  "/pull-refresh.mjs",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];
const SHELL_ASSETS = [...OFFLINE_SHELL_ASSETS, ...SHARED_SHELL_ASSETS];
const GIST_PATH_RE = /^\/[A-Za-z0-9]{16,64}(?:\/.*)?$/;
const RAW_PATH_RE = /^\/([A-Za-z0-9]{16,64})(?:\/revisions\/([1-9][0-9]*))?\/raw(?:\/([^/]+))?\/?$/;
const IMAGE_PATH_RE = /^\/api\/images\/img_[A-Za-z0-9_-]{16,64}$/;
const AUDIO_PATH_RE =
  /^\/api\/gists\/[A-Za-z0-9]{16,64}\/revisions\/[1-9][0-9]*\/narration\/audio$/;
const SUPPORTED_TYPES = new Set([
  "gist.published",
  "gist.updated",
  "narration.ready"
]);
const FALLBACK_NOTIFICATION = {
  title: "waveygist alert",
  body: "Open waveygist to view the update.",
  path: "/",
  tag: "waveygist-alert"
};

function safePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return null;
  }
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

function safeString(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

function notificationFromEvent(event) {
  try {
    const payload = event.data?.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !SUPPORTED_TYPES.has(payload.type)
    ) {
      return FALLBACK_NOTIFICATION;
    }
    const title = safeString(payload.title, 100);
    const body = safeString(payload.body, 160);
    const path = safePath(payload.path);
    const tag = safeString(payload.tag, 200);
    if (!title || !body || !path || !tag) {
      return FALLBACK_NOTIFICATION;
    }
    return { title, body, path, tag };
  } catch {
    return FALLBACK_NOTIFICATION;
  }
}

function isShellAsset(url) {
  return (
    url.origin === self.location.origin &&
    SHELL_ASSETS.some(
      (asset) => new URL(asset, self.location.origin).href === url.href
    )
  );
}

function shellRequests(assets, cacheMode) {
  return assets.map(
    (asset) =>
      new Request(new URL(asset, self.location.origin), { cache: cacheMode })
  );
}

async function refreshShellAssets(assets, cacheMode) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(shellRequests(assets, cacheMode));
}

function isOfflineNavigation(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname === "/" ||
      url.pathname === "/me" ||
      url.pathname === "/login" ||
      GIST_PATH_RE.test(url.pathname))
  );
}

async function hasSavedCopy(url) {
  const saved = await (await caches.open(CONTENT_CACHE)).keys();
  if (!GIST_PATH_RE.test(url.pathname)) {
    return saved.length > 0;
  }
  const gistId = url.pathname.split("/")[1];
  const prefix = `/api/gists/${gistId}/revisions/`;
  return saved.some((request) => new URL(request.url).pathname.startsWith(prefix));
}

async function savedRawResponse(url) {
  const [, gistId, revision, encodedFilename] = RAW_PATH_RE.exec(url.pathname);
  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  };
  try {
    const cache = await caches.open(CONTENT_CACHE);
    const prefix = `/api/gists/${gistId}/revisions/`;
    const candidates = (await cache.keys()).filter((request) => {
      const path = new URL(request.url).pathname;
      return path.startsWith(prefix) && /^\d+\/render$/.test(path.slice(prefix.length)) &&
        (!revision || path === `${prefix}${revision}/render`);
    }).sort((a, b) => Number(new URL(b.url).pathname.split("/")[5]) -
      Number(new URL(a.url).pathname.split("/")[5]));
    const response = candidates[0] && await cache.match(candidates[0]);
    if (response) {
      const payload = await response.json();
      const filename = encodedFilename ? decodeURIComponent(encodedFilename) : payload.primary_file;
      const file = Object.hasOwn(payload.files, filename) ? payload.files[filename] : null;
      if (!file || typeof file.content !== "string") {
        return new Response("Not found\n", { status: 404, headers });
      }
      return new Response(file.content, { headers: {
        ...headers,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
      } });
    }
  } catch { /* Keep unavailable Raw pages plain text too. */ }
  return new Response("This file is not saved offline. Reconnect and try again.\n", {
    status: 503, headers
  });
}

// Weak signal can hold a request open for minutes, so a saved copy wins eventually.
async function navigationResponse(networkResponse, url) {
  const fallbackResponse = async () => RAW_PATH_RE.test(url.pathname)
    ? savedRawResponse(url)
    : (await caches.open(SHELL_CACHE)).match(SHELL_URL);
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS);
  });
  try {
    if (self.navigator?.onLine === false && (await hasSavedCopy(url))) {
      const offline = await fallbackResponse();
      if (offline) {
        return offline;
      }
    }
    const response = await Promise.race([networkResponse, timedOut]);
    if (response) {
      return response;
    }
    const fallback = (await hasSavedCopy(url)) ? await fallbackResponse() : null;
    return fallback ?? (await networkResponse);
  } catch {
    return (await fallbackResponse()) ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
}

function copyMediaHeaders(response, length) {
  const headers = new Headers();
  for (const name of ["content-type", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(length));
  return headers;
}

function parseSingleRange(value, size) {
  if (
    typeof value !== "string" ||
    !value.startsWith("bytes=") ||
    value.includes(",")
  ) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    return null;
  }
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      return null;
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function cachedAudioResponse(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const response = await cache.match(request.url);
  if (!response) {
    return null;
  }
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader && request.method === "GET") {
    return response;
  }
  // The cache writer saves the verified size, so HEAD needs no body read.
  const size = Number(response.headers.get("content-length"));
  if (!rangeHeader) {
    return new Response(null, {
      status: 200,
      headers: copyMediaHeaders(response, size)
    });
  }
  const range = parseSingleRange(rangeHeader, size);
  if (!range) {
    const headers = copyMediaHeaders(response, 0);
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = range.end - range.start + 1;
  const headers = copyMediaHeaders(response, length);
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(
    request.method === "HEAD"
      ? null
      : (await response.blob()).slice(range.start, range.end + 1),
    { status: 206, headers }
  );
}

async function networkWithCachedFallback(request, cacheName, ignoreSearch = false) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await (await caches.open(cacheName)).match(request.url, { ignoreSearch });
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function currentShellAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await refreshShellAssets(SHELL_ASSETS, "reload");
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("waveygist-shell") && name !== SHELL_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    request.mode === "navigate" &&
    isOfflineNavigation(url)
  ) {
    const networkResponse = fetch(request);
    event.respondWith(navigationResponse(networkResponse, url));
    event.waitUntil(
      networkResponse
        .then(() => refreshShellAssets(OFFLINE_SHELL_ASSETS, "no-cache"))
        .catch(() => undefined)
    );
    return;
  }

  if (request.method === "GET" && isShellAsset(url)) {
    event.respondWith(currentShellAsset(request));
    return;
  }

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    url.origin === self.location.origin &&
    AUDIO_PATH_RE.test(url.pathname)
  ) {
    event.respondWith(
      cachedAudioResponse(request).then((response) => response ?? fetch(request))
    );
    return;
  }

  if (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    IMAGE_PATH_RE.test(url.pathname)
  ) {
    event.respondWith(networkWithCachedFallback(request, CONTENT_CACHE, true));
  }
});

self.addEventListener("push", (event) => {
  const notification = notificationFromEvent(event);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        tag: notification.tag,
        icon: "/icons/icon-192.png",
        data: { path: notification.path }
      });
      const unread = await self.registration.getNotifications();
      await self.navigator.setAppBadge?.(unread.length).catch(() => undefined);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.path) ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const targetUrl = new URL(path, self.location.origin).href;
        const target = windowClients.find(
          (windowClient) => windowClient.url === targetUrl
        );
        if (target) {
          return target.focus();
        }
        const existing = windowClients[0];
        if (existing && "navigate" in existing) {
          try {
            const navigated = await existing.navigate(targetUrl);
            if (navigated) {
              return navigated.focus();
            }
          } catch {
            // Opening a new window is the fallback.
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
