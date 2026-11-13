// The page background in each theme. Must match --bg in public/app.css;
// tests/design-tokens.test.mjs checks every copy, including the launch images
// that scripts/generate-launch-screens.mjs builds from these values.
export const THEME_COLORS = { light: "#fafafa", dark: "#111212" } as const;

// The status bar follows these tags, so both must match an explicit choice.
export function syncThemeColor() {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
}
