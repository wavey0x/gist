import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "github-markdown-css/github-markdown.css";
import { AppHeader } from "../components/AppHeader";
import "./markdown-theme.css";
import "./globals.css";
import "./syntax.css";

export const metadata: Metadata = {
  title: "Wavey Gist",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false
    }
  }
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1
};

const themeScript = `
(() => {
  try {
    const saved = localStorage.getItem("theme");
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const theme = saved === "light" || saved === "dark" ? saved : preferred;
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
