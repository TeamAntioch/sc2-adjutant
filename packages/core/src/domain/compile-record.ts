// The compile record (ADR-0010): everything the last compile wrote into a Mission's Map Package,
// kept beside its Blueprint as compile-record.json. The next compile removes exactly what the
// record lists and writes the new set; anything in the package that isn't on it is Kept Content.

import { createHash } from "node:crypto";

import { z } from "zod";

import { LIBRARY_STRUCTURE_KINDS } from "./library-interface.js";
import { PackagePath } from "./package-path.js";

/** A short hash of what was written, so a later compile can tell when the Editor changed it. */
export function fingerprint(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const Fingerprint = z.string().regex(/^[0-9a-f]{16}$/, "A fingerprint is 16 hex digits");

export const CompileRecordEntrySchema = z.discriminatedUnion("kind", [
  /** A file written whole. */
  z.object({ kind: z.literal("file"), path: PackagePath, fingerprint: Fingerprint }),
  /**
   * A file written whole that each machine makes for itself and git ignores: an Asset Mod's
   * community asset, fetched to the machine's cache, or a generated placeholder. Its bytes differ
   * from machine to machine, or it isn't there in a fresh clone, so it has no fingerprint.
   */
  z.object({ kind: z.literal("uncommitted"), path: PackagePath }),
  /** A placed object in Objects, by its Id. */
  z.object({ kind: z.literal("object"), id: z.number().int().positive(), fingerprint: Fingerprint }),
  /** A region in Regions, by its id. */
  z.object({ kind: z.literal("region"), id: z.number().int().positive(), fingerprint: Fingerprint }),
  /** One key of a localized strings file (GameStrings.txt, TriggerStrings.txt, …). */
  z.object({ kind: z.literal("string"), file: PackagePath, key: z.string().min(1), fingerprint: Fingerprint }),
  /** A trigger in Triggers, by its element Id. */
  z.object({ kind: z.literal("trigger"), id: z.string().min(1), fingerprint: Fingerprint }),
  /** A global variable in Triggers, by its element Id. */
  z.object({ kind: z.literal("variable"), id: z.string().min(1), fingerprint: Fingerprint }),
  /** A mod library's function in Triggers, by its element Id. */
  z.object({ kind: z.literal("function"), id: z.string().min(1), fingerprint: Fingerprint }),
  /** A mod library's category (trigger folder), preset type, structure, comment or custom script in Triggers, by its element Id. */
  z.object({ kind: z.enum(LIBRARY_STRUCTURE_KINDS), id: z.string().min(1), fingerprint: Fingerprint }),
  /** A Compiled block of MapScript.galaxy, such as `trigger:gt_<name>` (src/triggers/splice-map-script.ts). */
  z.object({ kind: z.literal("galaxy-block"), id: z.string().min(1), fingerprint: Fingerprint }),
  /** One entry of a GameData catalog file, by file and id. */
  z.object({ kind: z.literal("catalog-entry"), file: PackagePath, id: z.string().min(1), fingerprint: Fingerprint }),
  /** Terrain cells of a t3 file, as [x, y, width, height] rectangles (Spec B). */
  z.object({
    kind: z.literal("terrain-cells"),
    file: PackagePath,
    cells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])),
    fingerprint: Fingerprint,
  }),
  /**
   * t3CellFlags' hidden bit (0x4) on the cells the compile writes it on (zone.hiddenCells, #595): a
   * generated map's every cell, or the generating Zones' own beside Kept ground, as rectangles, and
   * which of them it hid. The other bits are worked out from the terrain, so a hide is compared on
   * its own, cell by cell, with no fingerprint (src/map/hidden-cells-changes.ts).
   */
  z.object({ kind: z.literal("hidden-cells"), cells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])), hidden: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])) }),
  /**
   * A texture set of the Blueprint's own (ADR-0016), by its Blueprint id: its index among the map's
   * 8 sets, the 8×8-cell blocks it moved onto it (as cell rectangles), and a fingerprint of its
   * name, its 8 slots and those blocks' tileSet in t3Terrain.xml.
   */
  z.object({
    kind: z.literal("texture-set"),
    id: z.string().min(1),
    set: z.number().int().min(1).max(7),
    blocks: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])),
    fingerprint: Fingerprint,
  }),
  /**
   * A Kept call a hold switched off (ADR-0014, src/triggers/kept-holds.ts), by element Id: a Run
   * Trigger, or a Map Initialization event, in the Kept trigger `trigger` (Galaxy name `script`).
   * Its Galaxy line, and the two lines it sat between, put it back once no hold keeps it. The call
   * stays Kept Content: it has no fingerprint, and the Editor may change it.
   */
  z.object({ kind: z.literal("kept-hold"), id: z.string().min(1), trigger: z.string().min(1), script: z.string().min(1), line: z.string(), gap: z.tuple([z.string(), z.string()]) }),
  /**
   * A Kept MapInfo's playable area, which the compile set to `bounds` (ADR-0015, map/patch-map-info.ts):
   * the rectangle it wrote and the one the package had before, which a compile whose Blueprint no
   * longer asks puts back. MapInfo stays Kept Content: the entry has no fingerprint, and the
   * compile reads the rectangle itself to tell an Editor change.
   */
  z.object({ kind: z.literal("map-bounds"), bounds: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]), original: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]) }),
]);

export type CompileRecordEntry = z.infer<typeof CompileRecordEntrySchema>;

/** What a `map-bounds` entry is called on the command line (compile-map --keep / --discard). */
export const MAP_BOUNDS_ENTRY_NAME = "map-bounds:MapInfo";
/** What the compile's hidden cells are called on the command line, and cells kept from them by their first: `hidden-cells:193,87`. */
export const HIDDEN_CELLS_ENTRY_NAME = "hidden-cells";

/**
 * Compiled Content the author kept when the Editor had changed it (compile-map --keep): it left the
 * entries, so it is Kept Content, and while the Blueprint still declares it the compile doesn't
 * write it. Listed by what it was, without a fingerprint.
 */
export const KeptEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: PackagePath }),
  z.object({ kind: z.literal("object"), id: z.number().int().positive() }),
  z.object({ kind: z.literal("region"), id: z.number().int().positive() }),
  z.object({ kind: z.literal("string"), file: PackagePath, key: z.string().min(1) }),
  z.object({ kind: z.literal("trigger"), id: z.string().min(1) }),
  z.object({ kind: z.literal("variable"), id: z.string().min(1) }),
  z.object({ kind: z.literal("function"), id: z.string().min(1) }),
  z.object({ kind: z.enum(LIBRARY_STRUCTURE_KINDS), id: z.string().min(1) }),
  z.object({ kind: z.literal("catalog-entry"), file: PackagePath, id: z.string().min(1) }),
  /** A texture set the author changed in the Editor and kept: the compile leaves its lines and blocks while it stays here. */
  z.object({
    kind: z.literal("texture-set"),
    id: z.string().min(1),
    set: z.number().int().min(1).max(7),
    blocks: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])),
  }),
  /** Cells whose hidden bit the author changed in the Editor and kept: the compile leaves that bit as the package has it while they stay here. */
  z.object({ kind: z.literal("hidden-cells"), cells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])).min(1) }),
  /** Cells of a generating Zone the author hand-edited and kept: no Zone writes them while they stay here. */
  z.object({
    kind: z.literal("terrain-cells"),
    file: PackagePath,
    cells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])).min(1),
  }),
]);

export type KeptEntry = z.infer<typeof KeptEntrySchema>;

export const CompileRecordSchema = z.object({
  version: z.literal(1),
  entries: z.array(CompileRecordEntrySchema),
  kept: z.array(KeptEntrySchema).optional(),
});

export type CompileRecord = z.infer<typeof CompileRecordSchema>;

/**
 * The ids of `kind` the compile owns or the author kept from it: Compiled Content on the record's
 * entries, and what was kept (compile-map --keep), which the Blueprint still declares. Neither is
 * the package's own Kept Content, which the compile numbers around and sync leaves alone.
 */
export function recordedIds<Kind extends "object" | "region" | "trigger">(
  record: CompileRecord,
  kind: Kind,
): Kind extends "object" | "region" ? Set<number> : Set<string> {
  return new Set([...record.entries, ...(record.kept ?? [])].flatMap((entry) => (entry.kind === kind ? [(entry as { id: number | string }).id] : []))) as never;
}

/** A record with nothing on it: a package whose every part is Kept Content, as Import leaves it. */
export const EMPTY_COMPILE_RECORD: CompileRecord = { version: 1, entries: [] };

export function parseCompileRecord(json: string, source = "compile-record.json"): CompileRecord {
  const result = CompileRecordSchema.safeParse(JSON.parse(json));
  if (!result.success) throw new Error(`${source} isn't a compile record: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** The record as JSON, one entry per line so a compile's git diff shows what changed. */
export function writeCompileRecord(record: CompileRecord): string {
  const list = (items: readonly object[]): string => `[${items.length ? `\n${items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ` : ""}]`;
  const kept = record.kept?.length ? `,\n  "kept": ${list(record.kept)}` : "";
  return `{\n  "version": ${record.version},\n  "entries": ${list(record.entries)}${kept}\n}\n`;
}

/**
 * What an entry is called on the command line (compile-map --keep <entry>): its kind and what
 * names it, such as `object:1234`, `trigger:0A1B2C3D`, `file:t3TextureMasks`, or
 * `string:enUS.SC2Data/LocalizedData/GameStrings.txt:Param/Value/0A1B2C3D`; a generating Zone's
 * cells in a terrain file `terrain-cells:t3HeightMap`, and cells kept from it by their first,
 * `terrain-cells:t3HeightMap:20,60`; the hidden cells `hidden-cells`, and cells kept from them `hidden-cells:193,87`.
 */
export function entryName(entry: CompileRecordEntry | KeptEntry): string {
  switch (entry.kind) {
    case "file":
    case "uncommitted":
      return `file:${entry.path}`;
    case "string":
      return `string:${entry.file}:${entry.key}`;
    case "catalog-entry":
      return `catalog-entry:${entry.file}:${entry.id}`;
    case "terrain-cells":
      // Cells kept from the Editor are named by their first cell, so each can be discarded on its own.
      return "fingerprint" in entry ? `terrain-cells:${entry.file}` : `terrain-cells:${entry.file}:${entry.cells[0]![0]},${entry.cells[0]![1]}`;
    case "hidden-cells":
      // Kept ones are named by their first cell, as kept terrain cells are.
      return "hidden" in entry ? HIDDEN_CELLS_ENTRY_NAME : `${HIDDEN_CELLS_ENTRY_NAME}:${entry.cells[0]![0]},${entry.cells[0]![1]}`;
    case "map-bounds":
      return MAP_BOUNDS_ENTRY_NAME;
    default:
      return `${entry.kind}:${entry.id}`;
  }
}
