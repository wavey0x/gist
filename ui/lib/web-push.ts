export type PushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function applicationServerKeyBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const decoded = window.atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function subscriptionPayload(
  subscription: PushSubscription
): PushSubscriptionPayload {
  const serialized = subscription.toJSON();
  if (
    typeof serialized.endpoint !== "string" ||
    typeof serialized.keys?.p256dh !== "string" ||
    typeof serialized.keys?.auth !== "string"
  ) {
    throw new Error("The browser returned an invalid push subscription");
  }
  return {
    endpoint: serialized.endpoint,
    keys: {
      p256dh: serialized.keys.p256dh,
      auth: serialized.keys.auth
    }
  };
}

async function subscriptionRequest(
  method: "PUT" | "DELETE",
  payload: PushSubscriptionPayload | { endpoint: string }
) {
  const response = await fetch("/api/me/push-subscriptions", {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Push subscription request failed: ${response.status}`);
  }
}

export function supportsWebPush() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandaloneDisplay() {
  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return Promise.reject(new Error("Service workers are unsupported"));
  }
  registrationPromise ??= navigator.serviceWorker
    .register("/sw.js", {
      scope: "/",
      updateViaCache: "none"
    })
    .then((registration) => {
      void registration.update().catch(() => undefined);
      return registration;
    })
    .catch((error) => {
      registrationPromise = null;
      throw error;
    });
  return registrationPromise;
}

export function registerPushServiceWorker() {
  return registerServiceWorker();
}

export async function bindExistingSubscription(
  registration: ServiceWorkerRegistration
) {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }
  await subscriptionRequest("PUT", subscriptionPayload(subscription));
  return subscription;
}

export async function enablePushSubscription(
  registration: ServiceWorkerRegistration,
  applicationServerKey: string
) {
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKeyBytes(applicationServerKey)
    }));
  try {
    await subscriptionRequest("PUT", subscriptionPayload(subscription));
  } catch (error) {
    if (!existing) {
      await subscription.unsubscribe().catch(() => false);
    }
    throw error;
  }
  return subscription;
}

export async function disablePushSubscription(
  registration: ServiceWorkerRegistration
) {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return { backendSynced: true };
  }
  let backendSynced = true;
  try {
    await subscriptionRequest("DELETE", {
      endpoint: subscription.endpoint
    });
  } catch {
    backendSynced = false;
  }
  await subscription.unsubscribe().catch(() => false);
  return { backendSynced };
}
