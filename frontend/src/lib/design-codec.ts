/** (De)serialises `PixelFrame[]` <-> the wire/storage shape Contract D settled on: each frame as
 * base64 of raw RGB888 bytes (`FRAME_BYTES` = 1536 for 32x16), a parallel `delays` array in ms,
 * confirmed with the Integration agent so the studio's canvas and the server's renders agree
 * pixel-for-pixel. `btoa`/`atob` are used directly (stable globals in both a browser and Node
 * since Node 18) rather than `Buffer`, which does not exist in the browser bundle.
 */

import { createFrame, type PixelFrame } from "./grid.ts";
import type { SmoothSetting, StoredDesign } from "../types.ts";

export function frameToBase64(frame: PixelFrame): string {
  let binary = "";
  // Chunked, not one `String.fromCharCode(...pixels)` spread: a 32x16 frame is only 1536 bytes
  // (harmless either way), but an animation's frames add up, and the spread form blows the
  // engine's call-argument limit well before that on some longer imported GIFs.
  const chunkSize = 0x2000;
  for (let offset = 0; offset < frame.pixels.length; offset += chunkSize) {
    binary += String.fromCharCode(...frame.pixels.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToFrame(b64: string, width: number, height: number, durationMs: number): PixelFrame {
  const binary = atob(b64);
  const pixels = new Uint8Array(width * height * 3);
  const length = Math.min(binary.length, pixels.length);
  for (let i = 0; i < length; i++) pixels[i] = binary.charCodeAt(i);
  return { width, height, pixels, durationMs };
}

export function designToFrames(design: StoredDesign): PixelFrame[] {
  if (design.frames.length === 0) return [createFrame(design.width, design.height)];
  return design.frames.map((b64, i) => base64ToFrame(b64, design.width, design.height, design.delays[i] ?? 100));
}

export function framesToDesign(
  frames: readonly PixelFrame[],
  meta: { id: string; name: string; kind: "image" | "animation"; created: number; updated: number; tags?: string[]; speed?: number | null; smooth?: SmoothSetting },
): StoredDesign {
  const design: StoredDesign = {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    width: frames[0]?.width ?? 32,
    height: frames[0]?.height ?? 16,
    frames: frames.map(frameToBase64),
    delays: frames.map((frame) => frame.durationMs),
    created: meta.created,
    updated: meta.updated,
    tags: meta.tags,
  };
  // Leave the keys out entirely when the caller has no opinion: the server then keeps the stored
  // speed/smooth. An explicit `null` is a choice (Original / auto) and is sent.
  if (meta.speed !== undefined) design.speed = meta.speed;
  if (meta.smooth !== undefined) design.smooth = meta.smooth;
  return design;
}
