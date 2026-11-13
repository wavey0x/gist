import { test, expect } from "@playwright/test";

const id = "GalleryAudio0001";

test.use({ serviceWorkers: "block" });

test("library rows stack the date under the title on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((gistId) => {
    localStorage.setItem("waveygist:recently-viewed:v1", JSON.stringify([{
      id: gistId, title: "Long read", author_name: "Field Notes",
      revision_number: 1, viewed_at: new Date().toISOString()
    }]));
  }, id);
  await page.reload();
  const row = page.getByRole("region", { name: "Library" }).locator(".library-link").first();
  const title = (await row.locator(".library-title").boundingBox())!;
  const aside = (await row.locator(".library-aside").boundingBox())!;
  expect(aside.y).toBeGreaterThanOrEqual(title.y + title.height);
  expect(Math.abs(aside.x - title.x)).toBeLessThan(2);
  // The page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

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
