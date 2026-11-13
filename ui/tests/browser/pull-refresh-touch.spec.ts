import { test, expect } from "@playwright/test";

test("a real downward touch on a library link refreshes without opening or swiping the row", async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("waveygist:recently-viewed:v1", JSON.stringify([{
    id: "GalleryReading01", title: "Reading notes", author_name: "Notes", revision_number: 1,
    viewed_at: new Date().toISOString()
  }])));
  await page.reload();
  const row = page.locator(".library-link").first();
  await expect(row).toBeVisible();
  const rect = (await row.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const x = rect.x + 30, y = rect.y + 15;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 10 }] });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await expect(page.locator(".pull-refresh")).toHaveAttribute("data-state", "ready");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".pull-refresh [role=status]")).toHaveText("Updated");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toBeVisible();
  // The next intentional tap is not swallowed.
  await row.tap();
  await expect(page).toHaveURL(/\/GalleryReading01/);
});
