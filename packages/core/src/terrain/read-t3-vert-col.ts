import { Buffer } from "node:buffer";

/**
 * One t3VertCol entry. Layout verified against 13 Editor-saved maps (each parse ends exactly at
 * the file's end): i32 id, i32 kind, f32 rect (x0, y0, x1, y1) in cells, i32, i32, u32 size, bytes.
 *
 * Kind 1 entries tile the whole map in 4x4-cell squares with one byte per vertex (5x5); values are
 * near 255 except where darkened. Other kinds (2, 4, 8) sit on cliff-cell-sized rects and carry
 * per-mesh data keyed by `id`. What the values mean (painted colour or baked shading) is unverified.
 */
export type VertColEntry = {
  readonly id: number;
  readonly kind: number;
  readonly rect: readonly [number, number, number, number];
  readonly data: Uint8Array;
};

export function readT3VertColHeader(buffer: Buffer): { readonly version: number; readonly entryCount: number; readonly bytes: number } {
  if (buffer.toString("ascii", 0, 4) !== "VTCL") throw new Error("t3VertCol: missing VTCL magic");
  return { version: buffer.readUInt32LE(4), entryCount: buffer.readUInt32LE(8), bytes: buffer.length };
}

/** Reads every entry of a v104 t3VertCol. */
export function readT3VertCol(buffer: Buffer): VertColEntry[] {
  const { entryCount } = readT3VertColHeader(buffer);
  const entries: VertColEntry[] = [];
  let offset = 32;
  for (let i = 0; i < entryCount; i++) {
    const size = buffer.readUInt32LE(offset + 32);
    entries.push({
      id: buffer.readInt32LE(offset),
      kind: buffer.readInt32LE(offset + 4),
      rect: [0, 1, 2, 3].map((k) => buffer.readFloatLE(offset + 8 + k * 4)) as [number, number, number, number],
      data: new Uint8Array(buffer.subarray(offset + 36, offset + 36 + size)),
    });
    offset += 36 + size;
  }
  if (offset !== buffer.length) throw new Error(`t3VertCol: parsed ${offset} of ${buffer.length} bytes`);
  return entries;
}

/** Kind-1 vertex values as a (width+1) x (height+1) grid, row-major from y = 0; 255 where absent. */
export function vertexValueGrid(entries: readonly VertColEntry[], width: number, height: number): Uint8Array {
  const vw = width + 1;
  const grid = new Uint8Array(vw * (height + 1)).fill(255);
  for (const { kind, rect, data } of entries) {
    if (kind !== 1 || data.length !== 25) continue;
    const [x0, y0] = rect;
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        const x = Math.round(x0) + i;
        const y = Math.round(y0) + j;
        if (x <= width && y <= height) grid[y * vw + x] = data[j * 5 + i]!;
      }
    }
  }
  return grid;
}
