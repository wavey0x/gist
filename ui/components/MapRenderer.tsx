"use client";

import { useEffect } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup as MapLibrePopup,
  StyleSpecification
} from "maplibre-gl";
import {
  directionsUrl,
  MAP_ICONS,
  mapBlockModel,
  mapColor,
  prefersAppleMaps,
  type MapModel,
  type MapPlace
} from "../public/map-block.mjs";

type MapLibre = typeof import("maplibre-gl");
type Theme = "light" | "dark";

// Keyless OpenStreetMap vector tiles. No account, no API key, no usage cap
// for a site of this size. If this host changes, update connect-src in
// proxy.ts too.
const STYLE_URLS: Record<Theme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark"
};
const WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";
const STYLESHEET_URL = "/vendor/maplibre/maplibre-gl.css";
const BLOCK_SELECTOR = "article.markdown-body .map-block";
const SOURCE_ID = "wg-places";
const LAYER_ID = "wg-places";
const LABEL_LAYER_ID = "wg-place-names";
const MAX_MAPS = 8;
const LOAD_TIMEOUT_MS = 12000;
const LABEL_FONT = ["Noto Sans Regular"];
const PIN_SIZE = 22;
const LARGE_PIN_SIZE = 28;
const ICON = {
  zoomIn: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  zoomOut: '<path d="M5 12h14"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  expand: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/>',
  collapse: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  directions: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>'
};

let libraryPromise: Promise<MapLibre> | null = null;

function svgIcon(paths: string) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths}</svg>`;
}

function loadStylesheet() {
  if (document.querySelector(`link[href="${STYLESHEET_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  document.head.prepend(link);
}

function loadMapLibre() {
  libraryPromise ??= import("maplibre-gl").then((module) => {
    const maplibre = ((module as { default?: MapLibre }).default ?? module) as MapLibre;
    maplibre.setWorkerUrl(new URL(WORKER_URL, window.location.origin).href);
    return maplibre;
  });
  libraryPromise.catch(() => {
    libraryPromise = null;
  });
  return libraryPromise;
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function supportsWebGl() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function cssVar(name: string, fallback: string) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

// Everything that changes how a pin looks is in its image id, so each
// distinct pin is drawn once per theme.
function iconId(theme: Theme, place: MapPlace) {
  return [
    "wg-pin",
    theme,
    place.color,
    place.emphasis ? "1" : "0",
    place.icon,
    encodeURIComponent(place.label)
  ].join(":");
}

// Pins are drawn on a canvas, not with the basemap's glyph font, so labels
// and icons always render crisply in the app's own type.
function drawPin(id: string) {
  const [, themeName, color, emphasis, icon, encodedLabel = ""] = id.split(":");
  const theme: Theme = themeName === "dark" ? "dark" : "light";
  const large = emphasis === "1";
  const label = decodeURIComponent(encodedLabel);
  const ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
  const size = large ? LARGE_PIN_SIZE : PIN_SIZE;
  const pixels = Math.round(size * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);

  const dark = theme === "dark";
  const fill = mapColor(color, theme);
  const ring = dark ? "#111212" : "#ffffff";
  const center = size / 2;
  const radius = center - 1.5;

  context.shadowColor = "rgba(0,0,0,0.28)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 1;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = ring;
  context.fill();
  context.shadowColor = "transparent";
  context.beginPath();
  context.arc(center, center, radius - 2, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();

  // Ink flips to light in dark mode, so its glyph flips to dark.
  const glyph = dark && color === "ink" ? "#111212" : "#ffffff";
  if (label) {
    context.fillStyle = glyph;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const fontSize = (label.length > 2 ? 8.5 : label.length > 1 ? 10 : 11) * (large ? 1.15 : 1);
    context.font = `600 ${fontSize}px ${cssVar("--font-ui", "system-ui, sans-serif")}`;
    context.fillText(label, center, center + 0.5);
  } else if (MAP_ICONS[icon as keyof typeof MAP_ICONS]) {
    const glyphSize = large ? 14 : 11;
    const scale = glyphSize / 24;
    context.save();
    context.translate(center - glyphSize / 2, center - glyphSize / 2);
    context.scale(scale, scale);
    context.strokeStyle = glyph;
    context.lineWidth = 2.3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(new Path2D(MAP_ICONS[icon as keyof typeof MAP_ICONS]));
    context.restore();
  }
  return {
    width: pixels,
    height: pixels,
    data: new Uint8Array(context.getImageData(0, 0, pixels, pixels).data.buffer),
    pixelRatio: ratio
  };
}

function placesGeoJson(model: MapModel, theme: Theme) {
  return {
    type: "FeatureCollection" as const,
    features: model.places.map((place, index) => ({
      type: "Feature" as const,
      id: index,
      properties: {
        index,
        name: place.name,
        icon: iconId(theme, place),
        large: place.emphasis,
        // Emphasised places first, then the order the author listed.
        rank: place.emphasis ? -1 : index
      },
      geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] }
    }))
  };
}

function addPlacesLayer(map: MapLibreMap, model: MapModel, theme: Theme) {
  for (const id of [LAYER_ID, LABEL_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  const data = placesGeoJson(model, theme);
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(SOURCE_ID, { type: "geojson", data });
  const dark = theme === "dark";
  // Names sit below the pins. Upper layers are placed first, so every pin
  // claims its spot and a name that would cover another pin is dropped
  // (it shows again when zoomed in).
  map.addLayer({
    id: LABEL_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "symbol-sort-key": ["get", "rank"],
      "text-field": ["get", "name"],
      "text-font": LABEL_FONT,
      "text-size": 11.5,
      "text-max-width": 9,
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      // Clear of the pin's own collision box (half its size plus padding).
      "text-radial-offset": ["case", ["get", "large"], 1.75, 1.45],
      "text-justify": "auto",
      "text-padding": 2
    },
    paint: {
      "text-color": dark ? "#e9e9e9" : "#1f1f1f",
      "text-halo-color": dark ? "rgba(17,18,18,0.92)" : "rgba(255,255,255,0.95)",
      "text-halo-width": 1.6
    }
  });
  map.addLayer({
    id: LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-allow-overlap": true,
      "symbol-sort-key": ["get", "rank"],
      "symbol-z-order": "source"
    }
  });
}

// The basemap's own points of interest compete with the author's pins, so
// they are dropped; streets, water, parks and place names stay.
function quietStyle(_previous: StyleSpecification | undefined, next: StyleSpecification) {
  return {
    ...next,
    layers: next.layers.filter(
      (layer) => !/poi|housenum|aeroway-label|airport/i.test(layer.id)
    )
  };
}

function popupContent(place: MapPlace, apple: boolean, onLink: () => void) {
  const root = document.createElement("div");
  root.className = "map-popup";
  const head = document.createElement("div");
  head.className = "map-popup-head";
  const name = document.createElement(place.link ? "a" : "strong");
  name.className = "map-popup-name";
  name.textContent = place.name;
  if (place.link && name instanceof HTMLAnchorElement) {
    name.href = place.link;
    if (!place.link.startsWith("#")) {
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    } else {
      name.addEventListener("click", onLink);
    }
  }
  const go = document.createElement("a");
  go.className = "map-popup-go";
  go.href = directionsUrl(place, apple);
  go.target = "_blank";
  go.rel = "noopener noreferrer";
  go.title = "Directions";
  go.setAttribute("aria-label", `Directions to ${place.name}`);
  go.innerHTML = svgIcon(ICON.directions);
  head.append(name, go);
  root.append(head);
  for (const value of [place.note, place.note ? "" : place.address]) {
    if (!value) continue;
    const line = document.createElement("p");
    line.className = "map-popup-note";
    line.textContent = value;
    root.append(line);
  }
  return root;
}

type MountedMap = { destroy: () => void; setTheme: (theme: Theme) => void };

function mountMap(
  maplibre: MapLibre,
  container: HTMLElement,
  model: MapModel
): MountedMap {
  const frame = container.querySelector<HTMLElement>(".map-block-frame")!;
  const canvas = container.querySelector<HTMLElement>(".map-block-canvas")!;
  const apple = prefersAppleMaps();
  let theme = currentTheme();
  let expanded = false;
  let popup: MapLibrePopup | null = null;
  let settled = false;

  const bounds = new maplibre.LngLatBounds();
  for (const place of model.places) bounds.extend([place.lng, place.lat]);
  const fitPadding = () => {
    // Room for names beside the outer pins, and for the controls on the
    // right and the legend at the bottom.
    if (frame.clientWidth < 480) {
      return { top: 30, bottom: 52, left: 40, right: 96 };
    }
    return { top: 56, bottom: 74, left: 68, right: 120 };
  };

  const map = new maplibre.Map({
    container: canvas,
    style: STYLE_URLS[theme],
    transformStyle: quietStyle,
    bounds,
    fitBoundsOptions: { padding: fitPadding(), maxZoom: 15 },
    maxZoom: 18,
    attributionControl: false,
    cooperativeGestures: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    fadeDuration: 150
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // The OpenFreeMap styles carry their own attribution (OpenFreeMap,
  // OpenMapTiles, OpenStreetMap).
  map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");

  const timeout = window.setTimeout(() => {
    if (!settled) fail();
  }, LOAD_TIMEOUT_MS);

  function fail() {
    settled = true;
    window.clearTimeout(timeout);
    container.dataset.mapState = "fallback";
    try {
      map.remove();
    } catch {
      // already gone
    }
  }

  map.setMissingStyleImageResolver((id) => {
    if (!id.startsWith("wg-pin:") || map.hasImage(id)) return;
    const image = drawPin(id);
    if (image) map.addImage(id, image, { pixelRatio: image.pixelRatio });
  });

  map.on("style.load", () => {
    addPlacesLayer(map, model, theme);
  });

  map.on("load", () => {
    // On a phone the full attribution would cover the legend; it stays one
    // tap away behind the (i) button.
    if (frame.clientWidth < 640) {
      container
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
    }
    settled = true;
    window.clearTimeout(timeout);
    container.dataset.mapState = "ready";
  });

  map.on("error", (event) => {
    // A missing tile is not fatal; a basemap that never loads is.
    if (!settled && !map.isStyleLoaded()) fail();
  });

  function showPopup(index: number) {
    const place = model.places[index];
    if (!place) return;
    popup?.remove();
    popup = new maplibre.Popup({
      closeButton: false,
      maxWidth: "260px",
      offset: place.emphasis ? 18 : 15,
      className: "map-popup-shell"
    })
      .setLngLat([place.lng, place.lat])
      .setDOMContent(
        popupContent(place, apple, () => {
          if (expanded) setExpanded(false);
        })
      )
      .addTo(map);
  }

  map.on("click", [LAYER_ID, LABEL_LAYER_ID], (event: MapLayerMouseEvent) => {
    const index = Number(event.features?.[0]?.properties?.index);
    if (Number.isInteger(index)) showPopup(index);
  });
  map.on("mouseenter", [LAYER_ID, LABEL_LAYER_ID], () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", [LAYER_ID, LABEL_LAYER_ID], () => {
    map.getCanvas().style.cursor = "";
  });

  // Controls
  const controls = document.createElement("div");
  controls.className = "map-block-controls";
  function button(label: string, icon: string, onClick: () => void) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "map-block-button";
    element.setAttribute("aria-label", label);
    element.title = label;
    element.innerHTML = svgIcon(icon);
    element.addEventListener("click", onClick);
    controls.append(element);
    return element;
  }
  button("Zoom in", ICON.zoomIn, () => map.zoomIn());
  button("Zoom out", ICON.zoomOut, () => map.zoomOut());
  button("Show all places", ICON.fit, () => fitAll(true));
  const expandButton = button("Expand map", ICON.expand, () => setExpanded(!expanded));
  frame.append(controls);

  if (model.groups.length > 1) {
    const legend = document.createElement("div");
    legend.className = "map-block-legend";
    for (const group of model.groups) {
      const item = document.createElement("span");
      item.className = "map-block-legend-item";
      const dot = document.createElement("span");
      dot.className = "map-block-legend-dot";
      dot.style.setProperty("--pin", mapColor(group.color, theme));
      item.append(dot, document.createTextNode(group.name));
      legend.append(item);
    }
    frame.append(legend);
  }

  function fitAll(animate: boolean) {
    popup?.remove();
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 15, animate });
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") setExpanded(false);
  }

  function setExpanded(next: boolean) {
    if (next === expanded) return;
    expanded = next;
    container.toggleAttribute("data-map-expanded", expanded);
    document.documentElement.classList.toggle("map-expanded-open", expanded);
    expandButton.innerHTML = svgIcon(expanded ? ICON.collapse : ICON.expand);
    const label = expanded ? "Close expanded map" : "Expand map";
    expandButton.setAttribute("aria-label", label);
    expandButton.title = label;
    if (expanded) {
      map.cooperativeGestures.disable();
      window.addEventListener("keydown", onKey);
    } else {
      map.cooperativeGestures.enable();
      window.removeEventListener("keydown", onKey);
    }
    requestAnimationFrame(() => {
      map.resize();
      fitAll(false);
    });
  }

  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(frame);

  return {
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      popup?.remove();
      container.querySelectorAll<HTMLElement>(".map-block-legend-dot").forEach((dot, index) => {
        const group = model.groups[index];
        if (group) dot.style.setProperty("--pin", mapColor(group.color, theme));
      });
      map.setStyle(STYLE_URLS[theme], { transformStyle: quietStyle });
    },
    destroy() {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", onKey);
      resizeObserver.disconnect();
      if (expanded) document.documentElement.classList.remove("map-expanded-open");
      controls.remove();
      container.querySelector(".map-block-legend")?.remove();
      container.removeAttribute("data-map-expanded");
      try {
        map.remove();
      } catch {
        // already gone
      }
    }
  };
}

function patchFallbackLinks(container: HTMLElement, model: MapModel) {
  if (!prefersAppleMaps()) return;
  container.querySelectorAll<HTMLAnchorElement>(".map-place").forEach((row) => {
    const place = model.places[Number(row.dataset.mapPlace)];
    const link = row.querySelector<HTMLAnchorElement>(".map-place-go");
    if (place && link) link.href = directionsUrl(place, true);
  });
}

export function MapRenderer({
  gistId,
  revisionNumber
}: {
  gistId: string;
  revisionNumber: number;
}) {
  useEffect(() => {
    let cancelled = false;
    const mounted = new Map<HTMLElement, MountedMap>();
    const seen = new WeakSet<HTMLElement>();

    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          visibility.unobserve(entry.target);
          void start(entry.target as HTMLElement);
        }
      },
      { rootMargin: "300px 0px" }
    );

    async function start(container: HTMLElement) {
      const model = mapBlockModel(container);
      if (!model) {
        container.dataset.mapState = "fallback";
        return;
      }
      if (mounted.size >= MAX_MAPS || !supportsWebGl() || !navigator.onLine) {
        container.dataset.mapState = "fallback";
        return;
      }
      try {
        loadStylesheet();
        const maplibre = await loadMapLibre();
        if (cancelled || !container.isConnected || mounted.has(container)) return;
        mounted.set(container, mountMap(maplibre, container, model));
      } catch {
        container.dataset.mapState = "fallback";
      }
    }

    function scan() {
      document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((container) => {
        if (seen.has(container)) return;
        seen.add(container);
        const model = mapBlockModel(container);
        if (model) patchFallbackLinks(container, model);
        visibility.observe(container);
      });
      for (const [container, instance] of mounted) {
        if (!container.isConnected) {
          instance.destroy();
          mounted.delete(container);
        }
      }
    }

    const domObserver = new MutationObserver(() => scan());
    domObserver.observe(document.body, { childList: true, subtree: true });
    const themeObserver = new MutationObserver(() => {
      const theme = currentTheme();
      mounted.forEach((instance) => instance.setTheme(theme));
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    scan();

    return () => {
      cancelled = true;
      domObserver.disconnect();
      themeObserver.disconnect();
      visibility.disconnect();
      mounted.forEach((instance) => instance.destroy());
      mounted.clear();
    };
  }, [gistId, revisionNumber]);

  return null;
}
