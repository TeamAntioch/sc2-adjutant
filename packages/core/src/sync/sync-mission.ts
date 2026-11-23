// Syncs what the author changed in the Editor back into a Mission Blueprint (ADR-0001): what the
// `sync` CLI and the MCP server's `sync` tool both run. Doodads moved, edited, added or deleted;
// units, points and cameras; regions (a zone's redrawn trigger area, or a region of the author's
// own); Map Options' Unexplored Areas, from MapInfo; ground raised or lowered and water drawn on
// a generated map (sync-terrain.ts); the Zones' hidden cells, from t3CellFlags; and a generated map's
// pathing paint, from CellAttribute_Pnp (sync-pathing.ts). The map is one
// compiled from this Blueprint and saved in the Editor. In the Mission's own package, only Compiled Content on the compile record comes back (ADR-0010): an
// object or region the author made in the Editor is Kept Content, left where it lies, but for a
// doodad placed on ground the compile writes, which sync adopts as an Anchor at its own Editor Id.
// Beside Kept ground the object and region steps run only on the Mission's own package with its
// record, and compare with the ground and dressing the next compile writes there (zonesForSync);
// the hidden cells come back whatever the object and region steps may do.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type EditResult, editMissionBlueprint } from "../edit/edit-blueprint.js";
import { readObjectsXml } from "../map/read-objects-xml.js";
import { readRegionsXml } from "../map/read-regions-xml.js";
import { readMapInfo } from "../map/read-map-info.js";
import { labelOf, unexploredAreasOf } from "../domain/unexplored-areas.js";
import { missionMapPackage, readCompileRecord, saveCompileRecord } from "../map/mission-package.js";
import { numberRegions } from "../map/write-regions-xml.js";
import { type CompileRecord, recordedIds } from "../domain/compile-record.js";
import { realPathOf } from "../util/inside.js";
import { WATER_DATA } from "../map/write-water.js";
import { hasKeptTerrain, type MissionBlueprint, missionBlueprintSchema } from "../domain/mission-blueprint.js";
import { missionWorkspace } from "../map/mission-catalog.js";
import { readRawBlueprint, type Workspace } from "../plugins/workspace.js";
import { syncAnchors } from "./sync-anchors.js";
import { syncDoodads } from "./sync-doodads.js";
import { regionsAsCompiled } from "../map/editor-changes.js";
import { zonesForSync } from "../map/zones-beside-kept.js";
import type { ZoneGround } from "../kept-terrain/generating-zones.js";
import { vertexHeightAt } from "../study/terrain-grid.js";
import { containsPoint } from "../terrain/rasterize.js";
import type { SyncGround } from "./sync-shared.js";
import { syncRegions } from "./sync-regions.js";
import { type EditorTerrainFiles, syncTerrain } from "./sync-terrain.js";
import { syncHiddenCells } from "./sync-hidden-cells.js";
import { syncPathing } from "./sync-pathing.js";
import { PATHING_FILE } from "../terrain/write-cell-attribute.js";
import { readCellFlagCells } from "../kept-terrain/kept-cliffs.js";

/** One kind of change and the ids it touched. */
export type SyncChange = { readonly label: string; readonly ids: readonly string[] };
/** Something the Editor has that the Blueprint doesn't keep, said so the author can decide. */
export type SyncNote = { readonly label: string; readonly items: readonly string[] };

export type SyncResult = {
  /** Each kind of change with at least one id, in report order. */
  readonly changes: readonly SyncChange[];
  readonly notes: readonly SyncNote[];
  /** The save, when anything changed: the Blueprint is saved only if it still validates. */
  readonly edit?: EditResult;
};

/** Thrown inside the edit when the map holds nothing to sync, so nothing is written. */
class NothingToSync extends Error {}

/** What sync reads from the package: its objects (with a record, only the Compiled ones) and regions, and the record's region ids. */
type EditorState = {
  /** Whether the map is the Mission's own Map Package. */
  readonly own: boolean;
  /** The compile record, when the map is the Mission's own package and it has one. */
  readonly record?: CompileRecord;
  readonly objects: ReturnType<typeof readObjectsXml>;
  /** Kept doodads the author placed on ground the compile writes (syncInputs): adopted as Anchors at their own Ids. */
  readonly adopted: ReadonlySet<number>;
  /** The package's doodads neither on the record, adopted already nor kept: adopted if they stand on ground the compile writes. */
  readonly unowned: readonly ReturnType<typeof readObjectsXml>["doodads"][number][];
  /** The object and region ids the author kept from the compile: passed over. */
  readonly kept: ReadonlySet<number>;
  readonly editorRegions: ReturnType<typeof readRegionsXml> | undefined;
  readonly recordedRegions: readonly number[] | undefined;
  /** The Compiled regions the Editor hasn't changed since the compile (their fingerprints match the record). */
  readonly untouchedRegions?: ReadonlySet<number>;
  /** MapInfo's fog string (Unexplored Areas), or why it couldn't be read; neither when there is no MapInfo. */
  readonly fog?: { readonly value: string } | { readonly unread: string };
  /** The terrain files, and the compile record that says which of them the Editor saved (the Mission's own package only). */
  readonly terrain: { readonly files: EditorTerrainFiles; readonly record: CompileRecord | undefined };
  /** The package's painted pathing (CellAttribute_Pnp), when it has one. */
  readonly pathing?: Buffer;
};

type RawZone = { readonly polygon?: readonly { readonly x: number; readonly y: number }[] };

/** Whether a point is inside a Zone: on a generated map, the ground the compile writes. */
function inAZone(raw: Record<string, unknown>, x: number, y: number): boolean {
  const zones = (Array.isArray(raw.zones) ? raw.zones : []) as RawZone[];
  return zones.some((zone) => Array.isArray(zone.polygon) && containsPoint(zone.polygon, { x, y }));
}

async function readEditorState(blueprintPath: string, mapPath: string, raw: Record<string, unknown>): Promise<EditorState> {
  const all = readObjectsXml(await readFile(path.join(mapPath, "Objects"), "utf8"));
  const regionsPath = path.join(mapPath, "Regions");
  const regionsXml = existsSync(regionsPath) ? await readFile(regionsPath, "utf8") : undefined;
  const editorRegions = regionsXml !== undefined ? readRegionsXml(regionsXml) : undefined;
  const fog = await readFog(path.join(mapPath, "MapInfo"));
  // The record says which objects and regions the compile wrote, and at what ids, in the Mission's own package.
  const own = (await realPathOf(mapPath)) === (await realPathOf(await missionMapPackage(blueprintPath)));
  const record = own ? await readCompileRecord(blueprintPath) : undefined;
  const terrain = { files: await readTerrainFiles(mapPath), record };
  const pathingPath = path.join(mapPath, PATHING_FILE);
  const pathing = existsSync(pathingPath) ? { pathing: await readFile(pathingPath) } : {};
  if (!record) return { own, objects: all, adopted: new Set(), unowned: [], kept: new Set(), editorRegions, recordedRegions: undefined, ...(fog ? { fog } : {}), terrain, ...pathing };
  // An object or region the author kept (compile-map --keep) is still the Blueprint's declaration, not a deletion.
  const compiled = recordedIds(record, "object");
  const kept = new Set((record.kept ?? []).flatMap((entry) => (entry.kind === "object" || entry.kind === "region" ? [entry.id] : [])));
  // A doodad an Anchor already adopted (its editorId) is the Blueprint's, on the record or not yet.
  const claimed = new Set(((Array.isArray(raw.anchors) ? raw.anchors : []) as { editorId?: unknown }[]).flatMap((anchor) => (typeof anchor.editorId === "number" ? [anchor.editorId] : [])));
  const ours = (id: number): boolean => compiled.has(id) || claimed.has(id);
  const only = <T extends { readonly id: number }>(items: readonly T[]): T[] => items.filter((item) => ours(item.id));
  const objects = { doodads: only(all.doodads), units: only(all.units), points: only(all.points), cameras: only(all.cameras) };
  return {
    own,
    record,
    objects,
    adopted: new Set(),
    unowned: all.doodads.filter((doodad) => !ours(doodad.id) && !kept.has(doodad.id)),
    kept,
    editorRegions,
    recordedRegions: regionPlaces(record, editorRegions ?? []),
    untouchedRegions: regionsXml !== undefined ? regionsAsCompiled(regionsXml, record) : new Set(),
    ...(fog ? { fog } : {}),
    terrain,
    ...pathing,
  };
}

/** The package's terrain files sync compares with the Blueprint's: those it has. */
async function readTerrainFiles(mapPath: string): Promise<EditorTerrainFiles> {
  const bytes = async (file: string): Promise<Buffer | undefined> => (existsSync(path.join(mapPath, file)) ? readFile(path.join(mapPath, file)) : undefined);
  const [heightMap, terrainXml, water, waterData, textureMasks] = await Promise.all([bytes("t3HeightMap"), bytes("t3Terrain.xml"), bytes("t3Water"), bytes(WATER_DATA), bytes("t3TextureMasks")]);
  return {
    ...(heightMap ? { heightMap } : {}),
    ...(terrainXml ? { terrainXml: terrainXml.toString("utf8") } : {}),
    ...(water ? { water } : {}),
    ...(waterData ? { waterData: waterData.toString("utf8") } : {}),
    ...(textureMasks ? { textureMasks } : {}),
  };
}

/** MapInfo's fog string; a MapInfo that can't be read costs the setting, not the sync. */
async function readFog(mapInfoPath: string): Promise<EditorState["fog"]> {
  if (!existsSync(mapInfoPath)) return undefined;
  try {
    return { value: readMapInfo(await readFile(mapInfoPath)).fogType };
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Map Options' Unexplored Areas, set in the Editor, as the Blueprint's `unexploredAreas`. The compile
 * writes MapInfo whole from the Blueprint, so without this an Editor change is lost at the next
 * compile. The default Black Mask leaves the field out. A fog string the Editor doesn't have is
 * left alone, said once per sync until the next compile replaces it with the Blueprint's.
 */
function syncUnexploredAreas(raw: Record<string, unknown>, fog: EditorState["fog"]): { readonly blueprint: Record<string, unknown>; readonly changed: string[]; readonly notes: string[] } {
  const unchanged = { blueprint: raw, changed: [], notes: [] };
  if (!fog) return unchanged;
  if ("unread" in fog) return { ...unchanged, notes: [`Unexplored Areas, as MapInfo couldn't be read (${fog.unread})`] };
  const value = unexploredAreasOf(fog.value);
  // As stored, before validation: a value the schema refuses is still replaced, and named as it is.
  const current: unknown = raw.unexploredAreas ?? "black";
  if (!value) return { ...unchanged, notes: [`Unexplored Areas ${JSON.stringify(fog.value)} isn't one of the Editor's three, so the Blueprint keeps ${labelOf(current)}, which the next compile writes`] };
  if (value === current) return unchanged;
  const { unexploredAreas: _, ...rest } = raw;
  return { blueprint: value === "black" ? rest : { ...raw, unexploredAreas: value }, changed: [`${labelOf(current)} → ${labelOf(value)} (${value})`], notes: [] };
}

/**
 * The region id at each compiled place, in order, as the compile numbered them. The record lists
 * them in that order; a kept region has left that list, so with one, the places are numbered again
 * as the compile does (numberRegions), around the package's own regions.
 */
function regionPlaces(record: CompileRecord, editorRegions: readonly { readonly id: number }[]): number[] {
  const listed = record.entries.flatMap((entry) => (entry.kind === "region" ? [entry.id] : []));
  const kept = (record.kept ?? []).filter((entry) => entry.kind === "region").length;
  if (kept === 0) return listed;
  const ours = recordedIds(record, "region");
  return numberRegions(listed.length + kept, new Set(editorRegions.flatMap((region) => (ours.has(region.id) ? [] : [region.id]))));
}

/** Whether a Blueprint, as stored, has Kept terrain: no Zones (everything in its package is Kept Content), or Zones that say how they stand to Kept ground. */
const keptTerrain = ({ zones }: Record<string, unknown>): boolean => hasKeptTerrain({ zones: Array.isArray(zones) ? zones : [] });

const KEPT_EDIT = "Kept objects and regions are edited where they lie, with edit_kept_objects (npm run edit-kept).";

/** Refuses a Blueprint with no Zones: everything in its package is Kept Content (ADR-0010), so there's nothing to bring back. */
function refuseNoZones(blueprintPath: string, raw: Record<string, unknown>): void {
  if (!keptTerrain(raw) || (Array.isArray(raw.zones) && raw.zones.length > 0)) return;
  throw new Error(`${blueprintPath} has no Zones: everything in its Map Package is Kept Content, so a compile wrote nothing for sync to bring back. ${KEPT_EDIT}`);
}

/** The package's t3CellFlags cells, for the hidden cells; undefined when it has none. */
async function readHiddenFlags(raw: Record<string, unknown>, mapPath: string): Promise<Uint8Array | undefined> {
  const size = raw.mapSize as { width?: unknown; height?: unknown } | undefined;
  if (typeof size?.width !== "number" || typeof size.height !== "number") return undefined;
  return readCellFlagCells(mapPath, size.width, size.height);
}

/**
 * Why sync's object and region steps can't run, if they can't: a Blueprint with no Zones, whose
 * package is all Kept Content (ADR-0010), or one whose Zones are beside Kept ground, synced from a
 * map other than its own Map Package, or with no compile record. Only the record says which of the
 * package's objects and regions are Compiled; the rest are Kept and would become Anchors. The steps
 * that touch neither (Unexplored Areas, the hidden cells) run regardless.
 */
async function objectSyncRefusal(blueprintPath: string, raw: Record<string, unknown>, state: Pick<EditorState, "own" | "record">): Promise<string | undefined> {
  if (!keptTerrain(raw)) return undefined;
  if (!Array.isArray(raw.zones) || raw.zones.length === 0) return `${blueprintPath} has no Zones: everything in its Map Package is Kept Content, so a compile wrote nothing for sync to bring back. ${KEPT_EDIT}`;
  if (!state.own) {
    return `${blueprintPath}'s Zones are beside Kept ground, so its objects and regions sync only from its own Map Package (${await missionMapPackage(blueprintPath)}), whose compile record says which are Compiled: the rest are Kept Content. ${KEPT_EDIT}`;
  }
  if (!state.record) return `${blueprintPath}'s Zones are beside Kept ground, and its Map Package has no compile record yet to say which objects and regions are Compiled: compile it first. ${KEPT_EDIT}`;
  return undefined;
}

/**
 * The ground and dressing the next compile writes beside the package's Kept ground, for the
 * Blueprint as read and as sync changes it, and whether a point is on a cell its generating Zones
 * own (ownedCells: whole cliff cells, less those the author kept); undefined on a generated map.
 */
async function keptGround(
  raw: Record<string, unknown>,
  mapPath: string,
  workspace: Pick<Workspace, "registry" | "catalog">,
  record: CompileRecord | undefined,
): Promise<{ readonly ground: (blueprint: MissionBlueprint) => SyncGround; readonly owns: (x: number, y: number) => boolean } | undefined> {
  if (!keptTerrain(raw) || !record) return undefined;
  const blueprint = missionBlueprintSchema(workspace.registry, workspace.catalog).parse(raw);
  const generate = await zonesForSync(mapPath, blueprint, record);
  const { width, height } = blueprint.mapSize;
  const made = new WeakMap<MissionBlueprint, ZoneGround>();
  const zones = (next: MissionBlueprint): ZoneGround => made.get(next) ?? made.set(next, generate(next)).get(next)!;
  const { owned } = zones(blueprint);
  return {
    ground: (next) => ({ groundAt: (x, y) => vertexHeightAt(zones(next).heights, width + 1, x, y), dressing: (other) => zones(other).dressing }),
    owns: (x, y) => x >= 0 && y >= 0 && x < width && y < height && owned[Math.floor(y) * width + Math.floor(x)] === 1,
  };
}

/** What every sync step works from: the package as read, whether the object and region steps may run, and the ground they compare with. */
type SyncInputs = {
  readonly state: EditorState;
  readonly refusal?: string;
  readonly ground?: (blueprint: MissionBlueprint) => SyncGround;
  /** The package's t3CellFlags cells, for the hidden cells. */
  readonly hiddenFlags?: Uint8Array;
};

async function syncInputs(workspace: Pick<Workspace, "registry" | "catalog">, blueprintPath: string, mapPath: string, raw: Record<string, unknown>): Promise<SyncInputs> {
  const read = await readEditorState(blueprintPath, mapPath, raw);
  const flags = await readHiddenFlags(raw, mapPath);
  const hiddenFlags = flags ? { hiddenFlags: flags } : {};
  const refusal = await objectSyncRefusal(blueprintPath, raw, read);
  if (refusal) return { state: read, refusal, ...hiddenFlags };
  const kept = await keptGround(raw, mapPath, workspace, read.record);
  // A doodad off the record standing on ground the compile writes, the author placed there (or it stood there before): sync adopts it.
  const owns = kept?.owns ?? ((x: number, y: number) => inAZone(raw, x, y));
  const adopted = read.unowned.filter((doodad) => owns(doodad.position.x, doodad.position.y));
  const state = { ...read, adopted: new Set(adopted.map((doodad) => doodad.id)), objects: { ...read.objects, doodads: [...read.objects.doodads, ...adopted] } };
  return { state, ...(kept ? { ground: kept.ground } : {}), ...hiddenFlags };
}

/**
 * What sync would make of the Blueprint, written nowhere: the compile asks this before it stops on
 * an Editor change, to tell what sync brings back from what the author must keep or discard.
 * Undefined when sync has nothing to bring back.
 */
export async function syncPreview(workspace: Workspace, blueprintPath: string, mapPath: string): Promise<{ readonly blueprint: Record<string, unknown>; readonly record?: CompileRecord } | undefined> {
  const raw = await readRawBlueprint(blueprintPath);
  if (!existsSync(path.join(mapPath, "Objects"))) return undefined;
  const mission = await missionWorkspace(workspace, blueprintPath);
  const { blueprint, changes, record } = syncAll(raw, await syncInputs(mission, blueprintPath, mapPath, raw), mission);
  return changes.length > 0 || record ? { blueprint, ...(record ? { record } : {}) } : undefined;
}

export async function syncMission(workspace: Workspace, blueprintPath: string, mapPath: string): Promise<SyncResult> {
  const stored = await readRawBlueprint(blueprintPath);
  refuseNoZones(blueprintPath, stored);
  const mission = await missionWorkspace(workspace, blueprintPath);
  const inputs = await syncInputs(mission, blueprintPath, mapPath, stored);
  let record: CompileRecord | undefined;
  const result = await runSync(workspace, blueprintPath, (raw) => {
    const synced = syncAll(raw, inputs, mission);
    record = synced.record;
    // With its object and region steps refused and nothing else to bring back, the refusal is the sync's.
    if (synced.changes.length === 0 && !record && inputs.refusal) throw new Error(inputs.refusal);
    return synced;
  });
  // The pathing strokes are in the Blueprint now, so the record takes the Editor's layer as the compile's (sync-pathing.ts).
  if (record && (result.edit === undefined || result.edit.saved)) await saveCompileRecord(blueprintPath, record);
  return result;
}

/** Runs `sync` on the Blueprint the edit itself reads, so what is saved is made from what was read, and saves it if anything changed. */
async function runSync(workspace: Workspace, blueprintPath: string, sync: (raw: Record<string, unknown>) => Omit<SyncResult, "edit"> & { readonly blueprint: Record<string, unknown> }): Promise<SyncResult> {
  let synced: Omit<SyncResult, "edit"> = { changes: [], notes: [] };
  try {
    const edit = await editMissionBlueprint(workspace, blueprintPath, (raw) => {
      const { blueprint, ...result } = sync(raw);
      synced = result;
      if (result.changes.length === 0) throw new NothingToSync();
      return { raw: blueprint, notes: [] };
    });
    return { ...synced, edit };
  } catch (error) {
    if (error instanceof NothingToSync) return synced;
    throw error;
  }
}

function syncAll(
  raw: Record<string, unknown>,
  { state, refusal, ground, hiddenFlags }: SyncInputs,
  workspace: Pick<Workspace, "registry" | "catalog">,
): Omit<SyncResult, "edit"> & { readonly blueprint: Record<string, unknown>; readonly record?: CompileRecord } {
  const { objects, editorRegions, recordedRegions, kept, untouchedRegions: untouched, adopted, fog, terrain } = state;
  // The ground first, on a generated map, so a doodad the Editor set down on ground the author
  // lowered stands on the synced ground, not at a height offset over the old. Beside Kept ground
  // the ground is the package's (keptGround). Parsed and expanded against the Workspace's own
  // Plugins, and the Mission's catalog (missionWorkspace).
  const schema = missionBlueprintSchema(workspace.registry, workspace.catalog);
  const terrainSync = keptTerrain(raw) ? undefined : syncTerrain(raw, (blueprint) => schema.parse(blueprint), terrain.files, terrain.record);
  const start = terrainSync?.blueprint ?? raw;
  const recorded = state.record ? recordedIds(state.record, "object") : new Set<number>();
  const doodads = refusal ? undefined : syncDoodads(start, objects, workspace, kept, { ...(ground ? { ground } : {}), adopted, recorded });
  const anchors = refusal ? undefined : syncAnchors(doodads!.blueprint, objects, workspace, kept);
  const regions = !refusal && editorRegions ? syncRegions(anchors!.blueprint, editorRegions, workspace, recordedRegions, kept, untouched, ground) : undefined;
  const unexplored = syncUnexploredAreas((regions?.blueprint ?? anchors?.blueprint ?? start) as Record<string, unknown>, fog);
  const hidden = hiddenFlags ? syncHiddenCells(unexplored.blueprint, hiddenFlags) : { blueprint: unexplored.blueprint, changed: [] };
  // Worked out on the Blueprint as compiled (raw), before the steps above moved anything (sync-pathing.ts).
  const pathing = keptTerrain(raw) ? { blueprint: hidden.blueprint, changed: [], notes: [] } : syncPathing(raw, hidden.blueprint, (blueprint) => schema.parse(blueprint), state.pathing, terrain.record);
  const blueprint = pathing.blueprint;

  const all: [string, string[]][] = [
    ["Doodad anchors changed", (doodads?.report.anchorsChanged ?? [])],
    ["Doodad anchors added", (doodads?.report.anchorsAdded ?? [])],
    ["Doodads placed in the Editor on ground the compile writes, adopted as Anchors", (doodads?.report.adopted ?? [])],
    ["Doodad anchors removed", (doodads?.report.anchorsRemoved ?? [])],
    ["Deleted in the Editor but referred to, so kept", [...(doodads?.report.anchorsKept ?? []), ...(anchors?.report.kept ?? [])]],
    ["Dressing doodads edited", (doodads?.report.dressingEdited ?? [])],
    ["Dressing doodads removed", (doodads?.report.dressingRemoved ?? [])],
    ["Doodads added to set pieces", (doodads?.report.setPieceAdded ?? [])],
    ["Units, points and cameras changed", (anchors?.report.changed ?? [])],
    ["Units, points and cameras added", (anchors?.report.added ?? [])],
    ["Units, points and cameras removed", (anchors?.report.removed ?? [])],
    ["Zone trigger areas redrawn", regions?.report.zonesRedrawn ?? []],
    ["Beat bounds redrawn", regions?.report.boundsRedrawn ?? []],
    ["Regions added", regions?.report.added ?? []],
    ["Regions changed", regions?.report.changed ?? []],
    ["Regions removed", regions?.report.removed ?? []],
    ["Unexplored Areas changed", unexplored.changed],
    ["Hidden cells changed", hidden.changed],
    ["Pathing paint changed", pathing.changed],
    ["Water added", terrainSync?.report.waterAdded ?? []],
    ["Water changed", terrainSync?.report.waterChanged ?? []],
    ["Water removed", terrainSync?.report.waterRemoved ?? []],
    ["Ground raised or lowered", terrainSync?.report.heightsChanged ?? []],
  ];
  const changes = all.filter(([, ids]) => ids.length > 0).map(([label, ids]) => ({ label, ids }));
  const notes = (
    [
      ["Editor settings the blueprint doesn't keep", (anchors?.report.notKept ?? [])],
      ["Doodads on ground the compile writes left Kept, as the catalog lacks their type or variation", doodads?.report.notAdopted ?? []],
      ["Region edits not kept", regions?.report.ignored ?? []],
      ["Map Options not synced", unexplored.notes],
      ["Terrain edits not synced (the compile stops on them, to keep or discard)", terrainSync?.report.notSynced ?? []],
      ["Not synced", pathing.notes],
      ["Objects and regions not synced", refusal ? [refusal] : []],
    ] as const
  )
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
  const record = terrain.record && pathing.recordAs !== undefined ? withPathingPrint(terrain.record, pathing.recordAs) : undefined;
  return { changes, notes, blueprint: blueprint as Record<string, unknown>, ...(record ? { record } : {}) };
}

/** The compile record with its CellAttribute_Pnp at `print` (off it for null); undefined when it says so already. */
function withPathingPrint(record: CompileRecord, print: string | null): CompileRecord | undefined {
  const entries = record.entries.filter((entry) => !(entry.kind === "file" && entry.path === PATHING_FILE));
  const was = record.entries.find((entry) => entry.kind === "file" && entry.path === PATHING_FILE);
  if ((was && "fingerprint" in was ? was.fingerprint : null) === print) return undefined;
  return { ...record, entries: print === null ? entries : [...entries, { kind: "file", path: PATHING_FILE, fingerprint: print }] };
}

/** The report the `sync` CLI prints: "No changes", or each kind of change with its ids, then the notes. */
export function formatSyncReport({ changes, notes }: SyncResult, mapPath: string): string[] {
  return [
    ...(changes.length === 0 ? [`No changes in ${mapPath}`] : []),
    ...changes.map(({ label, ids }) => `${label} (${ids.length}): ${ids.join(", ")}`),
    ...formatSyncNotes(notes),
  ];
}

/** Each note with its items, one to a line. */
export const formatSyncNotes = (notes: readonly SyncNote[]): string[] => notes.map(({ label, items }) => `${label}:\n  ${items.join("\n  ")}`);
