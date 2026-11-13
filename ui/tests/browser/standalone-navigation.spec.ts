import { test, expect } from "@playwright/test";
import http from "node:http";

const id = "GalleryRawFiles01";
const rawPath = `/${id}/revisions/1/raw/data%20sample.json`;
const rawText = '{"message":"Raw stays raw"}\n';

test.describe("browser tabs", () => {
  test.use({ serviceWorkers: "block" });

  test("Raw stays in the current tab and the header gets no Back button", async ({ page }) => {
    await page.goto(`/${id}`);
    await expect(page.locator("html")).toHaveAttribute("data-js", "enabled");
    await expect(page.locator(".standalone-back-button")).toHaveCount(0);
    await page.locator('[data-gist-filename="data sample.json"]').getByRole("link", { name: "Raw", exact: true }).click();
    await expect(page).toHaveURL(rawPath);
    expect(await page.locator("body").textContent()).toBe(rawText);
    await expect(page.locator(".app-header")).toHaveCount(0);
  });
});

test.describe("installed app navigation", () => {
  test.use({ serviceWorkers: "block" });
  test.beforeEach(async ({ page }) => {
    // Exercises our standalone branch, not iOS's native browser presentation.
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  });

  test("direct entry returns home even with an unrelated history entry", async ({ page }) => {
    await page.goto("http://127.0.0.1:4311/health");
    await page.goto(`/${id}`);
    await page.getByRole("button", { name: "Back to home", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator(".standalone-back-button")).toHaveCount(0);
  });

  test("Back preserves app history across reload and browser forward", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Log in", exact: true }).first().click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.goForward();
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL("/");
  });

  test("Back returns to the previous article's reading position", async ({ page }) => {
    await page.goto("/GalleryAudio0001");
    await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audio article" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1100);
    // Click the already visible sticky header without Playwright scrolling its
    // target into view first, which changes the position we are testing.
    const login = (await page.getByRole("link", { name: "Log in", exact: true }).boundingBox())!;
    await page.mouse.click(login.x + login.width / 2, login.y + login.height / 2);
    await expect(page).toHaveURL("/login");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL("/GalleryAudio0001");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(1200);
    await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
  });

  for (const linkKind of ["file action", "article link"]) {
    test(`Raw ${linkKind} opens separately with exact content and leaves the reader intact`, async ({ page }) => {
      await page.goto(`/${id}/revisions/1`);
      await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
      const link = linkKind === "file action"
        ? page.locator('[data-gist-filename="data sample.json"]').getByRole("link", { name: "Raw", exact: true })
        : page.getByRole("link", { name: "JSON source" });
      const popupPromise = page.waitForEvent("popup");
      await link.click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      await expect(popup).toHaveURL(rawPath);
      expect(await popup.locator("body").textContent()).toBe(rawText);
      expect(await popup.evaluate(() => document.contentType)).toBe("text/plain");
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      await expect(popup.locator(".app-header")).toHaveCount(0);
      await popup.close();
      await expect(page).toHaveURL(`/${id}/revisions/1`);
      await expect(page.getByRole("heading", { name: "Raw files" })).toBeVisible();
    });
  }
});

test("saved files stay raw offline and the offline header can return to the library", async ({ page, context, browserName }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  const proxy = http.createServer((request, response) => {
    const upstream = http.request(`http://127.0.0.1:4310${request.url}`,
      { method: request.method, headers: request.headers }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  try {
    await page.goto(`${origin}/${id}`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(async (gistId) => {
      const cache = await caches.open("waveygist-content-v1");
      return (await cache.keys()).some((request) => request.url.includes(gistId));
    }, id)).toBe(true);
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (browserName !== "webkit") await context.setOffline(true);
    await page.reload();
    await expect(page.locator("body.offline-shell")).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "View raw data sample.json" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(await popup.locator("body").textContent()).toBe(rawText);
    expect(await popup.evaluate(() => document.contentType)).toBe("text/plain");
    await popup.close();
    await page.getByRole("button", { name: "Back to home" }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.locator(".standalone-back-button")).toBeHidden();
    await page.locator(".library-link").first().click();
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
  } finally {
    proxy.closeAllConnections();
    proxy.close();
    await context.setOffline(false);
  }
});
