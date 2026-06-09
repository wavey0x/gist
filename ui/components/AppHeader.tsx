"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function AppHeader() {
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
    <header className="app-header">
      <div className="app-header-inner">
        <Link className="app-brand" href="/" aria-label="Wavey Gist home">
          <span className="brand-mark-strong">Wavey</span>
          <span className="brand-mark-light">gist</span>
        </Link>
        <nav className="app-nav" aria-label="Site">
          <Link className="app-link" href="/">
            Home
          </Link>
          <Link className="app-link" href="/list">
            List
          </Link>
          <Link className="app-link" href="/login">
            Log in
          </Link>
          <form className="app-logout-form" action="/logout" method="post">
            <button className="app-link app-link-button" type="submit">
              Log out
            </button>
          </form>
          <button
            type="button"
            className="icon-button app-theme-button"
            aria-label={`Switch to ${nextTheme} mode`}
            title={nextTheme === "dark" ? "Dark" : "Light"}
            onClick={() => applyTheme(nextTheme)}
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <Moon aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
