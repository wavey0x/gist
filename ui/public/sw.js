const SUPPORTED_TYPES = new Set(["gist.published", "gist.updated"]);
const FALLBACK_NOTIFICATION = {
  title: "waveygist alert",
  body: "Open waveygist to view the update.",
  path: "/me",
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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const notification = notificationFromEvent(event);
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: "/icons/icon-192.png",
      data: {
        path: notification.path
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.path) ?? "/me";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const existing = windowClients[0];
        if (existing) {
          if ("navigate" in existing) {
            try {
              await existing.navigate(path);
            } catch {
              // The existing same-origin window can still be focused.
            }
          }
          return existing.focus();
        }
        return self.clients.openWindow(path);
      })
  );
});
