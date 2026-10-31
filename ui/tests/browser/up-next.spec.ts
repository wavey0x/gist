import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ serviceWorkers: "block" });

const id = "GalleryAudio0001";
const endpoint = `/api/gists/${id}/revisions/1/narration`;
const audio = readFileSync(`${__dirname}/../fixtures/silence.mp3`);

type Item = {
  gist_id: string;
  title: string;
  author_name: string;
  latest_revision_number: number;
  status: "ready" | "pending" | "none";
  revision_number: number | null;
  duration_ms: number | null;
  audio_url: string | null;
  updating: boolean;
  added_at: string;
};

function item(gistId: string, title: string, extra: Partial<Item> = {}): Item {
  return {
    gist_id: gistId,
    title,
    author_name: "Field Notes",
    latest_revision_number: 1,
    status: "ready",
    revision_number: 1,
    duration_ms: 125000,
    audio_url: `/api/gists/${gistId}/revisions/1/narration/audio`,
    updating: false,
    added_at: "2026-10-31T12:00:00Z",
    ...extra
  };
}

// An in-memory stand-in for the account's saved queue.
async function mockQueue(page: Page, initial: Item[]) {
  let items = [...initial];
  const puts: string[][] = [];
  await page.route("**/api/me/listen-queue", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const { gist_ids } = request.postDataJSON() as { gist_ids: string[] };
      puts.push(gist_ids);
      const known = new Map([...initial, ...items].map((entry) => [entry.gist_id, entry]));
      items = gist_ids.map((gistId) => known.get(gistId) ?? item(gistId, gistId));
    }
    await route.fulfill({ json: { items } });
  });
  return { puts };
}

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "wg_session", value: "audio-test", url: "http://127.0.0.1:4310" }]);
  await page.route("**/api/me/offline-manifest", (route) =>
    route.fulfill({ json: { account_marker: "c".repeat(64), generated_at: new Date().toISOString(), gists: [] } })
  );
  await page.route("**/narration/audio", (route) =>
    route.fulfill({ contentType: "audio/mpeg", body: audio })
  );
});

test("up next lists the saved queue with time left and generation states", async ({ page }) => {
  await mockQueue(page, [
    item("QueueFirst000001", "First listen"),
    item("QueueSecond00001", "Being regenerated", { updating: true, latest_revision_number: 2 }),
    item("QueueThird000001", "Still generating", {
      status: "pending", revision_number: null, duration_ms: null, audio_url: null
    })
  ]);
  await page.goto("/");
  const upNext = page.getByRole("region", { name: "Up next" });
  await expect(upNext.getByText("First listen")).toBeVisible();
  await expect(upNext.getByText("2:05").first()).toBeVisible();
  await expect(upNext.getByText("Update generating")).toBeVisible();
  await expect(upNext.getByText("Generating audio…")).toBeVisible();
  await expect(upNext.getByRole("button", { name: "Play Still generating" })).toBeDisabled();
  await expect(upNext.getByText(/^3 · /)).toBeVisible();
});

test("the queue can be reordered from the grip", async ({ page }) => {
  const queue = await mockQueue(page, [
    item("QueueFirst000001", "First listen"),
    item("QueueSecond00001", "Second listen")
  ]);
  await page.goto("/");
  const upNext = page.getByRole("region", { name: "Up next" });
  await upNext.getByRole("button", { name: "Reorder First listen" }).press("ArrowDown");
  await expect.poll(() => queue.puts.at(-1)).toEqual(["QueueSecond00001", "QueueFirst000001"]);
  await expect(upNext.locator(".up-next-title").first()).toHaveText("Second listen");
});

test("playing an article puts it at the front of up next", async ({ page }) => {
  const queue = await mockQueue(page, [item("QueueFirst000001", "First listen")]);
  await page.route(`**${endpoint}`, (route) =>
    route.fulfill({ json: { status: "ready", retryable: false, audio_url: `${endpoint}/audio` } })
  );
  await page.goto(`/${id}`);
  await page.getByRole("button", { name: "Play article audio" }).click();
  await expect.poll(() => queue.puts.at(-1)).toEqual([id, "QueueFirst000001"]);
  await page.locator(".app-brand").click();
  const mini = page.getByRole("complementary", { name: "Now playing" });
  await expect(mini.getByText(/1 up next/)).toBeVisible();
  const upNext = page.getByRole("region", { name: "Up next" });
  await expect(upNext.getByRole("button", { name: /^Pause / })).toBeVisible();
});

test("removing an item can be undone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Touch screens remove by swiping.");
  const queue = await mockQueue(page, [
    item("QueueFirst000001", "First listen"),
    item("QueueSecond00001", "Second listen")
  ]);
  await page.goto("/");
  const upNext = page.getByRole("region", { name: "Up next" });
  await upNext.getByText("First listen").hover();
  await upNext.getByRole("button", { name: "Remove First listen from Up next" }).click();
  await expect.poll(() => queue.puts.at(-1)).toEqual(["QueueSecond00001"]);
  await upNext.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => queue.puts.at(-1)).toEqual(["QueueFirst000001", "QueueSecond00001"]);
});

test("dragging the grip moves an item down the queue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Pointer drag is exercised with a mouse.");
  const queue = await mockQueue(page, [
    item("QueueFirst000001", "First listen"),
    item("QueueSecond00001", "Second listen"),
    item("QueueThird000001", "Third listen")
  ]);
  await page.goto("/");
  const grip = page.getByRole("button", { name: "Reorder First listen" });
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 70, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => queue.puts.at(-1)).toEqual([
    "QueueSecond00001", "QueueThird000001", "QueueFirst000001"
  ]);
});

test("an empty queue still shows up next with a hint", async ({ page }) => {
  await mockQueue(page, []);
  await page.goto("/");
  const upNext = page.getByRole("region", { name: "Up next" });
  await expect(upNext.getByText(/Nothing queued yet/)).toBeVisible();
});
