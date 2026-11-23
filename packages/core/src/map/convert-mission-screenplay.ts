// The convert step for a Kept-terrain Mission's conversation (ADR-0010): the Map Package's own
// CConversation, which `screenplay.script.conversationId` names, becomes the Screenplay's, so the
// compile writes it, its CSounds and its strings from then on (map/mission-conversation.ts).
//
// The Screenplay is pulled, and its lines paired with the conversation's by line id, which the
// naming template gives (imported ids are kept). It records in `screenplay.script.conversion` what
// the lines keep: the Kept Sound of each line whose words are unchanged (sameWords), with its Kept
// recording, whether or not the naming template gives the same id; the imported group
// names, facial animations and overlap. Unlike a mod's conversion, a line whose words changed
// doesn't keep its Sound: it gets the template's, and a placeholder voice, so the old recording of
// other words never plays. Lines may be added and dropped: an added line is voiced like a new one,
// and the compile removes a dropped one's Sound and string, as nothing plays them (a Kept cutscene still
// playing it fails `check`).
//
// It lists every difference: the lines whose words changed, those added and dropped, a speaker
// changed, the Kept cutscenes that play a dropped line or a changed one by its old Sound (the
// compile relinks those), and each part the first compile writes over its Kept original other than
// as the Editor has it, which the Equivalence Check refuses unless the Blueprint names it in
// acceptedDifferences. `accept` names each one with the author's reason. Nothing in the package
// changes; it may run again until the first compile has written the conversation.

import { readFile } from "node:fs/promises";

import type { CompileRecord } from "../domain/compile-record.js";
import { hasKeptTerrain } from "../domain/mission-blueprint.js";
import { catalogEntries } from "./catalog-entries.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";
import { stringLines } from "./package-elements.js";
import { difference } from "../mods/equivalence.js";
import { fieldValue, keptGroups } from "../mods/convert-screenplay.js";
import { genericEntry } from "../mods/generic-entries.js";
import { OVERLAP_PREVIOUS_MS, groupId } from "../script/write-conversation-data.js";
import { pullScreenplay } from "../script/screenplay-source.js";
import { readMissionScript, scriptLines } from "../script/name-script.js";
import { missionCatalogFor } from "./mission-catalog.js";
import { parseMissionBlueprint, readRawBlueprint, validateMissionBlueprint, workspaceFor, type Workspace } from "../plugins/workspace.js";
import { replaceFile } from "../util/replace-file.js";
import { DEFAULT_VOICE_FORMAT } from "../host/voice-files.js";
import { CONVERSATION_DATA, CONVERSATION_STRINGS, conversationParts, keptCutsceneLines, keptTriggersName, keptVoiceFile, type MissionConversion, orphanedParts, SOUND_DATA, sameWords } from "./mission-conversation.js";
import path from "node:path";

export type ConvertMissionScreenplayOptions = {
  /** The Workspace the Mission is in; found above the Blueprint when not given. */
  readonly workspace?: Workspace;
  /** The author's reason for every difference the first compile meets: each is named in acceptedDifferences with it. */
  readonly accept?: string;
  /** The Mission's Map Package, when the caller has found it already (missionMapPackage). */
  readonly mapPackage?: string;
};

/** A part the first compile writes other than as the Editor has it: its Equivalence Check item, and where it first differs. */
export type ItemDifference = { readonly item: string; readonly detail: string };

export type ConvertedMissionScreenplay = {
  readonly conversation: string;
  /** How many lines the Screenplay has, and the Kept conversation. */
  readonly lines: number;
  readonly keptLines: number;
  /** The lines that keep their imported Sound, their words unchanged. */
  readonly keepingSounds: number;
  /** The lines whose words changed: each gets the template's Sound and a placeholder. */
  readonly changed: readonly { readonly line: string; readonly kept: string; readonly script: string }[];
  /** The Screenplay's lines the conversation hasn't. */
  readonly added: readonly string[];
  /** The conversation's lines the Screenplay hasn't, each with the Kept cutscenes that still play it. */
  readonly dropped: readonly { readonly line: string; readonly cutscenes: readonly string[] }[];
  /** The lines whose speaker's character changed. */
  readonly speakers: readonly { readonly line: string; readonly kept: string; readonly script: string }[];
  /** An imported Sound kept by its words whose recording the package lacks: the line gets a placeholder instead. */
  readonly unrecorded: readonly string[];
  /** The Kept cutscenes that play a changed line by its old Sound, which the compile relinks. */
  readonly relinks: readonly { readonly file: string; readonly line: string; readonly from: string; readonly to: string }[];
  /** What the first compile removes, as nothing plays it: the Sounds of changed and dropped lines (with their recordings) and the dropped lines' and scenes' strings. A Sound a Kept trigger names is kept, and listed apart. */
  readonly removes: { readonly sounds: readonly string[]; readonly strings: readonly string[]; readonly keptForTriggers: readonly string[] };
  /** Each part the first compile writes other than as the Editor has it. */
  readonly differences: readonly ItemDifference[];
  /** How many of them this run named in acceptedDifferences, and how many still aren't named. */
  readonly accepted: number;
  readonly unaccepted: number;
};

/** Converts the Kept conversation of the Mission at `blueprintPath` to its Screenplay, as above. */
export async function convertMissionScreenplay(blueprintPath: string, options: ConvertMissionScreenplayOptions = {}): Promise<ConvertedMissionScreenplay> {
  const workspace = options.workspace ?? (await workspaceFor(blueprintPath));
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const reference = blueprint.screenplay.script;
  if (!reference) throw new Error(`${blueprintPath} has no screenplay.script: name the Screenplay its conversation comes from first`);
  const conversation = reference.conversationId;
  if (!conversation) throw new Error(`${blueprintPath}'s screenplay.script names no conversationId: a Mission's conversation is converted when it's the Map Package's own, which conversationId names`);
  if (!hasKeptTerrain(blueprint)) throw new Error(`${blueprintPath} has no Kept terrain, so its compile writes its conversation whole already: there's nothing Kept to convert`);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the map with import-map, which writes an empty one`);
  const key = `CConversation:${conversation}`;
  if (compiledAlready(record, key)) throw new Error(`${conversation} is Compiled Content already: the compile writes it from the Screenplay, so there's nothing Kept left to convert`);
  const pkg = options.mapPackage ?? (await missionMapPackage(blueprintPath));
  const keptData = await readFile(path.join(pkg, ...CONVERSATION_DATA.split("/")), "utf8").catch(() => "");
  const kept = catalogEntries(keptData).find((entry) => entry.key === key);
  if (!kept) throw new Error(`The Map Package ${pkg} has no CConversation ${conversation} in ${CONVERSATION_DATA}`);
  const imported = genericEntry(kept.text, "Conversation");
  if ("refused" in imported) throw new Error(`${conversation} can't be read as a conversation: ${imported.refused}`);

  // The Screenplay, pulled from the Source (a Workspace without one has it as its file).
  await pullScreenplay({ blueprint, workspace }, blueprintPath);
  const script = (await readMissionScript(blueprint, blueprintPath, workspace))!.script;
  const lines = scriptLines(script);

  const keptLines = [imported.fields["Lines"] ?? []].flat().flatMap((line) => {
    if (typeof line !== "object" || Array.isArray(line)) return [];
    const id = fieldValue(line, "Id");
    return id ? [{ id, sound: fieldValue(line, "Sound"), overlap: fieldValue(line, "OverlapPrevious"), speaker: fieldValue(line, "SpeakerCharacter"), facialAnim: fieldValue(line, "FacialAnim") }] : [];
  });
  const keptById = new Map(keptLines.map((line) => [line.id, line]));
  const keptStrings = new Map(stringLines(await readFile(path.join(pkg, ...CONVERSATION_STRINGS.split("/")), "utf8").catch(() => "")).lines.map((line) => [line.key, line.text]));
  const keptText = (key: string): string | undefined => {
    const text = keptStrings.get(key);
    return text === undefined ? undefined : text.slice(text.indexOf("=") + 1).replace(/\r?\n$/, "");
  };

  const overlaps = new Set(keptLines.map((line) => line.overlap));
  if (overlaps.size > 1) throw new Error(`${conversation}'s lines overlap the one before by ${[...overlaps].map((overlap) => (overlap === undefined ? "the default" : `${overlap} ms`)).join(", ")}: a Screenplay's lines all overlap alike`);
  const overlap = Number([...overlaps][0] ?? OVERLAP_PREVIOUS_MS);

  // Each line by its id: a Kept one whose words are the Screenplay's keeps its Sound and facial animation.
  const importedSounds: Record<string, string> = {};
  const importedFacialAnims: Record<string, string> = {};
  const changed: { line: string; kept: string; script: string }[] = [];
  const added: string[] = [];
  const speakers: { line: string; kept: string; script: string }[] = [];
  const unrecorded: string[] = [];
  const clashes: string[] = [];
  for (const line of lines) {
    const was = keptById.get(line.lineId);
    if (!was) {
      added.push(line.lineId);
      continue;
    }
    if (was.speaker !== undefined && was.speaker !== line.characterId) speakers.push({ line: line.lineId, kept: was.speaker, script: line.characterId });
    const text = keptText(`Conversation/${conversation}/${line.lineId}`);
    if (text === undefined || !sameWords(text, line.text)) {
      changed.push({ line: line.lineId, kept: text ?? "(no text)", script: line.shown });
      // Its new Sound can't be the one whose Kept recording speaks the old words.
      if (was.sound !== undefined && was.sound.toLowerCase() === line.soundId.toLowerCase() && keptVoiceFile(pkg, was.sound)) clashes.push(`${line.lineId} (${was.sound})`);
      continue;
    }
    if (was.sound === undefined) continue;
    if (!keptVoiceFile(pkg, was.sound)) {
      unrecorded.push(`${line.lineId} (${was.sound})`);
      continue;
    }
    importedSounds[line.lineId] = was.sound;
    if (was.facialAnim !== undefined) importedFacialAnims[line.lineId] = was.facialAnim;
  }
  if (clashes.length > 0) {
    throw new Error(`${clashes.join(", ")}: the words changed, but the naming template gives ${clashes.length === 1 ? "it" : "each"} the Sound whose Kept recording speaks the old words, so that recording would play. Give ${clashes.length === 1 ? "it" : "each"} a new sound ID at the Source, then convert again`);
  }
  const ids = new Set(lines.map((line) => line.lineId));
  const cutsceneLines = await keptCutsceneLines(pkg, conversation, (file) => !compiledFile(record, file));
  const dropped = keptLines
    .filter((line) => !ids.has(line.id))
    .map((line) => ({ line: line.id, cutscenes: [...new Set(cutsceneLines.filter((played) => played.line === line.id).map((played) => played.file))] }));

  // Each scene's group name, where the Editor kept one the shape wouldn't give.
  const groups = keptGroups(imported.fields["Groups"]);
  const importedGroupNames: Record<string, string> = {};
  for (const scene of script.scenes) {
    const name = groups.find((group) => group.id === groupId(scene.number) && group.name !== undefined)?.name;
    if (name !== undefined && name !== `Conversation/${conversation}/${groupId(scene.number)}`) importedGroupNames[groupId(scene.number)] = name;
  }
  const conversion: MissionConversion = {
    importedSounds,
    ...(Object.keys(importedGroupNames).length > 0 ? { importedGroupNames } : {}),
    ...(Object.keys(importedFacialAnims).length > 0 ? { importedFacialAnims } : {}),
    ...(overlap !== OVERLAP_PREVIOUS_MS ? { overlapPrevious: overlap } : {}),
  };

  // The Kept cutscenes linking a line that plays a Sound of its own by another, which the compile relinks (ownSounds).
  const relinks = cutsceneLines.flatMap((played) => {
    const line = lines.find((candidate) => candidate.lineId === played.line);
    if (!line || importedSounds[line.lineId] !== undefined || played.soundLink === undefined || played.soundLink === line.soundId) return [];
    return [{ file: played.file, line: played.line, from: played.soundLink, to: line.soundId }];
  });

  // What the first compile removes, as write-map-package does.
  const orphans = orphanedParts(kept.text, script, conversion);
  const namedByTrigger = await keptTriggersName(pkg, record);
  const removes = { sounds: orphans.sounds.filter((sound) => !namedByTrigger(sound)), strings: orphans.strings, keptForTriggers: orphans.sounds.filter(namedByTrigger) };

  // What the first compile writes over its Kept original, compared as the Equivalence Check compares it.
  const parts = conversationParts(script, conversion, pkg, reference.voiceFormat ?? DEFAULT_VOICE_FORMAT);
  const differences: ItemDifference[] = [];
  const compare = (file: string, keptText: string, compiledText: string): void => {
    const keptEntries = new Map(catalogEntries(keptText).map((entry) => [entry.key, entry.text]));
    for (const entry of catalogEntries(compiledText)) {
      const was = keptEntries.get(entry.key);
      if (was === undefined || compiledEntry(record, file, entry.key)) continue;
      const item = `catalog-entry:${file}:${entry.key}`;
      const detail = difference(item, was, entry.text);
      if (detail) differences.push({ item, detail });
    }
  };
  compare(CONVERSATION_DATA, keptData, parts.conversationData);
  compare(SOUND_DATA, await readFile(path.join(pkg, ...SOUND_DATA.split("/")), "utf8").catch(() => ""), parts.soundData);
  for (const [stringKey, text] of Object.entries(parts.strings)) {
    const was = keptStrings.get(stringKey);
    if (was === undefined || compiledString(record, stringKey)) continue;
    const item = `string:${CONVERSATION_STRINGS}:${stringKey}`;
    const detail = difference(item, was, `${stringKey}=${text}`);
    if (detail) differences.push({ item, detail });
  }

  // The Blueprint as it is on disk, with the conversion, and with accept every difference named.
  const raw = (await readRawBlueprint(blueprintPath)) as Record<string, unknown> & { screenplay: { script: Record<string, unknown> } };
  const already = (raw["acceptedDifferences"] as { item: string; reason: string }[] | undefined) ?? [];
  const adding = options.accept === undefined ? [] : differences.filter((found) => !already.some((other) => other.item === found.item)).map(({ item }) => ({ item, reason: options.accept! }));
  const acceptedDifferences = [...already, ...adding];
  const next = {
    ...raw,
    ...(acceptedDifferences.length > 0 ? { acceptedDifferences } : {}),
    screenplay: { ...raw.screenplay, script: { ...raw.screenplay.script, conversion } },
  };
  const validated = validateMissionBlueprint(workspace, next, await missionCatalogFor(workspace.catalog, blueprintPath));
  if (!validated.success) throw new Error(`The converted Blueprint wouldn't be valid: ${validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  await replaceFile(blueprintPath, `${JSON.stringify(next, null, 2)}\n`);
  const named = new Set(acceptedDifferences.map((accepted) => accepted.item));
  return {
    conversation,
    lines: lines.length,
    keptLines: keptLines.length,
    keepingSounds: Object.keys(importedSounds).length,
    changed,
    added,
    dropped,
    speakers,
    unrecorded,
    relinks,
    removes,
    differences,
    accepted: adding.length,
    unaccepted: differences.filter((found) => !named.has(found.item)).length,
  };
}

/** Whether the record lists `key` in ConversationData: the compile writes the conversation already. */
const compiledAlready = (record: CompileRecord, key: string): boolean => compiledEntry(record, CONVERSATION_DATA, key);
const compiledEntry = (record: CompileRecord, file: string, key: string): boolean => record.entries.some((entry) => entry.kind === "catalog-entry" && entry.file === file && entry.id === key);
const compiledString = (record: CompileRecord, key: string): boolean => record.entries.some((entry) => entry.kind === "string" && entry.file === CONVERSATION_STRINGS && entry.key === key);
const compiledFile = (record: CompileRecord, file: string): boolean => record.entries.some((entry) => entry.kind === "file" && entry.path === file);

/** What a conversion found, for the author. `acceptHint` is how the caller's interface asks for accept (the CLI's flag by default). */
export function formatConvertedMissionScreenplay(converted: ConvertedMissionScreenplay, { acceptHint = "--accept <reason>" }: { readonly acceptHint?: string } = {}): string {
  const { conversation } = converted;
  return [
    `Converted ${conversation} to the Screenplay: ${converted.lines} line(s) against its ${converted.keptLines}; ${converted.keepingSounds} keep their imported Sound, their words unchanged`,
    ...(converted.changed.length
      ? [`${converted.changed.length} line(s) whose words changed get the naming template's Sound and a placeholder voice:`, ...converted.changed.map((line) => `  ${line.line}\n    Kept:       ${line.kept}\n    Screenplay: ${line.script}`)]
      : []),
    ...(converted.added.length ? [`${converted.added.length} line(s) added, voiced by placeholders: ${converted.added.join(", ")}`] : []),
    ...(converted.dropped.length
      ? [
          `${converted.dropped.length} line(s) dropped: ${converted.dropped.map((line) => line.line).join(", ")}`,
          ...converted.dropped.filter((line) => line.cutscenes.length > 0).map((line) => `  ${line.line} is still played by ${line.cutscenes.join(", ")}: check fails until it's taken out in the Cutscene Editor, or put back at the Source`),
        ]
      : []),
    ...(converted.speakers.length ? [`${converted.speakers.length} line(s) change speaker: ${converted.speakers.map((line) => `${line.line} ${line.kept} → ${line.script}`).join(", ")}`] : []),
    ...(converted.unrecorded.length ? [`${converted.unrecorded.length} unchanged line(s) have no recording in the package, so they get placeholders: ${converted.unrecorded.join(", ")}`] : []),
    ...(converted.relinks.length
      ? [`The compile relinks ${converted.relinks.length} Kept cutscene element(s) playing a changed line by its old Sound:`, ...converted.relinks.map((relink) => `  ${relink.file}: ${relink.line} ${relink.from} → ${relink.to}`)]
      : []),
    ...(converted.removes.sounds.length ? [`The compile removes ${converted.removes.sounds.length} Sound(s) nothing will play, with their recordings: ${converted.removes.sounds.join(", ")}`] : []),
    ...(converted.removes.strings.length ? [`It removes the string(s) of ${converted.removes.strings.length} dropped line(s) or scene(s)`] : []),
    ...(converted.removes.keptForTriggers.length ? [`It keeps ${converted.removes.keptForTriggers.join(", ")}, which the conversation no longer plays, since a Kept trigger names ${converted.removes.keptForTriggers.length === 1 ? "it" : "them"}`] : []),
    ...(converted.differences.length
      ? [
          `The first compile writes ${converted.differences.length} part(s) other than as the Editor has them${converted.accepted ? `; named ${converted.accepted} in acceptedDifferences` : ""}${converted.unaccepted ? `; ${converted.unaccepted} not yet named, so the compile refuses until each is (convert again with ${acceptHint}, or name it by hand)` : ""}:`,
          ...converted.differences.map((found) => `  ${found.item}: ${found.detail}`),
        ]
      : ["The first compile writes every part as the Editor has it"]),
  ].join("\n");
}

/** What the author does next: compile in place with `compile`, once nothing the first compile meets is left unaccepted. */
export function missionConversionNextStep(converted: ConvertedMissionScreenplay, compile: string): string {
  return converted.unaccepted
    ? `The compile refuses until each difference is named in acceptedDifferences; then compile the Mission in place (${compile}) to write it over its Kept original, under the Equivalence Check.`
    : `Compile the Mission in place (${compile}) to write it over its Kept original, under the Equivalence Check.`;
}
