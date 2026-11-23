// Syncs what the author changed in the Editor back into a Campaign Mod's Blueprint, as `sync` does
// for a Mission (ADR-0001): for now, its Set cutscenes (domain/mod-cinematic.ts). A Set cutscene the
// Editor saved since the last compile is imported again, as import-set reads a set, into the Set it
// was written from: in the Set's own frame (its provenance origin), so the Cinematics placing it
// stay where they were, and keeping what no cutscene holds (a piece's id, a camera's `moves`, the
// Set's name and provenance). The compile record then takes the saved file as the compile's, so the
// next compile writes the Set over it with no Editor change to decide.
//
//   npm run sync -- mods/<id>/blueprint.json

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatSet, importSet } from "../cutscene/import-set.js";
import { buildSetCatalog, type CinematicSet, type CutsceneSource } from "../cutscene/set-catalog.js";
import { cutsceneSourceKinds } from "../cutscene/source-kinds.js";
import { DEFAULT_LOOK, formatCinematicProblem } from "../cutscene/cinematic.js";
import type { SetData, SetMark, SetPiece } from "../domain/cinematic-set.js";
import { fingerprint } from "../domain/compile-record.js";
import { cutsceneFile } from "../domain/mod-cinematic.js";
import { readCompileRecord, saveCompileRecord } from "../map/mission-package.js";
import { workspaceFor, type Workspace } from "../plugins/workspace.js";
import { readModSetCutscenes } from "./mod-cinematics.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

/** One Set cutscene sync brought back: its name, its Set's file in the mod's folder, and what import-set left out or renamed. */
export type SyncedSetCutscene = { readonly cutscene: string; readonly set: string; readonly notes: readonly string[] };

export type ModSyncResult = { readonly synced: readonly SyncedSetCutscene[] };

/** Brings each Set cutscene the Editor changed since the last compile back into its Set, as above. */
export async function syncMod(blueprintPath: string, workspace?: Workspace): Promise<ModSyncResult> {
  const blueprint = await readModBlueprint(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record || blueprint.setCutscenes.length === 0) return { synced: [] };
  const pkg = await modPackage(blueprintPath);
  const { read, problems } = await readModSetCutscenes(blueprint, blueprintPath);
  if (problems.length > 0) throw new Error(`The Set cutscenes can't be synced: ${problems.map(formatCinematicProblem).join("; ")}`);
  const synced: SyncedSetCutscene[] = [];
  let entries = record.entries;
  for (const { entry, setFile, set } of read) {
    const file = cutsceneFile(entry);
    const full = path.join(pkg, ...file.split("/"));
    const recorded = record.entries.find((found) => found.kind === "file" && found.path === file);
    if (!recorded || recorded.kind !== "file" || !existsSync(full)) continue;
    const saved = await readFile(full);
    if (fingerprint(saved) === recorded.fingerprint) continue;
    workspace ??= await workspaceFor(blueprintPath);
    const kinds = cutsceneSourceKinds(workspace.registry);
    const source: CutsceneSource = { origin: set.provenance && kinds.has(set.provenance.kind) ? set.provenance.kind : "blizzard", path: `${path.basename(pkg)}/${file}`, xml: saved.toString("utf8") };
    const found = pickSet(buildSetCatalog([source], kinds), set, file);
    const imported = importSet([found], [source], found.name, { origin: (set.provenance?.origin ?? [0, 0, 0]) as [number, number, number] });
    await writeFile(setFile, formatSet(merged(set, imported.set)));
    entries = entries.map((other) => (other === recorded ? { ...recorded, fingerprint: fingerprint(saved) } : other));
    synced.push({ cutscene: entry.cutscene, set: entry.set, notes: imported.notes });
  }
  if (synced.length > 0) await saveCompileRecord(blueprintPath, { ...record, entries });
  return { synced };
}

/** The Set in the saved file: the one of its name, else its only one. */
function pickSet(sets: readonly CinematicSet[], set: SetData, file: string): CinematicSet {
  const named = sets.find((found) => found.name.toLowerCase() === set.name.toLowerCase());
  if (named) return named;
  if (sets.length === 1) return sets[0]!;
  throw new Error(`${file} holds ${sets.length === 0 ? "no set" : `the sets ${sets.map((found) => found.name).join(", ")}, none called ${set.name}`}: sync reads one Set from a Set cutscene; keep its room in one folder called ${set.name}`);
}

const samePlace = (a: readonly number[], b: readonly number[]): boolean => a.every((value, axis) => Math.abs(value - b[axis]!) <= 1e-3);

/**
 * The Set as the Editor left it (`now`), with what no cutscene holds carried from the Set it was
 * written from (`was`): its name and provenance; each piece's id, matched by model where it stood,
 * else by model in order; a camera's `moves`; the look-at type, attach point and Stand the Set
 * left to their defaults; and a mark's anim, which the import doesn't read back.
 */
function merged(was: SetData, now: SetData): SetData {
  const unmatched = [...was.pieces];
  const take = (match: (old: SetPiece) => boolean): SetPiece | undefined => {
    const at = unmatched.findIndex(match);
    return at < 0 ? undefined : unmatched.splice(at, 1)[0];
  };
  // By its model's file too, where it names one: two files in different folders can share a name.
  const sameModel = (a: SetPiece, b: SetPiece): boolean => a.model === b.model && a.modelPath === b.modelPath;
  const placed = now.pieces.map((piece) => take((old) => sameModel(old, piece) && samePlace(old.at, piece.at)));
  const pieces = now.pieces.map((piece, index) => {
    const old = placed[index] ?? take((other) => sameModel(other, piece));
    const { anim, ...rest } = piece;
    // The writer plays a model's own Stand where the Set gave no anim.
    const keepsAnim = anim !== undefined && !(old && old.anim === undefined && /^Stand( \d+)?$/.test(anim));
    return { ...(old?.id !== undefined ? { id: old.id } : {}), ...rest, ...(keepsAnim ? { anim } : {}) };
  });
  const marks = now.marks.map((mark): SetMark => {
    const old = was.marks.find((other) => other.name === mark.name);
    const look = old?.lookAt;
    const sameLook = look && mark.lookAt && look.mark === mark.lookAt.mark && (look.type ?? DEFAULT_LOOK.type) === mark.lookAt.type && (look.point ?? DEFAULT_LOOK.point) === mark.lookAt.point;
    return { ...mark, ...(sameLook ? { lookAt: look } : {}), ...(old?.anim !== undefined ? { anim: old.anim } : {}) };
  });
  const cameras = now.cameras.map((camera) => (was.cameras.find((other) => other.name === camera.name)?.moves ? { ...camera, moves: true as const } : camera));
  return { ...now, name: was.name, ...(was.provenance ? { provenance: was.provenance } : {}), pieces, marks, cameras };
}

/** The sync's report for the author: each Set cutscene brought back, with `relative` naming its Set's file, and its notes. */
export function formatModSync(result: ModSyncResult, relative: (file: string) => string = (file) => file): string[] {
  if (result.synced.length === 0) return ["No Set cutscene has changed in the Editor since the last compile: nothing to sync."];
  return result.synced.flatMap(({ cutscene, set, notes }) => [`${cutscene}: synced into ${relative(set)}; compile again to write it`, ...notes.map((note) => `  ${note}`)]);
}
