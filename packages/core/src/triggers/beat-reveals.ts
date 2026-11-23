// A Beat's reveals (ADR 0004 item 1), compiled: as the Beat starts, each Zone it reveals is
// explored for the player, so under Black Mask its ground shows under fog, and pinged on the
// minimap, as Blizzard's campaign maps preview a goal: Devil's Playground's "Find Tosh's Missing
// Miners" explores a circle around a placed point (`VisExploreArea(p1, RegionCircle(PointFromId(443),
// 8.0), true, false)`) and pings that point. Exploring leaves ground the player sees as it is. All
// of it is NativeLib's GUI actions (ADR 0002).

import { isPlaced, type MissionBlueprint, type Reveal } from "../domain/mission-blueprint.js";
import { fogLabelOf, isBlackMask, labelOf, MAPINFO_FOG, unexploredAreasOf } from "../domain/unexplored-areas.js";
import { containsPoint, distanceToPolygon, type Point } from "../terrain/polygon.js";
import { beatStart } from "./beat-start.js";
import { objectIdOf, regionValueOf, zoneNameOf } from "./kept-ids.js";
import { call, callValue, USER_PLAYER } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "./trigger-catalog.js";
import type { TriggerCall, TriggerParam } from "./trigger-model.js";

/** How long a reveal's ping shows, in seconds, and its colour (red, green, blue, 0-100): the calibration maps' commonest ping. */
export const REVEAL_PING_SECONDS = 5;
export const REVEAL_PING_COLOR = [0, 100, 0] as const;

type RevealsBlueprint = Pick<MissionBlueprint, "anchors" | "beats" | "kept" | "zones">;

/**
 * Where a reveal explores: a circle (at a point Anchor, or at a point the compile chose), or the
 * Zone's whole region, asked for or because no circle fits inside the Zone (`thin`).
 */
export type RevealShape =
  | { readonly kind: "circle"; readonly zoneId: string; readonly anchorId?: string; readonly center?: Point; readonly radius: number }
  | { readonly kind: "region"; readonly zoneId: string; readonly thin?: true };

const floorTenth = (value: number): number => Math.floor(value * 10) / 10;

type Bounds = { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };
function boundsOf(polygon: readonly Point[]): Bounds {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}
const overlaps = (a: Bounds, b: Bounds): boolean => a.left <= b.right && b.left <= a.right && a.bottom <= b.top && b.bottom <= a.top;

/**
 * The ground a Zone owns: its polygon, less the Zones drawn after it that overlap it (a later Zone
 * owns the cells it is drawn over, as the terrain draws them).
 */
type OwnedArea = { readonly polygon: readonly Point[]; readonly cutouts: readonly (readonly Point[])[] };

function ownedArea(blueprint: Pick<MissionBlueprint, "zones">, zoneId: string): OwnedArea {
  const index = blueprint.zones.findIndex((zone) => zone.id === zoneId);
  if (index < 0) throw new Error(`Unknown zone id: ${zoneId}`);
  const polygon = blueprint.zones[index]!.polygon;
  const bounds = boundsOf(polygon);
  // A later Zone clear of this one's bounds can't cut into it or come nearer than its own edge.
  const cutouts = blueprint.zones.slice(index + 1).map((zone) => zone.polygon).filter((other) => overlaps(bounds, boundsOf(other)));
  return { polygon, cutouts };
}

const insideArea = (area: OwnedArea, point: Point): boolean => containsPoint(area.polygon, point) && !area.cutouts.some((cutout) => containsPoint(cutout, point));
const clearance = (area: OwnedArea, point: Point): number => Math.min(distanceToPolygon(area.polygon, point), ...area.cutouts.map((cutout) => distanceToPolygon(cutout, point)));

/**
 * The widest circle inside a polygon, clear of the `cutouts` (Zones drawn over it): its centre on
 * a half-cell grid, the first found of the widest (so the same ground always gives the same
 * circle), and its radius to a tenth of a cell, down. None when no half-cell point lies inside, or
 * the widest is under a tenth of a cell.
 */
export function widestCircleInside(polygon: readonly Point[], cutouts: readonly (readonly Point[])[] = []): { readonly center: Point; readonly radius: number } | undefined {
  const area = { polygon, cutouts };
  const { left, bottom, right, top } = boundsOf(polygon);
  let best: { center: Point; radius: number } | undefined;
  for (let y = Math.ceil(bottom * 2) / 2; y <= top; y += 0.5) {
    for (let x = Math.ceil(left * 2) / 2; x <= right; x += 0.5) {
      const point = { x, y };
      if (!insideArea(area, point)) continue;
      const radius = clearance(area, point);
      if (radius > (best?.radius ?? 0)) best = { center: point, radius };
    }
  }
  const radius = best ? floorTenth(best.radius) : 0;
  return best && radius > 0 ? { center: best.center, radius } : undefined;
}

const SHAPES = new WeakMap<object, Map<string, RevealShape>>();

/** Where a reveal explores, from its Blueprint entry; worked out once per Blueprint and entry. */
export function revealShape(blueprint: RevealsBlueprint, reveal: Reveal): RevealShape {
  const key = JSON.stringify(reveal);
  let shapes = SHAPES.get(blueprint);
  if (!shapes) SHAPES.set(blueprint, (shapes = new Map()));
  const known = shapes.get(key);
  if (known) return known;
  const shape = findShape(blueprint, reveal);
  shapes.set(key, shape);
  return shape;
}

function findShape(blueprint: RevealsBlueprint, reveal: Reveal): RevealShape {
  const entry = typeof reveal === "string" ? { zoneId: reveal } : reveal;
  const zone = blueprint.zones.find((candidate) => candidate.id === entry.zoneId);
  if (!zone) throw new Error(`Unknown zone id: ${entry.zoneId}`);
  if ("region" in entry && entry.region) return { kind: "region", zoneId: zone.id };
  const area = ownedArea(blueprint, zone.id);
  if ("at" in entry && entry.at !== undefined) {
    const anchor = blueprint.anchors.find((candidate) => candidate.id === entry.at);
    // A Kept point's radius is required by the schema; an Anchor's defaults to the nearest edge of the Zone's ground.
    const radius = entry.radius ?? (anchor && isPlaced(anchor) ? Math.max(1, floorTenth(clearance(area, anchor.position))) : undefined);
    if (radius === undefined) throw new Error(`Reveal of ${zone.id} at ${entry.at} needs a radius`);
    return { kind: "circle", zoneId: zone.id, anchorId: entry.at, radius };
  }
  const widest = widestCircleInside(area.polygon, area.cutouts);
  if (!widest) return { kind: "region", zoneId: zone.id, thin: true };
  return { kind: "circle", zoneId: zone.id, center: widest.center, radius: ("radius" in entry ? entry.radius : undefined) ?? widest.radius };
}

/** A Beat's reveals once each: an entry repeated exactly is one reveal. */
const distinct = (reveals: readonly Reveal[]): Reveal[] => [...new Map(reveals.map((reveal) => [JSON.stringify(reveal), reveal])).values()];

/** A Beat's reveals as actions: the explores, and the pings that point at what they explored. */
export type BeatRevealActions = { readonly explores: TriggerCall[]; readonly pings: TriggerCall[] };

/**
 * The actions that reveal a Beat's Zones, in its `reveals` order: for each, Explore/Unexplore Area
 * for the player (Explored, Do Not check cliff level) over a circle (Convert Circle To Region) or
 * the Zone's trigger region, and Ping Minimap at its centre for all players. None for a Beat that
 * reveals nothing. The trigger that starts the Beat runs them ("Mission Start" for the first Beat,
 * a Beat's own trigger for a later one): the explores as the Beat starts, so a scene played on the
 * map shows the ground, and the pings once the scenes cued then have handed back.
 */
export function beatReveals(blueprint: RevealsBlueprint, beatId: string): BeatRevealActions {
  const beat = blueprint.beats.find((candidate) => candidate.id === beatId);
  if (!beat) throw new Error(`Unknown beat id: ${beatId}`);
  const fixed = (value: number): TriggerParam["value"] => ({ kind: "fixed", value });
  const seen = new Map<string, number>();
  const explores: TriggerCall[] = [];
  const pings: TriggerCall[] = [];
  for (const reveal of distinct(beat.reveals)) {
    const shape = revealShape(blueprint, reveal);
    const count = seen.get(shape.zoneId) ?? 0;
    seen.set(shape.zoneId, count + 1);
    // A Zone revealed again is numbered after a slash, which no Zone id has.
    const path = `beats/${beat.id}/reveals/${shape.zoneId}${count > 0 ? `/${count + 1}` : ""}`;
    const center = (at: string): TriggerParam["value"] =>
      shape.kind === "region"
        ? callValue(at, F.regionGetCenter, { region: regionValueOf(blueprint, shape.zoneId) })
        : shape.anchorId !== undefined
          ? { kind: "point", objectId: objectIdOf(blueprint, shape.anchorId) }
          : callValue(at, F.point, { x: fixed(shape.center!.x), y: fixed(shape.center!.y) });
    const area: TriggerParam["value"] =
      shape.kind === "region"
        ? regionValueOf(blueprint, shape.zoneId)
        : callValue(`${path}/explore/area`, F.regionCircle, { center: center(`${path}/explore/area/center`), radius: fixed(shape.radius) });
    const [r, g, b] = REVEAL_PING_COLOR;
    explores.push(
      call(`${path}/explore`, F.exploreArea, {
        player: { kind: "int", value: USER_PLAYER },
        state: { kind: "preset", preset: P.explored },
        cliffLevel: { kind: "preset", preset: P.doNot },
        area,
      }),
    );
    pings.push(
      call(`${path}/ping`, F.minimapPing, {
        players: callValue(`${path}/ping/players`, F.allPlayers, {}),
        point: center(`${path}/ping/point`),
        duration: fixed(REVEAL_PING_SECONDS),
        color: callValue(`${path}/ping/color`, F.color, { r: fixed(r), g: fixed(g), b: fixed(b) }),
      }),
    );
  }
  return { explores, pings };
}

/** Whether exploring `a` explores all of `b` too, as far as the Blueprint tells. */
function covers(blueprint: RevealsBlueprint, a: RevealShape, b: RevealShape): boolean {
  if (a.zoneId !== b.zoneId) return false;
  if (a.kind === "region") return true;
  if (b.kind === "region") return false;
  if (a.anchorId !== undefined && a.anchorId === b.anchorId) return b.radius <= a.radius;
  const centre = (shape: typeof a): Point | undefined => shape.center ?? blueprint.anchors.find((anchor) => anchor.id === shape.anchorId)?.position;
  const [ca, cb] = [centre(a), centre(b)];
  return ca !== undefined && cb !== undefined && Math.hypot(ca.x - cb.x, ca.y - cb.y) + b.radius <= a.radius + 1e-9;
}

/**
 * Advice on reveals:
 * - A reveal with no point Anchor gets the widest circle inside its Zone's ground, which the author
 *   should look at and replace with a point chosen in advance; where no circle fits, the Zone's
 *   whole region.
 * - A Beat that doesn't start in the map (beat-start.ts) runs no reveals; one an earlier Beat that
 *   does start already explores is no loss.
 * The layout checker still counts every reveal.
 */
export function revealWarnings(blueprint: RevealsBlueprint): string[] {
  const compiled: RevealShape[] = [];
  return blueprint.beats.flatMap((beat) => {
    const shapes = distinct(beat.reveals).map((reveal) => revealShape(blueprint, reveal));
    if (beatStart(blueprint, beat.id) !== undefined) {
      compiled.push(...shapes);
      return shapes.flatMap((shape) => {
        const name = zoneNameOf(blueprint, shape.zoneId);
        if (shape.kind === "region") {
          return shape.thin
            ? [`Beat ${beat.id} reveals ${name} with no point chosen, and no circle fits inside the Zone, so it explores the Zone's whole region: place a point Anchor and give the reveal \`at\` (and a \`radius\`)`]
            : [];
        }
        if (shape.anchorId !== undefined) return [];
        return [
          `Beat ${beat.id} reveals ${name} with no point chosen, so it explores the widest circle inside the Zone, at (${shape.center!.x}, ${shape.center!.y}) with radius ${shape.radius}: place a point Anchor and give the reveal \`at\` (and a \`radius\`)`,
        ];
      });
    }
    const lost = [...new Set(shapes.filter((shape) => !compiled.some((done) => covers(blueprint, done, shape))).map((shape) => shape.zoneId))];
    return lost.length > 0
      ? [
          `Beat ${beat.id} reveals ${lost.map((zoneId) => zoneNameOf(blueprint, zoneId)).join(", ")}, but it has no startsWhen, so nothing starts it and those reveals aren't compiled: give it a startsWhen, or reveal them from a Beat that has one`,
        ]
      : [];
  });
}

/**
 * Beside Kept terrain the package keeps its own MapInfo, so its Unexplored Areas is the author's,
 * read from `keptFog`, whatever the Blueprint says. Two warnings:
 * - a Blueprint that sets `unexploredAreas` to other than the package's: the compile doesn't write
 *   it, so the author sets the Editor's to match, or the Blueprint's (an imported value the author
 *   has since changed in the Editor, say, which sync can't bring back beside Kept terrain);
 * - with `reveals` (the Beats' reveals compiled), under Grey Mask (neither of the Black Masks) an
 *   explore shows nothing new, and only the ping is seen.
 */
export function keptMaskWarnings(blueprint: Pick<MissionBlueprint, "beats" | "unexploredAreas">, keptFog: string, { reveals = true }: { readonly reveals?: boolean } = {}): string[] {
  const wanted = blueprint.unexploredAreas;
  const kept = unexploredAreasOf(keptFog);
  const fix = kept ? `set unexploredAreas to "${kept}"` : "remove unexploredAreas";
  return [
    ...(wanted !== undefined && MAPINFO_FOG[wanted] !== keptFog
      ? [`The Blueprint asks for Unexplored Areas ${labelOf(wanted)}, but beside Kept terrain the package keeps its own, ${fogLabelOf(keptFog)}: set ${labelOf(wanted)} in the Editor (Map > Map Options), or ${fix} to match the package`]
      : []),
    ...(reveals && !isBlackMask(keptFog) && blueprint.beats.some((beat) => beat.reveals.length > 0)
      ? [`The package's Map Options keep Unexplored Areas at ${fogLabelOf(keptFog)}, so its Beats' reveals only ping the minimap: set it to Black Mask in the Editor (Map > Map Options) to start the Mission black`]
      : []),
  ];
}
