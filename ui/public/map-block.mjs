// ```map fences: a small list of places with coordinates, drawn as an
// interactive map. Shared by the app (lib/gists.ts, components/MapRenderer)
// and the offline shell, so it has no dependencies and works on strings.
//
// The fence body is either a YAML-style list or JSON (an array of places,
// an object with `places`, or GeoJSON points):
//
//   title: Santa Fe
//   groups:                      # optional: style a group
//     Lodging: { color: gray, icon: bed, emphasis: true }
//   places:
//     - name: Residence Inn
//       at: 35.65986, -105.95218
//       group: Lodging
//     - name: Meow Wolf
//       lat: 35.65465
//       lng: -105.99651
//       group: Activities
//       label: 2
//       note: Immersive art · allow 2 hours.
//       link: "#2-meow-wolf"
//
// Styling is generic: places that share a `group` share a colour, and
// groups take palette colours in the order they first appear. A group or a
// single place may set `color` (a palette name), `icon` (a built-in icon)
// and `emphasis` (a larger ink pin for the one place everything else is
// relative to). Nothing is inferred from names.
//
// Coordinates are written by the author (or agent) up front, so rendering
// never calls a geocoder.

export const MAP_MAX_PLACES = 300;
export const MAP_MAX_SOURCE_CHARS = 60000;

// Named fill colours, tuned to read on both the light and the dark basemap.
// Authors pick by name so every map stays legible in either theme.
export const MAP_COLORS = {
  blue: "#2563eb",
  orange: "#e8590c",
  green: "#2b8a3e",
  purple: "#7048e8",
  pink: "#d6336c",
  teal: "#0c8599",
  amber: "#c08a00",
  gray: "#5c677d"
};
export const MAP_COLOR_NAMES = Object.keys(MAP_COLORS);
// Emphasised pins (and `color: ink`) use the app's ink, which flips with
// the theme.
export const MAP_INK = { light: "#171717", dark: "#f2f2f2" };

// Built-in pin icons: 24x24 stroke paths (Lucide), drawn white on the pin.
export const MAP_ICONS = {
  pin: "M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0 M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
  bed: "M2 4v16 M2 8h18a2 2 0 0 1 2 2v10 M2 17h20 M6 8v9",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  star: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  flag: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
  food: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2 M7 2v20 M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7",
  coffee: "M10 2v2 M14 2v2 M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1 M6 2v2",
  camera: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z M15 13a3 3 0 1 1-6 0a3 3 0 1 1 6 0"
};
export const MAP_ICON_NAMES = Object.keys(MAP_ICONS);

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

// `{ color: gray, icon: bed }` on one line.
function parseFlowMap(text) {
  const body = text.trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  const out = {};
  for (const part of body.slice(1, -1).split(",")) {
    const pair = parseKeyValue(part.trim());
    if (pair) out[pair[0]] = pair[1];
  }
  return out;
}

// A group name as a map key: any text (quoted or not) before the colon.
function parseGroupKey(text) {
  const match = /^("[^"]+"|'[^']+'|[^:{]+?)\s*:(?:\s+(.*))?$/.exec(text);
  if (!match) return null;
  return [unquote(match[1]), match[2] ?? ""];
}

// A forgiving subset of YAML: top-level `key: value` options, a `groups:`
// map of group styles, and a list of places (`- key: value` items with
// indented continuation lines), either at the top level or under `places:`.
function parseYamlish(source) {
  const options = {};
  const items = [];
  const groups = {};
  let section = null;
  let current = null;
  let itemIndent = -1;
  let group = null;
  let groupIndent = -1;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0 && !line.startsWith("-")) {
      current = null;
      group = null;
      const pair = parseKeyValue(line);
      if (!pair) continue;
      if (pair[0] === "groups") section = "groups";
      else if (LIST_KEYS.has(pair[0])) section = "places";
      else {
        section = null;
        options[pair[0]] = pair[1];
      }
      continue;
    }

    if (section === "groups") {
      if (group && indent > groupIndent) {
        const pair = parseKeyValue(line);
        if (pair) group[pair[0]] = pair[1];
        continue;
      }
      const entry = parseGroupKey(line);
      if (!entry) continue;
      group = {};
      groupIndent = indent;
      groups[entry[0]] = group;
      Object.assign(group, parseFlowMap(entry[1]) ?? {});
      continue;
    }

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
    if (pair && current && indent > itemIndent) current[pair[0]] = pair[1];
  }
  return { options: { ...options, groups }, items };
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

function colorName(value) {
  const name = text(value, 20).toLowerCase().replace(/^grey$/, "gray");
  return name === "ink" || MAP_COLORS[name] ? name : "";
}

function iconName(value) {
  const name = text(value, 20).toLowerCase();
  return MAP_ICONS[name] ? name : "";
}

function flag(value) {
  return value === true || /^(true|yes|1)$/i.test(String(value ?? "").trim());
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
      group: text(item.group, 40),
      label: text(item.label, 3),
      note: text(firstKey(item, ["note", "description"]), 280),
      address: text(item.address, 160),
      link: safeLink(item.link),
      directions: safeLink(item.directions),
      color: colorName(item.color),
      icon: iconName(item.icon),
      emphasis: flag(item.emphasis)
    });
  }
  skipped += Math.max(0, parsed.items.length - MAP_MAX_PLACES);
  if (!places.length) return null;

  // Group styles from the optional `groups:` map, matched case-insensitively.
  const styles = new Map();
  const groupOptions = options.groups && typeof options.groups === "object" ? options.groups : {};
  for (const [name, style] of Object.entries(groupOptions)) {
    const item = lowerKeys(style);
    styles.set(name.trim().toLowerCase(), {
      color: colorName(item.color),
      icon: iconName(item.icon),
      emphasis: flag(item.emphasis)
    });
  }

  // Groups in the order they first appear. A group without a colour takes
  // the next palette colour no other group asked for by name.
  const groups = [];
  for (const place of places) {
    const key = place.group.toLowerCase();
    if (groups.some((group) => group.key === key)) continue;
    const style = styles.get(key) ?? { color: "", icon: "", emphasis: false };
    groups.push({ key, name: place.group, ...style });
  }
  const claimed = new Set(groups.map((group) => group.color).filter(Boolean));
  const free = MAP_COLOR_NAMES.filter((name) => !claimed.has(name));
  let next = 0;
  for (const group of groups) {
    if (group.color || group.emphasis) continue;
    group.color = (free.length ? free : MAP_COLOR_NAMES)[next++ % (free.length || MAP_COLOR_NAMES.length)];
  }
  for (const group of groups) {
    if (group.emphasis && !group.color) group.color = "ink";
  }
  for (const place of places) {
    const group = groups.find((item) => item.key === place.group.toLowerCase());
    place.emphasis ||= group.emphasis;
    place.color ||= place.emphasis && !group.emphasis ? "ink" : group.color;
    place.icon ||= group.icon;
  }

  return {
    title: text(options.title, 120),
    places,
    groups: groups.filter((group) => group.name),
    skipped
  };
}

export function mapColor(name, theme = "light") {
  return name === "ink" ? MAP_INK[theme === "dark" ? "dark" : "light"] : MAP_COLORS[name] ?? MAP_COLORS.blue;
}

export function placeColor(place, theme = "light") {
  return mapColor(place.color, theme);
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
function iconSvg(name) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${MAP_ICONS[name]}"/></svg>`;
}
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
        `<li class="map-place${place.color === "ink" ? " map-place-ink" : ""}" data-map-place="${index}">` +
        `<span class="map-place-dot" style="--pin:${placeColor(place)}">${place.label ? escapeHtml(place.label) : place.icon ? iconSvg(place.icon) : ""}</span>` +
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
