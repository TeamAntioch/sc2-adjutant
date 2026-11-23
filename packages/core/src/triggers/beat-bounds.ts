// A Beat's camera bounds and playable area (ADR-0015), compiled beside its reveals (beat-reveals.ts).
// Blizzard's campaign maps stage a mission's areas with Set Playable Map Area (`RegionPlayableMapSet`,
// 44 of 51 maps), opening the whole map round a cutscene; one Kept map's stealth section bounds
// the camera instead (`CameraSetBounds`, minimap on), one rectangle per area, with the box round two
// areas, minimap off, while a locked camera pans between them. A Beat's `playable` and `camera` say
// the same, and hold from it until a later Beat's: every Beat that starts in the map from the first
// that sets them sets them again as it starts, so a Beat the mission skips leaves nothing stale. An
// area given by Zones or as a rectangle is written as a bounds region, which the triggers name and
// sync brings back redrawn; a Zone's trigger region or a Kept region is used as it is.

import type { BoundsArea, BoundsRect, MissionBlueprint } from "../domain/mission-blueprint.js";
import { assumedPlayableBounds, boxOf, type Rect, rectText, roundIn, roundOut, union } from "../map/map-bounds.js";
import { regionBounds } from "../map/read-regions-xml.js";
import { type RegionSource, regionsBeforeBounds, type WrittenRegion } from "../map/write-regions-xml.js";
import { beatStart } from "./beat-start.js";
import { regionValueOf, zoneNameOf } from "./kept-ids.js";
import { call, callValue } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "./trigger-catalog.js";
import type { TriggerCall, TriggerParam } from "./trigger-model.js";
import { waveWarningRegions } from "./wave-triggers.js";

type BoundsBlueprint = Pick<MissionBlueprint, "beats" | "zones" | "kept" | "mapSize" | "bounds">;

export type BoundsRole = "playable" | "camera" | "transition";

/**
 * Where an area is: a region by id (a Zone's trigger region, or a Kept region, whose rectangle the
 * Blueprint doesn't know), a bounds region the compile writes (its place among them), or one of the
 * natives' own: the playable area as it stands, or the whole map.
 */
export type ResolvedArea =
  | { readonly kind: "region"; readonly id: string; readonly rect?: Rect }
  | { readonly kind: "bounds"; readonly index: number; readonly rect: Rect }
  | { readonly kind: "playable"; readonly rect: Rect }
  | { readonly kind: "entire"; readonly rect: Rect };

/** The bounds that hold during a Beat, and whether the Beat sets them itself. */
export type BeatBounds = {
  readonly beatId: string;
  /** Whether the Beat starts in the map (beat-start.ts): only one that does runs anything. */
  readonly starts: boolean;
  /** The playable area: MapInfo's (`playable`, as it stands) until a Beat sets one. */
  readonly playable: ResolvedArea;
  /** Where the camera may aim: the playable area until a Beat sets bounds. */
  readonly camera: ResolvedArea;
  readonly minimap: boolean;
  /**
   * The wider bounds set while the Beat's start scenes pan, when it asks for one: a bounds region
   * (`index`), or the playable area as it stands when the camera was bounded by nothing narrower.
   */
  readonly transition?: { readonly index: number; readonly rect: Rect } | { readonly playable: true; readonly rect: Rect };
  /**
   * Whether this Beat or an earlier one has set a playable area, or camera bounds, so its trigger
   * sets them again as it starts. Until one does, the map's stand: the playable area isn't set to
   * itself, which would round MapInfo's rectangle to even cells.
   */
  readonly setsPlayable: boolean;
  readonly setsCamera: boolean;
};

export type BoundsPlan = {
  readonly beats: readonly BeatBounds[];
  /** The bounds regions, in the order they're written. */
  readonly regions: readonly (WrittenRegion & { readonly rect: Rect; readonly source: Extract<RegionSource, { kind: "bounds" }> })[];
  readonly warnings: readonly string[];
};

const ROLE_NAMES: Readonly<Record<BoundsRole, string>> = { playable: "Playable", camera: "Camera", transition: "Transition" };

/** The rectangle of a Zone's trigger region: the box round its drawn shapes, else round its polygon. */
function zoneRegionRect(zone: MissionBlueprint["zones"][number]): Rect {
  const added = zone.region?.shapes.filter((shape) => !shape.negative) ?? [];
  return added.length > 0 ? regionBounds(added) : boxOf([zone.polygon])!;
}

const plans = new WeakMap<object, BoundsPlan>();

/** Each Beat's bounds and the regions they need, worked out once per Blueprint. */
export function boundsPlan(blueprint: BoundsBlueprint): BoundsPlan {
  const known = plans.get(blueprint);
  if (known) return known;
  const made = planBounds(blueprint);
  plans.set(blueprint, made);
  return made;
}

function planBounds(blueprint: BoundsBlueprint): BoundsPlan {
  const { width, height } = blueprint.mapSize;
  const regions: BoundsPlan["regions"][number][] = [];
  const warnings: string[] = [];
  const mapPlayable: ResolvedArea = { kind: "playable", rect: assumedPlayableBounds(blueprint) };
  const addRegion = (beat: MissionBlueprint["beats"][number], role: BoundsRole, rect: Rect): number => {
    regions.push({ name: `Bounds ${beat.title} ${ROLE_NAMES[role]}`, shapes: [{ type: "rect", quad: [...rect] as [number, number, number, number] }], rect, source: { kind: "bounds", beatId: beat.id, role } });
    return regions.length - 1;
  };
  const resolve = (beat: MissionBlueprint["beats"][number], role: "playable" | "camera", area: BoundsArea): ResolvedArea => {
    if (typeof area === "string") {
      const zone = blueprint.zones.find((candidate) => candidate.id === area);
      if (!zone) return { kind: "region", id: area };
      const drawn = zoneRegionRect(zone);
      if (role === "playable" && drawn.some((value) => value % 2 !== 0)) {
        // The game rounds it; the plan reads the rounded area, so the checks and the Waves' spawns see what plays.
        warnings.push(`Beat ${beat.id}'s playable area is ${zone.name}'s trigger region ${rectText(drawn)}, whose edges are off the even cells, and Set Playable Map Area rounds them to the nearest even cell edge, so the checks read it as ${rectText(roundIn(drawn))}, all it is sure to keep: give [${JSON.stringify(zone.id)}] for the box round the Zone rounded out to even cells, or an even rectangle`);
        return { kind: "region", id: area, rect: roundIn(drawn) };
      }
      return { kind: "region", id: area, rect: drawn };
    }
    if (typeof area[0] === "string") {
      const zones = (area as readonly string[]).flatMap((zoneId) => blueprint.zones.filter((zone) => zone.id === zoneId));
      // The game rounds a playable area to even cells; the camera's is kept to whole ones.
      const rect = clampToMap(roundOut(boxOf(zones.map((zone) => zone.polygon))!, role === "playable" ? 2 : 1));
      return { kind: "bounds", index: addRegion(beat, role, rect), rect };
    }
    const rect = area as BoundsRect;
    if (role === "playable" && rect.some((value) => value % 2 !== 0)) {
      warnings.push(`Beat ${beat.id}'s playable area ${rectText(rect)} has edges off the even cells, and Set Playable Map Area rounds them to the nearest even cell edge, so the checks read it as ${rectText(roundIn(rect))}, all it is sure to keep: give ${rectText(roundOut(rect, 2))} or ${rectText(roundIn(rect))} (the even rectangle you mean) so the map plays as written`);
      return { kind: "bounds", index: addRegion(beat, role, rect), rect: roundIn(rect) };
    }
    return { kind: "bounds", index: addRegion(beat, role, rect), rect };
  };
  const clampToMap = ([left, bottom, right, top]: Rect): Rect => [Math.max(0, left), Math.max(0, bottom), Math.min(width, right), Math.min(height, top)];

  const beats: BeatBounds[] = [];
  let playable: ResolvedArea = mapPlayable;
  let camera: ResolvedArea = mapPlayable;
  let minimap = true;
  let setsPlayable = false;
  let setsCamera = false;
  for (const beat of blueprint.beats) {
    const starts = beatStart(blueprint, beat.id) !== undefined;
    const declares = beat.camera !== undefined || beat.playable !== undefined;
    if (declares && !starts) {
      warnings.push(`Beat ${beat.id} sets ${[beat.playable !== undefined && "a playable area", beat.camera && "camera bounds"].filter(Boolean).join(" and ")}, but it has no startsWhen, so nothing starts it and they aren't compiled: give it a startsWhen, or set them on a Beat that has one`);
      beats.push({ beatId: beat.id, starts, playable, camera, minimap, setsPlayable, setsCamera });
      continue;
    }
    let transition: BeatBounds["transition"];
    if (beat.playable !== undefined) {
      playable = beat.playable === "entire" ? { kind: "entire", rect: [0, 0, width, height] } : resolve(beat, "playable", beat.playable);
      // With no camera bounds of its own, the camera follows the new playable area, as the game moves
      // it: an earlier Beat's camera bounds end here, and the minimap goes back to the whole area.
      if (!beat.camera) {
        camera = { kind: "playable", rect: playable.rect ?? mapPlayable.rect };
        minimap = true;
      }
    }
    if (beat.camera) {
      const before = camera;
      camera = beat.camera.bounds === "playable" ? { kind: "playable", rect: playable.rect ?? mapPlayable.rect } : resolve(beat, "camera", beat.camera.bounds);
      minimap = beat.camera.minimap ?? true;
      const wanted = beat.camera.transition;
      if (Array.isArray(wanted)) transition = { index: addRegion(beat, "transition", wanted as Rect), rect: wanted as Rect };
      else if (wanted === true) {
        // From or to the playable area itself, the box round both is the playable area, as it stands then.
        if (before.kind === "playable" || camera.kind === "playable") transition = { playable: true, rect: playable.rect ?? mapPlayable.rect };
        else if (before.rect === undefined || camera.rect === undefined) {
          const unknown = before.rect === undefined ? before : camera;
          warnings.push(`Beat ${beat.id}'s camera transition is the box round the last camera bounds and its own, but ${unknown.kind === "region" ? zoneNameOf(blueprint, unknown.id) : "one"} is a Kept region whose rectangle the Blueprint doesn't know, so no transition is compiled: give camera.transition as a rectangle`);
        } else {
          const rect = union(before.rect, camera.rect);
          transition = { index: addRegion(beat, "transition", rect), rect };
        }
      }
    }
    setsPlayable ||= beat.playable !== undefined;
    setsCamera ||= beat.camera !== undefined;
    beats.push({ beatId: beat.id, starts, playable, camera, minimap, ...(transition ? { transition } : {}), setsPlayable, setsCamera });
  }
  return { beats, regions, warnings };
}

/** The bounds regions the compile writes, after every other region (missionRegions). */
export function boundsRegions(blueprint: BoundsBlueprint): (WrittenRegion & { readonly source: RegionSource })[] {
  return boundsPlan(blueprint).regions.map(({ rect: _rect, ...region }) => region);
}

/**
 * The place the triggers give the first bounds region, provisionally: after every other region
 * missionRegions writes, as counted from the Blueprint. Each bounds region value also carries its
 * place among the bounds regions (`bounds`), and the compile names the region by that, from the
 * regions it wrote (renumberRegions), so a count that's off can't misname one.
 */
const firstBoundsPlace = (blueprint: MissionBlueprint): number => regionsBeforeBounds(blueprint, waveWarningRegions(blueprint).length) + 1;

/** What the compile reports about the Beats' bounds. */
export const boundsWarnings = (blueprint: BoundsBlueprint): readonly string[] => boundsPlan(blueprint).warnings;

/** The bounds that hold during the Beat `beatId`. */
export function beatBoundsOf(blueprint: BoundsBlueprint, beatId: string): BeatBounds {
  const found = boundsPlan(blueprint).beats.find((bounds) => bounds.beatId === beatId);
  if (!found) throw new Error(`Unknown beat id: ${beatId}`);
  return found;
}

/**
 * The Beats from `fromBeatId` until (not including) `untilBeatId`, or to the last, that start in the
 * map, with the playable area each holds: what a Wave streaming over them sends into.
 */
export function beatsDuring(blueprint: BoundsBlueprint, fromBeatId: string, untilBeatId?: string): BeatBounds[] {
  const { beats } = boundsPlan(blueprint);
  const from = beats.findIndex((bounds) => bounds.beatId === fromBeatId);
  const until = untilBeatId === undefined ? -1 : beats.findIndex((bounds) => bounds.beatId === untilBeatId);
  if (from < 0) return [];
  return beats.slice(from, until > from ? until : undefined).filter((bounds, index) => index === 0 || bounds.starts);
}

/** A Beat's bounds as actions: those its trigger runs as it starts, and those once its start scenes hand back. */
export type BeatBoundsActions = { readonly start: TriggerCall[]; readonly settled: TriggerCall[] };

/**
 * The actions that set the bounds holding from Beat `beatId`: Set Playable Map Area, then Set
 * Camera Bounds for all players, as it starts, each once this Beat or an earlier one has set it;
 * with a transition, the camera's are the wider rectangle then, minimap left as it is, and the
 * Beat's own once its start scenes have handed back. None for a Beat before any sets bounds, or one
 * that doesn't start in the map.
 */
export function beatBounds(blueprint: MissionBlueprint, beatId: string): BeatBoundsActions {
  const bounds = beatBoundsOf(blueprint, beatId);
  if (!bounds.starts || (!bounds.setsPlayable && !bounds.setsCamera)) return { start: [], settled: [] };
  const first = firstBoundsPlace(blueprint);
  const path = `beats/${beatId}/bounds`;
  const region = (area: ResolvedArea, at: string): TriggerParam["value"] => {
    switch (area.kind) {
      case "region":
        return regionValueOf(blueprint, area.id);
      case "bounds":
        return { kind: "region", regionId: first + area.index, bounds: area.index };
      case "playable":
        return callValue(at, F.regionPlayableMap, {});
      case "entire":
        return callValue(at, F.entireMap, {});
    }
  };
  const setCamera = (at: string, value: TriggerParam["value"], minimap: boolean): TriggerCall =>
    call(at, F.cameraSetBounds, { players: callValue(`${at}/players`, F.allPlayers, {}), region: value, minimap: { kind: "preset", preset: minimap ? P.do : P.doNot } });
  const start = bounds.setsPlayable ? [call(`${path}/playable`, F.regionPlayableMapSet, { region: region(bounds.playable, `${path}/playable/region`) })] : [];
  if (!bounds.setsCamera) return { start, settled: [] };
  const own = setCamera(`${path}/camera`, region(bounds.camera, `${path}/camera/region`), bounds.minimap);
  if (!bounds.transition) return { start: [...start, own], settled: [] };
  const wide: TriggerParam["value"] = "index" in bounds.transition ? { kind: "region", regionId: first + bounds.transition.index, bounds: bounds.transition.index } : callValue(`${path}/transition/region`, F.regionPlayableMap, {});
  return { start: [...start, setCamera(`${path}/transition`, wide, false)], settled: [own] };
}
