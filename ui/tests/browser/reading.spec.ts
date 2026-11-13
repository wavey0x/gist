import { test, expect } from "@playwright/test";

const id = "GalleryAudio0001";

test.use({ serviceWorkers: "block" });

test("a backend-rendered table keeps its focusable horizontal scroll region", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/GalleryReading01");
  const region = page.getByRole("region", { name: "Table (scroll horizontally for more columns)" });
  await expect(page.locator(".table-scroll")).toHaveCount(1);
  expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await region.scrollIntoViewIfNeeded();
  await region.focus();
  // Give WebKit a real key press; a zero-duration press can skip native scrolling.
  await page.keyboard.press("ArrowRight", { delay: 50 });
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("tables sit in a rounded frame with a distinct header and faint stripes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/GalleryReading01");
  const frame = page.locator(".markdown-body .table-scroll").first();
  await expect(frame).toHaveCSS("border-top-left-radius", "8px");
  await expect(frame).toHaveCSS("border-top-width", "1px");
  const styles = await frame.evaluate((node) => {
    const css = (element: Element | null, property: string) =>
      element ? getComputedStyle(element).getPropertyValue(property) : "";
    const rows = node.querySelectorAll("tbody tr");
    return {
      header: css(node.querySelector("th"), "background-color"),
      plain: css(rows[0], "background-color"),
      striped: css(rows[1], "background-color"),
      lastColumnRight: css(node.querySelector("tr > :last-child"), "border-right-width"),
      firstColumnRight: css(node.querySelector("tr > :first-child"), "border-right-width"),
      lastRowBottom: css(rows[rows.length - 1]?.firstElementChild ?? null, "border-bottom-width"),
      frameWidth: node.getBoundingClientRect().width,
      tableWidth: node.querySelector("table")!.getBoundingClientRect().width
    };
  });
  expect(styles.header).not.toBe(styles.plain);
  expect(styles.header).not.toBe(styles.striped);
  expect(styles.firstColumnRight).toBe("1px");
  expect(styles.lastColumnRight).toBe("0px");
  expect(styles.lastRowBottom).toBe("0px");
  // The frame hugs the table, with no empty strip inside it.
  expect(Math.abs(styles.frameWidth - styles.tableWidth)).toBeLessThanOrEqual(2);
});

test("an article uses the full page width, in line with its toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/GalleryReading01");
  const article = (await page.locator(".markdown-body").first().boundingBox())!;
  const toolbar = (await page.locator(".toolbar").first().boundingBox())!;
  expect(Math.abs(article.x + article.width - (toolbar.x + toolbar.width))).toBeLessThanOrEqual(1);
  expect(article.width).toBeGreaterThan(900);
});

for (const width of [1280, 390]) {
  test(`the updated dot is not clipped at ${width}px`, async ({ page, context }) => {
    await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/me/gists?*", (route) => route.fulfill({ json: {
      query: null,
      gists: [{
        id, url: `/${id}`, title: "Revised notes", display_title: "Revised notes",
        author_name: "Audio Test", revision_number: 2, file_count: 1,
        created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-12T12:00:00Z"
      }],
      pagination: { limit: 20, offset: 0, total: 1, next_offset: null },
      stats: { gist_count: 1, revision_count: 2, last_updated_at: "2026-11-12T12:00:00Z" }
    } }));
    await page.goto("/");
    await page.evaluate((gistId) => {
      localStorage.setItem("waveygist:recently-viewed:v1", JSON.stringify([{
        id: gistId, title: "Revised notes", author_name: "Audio Test",
        revision_number: 1, viewed_at: new Date().toISOString()
      }]));
    }, id);
    await page.reload();
    const library = page.getByRole("region", { name: "Library" });
    // The first page is rendered by the server; changing the sort loads the mocked list.
    await library.locator(".library-search-toggle").click();
    await library.getByRole("button", { name: "Created" }).click();
    const dot = library.getByRole("img", { name: "Updated since you read it" });
    await expect(dot).toBeVisible();
    // Visible to a reader, not merely present: nothing covers or clips it.
    expect(await dot.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node;
    })).toBe(true);
  });
}

test("the library shows how far into an article you read", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((gistId) => {
    localStorage.setItem("waveygist:recently-viewed:v1", JSON.stringify([{
      id: gistId, title: "Long read", author_name: "Field Notes",
      revision_number: 1, viewed_at: new Date().toISOString()
    }]));
    localStorage.setItem(`waveygist:reading:v1:${gistId}:1`, JSON.stringify({
      fraction: 0.4, saved_at: new Date().toISOString()
    }));
  }, id);
  await page.reload();
  const library = page.getByRole("region", { name: "Library" });
  await expect(library.getByRole("link", { name: /Long read/ })).toBeVisible();
  await expect(library.locator(".library-progress")).toHaveAttribute("style", /width: 40%/);
  await expect(page.getByRole("region", { name: "Playlist" })).toHaveCount(0);
});
