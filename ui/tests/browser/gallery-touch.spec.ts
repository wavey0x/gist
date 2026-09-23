import { test, expect } from "@playwright/test";

test("fitted swipes navigate, pinch and double-tap zoom, enlarged drags pan, and vertical drag closes", async ({
  page,
  context
}) => {
  await page.goto("/GalleryOffline01");
  await page.locator(".wg-gallery-trigger").first().click();
  const photo = () => page.locator('.pswp__item[aria-hidden="false"] img');
  await expect(photo()).toBeVisible();
  const cdp = await context.newCDPSession(page);
  type Point = { x: number; y: number };
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: Point[]
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point, id) => ({
        ...point,
        id,
        radiusX: 2,
        radiusY: 2
      }))
    });
  async function drag(start: Point[], end: Point[]) {
    await touch("touchStart", start);
    for (let step = 1; step <= 12; step++) {
      await touch(
        "touchMove",
        start.map((point, i) => ({
          x: point.x + ((end[i].x - point.x) * step) / 12,
          y: point.y + ((end[i].y - point.y) * step) / 12
        }))
      );
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    await touch("touchEnd", []);
  }
  const viewport = page.viewportSize()!;
  const middle = viewport.height / 2;
  await drag([{ x: viewport.width - 55, y: middle }], [{ x: 45, y: middle }]);
  await expect(page.locator(".pswp__counter")).toHaveText("2 / 3");
  await expect(photo()).toBeVisible();
  const fit = await photo().evaluate((el) => el.getBoundingClientRect().width);
  await drag(
    [
      { x: viewport.width / 2 - 30, y: middle },
      { x: viewport.width / 2 + 30, y: middle }
    ],
    [
      { x: 55, y: middle },
      { x: viewport.width - 55, y: middle }
    ]
  );
  await expect
    .poll(() => photo().evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(fit * 1.5);
  const left = await photo().evaluate((el) => el.getBoundingClientRect().left);
  await drag([{ x: viewport.width - 60, y: middle }], [{ x: 55, y: middle }]);
  await expect(page.locator(".pswp__counter")).toHaveText("2 / 3");
  await expect
    .poll(() => photo().evaluate((el) => el.getBoundingClientRect().left))
    .toBeLessThan(left - 50);
  await page.getByRole("button", { name: "Zoom", exact: true }).click();
  await expect
    .poll(() => photo().evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThan(fit + 2);
  await page.touchscreen.tap(viewport.width / 2, middle);
  await page.touchscreen.tap(viewport.width / 2, middle);
  await expect
    .poll(() => photo().evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(fit * 1.5);
  await page.getByRole("button", { name: "Zoom", exact: true }).click();
  await expect
    .poll(() => photo().evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThan(fit + 2);
  await drag(
    [{ x: viewport.width / 2, y: middle }],
    [{ x: viewport.width / 2, y: middle + 260 }]
  );
  await expect(page.locator(".pswp")).toHaveCount(0);
  await expect(page.locator(".wg-gallery-trigger").first()).toBeFocused();
});
