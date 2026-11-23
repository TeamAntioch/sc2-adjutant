// The Melee Map Blueprint (spec #212): a 1v1 ladder-style map, compiled to a map the Editor calls
// Melee. It shares the Mission Blueprint's zones, connections, terrain fields and `resource-base`
// Placement, and has none of a Mission's story: no Beats, Screenplay, Waves, Mechanics, Anchors
// or tech. It draws half the map; the compiler makes the other half by `symmetry` (#214,
// map/rotate-half.ts).

import { z } from "zod";

import {
  checkTerrainFields,
  CliffPaletteSchema,
  MapSizeSchema,
  RampSchema,
  ResourceBaseParamsSchema,
  slugId,
  TerrainObjectPlacementSchema,
  TexturePaletteSchema,
  ZoneConnectionSchema,
  ZoneSchema,
} from "./mission-blueprint.js";

export const DIAGONAL_FACINGS = ["south-west", "south-east", "north-west", "north-east"] as const;
/** The corner a melee base's mineral line wraps: away from the base's entrance. */
export type DiagonalFacing = (typeof DIAGONAL_FACINGS)[number];

/**
 * A connection opens and closes with no beats: a melee map has none. A `rocks` or `collapsible`
 * connection would promise rocks the compiler doesn't place there (#216): rocks are a `rocks`
 * placement on the path, and collapsible rock towers aren't built yet. An `air-only` connection
 * draws no ground path, which is what it says.
 */
const MeleeZoneSchema = ZoneSchema.extend({
  connections: z
    .array(
      ZoneConnectionSchema.omit({ opensAtBeat: true, closesAtBeat: true }).refine((connection) => connection.type !== "rocks" && connection.type !== "collapsible", {
        message: "A melee map draws nothing for a rocks or collapsible connection: leave the zones open, and put a `rocks` placement on the path",
        path: ["type"],
      }),
    )
    .default([]),
});

/**
 * A standard melee base (#215, map/melee-bases.ts) of minerals and geysers, all Neutral: no town
 * hall or Assimilators, which would give a player pre-placed units (an Editor non-melee reason).
 */
export const MeleeResourceBaseParamsSchema = z
  .object({
    /** The town-hall spot: its 5×5 footprint snaps onto the cell grid. */
    at: ResourceBaseParamsSchema.shape.at.unwrap(),
    /**
     * The corner the mineral line wraps, away from the base's entrance. A start base's defaults to
     * away from its main ramp; every other base needs one.
     */
    facing: z.enum(DIAGONAL_FACINGS).optional(),
    /** `rich`: a gold base of 6 rich patches. */
    minerals: z.enum(["normal", "rich"]).default("normal"),
    /** `rich`: two rich geysers; `one-rich`: a single rich geyser. */
    gas: z.enum(["normal", "rich", "one-rich"]).default("normal"),
  })
  .strict()
  .refine((params) => params.minerals === "normal" || params.gas === "normal", {
    message: "A ladder base is gold or rich-gas, not both: a gold base has normal geysers",
    path: ["gas"],
  });
export type MeleeResourceBaseParams = z.infer<typeof MeleeResourceBaseParamsSchema>;

const MeleeResourceBasePlacementSchema = z
  .object({
    id: slugId,
    zoneId: slugId,
    kind: z.literal("resource-base"),
    params: MeleeResourceBaseParamsSchema,
  })
  .strict();

/** The ladder maps' destructible rocks by size (melee research §1 "Watchtowers, rocks"): 2000 HP, blocking until killed. */
export const MELEE_ROCKS = { "6x6": "DestructibleRockEx16x6", "4x4": "DestructibleRockEx14x4" } as const;

/**
 * Destructible rocks, Neutral, on whole coordinates as ladder maps place them: they block a ground
 * path until they're killed, and the distance report gives each time rocks up and rocks down.
 */
const MeleeRocksPlacementSchema = z
  .object({
    id: slugId,
    zoneId: slugId,
    kind: z.literal("rocks"),
    params: z
      .object({
        at: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
        size: z.enum(["6x6", "4x4"]).default("6x6"),
      })
      .strict(),
  })
  .strict();

const MeleePlacementSchema = z.discriminatedUnion("kind", [MeleeResourceBasePlacementSchema, MeleeRocksPlacementSchema]);
export type MeleePlacement = z.infer<typeof MeleePlacementSchema>;
export type MeleeResourceBasePlacement = z.infer<typeof MeleeResourceBasePlacementSchema>;
export const isResourceBase = (placement: MeleePlacement): placement is MeleeResourceBasePlacement => placement.kind === "resource-base";

export const MeleeMapBlueprintSchema = z
  .object({
    id: slugId,
    title: z.string().min(1),
    summary: z.string().min(1).optional(),
    /** Sets the distance targets; Standard (33-38 s ramp to ramp) only for now. */
    category: z.literal("standard"),
    /** 1v1 only for now. */
    spawns: z.literal(2),
    /** How the other half is made from the one drawn: turned 180° about the playable area's centre. */
    symmetry: z.literal("rot180"),
    mapSize: MapSizeSchema,
    /** The playable area, centred across the map and with the larger margin at the top, as on ladder maps. */
    playableSize: MapSizeSchema,
    tilesetId: z.string().min(1).optional(),
    lighting: z.string().min(1).optional(),
    textures: z.array(z.string().min(1)).min(1).max(8).optional(),
    texturePalette: TexturePaletteSchema.optional(),
    cliffPalette: CliffPaletteSchema.optional(),
    raggedCliffs: z.number().min(0).max(8).optional(),
    /** Seeds the ragged cliffs' wobble in place of the id, as on a Mission Blueprint (keep it at the old id across a rename). */
    terrainSeed: z.string().min(1).optional(),
    zones: z.array(MeleeZoneSchema).min(1),
    ramps: z.array(RampSchema).default([]),
    terrainObjects: z.array(TerrainObjectPlacementSchema).default([]),
    placements: z.array(MeleePlacementSchema).default([]),
    /** The half's start bases, one per pair of spawns: the rotation makes the other. Each gets a start location at its town-hall spot. */
    starts: z.array(slugId),
  })
  .strict()
  .superRefine((blueprint, context) => {
    const issue = (message: string, path: (string | number)[]) => context.addIssue({ code: "custom", message, path });
    for (const [key, ids] of [
      ["zones", blueprint.zones.map((zone) => zone.id)],
      ["ramps", blueprint.ramps.map((ramp) => ramp.id)],
      ["terrainObjects", blueprint.terrainObjects.map((object) => object.id)],
      ["placements", blueprint.placements.map((placement) => placement.id)],
    ] as const) {
      ids.forEach((id, index) => {
        if (ids.indexOf(id) !== index) issue(`Duplicate id: ${id}`, [key, index, "id"]);
      });
    }
    checkTerrainFields(blueprint, context, new Set());

    const zoneIds = new Set(blueprint.zones.map((zone) => zone.id));
    blueprint.placements.forEach((placement, index) => {
      if (!zoneIds.has(placement.zoneId)) issue(`Unknown zone id: ${placement.zoneId}`, ["placements", index, "zoneId"]);
    });

    // The half has half the starts: the rotation turns each onto the other spawn's.
    const halfStarts = blueprint.spawns / 2;
    if (blueprint.starts.length !== halfStarts) {
      issue(`Half of a ${blueprint.spawns}-spawn map needs ${halfStarts} start (the rotation makes the other), not ${blueprint.starts.length}`, ["starts"]);
    }
    const placementIds = new Set(blueprint.placements.filter(isResourceBase).map((placement) => placement.id));
    blueprint.placements.forEach((placement, index) => {
      if (isResourceBase(placement) && placement.params.facing === undefined && !blueprint.starts.includes(placement.id)) {
        issue(`Resource base ${placement.id} needs a \`facing\`: only a start base faces away from its main ramp by default`, ["placements", index, "params", "facing"]);
      }
    });
    blueprint.starts.forEach((id, index) => {
      if (!placementIds.has(id)) issue(`Unknown resource-base placement id: ${id}`, ["starts", index]);
      else if (blueprint.starts.indexOf(id) !== index) issue(`Two spawns start at ${id}`, ["starts", index]);
    });

    const { mapSize: map, playableSize: playable } = blueprint;
    if (playable.width > map.width || playable.height > map.height) {
      issue(`The playable area (${playable.width}×${playable.height}) must fit inside the map (${map.width}×${map.height})`, ["playableSize"]);
    } else if ((map.width - playable.width) % 2 !== 0) {
      issue(`The map's width less the playable width must be even, to centre it (${map.width} - ${playable.width})`, ["playableSize", "width"]);
    } else if (playable.height % 2 !== 0) {
      // So the centre falls on a cell boundary and the rotation turns the 2×2 cliff grid onto itself.
      issue(`The playable height must be even, for the rotation to keep the cliff grid (${playable.height})`, ["playableSize", "height"]);
    }
  });

export type MeleeMapBlueprint = z.infer<typeof MeleeMapBlueprintSchema>;

/**
 * The playable bounds [left, bottom, right, top]: centred across, and up the map with a third of
 * the spare rows below and the rest above: ladder maps mostly keep the bigger margin at the top.
 */
export function meleePlayableBounds(blueprint: Pick<MeleeMapBlueprint, "mapSize" | "playableSize">): readonly [number, number, number, number] {
  const { mapSize: map, playableSize: playable } = blueprint;
  const left = (map.width - playable.width) / 2;
  const bottom = Math.floor((map.height - playable.height) / 3);
  return [left, bottom, left + playable.width, bottom + playable.height];
}
