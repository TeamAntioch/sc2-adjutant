// Sheet readings (docs/reference/doodad-facings.md): fronts read by eye from the catalog's
// turntable renders, kept in data/doodad-sheet-readings.json beside the author's measurements.
// Which doodads are worth reading, how a reader's JSON lines become entries, and the stand-off a
// floor piece's bounds suggest.

import { type DoodadFacings, type DoodadSheetReadings, frontFromPictures, type SheetReading, SheetReadingSchema } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";

/** Catalog kinds and roles with no front worth reading: rocks, plants, effects, decals, cliffs. */
const UNREAD_KINDS = new Set(["rock", "tree", "foliage", "water/fx", "decal"]);
const UNREAD_ROLES = new Set(["effect", "decal", "foliage", "cliff"]);

/** What `sheetCandidates` needs of a doodad's catalog entry. */
export type CandidateEntry = { readonly kind?: string; readonly description?: { readonly role?: string }; readonly sharesPicture?: readonly string[] };

/**
 * The doodads worth reading from their sheets, sorted: those with renders that the author hasn't
 * measured and no one has read, leaving out rocks, plants, effects, decals and cliffs, and those
 * whose picture is another doodad's.
 */
export function sheetCandidates(catalog: Readonly<Record<string, CandidateEntry>>, rendered: ReadonlySet<string>, facings: DoodadFacings, readings: DoodadSheetReadings): string[] {
  return Object.entries(catalog)
    .filter(([id]) => rendered.has(id) && !facings.doodads[id] && !readings.doodads[id])
    .filter(([, entry]) => !UNREAD_KINDS.has(entry.kind ?? "") && !UNREAD_ROLES.has(entry.description?.role ?? "") && !entry.sharesPicture?.length)
    .map(([id]) => id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** One line a reader writes: a doodad's id with its reading, less who read it. */
export type ReaderLine = Omit<SheetReading, "read" | "standOff"> & { readonly id: string };

/** A reader's JSON lines, each checked; throws naming the first bad line. */
export function parseReaderLines(text: string): ReaderLine[] {
  return text
    .split("\n")
    .map((line, n) => [line.trim(), n + 1] as const)
    .filter(([line]) => line.length > 0)
    .map(([line, n]) => {
      try {
        const { id, ...reading } = JSON.parse(line) as { id?: unknown };
        if (typeof id !== "string" || id.length === 0) throw new Error("no id");
        const parsed = SheetReadingSchema.omit({ read: true, standOff: true }).safeParse(reading);
        if (!parsed.success) throw new Error(`${id}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "reading"}: ${issue.message}`).join("; ")}`);
        return { id, ...parsed.data };
      } catch (error) {
        throw new Error(`line ${n}: ${(error as Error).message}`, { cause: error });
      }
    });
}

/** How far past its back a floor piece stands from a wall's edge, beyond its depth: fits the author's DOM_LabWallScreens (4.63 deep, 5.1 out). */
const BACK_GAP = 0.5;
/** Within this of the wall-foot default, a suggestion isn't worth giving. */
const TOLERANCE = 0.3;

/** A model's bounds in its own frame, as model-footprints reads them. */
export type Bounds = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };

/**
 * The stand-off a floor piece's bounds suggest, facing `front` (degrees) at rotation 0: its depth
 * from its origin to its back plus half a cell, when that's further out than the wall-foot
 * default by more than 0.3. Bounds that are a cube are the model's culling box, not its shape (a
 * light's, an emitter's), so they suggest nothing. Checked against the author's measurements
 * of 2026-11-09: it fits DOM_LabWallScreens and every floor piece that looked right at the
 * default, except SpaceArmoredDoorDiagonal, which it puts 0.8 too far out.
 */
export function suggestedStandOff(bounds: Bounds, front: number, wallFoot: number): number | undefined {
  const [w, d, h] = [0, 1, 2].map((axis) => bounds.max[axis]! - bounds.min[axis]!) as [number, number, number];
  if (Math.abs(w - d) < 0.02 && Math.abs(d - h) < 0.02) return undefined;
  const back = ((front + 180) * Math.PI) / 180;
  const [bx, by] = [Math.cos(back), Math.sin(back)];
  const depth = Math.max(...[bounds.min[0], bounds.max[0]].flatMap((x) => [bounds.min[1], bounds.max[1]].map((y) => x * bx + y * by)));
  const standOff = Math.round((depth + BACK_GAP) * 10) / 10;
  return standOff > wallFoot + TOLERANCE ? standOff : undefined;
}

/**
 * The readings with the reader's lines in, each replacing its doodad's old reading, marked `read`.
 * A doodad the author has measured is skipped: a measurement always wins. `bounds` gives the
 * models' bounds for the stand-off suggestion of a wall-foot piece.
 */
export function mergeSheetReadings(
  readings: DoodadSheetReadings,
  lines: readonly ReaderLine[],
  read: string,
  facings: DoodadFacings,
  bounds: Readonly<Record<string, Bounds>> = {},
): { readonly readings: DoodadSheetReadings; readonly skipped: readonly string[] } {
  const doodads = { ...readings.doodads };
  const skipped: string[] = [];
  const wallFoot = facings.placements["wall-foot"].standOff ?? 2.6;
  for (const { id, ...reading } of lines) {
    if (facings.doodads[id]) {
      skipped.push(id);
      continue;
    }
    const front = frontFromPictures(reading.faces);
    const box = bounds[id];
    // Without its bounds this time, a doodad keeps the suggestion it had for the same front and placement.
    const before = doodads[id];
    const kept = before && frontFromPictures(before.faces) === front && before.placement === reading.placement ? before.standOff : undefined;
    const standOff = front !== undefined && reading.placement === "wall-foot" ? (box ? suggestedStandOff(box, front, wallFoot) : kept) : undefined;
    // Keys in the schema's order, so the file reads the same whoever wrote it.
    doodads[id] = {
      faces: reading.faces,
      sure: reading.sure,
      ...(reading.faces.length > 0 && reading.placement ? { placement: reading.placement } : {}),
      ...(standOff !== undefined ? { standOff } : {}),
      ...(reading.note ? { note: reading.note } : {}),
      read,
    };
  }
  const sorted = Object.fromEntries(Object.entries(doodads).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { readings: { ...readings, doodads: sorted }, skipped };
}

const inline = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(inline).join(", ")}]`
    : typeof value === "object" && value !== null
      ? `{${Object.entries(value).map(([key, field]) => `${JSON.stringify(key)}: ${inline(field)}`).join(", ")}}`
      : JSON.stringify(value);

/** doodad-sheet-readings.json as core keeps it: one doodad to a line. */
export function formatSheetReadings(readings: DoodadSheetReadings): string {
  const entries = Object.entries(readings.doodads);
  return [
    "{",
    `  "about": ${JSON.stringify(readings.about)},`,
    `  "pictures": ${JSON.stringify(readings.pictures)},`,
    '  "doodads": {',
    ...entries.map(([id, reading], n) => `    ${JSON.stringify(id)}: ${inline(reading)}${n < entries.length - 1 ? "," : ""}`),
    "  }",
    "}",
    "",
  ].join("\n");
}
