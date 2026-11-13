import { expect, test } from "@playwright/test";
import http from "node:http";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

async function codeOverflows(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).first().evaluate((element) =>
    element.scrollWidth > element.clientWidth + 1
  );
}

async function captureClipboard(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => {
        if (localStorage.getItem("test-deny-copy")) throw new Error("Clipboard denied");
        localStorage.setItem("test-copied-code", text);
      }
    } });
  });
}

test("writes to the real clipboard from a keyboard activation", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard read permission is supported by Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/GalleryCodeWrap01");
  const block = page.locator(".code-wrap-block").first();
  await block.getByRole("button", { name: "Copy code block 1" }).focus();
  await page.keyboard.press("Enter");
  await expect(block.getByRole("status")).toHaveText("Copied");
  await expect(block.getByRole("status")).toHaveClass("sr-only");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await block.locator("pre").textContent());
});

test("copies exact block text regardless of wrapping and reports clipboard failures", async ({ page }) => {
  await captureClipboard(page);
  await page.goto("/GalleryCodeWrap01");
  const block = page.locator(".code-wrap-block").first();
  const copy = block.getByRole("button", { name: "Copy code block 1" });
  const expected = `const value = "${"abcdefghij".repeat(35)}";\n\n\t<tag> & \`literal\` $(text)\n`;
  await copy.click();
  await expect(block.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toBe(expected);
  await block.getByRole("button", { name: "Wrap lines in code block 1" }).click();
  await copy.click();
  expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toBe(expected);
  await expect(block.getByRole("status")).toBeEmpty();
  await page.evaluate(() => localStorage.setItem("test-deny-copy", "true"));
  await copy.click();
  await expect(block.getByRole("status")).toContainText("Couldn’t copy");
  await expect(block.getByRole("status")).not.toHaveText("Copied");
});

test("copies a source file in rendered and raw views without line numbers", async ({ page }) => {
  await captureClipboard(page);
  await page.goto("/GalleryCodePatch01");
  const copy = page.getByRole("button", { name: "Copy twocrypto-math.patch", exact: true });
  const expected = `diff --git a/example.vy b/example.vy\n+MIN_A: constant(uint256) = ${"N_CONS*N_CONS*".repeat(24)}\n`;
  await copy.click();
  expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toBe(expected);
  await page.getByRole("button", { name: "View raw file" }).click();
  await copy.click();
  expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toBe(expected);
  await expect(page.getByRole("status")).toHaveText("Copied");
  await page.evaluate(() => localStorage.setItem("test-deny-copy", "true"));
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Couldn’t copy");
});

test("wraps only the selected Markdown code block", async ({ page }) => {
  await page.goto("/GalleryCodeWrap01");
  const blocks = page.locator(".code-wrap-block");
  await expect(blocks).toHaveCount(2);
  const first = blocks.first();
  const second = blocks.nth(1);
  const toggle = first.getByRole("button", { name: "Wrap lines in code block 1" });
  await expect(toggle.locator("svg")).toHaveCount(1);
  await expect(toggle).toHaveText("");
  const touch = await page.evaluate(() =>
    matchMedia("(hover: none), (pointer: coarse)").matches
  );
  // Hidden until hovered with a pointer, or until the block is tapped on touch.
  await expect(first.locator(".code-block-actions")).toHaveCSS("opacity", "0");
  if (touch) {
    await first.locator("pre").tap();
  } else {
    await first.hover();
  }
  await expect(first.locator(".code-block-actions")).toHaveCSS("opacity", "1");
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
  await captureClipboard(page);
  await page.goto("/GalleryCodePanel01");
  const panel = page.locator('[data-gist-filename="twocrypto-math.patch"]');
  const toggle = panel.getByRole("button", { name: "Wrap lines in twocrypto-math.patch" });
  await expect(toggle.locator("svg")).toHaveCount(1);
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(panel.locator(".gist-code-view")).toHaveAttribute("data-code-wrap", "true");
  await expect(page.locator(".code-wrap-block pre")).toHaveCSS("white-space", "pre");
  await panel.getByRole("button", { name: "Collapse twocrypto-math.patch" }).click();
  const copy = panel.getByRole("button", { name: "Copy twocrypto-math.patch", exact: true });
  await expect(copy).toHaveText("");
  await copy.click();
  await expect(copy).toHaveText("");
  await expect(copy.locator("svg.lucide-check")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("test-deny-copy", "true"));
  await copy.click();
  await expect(copy).toHaveText("");
  await expect(panel.getByRole("status")).toContainText("Select the code");
  await panel.getByRole("button", { name: "Expand twocrypto-math.patch" }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test.describe("offline reader", () => {
  test.use({ serviceWorkers: "allow" });

  test("keeps patch highlighting and supports local wrapping", async ({ page, context, browserName }) => {
    await captureClipboard(page);
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
      await markdown.getByRole("button", { name: "Copy code block 1" }).click();
      expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toBe(await markdown.locator("pre").textContent());
      await expect(markdown.getByRole("status").last()).toHaveText("Copied");
      await page.getByRole("button", { name: "Copy twocrypto-math.patch", exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem("test-copied-code"))).toContain("\n+MIN_A:");
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
