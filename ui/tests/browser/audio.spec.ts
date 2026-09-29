import { test, expect } from "@playwright/test";

// Test the page and real IndexedDB/cache library without interception by a worker.
// Service-worker delivery and offline playback are covered by the offline suite.
test.use({ serviceWorkers: "block" });
const id = "GalleryAudio0001";
const endpoint = `/api/gists/${id}/revisions/1/narration`;
const pending = { status: "pending", retryable: false };
const ready = { status: "ready", retryable: false, audio_url: `${endpoint}/audio` };
const manifest = (audio = false) => ({
  account_marker: "c".repeat(64),
  generated_at: new Date().toISOString(),
  gists: [{
    id, revision_number: 1, owned: true,
    snapshot_sha256: "a".repeat(64), display_title: "Audio article",
    author_name: "Field Notes", updated_at: "2026-09-02T12:00:00Z",
    narration: audio ? { etag: "d".repeat(64), byte_size: 8 } : null
  }]
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
  await page.route("**/api/me/offline-manifest", (route) => route.fulfill({ json: { ...manifest(), gists: [] } }));
  await page.route(`**${endpoint}/audio`, (route) => route.fulfill({ contentType: "audio/mpeg", body: "ID3-test" }));
});

test("reopening pending audio resumes polling without posting another request", async ({ page }) => {
  let done = false;
  const methods: string[] = [];
  await page.route(`**${endpoint}`, (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: done ? ready : pending });
  });
  await page.goto(`/${id}`);
  await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
  done = true;
  await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
  await expect(page.locator(".article-audio-offline-check")).toHaveCount(0);
  expect(methods.length).toBeGreaterThanOrEqual(3);
  expect(methods.every((method) => method === "GET")).toBe(true);
});

test("unknown status recovers on reconnect without creating audio", async ({ page }) => {
  let available = false;
  let posts = 0;
  await page.route(`**${endpoint}`, (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill(available ? { json: pending } : { status: 503, json: {} });
  });
  await page.goto(`/${id}`);
  await expect(page.getByRole("button", { name: "Check article audio" })).toBeEnabled();
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
  expect(posts).toBe(0);
});

test("failed audio is restored and retries only on an explicit click", async ({ page }) => {
  let posts = 0;
  let reads = 0;
  await page.route(`**${endpoint}`, (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.fulfill({ json: pending });
    }
    reads++;
    if (!posts) return route.fulfill({ json: { status: "failed", retryable: true } });
    if (reads === 2) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: ready });
  });
  await page.goto(`/${id}`);
  await expect(page.getByRole("button", { name: "Retry article audio" })).toBeEnabled();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Retry article audio" }).click();
  await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
  await expect(page.getByText("Audio status is temporarily unavailable. Reconnecting…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
  expect(posts).toBe(1);
});

test("ready during an older sync triggers a fresh manifest and waits for the actual download", async ({ page }) => {
  let done = false;
  let manifests = 0;
  let downloading = false;
  const oldManifest = gate();
  const download = gate();
  await page.route(`**${endpoint}`, (route) => route.fulfill({ json: done ? ready : pending }));
  await page.route("**/api/me/offline-manifest", async (route) => {
    manifests++;
    const first = manifests === 1;
    if (first) await oldManifest.promise;
    await route.fulfill({ json: manifest(!first) });
  });
  await page.route(`**${endpoint}/audio`, async (route) => {
    if (!route.request().headers().range) {
      downloading = true;
      await download.promise;
    }
    await route.fulfill({ contentType: "audio/mpeg", body: "ID3-test" });
  });
  try {
    await page.goto(`/${id}`);
    await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => manifests).toBe(1);
    done = true;
    await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
    oldManifest.release();
    await expect.poll(() => manifests).toBe(2);
    await expect.poll(() => downloading).toBe(true);
    await expect(page.locator(".article-audio-offline-check")).toHaveCount(0);
    download.release();
    await expect(page.locator(".article-audio-offline-check")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Play article audio" })).toHaveAttribute("title", /available offline/);
    // A server-side failure must not hide a recording already saved here.
    let failedReads = 0;
    await page.route(`**${endpoint}`, (route) => {
      failedReads++;
      return route.fulfill({ json: { status: "failed", retryable: true } });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => failedReads).toBe(1);
    await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
    // Eviction removes the offline badge immediately.
    await page.evaluate(async (audioUrl) => {
      await (await caches.open("waveygist-audio-v1")).delete(audioUrl);
      window.dispatchEvent(new Event("waveygist:offline-library-changed"));
    }, `${endpoint}/audio`);
    await expect(page.locator(".article-audio-offline-check")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
    // Once neither device nor server has audio, the next check restores idle.
    await page.route(`**${endpoint}`, (route) => route.fulfill({ status: 404, json: {} }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button", { name: "Listen to article" })).toBeEnabled();
  } finally {
    oldManifest.release();
    download.release();
  }
});
