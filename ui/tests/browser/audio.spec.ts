import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Test the page and real IndexedDB/cache library without interception by a worker.
// Service-worker delivery and offline playback are covered by the offline suite.
test.use({ serviceWorkers: "block" });
const id = "GalleryAudio0001";
const endpoint = `/api/gists/${id}/revisions/1/narration`;
const pending = { status: "pending", retryable: false };
const ready = { status: "ready", retryable: false, audio_url: `${endpoint}/audio` };
const audio = readFileSync(`${__dirname}/../fixtures/silence.mp3`);
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
  await page.route(`**${endpoint}/audio`, (route) => route.fulfill({ contentType: "audio/mpeg", body: audio }));
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
  await expect(page.locator(".article-audio-button svg")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Article audio player" })).toHaveCount(0);
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
  await expect(page.locator(".article-audio-message")).toHaveText("Audio status is unavailable. Try again.");
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
  await expect(page.locator(".article-audio-message")).toHaveText("Audio generation failed. You can retry once.");
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Retry article audio" }).click();
  await expect(page.getByRole("button", { name: "Preparing article audio" })).toBeDisabled();
  await expect(page.getByText("Connection interrupted. Checking again…")).toBeVisible();
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
    await expect(page.locator(".article-audio-button")).toHaveClass(/article-audio-button-ready/);
    await expect(page.locator(".article-audio-button")).not.toHaveAttribute("title", /available offline/);
    download.release();
    await expect(page.getByRole("button", { name: "Play article audio" })).toHaveAttribute("title", /available offline/);
    await expect(page.locator(".article-audio-button svg")).toHaveCount(1);
    await expect(page.locator(".article-audio-spinner")).toHaveCount(0);
    // A server-side failure must not hide a recording already saved here.
    let failedReads = 0;
    await page.route(`**${endpoint}`, (route) => {
      failedReads++;
      return route.fulfill({ json: { status: "failed", retryable: true } });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => failedReads).toBe(1);
    await expect(page.getByRole("button", { name: "Play article audio" })).toBeEnabled();
    // Eviction updates the tooltip without changing the icon or glow.
    await page.evaluate(async (audioUrl) => {
      await (await caches.open("waveygist-audio-v1")).delete(audioUrl);
      window.dispatchEvent(new Event("waveygist:offline-library-changed"));
    }, `${endpoint}/audio`);
    await expect(page.locator(".article-audio-button")).not.toHaveAttribute("title", /available offline/);
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

test("the button moves from blue waiting to green ready and only opens on click", async ({ page }, testInfo) => {
  let requested = false;
  let done = false;
  let posts = 0;
  const initial = gate();
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() === "POST") {
      requested = true;
      posts++;
    }
    await initial.promise;
    await route.fulfill(requested ? { json: done ? ready : pending } : { status: 404, json: {} });
  });
  const button = page.locator(".article-audio-button");
  const player = page.getByRole("group", { name: "Article audio player" });
  try {
    // Even a former notification URL must leave the player closed.
    await page.goto(`/${id}?audio=ready`);
    await expect(button).toHaveAttribute("aria-label", "Checking article audio");
    await expect(button).toHaveCSS("animation-name", "article-audio-wait-pulse");
    await expect(button).toHaveCSS("animation-duration", "2s");
    await expect(button).toBeDisabled();
    const size = await button.boundingBox();
    if (testInfo.project.name === "mobile-webkit") {
      expect(size!.width).toBeGreaterThanOrEqual(44);
      expect(size!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(player).toHaveCount(0);
    initial.release();
    await expect(button).toHaveAttribute("aria-label", "Listen to article");
    await expect(button).toHaveCSS("animation-name", "none");
    await button.focus();
    await expect(button).toHaveCSS("outline-style", "solid");
    await button.press("Enter");
    await expect(button).toHaveAttribute("aria-label", "Preparing article audio");
    await expect(button).toHaveCSS("animation-name", "article-audio-wait-pulse");
    await expect(page.locator(".article-audio-overlay")).toHaveCount(0);
    await expect(page.locator(".article-audio-message")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("audio-waiting.png") });
    done = true;
    await expect(button).toHaveAttribute("aria-label", "Play article audio");
    await expect(button).toHaveClass(/article-audio-button-ready/);
    await expect(button).toHaveCSS("animation-name", "none");
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(player).toHaveCount(0);
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
    const readySize = await button.boundingBox();
    expect(readySize!.width).toBe(size!.width);
    expect(readySize!.height).toBe(size!.height);
    await page.screenshot({ path: testInfo.outputPath("audio-ready.png") });
    // Repeated background checks must not flicker the ready button or open controls.
    await page.evaluate(() => {
      const button = document.querySelector(".article-audio-button")!;
      (window as any).busyAfterReady = false;
      new MutationObserver(() => {
        if (button.getAttribute("aria-busy") === "true") (window as any).busyAfterReady = true;
      }).observe(button, { attributes: true, attributeFilter: ["aria-busy"] });
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    await button.click();
    await expect(player).toBeVisible();
    await expect(button).toHaveClass(/article-audio-button-ready/);
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("audio-player.png") });
    await button.click();
    await expect(player).toHaveCount(0);
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
    expect(await page.evaluate(() => (window as any).busyAfterReady)).toBe(false);
    expect(posts).toBe(1);
    await page.reload();
    await expect(button).toHaveAttribute("aria-label", "Play article audio");
    await expect(player).toHaveCount(0);
  } finally {
    initial.release();
  }
});

test("waiting honors reduced motion and terminal failure keeps a plain speaker", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const initial = gate();
  await page.route(`**${endpoint}`, async (route) => {
    await initial.promise;
    await route.fulfill({ json: { status: "failed", retryable: false } });
  });
  try {
    await page.goto(`/${id}`);
    const button = page.locator(".article-audio-button");
    await expect(page.locator(".article-audio-spinner")).toBeVisible();
    await expect(button).toHaveCSS("animation-name", "none");
    await expect(page.locator(".article-audio-spinner")).toHaveCSS("animation-name", "none");
    initial.release();
    await expect(button).toHaveAttribute("aria-label", "Article audio unavailable");
    await expect(button).toBeDisabled();
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button).not.toHaveClass(/article-audio-button-ready/);
    await expect(page.locator(".article-audio-message")).toHaveText("Audio generation failed.");
  } finally {
    initial.release();
  }
});
