"use client";

import { refreshJson, usePageRefresh, useRefreshRoute } from "../lib/page-refresh";

export function SettingsRefresh() {
  const refreshRoute = useRefreshRoute();
  usePageRefresh(async (signal) => {
    await refreshJson("/api/me/notification-settings", signal);
    await refreshRoute(signal);
  });
  return null;
}
