import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../node_modules/photoswipe/", import.meta.url);
const target = new URL("../public/vendor/photoswipe/", import.meta.url);
await mkdir(target, { recursive: true });
for (const [from, to] of [
  ["dist/photoswipe.esm.js", "photoswipe.esm.js"],
  ["dist/photoswipe.css", "photoswipe.css"],
  ["LICENSE", "LICENSE"]
]) {
  await copyFile(new URL(from, source), new URL(to, target));
}
