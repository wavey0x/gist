// Rebuilds the installed-app launch images from the theme background colors in
// lib/theme-color.ts. Run after changing those colors:
//   node scripts/generate-launch-screens.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const colors = Object.fromEntries(
  [...read("lib/theme-color.ts").matchAll(/(light|dark): "(#[0-9a-f]{6})"/g)].map(
    ([, scheme, color]) => [scheme, color]
  )
);
const screens = [
  ...read("app/layout.tsx")
    .match(/const LAUNCH_SCREENS = \[([\s\S]*?)\] as const/)[1]
    .matchAll(/\[(\d+), (\d+), (\d+)\]/g)
].map(([, width, height, scale]) => [width * scale, height * scale]);
if (!colors.light || !colors.dark || !screens.length) {
  throw new Error("Could not read the theme colors or launch screen sizes.");
}

const icon = await sharp(fileURLToPath(new URL("public/icons/icon-512.png", root)))
  .resize(360, 360)
  .toBuffer();
for (const [width, height] of screens) {
  for (const [scheme, background] of Object.entries(colors)) {
    await sharp({ create: { width, height, channels: 3, background } })
      .composite([{ input: icon, gravity: "center" }])
      .png({ compressionLevel: 9, palette: true })
      .toFile(
        fileURLToPath(new URL(`public/icons/launch-${width}x${height}-${scheme}.png`, root))
      );
  }
}
console.log(`Wrote ${screens.length * 2} launch screens.`);
