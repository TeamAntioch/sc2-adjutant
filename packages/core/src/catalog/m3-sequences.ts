// A model's animations, read from the SEQS records of an .m3 (saved with its .m3a files merged in,
// since story characters keep most of their animations in RequiredAnims files). Each record holds
// the animation's length and the movement speed built into it, which the Cutscene Editor copies
// into an actor's anim element: a walker following a path stands still without it.

/** One animation as the Editor sees it. */
export type M3Sequence = {
  readonly name: string;
  readonly durationMs: number;
  /** The speed the animation moves at, in the Editor's own units (a story walk is 38). 0 for a stand. */
  readonly moveSpeed: number;
  readonly looping: boolean;
};

/** SEQS record sizes by version. */
const SEQS_SIZE: Record<number, number> = { 1: 96, 2: 92 };

/** SEQS flag: the animation plays once. */
const NOT_LOOPING = 0x1;

/** One entry of an MD34's tag index: an array of `count` records of `tag` at `offset`. */
export type M3IndexEntry = { readonly tag: string; readonly offset: number; readonly count: number; readonly version: number };

/** An MD34 .m3's tag index, which every reference in it points into by position. */
export function m3Index(data: Uint8Array): { readonly view: DataView; readonly indexOffset: number; readonly entries: readonly M3IndexEntry[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (String.fromCharCode(...data.subarray(0, 4)) !== "43DM") throw new Error("not an MD34 .m3");
  const indexOffset = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  const entries = Array.from({ length: indexCount }, (_, i) => {
    const at = indexOffset + 16 * i;
    return { tag: String.fromCharCode(...data.subarray(at, at + 4)), offset: view.getUint32(at + 4, true), count: view.getUint32(at + 8, true), version: view.getUint32(at + 12, true) };
  });
  return { view, indexOffset, entries };
}

/**
 * The SEQS records of an MD34 .m3. The header points at an index of (tag, offset, count, version)
 * entries; a SEQS record opens with two -1 ints, the name as a reference (count, index entry,
 * flags), the start and end in ms, the movement speed as a float and the flags.
 */
export function readM3Sequences(data: Uint8Array): M3Sequence[] {
  const { view, indexOffset, entries } = m3Index(data);
  const seqs = entries.find((entry) => entry.tag === "SQES");
  if (!seqs || seqs.count === 0) return [];
  // The record size is the version's: 96 bytes at version 1, 92 at version 2 (a block is padded to
  // 16 bytes, so it can't be told from where the next one starts). Otherwise it follows from that.
  const next = Math.min(...entries.map((entry) => entry.offset).filter((offset) => offset > seqs.offset), indexOffset);
  const size = SEQS_SIZE[seqs.version] ?? Math.floor((next - seqs.offset) / seqs.count);
  return Array.from({ length: seqs.count }, (_, i) => {
    const at = seqs.offset + i * size;
    const name = entries[view.getUint32(at + 12, true)]!;
    const nameLength = view.getUint32(at + 8, true);
    const start = view.getUint32(at + 20, true);
    const end = view.getUint32(at + 24, true);
    return {
      name: new TextDecoder().decode(data.subarray(name.offset, name.offset + nameLength)).replace(/\0.*$/s, ""),
      durationMs: end - start,
      moveSpeed: Math.round(view.getFloat32(at + 28, true) * 1000) / 1000,
      looping: (view.getUint32(at + 32, true) & NOT_LOOPING) === 0,
    };
  });
}
