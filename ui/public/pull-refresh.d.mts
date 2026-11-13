export function mountPullRefresh(
  refresh: (signal: AbortSignal) => Promise<string | void>,
  enabled?: () => boolean
): () => void;
