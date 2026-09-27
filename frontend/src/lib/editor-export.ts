import type { PixelFrame } from "./grid.ts";

class ByteWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  byte(value: number): void { this.bytes.push(value & 0xff); }
  word(value: number): void { this.byte(value); this.byte(value >>> 8); }
  ascii(value: string): void { for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i)); }
  block(values: readonly number[]): void {
    for (let offset = 0; offset < values.length; offset += 255) {
      const length = Math.min(255, values.length - offset);
      this.byte(length);
      for (let i = 0; i < length; i++) this.byte(values[offset + i]!);
    }
    this.byte(0);
  }
  code(value: number, width: number): void {
    this.bitBuffer |= value << this.bitCount;
    this.bitCount += width;
    while (this.bitCount >= 8) {
      this.byte(this.bitBuffer);
      this.bitBuffer >>>= 8;
      this.bitCount -= 8;
    }
  }
  flushBits(): void {
    if (this.bitCount > 0) this.byte(this.bitBuffer);
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
  finish(): Uint8Array<ArrayBuffer> { return Uint8Array.from(this.bytes); }
}

function lzwEncode(indices: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  const clearCode = 256;
  const endCode = 257;
  const dictionary = new Map<number, number>();
  let nextCode = 258;
  let codeWidth = 9;
  writer.code(clearCode, codeWidth);
  if (indices.length === 0) {
    writer.code(endCode, codeWidth);
    writer.flushBits();
    return writer.finish();
  }

  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const suffix = indices[i]!;
    const key = (prefix << 8) | suffix;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }

    writer.code(prefix, codeWidth);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      if (nextCode === 1 << codeWidth && codeWidth < 12) codeWidth++;
    } else {
      writer.code(clearCode, codeWidth);
      dictionary.clear();
      nextCode = 258;
      codeWidth = 9;
    }
    prefix = suffix;
  }
  writer.code(prefix, codeWidth);
  writer.code(endCode, codeWidth);
  writer.flushBits();
  return writer.finish();
}

function frameIndices(frame: PixelFrame): Uint8Array {
  const indices = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < indices.length; i++) {
    const offset = i * 3;
    indices[i] = ((frame.pixels[offset]! >>> 5) << 5) | ((frame.pixels[offset + 1]! >>> 5) << 2) | (frame.pixels[offset + 2]! >>> 6);
  }
  return indices;
}

/** Encodes the editor's RGB frames into a looping GIF89a file using a fixed 3-3-2 palette. */
export function encodeAnimationGif(frames: readonly PixelFrame[]): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new RangeError("At least one frame is required to export a GIF.");
  const width = frames[0]!.width;
  const height = frames[0]!.height;
  if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new RangeError("GIF dimensions are out of range.");
  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height || frame.pixels.length !== width * height * 3) {
      throw new RangeError("All GIF frames must have the same valid dimensions.");
    }
  }

  const writer = new ByteWriter();
  writer.ascii("GIF89a");
  writer.word(width);
  writer.word(height);
  writer.byte(0xf7); // global 256-entry 3-3-2 colour table
  writer.byte(0);
  writer.byte(0);
  for (let i = 0; i < 256; i++) {
    writer.byte(Math.round(((i >>> 5) & 7) * 255 / 7));
    writer.byte(Math.round(((i >>> 2) & 7) * 255 / 7));
    writer.byte(Math.round((i & 3) * 255 / 3));
  }

  writer.byte(0x21); writer.byte(0xff); writer.byte(11); writer.ascii("NETSCAPE2.0");
  writer.byte(3); writer.byte(1); writer.word(0); writer.byte(0);

  for (const frame of frames) {
    const delay = Math.max(1, Math.min(65535, Math.round(frame.durationMs / 10)));
    writer.byte(0x21); writer.byte(0xf9); writer.byte(4); writer.byte(0x04);
    writer.word(delay); writer.byte(0); writer.byte(0);
    writer.byte(0x2c);
    writer.word(0); writer.word(0); writer.word(width); writer.word(height); writer.byte(0);
    writer.byte(8);
    writer.block(Array.from(lzwEncode(frameIndices(frame))));
  }
  writer.byte(0x3b);
  return writer.finish();
}
