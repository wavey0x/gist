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
    await expect(steps).not.toHaveClass(/cell-tight/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
