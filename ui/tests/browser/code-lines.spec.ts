import { test, expect, type Page } from "@playwright/test";

const single = "/GalleryLines00001";
const multi = "/GalleryLinesMulti1";

const selected = (page: Page) =>
  page.locator(".code-line[data-selected]").evaluateAll((lines) => lines.map((line) => line.id));
const number = (page: Page, line: number, prefix = "") =>
  page.locator(`[id="${prefix}L${line}"] > .code-line-number`);

test("every line carries its own number, level with its text", async ({ page }) => {
  await page.goto(single);
  await expect(page.locator(".code-line")).toHaveCount(80);
  for (const line of [1, 5, 11, 80]) {
    const row = page.locator(`[id="L${line}"]`);
    await expect(row.locator(".code-line-number")).toHaveAttribute("data-line", String(line));
    const [rowBox, numberBox] = await Promise.all([row.boundingBox(), row.locator(".code-line-number").boundingBox()]);
    expect(Math.abs(rowBox!.y - numberBox!.y)).toBeLessThanOrEqual(1);
    expect(rowBox!.height).toBeGreaterThan(15);
  }
  // A colour span that crossed lines is reopened on each of them.
  await expect(page.locator('[id="L11"] .pl-s')).toHaveText("and continues");
});

test("numbers are never part of the text", async ({ page }) => {
  await page.goto(single);
  const text = await page.locator("pre.code-lines").evaluate((pre) => pre.textContent);
  expect(text!.split("\n").slice(0, 6)).toEqual([
    "value_1 = 1 < 2", "value_2 = 2 < 3", "value_3 = 3 < 4", "value_4 = 4 < 5", "", "value_6 = 6 < 7"
  ]);
  expect(text!.endsWith("value_80 = 80 < 81\n")).toBe(true);
  expect(await number(page, 3).evaluate((node) => getComputedStyle(node).userSelect)).toBe("none");
});

test("a click selects a line, shift-click a block, and the address follows", async ({ page }) => {
  await page.goto(single);
  await number(page, 8).click();
  await expect(page).toHaveURL(`${single}#L8`);
  expect(await selected(page)).toEqual(["L8"]);
  await number(page, 13).click({ modifiers: ["Shift"] });
  await expect(page).toHaveURL(`${single}#L8-L13`);
  expect(await selected(page)).toEqual(["L8", "L9", "L10", "L11", "L12", "L13"]);
  // Shift-click above the start keeps the block in order.
  await number(page, 3).click({ modifiers: ["Shift"] });
  await expect(page).toHaveURL(`${single}#L3-L8`);
  // A plain click starts over, and clicking the only selected line clears it.
  await number(page, 20).click();
  await expect(page).toHaveURL(`${single}#L20`);
  await number(page, 20).click();
  await expect(page).toHaveURL(single);
  expect(await selected(page)).toEqual([]);
  await expect(page.locator(".code-line-link")).toHaveCount(0);
  // Selecting never adds history entries.
  await number(page, 4).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(single);
});

test("opening a link highlights the lines and brings them below the header", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await page.goto(`${single}#L60-L62`);
  await expect.poll(() => selected(page)).toEqual(["L60", "L61", "L62"]);
  const box = await page.locator('[id="L60"]').boundingBox();
  expect(box!.y).toBeGreaterThan(60);
  expect(box!.y).toBeLessThan(400);
  await expect(page.locator('[id="L60"]')).toHaveCSS("background-color", "rgb(255, 244, 196)");
  // Moving between links on the same page moves the highlight.
  await page.evaluate(() => { location.hash = "#L2"; });
  await expect.poll(() => selected(page)).toEqual(["L2"]);
});

test("out-of-range and reversed links are tolerated", async ({ page }) => {
  await page.goto(`${single}#L79-L500`);
  await expect.poll(() => selected(page)).toEqual(["L79", "L80"]);
  await page.goto(`${single}#L12-L10`);
  await expect.poll(() => selected(page)).toEqual(["L10", "L11", "L12"]);
  await page.goto(`${single}#heading`);
  await expect(page.locator(".code-line").first()).toBeVisible();
  expect(await selected(page)).toEqual([]);
});

test("the link button copies the address shown, with the revision only on a revision page", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(single);
  await number(page, 8).click();
  await number(page, 9).click({ modifiers: ["Shift"] });
  const copy = page.getByRole("button", { name: "Copy link to lines 8 to 9" });
  await copy.click();
  await expect(copy).toHaveAttribute("data-copied", "true");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://127.0.0.1:4310${single}#L8-L9`);

  await page.goto(`${single}/revisions/1`);
  await number(page, 3).click();
  await page.getByRole("button", { name: "Copy link to line 3" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://127.0.0.1:4310${single}/revisions/1#L3`);
});

test("numbers and the highlight survive wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(single);
  await page.locator(".gist-code-container").hover();
  await page.getByRole("button", { name: "Wrap lines in vault.py" }).click();
  await expect(page.locator(".gist-code-view")).toHaveAttribute("data-code-wrap", "true");
  await page.evaluate(() => { location.hash = "#L20"; });
  await expect(page.locator('[id="L20"]')).toHaveAttribute("data-selected", "true");
  const long = page.locator('[id="L20"]');
  const [longBox, nextBox, numberBox] = await Promise.all([
    long.boundingBox(), page.locator('[id="L21"]').boundingBox(), number(page, 20).boundingBox()
  ]);
  // The long line takes several rows, its number stays on the first one, and
  // the next line starts below all of them.
  expect(longBox!.height).toBeGreaterThan(numberBox!.height * 2.5);
  expect(Math.abs(numberBox!.y - longBox!.y)).toBeLessThanOrEqual(1);
  expect(nextBox!.y).toBeGreaterThanOrEqual(longBox!.y + longBox!.height - 1);
  await expect(number(page, 21)).toBeVisible();
  expect(await page.locator(".gist-code-view").evaluate((view) => view.scrollWidth <= view.clientWidth + 1)).toBe(true);
  // Later rows hang clear of the number column.
  const rects = await long.evaluate((line) => {
    const range = document.createRange();
    range.selectNodeContents(line);
    return [...range.getClientRects()].filter((rect) => rect.width > 80).map((rect) => Math.round(rect.left));
  });
  expect(Math.min(...rects)).toBeGreaterThanOrEqual(Math.round(numberBox!.x + numberBox!.width) - 1);
});

test("a file link in a multi-file gist expands the file and selects its lines", async ({ page }) => {
  await page.goto(multi);
  await page.getByRole("button", { name: "Collapse vault.py" }).click();
  await expect(page.locator('[id="file-vault-py-L3"]')).toHaveCount(0);
  // The README links to lines in a sibling file.
  await page.getByRole("link", { name: "The check" }).click();
  await expect.poll(() => selected(page)).toEqual(["file-vault-py-L3", "file-vault-py-L4"]);
  await expect(page.locator('[id="file-vault-py-L3"]')).toBeInViewport();
  // Each file numbers its own lines, and selecting writes the file form.
  await number(page, 2, "file-notes-py-").click();
  await expect(page).toHaveURL(`${multi}#file-notes-py-L2`);
  expect(await selected(page)).toEqual(["file-notes-py-L2"]);
  await page.goto(`${multi}#file-vault-py`);
  await expect(page.locator("#file-vault-py")).toBeInViewport();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("numbers appear only while a link's lines are on show", async ({ page }) => {
    await page.goto(single);
    await expect(number(page, 1)).toBeHidden();
    await expect(page.locator('[id="L5"]')).toHaveJSProperty("offsetHeight", await page.locator('[id="L4"]').evaluate((line) => (line as HTMLElement).offsetHeight));
    await page.goto(`${single}#L30-L31`);
    await expect(number(page, 30)).toBeVisible();
    await expect.poll(() => selected(page)).toEqual(["L30", "L31"]);
    await expect(page.locator('[id="L30"]')).toBeInViewport();
    // With numbers showing, a second tap extends to a block.
    await number(page, 30).tap();
    await expect(page).toHaveURL(`${single}#L30`);
    await number(page, 33).tap();
    await expect(page).toHaveURL(`${single}#L30-L33`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test("an old revision offers the latest and keeps the lines", async ({ page }) => {
  await page.goto(`${single}/revisions/1#L8`);
  const notice = page.getByRole("link", { name: "Revision 1 · view latest" });
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(page).toHaveURL(`${single}#L8`);
});

test("each number is a real link to its own line", async ({ page }) => {
  await page.goto(single);
  await expect(number(page, 24)).toHaveAttribute("href", "#L24");
  expect(await number(page, 24).evaluate((node) => node.tagName)).toBe("A");
  expect(await number(page, 24).evaluate((node) => getComputedStyle(node).textDecorationLine)).toBe("none");
  await page.goto(multi);
  await expect(number(page, 2, "file-vault-py-")).toHaveAttribute("href", "#file-vault-py-L2");
});

test("the selected lines can be copied as text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${single}#L4-L6`);
  const copy = page.getByRole("button", { name: "Copy lines 4 to 6", exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute("data-copied", "true");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("value_4 = 4 < 5\n\nvalue_6 = 6 < 7");
  // The two buttons never overlap each other.
  const [link, lines] = await Promise.all([
    page.getByRole("button", { name: "Copy link to lines 4 to 6" }).boundingBox(),
    copy.boundingBox()
  ]);
  expect(Math.abs(link!.x - lines!.x) >= 26 || Math.abs(link!.y - lines!.y) >= 26).toBe(true);
  await number(page, 9).click();
  await page.getByRole("button", { name: "Copy line 9", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("value_9 = 9 < 10");
});

test("a line link on a Markdown gist opens its source at those lines", async ({ page }) => {
  const markdown = "/GalleryMdLines001";
  await page.goto(markdown);
  await expect(page.locator("article.markdown-body h1")).toHaveText("Markdown lines");
  await expect(page.locator(".code-line")).toHaveCount(0);

  await page.goto(`${markdown}#L40-L42`);
  await expect(page.locator(".raw-viewer .code-line")).toHaveCount(60);
  expect(await selected(page)).toEqual(["L40", "L41", "L42"]);
  await expect(page.locator('[id="L40"]')).toHaveText("Row 40 has <b>markup</b> & an ampersand.\n");
  await expect(page.locator('[id="L40"]')).toBeInViewport();
  await expect(page.getByRole("button", { name: "View rendered file" })).toBeVisible();

  // Lines can be picked in the source like in any code file.
  await number(page, 1).click();
  await expect(page).toHaveURL(`${markdown}#L1`);

  // Going back to the rendered page drops the line address.
  await page.getByRole("button", { name: "View rendered file" }).click();
  await expect(page).toHaveURL(markdown);
  await expect(page.locator("article.markdown-body h1")).toBeVisible();
  await page.reload();
  await expect(page.locator("article.markdown-body h1")).toBeVisible();
});
