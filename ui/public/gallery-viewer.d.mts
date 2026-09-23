import type { GalleryOptions } from "./gallery-model.mjs";
export function mountGallery(
  roots: Iterable<HTMLElement>,
  options?: GalleryOptions
): () => void;
