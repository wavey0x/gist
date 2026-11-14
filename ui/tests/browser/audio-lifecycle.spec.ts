import { test, expect, type Page, type Route } from "@playwright/test";

const id = "GalleryAudio0001";
const endpoint = `/api/gists/${id}/revisions/1/narration`;
const ready = { status: "ready", retryable: false, audio_url: `${endpoint}/audio` };
// Long enough to exercise real ten-second seeks in the browser's media engine.
const audio = Buffer.alloc(44 + 8000 * 40 * 2);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);

// Match production byte-range responses so streaming audio is seekable too.
async function fulfillAudio(route: Route) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
  await route.fulfill({
    status: range ? 206 : 200,
    contentType: "audio/wav",
    headers: {
      "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${end}/${audio.length}` } : {})
    },
    body: audio.subarray(start, end + 1)
  });
}

type Controls = typeof window & {
  testMediaActions: Record<string, MediaSessionActionHandler | null>;
};

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page, context }) => {
  await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
  await page.route("**/api/me/offline-manifest", route => route.fulfill({ json: {
    account_marker: "c".repeat(64), generated_at: new Date().toISOString(), gists: []
  } }));
  await page.route(`**${endpoint}`, route => route.fulfill({ json: ready }));
  await page.route("**/narration/audio", fulfillAudio);
  await page.addInitScript(() => {
    const actions: Controls["testMediaActions"] = {};
    (window as Controls).testMediaActions = actions;
    const proto = Object.getPrototypeOf(navigator.mediaSession);
    const original = proto.setActionHandler;
    proto.setActionHandler = function(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
      actions[action] = handler;
      original.call(this, action, handler);
    };
  });
});

async function start(page: Page) {
  await page.goto(`/${id}`);
  await page.getByRole("button", { name: "Play article audio" }).click();
  await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(3);
  await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
}

async function action(page: Page, action: MediaSessionAction, extra = {}) {
  await page.evaluate(({ action, extra }) => {
    const handler = (window as Controls).testMediaActions[action];
    if (!handler) throw new Error(`Missing media action: ${action}`);
    handler({ action, ...extra });
  }, { action, extra });
}

test("PWA refresh keeps the recording playing and offers a new revision without replacing narrated text", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await start(page);
  const element = page.locator("audio");
  await element.evaluate((audio: HTMLAudioElement) => {
    audio.dataset.refreshIdentity = "original";
    audio.currentTime = 12;
    audio.playbackRate = 1.5;
  });
  const before = await element.evaluate((audio: HTMLAudioElement) => audio.currentTime);
  const refresh = page.getByRole("button", { name: "Refresh this page" });
  await refresh.focus();
  await refresh.press("Enter");
  await expect(page.getByRole("button", { name: "View updated gist" })).toBeVisible();
  await expect(page.locator(".pull-refresh [role=status]")).toHaveText("New revision available");
  await expect(element).toHaveAttribute("data-refresh-identity", "original");
  expect(await element.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  expect(await element.evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(1.5);
  expect(await element.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(before);
  // No new revision: the server refresh merges without replacing the audio node.
  await page.route(`**/api/gists/${id}/revisions/1/render`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.latest_revision_number = 1;
    await route.fulfill({ json: payload });
  });
  await refresh.press("Enter");
  await expect(page.locator(".pull-refresh [role=status]")).toHaveText("Updated");
  await expect(element).toHaveAttribute("data-refresh-identity", "original");
  expect(await element.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
});

test("the mini-player and lock-screen actions seek by ten seconds without a Next button", async ({ page }) => {
  await start(page);
  const element = page.locator("audio");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(3);
  await action(page, "pause");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await action(page, "seekto", { seekTime: 15 });
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(15, 1);
  await page.locator(".app-brand").click();
  const mini = page.getByRole("complementary", { name: "Now playing" });
  await expect(mini).toBeVisible();
  await expect(mini.getByRole("button", { name: "Play next article" })).toHaveCount(0);
  await mini.getByRole("button", { name: "Skip forward 10 seconds" }).click();
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(25, 1);
  await mini.getByRole("button", { name: "Skip back 10 seconds" }).click();
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(15, 1);
  await action(page, "seekbackward");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(5, 1);
  await action(page, "seekbackward");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBe(0);
  await action(page, "seekforward");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(10, 1);
  expect(await page.evaluate(() => {
    const actions = (window as Controls).testMediaActions;
    return [actions.previoustrack, actions.nexttrack, navigator.mediaSession.playbackState];
  })).toEqual([null, null, "paused"]);
  await action(page, "play");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  await mini.getByRole("button", { name: "Close audio player" }).click();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
});

for (const close of [false, true]) {
  test(`a delayed local copy respects ${close ? "closing" : "pausing"} playback`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let downloading = false;
    await page.route(`**${endpoint}/audio`, async route => {
      if (route.request().resourceType() === "fetch") {
        downloading = true;
        await gate;
      }
      await fulfillAudio(route);
    });
    try {
      await start(page);
      await expect.poll(() => downloading).toBe(true);
      const element = page.locator("audio");
      await action(page, "seekto", { seekTime: 15 });
      if (close) await page.getByRole("button", { name: "Hide article audio player" }).click();
      else await page.getByRole("button", { name: "Pause article audio" }).click();
      release();
      await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
      await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThan(0);
      expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
      expect(await element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(15, 0);
      const position = await page.evaluate(gistId => JSON.parse(localStorage.getItem(`waveygist:audio-position:v1:${gistId}:1`)!).position, id);
      expect(position).toBeCloseTo(15, 0);
      expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe(close ? "none" : "paused");
    } finally { release(); }
  });
}

test("backgrounding a healthy stream does not replace its source when the local copy arrives", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let downloading = false;
  let createdLocal = false;
  await page.exposeFunction("localCopyCreated", () => { createdLocal = true; });
  await page.addInitScript(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => {
      void (window as unknown as { localCopyCreated(): void }).localCopyCreated();
      return original(blob);
    };
  });
  await page.route(`**${endpoint}/audio`, async route => {
    if (route.request().resourceType() === "fetch") { downloading = true; await gate; }
    await fulfillAudio(route);
  });
  try {
    await start(page);
    await expect.poll(() => downloading).toBe(true);
    const element = page.locator("audio");
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(3);
    const source = await element.evaluate((node: HTMLAudioElement) => node.currentSrc);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    release();
    await expect.poll(() => createdLocal).toBe(true);
    expect(await element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toBe(source);
    expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await action(page, "pause");
    expect(await element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toBe(source);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
    expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  } finally { release(); }
});


test("pausing during loading cancels the pending play request", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${endpoint}/audio`, async route => {
    await gate;
    await fulfillAudio(route);
  });
  try {
    await page.goto(`/${id}`);
    await page.getByRole("button", { name: "Play article audio" }).click();
    const pause = page.getByRole("button", { name: "Pause article audio" });
    await expect(pause).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loading audio…" })).toBeVisible();
    await pause.click();
    release();
    const element = page.locator("audio");
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThan(0);
    expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
    await expect(page.getByRole("button", { name: "Play article audio", exact: true })).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  } finally { release(); }
});

test("the next recording is ready before the current one ends in the background", async ({ page }) => {
  const nextId = "QueueNextAudio01";
  const entries = [id, nextId].map((gistId, index) => ({
    gist_id: gistId, title: index ? "Next recording" : "First recording", author_name: "Field Notes",
    latest_revision_number: 1, revision_number: 1, status: "ready", duration_ms: 40000,
    audio_url: `/api/gists/${gistId}/revisions/1/narration/audio`, updating: false,
    added_at: "2026-11-13T12:00:00Z"
  }));
  let items = [...entries];
  await page.route("**/api/me/listen-queue", async route => {
    if (route.request().method() === "PUT") {
      items = route.request().postDataJSON().gist_ids.map((gistId: string) => entries.find(item => item.gist_id === gistId));
    }
    await route.fulfill({ json: { items } });
  });
  let nextDownloads = 0;
  let nextStreams = 0;
  await page.route(`**/api/gists/${nextId}/revisions/1/narration/audio`, async route => {
    if (route.request().resourceType() === "fetch") nextDownloads++;
    else nextStreams++;
    await fulfillAudio(route);
  });
  let prepared = false;
  await page.exposeFunction("nextRecordingPrepared", () => { prepared = true; });
  await page.addInitScript(nextId => {
    const original = Response.prototype.blob;
    Response.prototype.blob = async function() {
      const result = await original.call(this);
      if (this.url.includes(nextId)) {
        void (window as unknown as { nextRecordingPrepared(): void }).nextRecordingPrepared();
      }
      return result;
    };
  }, nextId);
  await start(page);
  await expect.poll(() => prepared).toBe(true);
  expect(nextDownloads).toBe(1);
  const element = page.locator("audio");
  const firstSource = await element.evaluate((node: HTMLAudioElement) => node.currentSrc);
  // All later audio requests fail: auto-advance must use the already prepared body.
  await page.route("**/narration/audio", route => route.abort("internetdisconnected"));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await action(page, "seekto", { seekTime: 39.5 });
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Next recording");
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).not.toBe(firstSource);
  expect(await element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
  await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
  expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  expect(nextStreams).toBe(0);
});

test("a dropped stream retries at the same position, and pause cancels recovery", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${endpoint}/audio`, async route => {
    if (route.request().resourceType() === "fetch") await gate;
    await fulfillAudio(route);
  });
  try {
    await start(page);
    await action(page, "seekto", { seekTime: 12 });
    await page.clock.install();
    // Inject the native error event sequence while retaining real media loading,
    // position restoration and play promises for the retry itself.
    await page.evaluate(() => {
      const audio = document.querySelector("audio")!;
      const originalLoad = audio.load.bind(audio);
      let failed = false;
      Object.defineProperty(audio, "error", { get: () => failed ? { code: 2 } : null });
      audio.load = () => { failed = false; originalLoad(); };
      Object.assign(window, { dropAudio: () => {
        failed = true;
        audio.pause();
        audio.dispatchEvent(new Event("error"));
      } });
    });
    const drop = () => page.evaluate(() => (window as unknown as { dropAudio(): void }).dropAudio());
    await drop();
    await expect(page.getByText("Connection lost. Reconnecting…", { exact: true })).toBeVisible();
    await page.clock.runFor(2100);
    const element = page.locator("audio");
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole("button", { name: "Pause article audio" })).toHaveAttribute("aria-busy", "false");
    await drop();
    await page.getByRole("button", { name: "Pause article audio" }).click();
    await page.clock.runFor(5000);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  } finally { release(); }
});

test("the mini-player timeline supports touch, dragging and keyboard seeking without changing play state", async ({ page, isMobile }, testInfo) => {
  await start(page);
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(3);
  await action(page, "pause");
  await page.locator(".app-brand").click();
  const mini = page.getByRole("complementary", { name: "Now playing" });
  const slider = mini.getByRole("slider", { name: "Article audio position" });
  await expect(slider).toBeEnabled();
  await expect(mini).not.toContainText("up next");
  const box = (await slider.boundingBox())!;
  const controls = (await mini.locator(".mini-player-transport").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(controls.y + controls.height);
  expect(box.height).toBeGreaterThanOrEqual(24);
  const y = box.y + box.height / 2;
  if (isMobile) await page.touchscreen.tap(box.x + box.width * 0.75, y);
  else await page.mouse.click(box.x + box.width * 0.75, y);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(29);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeLessThan(31);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  const storedPosition = () => page.evaluate(gistId => JSON.parse(localStorage.getItem(`waveygist:audio-position:v1:${gistId}:1`) ?? "null")?.position, id);
  // Seek away from the end-of-article bookmark clearing threshold.
  if (isMobile) await page.touchscreen.tap(box.x + box.width * 0.25, y);
  else {
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, y, { steps: 10 });
    await page.mouse.up();
  }
  await expect.poll(storedPosition).toBeGreaterThan(9);
  await expect.poll(storedPosition).toBeLessThan(11);
  await slider.press("Home");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBe(0);
  await slider.press("ArrowRight");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(0.1, 1);
  await expect(slider).toHaveAttribute("aria-valuetext", "0:00 of 0:40");
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await mini.getByRole("button", { name: "Play article audio" }).click();
  if (isMobile) await page.touchscreen.tap(box.x + box.width * 0.5, y);
  else await page.mouse.click(box.x + box.width * 0.5, y);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(20);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  await mini.getByRole("button", { name: "Pause article audio" }).click();
  await mini.screenshot({ path: testInfo.outputPath("mini-player-scrubber.png") });
});

test("the narrow mini-player keeps timing readable and transport controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await start(page);
  await action(page, "pause");
  await page.locator(".app-brand").click();
  const player = page.getByRole("complementary", { name: "Now playing" });
  await expect(player.locator(".mini-player-meta")).toContainText(" / ");
  expect(await player.locator(".mini-player-meta").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const title = (await player.locator(".mini-player-title").boundingBox())!;
  const transport = (await player.locator(".mini-player-transport").boundingBox())!;
  expect(title.y + title.height).toBeLessThanOrEqual(transport.y);
  const skip = player.getByRole("button", { name: "Skip forward 10 seconds" });
  const box = (await skip.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await skip.click();
  await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(10);
});

test("mini-player speed stays in sync with the article player and survives reopening from the playlist", async ({ page }, testInfo) => {
  await start(page);
  await action(page, "pause");
  const audio = page.locator("audio");
  await page.locator(".app-brand").click();
  const mini = page.getByRole("complementary", { name: "Now playing" });
  const speed = mini.getByRole("combobox", { name: "Playback speed" });
  await expect(speed).toHaveValue("1");
  await speed.selectOption("1.5");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.playbackRate)).toBe(1.5);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("waveygist:audio-rate:v1"))).toBe("1.5");
  await mini.getByRole("link").click();
  await page.getByRole("button", { name: "Playback speed 1.5×" }).click();
  await page.getByRole("group", { name: "Playback speed", exact: true }).getByRole("button", { name: "1.25×", exact: true }).click();
  await page.locator(".app-brand").click();
  await expect(speed).toHaveValue("1.25");
  await mini.getByRole("button", { name: "Play article audio" }).click();
  await speed.selectOption("1.75");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.playbackRate)).toBe(1.75);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  await mini.getByRole("button", { name: "Pause article audio" }).click();
  await mini.screenshot({ path: testInfo.outputPath("mini-player-speed.png") });
  // Start directly from the home playlist after a reload, without mounting an article player.
  await page.route("**/api/me/listen-queue", route => route.fulfill({ json: { items: [{
    gist_id: id, title: "Saved recording", author_name: "Field Notes", latest_revision_number: 1,
    revision_number: 1, status: "ready", duration_ms: 40000, audio_url: `${endpoint}/audio`,
    updating: false, added_at: "2026-11-13T12:00:00Z"
  }] } }));
  await page.reload();
  await page.getByRole("button", { name: "Play Saved recording", exact: true }).click();
  await expect(speed).toHaveValue("1.75");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.playbackRate)).toBe(1.75);
});

test("a stream that drops while hidden switches to the downloaded copy instead of waiting", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let downloaded = false;
  await page.route(`**${endpoint}/audio`, async route => {
    if (route.request().resourceType() === "fetch") { await gate; downloaded = true; }
    await fulfillAudio(route);
  });
  try {
    await start(page);
    await action(page, "seekto", { seekTime: 12 });
    const element = page.locator("audio");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      const audio = document.querySelector("audio")!;
      let failed = false;
      Object.defineProperty(audio, "error", { get: () => failed ? { code: 2 } : null });
      const originalLoad = audio.load.bind(audio);
      audio.load = () => { failed = false; originalLoad(); };
      Object.assign(window, { dropAudio: () => {
        failed = true;
        audio.pause();
        audio.dispatchEvent(new Event("error"));
      } });
    });
    release();
    await expect.poll(() => downloaded).toBe(true);
    // The healthy hidden stream keeps its source until it fails.
    expect(await element.evaluate((node: HTMLAudioElement) => node.currentSrc)).not.toMatch(/^blob:/);
    await page.evaluate(() => (window as unknown as { dropAudio(): void }).dropAudio());
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(12);
    await expect(page.getByText("Connection lost. Reconnecting…", { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("the raw view keeps the audio control and leaves playback running", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "View raw file" }).click();
  await expect(page.locator(".raw-viewer pre.code-lines")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide article audio player" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View revision history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Table of contents" })).toHaveCount(0);
  const before = await page.locator("audio").evaluate((node: HTMLAudioElement) => node.currentTime);
  await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "View rendered file" }).click();
  await expect(page.getByRole("button", { name: "Hide article audio player" })).toBeVisible();
});

test("the player has a close button that clears it and stops playback", async ({ page }) => {
  await start(page);
  const player = page.getByRole("group", { name: "Article audio player" });
  // Close sits at the trailing edge, clear of the speed control.
  const close = (await player.getByRole("button", { name: "Close audio player" }).boundingBox())!;
  const speed = (await player.getByRole("button", { name: /Playback speed/ }).boundingBox())!;
  const frame = (await player.boundingBox())!;
  expect(frame.x + frame.width - (close.x + close.width)).toBeLessThan(16);
  expect(speed.x + speed.width).toBeLessThan(close.x);
  await player.getByRole("button", { name: "Close audio player" }).click();
  await expect(player).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play article audio", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll("audio")).every((node) => node.paused))).toBe(true);
});

test("the diff view keeps the audio control", async ({ page }) => {
  await page.route("**/narration", route => route.fulfill({ json: ready }));
  await page.goto(`/${id}/diff/1..2`);
  await expect(page.locator(".diff-viewer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play article audio", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View revision history" })).toBeVisible();
});

test("recovery keeps trying when the first reload also fails, then resumes at the same position", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${endpoint}/audio`, async route => {
    if (route.request().resourceType() === "fetch") await gate;
    await fulfillAudio(route);
  });
  try {
    await start(page);
    await action(page, "seekto", { seekTime: 12 });
    await page.clock.install();
    // The stream drops with a network error. While the connection is still
    // down, each reload fails the way browsers report it: source not supported.
    await page.evaluate(() => {
      const audio = document.querySelector("audio")!;
      const originalLoad = audio.load.bind(audio);
      const originalPlay = audio.play.bind(audio);
      let code = 0;
      let failingReloads = 2;
      Object.defineProperty(audio, "error", { get: () => code ? { code } : null });
      audio.load = () => {
        if (failingReloads > 0) {
          failingReloads--;
          code = 4;
          return;
        }
        code = 0;
        originalLoad();
      };
      audio.play = () => code
        ? Promise.reject(new DOMException("No supported source", "NotSupportedError"))
        : originalPlay();
      Object.assign(window, { dropAudio: () => {
        code = 2;
        audio.pause();
        audio.dispatchEvent(new Event("error"));
      } });
    });
    await page.evaluate(() => (window as unknown as { dropAudio(): void }).dropAudio());
    const reconnecting = page.getByText("Connection lost. Reconnecting…", { exact: true });
    await expect(reconnecting).toBeVisible();
    const element = page.locator("audio");
    // First and second retries fail; the player must still be trying, not asking for a tap.
    await page.clock.runFor(2100);
    await expect(reconnecting).toBeVisible();
    await expect(page.getByText(/Tap play to retry/)).toHaveCount(0);
    await page.clock.runFor(4100);
    await expect(reconnecting).toBeVisible();
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
    // The third retry gets through.
    await page.clock.runFor(8100);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThanOrEqual(12);
    await expect(reconnecting).toHaveCount(0);
  } finally { release(); }
});

test("a next recording still downloading at handoff is finished, not fetched again", async ({ page }) => {
  const nextId = "QueueNextAudio01";
  const entries = [id, nextId].map((gistId, index) => ({
    gist_id: gistId, title: index ? "Next recording" : "First recording", author_name: "Field Notes",
    latest_revision_number: 1, revision_number: 1, status: "ready", duration_ms: 40000,
    audio_url: `/api/gists/${gistId}/revisions/1/narration/audio`, updating: false,
    added_at: "2026-11-13T12:00:00Z"
  }));
  let items = [...entries];
  await page.route("**/api/me/listen-queue", async route => {
    if (route.request().method() === "PUT") {
      items = route.request().postDataJSON().gist_ids.map((gistId: string) => entries.find(item => item.gist_id === gistId));
    }
    await route.fulfill({ json: { items } });
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let nextDownloads = 0;
  await page.route(`**/api/gists/${nextId}/revisions/1/narration/audio`, async route => {
    if (route.request().resourceType() === "fetch") {
      nextDownloads++;
      await gate;
    }
    await fulfillAudio(route);
  });
  try {
    await start(page);
    await expect.poll(() => nextDownloads).toBe(1);
    // The first recording ends while the next one is still downloading.
    await action(page, "seekto", { seekTime: 39.5 });
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Next recording");
    const element = page.locator("audio");
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
    release();
    // The same download completes and becomes the in-memory copy.
    await expect.poll(() => element.evaluate((node: HTMLAudioElement) => node.currentSrc)).toMatch(/^blob:/);
    expect(nextDownloads).toBe(1);
    expect(await element.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  } finally { release(); }
});
