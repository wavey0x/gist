import { test, expect } from "@playwright/test";
import http from "node:http";

test("saved audio stays closed on offline entry and plays only after a click", async ({ page, context, browserName }) => {
  // Close the origin too: WebKit cannot emulate offline service-worker navigation.
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
  const { port } = proxy.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  try {
    await context.addCookies([{ name: "wg_session", value: "audio-test", url: origin }]);
    await page.goto(`${origin}/GalleryAudioOffline01?audio=ready`);
    const button = page.locator(".article-audio-button");
    const player = page.getByRole("group", { name: "Article audio player" });
    await expect(button).toHaveAttribute("title", /available offline/);
    await expect(player).toHaveCount(0);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (browserName !== "webkit") await context.setOffline(true);
    await page.reload();
    await expect(page.locator("body.offline-shell")).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveClass(/article-audio-button-ready/);
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(player).toBeHidden();
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
    await button.click();
    await expect(player).toBeVisible();
    await expect(button).toHaveClass(/article-audio-button-ready/);
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
    await button.click();
    await expect(player).toBeHidden();
    await expect(button).toHaveClass(/article-audio-button-ready/);
    await expect.poll(() => page.locator("audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  } finally {
    await context.setOffline(false);
    proxy.closeAllConnections();
    if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
