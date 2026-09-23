export type GalleryOptions = { baseUrl: string; imageOrigin?: string };
export type GalleryItem = {
  src: string;
  caption: string;
  alt: string;
  width: number;
  height: number;
};
export type GalleryGroup = {
  root: HTMLElement;
  name: string | null;
  items: GalleryItem[];
};
export function galleryOptions(document: Document): GalleryOptions;
export function imageAsset(
  value: string,
  options: GalleryOptions
): { id: string; path: string; search: string; hash: string } | null;
export function parseGalleryUrl(
  value: string,
  options: GalleryOptions
): { group: string | null; src: string; marker: string } | null;
export function collectGalleries(
  roots: Iterable<HTMLElement>,
  options: GalleryOptions
): {
  groups: GalleryGroup[];
  triggers: Map<HTMLElement, { group: GalleryGroup; index: number }>;
};
export function prepareGalleryImages<
  T extends { files: Record<string, { kind: string; rendered_html: string }> }
>(
  payload: T,
  options: GalleryOptions,
  parser: typeof DOMParser
): { payload: T; imageIds: string[] };
