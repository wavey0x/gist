import http from "node:http";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const origin = "http://127.0.0.1:4311";
const audio = readFileSync(new URL("./fixtures/silence.mp3", import.meta.url));
const offlineAudioId = "GalleryAudioOffline01";
const audioPath = `/api/v1/gists/${offlineAudioId}/revisions/1/narration`;
const image = (number) =>
  `${origin}/api/v1/images/img_${String(number).padStart(16, "0")}`;
const mark = (
  number,
  fragment = "wg-gallery=album",
  title = `Photo ${number}`
) =>
  `<a href="${image(number)}#${fragment}" title="${title}">${String(number).padStart(2, "0")}</a>`;
const album = `<h1 id="gallery-test">Field notes</h1><p>Read the numbered photo references without leaving the article.</p>${"<p>We followed the path beside the lake and made these notes along the way.</p>".repeat(12)}<p id="references">${mark(1)} · ${mark(2)} · ${mark(3)}</p><p>${mark(2, "wg-gallery=album", "A duplicate title")}</p><p>Individual previews: ${mark(1, "wg-image", "Standalone lake")} · ${mark(2, "wg-image", "Standalone cabin")}</p><p><img src="${image(1)}#wg-gallery=album" alt="Lake at dawn" title="Inline lake" width="320"></p><p><a href="${image(3)}#wg-gallery=album" title="Full-size landscape"><img src="${image(4)}" alt="Landscape thumbnail" width="200"></a></p><p><a href="${image(2)}"><img src="${image(1)}#wg-gallery=album" width="180" alt="Ordinary linked image"></a></p><p><a href="https://images.example.test/external.png#wg-image" title="External image">External</a> · <a href="${image(9)}#wg-image" title="Missing image">Broken</a></p>${"<p>Continue reading the notes here.</p>".repeat(18)}`;
const longCodeValue = "abcdefghij".repeat(35);
const longCodeLine = `const value = "${longCodeValue}";`;
const highlightedCode = `<div class="highlight highlight-source-js" dir="auto"><pre><span class="pl-k">const</span> value = "${longCodeValue}";\n\n\t&lt;tag&gt; &amp; \`literal\` $(text)\n</pre></div>`;
const longPatchLine = `+MIN_A: constant(uint256) = ${"N_CONS*N_CONS*".repeat(24)}`;
const highlightedPatch = `<div class="highlight highlight-source-diff" dir="auto"><pre>diff --git a/example.vy b/example.vy\n<span class="pl-mi1">${longPatchLine}</span></pre></div>`;
const longParagraph = (figure) =>
  `The lender market holds ${figure} of available cash against outstanding debt, ${"and the remaining allocation stays idle until governance acts on it, ".repeat(6)}which is why the plan starts here.`;
const diffTable = (debt) =>
  ["| Market | Debt | Cash |", "| --- | ---: | ---: |", `| cbBTC mint | ${debt} | 48.08m |`, "| sfrxUSD | 4.16m | 1.35m |"].join("\n");
const unchangedLines = Array.from({ length: 12 }, (_, index) => `Unchanged line ${index + 1}.`).join("\n\n");
// One gist whose content differs per revision, to exercise the diff view.
const diffContent = (filename, revision) =>
  filename === "calc.py"
    ? `def total(values):\n    result = 0\n    for value in values:\n        result += ${revision === 1 ? "value" : "value * 2"}\n    return result\n\nLIMIT = "${"x".repeat(revision === 1 ? 200 : 220)}"\n`
    : [
        revision === 1 ? "# Oracle markets: prioritized remediation" : "# Oracle markets: containment and migration",
        longParagraph(revision === 1 ? "1.93m" : "1.88m"),
        revision === 1 ? "Start with the lender exit." : "A freeze stops new principal; it does not repair the oracle at all.",
        unchangedLines,
        diffTable(revision === 1 ? "1.93m" : "1.88m"),
        ...(revision === 3 ? ["Added in the third revision."] : [])
      ].join("\n\n") + "\n";
// A code file for line links: 80 lines with an empty line (5), a docstring
// whose colour span crosses three lines (10 to 12) and one long line (20).
const lineSource = Array.from({ length: 80 }, (_, index) => {
  const n = index + 1;
  if (n === 5) return "";
  if (n === 10) return '"""Docstring opens';
  if (n === 11) return "and continues";
  if (n === 12) return 'then closes."""';
  if (n === 20) return `long_${n} = "${"wide value ".repeat(40)}"`;
  return `value_${n} = ${n} < ${n + 1}`;
});
const lineHtml = lineSource.map((line, index) => {
  const n = index + 1;
  const safe = line.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  if (n === 10) return `<span class="pl-s">${safe}`;
  if (n === 12) return `${safe}</span>`;
  if (n >= 10 && n <= 12) return safe;
  return safe.replace(/^(\w+)/, '<span class="pl-v">$1</span>');
}).join("\n");
const highlightedLines = `<div class="highlight highlight-source-python" dir="auto"><pre>${lineHtml}\n</pre></div>`;
const filesFor = (id) =>
  id === "GalleryDiff00001"
    ? { "README.md": "<h1>Oracle markets</h1><p>Diff fixture.</p>", "calc.py": "<pre>def total(values): ...</pre>" }
    : id === "GalleryDiffProse1"
    ? { "README.md": "<h1>Oracle markets</h1><p>Diff fixture.</p>" }
    : id === "GalleryTable0001"
    ? {
        "README.md": '<h1>Priority actions</h1><div class="table-scroll"><table><thead><tr><th>Priority</th><th>Market</th><th>Metrics</th><th>Recommended steps, in order</th></tr></thead><tbody>' +
          [1, 2, 3].map((n) => `<tr><td>${n}</td><td><a href="#m${n}">sUSDe-long-v2 — protocol LLv1</a></td><td><strong>Debt:</strong> 1.93m<br><strong>Liq:</strong> $48.07m<br><strong>Oracle:</strong> $1.32m</td><td><strong>1. eDAO:</strong> Set the mint ceiling to zero, burning unused allocation.<br><strong>2. DAO governance, with engineering:</strong> Approve a reviewed replacement addressing pricing, after rechecking feed health and the peg, and monitor independent prices and feed freshness because the bound can mask a depeg.</td></tr>`).join("") +
          "</tbody></table></div>"
      }
    : id === "GalleryLines00001"
    ? { "vault.py": highlightedLines }
    : id === "GalleryMdLines001"
    ? { "README.md": "<h1>Markdown lines</h1>" + "<p>Rendered paragraph.</p>".repeat(30) }
    : id === "GalleryLinesMulti1"
    ? {
        "README.md": '<h1>Line links</h1><p><a href="#file-vault-py-L3-L4">The check</a></p>' + "<p>Filler paragraph.</p>".repeat(40),
        "notes.py": "<pre><code class=\"language-text\">first note\nsecond note\nthird note\n</code></pre>",
        "vault.py": highlightedLines
      }
    : id === "GalleryRawFiles01"
    ? {
        "README.md": '<h1>Raw files</h1><p><a href="/GalleryRawFiles01/revisions/1/raw/data%20sample.json">JSON source</a></p>',
        "data sample.json": '<pre>{"message":"Raw stays raw"}</pre>'
      }
    : id === "GalleryReading01"
    ? { "README.md": readFileSync(new URL("./fixtures/reading.html", import.meta.url), "utf8") }
    : id.startsWith("GalleryAudio")
    ? { "README.md": `<h1>Audio article</h1>${"<p>Keep reading this article while its narration plays.</p>".repeat(100)}` }
    : id === "GalleryCodeWrap01"
    ? { "README.md": `<h1>Code wrapping</h1>${highlightedCode}<pre><code>${longCodeLine}</code></pre>` }
    : id === "GalleryCodePatch01"
    ? { "twocrypto-math.patch": highlightedPatch }
    : id === "GalleryCodePanel01" || id === "GalleryLayout001"
    ? {
        "README.md": `<h1>Code wrapping</h1>${highlightedCode}`,
        "twocrypto-math.patch": highlightedPatch
      }
    : id === "GalleryLongText1"
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
const markdownLineSource =
  "# Markdown lines\n\n" +
  Array.from({ length: 58 }, (_, index) => `Row ${index + 3} has <b>markup</b> & an ampersand.`).join("\n") +
  "\n";

export function fixture(id, revision = 1) {
  const files = Object.fromEntries(
    Object.entries(filesFor(id)).map(([filename, rendered_html]) => [
      filename,
      {
        filename,
        kind: /\.(patch|json|py)$/.test(filename) ? "source" : "markdown",
        language: filename.endsWith(".patch") ? "diff" : filename.endsWith(".json") ? "json" : "markdown",
        content: id.startsWith("GalleryDiff") ? diffContent(filename, revision) :
          filename.endsWith(".json") ? '{"message":"Raw stays raw"}\n' :
          id === "GalleryMdLines001" ? markdownLineSource :
          filename === "vault.py" ? lineSource.join("\n") + "\n" :
          filename === "notes.py" ? "first note\nsecond note\nthird note\n" :
          filename.endsWith(".patch") ? `diff --git a/example.vy b/example.vy\n${longPatchLine}\n` :
          id === "GalleryCodeWrap01" ? `# Code wrapping\n\n\`\`\`js\n${longCodeLine}\n\`\`\`` :
          `# Gallery\n\n[Photo](${image(1)}#wg-gallery=album)`,
        rendered_html,
        content_sha256: "b".repeat(64),
        byte_size: 100,
        raw_url: `/${id}/revisions/${revision}/raw/${encodeURIComponent(filename)}`
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
    primary_file: Object.keys(files)[0],
    snapshot_sha256: "a".repeat(64),
    revision_number: revision,
    latest_revision_number: id.startsWith("GalleryDiff") ? 3 : 2,
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z",
    files,
    history: (id.startsWith("GalleryDiff") ? [3, 2, 1] : [2, 1]).map((revision_number) => ({
      revision_number,
      created_at: "2026-09-01T12:00:00Z",
      author_name: "Field Notes",
      snapshot_sha256: "a".repeat(64),
      file_count: Object.keys(files).length,
      is_latest: revision_number === (id.startsWith("GalleryDiff") ? 3 : 2),
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
    if (url.pathname === "/api/v1/me/notification-settings" && req.headers.cookie === "wg_session=audio-test") {
      return respond(200, { available: false, new_gist: false, edited_gist: false });
    }
    if (url.pathname === "/api/v1/auth/session" && req.headers.cookie === "wg_session=audio-test") {
      return respond(200, {
        name: "Audio Test", key: "test-key", key_prefix: "test",
        can_generate_audio: true
      });
    }
    if (url.pathname === "/api/v1/me/gists" && req.headers.cookie === "wg_session=audio-test") {
      return respond(200, {
        query: null,
        gists: [],
        pagination: { limit: 20, offset: 0, total: 0, next_offset: null },
        stats: { gist_count: 0, revision_count: 0, last_updated_at: null }
      });
    }
    if (url.pathname === "/api/v1/me/offline-manifest" && req.headers.cookie === "wg_session=audio-test") {
      return respond(200, {
        account_marker: "c".repeat(64), generated_at: new Date().toISOString(),
        gists: [{
          id: offlineAudioId, revision_number: 1, owned: true,
          snapshot_sha256: "a".repeat(64), display_title: "Audio article",
          author_name: "Field Notes", updated_at: "2026-09-02T12:00:00Z",
          narration: { etag: "d".repeat(64), byte_size: audio.length }
        }]
      });
    }
    if (url.pathname === audioPath) {
      return respond(200, {
        status: "ready", retryable: false,
        audio_url: `/api/gists/${offlineAudioId}/revisions/1/narration/audio`
      });
    }
    if (url.pathname === `${audioPath}/audio`) {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length });
      return res.end(audio);
    }
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
    if (gist) {
      // Let the saved preview paint before the live response in layout tests.
      if (gist[1] === "GalleryLayout001") await new Promise((resolve) => setTimeout(resolve, 2500));
      return respond(200, fixture(gist[1], Number(gist[2] || 1)));
    }
    if (url.pathname.includes("/narration")) return respond(404, {});
    respond(401, { error: { code: "unauthorized", message: "Log in" } });
  })
  .listen(4311, "127.0.0.1");
