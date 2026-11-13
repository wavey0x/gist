import { test, expect } from "@playwright/test";

const prose = "GalleryDiffProse1";
const mixed = "GalleryDiff00001";

test.use({ serviceWorkers: "block" });

for (const width of [1280, 390]) {
  test(`a prose diff wraps long paragraphs inside the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/${prose}/diff/1..2`);
    const viewer = page.locator(".diff-viewer");
    await expect(viewer).toBeVisible();
    // Nothing is clipped: neither the page nor the diff scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await viewer.locator(".diff-table-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const paragraph = viewer.locator(".diff-row-edited", { hasText: "The lender market holds" });
    const box = (await paragraph.boundingBox())!;
    expect(box.height).toBeGreaterThan(60);
    // Line numbers give way to the text on a phone.
    await expect(viewer.locator(".diff-line-number").first()).toBeVisible({ visible: width > 640 });
  });
}

test("a small edit is one line with the old words struck and the new ones marked", async ({ page }) => {
  await page.goto(`/${prose}/diff/1..2`);
  const viewer = page.locator(".diff-viewer");
  const paragraph = viewer.locator(".diff-row-edited", { hasText: "The lender market holds" });
  await expect(paragraph.locator("del")).toHaveText("1.93m");
  await expect(paragraph.locator("ins")).toHaveText("1.88m");
  // A changed figure in a table row is marked in place.
  const row = viewer.locator(".diff-row-edited", { hasText: "cbBTC mint" });
  await expect(row.locator("del")).toHaveText("1.93m");
  await expect(row.locator("ins")).toHaveText("1.88m");
  // A rewritten line is shown as old then new instead.
  await expect(viewer.locator(".diff-row-removed", { hasText: "Start with the lender exit." })).toBeVisible();
  await expect(viewer.locator(".diff-row-removed", { hasText: "prioritized remediation" })).toBeVisible();
  await expect(viewer.locator(".diff-row-added", { hasText: "A freeze stops new principal" })).toBeVisible();
  await expect(viewer.getByLabel("4 additions and 4 deletions")).toBeVisible();
  // One header bar for a single file.
  await expect(viewer.locator(".diff-file-header")).toHaveCount(0);
  await expect(viewer.locator(".diff-filename")).toHaveText("README.md");
});

test("unchanged lines expand in place", async ({ page }) => {
  await page.goto(`/${prose}/diff/1..2`);
  const viewer = page.locator(".diff-viewer");
  await expect(viewer.getByText("Unchanged line 6.")).toHaveCount(0);
  await viewer.getByRole("button", { name: /Show \d+ unchanged lines/ }).click();
  await expect(viewer.getByText("Unchanged line 6.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /unchanged lines/ })).toHaveCount(0);
});

test("the stepper walks between neighbouring revisions and stops at the ends", async ({ page }) => {
  await page.goto(`/${prose}/diff/1..2`);
  const viewer = page.locator(".diff-viewer");
  await expect(viewer.getByRole("heading", { name: "Revision 1 to 2" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Older changes" })).toHaveAttribute("aria-disabled", "true");
  await viewer.getByRole("link", { name: "Newer changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/${prose}/diff/2\\.\\.3$`));
  await expect(viewer.getByRole("heading", { name: "Revision 2 to 3" })).toBeVisible();
  await expect(viewer.locator(".diff-row-added", { hasText: "Added in the third revision." })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Newer changes" })).toHaveAttribute("aria-disabled", "true");
  await viewer.getByRole("link", { name: "Older changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/${prose}/diff/1\\.\\.2$`));
});

test("code files keep one row per line and scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 844 });
  await page.goto(`/${mixed}/diff/1..2`);
  const viewer = page.locator(".diff-viewer");
  await expect(viewer.locator(".diff-file-header")).toHaveCount(2);
  const code = viewer.locator(".diff-file", { hasText: "calc.py" });
  await expect(code.locator(".diff-table-code")).toBeVisible();
  // Old and new sit on separate rows, with both line numbers, never merged.
  await expect(code.locator(".diff-row-edited")).toHaveCount(0);
  const removed = code.locator(".diff-row-removed", { hasText: "result += value" });
  const added = code.locator(".diff-row-added", { hasText: "result += value * 2" });
  await expect(removed.locator(".diff-line-number-old")).toHaveText("4");
  await expect(added.locator(".diff-line-number").last()).toHaveText("4");
  await expect(added.locator(".diff-word-added")).toHaveText(" * 2");
  // The long line is not wrapped; its file scrolls and the page does not.
  const long = code.locator(".diff-row-added", { hasText: "LIMIT" });
  expect((await long.boundingBox())!.height).toBeLessThan(30);
  expect(await code.locator(".diff-table-scroll").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The Markdown file beside it still wraps.
  await expect(viewer.locator(".diff-file", { hasText: "README.md" }).locator(".diff-table-prose")).toBeVisible();
});

test("the history menu marks what is on screen and opens changes from a labelled control", async ({ page }) => {
  await page.goto(`/${prose}/revisions/2`);
  await page.getByRole("button", { name: "View revision history" }).click();
  const menu = page.getByRole("menu", { name: "Revision history" });
  await expect(menu.locator(".history-menu-label")).toHaveText("History");
  await expect(menu.getByRole("menuitem", { name: /Revision 2/ }).first()).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("menuitem", { name: /Revision 3/ }).first().locator(".history-item-latest")).toHaveText("Latest");
  // The first revision has nothing to compare with.
  await expect(menu.getByRole("menuitem", { name: "View changes in revision 1" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "View changes in revision 3" }).click();
  await expect(page).toHaveURL(new RegExp(`/${prose}/diff/2\\.\\.3$`));
  await page.getByRole("button", { name: "View revision history" }).click();
  await expect(page.getByRole("menuitem", { name: "View changes in revision 3" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("menuitem", { name: "View changes in revision 2" })).not.toHaveAttribute("aria-current", "page");
});
