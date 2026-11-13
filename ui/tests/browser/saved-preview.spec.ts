import { test, expect, type Locator } from "@playwright/test";

async function geometry(root: Locator) {
  return root.locator(".gist-file-panel, .gist-file-header, article > h1, .gist-code-view").evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    })
  );
}

for (const width of [1280, 390]) {
  test(`saved multi-file content keeps its layout when the live page arrives at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/GalleryLayout001");
    await expect(page.locator("main:not([aria-busy]) .gist-file-panel")).toHaveCount(2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open("waveygist-content-v1");
      if (!(await cache.keys()).some((key) => key.url.includes("GalleryLayout001"))) return false;
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("waveygist-offline", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const saved = await new Promise<boolean>((resolve) => {
        const request = database.transaction("entries").objectStore("entries").get("gist:GalleryLayout001:1");
        request.onsuccess = () => resolve(Boolean(request.result));
      });
      database.close();
      return saved;
    })).toBe(true);

    // A new document clears Next's in-memory route cache while keeping the saved
    // gist. Reopen it from the library with the server response still pending.
    await page.goto("/");
    await page.locator('.library-link[href="/GalleryLayout001"]').click();
    const preview = page.locator('main[aria-busy="true"]');
    await expect(preview.locator(".gist-file-panel")).toHaveCount(2);
    await expect(preview.locator(".gist-single-file")).toHaveCount(0);
    await expect(preview.locator(".gist-file-name")).toHaveText(["README.md", "twocrypto-math.patch"]);
    await expect(preview.locator(".gist-meta time").first()).not.toBeEmpty();
    const before = await geometry(preview);

    const live = page.locator("main:not([aria-busy])");
    await expect(live.locator(".gist-file-panel")).toHaveCount(2);
    await expect(live.locator(".gist-meta time").first()).not.toBeEmpty();
    const after = await geometry(live);
    expect(after).toHaveLength(before.length);
    after.forEach((rect, index) => {
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(rect[key] - before[index][key]), `element ${index} ${key}`).toBeLessThanOrEqual(1);
      }
    });
    await live.getByRole("button", { name: "Collapse twocrypto-math.patch" }).click();
    await expect(live.locator('.gist-file-panel[data-gist-filename="twocrypto-math.patch"]')).toHaveAttribute("data-collapsed", "true");
  });
}
