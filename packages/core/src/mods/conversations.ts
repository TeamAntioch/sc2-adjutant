// Conversations, a purpose-level shape (ADR-0011): each Screenplay a Campaign Mod's Blueprint
// declares (domain/mod-screenplay.ts) compiles into the CConversation it names, as a generic entry
// in ConversationData, and its text into ConversationStrings:
//
//   ## Scene 2: THE CRANE                 <Groups Id="Group00002" Name="Conversation/<id>/Group00002">,
//                                         its lines as Children, and a RootItems; its title the group's string;
//                                         a wordless scene (directions, no lines) an empty group
//   **DOCKHAND** `H-02-001-DOCKHAND`: …   <Lines> with the naming template's line id, the Sound
//                                         (the imported one, if the declaration keeps one, and its
//                                         imported FacialAnim), the speaker's
//                                         character as SpeakerCharacter, and its text (no emotion tags,
//                                         no direction) as Conversation/<id>/<line id>
//   its declaration's name                Conversation/Name/<id> in ObjectStrings, the
//                                         CConversation's own string, the name the Editor lists it by
//
// Line ids come from the Campaign Pack's naming template, as a Mission's do, so a script's Sound
// ID gives the line id the conversation was imported with. Every speaker is one of the Blueprint's
// own characters. The compile reads the Screenplay's pulled copy in the mod's folder; the pull
// (pullModScreenplays) refreshes it from the Screenplay Source.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { FieldStruct, FieldValue } from "../domain/catalog-fields.js";
import { OBJECT_STRINGS } from "../domain/entry-strings.js";
import { GAME_DATA_DIR, type ModBlueprint } from "../domain/mod-blueprint.js";
import type { ModScreenplay } from "../domain/mod-screenplay.js";
import type { PluginRegistry, ScreenplaySource } from "../plugins/plugin-api.js";
import { workspaceFor, type Workspace } from "../plugins/workspace.js";
import { lineMoves, type LineMoves } from "../script/line-moves.js";
import { type Script, type ScriptLine, nameScript, scriptLines } from "../script/name-script.js";
import { fetchFromSource, readScreenplay } from "../script/screenplay-source.js";
import { type ConversationLineField, conversationLineFields, groupId, OVERLAP_PREVIOUS_MS } from "../script/write-conversation-data.js";
import { isInside } from "../util/inside.js";
import { replaceFile } from "../util/replace-file.js";
import { charactersOf } from "./characters.js";
import type { GenericEntry } from "./generic-entries.js";
import { campaignMod, readModBlueprint } from "./workspace-mods.js";

export { CONVERSATION_STRINGS } from "../script/write-conversation-data.js";

/** Where a Campaign Mod's Conversations are: its Conversation catalog's own file. */
export const CONVERSATION_DATA = `${GAME_DATA_DIR}ConversationData.xml`;

/** One of the Blueprint's Screenplays, named for its Conversation. */
export type ModScript = { readonly screenplay: ModScreenplay; readonly index: number; readonly script: Script };

/**
 * `markdown`, the Blueprint's Screenplay `index`, parsed and named for its Conversation with the
 * Campaign Pack's naming template and the Blueprint's characters; throws, saying where, when it
 * isn't a Screenplay or can't be named (such as a speaker with no character).
 */
export function nameModScreenplay(markdown: string, blueprint: ModBlueprint, index: number, registry: PluginRegistry, blueprintFile: string): Script {
  const screenplay = blueprint.screenplays[index]!;
  const characters = charactersOf(blueprint.characters, `the characters of the Mod Blueprint ${blueprintFile}`);
  return readScreenplay(markdown, `screenplays.${index} (${screenplay.ref ?? screenplay.source})`, (parsed) => nameScript(parsed, blueprint.id, registry, characters, { conversationId: screenplay.conversation })).script;
}

/**
 * Why `script` would lose an imported id, if it would: each line `importedSounds` keeps is one the
 * Screenplay still has. A line renumbered or cut at the Source otherwise compiles under a new id,
 * or not at all, without a word; to let one go, remove its Sound from importedSounds.
 */
export function lostImportedLines({ screenplay, index, script }: ModScript): string | undefined {
  const ids = new Set(scriptLines(script).map((line) => line.lineId));
  const lost = Object.keys(screenplay.importedSounds).filter((id) => !ids.has(id));
  if (lost.length === 0) return undefined;
  return `screenplays.${index}'s importedSounds keeps ${lost.map((id) => `${id}'s`).join(", ")} Sound, but the Screenplay has no line ${lost.join(", ")}: imported line ids are kept, so a line renumbered at the Source changes its id. Put it back at the Source, or, to let the line go, remove it from importedSounds`;
}

/** Why `screenplay`'s importedGroupNames or importedFacialAnims would name a group or line `script` doesn't have, if one would. */
function lostImportedParts({ screenplay, index, script }: ModScript): string[] {
  const out: string[] = [];
  const groups = new Set(script.scenes.map((scene) => groupId(scene.number)));
  const lostGroups = Object.keys(screenplay.importedGroupNames ?? {}).filter((id) => !groups.has(id));
  if (lostGroups.length > 0) out.push(`screenplays.${index}'s importedGroupNames keeps ${lostGroups.map((id) => `${id}'s`).join(", ")} name, but the Screenplay has no scene ${lostGroups.map((id) => Number(id.slice("Group".length))).join(", ")}: put the scene back at the Source, or, to let the group go, remove it from importedGroupNames`);
  const lines = new Set(scriptLines(script).map((line) => line.lineId));
  const lostLines = Object.keys(screenplay.importedFacialAnims ?? {}).filter((id) => !lines.has(id));
  if (lostLines.length > 0) out.push(`screenplays.${index}'s importedFacialAnims keeps ${lostLines.map((id) => `${id}'s`).join(", ")} facial animation, but the Screenplay has no line ${lostLines.join(", ")}: put it back at the Source, or, to let it go, remove it from importedFacialAnims`);
  return out;
}

/** The name of `script`'s group for scene `scene`, its title's string key: the one it was imported with, else the shape's. */
export const groupName = (screenplay: ModScreenplay, conversation: string, scene: number): string => screenplay.importedGroupNames?.[groupId(scene)] ?? `Conversation/${conversation}/${groupId(scene)}`;

/** The Sound `line` plays: the one it was imported with, else the naming template's. */
export const lineSound = (screenplay: ModScreenplay, line: ScriptLine): string => screenplay.importedSounds[line.lineId] ?? line.soundId;

/**
 * What's wrong with the Blueprint's Screenplays, named, together, by the Screenplay each is in:
 * one that lost an imported line (lostImportedLines), and two lines that would play one Sound. A
 * Sound names its CSound and voice file across the whole mod, and core's default naming template
 * names a Campaign Mod's by the mod's id, so two Screenplays can give the same one; compared
 * without case, as a voice file's name is.
 */
export function modScriptProblems(scripts: readonly ModScript[]): { readonly index: number; readonly message: string }[] {
  const problems: { index: number; message: string }[] = [];
  const playing = new Map<string, string>();
  for (const read of scripts) {
    for (const lost of [lostImportedLines(read), ...lostImportedParts(read)]) if (lost) problems.push({ index: read.index, message: lost });
    for (const line of scriptLines(read.script)) {
      const sound = lineSound(read.screenplay, line);
      const here = `screenplays.${read.index}'s ${line.lineId}`;
      const other = playing.get(sound.toLowerCase());
      if (other) problems.push({ index: read.index, message: `${here} and ${other} would both play the Sound ${sound} (Sounds are compared without case): a Sound is one CSound and one voice file, so give one of them another at the Source, or in importedSounds` });
      else playing.set(sound.toLowerCase(), here);
    }
  }
  return problems;
}

/** The Blueprint's Screenplays, each read from its file in the mod's folder (by `source`) and named; throws on the first of modScriptProblems. */
export async function readModScreenplays(blueprint: ModBlueprint, registry: PluginRegistry, blueprintFile: string, source: (file: string) => Promise<Buffer>): Promise<ModScript[]> {
  const out: ModScript[] = [];
  for (const [index, screenplay] of blueprint.screenplays.entries()) {
    const markdown = (await source(screenplay.source)).toString("utf8");
    out.push({ screenplay, index, script: nameModScreenplay(markdown, blueprint, index, registry, blueprintFile) });
  }
  const [problem] = modScriptProblems(out);
  if (problem) throw new Error(problem.message);
  return out;
}

/** A line's fields as a generic entry's: each a value, an indexed one a list of its slots. */
function lineFields(fields: readonly ConversationLineField[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const { name, index, value } of fields) {
    if (index === undefined) out[name] = { value };
    else ((out[name] ??= []) as FieldStruct[]).push({ index, value });
  }
  return out;
}

/** A line's fields with the facial animation it was imported with, if any, where the Editor writes it: after its Text. */
function withFacialAnim(fields: readonly ConversationLineField[], anim: string | undefined): readonly ConversationLineField[] {
  if (anim === undefined) return fields;
  const at = fields.findIndex((field) => field.name === "Text") + 1;
  return [...fields.slice(0, at), { name: "FacialAnim", value: anim }, ...fields.slice(at)];
}

/** A Conversation's name's key, in ObjectStrings. */
export const conversationNameKey = (conversation: string): string => `Conversation/Name/${conversation}`;

/** The CConversation `script` compiles into, as a generic entry: its groups, then its lines, as the Editor writes them, and its name, if the declaration gives one. */
export function conversationEntry({ screenplay, script }: Pick<ModScript, "screenplay" | "script">): GenericEntry {
  const id = script.conversationId;
  // Every scene is a group, a wordless one (stage directions and no lines) with no children, as the Editor makes it.
  const scenes = script.scenes.map((scene) => ({ number: scene.number, lines: scene.items.flatMap((item) => (item.kind === "line" ? [item] : [])) }));
  const overlap = screenplay.overlapPrevious ?? OVERLAP_PREVIOUS_MS;
  return {
    catalog: "Conversation",
    class: "CConversation",
    id,
    fields: {
      EditorCategories: "ConversationType:Mission",
      ProductionLevel: 2,
      Groups: scenes.map((scene) => ({ Id: groupId(scene.number), Name: groupName(screenplay, id, scene.number), Children: scene.lines.map((line) => line.lineId) })),
      RootItems: scenes.map((scene) => groupId(scene.number)),
      Lines: scriptLines(script).map((line) => lineFields(withFacialAnim(conversationLineFields(id, line, { sound: lineSound(screenplay, line), overlap }), screenplay.importedFacialAnims?.[line.lineId]))),
    },
    ...(screenplay.name === undefined ? {} : { strings: { [OBJECT_STRINGS]: { [conversationNameKey(id)]: screenplay.name } } }),
  };
}

/** The strings `script` compiles into, in ConversationStrings: each scene's title, by its group's name (a wordless scene's too), and each line's text. */
export function conversationStrings({ screenplay, script }: Pick<ModScript, "screenplay" | "script">): Record<string, string> {
  const id = script.conversationId;
  const out: Record<string, string> = {};
  for (const scene of script.scenes) out[groupName(screenplay, id, scene.number)] = scene.title;
  for (const line of scriptLines(script)) out[`Conversation/${id}/${line.lineId}`] = line.shown;
  return out;
}

/** One Screenplay a pull refreshed. */
export type PulledModScreenplay = { readonly index: number; readonly ref: string; readonly path: string };

/**
 * Refreshes each of the Mod Blueprint's Screenplays from the Workspace's Screenplay Source: writes
 * what its `ref` fetches over its `source`, once it reads as a Screenplay the Blueprint can name.
 * Each is checked before any is written, as the compile checks them (modScriptProblems), so a
 * refused pull leaves every file as it was. Without a Source, the files are the Screenplays and
 * nothing is pulled.
 */
export async function pullModScreenplays(blueprintPath: string, workspace?: Workspace): Promise<{ readonly sourceName?: string; readonly pulled: readonly PulledModScreenplay[] }> {
  const blueprint = await readModBlueprint(blueprintPath);
  const { registry } = workspace ?? (await workspaceFor(blueprintPath));
  const source = registry.screenplaySource();
  if (!source) return { pulled: [] };
  const fetched: { readonly index: number; readonly ref: string; readonly file: string; readonly markdown: string; readonly script: Script }[] = [];
  for (const [index, screenplay] of blueprint.screenplays.entries()) {
    if (!screenplay.ref) throw new Error(`${blueprintPath}'s screenplays.${index} has no ref: name what the Screenplay Source ${source.name} knows it by`);
    const file = await modFile(blueprintPath, screenplay.source);
    const markdown = await fetchScreenplay(source, blueprint.id, screenplay.ref);
    fetched.push({ index, ref: screenplay.ref, file, markdown, script: nameModScreenplay(markdown, blueprint, index, registry, blueprintPath) });
  }
  // As the compile would read them: one that lost an imported line, or a Sound two lines play, is refused before anything is written.
  const [problem] = modScriptProblems(fetched.map(({ index, script }) => ({ screenplay: blueprint.screenplays[index]!, index, script })));
  if (problem) throw new Error(`${problem.message}; nothing was pulled`);
  for (const { file, markdown } of fetched) await writeScreenplay(file, markdown);
  return { sourceName: source.name, pulled: fetched.map(({ index, ref, file }) => ({ index, ref, path: file })) };
}

/**
 * The index of the Mod Blueprint's Screenplay that `name` addresses: what the Source knows it by
 * (`ref`, such as a script repo's Act), the Conversation it compiles into, or its file (as written, or its
 * name without the extension), the last two without case. Left out, the one Screenplay a mod
 * declares; a mod with several needs one named. Throws, listing what it declares, when `name`
 * matches none or more than one.
 */
export function findModScreenplay(blueprint: ModBlueprint, blueprintPath: string, name?: string): number {
  const declared = blueprint.screenplays;
  const listing = declared.map((screenplay, index) => `screenplays.${index}: ${[screenplay.ref, screenplay.conversation, screenplay.source].filter(Boolean).join(" / ")}`).join("; ");
  if (declared.length === 0) throw new Error(`${blueprintPath} declares no Screenplays`);
  if (name === undefined) {
    if (declared.length === 1) return 0;
    throw new Error(`${blueprintPath} declares ${declared.length} Screenplays: name one by its ref (act), conversation or source file (${listing})`);
  }
  const key = name.toLowerCase();
  const file = path.posix.normalize(name.replace(/\\/g, "/")).toLowerCase();
  const stem = (file: string): string => path.posix.basename(file.replace(/\\/g, "/")).replace(/\.[^.]*$/, "").toLowerCase();
  const matches = declared.flatMap((screenplay, index) =>
    screenplay.ref === name || screenplay.conversation.toLowerCase() === key || path.posix.normalize(screenplay.source.replace(/\\/g, "/")).toLowerCase() === file || stem(screenplay.source) === key ? [index] : [],
  );
  if (matches.length === 1) return matches[0]!;
  throw new Error(`${name} ${matches.length === 0 ? "names none of" : "is ambiguous among"} ${blueprintPath}'s Screenplays (${listing})`);
}

/** What editing one of the mod's Screenplays at the Source did: which one, and the Source's report. */
export type EditedModScreenplay = { readonly index: number; readonly ref: string; readonly report: string };

/**
 * Edits one of the Mod Blueprint's Screenplays (`name`, see findModScreenplay) at the Workspace's
 * Screenplay Source, or with `dryRun` shows what the edits would do. `edits` is in the Source's
 * own format and addresses lines by their sound IDs in the pulled copy, as a Mission's do. Nothing
 * is written in the Workspace: pull (or refreshModScreenplays) afterwards.
 */
export async function editModScreenplay(blueprintPath: string, name: string | undefined, edits: unknown, dryRun: boolean, workspace?: Workspace): Promise<EditedModScreenplay> {
  const blueprint = await readModBlueprint(blueprintPath);
  const { registry } = workspace ?? (await workspaceFor(blueprintPath));
  const index = findModScreenplay(blueprint, blueprintPath, name);
  const screenplay = blueprint.screenplays[index]!;
  const source = registry.screenplaySource();
  const file = path.join(path.dirname(blueprintPath), screenplay.source);
  if (!source) throw new Error(`The Workspace's Campaign Pack has no Screenplay Source: edit the Screenplay file ${file} itself`);
  if (!screenplay.ref) throw new Error(`${blueprintPath}'s screenplays.${index} has no ref: name what the Screenplay Source ${source.name} knows it by`);
  if (!source.edit) throw new Error(`The Screenplay Source ${source.name} can't edit Screenplays: edit ${screenplay.ref} where ${source.name} keeps it, then pull`);
  const report: unknown = await source.edit({ modId: blueprint.id, ref: screenplay.ref, edits, dryRun });
  if (typeof report !== "string") throw new Error(`The Screenplay Source ${source.name} returned ${typeof report} from its edit, not a report`);
  return { index, ref: screenplay.ref, report };
}

/** One Screenplay a refresh pulled, and how its lines moved from the copy the pull replaced. */
export type RefreshedModScreenplay = PulledModScreenplay & {
  /** Where each line went; undefined when there was no readable copy before the pull. */
  readonly moves?: LineMoves;
  /** Line ids of lines whose words or speaker changed and which `importedSounds` still gives a Sound: the old recording keeps playing until it's let go. */
  readonly keptSounds: readonly string[];
};

/**
 * pullModScreenplays, following the lines: for each Screenplay, the copy before the pull is
 * compared with the one after, so the author can see which sound IDs moved, changed or went, and
 * which changed lines still play an imported Sound.
 */
export async function refreshModScreenplays(blueprintPath: string, workspace?: Workspace): Promise<{ readonly sourceName?: string; readonly refreshed: readonly RefreshedModScreenplay[] }> {
  const blueprint = await readModBlueprint(blueprintPath);
  const resolved = workspace ?? (await workspaceFor(blueprintPath));
  const read = async (index: number): Promise<Script | undefined> => {
    try {
      const file = await modFile(blueprintPath, blueprint.screenplays[index]!.source);
      return nameModScreenplay(await readFile(file, "utf8"), blueprint, index, resolved.registry, blueprintPath);
    } catch {
      return undefined;
    }
  };
  const before = await Promise.all(blueprint.screenplays.map((_, index) => read(index)));
  const { sourceName, pulled } = await pullModScreenplays(blueprintPath, resolved);
  const refreshed: RefreshedModScreenplay[] = [];
  for (const one of pulled) {
    const after = await read(one.index);
    const was = before[one.index];
    const moves = was && after ? lineMoves(was, after) : undefined;
    const imported = blueprint.screenplays[one.index]!.importedSounds;
    const lineOf = new Map(after ? scriptLines(after).map((line) => [line.soundId, line.lineId]) : []);
    const keptSounds = (moves?.changed ?? []).flatMap((move) => {
      const lineId = lineOf.get(move.to);
      return lineId !== undefined && imported[lineId] !== undefined ? [lineId] : [];
    });
    refreshed.push({ ...one, ...(moves ? { moves } : {}), keptSounds });
  }
  return { ...(sourceName === undefined ? {} : { sourceName }), refreshed };
}

/** What the Source fetches for one of the mod's Screenplays, by its `ref` (fetchFromSource). */
export const fetchScreenplay = (source: ScreenplaySource, modId: string, ref: string): Promise<string> => fetchFromSource(source, { modId, ref });

/** The file `file` of the mod's folder, absolute; refused when it would be outside it. */
export async function modFile(blueprintPath: string, file: string): Promise<string> {
  const dir = path.dirname(blueprintPath);
  const full = path.join(dir, file);
  if (!(await isInside(dir, full))) throw new Error(`The Mod Blueprint's source ${file} isn't in the mod's folder ${dir}`);
  return full;
}

/** Writes a pulled Screenplay whole, so a failed write never leaves half of one. */
export async function writeScreenplay(file: string, markdown: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await replaceFile(file, markdown);
}

/** A conversation's line, its scene's group number and the Sound it plays: the imported one, else the naming template's. */
export type ConversationLine = { readonly line: ScriptLine; readonly group: number; readonly sound: string };

/** The lines of `script`, those of `groups` (scene numbers) if given, each with the Sound it plays. */
export function conversationLines({ screenplay, script }: Pick<ModScript, "screenplay" | "script">, groups?: readonly number[]): ConversationLine[] {
  return script.scenes
    .filter((scene) => !groups || groups.includes(scene.number))
    .flatMap((scene) => scene.items.flatMap((item) => (item.kind === "line" ? [{ line: item, group: scene.number, sound: lineSound(screenplay, item) }] : [])));
}

/**
 * The Screenplay of the Workspace's Campaign Mod that compiles into `conversation`, read from its
 * pulled copy and named as that mod's compile names it; `who` says who asks, for the error when the
 * Workspace has no Campaign Mod or none of its Screenplays is that conversation.
 */
export async function workspaceConversation(workspace: Workspace, conversation: string, who: string): Promise<ModScript> {
  const mod = await campaignMod(workspace);
  if (!mod) throw new Error(`${who} voices ${conversation}, but the Workspace has no Campaign Mod whose Screenplays would give its lines: the Campaign Pack names it (campaignMod), and import-mod brings it in`);
  const blueprint = await readModBlueprint(mod.blueprintPath);
  const index = blueprint.screenplays.findIndex((screenplay) => screenplay.conversation === conversation);
  if (index < 0) throw new Error(`${who} voices ${conversation}, which none of the Campaign Mod ${mod.name}'s Screenplays compiles (${mod.blueprintPath}): declare it there with convert-screenplay`);
  const screenplay = blueprint.screenplays[index]!;
  const markdown = await readFile(await modFile(mod.blueprintPath, screenplay.source), "utf8");
  return { screenplay, index, script: nameModScreenplay(markdown, blueprint, index, workspace.registry, mod.blueprintPath) };
}
