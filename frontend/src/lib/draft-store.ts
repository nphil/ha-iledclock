import { base64ToFrame, frameToBase64 } from "./design-codec.ts";
import type { PixelFrame } from "./grid.ts";

const DRAFT_VERSION = 1;
const MAX_DRAFT_FRAMES = 64;

export interface EditorDraftState {
  name: string;
  frames: readonly PixelFrame[];
  clockRegion: boolean;
  designId?: string | null;
}

export interface EditorDraft extends EditorDraftState {
  entryId: string;
  designId: string | null;
  savedFingerprint: string;
  savedAt: number;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SerializedDraft {
  version: number;
  entryId: string;
  name: string;
  clockRegion: boolean;
  designId: string | null;
  savedFingerprint: string;
  savedAt: number;
  width: number;
  height: number;
  frames: string[];
  delays: number[];
}

export function editorStateFingerprint(state: EditorDraftState): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const mix = (value: number) => {
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  };
  for (let i = 0; i < state.name.length; i++) mix(state.name.charCodeAt(i));
  mix(state.clockRegion ? 1 : 0);
  mix(state.frames.length);
  for (const frame of state.frames) {
    mix(frame.width);
    mix(frame.height);
    mix(frame.durationMs);
    for (const value of frame.pixels) mix(value);
  }
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}

export function makeEditorDraft(
  entryId: string,
  state: EditorDraftState,
  savedFingerprint: string,
  savedAt = Date.now(),
): EditorDraft {
  return {
    entryId,
    name: state.name,
    frames: state.frames,
    clockRegion: state.clockRegion,
    designId: state.designId ?? null,
    savedFingerprint,
    savedAt,
  };
}

export function isEditorDraftDirty(draft: EditorDraft): boolean {
  return editorStateFingerprint(draft) !== draft.savedFingerprint;
}

export function serializeEditorDraft(draft: EditorDraft): string {
  const first = draft.frames[0];
  const serialized: SerializedDraft = {
    version: DRAFT_VERSION,
    entryId: draft.entryId,
    name: draft.name,
    clockRegion: draft.clockRegion,
    designId: draft.designId ?? null,
    savedFingerprint: draft.savedFingerprint,
    savedAt: draft.savedAt,
    width: first?.width ?? 32,
    height: first?.height ?? 16,
    frames: draft.frames.map(frameToBase64),
    delays: draft.frames.map((frame) => frame.durationMs),
  };
  return JSON.stringify(serialized);
}

export function deserializeEditorDraft(value: string, expectedEntryId?: string): EditorDraft | null {
  try {
    const raw = JSON.parse(value) as Partial<SerializedDraft>;
    if (
      raw.version !== DRAFT_VERSION ||
      typeof raw.entryId !== "string" ||
      !raw.entryId ||
      (expectedEntryId !== undefined && raw.entryId !== expectedEntryId) ||
      typeof raw.name !== "string" ||
      typeof raw.clockRegion !== "boolean" ||
      typeof raw.savedFingerprint !== "string" ||
      !Array.isArray(raw.frames) ||
      raw.frames.length < 1 ||
      raw.frames.length > MAX_DRAFT_FRAMES ||
      !Array.isArray(raw.delays) ||
      !Number.isInteger(raw.width) ||
      !Number.isInteger(raw.height) ||
      (raw.width as number) < 1 ||
      (raw.height as number) < 1
    ) return null;

    const width = raw.width as number;
    const height = raw.height as number;
    const frames = raw.frames.map((encoded, index) => {
      if (typeof encoded !== "string") throw new TypeError("Invalid frame data");
      const delay = raw.delays![index];
      if (typeof delay !== "number" || !Number.isFinite(delay)) throw new TypeError("Invalid frame delay");
      return base64ToFrame(encoded, width, height, Math.max(10, Math.round(delay)));
    });
    return {
      entryId: raw.entryId,
      name: raw.name,
      clockRegion: raw.clockRegion,
      frames,
      designId: typeof raw.designId === "string" ? raw.designId : null,
      savedFingerprint: raw.savedFingerprint,
      savedAt: typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function editorDraftKey(entryId: string): string {
  return `iledclock:editor-draft:v${DRAFT_VERSION}:${encodeURIComponent(entryId)}`;
}

export function readEditorDraft(storage: DraftStorage, entryId: string): EditorDraft | null {
  try {
    const value = storage.getItem(editorDraftKey(entryId));
    return value ? deserializeEditorDraft(value, entryId) : null;
  } catch {
    return null;
  }
}

/** Returns false rather than throwing when browser storage is full or unavailable. */
export function writeEditorDraft(storage: DraftStorage, draft: EditorDraft): boolean {
  try {
    storage.setItem(editorDraftKey(draft.entryId), serializeEditorDraft(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearEditorDraft(storage: DraftStorage, entryId: string): boolean {
  try {
    storage.removeItem(editorDraftKey(entryId));
    return true;
  } catch {
    return false;
  }
}
