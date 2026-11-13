import { expect, test } from "@playwright/test";

test.use({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});

test("on touch, code block buttons appear on a tap and leave on a tap elsewhere", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Mobile emulation here is Chromium-only");
  await page.goto("/GalleryCodeWrap01");
  const blocks = page.locator(".code-wrap-block");
  await expect(blocks).toHaveCount(2);
  const first = blocks.first();
  const second = blocks.nth(1);
  const actions = first.locator(".code-block-actions");
  await expect(actions).toBeHidden();
  // Nothing is reserved for the hidden buttons: the code runs to the block's own padding.
  expect(await first.locator("pre").evaluate((pre) => parseFloat(getComputedStyle(pre).paddingRight))).toBeLessThanOrEqual(16);

  await first.locator("pre").tap();
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS("opacity", "1");

  // Using a button keeps them up.
  await first.getByRole("button", { name: "Wrap lines in code block 1" }).tap();
  await expect(first.locator("pre")).toHaveCSS("white-space", "pre-wrap");
  await expect(actions).toBeVisible();

  // Tapping another block moves them; tapping the page clears them.
  await second.locator("pre").tap();
  await expect(actions).toBeHidden();
  await expect(second.locator(".code-block-actions")).toBeVisible();
  await page.locator("h1").first().tap();
  await expect(second.locator(".code-block-actions")).toBeHidden();

  // Tapping the same block again puts them away.
  await second.locator("pre").tap();
  await expect(second.locator(".code-block-actions")).toBeVisible();
  await second.locator("pre").tap();
  await expect(second.locator(".code-block-actions")).toBeHidden();
});

test("on a phone, code blocks keep their frame inside the page gutter", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Mobile emulation here is Chromium-only");
  await page.goto("/GalleryCodeWrap01");
  const block = page.locator(".code-wrap-block pre").first();
  const box = (await block.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(15);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 15);
  expect(await block.evaluate((pre) => parseFloat(getComputedStyle(pre).borderLeftWidth))).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
