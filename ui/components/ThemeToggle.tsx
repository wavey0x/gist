"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function applyTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-button app-theme-button"
      aria-label={`Switch to ${nextTheme} mode`}
      title={nextTheme === "dark" ? "Dark" : "Light"}
      onClick={() => applyTheme(nextTheme)}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={16} strokeWidth={1.8} />
      ) : (
        <Moon aria-hidden="true" size={16} strokeWidth={1.8} />
      )}
    </button>
  );
}
