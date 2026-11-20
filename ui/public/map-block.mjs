// ```map fences: a small list of places with coordinates, drawn as an
// interactive map. Shared by the app (lib/gists.ts, components/MapRenderer)
// and the offline shell, so it has no dependencies and works on strings.
//
// The fence body is either a YAML-style list or JSON (an array of places,
// an object with `places`, or GeoJSON points):
//
//   title: Santa Fe
//   places:
//     - name: Residence Inn
//       lat: 35.66843
//       lng: -105.95932
//       group: hotel
//     - name: Meow Wolf
//       at: 35.65429, -105.99583
//       group: Activities
//       label: 2
//       note: Immersive art · allow 2 hours.
//       link: "#2-meow-wolf--house-of-eternal-return"
//
// Coordinates are written by the author (or agent) up front, so rendering
// never calls a geocoder.

export const MAP_MAX_PLACES = 300;
export const MAP_MAX_SOURCE_CHARS = 60000;

// Fill colours for pins and legend dots, chosen to read on both the light
// and the dark basemap. Index 0 is reserved for the hotel/base pin, which
// is drawn in ink instead (see MAP_BASE_GROUP).
export const MAP_GROUP_COLORS = [
  "#2563eb",
  "#e8590c",
  "#2b8a3e",
  "#7048e8",
  "#d6336c",
  "#0c8599",
  "#c08a00",
  "#5c677d"
];
export const MAP_BASE_COLOR = { light: "#171717", dark: "#f2f2f2" };

const BASE_GROUP_RE = /^(hotel|hotels|stay|lodging|accommodation|home|base|airbnb|hostel)$/i;
const KEYWORD_COLORS = [
  [/^(activit|see|sight|do\b|things|museum|attraction|culture|art)/i, 0],
  [/^(food|eat|drink|restaurant|bar|cafe|café|coffee|dining|dinner|lunch|breakfast)/i, 1],
  [/^(nature|park|hike|hiking|outdoor|trail|beach|view)/i, 2],
  [/^(shop|shopping|store|market)/i, 3],
  [/^(night|music|show|theat|entertain)/i, 4]
];

const LAT_KEYS = ["lat", "latitude"];
const LNG_KEYS = ["lng", "lon", "long", "longitude"];
const PAIR_KEYS = ["at", "coords", "coordinates", "location", "position", "latlng"];
const LIST_KEYS = new Set(["places", "pins", "markers", "points", "stops"]);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeHtml(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unquote(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  // A " # " starts a trailing comment in unquoted values.
  return value.replace(/\s+#\s.*$/, "").trim();
}

function parseKeyValue(text) {
  const match = /^([A-Za-z_][\w -]*?)\s*:(?:\s+(.*))?$/.exec(text);
  if (!match) return null;
  return [match[1].trim().toLowerCase(), match[2] === undefined ? "" : unquote(match[2])];
}

// A forgiving subset of YAML: top-level `key: value` options, and a list of
// places (`- key: value` items with indented continuation lines), either at
// the top level or under `places:`.
function parseYamlish(source) {
  const options = {};
  const items = [];
  let current = null;
  let itemIndent = -1;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (line.startsWith("- ") || line === "-") {
      current = {};
      items.push(current);
      itemIndent = indent;
      const rest = line.slice(1).trim();
      if (rest) {
        const pair = parseKeyValue(rest);
        if (pair) current[pair[0]] = pair[1];
        else current.name = unquote(rest);
      }
      continue;
    }

    const pair = parseKeyValue(line);
    if (!pair) continue;
    if (current && indent > itemIndent) {
      current[pair[0]] = pair[1];
      continue;
    }
    current = null;
    if (!LIST_KEYS.has(pair[0])) options[pair[0]] = pair[1];
  }
  return { options, items };
}

function fromJson(data) {
  if (Array.isArray(data)) return { options: {}, items: data };
  if (!data || typeof data !== "object") return null;
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    const { features, type, ...options } = data;
    return { options, items: features.map(fromFeature) };
  }
  if (data.type === "Feature") return { options: {}, items: [fromFeature(data)] };
  const listKey = Object.keys(data).find((key) => LIST_KEYS.has(key.toLowerCase()));
  if (listKey && Array.isArray(data[listKey])) {
    const { [listKey]: items, ...options } = data;
    return { options, items };
  }
  return null;
}

function fromFeature(feature) {
  const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const properties = feature?.properties && typeof feature.properties === "object"
    ? feature.properties
    : {};
  return Array.isArray(coordinates)
    ? { ...properties, lng: coordinates[0], lat: coordinates[1] }
    : properties;
}

function lowerKeys(item) {
  const out = {};
  if (!item || typeof item !== "object") return out;
  for (const [key, value] of Object.entries(item)) out[key.toLowerCase()] = value;
  return out;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Number(value.trim());
}

function firstKey(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== "") return item[key];
  }
  return undefined;
}

function coordinatesOf(item) {
  let lat = toNumber(firstKey(item, LAT_KEYS));
  let lng = toNumber(firstKey(item, LNG_KEYS));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const pair = firstKey(item, PAIR_KEYS);
    const parts = Array.isArray(pair)
      ? pair
      : typeof pair === "string"
        ? pair.replace(/^\[|\]$/g, "").split(/[,\s]+/).filter(Boolean)
        : [];
    if (parts.length === 2) {
      lat = toNumber(String(parts[0]));
      lng = toNumber(String(parts[1]));
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function text(value, max) {
  if (value === undefined || value === null) return "";
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function safeLink(value) {
  const link = text(value, 2000);
  if (!link) return "";
  if (link.startsWith("#")) return link;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function isBaseGroup(group) {
  return BASE_GROUP_RE.test(String(group || "").trim());
}

// Parses a fence body into { title, places, groups, skipped } or returns
// null when nothing in it can be placed on a map.
export function parseMapBlock(source) {
  const body = String(source ?? "");
  if (!body.trim() || body.length > MAP_MAX_SOURCE_CHARS) return null;

  let parsed = null;
  const trimmed = body.trim();
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try {
      parsed = fromJson(JSON.parse(trimmed));
    } catch {
      parsed = null;
    }
  }
  parsed ??= parseYamlish(body);
  if (!parsed) return null;

  const options = lowerKeys(parsed.options);
  const places = [];
  let skipped = 0;
  for (const raw of parsed.items.slice(0, MAP_MAX_PLACES)) {
    const item = lowerKeys(raw);
    const point = coordinatesOf(item);
    if (!point) {
      skipped += 1;
      continue;
    }
    places.push({
      ...point,
      name: text(firstKey(item, ["name", "title"]), 120) || `Place ${places.length + 1}`,
      group: text(firstKey(item, ["group", "type", "category", "kind"]), 40),
      label: text(firstKey(item, ["label", "number", "n"]), 3),
      note: text(firstKey(item, ["note", "description", "desc", "notes"]), 280),
      address: text(item.address, 160),
      link: safeLink(firstKey(item, ["link", "url", "href"])),
      directions: safeLink(firstKey(item, ["directions", "maps"]))
    });
  }
  skipped += Math.max(0, parsed.items.length - MAP_MAX_PLACES);
  if (!places.length) return null;

  // Colour each group: the hotel/base group is ink; familiar groups keep a
  // stable colour; anything else takes the next unused colour.
  const groups = [];
  const used = new Set();
  for (const place of places) {
    const key = place.group.toLowerCase();
    if (groups.some((group) => group.key === key)) continue;
    groups.push({ key, name: place.group, base: isBaseGroup(place.group), color: -1 });
  }
  for (const group of groups) {
    if (group.base) continue;
    const keyword = KEYWORD_COLORS.find(([re]) => re.test(group.key));
    if (keyword && !used.has(keyword[1])) {
      group.color = keyword[1];
      used.add(keyword[1]);
    }
  }
  for (const group of groups) {
    if (group.base || group.color >= 0) continue;
    let next = 0;
    while (used.has(next) && next < MAP_GROUP_COLORS.length - 1) next += 1;
    group.color = next;
    used.add(next);
  }
  for (const place of places) {
    const group = groups.find((item) => item.key === place.group.toLowerCase());
    place.base = group.base;
    place.color = group.color;
  }

  return {
    title: text(options.title, 120),
    places,
    groups: groups.filter((group) => group.name),
    skipped
  };
}

export function placeColor(place, theme = "light") {
  return place.base ? MAP_BASE_COLOR[theme === "dark" ? "dark" : "light"] : MAP_GROUP_COLORS[place.color] ?? MAP_GROUP_COLORS[0];
}

export function prefersAppleMaps(userAgent = globalThis.navigator?.userAgent ?? "") {
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent);
}

export function directionsUrl(place, apple = false) {
  if (place.directions) return place.directions;
  const ll = `${place.lat},${place.lng}`;
  return apple
    ? `https://maps.apple.com/?q=${encodeURIComponent(place.name)}&ll=${ll}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`;
}

const DIRECTIONS_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
const BED_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/></svg>';
const PIN_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>';

// The places as a plain list: what readers see offline, without WebGL, or
// when the basemap cannot load. Directions links still open the maps app.
export function placesListHtml(model, { apple = false } = {}) {
  const rows = model.places
    .map((place, index) => {
      const name = place.link
        ? `<a class="map-place-name" href="${escapeHtml(place.link)}">${escapeHtml(place.name)}</a>`
        : `<span class="map-place-name">${escapeHtml(place.name)}</span>`;
      const detail = place.note || place.address;
      return (
        `<li class="map-place${place.base ? " map-place-base" : ""}" data-map-place="${index}">` +
        `<span class="map-place-dot" style="--pin:${placeColor(place)}">${place.base ? BED_ICON : escapeHtml(place.label)}</span>` +
        `<span class="map-place-text">${name}` +
        (detail ? `<span class="map-place-note">${escapeHtml(detail)}</span>` : "") +
        `</span>` +
        `<a class="map-place-go" href="${escapeHtml(directionsUrl(place, apple))}" target="_blank" rel="noopener noreferrer" aria-label="Directions to ${escapeHtml(place.name)}" title="Directions">${DIRECTIONS_ICON}</a>` +
        `</li>`
      );
    })
    .join("");
  const count = `${model.places.length} ${model.places.length === 1 ? "place" : "places"}`;
  return (
    `<div class="map-places">` +
    `<div class="map-places-head">${PIN_ICON}<span>${escapeHtml(model.title || "Places")}</span><span class="map-places-count">${count}</span></div>` +
    `<ol class="map-places-list">${rows}</ol>` +
    `</div>`
  );
}

const MAP_FENCE_RE = /<pre>\s*<code class="language-map">([\s\S]*?)<\/code>\s*<\/pre>/gi;

// Turns each rendered ```map fence into a map block. The fence text stays
// inside (hidden) as the source of truth for the client renderer; the
// places list is the fallback. A fence with no usable places is left as an
// ordinary code block.
export function enrichMapBlocks(html) {
  if (!html || !html.includes("language-map")) return html;
  let index = 0;
  return html.replace(MAP_FENCE_RE, (block, code) => {
    const model = parseMapBlock(decodeHtml(code));
    if (!model) return block;
    const label = model.title
      ? `Map: ${model.title}`
      : `Map of ${model.places.length} ${model.places.length === 1 ? "place" : "places"}`;
    return (
      `<div class="map-block" role="figure" aria-label="${escapeHtml(label)}" data-map-block="${index++}" data-map-state="pending">` +
      `<div class="map-block-frame"><div class="map-block-canvas"></div></div>` +
      placesListHtml(model) +
      `<pre class="map-block-source" hidden><code>${code}</code></pre>` +
      `</div>`
    );
  });
}

// Reads the model back out of an enriched block in the page.
export function mapBlockModel(container) {
  const source = container.querySelector(".map-block-source code")?.textContent ?? "";
  return parseMapBlock(source);
}
