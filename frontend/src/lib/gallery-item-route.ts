/** The item sheet route value is one source id and one source-local id separated by the first colon. */
export interface GalleryItemRoute {
  source: string;
  id: string;
}

export function serializeGalleryItemRoute(source: string, id: string): string {
  return `${source}:${id}`;
}

export function parseGalleryItemRoute(value: string | undefined): GalleryItemRoute | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const source = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!source.trim() || !id.trim()) return null;
  return { source, id };
}
