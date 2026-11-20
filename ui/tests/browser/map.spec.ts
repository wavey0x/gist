import { expect, test, type Page } from "@playwright/test";

// The tile server is stubbed with a blank style so the test needs no network.
async function stubTiles(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8e8e4" } }]
      })
    })
  );
}

test("a map fence renders an interactive map with controls and a legend", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/GalleryMap000001");
  const block = page.locator(".map-block");
  await expect(block).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 });
  await expect(block.locator(".maplibregl-canvas")).toBeVisible();
  await expect(block.locator(".map-places")).toBeHidden();
  await expect(block.locator(".map-block-legend")).toHaveText(/Hotel.*Activities.*Food & drink/);
  // The fence is not treated as a code block.
  await expect(block.locator(".code-block-actions")).toHaveCount(0);

  await block.getByRole("button", { name: "Expand map" }).click();
  await expect(block).toHaveAttribute("data-map-expanded", "");
  const frame = await block.locator(".map-block-frame").boundingBox();
  expect(frame?.width).toBe(page.viewportSize()?.width);
  await page.keyboard.press("Escape");
  await expect(block).not.toHaveAttribute("data-map-expanded", "");
});

test("without tiles the map shows its places as a list with directions", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await page.goto("/GalleryMap000001");
  const block = page.locator(".map-block");
  await expect(block).toHaveAttribute("data-map-state", "fallback", { timeout: 20_000 });
  await expect(block.locator(".map-places")).toBeVisible();
  await expect(block.locator(".map-place")).toHaveCount(26);
  await expect(block.locator(".map-places-head")).toContainText("Santa Fe");
  const meow = block.locator(".map-place", { hasText: "Meow Wolf" });
  await expect(meow.locator(".map-place-name")).toHaveAttribute("href", /#2-meow-wolf/);
  await expect(meow.locator(".map-place-go")).toHaveAttribute("href", /35\.65465/);
});
