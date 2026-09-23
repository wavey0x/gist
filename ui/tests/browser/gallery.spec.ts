import { test, expect, type Page } from "@playwright/test";
import http from "node:http";

async function visit(page: Page, id = "GalleryFixture01") {
  await page.goto(`/${id}`);
  await expect(page.locator(".wg-gallery-trigger").first()).toBeVisible();
}
async function loaded(page: Page) {
  await expect(
    page.getByRole("dialog", { name: "Image gallery" })
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".pswp__item[aria-hidden='false'] img")
        .evaluateAll((images) =>
          images.some(
            (image) =>
              (image as HTMLImageElement).naturalWidth > 0 &&
              image.getBoundingClientRect().width > 0
          )
        )
    )
    .toBe(true);
}

test("numbered standalone references open in place and close without gallery chrome", async ({
  page
}) => {
  await visit(page, "GallerySingle001");
  const trigger = page.getByRole("link", { name: "01", exact: true });
  await trigger.click();
  await loaded(page);
  await expect(page.locator(".wg-gallery-caption")).toHaveText(
    "Standalone lake"
  );
  await expect(page.locator(".pswp__counter")).toHaveCount(0);
  await expect(page.locator(".pswp__button--arrow--next")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".pswp")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(page.url()).toContain("/GallerySingle001");
});

test("deduplicates mixed triggers, isolates files, and restores reading position", async ({
  page
}) => {
  await visit(page);
  const trigger = page.locator("#references a").nth(1);
  await trigger.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await trigger.click();
  await loaded(page);
  await expect(page.locator(".pswp__counter")).toHaveText("2 / 3");
  await expect(page.locator(".wg-gallery-caption")).toHaveText("Photo 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pswp__counter")).toHaveText("3 / 3");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pswp")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(trigger).toBeFocused();
  await page.locator('a[href$="#wg-image"]').first().click();
  await loaded(page);
  await expect(page.locator(".wg-gallery-caption")).toHaveText(
    "Standalone lake"
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".pswp")).toHaveCount(0);
  await page
    .locator('[data-gist-filename="appendix.md"] a.wg-gallery-trigger')
    .click();
  await loaded(page);
  await expect(page.locator(".pswp__counter")).toHaveCount(0);
  await expect(page.locator(".wg-gallery-caption")).toHaveText(
    "Separate photo"
  );
});

test("Back and Forward restore the selected image without leaving the document", async ({
  page
}) => {
  await visit(page);
  const before = await page.evaluate(() => history.length);
  await page.locator("#references a").first().click();
  await loaded(page);
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  await page.goBack();
  await expect(page.locator(".pswp")).toHaveCount(0);
  await page.goForward();
  await loaded(page);
  await expect(page.locator(".pswp__counter")).toHaveText("2 / 3");
  await page.reload();
  await expect(page.locator(".wg-gallery-trigger").first()).toBeVisible();
  await expect(page.locator(".pswp")).toHaveCount(0);
  expect(await page.evaluate(() => history.state?.wgGallery)).toBeUndefined();
});

test("the saved text-link album opens offline without ever opening it online", async ({
  page,
  context,
  browserName
}) => {
  // Stop the origin as well as emulating offline: WebKit's offline navigation
  // emulation fails even for literal service-worker responses (playwright#42775).
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
    await page.goto(`http://127.0.0.1:${address.port}/GalleryOffline01`);
    await expect(page.locator(".wg-gallery-trigger").first()).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller))
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open("waveygist-content-v1");
          return (await cache.keys()).filter((r) =>
            r.url.includes("/api/images/")
          ).length;
        })
      )
      .toBe(3);
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve()))
    );
    if (browserName !== "webkit") await context.setOffline(true);
    await page.reload();
    await expect(page.locator("body.offline-shell")).toBeVisible();
    await expect(page.locator(".wg-gallery-trigger").first()).toBeVisible();
    await page.getByRole("link", { name: "02", exact: true }).click();
    await loaded(page);
    await expect(page.locator(".pswp__counter")).toHaveText("2 / 3");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".pswp")).toHaveCount(0);
    await context.setOffline(false);
  } finally {
    proxy.closeAllConnections();
    if (proxy.listening)
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("the collector preserves captions, grouping, URL identity, and outer-link precedence", async ({
  page
}) => {
  await visit(page, "GallerySingle001");
  const result = await page.evaluate(async () => {
    const moduleUrl = "/gallery-model.mjs";
    const { collectGalleries, prepareGalleryImages } = await import(moduleUrl);
    const doc = new DOMParser().parseFromString(
      `<article>
      <a href="https://photos.test/a?size=large#wg-gallery" title="&lt;b&gt;First&lt;/b&gt;">01</a>
      <a href="https://photos.test/a?size=large#wg-gallery" title="Later">02</a>
      <a href="https://photos.test/a?size=small#wg-gallery">Small</a>
      <img src="https://photos.test/b#wg-gallery" alt="Descriptive alt">
      <a href="https://photos.test/a?size=large#wg-gallery=default">Named</a>
      <a href="https://photos.test/full#wg-image"><img src="https://photos.test/thumb#wg-gallery" alt="Thumbnail description"></a>
      <a href="https://photos.test/ordinary"><img src="https://photos.test/ignored#wg-gallery"></a>
      <a href="https://photos.test/x#wg-gallery=">Invalid</a>
    </article><article><a href="https://photos.test/c#wg-gallery">Separate</a></article>`,
      "text/html"
    );
    const options = {
      baseUrl: location.href,
      imageOrigin: "https://api.photos.test"
    };
    const { groups, triggers } = collectGalleries(
      [...doc.querySelectorAll("article")],
      options
    );
    const payload = {
      files: {
        "photos.md": {
          kind: "markdown",
          rendered_html:
            '<a href="https://api.photos.test/api/v1/images/img_1234567890abcdef?source=report#wg-image"><img src="https://api.photos.test/api/v1/images/img_abcdef1234567890#wg-gallery"></a><a href="https://untrusted.test/api/v1/images/img_2222222222222222#wg-image">External</a>'
        }
      }
    };
    const prepared = prepareGalleryImages(payload, options, DOMParser);
    return {
      groups: groups.map(
        (group: {
          name: string | null;
          items: { src: string; caption: string }[];
        }) => ({
          name: group.name,
          items: group.items.map((item) => ({
            src: item.src,
            caption: item.caption
          }))
        })
      ),
      triggers: triggers.size,
      prepared
    };
  });
  expect(result.triggers).toBe(7);
  expect(
    result.groups.map((group: { items: unknown[] }) => group.items.length)
  ).toEqual([3, 1, 1, 1]);
  expect(
    result.groups[0].items.map((item: { caption: string }) => item.caption)
  ).toEqual(["<b>First</b>", "Small", "Descriptive alt"]);
  expect(result.groups[1].name).toBe("default");
  expect(result.groups[2].items[0]).toEqual({
    src: "https://photos.test/full",
    caption: "Thumbnail description"
  });
  expect(result.prepared.imageIds).toEqual([
    "img_1234567890abcdef",
    "img_abcdef1234567890"
  ]);
  expect(result.prepared.payload.files["photos.md"].rendered_html).toContain(
    "/api/images/img_1234567890abcdef?source=report#wg-image"
  );
});

test("zoom, keyboard focus, repeated dismissal, and ordinary links remain usable", async ({
  page
}) => {
  await visit(page);
  await expect(
    page.locator('img[alt="Ordinary linked image"]').locator("..")
  ).not.toHaveClass(/wg-gallery-trigger/);
  const trigger = page.locator("#references a").first();
  const before = await page.evaluate(() => history.length);
  for (let attempt = 0; attempt < 2; attempt++) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await loaded(page);
    await expect(
      page.getByRole("button", { name: "Close", exact: true })
    ).toBeFocused();
    await expect(page.locator(".pswp")).toHaveAttribute("aria-modal", "true");
    expect(
      await page
        .locator("main")
        .evaluate((el) => Boolean(el.closest("[inert]")))
    ).toBe(true);
    for (let tab = 0; tab < 8; tab++) {
      await page.keyboard.press(tab % 2 ? "Shift+Tab" : "Tab");
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest(".pswp"))
        )
      ).toBe(true);
    }
    const photo = page.locator('.pswp__item[aria-hidden="false"] img');
    const width = await photo.evaluate(
      (el) => el.getBoundingClientRect().width
    );
    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await expect
      .poll(() => photo.evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(width + 100);
    await page.keyboard.press("Escape");
    await expect(page.locator(".pswp")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(
      await page
        .locator("main")
        .evaluate((el) => Boolean(el.closest("[inert]")))
    ).toBe(false);
  }
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
});

test.describe("external loading", () => {
  test.use({ serviceWorkers: "block" });

  test("external images load without CORS, fail gracefully, and retry", async ({
    page,
    context,
    request
  }) => {
    const bytes = await (
      await request.get(
        "http://127.0.0.1:4311/api/v1/images/img_0000000000000001"
      )
    ).body();
    let failure = true;
    await context.route("https://images.example.test/external.png", (route) =>
      failure
        ? route.fulfill({ status: 503, body: "Unavailable" })
        : route.fulfill({ contentType: "image/png", body: bytes })
    );
    await visit(page);
    await page.getByRole("link", { name: "External", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open original" })
    ).toHaveAttribute("href", "https://images.example.test/external.png");
    failure = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await loaded(page);
    await expect(page.locator(".wg-gallery-caption")).toHaveText(
      "External image"
    );
    await page.keyboard.press("Escape");
    await expect(page.locator(".pswp")).toHaveCount(0);
  });

  test("slow images can be closed and later loads do not reopen the modal", async ({
    page,
    context,
    request
  }) => {
    const bytes = await (
      await request.get(
        "http://127.0.0.1:4311/api/v1/images/img_0000000000000001"
      )
    ).body();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route(
      "https://images.example.test/external.png",
      async (route) => {
        await gate;
        await route.fulfill({ contentType: "image/png", body: bytes });
      }
    );
    await visit(page);
    await page.getByRole("link", { name: "External", exact: true }).click();
    await expect(
      page.getByText("Loading image…", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".pswp")).toHaveCount(0);
    release();
    await page.locator("#references a").nth(2).click();
    await loaded(page);
    await expect(page.locator(".wg-gallery-caption")).toHaveText("Photo 3");
  });
});

for (const mode of ["legacy snapshot", "missing image"] as const) {
  test(`online reconciliation repairs a ${mode} without a new gist revision`, async ({
    page
  }) => {
    await visit(page, "GalleryOffline01");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open("waveygist-content-v1");
          return (await cache.keys()).filter((r) =>
            r.url.includes("/api/images/")
          ).length;
        })
      )
      .toBe(3);
    const key = await page.evaluate(async (mode) => {
      const cache = await caches.open("waveygist-content-v1");
      const request = (await cache.keys()).find((r) =>
        r.url.includes("/render")
      )!;
      if (mode === "legacy snapshot") {
        const payload = await (await cache.match(request))!.json();
        for (const file of Object.values(payload.files) as {
          rendered_html: string;
        }[])
          file.rendered_html = file.rendered_html.replace(
            /#wg-(?:image|gallery(?:=[a-z0-9-]+)?)/g,
            ""
          );
        await cache.put(
          request,
          new Response(JSON.stringify(payload), {
            headers: { "content-type": "application/json" }
          })
        );
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("waveygist-offline");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("entries", "readwrite");
          const store = tx.objectStore("entries");
          const req = store.get("gist:GalleryOffline01:1");
          req.onsuccess = () => {
            const entry = req.result;
            delete entry.imageIds;
            store.put(entry);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }
      await cache.delete("/api/images/img_0000000000000003");
      return request.url;
    }, mode);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(() =>
        page.evaluate(async () =>
          Boolean(
            await (
              await caches.open("waveygist-content-v1")
            ).match("/api/images/img_0000000000000003")
          )
        )
      )
      .toBe(true);
    const saved = await page.evaluate(
      async (key) =>
        await (await (
          await caches.open("waveygist-content-v1")
        ).match(key))!.json(),
      key
    );
    expect(saved.revision_number).toBe(1);
    expect(saved.files["README.md"].rendered_html).toContain(
      "#wg-gallery=album"
    );
    expect(saved.files["README.md"].rendered_html).toContain("#wg-image");
  });
}

test("raw view, file disclosure, and revision changes dispose and remount previews", async ({
  page
}) => {
  await visit(page, "GallerySingle001");
  await page
    .getByRole("button", { name: "View raw file", exact: true })
    .click();
  await expect(page.locator(".wg-gallery-trigger")).toHaveCount(0);
  await page
    .getByRole("button", { name: "View rendered file", exact: true })
    .click();
  await page.locator(".wg-gallery-trigger").first().click();
  await loaded(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".pswp")).toHaveCount(0);
  await visit(page);
  await page
    .getByRole("button", { name: "Collapse README.md", exact: true })
    .click();
  await expect(page.locator("#references")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand README.md", exact: true })
    .click();
  await page.locator("#references a").first().click();
  await loaded(page);
  await page.goto("/GalleryFixture01/revisions/2");
  await expect(page.locator(".pswp")).toHaveCount(0);
  expect(await page.evaluate(() => history.state?.wgGallery)).toBeUndefined();
  await page.locator("#references a").first().click();
  await loaded(page);
  await expect(page.locator(".pswp__counter")).toHaveText("1 / 3");
});

test("long captions stay below the photo in portrait and landscape with reduced motion", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "GalleryLongText1");
  await page.locator(".wg-gallery-trigger").first().click();
  await loaded(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const photo = document
            .querySelector('.pswp__item[aria-hidden="false"] img')!
            .getBoundingClientRect();
          const caption = document
            .querySelector(".wg-gallery-caption")!
            .getBoundingClientRect();
          const toolbar = document
            .querySelector(".pswp__top-bar")!
            .getBoundingClientRect();
          return photo.bottom <= caption.top && photo.top >= toolbar.bottom;
        })
      )
      .toBe(true);
    expect(
      await page
        .locator(".wg-gallery-caption")
        .evaluate((el) => el.scrollHeight > el.clientHeight)
    ).toBe(true);
    await page.locator(".wg-gallery-caption").focus();
    await page.keyboard.press("End");
    await expect
      .poll(() =>
        page.locator(".wg-gallery-caption").evaluate((el) => el.scrollTop)
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Close", exact: true })
    ).toBeVisible();
  }
});

test("temporary image failures are not cached as immutable responses", async ({
  request
}) => {
  await request.get("http://127.0.0.1:4311/fail-next-image?id=5");
  const failed = await request.get("/api/images/img_0000000000000005");
  expect(failed.status()).toBe(503);
  expect(failed.headers()["cache-control"]).toBe("no-store");
  const retried = await request.get("/api/images/img_0000000000000005");
  expect(retried.status()).toBe(200);
  expect(retried.headers()["content-type"]).toBe("image/png");
});

test("a preview can be dismissed immediately, including after Forward", async ({
  page
}) => {
  await visit(page, "GallerySingle001");
  await page.locator(".wg-gallery-trigger").first().click();
  await page
    .getByRole("button", { name: "Close", exact: true })
    .click({ force: true });
  await expect(page.locator(".pswp")).toHaveCount(0);
  await page.goForward();
  await page
    .getByRole("button", { name: "Close", exact: true })
    .click({ force: true });
  await expect(page.locator(".pswp")).toHaveCount(0);
  await expect(page.locator(".wg-gallery-trigger").first()).toBeFocused();
});
