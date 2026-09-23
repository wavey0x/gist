const MARKER = /^#wg-gallery(?:=([a-z0-9-]+))?$/;
const IMAGE_PATH = /^\/api\/(?:v1\/)?images\/(img_[A-Za-z0-9_-]{16,64})$/;

export function galleryOptions(document) {
  return {
    baseUrl: document.baseURI,
    imageOrigin: document.querySelector('meta[name="wg-image-origin"]')?.content
  };
}

function imageUrl(value, options) {
  if (!value || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value, options.baseUrl);
    if (url.username || url.password) return null;
    const local = new URL(options.baseUrl).origin;
    const asset =
      IMAGE_PATH.test(url.pathname) &&
      (url.origin === local || url.origin === options.imageOrigin);
    if (url.protocol !== "https:" && !(asset && url.protocol === "http:"))
      return null;
    // Relative URLs only address the application's image routes, not page anchors.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !asset) return null;
    return url;
  } catch {
    return null;
  }
}

export function imageAsset(value, options) {
  const url = imageUrl(value, options);
  if (!url) return null;
  const match = IMAGE_PATH.exec(url.pathname);
  const local = new URL(options.baseUrl).origin;
  if (!match || (url.origin !== local && url.origin !== options.imageOrigin))
    return null;
  return {
    id: match[1],
    path: `/api/images/${match[1]}`,
    search: url.search,
    hash: url.hash
  };
}

export function parseGalleryUrl(value, options) {
  const url = imageUrl(value, options);
  if (url?.hash === "#wg-image") {
    url.hash = "";
    return { group: null, src: url.href, marker: "#wg-image" };
  }
  const match = url && MARKER.exec(url.hash);
  if (!match) return null;
  const marker = url.hash;
  url.hash = "";
  return { group: match[1] ?? "", src: url.href, marker };
}

export function collectGalleries(roots, options) {
  const groups = [];
  const triggers = new Map();
  for (const root of roots) {
    const fileGroups = new Map();
    for (const trigger of root.querySelectorAll("a[href], img[src]")) {
      const isImage = trigger.tagName === "IMG";
      if (isImage && trigger.closest("a")) continue;
      const parsed = parseGalleryUrl(
        trigger.getAttribute(isImage ? "src" : "href"),
        options
      );
      if (!parsed) continue;
      const key =
        parsed.group === null
          ? `image:${parsed.src}`
          : `gallery:${parsed.group}`;
      let group = fileGroups.get(key);
      if (!group) {
        group = { root, name: parsed.group, items: [] };
        fileGroups.set(key, group);
        groups.push(group);
      }
      const image = isImage ? trigger : trigger.querySelector("img");
      const alt = image?.getAttribute("alt")?.trim() ?? "";
      let index = group.items.findIndex((item) => item.src === parsed.src);
      if (index === -1) {
        index = group.items.length;
        group.items.push({
          src: parsed.src,
          caption:
            trigger.getAttribute("title")?.trim() ||
            alt ||
            trigger.textContent.trim(),
          alt,
          width: 0,
          height: 0
        });
      }
      const item = group.items[index];
      // A later inline reference can supply intrinsic dimensions/alt, never a thumbnail's size.
      if (image) {
        const src = imageUrl(image.getAttribute("src"), options);
        if (src) src.hash = "";
        if (src?.href === item.src) {
          item.width = image.naturalWidth || item.width;
          item.height = image.naturalHeight || item.height;
          item.alt ||= alt;
        }
      }
      triggers.set(trigger, { group, index });
    }
  }
  return { groups, triggers };
}

export function prepareGalleryImages(payload, options, DOMParserClass) {
  const imageIds = new Set();
  for (const file of Object.values(payload.files)) {
    if (file.kind !== "markdown") continue;
    const document = new DOMParserClass().parseFromString(
      file.rendered_html,
      "text/html"
    );
    for (const node of document.querySelectorAll("img[src], a[href]")) {
      const attribute = node.tagName === "IMG" ? "src" : "href";
      const value = node.getAttribute(attribute);
      if (attribute === "href" && !parseGalleryUrl(value, options)) continue;
      const asset = imageAsset(value, options);
      if (!asset) continue;
      imageIds.add(asset.id);
      node.setAttribute(attribute, asset.path + asset.search + asset.hash);
    }
    file.rendered_html = document.body.innerHTML;
  }
  return { payload, imageIds: [...imageIds] };
}
