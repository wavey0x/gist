import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const id = "GalleryAudio0001";

test.use({ serviceWorkers: "block", hasTouch: true });

async function seedRecent(page: Page) {
  await page.goto("/");
  await page.evaluate((gistId) => {
    localStorage.setItem("waveygist:recently-viewed:v1", JSON.stringify([
      {
        id: gistId, title: "Long read", author_name: "Field Notes",
        revision_number: 3, viewed_at: new Date().toISOString()
      },
      {
        id: "OtherGist0000001", title: "Second read", author_name: "Field Notes",
        revision_number: 1, viewed_at: new Date(Date.now() - 60_000).toISOString()
      }
    ]));
  }, id);
  await page.reload();
}

async function swipe(context: BrowserContext, page: Page, from: number, to: number, y: number) {
  const cdp = await context.newCDPSession(page);
  const send = (type: string, x?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type: type as "touchStart",
      touchPoints: x === undefined ? [] : [{ x, y }]
    });
  await send("touchStart", from);
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await send("touchMove", from + ((to - from) * step) / steps);
    await page.waitForTimeout(16);
  }
  // Hold still, so the release is judged on distance and not on speed.
  await page.waitForTimeout(120);
  await send("touchEnd");
}

function offsetOf(page: Page) {
  return page.locator(".library-item").first().locator(".swipe-row-content").evaluate(
    (node) => new DOMMatrix(getComputedStyle(node).transform).m41
  );
}

for (const width of [1280, 390]) {
  test(`a library row keeps author and date together under the title at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedRecent(page);
    const row = page.getByRole("region", { name: "Library" }).locator(".library-link").first();
    const title = (await row.locator(".library-title").boundingBox())!;
    const avatar = (await row.locator(".library-avatar").boundingBox())!;
    const name = (await row.locator(".library-byline-name").boundingBox())!;
    const time = (await row.locator("time").boundingBox())!;
    await expect(row.locator(".library-byline-name")).toHaveText("Field Notes");
    expect(avatar.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(Math.abs(avatar.x - title.x)).toBeLessThan(2);
    // The date follows the author directly instead of sitting at the far edge.
    expect(time.x).toBeGreaterThan(name.x + name.width);
    expect(time.x - (name.x + name.width)).toBeLessThan(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("my gists show the author avatar too", async ({ page, context }) => {
  await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
  await page.route("**/api/me/gists?*", (route) => route.fulfill({ json: {
    query: null,
    gists: [{
      id, url: `/${id}`, title: "Mine", display_title: "Mine",
      author_name: "Review Agent", revision_number: 2, file_count: 1,
      created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-12T12:00:00Z"
    }],
    pagination: { limit: 20, offset: 0, total: 1, next_offset: null },
    stats: { gist_count: 1, revision_count: 2, last_updated_at: "2026-11-12T12:00:00Z" }
  } }));
  await page.goto("/");
  await page.locator(".library-search-toggle").click();
  await page.getByRole("button", { name: "Created" }).click();
  const row = page.locator(".library-link").first();
  await expect(row.locator(".library-avatar")).toBeVisible();
  await expect(row.locator(".library-byline-name")).toHaveText("Review Agent");
});

test("swiping a row reveals Remove and waits for a tap to confirm", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Touch is driven through CDP, which only Chromium has");
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRecent(page);
  const library = page.getByRole("region", { name: "Library" });
  const item = library.locator(".library-item").first();
  const box = (await item.boundingBox())!;
  const y = box.y + box.height / 2;
  const action = item.locator(".swipe-row-action");
  await expect(action).toBeHidden();

  // A long swipe opens the row but removes nothing.
  await swipe(context, page, 340, 60, y);
  await expect(action).toBeVisible();
  await expect.poll(() => offsetOf(page)).toBe(-88);
  await expect(library.locator(".library-item")).toHaveCount(2);

  // Tapping the row itself puts it away and does not open the gist.
  await page.touchscreen.tap(100, y);
  await expect.poll(() => offsetOf(page)).toBe(0);
  await expect(action).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(library.locator(".library-item")).toHaveCount(2);

  // A short swipe springs back.
  await swipe(context, page, 340, 310, y);
  await expect.poll(() => offsetOf(page)).toBe(0);

  // Swipe, then tap Remove: only now is the row removed.
  await swipe(context, page, 340, 200, y);
  await expect(action).toBeVisible();
  await page.touchscreen.tap(box.x + box.width - 40, y);
  await expect(library.locator(".library-item")).toHaveCount(1);
  await expect(library.getByRole("link", { name: /Long read/ })).toHaveCount(0);
});

test("an open row closes when another part of the page is touched", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Touch is driven through CDP, which only Chromium has");
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRecent(page);
  const item = page.getByRole("region", { name: "Library" }).locator(".library-item").first();
  const box = (await item.boundingBox())!;
  await swipe(context, page, 340, 150, box.y + box.height / 2);
  await expect.poll(() => offsetOf(page)).toBe(-88);
  await page.touchscreen.tap(195, 20);
  await expect.poll(() => offsetOf(page)).toBe(0);
});
