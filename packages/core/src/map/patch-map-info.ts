// A Kept map's playable area, changed in place (ADR-0015). Beside Kept terrain the package's MapInfo
// is Kept Content, and the compile rewrites only its bounds: the four int32s after the tileset, and
// the integrity hash at byte 8 they feed, which the game checks (kept-checks.ts mapInfoHashProblems).
// The record lists what it wrote and what was there before (`map-bounds`), so a compile whose
// Blueprint no longer asks puts the package's own rectangle back.

import { Buffer } from "node:buffer";

import { type CompileRecordEntry, MAP_BOUNDS_ENTRY_NAME } from "../domain/compile-record.js";
import { MAPINFO_MAGIC, mapInfoIntegrityHash } from "../terrain/write-map-info.js";
import type { EditorChange } from "./editor-changes.js";
import { type Rect, rectText, sameRect } from "./map-bounds.js";
import { readMapInfoHashedFields } from "./read-map-info-fields.js";

/** The only MapInfo version the hash formula has been confirmed on (kept-checks.ts). */
const PATCHED_VERSION = 39;

export type MapBoundsEntry = Extract<CompileRecordEntry, { kind: "map-bounds" }>;

export { MAP_BOUNDS_ENTRY_NAME } from "../domain/compile-record.js";

/** The playable area MapInfo holds. */
export function mapInfoBounds(buffer: Buffer): Rect {
  return readMapInfoHashedFields(buffer).bounds;
}

/** MapInfo with its playable area set to `bounds` and its integrity hash to match; everything else byte for byte. */
export function patchMapInfoBounds(buffer: Buffer, bounds: Rect): Buffer {
  if (buffer.toString("ascii", 0, 4) !== MAPINFO_MAGIC) throw new Error(`MapInfo has no ${MAPINFO_MAGIC} magic, so its bounds can't be set: resave the map in the Editor`);
  const version = buffer.readUInt32LE(4);
  if (version !== PATCHED_VERSION) throw new Error(`MapInfo is version ${version}, and only version ${PATCHED_VERSION}'s bounds can be set, the only one whose integrity hash is known: resave the map in a current Editor`);
  if (!bounds.every(Number.isInteger)) throw new Error(`MapInfo's bounds are whole cells: ${rectText(bounds)}`);
  const fields = readMapInfoHashedFields(buffer);
  if (bounds[2] > fields.width || bounds[3] > fields.height) throw new Error(`The playable area ${rectText(bounds)} runs off the ${fields.width}×${fields.height} map`);
  const patched = Buffer.from(buffer);
  bounds.forEach((value, index) => patched.writeInt32LE(value, fields.boundsOffset + index * 4));
  const hash = mapInfoIntegrityHash({ width: fields.width, height: fields.height, descriptionLength: [...fields.description].length, bounds, gameOptionsFlags: fields.gameOptions });
  patched.writeBigUInt64LE(BigInt.asUintN(64, hash), 8);
  return patched;
}

/**
 * A Kept Minimap.tga for new bounds on a map of `map`'s size: the Editor draws it black outside the
 * bounds, so pixels whose cell lies outside `to` are blacked out (one pixel per cell, or scaled when
 * the image is another size). Pixels inside `to` but outside the bounds it was drawn for (`from`)
 * are black already and can't be drawn here, so then, or for a minimap this can't read, the warning
 * asks for an Editor save, which redraws it. No content when nothing changes.
 */
export function maskMinimap(buffer: Buffer, map: { readonly width: number; readonly height: number }, from: Rect, to: Rect): { readonly content?: Buffer; readonly warning?: string } {
  const resave = `Resave the map in the Editor so it redraws Minimap.tga for the playable area ${rectText(to)}`;
  const bytesPerPixel = (buffer[16] ?? 0) / 8;
  if (buffer.length < 18 || buffer[2] !== 2 || (bytesPerPixel !== 3 && bytesPerPixel !== 4)) return { warning: `The package's Minimap.tga isn't an uncompressed TGA, so the compile can't mask it to the new bounds. ${resave}` };
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const topOrigin = (buffer[17]! & 0x20) !== 0;
  // Past the ID field and any colour map: its length (bytes 5-6) times its entry size in bits (byte 7).
  const start = 18 + buffer[0]! + (buffer[1] === 0 ? 0 : buffer.readUInt16LE(5) * Math.ceil(buffer[7]! / 8));
  if (width === 0 || height === 0 || buffer.length < start + width * height * bytesPerPixel) return { warning: `The package's Minimap.tga is shorter than its header says. ${resave}` };
  const out = Buffer.from(buffer);
  const [left, bottom, right, top] = to;
  let changed = false;
  for (let row = 0; row < height; row++) {
    // Rows run from the top of the map down when the origin is the top-left.
    const fromBottom = topOrigin ? height - 1 - row : row;
    const cellY = ((fromBottom + 0.5) * map.height) / height;
    for (let x = 0; x < width; x++) {
      const cellX = ((x + 0.5) * map.width) / width;
      if (cellX >= left && cellX < right && cellY >= bottom && cellY < top) continue;
      const at = start + (row * width + x) * bytesPerPixel;
      for (let channel = 0; channel < 3; channel++) {
        if (out[at + channel] !== 0) changed = true;
        out[at + channel] = 0;
      }
    }
  }
  const grows = to[0] < from[0] || to[1] < from[1] || to[2] > from[2] || to[3] > from[3];
  return {
    ...(changed ? { content: out } : {}),
    ...(grows ? { warning: `The playable area ${rectText(to)} reaches past the bounds the package's Minimap.tga was drawn for (${rectText(from)}), where it is black. ${resave}` } : {}),
  };
}

/**
 * What a compile beside Kept terrain does with the package's playable area, from what MapInfo holds
 * (`current`), what the last compile recorded writing (`previous`), what the Blueprint asks for
 * (`wanted`, none when it gives no `bounds.playable`) and the author's decision on an Editor change:
 *
 * - Asked for: written, recorded with the rectangle that was there before the first such compile.
 * - No longer asked for: the recorded original put back, and nothing recorded.
 * - Moved in the Editor since the last compile, to other than what the Blueprint asks: an Editor
 *   change, kept (the package's rectangle stays this once, and is recorded as written, so the next
 *   compile writes the Blueprint's again unless it says otherwise) or discarded (the Blueprint's is
 *   written). The change is returned either way, for the compile to list with the others, which
 *   stops it when there is no decision. Moved, and no longer asked for, the Editor's stays.
 */
export function planKeptBounds({
  current,
  previous,
  wanted,
  decision,
}: {
  readonly current: Rect;
  /**
   * The map-bounds entries the last compile's record lists: one, or, after a compile cut short
   * between its two saves, the one before it as well, oldest first.
   */
  readonly previous: readonly MapBoundsEntry[];
  readonly wanted: Rect | undefined;
  readonly decision: "keep" | "discard" | undefined;
}): { readonly write?: Rect; readonly entry?: MapBoundsEntry; readonly change?: EditorChange; readonly warning?: string } {
  // A rectangle an entry wrote is the compile's own. After a compile cut short (two entries) so is
  // the one the older entry wrote, or the package's original. With one entry, the original is an
  // Editor change: the author put the package's own rectangle back.
  const recorded = previous.at(-1);
  const cutShort = previous.length > 1;
  const editorMoved = recorded !== undefined && !previous.some((entry) => sameRect(current, entry.bounds) || (cutShort && sameRect(current, entry.original)));
  const previousOriginal = previous[0]?.original;
  if (wanted === undefined) {
    if (!previousOriginal || editorMoved || sameRect(current, previousOriginal)) return {};
    return { write: previousOriginal };
  }
  const entry = (bounds: Rect, from: Rect): MapBoundsEntry | undefined => (sameRect(bounds, from) ? undefined : { kind: "map-bounds", bounds: [...bounds] as MapBoundsEntry["bounds"], original: [...from] as MapBoundsEntry["original"] });
  const record = (bounds: Rect, from: Rect) => {
    const made = entry(bounds, from);
    return made ? { entry: made } : {};
  };
  if (!editorMoved || sameRect(current, wanted)) {
    return { ...(sameRect(current, wanted) ? {} : { write: wanted }), ...record(wanted, previousOriginal ?? current) };
  }
  const change: EditorChange = { entry: recorded!, name: MAP_BOUNDS_ENTRY_NAME, change: "changed in the Editor", label: `the playable area, now ${rectText(current)}; the Blueprint's bounds.playable is ${rectText(wanted)}, so set that to ${rectText(current)} to keep it for good` };
  if (decision === "discard") return { change, write: wanted, ...record(wanted, previousOriginal!) };
  if (decision === "keep") {
    return {
      change,
      ...record(current, previousOriginal!),
      warning: `Kept the Editor's playable area ${rectText(current)} this once: the Blueprint's bounds.playable is still ${rectText(wanted)}, which the next compile writes. Set bounds.playable to ${rectText(current)} to keep the Editor's`,
    };
  }
  return { change };
}
