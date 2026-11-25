// An .m3 with the texture paths its material layers name pointed at other files: how a stock
// model is copied to draw recoloured textures (an Asset Mod's `retexture` step, ADR-0027), since a
// texture swap reaches only a standard material's layers (docs/reference/texture-swaps.md).
//
// An MD34 file is blocks the tag index lists as (tag, offset, count, version), and a structure
// points at a block by a reference (count, index entry, flags). A layer (LAYR) keeps its image path
// as a reference to a CHAR block at its byte 4. A new path needn't be the old one's length: each
// CHAR block a remapped layer names gets the new text written after the file's other blocks, its
// index entry pointed there, and each layer referring to it given the new count; the index is
// written after them, and the header pointed at it. The old text is cleared, so nothing reads it.

import { LAYR_SIZE } from "./m3-display-channels.js";
import { m3Index } from "./m3-sequences.js";

/** A LAYR's image path reference. */
const LAYR_IMAGE = 4;
/** What a block is padded to, and with: the bytes Blizzard's files pad with. */
const ALIGN = 16;
const PAD = 0xaa;

const same = (storagePath: string): string => storagePath.replace(/\\/g, "/").toLowerCase();

/**
 * `data` with each layer image path that is a key of `textures` (matched in any case, either
 * slash) naming its value instead. Throws when a key is a path no layer names, listing the ones
 * they do, or when a layer's version has no known layout.
 */
export function retextureM3(data: Uint8Array, textures: Readonly<Record<string, string>>): Uint8Array {
  const { view, indexOffset, entries } = m3Index(data);
  const wanted = new Map(Object.entries(textures).map(([from, to]) => [same(from), to]));
  const text = (entry: number, count: number): string => new TextDecoder().decode(data.subarray(entries[entry]!.offset, entries[entry]!.offset + count)).replace(/\0.*$/s, "");

  // Each layer image reference, by where it sits, and the CHAR entry it names.
  const references: { readonly at: number; readonly entry: number }[] = [];
  const named = new Set<string>();
  for (const block of entries) {
    if (block.tag !== "RYAL" || block.count === 0) continue;
    const size = LAYR_SIZE[block.version];
    if (size === undefined) throw new Error(`LAYR version ${block.version} isn't one whose layout is known (${Object.keys(LAYR_SIZE).join(", ")})`);
    for (let k = 0; k < block.count; k++) {
      const at = block.offset + size * k + LAYR_IMAGE;
      if (at + 12 > data.length) throw new Error(`A LAYR block at ${block.offset} runs past the end of the file`);
      const count = view.getUint32(at, true);
      const entry = view.getUint32(at + 4, true);
      if (count === 0 || entries[entry]?.tag !== "RAHC") continue;
      const path = text(entry, count);
      named.add(path);
      if (wanted.has(same(path))) references.push({ at, entry });
    }
  }
  const missing = Object.keys(textures).filter((from) => ![...named].some((path) => same(path) === same(from)));
  if (missing.length > 0) throw new Error(`the model's layers don't name ${missing.join(", ")}: they name ${[...named].join(", ") || "no texture"}`);

  // The new CHAR blocks, after the blocks before the index (the index is last in Blizzard's files; anything after it is kept).
  const indexEnd = indexOffset + 16 * entries.length;
  const body = indexEnd === data.length ? data.subarray(0, indexOffset) : data;
  const chunks: Uint8Array[] = [body];
  let at = body.length;
  const pad = (): void => {
    const extra = (ALIGN - (at % ALIGN)) % ALIGN;
    if (extra > 0) chunks.push(new Uint8Array(extra).fill(PAD));
    at += extra;
  };
  pad();
  const moved = new Map<number, { readonly offset: number; readonly count: number }>();
  for (const { entry } of references) {
    if (moved.has(entry)) continue;
    const bytes = new TextEncoder().encode(`${wanted.get(same(text(entry, entries[entry]!.count)))!}\0`);
    moved.set(entry, { offset: at, count: bytes.length });
    chunks.push(bytes);
    at += bytes.length;
    pad();
  }
  const newIndex = at;
  const index = new Uint8Array(16 * entries.length);
  index.set(data.subarray(indexOffset, indexEnd));
  const indexView = new DataView(index.buffer);
  for (const [entry, { offset, count }] of moved) {
    indexView.setUint32(16 * entry + 4, offset, true);
    indexView.setUint32(16 * entry + 8, count, true);
  }
  chunks.push(index);

  const out = new Uint8Array(at + index.length);
  let written = 0;
  for (const chunk of chunks) {
    out.set(chunk, written);
    written += chunk.length;
  }
  const outView = new DataView(out.buffer);
  outView.setUint32(4, newIndex, true);
  for (const { at: reference, entry } of references) outView.setUint32(reference, moved.get(entry)!.count, true);
  // The old text, left where it was without an index entry, is cleared.
  for (const entry of moved.keys()) {
    const old = entries[entry]!;
    if (old.offset + old.count <= body.length) out.fill(0, old.offset, old.offset + old.count);
  }
  return out;
}
