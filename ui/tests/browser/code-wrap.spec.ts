import { expect, test } from "@playwright/test";
import http from "node:http";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

async function codeOverflows(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).first().evaluate((element) =>
    element.scrollWidth > element.clientWidth + 1
  );
}

test("wraps only the selected Markdown code block", async ({ page }) => {
  await page.goto("/GalleryCodeWrap01");
  const blocks = page.locator(".code-wrap-block");
  await expect(blocks).toHaveCount(2);
  const first = blocks.first();
  const second = blocks.nth(1);
  const toggle = first.getByRole("button", { name: "Wrap lines in code block 1" });
  await toggle.focus();
  await expect(toggle).toHaveCSS("opacity", "1");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await codeOverflows(page, ".code-wrap-block .highlight pre")).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(first.locator("pre")).toHaveCSS("white-space", "pre-wrap");
  await expect(second.locator("pre")).toHaveCSS("white-space", "pre");
  expect(await codeOverflows(page, ".code-wrap-block .highlight pre")).toBe(false);

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(first.locator("pre")).toHaveCSS("white-space", "pre");
});

test("shares one file's wrap choice between source and raw views", async ({ page }) => {
  await page.goto("/GalleryCodePatch01");
  const toggle = page.getByRole("button", { name: "Wrap lines in twocrypto-math.patch" });
  await expect(page.locator(".toolbar").getByRole("button", { name: /Wrap/ })).toHaveCount(0);
  await expect(page.locator(".gist-code-content .highlight-source-diff .pl-mi1")).toBeVisible();
  expect(await codeOverflows(page, ".gist-code-view")).toBe(true);
  await toggle.click();
  await expect(page.locator(".gist-code-view")).toHaveAttribute("data-code-wrap", "true");
  await expect(page.locator(".gist-line-numbers")).toBeHidden();
  expect(await codeOverflows(page, ".gist-code-view")).toBe(false);

  await page.getByRole("button", { name: "View raw file" }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".raw-markdown")).toHaveCSS("white-space", "pre-wrap");
  expect(await codeOverflows(page, ".raw-markdown")).toBe(false);

  await toggle.click();
  await expect(page.locator(".raw-markdown")).toHaveCSS("white-space", "pre");
  await page.getByRole("button", { name: "View rendered file" }).click();
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.locator(".gist-code-view")).toHaveAttribute("data-code-wrap", "false");
  await expect(page.locator(".gist-line-numbers")).toBeVisible();
});

test("keeps the source file control in its file header", async ({ page }) => {
  await page.goto("/GalleryCodePanel01");
  const panel = page.locator('[data-gist-filename="twocrypto-math.patch"]');
  const toggle = panel.getByRole("button", { name: "Wrap lines in twocrypto-math.patch" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(panel.locator(".gist-code-view")).toHaveAttribute("data-code-wrap", "true");
  await expect(page.locator(".code-wrap-block pre")).toHaveCSS("white-space", "pre");
  await panel.getByRole("button", { name: "Collapse twocrypto-math.patch" }).click();
  await panel.getByRole("button", { name: "Expand twocrypto-math.patch" }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test.describe("offline reader", () => {
  test.use({ serviceWorkers: "allow" });

  test("keeps patch highlighting and supports local wrapping", async ({ page, context, browserName }) => {
    const proxy = http.createServer((request, response) => {
      const upstream = http.request(
        `http://127.0.0.1:4310${request.url}`,
        { method: request.method, headers: request.headers },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        }
      );
      upstream.on("error", () => response.destroy());
      request.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address() as { port: number };

    try {
      await page.goto(`http://127.0.0.1:${address.port}/GalleryCodePanel01`);
      await expect(page.locator(".gist-code-content .highlight-source-diff .pl-mi1")).toBeVisible();
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open("waveygist-content-v1");
        return (await cache.keys()).some((request) =>
          request.url.endsWith("/api/gists/GalleryCodePanel01/revisions/1/render")
        );
      })).toBe(true);
      const toggle = page.getByRole("button", { name: "Wrap lines in twocrypto-math.patch" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");

      // Model a gist saved before patch files used the diff renderer.
      await page.evaluate(async () => {
        const cache = await caches.open("waveygist-content-v1");
        const request = (await cache.keys()).find((key) =>
          key.url.endsWith("/api/gists/GalleryCodePanel01/revisions/1/render")
        );
        if (!request) throw new Error("Saved gist missing");
        const payload = await (await cache.match(request))?.json();
        if (!payload) throw new Error("Saved gist payload missing");
        payload.files["twocrypto-math.patch"].rendered_html = "<pre>old</pre>";
        await cache.put(request, new Response(JSON.stringify(payload)));
      });
      await page.reload();
      await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open("waveygist-content-v1");
        const response = await cache.match("/api/gists/GalleryCodePanel01/revisions/1/render");
        const payload = await response?.json();
        return payload?.files["twocrypto-math.patch"].rendered_html.includes("highlight-source-diff");
      })).toBe(true);

      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (browserName !== "webkit") await context.setOffline(true);
      await page.reload();
      await expect(page.locator("body.offline-shell")).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".gist-code-content .highlight-source-diff .pl-mi1")).toBeVisible();
      const markdown = page.locator('.gist-file-panel[data-gist-filename="README.md"]');
      const markdownWrap = markdown.getByRole("button", { name: "Wrap lines in code block 1" });
      await markdownWrap.click();
      await expect(markdown.locator(".code-wrap-block pre")).toHaveCSS("white-space", "pre-wrap");
      await expect(page.locator('.gist-file-panel[data-gist-filename="twocrypto-math.patch"] .gist-code-view')).toHaveAttribute("data-code-wrap", "false");
      await toggle.click();
      expect(await codeOverflows(page, ".gist-code-view")).toBe(false);
      await context.setOffline(false);
    } finally {
      proxy.closeAllConnections();
      if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});
