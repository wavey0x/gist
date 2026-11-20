export type MapColorName =
  | "blue" | "orange" | "green" | "purple" | "pink" | "teal" | "amber" | "gray" | "ink";
export type MapIconName = "pin" | "bed" | "home" | "star" | "flag" | "food" | "coffee" | "camera";

export type MapPlace = {
  lat: number;
  lng: number;
  name: string;
  group: string;
  label: string;
  note: string;
  address: string;
  link: string;
  directions: string;
  color: string;
  icon: string;
  emphasis: boolean;
};

export type MapGroup = {
  key: string;
  name: string;
  color: string;
  icon: string;
  emphasis: boolean;
};

export type MapModel = {
  title: string;
  places: MapPlace[];
  groups: MapGroup[];
  skipped: number;
};

export const MAP_MAX_PLACES: number;
export const MAP_MAX_SOURCE_CHARS: number;
export const MAP_COLORS: Record<Exclude<MapColorName, "ink">, string>;
export const MAP_COLOR_NAMES: string[];
export const MAP_INK: { light: string; dark: string };
export const MAP_ICONS: Record<MapIconName, string>;
export const MAP_ICON_NAMES: string[];
export function decodeHtml(value: string): string;
export function escapeHtml(value: string): string;
export function parseMapBlock(source: string): MapModel | null;
export function mapColor(name: string, theme?: string): string;
export function placeColor(place: MapPlace, theme?: string): string;
export function prefersAppleMaps(userAgent?: string): boolean;
export function directionsUrl(place: MapPlace, apple?: boolean): string;
export function placesListHtml(model: MapModel, options?: { apple?: boolean }): string;
export function enrichMapBlocks(html: string): string;
export function mapBlockModel(container: Element): MapModel | null;
