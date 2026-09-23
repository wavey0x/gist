import {
  collectGalleries,
  galleryOptions,
  imageAsset
} from "./gallery-model.mjs";

const HISTORY_KEY = "wgGallery";
let activeViewer = null;
let photoSwipeModule;

function loadPhotoSwipe() {
  const url = "/vendor/photoswipe/photoswipe.esm.js";
  return (photoSwipeModule ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ url
  ).catch((error) => {
    photoSwipeModule = null;
    throw error;
  }));
}

function replaceHistory(value) {
  const state = { ...history.state };
  if (value) state[HISTORY_KEY] = value;
  else delete state[HISTORY_KEY];
  history.replaceState(state, "");
}

export function mountGallery(roots, options = galleryOptions(document)) {
  const { groups, triggers } = collectGalleries(roots, options);
  const token = crypto.randomUUID();
  const pageUrl = location.href;
  const cleanups = [];
  const sizes = new Map();
  let disposed = false;
  let opening = false;
  let viewer = null;
  let lastTrigger = null;
  let historyClosing = false;

  // A history marker from an earlier document must never reopen a stale overlay.
  if (!activeViewer && history.state?.[HISTORY_KEY]) replaceHistory(null);
  if (!groups.length) return () => {};

  function ownsEntry() {
    return history.state?.[HISTORY_KEY]?.token === token;
  }

  function displaySource(src) {
    const asset = imageAsset(src, options);
    return asset ? asset.path + asset.search : src;
  }

  function resolveImage(item) {
    if (item.width && item.height) return Promise.resolve(item);
    if (sizes.has(item.src)) return sizes.get(item.src);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error("Empty image"));
          return;
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => reject(new Error("Image unavailable"));
      image.src = displaySource(item.src);
    }).catch((error) => {
      sizes.delete(item.src);
      throw error;
    });
    sizes.set(item.src, promise);
    return promise;
  }

  async function open(group, index, trigger, fromHistory = false) {
    if (
      disposed ||
      opening ||
      historyClosing ||
      location.href !== pageUrl ||
      !group.root.isConnected
    )
      return;
    opening = true;
    trigger?.setAttribute("aria-busy", "true");
    let PhotoSwipe;
    try {
      ({ default: PhotoSwipe } = await loadPhotoSwipe());
    } catch {
      if (!disposed && !fromHistory) location.assign(trigger.href);
      return;
    } finally {
      opening = false;
      trigger?.removeAttribute("aria-busy");
    }
    if (disposed || location.href !== pageUrl || !group.root.isConnected)
      return;
    activeViewer?.destroy();
    lastTrigger = trigger ?? lastTrigger;
    const groupIndex = groups.indexOf(group);
    const historyValue = () => ({
      token,
      group: groupIndex,
      index: pswp.currIndex
    });
    if (!fromHistory) {
      history.pushState(
        {
          ...history.state,
          [HISTORY_KEY]: { token, group: groupIndex, index }
        },
        ""
      );
    }

    const data = group.items.map(() => ({
      html: '<div class="wg-gallery-message" role="status">Loading image…</div>'
    }));
    const status = group.items.map(() => "idle");
    const reducedMotion = matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let caption;
    let announcement;
    let original;
    let captionHeight = 0;
    let resizeFrame = 0;
    let closed = false;
    let localClose = false;
    let inertElements = [];
    const scroll = { x: window.scrollX, y: window.scrollY };
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const pswp = new PhotoSwipe({
      dataSource: data,
      index,
      mainClass: "wg-gallery",
      loop: false,
      allowPanToNext: false,
      pinchToClose: false,
      closeOnVerticalDrag: true,
      bgOpacity: 0.96,
      imageClickAction: "zoom",
      tapAction: "toggle-controls",
      doubleTapAction: "zoom",
      showHideAnimationType: "fade",
      // PhotoSwipe ignores dismissal while its opening transition is running.
      // Open immediately so a quick preview can always be closed right away.
      showAnimationDuration: 0,
      hideAnimationDuration: reducedMotion ? 0 : 160,
      zoomAnimationDuration: reducedMotion ? 0 : 200,
      initialZoomLevel: "fit",
      secondaryZoomLevel: 1,
      preload: [1, 1],
      counter: group.items.length > 1,
      arrowPrev: group.items.length > 1,
      arrowNext: group.items.length > 1,
      returnFocus: false,
      indexIndicatorSep: " / ",
      paddingFn: (viewport) => ({
        top: Math.max(
          76,
          (pswp.element
            ?.querySelector(".pswp__top-bar")
            ?.getBoundingClientRect().bottom ?? 60) + 16
        ),
        bottom: captionHeight + 24,
        left: viewport.x < 600 ? 12 : 60,
        right: viewport.x < 600 ? 12 : 60
      })
    });
    viewer = pswp;
    activeViewer = pswp;

    function refreshSize() {
      const next = caption?.getBoundingClientRect().height ?? 0;
      if (caption)
        caption.tabIndex = caption.scrollHeight > caption.clientHeight ? 0 : -1;
      if (next === captionHeight) return;
      captionHeight = next;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!closed) pswp.updateSize(true);
      });
    }

    function load(index) {
      if (index < 0 || index >= group.items.length || status[index] !== "idle")
        return;
      status[index] = "loading";
      const item = group.items[index];
      resolveImage(item)
        .then(({ width, height }) => {
          if (closed) return;
          item.width = width;
          item.height = height;
          status[index] = "ready";
          data[index] = {
            src: displaySource(item.src),
            width: item.width,
            height: item.height,
            alt: item.alt || item.caption
          };
          pswp.refreshSlideContent(index);
        })
        .catch(() => {
          if (closed) return;
          status[index] = "error";
          data[index] = {
            html: '<div class="wg-gallery-message"><p>This image is unavailable. If you’re offline, reconnect to try again.</p><button type="button" class="wg-gallery-retry">Retry</button></div>'
          };
          pswp.refreshSlideContent(index);
        });
    }

    pswp.on("uiRegister", () => {
      pswp.ui.registerElement({
        name: "original",
        tagName: "a",
        order: 8,
        isButton: false,
        className: "wg-gallery-original",
        html: "Open original",
        onInit: (element) => {
          original = element;
          element.target = "_blank";
          element.rel = "noopener noreferrer";
        }
      });
      pswp.ui.registerElement({
        name: "caption",
        appendTo: "root",
        className: "wg-gallery-caption",
        onInit: (element) => {
          caption = element;
        }
      });
      pswp.ui.registerElement({
        name: "announcement",
        appendTo: "root",
        className: "wg-gallery-announcement",
        onInit: (element) => {
          announcement = element;
          element.setAttribute("role", "status");
          element.setAttribute("aria-live", "polite");
          element.setAttribute("aria-atomic", "true");
        }
      });
    });
    pswp.on("contentLoadImage", ({ content }) => {
      content.element.referrerPolicy = "no-referrer";
    });
    pswp.addFilter("contentErrorElement", () => {
      const message = document.createElement("div");
      message.className = "wg-gallery-message";
      const text = document.createElement("p");
      text.textContent =
        "This image is unavailable. If you’re offline, reconnect to try again.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "wg-gallery-retry";
      retry.textContent = "Retry";
      message.append(text, retry);
      return message;
    });
    pswp.on("change", () => {
      const current = pswp.currIndex;
      const item = group.items[current];
      if (caption) {
        caption.textContent = item.caption;
        caption.hidden = !item.caption;
      }
      if (original) original.href = displaySource(item.src);
      if (announcement)
        announcement.textContent = `Image ${current + 1} of ${group.items.length}${item.caption ? `: ${item.caption}` : ""}`;
      if (ownsEntry()) replaceHistory(historyValue());
      refreshSize();
      load(current);
      load(current - 1);
      load(current + 1);
    });
    pswp.on("afterInit", () => {
      const root = pswp.element;
      root.setAttribute("aria-label", "Image gallery");
      root.setAttribute("aria-modal", "true");
      root.dataset.pullRefresh = "ignore";
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      inertElements = [...document.body.children].filter(
        (element) => element !== root && !element.inert
      );
      inertElements.forEach((element) => {
        element.inert = true;
      });
      root.addEventListener("click", (event) => {
        if (!event.target.closest(".wg-gallery-retry")) return;
        const index = pswp.currIndex;
        status[index] = "idle";
        data[index] = {
          html: '<div class="wg-gallery-message" role="status">Loading image…</div>'
        };
        pswp.refreshSlideContent(index);
        load(index);
      });
    });
    pswp.on("bindEvents", () => {
      pswp.element
        ?.querySelector(".pswp__button--close")
        ?.focus({ preventScroll: true });
    });
    // PhotoSwipe contains focusin events; Tab also needs to wrap at the ends
    // so Safari does not move focus into browser chrome before that event fires.
    pswp.on("keydown", (event) => {
      const key = event.originalEvent;
      if (
        document.activeElement === caption &&
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          key.key
        )
      ) {
        event.preventDefault();
        return;
      }
      if (key.key !== "Tab") return;
      const controls = [
        ...pswp.element.querySelectorAll("a[href], button, [tabindex='0']")
      ].filter(
        (element) =>
          !element.disabled &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden" &&
          !element.closest('[aria-hidden="true"]')
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      const target =
        key.shiftKey && document.activeElement === first
          ? last
          : !key.shiftKey && document.activeElement === last
            ? first
            : null;
      if (target) {
        event.preventDefault();
        key.preventDefault();
        target.focus({ preventScroll: true });
      }
    });
    const captionObserver = new ResizeObserver(refreshSize);
    pswp.on("close", () => {
      if (!localClose && !disposed && ownsEntry()) {
        historyClosing = true;
        history.back();
      }
    });
    pswp.on("destroy", () => {
      closed = true;
      captionObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      inertElements.forEach((element) => {
        element.inert = false;
      });
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      if (viewer === pswp) viewer = null;
      if (activeViewer === pswp) activeViewer = null;
      if (location.href === pageUrl) {
        window.scrollTo(scroll.x, scroll.y);
        const target = lastTrigger?.isConnected
          ? lastTrigger
          : document.querySelector(
              ".gist-file-disclosure, .page-header button, .app-brand"
            );
        target?.focus({ preventScroll: true });
      }
    });
    // History navigation and unmount close locally; only a user's dismissal goes Back.
    pswp.galleryCloseLocally = () => {
      localClose = true;
      pswp.close();
    };
    pswp.init();
    if (caption) captionObserver.observe(caption);
  }

  for (const [node, reference] of triggers) {
    let trigger = node;
    const wrapped = node.tagName === "IMG";
    if (wrapped) {
      trigger = document.createElement("a");
      trigger.href = node.getAttribute("src");
      node.replaceWith(trigger);
      trigger.append(node);
    }
    const popup = trigger.getAttribute("aria-haspopup");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.classList.add("wg-gallery-trigger");
    function onClick(event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      void open(reference.group, reference.index, trigger);
    }
    trigger.addEventListener("click", onClick);
    cleanups.push(() => {
      trigger.removeEventListener("click", onClick);
      trigger.classList.remove("wg-gallery-trigger");
      if (popup === null) trigger.removeAttribute("aria-haspopup");
      else trigger.setAttribute("aria-haspopup", popup);
      if (wrapped && trigger.parentNode) trigger.replaceWith(node);
    });
  }

  function onPopState() {
    historyClosing = false;
    const state = history.state?.[HISTORY_KEY];
    if (ownsEntry() && location.href === pageUrl) {
      const group = groups[state.group];
      if (group?.root.isConnected && group.items[state.index])
        void open(group, state.index, lastTrigger, true);
    } else {
      viewer?.galleryCloseLocally();
    }
  }
  window.addEventListener("popstate", onPopState);
  return () => {
    disposed = true;
    window.removeEventListener("popstate", onPopState);
    viewer?.destroy();
    if (ownsEntry()) replaceHistory(null);
    cleanups.forEach((cleanup) => cleanup());
    sizes.clear();
  };
}
