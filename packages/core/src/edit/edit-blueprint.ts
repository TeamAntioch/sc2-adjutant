// Edits a Mission Blueprint on disk, validated before it is saved: what the MCP server's
// `patch_blueprint` and geometry helpers run. An edit whose result doesn't validate against core
// and every Plugin the Workspace loads is refused with each issue's path and reason, and the file
// is left as it was.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { missionCatalogFor } from "../map/mission-catalog.js";
import { type BlueprintIssue, readRawBlueprint, validateMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { containsPoint, type Point } from "../terrain/rasterize.js";
import { replaceFile } from "../util/replace-file.js";
import { applyJsonPatch, JsonPatchError, type JsonPatchOperation } from "./json-patch.js";

/** A Blueprint as stored: plain JSON, before defaults are filled in. */
type Raw = Record<string, unknown>;

export type EditResult =
  | { readonly saved: true; readonly blueprint: MissionBlueprint; readonly notes: readonly string[] }
  | { readonly saved: false; readonly issues: readonly BlueprintIssue[] };

/** An edit that can't be made as asked: the Blueprint path it concerns and why. */
export class EditRefused extends Error {
  constructor(readonly issue: BlueprintIssue) {
    super(`${issue.path}: ${issue.message}`);
  }
}

/** What an edit makes of the stored Blueprint: the Blueprint to save, and notes for the author. */
export type Edit = (raw: Raw) => { readonly raw: Raw; readonly notes: readonly string[] };

/**
 * Applies `edit` to the stored Blueprint and saves the result if it validates. `edit` gets a copy
 * it may change; it throws `EditRefused` to refuse. `check` refuses a Blueprint that validates with
 * the issues it gives, for what the schema can't see, such as the Map Package.
 */
export async function editMissionBlueprint(
  workspace: Workspace,
  blueprintPath: string,
  edit: Edit,
  { check }: { readonly check?: (blueprint: MissionBlueprint) => Promise<readonly BlueprintIssue[]> } = {},
): Promise<EditResult> {
  const stored = await readRawBlueprint(blueprintPath);
  let edited: ReturnType<Edit>;
  try {
    edited = edit(structuredClone(stored));
  } catch (error) {
    if (error instanceof EditRefused) return { saved: false, issues: [error.issue] };
    throw error;
  }
  const { raw, notes } = edited;
  const result = validateMissionBlueprint(workspace, raw, await missionCatalogFor(workspace.catalog, blueprintPath));
  if (!result.success) return { saved: false, issues: result.issues };
  const issues = check ? await check(result.blueprint) : [];
  if (issues.length) return { saved: false, issues };
  await replaceFile(blueprintPath, `${JSON.stringify(raw, null, 2)}\n`);
  const already = new Set(misplacedAnchors(stored));
  const misplaced = misplacedAnchors(raw).filter((anchor) => !already.has(anchor));
  return { saved: true, blueprint: result.blueprint, notes: [...notes, ...misplaced.map((anchor) => `Anchor ${anchor} now stands outside its zone.`)] };
}

/** An edit applying a JSON Patch; an operation that can't apply refuses it with the operation's path. */
export const jsonPatchEdit =
  (patch: readonly JsonPatchOperation[]): Edit =>
  (raw) => {
    let patched: unknown;
    try {
      // `raw` is already editMissionBlueprint's copy, so the patch may change it in place.
      patched = applyJsonPatch(raw, patch, { inPlace: true });
    } catch (error) {
      if (error instanceof JsonPatchError) throw new EditRefused({ path: `patch.${error.index}`, message: error.message });
      throw error;
    }
    if (typeof patched !== "object" || patched === null || Array.isArray(patched)) {
      throw new EditRefused({ path: "(blueprint)", message: "The patched Blueprint must be a JSON object" });
    }
    return { raw: patched as Raw, notes: [`Applied ${patch.length} operation${patch.length === 1 ? "" : "s"}.`] };
  };

/**
 * An edit replacing a Zone's polygon, refused if it leaves the map or crosses itself. The Zone's
 * Editor region, drawn by hand, is kept, with a note to redraw it.
 */
export const setZonePolygonEdit =
  (zoneId: string, polygon: readonly Point[]): Edit =>
  (raw) => {
    const { item: zone, index } = findById(raw, "zones", zoneId);
    checkPolygon(raw, polygon, `zones.${index}.polygon`);
    zone.polygon = polygon.map(({ x, y }) => ({ x, y }));
    const notes = [`Zone ${zoneId} now has ${polygon.length} corners.`];
    if (zone.region) notes.push(`Its Editor region is as it was drawn; redraw it in the Editor and sync, or remove /zones/${index}/region to use the polygon's bounds.`);
    return { raw, notes };
  };

/**
 * An edit moving a Zone by (dx, dy): its polygon, its Editor region, and the Anchors and
 * Placements in it. The Connections' crossing points (`at`) stay where they are, since they sit
 * between two Zones. So do terrain objects, authored regions and positions in Mechanic params,
 * which belong to no one Zone; the notes name the terrain objects and regions that stood in it.
 * A translation keeps the outline's shape, so only the map bounds are checked.
 */
export const moveZoneEdit =
  (zoneId: string, dx: number, dy: number): Edit =>
  (raw) => {
    const { item: zone, index } = findById(raw, "zones", zoneId);
    const shift = <T extends Point>(point: T): T => ({ ...point, x: point.x + dx, y: point.y + dy });
    const old = zone.polygon as Point[];
    const polygon = old.map(shift);
    checkInsideMap(raw, polygon, `zones.${index}.polygon`);
    zone.polygon = polygon;
    // Its hidden cells go with it: whole cells, so only a move by whole cells keeps them inside it.
    if (Array.isArray(zone.hiddenCells) && zone.hiddenCells.length > 0) {
      if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error(`Zone ${zoneId} has hiddenCells, which are whole cells: move it by whole cells`);
      zone.hiddenCells = (zone.hiddenCells as number[][]).map(([x, y, w, h]) => [x! + dx, y! + dy, w!, h!]);
    }
    const region = zone.region as { shapes: Record<string, unknown>[] } | undefined;
    for (const shape of region?.shapes ?? []) {
      if (Array.isArray(shape.quad)) {
        const [x1, y1, x2, y2] = shape.quad as number[];
        shape.quad = [x1! + dx, y1! + dy, x2! + dx, y2! + dy];
      } else if (shape.center) shape.center = shift(shape.center as Point);
    }
    const anchors = ((raw.anchors ?? []) as Record<string, unknown>[]).filter((anchor) => anchor.zoneId === zoneId);
    for (const anchor of anchors) {
      anchor.position = shift(anchor.position as Point);
      if (anchor.cameraTarget) anchor.cameraTarget = shift(anchor.cameraTarget as Point);
    }
    // A Placement without `at` stands at its Zone's centre, so it moves with the polygon anyway.
    const placements = ((raw.placements ?? []) as { zoneId?: unknown; params?: { at?: Point } }[]).filter(
      (placement) => placement.zoneId === zoneId && placement.params?.at,
    );
    for (const placement of placements) placement.params!.at = shift(placement.params!.at!);
    const crossings = ((raw.zones ?? []) as Record<string, unknown>[]).flatMap((other) =>
      ((other.connections ?? []) as Record<string, unknown>[])
        .filter((connection) => connection.at !== undefined && (other.id === zoneId || connection.toZoneId === zoneId))
        .map((connection) => `${String(other.id)} → ${String(connection.toZoneId)}`),
    );
    const inOld = (point: unknown): boolean =>
      typeof (point as Point | undefined)?.x === "number" && typeof (point as Point).y === "number" && containsPoint(old, point as Point);
    const terrainObjects = ((raw.terrainObjects ?? []) as { id?: unknown; at?: unknown }[]).filter((object) => inOld(object.at)).map((object) => String(object.id));
    const regions = ((raw.regions ?? []) as { id?: unknown; shapes?: { quad?: number[]; center?: unknown }[] }[])
      .filter((region) =>
        (region.shapes ?? []).some((shape) =>
          Array.isArray(shape.quad) ? inOld({ x: (shape.quad[0]! + shape.quad[2]!) / 2, y: (shape.quad[1]! + shape.quad[3]!) / 2 }) : inOld(shape.center),
        ),
      )
      .map((region) => String(region.id));
    const holdsPoint = (value: unknown): boolean =>
      inOld(value) || (typeof value === "object" && value !== null && Object.values(value).some(holdsPoint));
    const mechanics = ((raw.mechanics ?? []) as { id?: unknown; params?: unknown }[]).filter((entry) => holdsPoint(entry.params)).map((entry) => String(entry.id));
    const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
    const notes = [
      `Moved zone ${zoneId} by (${dx}, ${dy}) with ${count(anchors.length, "anchor")} and ${count(placements.length, "placement")}.`,
      ...(crossings.length ? [`Crossing points left where they were; check them: ${crossings.join(", ")}.`] : []),
      ...(terrainObjects.length ? [`Terrain objects that stood in it left where they were: ${terrainObjects.join(", ")}.`] : []),
      ...(regions.length ? [`Authored regions that stood in it left where they were: ${regions.join(", ")}.`] : []),
      ...(mechanics.length ? [`Positions in these Mechanics' params that stood in it left where they were: ${mechanics.join(", ")}.`] : []),
    ];
    return { raw, notes };
  };

/**
 * An edit moving an Anchor to (x, y) and into the Zone that holds that point, as the terrain
 * paints Zones (the last listed wins), unless `zoneId` names another or its current Zone still
 * holds the point. Its height offset stays unless `z` is given (`null` clears it), and a camera's
 * target moves with it, keeping the framing, refused if that takes the target off the map.
 */
export const moveAnchorEdit =
  (anchorId: string, position: { readonly x: number; readonly y: number; readonly z?: number | null | undefined }, zoneId?: string): Edit =>
  (raw) => {
    const { item: anchor, index } = findById(raw, "anchors", anchorId);
    const at = `anchors.${index}.position`;
    if (!insideMap(raw, position)) throw new EditRefused({ path: at, message: `(${position.x}, ${position.y}) is outside the map ${mapSizeText(raw)}` });
    const zones = (raw.zones ?? []) as { id: string; polygon: Point[] }[];
    const before = anchor.zoneId;
    const current = zones.find((zone) => zone.id === before);
    const holder = current && containsPoint(current.polygon, position) ? current : zones.findLast((zone) => containsPoint(zone.polygon, position));
    const target = zoneId ?? holder?.id;
    if (!target) throw new EditRefused({ path: at, message: `(${position.x}, ${position.y}) is in no zone` });
    const old = anchor.position as Point & { z?: number };
    const z = position.z === null ? undefined : (position.z ?? old.z);
    anchor.position = z === undefined ? { x: position.x, y: position.y } : { x: position.x, y: position.y, z };
    const looking = anchor.cameraTarget as Point | undefined;
    if (looking) {
      const moved = { x: looking.x + position.x - old.x, y: looking.y + position.y - old.y };
      if (!insideMap(raw, moved)) {
        throw new EditRefused({ path: `anchors.${index}.cameraTarget`, message: `Moving the camera's target with it puts it at (${moved.x}, ${moved.y}), outside the map ${mapSizeText(raw)}` });
      }
      anchor.cameraTarget = moved;
    }
    anchor.zoneId = target;
    const notes = [`Moved anchor ${anchorId} to (${position.x}, ${position.y})${before === target ? ` in zone ${target}` : `, from zone ${String(before)} to ${target}`}.`];
    return { raw, notes };
  };

/** The ids of Anchors standing outside their Zone's polygon, in a stored Blueprint (which may be invalid). */
function misplacedAnchors(raw: Raw): string[] {
  const zones = Array.isArray(raw.zones) ? (raw.zones as { id?: unknown; polygon?: unknown }[]) : [];
  const anchors = Array.isArray(raw.anchors) ? (raw.anchors as { id?: unknown; zoneId?: unknown; position?: Point }[]) : [];
  return anchors.flatMap((anchor) => {
    const polygon = zones.find((zone) => zone?.id === anchor?.zoneId)?.polygon;
    if (!Array.isArray(polygon) || typeof anchor?.position?.x !== "number" || typeof anchor.position.y !== "number") return [];
    return containsPoint(polygon as Point[], anchor.position) ? [] : [String(anchor.id)];
  });
}

function findById(raw: Raw, list: "zones" | "anchors", id: string): { item: Record<string, unknown>; index: number } {
  const items = (Array.isArray(raw[list]) ? raw[list] : []) as Record<string, unknown>[];
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    const known = items.map((item) => String(item.id));
    throw new EditRefused({ path: list, message: `No ${list === "zones" ? "zone" : "anchor"} ${id} (its ${list}: ${known.join(", ") || "none"})` });
  }
  return { item: items[index]!, index };
}

function checkInsideMap(raw: Raw, polygon: readonly Point[], at: string): void {
  const outside = polygon.findIndex((point) => !insideMap(raw, point));
  if (outside >= 0) {
    const { x, y } = polygon[outside]!;
    throw new EditRefused({ path: `${at}.${outside}`, message: `(${x}, ${y}) is outside the map ${mapSizeText(raw)}` });
  }
}

function checkPolygon(raw: Raw, polygon: readonly Point[], at: string): void {
  if (polygon.length < 3) throw new EditRefused({ path: at, message: "A zone needs at least 3 corners" });
  checkInsideMap(raw, polygon, at);
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [polygon[i]!, polygon[(i + 1) % n]!, polygon[(i + 2) % n]!];
    if (a.x === b.x && a.y === b.y) {
      throw new EditRefused({ path: `${at}.${(i + 1) % n}`, message: `Corners ${i} and ${(i + 1) % n} are the same point` });
    }
    // Two edges in a line that double back: a spike of zero width.
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (cross === 0 && dot < 0) throw new EditRefused({ path: `${at}.${(i + 1) % n}`, message: `The outline doubles back on itself at corner ${(i + 1) % n}` });
  }
  const crossing = selfCrossing(polygon);
  if (crossing) throw new EditRefused({ path: at, message: `The polygon crosses itself: edges ${crossing[0]} and ${crossing[1]} intersect` });
}

function insideMap(raw: Raw, point: Point): boolean {
  const size = raw.mapSize as { width?: number; height?: number } | undefined;
  if (typeof size?.width !== "number" || typeof size.height !== "number") return true;
  return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
}

const mapSizeText = (raw: Raw): string => {
  const size = raw.mapSize as { width: number; height: number };
  return `${size.width}×${size.height}`;
};

/** The first pair of non-adjacent edges that touch, by the index of each edge's first corner. */
function selfCrossing(polygon: readonly Point[]): [number, number] | undefined {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsTouch(polygon[i]!, polygon[(i + 1) % n]!, polygon[j]!, polygon[(j + 1) % n]!)) return [i, j];
    }
  }
  return undefined;
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const onSegment = (o: Point, p: Point, q: Point): boolean =>
    Math.min(o.x, p.x) <= q.x && q.x <= Math.max(o.x, p.x) && Math.min(o.y, p.y) <= q.y && q.y <= Math.max(o.y, p.y);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(c, d, a)) || (d2 === 0 && onSegment(c, d, b)) || (d3 === 0 && onSegment(a, b, c)) || (d4 === 0 && onSegment(a, b, d));
}
