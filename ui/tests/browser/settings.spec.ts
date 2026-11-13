import { test, expect, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.context().addCookies([
    { name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }
  ]);
  await page.goto("/me");
}

test("settings shows every section without opening anything", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  for (const name of ["Offline", "Notifications", "Your gists"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator("details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Offline library" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Notifications on this device" })).toBeDisabled();
  await expect(page.getByText("Export", { exact: true })).toBeVisible();
});

test("the API key button is labelled and confirms the copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSettings(page);
  await page.route("**/api/me/key", (route) => route.fulfill({ json: { key: "wg_test_key" } }));
  const copy = page.getByRole("button", { name: "Copy key" });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("wg_test_key");
  await expect(copy).toBeVisible();
});

test("clearing offline content asks first", async ({ page }) => {
  await openSettings(page);
  const clear = page.getByRole("button", { name: "Clear offline content" });
  await expect(clear).toBeEnabled({ timeout: 15000 });
  await clear.click();
  const dialog = page.getByRole("dialog", { name: "Clear offline content?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // Cancelling leaves the library on and its content in place.
  await expect(page.getByRole("switch", { name: "Offline library" })).toHaveAttribute("aria-checked", "true");
  await expect(clear).toBeEnabled();
});

test("settings fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Copy key" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
