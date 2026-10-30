const THEME_COLORS = { light: "#ffffff", dark: "#0d1117" } as const;

// The status bar follows these tags, so both must match an explicit choice.
export function syncThemeColor() {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
}
