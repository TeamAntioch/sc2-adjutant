// A Kept-terrain Mission's conversation converted to its Screenplay (ADR-0010): the Map Package's
// own CConversation, which `screenplay.script.conversationId` names, written from the Screenplay
// once `screenplay.script.conversion` records what its lines keep (convert-screenplay).
//
//   the CConversation   in Base.SC2Data/GameData/ConversationData.xml, as a Campaign Mod's
//                       conversation shape writes it (mods/conversations.ts): each scene a group,
//                       each line under the naming template's id, with the imported Sound, facial
//                       animation and overlap the conversion keeps
//   a CSound per line   in SoundData.xml: an imported Sound plays its Kept recording, any other
//                       line the template's Sound, voiced by a placeholder until it's recorded
//   its strings         in ConversationStrings.txt: each scene's title, each line's text and each
//                       speaker's name, as a compiled Mission's
//
// A line keeps its imported Sound only where its words are the recording's: its text unchanged,
// compared without mood tags, emphasis, punctuation, spacing or case (sameWords). A line whose
// words changed gets the template's Sound, so an old recording of other words never plays.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CompileRecord } from "../domain/compile-record.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { recordedItemKeys, triggerItemTexts } from "../triggers/splice-triggers.js";
import { fieldValue, keptGroups } from "../mods/convert-screenplay.js";
import { conversationEntry } from "../mods/conversations.js";
import { entryXml, genericEntry } from "../mods/generic-entries.js";
import { type Script, type ScriptLine, scriptLines } from "../script/name-script.js";
import { CONVERSATION_STRINGS, conversationStrings, groupId, soundDataXml, voiceAssetPath } from "../script/write-conversation-data.js";
import { catalogEntries } from "./catalog-entries.js";
import { CONVERSATION_DATA, CUTSCENES_DIR, cutsceneLineElements, packageFilesBelow } from "./kept-package.js";

export { CONVERSATION_DATA, CONVERSATION_STRINGS };
/** Where a Mission's CSounds are. */
export const SOUND_DATA = "Base.SC2Data/GameData/SoundData.xml";

/** What a conversion records: the Blueprint's `screenplay.script.conversion`. */
export type MissionConversion = NonNullable<NonNullable<MissionBlueprint["screenplay"]["script"]>["conversion"]>;

/** A line's words as a recording speaks them: no mood tags, markup or emphasis, punctuation as spaces, one space between words, any case. */
export function spokenWords(text: string): string {
  return text
    .replace(/\[\/?(?:Angry|Sad|Happy|Serious|Surprise|Fear)(?:\s+\d+)?\]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[’‘`]/g, "'")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether two texts speak the same words (spokenWords): a recording of one is a recording of the
 * other. Texts with no words, such as "..." or "*Laughter.*", are the same only as they're written.
 */
export function sameWords(a: string, b: string): boolean {
  const [one, other] = [spokenWords(a), spokenWords(b)];
  return one === "" || other === "" ? a.trim() === b.trim() : one === other;
}

/** The Sound `line` plays: the imported one the conversion keeps, else the naming template's. */
export const playedSound = (conversion: MissionConversion, line: ScriptLine): string => conversion.importedSounds[line.lineId] ?? line.soundId;

/** Whether `line` plays a Sound of its own, the template's, which a placeholder voices until it's recorded. */
export const voicedHere = (conversion: MissionConversion, line: ScriptLine): boolean => conversion.importedSounds[line.lineId] === undefined;

/** The Kept voice file an imported Sound plays, in the package (forward slashes), if it's there: its .ogg, else its .wav. */
export function keptVoiceFile(pkg: string, sound: string): { readonly file: string; readonly extension: "ogg" | "wav" } | undefined {
  for (const extension of ["ogg", "wav"] as const) {
    const file = voiceAssetPath({ soundId: sound }, extension);
    if (existsSync(path.join(pkg, ...file.split("/")))) return { file, extension };
  }
  return undefined;
}

/** `script` with only the lines that play a Sound of their own (voicedHere): the ones placeholders voice. */
export function voicedScript(script: Script, conversion: MissionConversion): Script {
  return { ...script, scenes: script.scenes.map((scene) => ({ ...scene, items: scene.items.filter((item) => item.kind !== "line" || voicedHere(conversion, item)) })) };
}

/** What a converted conversation compiles into: the catalog text of its CConversation and its CSounds, and its strings, by key. */
export type ConversationParts = { readonly conversationData: string; readonly soundData: string; readonly strings: Readonly<Record<string, string>> };

const catalog = (entries: readonly string[]): string => ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...entries, "</Catalog>", ""].join("\r\n");

/**
 * The converted conversation's parts, as above. `pkg` is the Map Package, whose Kept recording of
 * each imported Sound (keptVoiceFile) its CSound plays; a missing one is refused, naming it.
 * `format` is the Mission's voice format, which a line voiced here plays in.
 */
export function conversationParts(script: Script, conversion: MissionConversion, pkg: string, format: "wav" | "ogg"): ConversationParts {
  const id = script.conversationId;
  const entry = conversationEntry({ screenplay: { source: "", conversation: id, ...conversion }, script });
  const missing: string[] = [];
  const soundData = soundDataXml(script, format, (line) => {
    if (voicedHere(conversion, line)) return { soundId: line.soundId, extension: format };
    const sound = playedSound(conversion, line);
    const kept = keptVoiceFile(pkg, sound);
    if (!kept) missing.push(`${line.lineId}'s ${sound}`);
    return { soundId: sound, extension: kept?.extension ?? "ogg" };
  });
  if (missing.length > 0) {
    throw new Error(`screenplay.script.conversion keeps ${missing.join(", ")}, but the Map Package has no recording of ${missing.length === 1 ? "it" : "them"} in Assets/Sounds/Conversations: put the file back, or take the line out of importedSounds so it gets a placeholder`);
  }
  // Each scene's title under its group's name: the one it was imported with, else the shape's.
  const strings: Record<string, string> = {};
  for (const [key, text] of Object.entries(conversationStrings(script))) {
    const scene = script.scenes.find((candidate) => key === `Conversation/${id}/${groupId(candidate.number)}`);
    strings[scene ? (conversion.importedGroupNames?.[groupId(scene.number)] ?? key) : key] = text;
  }
  return { conversationData: catalog([entryXml(entry).replace(/\n/g, "\r\n")]), soundData, strings };
}

/** A line a Kept cutscene plays: the file (in the package, forward slashes), the line, and the Sound its element links, if it links one. */
export type KeptCutsceneLine = { readonly file: string; readonly line: string; readonly soundLink?: string };

/** The lines of `conversation` that the package's Kept cutscenes play, each once per element that plays it. */
export async function keptCutsceneLines(pkg: string, conversation: string, keptFile: (file: string) => boolean = () => true): Promise<KeptCutsceneLine[]> {
  const dir = path.join(pkg, ...CUTSCENES_DIR.split("/"));
  const out: KeptCutsceneLine[] = [];
  for (const name of await packageFilesBelow(dir, ".SC2Cutscene")) {
    const file = `${CUTSCENES_DIR}/${name}`;
    if (!keptFile(file)) continue;
    const { driven, onActors } = cutsceneLineElements(await readFile(path.join(dir, ...name.split("/")), "utf8"));
    for (const element of [...driven, ...onActors]) {
      if (element.conversation === conversation) out.push({ file, line: element.line, ...(element.soundLink ? { soundLink: element.soundLink } : {}) });
    }
  }
  return out;
}

/**
 * The Sound each line of a converted conversation plays of its own (voicedHere), by line id: the
 * Sound a Kept cutscene's element for it must link, since one linking another (the Kept recording
 * of the words it had) would play that.
 */
export function ownSounds(script: Script, conversion: MissionConversion): Map<string, string> {
  return new Map(scriptLines(script).flatMap((line) => (voicedHere(conversion, line) ? [[line.lineId, line.soundId] as const] : [])));
}

/** One element a relink changed: its line, and the Sound it linked and links now. */
export type Relink = { readonly line: string; readonly from: string; readonly to: string };

/**
 * A Kept cutscene's XML with the `soundLink` of each of its CCutsceneElementConversation elements
 * for a line of `conversation` in `sounds` (ownSounds) that links another Sound relinked to that
 * line's own, and nothing else in it changed; with each relink.
 */
export function relinkCutscene(xml: string, conversation: string, sounds: ReadonlyMap<string, string>): { readonly text: string; readonly relinked: readonly Relink[] } {
  const relinked: Relink[] = [];
  const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const text = xml.replace(/<CCutsceneElementConversation\b[^>]*>/g, (tag) => {
    const line = attribute(tag, "conversationLine");
    const from = attribute(tag, "soundLink");
    const to = line === undefined ? undefined : sounds.get(line);
    if (attribute(tag, "conversationLink") !== conversation || from === undefined || to === undefined || from === to) return tag;
    relinked.push({ line: line!, from, to });
    return tag.replace(/(\ssoundLink=")[^"]*(")/, `$1${to}$2`);
  });
  return { text, relinked };
}

/** The entry names of a converted conversation's parts, as the compile record and the Equivalence Check name them: the only Kept parts its compile may convert. */
export function conversationItemNames(parts: ConversationParts): Set<string> {
  return new Set([
    ...catalogEntries(parts.conversationData).map((entry) => `catalog-entry:${CONVERSATION_DATA}:${entry.key}`),
    ...catalogEntries(parts.soundData).map((entry) => `catalog-entry:${SOUND_DATA}:${entry.key}`),
    ...Object.keys(parts.strings).map((key) => `string:${CONVERSATION_STRINGS}:${key}`),
  ]);
}

/**
 * What a converted conversation leaves behind in the package, which the compile removes so no
 * junk stays: each Sound the package's conversation now plays (`current`, its CConversation's text,
 * Kept or as the last compile wrote it) that the Screenplay's no longer does, the Sound of a line
 * dropped or whose words changed, with its recording; and the string of each line or scene the
 * Screenplay no longer has. Empty once the compile has written the conversation.
 */
export function orphanedParts(current: string, script: Script, conversion: MissionConversion): { readonly sounds: readonly string[]; readonly strings: readonly string[] } {
  const entry = genericEntry(current, "Conversation");
  if ("refused" in entry) return { sounds: [], strings: [] };
  const id = script.conversationId;
  const lines = scriptLines(script);
  const playing = new Set(lines.map((line) => playedSound(conversion, line).toLowerCase()));
  const ids = new Set(lines.map((line) => line.lineId));
  const sounds = new Set<string>();
  const strings: string[] = [];
  for (const line of [entry.fields["Lines"] ?? []].flat()) {
    if (typeof line !== "object" || Array.isArray(line)) continue;
    const sound = fieldValue(line, "Sound");
    const lineId = fieldValue(line, "Id");
    if (sound !== undefined && !playing.has(sound.toLowerCase())) sounds.add(sound);
    if (lineId !== undefined && !ids.has(lineId)) strings.push(`Conversation/${id}/${lineId}`);
  }
  const scenes = new Set(script.scenes.map((scene) => groupId(scene.number)));
  for (const group of keptGroups(entry.fields["Groups"])) {
    if (!scenes.has(group.id)) strings.push(group.name ?? `Conversation/${id}/${group.id}`);
  }
  return { sounds: [...sounds], strings: [...new Set(strings)] };
}

/** `xml`, a catalog, without its entries `keys` (`CSound:<id>`), each with its line; the rest byte for byte. */
export function withoutEntries(xml: string, keys: ReadonlySet<string>): string {
  let out = "";
  let cursor = 0;
  for (const entry of catalogEntries(xml)) {
    if (!keys.has(entry.key)) continue;
    const newline = xml.lastIndexOf("\n", entry.start - 1);
    const from = newline < 0 ? entry.start : xml[newline - 1] === "\r" ? newline - 1 : newline;
    out += xml.slice(cursor, from);
    cursor = entry.end;
  }
  return out + xml.slice(cursor);
}

/**
 * Whether one of the package's Kept triggers names the Sound `sound` (a sound link in its XML), so
 * the Sound still plays there and stays when the conversation no longer plays it. The compile's own
 * triggers, those `record` lists, don't count: they're rebuilt from the Screenplay.
 */
export async function keptTriggersName(pkg: string, record: CompileRecord | undefined): Promise<(sound: string) => boolean> {
  const triggers = await readFile(path.join(pkg, "Triggers"), "utf8").catch(() => "");
  if (triggers === "") return () => false;
  const compiled = recordedItemKeys(record?.entries ?? []);
  const kept = [...triggerItemTexts(triggers)].flatMap(([key, item]) => (compiled.has(key) ? [] : [item.text])).join("\n");
  return (sound) => kept.includes(`"${sound}"`) || kept.includes(`>${sound}<`);
}
