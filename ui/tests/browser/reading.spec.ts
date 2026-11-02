import { test, expect } from "@playwright/test";

const id = "GalleryAudio0001";

test.use({ serviceWorkers: "block" });

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
