import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function pull(page: Page, selector: string, distances = [{ x: 0, y: 100 }]) {
  await page.locator(selector).first().evaluate((target, points) => {
    const rect = target.getBoundingClientRect();
    const x = rect.x + 15, y = rect.y + 10;
    function touch(type: string, dx: number, dy: number) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ identifier: 0, clientX: x + dx, clientY: y + dy }] });
      target.dispatchEvent(event);
    }
    touch("touchstart", 0, 0);
    points.forEach(({ x, y }) => touch("touchmove", x, y));
    touch("touchend", 0, 0);
  }, distances);
}

function listPayload(title: string) {
  return {
    query: null,
    gists: [{ id: "GalleryAudio0001", url: "/GalleryAudio0001", title, display_title: title,
      author_name: "Field Notes", revision_number: 1, file_count: 1,
      created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-12T12:00:00Z" }],
    pagination: { limit: 20, offset: 0, total: 1, next_offset: null },
    stats: { gist_count: 1, revision_count: 1, last_updated_at: null }
  };
}

test("ordinary browser tabs keep their native refresh behavior", async ({ page }) => {
  await page.goto("/GalleryReading01");
  await expect(page.locator(".markdown-body")).toBeVisible();
  await expect(page.locator(".pull-refresh")).toHaveCount(0);
});

test.describe("installed app", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
      (window as unknown as { documentToken: number }).documentToken = Math.random();
    });
  });

  test("pulling a linked library row refreshes data without navigation or losing search", async ({ page, context }) => {
    await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
    let title = "Notes before refresh";
    let reads = 0;
    await page.route("**/api/me/gists?*", (route) => { reads++; return route.fulfill({ json: listPayload(title) }); });
    await page.route("**/api/me/listen-queue", (route) => route.fulfill({ json: { items: [] } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("searchbox").fill("Notes");
    await expect(page.locator(".library-link")).toContainText(title);
    const before = reads;
    const token = await page.evaluate(() => (window as unknown as { documentToken: number }).documentToken);
    title = "Notes after refresh";
    await pull(page, ".library-link");
    await expect(page.locator(".library-link")).toContainText(title);
    await expect(page.getByRole("searchbox")).toHaveValue("Notes");
    await expect(page).toHaveURL("/");
    expect(reads).toBe(before + 1);
    expect(await page.evaluate(() => (window as unknown as { documentToken: number }).documentToken)).toBe(token);
    await expect(page.locator(".pull-refresh [role=status]")).toHaveText("Updated");
    await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "idle");
  });

  test("short, reversed, horizontal, nested-table and mid-page gestures do not refresh", async ({ page }) => {
    await page.goto("/GalleryReading01");
    await expect(page.locator(".pull-refresh")).toHaveCount(1);
    let reads = 0;
    await page.route("**/api/gists/*/revisions/*/render", async (route) => { reads++; await route.continue(); });
    await pull(page, ".markdown-body", [{ x: 0, y: 25 }]);
    await pull(page, ".markdown-body", [{ x: 0, y: 100 }, { x: 0, y: 30 }]);
    await pull(page, ".markdown-body", [{ x: 100, y: 20 }]);
    await pull(page, ".table-scroll");
    await page.evaluate(() => scrollTo(0, 200));
    await pull(page, ".markdown-body");
    await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "idle");
    expect(reads).toBe(0);
  });

  test("a failed refresh keeps the article and settles instead of blanking the page", async ({ page }) => {
    await page.goto("/GalleryReading01");
    await expect(page.locator(".markdown-body")).toBeVisible();
    await page.route("**/api/gists/*/revisions/*/render", (route) => route.abort());
    await pull(page, ".markdown-body");
    await expect(page.locator(".pull-refresh [role=status]")).toContainText("Couldn’t refresh");
    await expect(page.locator(".markdown-body")).toBeVisible();
    await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "idle");
  });

  test("gist refresh finishes without a document reload and preserves a pinned revision", async ({ page }) => {
    await page.goto("/GalleryReading01/revisions/1");
    await expect(page.locator(".markdown-body")).toBeVisible();
    const token = await page.evaluate(() => (window as unknown as { documentToken: number }).documentToken);
    await pull(page, ".markdown-body");
    await expect(page.locator(".pull-refresh [role=status]")).toHaveText("Updated");
    await expect(page).toHaveURL("/GalleryReading01/revisions/1");
    expect(await page.evaluate(() => (window as unknown as { documentToken: number }).documentToken)).toBe(token);
  });

  test("only one refresh runs while a request is pending, and navigation cancels it", async ({ page }) => {
    await page.goto("/GalleryReading01");
    await expect(page.locator(".markdown-body")).toBeVisible();
    let reads = 0;
    await page.route("**/api/gists/*/revisions/*/render", async (route) => {
      reads++;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue().catch(() => {});
    });
    await pull(page, ".markdown-body");
    await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "refreshing");
    await pull(page, ".markdown-body");
    await expect.poll(() => reads).toBe(1);
    await page.getByRole("link", { name: "waveygist home" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "idle");
  });

  test("settings refresh is keyboard accessible", async ({ page, context }) => {
    await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
    await page.goto("/me");
    const refresh = page.getByRole("button", { name: "Refresh this page" });
    await refresh.focus();
    await refresh.press("Enter");
    await expect(page.locator(".pull-refresh [role=status]")).toHaveText("Updated");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
