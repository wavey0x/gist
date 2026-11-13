"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { mountPullRefresh } from "../public/pull-refresh.mjs";
import { canRefreshPage, refreshPage } from "../lib/page-refresh";
import { reconcileIfStale } from "../lib/offline-library";

export function PullRefresh() {
  const pathname = usePathname();
  useEffect(() => pathname === "/login" ? undefined : mountPullRefresh(async (signal) => {
    if (navigator.onLine === false) throw new Error("Offline");
    const result = await refreshPage(signal);
    if (!signal.aborted) void reconcileIfStale();
    return result;
  }, canRefreshPage), [pathname]);
  return null;
}
