import { ImageResponse } from "next/og";

export const GIST_SOCIAL_IMAGE_ALT = "Wavey Gist title preview";
export const GIST_SOCIAL_IMAGE_SIZE = {
  width: 1200,
  height: 630
};

const FALLBACK_TITLE = "waveygist";
const MAX_TITLE_LENGTH = 180;

function normalizeTitle(value: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim() || FALLBACK_TITLE;
  const characters = Array.from(normalized);

  if (characters.length <= MAX_TITLE_LENGTH) {
    return normalized;
  }

  return `${characters.slice(0, MAX_TITLE_LENGTH - 1).join("")}…`;
}

function titleFontSize(title: string) {
  const length = Array.from(title).length;
  if (length <= 48) {
    return 88;
  }
  if (length <= 96) {
    return 68;
  }
  return 54;
}

export function renderGistSocialImage(value: string | null) {
  const title = normalizeTitle(value);

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0d1117",
          color: "#f0f6fc",
          display: "flex",
          height: "100%",
          padding: "96px",
          width: "100%"
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "sans-serif",
            fontSize: titleFontSize(title),
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            overflowWrap: "anywhere",
            width: "100%"
          }}
        >
          {title}
        </div>
      </div>
    ),
    GIST_SOCIAL_IMAGE_SIZE
  );
}
