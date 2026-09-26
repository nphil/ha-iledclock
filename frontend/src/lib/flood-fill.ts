/** Flood fill (paint bucket): classic 4-connected scanline-free BFS, matched-colour region only.
 * `wrap` treats the grid as toroidal (edges connect to the opposite edge), matching the pixel
 * editor's own wrap toggle so a fill on a wrapping design fills the whole ring, not just one side.
 */

import { type RGB, quantizePreviewRgb } from "./color.ts";
import { cloneFrame, getPixel, inBounds, type PixelFrame, setPixelMut } from "./grid.ts";

export function floodFill(frame: PixelFrame, startX: number, startY: number, color: RGB, wrap = false): PixelFrame {
  if (!inBounds(frame, startX, startY)) return frame;
  const target = getPixel(frame, startX, startY);
  const fillColor = quantizePreviewRgb(color);
  if (target[0] === fillColor[0] && target[1] === fillColor[1] && target[2] === fillColor[2]) return frame;

  const next = cloneFrame(frame);
  const visited = new Uint8Array(frame.width * frame.height);
  const stack: Array<[number, number]> = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (!inBounds(frame, x, y)) continue;
    const index = y * frame.width + x;
    if (visited[index]) continue;
    const here = getPixel(frame, x, y);
    if (here[0] !== target[0] || here[1] !== target[1] || here[2] !== target[2]) continue;
    visited[index] = 1;
    setPixelMut(next, x, y, fillColor);

    const neighbors: Array<[number, number]> = wrap
      ? [
          [(x + 1) % frame.width, y],
          [(x - 1 + frame.width) % frame.width, y],
          [x, (y + 1) % frame.height],
          [x, (y - 1 + frame.height) % frame.height],
        ]
      : [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
    for (const neighbor of neighbors) stack.push(neighbor);
  }

  return next;
}
