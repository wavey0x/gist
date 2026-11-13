import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("public/app.css");
// The foundations are the two blocks before the first ordinary rule.
const foundationsEnd = app.indexOf("\n* {");
const foundations = app.slice(0, foundationsEnd);
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;

function token(theme, name) {
  const block = foundations.split(':root[data-theme="dark"]')[theme === "dark" ? 1 : 0];
  return block.match(new RegExp(`${name}: (#[0-9a-f]{6});`))?.[1];
}

const themeColors = Object.fromEntries(
  [...read("lib/theme-color.ts").matchAll(/(light|dark): "(#[0-9a-f]{6})"/g)].map(
    ([, theme, color]) => [theme, color]
  )
);

test("styles below the foundations use variables, never raw colors", () => {
  for (const [name, css] of [
    ["app.css", app.slice(foundationsEnd)],
    ["offline-shell.css", read("public/offline-shell.css")]
  ]) {
    const lines = css.split("\n").filter((line) => line.match(RAW_COLOR));
    assert.deepEqual(lines, [], `${name} has raw colors; add or reuse a variable`);
  }
});

test("each rule keeps to the shared radii", () => {
  const radii = new Set(
    [...app.slice(foundationsEnd).matchAll(/border-radius: ([^;]+);/g)].map(([, value]) => value)
  );
  for (const value of radii) {
    assert.match(value, /^(0|50%|inherit|(var\(--r-(sm|md|lg|xl|full)\)|0)( (var\(--r-(sm|md|lg|xl|full)\)|0))*)$/, value);
  }
});

test("every copy of the page background matches the --bg variable", async () => {
  for (const theme of ["light", "dark"]) {
    assert.equal(themeColors[theme], token(theme, "--bg"));
    const [r, g, b] = await sharp(
      new URL(`../public/icons/launch-1170x2532-${theme}.png`, import.meta.url).pathname
    ).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer();
    const pixel = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    assert.equal(pixel, themeColors[theme], "run scripts/generate-launch-screens.mjs");
  }
  assert.ok(read("public/offline-shell.html").includes(`content="${themeColors.dark}"`));
  const shell = read("public/offline-shell.js");
  assert.ok(shell.includes(`"${themeColors.dark}" : "${themeColors.light}"`));
});
