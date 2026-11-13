"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

type Refresh = (signal: AbortSignal) => Promise<string | void>;
let current: Refresh | null = null;
export const canRefreshPage = () => current !== null;
export const refreshPage: Refresh = (signal) => current?.(signal) ?? Promise.resolve();

export function usePageRefresh(refresh: Refresh) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const handler: Refresh = (signal) => latest.current(signal);
    current = handler;
    return () => { if (current === handler) current = null; };
  }, []);
}

// Next merges fresh server data without remounting the player or client controls.
export function useRefreshRoute() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const completion = useRef<(() => void) | null>(null);
  useEffect(() => { if (!pending) { completion.current?.(); completion.current = null; } }, [pending]);
  useEffect(() => () => { completion.current?.(); }, []);
  return (signal: AbortSignal) => new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    completion.current = resolve;
    startTransition(() => router.refresh());
  });
}

export async function refreshJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not refresh");
  const result: unknown = await response.json();
  signal.throwIfAborted();
  return result;
}
