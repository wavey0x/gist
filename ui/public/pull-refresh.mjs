import { isStandaloneDisplay } from "./standalone-navigation.mjs";

const EXCLUDED = 'button,input,select,textarea,summary,[contenteditable],[data-pull-refresh="ignore"],.table-scroll,pre,.mermaid-panzoom,.article-audio-overlay,.mini-player,[data-no-swipe]';
const BLOCKED = '[role="dialog"],.pswp,.history-menu,.queue-reorder-menu';
const TRIGGER = 80;

// The same gesture and feedback are used by the live app and the saved reader.
// Each screen supplies only its data refresh; this never navigates or reloads.
export function mountPullRefresh(refresh, enabled = () => true) {
  if (!isStandaloneDisplay()) return () => {};
  const indicator = document.createElement("div");
  indicator.className = "pull-refresh";
  indicator.dataset.state = "idle";
  indicator.innerHTML = '<button type="button" aria-label="Refresh this page" title="Refresh"><svg class="pull-refresh-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5"/></svg><svg class="pull-refresh-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button><span class="sr-only" role="status"></span>';
  const button = indicator.querySelector("button");
  const status = indicator.querySelector('[role="status"]');
  document.querySelector(".app-header").after(indicator);
  let gesture = null;
  let controller = null;
  let disposed = false;
  let swallowClick = false;
  let frame;
  let settleTimer;

  function paint(distance, state) {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      indicator.dataset.state = state;
      indicator.style.setProperty("--pull-distance", `${Math.min(48, distance * 0.6)}px`);
      indicator.style.setProperty("--pull-rotation", `${Math.min(1, distance / TRIGGER) * 180}deg`);
    });
  }

  function settle() {
    gesture = null;
    paint(0, "idle");
  }

  async function run() {
    if (controller || !enabled()) return;
    clearTimeout(settleTimer);
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 8000);
    gesture = null;
    button.setAttribute("aria-busy", "true");
    status.className = "sr-only";
    status.textContent = "Refreshing";
    paint(TRIGGER, "refreshing");
    try {
      const message = await Promise.race([
        refresh(current.signal),
        new Promise((_, reject) => current.signal.addEventListener("abort", () => reject(new Error("Refresh cancelled")), { once: true }))
      ]);
      if (disposed) return;
      status.textContent = message || "Updated";
      status.className = message ? "pull-refresh-message" : "sr-only";
      paint(TRIGGER, message ? "notice" : "complete");
      settleTimer = setTimeout(settle, message ? 2400 : 450);
    } catch {
      if (disposed) return;
      status.textContent = navigator.onLine === false ? "You’re offline" : "Couldn’t refresh. Try again.";
      status.className = "pull-refresh-message";
      paint(TRIGGER, "notice");
      settleTimer = setTimeout(settle, 2400);
    } finally {
      clearTimeout(timeout);
      controller = null;
      button.removeAttribute("aria-busy");
    }
  }

  function start(event) {
    swallowClick = false;
    if (gesture) settle();
    if (controller || !enabled() || event.touches.length !== 1 || scrollY > 1 ||
        (visualViewport?.scale ?? 1) !== 1 || document.querySelector(BLOCKED) ||
        window.getSelection()?.toString() || !(event.target instanceof Element) ||
        (!event.target.closest("main") && event.target !== document.body && event.target !== document.documentElement) ||
        event.target.closest(EXCLUDED)) return;
    clearTimeout(settleTimer);
    status.textContent = "";
    status.className = "sr-only";
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, pulling: false, distance: 0 };
  }

  function move(event) {
    if (!gesture) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === gesture.id);
    if (!touch || event.touches.length !== 1 || scrollY > 1) return settle();
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (!gesture.pulling) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (dy <= 0 || dy < Math.abs(dx) * 1.25) return settle();
      gesture.pulling = true;
      swallowClick = true;
    }
    if (!event.cancelable) return settle();
    event.preventDefault();
    gesture.distance = Math.max(0, dy);
    paint(gesture.distance, dy >= TRIGGER ? "ready" : "pulling");
  }

  function end() {
    if (!gesture) return;
    if (gesture.pulling && gesture.distance >= TRIGGER) void run();
    else settle();
  }

  function click(event) {
    // A new touch clears this flag, so a deliberate tap after a pull still works.
    if (!swallowClick || event.detail === 0) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  button.addEventListener("click", run);
  window.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", settle);
  window.addEventListener("click", click, true);
  return () => {
    disposed = true;
    controller?.abort();
    cancelAnimationFrame(frame);
    clearTimeout(settleTimer);
    window.removeEventListener("touchstart", start);
    window.removeEventListener("touchmove", move);
    window.removeEventListener("touchend", end);
    window.removeEventListener("touchcancel", settle);
    window.removeEventListener("click", click, true);
    indicator.remove();
  };
}
