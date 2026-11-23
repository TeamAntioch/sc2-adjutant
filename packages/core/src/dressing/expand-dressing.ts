// Expands a blueprint's dressing into placed doodads at compile time: cliff feet first, then
// shores, edge lines and each set piece around its centre. Every doodad is placed from its own
// seed (its set piece or pile, type and index), so editing one set piece, or adding a type to it,
// leaves everything else where it was; review feedback can then change one thing at a time.
//
// - What a pile holds, how doodads turn, the default scales, how lips clump, a broken run's wear
//   and advice on Composites are the active Style Pack's rules (`StyleRuleSlots`). Without one,
//   each falls back to plain dressing: one piece per pile, free turns, scale 1, even lines.
// - A pile is tinted to its cliff; a built cliff takes the built pile.
// - A set piece stays on its centre's cliff level, off ramps and cliff cells, and away from
//   connection crossing points (`at`) so it doesn't block a route.
// - Members that find no room after a few tries are dropped, not forced, and each such member is
//   reported with how many of its count landed. A `nestle`d member skips only the spacing from
//   other doodads (the Editor's "ignore placement"); a member's `yaw` turns its front that way, by
//   the doodad's measured front (doodad-facings.json) or a composite's; `against: "wall"` backs it
//   onto the nearest wall instead, front to the room, standing off the wall as measured.
// - Hand edits synced back from the Editor (`edits`, `added`) apply last, by id, so they never
//   move another doodad; an edit whose doodad no longer exists is reported.

import { getComposite } from "../catalog/composites.js";
import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { randomVariations } from "./decal-variations.js";
import { type DoodadFacing } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { bundledDoodadFacings, bundledSheetReadings, compositeFrontFrom, getDoodadFacing, rotationToFace, getDoodad } from "../catalog/stock-catalog.js";
import { getDoodadDescription } from "../catalog/mod-doodad-index.js";
import { getCliffSetKind } from "../catalog/tileset-cliff-sets.js";
import { hidesLowestLevel } from "../catalog/tileset-sky.js";
import {
  type CliffPile,
  type DoodadEdit,
  type DressingMember,
  type EdgeLine,
  type MissionBlueprint,
  type SetPieceMember,
  type SetPieceParams,
  SetPieceParamsSchema,
} from "../domain/mission-blueprint.js";
import { stableObjectId } from "../map/stable-object-id.js";
import { inPool, poolRect, poolRects, underWater } from "../map/write-water.js";
import { blueprintPlugins, type ChoosePieces, type StampedComposite, type StyleRuleSlots } from "../plugins/plugin-api.js";
import { raggedAmplitude } from "../terrain/ragged-outlines.js";
import { containsPoint, type TerrainRasterizationResult, terrainHeightAt } from "../terrain/rasterize.js";
import { walkedGround } from "./walked-ground.js";

/** One doodad the dressing places. */
export type PlacedDoodad = {
  /** Stable across recompiles: `<set piece or "cliffs/<cell>">/<type>/<index>`. */
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  /** Radians. */
  readonly rotation: number;
  readonly pitch?: number;
  readonly roll?: number;
  /** Uniform, or [x, y, z] after a hand edit. */
  readonly scale: number | readonly [number, number, number];
  readonly variation: number;
  /** "r,g,b", as the Editor writes TintColor. */
  readonly tint?: string;
  /** Absolute height: the terrain's here or a natural pile's cliff foot, plus any hand `heightOffset`. */
  readonly z: number;
  /** Cells above where the compiler would stand it, from a hand edit. */
  readonly heightOffset?: number;
  /** The Editor's "ignore placement": a natural pile's pieces pushed into the cliff, or set by hand. */
  readonly forcePlacement?: boolean;
  /** The set piece it belongs to, or undefined for cliff dressing. */
  readonly setPieceId?: string;
  /** Other Editor flags set on it: NoDoodadFootprint on a composite's member. */
  readonly flags?: readonly string[];
  /** A set piece's ring it was placed in, or `added` for one added by hand; undefined for other dressing. */
  readonly ring?: "anchor" | "props" | "clutter" | "added";
  /** The member's, added doodad's or edit's `pathing` (DoodadPathingSchema). */
  readonly pathing?: "block" | "walk";
};

/** The id of a set piece's `n`th hand-added doodad. */
export const addedDoodadId = (setPieceId: string, n: number): string => `${setPieceId}/added/${n}`;

/** A set piece's centre and reach, for its named region and the preview. */
export type PlacedSetPiece = { readonly id: string; readonly x: number; readonly y: number; readonly radius: number };

const DEFAULT_COUNT = { anchor: 1, props: 3, clutter: 6 } as const;
const DENSITY = { sparse: 0.5, normal: 1, dense: 2 } as const;
/** Cells kept clear round a connection's crossing point, and round ramps. */
const CROSSING_CLEARANCE = 4;
const RAMP_CLEARANCE = 3;
const TRIES = 8;
/** The group of shore lights, which take no room. */
const LIGHTS = "shores/lights";
/** The group of the doodads already standing (`standing`), which the dressing keeps clear of and doesn't return. */
const STANDING = "standing/";
const UNIT_SCALE = [1, 1] as const;
/** Cells between the points sampled along a wall's foot for wall-backed members. */
const WALL_STEP = 0.5;

/** Deterministic 0..1 from a key. */
const random = (key: string): number => (stableObjectId(key) % 100000) / 100000;
/** One of `variations`, from its own key. */
const pickVariation = (key: string, variations: readonly number[]): number => variations[Math.floor(random(key) * variations.length)]!;
const pick = (members: readonly DressingMember[], key: string): DressingMember => members[Math.floor(random(key) * members.length)]!;
/** A pile's chooser for the Style Pack's rules: each piece picked from its own key, `<pile key>#<role>#<index>`. */
const chooser =
  (pile: CliffPile, key: string): ChoosePieces =>
  (role, count) =>
    pile[role].length === 0 ? [] : Array.from({ length: count }, (_, index) => ({ role, member: pick(pile[role], `${key}#${role}#${index}`), index }));

/** Plain dressing, for the slots the Style Pack's rules leave empty. */
const PLAIN: Required<Pick<StyleRuleSlots, "yaw" | "pileScale" | "lipScale" | "cliffPile" | "shorePile" | "breakWear">> = {
  yaw: ({ turn }) => turn,
  pileScale: { large: UNIT_SCALE, small: UNIT_SCALE, ground: UNIT_SCALE, accent: UNIT_SCALE },
  lipScale: UNIT_SCALE,
  // One large piece at the foot, off the wall.
  cliffPile: ({ choose }) => ({ snug: false, pieces: choose("large", 1).map((piece) => ({ ...piece, along: 1.5, outward: { base: 0, reach: 0.6 } })) }),
  shorePile: ({ choose }) => ({ pieces: choose("large", 1).map((piece) => ({ ...piece, reach: 0.6 })) }),
  breakWear: { capsPerEnd: 1, capScale: UNIT_SCALE, maxDebris: 1, debrisScale: UNIT_SCALE },
};

/** Smooth 0..1 value noise over the map, for clumping. */
function valueNoise(x: number, y: number, seed: string): number {
  const [ix, iy] = [Math.floor(x), Math.floor(y)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  const [fx, fy] = [ease(x - ix), ease(y - iy)];
  const at = (cx: number, cy: number) => random(`${seed}#${cx}_${cy}`);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Minimum distance (cells) between a doodad's centre and another's, by size. */
const SPACING: Record<string, number> = { tiny: 0.6, small: 1, medium: 2, large: 3.5, huge: 5 };

/** Radians in [0, 2π). */
const wrapAngle = (angle: number): number => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** Degrees to radians in [0, 2π). */
const radians = (degrees: number): number => ((((degrees * Math.PI) / 180) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const typeOf = (member: DressingMember): string => (typeof member === "string" ? member : member.type);
const memberOf = (member: DressingMember) => (typeof member === "string" ? { type: member } : member);
/** The object without its undefined fields. */
const defined = <T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

/** A doodad already standing that the dressing keeps clear of, as it does of its own: a Kept doodad beside a generating Zone. */
export type StandingDoodad = { readonly type: string; readonly x: number; readonly y: number; readonly scale: number };

export function expandDressing(
  blueprint: MissionBlueprint,
  terrain: TerrainRasterizationResult,
  { standing = [], crossings = [] }: { readonly standing?: readonly StandingDoodad[]; readonly crossings?: readonly { readonly x: number; readonly y: number }[] } = {},
): { doodads: PlacedDoodad[]; setPieces: PlacedSetPiece[]; warnings: string[] } {
  const { width, height } = blueprint.mapSize;
  // A Blueprint made in code has no Plugins bound: it gets core alone, so it is dressed plainly.
  const rules = { ...PLAIN, ...blueprintPlugins(blueprint).styleRules() };
  // The doodads and tileset of the Catalog it was validated against.
  const catalog = blueprintCatalog(blueprint);
  const level = (x: number, y: number): number => terrain.syncCliff[Math.floor(y) * width + Math.floor(x)]!;
  const isRampCell = (cell: number): boolean => terrain.syncCliff[cell]! % 64 !== 0;

  // Cells nothing may stand on: ramps and their surroundings, cliff cells, crossing points.
  const blocked = new Uint8Array(width * height);
  const clear = (cx: number, cy: number, reach: number): void => {
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(height - 1, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(width - 1, Math.ceil(cx + reach)); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= reach) blocked[y * width + x] = 1;
      }
    }
  };
  for (let cell = 0; cell < width * height; cell++) {
    if (isRampCell(cell)) clear((cell % width) + 0.5, Math.floor(cell / width) + 0.5, RAMP_CLEARANCE);
  }
  for (const zone of blueprint.zones) for (const connection of zone.connections) if (connection.at) clear(connection.at.x, connection.at.y, CROSSING_CLEARANCE);
  // Crossings the Blueprint given doesn't hold (a generating Zone's into Kept ground).
  for (const crossing of crossings) clear(crossing.x, crossing.y, CROSSING_CLEARANCE);
  // A hidden lowest level is open sky: nothing stands on it, not even a pile against its cliff.
  const hidden = hidesLowestLevel(catalog, blueprint);
  if (hidden) for (let cell = 0; cell < width * height; cell++) if (terrain.syncCliff[cell] === 0) blocked[cell] = 1;
  // Where shore dressing may stand: in the water's edge and shallows too, but off cliffs.
  const blockedShore = Uint8Array.from(blocked);
  for (let cell = 0; cell < width * height; cell++) if (terrain.cellFlags[cell]! & 0x01) blockedShore[cell] = 1;
  // Nor under a pool's surface.
  const wet = underWater(blueprint, terrain);
  for (let cell = 0; cell < width * height; cell++) if (wet[cell]) blocked[cell] = 1;
  // Ramps and crossings alone (what a pile pushed against a cliff must still keep clear of).
  const blockedRoute = Uint8Array.from(blocked);
  for (let cell = 0; cell < width * height; cell++) if (terrain.cellFlags[cell]! & 0x01) blocked[cell] = 1;

  const placed: (Omit<PlacedDoodad, "z"> & { z?: number; group: string })[] = [];
  // Doodads already there take their room first; they are taken out again before the dressing is returned.
  for (const [index, doodad] of standing.entries()) placed.push({ id: `${STANDING}${index}`, type: doodad.type, x: doodad.x, y: doodad.y, rotation: 0, scale: doodad.scale, variation: 0, group: STANDING });
  const spacingOf = (type: string, scale: PlacedDoodad["scale"]): number =>
    (SPACING[getDoodadDescription(catalog, type)?.size ?? "small"] ?? 1) * (typeof scale === "number" ? scale : Math.max(...scale));
  /**
   * Ground a doodad may stand on: on the map, unblocked and on the level. `againstCliff` lets it
   * onto cliff cells (the Editor's "ignore placement"), still off ramps and crossings.
   */
  const standable = (x: number, y: number, onLevel: number | undefined, againstCliff = false, mask: Uint8Array = againstCliff ? blockedRoute : blocked): boolean => {
    if (x < 0.5 || y < 0.5 || x > width - 0.5 || y > height - 0.5) return false;
    if (mask[Math.floor(y) * width + Math.floor(x)]) return false;
    return againstCliff || onLevel === undefined || level(x, y) === onLevel;
  };
  /** Room for a doodad here: standable, and apart from other groups' doodads (a pile's own members may heap). */
  const fits = (
    type: string,
    scale: number,
    group: string,
    x: number,
    y: number,
    onLevel: number | undefined,
    piled: boolean,
    againstCliff = false,
    mask: Uint8Array = againstCliff ? blockedRoute : blocked,
  ): boolean => {
    if (!standable(x, y, onLevel, againstCliff, mask)) return false;
    const own = spacingOf(type, scale);
    return placed.every((other) =>
      (piled && other.group === group) || other.group === LIGHTS ? true : Math.hypot(other.x - x, other.y - y) >= Math.max(own, spacingOf(other.type, other.scale)) * 0.8,
    );
  };
  /** One warning per doodad a member names variations of that it lacks. */
  const unknownVariations = new Set<string>();
  /**
   * The variations to pick a member's copies from: those it (or its edge line) names that the
   * doodad has, else those randomVariations allows. A named variation the doodad lacks is reported.
   */
  const variationsFor = (member: DressingMember, type: string, named = memberOf(member).variations): number[] => {
    if (!named) return randomVariations(catalog, type);
    const count = getDoodad(catalog, type)?.variations ?? 1;
    const lacking = named.filter((variation) => variation >= count);
    if (lacking.length > 0) unknownVariations.add(`${type} has ${count} variation${count === 1 ? "" : "s"} (0-${count - 1}), not ${lacking.join(", ")}; those are left out.`);
    const known = named.filter((variation) => variation < count);
    return known.length > 0 ? known : randomVariations(catalog, type);
  };
  const place = (
    id: string,
    member: DressingMember,
    x: number,
    y: number,
    scale: number,
    group: string,
    tint: string | undefined,
    setPieceId: string | undefined,
    z?: number,
    forcePlacement?: boolean,
    /** A fixed facing in radians, taken as it is instead of the Style Pack's turn. */
    yaw?: number,
    /** A set piece's ring it's placed in. */
    ring?: "anchor" | "props" | "clutter",
  ): void => {
    const type = typeOf(member);
    const description = getDoodadDescription(catalog, type);
    const rotation = yaw ?? rules.yaw({ turn: random(`${id}#yaw`) * 2 * Math.PI, built: description?.kind === "built" });
    const variations = variationsFor(member, type);
    const ownTint = memberOf(member).tint ?? tint;
    placed.push({
      id,
      type,
      x,
      y,
      rotation,
      scale,
      variation: pickVariation(`${id}#variation`, variations),
      group,
      ...(ownTint ? { tint: ownTint } : {}),
      ...(setPieceId ? { setPieceId } : {}),
      ...(z !== undefined ? { z } : {}),
      ...(forcePlacement ? { forcePlacement } : {}),
      ...(ring ? { ring } : {}),
      ...(typeof member === "object" && "pathing" in member && member.pathing ? { pathing: member.pathing as "block" | "walk" } : {}),
    });
  };
  const scaleFor = (id: string, member: DressingMember, fallback: readonly [number, number]): number => {
    const [low, high] = memberOf(member).scale ?? fallback;
    return Math.round((low + random(`${id}#scale`) * (high - low)) * 100) / 100;
  };
  // Piles at cliff feet, first.
  const cliffs = blueprint.dressing?.cliffs;
  if (cliffs) {
    const columns = width / 2;
    for (const cliff of terrain.cliffCells) {
      if (cliff.flags !== 1) continue;
      const key = `cliffs/${cliff.index}`;
      if (random(key) >= 2 / cliffs.spacing) continue;
      const kind = getCliffSetKind(terrain.cliffSets[cliff.cliffSet ?? 0] ?? "");
      const pile: CliffPile | undefined = kind === "built" ? (cliffs.built ?? cliffs.natural) : (cliffs.natural ?? cliffs.built);
      if (!pile) continue;
      // The foot: the lowest flat cell beside this 2×2 cliff cell, and the way out from the cliff.
      const cx = (cliff.index % columns) * 2;
      const cy = Math.floor(cliff.index / columns) * 2;
      let foot: { x: number; y: number } | undefined;
      let lowest = Infinity;
      let dropsToVoid = false;
      for (const [dx, dy] of [[-1, 0.5], [2, 0.5], [0.5, -1], [0.5, 2], [-1, 1.5], [2, 1.5], [1.5, -1], [1.5, 2]] as const) {
        const x = cx + dx + 0.5;
        const y = cy + dy + 0.5;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const value = level(x, y);
        if (hidden && value === 0) dropsToVoid = true;
        // Off every cliff: a neighbouring cliff cell's low row counts as low ground but stands up the slope.
        if (value < lowest && value % 64 === 0 && !(terrain.cellFlags[Math.floor(y) * width + Math.floor(x)]! & 0x01)) {
          lowest = value;
          foot = { x, y };
        }
      }
      // A cliff into open sky or water has no foot to heap a pile against.
      if (!foot || dropsToVoid || wet[Math.floor(foot.y) * width + Math.floor(foot.x)]) continue;
      const out ={ x: foot.x - (cx + 1), y: foot.y - (cy + 1) };
      const outLength = Math.hypot(out.x, out.y) || 1;
      const away = { x: out.x / outLength, y: out.y / outLength };
      const { snug, pieces } = rules.cliffPile({ key, kind, pile, random, choose: chooser(pile, key) });
      const base = snug ? { x: cx + 1 + away.x * 0.4, y: cy + 1 + away.y * 0.4 } : foot;
      const footZ = snug ? terrainHeightAt(terrain, width, foot.x, foot.y) : undefined;
      for (const piece of pieces) {
        const { role, member, index } = piece;
        const id = `${key}/${role}/${index}`;
        const scale = scaleFor(id, member, rules.pileScale[role]);
        for (let attempt = 0; attempt < TRIES; attempt++) {
          // Along the cliff (perpendicular to `away`) and a little out from it.
          const along = (random(`${id}#along#${attempt}`) - 0.5) * piece.along;
          const outward = piece.outward.base + random(`${id}#out#${attempt}`) * piece.outward.reach;
          const x = base.x - away.y * along + away.x * outward;
          const y = base.y + away.x * along + away.y * outward;
          if (fits(typeOf(member), scale, key, x, y, lowest, true, snug)) {
            place(id, member, x, y, scale, key, pile.tint, undefined, footZ, snug);
            break;
          }
        }
      }
    }
  }

  // Shore piles at each pool's waterline, then sunken pieces in its shallows. Each stands
  // on the ground where it is, half in the water, so it ignores placement.
  const shores = blueprint.dressing?.shores;
  let walked: Uint8Array | undefined;
  if (shores) {
    for (const pool of blueprint.water) {
      const [x0, y0, x1, y1] = poolRect(blueprint, pool);
      const rects = poolRects(blueprint, pool);
      const depth = (x: number, y: number): number => pool.height - terrainHeightAt(terrain, width, x, y);
      const waterline: { cx: number; cy: number }[] = [];
      for (let cy = Math.floor(y0); cy < Math.ceil(y1); cy++) {
        for (let cx = Math.floor(x0); cx < Math.ceil(x1); cx++) {
          if (blockedShore[cy * width + cx] || (pool.rects && !inPool(rects, cx + 0.5, cy + 0.5))) continue;
          const [x, y] = [cx + 0.5, cy + 0.5];
          const here = depth(x, y);
          // The waterline: ground within half a unit of the surface, crossing it to a neighbour.
          const crosses = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => Math.sign(depth(x + dx!, y + dy!)) !== Math.sign(here));
          if (Math.abs(here) < 0.5 && crosses) {
            waterline.push({ cx, cy });
            const key = `shores/${pool.id}/${cx}_${cy}`;
            if (random(key) < 1 / shores.spacing) heapShorePile(key, x, y);
            if (shores.fringe.length > 0 && random(`${key}#fringe`) < shores.fringeChance) {
              const id = `${key}/fringe/0`;
              const member = pick(shores.fringe, `${id}#member`);
              const scale = scaleFor(id, member, rules.pileScale.small);
              for (let attempt = 0; attempt < TRIES; attempt++) {
                const fx = x + (random(`${id}#x#${attempt}`) - 0.5) * 1.2;
                const fy = y + (random(`${id}#y#${attempt}`) - 0.5) * 1.2;
                // Reeds and pebbles may tuck in among a pile's rocks: only off cliffs and routes.
                if (fx >= 0.5 && fy >= 0.5 && fx <= width - 0.5 && fy <= height - 0.5 && !blockedShore[Math.floor(fy) * width + Math.floor(fx)]) {
                  place(id, member, fx, fy, scale, id, shores.pile.tint, undefined, terrainHeightAt(terrain, width, fx, fy), true);
                  break;
                }
              }
            }
          } else if (shores.sunken.length > 0 && here > 0.3 && here < 1.5) {
            const key = `shores/${pool.id}/sunken/${cx}_${cy}`;
            if (random(key) >= 1 / shores.sunkenSpacing) continue;
            const member = pick(shores.sunken, `${key}#member`);
            const id = `${key}/0`;
            const scale = scaleFor(id, member, rules.pileScale.large);
            if (fits(typeOf(member), scale, key, x, y, undefined, false, false, blockedShore)) {
              place(id, member, x, y, scale, key, shores.pile.tint, undefined, terrainHeightAt(terrain, width, x, y), true);
            }
          }
        }
      }
      if (shores.lights) stringShoreLights(pool, waterline, shores.lights);
    }
  }
  /**
   * Lights along the waterline where the player walks (3-6's night shores): each waterline cell
   * within `reach` of a route takes a light unless one already stands within `spacing`, so they run
   * in strings along those stretches. They hang `lift` above the surface and take no room.
   */
  function stringShoreLights(
    pool: MissionBlueprint["water"][number],
    waterline: readonly { cx: number; cy: number }[],
    lights: NonNullable<NonNullable<NonNullable<MissionBlueprint["dressing"]>["shores"]>["lights"]>,
  ): void {
    walked ??= walkedGround(blueprint);
    const reach = Math.ceil(lights.reach);
    const nearRoute = (cx: number, cy: number): boolean => {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const [x, y] = [cx + dx, cy + dy];
          if (x >= 0 && y >= 0 && x < width && y < height && walked![y * width + x] && Math.hypot(dx, dy) <= lights.reach) return true;
        }
      }
      return false;
    };
    const strung: { x: number; y: number }[] = [];
    for (const { cx, cy } of waterline) {
      const [x, y] = [cx + 0.5, cy + 0.5];
      if (strung.some((other) => Math.hypot(other.x - x, other.y - y) < lights.spacing) || !nearRoute(cx, cy)) continue;
      const id = `shores/${pool.id}/light/${cx}_${cy}/0`;
      const type = lights.accent && random(`${id}#accent`) < lights.accentChance ? lights.accent : lights.light;
      strung.push({ x, y });
      place(id, type, x, y, 1, LIGHTS, undefined, undefined, pool.height + lights.lift, true);
    }
  }
  /** A pile heaped round a waterline cell, each piece within its reach of it. */
  function heapShorePile(key: string, cx: number, cy: number): void {
    const pile = shores!.pile;
    for (const { role, member, index, reach } of rules.shorePile({ key, pile, random, choose: chooser(pile, key) }).pieces) {
      const id = `${key}/${role}/${index}`;
      const scale = scaleFor(id, member, rules.pileScale[role]);
      for (let attempt = 0; attempt < TRIES; attempt++) {
        const angle = random(`${id}#angle#${attempt}`) * Math.PI * 2;
        const distance = Math.sqrt(random(`${id}#out#${attempt}`)) * reach;
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        if (fits(typeOf(member), scale, key, x, y, undefined, true, false, blockedShore)) {
          place(id, member, x, y, scale, key, pile.tint, undefined, terrainHeightAt(terrain, width, x, y), true);
          break;
        }
      }
    }
  }

  // Lines along edges: trim and curbs along built floors' edges, plants and columns along cliffs' lips.
  const edges = blueprint.dressing?.edges;
  const lineFor = (zoneIndex: number, kind: "built" | "lip"): EdgeLine | undefined => {
    const zone = blueprint.zones[zoneIndex];
    if (!zone || (kind === "built" && zone.surface !== "built")) return undefined;
    const line = zone.edges?.[kind] ?? edges?.[kind];
    return line === "none" ? undefined : line;
  };
  const lipPieces: { x: number; y: number }[] = [];
  blueprint.zones.forEach((zone, zoneIndex) => {
    if (lineFor(zoneIndex, "built")) lineEdges(zone, zoneIndex, "built");
    // A lip is traced by the high zone's polygon (a mesa) or the low one's (a pit in a wider zone).
    if (blueprint.zones.some((_, other) => lineFor(other, "lip"))) lineEdges(zone, zoneIndex, "lip");
  });
  type RunSpot = { n: number; id: string; x: number; y: number; piece: boolean; gap: boolean };
  /** The zone that owns a point: the last listed whose polygon holds it, as the terrain paints them. */
  function zoneIndexAt(x: number, y: number): number {
    for (let i = blueprint.zones.length - 1; i >= 0; i--) if (containsPoint(blueprint.zones[i]!.polygon, { x, y })) return i;
    return -1;
  }
  /**
   * Where a natural zone's ragged cliff (terrain/ragged-outlines.ts) crosses the line out through
   * `p`, a point on its polygon's side: the nearest offset, within the wobble, at which the ground
   * 2.5 cells either side differs in level, one side at the zone's own. Undefined if there's none.
   */
  function lipCrossing(p: { x: number; y: number }, out: { x: number; y: number }, zone: MissionBlueprint["zones"][number]): { x: number; y: number } | undefined {
    const wander = zone.surface === "built" ? 0 : raggedAmplitude(blueprint);
    const own = zone.elevation * 64;
    for (let k = 0; k <= wander * 2; k++) {
      const offset = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const q = { x: p.x + out.x * offset, y: p.y + out.y * offset };
      const [ix, iy, bx, by] = [q.x - out.x * 2.5, q.y - out.y * 2.5, q.x + out.x * 2.5, q.y + out.y * 2.5];
      if (Math.min(ix, iy, bx, by) < 0 || Math.max(ix, bx) >= width || Math.max(iy, by) >= height) continue;
      const [low, high] = [level(ix, iy), level(bx, by)];
      if (low !== high && low % 64 === 0 && high % 64 === 0 && (low === own || high === own)) return q;
    }
    return undefined;
  }
  /**
   * A line along each straight side of a zone's polygon where that side is the right kind of edge.
   * Built: the ground beyond is another zone on the same level; the piece stands `inset` inside.
   * Lip: the two sides differ in level (looking 2.5 cells out, past the high ground a cliff mesh
   * covers); pieces stand from `inset` onto the high side, or just past the cliff mesh when that
   * reaches further, and take the lip line of the zone they stand in. Built pieces step along the
   * side from half a step in; lip spots are sampled every half cell, kept a step from the line's
   * other pieces, and clump by the line's `clumps`. All skip ramps, crossings, water and cliffs.
   * Ids `edges/<zone>/<kind>/<traced zone>.<side>/<n>[.<try>]`, the zone being the piece's.
   */
  function lineEdges(zone: MissionBlueprint["zones"][number], zoneIndex: number, kind: "built" | "lip"): void {
    const polygon = zone.polygon;
    const area = polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0);
    const reach = kind === "lip" ? 2.5 : 0.5;
    const onMap = (q: { x: number; y: number }) => q.x >= 0 && q.y >= 0 && q.x < width && q.y < height;
    const onMapAt = (x: number, y: number) => onMap({ x, y });
    polygon.forEach((a, side) => {
      const b = polygon[(side + 1) % polygon.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      // Outward: right of the direction for a counter-clockwise polygon.
      const out = area > 0 ? { x: along.y, y: -along.x } : { x: -along.y, y: along.x };
      const owned = kind === "built" ? lineFor(zoneIndex, "built") : undefined;
      // A lip's spacing is its owner's line's, known only per spot: sample finely, keep pieces a step apart.
      const step = owned?.step ?? 0.5;
      // A built run's spots in order, for the wear where gaps break it.
      const run: RunSpot[] = [];
      for (let n = 0, t = step / 2; t < length; n++, t += step) {
        const onSide = { x: a.x + along.x * t, y: a.y + along.y * t };
        const p = kind === "lip" ? (lipCrossing(onSide, out, zone) ?? onSide) : onSide;
        const inside = { x: p.x - out.x * reach, y: p.y - out.y * reach };
        const beyond = { x: p.x + out.x * reach, y: p.y + out.y * reach };
        if (!onMap(inside) || !onMap(beyond)) continue;
        const low = level(inside.x, inside.y);
        const high = level(beyond.x, beyond.y);
        // Which way the piece goes in (towards the zone, or for a lip towards the high side).
        let into: number;
        if (kind === "built") {
          if (zoneIndexAt(p.x - out.x * 0.5, p.y - out.y * 0.5) !== zoneIndex || zoneIndexAt(p.x + out.x * 0.5, p.y + out.y * 0.5) === zoneIndex) continue;
          if (level(p.x + out.x * 0.5, p.y + out.y * 0.5) !== level(p.x - out.x * 0.5, p.y - out.y * 0.5)) continue;
          into = -1;
        } else {
          if (low === high || low % 64 !== 0 || high % 64 !== 0) continue;
          into = low > high ? -1 : 1;
        }
        const base = { x: p.x + out.x * into * 0.5, y: p.y + out.y * into * 0.5 };
        const top = Math.max(low, high);
        // A lip belongs to its high ground's zone: where a ragged cliff stands out past the traced
        // zone's polygon, the traced zone's, not the polygon's owner below it.
        const under = zoneIndexAt(base.x, base.y);
        const owner = kind === "lip" && blueprint.zones[under]?.elevation !== top / 64 && zone.elevation === top / 64 ? zoneIndex : under;
        const line = kind === "built" ? owned : lineFor(owner, "lip");
        if (!line) continue;
        const id = `edges/${blueprint.zones[owner]!.id}/${kind}/${zone.id}.${side}/${n}`;
        // A lip starts where the high ground clears its cliff mesh: at the polygon for a mesa, a
        // couple of cells out for a pit's rim.
        let clear = 0;
        if (kind === "lip") {
          const free = (d: number) => {
            // A hair past d, so a lip on a cell boundary reads its own side's cell.
            const q = { x: p.x + out.x * into * (d + 0.02), y: p.y + out.y * into * (d + 0.02) };
            return onMap(q) && level(q.x, q.y) === top && !(terrain.cellFlags[Math.floor(q.y) * width + Math.floor(q.x)]! & 0x01);
          };
          while (clear < 3 && !free(clear)) clear += 0.25;
          if (clear >= 3) continue;
        }
        // A built piece stands `inset` inside its zone; a lip piece `inset` from the lip, a plant
        // leaning out over the cliff's crest when negative (ignoring placement rules).
        const from = kind === "lip" ? clear + line.inset : line.inset;
        // Grown lines clump, shaped by the Style Pack's clump rule: a few tries per spot, as likely
        // as the clump noise is thick there. Without that rule, every line spaces evenly.
        const shape = rules.lipClumps;
        const clumps = shape ? line.clumps : 0;
        const clump = !shape || clumps === 0 ? 1 : Math.min(1, Math.max(0, (valueNoise(base.x / shape.period, base.y / shape.period, "edges#clump") - clumps) / shape.edge));
        const clumpReach = !shape || clumps === 0 ? 0 : (0.25 + 1.75 * valueNoise(base.x / shape.reachPeriod, base.y / shape.reachPeriod, "edges#reach")) * (0.5 + clump);
        const tries = clumps === 0 ? 1 : Math.round(3 + 2 * clumpReach);
        for (let k = 0; k < tries; k++) {
          const key = k === 0 ? id : `${id}.${k}`;
          if (clumps > 0 && random(`${key}#clump`) >= clump) continue;
          const shift = (random(`${key}#along`) - 0.5) * 2 * line.jitter;
          const member = pick(line.members, `${key}#member`);
          const type = typeOf(member);
          const scale = scaleFor(key, member, kind === "built" ? UNIT_SCALE : rules.lipScale);
          // Most of a clump hugs the lip; fewer pieces stray further in, and how far wanders along
          // the edge (and with the clump's thickness), so clumps bulge in rather than run in bands.
          const grown = from + random(`${key}#in`) * line.jitter + (clumps > 0 ? random(`${key}#deep`) ** 2 * line.spread * clumpReach : 0);
          // Only plants lean out over the crest; a rock or anything else solid stands wholly on the
          // lip's ground, never dangling off the cliff (the author, 2026-11-01).
          const solid = kind === "lip" && getDoodadDescription(catalog, type)?.role !== "foliage";
          const radius = solid ? spacingOf(type, scale) / 2 : 0;
          const inward = solid ? Math.max(grown, clear + radius) : grown;
          const x = p.x + along.x * shift + out.x * into * inward;
          const y = p.y + along.y * shift + out.y * into * inward;
          // Where it stands: for a piece over the crest, the lip's own ground just behind it.
          const footing = kind === "lip" ? Math.max(inward, clear + 0.05) : inward;
          const fx = p.x + along.x * shift + out.x * into * footing;
          const fy = p.y + along.y * shift + out.y * into * footing;
          const cell = Math.floor(fy) * width + Math.floor(fx);
          // A solid piece needs the lip's own ground all round it, so it hangs over no cliff (a corner's included).
          const dangles = solid && Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4).some((a) => {
            const [qx, qy] = [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
            return !onMapAt(qx, qy) || level(qx, qy) !== top || (terrain.cellFlags[Math.floor(qy) * width + Math.floor(qx)]! & 0x01) !== 0;
          });
          if (dangles || x < 0.5 || y < 0.5 || x > width - 0.5 || y > height - 0.5 || blocked[cell] || (kind === "lip" && level(fx, fy) !== top)) {
            if (kind === "built") run.push({ n, id, x, y, piece: false, gap: false });
            continue;
          }
          if (random(`${key}#gap`) < line.gaps) {
            if (kind === "built") run.push({ n, id, x, y, piece: false, gap: true });
            continue;
          }
          // A step apart along the lip, and once where two zones trace the same one.
          if (kind === "lip") {
            if (lipPieces.some((q) => Math.hypot(q.x - x, q.y - y) < line.step)) continue;
            lipPieces.push({ x, y });
          }
          if (kind === "built") run.push({ n, id, x, y, piece: true, gap: false });
          const variations = variationsFor(member, type, memberOf(member).variations ?? line.variations);
          const rotation = line.aligned ? Math.atan2(along.y, along.x) + (line.turn * Math.PI) / 180 : random(`${key}#yaw`) * 2 * Math.PI;
          placed.push({
            id: key,
            type,
            x,
            y,
            rotation: ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
            scale,
            variation: pickVariation(`${key}#variation`, variations),
            group: `edges/${kind}`,
            // Over the crest, at the lip's height, not partway down the cliff.
            ...(footing !== inward ? { z: terrainHeightAt(terrain, width, fx, fy) } : {}),
            ...(memberOf(member).tint ? { tint: memberOf(member).tint! } : {}),
            ...(line.noFootprint ? { flags: ["NoDoodadFootprint"] } : {}),
          });
        }
      }
      if (owned?.breaks) wearBreaks(run, owned.breaks, along, out);
    });
  }
  /**
   * A broken run's wear: where a gap cuts it, bits of wreckage cover the cut end of the piece
   * beside it, and debris lies strewn in the gap, either side of the line; how many and how big
   * are the Style Pack's to say.
   */
  function wearBreaks(run: readonly RunSpot[], breaks: NonNullable<EdgeLine["breaks"]>, along: { x: number; y: number }, out: { x: number; y: number }): void {
    const strew = (id: string, members: readonly DressingMember[], x: number, y: number, range: readonly [number, number]): void => {
      const cell = Math.floor(y) * width + Math.floor(x);
      if (x < 0.5 || y < 0.5 || x > width - 0.5 || y > height - 0.5 || blocked[cell]) return;
      const member = pick(members, `${id}#member`);
      const type = typeOf(member);
      placed.push({
        id,
        type,
        x,
        y,
        rotation: random(`${id}#yaw`) * 2 * Math.PI,
        scale: scaleFor(id, member, range),
        variation: pickVariation(`${id}#variation`, variationsFor(member, type)),
        group: "edges/built",
        ...(memberOf(member).tint ? { tint: memberOf(member).tint! } : {}),
      });
    };
    run.forEach((spot, i) => {
      if (!spot.gap) return;
      for (const [end, next] of [["before", run[i - 1]], ["after", run[i + 1]]] as const) {
        if (!next?.piece || Math.abs(next.n - spot.n) !== 1) continue;
        // On the cut, halfway between the missing piece and the one beside it.
        for (let k = 0; k < rules.breakWear.capsPerEnd; k++) {
          const id = `${spot.id}/cap/${end}/${k}`;
          const a = (random(`${id}#along`) - 0.5) * 0.4;
          const o = (random(`${id}#out`) - 0.5) * 0.3;
          strew(id, breaks.caps, (spot.x + next.x) / 2 + along.x * a + out.x * o, (spot.y + next.y) / 2 + along.y * a + out.y * o, rules.breakWear.capScale);
        }
      }
      if (breaks.debris.length === 0) return;
      const count = 1 + Math.floor(random(`${spot.id}/debris#count`) * rules.breakWear.maxDebris);
      for (let k = 0; k < count; k++) {
        const id = `${spot.id}/debris/${k}`;
        const a = (random(`${id}#along`) - 0.5) * 1.4;
        const o = (random(`${id}#out`) - 0.5) * 1.6;
        strew(id, breaks.debris, spot.x + along.x * a + out.x * o, spot.y + along.y * a + out.y * o, rules.breakWear.debrisScale);
      }
    });
  }

  // Set pieces.
  const setPieces: PlacedSetPiece[] = [];
  /** Members that placed fewer than their count. */
  const dropped: string[] = [];
  const reportDropped = (setPieceId: string, what: string, landed: number, count: number): void => {
    if (landed < count) dropped.push(`Set piece ${setPieceId}: placed ${landed} of ${count} ${what} (no room after ${TRIES} tries); give it room or nestle it.`);
  };
  /** Every composite copy stamped, for the Style Pack's advice. */
  const copies: StampedComposite[] = [];
  const facings = bundledDoodadFacings();
  const readings = bundledSheetReadings();
  /** Pieces turned by a front read from a catalog sheet, not measured: their types by id, named in one warning once hand edits are in. */
  const sheetTurned = new Map<string, string>();
  const turnedBySheet = (id: string, type: string): void => {
    sheetTurned.set(id, type);
  };
  const wallFootStandOff = facings.placements["wall-foot"].standOff ?? 2.6;
  const wallFeet = new Map<string, { x: number; y: number; nx: number; ny: number }[]>();
  /** Warnings about turning or backing doodads whose front isn't measured, one per set piece and type. */
  const walled: string[] = [];
  const noWall = (setPieceId: string, what: string): void => {
    walled.push(`Set piece ${setPieceId}: no wall within its radius for ${what} (against: "wall"): move its centre nearer a wall, or widen its radius.`);
  };
  const unmeasuredSeen = new Set<string>();
  const unmeasured = (setPieceId: string, type: string, outcome: string, what: "doodad" | "composite" = "doodad"): void => {
    if (unmeasuredSeen.has(`${setPieceId}/${type}`)) return;
    unmeasuredSeen.add(`${setPieceId}/${type}`);
    walled.push(
      what === "composite"
        ? `Set piece ${setPieceId}: composite ${type} has no front (no "front", and its members' known fronts, measured or read for sure from their sheets, don't agree or there are none), so ${outcome}; give the recipe a front.`
        : `Set piece ${setPieceId}: ${type}'s front isn't measured (doodad-facings.json) or read for sure from its sheet (doodad-sheet-readings.json), so ${outcome}; measure it with npm run facing-strip.`,
    );
  };
  for (const placement of blueprint.placements) {
    if (placement.kind !== "set-piece") continue;
    const params: SetPieceParams = SetPieceParamsSchema.parse(placement.params);
    const zone = blueprint.zones.find((z) => z.id === placement.zoneId)!;
    const centre = params.at ?? {
      x: zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length,
      y: zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length,
    };
    setPieces.push({ id: placement.id, x: centre.x, y: centre.y, radius: params.radius });
    const onLevel = level(centre.x, centre.y);
    const r = params.radius;
    const density = DENSITY[params.density];
    // The ids' prefixes: `<set piece>/<type>` for a type's (or composite's) first member, and for
    // a later member of the same type, which would share its ids, its ring and its place there
    // (`<type>/props`, `<type>/props-1`). The next compile merges objects by id, and an edit keyed
    // by one member's id stays on it whatever the other members' counts.
    const firsts = new Set<string>();
    const inRing = new Map<string, number>();
    const prefixFor = (name: string, ring: string): string => {
      const n = inRing.get(`${ring}/${name}`) ?? 0;
      inRing.set(`${ring}/${name}`, n + 1);
      if (!firsts.has(name)) {
        firsts.add(name);
        return `${placement.id}/${name}`;
      }
      return `${placement.id}/${name}/${n === 0 ? ring : `${ring}-${n}`}`;
    };
    for (const ring of ["anchor", "props", "clutter"] as const) {
      for (const member of params[ring]) {
        if (typeof member === "object" && "composite" in member) {
          stampComposites(placement.id, prefixFor(member.composite, ring), ring, member, centre, r, onLevel, density, member.nestle ?? params.nestle ?? false, zone.elevation);
          continue;
        }
        const type = typeOf(member);
        const prefix = prefixFor(type, ring);
        const count = memberOf(member).count ?? Math.max(1, Math.round(DEFAULT_COUNT[ring] * (ring === "anchor" ? 1 : density)));
        const own: { nestle?: boolean | undefined; yaw?: number | undefined; against?: "wall" | undefined } = typeof member === "string" ? {} : member;
        const nestle = own.nestle ?? params.nestle ?? false;
        const facing = own.yaw === undefined ? undefined : rotationToFace(type, radians(own.yaw), facings, readings);
        if (facing && !facing.source) unmeasured(placement.id, type, `yaw ${own.yaw} is taken as its rotation`);
        const yaw = facing?.rotation;
        let landed = 0;
        if (own.against === "wall") {
          landed = placeAgainstWall(placement.id, prefix, member, type, count, zone.elevation, centre, r, onLevel, nestle, ring);
          reportDropped(placement.id, type, landed, count);
          continue;
        }
        for (let index = 0; index < count; index++) {
          const id = `${prefix}/${index}`;
          const scale = scaleFor(id, member, [1, 1]);
          for (let attempt = 0; attempt < TRIES; attempt++) {
            const angle = random(`${id}#angle#${attempt}`) * 2 * Math.PI;
            const u = random(`${id}#distance#${attempt}`);
            // Anchors near the centre; props in a ring; clutter densest near the middle.
            const distance = ring === "anchor" ? (index === 0 && attempt === 0 ? 0 : 0.35 * r * u) : ring === "props" ? r * (0.3 + 0.45 * u) : r * u;
            const x = centre.x + Math.cos(angle) * distance;
            const y = centre.y + Math.sin(angle) * distance;
            if (nestle ? standable(x, y, onLevel) : fits(type, scale, placement.id, x, y, onLevel, ring === "clutter")) {
              place(id, member, x, y, scale, placement.id, undefined, placement.id, undefined, nestle, yaw, ring);
              if (facing?.source === "sheet") turnedBySheet(id, type);
              landed++;
              break;
            }
          }
        }
        reportDropped(placement.id, type, landed, count);
      }
    }
  }
  /**
   * Copies of a composite recipe in a set piece's ring, each placed from its own seed like any
   * member. The shape is exact; each copy turns (as the Style Pack turns its style), takes a size from the
   * recipe's range, and picks variants for members marked "any". Its members overlap by design,
   * so they ignore placement and stand at the copy's own ground height plus theirs. A member's
   * `yaw` (degrees) turns every copy's front that way instead (`compositeFront`); `against: "wall"`
   * backs every copy onto a wall, front to the room, far enough out that each of its pieces stands
   * off the wall as measured. A `nestle`d copy skips the room it keeps from other doodads, but its
   * pieces still stand on its level and off blocked cells (hung and wall-top pieces excepted).
   */
  function stampComposites(
    setPieceId: string,
    /** `<set piece>/<composite>`, or for a later member of the same composite with its ring too, as for a doodad type. */
    prefix: string,
    ring: "anchor" | "props" | "clutter",
    member: Extract<SetPieceMember, { composite: string }>,
    centre: { x: number; y: number },
    r: number,
    onLevel: number,
    density: number,
    nestle: boolean,
    floor: number,
  ): void {
    const recipe = getComposite(blueprint, member.composite);
    if (!recipe) throw new Error(`Set piece ${setPieceId}: no composite ${member.composite} in the blueprint's composites or the loaded Plugins' shared libraries (the Style Pack's)`);
    const count = member.count ?? Math.max(1, Math.round(DEFAULT_COUNT[ring] * (ring === "anchor" ? 1 : density)));
    const extent = Math.max(...recipe.members.map((m) => Math.hypot(m.x, m.y)));
    const { front, sheet } = member.yaw !== undefined || member.against ? compositeFrontFrom(recipe, facings, readings) : { front: undefined, sheet: [] as readonly string[] };
    if ((member.yaw !== undefined || member.against) && front === undefined) {
      unmeasured(setPieceId, recipe.id, member.against ? "it faces the room as if its front were east at yaw 0" : `yaw ${member.yaw} turns it as before`, "composite");
    }
    const measured = recipe.members.map((m) => getDoodadFacing(m.type, facings));
    // Hung and wall-top pieces may stand over the slope or on the wall; the rest stay on the floor.
    const offFloor = measured.map((known) => known?.placement === "wall-face" || known?.placement === "wall-top");
    const walls = member.against ? wallFoot(floor, centre, r) : [];
    if (member.against && walls.length === 0) noWall(setPieceId, recipe.id);
    let landed = 0;
    for (let index = 0; index < count; index++) {
      const key = `${prefix}/${index}`;
      const [low, high] = recipe.scale;
      const size = Math.round((low + random(`${key}#scale`) * (high - low)) * 100) / 100;
      const turned = (yaw: number) => (m: { x: number; y: number }) => ({ x: (m.x * Math.cos(yaw) - m.y * Math.sin(yaw)) * size, y: (m.x * Math.sin(yaw) + m.y * Math.cos(yaw)) * size });
      const reach = extent * size + 1;
      for (let attempt = 0; attempt < TRIES; attempt++) {
        let x: number;
        let y: number;
        let yaw: number;
        if (member.against) {
          // A point on the wall's foot; the shape turned front to the room and pushed out until every piece clears the wall.
          if (walls.length === 0) break;
          const foot = walls[Math.floor(random(`${key}#wall#${attempt}`) * walls.length)]!;
          yaw = wrapAngle(Math.atan2(foot.ny, foot.nx) - (front ?? 0));
          const offsets = recipe.members.map(turned(yaw));
          const out = Math.max(
            ...recipe.members.map((_, n) => {
              if (measured[n]?.placement === "wall-top") return -Infinity;
              const depth = offsets[n]!.x * foot.nx + offsets[n]!.y * foot.ny;
              return (measured[n]?.standOff ?? wallFootStandOff) - depth;
            }),
          );
          x = foot.x + foot.nx * (Number.isFinite(out) ? out : wallFootStandOff);
          y = foot.y + foot.ny * (Number.isFinite(out) ? out : wallFootStandOff);
        } else {
          yaw =
            member.yaw !== undefined
              ? wrapAngle(radians(member.yaw) - (front ?? 0))
              : rules.yaw({ turn: random(`${key}#yaw`) * 2 * Math.PI, built: recipe.style === "built" });
          const angle = random(`${key}#angle#${attempt}`) * 2 * Math.PI;
          const u = random(`${key}#distance#${attempt}`);
          const distance = ring === "anchor" ? (index === 0 && attempt === 0 ? 0 : 0.35 * r * u) : ring === "props" ? r * (0.3 + 0.45 * u) : r * u;
          x = centre.x + Math.cos(angle) * distance;
          y = centre.y + Math.sin(angle) * distance;
        }
        const offsets = recipe.members.map(turned(yaw));
        const spots = offsets.map((o) => ({ x: x + o.x, y: y + o.y }));
        const onMap = spots.every((p) => p.x >= 0.5 && p.y >= 0.5 && p.x <= width - 0.5 && p.y <= height - 0.5);
        if (!onMap) continue;
        if (spots.some((p, n) => (offFloor[n] && member.against ? blockedRoute : blocked)[Math.floor(p.y) * width + Math.floor(p.x)] || (!(offFloor[n] && member.against) && level(p.x, p.y) !== onLevel))) continue;
        const roomy = nestle || placed.every((other) => other.group === LIGHTS || Math.hypot(other.x - x, other.y - y) >= Math.max(reach, spacingOf(other.type, other.scale)) * 0.8);
        if (!roomy) continue;
        const ground = terrainHeightAt(terrain, width, x, y);
        recipe.members.forEach((m, n) => {
          const id = `${key}/${n}`;
          const scale = typeof m.scale === "number" ? Math.round(m.scale * size * 1000) / 1000 : m.scale.map((axis) => Math.round(axis * size * 1000) / 1000) as [number, number, number];
          placed.push({
            id,
            type: m.type,
            ...spots[n]!,
            rotation: (((m.yaw + yaw) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
            ...(m.pitch !== undefined ? { pitch: m.pitch } : {}),
            ...(m.roll !== undefined ? { roll: m.roll } : {}),
            scale,
            variation: m.variation === "any" ? pickVariation(`${id}#variation`, randomVariations(catalog, m.type)) : m.variation,
            group: key,
            ...(m.tint ? { tint: m.tint } : {}),
            setPieceId,
            z: ground + m.height * size,
            forcePlacement: true,
            ...(m.noFootprint ? { flags: ["NoDoodadFootprint"] } : {}),
            ring,
            ...(member.pathing ? { pathing: member.pathing } : {}),
          });
        });
        copies.push({ compositeId: recipe.id, kind: recipe.kind, setPieceId, x, y });
        recipe.members.forEach((m, n) => {
          if (sheet.includes(m.type)) turnedBySheet(`${key}/${n}`, m.type);
        });
        landed++;
        break;
      }
    }
    reportDropped(setPieceId, recipe.id, landed, count);
  }

  /**
   * Points along the foot of every wall round a set piece: the edges of the Zones higher than its
   * floor Zone, within its radius, where the ground just inside the edge is higher than the set
   * piece's level and the ground three cells out is on it. Each comes with the unit normal out of
   * the wall into the room.
   */
  function wallFoot(floor: number, centre: { x: number; y: number }, r: number): { x: number; y: number; nx: number; ny: number }[] {
    const key = `${floor}/${centre.x}/${centre.y}/${r}`;
    const cached = wallFeet.get(key);
    if (cached) return cached;
    const onLevel = level(centre.x, centre.y);
    const levelAt = (x: number, y: number): number | undefined => (x < 0 || y < 0 || x >= width || y >= height ? undefined : level(x, y));
    const feet: { x: number; y: number; nx: number; ny: number }[] = [];
    for (const wall of blueprint.zones) {
      if (wall.elevation <= floor) continue;
      wall.polygon.forEach((a, i) => {
        const b = wall.polygon[(i + 1) % wall.polygon.length]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) return;
        const steps = Math.max(1, Math.round(length / WALL_STEP));
        const [dx, dy] = [(b.x - a.x) / length, (b.y - a.y) / length];
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          const [x, y] = [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
          if (Math.hypot(x - centre.x, y - centre.y) > r) continue;
          for (const [nx, ny] of [[dy, -dx], [-dy, dx]] as const) {
            const inside = levelAt(x - nx, y - ny);
            if (inside !== undefined && inside > onLevel && levelAt(x + nx * 3, y + ny * 3) === onLevel) {
              feet.push({ x, y, nx, ny });
              break;
            }
          }
        }
      });
    }
    wallFeet.set(key, feet);
    return feet;
  }

  /**
   * `count` copies of a doodad backed onto the walls round a set piece, front to the room: each
   * at a point on a wall's foot, its measured stand-off out (a floor piece clear of the slope, a
   * hung one over it at its height above the ground there). An unmeasured doodad stands as a
   * floor piece at the wall's foot, turned as if its front were its rotation. A wall-top piece
   * whose distance in from the edge isn't measured isn't placed. Returns how many landed.
   */
  function placeAgainstWall(
    setPieceId: string,
    prefix: string,
    member: DressingMember,
    type: string,
    count: number,
    floor: number,
    centre: { x: number; y: number },
    r: number,
    onLevel: number,
    nestle: boolean,
    ring: "anchor" | "props" | "clutter",
  ): number {
    const known: DoodadFacing | undefined = getDoodadFacing(type, facings);
    const turn = (towards: number) => rotationToFace(type, towards, facings, readings);
    if (!known && !turn(0).source) unmeasured(setPieceId, type, "it stands at the wall's foot as a floor piece, turned as if its front were its rotation");
    // A sheet reading's placement is only a suggestion: say so when it isn't the floor piece this stands as.
    const suggested = known ? undefined : readings.doodads[type]?.placement;
    if ((suggested === "wall-face" || suggested === "wall-top") && !unmeasuredSeen.has(`${setPieceId}/${type}#suggested`)) {
      unmeasuredSeen.add(`${setPieceId}/${type}#suggested`);
      walled.push(
        `Set piece ${setPieceId}: ${type}'s sheet suggests it ${suggested === "wall-face" ? "hangs on the wall's face" : "sits on the wall's top"}, but its placement isn't measured, so it stands at the wall's foot as a floor piece; measure it with npm run facing-strip.`,
      );
    }
    const standOff = known?.standOff ?? (known?.placement === "wall-top" ? undefined : wallFootStandOff);
    if (standOff === undefined) {
      walled.push(`Set piece ${setPieceId}: ${type} stands on a wall's top, and how far in from the edge isn't measured, so against: "wall" can't place it; place it as a doodad anchor.`);
      return 0;
    }
    const hung = known?.placement === "wall-face";
    const onFloor = known?.placement !== "wall-face" && known?.placement !== "wall-top";
    const walls = wallFoot(floor, centre, r);
    if (walls.length === 0) noWall(setPieceId, type);
    let landed = 0;
    for (let index = 0; index < count && walls.length > 0; index++) {
      const id = `${prefix}/${index}`;
      const scale = scaleFor(id, member, [1, 1]);
      for (let attempt = 0; attempt < TRIES; attempt++) {
        const foot = walls[Math.floor(random(`${id}#wall#${attempt}`) * walls.length)]!;
        const x = foot.x + foot.nx * standOff;
        const y = foot.y + foot.ny * standOff;
        const room = onFloor ? (nestle ? standable(x, y, onLevel) : fits(type, scale, setPieceId, x, y, onLevel, false)) : nestle ? standable(x, y, undefined, true) : fits(type, scale, setPieceId, x, y, undefined, false, true);
        if (!room) continue;
        const { rotation, source } = turn(Math.atan2(foot.ny, foot.nx));
        if (source === "sheet") turnedBySheet(id, type);
        const z = hung ? terrainHeightAt(terrain, width, x, y) + (known?.height ?? 0) : undefined;
        place(id, member, x, y, scale, setPieceId, undefined, setPieceId, z, nestle || !onFloor, rotation, ring);
        landed++;
        break;
      }
    }
    return landed;
  }

  const warnings: string[] = [
    ...dropped,
    ...unknownVariations,
    ...walled,
    ...(rules.compositeWarnings?.(copies) ?? []),
  ];

  // Hand edits last, by id (prefix + key), then hand-added doodads.
  const edits = new Map<string, DoodadEdit>();
  for (const [key, change] of Object.entries(cliffs?.edits ?? {})) edits.set(`cliffs/${key}`, change);
  for (const [key, change] of Object.entries(shores?.edits ?? {})) edits.set(`shores/${key}`, change);
  for (const [key, change] of Object.entries(edges?.edits ?? {})) edits.set(`edges/${key}`, change);
  const added: PlacedDoodad[] = [];
  for (const placement of blueprint.placements) {
    if (placement.kind !== "set-piece") continue;
    const params = SetPieceParamsSchema.parse(placement.params);
    for (const [key, change] of Object.entries(params.edits)) edits.set(`${placement.id}/${key}`, change);
    params.added.forEach((doodad, n) => {
      const { heightOffset, ...rest } = doodad;
      added.push({
        id: addedDoodadId(placement.id, n + 1),
        ...defined(rest),
        type: rest.type,
        x: rest.x,
        y: rest.y,
        rotation: rest.rotation,
        scale: rest.scale,
        variation: rest.variation,
        z: terrainHeightAt(terrain, width, doodad.x, doodad.y) + (heightOffset ?? 0),
        ...(heightOffset !== undefined ? { heightOffset } : {}),
        setPieceId: placement.id,
        ring: "added",
      });
    });
  }
  const known = new Set(placed.map((doodad) => doodad.id));
  // Each id becomes one Editor Id, and an in-place compile merges the package's objects by it.
  if (known.size < placed.length) {
    const seen = new Set<string>();
    const twice = [...new Set(placed.flatMap((doodad) => (seen.has(doodad.id) ? [doodad.id] : (seen.add(doodad.id), []))))];
    throw new Error(`Dressing gave two doodads one id (${twice.join(", ")}), so a compile into the Map Package would merge them`);
  }
  for (const id of edits.keys()) if (!known.has(id)) warnings.push(`Dressing edit ${id} matches no doodad (its set piece or cliff changed); remove it or re-sync.`);
  const doodads: PlacedDoodad[] = [];
  /** Sheet-turned pieces by type, less those the author removed, turned or swapped by hand. */
  const sheetCounts = new Map<string, number>();
  for (const { group, ...doodad } of placed) {
    if (group === STANDING) continue;
    const change = edits.get(doodad.id);
    if (change?.removed) continue;
    const readType = sheetTurned.get(doodad.id);
    if (readType && change?.rotation === undefined && change?.type === undefined) sheetCounts.set(readType, (sheetCounts.get(readType) ?? 0) + 1);
    const { heightOffset, removed: _removed, ...rest } = change ?? {};
    const moved = { ...doodad, ...defined(rest) };
    const base = doodad.z ?? terrainHeightAt(terrain, width, moved.x, moved.y);
    doodads.push({ ...moved, z: base + (heightOffset ?? 0), ...(heightOffset !== undefined ? { heightOffset } : {}) });
  }
  if (sheetCounts.size > 0) {
    const listed = [...sheetCounts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    warnings.push(
      `${listed.reduce((sum, [, n]) => sum + n, 0)} pieces turned by fronts read from catalog sheets, not measured: ${listed.map(([type, n]) => `${type} ×${n}`).join(", ")} (doodad-sheet-readings.json). If one faces wrong, measure it with npm run facing-strip.`,
    );
  }
  return { doodads: [...doodads, ...added], setPieces, warnings };
}
