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

// MapLibre's worker and stylesheet are served from our own origin so the
// CSP can keep worker-src 'self' (components/MapRenderer.tsx).
const maplibreSource = new URL("../node_modules/maplibre-gl/", import.meta.url);
const maplibreTarget = new URL("../public/vendor/maplibre/", import.meta.url);
await mkdir(maplibreTarget, { recursive: true });
for (const [from, to] of [
  ["dist/maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs"],
  ["dist/maplibre-gl.css", "maplibre-gl.css"],
  ["LICENSE.txt", "LICENSE.txt"]
]) {
  await copyFile(new URL(from, maplibreSource), new URL(to, maplibreTarget));
}
