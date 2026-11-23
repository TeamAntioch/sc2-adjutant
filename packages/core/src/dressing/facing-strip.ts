// The facing strip (docs/reference/doodad-facings.md): a test map for measuring which way doodads
// face and where they stand against a wall, as the author measured the first ones on 2026-11-09.
// Rows of straight walls face south; one of each doodad stands at a wall's foot at rotation 0,
// over a point named for it. The author turns, moves and raises each until it looks right and
// saves; `readFacingStrip` turns what they saved into doodad-facings.json entries.

import type { DoodadFacing, DoodadFacings, DoodadPlacement } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import type { PlacedDoodad as EditorDoodad } from "../map/read-objects-xml.js";
import { stableObjectId } from "../map/stable-object-id.js";

/** A wall faces south: its front, the room side, at 270°. */
const ROOM = 270;
/** Where each doodad stands to start, as a floor piece at the wall's foot (doodad-facings.json's wall-foot). */
export const STRIP_STAND_OFF = 2.6;
const FLOOR = 1;
const WALL = 3;
const WALL_DEPTH = 8;
const FLOOR_DEPTH = 16;
const MARGIN = 8;
/** A doodad farther out than this from its wall stands free of it. */
const FREE_BEYOND = 6;
/** Hung: raised more than this above the ground under it. */
const HUNG_ABOVE = 0.5;
/** Within this of its placement's default, a stand-off or height isn't recorded as the doodad's own. */
const TOLERANCE = 0.3;

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The anchor id of the strip's `n`th doodad, and of the point under it. */
const doodadId = (n: number): string => `strip-${n + 1}`;
const pointId = (n: number): string => `strip-${n + 1}-label`;

export type FacingStripOptions = {
  readonly campaignId: string;
  readonly tilesetId?: string;
  /** Cells between doodads along a wall; 8 by default. */
  readonly spacing?: number;
  /** The map dependencies the doodads need, beyond what the compile adds itself. */
  readonly dependencies?: readonly string[];
};

/**
 * The strip's Blueprint (as stored, before defaults): a floor at level 1 with rows of walls two
 * levels up, each row's south edge straight, and for each doodad a doodad anchor at rotation 0 and
 * scale 1, `STRIP_STAND_OFF` cells south of its wall's edge, over a point anchor named for it.
 */
export function facingStripBlueprint(types: readonly string[], options: FacingStripOptions): Record<string, unknown> {
  if (types.length === 0) throw new Error("The facing strip needs at least one doodad");
  const spacing = options.spacing ?? 8;
  const width = 256;
  const perRow = Math.floor((width - 2 * MARGIN) / spacing);
  const rows = Math.ceil(types.length / perRow);
  const band = WALL_DEPTH + FLOOR_DEPTH;
  const height = Math.max(64, Math.ceil((rows * band + 2 * MARGIN) / 16) * 16);
  if (height > 256) throw new Error(`The facing strip holds at most ${perRow * Math.floor((256 - 2 * MARGIN) / band)} doodads at spacing ${spacing}: measure ${types.length} in two strips`);
  // Row 0 at the top. A row's wall runs from its edge up to the band's top; its floor lies below.
  const edgeOf = (row: number): number => height - MARGIN - row * band - WALL_DEPTH;
  const walls = Array.from({ length: rows }, (_, row) => ({
    id: `wall-${row + 1}`,
    name: `Wall ${row + 1}`,
    elevation: WALL,
    landform: "flat",
    role: "path",
    surface: "built",
    polygon: rect(MARGIN / 2, edgeOf(row), width - MARGIN / 2, edgeOf(row) + WALL_DEPTH),
  }));
  const anchors = types.flatMap((type, n) => {
    const row = Math.floor(n / perRow);
    const x = MARGIN + spacing / 2 + (n % perRow) * spacing;
    // The doodad on the ground there, as the compile stands one with no height.
    const position = { x, y: edgeOf(row) - STRIP_STAND_OFF };
    return [
      { id: doodadId(n), name: type, zoneId: "floor", kind: "doodad", doodadType: type, variation: 0, position, rotation: 0, scale: 1 },
      { id: pointId(n), name: type, zoneId: "floor", kind: "point", position: { ...position, z: 0 } },
    ];
  });
  return {
    id: "facing-strip",
    campaignId: options.campaignId,
    title: "Facing Strip",
    summary: "One of each doodad at rotation 0 at the foot of a south-facing wall: turn, move and raise each until it looks right, save, then read it back with npm run facing-strip -- --read.",
    setting: "test strip",
    mapSize: { width, height },
    raggedCliffs: 0,
    tilesetId: options.tilesetId ?? "KorhalCityEx2",
    ...(options.dependencies?.length ? { dependencies: options.dependencies } : {}),
    zones: [{ id: "floor", name: "Floor", elevation: FLOOR, landform: "flat", role: "base", surface: "built", polygon: rect(0, 0, width, height) }, ...walls],
    anchors,
    beats: [{ id: "measure", title: "Measure", summary: "The author sets each doodad as it should stand." }],
    placements: [],
    screenplay: { title: "Facing Strip" },
  };
}

/** One doodad as the author left it on the strip. */
export type StripReading = {
  readonly type: string;
  readonly facing: Omit<DoodadFacing, "measured">;
  /** As saved: the rotation (degrees), distance out from the wall's edge and height above the ground under it. */
  readonly saved: { readonly rotation: number; readonly standOff: number; readonly height: number };
};

export type StripRead = {
  readonly readings: readonly StripReading[];
  /** Doodads the strip placed that the saved map no longer has: the author deleted them, so they stay unmeasured. */
  readonly missing: readonly string[];
};

const round = (value: number, places = 1): number => Math.round(value * 10 ** places) / 10 ** places;
const wrapDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

/**
 * What the author's saved strip says about each doodad: its front from its rotation (the room is
 * south, so front = 270° less its rotation, to the degree), and its placement from where it
 * stands: on the wall (wall-top), raised over half a cell (wall-face, with its height), more than
 * 6 cells out (free), else at the wall's foot. A doodad is found by its Editor Id, else as the
 * nearest of its type within half the spacing of its point. A stand-off or height within 0.3 of
 * its placement's default isn't recorded as its own.
 */
export function readFacingStrip(
  strip: MissionBlueprint,
  doodads: readonly EditorDoodad[],
  groundAt: (x: number, y: number) => number,
  defaults: DoodadFacings["placements"],
): StripRead {
  const walls = strip.zones.filter((zone) => zone.id.startsWith("wall-"));
  const spots = strip.anchors.filter((anchor) => anchor.kind === "doodad" && anchor.id.startsWith("strip-"));
  const spacing = spots.length > 1 ? Math.abs(spots[1]!.position!.x - spots[0]!.position!.x) || 8 : 8;
  const readings: StripReading[] = [];
  const missing: string[] = [];
  for (const spot of spots) {
    const type = spot.doodadType!;
    const at = spot.position!;
    const id = stableObjectId(spot.id);
    const doodad =
      doodads.find((d) => d.id === id && d.type === type) ??
      doodads
        .filter((d) => d.type === type && Math.hypot(d.position.x - at.x, d.position.y - at.y) <= spacing / 2)
        .sort((a, b) => Math.hypot(a.position.x - at.x, a.position.y - at.y) - Math.hypot(b.position.x - at.x, b.position.y - at.y))[0];
    if (!doodad) {
      missing.push(type);
      continue;
    }
    // Its wall: the row whose edge is nearest above its point.
    const edge = Math.min(...walls.map((wall) => Math.min(...wall.polygon.map((p) => p.y))).filter((y) => y >= at.y));
    const standOff = edge - doodad.position.y;
    const raised = doodad.flags.includes("HeightOffset") && !doodad.flags.includes("HeightAbsolute") ? doodad.position.z : doodad.position.z - groundAt(doodad.position.x, doodad.position.y);
    const rotation = wrapDegrees((doodad.yaw * 180) / Math.PI);
    const placement: DoodadPlacement = standOff < 0 ? "wall-top" : raised > HUNG_ABOVE ? "wall-face" : standOff > FREE_BEYOND ? "free" : "wall-foot";
    const own = defaults[placement];
    const facing: Omit<DoodadFacing, "measured"> = {
      front: wrapDegrees(Math.round(ROOM - rotation)),
      placement,
      ...(placement !== "free" && (own.standOff === undefined || Math.abs(standOff - own.standOff) > TOLERANCE) ? { standOff: round(standOff) } : {}),
      ...(placement === "wall-face" && (own.height === undefined || Math.abs(raised - own.height) > TOLERANCE) ? { height: round(raised) } : {}),
    };
    readings.push({ type, facing, saved: { rotation: round(rotation), standOff: round(standOff, 2), height: round(raised, 2) } });
  }
  return { readings, missing };
}

/** The facings with the readings in, each replacing any entry its doodad had, marked `measured`. */
export function mergeFacings(facings: DoodadFacings, readings: readonly StripReading[], measured: string): DoodadFacings {
  const doodads = { ...facings.doodads };
  for (const { type, facing } of readings) doodads[type] = { ...facing, measured };
  return { ...facings, doodads: Object.fromEntries(Object.entries(doodads).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

/** doodad-facings.json as core keeps it: one placement and one doodad to a line. */
export function formatDoodadFacings(facings: DoodadFacings): string {
  const inline = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(inline).join(", ")}]`
      : typeof value === "object" && value !== null
        ? `{${Object.entries(value).map(([key, field]) => `${JSON.stringify(key)}: ${inline(field)}`).join(", ")}}`
        : JSON.stringify(value);
  const block = (entries: [string, unknown][]): string[] => entries.map(([key, value], n) => `    ${JSON.stringify(key)}: ${inline(value)}${n < entries.length - 1 ? "," : ""}`);
  return [
    "{",
    `  "about": ${JSON.stringify(facings.about)},`,
    '  "placements": {',
    ...block(Object.entries(facings.placements)),
    "  },",
    '  "doodads": {',
    ...block(Object.entries(facings.doodads)),
    "  }",
    "}",
    "",
  ].join("\n");
}
