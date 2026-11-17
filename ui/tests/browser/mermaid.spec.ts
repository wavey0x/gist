import { test, expect } from "@playwright/test";

const diagrams = (page: import("@playwright/test").Page) =>
  page.locator(".markdown-body .js-mermaid-render");

for (const colorScheme of ["light", "dark"] as const) {
  test(`diagrams render in the reader style, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/GalleryMermaid01");
    for (const diagram of await diagrams(page).all()) {
      await expect(diagram).toHaveAttribute("data-mermaid-state", "rendered");
    }

    const flow = diagrams(page).nth(0);
    // Nodes step through the tints down the flow; the back edge changes nothing.
    const tones = await flow.locator("g.node").evaluateAll((nodes) =>
      nodes.map((node) => [...node.classList].find((name) => name.startsWith("tone-")))
    );
    expect(tones).toEqual(["tone-1", "tone-2", "tone-3", "tone-4", "tone-4", "tone-5"]);
    await expect(flow.locator("g.node > rect.label-container").first()).toHaveAttribute("rx", "10");

    // Edge labels sit on the page color and never overlap each other.
    const labels = await flow.locator("g.edgeLabel .labelBkg").evaluateAll((nodes) =>
      nodes
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0)
        .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }))
    );
    expect(labels.length).toBe(6);
    for (const [index, a] of labels.entries()) {
      for (const b of labels.slice(index + 1)) {
        const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps).toBe(false);
      }
    }
    const [labelBackground, pageBackground] = await page.evaluate(() => [
      getComputedStyle(document.querySelector(".markdown-body g.edgeLabel .labelBkg")!).backgroundColor,
      getComputedStyle(document.body).backgroundColor
    ]);
    expect(labelBackground).toBe(pageBackground);

    // Author color names win, and switch the automatic tints off.
    const marked = diagrams(page).nth(1);
    await expect(marked.locator("g.node[class*='tone-']")).toHaveCount(0);
    const fills = await marked.locator("g.node > rect").evaluateAll((rects) =>
      rects.map((rect) => getComputedStyle(rect).fill)
    );
    expect(new Set(fills).size).toBe(4);
  });
}

test("diagrams fit a phone screen without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/GalleryMermaid01");
  await expect(diagrams(page).nth(0)).toHaveAttribute("data-mermaid-state", "rendered");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
