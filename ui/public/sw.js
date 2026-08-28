const SHELL_VERSION = "v3";
const SHELL_QUERY = "v=3";
const SHELL_CACHE = `waveygist-shell-${SHELL_VERSION}`;
const CONTENT_CACHE = "waveygist-content-v1";
const AUDIO_CACHE = "waveygist-audio-v1";
const SHELL_URL = `/offline-shell.html?${SHELL_QUERY}`;
const SHELL_ASSETS = [
  SHELL_URL,
  `/github-markdown.css?${SHELL_QUERY}`,
  `/markdown-theme.css?${SHELL_QUERY}`,
  `/app.css?${SHELL_QUERY}`,
  `/syntax.css?${SHELL_QUERY}`,
  `/offline-shell.css?${SHELL_QUERY}`,
  `/offline-shell.js?${SHELL_QUERY}`,
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];
const GIST_PATH_RE = /^\/[A-Za-z0-9]{16,64}(?:\/.*)?$/;
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

function isOfflineNavigation(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname === "/" ||
      url.pathname === "/me" ||
      url.pathname === "/login" ||
      GIST_PATH_RE.test(url.pathname))
  );
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
  const bytes = await response.arrayBuffer();
  const size = bytes.byteLength;
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    return new Response(request.method === "HEAD" ? null : bytes, {
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
    request.method === "HEAD" ? null : bytes.slice(range.start, range.end + 1),
    { status: 206, headers }
  );
}

async function networkWithCachedFallback(request, cacheName) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await (await caches.open(cacheName)).match(request.url);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("waveygist-shell-") && name !== SHELL_CACHE) {
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
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
        return shell ?? Response.error();
      })
    );
    return;
  }

  if (request.method === "GET" && isShellAsset(url)) {
    event.respondWith(
      caches.match(request).then((response) => response ?? fetch(request))
    );
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
    event.respondWith(networkWithCachedFallback(request, CONTENT_CACHE));
  }
});

self.addEventListener("push", (event) => {
  const notification = notificationFromEvent(event);
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: "/icons/icon-192.png",
      data: { path: notification.path }
    })
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
