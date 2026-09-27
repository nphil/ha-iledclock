/** Pure layout math for the LED matrix mirror: given a canvas box and the 32x16 grid, where does
 * each round LED sit and how big is it? Shared by the card's hero canvas and the studio's pixel
 * editor canvas so both draw from the exact same geometry -- only the pixel colours and overlay
 * (cursor, grid lines) differ between the two call sites.
 */

export const MATRIX_DOT_SCALE = 0.78;

export interface MatrixLayout {
  /** Centre-to-centre spacing between adjacent LEDs, in canvas px. */
  cellSize: number;
  /** Drawn dot radius -- `cellSize * dotScale / 2`, leaving a gap between LEDs so the grid
   * reads as discrete pixels rather than a solid block. */
  dotRadius: number;
  /** Canvas-space centre of LED (0, 0). */
  offsetX: number;
  offsetY: number;
}

/** Fits the grid into `canvasWidth`x`canvasHeight` uniformly (never stretched, matching the
 * device's own square-ish LED pitch): the limiting axis sets `cellSize`, and the other axis
 * centres the unused margin. `dotScale` (0..1) is the LED's diameter as a fraction of its cell,
 * `< 1` so neighbouring LEDs never touch (the physical matrix's own dark gap between pixels). */
export function computeMatrixLayout(canvasWidth: number, canvasHeight: number, gridWidth: number, gridHeight: number, dotScale = MATRIX_DOT_SCALE): MatrixLayout {
  const cellSize = Math.min(canvasWidth / gridWidth, canvasHeight / gridHeight);
  const usedWidth = cellSize * gridWidth;
  const usedHeight = cellSize * gridHeight;
  return {
    cellSize,
    dotRadius: (cellSize * dotScale) / 2,
    offsetX: (canvasWidth - usedWidth) / 2 + cellSize / 2,
    offsetY: (canvasHeight - usedHeight) / 2 + cellSize / 2,
  };
}

export function cellCenter(layout: MatrixLayout, x: number, y: number): readonly [number, number] {
  return [layout.offsetX + x * layout.cellSize, layout.offsetY + y * layout.cellSize];
}

/** Inverse of `cellCenter`: canvas-space point -> nearest grid cell, `null` outside the drawn
 * grid entirely (a click in the letterboxed margin). Used by the studio editor's pointer
 * handlers to turn a raw `offsetX`/`offsetY` into a pixel coordinate. */
export function pointToCell(layout: MatrixLayout, canvasX: number, canvasY: number, gridWidth: number, gridHeight: number): readonly [number, number] | null {
  const x = Math.round((canvasX - layout.offsetX) / layout.cellSize);
  const y = Math.round((canvasY - layout.offsetY) / layout.cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return [x, y];
}
