import { test, expect } from "@playwright/test";
import http from "node:http";

test("an existing downloaded article repairs duplicate table wrappers while offline", async ({ page, context, browserName }) => {
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/GalleryReading01`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open("waveygist-content-v1");
      return (await cache.keys()).some((request) => request.url.includes("GalleryReading01"));
    })).toBe(true);
    await page.evaluate(async () => {
      const cache = await caches.open("waveygist-content-v1");
      const key = (await cache.keys()).find((request) => request.url.includes("GalleryReading01"))!;
      const payload = await (await cache.match(key))!.json();
      // Reproduce the saved markup from the design refresh, inside the backend's
      // existing labelled region. The migration must not need a server refresh.
      payload.files["README.md"].rendered_html = payload.files["README.md"].rendered_html
        .replace(/<table(?=[\s>])/gi, '<div class="table-scroll"><table')
        .replace(/<\/table>/gi, "</table></div>");
      await cache.put(key, new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" }
      }));
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("waveygist-offline", 1);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("settings", "readwrite");
        transaction.objectStore("settings").delete("migration:table-scroll:1");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (browserName !== "webkit") await context.setOffline(true);
    await page.reload();
    await expect(page.locator("body.offline-shell")).toBeVisible();
    await expect(page.locator(".table-scroll")).toHaveCount(1);
    const table = page.getByRole("region", { name: "Table (scroll horizontally for more columns)" });
    await table.scrollIntoViewIfNeeded();
    await table.focus();
    await page.keyboard.press("ArrowRight", { delay: 50 });
    await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(async () => {
      const cache = await caches.open("waveygist-content-v1");
      const key = (await cache.keys()).find((request) => request.url.includes("GalleryReading01"))!;
      const payload = await (await cache.match(key))!.json();
      return (payload.files["README.md"].rendered_html.match(/class="table-scroll"/g) ?? []).length;
    })).toBe(1);
    await page.reload();
    await expect(page.locator(".table-scroll")).toHaveCount(1);
  } finally {
    proxy.closeAllConnections();
    proxy.close();
    await context.setOffline(false);
  }
});
