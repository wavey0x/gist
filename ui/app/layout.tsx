import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "github-markdown-css/github-markdown.css";
import { AppHeader } from "../components/AppHeader";
import "./markdown-theme.css";
import "./globals.css";
import "./syntax.css";

export const metadata: Metadata = {
  title: "Wavey Gist",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        url: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  },
  appleWebApp: {
    capable: true,
    title: "waveygist",
    statusBarStyle: "black-translucent"
  },
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
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" }
  ]
};

const themeScript = `
(() => {
  document.documentElement.dataset.js = "enabled";
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
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
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
