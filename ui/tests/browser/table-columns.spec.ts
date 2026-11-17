import { test, expect } from "@playwright/test";

// A long prose column must not squeeze short neighbours onto extra lines.
for (const width of [1280, 390]) {
  test(`short table cells keep their lines whole at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/GalleryTable0001");
    const metrics = page.locator(".markdown-body tbody tr").first().locator("td").nth(2);
    await expect(metrics).toHaveClass(/cell-tight/);
    // Three stacked values stay three lines.
    const lines = await metrics.evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const tops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top / 4)));
      return tops.size;
    });
    expect(lines).toBe(3);
    const steps = page.locator(".markdown-body tbody tr").first().locator("td").nth(3);
    await expect(steps).toHaveClass(/cell-roomy/);
    // A mid-length cell keeps room for about 18 characters before it wraps.
    const market = page.locator(".markdown-body tbody tr").first().locator("td").nth(1);
    await expect(market).toHaveClass(/cell-roomy/);
    const room = await market.evaluate((cell) => {
      const style = getComputedStyle(cell);
      return (cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / parseFloat(style.fontSize);
    });
    expect(room).toBeGreaterThanOrEqual(9.4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

// A key/value table has no column labels; Markdown still gives it a header row.
test("an empty header row is not drawn", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/GalleryKeyFacts01");
  const frame = page.locator(".markdown-body .table-scroll");
  await expect(frame.locator("thead")).toBeHidden();
  const gap = await frame.evaluate((node) =>
    node.querySelector("tbody td")!.getBoundingClientRect().top - node.getBoundingClientRect().top
  );
  expect(gap).toBeLessThanOrEqual(1);
  // A header that has text is still drawn.
  await page.goto("/GalleryTable0001");
  await expect(page.locator(".markdown-body thead")).toBeVisible();
});

test("a two-column table wraps on a phone instead of scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/GalleryKeyFacts01");
  const frame = page.locator(".markdown-body .table-scroll");
  await expect(frame.locator("td").first()).toHaveClass(/cell-tight/);
  expect(await frame.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  // The label column keeps each label on one line.
  const label = frame.locator("tbody tr").nth(2).locator("td").first();
  const lines = await label.evaluate((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top / 4))).size;
  });
  expect(lines).toBe(1);
});
