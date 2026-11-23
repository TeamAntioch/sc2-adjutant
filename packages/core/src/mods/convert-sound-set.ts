// The convert step for a conversation's voices (ADR-0011): it reads the Kept CSound and voice file
// of each line of one of a Campaign Mod's Screenplays, and writes the conversation's sound set
// into the Campaign Mod's Blueprint (domain/sound-set.ts) and its voices into the Blueprint of the
// Asset Mod that holds the files (domain/asset-source.ts). The next compile of each writes them
// over their Kept originals under the Equivalence Check.
//
//   a CSound with a Template     the template form, on its parent, whose AssetArrayTemplate gives the file
//   a CSound with an AssetArray  the AssetArray form, its File the voice file
//   the most common form         the set's; a line in another is in the set's `lines`
//   a line's voice file          its recording: the Asset Mod's own declaration of the file (an `assets`
//                                entry, moved into voices), else the package's file copied to
//                                voices/<Sound>.<format> in the Asset Mod's folder with its SHA-256
//   a line with no voice file    a placeholder, until it's recorded
//
// A voice file that's a Git LFS pointer (not pulled on this machine) is recorded by the SHA-256 it
// points to, and the pointer is what's copied: the compile then holds that line's file as the
// package has it until the recording is pulled, so a voice is never written over without it.
// A CSound a Generic Entry writes (convert-entries took it) moves into the sound set. Each line
// CSound's name, Sound/Name/<id> in ObjectStrings, is the sound set's, which writes its id: it
// leaves the Blueprint's raw strings and the moved CSound's strings (any other string the CSound
// held stays the Blueprint's, as a raw one), and a Kept name that isn't the id is a difference the
// compile will find. A CSound no sound set can write (an AssetArray with more than a line's voice,
// a Template no parent here gives a file for), a removed name or a moved CSound's string the raw
// strings give otherwise refuses the whole conversation, every one named, and nothing is written.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { AssetFile, AssetSource, Voices } from "../domain/asset-source.js";
import type { FieldStruct, FieldValue } from "../domain/catalog-fields.js";
import { OBJECT_STRINGS, type Strings } from "../domain/entry-strings.js";
import { GAME_DATA_DIR, ModBlueprintSchema } from "../domain/mod-blueprint.js";
import { LINE_ATTRIBUTES, type SoundForm, type SoundSet, TEMPLATE_PARAM } from "../domain/sound-set.js";
import { catalogEntries } from "../map/catalog-entries.js";
import { workspaceFor, type Workspace } from "../plugins/workspace.js";
import { replaceFile } from "../util/replace-file.js";
import { isLfsPointer, sha256 as sha256Of } from "./asset-sources.js";
import { conversationLines, modFile, readModScreenplays } from "./conversations.js";
import { type GenericEntry, genericEntry, readGenericEntries } from "./generic-entries.js";
import { withString } from "./entry-strings.js";
import { packageFiles, packageStringTable } from "./mod-package-files.js";
import { withRawStrings } from "./owned-strings.js";
import { dependedAssetMods, soundNameKey, templateParam } from "./sound-sets.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

const SOUND_DATA = `${GAME_DATA_DIR}SoundData.xml`;
/** The fields of a line's AssetArray, as the AssetArray form writes them. */
const ASSET_ARRAY_FIELDS = ["index", "File", "FacialAnim", "FacialGroup", "PortraitModel", "Speaker", "Subtitle"];
const VOICE_FORMATS = ["ogg", "wav"] as const;

export type ConvertSoundSetOptions = {
  /** The conversation to voice, one of the Blueprint's Screenplays compiles. */
  readonly conversation: string;
  /** The Workspace the mods are in; found above the Blueprint when not given. */
  readonly workspace?: Workspace;
};

export type ConvertedSoundSet = {
  readonly conversation: string;
  /** The Asset Mod whose voices it went in, by package name. */
  readonly assetMod: string;
  /** Each Sound recorded, in line order. */
  readonly recorded: readonly string[];
  /** Each line with no voice file in the package, which gets a placeholder until it's recorded. */
  readonly placeholders: readonly { readonly lineId: string; readonly sound: string }[];
  /** What the compile will find different from the Kept CSound, for an Accepted Difference, such as a renumbered line's Line. */
  readonly differences: readonly string[];
  /** The line CSounds' names taken out of the Kept strings, the raw strings and the moved CSounds', as items: the sound set writes them now. */
  readonly strings: readonly string[];
  /** The CSounds taken out of the Blueprint's Generic Entries, by key, now the sound set's. */
  readonly movedEntries: readonly string[];
  /** The Asset Mod's `assets` declarations taken into voices, by path. */
  readonly movedAssets: readonly string[];
};

/** A line's Kept CSound, read: the form it's in, its facial anim and its voice file's game path. */
type ReadSound = { readonly form: SoundForm; readonly facialAnim: string; readonly voice: string };

/** Writes the sound set and voices of `conversation`, a Screenplay of the Campaign Mod at `blueprintPath`, as above. */
export async function convertSoundSet(blueprintPath: string, { conversation, workspace: given }: ConvertSoundSetOptions): Promise<ConvertedSoundSet> {
  const blueprint = await readModBlueprint(blueprintPath);
  if (blueprint.kind !== "campaign") throw new Error(`${blueprintPath} is an Asset Mod's Blueprint: give the Campaign Mod's, whose Screenplay ${conversation} is`);
  const workspace = given ?? (await workspaceFor(blueprintPath));
  const scripts = await readModScreenplays(blueprint, workspace.registry, blueprintPath, async (file) => readFile(await modFile(blueprintPath, file)));
  const script = scripts.find((found) => found.script.conversationId === conversation);
  if (!script) throw new Error(`None of ${blueprintPath}'s Screenplays compiles ${conversation}: declare it with convert-screenplay first`);
  const lines = conversationLines(script);

  // The package's SoundData, every CSound by id.
  const pkg = await modPackage(blueprintPath);
  const soundFile = (await packageFiles(pkg)).find((name) => name.toLowerCase() === SOUND_DATA.toLowerCase());
  const kept = new Map<string, GenericEntry>();
  const problems: string[] = [];
  if (soundFile) {
    for (const entry of catalogEntries(await readFile(path.join(pkg, ...soundFile.split("/")), "utf8"))) {
      if (entry.className !== "CSound" || entry.id === undefined) continue;
      const generic = genericEntry(entry.text, "Sound");
      if ("refused" in generic) {
        if (lines.some(({ sound }) => sound === entry.id)) problems.push(`the CSound ${entry.id} can't be read: ${generic.refused}`);
        continue;
      }
      kept.set(entry.id, generic);
    }
  }

  // A line CSound a raw gameData source writes can't be the sound set's too.
  const sounds = new Set(lines.map(({ sound }) => sound));
  for (const [index, { file, source }] of blueprint.gameData.entries()) {
    if (file.toLowerCase() !== SOUND_DATA.toLowerCase()) continue;
    for (const entry of catalogEntries(await readFile(await modFile(blueprintPath, source), "utf8"))) {
      if (entry.className === "CSound" && entry.id !== undefined && sounds.has(entry.id)) problems.push(`the CSound ${entry.id} is written by gameData.${index} (${source}): take it out of that source first, so the sound set writes it`);
    }
  }

  // Each line's CSound, read.
  const differences: string[] = [];
  const read = new Map<string, ReadSound>();
  for (const { line, sound } of lines) {
    const entry = kept.get(sound);
    if (!entry) continue;
    const where = `${line.lineId}'s CSound ${sound}`;
    const result = readSound(entry, kept, { conversation, character: line.characterId, lineId: line.lineId, soundLine: line.soundLine, sound });
    if ("problem" in result) problems.push(`${where} ${result.problem}`);
    else {
      read.set(line.lineId, result.sound);
      differences.push(...result.differences.map((difference) => `${where}: ${difference}`));
    }
  }

  // Each line CSound's Kept name, which the sound set writes as its id.
  const keptNames = await packageStringTable(pkg, await packageFiles(pkg), OBJECT_STRINGS);
  /** The line CSounds whose names it takes, from the Kept strings, the raw ones or a moved CSound's. */
  const soundsNamed = new Set<string>();
  for (const { line, sound } of lines) {
    const key = soundNameKey(sound);
    // A removed name can't be written back: the sound set would write it.
    if (blueprint.removals.some(({ item }) => item === `string:${OBJECT_STRINGS}:${key}`)) problems.push(`removals names ${line.lineId}'s CSound's name ${key}, which the sound set writes: take it out of removals first`);
    const name = keptNames.get(key);
    if (name === undefined) continue;
    soundsNamed.add(sound);
    if (name !== sound) differences.push(`${line.lineId}'s CSound ${sound}: its name ${key} is "${name}", and the sound set writes "${sound}"`);
  }

  // The voice files, in one Asset Mod the Campaign Mod depends on, in one folder.
  const assetMods = await dependedAssetMods(blueprint, workspace, scripts);
  const holders = await Promise.all(assetMods.map(async (asset) => ({ asset, files: new Map((await packageFiles(asset.mod.modPackage)).map((file) => [file.toLowerCase(), file])) })));
  const files = new Map<string, { readonly holder: (typeof holders)[number]; readonly file: string }>();
  const missing: { readonly lineId: string; readonly sound: string; readonly voice: string }[] = [];
  for (const { line, sound } of lines) {
    const voice = read.get(line.lineId)?.voice;
    if (voice === undefined) continue;
    const candidates = ["Base.SC2Assets/", "Base.SC2Data/"].map((root) => `${root}${voice.replace(/\\/g, "/")}`.toLowerCase());
    const holder = holders.find((found) => candidates.some((candidate) => found.files.has(candidate)));
    if (!holder) {
      missing.push({ lineId: line.lineId, sound, voice });
      continue;
    }
    const file = holder.files.get(candidates.find((candidate) => holder.files.has(candidate))!)!;
    if (path.posix.basename(file, path.posix.extname(file)) !== sound) problems.push(`${line.lineId}'s voice file ${file} isn't named for its Sound ${sound}: voices name each line's file <Sound>.<format>`);
    else files.set(sound, { holder, file });
  }
  const owners = new Set([...files.values()].map(({ holder }) => holder));
  if (owners.size > 1) problems.push(`its voice files are in ${[...owners].map(({ asset }) => asset.mod.name).join(" and ")}: a conversation's voices are in one Asset Mod`);
  const owner = [...owners][0] ?? (holders.length === 1 ? holders[0] : undefined);
  if (!owner) problems.push(holders.length === 0 ? `the Campaign Mod depends on no Asset Mod of the Workspace to hold its voice files: add the Asset Mod to its dependencies` : `none of its voice files is in the Asset Mods it depends on (${holders.map(({ asset }) => asset.mod.name).join(", ")}), so which one holds them can't be told`);
  const folders = new Set([...files.values()].map(({ file }) => path.posix.dirname(file)));
  const formats = new Set([...files.values()].map(({ file }) => path.posix.extname(file).slice(1)));
  if (folders.size > 1) problems.push(`its voice files are in ${[...folders].join(", ")}: a conversation's voices are in one folder`);
  if (formats.size > 1 || [...formats].some((format) => !(VOICE_FORMATS as readonly string[]).includes(format))) problems.push(`its voice files are ${[...formats].map((format) => `.${format}`).join(" and ")}: a conversation's voices are all .ogg or all .wav`);
  if (folders.size === 0 && owner) problems.push(`none of its lines has a voice file in ${owner.asset.mod.name} to say which folder its voices go in`);
  // A Kept CSound whose file no Asset Mod has gets a placeholder only where the sound set would point it anyway.
  const folder = [...folders][0];
  const format = [...formats][0];
  for (const { lineId, sound, voice } of missing) {
    const placed = folder && format ? `${folder}/${sound}.${format}`.replace(/^Base\.SC2(Assets|Data)\//i, "").replace(/\//g, "\\") : undefined;
    if (placed?.toLowerCase() !== voice.toLowerCase()) problems.push(`${lineId}'s CSound ${sound} plays ${voice}, which none of the Asset Mods it depends on (${holders.map(({ asset }) => asset.mod.name).join(", ") || "none"}) has: the sound set would play ${placed ?? "a file in its voices' folder"} instead. Put the file in the Asset Mod, or point the CSound at it`);
  }
  // Another Asset Mod's voices for the conversation would voice its lines twice.
  for (const { asset } of holders) {
    if (asset === owner?.asset) continue;
    const other = await readModBlueprint(asset.mod.blueprintPath);
    if (other.voices.some((voices) => voices.conversation === conversation)) problems.push(`${asset.mod.name} already has voices for ${conversation}: a conversation's voices are in one Asset Mod, so take them out there first`);
  }
  if (problems.length > 0) throw new Error(`${conversation} can't be written as a sound set; nothing was written:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);

  const asset = owner!.asset;
  const assetDir = path.dirname(asset.mod.blueprintPath);
  const assetRaw = JSON.parse(await readFile(asset.mod.blueprintPath, "utf8")) as Record<string, unknown>;
  const assetBlueprint = ModBlueprintSchema.parse(assetRaw);

  // Each line's recording: the Asset Mod's own declaration of the file, else a copy of the package's.
  const previous = assetBlueprint.voices.find((voices) => voices.conversation === conversation);
  const declared = new Map(assetBlueprint.assets.map((file) => [file.path.toLowerCase(), file]));
  const recordings: Record<string, AssetSource> = {};
  const copies: { readonly from: string; readonly to: string }[] = [];
  const movedAssets: string[] = [];
  const placeholders: { lineId: string; sound: string }[] = [];
  for (const { line, sound } of lines) {
    const found = files.get(sound);
    const earlier = previous?.recordings[sound];
    if (!found) {
      if (earlier) recordings[sound] = earlier;
      else placeholders.push({ lineId: line.lineId, sound });
      continue;
    }
    const declaration = declared.get(found.file.toLowerCase());
    if (declaration) {
      recordings[sound] = declaration.source;
      movedAssets.push(declaration.path);
      continue;
    }
    const from = path.join(asset.mod.modPackage, ...found.file.split("/"));
    const bytes = await readFile(from);
    const pointed = isLfsPointer(bytes) ? /^oid sha256:([0-9a-f]{64})$/m.exec(bytes.toString("latin1"))?.[1] : undefined;
    if (isLfsPointer(bytes) && !pointed) {
      problems.push(`${line.lineId}'s voice file ${found.file} is a Git LFS pointer with no SHA-256`);
      continue;
    }
    const sha256 = pointed ?? sha256Of(bytes);
    // A recording already declared stays, while it's the file the package has.
    if (earlier) {
      if ("sha256" in earlier && earlier.sha256 !== sha256 && "file" in earlier) problems.push(`${line.lineId}'s voice file ${found.file} isn't its recording ${earlier.file} any more (changed in the Editor?): compile ${asset.mod.name} to keep or discard the change first`);
      else recordings[sound] = earlier;
      continue;
    }
    const file = `voices/${sound}.${format!}`;
    const to = path.join(assetDir, ...file.split("/"));
    if (existsSync(to) && !(await readFile(to)).equals(bytes)) problems.push(`${file} is already in ${asset.mod.name}'s folder, and isn't ${found.file}: move it, or declare it as the line's recording`);
    else if (!existsSync(to)) copies.push({ from, to });
    recordings[sound] = { file, sha256 };
  }
  if (problems.length > 0) throw new Error(`${conversation} can't be written as a sound set; nothing was written:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);

  // The sound set: the most common form the set's, any other a line's own.
  const soundSet = buildSoundSet(conversation, lines.map(({ line }) => ({ lineId: line.lineId, read: read.get(line.lineId) })));
  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
  const sets = ((raw.soundSets as { conversation: string }[] | undefined) ?? []).filter((set) => set.conversation !== conversation);
  const next = { ...raw, soundSets: [...sets, soundSet] };
  const voices: Voices = { conversation, folder: folder!, format: format as (typeof VOICE_FORMATS)[number], recordings };
  const otherVoices = ((assetRaw.voices as { conversation: string }[] | undefined) ?? []).filter((item) => item.conversation !== conversation);
  const moved = new Set(movedAssets.map((file) => file.toLowerCase()));
  const nextAsset: Record<string, unknown> = { ...assetRaw, voices: [...otherVoices, voices] };
  if (assetRaw.assets !== undefined) nextAsset.assets = (assetRaw.assets as AssetFile[]).filter((file) => !moved.has(file.path.toLowerCase()));

  // The line CSounds a Generic Entry writes, taken out: the sound set writes them now. Each one's
  // name is the sound set's; any other string it held stays the Blueprint's, as a raw string.
  const movedEntries: string[] = [];
  const sources: { readonly file: string; readonly list: GenericEntry[] }[] = [];
  /** The line CSound whose name each key is, in ObjectStrings. */
  const nameOf = new Map(lines.map(({ sound }) => [soundNameKey(sound), sound]));
  const isName = (stringsFile: string, key: string): boolean => stringsFile.toLowerCase() === OBJECT_STRINGS.toLowerCase() && nameOf.has(key);
  /** The Blueprint's raw strings, less the line CSounds' names and with the moved CSounds' other strings. */
  let rawStrings: Strings = {};
  let rawChanged = false;
  /** Takes the line CSounds' names out of `strings`, and adds the rest to the raw strings unless `raw` (they're the raw strings). */
  const sortStrings = (strings: Strings, raw: boolean, from: string): void => {
    for (const [stringsFile, keys] of Object.entries(strings)) {
      for (const [key, text] of Object.entries(keys)) {
        if (isName(stringsFile, key)) {
          soundsNamed.add(nameOf.get(key)!);
          if (raw) rawChanged = true;
          continue;
        }
        const given = rawStrings[stringsFile]?.[key];
        if (!raw && given !== undefined && given !== text) problems.push(`${from} holds ${key} in ${stringsFile} as "${text}", and the Blueprint's raw strings give it as "${given}": leave it to one of them first`);
        rawStrings = withString(rawStrings, stringsFile, key, text);
        if (!raw) rawChanged = true;
      }
    }
  };
  sortStrings(blueprint.strings, true, "the Blueprint's strings");
  for (const { source } of blueprint.entries) {
    const file = await modFile(blueprintPath, source);
    const list = readGenericEntries(await readFile(file, "utf8"), source);
    const kept = list.filter((entry) => !(entry.class === "CSound" && entry.id !== undefined && sounds.has(entry.id)));
    if (kept.length === list.length) continue;
    for (const entry of list.filter((found) => !kept.includes(found))) {
      movedEntries.push(`CSound:${entry.id}`);
      sortStrings(entry.strings ?? {}, false, `${source}'s CSound:${entry.id}`);
    }
    sources.push({ file, list: kept });
  }
  if (problems.length > 0) throw new Error(`${conversation} can't be written as a sound set; nothing was written:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  const withStrings = rawChanged ? withRawStrings(next, rawStrings) : next;
  // Both Blueprints are checked before anything is written.
  ModBlueprintSchema.parse(withStrings);
  ModBlueprintSchema.parse(nextAsset);

  // Written all or nothing: a failed write puts back what was written before it.
  const writes = [
    ...sources.map(({ file, list }) => ({ file, content: `${JSON.stringify(list, null, 2)}\n` })),
    { file: asset.mod.blueprintPath, content: `${JSON.stringify(nextAsset, null, 2)}\n` },
    { file: blueprintPath, content: `${JSON.stringify(withStrings, null, 2)}\n` },
  ];
  const originals = await Promise.all(writes.map(({ file }) => readFile(file, "utf8")));
  const copied: string[] = [];
  let written = 0;
  try {
    for (const { from, to } of copies) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      copied.push(to);
    }
    for (const { file, content } of writes) {
      await replaceFile(file, content);
      written++;
    }
  } catch (error) {
    const unrestored: string[] = [];
    for (const [index, { file }] of writes.slice(0, written).entries()) await replaceFile(file, originals[index]!).catch(() => unrestored.push(file));
    for (const file of copied) await rm(file, { force: true }).catch(() => unrestored.push(file));
    throw new Error(`${(error as Error).message}${unrestored.length > 0 ? `; and ${unrestored.join(", ")} couldn't be put back as they were` : "; everything written before it was put back"}`, { cause: error });
  }
  const strings = lines.flatMap(({ sound }) => (soundsNamed.has(sound) ? [`string:${OBJECT_STRINGS}:${soundNameKey(sound)}`] : []));
  return { conversation, assetMod: asset.mod.name, recorded: lines.flatMap(({ sound }) => (recordings[sound] ? [sound] : [])), placeholders, differences, strings, movedEntries, movedAssets };
}

/** The value of a field given as `{ value }`, or undefined when it isn't one. */
function valueOf(field: FieldValue | undefined): string | undefined {
  if (typeof field !== "object" || Array.isArray(field)) return undefined;
  const keys = Object.keys(field);
  const value = (field as FieldStruct).value;
  return keys.length === 1 && typeof value === "string" ? value : undefined;
}

/** The AssetArrayTemplate File `parent` (or a parent of its, in the same file) gives its children, if one does. */
function parentTemplate(parent: string, kept: ReadonlyMap<string, GenericEntry>): string | undefined {
  const seen = new Set<string>();
  for (let at = kept.get(parent); at && !seen.has(at.id!); at = at.parent ? kept.get(at.parent) : undefined) {
    seen.add(at.id!);
    const template = at.fields["AssetArrayTemplate"];
    if (typeof template === "object" && !Array.isArray(template) && typeof (template as FieldStruct).File === "string") return (template as FieldStruct).File as string;
  }
  return undefined;
}

type Line = { readonly conversation: string; readonly character: string; readonly lineId: string; readonly soundLine: string; readonly sound: string };

/** `entry`, a line's Kept CSound, as a sound set would write it, with what the compile will find different; or why no sound set can. */
function readSound(entry: GenericEntry, kept: ReadonlyMap<string, GenericEntry>, line: Line): { readonly sound: ReadSound; readonly differences: string[] } | { readonly problem: string } {
  const attributes = entry.attributes ?? {};
  if (!entry.parent) return { problem: "has no parent: a sound set's CSounds each have one" };
  if (entry.tokens !== undefined) return { problem: "declares tokens, which a sound set's CSounds don't" };
  const differences: string[] = [];
  const expect = (name: string, actual: string | undefined, wanted: string) => {
    if (actual !== wanted) differences.push(`its ${name} is ${actual === undefined ? "not given" : `"${actual}"`}, and the sound set writes "${wanted}"`);
  };
  expect("Subtitle", attributes.Subtitle, line.conversation);
  expect("Speaker", attributes.Speaker, line.character);
  expect("Line", attributes.Line, line.soundLine);
  const others = Object.fromEntries(Object.entries(attributes).filter(([name]) => !(LINE_ATTRIBUTES as readonly string[]).includes(name)));
  const base = { parent: entry.parent, attributes: others };

  if (attributes.Template !== undefined) {
    const parts = attributes.Template.split(";");
    if (parts.length !== 2) return { problem: `has the Template "${attributes.Template}", not <file>;<facial anim>` };
    const [param, facialAnim] = parts as [string, string];
    const template = parentTemplate(entry.parent, kept);
    if (template === undefined || template.split(TEMPLATE_PARAM).length !== 2) return { problem: `has a Template, but its parent ${entry.parent} gives no AssetArrayTemplate File with ${TEMPLATE_PARAM} in this SoundData` };
    if ("AssetArray" in entry.fields) return { problem: "has a Template and an AssetArray: a sound set writes one or the other" };
    const form: SoundForm = { ...base, template, fields: entry.fields };
    const voice = template.replace(TEMPLATE_PARAM, () => param.replace(/##id##/g, () => line.sound));
    const written = templateParam(form, voice, line.sound);
    if (written !== param) differences.push(`its Template gives the file as "${param}", and the sound set writes "${written}"`);
    return { sound: { form, facialAnim, voice }, differences };
  }

  const { AssetArray: assetArray, ...fields } = entry.fields;
  if (typeof assetArray !== "object" || Array.isArray(assetArray)) return { problem: "has neither a Template nor one AssetArray: a sound set writes one or the other" };
  const struct = assetArray as FieldStruct;
  const extra = Object.keys(struct).filter((name) => !ASSET_ARRAY_FIELDS.includes(name));
  const missing = ASSET_ARRAY_FIELDS.filter((name) => !(name in struct));
  if (extra.length > 0 || missing.length > 0) return { problem: `has an AssetArray ${[extra.length > 0 ? `with ${extra.join(", ")}` : "", missing.length > 0 ? `without ${missing.join(", ")}` : ""].filter(Boolean).join(" and ")}: a sound set's gives ${ASSET_ARRAY_FIELDS.slice(1).join(", ")}` };
  if (String(struct.index) !== "0") return { problem: `has its AssetArray at index ${String(struct.index)}: a sound set's is at 0` };
  const values = Object.fromEntries(ASSET_ARRAY_FIELDS.slice(1).map((name) => [name, valueOf(struct[name])]));
  const unread = Object.entries(values).flatMap(([name, value]) => (value === undefined ? [name] : []));
  if (unread.length > 0) return { problem: `has an AssetArray whose ${unread.join(", ")} isn't a value` };
  const set = ["FacialGroup", "PortraitModel"].filter((name) => values[name] !== "");
  if (set.length > 0) return { problem: `has an AssetArray with a ${set.map((name) => `${name} ("${values[name]}")`).join(" and ")}: a sound set writes them empty` };
  expect("AssetArray Speaker", values.Speaker, `ConversationState/Characters/${line.character}`);
  expect("AssetArray Subtitle", values.Subtitle, `Conversation/${line.conversation}/${line.lineId}`);
  return { sound: { form: { ...base, fields }, facialAnim: values.FacialAnim!, voice: values.File! }, differences };
}

/** A form as a sound set's JSON gives it: no empty attributes or fields. */
function compact(form: SoundForm): SoundForm {
  return {
    parent: form.parent,
    ...(form.template !== undefined ? { template: form.template } : {}),
    ...(Object.keys(form.attributes).length > 0 ? { attributes: form.attributes } : {}),
    ...(Object.keys(form.fields).length > 0 ? { fields: form.fields } : {}),
  } as SoundForm;
}

/** The sound set of `lines`, each with its Kept CSound read if it has one: the most common form the set's (the first line's on a tie), every other a line's own. */
function buildSoundSet(conversation: string, lines: readonly { readonly lineId: string; readonly read: ReadSound | undefined }[]): SoundSet {
  const keyOf = (form: SoundForm) => JSON.stringify([form.parent, form.template ?? null, Object.entries(form.attributes).sort(), form.fields]);
  const counts = new Map<string, { form: SoundForm; count: number }>();
  for (const { read } of lines) {
    if (!read) continue;
    const key = keyOf(read.form);
    const found = counts.get(key);
    if (found) found.count++;
    else counts.set(key, { form: read.form, count: 1 });
  }
  const main = [...counts.values()].reduce((best, next) => (next.count > best.count ? next : best)).form;
  const own: Record<string, SoundForm> = {};
  const facialAnims: Record<string, string> = {};
  for (const { lineId, read } of lines) {
    if (!read) continue;
    if (keyOf(read.form) !== keyOf(main)) own[lineId] = compact(read.form);
    if (read.facialAnim !== (read.form.template !== undefined ? "##id##" : "")) facialAnims[lineId] = read.facialAnim;
  }
  return {
    conversation,
    ...compact(main),
    ...(Object.keys(facialAnims).length > 0 ? { facialAnims } : {}),
    ...(Object.keys(own).length > 0 ? { lines: own } : {}),
  } as SoundSet;
}

/** What a conversion did, for the author. */
export function formatConvertedSoundSet({ conversation, assetMod, recorded, placeholders, differences, strings, movedEntries, movedAssets }: ConvertedSoundSet): string {
  return [
    `Wrote ${conversation}'s sound set, and its voices in ${assetMod}: ${recorded.length} recording(s)`,
    ...(movedAssets.length > 0 ? [`Moved ${movedAssets.length} of ${assetMod}'s assets into its voices: ${movedAssets.join(", ")}`] : []),
    ...(strings.length > 0 ? [`Took ${strings.length} line CSound name(s) out of the Kept strings, which the sound set writes now`] : []),
    ...(movedEntries.length > 0 ? [`Took ${movedEntries.length} CSound(s) out of the Generic Entries, which the sound set writes now: ${movedEntries.join(", ")}`] : []),
    ...placeholders.map(({ lineId, sound }) => `No voice file: ${lineId} (${sound}) gets a placeholder until it's recorded`),
    ...differences.map((difference) => `Different from the Kept CSound: ${difference}`),
  ].join("\n");
}
