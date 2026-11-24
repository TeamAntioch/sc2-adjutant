// Custom doodads (domain/custom-doodad.ts) as the entries they compile down to, a CModel and a
// CActorDoodad of one id, and the check of the files they draw on: a compile refuses a doodad
// whose model, or a texture the model names, the game wouldn't find, since the Editor then shows
// a placeholder or an untextured model, and warns about a model whose bounds don't cover its mesh,
// which the game culls while it is still on screen.
//
//   model        found by its storage path, as the game finds it: in the Workspace's mod packages
//                (the Campaign Mod's and the Workspace mods it depends on, newest first), or a
//                Mission's own files for a Mission's doodad. A game model is one only with
//                `gameModel`: then nothing is copied or read, its textures are the game's, and the
//                path is refused unless the game has a model there (stock-catalog.ts isGameModel).
//   textures     each path the model names (m3-textures.ts) found the same way, or listed in the
//                doodad's `gameTextures` as the game's own
//   bounds       the MODL bounds against the mesh's vertices (m3-footprint.ts): m3studio writes
//                the armature's `m3_bounds`, a 4 × 4 box unless an export script sets it
//   animate      a looping Stand needs a Stand: warned when the model has none
//   id           refused when it is a game doodad's or unit's: the entries would replace the game's
//                (a unit's actor and model are mostly of its id). A model at a game doodad model's
//                path is warned about: its file replaces the game's for everything that draws it.
//   entries      a Blueprint Generic Entry's fields that name an `Assets\` model or image (genericEntryAssetWarnings)
//                are warned about when no mod package, the Blueprint or the game's lists hold the file
//   swaps        checked against the .m3 the game draws (texture-swaps.ts): its own file, or a
//                gameModel's read from the game through the Host Adapter's model.export, refused
//                on a machine without it; each `with` found as the model's textures are (a
//                Campaign Mod's in its mod packages, its Asset Mod's), or listed in `gameTextures`

import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { gameDoodadModels, isGameAsset, isGameModel, listDoodads } from "../catalog/stock-catalog.js";
import { findPackageFile } from "../catalog/package-files.js";
import { readM3Footprint, readM3MeshExtent } from "../catalog/m3-footprint.js";
import { readM3Sequences } from "../catalog/m3-sequences.js";
import { readM3TexturePaths } from "../catalog/m3-textures.js";
import { gameUnitIds } from "../catalog/tech-catalog.js";
import type { FieldStruct, FieldValue } from "../domain/catalog-fields.js";
import type { CustomDoodad, MissionDoodad } from "../domain/custom-doodad.js";
import { OBJECT_STRINGS } from "../domain/entry-strings.js";
import type { Workspace } from "../plugins/workspace.js";
import { isLfsPointer } from "./asset-sources.js";
import { CatalogSchemaError, catalogSchema, schemaProblems } from "./catalog-schema.js";
import { type GenericEntry, genericEntryKey } from "./generic-entries.js";
import { isInside } from "../util/inside.js";
import type { Host } from "../host/host.js";
import { baseName, checkDoodadSwaps, type SwapSlot } from "./texture-swaps.js";
import { modPackagesUnder, readWorkspaceMod } from "./workspace-mods.js";

/** A file named from the Workspace's root with forward slashes, as Blueprints name files, on Windows too. */
const fromRoot = (root: string, file: string): string => path.relative(root, file).split(path.sep).join("/");

/** A storage path as game data writes it, with backslashes. */
const dataPath = (storagePath: string): string => storagePath.replace(/\//g, "\\");
/** A storage path to compare: one slash, any case, as the game matches it. */
export const samePath = (storagePath: string): string => storagePath.replace(/\\/g, "/").toLowerCase();

/** A field's items: an array's, or one value as one item. */
const items = (value: FieldValue | undefined): readonly (string | number | FieldStruct)[] => (value === undefined ? [] : Array.isArray(value) ? value : [value as string | number | FieldStruct]);

/**
 * The CModel and CActorDoodad `doodad` compiles to, and a CTexture for each of its `swaps`
 * (checkDoodadSwaps's, in its order): swap n declares the slot `swap<n>` on the CModel for the
 * replaced file's base name, files the new texture in it, and is sent on ActorCreation and
 * ModelSwapped (texture-swaps.md). The swap events go after the actor's On list, the default
 * removals or `fields.actor`'s own On, and the declarations after `fields.model`'s TextureDeclares.
 */
export function customDoodadEntries(doodad: CustomDoodad, swaps: readonly SwapSlot[] = []): GenericEntry[] {
  const scale = doodad.scale === undefined ? undefined : Array(3).fill(doodad.scale.toFixed(6)).join(",");
  const textureId = (n: number) => `${doodad.id}_Swap${n}`;
  const declares = swaps.map((swap, index) => ({ Prefix: baseName(swap.replace), Adaptions: { Slot: `swap${index + 1}` } }));
  const model: Record<string, FieldValue> = {
    Model: dataPath(doodad.model),
    ...(scale ? { ScaleMin: scale, ScaleMax: scale } : {}),
    ...doodad.fields?.model,
    ...(swaps.length > 0 ? { TextureDeclares: [...items(doodad.fields?.model?.TextureDeclares), ...declares] } : {}),
  };
  const events = swaps.flatMap((_, index) => ["ActorCreation", "ModelSwapped"].map((terms) => ({ Terms: terms, Send: `TextureSelectById ${textureId(index + 1)}` })));
  const actor: Record<string, FieldValue> = {
    // CActorDoodad's two default events: a sound emitter of the doodad's id, and the looping Stand.
    On: [{ index: 0, removed: 1 }, ...(doodad.animate ? [] : [{ index: 1, removed: 1 }])],
    ...(doodad.group ? { EditorCategories: `DoodadType:${doodad.group}` } : {}),
    ...(doodad.tilesets ? { TexSets: doodad.tilesets } : {}),
    ...(doodad.footprint ? { Footprint: doodad.footprint } : {}),
    RandomScaleRange: "1.000000,1.000000",
    ...doodad.fields?.actor,
  };
  if (events.length > 0) actor.On = [...items(actor.On), ...events];
  const named = (key: string) => (doodad.name === undefined ? {} : { strings: { [OBJECT_STRINGS]: { [`${key}/Name/${doodad.id}`]: doodad.name } } });
  return [
    { catalog: "Model", class: "CModel", id: doodad.id, parent: "Doodad", fields: model, ...named("Model") },
    { catalog: "Actor", class: "CActorDoodad", id: doodad.id, fields: actor, ...named("Actor") },
    ...swaps.map((swap, index): GenericEntry => ({
      catalog: "Texture",
      class: "CTexture",
      id: textureId(index + 1),
      fields: { File: dataPath(swap.with), Slot: `swap${index + 1}${swap.component ? `.${swap.component}` : ""}` },
    })),
  ];
}

/** A file found by its storage path: its bytes, and where it was found, for messages. */
export type FoundFile = { readonly data: Uint8Array; readonly where: string };

/** The texture paths the model `found` names; refused, naming it, when it doesn't read as an .m3. */
function readTextures(found: FoundFile, label: string, model: string): string[] {
  if (isLfsPointer(Buffer.from(found.data))) return [];
  try {
    return readM3TexturePaths(found.data);
  } catch (error) {
    throw new Error(`${label}'s model ${model} (${found.where}) doesn't read as an .m3: ${(error as Error).message}`, { cause: error });
  }
}

/** The game's doodad and unit ids by their lower case, and its doodad models' paths (samePath), read once. */
let game: { readonly doodads: ReadonlyMap<string, string>; readonly units: ReadonlyMap<string, string>; readonly models: ReadonlySet<string> } | undefined;
const byCase = (ids: Iterable<string>): Map<string, string> => new Map([...ids].map((id) => [id.toLowerCase(), id]));

/** Refuses `doodad` when its id is a game doodad's or unit's. */
function gameIdClashes(doodad: CustomDoodad, label: string): NonNullable<typeof game> {
  game ??= { doodads: byCase(listDoodads().map(([id]) => id)), units: byCase(gameUnitIds()), models: new Set([...gameDoodadModels()].map(samePath)) };
  const doodadId = game.doodads.get(doodad.id.toLowerCase());
  if (doodadId) throw new Error(`${label}'s id is the game's doodad ${doodadId}: its CModel and CActorDoodad would replace that doodad's wherever they load. Give it an id of its own`);
  const unit = game.units.get(doodad.id.toLowerCase());
  if (unit) throw new Error(`${label}'s id is the game's unit ${unit}: its CModel and CActorDoodad would replace that unit's model and actor, which have its id, so the unit would draw as a still prop. Give it an id of its own`);
  return game;
}

/** Refuses `doodad` when its id is a game doodad's or unit's; the warning when its model is at a game doodad model's path. */
function gameClashes(doodad: CustomDoodad, label: string): string[] {
  return gameIdClashes(doodad, label).models.has(samePath(doodad.model))
    ? [`${label}'s model ${doodad.model} is at a game doodad's model's path: its file replaces the game's for every doodad and unit that draws it. Give it a path of its own, unless that replacement is the point`]
    : [];
}

const box = ({ min, max }: { readonly min: readonly number[]; readonly max: readonly number[] }): string => `(${min.join(", ")}) to (${max.join(", ")})`;

/**
 * Checks the files `doodad` (named `label`, such as `doodads.0 (Ring)`) draws on, as above, reading
 * each through `find`; `lookedIn` says where `find` looks, for the refusal. Throws, naming every
 * file missing, when the model or a texture isn't found, and when its id is a game doodad's or unit's; returns the warnings.
 */
export function checkCustomDoodadFiles(doodad: CustomDoodad, label: string, find: (storagePath: string) => FoundFile | undefined, lookedIn: string): string[] {
  if (doodad.gameModel) {
    gameIdClashes(doodad, label);
    if (!isGameModel(doodad.model)) throw new Error(`${label}'s model ${doodad.model} is a gameModel, but core knows of no game model at that path (a CModel's file, a game doodad's or a story set's part): fix the path (a game model's file, such as a stock doodad's), or leave gameModel out for a model of the Workspace's. If the game does have that file, it is a game file core's list lacks (data/game-models.json): report it on sc2-adjutant`);
    // Its file isn't read (the game's), so the bounds and Stand checks don't apply; one the map loads at its path replaces it.
    const shadow = find(doodad.model);
    return shadow ? [`${label}'s model ${doodad.model} is a gameModel, but ${shadow.where} is at that path too, and the game draws that file instead: remove it, unless that replacement is the point`] : [];
  }
  const clashes = gameClashes(doodad, label);
  const model = find(doodad.model);
  if (!model) throw new Error(`${label}'s model ${doodad.model} isn't in ${lookedIn}: add the file there (and compile it), or fix the path`);
  // A checkout without the Git LFS objects holds pointers: say so, rather than read one as a model or take it for a texture.
  const pointers = [{ path: doodad.model, found: model }, ...readTextures(model, label, doodad.model).map((texture) => ({ path: texture, found: find(texture) }))].filter(
    ({ found }) => found !== undefined && isLfsPointer(Buffer.from(found.data)),
  );
  if (pointers.length > 0) throw new Error(`${label}'s ${pointers.map(({ path: file, found }) => `${file} (${found!.where})`).join(", ")} ${pointers.length === 1 ? "is a Git LFS pointer" : "are Git LFS pointers"}, ${pointers.length === 1 ? "its file" : "their files"} not pulled on this machine: run git lfs pull, then compile again`);
  const textures = readTextures(model, label, doodad.model);
  const game = new Set(doodad.gameTextures.map(samePath));
  const missing = textures.filter((texture) => !game.has(samePath(texture)) && !find(texture));
  if (missing.length > 0) {
    throw new Error(
      `${label}'s model ${doodad.model} names ${missing.length === 1 ? "a texture" : "textures"} that ${missing.length === 1 ? "isn't" : "aren't"} in ${lookedIn}: ${missing.join(", ")}. Add each file at that path, or, when it is the game's own texture, list it in the doodad's gameTextures`,
    );
  }
  const warnings: string[] = [...clashes];
  // A swap's new texture listed as the game's is used too.
  const used = new Set([...textures, ...doodad.swaps.map((swap) => swap.with)].map(samePath));
  const unused = doodad.gameTextures.filter((texture) => !used.has(samePath(texture)));
  if (unused.length > 0) warnings.push(`${label}'s gameTextures lists ${unused.join(", ")}, which its model doesn't name: leave ${unused.length === 1 ? "it" : "them"} out`);
  // The bounds check advises: a mesh it can't read is said, not refused.
  let bounds: { readonly min: readonly number[]; readonly max: readonly number[] } | undefined;
  let mesh: { readonly min: readonly number[]; readonly max: readonly number[] } | undefined;
  try {
    bounds = readM3Footprint(model.data);
    mesh = readM3MeshExtent(model.data);
  } catch (error) {
    warnings.push(`${label}'s model ${doodad.model} has a mesh the compile can't read, so its bounds weren't checked: ${(error as Error).message}`);
  }
  if (bounds && mesh) {
    // A mesh past its bounds by more than a tenth of its size (half a unit at least) on any axis.
    const past = [0, 1, 2].some((axis) => {
      const out = Math.max(bounds!.min[axis]! - mesh!.min[axis]!, mesh!.max[axis]! - bounds!.max[axis]!);
      return out > Math.max(0.5, 0.1 * (mesh!.max[axis]! - mesh!.min[axis]!));
    });
    if (past) {
      warnings.push(
        `${label}'s model ${doodad.model} has bounds ${box(bounds)} that don't cover its mesh, ${box(mesh)}: the game culls the whole model once those bounds leave the screen. Export it again with the armature's m3_bounds covering the mesh (for a model that turns, as wide as its farthest point)`,
      );
    }
  }
  if (doodad.animate && !readM3Sequences(model.data).some((sequence) => sequence.name.split(" ")[0] === "Stand")) {
    warnings.push(`${label} is animated, but its model ${doodad.model} has no Stand animation to loop: leave animate out for a still prop`);
  }
  return warnings;
}

/**
 * Finds a file by its storage path in the mod packages the game loads under the mod `id`, the mod's
 * own among them (its Asset Mod's too, once compiled): `lookedIn` says where, for messages.
 */
export async function modFileFinder(workspace: Pick<Workspace, "root" | "mods">, id: string): Promise<{ readonly find: (storagePath: string) => FoundFile | undefined; readonly lookedIn: string }> {
  const packages = await modPackagesUnder(workspace, await readWorkspaceMod(workspace, id));
  const lookedIn = `the mod packages it loads from the Workspace (${packages.map((pkg) => fromRoot(workspace.root, pkg)).join(", ")}), where an Asset Mod's assets put its files once it's compiled`;
  const find = (storagePath: string): FoundFile | undefined => {
    const found = findPackageFile(packages, storagePath);
    return found ? { data: readFileSync(found.file), where: fromRoot(workspace.root, found.file) } : undefined;
  };
  return { find, lookedIn };
}

/** An asset path a Generic Entry's field names: a model, or an image (an icon, a texture). */
const ASSET_PATH = /^Assets[\\/][^#*]*\.(m3|dds|tga|png|jpg)$/i;

/** The asset paths `entry`'s fields name, each with its field's name (a nested one dotted, as `TextureDeclares.Prefix`). */
export function entryAssetPaths(entry: GenericEntry): { readonly field: string; readonly path: string }[] {
  const found: { field: string; path: string }[] = [];
  const walk = (value: FieldValue, field: string): void => {
    if (typeof value === "string") {
      if (ASSET_PATH.test(value)) found.push({ field, path: value });
    } else if (Array.isArray(value)) for (const item of value) walk(item, field);
    else if (typeof value === "object") for (const [key, each] of Object.entries(value)) if (!key.startsWith("$")) walk(each, field === "" ? key : `${field}.${key}`);
  };
  for (const [name, value] of Object.entries(entry.fields)) walk(value, name);
  return found;
}

/** A model with variations is its numbered files (`<name>_00.m3` and on), as the game names them: the first one, for a path without a number. */
const numbered = (file: string): string[] => (/\.m3$/i.test(file) ? [file.replace(/\.m3$/i, "_00.m3")] : []);

/**
 * Warns about each asset path `entries`' fields name (entryAssetPaths) that is no file the game
 * loads under the mod: not found by `find` (as checkCustomDoodadFiles finds a model or texture), not
 * a model core knows of (isGameModel), and for an image not one the game's data names (isGameAsset, every stock mod).
 * The game may still have a file those lists lack, so it is advice. Names the entry, field and path.
 */
export function genericEntryAssetWarnings(entries: readonly GenericEntry[], find: (storagePath: string) => FoundFile | undefined, lookedIn: string): string[] {
  return entries.flatMap((entry) =>
    entryAssetPaths(entry)
      .filter(({ path: file }) => ![file, ...numbered(file)].some((each) => find(each) || isGameModel(each) || isGameAsset(each)))
      .map(
        ({ field, path: file }) =>
          `${genericEntryKey(entry)}'s ${field} names ${file}, which isn't in ${lookedIn}, and no ${/\.m3$/i.test(file) ? "game model" : "game image"} core knows of is at that path: the game shows a placeholder or nothing. Add the file there (and compile it), or fix the path. If it is a game file core's list lacks (data/game-models.json or data/game-assets.json), report it on sc2-adjutant`,
      ),
  );
}

/**
 * Checks the files of a Campaign Mod's doodads (its Blueprint `doodads`, its folder's id `id`) in
 * the Workspace's mod packages the game loads under it (its Asset Mod among them), as
 * checkCustomDoodadFiles does, and their swaps as a Mission's are, each `with` in those packages
 * or listed in `gameTextures`; a gameModel's swaps read the game's .m3 through the reader
 * `gameModels` gives, asked for only then.
 * Returns the warnings, and the slot of each of a doodad's swaps by its id, for shapeEntries.
 */
export async function modDoodadWarnings(
  doodads: readonly CustomDoodad[],
  workspace: Pick<Workspace, "root" | "mods">,
  id: string,
  gameModels: () => Promise<GameModelReader> = async () => NO_GAME_MODELS,
): Promise<{ readonly warnings: readonly string[]; readonly swaps: ReadonlyMap<string, readonly SwapSlot[]> }> {
  const swaps = new Map<string, readonly SwapSlot[]>();
  if (doodads.length === 0) return { warnings: [], swaps };
  const { find, lookedIn } = await modFileFinder(workspace, id);
  const warnings: string[] = [];
  for (const [index, doodad] of doodads.entries()) {
    const label = `doodads.${index} (${doodad.id})`;
    warnings.push(...checkCustomDoodadFiles(doodad, label, find, lookedIn));
    if (doodad.swaps.length === 0) continue;
    const checked = await swapSlots(doodad, label, find, lookedIn, gameModels);
    swaps.set(doodad.id, checked.slots);
    warnings.push(...checked.warnings);
  }
  return { warnings, swaps };
}

/** A file a Mission's doodads write into its Map Package: at its storage path, with forward slashes. */
export type DoodadFile = { readonly path: string; readonly data: Uint8Array };

/**
 * A Mission's own doodads' files, read from its folder (`missionDir`), each storage path once, and
 * the warnings of their check, as checkCustomDoodadFiles checks them: a file is found among them,
 * else in the Map Package `mapPackage` as a Kept file (one `compiled`, the paths its compile record
 * lists, is the last compile's copy, which this one removes unless it writes it again), else in the
 * Workspace's mod packages the map loads (`packages`, mapModPackages's for its dependencies), and
 * nowhere else: a texture of the Campaign Mod's is found only when the Mission depends on it. An own
 * file at a path one of those packages also holds is warned about, since it replaces that file
 * throughout the map. Their entries are checked against the game's data schema. Throws when a file
 * can't be read, two give one storage path different bytes, or a check refuses one.
 */
export async function missionDoodadFiles(
  doodads: readonly MissionDoodad[],
  missionDir: string,
  workspace: Pick<Workspace, "root">,
  packages: readonly string[],
  mapPackage: string,
  compiled: ReadonlySet<string> = new Set(),
  gameModels: GameModelReader = NO_GAME_MODELS,
): Promise<{ readonly files: readonly DoodadFile[]; readonly swaps: ReadonlyMap<string, readonly SwapSlot[]>; readonly warnings: readonly string[] }> {
  const schema = catalogSchema();
  const problems = doodads.flatMap((doodad, index) => customDoodadEntries(doodad).flatMap((entry) => schemaProblems(entry, schema).map((problem) => `doodads.${index} (${doodad.id}): ${problem}`)));
  if (problems.length > 0) throw new CatalogSchemaError(problems);
  const own = new Map<string, DoodadFile & { readonly source: string }>();
  const add = async (label: string, storagePath: string, source: string): Promise<void> => {
    const full = path.resolve(missionDir, source);
    if (!(await isInside(missionDir, full))) throw new Error(`${label}'s file ${source} isn't in the Mission's folder ${missionDir}`);
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(full));
    } catch (error) {
      throw new Error(`${label}'s file ${source} can't be read: ${(error as Error).message}`, { cause: error });
    }
    const other = own.get(samePath(storagePath));
    if (other && Buffer.compare(other.data, data) !== 0) throw new Error(`${label} writes ${storagePath} from ${source}, and another doodad writes it from ${other.source}, which differs: one storage path is one file`);
    own.set(samePath(storagePath), { path: storagePath.replace(/\\/g, "/"), data, source });
  };
  for (const [index, doodad] of doodads.entries()) {
    const label = `doodads.${index} (${doodad.id})`;
    // A gameModel's file is the game's: nothing to copy.
    if (doodad.source !== undefined) await add(label, doodad.model, doodad.source);
    for (const [texture, source] of Object.entries(doodad.textures)) await add(label, texture, source);
  }
  const find = (storagePath: string): FoundFile | undefined => {
    const file = own.get(samePath(storagePath));
    if (file) return { data: file.data, where: file.source };
    const kept = findPackageFile([mapPackage], storagePath);
    const isCompiled = kept !== undefined && compiled.has(samePath(path.relative(mapPackage, kept.file).split(path.sep).join("/")));
    const found = kept && !isCompiled ? kept : findPackageFile(packages, storagePath);
    return found ? { data: readFileSync(found.file), where: fromRoot(workspace.root, found.file) } : undefined;
  };
  const loaded = packages.length > 0 ? `the Workspace's mod packages the Mission depends on (${packages.map((pkg) => fromRoot(workspace.root, pkg)).join(", ")})` : "a Workspace mod package (the Mission depends on none)";
  const lookedIn = `the doodad's own files (its source and textures), the Map Package or ${loaded}`;
  // A doodad's own files come first, so its model is always its source.
  const warnings = doodads.flatMap((doodad, index) => checkCustomDoodadFiles(doodad, `doodads.${index} (${doodad.id})`, find, lookedIn));
  const swaps = new Map<string, readonly SwapSlot[]>();
  for (const [index, doodad] of doodads.entries()) {
    if (doodad.swaps.length === 0) continue;
    const label = `doodads.${index} (${doodad.id})`;
    const checked = await swapSlots(doodad, label, find, lookedIn, async () => gameModels);
    const named = new Set(readM3TexturePaths(checked.model.data).map(samePath));
    for (const [at, swap] of doodad.swaps.entries()) {
      // A gameModel's textures are the game's: a file shipped at one's path replaces it map-wide (the schema allows only swaps' new textures).
      if (doodad.gameModel && named.has(samePath(swap.with)) && Object.keys(doodad.textures).some((texture) => samePath(texture) === samePath(swap.with))) {
        throw new Error(`${label}'s swaps.${at} ships ${swap.with}, a texture its gameModel ${doodad.model} names: that file replaces the game's for every model in the map that draws it, so give the new texture a path of its own`);
      }
    }
    const entries = customDoodadEntries(doodad, checked.slots);
    const swapProblems = entries.flatMap((entry) => schemaProblems(entry, schema).map((problem) => `${label}: ${problem}`));
    if (swapProblems.length > 0) throw new CatalogSchemaError(swapProblems);
    swaps.set(doodad.id, checked.slots);
    warnings.push(...checked.warnings);
  }
  for (const file of own.values()) {
    const shadowed = findPackageFile(packages, file.path);
    if (shadowed) warnings.push(`${file.source} is written at ${file.path}, where ${fromRoot(workspace.root, shadowed.file)} is too: in this map it replaces that file for everything that draws it. Give it a path of its own, unless that replacement is the point`);
  }
  return { files: [...own.values()].map(({ path: file, data }) => ({ path: file, data })), swaps, warnings };
}

/**
 * The slot of each of `doodad`'s swaps (named `label`), checked as checkDoodadSwaps checks them
 * against the .m3 the game draws: the file at its path that `find` finds (its own, or one the map
 * loads in place of a gameModel's, warned about by checkCustomDoodadFiles), else a gameModel's read
 * from the game through the reader `gameModels` gives. Each `with` is found through `find` (`lookedIn` says where),
 * refused when it is a Git LFS pointer, or listed in `gameTextures`. Returns the model read too.
 */
async function swapSlots(
  doodad: CustomDoodad,
  label: string,
  find: (storagePath: string) => FoundFile | undefined,
  lookedIn: string,
  gameModels: () => Promise<GameModelReader>,
): Promise<{ readonly slots: readonly SwapSlot[]; readonly warnings: readonly string[]; readonly model: FoundFile }> {
  const model = find(doodad.model) ?? (await gameModelFile(doodad.model, label, await gameModels()));
  const checked = checkDoodadSwaps(doodad, label, model, (storagePath) => find(storagePath) !== undefined, lookedIn);
  for (const [at, swap] of doodad.swaps.entries()) {
    const found = find(swap.with);
    if (found && isLfsPointer(Buffer.from(found.data))) throw new Error(`${label}'s swaps.${at} draws ${swap.with} from ${found.where}, which is a Git LFS pointer, its file not pulled on this machine: run git lfs pull, then compile again`);
  }
  return { ...checked, model };
}

/**
 * Reads a game model's .m3 by its storage path, through the Host Adapter's model.export: `read` is
 * undefined on a machine whose Host Adapter (`adapter`, for messages) can't.
 */
export type GameModelReader = { readonly read: ((model: string) => Promise<Uint8Array>) | undefined; readonly adapter: string };

/** No Host Adapter to read the game's models with. */
const NO_GAME_MODELS: GameModelReader = { read: undefined, adapter: "none" };

/** The game's model file at `model` for `label`'s swaps: refused when the machine can't read it, since a slot the compile can't derive fails silently in the game. */
async function gameModelFile(model: string, label: string, { read, adapter }: GameModelReader): Promise<FoundFile> {
  if (!read) {
    throw new Error(
      `${label} swaps textures on the gameModel ${model}, whose .m3 the compile reads from the game for the layer each texture is in, through the Host Adapter's model.export, and this machine's Host Adapter (${adapter}) doesn't have it: compile on a machine whose Host Adapter does, or take the swaps out`,
    );
  }
  try {
    return { data: await read(model), where: "the game" };
  } catch (error) {
    throw new Error(`${label}'s gameModel ${model} couldn't be read from the game for its swaps: ${(error as Error).message}`, { cause: error });
  }
}

/** A GameModelReader through `host`'s model.export, each model into a scratch folder it removes. */
export function hostGameModels(host: Host): GameModelReader {
  const adapter = host.adapter ? `${host.adapter.name}, from ${host.machine.file}` : "none";
  if (!host.has("model.export")) return { read: undefined, adapter };
  return {
    adapter,
    read: async (model) => {
      const scratch = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-game-model-"));
      try {
        const file = path.join(scratch, "model.m3");
        await host.run("model.export", { model, outputPath: file });
        return new Uint8Array(await readFile(file));
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
