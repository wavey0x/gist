import http from "node:http";
import sharp from "sharp";

const origin = "http://127.0.0.1:4311";
const image = (number) =>
  `${origin}/api/v1/images/img_${String(number).padStart(16, "0")}`;
const mark = (
  number,
  fragment = "wg-gallery=album",
  title = `Photo ${number}`
) =>
  `<a href="${image(number)}#${fragment}" title="${title}">${String(number).padStart(2, "0")}</a>`;
const album = `<h1 id="gallery-test">Field notes</h1><p>Read the numbered photo references without leaving the article.</p>${"<p>We followed the path beside the lake and made these notes along the way.</p>".repeat(12)}<p id="references">${mark(1)} · ${mark(2)} · ${mark(3)}</p><p>${mark(2, "wg-gallery=album", "A duplicate title")}</p><p>Individual previews: ${mark(1, "wg-image", "Standalone lake")} · ${mark(2, "wg-image", "Standalone cabin")}</p><p><img src="${image(1)}#wg-gallery=album" alt="Lake at dawn" title="Inline lake" width="320"></p><p><a href="${image(3)}#wg-gallery=album" title="Full-size landscape"><img src="${image(4)}" alt="Landscape thumbnail" width="200"></a></p><p><a href="${image(2)}"><img src="${image(1)}#wg-gallery=album" width="180" alt="Ordinary linked image"></a></p><p><a href="https://images.example.test/external.png#wg-image" title="External image">External</a> · <a href="${image(9)}#wg-image" title="Missing image">Broken</a></p>${"<p>Continue reading the notes here.</p>".repeat(18)}`;
const filesFor = (id) =>
  id === "GalleryLongText1"
    ? {
        "README.md": `<h1>Long caption</h1><p>${mark(1, "wg-image", "Lake at dawn. ".repeat(75))}</p>`
      }
    : id === "GallerySingle001"
      ? {
          "README.md": `<h1>Photo references</h1><p>${mark(1, "wg-image", "Standalone lake")} · ${mark(2, "wg-image", "Standalone cabin")}</p>`
        }
      : id === "GalleryOffline01"
        ? {
            "README.md": `<h1>Saved album</h1><p>${mark(1)} · ${mark(2)} · ${mark(3)}</p><p>${mark(1, "wg-image", "Standalone lake")}</p>`
          }
        : {
            "README.md": album,
            "appendix.md": `<h1>Separate file</h1><p>${mark(5, "wg-gallery=album", "Separate photo")}</p>`
          };
export function fixture(id, revision = 1) {
  const files = Object.fromEntries(
    Object.entries(filesFor(id)).map(([filename, rendered_html]) => [
      filename,
      {
        filename,
        kind: "markdown",
        language: "markdown",
        content: `# Gallery\n\n[Photo](${image(1)}#wg-gallery=album)`,
        rendered_html,
        content_sha256: "b".repeat(64),
        byte_size: 100,
        raw_url: `/${id}/raw`
      }
    ])
  );
  for (const file of Object.values(files))
    file.byte_size = Buffer.byteLength(file.content);
  return {
    id,
    url: `http://127.0.0.1:4310/${id}`,
    title: "Field notes",
    display_title: "Field notes",
    author_name: "Field Notes",
    primary_file: "README.md",
    snapshot_sha256: "a".repeat(64),
    revision_number: revision,
    latest_revision_number: 2,
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z",
    files,
    history: [2, 1].map((revision_number) => ({
      revision_number,
      created_at: "2026-09-01T12:00:00Z",
      author_name: "Field Notes",
      snapshot_sha256: "a".repeat(64),
      file_count: Object.keys(files).length,
      is_latest: revision_number === 2,
      url: `/${id}/revisions/${revision_number}`
    }))
  };
}
const colors = ["#84b7c8", "#bd9a77", "#6c8f79", "#c3b998", "#9288b6"];
const images = await Promise.all(
  colors.map((color, index) =>
    sharp(
      Buffer.from(
        `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1000" fill="${color}"/><path d="M0 900L400 200 850 800 1150 400 1600 850V1000H0" fill="#344755"/><text x="100" y="140" font-family="sans-serif" font-size="70" fill="white">Photo ${index + 1}</text></svg>`
      )
    )
      .png()
      .toBuffer()
  )
);
let failedImage = 0;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const respond = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === "/health") return respond(200, { ok: true });
    if (url.pathname === "/fail-next-image") {
      failedImage = Number(url.searchParams.get("id"));
      return respond(200, { ok: true });
    }
    const match = url.pathname.match(/^\/api\/v1\/images\/img_(\d+)$/);
    if (match) {
      const n = Number(match[1]);
      if (n === failedImage) {
        failedImage = 0;
        return respond(503, { error: "temporary" });
      }
      const bytes = images[n - 1];
      if (!bytes) return respond(404, {});
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600"
      });
      res.end(bytes);
      return;
    }
    const gist = url.pathname.match(
      /^\/api\/v1\/gists\/(Gallery[A-Za-z0-9]+)(?:\/revisions\/(\d+))?\/render$/
    );
    if (gist) return respond(200, fixture(gist[1], Number(gist[2] || 1)));
    if (url.pathname.includes("/narration")) return respond(404, {});
    respond(401, { error: { code: "unauthorized", message: "Log in" } });
  })
  .listen(4311, "127.0.0.1");
