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
  base: boolean;
  color: number;
};

export type MapGroup = { key: string; name: string; base: boolean; color: number };

export type MapModel = {
  title: string;
  places: MapPlace[];
  groups: MapGroup[];
  skipped: number;
};

export const MAP_MAX_PLACES: number;
export const MAP_MAX_SOURCE_CHARS: number;
export const MAP_GROUP_COLORS: string[];
export const MAP_BASE_COLOR: { light: string; dark: string };
export function decodeHtml(value: string): string;
export function escapeHtml(value: string): string;
export function isBaseGroup(group: string): boolean;
export function parseMapBlock(source: string): MapModel | null;
export function placeColor(place: MapPlace, theme?: string): string;
export function prefersAppleMaps(userAgent?: string): boolean;
export function directionsUrl(place: MapPlace, apple?: boolean): string;
export function placesListHtml(model: MapModel, options?: { apple?: boolean }): string;
export function enrichMapBlocks(html: string): string;
export function mapBlockModel(container: Element): MapModel | null;
