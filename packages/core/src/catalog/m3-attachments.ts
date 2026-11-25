// A model's attachment points (the Ref_ sites actors attach models at), read from the ATT_
// records of an MD34 .m3, each placed by its bone's inverse bind matrix (IREF).

import { m3Index } from "./m3-sequences.js";

/** An attachment point: its name and where it is in the bind pose, in the model's own frame (cells). */
export type M3Attachment = { readonly name: string; readonly position: readonly [number, number, number] };

/** ATT_ version 1: an unknown int, the name as a reference (count, index entry, flags), the bone. */
const ATT_SIZE = 20;

/** The inverse of a 4 × 4 matrix, by Gauss-Jordan elimination. */
function invert(matrix: readonly (readonly number[])[]): number[][] {
  const a = matrix.map((row) => row.slice());
  const out = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    [out[column], out[pivot]] = [out[pivot]!, out[column]!];
    const divisor = a[column]![column]!;
    for (let j = 0; j < 4; j++) {
      a[column]![j]! /= divisor;
      out[column]![j]! /= divisor;
    }
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = a[row]![column]!;
      for (let j = 0; j < 4; j++) {
        a[row]![j]! -= factor * a[column]![j]!;
        out[row]![j]! -= factor * out[column]![j]!;
      }
    }
  }
  return out;
}

/**
 * The attachment points of an MD34 .m3. Each sits on a bone, and the bone's IREF record is the
 * inverse of its bind-pose matrix (stored as four columns), so the point is where the inverse's
 * inverse translates to. A point follows its bone when the model animates: a weapon bone's bind
 * pose can be far from where Stand holds it (the Marine's Ref_Weapon is at its feet).
 */
export function readM3Attachments(data: Uint8Array): M3Attachment[] {
  const { view, entries } = m3Index(data);
  const points = entries.find((entry) => entry.tag === "_TTA");
  const iref = entries.find((entry) => entry.tag === "FERI");
  if (!points || points.count === 0 || !iref) return [];
  return Array.from({ length: points.count }, (_, i) => {
    const at = points.offset + i * ATT_SIZE;
    const nameLength = view.getUint32(at + 4, true);
    const name = entries[view.getUint32(at + 8, true)]!;
    const bone = view.getUint32(at + 16, true);
    const base = iref.offset + 64 * bone;
    const matrix = [0, 1, 2, 3].map((row) => [0, 1, 2, 3].map((column) => view.getFloat32(base + 16 * column + 4 * row, true)));
    const world = invert(matrix);
    return {
      name: new TextDecoder().decode(data.subarray(name.offset, name.offset + nameLength)).replace(/\0.*$/s, ""),
      position: [world[0]![3]!, world[1]![3]!, world[2]![3]!] as const,
    };
  });
}
