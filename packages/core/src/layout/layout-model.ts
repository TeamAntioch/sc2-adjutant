// Facts the level-design checker derives from a blueprint (docs/adr/0003): which zone owns each
// cell, which zones border and overlook each other, the crossing graph, which zones each side
// holds, the player's start, the places the mission's goals send the player, where threats sit,
// and ground routes on the cell grid with their travel times.

import { type Archetype, isPlaced, type MissionBlueprint, type OutcomeCondition, revealedZoneIds } from "../domain/mission-blueprint.js";
import type { Footprint, Threat } from "../domain/threat.js";
import { cellOwners, type Point } from "../terrain/rasterize.js";
import { type ConnectionChange, missionConnectionChanges } from "./connection-changes.js";
import { alwaysActiveAt, mayBeActiveAt } from "./schedules.js";
import { enemyThreats, missionThreats } from "./threats.js";

/**
 * Reference ground speed in cells per second: a marine at Faster game speed. Distances on the
 * four calibration missions came out at 30–60 s between base and goals.
 */
export const REFERENCE_SPEED = 3.15;

type Zone = MissionBlueprint["zones"][number];
type ConnectionType = Zone["connections"][number]["type"];

export type ZoneFacts = {
  readonly zone: Zone;
  /** Cells the zone ends up owning; later zones win where polygons overlap. */
  readonly cells: number;
  readonly centroid: Point;
};

export type Border = {
  readonly a: string;
  readonly b: string;
  /** Count of cell edges the two zones share. */
  readonly length: number;
  readonly midpoint: Point;
};

/** A traversable direction across a declared connection. */
export type Crossing = {
  readonly from: string;
  readonly to: string;
  readonly type: ConnectionType;
  readonly oneWay: boolean;
  /** Where the crossing sits, from either side's listing; units cross only near it. */
  readonly at?: Point;
  readonly width?: number;
};

/** Somewhere the mission's goals send the player. */
export type Goal = {
  readonly zoneId: string;
  /** A target to reach inside the zone (an anchor to kill); without it, reaching the zone is enough. */
  readonly point?: Point;
  /** e.g. "objective reach_temple" or "victory". */
  readonly source: string;
  /** Index of the beat the goal belongs to; victory goals take the last beat. */
  readonly beatIndex: number;
  /** A timer goal: hold the start until it runs out, with nowhere to go. */
  readonly hold?: true;
  /**
   * A unit other than the player's start unit that must reach the zone (an escorted convoy, a unit
   * the player gets later): the goal is routed from it, at its speed when the anchor declares one.
   */
  readonly from?: { readonly anchorId: string; readonly zoneId: string; readonly point: Point; readonly speed?: number };
};

export type LayoutModel = {
  readonly blueprint: MissionBlueprint;
  readonly zones: ReadonlyMap<string, ZoneFacts>;
  /** Owning zone index per cell (row-major, y up), or -1. */
  readonly owner: Int32Array;
  readonly borders: readonly Border[];
  readonly crossings: readonly Crossing[];
  /** Zones each zone sees: lower zones it borders plus its declared overlooks. */
  readonly overlooks: ReadonlyMap<string, ReadonlySet<string>>;
  readonly beatIndex: ReadonlyMap<string, number>;
  readonly startZoneId: string | undefined;
  readonly startPoint: Point | undefined;
  /** How the start was found, for reports. */
  readonly startReason: string;
  readonly goals: readonly Goal[];
  /** Anchors whose loss fails the mission, with the zone each starts in. */
  readonly criticalAnchors: readonly { readonly anchorId: string; readonly zoneId: string }[];
  /**
   * Everything that makes part of the Mission unsafe (ADR-0006): encounters, enemy groups, waves
   * and Mechanics. A function, derived on its first call and kept, error and all, so a Plugin's
   * threats hook runs once and only for the checks; copying or serializing the model runs nothing.
   */
  readonly threats: () => readonly Threat[];
  /** How Connections change on Schedules (ADR-0006): the Blueprint's `opensAtBeat` and `closesAtBeat`, then each Mechanic's. */
  readonly connectionChanges: readonly ConnectionChange[];
  /**
   * Enemy bases: `base` zones other than the start holding an encounter group or a unit of
   * another player. Player routes treat them as walls unless there's no way round.
   */
  readonly enemyHeldZoneIds: ReadonlySet<string>;
  /** The beat index from which each enemy base is held: 0, or later when every group there is passive until then. */
  readonly enemyHeldFromBeat: ReadonlyMap<string, number>;
  /** The player's held region: the start plus the base and refuge zones joined to it through each other. */
  readonly playerRegionZoneIds: ReadonlySet<string>;
  /** Each beat's archetype: the latest beat to declare one, else the blueprint's. */
  readonly archetypes: readonly (Archetype | undefined)[];
};

export function buildLayoutModel(blueprint: MissionBlueprint): LayoutModel {
  const { width, height } = blueprint.mapSize;
  // Cells as the terrain draws them, natural zones' outlines ragged (terrain/ragged-outlines.ts).
  const owner = cellOwners(blueprint);

  const sums = blueprint.zones.map(() => ({ cells: 0, x: 0, y: 0 }));
  const borderSums = new Map<string, { a: number; b: number; length: number; x: number; y: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = owner[y * width + x]!;
      if (here < 0) continue;
      const sum = sums[here]!;
      sum.cells += 1;
      sum.x += x + 0.5;
      sum.y += y + 0.5;
      // Each shared cell edge counted once, from its left or lower cell.
      for (const [nx, ny, ex, ey] of [
        [x + 1, y, x + 1, y + 0.5],
        [x, y + 1, x + 0.5, y + 1],
      ] as const) {
        if (nx >= width || ny >= height) continue;
        const there = owner[ny * width + nx]!;
        if (there < 0 || there === here) continue;
        const [a, b] = here < there ? [here, there] : [there, here];
        const key = `${a}:${b}`;
        const border = borderSums.get(key) ?? { a, b, length: 0, x: 0, y: 0 };
        border.length += 1;
        border.x += ex;
        border.y += ey;
        borderSums.set(key, border);
      }
    }
  }

  const zones = new Map<string, ZoneFacts>();
  blueprint.zones.forEach((zone, zoneIndex) => {
    const sum = sums[zoneIndex]!;
    const centroid =
      sum.cells > 0
        ? { x: sum.x / sum.cells, y: sum.y / sum.cells }
        : {
            x: zone.polygon.reduce((total, point) => total + point.x, 0) / zone.polygon.length,
            y: zone.polygon.reduce((total, point) => total + point.y, 0) / zone.polygon.length,
          };
    zones.set(zone.id, { zone, cells: sum.cells, centroid });
  });

  const borders = [...borderSums.values()].map(({ a, b, length, x, y }) => ({
    a: blueprint.zones[a]!.id,
    b: blueprint.zones[b]!.id,
    length,
    midpoint: { x: x / length, y: y / length },
  }));

  const crossings: Crossing[] = [];
  const seenPairs = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      const pair = [zone.id, connection.toZoneId].sort().join("|");
      if (connection.oneWay) {
        crossings.push(crossingOf(zone.id, connection));
        continue;
      }
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const reverse = blueprint.zones
        .find((other) => other.id === connection.toZoneId)
        ?.connections.find((candidate) => candidate.toZoneId === zone.id && !candidate.oneWay);
      const crossing = crossingOf(zone.id, connection, reverse);
      crossings.push(crossing, { ...crossing, from: connection.toZoneId, to: zone.id });
    }
  }

  const overlooks = new Map<string, Set<string>>(blueprint.zones.map((zone) => [zone.id, new Set(zone.overlooks)]));
  for (const border of borders) {
    const a = zones.get(border.a)!.zone;
    const b = zones.get(border.b)!.zone;
    if (a.elevation > b.elevation) overlooks.get(a.id)!.add(b.id);
    if (b.elevation > a.elevation) overlooks.get(b.id)!.add(a.id);
  }

  const beatIndex = new Map(blueprint.beats.map((beat, index) => [beat.id, index]));
  const anchorById = new Map(blueprint.anchors.map((anchor) => [anchor.id, anchor]));

  const playerUnit = blueprint.anchors.filter(isPlaced).find((anchor) => anchor.kind === "unit" && anchor.player === 1);
  const firstBeatZone = blueprint.beats[0]?.zoneIds[0];
  const [startZoneId, startPoint, startReason] = playerUnit
    ? [playerUnit.zoneId, { x: playerUnit.position.x, y: playerUnit.position.y }, `player 1's first unit (${playerUnit.id}) starts there`]
    : firstBeatZone
      ? [firstBeatZone, zones.get(firstBeatZone)?.centroid, "the first beat's first zone (no player 1 unit anchor)"]
      : [undefined, undefined, "no player 1 unit anchor and the first beat lists no zones"];

  // A resource field counts from the first beat that names or reveals its zone.
  const firstShown = (zoneId: string): number | undefined => {
    const index = blueprint.beats.findIndex((beat) => beat.zoneIds.includes(zoneId) || revealedZoneIds(beat).includes(zoneId));
    return index >= 0 ? index : undefined;
  };
  type Target = Pick<Goal, "zoneId" | "point" | "hold" | "from"> & { readonly beatIndex?: number };
  const conditionTargets = (condition: OutcomeCondition): Target[] => {
    switch (condition.type) {
      case "anchorEntersZone": {
        const mover = anchorById.get(condition.anchorId);
        // A Wave's unit has no place to set off from but the Wave's.
        if (!mover || !isPlaced(mover) || mover.id === playerUnit?.id) return [{ zoneId: condition.zoneId }];
        const from = {
          anchorId: mover.id,
          zoneId: mover.zoneId,
          point: { x: mover.position.x, y: mover.position.y },
          ...(mover.speed !== undefined ? { speed: mover.speed } : {}),
        };
        return [{ zoneId: condition.zoneId, from }];
      }
      case "anchorDies":
      case "anchorCaptured": {
        const anchor = anchorById.get(condition.anchorId);
        if (!anchor) return [];
        return isPlaced(anchor) ? [{ zoneId: anchor.zoneId, point: { x: anchor.position.x, y: anchor.position.y } }] : [{ zoneId: anchor.zoneId }];
      }
      case "timer":
        return startZoneId ? [{ zoneId: startZoneId, hold: true }] : [];
      // Where its Objectives send the player is already their own goals'.
      case "objectivesComplete":
        return [];
      case "resourceQuota": {
        const fields = [...new Set(blueprint.placements.filter((placement) => placement.kind === "resource-base").map((placement) => placement.zoneId))];
        return fields.map((zoneId) => {
          const shown = firstShown(zoneId);
          return shown === undefined ? { zoneId } : { zoneId, beatIndex: shown };
        });
      }
    }
  };
  const goals: Goal[] = [];
  for (const objective of blueprint.objectives) {
    if (objective.type !== "primary") continue;
    const index = beatIndex.get(objective.beatId) ?? 0;
    const targets = objective.completeWhen ? conditionTargets(objective.completeWhen) : [];
    if (targets.length > 0) {
      for (const target of targets) goals.push({ beatIndex: index, ...target, source: `objective ${objective.id}` });
      continue;
    }
    // Without a completion condition, the beat's objective-role zones stand in for the goal.
    for (const zoneId of blueprint.beats[index]?.zoneIds ?? []) {
      if (zones.get(zoneId)?.zone.role === "objective") {
        goals.push({ zoneId, source: `objective ${objective.id} (from its beat)`, beatIndex: index });
      }
    }
  }
  for (const condition of blueprint.outcomes.victory) {
    // A victory condition on a player's own unit dying isn't a place to go.
    if (condition.type === "anchorDies" && anchorById.get(condition.anchorId)?.player === 1) continue;
    for (const target of conditionTargets(condition)) {
      if (!goals.some((goal) => goal.zoneId === target.zoneId)) {
        goals.push({ beatIndex: Math.max(0, blueprint.beats.length - 1), ...target, source: "victory" });
      }
    }
  }

  // Units whose death is a defeat condition, then the units `fail` Threats are after (the flare's hero).
  const criticalAnchorsOf = (threats: readonly Threat[]): LayoutModel["criticalAnchors"] => {
    const criticalIds = new Set(
      blueprint.outcomes.defeat.filter((condition) => condition.type === "anchorDies").map((condition) => condition.anchorId),
    );
    for (const threat of threats) if (threat.consequence === "fail" && threat.anchorId !== undefined) criticalIds.add(threat.anchorId);
    return [...criticalIds].filter((anchorId) => anchorById.has(anchorId)).map((anchorId) => ({ anchorId, zoneId: anchorById.get(anchorId)!.zoneId }));
  };

  // Each zone's earliest beat with an enemy in it: an enemy group's Threat from its beat (a passive
  // group's from the beat it wakes), or another player's unit from the start.
  const enemyFromBeat = new Map<string, number>();
  const earliest = (zoneId: string, beat: number) => enemyFromBeat.set(zoneId, Math.min(beat, enemyFromBeat.get(zoneId) ?? Infinity));
  for (const threat of enemyThreats(blueprint)) {
    if (threat.source.kind !== "enemy group" || threat.schedule.kind !== "from-beat") continue;
    for (const zoneId of "zoneIds" in threat.footprint ? threat.footprint.zoneIds : []) earliest(zoneId, beatIndex.get(threat.schedule.beatId)!);
  }
  for (const anchor of blueprint.anchors) {
    // A Wave's unit (no position) isn't there from the start; its Wave is the threat.
    if (anchor.kind === "unit" && isPlaced(anchor) && anchor.player !== undefined && anchor.player !== 1) earliest(anchor.zoneId, 0);
  }
  const enemyHeldFromBeat = new Map(
    blueprint.zones
      .filter((zone) => zone.role === "base" && zone.id !== startZoneId && enemyFromBeat.has(zone.id))
      .map((zone) => [zone.id, enemyFromBeat.get(zone.id)!]),
  );
  const enemyHeldZoneIds = new Set(enemyHeldFromBeat.keys());

  const playerRegionZoneIds = new Set<string>();
  if (startZoneId) {
    const queue = [startZoneId];
    playerRegionZoneIds.add(startZoneId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const crossing of crossings) {
        const next = zones.get(crossing.to)?.zone;
        if (crossing.from !== current || crossing.type === "air-only" || !next || playerRegionZoneIds.has(next.id)) continue;
        if ((next.role === "base" || next.role === "refuge") && !enemyHeldZoneIds.has(next.id)) {
          playerRegionZoneIds.add(next.id);
          queue.push(next.id);
        }
      }
    }
  }

  let current = blueprint.archetype;
  const archetypes = blueprint.beats.map((beat) => (current = beat.archetype ?? current));

  let threats: { readonly value: readonly Threat[] } | { readonly error: unknown } | undefined;
  let connectionChanges: readonly ConnectionChange[] | undefined;
  let criticalAnchors: LayoutModel["criticalAnchors"] | undefined;
  const model: LayoutModel = {
    blueprint,
    zones,
    owner,
    borders,
    crossings,
    overlooks,
    beatIndex,
    startZoneId,
    startPoint,
    startReason,
    goals,
    // Derived on first read, so a Plugin's hooks run only for the checks, not for dressing.
    get criticalAnchors() {
      return (criticalAnchors ??= criticalAnchorsOf(model.threats()));
    },
    threats: () => {
      if (!threats) {
        try {
          threats = { value: missionThreats(blueprint, (zoneId) => reachableFrom(model, zoneId)) };
        } catch (error) {
          threats = { error };
        }
      }
      if ("error" in threats) throw threats.error;
      return threats.value;
    },
    get connectionChanges() {
      return (connectionChanges ??= missionConnectionChanges(blueprint));
    },
    enemyHeldZoneIds,
    enemyHeldFromBeat,
    playerRegionZoneIds,
    archetypes,
  };
  return model;
}

function crossingOf(from: string, connection: Zone["connections"][number], reverse?: Zone["connections"][number]): Crossing {
  const at = connection.at ?? reverse?.at;
  const width = connection.width ?? reverse?.width;
  return {
    from,
    to: connection.toZoneId,
    type: connection.type,
    oneWay: connection.oneWay ?? false,
    ...(at !== undefined ? { at: { x: at.x, y: at.y } } : {}),
    ...(width !== undefined ? { width } : {}),
  };
}

/** Lane width when a crossing at a point doesn't declare one: a ramp's 8 cells. */
const DEFAULT_CROSSING_WIDTH = 8;

type Window = { readonly at: Point; readonly radius: number };

/**
 * The circle a crossing with `at` may be walked through: half its width, plus 2 cells because the
 * sketched polygons and the ramp's 2-cell corner grid don't line up exactly. An open crossing
 * without a width isn't narrowed.
 */
export function crossingWindow(crossing: Crossing): Window | undefined {
  if (crossing.at === undefined) return undefined;
  if (crossing.type === "open" && crossing.width === undefined) return undefined;
  return { at: crossing.at, radius: (crossing.width ?? DEFAULT_CROSSING_WIDTH) / 2 + 2 };
}

const inWindow = (window: Window, cell: number, width: number): boolean =>
  Math.hypot((cell % width) + 0.5 - window.at.x, Math.floor(cell / width) + 0.5 - window.at.y) <= window.radius;

/** Whether the zones' shared border passes through the crossing's window (always, without one). */
export function windowOnBorder(model: LayoutModel, crossing: Crossing): boolean {
  const window = crossingWindow(crossing);
  if (!window) return true;
  const { width, height } = model.blueprint.mapSize;
  const indexOf = new Map(model.blueprint.zones.map((zone, index) => [zone.id, index]));
  const a = indexOf.get(crossing.from)!;
  const b = indexOf.get(crossing.to)!;
  const r = Math.ceil(window.radius);
  for (let y = Math.max(0, Math.floor(window.at.y) - r); y <= Math.min(height - 1, Math.floor(window.at.y) + r); y++) {
    for (let x = Math.max(0, Math.floor(window.at.x) - r); x <= Math.min(width - 1, Math.floor(window.at.x) + r); x++) {
      const cell = y * width + x;
      if (model.owner[cell] !== a || !inWindow(window, cell, width)) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (model.owner[ny * width + nx] === b && inWindow(window, ny * width + nx, width)) return true;
        }
      }
    }
  }
  return false;
}

/** Enemy bases held by the given beat: passive groups don't hold theirs until their beat. */
export function enemyHeldAt(model: LayoutModel, beatIndex: number): Set<string> {
  return new Set([...model.enemyHeldFromBeat].filter(([, from]) => from <= beatIndex).map(([zoneId]) => zoneId));
}

export function borderBetween(model: LayoutModel, a: string, b: string): Border | undefined {
  return model.borders.find((border) => (border.a === a && border.b === b) || (border.a === b && border.b === a));
}

export type TraversalOptions = {
  /** Only crossings open at this beat index; omit to ignore timing. */
  readonly beatIndex?: number;
  /** Include air-only crossings. */
  readonly air?: boolean;
  /** Crossings to treat as gone, as crossingKey()s (both directions are removed). */
  readonly without?: ReadonlySet<string>;
  /** Zones not to enter (a route's own start and goal are always allowed). */
  readonly avoid?: ReadonlySet<string>;
  /** Directions to treat as closed, as directedKey()s (only that direction is removed). */
  readonly closed?: ReadonlySet<string>;
};

export function crossingKey(a: string, b: string): string {
  return [a, b].sort().join(">");
}

/** One direction across a connection, unlike crossingKey(). */
export function directedKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** The changes that apply to a crossing: those naming its two zones, in either order. */
export function changesOn(model: LayoutModel, crossing: Crossing): readonly ConnectionChange[] {
  // Traversals ask for every crossing they step over, so index the changes once per model.
  let byPair = CHANGES_BY_PAIR.get(model);
  if (!byPair) {
    byPair = new Map();
    for (const change of model.connectionChanges) {
      const key = crossingKey(change.fromZoneId, change.toZoneId);
      byPair.set(key, [...(byPair.get(key) ?? []), change]);
    }
    CHANGES_BY_PAIR.set(model, byPair);
  }
  return byPair.get(crossingKey(crossing.from, crossing.to)) ?? [];
}

const CHANGES_BY_PAIR = new WeakMap<LayoutModel, Map<string, readonly ConnectionChange[]>>();

/**
 * Whether the crossing can be walked at some moment of the Beat. An `open` change must be possibly
 * in effect; a `closed` change, or a `one-way` change against this direction, closes it only when
 * it is surely in effect all Beat (a from-a-Beat Schedule): a ford that floods on a cycle still
 * lets the player across between surges.
 */
export function isOpenAt(model: LayoutModel, crossing: Crossing, beatIndex: number): boolean {
  return changesOn(model, crossing).every((change) => {
    switch (change.state) {
      case "open":
        return mayBeActiveAt(model.beatIndex, change.schedule, beatIndex);
      case "closed":
        return !alwaysActiveAt(model.beatIndex, change.schedule, beatIndex);
      case "one-way":
        return change.fromZoneId === crossing.from || !alwaysActiveAt(model.beatIndex, change.schedule, beatIndex);
    }
  });
}

function usable(model: LayoutModel, crossing: Crossing, options: TraversalOptions): boolean {
  if (crossing.type === "air-only" && !options.air) return false;
  if (options.without?.has(crossingKey(crossing.from, crossing.to))) return false;
  if (options.closed?.has(directedKey(crossing.from, crossing.to))) return false;
  if (options.avoid?.has(crossing.to)) return false;
  return options.beatIndex === undefined || isOpenAt(model, crossing, options.beatIndex);
}

export function reachableFrom(model: LayoutModel, start: string, options: TraversalOptions = {}): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const crossing of model.crossings) {
      if (crossing.from !== current || seen.has(crossing.to) || !usable(model, crossing, options)) continue;
      seen.add(crossing.to);
      queue.push(crossing.to);
    }
  }
  return seen;
}

export type Route = {
  /** Zones in the order the route passes through them. */
  readonly zoneIds: readonly string[];
  readonly cells: number;
  readonly seconds: number;
  /** The cells walked, start to goal (row-major indices). */
  readonly path: readonly number[];
};

type Jump = { readonly cell: number; readonly cost: number };

type Steps = {
  /** Whether a unit may step from `cell` (zone `here`) to `next` (zone `there`). */
  readonly canStep: (here: number, there: number, cell: number, next: number) => boolean;
  readonly jumps: Map<number, { from: number; to: number; cost: number }[]>;
};

/**
 * Which zone-to-zone steps the cell grid allows (only through a crossing's window when it has
 * one), and the jumps across bridges between zones that don't touch, keyed by the cell they leave from.
 */
function cellCrossings(model: LayoutModel, options: TraversalOptions): Steps {
  const { width, height } = model.blueprint.mapSize;
  const indexOf = new Map(model.blueprint.zones.map((zone, index) => [zone.id, index]));
  // "a>b" by zone index, to the windows its crossings may be walked through (null: anywhere).
  const allowed = new Map<string, (Window | null)[]>();
  const jumps = new Map<number, { from: number; to: number; cost: number }[]>();
  for (const crossing of model.crossings) {
    if (options.avoid?.has(crossing.from) || !usable(model, crossing, options)) continue;
    const a = indexOf.get(crossing.from)!;
    const b = indexOf.get(crossing.to)!;
    const key = `${a}>${b}`;
    allowed.set(key, [...(allowed.get(key) ?? []), crossingWindow(crossing) ?? null]);
    // Only a bridge spans a gap; any other connection between zones that don't touch can't be walked
    // (terrain-agreement reports it). A bridge with `at` lands on the cells of each zone nearest it.
    if (crossing.type === "bridge" && !borderBetween(model, crossing.from, crossing.to)) {
      const pa = model.zones.get(crossing.from)!.centroid;
      const pb = model.zones.get(crossing.to)!.centroid;
      const pair = crossing.at
        ? bridgeAt(model, a, b, crossing.at)
        : nearestCells(model.owner, width, height, a, b, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
      if (pair) {
        const list = jumps.get(pair.from) ?? [];
        list.push({ from: pair.from, to: pair.to, cost: pair.distance });
        jumps.set(pair.from, list);
      }
    }
  }
  const canStep = (here: number, there: number, cell: number, next: number): boolean => {
    if (here === there) return true;
    const windows = allowed.get(`${here}>${there}`);
    return windows !== undefined && windows.some((window) => window === null || (inWindow(window, cell, width) && inWindow(window, next, width)));
  };
  return { canStep, jumps };
}

function bridgeAt(model: LayoutModel, a: number, b: number, at: Point): { from: number; to: number; distance: number } | undefined {
  const { width } = model.blueprint.mapSize;
  const from = nearestOwnCell(model, a, at);
  const to = nearestOwnCell(model, b, at);
  if (from === undefined || to === undefined) return undefined;
  return { from, to, distance: Math.hypot((from % width) - (to % width), Math.floor(from / width) - Math.floor(to / width)) };
}

/**
 * Ground distance in cells from every cell to the nearest cell of the given zones, along the same
 * moves as groundRoute (so one-way crossings count in the direction a unit would walk them).
 * Infinity where there's no way there.
 */
export function distancesTo(model: LayoutModel, zoneIds: ReadonlySet<string>): Float64Array {
  const { width, height } = model.blueprint.mapSize;
  const indices = new Set(model.blueprint.zones.flatMap((zone, index) => (zoneIds.has(zone.id) ? [index] : [])));
  const { canStep, jumps } = cellCrossings(model, {});
  // Search backwards from the targets: reach a cell by a jump that lands on it.
  const jumpsInto = new Map<number, Jump[]>();
  for (const list of jumps.values()) {
    for (const jump of list) jumpsInto.set(jump.to, [...(jumpsInto.get(jump.to) ?? []), { cell: jump.from, cost: jump.cost }]);
  }
  const distance = new Float64Array(width * height).fill(Infinity);
  const heap = new MinHeap();
  model.owner.forEach((owner, cell) => {
    if (indices.has(owner)) {
      distance[cell] = 0;
      heap.push(cell, 0);
    }
  });
  while (heap.size > 0) {
    const [cell, cost] = heap.pop();
    if (cost > distance[cell]!) continue;
    const here = model.owner[cell]!;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const relax = (next: number, step: number) => {
      if (cost + step < distance[next]!) {
        distance[next] = cost + step;
        heap.push(next, cost + step);
      }
    };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        const there = model.owner[next]!;
        // A unit at `next` would step into `cell`.
        if (there < 0 || !canStep(there, here, next, cell)) continue;
        relax(next, dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      }
    }
    for (const jump of jumpsInto.get(cell) ?? []) relax(jump.cell, jump.cost);
  }
  return distance;
}

/**
 * Shortest ground route on the cell grid from a point in one zone to a goal, crossing between zones
 * only where a usable connection is declared. A bridge between zones that don't touch (over a
 * chasm) jumps between their nearest cells. Moves are 8-way.
 */
export function groundRoute(
  model: LayoutModel,
  from: { readonly zoneId: string; readonly point?: Point },
  to: { readonly zoneId: string; readonly point?: Point },
  options: TraversalOptions = {},
): Route | undefined {
  const { width, height } = model.blueprint.mapSize;
  const zoneIds = model.blueprint.zones.map((zone) => zone.id);
  const indexOf = new Map(zoneIds.map((id, index) => [id, index]));
  const fromIndex = indexOf.get(from.zoneId);
  const toIndex = indexOf.get(to.zoneId);
  if (fromIndex === undefined || toIndex === undefined) return undefined;
  const avoid = new Set([...(options.avoid ?? [])].filter((id) => id !== from.zoneId && id !== to.zoneId));
  const { canStep, jumps } = cellCrossings(model, { ...options, avoid });

  const cellAt = (point: Point) =>
    Math.min(height - 1, Math.max(0, Math.floor(point.y))) * width + Math.min(width - 1, Math.max(0, Math.floor(point.x)));
  // Start at the point when it lies in the start zone, else at the zone cell nearest its centroid.
  const pointCell = from.point ? cellAt(from.point) : -1;
  const startCell =
    pointCell >= 0 && model.owner[pointCell] === fromIndex
      ? pointCell
      : nearestOwnCell(model, fromIndex, from.point ?? model.zones.get(from.zoneId)!.centroid);
  if (startCell === undefined) return undefined;
  const targetCell = to.point ? cellAt(to.point) : undefined;
  const isTarget = (cell: number) => (targetCell !== undefined ? cell === targetCell : model.owner[cell] === toIndex);

  const distance = new Float64Array(width * height).fill(Infinity);
  const previous = new Int32Array(width * height).fill(-1);
  const heap = new MinHeap();
  distance[startCell] = 0;
  heap.push(startCell, 0);
  let reached = -1;
  while (heap.size > 0) {
    const [cell, cost] = heap.pop();
    if (cost > distance[cell]!) continue;
    if (isTarget(cell)) {
      reached = cell;
      break;
    }
    const here = model.owner[cell]!;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const relax = (next: number, step: number) => {
      const total = cost + step;
      if (total < distance[next]!) {
        distance[next] = total;
        previous[next] = cell;
        heap.push(next, total);
      }
    };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        const there = model.owner[next]!;
        if (there < 0 || avoid.has(zoneIds[there]!)) continue;
        if (!canStep(here, there, cell, next)) continue;
        relax(next, dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      }
    }
    for (const jump of jumps.get(cell) ?? []) relax(jump.to, jump.cost);
  }
  if (reached < 0) return undefined;

  const path: string[] = [];
  const cells: number[] = [];
  for (let cell = reached; cell >= 0; cell = previous[cell]!) {
    const zoneId = zoneIds[model.owner[cell]!]!;
    if (path[0] !== zoneId) path.unshift(zoneId);
    cells.unshift(cell);
  }
  return { zoneIds: path, cells: distance[reached]!, seconds: distance[reached]! / REFERENCE_SPEED, path: cells };
}

/**
 * The ground route to a goal from the start (or from the unit that must arrive, at its speed):
 * around enemy-held zones if possible, otherwise through them.
 */
export function playerRoute(
  model: LayoutModel,
  goal: Goal,
  options: TraversalOptions = {},
): (Route & { readonly throughEnemy: readonly string[] }) | undefined {
  const from = goal.from ?? (model.startZoneId ? { zoneId: model.startZoneId, ...(model.startPoint ? { point: model.startPoint } : {}) } : undefined);
  if (!from) return undefined;
  const speed = goal.from?.speed;
  const timed = (route: Route): Route => (speed === undefined ? route : { ...route, seconds: route.cells / speed });
  const held = enemyHeldAt(model, goal.beatIndex);
  const around = groundRoute(model, from, goal, { ...options, avoid: held });
  if (around) return { ...timed(around), throughEnemy: [] };
  const through = groundRoute(model, from, goal, options);
  return through ? { ...timed(through), throughEnemy: through.zoneIds.filter((zoneId) => held.has(zoneId) && zoneId !== goal.zoneId) } : undefined;
}

/** The cells a footprint covers: its zones' cells, or every cell whose centre lies within the radius of the route. */
export function footprintCells(model: LayoutModel, footprint: Footprint): number[] {
  const { width } = model.blueprint.mapSize;
  const cells: number[] = [];
  if ("zoneIds" in footprint) {
    const indices = new Set(model.blueprint.zones.flatMap((zone, index) => (footprint.zoneIds.includes(zone.id) ? [index] : [])));
    model.owner.forEach((owner, cell) => {
      if (indices.has(owner)) cells.push(cell);
    });
    return cells;
  }
  model.owner.forEach((_, cell) => {
    const point = { x: (cell % width) + 0.5, y: Math.floor(cell / width) + 0.5 };
    if (footprint.route.some((b, index) => index > 0 && distanceToSegment(point, footprint.route[index - 1]!, b) <= footprint.radius)) cells.push(cell);
  });
  return cells;
}

/** The zones a footprint reaches: its zones, or those owning a cell under the route's radius, in Blueprint order. */
export function footprintZoneIds(model: LayoutModel, footprint: Footprint): readonly string[] {
  if ("zoneIds" in footprint) return footprint.zoneIds;
  // A route's zones take a pass over the map, and the checks ask zone by zone.
  let cache = ROUTE_ZONES.get(model);
  if (!cache) ROUTE_ZONES.set(model, (cache = new WeakMap()));
  let zoneIds = cache.get(footprint);
  if (!zoneIds) {
    const owners = new Set(footprintCells(model, footprint).map((cell) => model.owner[cell]!));
    zoneIds = model.blueprint.zones.flatMap((zone, index) => (owners.has(index) ? [zone.id] : []));
    cache.set(footprint, zoneIds);
  }
  return zoneIds;
}

/** Each model's route footprints' zones. */
const ROUTE_ZONES = new WeakMap<LayoutModel, WeakMap<Footprint, readonly string[]>>();

/** A route's length in cells. */
export function routeLength(route: readonly Point[]): number {
  return route.reduce((total, point, index) => (index === 0 ? 0 : total + Math.hypot(point.x - route[index - 1]!.x, point.y - route[index - 1]!.y)), 0);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The centre of a cell (row-major index) on a map `width` cells wide. */
export const cellCentre = (cell: number, width: number): Point => ({ x: (cell % width) + 0.5, y: Math.floor(cell / width) + 0.5 });

/** A zone's point: the centre of its cell nearest its centroid, so it lies inside the zone even when the zone isn't convex. */
export function zonePoint(model: LayoutModel, zoneId: string): Point | undefined {
  const zoneIndex = model.blueprint.zones.findIndex((zone) => zone.id === zoneId);
  const facts = model.zones.get(zoneId);
  if (zoneIndex < 0 || !facts) return undefined;
  const cell = nearestOwnCell(model, zoneIndex, facts.centroid);
  return cell === undefined ? undefined : cellCentre(cell, model.blueprint.mapSize.width);
}

/**
 * A zone's deepest cell (ADR 0008): the centre of its cell farthest, walking inside it, from every
 * Connection into it, where a wave can form out of sight. A crossing with `at` is entered at the
 * zone's cell nearest that point, and one without along the whole shared border (or, for a bridge
 * over a gap, at the cell nearest the other zone). The first such cell wins a tie. Only cells whose
 * centre lies `within` the bounds (left, bottom, right, top) count, such as the playable area; there
 * may be none. A zone with no way in is measured from its ways out, and one with neither gives its
 * cell nearest its centroid, within the bounds.
 */
export function deepestCell(model: LayoutModel, zoneId: string, within?: readonly [number, number, number, number]): Point | undefined {
  const { width, height } = model.blueprint.mapSize;
  const indexOf = new Map(model.blueprint.zones.map((zone, index) => [zone.id, index]));
  const zoneIndex = indexOf.get(zoneId);
  if (zoneIndex === undefined) return undefined;
  const inside = (cell: number): boolean => {
    if (!within) return true;
    const { x, y } = cellCentre(cell, width);
    return x >= within[0] && y >= within[1] && x <= within[2] && y <= within[3];
  };
  const seeds = new Set<number>();
  const ways = model.crossings.filter((crossing) => crossing.to === zoneId);
  // The other side of each way in or out, as a crossing into the zone.
  const sides = (ways.length > 0 ? ways : model.crossings.filter((crossing) => crossing.from === zoneId).map((crossing) => ({ ...crossing, from: crossing.to, to: zoneId })));
  for (const crossing of sides) {
    const fromIndex = indexOf.get(crossing.from)!;
    if (crossing.at) {
      const cell = nearestOwnCell(model, zoneIndex, crossing.at);
      if (cell !== undefined) seeds.add(cell);
      continue;
    }
    if (crossing.type === "bridge" && !borderBetween(model, crossing.from, zoneId)) {
      const pair = nearestCells(model.owner, width, height, zoneIndex, fromIndex, model.zones.get(zoneId)!.centroid);
      if (pair) seeds.add(pair.from);
      continue;
    }
    model.owner.forEach((owner, cell) => {
      if (owner !== zoneIndex) return;
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && model.owner[ny * width + nx] === fromIndex) seeds.add(cell);
        }
      }
    });
  }
  if (seeds.size === 0) {
    const centroid = model.zones.get(zoneId)!.centroid;
    let nearest = -1;
    let nearestDistance = Infinity;
    model.owner.forEach((owner, cell) => {
      if (owner !== zoneIndex || !inside(cell)) return;
      const { x, y } = cellCentre(cell, width);
      const d = Math.hypot(x - centroid.x, y - centroid.y);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = cell;
      }
    });
    return nearest < 0 ? undefined : cellCentre(nearest, width);
  }
  const distance = new Float64Array(width * height).fill(Infinity);
  const heap = new MinHeap();
  for (const cell of seeds) {
    distance[cell] = 0;
    heap.push(cell, 0);
  }
  while (heap.size > 0) {
    const [cell, cost] = heap.pop();
    if (cost > distance[cell]!) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        const total = cost + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (model.owner[next] === zoneIndex && total < distance[next]! - 1e-9) {
          distance[next] = total;
          heap.push(next, total);
        }
      }
    }
  }
  let deepest = -1;
  distance.forEach((cells, cell) => {
    if (cells < Infinity && inside(cell) && (deepest < 0 || cells > distance[deepest]! + 1e-9)) deepest = cell;
  });
  return deepest < 0 ? undefined : cellCentre(deepest, width);
}

function nearestOwnCell(model: LayoutModel, zoneIndex: number, point: Point): number | undefined {
  const { width } = model.blueprint.mapSize;
  let best: number | undefined;
  let bestDistance = Infinity;
  model.owner.forEach((owner, cell) => {
    if (owner !== zoneIndex) return;
    const d = Math.hypot((cell % width) + 0.5 - point.x, Math.floor(cell / width) + 0.5 - point.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = cell;
    }
  });
  return best;
}

/**
 * The closest pair of edge cells between two zones that don't touch: where a bridge would sit.
 * Ties go to the pair nearest `centre` (halfway between the zones), so a gap of even width is
 * bridged in the middle, not at a corner.
 */
function nearestCells(
  owner: Int32Array,
  width: number,
  height: number,
  a: number,
  b: number,
  centre: Point,
): { readonly from: number; readonly to: number; readonly distance: number } | undefined {
  const edge = (zoneIndex: number) => {
    const cells: number[] = [];
    owner.forEach((cellOwner, cell) => {
      if (cellOwner !== zoneIndex) return;
      const x = cell % width;
      const y = Math.floor(cell / width);
      const outside = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].some(([nx, ny]) => nx! < 0 || ny! < 0 || nx! >= width || ny! >= height || owner[ny! * width + nx!] !== zoneIndex);
      if (outside) cells.push(cell);
    });
    return cells;
  };
  const offCentre = (p: number, q: number) =>
    Math.hypot(((p % width) + (q % width)) / 2 + 0.5 - centre.x, (Math.floor(p / width) + Math.floor(q / width)) / 2 + 0.5 - centre.y);
  let best: { from: number; to: number; distance: number; offCentre: number } | undefined;
  const toEdge = edge(b);
  for (const p of edge(a)) {
    for (const q of toEdge) {
      const d = Math.hypot((p % width) - (q % width), Math.floor(p / width) - Math.floor(q / width));
      if (best && d > best.distance + 1e-9) continue;
      const off = offCentre(p, q);
      if (!best || d < best.distance - 1e-9 || off < best.offCentre) best = { from: p, to: q, distance: d, offCentre: off };
    }
  }
  return best;
}

class MinHeap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number, priority: number): void {
    const items = this.items;
    items.push([value, priority]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent]![1] <= priority) break;
      [items[parent], items[index]] = [items[index]!, items[parent]!];
      index = parent;
    }
  }

  pop(): [number, number] {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left]![1] < items[smallest]![1]) smallest = left;
        if (right < items.length && items[right]![1] < items[smallest]![1]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index]!, items[smallest]!];
        index = smallest;
      }
    }
    return top;
  }
}
