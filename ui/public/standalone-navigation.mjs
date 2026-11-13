const HISTORY_KEY = "waveygistNavigation";
const TRANSFER_KEY = "waveygist:navigation-transfer";
const RAW_PATH = /^\/[A-Za-z0-9]{16,64}(?:\/revisions\/[1-9][0-9]*)?\/raw(?:\/[^/]+)?\/?$/;

export function isStandaloneDisplay() {
  return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
}

// Share navigation behavior between Next's reader and the static offline shell.
// Never infer a safe destination from history.length: it may be another site.
export function installStandaloneNavigation(onChange) {
  if (!isStandaloneDisplay()) return null;
  let lastHref = null;
  let pendingTransfer = null;

  function takeTransfer() {
    try {
      const value = JSON.parse(sessionStorage.getItem(TRANSFER_KEY) || "null");
      sessionStorage.removeItem(TRANSFER_KEY);
      return value && value.to === location.href && new URL(value.from).origin === location.origin &&
        Date.now() - value.time < 60_000 && history.length > 1;
    } catch {
      return false;
    }
  }

  function sync(kind = "route") {
    const saved = history.state?.[HISTORY_KEY];
    const transferred = lastHref === null ? takeTransfer() : false;
    const canGoBack = saved?.href === location.href
      ? saved.canGoBack === true
      : kind !== "pop" && (transferred || (lastHref !== null && lastHref !== location.href));
    // Preserve Next's router state and the gallery's history state.
    history.replaceState({
      ...history.state,
      [HISTORY_KEY]: { href: location.href, canGoBack }
    }, "");
    lastHref = location.href;
    pendingTransfer = null;
    onChange({ canGoBack, isHome: location.pathname === "/" });
  }

  function handlePageHide() {
    if (!pendingTransfer) return;
    try {
      // Only persist an actual document departure. Cancelled clicks and SPA
      // transitions must not leave a stale transfer behind. Referrers are
      // intentionally disabled throughout the app.
      sessionStorage.setItem(TRANSFER_KEY, JSON.stringify(pendingTransfer));
    } catch { /* Direct entries still have a safe home destination. */ }
  }

  function handleClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.altKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;

    if (RAW_PATH.test(url.pathname) || url.pathname === "/me/raw") {
      // Keep this a native, user-activated link. A raw response cannot render
      // app controls; a separate browsing context leaves the reader underneath.
      anchor.target = "_blank";
      anchor.relList.add("noopener");
      return;
    }
    if (url.pathname === location.pathname && url.search === location.search) return;
    pendingTransfer = { from: location.href, to: url.href, time: Date.now() };
  }

  const handlePop = () => sync("pop");
  const handlePageShow = () => sync("pop");
  document.addEventListener("click", handleClick, true);
  window.addEventListener("popstate", handlePop);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("pagehide", handlePageHide);
  sync();

  return {
    sync,
    back(goHome) {
      const saved = history.state?.[HISTORY_KEY];
      if (saved?.href === location.href && saved.canGoBack && history.length > 1) {
        history.back();
      } else {
        goHome();
      }
    },
    dispose() {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePop);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
    }
  };
}
