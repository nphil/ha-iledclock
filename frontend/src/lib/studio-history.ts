export interface ShowHistoryDescriptor {
  kind: string;
  title?: string;
  shown_at?: string;
  unavailable?: boolean;
  design_id?: string;
  [key: string]: unknown;
}

/** Rebuild the `item` payload from a saved descriptor. Presentation-only fields are stripped;
 * generative descriptors store their preset as `effect`, while `iledclock/show` expects `kind`. */
export function showItemFromDescriptor(descriptor: ShowHistoryDescriptor): Record<string, unknown> | null {
  const { kind, title: _title, shown_at: _shownAt, unavailable, ...params } = descriptor;
  if (!kind || unavailable) return null;
  if (kind === "design") return typeof params.design_id === "string" ? { design_id: params.design_id } : null;
  if (kind === "generative" && typeof params.effect === "string") {
    params.kind = params.effect;
    delete params.effect;
  }
  return { spec: { type: kind, ...params } };
}
