import { z } from "zod";

import {
  bindPlugins,
  EMPTY_REGISTRY,
  mechanicLabel,
  type PluginRegistry,
  runHook,
} from "../plugins/plugin-api.js";
import { mechanicContext } from "../plugins/mechanic-context.js";
import { stableObjectId } from "../map/stable-object-id.js";
import { VOICE_FORMATS } from "./asset-source.js";
import { NAMED_ID, NAMED_ID_RULE } from "./named-id.js";
import { slugId } from "./slug-id.js";
import { DeclaredContentShape } from "./declared-content.js";
import { type Collection, idEntries, idsOf, unknownIdIssue } from "./reference-graph.js";
import { UNEXPLORED_AREAS } from "./unexplored-areas.js";
import { CatalogId } from "./mod-screenplay.js";
import { canonicalAddress, DIRECTION_ADDRESS, directionAddress } from "../script/scene-parts.js";
import { bindCatalog, type Catalog, EMPTY_CATALOG, layerSource, withDoodads } from "../catalog/catalog-layer.js";
import { MissionDoodadsSchema } from "./custom-doodad.js";
import { BlueprintTriggerFolderSchema, BlueprintTriggerPath } from "./blueprint-trigger.js";
import { MAP_GUI } from "./library-interface.js";
import { isKnownUpgrade, techUnit } from "../catalog/tech-catalog.js";
import { isKnownCliffSet } from "../catalog/tileset-cliff-sets.js";
import { isKnownTexture, isKnownTileset, missionTextures } from "../catalog/tileset-textures.js";
import { blockOf, blockOrigin, blockSet, CELLS_PER_BLOCK } from "../terrain/texture-grid.js";
import { containsPoint } from "../terrain/polygon.js";

/** An id: lowercase letters, digits, hyphens and underscores, starting with a letter (domain/slug-id.ts). */
export { slugId };

const PositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite().optional(),
  })
  .strict();

/** One shape of an Editor region; a `negative` one cuts its area out of the others. */
export const RegionShapeSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("rect"), quad: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]), negative: z.boolean().optional() })
    .strict(),
  z.object({ type: z.literal("circle"), center: PositionSchema, radius: z.number().positive(), negative: z.boolean().optional() }).strict(),
  z
    .object({ type: z.literal("diamond"), center: PositionSchema, width: z.number().positive(), height: z.number().positive(), negative: z.boolean().optional() })
    .strict(),
]);
export type RegionShape = z.infer<typeof RegionShapeSchema>;

/** An Editor region as drawn: its shapes, and the Editor's colour (four numbers, kept as written) and visibility. */
const RegionLookSchema = z
  .object({
    shapes: z.array(RegionShapeSchema).min(1),
    color: z.string().min(1).optional(),
    invisible: z.boolean().optional(),
  })
  .strict();
export type RegionLook = z.infer<typeof RegionLookSchema>;

/** A region the author drew in the Editor, kept as drawn (synced back by `npm run sync`). */
const RegionSchema = RegionLookSchema.extend({ id: slugId, name: z.string().min(1) }).strict();

/**
 * How a crossing between two zones plays, as Blizzard's campaign missions build them:
 * - open: the zones meet along a wide edge at the same level.
 * - narrow: a deliberately thin passage of `width` cells.
 * - ramp: climbs exactly one cliff level; compiled to a ramp on the high zone's edge.
 * - rocks: blocked by destructible rocks; opens when they're destroyed.
 * - collapsible: open beside a collapsible rock tower; closes when it's destroyed.
 * - bridge: crosses a pit or void at the same level; compiled to a stock bridge across the gap
 *   between the zones, with bridgeheads where the gap is longer than the bridge (level 1 only).
 * - air-only: no ground path.
 * Only `ramp` and `bridge` are compiled into terrain so far; the others are declared and previewed.
 */
const ConnectionTypeSchema = z.enum(["open", "narrow", "ramp", "rocks", "collapsible", "bridge", "air-only"]);

export const ZoneConnectionSchema = z
  .object({
    toZoneId: slugId,
    type: ConnectionTypeSchema,
    /** Passable width in cells (narrow, rocks, collapsible, bridge); the choke checks read it. */
    width: z.number().positive().optional(),
    /**
     * Where the crossing sits: the ramp, bridge or gap. Routes go through it (within half its width).
     * A ramp is compiled at the fitting spot on the high zone's boundary nearest it; without `at`,
     * nearest the middle of the high zone's edge facing the low zone.
     */
    at: PositionSchema.optional(),
    /** Traversable only from the declaring zone (a drop, a gate that shuts behind you); the other side must not list it. */
    oneWay: z.boolean().optional(),
    /** The beat at which the crossing opens (rocks cleared, a gate unlocked); closed before it. */
    opensAtBeat: slugId.optional(),
    /** The beat at which the crossing closes (a tower collapsed, a bridge blown); open before it. */
    closesAtBeat: slugId.optional(),
  })
  .strict();

/** A doodad's tint as the Editor writes it: "r,g,b", 0-255 each. */
const TintSchema = z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/, "A tint is \"r,g,b\" with each 0-255");
/** A scale range [min, max]; each doodad draws its own scale from it. */
const ScaleRangeSchema = z.tuple([z.number().positive(), z.number().positive()]);
/** A doodad's scale: uniform, or [x, y, z] as the Editor allows. */
const DoodadScaleSchema = z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive(), z.number().positive()])]);

/**
 * A member's variations to pick from. Without it a decal is picked from those that can go anywhere
 * (the catalog's decal descriptions: no number, letter or words, no label, sign or emblem), so name them to
 * put a bay's number or a lane's words where they label something.
 */
const MemberVariationsSchema = z.array(z.number().int().nonnegative()).min(1).optional();

/** A doodad type, or a type with how many, its scale range, a tint and the variations to pick from. */
const DressingMemberSchema = z.union([
  z.string().min(1),
  z
    .object({
      type: z.string().min(1),
      count: z.number().int().positive().optional(),
      scale: ScaleRangeSchema.optional(),
      tint: TintSchema.optional(),
      variations: MemberVariationsSchema,
    })
    .strict(),
]);
export type DressingMember = z.infer<typeof DressingMemberSchema>;

/**
 * A line of pieces along an edge: a built floor's edge (trim, curbs) or a cliff's lip (plants,
 * columns, decals). Pieces step `step` cells apart along each straight edge, `inset` cells onto the
 * zone's side; `aligned` pieces turn with the edge plus `turn` degrees (most trim and curb models lie
 * across their yaw, so 90), others turn freely. `jitter` shifts each piece by up to that many cells,
 * `gaps` leaves out that share of them (a broken run), and `variations` limits the variants picked
 * (a curb's straight pieces, not its corners; a decal's are otherwise those that can go anywhere).
 */
const edgeLineSchema = (defaults: { step: number; turn: number; inset: number; jitter: number; aligned: boolean; clumps: number; spread: number }) =>
  z
    .object({
      members: z.array(DressingMemberSchema).min(1),
      variations: z.array(z.number().int().nonnegative()).min(1).optional(),
      step: z.number().positive().default(defaults.step),
      turn: z.number().finite().default(defaults.turn),
      /** Cells in: from a built zone's edge, or from a cliff's lip (negative leans out over its crest). */
      inset: z.number().finite().default(defaults.inset),
      jitter: z.number().nonnegative().default(defaults.jitter),
      gaps: z.number().min(0).max(1).default(0),
      aligned: z.boolean().default(defaults.aligned),
      /**
       * Grown, not planted: roughly the share of the edge left bare between clumps (0 spaces pieces evenly,
       * as planted or built). In a clump pieces pack `step` apart, up to `spread` cells further in.
       */
      clumps: z.number().min(0).max(0.9).default(defaults.clumps),
      spread: z.number().nonnegative().default(defaults.spread),
      /**
       * A broken run's wear: small wreckage over each cut end (`caps`), so no piece ends square, and
       * debris strewn in the gaps.
       */
      breaks: z
        .object({
          caps: z.array(DressingMemberSchema).min(1),
          debris: z.array(DressingMemberSchema).default([]),
        })
        .strict()
        .optional(),
      /** The Editor's NoDoodadFootprint, so a line of blocking pieces doesn't wall the zone off. */
      noFootprint: z.boolean().optional(),
    })
    .strict();
/** Trim or curbs along a built zone's edge: end to end (3-10's curbs 1.66 apart, turned 90° to the run). */
export const BuiltEdgeSchema = edgeLineSchema({ step: 1.6, turn: 90, inset: 0.3, jitter: 0, aligned: true, clumps: 0, spread: 0 });
/**
 * Plants, rocks or columns along a cliff's lip. Natural by default: clumps with bare stretches
 * between, packed half a cell apart from the cliff's crest to a cell or so in (the author's reviews,
 * 2026-10-28: even spacing reads as planted, and they belong right on the lip). The crest is the
 * middle of the cliff mesh's top cell, about a cell before the first clear ground, hence -0.95. A colonnade sets `clumps: 0` and its own step.
 */
export const LipEdgeSchema = edgeLineSchema({ step: 0.5, turn: 0, inset: -0.95, jitter: 0.25, aligned: false, clumps: 0.35, spread: 1.1 });
export type EdgeLine = z.infer<typeof BuiltEdgeSchema>;

/** What the ground is (see docs/adr/0003). */
const LandformSchema = z.enum(["flat", "ridge", "canyon", "transition"]);

/**
 * What the zone is for in play (see docs/adr/0003):
 * - base: a player or enemy base.
 * - objective: where an objective is played out.
 * - refuge: a sheltered foothold or regroup pocket that isn't a base.
 * - vault: a small optional reward pocket.
 * - arena: a deliberately exposed showdown.
 * - path: ordinary ground between the others.
 */
const ZoneRoleSchema = z.enum(["base", "objective", "refuge", "vault", "arena", "path"]);

/** A Zone's lighting region: 1 to 4, or a list of them in equal shares (`[1, 2]` is half and half). */
const ZoneLightRegionSchema = z.union([
  z.number().int().min(1).max(4),
  z
    .array(z.number().int().min(1).max(4))
    .min(1)
    .max(4)
    .refine((regions) => new Set(regions).size === regions.length, "A lighting region is listed once"),
]);

export const ZoneSchema = z
  .object({
    id: slugId,
    name: z.string().min(1),
    /** Cliff level, 0 (pit) to 15: 1 is ground, each level above it 2 higher (src/terrain/cliffs.ts). */
    elevation: z.number().int().min(0).max(15),
    landform: LandformSchema,
    role: ZoneRoleSchema,
    polygon: z.array(PositionSchema).min(3),
    /** Texture painted on the zone (one of the mission's textures); defaults to the palette's for its band, else the next layer in zone order. */
    texture: z.string().min(1).optional(),
    /** Built ground (plates, tiles, a base's floor): the palette's built texture, with crisp edges. */
    surface: z.enum(["natural", "built"]).optional(),
    /** Ground units never walk on (a pit floor, a void, a distant height): one signature texture, no touches (DL-01). */
    backdrop: z.boolean().optional(),
    /**
     * Cliff set for this Zone's cliffs (DL-04): wins over its `cliffSets` group and the cliff palette. A
     * Zone's cliffs are those under its ground, and the walls of any backdrop rising above it. A
     * backdrop's own `cliff` therefore gives way, on a wall, to the floor at its foot that names a set (see `cliffSets`).
     */
    cliff: z.string().min(1).optional(),
    connections: z.array(ZoneConnectionSchema).default([]),
    /**
     * The zone's trigger area as drawn in the Editor (synced back by `npm run sync`), instead of the
     * polygon's bounding rectangle. Terrain still follows the polygon.
     */
    region: RegionLookSchema.optional(),
    /** This zone's own edge lines instead of the map's `dressing.edges`; "none" leaves that edge bare. */
    edges: z
      .object({ built: z.union([BuiltEdgeSchema, z.literal("none")]).optional(), lip: z.union([LipEdgeSchema, z.literal("none")]).optional() })
      .strict()
      .optional(),
    /** Zones seen from here beyond the lower zones it borders (which it overlooks anyway): a view across a chasm, a watchtower. */
    overlooks: z.array(slugId).default([]),
    /**
     * Beside Kept ground (ADR-0010): `generate`, the compile writes this Zone's ground, its cells
     * Compiled Content, meeting the Kept ground round it at a seam; `kept`, the Zone is drawn over
     * Kept ground as an area only (checks, preview, trigger region), and its ground isn't touched.
     * Left out on every Zone, the Mission has no Kept terrain and every Zone generates, as before.
     * Once one Zone sets it, every Zone must, and the cells no generating Zone covers are Kept.
     */
    terrain: z.enum(["generate", "kept"]).optional(),
    /**
     * Cells whose ground doesn't draw, as the Editor's Hide Terrain brush leaves them (t3CellFlags
     * bit 0x4): [x, y, width, height] rectangles of whole map cells, each cell's centre inside the
     * Zone. A hole shows the sky unless something stands under it (a wall doodad below the ground),
     * and units can still walk over it: hiding isn't pathing. A generating Zone's or a generated
     * map's own; Kept ground keeps the package's (docs/reference/terrain-file-formats.md).
     */
    hiddenCells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()])).optional(),
    /**
     * The lighting region this Zone is painted with (see the Blueprint's `lightRegions`): 1, the
     * map's Light as it is, when left out. A backdrop Zone isn't painted: it takes its nearest walkable Zone's.
     */
    lightRegion: ZoneLightRegionSchema.optional(),
  })
  .strict();

/**
 * Whether a doodad blocks ground units with painted no-pathing under its model (src/terrain/doodad-pathing.ts):
 * `block` paints it whatever its catalog role or ring, `walk` never does. Left out, a set piece's
 * anchor, props and added doodads and a doodad Anchor whose catalog role is a structure, prop or
 * cliff are painted; clutter, foliage, decals and effects aren't.
 */
export const DoodadPathingSchema = z.enum(["block", "walk"]);

/** A rectangle of the Editor's pathing sub-cells, in cells: x and width multiples of 0.5, y and height of 0.25. */
const PathingRectSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()])
  .refine(([x, y, w, h]) => [x, w].every((value) => Number.isInteger(value * 2)) && [y, h].every((value) => Number.isInteger(value * 4)), "A pathing rectangle is on the Editor's sub-cell grid: x and width in halves of a cell, y and height in quarters");

/** One `pathingPaint` entry (see the Blueprint's `pathingPaint`). */
export const PathingPaintSchema = z
  .object({
    doodad: z.string().min(1).optional(),
    block: z.array(PathingRectSchema).optional(),
    clear: z.array(PathingRectSchema).optional(),
  })
  .strict();
export type PathingPaint = z.infer<typeof PathingPaintSchema>;

/**
 * One declared route test (the Blueprint's `tests.routes`): a walk from one place to another that
 * should arrive or should be blocked. `from` and `to` each name a Zone (its whole ground) or a
 * placed Anchor (its cell).
 */
export const RouteTestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "A test id is lowercase letters, numbers, hyphens and underscores"),
    from: z.string().min(1),
    to: z.string().min(1),
    expect: z.enum(["arrive", "blocked"]),
    /** Why the author expects it: shown with a failure. */
    note: z.string().min(1).optional(),
  })
  .strict();
export type RouteTest = z.infer<typeof RouteTestSchema>;

const AnchorKindSchema = z.enum(["unit", "point", "camera", "prop", "doodad"]);

const AnchorSchema = z
  .object({
    id: slugId,
    name: z.string().min(1),
    zoneId: slugId,
    kind: AnchorKindSchema,
    unitType: z.string().min(1).optional(),
    player: z.number().int().positive().optional(),
    pointType: z.string().min(1).optional(),
    cameraTarget: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    cameraValues: z.array(z.object({ index: z.string().min(1), value: z.number().finite() }).strict()).optional(),
    doodadType: z.string().min(1).optional(),
    variation: z.number().int().nonnegative().optional(),
    /**
     * Where the compile places it. Left out only on a unit Anchor a Wave's unit entry binds
     * (`anchorId`): the send creates that unit, so nothing is placed for it at map start.
     */
    position: PositionSchema.optional(),
    rotation: z.number().finite().optional(),
    /** Doodads only: tilt in radians, as the Editor's Pitch and Roll. */
    pitch: z.number().finite().optional(),
    roll: z.number().finite().optional(),
    /** Uniform scale, or [x, y, z]; doodads default to a random 0.85-1.15 like the Editor's brush. */
    scale: z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive(), z.number().positive()])]).optional(),
    /** Doodads only: "r,g,b" tint (the Editor's TintColor). */
    tint: z
      .string()
      .regex(/^\d{1,3},\d{1,3},\d{1,3}$/)
      .optional(),
    /** The Editor's "ignore placement" (ForcePlacement): a doodad on a cliff or overlapping, a unit or point anywhere. */
    forcePlacement: z.boolean().optional(),
    /** Doodads only: whether it's painted unpathable under its model (DoodadPathingSchema). */
    pathing: DoodadPathingSchema.optional(),
    /**
     * Other Editor flags on the object, kept as set there: UnitNoCreate (placed for a trigger to
     * create), UnitHidden, PointHidden, CameraHidden, HeightOffset...
     */
    flags: z.array(z.string().min(1)).optional(),
    /** Units only: a resource's amount (minerals, gas), as the Editor's Resources. */
    resources: z.number().int().nonnegative().optional(),
    /**
     * Cells per second at Faster speed, read only by the level-design checker to time this unit's
     * routes (an escorted convoy); the game takes speed from the unit's data.
     */
    speed: z.number().positive().optional(),
    /**
     * Doodads only: the Editor's own Id for the object, when sync adopted a doodad the author
     * placed in the Editor on a generating Zone's ground. The compile writes the Anchor at that Id
     * (taking the object over where it stands) rather than at one made from the Anchor's id.
     */
    editorId: z.number().int().positive().max(0x7fffffff).optional(),
  })
  .strict();

/** What a Kept Reference names in the Map Package (ADR-0010). */
export const KEPT_KINDS = ["unit", "point", "camera", "region", "trigger", "variable", "catalog-entry"] as const;
export type KeptKind = (typeof KEPT_KINDS)[number];

/** An Editor element id in Triggers: 8 uppercase hex digits. */
const ElementIdSchema = z.string().regex(/^[0-9A-F]{8}$/, "An Editor element id is 8 uppercase hex digits, as in Triggers");

/**
 * A Kept Reference: one piece of Kept Content the Blueprint's Compiled Content builds on, found in
 * the Map Package by its Editor Id. Its id shares the Anchor namespace and is accepted wherever an
 * Anchor of its kind is (a unit as a speaker or in a condition, a region where a condition takes a
 * Zone); a trigger is what a `keptTriggerRuns` cue or Beat start waits on, and one a `hold` holds
 * back runs on a cue. `name` is the Editor's name, which the checker compares with the package's (a
 * difference is a warning). A trigger reference may name one of the Blueprint's own triggers
 * (ADR-0026) by its element Id instead: it's found in the Blueprint's `triggers`, so the same
 * reference holds whether the trigger is Kept or converted.
 */
const KeptReferenceSchema = z
  .object({
    id: slugId,
    kind: z.enum(KEPT_KINDS),
    /** An object's Id in Objects or a region's id in Regions (numbers), a trigger's or variable's element Id in Triggers, a catalog entry's id. */
    editorId: z.union([z.number().int().positive(), z.string().min(1)]),
    name: z.string().min(1),
    /** A trigger held back until a cue (ADR-0014): its start is switched off (a Kept one's in the package, a Blueprint one's in its body), and the cue runs it. */
    hold: z.lazy(() => KeptHoldSchema).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    const numeric = reference.kind === "unit" || reference.kind === "point" || reference.kind === "camera" || reference.kind === "region";
    if (numeric && typeof reference.editorId !== "number") {
      context.addIssue({ code: "custom", path: ["editorId"], message: `A Kept ${reference.kind}'s editorId is its number in ${reference.kind === "region" ? "Regions" : "Objects"}` });
    }
    if ((reference.kind === "trigger" || reference.kind === "variable") && !ElementIdSchema.safeParse(reference.editorId).success) {
      context.addIssue({ code: "custom", path: ["editorId"], message: `A Kept ${reference.kind}'s editorId is its element Id in Triggers: 8 uppercase hex digits, as a string` });
    }
    if (reference.kind === "catalog-entry" && typeof reference.editorId !== "string") {
      context.addIssue({ code: "custom", path: ["editorId"], message: "A Kept catalog entry's editorId is its id in the map's GameData, as a string" });
    }
    if (reference.hold && reference.kind !== "trigger") {
      context.addIssue({ code: "custom", path: ["hold"], message: `Only a Kept trigger is held; this is a Kept ${reference.kind}` });
    }
  });

export type KeptReference = z.infer<typeof KeptReferenceSchema> & {
  /** A Kept trigger's or global's Galaxy name, as the compile finds it in the package (resolveKeptReferences); never in a Blueprint file. */
  readonly scriptName?: string;
};

const PlacementKindSchema = z.enum(["resource-base", "encounter-group", "dressing", "objective-structure", "set-piece"]);

/**
 * A hand edit to one generated doodad, synced back from the Editor: only what was changed.
 * `heightOffset` is cells above where the compiler stands it; `removed` deletes it.
 */
export const DoodadEditSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    heightOffset: z.number().finite().optional(),
    rotation: z.number().finite().optional(),
    pitch: z.number().finite().optional(),
    roll: z.number().finite().optional(),
    scale: DoodadScaleSchema.optional(),
    type: z.string().min(1).optional(),
    variation: z.number().int().nonnegative().optional(),
    tint: TintSchema.optional(),
    /** The Editor's "ignore placement" (ForcePlacement). */
    forcePlacement: z.boolean().optional(),
    /** Whether it's painted unpathable under its model (DoodadPathingSchema). */
    pathing: DoodadPathingSchema.optional(),
    removed: z.literal(true).optional(),
  })
  .strict();
export type DoodadEdit = z.infer<typeof DoodadEditSchema>;

/** A doodad added by hand to a set piece (synced back from the Editor), at an exact place. */
export const AddedDoodadSchema = z
  .object({
    type: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    heightOffset: z.number().finite().optional(),
    rotation: z.number().finite().default(0),
    pitch: z.number().finite().optional(),
    roll: z.number().finite().optional(),
    scale: DoodadScaleSchema.default(1),
    variation: z.number().int().nonnegative().default(0),
    tint: TintSchema.optional(),
    forcePlacement: z.boolean().optional(),
    /** Whether it's painted unpathable under its model (DoodadPathingSchema). */
    pathing: DoodadPathingSchema.optional(),
  })
  .strict();
export type AddedDoodad = z.infer<typeof AddedDoodadSchema>;

/**
 * One piece of a Doodad Composite recipe (DL-07), relative to the composite's centre: `x`, `y`
 * cells across, `height` cells above the ground at the centre. `variation: "any"` lets each copy
 * pick its own model variant.
 */
const CompositeMemberSchema = z
  .object({
    type: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    height: z.number().finite().default(0),
    yaw: z.number().finite().default(0),
    pitch: z.number().finite().optional(),
    roll: z.number().finite().optional(),
    scale: DoodadScaleSchema.default(1),
    tint: TintSchema.optional(),
    variation: z.union([z.number().int().nonnegative(), z.literal("any")]).default(0),
    /** The Editor's NoDoodadFootprint: the piece neither blocks pathing nor takes room. */
    noFootprint: z.boolean().optional(),
  })
  .strict();

/**
 * A Doodad Composite recipe (DL-07): a shape no single asset provides, built from manipulated
 * stock doodads. The shape is exact; each copy varies its turn (free for `natural`, 45° steps for
 * `built`), its overall size within `scale`, and members marked `variation: "any"`. A `landmark`
 * (a tower, a crowned column) is meant to be rare: the compiler warns past 3 copies, or two
 * copies within a screen of each other in different set pieces. A `detail` (a stain) repeats freely.
 * Members are stock doodads, or doodads the recipe makes from any model in `actors` (3-4's missile
 * tower is the Scout's missile model as a doodad).
 */
/**
 * A doodad made from any model in the game (DL-07: 3-4's AntimatterMissileDoodad is the Scout's
 * missile): written to the map's ActorData as a CActorDoodad. A still prop by default, without the
 * stock doodad's sound emitter or looping Stand animation (a unit or weapon model's loop may move);
 * `animate` keeps the loop, `animation` plays a named Stand variant instead.
 */
const CompositeActorSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "An actor id is letters, digits and underscores"),
    /** A CModel id, e.g. ScoutAirWeaponLeft. */
    model: z.string().min(1),
    scale: z.number().positive().default(1),
    animate: z.boolean().default(false),
    /**
     * The Stand variant it loops from creation: the word after Stand in the model's sequence
     * ("Unpowered" for "Stand Unpowered"). Sent as an ActorCreation event in place of the stock
     * Stand loop, so not also `animate`. The compile warns when the model has no such sequence.
     */
    animation: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9]*$/, "An animation is one word of the model's Stand sequence, e.g. Unpowered")
      .optional(),
  })
  .strict()
  .refine((actor) => !(actor.animate && actor.animation), { message: "An actor is animate (the stock Stand loop) or has an animation, not both", path: ["animation"] });
export type CompositeActor = z.infer<typeof CompositeActorSchema>;

export const CompositeSchema = z
  .object({
    id: slugId,
    /** What the shape is, for the author and the skill. */
    description: z.string().min(1).optional(),
    kind: z.enum(["landmark", "detail"]),
    style: z.enum(["natural", "built"]).default("natural"),
    scale: ScaleRangeSchema.default([1, 1]),
    /**
     * Which way the shape faces at yaw 0 (degrees counterclockwise from east), for turning it to
     * face a room. Left out, it's the shared front of its members whose facing is measured
     * (doodad-facings.json), when they agree (`compositeFront`).
     */
    front: z.number().finite().min(0).lt(360).optional(),
    /** Doodads this recipe makes from models, for its members to use by id. */
    actors: z.array(CompositeActorSchema).default([]),
    members: z.array(CompositeMemberSchema).min(1),
  })
  .strict();
export type Composite = z.infer<typeof CompositeSchema>;

/**
 * Placing a set piece member: `nestle: true` stands it by other doodads, skipping only the spacing
 * check against them (it still keeps on the map, on its level and off ramps, crossings and water),
 * and writes it with the Editor's "ignore placement"; it overrides the set piece's `nestle`.
 * `yaw` (degrees counterclockwise from east) turns every copy's front that way instead of a random
 * turn, and no Style Pack snaps it: a doodad whose front is measured (doodad-facings.json) is
 * turned by its front, a composite by its `front`; anything unmeasured takes `yaw` as its rotation.
 * `against: "wall"` backs every copy onto the nearest wall in the set piece's radius instead,
 * front to the room, standing off the wall as its measured placement says.
 */
const setPiecePlacing = {
  nestle: z.boolean().optional(),
  yaw: z.number().finite().optional(),
  against: z.literal("wall").optional(),
  /** Whether every copy is painted unpathable under its model (DoodadPathingSchema). */
  pathing: DoodadPathingSchema.optional(),
};
const oneFacing = (member: { yaw?: number | undefined; against?: "wall" | undefined }): boolean => member.yaw === undefined || member.against === undefined;
const ONE_FACING = { message: "A member backed against a wall faces the room: give it `yaw` or `against`, not both" };

/** A set piece member: a doodad, or `count` copies of a Doodad Composite recipe. */
const SetPieceMemberSchema = z.union([
  z.string().min(1),
  z
    .object({
      type: z.string().min(1),
      count: z.number().int().positive().optional(),
      scale: ScaleRangeSchema.optional(),
      tint: TintSchema.optional(),
      variations: MemberVariationsSchema,
      ...setPiecePlacing,
    })
    .strict()
    .refine(oneFacing, ONE_FACING),
  z.object({ composite: slugId, count: z.number().int().positive().optional(), ...setPiecePlacing }).strict().refine(oneFacing, ONE_FACING),
]);
export type SetPieceMember = z.infer<typeof SetPieceMemberSchema>;

/**
 * A set piece (DL-06, DL-08): a dense cluster of one story's props, expanded at compile time.
 * `anchor` sits at the centre, `props` ring it, `clutter` scatters densest near the middle;
 * every member is placed from its own seed, so editing one leaves the others where they were.
 */
export const SetPieceParamsSchema = z
  .object({
    /** What happened here, in a sentence (DL-08). */
    story: z.string().min(1),
    /** The centre; defaults to the zone's centre. */
    at: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    /** Cells from the centre to the outermost clutter. */
    radius: z.number().positive().max(24).default(6),
    anchor: z.array(SetPieceMemberSchema).default([]),
    props: z.array(SetPieceMemberSchema).default([]),
    clutter: z.array(SetPieceMemberSchema).default([]),
    /** Multiplies the default counts (props 3 each, clutter 6 each). */
    density: z.enum(["sparse", "normal", "dense"]).default("normal"),
    /**
     * Every member stands by other doodads, as a terrainer ignores placement in the Editor (a
     * member's own `nestle` wins): the spacing check is skipped, nothing else. A member that still
     * finds no room is dropped with a warning naming it.
     */
    nestle: z.boolean().optional(),
    /** Hand edits from the Editor, keyed by `<type>/<index>`, or `<type>/<ring>/<index>` (`<ring>-<n>` for its nth) for a later member of a type already listed; they survive param changes. */
    edits: z.record(z.string(), DoodadEditSchema).default({}),
    /** Doodads added by hand in the Editor, kept as placed. */
    added: z.array(AddedDoodadSchema).default([]),
  })
  .strict();
export type SetPieceParams = z.infer<typeof SetPieceParamsSchema>;

/**
 * A pile at a cliff's foot (DL-05): one or two `large` pieces, a handful of `small` ones heaped
 * round them at mixed sizes, sometimes a `ground` decal under it and an `accent` (smoke, a wreck).
 * `tint` colours every member to match the cliff, unless a member has its own.
 */
const CliffPileSchema = z
  .object({
    large: z.array(DressingMemberSchema).min(1),
    small: z.array(DressingMemberSchema).default([]),
    ground: z.array(DressingMemberSchema).default([]),
    accent: z.array(DressingMemberSchema).default([]),
    tint: TintSchema.optional(),
  })
  .strict();
export type CliffPile = z.infer<typeof CliffPileSchema>;

/**
 * Cliff dressing (DL-05): piles along the feet of cliffs, one every `spacing` cells of cliff on
 * average. A cliff takes the pile for its set's kind (natural rock, or built: wreckage and debris).
 */
const DressingSchema = z
  .object({
    cliffs: z
      .object({
        natural: CliffPileSchema.optional(),
        built: CliffPileSchema.optional(),
        spacing: z.number().positive().default(6),
        /** Hand edits from the Editor, keyed by the pile doodad's id after `cliffs/`. */
        edits: z.record(z.string(), DoodadEditSchema).default({}),
      })
      .strict()
      .optional(),
    /**
     * Shore dressing for water pools (DL-13): a `pile` heaped at the waterline, one every
     * `spacing` cells of shore on average; a `fringe` of plants and pebbles along it, on
     * `fringeChance` of its cells; and `sunken` pieces (big rocks, ruins) standing in the shallows
     * to break the surface, one every `sunkenSpacing` cells of shallows; and `lights` strung along
     * the waterline where the player walks, for a dark mission.
     */
    shores: z
      .object({
        pile: CliffPileSchema,
        spacing: z.number().positive().default(2.5),
        fringe: z.array(DressingMemberSchema).default([]),
        fringeChance: z.number().min(0).max(1).default(0.6),
        sunken: z.array(DressingMemberSchema).default([]),
        sunkenSpacing: z.number().positive().default(6),
        /**
         * Light doodads in runs along the waterline (DL-13; 3-6's night shores), only on stretches
         * within `reach` cells of the player's routes (on screen as the player passes), `spacing` apart and `lift` above the surface.
         * `light` is the main one (a stock `LightOmni<Colour>Large` nearest the dark lighting's
         * ambient hue); `accent`, the place's signature colour, takes `accentChance` of them.
         */
        lights: z
          .object({
            light: z.string().min(1),
            accent: z.string().min(1).optional(),
            accentChance: z.number().min(0).max(1).default(1 / 6),
            spacing: z.number().positive().default(2.5),
            reach: z.number().positive().default(10),
            lift: z.number().finite().default(0.2),
          })
          .strict()
          .optional(),
        /** Hand edits from the Editor, keyed by the doodad's id after `shores/`. */
        edits: z.record(z.string(), DoodadEditSchema).default({}),
      })
      .strict()
      .optional(),
    /**
     * Lines along edges, map-wide: `built` along every built zone's edge where it meets ground on
     * its level; `lip` along every cliff's top. A zone's own `edges` wins.
     */
    edges: z
      .object({
        built: BuiltEdgeSchema.optional(),
        lip: LipEdgeSchema.optional(),
        /** Hand edits from the Editor, keyed by the doodad's id after `edges/`. */
        edits: z.record(z.string(), DoodadEditSchema).default({}),
      })
      .strict()
      .optional(),
  })
  .strict();

/** One of eight map directions; north is +y. */
const FacingSchema = z.enum(["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]);
export type Facing = z.infer<typeof FacingSchema>;

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

/**
 * A `resource-base` Placement's params. With `at` it's built: the town-hall spot at `at` stays
 * empty, mineral fields arc round it on the `facing` side and a geyser stands at each end of the
 * arc, Blizzard's standard shape (enemy-ai §3.6). Without `at` it's read by the checker only.
 */
export const ResourceBaseParamsSchema = z
  .object({
    /** The town-hall spot's centre. */
    at: PointSchema.optional(),
    /** Where the minerals lie from the town-hall spot: back them onto a cliff or the map edge. */
    facing: FacingSchema.default("north"),
    /** small: 4 fields; normal: 8 at 1,800 and 900; rich: 8 rich fields. */
    minerals: z.enum(["none", "small", "normal", "rich"]).default("normal"),
    /** small: one geyser of 400; poor: two of 600; normal: two of 2,250; rich: two rich geysers. */
    gas: z.enum(["none", "small", "poor", "normal", "rich"]).default("normal"),
    /** Put this player's Assimilator on each geyser (a capture camp's, for its Sentry to tether). */
    assimilators: z.number().int().min(1).max(15).optional(),
    /** An enemy's town hall on the spot, with its workers between it and the minerals. */
    townHall: z
      .object({
        player: z.number().int().min(2).max(15),
        type: z.string().min(1).default("Nexus"),
        worker: z.string().min(1).default("Probe"),
        workers: z.number().int().nonnegative().default(8),
      })
      .strict()
      .optional(),
    story: z.string().optional(),
  })
  .passthrough();
export type ResourceBaseParams = z.infer<typeof ResourceBaseParamsSchema>;

/**
 * An `encounter-group` Placement's params. With `at` it's built: `structures` packed round `at`,
 * `defences` on an arc toward `facing`, and `units` standing in front of them on that side.
 * Without `at` it's read by the checker only.
 */
export const EncounterGroupParamsSchema = z
  .object({
    at: PointSchema.optional(),
    /** The approach the group faces. */
    facing: FacingSchema.default("south"),
    player: z.number().int().min(2).max(15).default(2),
    units: z.array(z.string().min(1)).default([]),
    /** Buildings packed round `at`, first in the middle (a camp's Pylon). */
    structures: z.array(z.string().min(1)).default([]),
    /** Static defences on an arc toward `facing`, `defenceRadius` from `at`. */
    defences: z.array(z.string().min(1)).default([]),
    defenceRadius: z.number().positive().default(4),
  })
  .passthrough();
export type EncounterGroupParams = z.infer<typeof EncounterGroupParamsSchema>;

/** A share of a group's units, 0-1 (or more, for extras). */
const ShareSchema = z.number().min(0).max(4);

/** Per-mission overrides of `ENEMY_AI` in `src/ai/enemy-ai.ts`; anything left out keeps the default. */
const EnemyAiOverridesSchema = z
  .object({
    money: z.object({ minerals: z.number().int().nonnegative(), vespene: z.number().int().nonnegative(), topUpSeconds: z.number().positive() }).partial().strict().optional(),
    casual: z.object({ keep: ShareSchema, handicap: z.number().int().min(1).max(100) }).partial().strict().optional(),
    hard: z.object({ extra: ShareSchema, upgrades: z.array(z.string().min(1)) }).partial().strict().optional(),
    brutal: z.object({ extra: ShareSchema, upgrades: z.array(z.string().min(1)) }).partial().strict().optional(),
    /** Unit types the AI keeps rebuilding; every other placed enemy unit is never rebuilt. */
    rebuildAlways: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type EnemyAiOverrides = z.infer<typeof EnemyAiOverridesSchema>;

/**
 * Stock ids, checked against data/tech-catalog.json: `units` and `buildings` are CUnit ids
 * (Stalker, Stargate), kept apart for reading; `upgrades` are CUpgrade ids (BlinkTech).
 */
const TechListSchema = z
  .object({
    units: z.array(z.string().min(1)).default([]),
    buildings: z.array(z.string().min(1)).default([]),
    upgrades: z.array(z.string().min(1)).default([]),
  })
  .strict();
const TECH_KINDS = ["buildings", "units", "upgrades"] as const;

/**
 * One player's tech at map initialization, compiled into the "Tech" trigger, which runs before
 * the Mission's and the Mechanics' own map-init triggers (so a Mechanic can still lock a unit and
 * allow it later, as capture does the Sentry). With `allow`, tech-tree restrictions are turned on
 * for the player first, so only what's allowed (and what the game data's Suppressed commands bring
 * along with it) can be built, as Blizzard's campaign libraries do; requirements still apply.
 * `disallow` runs last. Without `allow`, restrictions stay as the map has them; the Editor's hint
 * says disallowing does nothing while they're off, which is still to be tested in game.
 */
/** Its units and buildings are checked against `catalog`, the game's and a Campaign Mod's. */
const playerTechSchema = (catalog: Catalog) =>
  z
    .object({
      player: z.number().int().min(1).max(15),
      allow: TechListSchema.optional(),
      disallow: TechListSchema.optional(),
    })
    .strict()
    .superRefine((tech, context) => {
      if (!tech.allow && !tech.disallow) {
        context.addIssue({ code: "custom", message: "Give allow, disallow or both", path: [] });
        return;
      }
      const allowed = new Set(TECH_KINDS.flatMap((kind) => tech.allow?.[kind] ?? []));
      for (const list of ["allow", "disallow"] as const) {
        const seen = new Set<string>();
        for (const kind of TECH_KINDS) {
          tech[list]?.[kind].forEach((id, index) => {
            const path = [list, kind, index];
            const issue = (message: string) => context.addIssue({ code: "custom", message, path });
            if (seen.has(id)) issue(`${id} is listed twice`);
            seen.add(id);
            if (kind === "upgrades") {
              if (!isKnownUpgrade(id)) issue(`Unknown upgrade: ${id} (data/tech-catalog.json)`);
            } else {
              const unit = techUnit(catalog, id);
              if (!unit) issue(`Unknown unit or building: ${id} (data/tech-catalog.json${layerSource(catalog)})`);
              else if (kind === "buildings" && !unit.structure) issue(`${id} isn't a building; list it under units`);
              else if (kind === "units" && unit.structure) issue(`${id} is a building; list it under buildings`);
            }
            if (list === "disallow" && allowed.has(id)) issue(`${id} is both allowed and disallowed`);
          });
        }
      }
    });
const PlayerTechSchema = playerTechSchema(EMPTY_CATALOG);
export type PlayerTech = z.infer<typeof PlayerTechSchema>;

const PlacementSchema = z
  .object({
    id: slugId,
    zoneId: slugId,
    kind: PlacementKindSchema,
    params: z.record(z.string(), z.unknown()).default({}),
    /** Encounter groups only: the group doesn't attack until this beat (a parade, a garrison caught unready). Checker only. */
    passiveUntilBeat: slugId.optional(),
  })
  .strict();

/**
 * A level band's texture: a name, or a name with its own variety textures, patched in at full
 * strength (without them the band gets light touches of the palette's variety).
 */
const PaletteBandSchema = z.union([
  z.string().min(1),
  z.object({ texture: z.string().min(1), variety: z.array(z.string().min(1)).max(3).default([]) }).strict(),
]);
/** One band, or one per level away from the main level (the last repeats). */
const PaletteBandsSchema = z.union([PaletteBandSchema, z.array(PaletteBandSchema).min(1)]);

export type PaletteBand = { readonly texture: string; readonly variety: readonly string[] };

/** A palette side's bands, nearest the main level first. */
export function paletteBands(bands: z.infer<typeof PaletteBandsSchema> | undefined): PaletteBand[] {
  if (bands === undefined) return [];
  return (Array.isArray(bands) ? bands : [bands]).map((band) =>
    typeof band === "string" ? { texture: band, variety: [] } : { texture: band.texture, variety: band.variety },
  );
}

export const TexturePaletteSchema = z
  .object({
    main: z.string().min(1),
    low: PaletteBandsSchema.optional(),
    high: PaletteBandsSchema.optional(),
    variety: z.array(z.string().min(1)).max(3).default([]),
    built: z.string().min(1).optional(),
  })
  .strict();

/** The texture palette, as parsed: see `texturePalette` on the blueprint. */
export type TexturePalette = z.infer<typeof TexturePaletteSchema>;

/** Every texture a palette names, main first, then variety, high, low and built. */
export function paletteTextures(palette: TexturePalette): string[] {
  const band = (side: TexturePalette["low"]) => paletteBands(side).flatMap((b) => [b.texture, ...b.variety]);
  return [...new Set([palette.main, ...palette.variety, ...band(palette.high), ...band(palette.low), ...(palette.built ? [palette.built] : [])])];
}

/** The mission type that sets the graph's shape (see packages/claude-plugin/skills/level-design/ARCHETYPES.md). */
const ArchetypeSchema = z.enum(["hold", "escort", "moving-hazard", "race", "commando", "assault", "expansion"]);

export type Archetype = z.infer<typeof ArchetypeSchema>;

/** A stage direction's address, naming the part of a scene from it (scene-parts.ts). */
const PartFromSchema = z.string().regex(DIRECTION_ADDRESS, "a stage direction's address, S<scene>><n>, e.g. S07>2");
/** A line by its sound ID, held to what the naming makes one (it goes into element paths and names). */
const LineSoundIdSchema = z.string().regex(NAMED_ID, `a line's sound ID: ${NAMED_ID_RULE}`);

/**
 * What's wrong with a scene part's address, whatever names it (a cue entry, a scenePlayed cue): a
 * part and a line both, with `both` said, or a stage direction of another scene.
 */
function scenePartIssues({ scene, from, line }: ScenePart, both: string): { readonly field: "from" | "line"; readonly message: string }[] {
  if (from !== undefined && line !== undefined) return [{ field: "line", message: both }];
  const addressed = from === undefined ? undefined : directionAddress(from);
  if (addressed && addressed.scene !== scene) return [{ field: "from", message: `${from} is a stage direction of scene ${addressed.scene}, not of scene ${scene}` }];
  return [];
}

/** A script scene, part (`from`, a stage direction's address) or line (`line`, a sound ID), as a cue entry names it. */
const scenePartFields = {
  scene: z.number().int().positive(),
  from: PartFromSchema.optional(),
  line: LineSoundIdSchema.optional(),
};

/**
 * Holds once these Objectives (all of them, or `count` of them) are marked Completed, by their own
 * `completeWhen`: a Mission whose Objectives come in any order waits for several. Objectives
 * completed some other way (a Kept trigger) aren't counted, so each names one with a `completeWhen`.
 */
const objectivesCompleteFields = {
  type: z.literal("objectivesComplete"),
  objectiveIds: z.array(slugId).min(1),
  count: z.number().int().positive().optional(),
  /**
   * Holds when the Completed Objectives are exactly these: every one named is, and no other
   * Objective is yet. A cue on it plays a scene part by which Objectives are done ("warp drive and
   * conduits, no SCV"), as the last of them completes. Takes no `count`.
   */
  exactly: z.literal(true).optional(),
};

/** What starts a beat in play: the first of these to happen (a unit entering a zone, a death). */
const BeatStartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anchorDies"), anchorId: slugId }).strict(),
  z.object({ type: z.literal("anchorEntersZone"), anchorId: slugId, zoneId: slugId }).strict(),
  /** The anchor's unit becomes player 1's (a Sentry captured with its camp). */
  z.object({ type: z.literal("anchorCaptured"), anchorId: slugId }).strict(),
  /** A Kept or Blueprint trigger (a Kept Reference of kind trigger) has run to its end. */
  z.object({ type: z.literal("keptTriggerRuns"), triggerId: slugId }).strict(),
  z.object(objectivesCompleteFields).strict(),
  /**
   * A script scene, with `from` its part from that stage direction (`S07>4`), or with `line` that
   * one line, starts to play: the first time a cue entry of that scene and part or line plays it,
   * after the entry's `afterSeconds`, as its Cinematic or trigger scene starts or its first
   * Transmission has its turn. It names a cue entry's scene, `from` and `line` as they are, as a
   * `scenePlayed` cue does.
   */
  z
    .object({
      type: z.literal("scenePlays"),
      ...scenePartFields,
    })
    .strict(),
  /**
   * One of the moments a Mechanic declares in its `cues` (a meditation's `ends`), named as a cue
   * names it: the Beat starts from that Mechanic's triggers when they reach the moment, as what the
   * Blueprint cues there plays.
   */
  z.object({ type: z.literal("mechanic"), mechanicId: slugId, cue: z.string().min(1) }).strict(),
]);

/**
 * One Zone a Beat reveals (ADR 0004 item 1). The compile explores a circle and pings its centre: at
 * the point Anchor `at`, chosen in advance in the Zone it reveals, with `radius` cells (by default as far as the Zone's
 * edge), or with neither at the widest circle inside the Zone. `region: true` explores the Zone's
 * whole trigger region instead. A bare Zone id is `{ zoneId }`.
 */
const RevealSchema = z.union([
  slugId,
  z
    .object({
      zoneId: slugId,
      at: slugId.optional(),
      radius: z.number().positive().finite().optional(),
      region: z.literal(true).optional(),
    })
    .strict(),
]);
export type Reveal = z.infer<typeof RevealSchema>;

/** The Zone a reveal names. */
export const revealZoneId = (reveal: Reveal): string => (typeof reveal === "string" ? reveal : reveal.zoneId);

/** The Zones a Beat reveals, in order. */
export const revealedZoneIds = (beat: { readonly reveals: readonly Reveal[] }): string[] => beat.reveals.map(revealZoneId);

/** A rectangle in cells, [left, bottom, right, top], as MapInfo and a rect region hold one. */
export const BoundsRectSchema = z
  .tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative()])
  .refine(([left, bottom, right, top]) => left < right && bottom < top, "A rectangle is [left, bottom, right, top], with left below right and bottom below top");
export type BoundsRect = readonly [left: number, bottom: number, right: number, top: number];

/** Whether a rectangle is one a map of `size` can bound to: a BoundsRect inside the map. */
export function rectOnMap(rect: readonly number[], size: { readonly width: number; readonly height: number }): boolean {
  return BoundsRectSchema.safeParse(rect).success && rect[2]! <= size.width && rect[3]! <= size.height;
}

/**
 * An area a Beat's bounds name (ADR-0015): a Zone's trigger region or a Kept region, by id, used as
 * it is; the box round some Zones' polygons, by their ids, compiled as a bounds region; or a
 * rectangle, also compiled as one. A bounds region the author redraws in the Editor syncs back as
 * the rectangle drawn.
 */
const BoundsAreaSchema = z.union([slugId, z.array(slugId).min(1), BoundsRectSchema]);
export type BoundsArea = z.infer<typeof BoundsAreaSchema>;

/**
 * Where the camera may aim from this Beat on (NativeLib's Set Camera Bounds, `CameraSetBounds`):
 * an area, or "playable", the playable area as it stands. `minimap` (on by default, as one Kept map's
 * stealth areas set it) shrinks the minimap to the bounds. `transition` sets a wider rectangle
 * first, with the minimap left as it is, for the scenes the Beat's start plays to pan from the last
 * area to this one, then this Beat's once they hand back: `true` for the box round both areas, or
 * the rectangle to use.
 */
const BeatCameraSchema = z
  .object({
    bounds: z.union([z.literal("playable"), BoundsAreaSchema]),
    minimap: z.boolean().optional(),
    transition: z.union([z.literal(true), BoundsRectSchema]).optional(),
  })
  .strict();

const BeatSchema = z
  .object({
    id: slugId,
    title: z.string().min(1),
    summary: z.string().min(1),
    zoneIds: z.array(slugId).default([]),
    anchorIds: z.array(slugId).default([]),
    /** What the player meets for the first time in this beat: mechanic ids, enemy unit types, connection types. */
    introduces: z.array(z.string().min(1)).default([]),
    /**
     * Zones the beat's script shows the player (a camera pan, a revealer, a ping, a tour); the first
     * beat's cover the mission start. Each compiles to an explore under fog as the Beat starts and a
     * minimap ping once the Cinematics and trigger scenes cued then have handed back, dropped if a
     * later Beat has started meanwhile; the Transmissions cued after them play after the ping
     * (beat-reveals.ts, RevealSchema): as a rule a circle at a point Anchor chosen in advance.
     */
    reveals: z.array(RevealSchema).default([]),
    /** The archetype from this beat on, when the mission changes type (a commando raid, then an assault). */
    archetype: ArchetypeSchema.optional(),
    /** Compiles to a "Beat - <title>" trigger that Mechanics add actions to; the first beat starts with the mission. */
    startsWhen: z.array(BeatStartSchema).min(1).optional(),
    /** The camera's bounds from this Beat on, until a later Beat sets others (ADR-0015, beat-bounds.ts). */
    camera: BeatCameraSchema.optional(),
    /**
     * The playable area from this Beat on (NativeLib's Set Playable Map Area, `RegionPlayableMapSet`),
     * which confines units and moves the camera bounds with it: an area, or "entire", the whole map,
     * as Blizzard's campaign maps open it round a cutscene. The game rounds its edges to even cells.
     */
    playable: z.union([z.literal("entire"), BoundsAreaSchema]).optional(),
  })
  .strict();

/**
 * An outcome condition's or an encounter's `fromBeat`: armed only once that Beat, or a later one if
 * the mission skips it, has started, and met then if it already holds (the anchor's unit dead,
 * captured or in the Zone, the quota collected). Without it, armed from map start.
 */
const fromBeat = slugId.optional();

const OutcomeConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anchorDies"), anchorId: slugId, fromBeat }).strict(),
  /** The anchor's unit enters the zone's region. */
  z.object({ type: z.literal("anchorEntersZone"), anchorId: slugId, zoneId: slugId, fromBeat }).strict(),
  /** The anchor's unit becomes player 1's (a Sentry captured with its camp). */
  z.object({ type: z.literal("anchorCaptured"), anchorId: slugId, fromBeat }).strict(),
  /** A countdown from mission start, shown on screen, runs out: survive (victory) or beat the clock (defeat). It takes no `fromBeat` (the checks say so). */
  z.object({ type: z.literal("timer"), seconds: z.number().positive(), fromBeat }).strict(),
  /** Player 1 has collected this much in total over the mission (spending doesn't count against it). */
  z.object({ type: z.literal("resourceQuota"), resource: z.enum(["minerals", "vespene"]), amount: z.number().int().positive(), fromBeat }).strict(),
  /** These Objectives are Completed (all, or `count`): a victory or defeat that waits for several. It takes no `fromBeat` (the checks say so), and no Objective's `completeWhen`. */
  z.object({ ...objectivesCompleteFields, fromBeat }).strict(),
]);

const CueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("missionStart") }).strict(),
  z.object({ type: z.literal("anchorDies"), anchorId: slugId }).strict(),
  z.object({ type: z.literal("anchorEntersZone"), anchorId: slugId, zoneId: slugId }).strict(),
  /** The anchor's unit becomes player 1's (a Sentry captured with its camp). */
  z.object({ type: z.literal("anchorCaptured"), anchorId: slugId }).strict(),
  z.object({ type: z.literal("encounter"), encounterId: slugId }).strict(),
  /** One of the moments a Mechanic declares in its `cues`, such as the flare's `firstFlare`. */
  z.object({ type: z.literal("mechanic"), mechanicId: slugId, cue: z.string().min(1) }).strict(),
  /** A Kept or Blueprint trigger (a Kept Reference of kind trigger) has run to its end. */
  z.object({ type: z.literal("keptTriggerRuns"), triggerId: slugId }).strict(),
  /** These Objectives are Completed (all, or `count`), as the one that makes it so is: a scene can play at 1, 2 and 3 of 4. */
  z.object(objectivesCompleteFields).strict(),
  /** A Beat has started, whichever of its `startsWhen` conditions started it; once, as a Beat starts once. */
  z.object({ type: z.literal("beatStarts"), beatId: slugId }).strict(),
  /**
   * The Anchor's unit comes within `distance` cells of another, once: the Anchor `targetId`'s unit,
   * or the first of `player`'s units of `unitType` (whichever camp a raider raids). The unit neared
   * is kept for the scene the cue plays (cue-triggers.ts, cueUnitVariable).
   */
  z
    .object({
      type: z.literal("anchorNears"),
      anchorId: slugId,
      distance: z.number().positive().finite(),
      targetId: slugId.optional(),
      unitType: z.string().min(1).optional(),
      player: z.number().int().positive().optional(),
    })
    .strict(),
  /**
   * The Anchor's unit starts the data effect `effectId`, once: the game's Player Uses Effect, its
   * caster the Anchor's unit. The effect's target unit is kept for the scene the cue plays, or, for
   * an effect on a point, its caster (cue-triggers.ts, cueUnitVariable), so a scene aimed at the
   * cue's unit frames exactly the unit the data struck. Name an effect the search runs on the unit
   * it found, not the search itself: the first (the one that starts the strike) to cue as the strike
   * starts, its damage to cue as it hits.
   */
  z.object({ type: z.literal("effectStarts"), anchorId: slugId, effectId: z.string().min(1) }).strict(),
  /** `player` has lost `count` (1 when left out) of its structures of `unitType`, so a first and a second loss can each cue a line. */
  z.object({ type: z.literal("structureDies"), player: z.number().int().positive(), unitType: z.string().min(1), count: z.number().int().positive().optional() }).strict(),
  /** The encounter has ended, once: the first of its `endsWhen` and its `behavior` gone from the unit (or the unit dead). */
  z.object({ type: z.literal("encounterEnds"), encounterId: slugId }).strict(),
  /**
   * A script scene, with `from` the part of it from that stage direction (`S07>4`), or with `line`
   * that one line, has played: once, the first time a cue entry of that scene and part or line has
   * played its last Transmission, or its Cinematic or trigger scene has handed back. It names a cue
   * entry's scene, `from` and `line` as they are.
   */
  z
    .object({
      type: z.literal("scenePlayed"),
      ...scenePartFields,
    })
    .strict(),
  /**
   * A bookmark of the listed Cinematic `cinematicId` (its shot list's `bookmarks`), once, as its
   * cutscene plays past it: the game's Cutscene Bookmark Fired. **Prefer a `scenePlayed` cue, which
   * fires however the Cinematic ends.** The engine doesn't hear a bookmark when the player skips the
   * Cinematic, so by default (`onSkip` "skip") a skip never runs this cue, and whatever depends on
   * it (a Beat, a hold, a scene) never happens for a player who skips. `onSkip: "fire"` has the
   * Cinematic's own cleanup run the cue, if it hasn't run, as the Cinematic ends. The checks warn
   * about every one of these cues (docs/reference/editor-and-engine.md, "A cutscene's events").
   */
  z
    .object({
      type: z.literal("cinematicBookmark"),
      cinematicId: slugId,
      bookmark: z.string().trim().min(1),
      onSkip: z.enum(["fire", "skip"]).optional(),
    })
    .strict(),
]);

/**
 * A Kept trigger held back until `until` (ADR-0014), so the Compiled scenes before it play first.
 * The compile switches off what starts it in the Map Package, as the Editor's Disabled flag: each
 * Run Trigger of it in the Kept trigger `from`, or, without `from`, its own Map Initialization
 * event. The cue then runs it, checking its conditions, once its scenes have played: a
 * `scenePlayed` cue fires once a Cinematic or trigger scene has handed back, skipped or watched to
 * its end. Dropping the hold switches its start back on.
 */
const KeptHoldSchema = z
  .object({
    /** The Kept trigger whose Run Trigger of this one is held; left out, this one's own Map Initialization event. */
    from: slugId.optional(),
    until: CueSchema,
  })
  .strict();

/** A light colour, 0-1 per channel (CLight colours are linear floats, not 0-255). */
const LightColorSchema = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]);

/** One of a light's three directional lights: its colour, a scale on its multiplier, and where it shines toward. */
const DirectionalLightSchema = z
  .object({
    color: LightColorSchema.optional(),
    scale: z.number().positive().optional(),
    direction: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
      .refine((vector) => Math.hypot(...vector) > 0, "A direction can't be (0, 0, 0)")
      .optional(),
  })
  .strict();

/**
 * A mission's own light (DL-09), or a Plugin's: a full copy of a stock light (`from`, an id in
 * data/light-catalog.json) with a few knobs turned. `scale` multiplies the colour's brightness;
 * a `direction` is where that light shines toward (x east, y north, z up; normalised), so a sun
 * high overhead keys with z near -1 and a bounce off the ground fills with z above 0.
 */
export const MissionLightSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "A light id is letters, digits and underscores"),
    from: z.string().min(1),
    ambient: z.object({ color: LightColorSchema.optional(), scale: z.number().positive().optional() }).strict().optional(),
    /** The sun: the one directional light that casts shadows. */
    key: DirectionalLightSchema.optional(),
    /** The fill, such as a bounce off warm ground. */
    fill: DirectionalLightSchema.optional(),
    /** The back light, a rim from behind. */
    back: DirectionalLightSchema.optional(),
    /** HDR exposure; stock lights mostly sit at 1.5. */
    exposure: z.number().positive().optional(),
  })
  .strict();
export type MissionLight = z.infer<typeof MissionLightSchema>;

/** A lighting region's knob on a colour: a new colour, a scale on its brightness (its multiplier for a directional light), or both. */
const RegionKnobSchema = z.object({ color: LightColorSchema.optional(), scale: z.number().positive().optional() }).strict();

/**
 * One painted lighting region's light (docs/reference/lighting-regions.md), held in the map Light's `LightRegions`: the
 * ambient and the key, fill and back colours of `from` (a Light: one of `lights`, a Plugin's or a
 * stock one; left out, the map's Light itself) with the same knobs as `lights`, but no direction
 * or exposure, which a region doesn't have. `specular` starts from the key's, `environment` (the
 * ambient's share of the environment map) and `fog` from the map Light's and the mission's fog,
 * each dimmed as the region's ambient is against the map Light's.
 */
export const LightRegionSchema = z
  .object({
    from: z.string().min(1).optional(),
    ambient: RegionKnobSchema.optional(),
    key: RegionKnobSchema.optional(),
    fill: RegionKnobSchema.optional(),
    back: RegionKnobSchema.optional(),
    specular: RegionKnobSchema.optional(),
    environment: z.number().min(0).optional(),
    fog: LightColorSchema.optional(),
  })
  .strict();
export type LightRegion = z.infer<typeof LightRegionSchema>;


/**
 * The mission's sky (DL-14), written to the map-local tileset override. `from` copies a stock
 * tileset's two sky layers (data/tileset-sky.json): the fixed `skybox` and the `parallax` layer
 * that pans with the camera, which is what shows through a hidden level on the Void and Ulnar.
 * `skybox` and `parallax` name either layer's model directly. `hideLowestLevel` turns level-0
 * pits into open sky, the floating-platform look; without it, the tileset's own setting holds.
 * `fog` copies a stock tileset's fog (`from`), then turns its knobs; colour is 0-1 per channel.
 */
export const SkySchema = z
  .object({
    from: z.string().min(1).optional(),
    skybox: z.string().min(1).optional(),
    parallax: z.string().min(1).optional(),
    hideLowestLevel: z.boolean().optional(),
    fog: z
      .object({
        from: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
        color: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
        density: z.number().min(0).optional(),
        falloff: z.number().min(0).optional(),
        startingHeight: z.number().finite().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Sky = z.infer<typeof SkySchema>;

/**
 * A change of scene at a cue (DL-09): what the mission's look does when the story moves on. For
 * now the light: an instant cut (`seconds` 0), a slow drift (minutes), or a pulse (`back` after a
 * second or two, to `back.to`, else the mission's light). `afterSeconds` waits after the cue.
 */
export const TransitionSchema = z
  .object({
    id: slugId,
    beatId: slugId.optional(),
    cue: CueSchema,
    afterSeconds: z.number().positive().optional(),
    light: z
      .object({
        to: z.string().min(1),
        /** Blend time; 0 cuts. */
        seconds: z.number().nonnegative().default(0),
        back: z
          .object({ after: z.number().positive(), seconds: z.number().nonnegative().default(1), to: z.string().min(1).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** A pool moving to one of its states (`default` returns it), e.g. a flood rising (DL-13). */
    water: z
      .object({ poolId: slugId, state: z.string().min(1), seconds: z.number().nonnegative().default(0) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((transition) => transition.light !== undefined || transition.water !== undefined, "A transition changes the light, the water or both");
export type Transition = z.infer<typeof TransitionSchema>;

/**
 * A UI Component's Blueprint trigger action at a cue (ADR-0019), such as showing a boss bar: its
 * `action` (showBossBar) with its `params`, as the component that has it takes them. It compiles
 * into a call to the component's function in the Campaign Mod's library, which needs the Campaign
 * Mod to turn the component on in its `ui`. `afterSeconds` waits after the cue.
 */
export const UiActionSchema = z
  .object({
    id: slugId,
    cue: CueSchema,
    afterSeconds: z.number().positive().optional(),
    action: z.string().regex(/^[a-z][A-Za-z0-9]*$/, "An action is named as its UI Component names it, such as showBossBar"),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type UiAction = z.infer<typeof UiActionSchema>;

/** A water colour: 0-1 per channel, then opacity (CWater Color). */
const WaterColorSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

/**
 * A pool of water or lava over a zone (DL-13): the zone's bounding box widened by `margin` cells,
 * so waves reach the cliff. `type` is a stock CWater (data/water-types.json); each pool compiles to
 * its own copy of it, so pools sit at their own heights. `height` is absolute (ground is 8, a
 * level-0 pit's floor 0). `states` are further heights a transition can move the pool to.
 */
export const WaterPoolSchema = z
  .object({
    id: slugId,
    zoneId: slugId,
    type: z.string().min(1),
    height: z.number().finite(),
    margin: z.number().nonnegative().default(4),
    /**
     * The pool's own rectangles, each [x0, y0, x1, y1] in cells, instead of its zone's bounding box
     * widened by `margin`: water drawn in the Editor, which saves it as tiles, as `npm run sync`
     * brings it back. The zone (the one the first rectangle's centre is in, when sync adds it) still
     * gives the floor the warnings measure, and the ground a `bank` or `dig` shapes.
     */
    rects: z
      .array(
        z
          .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
          .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, "A water rect is [x0, y0, x1, y1], with x0 < x1 and y0 < y1"),
      )
      .min(1)
      .optional(),
    /**
     * The floor rising into a bank along the pool's edge, so the waterline wanders: within `width`
     * cells of the edge, the bank's top varies along the shore from `dip` below the surface to
     * `rise` above it. `false` keeps the floor flat, the water meeting the cliff.
     */
    bank: z
      .union([
        z.literal(false),
        z
          .object({
            width: z.number().positive().default(5),
            rise: z.number().nonnegative().default(0.8),
            dip: z.number().nonnegative().default(1.2),
          })
          .strict(),
      ])
      .default({ width: 5, rise: 0.8, dip: 1.2 }),
    /**
     * A pool dug into its zone's own level instead of a pit (DL-13, 1-8's ponds): the zone's ground
     * sinks into a bowl up to `depth` below the ground around it, its rim wandering, and the cells
     * under the surface are painted unpathable. The bowl's slope is the bank, so `bank` is ignored.
     * Keep `height` a little under the surrounding ground (ground is 8, with ±0.3 of relief).
     */
    dig: z
      .object({ depth: z.number().positive().default(4) })
      .strict()
      .optional(),
    color: WaterColorSchema.optional(),
    states: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "A water state name is letters, digits, spaces, _ and -"),
            height: z.number().finite(),
            color: WaterColorSchema.optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type WaterPool = z.infer<typeof WaterPoolSchema>;

/** A straight ramp up onto a zone, on one of its edges (the zone must be one level above its surroundings). */
export const RampSchema = z
  .object({
    id: slugId,
    zoneId: slugId,
    edge: z.enum(["north", "south", "east", "west"]),
    /** Cells along the edge from its centre (east/north positive); rounded to the 2-cell grid. */
    offset: z.number().default(0),
  })
  .strict();

/**
 * A stock terrain object (data/terrain-object-catalog.json): a bridge, pit, hole or floor piece that
 * stamps its own cliff levels into the terrain around the vertex `at`.
 */
export const TerrainObjectPlacementSchema = z
  .object({
    id: slugId,
    /** Its catalog id, e.g. TerrainObjectCastanarBridge6x10. */
    type: z.string().min(1),
    /** The centre vertex. */
    at: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    /** Quarter turns anticlockwise: 0 puts the stamp's first row along the north edge. */
    rotation: z.number().int().min(0).max(3).default(0),
  })
  .strict();

/** What starts an encounter instead of a player's unit entering its zone: one Anchor's unit's event. */
const EncounterStartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anchorDies"), anchorId: slugId }).strict(),
  z.object({ type: z.literal("anchorEntersZone"), anchorId: slugId, zoneId: slugId }).strict(),
  /** The anchor's unit becomes player 1's. */
  z.object({ type: z.literal("anchorCaptured"), anchorId: slugId }).strict(),
]);

export type EncounterStart = z.infer<typeof EncounterStartSchema>;

/** Enemy units that attack once a player unit enters the trigger zone, or on its `startsWhen` (fires once). */
const EncounterSchema = z
  .object({
    id: slugId,
    /** Names its Trigger Folder; without it the folder is named by its id in words ("raid_quake" is "Raid Quake"). */
    title: z.string().min(1).optional(),
    triggerZoneId: slugId,
    attackerAnchorIds: z.array(slugId).min(1),
    /** Player whose units set off the encounter by entering its zone: player 1 when omitted. An encounter with `startsWhen` takes none. */
    player: z.number().int().positive().optional(),
    /** Starts the encounter instead of the player's units entering its zone: a hero reaching a fortress, not the army before them. */
    startsWhen: EncounterStartSchema.optional(),
    /** Armed only once this Beat has started (or a later one), starting then if its start already holds: an Anchor's unit dead, captured or in the Zone, or one of the player's units in its zone. */
    fromBeat,
    /**
     * A Behavior the encounter's start adds to the Anchor's unit; the encounter ends, for an
     * `encounterEnds` cue, when the unit no longer has it or dies. The data (its duration and
     * removal validators) sets how long it lasts and what cuts it short.
     */
    behavior: z.object({ anchorId: slugId, behavior: z.string().min(1) }).strict().optional(),
    /**
     * When it ends, for an `encounterEnds` cue: the first of `afterSeconds` from its start (AI time,
     * which a playing scene pauses) and `damageTaken`, the damage its attackers have taken together.
     */
    endsWhen: z
      .object({ afterSeconds: z.number().positive().finite().optional(), damageTaken: z.number().positive().finite().optional() })
      .strict()
      .refine((ends) => ends.afterSeconds !== undefined || ends.damageTaken !== undefined, "An encounter's end needs afterSeconds, damageTaken or both")
      .optional(),
  })
  .strict();

/** A count for each difficulty: Casual, Normal, Hard and Brutal, in that order. */
export type DifficultyCounts = readonly [casual: number, normal: number, hard: number, brutal: number];

/** Hard's and Brutal's share of Normal's count, Blizzard's ratios (docs/adr/0008). */
const HARD_SCALE = 1.3;
const BRUTAL_SCALE = 1.5;

/**
 * How many of a Wave's unit type each send brings, by difficulty: four numbers as given, or one
 * (Normal's) that Casual copies and Hard and Brutal scale ×1.3 and ×1.5, rounded.
 */
export function waveUnitCounts(count: number | DifficultyCounts): DifficultyCounts {
  if (typeof count !== "number") return count;
  return [count, count, Math.round(count * HARD_SCALE), Math.round(count * BRUTAL_SCALE)];
}

/** The difficulties, in the order of a count's four numbers. */
export const DIFFICULTY_NAMES = ["Casual", "Normal", "Hard", "Brutal"] as const;

const WaveUnitSchema = z
  .object({
    type: z.string().min(1),
    /** Normal's count, scaled for the other difficulties, or four counts (Casual, Normal, Hard, Brutal). */
    count: z.union([
      z.number().int().positive(),
      z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
    ]),
    /**
     * Which sends bring it: `every` one, or only the stream's `first` that goes out (for a Raid, the
     * first that finds a candidate held), in that send's group: a leader who comes once.
     */
    sends: z.enum(["every", "first"]).default("every"),
    /**
     * A unit Anchor, with no position, that the unit this entry creates binds to: a unit that comes
     * once (a count of at most 1 on each difficulty, with `sends: "first"` or in a Wave that sends
     * once). The Anchor's unit is none until the send creates it (waveUnitAnchors).
     */
    anchorId: slugId.optional(),
  })
  .strict();

/**
 * The Wave's form before ADR 0008: one `targetZoneId`, and `unitTypes` listing a type once per
 * unit. Migrated to `targetZoneIds` and `units` wherever a Blueprint is parsed.
 */
function migrateWave(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  // A wave with both forms of a field keeps the old one, which the strict schema refuses.
  const { targetZoneId, unitTypes, ...wave } = raw as Record<string, unknown>;
  const migrated: Record<string, unknown> = { ...wave };
  if (targetZoneId !== undefined) {
    if (wave.targetZoneIds === undefined) migrated.targetZoneIds = [targetZoneId];
    else migrated.targetZoneId = targetZoneId;
  }
  if (unitTypes !== undefined) {
    if (Array.isArray(unitTypes) && wave.units === undefined) {
      const counts = new Map<unknown, number>();
      for (const type of unitTypes) counts.set(type, (counts.get(type) ?? 0) + 1);
      migrated.units = [...counts].map(([type, count]) => ({ type, count }));
    } else migrated.unitTypes = unitTypes;
  }
  return migrated;
}

/**
 * A timed attack (docs/adr/0004, 0008): units that set off from one zone to attack one of
 * `targetZoneIds`, first `firstSeconds` after `startsAtBeat` begins and then every
 * `intervalSeconds` until `endsAtBeat` (the checker adds the travel time). With
 * `onlyIfPlayerHolds` it is a Raid: each send goes to the first candidate where the player holds a
 * completed unit of that type, or is skipped.
 * Ground Waves compile to trigger streams on AI time (src/triggers/wave-triggers.ts); the other
 * arrivals are for the level-design checker only, and the compile reports them.
 */
const WaveSchema = z.preprocess(
  migrateWave,
  z
    .object({
      id: slugId,
      /** Names its Trigger Folder; without it the folder is named by its id in words ("raid_quake" is "Raid Quake"). */
      title: z.string().min(1).optional(),
      spawnZoneId: slugId,
      /** Candidates in priority order; a plain Wave attacks the first. */
      targetZoneIds: z.array(slugId).min(1),
      /** Only ground waves route through connections; the others arrive at the target directly. */
      arrival: z.enum(["ground", "air", "drop", "nydus", "burrow"]),
      units: z.array(WaveUnitSchema).min(1),
      /** A unit type: the Wave is a Raid, going only where the player holds a completed one. */
      onlyIfPlayerHolds: z.string().min(1).optional(),
      /** Where the units appear, a point Anchor in the spawn Zone; else its walkable cell farthest from every Connection into it. */
      spawnAnchorId: slugId.optional(),
      /** A minimap ping when a raider comes within `seconds` of the aim point; the checker reads it as the telegraph. */
      warning: z
        .object({
          seconds: z.number().positive(),
          /** A `screenplay.scenes` id, or a script scene number, to play as the warning's Transmission. */
          transmission: z.union([slugId, z.number().int().positive()]).optional(),
          /** Only the stream's first send warns; later ones are left to the engine's attack alert. */
          firstOnly: z.boolean().optional(),
        })
        .strict()
        .optional(),
      startsAtBeat: slugId,
      endsAtBeat: slugId.optional(),
      firstSeconds: z.number().nonnegative(),
      /** Omit for a single wave. */
      intervalSeconds: z.number().positive().optional(),
      /** Cells per second at Faster speed; the checker assumes a marine's without it. */
      speed: z.number().positive().optional(),
    })
    .strict(),
);

const ObjectiveTypeSchema = z.enum(["primary", "secondary", "bonus"]);

const ObjectiveSchema = z
  .object({
    id: slugId,
    title: z.string().min(1),
    description: z.string().min(1),
    type: ObjectiveTypeSchema,
    beatId: slugId,
    /** Marks the objective Completed; without it the objective stays active. */
    completeWhen: OutcomeConditionSchema.optional(),
  })
  .strict();

const OutcomesSchema = z
  .object({
    victory: z.array(OutcomeConditionSchema).default([]),
    defeat: z.array(OutcomeConditionSchema).default([]),
  })
  .strict();

const MechanicSchema = z
  .object({
    id: slugId,
    /** Names its Trigger Folder; without it the folder is named by its id in words ("raid_quake" is "Raid Quake"). */
    title: z.string().min(1).optional(),
    type: z.string().min(1),
    description: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const DialogueLineSchema = z
  .object({
    id: slugId,
    speaker: z.string().min(1),
    /** Unit anchor the transmission comes from (portrait and name source). */
    speakerAnchorId: slugId.optional(),
    /** Or a unit type, for speakers who aren't on the map (e.g. "Raynor" on comms). */
    speakerUnitType: z.string().min(1).optional(),
    text: z.string().min(1),
    durationSeconds: z.number().positive().optional(),
  })
  .strict();

const SceneSchema = z
  .object({
    id: slugId,
    beatId: slugId.optional(),
    /** When the scene plays as in-game transmissions; scenes without a cue are not compiled. */
    cue: CueSchema.optional(),
    lines: z.array(DialogueLineSchema).min(1),
  })
  .strict();

/** A Screenplay kept as a Markdown file in core's format (docs/screenplay-format.md), with voice lines (see src/script). */
export const ScriptReferenceSchema = z
  .object({
    /** Markdown script, relative to the blueprint file. */
    source: z.string().min(1),
    /** What the Campaign Pack's Screenplay Source knows this Screenplay by; `npm run pull-screenplay` fetches it into `source`. */
    ref: z.string().min(1).optional(),
    /** Deprecated: `ref`'s old name, read as `ref` when that is absent; the compile warns about it. */
    act: z.string().min(1).optional(),
    /**
     * The conversation the Screenplay is, in place of the naming template's id: an imported map's
     * own (Import writes it), so its Kept cutscenes and triggers are checked against this Screenplay.
     */
    conversationId: z
      .string()
      .regex(NAMED_ID, `a conversation id: ${NAMED_ID_RULE}`)
      .optional(),
    /**
     * The Map Package's Kept conversation, `conversationId`, converted to this Screenplay
     * (convert-screenplay, ADR-0010): what its lines keep from it. With it, a Blueprint with Kept
     * terrain compiles the Screenplay over that conversation, its CSounds and its strings; without
     * it, the package keeps its own.
     */
    conversion: z
      .object({
        /**
         * The Sound each imported line keeps, by its line id, with its Kept recording: only a line
         * whose words are the recording's (its text unchanged). Every other line plays the
         * template's Sound, voiced by a placeholder until it's recorded.
         */
        importedSounds: z.record(z.string().min(1), CatalogId).default({}),
        /** The name each imported group already has, by its group id, where it isn't Conversation/<id>/<group id>. */
        importedGroupNames: z.record(z.string().regex(/^Group\d{5}$/, "A group id is Group and five digits, Group00001"), z.string().min(1)).optional(),
        /** The facial animation an imported line keeps, by its line id, where the Editor gave it one. */
        importedFacialAnims: z.record(z.string().min(1), CatalogId).optional(),
        /** How long each line overlaps the one before it, in milliseconds, as the Kept lines have it (OverlapPrevious). */
        overlapPrevious: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    /**
     * Voice files named <sound ID>.ogg or <sound ID>.wav, relative to the blueprint file (see
     * `npm run tts`). A line with both is voiced by its recording over its placeholder, else by
     * the file in `voiceFormat` (src/host/voice-files.ts).
     */
    audioDir: z.string().min(1).default("audio"),
    /**
     * The format of the Map Package's voice files, and of the placeholders `npm run tts` and a
     * compile write, as an Asset Mod's voices `format`: on "ogg", a .wav voice file is encoded to
     * Ogg Vorbis as it goes into the package (ffmpeg) and an .ogg one is copied; on "wav", each is
     * a .wav, copied.
     */
    voiceFormat: z.enum(VOICE_FORMATS).optional(),
    /** Script speaker (e.g. "RAYNOR") -> unit anchor that speaks the line on the map; others are off-map. */
    speakerAnchors: z.record(z.string(), slugId).default({}),
    /** When each script scene plays; scenes without a cue aren't compiled. */
    cues: z
      .array(
        z
          .object({
            scene: z.number().int().positive(),
            cue: CueSchema,
            /**
             * Plays the scene this long after its cue, as a transition's `afterSeconds` waits, without
             * holding up what else the cue plays; once, however often the cue fires. Counted in AI time,
             * which a playing Cinematic or trigger scene pauses, so the delay counts play.
             */
            afterSeconds: z.number().positive().optional(),
            /**
             * Plays only part of the scene: the lines from this stage direction to the next one,
             * addressed as `S<scene>><n>` (`S07>2`, scene 7's second).
             * For a scene of several messages, each on its own cue.
             */
            from: PartFromSchema.optional(),
            /**
             * Plays only this one line of the scene, by its sound ID: for a scene of one-off lines,
             * each on its own cue. Queued as a part is; a part (`from`) or a line, not both.
             */
            line: LineSoundIdSchema.optional(),
            /**
             * Keeps a scene's parts in order: the entry plays on its own cue (after its
             * `afterSeconds`), but never before the cue entry of this scene, part (`from`) or line
             * has played, named as a `scenePlayed` cue names one. If its cue comes first, it waits
             * for that entry to play, on a thread of its own, so it holds up nothing else on its
             * cue, then plays behind it; once, however often its cue fires.
             */
            after: z
              .object({ ...scenePartFields })
              .strict()
              .optional(),
            /**
             * Drops the entry once it's late: when an entry `after` it, directly or down a chain of
             * `after`s, reaches its cue before this one has begun (still in its `afterSeconds`,
             * waiting on its own `after`, or queued behind another transmission). It never plays
             * then, and counts as played for what waits on it, once the entry it is `after` has
             * played. One that has begun plays to its end. For a message that no longer makes
             * sense once overtaken; Transmissions only.
             */
            skipIfLate: z.literal(true).optional(),
          })
          .strict(),
      )
      .default([]),
    /**
     * Scenes that play as a Cinematic, each from its shot list at cinematics/<id>.json beside the
     * blueprint, compiled into the map's Cutscenes. Its scene's cues play it in place of the scene's
     * Transmissions.
     */
    cinematics: z
      .array(
        z
          .object({
            id: slugId,
            scene: z.number().int().positive(),
            /**
             * "shown" leaves the map's terrain, water and doodads showing behind the Cinematic's sets,
             * for one filmed on the map's own ground, as a Kept cutscene imported with `import-set` is
             * (its set placed back in its Kept coordinates by its `offset`). It then plays in the world
             * at Point(64, 64), where those coordinates meet the terrain, not in a dialog, which draws
             * the world elsewhere. The map's units are still paused and hidden. Hidden when left out,
             * so a built set's windows don't show the map.
             */
            environment: z.literal("shown").optional(),
          })
          .strict(),
      )
      .default([]),
    /**
     * Scenes that play as a trigger scene on the map, each from its shot list at
     * trigger-scenes/<id>.json beside the blueprint (ADR 0012). Its scene's cues play it in place of
     * the scene's Transmissions. Or, listed by `outcome: "victory"` in place of a `scene`, a victory
     * outro with no Screenplay scene, so no lines: it plays last on every victory condition, and needs
     * no cue. At most one is listed so.
     */
    triggerScenes: z
      .array(
        z
          .object({ id: slugId, scene: z.number().int().positive().optional(), outcome: z.literal("victory").optional() })
          .strict()
          .superRefine(({ scene, outcome }, context) => {
            if ((scene === undefined) === (outcome === undefined)) {
              context.addIssue({ code: "custom", message: `A trigger scene plays its Screenplay scene or the victory outcome; give scene or outcome${scene === undefined ? "" : ", not both"}` });
            }
          }),
      )
      .default([]),
  })
  .strict()
  .superRefine(({ act, ref, cues, cinematics, triggerScenes, conversationId, conversion }, context) => {
    // A conversion is of the package's own conversation, which conversationId names.
    if (conversion && conversationId === undefined) context.addIssue({ code: "custom", path: ["conversion"], message: "A conversion is of the Map Package's Kept conversation: name it in conversationId" });
    // One victory outro at most plays on the victory outcome: it ends the game.
    const byOutcome = triggerScenes.filter(({ scene, outcome }) => scene === undefined && outcome !== undefined);
    triggerScenes.forEach((entry, index) => {
      if (entry.scene !== undefined || entry.outcome === undefined || entry === byOutcome[0]) return;
      context.addIssue({ code: "custom", path: ["triggerScenes", index, "outcome"], message: `${byOutcome[0]!.id} already plays on the victory outcome, and only one victory outro can end the game` });
    });
    // A scene plays as one Cinematic or one trigger scene, never both.
    const scenes = new Map<number, string>();
    for (const [list, key, noun] of [
      [cinematics, "cinematics", "Cinematic"],
      [triggerScenes, "triggerScenes", "trigger scene"],
    ] as const) {
      const ids = new Set<string>();
      list.forEach(({ id, scene }, index) => {
        if (ids.has(id)) context.addIssue({ code: "custom", path: [key, index, "id"], message: `Two ${noun}s are called ${id}` });
        ids.add(id);
        if (scene === undefined) return;
        const had = scenes.get(scene);
        if (had) context.addIssue({ code: "custom", path: [key, index, "scene"], message: `Scene ${scene} already has a ${had}` });
        if (!cues.some((cue) => cue.scene === scene)) {
          context.addIssue({ code: "custom", path: [key, index, "scene"], message: `Scene ${scene} has no cue, so its ${noun} would never play; cue it in screenplay.script.cues` });
        }
        scenes.set(scene, noun);
      });
    }
    // A part names a stage direction of its own scene, and plays Transmissions: a Cinematic or a trigger scene plays whole.
    // A line is one of its scene's (checked against the Screenplay, scene-parts.ts), and not a part's as well.
    cues.forEach(({ scene, from, line }, index) => {
      for (const issue of scenePartIssues({ scene, from, line }, "A cue plays a part (from) or a line, not both: remove one")) context.addIssue({ code: "custom", path: ["cues", index, issue.field], message: issue.message });
      const field = from !== undefined ? "from" : line !== undefined ? "line" : undefined;
      if (field === undefined) return;
      const played = cinematics.some((entry) => entry.scene === scene) ? "a Cinematic" : triggerScenes.some((entry) => entry.scene === scene) ? "a trigger scene" : undefined;
      if (played) context.addIssue({ code: "custom", path: ["cues", index, field], message: `Scene ${scene} plays as ${played}, so its cues play it whole; remove ${field}` });
    });
    if (act !== undefined && ref !== undefined && act !== ref) {
      context.addIssue({ code: "custom", path: ["act"], message: `act is ref's old name, and it differs from ref (${ref}); remove it` });
    }
  })
  .transform((reference) => (reference.act !== undefined && reference.ref === undefined ? { ...reference, ref: reference.act } : reference));

const ScreenplaySchema = z
  .object({
    title: z.string().min(1),
    scenes: z.array(SceneSchema).default([]),
    script: ScriptReferenceSchema.optional(),
  })
  .strict();

export const MapSizeSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

/**
 * A texture set's palette: `texturePalette`'s fields over the set's textures, with the bands counted
 * from the set's own main level: `mainLevel`, else the cliff level most of its Zones' cells are on.
 */
export const TextureSetPaletteSchema = TexturePaletteSchema.extend({ mainLevel: z.number().int().min(0).max(15).optional() }).strict();
export type TextureSetPalette = z.infer<typeof TextureSetPaletteSchema>;

/**
 * A texture set of the Mission's own (ADR-0016): up to 8 textures from any tileset, painted over
 * the generating Zones it lists or that sit at its levels (every Zone generates on a generated map). The compile adds it to
 * the Map Package as one of the map's 8 texture sets and moves every 8×8-cell block holding a cell
 * of its Zones onto it (on a generated map, every block its Zones cover most of).
 */
export const TextureSetSchema = z
  .object({
    /** The Blueprint's name for the set, which the compile record files it under. */
    id: slugId,
    /** The set's name in t3Terrain.xml, a tileset (CTerrain id), shown in the Editor's Texture Set menu; by default the tileset listing most of its textures. */
    name: z.string().regex(/^[\w.-]+$/).optional(),
    /**
     * The set's textures (CTerrainTex ids, any tileset), in slot order: the first is slot 8s, the
     * set's layer 0. Beside Kept ground, a texture the Kept ground in the set's blocks shows must
     * sit at the layer it has in the set those blocks are on now: e.g. a Kept map's factory set whose
     * first texture, KorhalCityEx2_1, is layer 0 of the map's first set. On a generated map a set's Zone with no
     * `texture` of its own wears its band of the set's `palette`, else the set's first.
     */
    textures: z.array(z.string().regex(/^[\w.-]+$/)).min(1).max(8),
    /** The generating Zones painted from this set: ids, or patterns with `*` (`"factory-*"`) that match every generating Zone whose id fits. */
    zones: z.array(z.string().min(1)).default([]),
    /**
     * Cliff levels: every generating Zone at one of them (its `elevation`) is painted from this set,
     * unless a set's `zones` names it. A level is in one set at most. A set gives `zones`, `levels` or both.
     */
    levels: z.array(z.number().int().min(0).max(15)).min(1).optional(),
    /**
     * How a fully generated map paints the set's natural Zones, as `texturePalette` paints the rest:
     * level bands and variety patches, all from the set's textures. Without one, a Zone wears its
     * `texture`, else the set's first.
     */
    palette: TextureSetPaletteSchema.optional(),
  })
  .strict();
export type TextureSet = z.infer<typeof TextureSetSchema>;

/**
 * One texture of a Paint Region's mix (ADR-0028), with its amount given one of two ways, or none:
 * - `weight`, a blend weight: that fraction of the texture's layer in every cell of the region.
 * - `share`, an area share: patches of the texture covering about that fraction of the region, measured
 *   as its mean weight past the region's falloff, so the weights, shares and rest add up to its paint.
 * - neither: the texture takes what the others leave. A mix has at most one of these.
 */
export const PaintMixSchema = z
  .object({
    /** A CTerrainTex id, one of the texture set's the region's cells are on. */
    texture: z.string().min(1),
    weight: z.number().gt(0).max(1).optional(),
    share: z.number().gt(0).max(1).optional(),
  })
  .strict()
  .refine((entry) => entry.weight === undefined || entry.share === undefined, "A texture takes a blend weight or an area share, not both");
export type PaintMix = z.infer<typeof PaintMixSchema>;

/**
 * A Paint Region (ADR-0028): a polygon, or a Zone's, whose texture mix overrides its Zones' palette
 * inside it. The compile paints the Zone palettes, then each region in order, feathered at its edge.
 */
export const PaintRegionSchema = z
  .object({
    id: slugId,
    /** The region's outline in map cells, inside the map. Give this or `zone`. */
    polygon: z.array(PositionSchema).min(3).optional(),
    /** A Zone whose polygon is the region's outline (a generating one, beside Kept ground). Give this or `polygon`. */
    zone: slugId.optional(),
    /** The textures and their amounts: blend weights and area shares together at most 1. */
    mix: z.array(PaintMixSchema).min(1).max(8),
    /** Cells inward from the edge over which the mix fades in from the ground under it: 2 by default, 0 a hard edge. */
    falloff: z.number().min(0).optional(),
    /** Cliff levels the region paints; every level when left out. */
    levels: z.array(z.number().int().min(0).max(15)).min(1).optional(),
  })
  .strict()
  .refine((region) => (region.polygon === undefined) !== (region.zone === undefined), "A Paint Region gives a polygon or a zone, one of the two");
export type PaintRegion = z.infer<typeof PaintRegionSchema>;

/** One cliff set for a group of Zones' cliffs: see `cliffSets` on the blueprint. */
export const CliffSetGroupSchema = z
  .object({
    /** The cliff set (an id from data/cliff-extracted.json, any tileset's, or the Campaign Mod's). */
    cliffSet: z.string().min(1),
    /** The Zones whose cliffs wear it: ids, or patterns with `*` (`"ruin*"`) that match every Zone whose id fits. */
    zones: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type CliffSetGroup = z.infer<typeof CliffSetGroupSchema>;

/**
 * The most different cliff sets a map may use (its `<cliffSetList>`). Reported by the community, not yet
 * checked in the Editor; no map in the research archive (166 with cliffs) uses more.
 */
export const MAX_MAP_CLIFF_SETS = 4;

/** Cliff sets by the ground they border: see `cliffPalette` on the blueprint. */
export const CliffPaletteSchema = z
  .object({ natural: z.string().min(1), built: z.string().min(1).optional(), pit: z.string().min(1).optional() })
  .strict();

/**
 * Issues in the Zones' `hiddenCells`: a Kept Zone's (Kept ground keeps the package's hides), and a
 * rectangle off the map or with a cell whose centre is outside its Zone's polygon.
 */
export function checkHiddenCells(
  blueprint: { readonly zones: readonly z.infer<typeof ZoneSchema>[]; readonly mapSize: { readonly width: number; readonly height: number } },
  context: z.RefinementCtx,
): void {
  const { width, height } = blueprint.mapSize;
  blueprint.zones.forEach((zone, zoneIndex) => {
    if (!zone.hiddenCells?.length) return;
    if (zone.terrain === "kept") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${zone.id} is drawn over Kept ground, whose hidden cells stay as the package has them: hide its cells in the Editor, or make the Zone generate`, path: ["zones", zoneIndex, "hiddenCells"] });
      return;
    }
    zone.hiddenCells.forEach(([x, y, w, h], rectIndex) => {
      const path = ["zones", zoneIndex, "hiddenCells", rectIndex];
      if (x + w > width || y + h > height) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Hidden cells [${x}, ${y}, ${w}, ${h}] reach off the ${width}×${height} map`, path });
        return;
      }
      for (let cy = y; cy < y + h; cy++) {
        for (let cx = x; cx < x + w; cx++) {
          if (containsPoint(zone.polygon, { x: cx + 0.5, y: cy + 0.5 })) continue;
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Hidden cell (${cx}, ${cy}) is outside ${zone.id}: list it on the Zone it's in`, path });
          return;
        }
      }
    });
  });
}

/** The fields a Mission Blueprint and a Melee Map Blueprint share and draw the terrain from. */
type TerrainFields = {
  readonly zones: readonly z.infer<typeof ZoneSchema>[];
  readonly ramps: readonly z.infer<typeof RampSchema>[];
  readonly textures?: readonly string[] | undefined;
  readonly texturePalette?: TexturePalette | undefined;
  readonly textureSets?: readonly TextureSet[] | undefined;
};

/**
 * Issues in the terrain fields: textures the palette or a zone names that the map lacks, ramps on
 * unknown zones, and connections to unknown zones, at unknown beats, or that the two sides disagree on.
 * A Zone in a texture set is painted from its set (checkTextureSets), not the map's textures or palette.
 */
export function checkTerrainFields(blueprint: TerrainFields, context: z.RefinementCtx, beatIds: ReadonlySet<string>): void {
  const zoneIds = new Set(idsOf(blueprint, "zones"));
  const inSet = textureSetOfZone(blueprint.textureSets ?? [], blueprint.zones);
  const palette = blueprint.texturePalette;
  if (palette) {
    const names = paletteTextures(palette);
    if (names.length > 8) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A texture palette can use at most 8 textures", path: ["texturePalette"] });
    }
    for (const name of names) {
      if (blueprint.textures && !blueprint.textures.includes(name)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Palette texture ${name} is not one of the blueprint's textures`, path: ["texturePalette"] });
      }
    }
    blueprint.zones.forEach((zone, zoneIndex) => {
      if (zone.surface === "built" && zone.texture === undefined && palette.built === undefined && !inSet.has(zone.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A built zone needs the palette's built texture or its own", path: ["zones", zoneIndex, "surface"] });
      }
    });
  }
  if (blueprint.textures) {
    blueprint.zones.forEach((zone, zoneIndex) => {
      if (zone.texture !== undefined && !inSet.has(zone.id) && !blueprint.textures!.includes(zone.texture)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Zone texture ${zone.texture} is not one of the blueprint's textures`,
          path: ["zones", zoneIndex, "texture"],
        });
      }
    });
  }
  blueprint.ramps.forEach((ramp, rampIndex) => {
    if (!zoneIds.has(ramp.zoneId)) {
      context.addIssue(unknownIdIssue("zones", ramp.zoneId, ["ramps", rampIndex, "zoneId"]));
    }
  });
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  blueprint.zones.forEach((zone, zoneIndex) => {
    zone.connections.forEach((connection, connectionIndex) => {
      const path = ["zones", zoneIndex, "connections", connectionIndex];
      const other = zoneById.get(connection.toZoneId);
      if (!other) {
        context.addIssue(unknownIdIssue("zones", connection.toZoneId, [...path, "toZoneId"]));
        return;
      }
      // The other side may list the same crossing; it must agree on the type and timing. A one-way crossing is listed on one side only.
      const reverse = other.connections.find((candidate) => candidate.toZoneId === zone.id);
      if (reverse && (connection.oneWay || reverse.oneWay)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A one-way connection is listed only on the zone it leaves from (${zone.id} and ${other.id} both list it)`,
          path: [...path, "oneWay"],
        });
      } else if (reverse) {
        if (reverse.type !== connection.type) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${zone.id} and ${other.id} disagree on their connection type (${connection.type} vs ${reverse.type})`,
            path: [...path, "type"],
          });
        }
        for (const key of ["opensAtBeat", "closesAtBeat"] as const) {
          if (reverse[key] !== connection[key]) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${zone.id} and ${other.id} disagree on ${key} (${connection[key] ?? "unset"} vs ${reverse[key] ?? "unset"})`,
              path: [...path, key],
            });
          }
        }
      }
      for (const key of ["opensAtBeat", "closesAtBeat"] as const) {
        const beatId = connection[key];
        if (beatId !== undefined && !beatIds.has(beatId)) {
          context.addIssue(unknownIdIssue("beats", beatId, [...path, key]));
        }
      }
      if (connection.opensAtBeat !== undefined && connection.opensAtBeat === connection.closesAtBeat) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A connection can't open and close at the same beat", path });
      }
      if (connection.type === "ramp") {
        const low = Math.min(zone.elevation, other.elevation);
        if (Math.abs(zone.elevation - other.elevation) !== 1 || low < 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A ramp joins zones exactly one level apart and can't go into a level-0 pit (${zone.id} ${zone.elevation}, ${other.id} ${other.elevation})`,
            path: [...path, "type"],
          });
        }
      }
    });
    zone.overlooks.forEach((zoneId, overlookIndex) => {
      const path = ["zones", zoneIndex, "overlooks", overlookIndex];
      if (!zoneIds.has(zoneId)) {
        context.addIssue(unknownIdIssue("zones", zoneId, path));
      } else if (zoneId === zone.id) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A zone can't overlook itself", path });
      }
    });
  });
}

const CoreBlueprintSchema = z
  .object({
    id: slugId,
    campaignId: slugId,
    title: z.string().min(1),
    summary: z.string().min(1).optional(),
    setting: z.string().min(1),
    /** The mission's archetype until a beat declares another; the checker applies its bands. */
    archetype: ArchetypeSchema.optional(),
    mapSize: MapSizeSchema,
    /**
     * The map's playable area, MapInfo's one rectangle (ADR-0015, map/map-bounds.ts): where units
     * may go, the camera's bounds at the start and `RegionPlayableMap()`. `playable` is a rectangle
     * of whole cells, "zones" (the default) for the box round the Zones that aren't backdrop
     * widened by `margin` cells (3 by default) and kept inside the Editor's own inset, or "editor"
     * for that inset, 10 / 8 / 10 / 20 cells in from the left, bottom, right and top. Beside Kept
     * terrain the package keeps its own rectangle unless `playable` is given.
     */
    bounds: z
      .object({
        playable: z.union([z.literal("zones"), z.literal("editor"), BoundsRectSchema]).optional(),
        margin: z.number().int().min(0).max(32).optional(),
      })
      .strict()
      .optional(),
    tilesetId: z.string().min(1).optional(),
    /** CLight to use instead of the tileset's default (a stock light or one of `lights`); written as a map-local tileset override. */
    lighting: z.string().min(1).optional(),
    /**
     * Map Options' Unexplored Areas: `black` (Black Mask, the default) keeps ground the player hasn't
     * explored black until a Beat reveals it; `grey` (Grey Mask) shows it greyed, as Media Blitz does.
     * `black-reduced-radius` (Black Mask (Reduced Radius)) is Black Mask without its reveal radius,
     * which un-blacks cells past what a unit sees, cliffs or not: for interiors and caves, where the
     * rock tops over a unit shouldn't show through the fog, as in Nova Covert Ops' The Escape.
     * A Mission with Kept terrain keeps its package's own setting.
     */
    unexploredAreas: z.enum(UNEXPLORED_AREAS).optional(),
    /** The mission's own lights, retuned from stock ones (DL-09). */
    lights: z.array(MissionLightSchema).default([]),
    /**
     * Painted lighting regions (docs/reference/lighting-regions.md): regions 2 to 4 of the map's Light (`lighting`, else the
     * tileset's), each a light of its own over the Zones that name it in their `lightRegion`, region
     * 1 being the Light as it is. The compile paints LightingMap.tga, every cell taking its nearest
     * walkable Zone's region so rock between Zones splits down the middle, and blends each edge
     * over about `blend` cells (8 when left out; 0 for hard edges).
     */
    lightRegions: z
      .object({
        regions: z.object({ "2": LightRegionSchema.optional(), "3": LightRegionSchema.optional(), "4": LightRegionSchema.optional() }).strict(),
        blend: z.number().min(0).max(32).optional(),
      })
      .strict()
      .optional(),
    /** What changes when the story moves on: the light at a cue, for now (DL-09). */
    transitions: z.array(TransitionSchema).default([]),
    /** The UI Components' actions, each at its cue (ADR-0019). */
    uiActions: z.array(UiActionSchema).default([]),
    /** Skybox, fog and whether pits open onto the sky (DL-14); written as a map-local tileset override. */
    sky: SkySchema.optional(),
    /** Water and lava pools over zones (DL-13); transitions raise them. */
    water: z.array(WaterPoolSchema).default([]),
    /**
     * Hand edits to the generated ground, brought back from the Editor by `npm run sync`.
     * `heights` raises (positive) or lowers (negative) the ground at a vertex, keyed `"x,y"`, by that
     * much over what the Zones, banks and dug pools generate. Offsets, not heights, so the edit
     * moves with its Zone's level. A generated map's only: beside Kept ground the ground is edited
     * in the package (edit_kept_terrain).
     */
    terrainEdits: z
      .object({ heights: z.record(z.string(), z.number().finite()).default({}) })
      .strict()
      .optional(),
    /**
     * The author's own no-pathing paint over what the compile paints (dug pools, and solid doodads:
     * src/terrain/doodad-pathing.ts), brought back from the Editor's pathing brush by `npm run
     * sync`. Each entry paints (`block`) or erases (`clear`) rectangles [x, y, width, height] in
     * cells, on the Editor's grid of half a cell across and a quarter high, so every number is a
     * multiple of 0.5 (x, width) or 0.25 (y, height). With `doodad` (a placed doodad's id: an
     * Anchor's id, or `<set piece>/<type>/<n>`, `<set piece>/added/<n>`) the rectangles are offsets
     * from the corner of the sub-cell under the doodad's origin, so they move with it; without, they
     * are where they are. Erasing wins over the compile's paint, painting over everything. A
     * generated map's only: beside Kept ground the package's paint is the author's.
     */
    pathingPaint: z.array(PathingPaintSchema).optional(),
    /**
     * Declarative Mission tests (issue #741). `routes` are walks that should arrive or be blocked on
     * the terrain the compile would generate, checked without the game by `check_layout`'s
     * `route-tests` and by `test_mission` before it starts the game. A generated map's only.
     */
    tests: z.object({ routes: z.array(RouteTestSchema).default([]) }).strict().optional(),
    /**
     * A bank fixture (issue #55): a folder of `.SC2Bank` files in the Workspace, as a path from this
     * Blueprint's folder. `test_mission` copies its banks into the game's Banks folder for the run and puts the author's back when the
     * game quits. Without it a test game runs on the author's own banks.
     */
    bankFixture: z.string().min(1).optional(),
    /**
     * Blend textures (CTerrainTex ids, up to 8) to use instead of the tileset's, also written as a
     * map-local tileset override, e.g. Meinhoff's textures on MonlythEx1.
     */
    textures: z.array(z.string().min(1)).min(1).max(8).optional(),
    /**
     * The textures zones are painted with (CTerrainTex ids, from any tileset; see
     * the texture_sheet tool and the exemplar-design skill). `main` covers the main level (the
     * cliff level with the most cells), `low` every level below it and `high` every level above it,
     * each falling back to `main`; up to 3 `variety` textures are patched into the main level; `built` paints
     * zones whose surface is built. Without `textures`, the mission's 8 textures are these, then
     * the tileset's.
     */
    texturePalette: TexturePaletteSchema.optional(),
    /**
     * Texture sets of the Mission's own (ADR-0016): each adds up to 8 textures from any tileset,
     * painted over the generating Zones it lists (any Zone, on a generated map), so the map can show
     * up to the Editor's 16 textures. On a generated map a block shared by Zones of two sets goes to
     * the set whose Zones cover most of its cells (a tie to set 0, then the set listed first), and the
     * other Zones' cells there are painted from it, with a warning.
     */
    textureSets: z.array(TextureSetSchema).optional(),
    /**
     * Paint Regions (ADR-0028): polygons, or Zones', each with a texture mix of blend weights, area
     * shares and one texture taking the rest, painted in order over the Zone palettes, feathered
     * at their edges (terrain/paint-regions.ts). Area shares are the variety painter's patches, calibrated per region.
     */
    paintRegions: z.array(PaintRegionSchema).optional(),
    /** Map-wide dressing: cliff feet first (DL-05); set pieces are `set-piece` placements. */
    dressing: DressingSchema.optional(),
    /**
     * Cliff sets (ids from data/cliff-extracted.json, any tileset), chosen with the ground they
     * border (DL-04): `natural` for cliffs under natural ground, `built` under built zones, `pit`
     * for cliffs dropping below the main level. Without it every cliff wears the tileset's first set.
     */
    cliffPalette: CliffPaletteSchema.optional(),
    /**
     * Cliff sets for groups of Zones, over the cliff palette (DL-04, DL-14): each names a set and the
     * Zones whose cliffs wear it, so an area's cliffs are chosen with its ground. A cliff belongs to the
     * Zone on top of it, except where that Zone is a backdrop and the Zone at its foot isn't: a wall of
     * backdrop rock belongs to the floor it rises from, so a floor's choice dresses the walls round it.
     * A floor naming nothing leaves its walls to the rock's own choice. A Zone is in one group at most, and
     * its own `cliff` wins over its group. Beside Kept ground a group lists generating Zones only. A
     * generated map has at most 4 cliff sets (MAX_MAP_CLIFF_SETS).
     */
    cliffSets: z.array(CliffSetGroupSchema).optional(),
    /**
     * How far, in cells, natural cliff outlines wobble off their zones' polygon sides (default 4; 0
     * keeps every cliff on its polygon). The wobble is smooth along each edge and seeded from
     * `terrainSeed`, so the same blueprint compiles the same terrain. Built zones keep straight
     * sides, and the ground round ramps, bridges, terrain objects and each connection's `at` stays
     * as the polygons put it; give a narrow crossing an `at` to keep its width (terrain/ragged-outlines.ts).
     */
    raggedCliffs: z.number().min(0).max(8).optional(),
    /**
     * The text the terrain's generated choices (the ragged cliffs' wobble) are seeded from; the
     * Mission's `id` when unset. Set it to the old id when renaming a Mission, so its cliffs keep
     * the shapes they had. Any other text gives other wobbles from the same polygons.
     */
    terrainSeed: z.string().min(1).optional(),
    dependencies: z.array(z.string().min(1)).min(1).optional(),
    /**
     * The Zones whose ground the compile generates. None means every terrain cell is Kept Content
     * (ADR-0010): the Map Package's own terrain stands as it is, as Import leaves it. Beside Kept
     * ground each Zone sets `terrain`, and only generating Zones' cells are written.
     */
    zones: z.array(ZoneSchema).default([]),
    anchors: z.array(AnchorSchema).default([]),
    /** The Kept Content the Compiled Content builds on, each found in the Map Package by Editor Id (ADR-0010). */
    kept: z.array(KeptReferenceSchema).default([]),
    /**
     * The Mission's own trigger elements (ADR-0026): one JSON file each in its `triggers/` folder, by
     * path (domain/blueprint-trigger.ts), compiled beside the Kept and the concepts' triggers.
     */
    triggers: z.array(BlueprintTriggerPath).optional(),
    /** The Mission's own global variables (Variable elements), which its own triggers and Kept ones may name by Id. */
    triggerVariables: z.array(MAP_GUI.GuiVariableSchema).optional(),
    /** The Trigger Folders the Blueprint's own triggers and globals are filed in; one no folder files goes in Root. */
    triggerFolders: z.array(BlueprintTriggerFolderSchema).optional(),
    /**
     * The Declared Content a Mod Blueprint declares the same way (domain/declared-content.ts):
     * catalog entries, the includes list, Characters, strings, files written whole, Set cutscenes,
     * and the Equivalence Check's Accepted Differences and Removals, each compiled into the Map
     * Package as a mod's compile writes it into the mod (src/mods/declared-parts.ts), beside what
     * the Mission's compile generates. convert-screenplay lists a converted part's Accepted
     * Differences, and names them with --accept.
     */
    ...DeclaredContentShape,
    placements: z.array(PlacementSchema).default([]),
    /** The mission's own Doodad Composite recipes (DL-07); they win over the Style Pack's shared library on an id clash. */
    composites: z.array(CompositeSchema).default([]),
    /**
     * The Mission's own custom doodads (domain/custom-doodad.ts): models in its folder, written into
     * its Map Package with a CModel and a CActorDoodad each, so it can place them and the Editor's
     * palette lists them. A doodad more than one Mission uses goes in the Campaign Mod's instead.
     */
    doodads: MissionDoodadsSchema,
    /** Regions the author drew in the Editor, written after the zone and set-piece regions. */
    regions: z.array(RegionSchema).default([]),
    /** The story's Beats: at least one when the Blueprint has Zones; an imported one adds them when a job needs them. */
    beats: z.array(BeatSchema).default([]),
    objectives: z.array(ObjectiveSchema).default([]),
    encounters: z.array(EncounterSchema).default([]),
    waves: z.array(WaveSchema).default([]),
    ramps: z.array(RampSchema).default([]),
    /** Stock terrain objects, stamped over the zones' cliff levels after ramps. */
    terrainObjects: z.array(TerrainObjectPlacementSchema).default([]),
    outcomes: OutcomesSchema.default({ victory: [], defeat: [] }),
    mechanics: z.array(MechanicSchema).default([]),
    /** This mission's overrides of the enemy AI's tuning; the defaults live in `src/ai/enemy-ai.ts`. */
    enemyAi: EnemyAiOverridesSchema.optional(),
    /** Each player's units, buildings and upgrades at the start: one entry per player (see PlayerTechSchema). */
    tech: z.array(PlayerTechSchema).default([]),
    screenplay: ScreenplaySchema,
  })
  .strict()
  .superRefine((blueprint, context) => {
    // Zones beside Kept ground name their terrain, all or none.
    const named = blueprint.zones.filter((zone) => zone.terrain !== undefined).length;
    if (named > 0 && named < blueprint.zones.length) {
      blueprint.zones.forEach((zone, index) => {
        if (zone.terrain === undefined) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Another Zone sets terrain, so the Mission has Kept ground: say whether ${zone.id} generates its ground ("generate") or is drawn over Kept ground ("kept")`, path: ["zones", index, "terrain"] });
        }
      });
    }
    if (blueprint.zones.length > 0 && blueprint.beats.length === 0 && named === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Zones need at least one Beat: the story the Mission plays over them", path: ["beats"] });
    }
    // Each collection's entries are read once: the id sets below and the repeat checks share them.
    const entriesByCollection = new Map<Collection, ReturnType<typeof idEntries>>();
    const entriesOf = (collection: Collection): ReturnType<typeof idEntries> => {
      let entries = entriesByCollection.get(collection);
      if (!entries) entriesByCollection.set(collection, (entries = idEntries(blueprint, collection)));
      return entries;
    };
    const idSet = (collection: Collection): Set<string> => new Set(entriesOf(collection).map((entry) => entry.id));
    const zoneIds = idSet("zones");
    const anchorIds = idSet("anchors");
    const beatIds = idSet("beats");

    function addDuplicateIssue(path: (string | number)[], id: string): void {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate id: ${id}`,
        path,
      });
    }

    /** Issues for repeats among `values`: `Duplicate <what>: <value>` at the repeat's `at(index)`. */
    function checkRepeats(values: readonly string[], what: string, at: (index: number) => (string | number)[]): void {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${what}: ${value}`, path: at(index) });
        seen.add(value);
      });
    }

    /** Issues for a collection's repeated ids, at the repeat's own `id`. */
    function checkIds(collection: Collection): void {
      const entries = entriesOf(collection);
      checkRepeats(entries.map((entry) => entry.id), "id", (index) => entries[index]!.path);
    }

    checkIds("zones");
    checkTextureSets(blueprint, named > 0, context);
    checkCliffSets(blueprint, named > 0, context);
    checkHiddenCells(blueprint, context);
    checkPaintRegions(blueprint, named > 0, context);
    checkIds("paintRegions");
    checkIds("anchors");
    checkIds("kept");
    // Kept References share the Anchor namespace.
    blueprint.kept.forEach((reference, index) => {
      if (anchorIds.has(reference.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Kept Reference ${reference.id} has an Anchor's id`, path: ["kept", index, "id"] });
      // A condition naming that id would take the Kept region for the Zone.
      else if (reference.kind === "region" && zoneIds.has(reference.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Kept Reference ${reference.id} has a Zone's id`, path: ["kept", index, "id"] });
    });
    checkIds("placements");
    checkIds("regions");
    checkIds("composites");
    checkIds("beats");
    checkIds("objectives");
    checkIds("encounters");
    checkIds("waves");
    checkIds("ramps");
    checkRepeats(blueprint.tech.map((tech) => String(tech.player)), "player", (index) => ["tech", index, "player"]);
    checkIds("terrainObjects");
    checkTerrainFields(blueprint, context, beatIds);
    checkIds("mechanics");
    checkIds("scenes");

    // A Wave's unit's Anchor (waveUnitAnchors) is the one with no position: its send places it.
    const waveUnits = waveUnitAnchors(blueprint);
    // Each one's unit is a trigger variable named for its id with - and _ alike (kept-ids'
    // waveUnitVariable), so two ids that differ only there would share it.
    const variableNames = new Map<string, string>();
    for (const anchorId of waveUnits.keys()) {
      const name = anchorId.replace(/-/g, "_");
      const other = variableNames.get(name);
      if (other !== undefined) {
        const index = blueprint.anchors.findIndex((anchor) => anchor.id === anchorId);
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Wave units' Anchors ${other} and ${anchorId} differ only in - and _, which their trigger variables can't tell apart: rename one`, path: index >= 0 ? ["anchors", index, "id"] : ["anchors"] });
      } else variableNames.set(name, anchorId);
    }
    // An adopted doodad's Editor Id is its object's: no other Anchor may write there.
    const objectIds = new Map<number, string>();
    blueprint.anchors.forEach((anchor) => {
      if (anchor.editorId === undefined) objectIds.set(stableObjectId(anchor.id), anchor.id);
    });
    // A Kept Reference's object stays the package's: no doodad is written over it.
    for (const reference of blueprint.kept) {
      if ((reference.kind === "unit" || reference.kind === "point" || reference.kind === "camera") && typeof reference.editorId === "number") objectIds.set(reference.editorId, `Kept Reference ${reference.id}`);
    }
    blueprint.anchors.forEach((anchor, anchorIndex) => {
      if (anchor.editorId === undefined) return;
      const path = ["anchors", anchorIndex, "editorId"];
      if (anchor.kind !== "doodad") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Only a doodad Anchor takes an editorId (an adopted Editor doodad's own Id); ${anchor.id} is a ${anchor.kind}`, path });
        return;
      }
      const other = objectIds.get(anchor.editorId);
      if (other !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: `${anchor.id}'s editorId ${anchor.editorId} is the object ${other} writes too`, path });
      else objectIds.set(anchor.editorId, anchor.id);
    });
    blueprint.anchors.forEach((anchor, anchorIndex) => {
      if (!zoneIds.has(anchor.zoneId)) {
        context.addIssue(unknownIdIssue("zones", anchor.zoneId, ["anchors", anchorIndex, "zoneId"]));
      }
      const bound = waveUnits.get(anchor.id);
      if (bound && anchor.position !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${anchor.id} is Wave ${bound.wave.id}'s unit (its anchorId), which its send creates, so nothing is placed for it: leave out its position`,
          path: ["anchors", anchorIndex, "position"],
        });
      } else if (!bound && anchor.position === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${anchor.id} needs a position: only a unit Anchor a Wave's unit entry binds (its anchorId) has none`,
          path: ["anchors", anchorIndex, "position"],
        });
      }
    });

    blueprint.placements.forEach((placement, placementIndex) => {
      if (placement.kind === "set-piece") {
        const parsed = SetPieceParamsSchema.safeParse(placement.params);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["placements", placementIndex, "params", ...issue.path] });
        } else if (parsed.data.anchor.length + parsed.data.props.length + parsed.data.clutter.length + parsed.data.added.length === 0) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "A set piece needs at least one doodad", path: ["placements", placementIndex, "params"] });
        }
      }
      // Built placements (with `at`) must parse; checker-only ones keep their free-form params.
      const built = { "resource-base": ResourceBaseParamsSchema, "encounter-group": EncounterGroupParamsSchema }[placement.kind as string];
      if (built && placement.params["at"] !== undefined) {
        const parsed = built.safeParse(placement.params);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["placements", placementIndex, "params", ...issue.path] });
        }
      }
      if (!zoneIds.has(placement.zoneId)) {
        context.addIssue(unknownIdIssue("zones", placement.zoneId, ["placements", placementIndex, "zoneId"]));
      }
      if (placement.passiveUntilBeat !== undefined) {
        const path = ["placements", placementIndex, "passiveUntilBeat"];
        if (placement.kind !== "encounter-group") {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "passiveUntilBeat only applies to encounter groups", path });
        } else if (!beatIds.has(placement.passiveUntilBeat)) {
          context.addIssue(unknownIdIssue("beats", placement.passiveUntilBeat, path));
        }
      }
    });

    blueprint.beats.forEach((beat, beatIndex) => {
      for (const key of ["zoneIds", "reveals"] as const) {
        (key === "reveals" ? revealedZoneIds(beat) : beat[key]).forEach((zoneId, zoneIdIndex) => {
          if (!zoneIds.has(zoneId)) {
            context.addIssue(unknownIdIssue("zones", zoneId, ["beats", beatIndex, key, zoneIdIndex]));
          }
        });
      }
      beat.anchorIds.forEach((anchorId, anchorIdIndex) => {
        if (!anchorIds.has(anchorId)) {
          context.addIssue(unknownIdIssue("anchors", anchorId, ["beats", beatIndex, "anchorIds", anchorIdIndex]));
        }
      });
      if (beat.camera && beat.camera.bounds !== "playable") checkBoundsArea(beat.camera.bounds, ["beats", beatIndex, "camera", "bounds"]);
      if (Array.isArray(beat.camera?.transition)) checkInsideMap(beat.camera.transition as BoundsRect, ["beats", beatIndex, "camera", "transition"]);
      if (beat.playable !== undefined && beat.playable !== "entire") checkBoundsArea(beat.playable, ["beats", beatIndex, "playable"]);
    });

    const { bounds } = blueprint;
    if (Array.isArray(bounds?.playable)) {
      const rect = bounds.playable as BoundsRect;
      if (!rect.every(Number.isInteger)) context.addIssue({ code: z.ZodIssueCode.custom, message: "The map's playable area is in whole cells, as MapInfo holds it", path: ["bounds", "playable"] });
      checkInsideMap(rect, ["bounds", "playable"]);
    } else if (bounds?.playable === "zones" && !blueprint.zones.some((zone) => !zone.backdrop)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A playable area of "zones" needs a Zone that isn\'t backdrop to draw the box round: give a rectangle', path: ["bounds", "playable"] });
    }
    // The margin widens only the box round the Zones: "zones", given or (on generated terrain) by default.
    const keptGround = hasKeptTerrain(blueprint);
    if (bounds?.margin !== undefined && bounds.playable !== "zones" && (bounds.playable !== undefined || keptGround)) {
      const instead = Array.isArray(bounds.playable) ? "a rectangle" : bounds.playable === "editor" ? '"editor"' : "the package's own rectangle, which Kept terrain keeps without a playable";
      context.addIssue({ code: z.ZodIssueCode.custom, message: `A margin widens the box round the Zones, so it goes with a playable area of "zones", not ${instead}`, path: ["bounds", "margin"] });
    }
    // Height edits offset a generated map's vertices; beside Kept ground the compile generates no heights for them to offset.
    for (const key of Object.keys(blueprint.terrainEdits?.heights ?? {})) {
      const path = ["terrainEdits", "heights", key];
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (!/^\d+,\d+$/.test(key)) context.addIssue({ code: z.ZodIssueCode.custom, message: `A height edit is keyed by its vertex, "x,y" (such as "193,40"), not ${JSON.stringify(key)}`, path });
      else if (keptGround) context.addIssue({ code: z.ZodIssueCode.custom, message: "Height edits offset generated ground, and this Mission has Kept terrain: edit its ground in the package with edit_kept_terrain", path });
      else if (x > blueprint.mapSize.width || y > blueprint.mapSize.height) context.addIssue({ code: z.ZodIssueCode.custom, message: `Vertex ${key} is off the ${blueprint.mapSize.width}×${blueprint.mapSize.height} map (its vertices run 0-${blueprint.mapSize.width}, 0-${blueprint.mapSize.height})`, path });
    }
    // "playable" and "entire" name the natives' own areas, so a Zone or Kept region of that id can't be meant there.
    const reservedClash = (word: string, path: (string | number)[]): void => {
      if (zoneIds.has(word) || blueprint.kept.some((reference) => reference.id === word && reference.kind === "region")) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `"${word}" here is the ${word === "entire" ? "whole map" : "playable area as it stands"}, not the Zone or Kept region ${word}: rename that one to name it as bounds`, path });
      }
    };
    blueprint.beats.forEach((beat, beatIndex) => {
      if (beat.playable === "entire") reservedClash("entire", ["beats", beatIndex, "playable"]);
      if (beat.camera?.bounds === "playable") reservedClash("playable", ["beats", beatIndex, "camera", "bounds"]);
    });

    /** A rectangle off the map is one the game can't bound anything to. */
    function checkInsideMap(rect: BoundsRect, path: (string | number)[]): void {
      // A rectangle with no area is BoundsRectSchema's to refuse.
      if (rect[0] < rect[2] && rect[1] < rect[3] && !rectOnMap(rect, blueprint.mapSize)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `[${rect.join(", ")}] runs off the ${blueprint.mapSize.width}×${blueprint.mapSize.height} map`, path });
      }
    }

    /** A Beat's bounds area: Zones that exist, a Zone or Kept region by id, or a rectangle on the map. */
    function checkBoundsArea(area: BoundsArea, path: (string | number)[]): void {
      if (typeof area === "string") {
        if (!zoneIds.has(area) && !blueprint.kept.some((reference) => reference.id === area && reference.kind === "region")) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown zone or Kept region id: ${area}`, path });
        }
      } else if (typeof area[0] === "string") {
        (area as readonly string[]).forEach((zoneId, index) => {
          if (!zoneIds.has(zoneId)) context.addIssue(unknownIdIssue("zones", zoneId, [...path, index]));
        });
      } else checkInsideMap(area as BoundsRect, path);
    }

    blueprint.objectives.forEach((objective, objectiveIndex) => {
      if (!beatIds.has(objective.beatId)) {
        context.addIssue(unknownIdIssue("beats", objective.beatId, ["objectives", objectiveIndex, "beatId"]));
      }
    });

    /** The Anchor `anchorId` names when it is of `kind`; a Kept Reference of that kind passes too; otherwise an issue at `path`. */
    const checkAnchor = (anchorId: string, kind: (typeof blueprint.anchors)[number]["kind"], path: (string | number)[], keptToo = true) => {
      const anchor = blueprint.anchors.find((candidate) => candidate.id === anchorId);
      if (anchor?.kind === kind) return anchor;
      if (keptToo && blueprint.kept.some((reference) => reference.id === anchorId && reference.kind === kind)) return undefined;
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown ${kind} anchor id: ${anchorId}`, path });
      return undefined;
    };
    const checkKeptTrigger = (triggerId: string, path: (string | number)[]): void => {
      if (blueprint.kept.some((reference) => reference.id === triggerId && reference.kind === "trigger")) return;
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown Kept trigger id: ${triggerId} (declare it in kept, with kind trigger)`, path });
    };
    const checkUnitAnchor = (anchorId: string, path: (string | number)[]): void => {
      checkAnchor(anchorId, "unit", path);
    };
    /** A unit Anchor whose unit must be there from map start, so not a Wave's unit, which comes later or never. */
    const checkPlacedUnitAnchor = (anchorId: string, path: (string | number)[], why: string): void => {
      checkUnitAnchor(anchorId, path);
      const bound = waveUnits.get(anchorId);
      if (bound) context.addIssue({ code: z.ZodIssueCode.custom, message: `${anchorId} is Wave ${bound.wave.id}'s unit, which isn't there until its send creates it: ${why}`, path });
    };
    /** The difficulties on which a condition never comes: one on a Wave's unit with a count of 0 there. */
    const neverOn = (condition: { readonly type: string; readonly anchorId?: string }): number[] => {
      const bound = condition.anchorId === undefined ? undefined : waveUnits.get(condition.anchorId);
      return bound ? [0, 1, 2, 3].filter((difficulty) => waveUnitCounts(bound.unit.count)[difficulty] === 0) : [];
    };
    /**
     * Conditions that must come on every difficulty (a goal, a Beat's or an encounter's start) can't
     * all wait on a Wave's unit with a count of 0 on one, which never comes there: the issue goes on
     * the first, at `paths[0]`.
     */
    const checkComesEverywhere = (conditions: readonly { readonly type: string; readonly anchorId?: string }[], paths: (string | number)[][]): void => {
      if (conditions.length === 0) return;
      const missing = conditions.map(neverOn).reduce((left, right) => left.filter((difficulty) => right.includes(difficulty)));
      if (missing.length === 0) return;
      const anchorId = conditions[0]!.anchorId!;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${anchorId} is Wave ${waveUnits.get(anchorId)!.wave.id}'s unit, which never comes on ${missing.map((difficulty) => DIFFICULTY_NAMES[difficulty]).join(", ")} (a count of 0), so this would never come there`,
        path: [...paths[0]!, "anchorId"],
      });
    };

    // A reveal's point is a point Anchor; a Kept point's position isn't known, so it needs a radius.
    blueprint.beats.forEach((beat, beatIndex) =>
      beat.reveals.forEach((reveal, revealIndex) => {
        if (typeof reveal === "string") return;
        const path = ["beats", beatIndex, "reveals", revealIndex];
        if (reveal.region && (reveal.at !== undefined || reveal.radius !== undefined)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "A reveal of the Zone's whole region takes no at or radius", path: [...path, "region"] });
        }
        if (reveal.at === undefined) return;
        const anchor = checkAnchor(reveal.at, "point", [...path, "at"]);
        if (anchor && anchor.zoneId !== reveal.zoneId) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `${reveal.at} is in Zone ${anchor.zoneId}: a reveal's point sits in the Zone it reveals (${reveal.zoneId})`, path: [...path, "at"] });
        }
        if (!anchor && reveal.radius === undefined && blueprint.kept.some((reference) => reference.id === reveal.at)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `${reveal.at} is a Kept point, whose position the Blueprint doesn't know: give the reveal a radius`, path: [...path, "radius"] });
        }
      }),
    );

    // A Kept region stands in for a Zone where a condition names one, in a Blueprint with Kept
    // terrain: the layout checks, which run over Zones, don't run there.
    const keptRegionIds = new Set(blueprint.kept.flatMap((reference) => (reference.kind === "region" ? [reference.id] : [])));
    const checkConditionZone = (zoneId: string, path: (string | number)[]): void => {
      if (!keptRegionIds.has(zoneId)) return checkZone(zoneId, path);
      if (blueprint.zones.length > 0 && named === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${zoneId} is a Kept region: one stands in for a Zone only in a Blueprint with Kept terrain, whose layout isn't checked`, path });
      }
    };
    const checkZone = (zoneId: string, path: (string | number)[]): void => {
      if (!zoneIds.has(zoneId)) {
        context.addIssue(unknownIdIssue("zones", zoneId, path));
      }
    };
    // The Objectives an objectivesComplete names are the Blueprint's, and each is marked Completed by its own completeWhen.
    const checkObjectivesComplete = (condition: { readonly objectiveIds: readonly string[]; readonly count?: number | undefined; readonly exactly?: true | undefined }, path: (string | number)[]): void => {
      const issue = (message: string, at: (string | number)[]): void => context.addIssue({ code: z.ZodIssueCode.custom, message, path: at });
      condition.objectiveIds.forEach((objectiveId, index) => {
        const objective = blueprint.objectives.find((candidate) => candidate.id === objectiveId);
        const at = [...path, "objectiveIds", index];
        if (!objective) issue(`Unknown objective id: ${objectiveId}`, at);
        else if (!objective.completeWhen) issue(`Objective ${objectiveId} has no completeWhen, so nothing marks it Completed and this would never hold: give it one`, at);
        if (condition.objectiveIds.indexOf(objectiveId) !== index) issue(`Duplicate objective id: ${objectiveId}`, at);
      });
      if (condition.exactly && condition.count !== undefined) issue("exactly is the Objectives named, all of them, so it takes no count: drop it", [...path, "count"]);
      if (condition.count !== undefined && condition.count > condition.objectiveIds.length) {
        issue(`count ${condition.count} is more than the ${condition.objectiveIds.length} objectives named, so this would never hold`, [...path, "count"]);
      }
    };
    const checkCondition = (condition: z.infer<typeof OutcomeConditionSchema> | z.infer<typeof BeatStartSchema>, path: (string | number)[]): void => {
      if (condition.type === "timer" || condition.type === "resourceQuota") return;
      if (condition.type === "keptTriggerRuns") return checkKeptTrigger(condition.triggerId, [...path, "triggerId"]);
      if (condition.type === "objectivesComplete") return checkObjectivesComplete(condition, path);
      // A scene playing is checked against the script's cues in missionBlueprintSchema, which every
      // exported schema runs (this one isn't exported alone).
      if (condition.type === "scenePlays") return;
      // A Mechanic's moment is checked against the Mechanics' cues there too, with the cues that name one.
      if (condition.type === "mechanic") return;
      checkUnitAnchor(condition.anchorId, [...path, "anchorId"]);
      if (condition.type === "anchorEntersZone") checkConditionZone(condition.zoneId, [...path, "zoneId"]);
    };

    // A fromBeat names a Beat that starts in the map, by its trigger: the first starts with the
    // mission, so it would wait for nothing. A timer counts from mission start, so it can't wait.
    const checkFromBeat = (armed: { readonly type?: string; readonly fromBeat?: string | undefined }, path: (string | number)[]): void => {
      const beatId = armed.fromBeat;
      if (beatId === undefined) return;
      const at = [...path, "fromBeat"];
      const index = blueprint.beats.findIndex((beat) => beat.id === beatId);
      const issue = (message: string): void => context.addIssue({ code: z.ZodIssueCode.custom, message, path: at });
      if (armed.type === "timer") return issue("A timer counts down from mission start, so it can't wait for a Beat: drop fromBeat");
      if (armed.type === "objectivesComplete") return issue("Objectives complete as the mission goes, each armed from a Beat of its own (their fromBeat), so this takes no fromBeat: drop it");
      if (index < 0) return issue(`Unknown beat id: ${beatId}`);
      if (index === 0) return issue(`Beat ${beatId} starts with the mission, so this is armed from map start anyway: drop fromBeat`);
      if (!blueprint.beats[index]!.startsWhen) issue(`Beat ${beatId} has no startsWhen, so it never starts in the map and this would never be armed`);
    };

    blueprint.objectives.forEach((objective, objectiveIndex) => {
      if (objective.completeWhen?.type === "objectivesComplete") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Objective ${objective.id} would complete on other objectives completing: give it a condition of its own (the Objectives it waits for are a victory's or a Beat's)`, path: ["objectives", objectiveIndex, "completeWhen", "type"] });
        return;
      }
      if (objective.completeWhen) {
        checkFromBeat(objective.completeWhen, ["objectives", objectiveIndex, "completeWhen"]);
        checkCondition(objective.completeWhen, ["objectives", objectiveIndex, "completeWhen"]);
        checkComesEverywhere([objective.completeWhen], [["objectives", objectiveIndex, "completeWhen"]]);
      }
    });
    blueprint.beats.forEach((beat, beatIndex) => {
      if (beatIndex === 0 && beat.startsWhen) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The first beat starts with the mission", path: ["beats", 0, "startsWhen"] });
      }
      beat.startsWhen?.forEach((condition, conditionIndex) => checkCondition(condition, ["beats", beatIndex, "startsWhen", conditionIndex]));
      // A Beat starts on the first of its startsWhen, so it is stuck only where none can come.
      if (beat.startsWhen) checkComesEverywhere(beat.startsWhen, beat.startsWhen.map((_, conditionIndex) => ["beats", beatIndex, "startsWhen", conditionIndex]));
    });


    blueprint.encounters.forEach((encounter, encounterIndex) => {
      if (!zoneIds.has(encounter.triggerZoneId)) {
        context.addIssue(unknownIdIssue("zones", encounter.triggerZoneId, ["encounters", encounterIndex, "triggerZoneId"]));
      }
      checkFromBeat(encounter, ["encounters", encounterIndex]);
      if (encounter.startsWhen) {
        checkCondition(encounter.startsWhen, ["encounters", encounterIndex, "startsWhen"]);
        checkComesEverywhere([encounter.startsWhen], [["encounters", encounterIndex, "startsWhen"]]);
      }
      if (encounter.startsWhen && encounter.player !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Encounter ${encounter.id} starts on its startsWhen, so its player is never read: drop it`,
          path: ["encounters", encounterIndex, "player"],
        });
      }
      if (encounter.behavior) {
        checkPlacedUnitAnchor(encounter.behavior.anchorId, ["encounters", encounterIndex, "behavior", "anchorId"], "the encounter's start adds the Behavior to a unit that is there");
      }
      encounter.attackerAnchorIds.forEach((anchorId, anchorIdIndex) => {
        checkPlacedUnitAnchor(anchorId, ["encounters", encounterIndex, "attackerAnchorIds", anchorIdIndex], "a Wave's unit is the Wave's to send, not an encounter's attacker");
      });
    });

    const beatOrder = new Map(blueprint.beats.map((beat, index) => [beat.id, index]));
    blueprint.waves.forEach((wave, waveIndex) => {
      const path = ["waves", waveIndex];
      checkZone(wave.spawnZoneId, [...path, "spawnZoneId"]);
      wave.targetZoneIds.forEach((zoneId, index) => checkZone(zoneId, [...path, "targetZoneIds", index]));
      checkRepeats(wave.targetZoneIds, "target zone", (index) => [...path, "targetZoneIds", index]);
      // A plain Wave attacks one Zone; only a Raid picks among candidates (ADR 0008).
      if (wave.onlyIfPlayerHolds === undefined && wave.targetZoneIds.length > 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only a Raid (onlyIfPlayerHolds) may list more than one target zone",
          path: [...path, "targetZoneIds"],
        });
      }
      // A type may come once with every send and once more with the first, as an extra at its head.
      const listed = { every: new Set<string>(), first: new Set<string>() };
      wave.units.forEach((unit, index) => {
        if (listed[unit.sends].has(unit.type)) {
          const message = unit.sends === "every" ? `Duplicate unit type: ${unit.type}` : `Duplicate unit type on the first send: ${unit.type}`;
          context.addIssue({ code: z.ZodIssueCode.custom, message, path: [...path, "units", index, "type"] });
        }
        listed[unit.sends].add(unit.type);
      });
      // A unit that binds an Anchor comes once: one unit, from one send.
      wave.units.forEach((unit, index) => {
        if (unit.anchorId === undefined) return;
        const at = [...path, "units", index];
        const anchor = checkAnchor(unit.anchorId, "unit", [...at, "anchorId"], false);
        if (waveUnitCounts(unit.count).some((count) => count > 1)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "A unit that binds an Anchor comes once: give it a count of at most 1 on each difficulty", path: [...at, "count"] });
        }
        if (unit.sends === "every" && wave.intervalSeconds !== undefined) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'A unit that binds an Anchor comes once: give it sends: "first", or bind it in a Wave that sends once (no intervalSeconds)', path: [...at, "sends"] });
        }
        if (waveUnits.get(unit.anchorId)?.unit !== unit) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Another Wave unit binds ${unit.anchorId} already; an Anchor is one unit`, path: [...at, "anchorId"] });
        }
        // The compile leaves these Waves out of the map, so the Anchor's unit would never come.
        if (wave.arrival !== "ground") {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `A unit that binds an Anchor comes in a ground Wave: a Wave arriving by ${wave.arrival} isn't compiled yet, so ${unit.anchorId} would never come`, path: [...at, "anchorId"] });
        }
        const startBeat = beatOrder.get(wave.startsAtBeat);
        if (startBeat !== undefined && startBeat > 0 && blueprint.beats[startBeat]!.startsWhen === undefined) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `A unit that binds an Anchor comes in a Wave that starts in the map: beat ${wave.startsAtBeat} has no startsWhen, so ${unit.anchorId} would never come`, path: [...at, "anchorId"] });
        }
        if (!anchor) return;
        if (anchor.zoneId !== wave.spawnZoneId) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Anchor ${anchor.id} is in ${anchor.zoneId}; a Wave's unit's Anchor is in its spawn zone ${wave.spawnZoneId}`, path: [...at, "anchorId"] });
        }
        // Declared as any unit Anchor is, with the type and player the send creates it as.
        if (anchor.unitType !== unit.type) {
          const message = anchor.unitType === undefined ? `Anchor ${anchor.id} needs its unitType, ${unit.type}, as this unit's` : `Anchor ${anchor.id} is a ${anchor.unitType}, but this unit is a ${unit.type}`;
          context.addIssue({ code: z.ZodIssueCode.custom, message, path: [...at, "anchorId"] });
        }
        if (anchor.player === undefined || anchor.player < 2 || anchor.player > 14) {
          const message = anchor.player === undefined ? `Anchor ${anchor.id} needs its player, the Wave's computer player (2-14)` : `Anchor ${anchor.id} is player ${anchor.player}'s, but a Wave's units are a computer player's (2-14)`;
          context.addIssue({ code: z.ZodIssueCode.custom, message, path: [...at, "anchorId"] });
        }
      });
      wave.units.forEach((unit, index) => {
        if (waveUnitCounts(unit.count).every((count) => count === 0)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A wave's unit needs a count above 0 on some difficulty",
            path: [...path, "units", index, "count"],
          });
        }
      });
      // Its repeats would bring nobody.
      if (wave.intervalSeconds !== undefined && wave.units.every((unit) => unit.sends === "first")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A repeating wave needs a unit that comes with every send, not only sends: "first"',
          path: [...path, "intervalSeconds"],
        });
      }
      // A Wave spawns from a compiled point Anchor in its spawn Zone, not a Kept one.
      const anchor = wave.spawnAnchorId === undefined ? undefined : checkAnchor(wave.spawnAnchorId, "point", [...path, "spawnAnchorId"], false);
      if (anchor) {
        if (anchor.zoneId !== wave.spawnZoneId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Anchor ${anchor.id} is in ${anchor.zoneId}, not the wave's spawn zone ${wave.spawnZoneId}`,
            path: [...path, "spawnAnchorId"],
          });
        }
      }
      const transmission = wave.warning?.transmission;
      if (typeof transmission === "string" && !blueprint.screenplay.scenes.some((scene) => scene.id === transmission)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown scene id: ${transmission}`, path: [...path, "warning", "transmission"] });
      }
      if (typeof transmission === "number" && !blueprint.screenplay.script) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Script scene ${transmission} needs a screenplay script`,
          path: [...path, "warning", "transmission"],
        });
      }
      for (const key of ["startsAtBeat", "endsAtBeat"] as const) {
        const beatId = wave[key];
        if (beatId !== undefined && !beatIds.has(beatId)) {
          context.addIssue(unknownIdIssue("beats", beatId, [...path, key]));
        }
      }
      const starts = beatOrder.get(wave.startsAtBeat);
      const ends = wave.endsAtBeat === undefined ? undefined : beatOrder.get(wave.endsAtBeat);
      if (starts !== undefined && ends !== undefined && ends <= starts) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A wave must end at a later beat than it starts",
          path: [...path, "endsAtBeat"],
        });
      }
    });

    (["victory", "defeat"] as const).forEach((outcome) => {
      blueprint.outcomes[outcome].forEach((condition, conditionIndex) => {
        checkFromBeat(condition, ["outcomes", outcome, conditionIndex]);
        checkCondition(condition, ["outcomes", outcome, conditionIndex]);
      });
    });
    // Victory comes on any one of its conditions, so it only fails where none of them comes.
    checkComesEverywhere(blueprint.outcomes.victory, blueprint.outcomes.victory.map((_, conditionIndex) => ["outcomes", "victory", conditionIndex]));

    const script = blueprint.screenplay.script;
    if (script) {
      for (const [speaker, anchorId] of Object.entries(script.speakerAnchors)) {
        checkUnitAnchor(anchorId, ["screenplay", "script", "speakerAnchors", speaker]);
      }
      script.cues.forEach(({ cue }, cueIndex) => {
        const path = ["screenplay", "script", "cues", cueIndex, "cue"];
        if (cue.type === "anchorDies" || cue.type === "anchorEntersZone" || cue.type === "keptTriggerRuns" || cue.type === "objectivesComplete") checkCondition(cue, path);
        if (cue.type === "encounter" && !blueprint.encounters.some((encounter) => encounter.id === cue.encounterId)) {
          context.addIssue(unknownIdIssue("encounters", cue.encounterId, path));
        }
      });
    }

    // A held Kept trigger is run by another Kept trigger it names, and waits on a cue that can come.
    blueprint.kept.forEach((reference, index) => {
      if (!reference.hold) return;
      const path = ["kept", index, "hold"];
      const { from, until } = reference.hold;
      if (from === reference.id) context.addIssue({ code: z.ZodIssueCode.custom, message: `${reference.id} can't hold its own Run Trigger of itself: name the Kept trigger that runs it, or leave from out to hold its Map Initialization event`, path: [...path, "from"] });
      else if (from !== undefined) checkKeptTrigger(from, [...path, "from"]);
      if (until.type === "keptTriggerRuns" && until.triggerId === reference.id) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${reference.id} would wait on its own run, which the hold keeps from coming: cue it on something else`, path: [...path, "until", "triggerId"] });
      } else if (until.type === "anchorDies" || until.type === "anchorEntersZone" || until.type === "keptTriggerRuns") checkCondition(until, [...path, "until"]);
      if (until.type === "encounter" && !blueprint.encounters.some((encounter) => encounter.id === until.encounterId)) {
        context.addIssue(unknownIdIssue("encounters", until.encounterId, [...path, "until"]));
      }
    });

    // A unit nearing another names Anchors and one target; a unit starting an effect, a unit Anchor; an encounter's end names an encounter that declares one.
    for (const { cue, path } of blueprintCues(blueprint)) {
      if (cue.type === "anchorNears") {
        checkUnitAnchor(cue.anchorId, [...path, "anchorId"]);
        const byType = cue.unitType !== undefined || cue.player !== undefined;
        if (cue.targetId !== undefined && byType) context.addIssue({ code: z.ZodIssueCode.custom, message: "Give targetId, or unitType and player, not both", path });
        else if (cue.targetId === cue.anchorId) context.addIssue({ code: z.ZodIssueCode.custom, message: "An anchorNears cue's target is another unit than its Anchor's", path: [...path, "targetId"] });
        else if (cue.targetId !== undefined) checkUnitAnchor(cue.targetId, [...path, "targetId"]);
        else if (!byType) context.addIssue({ code: z.ZodIssueCode.custom, message: "An anchorNears cue names its target: targetId, or unitType and player", path });
        else if (cue.player === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "A unitType target needs its player", path: [...path, "player"] });
        else if (cue.unitType === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "A player target needs its unitType", path: [...path, "unitType"] });
      }
      if (cue.type === "effectStarts") checkUnitAnchor(cue.anchorId, [...path, "anchorId"]);
      if (cue.type === "cinematicBookmark" && !blueprint.screenplay.script?.cinematics.some((cinematic) => cinematic.id === cue.cinematicId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `A cinematicBookmark cue names ${cue.cinematicId}, which screenplay.script.cinematics doesn't list`, path: [...path, "cinematicId"] });
      }
      if (cue.type === "encounterEnds") {
        const encounter = blueprint.encounters.find((candidate) => candidate.id === cue.encounterId);
        if (!encounter) context.addIssue(unknownIdIssue("encounters", cue.encounterId, [...path, "encounterId"]));
        else if (!encounter.endsWhen && !encounter.behavior) context.addIssue({ code: z.ZodIssueCode.custom, message: `Encounter ${cue.encounterId} declares no end (endsWhen or behavior), so the cue would never fire`, path: [...path, "encounterId"] });
      }
    }

    const lightIds = new Set<string>();
    blueprint.lights.forEach((light, lightIndex) => {
      if (lightIds.has(light.id)) addDuplicateIssue(["lights", lightIndex, "id"], light.id);
      lightIds.add(light.id);
    });
    const pools = new Map<string, WaterPool>();
    blueprint.water.forEach((pool, poolIndex) => {
      const path = ["water", poolIndex];
      if (pools.has(pool.id)) addDuplicateIssue([...path, "id"], pool.id);
      pools.set(pool.id, pool);
      if (!zoneIds.has(pool.zoneId)) {
        context.addIssue(unknownIdIssue("zones", pool.zoneId, [...path, "zoneId"]));
      }
      (pool.rects ?? []).forEach((rect, rectIndex) => {
        if (rect[0] < 0 || rect[1] < 0 || rect[2] > blueprint.mapSize.width || rect[3] > blueprint.mapSize.height) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `[${rect.join(", ")}] runs off the ${blueprint.mapSize.width}×${blueprint.mapSize.height} map`, path: [...path, "rects", rectIndex] });
        }
      });
      const names = new Set<string>(["default"]);
      pool.states.forEach((state, stateIndex) => {
        if (names.has(state.name.toLowerCase())) addDuplicateIssue([...path, "states", stateIndex, "name"], state.name);
        names.add(state.name.toLowerCase());
      });
    });
    // An objectivesComplete cue anywhere (an inline scene's, a Kept hold's too; the others' are checked with their own).
    for (const { cue, path } of blueprintCues(blueprint)) {
      if (cue.type === "objectivesComplete" && path[0] !== "transitions" && path[0] !== "uiActions" && !(path[0] === "screenplay" && path[1] === "script")) checkCondition(cue, path);
    }
    // A transition's or UI action's cue: the condition it names, or an encounter the Blueprint has.
    const checkActionCue = (cue: Cue, at: (string | number)[]): void => {
      if (cue.type === "anchorDies" || cue.type === "anchorEntersZone" || cue.type === "keptTriggerRuns" || cue.type === "objectivesComplete") checkCondition(cue, at);
      if (cue.type === "encounter" && !blueprint.encounters.some((encounter) => encounter.id === cue.encounterId)) {
        context.addIssue(unknownIdIssue("encounters", cue.encounterId, at));
      }
    };
    const uiActionIds = new Set<string>();
    blueprint.uiActions.forEach((action, index) => {
      const path = ["uiActions", index];
      if (uiActionIds.has(action.id)) addDuplicateIssue([...path, "id"], action.id);
      uiActionIds.add(action.id);
      checkActionCue(action.cue, [...path, "cue"]);
    });
    const transitionIds = new Set<string>();
    blueprint.transitions.forEach((transition, transitionIndex) => {
      const path = ["transitions", transitionIndex];
      if (transitionIds.has(transition.id)) addDuplicateIssue([...path, "id"], transition.id);
      transitionIds.add(transition.id);
      if (transition.beatId !== undefined && !beatIds.has(transition.beatId)) {
        context.addIssue(unknownIdIssue("beats", transition.beatId, [...path, "beatId"]));
      }
      checkActionCue(transition.cue, [...path, "cue"]);
      const water = transition.water;
      if (water) {
        const pool = pools.get(water.poolId);
        if (!pool) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown water pool: ${water.poolId}`, path: [...path, "water", "poolId"] });
        } else if (water.state !== "default" && !pool.states.some((state) => state.name === water.state)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Pool ${pool.id} has no state ${water.state}`,
            path: [...path, "water", "state"],
          });
        }
      }
    });

    blueprint.screenplay.scenes.forEach((scene, sceneIndex) => {
      if (scene.beatId !== undefined && !beatIds.has(scene.beatId)) {
        context.addIssue(unknownIdIssue("beats", scene.beatId, ["screenplay", "scenes", sceneIndex, "beatId"]));
      }

      if (scene.cue?.type === "anchorDies" || scene.cue?.type === "anchorEntersZone" || scene.cue?.type === "keptTriggerRuns") {
        checkCondition(scene.cue, ["screenplay", "scenes", sceneIndex, "cue"]);
      }
      const cue = scene.cue;
      if (cue?.type === "encounter" && !blueprint.encounters.some((encounter) => encounter.id === cue.encounterId)) {
        context.addIssue(unknownIdIssue("encounters", cue.encounterId, ["screenplay", "scenes", sceneIndex, "cue", "encounterId"]));
      }
      scene.lines.forEach((line, lineIndex) => {
        const path = ["screenplay", "scenes", sceneIndex, "lines", lineIndex, "speakerAnchorId"];
        if (line.speakerAnchorId !== undefined && line.speakerUnitType !== undefined) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Give speakerAnchorId or speakerUnitType, not both", path });
        } else if (line.speakerAnchorId !== undefined) {
          checkUnitAnchor(line.speakerAnchorId, path);
        } else if (cue !== undefined && line.speakerUnitType === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Lines in a cued scene need a speakerAnchorId or speakerUnitType (the transmission's source)",
            path,
          });
        }
      });

      const lineIds = scene.lines.map((line) => line.id);
      checkRepeats(lineIds, "id", (index) => ["screenplay", "scenes", sceneIndex, "lines", index, "id"]);
    });
  });

export type MissionBlueprint = z.infer<typeof CoreBlueprintSchema>;

type Anchor = MissionBlueprint["anchors"][number];
type WaveUnit = MissionBlueprint["waves"][number]["units"][number];

/**
 * The unit Anchors Waves' units bind (a unit entry's `anchorId`), each with its Wave and entry,
 * the first entry that names it. Such an Anchor has no position: nothing is placed for it, and its
 * unit is none until the send creates it, so it may come late or never (a count of 0, or a Raid
 * whose sends are all skipped).
 */
export function waveUnitAnchors(blueprint: { readonly waves: readonly MissionBlueprint["waves"][number][] }): ReadonlyMap<string, WaveUnitAnchor> {
  const bound = new Map<string, WaveUnitAnchor>();
  for (const wave of blueprint.waves) for (const unit of wave.units) if (unit.anchorId !== undefined && !bound.has(unit.anchorId)) bound.set(unit.anchorId, { wave, unit });
  return bound;
}
type WaveUnitAnchor = { readonly wave: MissionBlueprint["waves"][number]; readonly unit: WaveUnit };

/** An Anchor the compile places on the map: every Anchor but a Wave's unit's (waveUnitAnchors), which has no position. */
export type PlacedAnchor = Anchor & { readonly position: NonNullable<Anchor["position"]> };
export const isPlaced = <A extends { readonly position?: unknown }>(anchor: A): anchor is A & { readonly position: NonNullable<A["position"]> } => anchor.position !== undefined;

/**
 * Whether the Mission has Kept terrain (ADR-0010): a Blueprint with no Zones, as Import writes it,
 * every cell Kept, or one whose Zones each say whether they generate their ground or are drawn over
 * Kept ground. Its Map Package keeps its own terrain, map info and triggers, but for the cells
 * generating Zones write.
 */
export function hasKeptTerrain(blueprint: { readonly zones: readonly { readonly terrain?: "generate" | "kept" | undefined }[] }): boolean {
  return blueprint.zones.length === 0 || blueprint.zones.some((zone) => zone.terrain !== undefined);
}

/** The Zones that generate their ground beside Kept ground (`terrain: "generate"`); none for a Mission without Kept terrain. */
export function generatingZones<Zone extends { readonly terrain?: "generate" | "kept" | undefined }>(blueprint: { readonly zones: readonly Zone[] }): Zone[] {
  return blueprint.zones.filter((zone) => zone.terrain === "generate");
}

/** The most different textures a map may use, across all its texture sets (the Editor's limit). */
export const MAX_MAP_TEXTURES = 16;

/**
 * Issues in `textureSets` (ADR-0016): a generated map a multiple of 8 cells each way, unique ids, each Zone a generating one (every Zone, on a
 * generated map) in one set at most, no texture twice in a set, and a set's Zone painted with one of its textures.
 */
function checkTextureSets(
  blueprint: { readonly textureSets?: readonly TextureSet[] | undefined; readonly zones: readonly z.infer<typeof ZoneSchema>[]; readonly mapSize: { readonly width: number; readonly height: number } },
  keptTerrain: boolean,
  context: z.RefinementCtx,
): void {
  const sets = blueprint.textureSets;
  if (!sets?.length) return;
  // A set covers 8×8-cell blocks; beside Kept ground the package's own size is checked when it's read.
  const { width, height } = blueprint.mapSize;
  if (!keptTerrain && (width % 8 !== 0 || height % 8 !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: textureSetMapSizeMessage(width, height), path: ["textureSets"] });
  }
  const inSet = new Map<string, string>();
  const ids = new Set<string>();
  sets.forEach((set, setIndex) => {
    if (ids.has(set.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate id: ${set.id}`, path: ["textureSets", setIndex, "id"] });
    ids.add(set.id);
    const seen = new Set<string>();
    set.textures.forEach((texture, textureIndex) => {
      if (seen.has(texture)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${texture} is in the set twice: a set holds each texture once`, path: ["textureSets", setIndex, "textures", textureIndex] });
      seen.add(texture);
    });
    if (set.zones.length === 0 && !set.levels) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Texture set ${set.id} paints no Zone: give it zones, levels or both`, path: ["textureSets", setIndex] });
    }
    checkZoneList(blueprint.zones, keptTerrain, set.zones, ["textureSets", setIndex, "zones"], "is painted from a texture set", context, (zone, path) => {
      const other = inSet.get(zone.id);
      if (other !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${zone.id} is in texture set ${other} already: a Zone is painted from one set`, path });
        return;
      }
      inSet.set(zone.id, set.id);
      checkSetZone(set, zone, keptTerrain, path, context);
    });
    if (set.palette && keptTerrain) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Texture set ${set.id}'s palette paints a fully generated map only: beside Kept ground give each of its Zones a texture`, path: ["textureSets", setIndex, "palette"] });
    } else if (set.palette) checkSetPalette(set, set.palette, ["textureSets", setIndex, "palette"], context);
  });
  // Levels after every list, which win over them: each level in one set, and checked against the
  // Zones textureSetOfZone, the compile's rule, gives each set by level.
  const generating = blueprint.zones.filter((zone) => (keptTerrain ? zone.terrain === "generate" : true));
  const setOfZone = textureSetOfZone(sets, generating);
  const setOfLevel = new Map<number, string>();
  sets.forEach((set, setIndex) => {
    set.levels?.forEach((level, levelIndex) => {
      const path = ["textureSets", setIndex, "levels", levelIndex];
      const other = setOfLevel.get(level);
      if (other !== undefined) {
        const message = other === set.id ? `Level ${level} is listed twice in texture set ${set.id}'s levels` : `Level ${level} is in texture set ${other}'s levels already: a level is painted from one set`;
        context.addIssue({ code: z.ZodIssueCode.custom, message, path });
        return;
      }
      setOfLevel.set(level, set.id);
      const atLevel = generating.filter((zone) => zone.elevation === level);
      // The Zones the level gives the set: those no list names.
      const taken = atLevel.filter((zone) => !inSet.has(zone.id) && setOfZone.get(zone.id) === setIndex);
      if (atLevel.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: `No generating Zone is at level ${level}`, path });
      else if (taken.length === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Every Zone at level ${level} is named by a set's zones (${atLevel.map((zone) => zone.id).join(", ")}), so the level gives texture set ${set.id} none`, path });
      }
      for (const zone of taken) checkSetZone(set, zone, keptTerrain, path, context);
    });
  });
}

/**
 * Issues in `paintRegions` (ADR-0028) the Blueprint alone can tell: a polygon inside the map, a
 * known Zone (a generating one, beside Kept ground), each mix's amounts at most 1 together, one
 * texture at most without an amount, and each texture once. Repeated ids are checkIds'. The
 * textures against the sets the regions' cells are on are checkPaintRegionTextures', which needs the Catalog.
 */
function checkPaintRegions(
  blueprint: Pick<z.infer<typeof CoreBlueprintSchema>, "paintRegions" | "zones" | "mapSize">,
  keptTerrain: boolean,
  context: z.RefinementCtx,
): void {
  const { width, height } = blueprint.mapSize;
  blueprint.paintRegions?.forEach((region, regionIndex) => {
    const path = ["paintRegions", regionIndex];
    const off = region.polygon?.findIndex((point) => point.x < 0 || point.y < 0 || point.x > width || point.y > height) ?? -1;
    if (off >= 0) {
      const { x, y } = region.polygon![off]!;
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Paint Region ${region.id}'s point (${x}, ${y}) is off the ${width}×${height} map`, path: [...path, "polygon", off] });
    }
    if (region.zone !== undefined) {
      const zone = blueprint.zones.find((candidate) => candidate.id === region.zone);
      if (!zone) context.addIssue(unknownIdIssue("zones", region.zone, [...path, "zone"]));
      else if (keptTerrain && zone.terrain !== "generate") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${zone.id} is drawn over Kept ground: only a generating Zone ("terrain": "generate") is painted by a Paint Region`, path: [...path, "zone"] });
      }
    }
    const amounts = region.mix.reduce((sum, entry) => sum + (entry.weight ?? entry.share ?? 0), 0);
    // A little slack for decimals that don't add up exactly in binary (0.1 + 0.2 + 0.7).
    if (amounts > 1 + 1e-9) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Paint Region ${region.id}'s blend weights and area shares add up to ${Number(amounts.toFixed(3))}: together they're at most 1`, path: [...path, "mix"] });
    }
    let rest: string | undefined;
    const seen = new Set<string>();
    region.mix.forEach((entry, entryIndex) => {
      const at = [...path, "mix", entryIndex];
      if (seen.has(entry.texture)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${entry.texture} is in Paint Region ${region.id}'s mix twice: list each texture once`, path: at });
      seen.add(entry.texture);
      if (entry.weight !== undefined || entry.share !== undefined) return;
      if (rest === undefined) rest = entry.texture;
      else context.addIssue({ code: z.ZodIssueCode.custom, message: `Paint Region ${region.id}'s ${rest} already takes what the weights and shares leave: give ${entry.texture} a weight or a share`, path: at });
    });
  });
}

/**
 * Issues in `paintRegions`' textures (ADR-0028): each one held by every texture set the region's
 * cells are on, naming the set and its textures. A region's cells are those whose centre its outline
 * holds, at its `levels` (its cell's Zone's level). A cell's Zone is the last listed whose polygon
 * holds its centre. Its set:
 * - on a fully generated map, its 8×8 block's (blockSet), set 0 the map's textures (missionTextures);
 * - beside Kept ground, its Zone's texture set when it's a generating Zone in one. A generating Zone
 *   in no set is on whatever set the package has its blocks on, which the compile checks, and a
 *   Kept Zone's cells, or a cell no Zone holds, aren't painted at all.
 */
function checkPaintRegionTextures(blueprint: Pick<z.infer<typeof CoreBlueprintSchema>, "paintRegions" | "mapSize" | "zones" | "textureSets" | "tilesetId" | "textures" | "texturePalette">, catalog: Catalog, context: z.RefinementCtx): void {
  const regions = blueprint.paintRegions ?? [];
  if (regions.length === 0) return;
  const { width, height } = blueprint.mapSize;
  const keptTerrain = hasKeptTerrain(blueprint);
  const sets = blueprint.textureSets ?? [];
  const setOfZone = textureSetOfZone(sets, keptTerrain ? blueprint.zones.filter((zone) => zone.terrain === "generate") : blueprint.zones);
  // Set 0, then each of textureSets by its place (1 the first).
  const setTextures = [missionTextures(catalog, blueprint).filter((name) => name !== ""), ...sets.map((set) => set.textures)];
  const setLabel = (set: number) => (set === 0 ? "the map's textures (set 0), which don't" : `texture set ${sets[set - 1]!.id}, which doesn't`);
  // Each cell's Zone: its index, NO_ZONE for none, worked out (from UNREAD) as a cell is asked for.
  const [UNREAD, NO_ZONE] = [-2, -1];
  const owners = new Int16Array(width * height).fill(UNREAD);
  const ownerOf = (x: number, y: number): number => {
    const cell = y * width + x;
    if (owners[cell] === UNREAD) owners[cell] = blueprint.zones.findLastIndex((zone) => containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 }));
    return owners[cell]!;
  };
  // A Zone's own set (0 for none, else its place in textureSets plus 1), as generatedTextureSets numbers them.
  // A Zone's own set: 0 for none, else its place in textureSets plus 1, as generatedTextureSets numbers them.
  const zoneSet = (owner: number): number => (owner === NO_ZONE ? 0 : (setOfZone.get(blueprint.zones[owner]!.id) ?? -1) + 1);
  const blocksPerRow = Math.ceil(width / CELLS_PER_BLOCK);
  const blockSets = new Map<number, number>();
  const generatedSet = (x: number, y: number): number => {
    if (sets.length === 0) return 0;
    const block = blockOf(blocksPerRow, x, y);
    let set = blockSets.get(block);
    if (set === undefined) {
      const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
      const covered: number[] = [];
      for (let cy = by; cy < Math.min(height, by + CELLS_PER_BLOCK); cy++) {
        for (let cx = bx; cx < Math.min(width, bx + CELLS_PER_BLOCK); cx++) if (ownerOf(cx, cy) !== NO_ZONE) covered.push(zoneSet(ownerOf(cx, cy)));
      }
      blockSets.set(block, (set = blockSet(covered, sets.length + 1)));
    }
    return set;
  };
  // A cell's set, or undefined where the Blueprint can't tell or the region doesn't paint.
  const cellSet = (x: number, y: number): number | undefined => {
    if (!keptTerrain) return generatedSet(x, y);
    const owner = ownerOf(x, y);
    if (owner === NO_ZONE || blueprint.zones[owner]!.terrain !== "generate") return undefined;
    const set = zoneSet(owner);
    return set === 0 ? undefined : set;
  };
  regions.forEach((region, regionIndex) => {
    const outline = region.polygon ?? blueprint.zones.find((zone) => zone.id === region.zone)?.polygon;
    if (!outline) return;
    const xs = outline.map((point) => point.x);
    const ys = outline.map((point) => point.y);
    const onSets = new Set<number>();
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
        if (!containsPoint(outline, { x: x + 0.5, y: y + 0.5 })) continue;
        if (region.levels) {
          const owner = ownerOf(x, y);
          if (owner === NO_ZONE || !region.levels.includes(blueprint.zones[owner]!.elevation)) continue;
        }
        const set = cellSet(x, y);
        if (set !== undefined) onSets.add(set);
      }
    }
    region.mix.forEach((entry, entryIndex) => {
      for (const set of [...onSets].sort((a, b) => a - b)) {
        if (setTextures[set]!.includes(entry.texture)) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Paint Region ${region.id} paints cells on ${setLabel(set)} hold ${entry.texture}: ${setTextures[set]!.join(", ")}`,
          path: ["paintRegions", regionIndex, "mix", entryIndex, "texture"],
        });
      }
    });
  });
}

/** Issues in a set's Zone: its own texture one of the set's, and, under the set's palette, a built Zone given a texture. */
function checkSetZone(set: TextureSet, zone: z.infer<typeof ZoneSchema>, keptTerrain: boolean, path: (string | number)[], context: z.RefinementCtx): void {
  if (zone.texture !== undefined && !set.textures.includes(zone.texture)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${zone.id}'s texture ${zone.texture} isn't one of texture set ${set.id}'s: ${set.textures.join(", ")}`, path });
  } else if (set.palette && !keptTerrain && zone.texture === undefined && zone.surface === "built" && set.palette.built === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${zone.id} is built: texture set ${set.id}'s palette needs its built texture, or the Zone its own`, path });
  }
}

/** Issues in a set's palette: every texture one of the set's. */
function checkSetPalette(set: TextureSet, palette: TextureSetPalette, path: (string | number)[], context: z.RefinementCtx): void {
  for (const name of paletteTextures(palette)) {
    if (!set.textures.includes(name)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Palette texture ${name} isn't one of texture set ${set.id}'s: ${set.textures.join(", ")}`, path });
  }
}

/**
 * Issues in a `zones` list of `textureSets` or `cliffSets`: a pattern that matches no generating Zone,
 * an unknown id, or a Zone drawn over Kept ground (only a generating Zone `doesWhat`). `found` is
 * called with each generating Zone the list names, and the entry's path.
 */
function checkZoneList<Zone extends { readonly id: string; readonly terrain?: "generate" | "kept" | undefined }>(
  zones: readonly Zone[],
  keptTerrain: boolean,
  entries: readonly string[],
  at: (string | number)[],
  doesWhat: string,
  context: z.RefinementCtx,
  found: (zone: Zone, path: (string | number)[]) => void,
): void {
  // On a generated map every Zone generates its ground; beside Kept ground those that say so.
  const generates = (zone: Zone) => (keptTerrain ? zone.terrain === "generate" : true);
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  entries.forEach((entry, entryIndex) => {
    const path = [...at, entryIndex];
    const pattern = zonePattern(entry);
    const ids = pattern ? zones.filter((zone) => generates(zone) && pattern.test(zone.id)).map((zone) => zone.id) : [entry];
    if (pattern && ids.length === 0) return context.addIssue({ code: z.ZodIssueCode.custom, message: `${entry} matches no generating Zone`, path });
    for (const id of ids) {
      const zone = byId.get(id);
      if (!zone) context.addIssue(unknownIdIssue("zones", id, path));
      else if (!generates(zone)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${id} is drawn over Kept ground: only a generating Zone ("terrain": "generate") ${doesWhat}`, path });
      else found(zone, path);
    }
  });
}

/** Issues in `cliffSets`: each entry a generating Zone or a pattern matching one, and each Zone in one group at most. */
function checkCliffSets(
  blueprint: {
    readonly cliffSets?: readonly CliffSetGroup[] | undefined;
    readonly cliffPalette?: z.infer<typeof CliffPaletteSchema> | undefined;
    readonly zones: readonly z.infer<typeof ZoneSchema>[];
  },
  keptTerrain: boolean,
  context: z.RefinementCtx,
): void {
  // The sets sure to be written on a generated map: the palette's natural, each group's and each Zone's
  // own (the palette's built and pit only where a cliff wears them, which the compile counts).
  const named = new Set([blueprint.cliffPalette?.natural, ...(blueprint.cliffSets ?? []).map((group) => group.cliffSet), ...blueprint.zones.map((zone) => zone.cliff)].filter((name) => name !== undefined));
  if (!keptTerrain && named.size > MAX_MAP_CLIFF_SETS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `The Blueprint names ${named.size} cliff sets (${[...named].join(", ")}), and a map can use at most ${MAX_MAP_CLIFF_SETS}`, path: ["cliffSets"] });
  }
  const inGroup = new Map<string, number>();
  blueprint.cliffSets?.forEach((group, groupIndex) => {
    checkZoneList(blueprint.zones, keptTerrain, group.zones, ["cliffSets", groupIndex, "zones"], "has its cliffs chosen by a cliffSets group", context, (zone, path) => {
      const other = inGroup.get(zone.id);
      if (other !== undefined && other !== groupIndex) context.addIssue({ code: z.ZodIssueCode.custom, message: `Zone ${zone.id} is in cliffSets.${other} already: a Zone's cliffs wear one group's set`, path });
      else inGroup.set(zone.id, groupIndex);
    });
  });
}

/** Why a map that isn't a multiple of 8 cells each way can't have texture sets. */
export const textureSetMapSizeMessage = (width: number, height: number): string =>
  `Texture sets go on 8×8-cell blocks, and the map is ${width}×${height} cells: make it a multiple of 8 each way`;

/** A `textureSets[].zones` entry with `*` as a pattern over Zone ids (`*` any run of characters), else undefined. */
function zonePattern(entry: string): RegExp | undefined {
  if (!entry.includes("*")) return undefined;
  return new RegExp(`^${entry.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/**
 * The generating Zones a `zones` list names (a texture set's, a `cliffSets` group's): each entry an
 * id, or a pattern with `*` (`"factory-*"`) matching every Zone not marked Kept whose id fits, so the
 * list follows a relayout. On a generated map every Zone generates (none says `terrain`).
 */
export function listedZoneIds(list: { readonly zones: readonly string[] }, zones: readonly { readonly id: string; readonly terrain?: "generate" | "kept" | undefined }[]): string[] {
  const ids = new Set<string>();
  for (const entry of list.zones) {
    const pattern = zonePattern(entry);
    if (!pattern) ids.add(entry);
    else for (const zone of zones) if (zone.terrain !== "kept" && pattern.test(zone.id)) ids.add(zone.id);
  }
  return [...ids];
}

/**
 * Each generating Zone a texture set paints, with the set's index in `sets`: first the Zones each
 * set's `zones` names (ids and patterns, as listedZoneIds; the schema refuses a Zone in two lists),
 * then each Zone left whose `elevation` is one of a set's `levels`. So a Zone named by id keeps its
 * set wherever its level's ground goes, as the exit shelf of a cave keeps the surface's look.
 */
export function textureSetOfZone(
  sets: readonly Pick<TextureSet, "zones" | "levels">[],
  zones: readonly { readonly id: string; readonly elevation: number; readonly terrain?: "generate" | "kept" | undefined }[],
): Map<string, number> {
  const of = new Map<string, number>();
  sets.forEach((set, index) => {
    for (const id of listedZoneIds(set, zones)) if (!of.has(id)) of.set(id, index);
  });
  sets.forEach((set, index) => {
    if (set.levels) for (const zone of zones) if (zone.terrain !== "kept" && !of.has(zone.id) && set.levels.includes(zone.elevation)) of.set(zone.id, index);
  });
  return of;
}

/** Core's schema with the tileset and tech units checked against `catalog`, each where core checks the rest. */
const coreSchemaWith = (catalog: Catalog) =>
  CoreBlueprintSchema.safeExtend({
    tilesetId: z
      .string()
      .min(1)
      .superRefine((id, context) => {
        if (!isKnownTileset(catalog, id)) context.addIssue({ code: "custom", message: `Unknown tileset ${id} (data/texture-extracted.json${layerSource(catalog)})` });
      })
      .optional(),
    tech: z.array(playerTechSchema(catalog)).default([]),
    cliffSets: z
      .array(
        CliffSetGroupSchema.superRefine((group, context) => {
          if (!isKnownCliffSet(catalog, group.cliffSet)) context.addIssue({ code: "custom", message: `Cliff set ${group.cliffSet} isn't a known cliff set (data/cliff-extracted.json${layerSource(catalog)})`, path: ["cliffSet"] });
        }),
      )
      .optional(),
    textureSets: z
      .array(
        TextureSetSchema.superRefine((set, context) => {
          // The name is the tileset whose CTerrain override lists the set's textures: one the game (or the Campaign Mod) has.
          if (set.name !== undefined && !isKnownTileset(catalog, set.name)) context.addIssue({ code: "custom", message: `Unknown tileset ${set.name} (data/texture-extracted.json${layerSource(catalog)}): a set's name is the tileset its textures are listed under`, path: ["name"] });
          set.textures.forEach((texture, index) => {
            if (!isKnownTexture(catalog, texture)) context.addIssue({ code: "custom", message: `${texture} isn't a terrain texture the game has (data/texture-extracted.json${layerSource(catalog)})`, path: ["textures", index] });
          });
        }),
      )
      .optional(),
  });
/** Each Catalog's core schema, built once. */
const coreSchemas = new WeakMap<Catalog, ReturnType<typeof coreSchemaWith>>();
function coreSchemaFor(catalog: Catalog): ReturnType<typeof coreSchemaWith> {
  let schema = coreSchemas.get(catalog);
  if (!schema) coreSchemas.set(catalog, (schema = coreSchemaWith(catalog)));
  return schema;
}

/**
 * The Mission Blueprint schema for a set of loaded Plugins and a Catalog: core's strict schema, with
 * each `mechanics[]` entry validated against the Mechanic that provides its type, and its tileset
 * and tech units against `catalog` (the game's entries alone unless given). Core provides no
 * Mechanic types itself, so a type no loaded Plugin provides fails. Each parsed Blueprint is bound
 * to `plugins` and `catalog`, so it is compiled and checked with the Plugins and Catalog it was
 * validated against (see `blueprintPlugins`, `blueprintCatalog`).
 */
export function missionBlueprintSchema(plugins: PluginRegistry, catalog: Catalog = EMPTY_CATALOG) {
  return coreSchemaFor(catalog).superRefine((blueprint, context) => {
    // A `single` Mechanic's second and later entries are refused where they stand, and not validated further.
    const firstOfType = new Map<string, number>();
    // One context for every entry's validate hook, and the Mechanic types present, for `requires`.
    const shared = mechanicContext(blueprint, catalog, plugins);
    const types = new Set(blueprint.mechanics.map((entry) => entry.type));
    // The cues each entry's params reach (its Mechanic's cuesOf), by entry id, for the moments' check below.
    const reachedCues = new Map<string, readonly string[]>();
    blueprint.mechanics.forEach((entry, mechanicIndex) => {
      const path = ["mechanics", mechanicIndex];
      const first = firstOfType.get(entry.type);
      if (first === undefined) firstOfType.set(entry.type, mechanicIndex);
      else if (plugins.mechanic(entry.type)?.single) {
        context.addIssue({ code: "custom", message: `At most one ${entry.type} mechanic: mechanics.${first} is already one`, path: [...path, "type"] });
        return;
      }
      const mechanic = plugins.mechanic(entry.type);
      if (!mechanic) {
        const known = plugins.contributions("mechanics").map((candidate) => candidate.type);
        context.addIssue({
          code: "custom",
          message: `Unknown Mechanic type ${entry.type}: no Plugin the Workspace loads provides it (known types: ${known.length > 0 ? known.join(", ") : "none"})`,
          path: [...path, "type"],
        });
        return;
      }
      for (const required of mechanic.requires ?? []) {
        if (!types.has(required)) context.addIssue({ code: "custom", message: `A ${entry.type} mechanic needs the ${required} mechanic`, path });
      }
      const label = mechanicLabel(plugins, entry, mechanicIndex);
      const parsed = runHook(label, "paramsSchema", () => mechanic.paramsSchema.safeParse(entry.params));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: [...path, "params", ...issue.path] });
        return;
      }
      if (mechanic.cuesOf) {
        const reached: unknown = runHook(label, "cuesOf hook", () => mechanic.cuesOf!(parsed.data));
        const declared = mechanic.cues ?? [];
        if (!Array.isArray(reached) || reached.some((name) => typeof name !== "string")) throw new Error(`${label}: its cuesOf hook returned ${JSON.stringify(reached)}, not a list of cue names`);
        const stray = reached.find((name) => !declared.includes(name));
        if (stray !== undefined) throw new Error(`${label}: its cuesOf hook returned ${stray}, which isn't one of its cues (${declared.length > 0 ? declared.join(", ") : "none"})`);
        reachedCues.set(entry.id, reached);
      }
      for (const issue of runHook(label, "validate hook", () => mechanic.validate?.(parsed.data, { ...shared, mechanicId: entry.id }) ?? [])) {
        context.addIssue({ code: "custom", message: issue.message, path: [...path, "params", ...issue.path] });
      }
    });
    // A Paint Region's textures are in the sets its cells are on, set 0's from the Catalog's tileset.
    checkPaintRegionTextures(blueprint, catalog, context);
    // A Light of the Mission's own can't share an id with a Plugin's: the map holds one CLight by each id.
    blueprint.lights.forEach((light, lightIndex) => {
      const contributed = plugins.light(light.id);
      if (contributed) context.addIssue({ code: "custom", message: `Plugin ${contributed.plugin} contributes a Light ${light.id} too; rename this one`, path: ["lights", lightIndex, "id"] });
    });
    // A cue on a Beat's start names a Beat that something starts.
    for (const { cue, path } of blueprintCues(blueprint)) {
      if (cue.type !== "beatStarts") continue;
      const beat = blueprint.beats.find((candidate) => candidate.id === cue.beatId);
      if (!beat) context.addIssue(unknownIdIssue("beats", cue.beatId, [...path, "beatId"]));
      else if (beat === blueprint.beats[0]) context.addIssue({ code: "custom", message: `Beat ${cue.beatId} is the first, which starts with the mission; cue missionStart instead`, path: [...path, "beatId"] });
      else if (!beat.startsWhen) context.addIssue({ code: "custom", message: `Beat ${cue.beatId} has no startsWhen, so nothing starts it and the cue would never fire`, path: [...path, "beatId"] });
    }
    // A cue on a scene having played, or a Beat start on one playing, names a scene and part some cue
    // entry plays, and no entries or Beats wait only on each other in a loop.
    const entries = blueprint.screenplay.script?.cues ?? [];
    const key = scenePlayedKey;
    const namingScenes: { readonly part: ScenePart; readonly path: (string | number)[]; readonly what: string; readonly never: string }[] = [
      ...blueprintCues(blueprint).flatMap(({ cue, path }) => (cue.type === "scenePlayed" ? [{ part: cue, path, what: "A scenePlayed cue", never: "this cue would never fire" }] : [])),
      ...blueprint.beats.flatMap((beat, beatIndex) =>
        (beat.startsWhen ?? []).flatMap((condition, conditionIndex) =>
          condition.type === "scenePlays" ? [{ part: condition, path: ["beats", beatIndex, "startsWhen", conditionIndex], what: "A scenePlays start", never: `Beat ${beat.id} would never start on it` }] : [],
        ),
      ),
    ];
    entries.forEach((entry, index) => {
      if (entry.after) namingScenes.push({ part: entry.after, path: ["screenplay", "script", "cues", index, "after"], what: "An after", never: "the entry after it would never play" });
    });
    for (const { part, path, what, never } of namingScenes) {
      const issues = scenePartIssues(part, `${what} names a part (from) or a line, not both`);
      for (const issue of issues) context.addIssue({ code: "custom", message: issue.message, path: [...path, issue.field] });
      if (issues.length === 0 && !entries.some((entry) => key(entry) === key(part))) {
        context.addIssue({ code: "custom", message: `${scenePlayedName(part)} has no cue of its own, so it never plays and ${never}; cue it in screenplay.script.cues`, path });
      }
    }
    // A scene plays once one of its entries can, and a Beat starts once one of its starts can. An
    // entry can once its cue can fire and the entry it plays `after` (if any) can play: a cue on a
    // scene having played waits on that scene, a beatStarts cue on its Beat, and anything else
    // fires. A Beat's scenePlays waits on its scene, and any other start fires. Those left over
    // wait on a scene with no cue or a Beat nothing starts (reported above), or in a loop.
    const nodes = [
      ...entries.map((entry) => ({ key: key(entry), needs: [cueWaitsOn(entry.cue), entry.after && key(entry.after)].filter((need) => need !== undefined) })),
      ...blueprint.beats.flatMap((beat) => (beat.startsWhen ?? []).map((condition) => ({ key: beatStartKey(beat.id), needs: condition.type === "scenePlays" ? [key(condition)] : [] }))),
    ];
    const plays = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const { key: waiting, needs } of nodes) {
        if (!plays.has(waiting) && needs.every((need) => plays.has(need))) {
          plays.add(waiting);
          grew = true;
        }
      }
    }
    // What each scene or Beat left over waits on that is left over too, and which of those waits are a cue's (the rest are an after's).
    const waitsOn = new Map<string, Set<string>>();
    const cueWaits = new Set<string>();
    for (const { key: waiting, needs } of nodes) {
      if (plays.has(waiting)) continue;
      for (const need of needs) if (!plays.has(need)) waitsOn.set(waiting, (waitsOn.get(waiting) ?? new Set()).add(need));
    }
    for (const entry of entries) {
      const on = cueWaitsOn(entry.cue);
      if (on !== undefined) cueWaits.add(`${key(entry)}\n${on}`);
    }
    for (const beat of blueprint.beats) for (const condition of beat.startsWhen ?? []) if (condition.type === "scenePlays") cueWaits.add(`${beatStartKey(beat.id)}\n${key(condition)}`);
    const reported = new Set<string>();
    entries.forEach((entry, index) => {
      const firsts = [
        { first: cueWaitsOn(entry.cue), field: "cue" },
        { first: entry.after && key(entry.after), field: "after" },
      ];
      for (const { first, field } of firsts) {
        if (first === undefined || plays.has(key(entry)) || reported.has(key(entry))) continue;
        const cycle = cycleFrom(key(entry), first, waitsOn);
        if (!cycle) continue;
        for (const waiting of cycle) reported.add(waiting);
        const loop = [...cycle, cycle[0]!];
        const chain = loop
          .slice(1)
          .map((on, at) => `${at === 0 ? "" : "which "}${waitText(loop[at]!, on, at === 0, !cueWaits.has(`${loop[at]!}\n${on}`))}`)
          .join(", ");
        context.addIssue({ code: "custom", message: `${playedKeyName(loop[0]!)} ${chain}: a cycle, so none of them plays`, path: ["screenplay", "script", "cues", index, field] });
      }
    });
    // An entry with skipIfLate drops Transmissions that one entry plays, and some entry after it,
    // directly or down a chain of afters, can reach its cue before it has played.
    entries.forEach((entry, index) => {
      if (!entry.skipIfLate) return;
      const path = ["screenplay", "script", "cues", index, "skipIfLate"];
      const name = scenePlayedName(entry);
      const staged = blueprint.screenplay.script?.cinematics.some((cinematic) => cinematic.scene === entry.scene)
        ? "a Cinematic"
        : blueprint.screenplay.script?.triggerScenes.some((triggerScene) => triggerScene.scene === entry.scene)
          ? "a trigger scene"
          : undefined;
      if (staged) context.addIssue({ code: "custom", message: `Scene ${entry.scene} plays as ${staged}, which skipIfLate doesn't drop: it drops Transmissions; drop skipIfLate`, path });
      const own = key(entry);
      const several = entries.filter((candidate) => key(candidate) === own).length;
      if (several > 1) context.addIssue({ code: "custom", message: `skipIfLate drops ${name}, which ${several} cue entries play: cue it once`, path });
      // The entries after it, and what can only come once it has played: a scene whose every entry
      // is cued on or plays after such a thing, or a Beat that only such scenes playing start.
      const later = new Set<string>([own]);
      const overtakers: (typeof entries)[number][] = [];
      for (let grew = true; grew; ) {
        grew = false;
        for (const candidate of entries) {
          if (candidate.after && later.has(key(candidate.after)) && !overtakers.includes(candidate)) {
            overtakers.push(candidate);
            later.add(key(candidate));
            grew = true;
          }
        }
      }
      if (overtakers.length === 0) {
        context.addIssue({ code: "custom", message: `${name}'s skipIfLate never applies: no entry plays after it; drop skipIfLate or give a later entry an after on it`, path });
        return;
      }
      const onceItHasPlayed = new Set<string>([own]);
      const waitsOnIt = (waits: string | undefined): boolean => waits !== undefined && onceItHasPlayed.has(waits);
      for (let grew = true; grew; ) {
        grew = false;
        for (const scene of new Set(entries.map(key))) {
          if (!onceItHasPlayed.has(scene) && entries.filter((candidate) => key(candidate) === scene).every((candidate) => waitsOnIt(cueWaitsOn(candidate.cue)) || waitsOnIt(candidate.after && key(candidate.after)))) {
            onceItHasPlayed.add(scene);
            grew = true;
          }
        }
        for (const beat of blueprint.beats) {
          const starts = beat.startsWhen ?? [];
          if (!onceItHasPlayed.has(beatStartKey(beat.id)) && starts.length > 0 && starts.every((condition) => condition.type === "scenePlays" && onceItHasPlayed.has(key(condition)))) {
            onceItHasPlayed.add(beatStartKey(beat.id));
            grew = true;
          }
        }
      }
      // On the entry's own cue, an undelayed entry plays in cue order on the cue's thread: one listed
      // after it, undelayed, reaches the cue once it has begun (if it isn't waiting on an after of its
      // own); one listed before it, or while it counts down a delay, reaches it first every time.
      const sameCue = (overtaker: (typeof entries)[number]): boolean => overtaker.afterSeconds === undefined && JSON.stringify(overtaker.cue) === JSON.stringify(entry.cue);
      const inPlace = entry.afterSeconds === undefined && entry.after === undefined;
      const first = overtakers.find((overtaker) => sameCue(overtaker) && (entry.afterSeconds !== undefined || entries.indexOf(overtaker) < index));
      if (first) {
        context.addIssue({ code: "custom", message: `${name}'s skipIfLate always applies, so it never plays: ${scenePlayedName(first)} reaches the same cue first; drop skipIfLate or cue them apart`, path });
      } else if (overtakers.every((overtaker) => waitsOnIt(cueWaitsOn(overtaker.cue)) || (inPlace && sameCue(overtaker) && entries.indexOf(overtaker) > index))) {
        context.addIssue({ code: "custom", message: `${name}'s skipIfLate never applies: every entry after it is cued only once it has played, or comes after it on the same cue; drop skipIfLate`, path });
      }
    });
    // A unit nearing a unit type, or a structure type dying, names a unit type the Catalog knows; a dying one, a structure.
    for (const { cue, path } of blueprintCues(blueprint)) {
      if ((cue.type !== "anchorNears" && cue.type !== "structureDies") || cue.unitType === undefined) continue;
      const unit = techUnit(catalog, cue.unitType);
      if (!unit) context.addIssue({ code: "custom", message: `Unknown unit type: ${cue.unitType} (data/tech-catalog.json${layerSource(catalog)})`, path: [...path, "unitType"] });
      else if (cue.type === "structureDies" && !unit.structure) context.addIssue({ code: "custom", message: `${cue.unitType} isn't a structure; cue on an Anchor's death (anchorDies) instead`, path: [...path, "unitType"] });
    }
    // A cue or a Beat's start at a Mechanic's moment names an entry whose Mechanic declares that
    // cue, and one its params let it reach (`cuesOf`).
    for (const { moment: cue, path } of mechanicMoments(blueprint)) {
      const entry = blueprint.mechanics.find((candidate) => candidate.id === cue.mechanicId);
      if (!entry) {
        context.addIssue(unknownIdIssue("mechanics", cue.mechanicId, [...path, "mechanicId"]));
        continue;
      }
      const mechanic = plugins.mechanic(entry.type);
      // An entry of an unknown type has its own issue already.
      const cues = mechanic?.cues ?? [];
      if (mechanic && !cues.includes(cue.cue)) {
        context.addIssue({
          code: "custom",
          message: `Mechanic ${entry.id} (type ${entry.type}) has no cue ${cue.cue} (its cues: ${cues.length > 0 ? cues.join(", ") : "none"})`,
          path: [...path, "cue"],
        });
        continue;
      }
      // From the entry's params, above; none when it has no cuesOf, or params that don't parse (their own issue).
      const reached = reachedCues.get(entry.id);
      if (reached && !reached.includes(cue.cue)) {
        context.addIssue({
          code: "custom",
          message: `Mechanic ${entry.id} (type ${entry.type}) never reaches its cue ${cue.cue} with these params (it reaches: ${reached.length > 0 ? reached.join(", ") : "none"})`,
          path: [...path, "cue"],
        });
      }
    }
  }).transform((blueprint) => bindPlugins(bindCatalog(blueprint, withDoodads(catalog, blueprint.doodads)), plugins));
}

/**
 * A script scene, with `from` its part from that stage direction, or with `line` that one line (a
 * sound ID), as a cue entry plays it or a scenePlayed cue names it.
 */
export type ScenePart = { readonly scene: number; readonly from?: string | undefined; readonly line?: string | undefined };
/**
 * A scene part as one string: `7`, `7/S07>4`, or `7#<sound ID>` for a line. One for each spelling of
 * a stage direction (`S7>4` is `S07>4`).
 */
export const scenePlayedKey = ({ scene, from, line }: ScenePart): string => (from !== undefined ? `${scene}/${canonicalAddress(from)}` : line !== undefined ? `${scene}#${line}` : `${scene}`);
const parseScenePlayedKey = (key: string): ScenePart => {
  const [, scene, mark, rest] = /^(\d+)(?:([/#])(.*))?$/.exec(key)!;
  return { scene: Number(scene), ...(mark === "/" ? { from: rest } : mark === "#" ? { line: rest } : {}) };
};
/**
 * Whether a script cue entry plays from a trigger of its own, apart from the run of scenes its cue
 * plays back to back: after a delay (`afterSeconds`), or behind another entry (`after`). It hands
 * nothing on and isn't handed on to, so it hands back.
 */
export const playsAlone = (entry: { readonly afterSeconds?: number | undefined; readonly after?: ScenePart | undefined }): boolean => entry.afterSeconds !== undefined || entry.after !== undefined;
/** "Scene 7 S07>4", "Scene 7 <sound ID>" for a line, or "Scene 7" for the whole scene; "scene 7 ..." mid-sentence. */
export const scenePlayedName = ({ scene, from, line }: ScenePart, word: "Scene" | "scene" = "Scene"): string =>
  `${word} ${scene}${from !== undefined ? ` ${from}` : line !== undefined ? ` ${line}` : ""}`;
/** A Beat as a node of the waits between scenes and Beats, beside scene parts' keys. */
const BEAT_KEY = "beat:";
const beatStartKey = (beatId: string): string => `${BEAT_KEY}${beatId}`;
/** The Beat a key names, if it names a Beat rather than a scene part. */
const keyBeatId = (key: string): string | undefined => (key.startsWith(BEAT_KEY) ? key.slice(BEAT_KEY.length) : undefined);
/** What a script cue waits on before it can fire: a scene having played, a Beat starting, or nothing. */
const cueWaitsOn = (cue: Cue): string | undefined => (cue.type === "scenePlayed" ? scenePlayedKey(cue) : cue.type === "beatStarts" ? beatStartKey(cue.beatId) : undefined);
/** "Beat <id>", or a scene part's name. */
const playedKeyName = (key: string, word: "Scene" | "scene" = "Scene"): string => {
  const beatId = keyBeatId(key);
  return beatId !== undefined ? `Beat ${beatId}` : scenePlayedName(parseScenePlayedKey(key), word);
};
/** How `waiting` waits on `on` in a cycle's message; `first` spells out the first wait on a scene, and `behind` is an entry's `after`. */
const waitText = (waiting: string, on: string, first: boolean, behind = false): string => {
  if (behind) return `plays after ${playedKeyName(on, "scene")}`;
  if (keyBeatId(on) !== undefined) return `waits on ${playedKeyName(on)} starting`;
  if (keyBeatId(waiting) !== undefined) return `starts as ${playedKeyName(on, "scene")} plays`;
  return `waits on ${playedKeyName(on, "scene")}${first ? " having played" : ""}`;
};
/** The keys of a cycle of waits from `start` through `first` and back to `start`, in order, if there is one. */
function cycleFrom(start: string, first: string, waitsOn: ReadonlyMap<string, ReadonlySet<string>>): string[] | undefined {
  const seen = new Set<string>([first]);
  const walk = (key: string, trail: string[]): string[] | undefined => {
    if (key === start) return trail.slice(0, -1);
    for (const next of waitsOn.get(key) ?? []) {
      if (seen.has(next) && next !== start) continue;
      seen.add(next);
      const found = walk(next, [...trail, next]);
      if (found) return found;
    }
    return undefined;
  };
  return walk(first, [start, first]);
}

/** Every cue in the Blueprint (script cues, transitions, uiActions, scenes, Kept holds), with its path: the one list of cued elements, which what reacts to cues walks. */
export function blueprintCues(blueprint: MissionBlueprint): { readonly cue: Cue; readonly path: (string | number)[] }[] {
  return [
    ...(blueprint.screenplay.script?.cues ?? []).map(({ cue }, index) => ({ cue, path: ["screenplay", "script", "cues", index, "cue"] })),
    ...blueprint.transitions.map((transition, index) => ({ cue: transition.cue, path: ["transitions", index, "cue"] })),
    ...blueprint.uiActions.map((action, index) => ({ cue: action.cue, path: ["uiActions", index, "cue"] })),
    ...blueprint.screenplay.scenes.flatMap((scene, index) => (scene.cue ? [{ cue: scene.cue, path: ["screenplay", "scenes", index, "cue"] }] : [])),
    ...blueprint.kept.flatMap((reference, index) => (reference.hold ? [{ cue: reference.hold.until, path: ["kept", index, "hold", "until"] }] : [])),
  ];
}

/** A Mechanic's moment as a cue or a Beat's start names it. */
export type MechanicMoment = { readonly type: "mechanic"; readonly mechanicId: string; readonly cue: string };

/**
 * Every place the Blueprint names a Mechanic's moment, with its path: the cues at one (as
 * blueprintCues gives them), then the Beat starts on one (`beats.N.startsWhen.M`).
 */
export function mechanicMoments(blueprint: MissionBlueprint): { readonly moment: MechanicMoment; readonly path: (string | number)[] }[] {
  const named: { readonly moment: { readonly type: string }; readonly path: (string | number)[] }[] = [
    ...blueprintCues(blueprint).map(({ cue, path }) => ({ moment: cue, path })),
    ...blueprint.beats.flatMap((beat, beatIndex) => (beat.startsWhen ?? []).map((condition, conditionIndex) => ({ moment: condition, path: ["beats", beatIndex, "startsWhen", conditionIndex] }))),
  ];
  return named.flatMap(({ moment, path }) => (isMoment(moment) ? [{ moment, path }] : []));
}

const isMoment = (named: { readonly type: string }): named is MechanicMoment => named.type === "mechanic";

/** Whether a cue or Beat start names entry `mechanicId`'s moment `cue` (any of its moments, without one). */
export const isMomentOf = (named: { readonly type: string }, mechanicId: string, cue?: string): named is MechanicMoment =>
  isMoment(named) && named.mechanicId === mechanicId && (cue === undefined || named.cue === cue);

/** The schema with core alone; a Blueprint whose Mechanics come from Plugins needs `missionBlueprintSchema`. */
export const MissionBlueprintSchema = missionBlueprintSchema(EMPTY_REGISTRY);
export type OutcomeCondition = z.infer<typeof OutcomeConditionSchema>;
export type Cue = z.infer<typeof CueSchema>;
