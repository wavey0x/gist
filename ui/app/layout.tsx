import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import { AppHeader } from "../components/AppHeader";
import { MiniPlayer } from "../components/MiniPlayer";
import { PwaRuntime } from "../components/PwaRuntime";
import { resolveApiBaseUrl } from "../lib/api-base";
import { THEME_COLORS } from "../lib/theme-color";

const LAUNCH_SCREENS = [
  [375, 667, 2],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [430, 932, 3],
  [440, 956, 3]
] as const;

function resolveMetadataBase() {
  return new URL(
    process.env.GIST_SITE_BASE_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://gist.wavey.info"
        : "http://localhost:3000")
  );
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
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
    statusBarStyle: "black-translucent",
    startupImage: LAUNCH_SCREENS.flatMap(([width, height, scale]) =>
      (["light", "dark"] as const).map((scheme) => ({
        url: `/icons/launch-${width * scale}x${height * scale}-${scheme}.png`,
        media:
          `(device-width: ${width}px) and (device-height: ${height}px) and ` +
          `(-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait) and ` +
          `(prefers-color-scheme: ${scheme})`
      }))
    )
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
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark }
  ]
};

// Painted before any stylesheet so launching never flashes the wrong color.
const launchBackground =
  `html{background:${THEME_COLORS.light}}` +
  `@media (prefers-color-scheme:dark){html:not([data-theme=light]){background:${THEME_COLORS.dark}}}` +
  `html[data-theme=dark]{background:${THEME_COLORS.dark}}`;

const themeScript = `
(() => {
  document.documentElement.dataset.js = "enabled";
  try {
    // Lets the server group lists by the reader's own calendar days.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) document.cookie = "wg_tz=" + encodeURIComponent(zone) + ";path=/;max-age=31536000;samesite=lax";
  } catch {}
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
        <meta name="wg-image-origin" content={new URL(resolveApiBaseUrl()).origin} />
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
        <link rel="stylesheet" href="/github-markdown.css" />
        <link rel="stylesheet" href="/markdown-theme.css" />
        <link rel="stylesheet" href="/app.css" />
        <link rel="stylesheet" href="/syntax.css" />
        <link rel="stylesheet" href="/vendor/photoswipe/photoswipe.css" />
        <link rel="stylesheet" href="/gallery-viewer.css" />
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: launchBackground }} />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <PwaRuntime />
        <AppHeader />
        {children}
        <MiniPlayer />
      </body>
    </html>
  );
}
