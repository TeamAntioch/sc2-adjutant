// The convert step for a Campaign Mod's Conversations (ADR-0011): it declares the Screenplay a
// Kept CConversation comes from in the Mod Blueprint, so compile-mod writes it from the Screenplay
// Source from then on. The Screenplay is found (the Source's refForConversation, or --ref) and
// pulled into screenplays/<conversation>.md in the mod's folder.
//
// Imported ids are kept. The naming template gives each line its id, as a Mission's, and those
// must be the Conversation's own, line for line: a Screenplay whose lines don't line up is refused,
// naming each line on either side, since guessing a mapping could swap lines silently. Each line
// keeps the Sound it was imported with (importedSounds) where that isn't the template's. With
// those, the compiled CConversation must read as the Kept one does; what's left to differ is text,
// in the strings, which is listed so each difference can be named as an Accepted Difference.
//
// The Conversation's name, Conversation/Name/<id> in ObjectStrings, isn't its id, so the
// declaration records it: the Blueprint's raw string, else the Kept one, which then leaves the raw
// strings. A Kept name that removals names refuses the conversion, as the Screenplay would write it.
//
// Nothing in the package changes, unless the author renumbers (below): compile-mod then writes the Conversation over its Kept original
// under the Equivalence Check.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FieldStruct, FieldValue } from "../domain/catalog-fields.js";
import { OBJECT_STRINGS, type Strings } from "../domain/entry-strings.js";
import { type ModBlueprint, ModBlueprintSchema } from "../domain/mod-blueprint.js";
import { type ModScreenplay, ModScreenplaySchema } from "../domain/mod-screenplay.js";
import { catalogEntries } from "../map/catalog-entries.js";
import { readCompileRecord } from "../map/mission-package.js";
import { workspaceFor, type Workspace } from "../plugins/workspace.js";
import { type Script, scriptLines } from "../script/name-script.js";
import { groupId, OVERLAP_PREVIOUS_MS } from "../script/write-conversation-data.js";
import { replaceFile } from "../util/replace-file.js";
import { followKeptReferences } from "./conversation-references.js";
import { CONVERSATION_DATA, CONVERSATION_STRINGS, conversationEntry, conversationNameKey, conversationStrings, fetchScreenplay, groupName, modFile, nameModScreenplay, writeScreenplay } from "./conversations.js";
import { type AcceptedDifference, difference } from "./equivalence.js";
import { entryXml, type GenericEntry, genericEntry } from "./generic-entries.js";
import { packageFiles, packageStringTable } from "./mod-package-files.js";
import { stringsLess, withRawStrings } from "./owned-strings.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

export type ConvertScreenplayOptions = {
  /** The Kept CConversation to convert. */
  readonly conversation: string;
  /** What the Screenplay Source knows its Screenplay by, when its refForConversation doesn't know. */
  readonly ref?: string;
  /** The Screenplay file in the mod's folder; screenplays/<conversation>.md when not given. Without a Source, it must already be there. */
  readonly source?: string;
  /** The Workspace the mod is in; found above the Blueprint when not given. */
  readonly workspace?: Workspace;
  /**
   * Why the Conversation may compile other than as the Editor has it, as the author decided:
   * recorded as its Accepted Difference (and, renumbered, its strings'). Its lines must still
   * compile as the Editor's, each under its Kept id.
   */
  readonly accept?: string;
  /**
   * The author renumbered the Screenplay at its Source on purpose: its lines pair with the
   * Conversation's in order (one for one, each with its speaker), keep their imported Sounds under
   * the new ids, and the mod's Kept references to them follow (conversation-references.ts). Needs accept.
   */
  readonly renumber?: boolean;
};

export type ConvertedScreenplay = {
  /** Its place in the Blueprint's screenplays. */
  readonly index: number;
  readonly ref?: string;
  readonly source: string;
  /** How many lines it has. */
  readonly lines: number;
  /** How many keep a Sound the naming template wouldn't give them. */
  readonly importedSounds: number;
  /** The Conversation's name the declaration records, from the raw strings or the Kept ones; none when the mod has none. */
  readonly name?: string;
  /** Each string whose Screenplay text (or the raw name it takes) differs from the Kept one: to name as an Accepted Difference, or change at the Source. */
  readonly textDifferences: readonly { readonly item: string; readonly kept: string; readonly script: string }[];
  /** Where the Conversation first differs from the Editor's, when accept let it. */
  readonly entryDifference?: string;
  /** Each line a renumbering gave a new id, from its Kept id to the Screenplay's. */
  readonly renumbered?: readonly { readonly from: string; readonly to: string }[];
  /** Each Kept file whose references to the renumbered lines followed them, with how many. */
  readonly references?: readonly { readonly file: string; readonly count: number }[];
};

/** Declares the Screenplay of the Kept CConversation `conversation` in the mod of `blueprintPath`, as above. */
export async function convertScreenplay(blueprintPath: string, options: ConvertScreenplayOptions): Promise<ConvertedScreenplay> {
  const { conversation } = options;
  if (options.renumber && !options.accept) throw new Error(`Renumbering ${conversation} changes its ids, which the Equivalence Check counts: give accept, the reason, with renumber`);
  const blueprint = await readModBlueprint(blueprintPath);
  if (blueprint.kind !== "campaign") throw new Error(`${blueprintPath} is an Asset Mod's Blueprint: only a Campaign Mod has Screenplays`);
  const writing = blueprint.screenplays.findIndex((screenplay) => screenplay.conversation === conversation);
  if (writing >= 0) throw new Error(`The Mod Blueprint's screenplays.${writing} already writes ${conversation}`);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  const files = await packageFiles(pkg);
  const file = files.find((name) => name.toLowerCase() === CONVERSATION_DATA.toLowerCase());
  const kept = file ? catalogEntries(await readFile(path.join(pkg, ...file.split("/")), "utf8")).find((entry) => entry.key === `CConversation:${conversation}`) : undefined;
  if (!file || !kept) throw new Error(`The mod package has no CConversation ${conversation} in ${CONVERSATION_DATA}`);
  if (record.entries.some((entry) => entry.kind === "catalog-entry" && entry.file === file && entry.id === kept.key)) throw new Error(`${conversation} is Compiled Content already: the Blueprint writes it some other way`);

  // The Screenplay, from the Source or the file.
  const { registry } = options.workspace ?? (await workspaceFor(blueprintPath));
  const sourceOfScreenplays = registry.screenplaySource();
  const source = options.source ?? `screenplays/${conversation}.md`;
  // Where it goes is checked before anything is fetched or written.
  ModScreenplaySchema.shape.source.parse(source);
  const target = await modFile(blueprintPath, source);
  let ref: string | undefined;
  let markdown: string;
  if (sourceOfScreenplays) {
    ref = options.ref ?? (await sourceOfScreenplays.refForConversation?.(conversation));
    if (!ref) throw new Error(`The Screenplay Source ${sourceOfScreenplays.name} doesn't know which Screenplay ${conversation} comes from: name it with ref`);
    markdown = await fetchScreenplay(sourceOfScreenplays, blueprint.id, ref);
  } else {
    markdown = await readFile(target, "utf8").catch(() => {
      throw new Error(`The Workspace has no Screenplay Source, and the mod's folder has no ${source}: write ${conversation}'s Screenplay there`);
    });
  }
  const named = (screenplay: ModScreenplay) => {
    const next: ModBlueprint = { ...blueprint, screenplays: [...blueprint.screenplays, screenplay] };
    return nameModScreenplay(markdown, next, next.screenplays.length - 1, registry, blueprintPath);
  };
  // Its name: the raw string, else the Kept one; one the author removed can't be written back.
  const nameKey = conversationNameKey(conversation);
  const nameItem = `string:${OBJECT_STRINGS}:${nameKey}`;
  const rawNameFile = Object.keys(blueprint.strings).find((stringsFile) => stringsFile.toLowerCase() === OBJECT_STRINGS.toLowerCase() && blueprint.strings[stringsFile]![nameKey] !== undefined);
  const keptName = (await packageStringTable(pkg, files, OBJECT_STRINGS)).get(nameKey);
  const name = rawNameFile !== undefined ? blueprint.strings[rawNameFile]![nameKey] : keptName;
  if (name !== undefined && blueprint.removals.some(({ item }) => item === nameItem)) throw new Error(`removals names ${conversation}'s name ${nameKey}, which its Screenplay would write: take it out of removals first`);
  const declared: ModScreenplay = { ...(ref ? { ref } : {}), source, conversation, ...(name !== undefined ? { name } : {}), importedSounds: {} };
  const script = named(declared);
  const label = ref ?? source;

  // The Conversation's lines, as imported, in order.
  const imported = genericEntry(kept.text, "Conversation");
  if ("refused" in imported) throw new Error(`${conversation} can't be read as a conversation: ${imported.refused}`);
  const keptLines = [imported.fields["Lines"] ?? []].flat().flatMap((line) => {
    if (typeof line !== "object" || Array.isArray(line)) return [];
    const id = fieldValue(line, "Id");
    return id ? [{ id, sound: fieldValue(line, "Sound"), overlap: fieldValue(line, "OverlapPrevious"), speaker: fieldValue(line, "SpeakerCharacter"), facialAnim: fieldValue(line, "FacialAnim") }] : [];
  });
  const lines = scriptLines(script);

  // Each line's Kept original: the one of its id, or, renumbered at the Source, the one in its place.
  const renames = new Map<string, string>();
  const ids = new Set(lines.map((line) => line.lineId));
  const keptById = new Map(keptLines.map((was) => [was.id, was]));
  const onlyScript = lines.filter((line) => !keptById.has(line.lineId)).map((line) => line.lineId);
  const onlyKept = keptLines.filter((was) => !ids.has(was.id)).map((was) => was.id);
  let originals: (typeof keptLines)[number][];
  if (onlyScript.length === 0 && onlyKept.length === 0) {
    originals = lines.map((line) => keptById.get(line.lineId)!);
  } else if (!options.renumber) {
    throw new Error(
      `${label}'s lines don't line up with ${conversation}'s: ${[
        ...(onlyScript.length ? [`the Screenplay has ${onlyScript.join(", ")}, which the Conversation doesn't`] : []),
        ...(onlyKept.length ? [`the Conversation has ${onlyKept.join(", ")}, which the Screenplay doesn't`] : []),
      ].join("; ")}. The naming template names each line from the Screenplay, and the Conversation's line ids are kept, so the two must match line for line: change the Screenplay at its Source, or leave ${conversation} Kept. If the author renumbered it at the Source on purpose, convert it with renumber, and accept with the reason`,
    );
  } else {
    if (lines.length !== keptLines.length) throw new Error(`${label} has ${lines.length} line(s) and ${conversation} ${keptLines.length}: a renumbering pairs them in order, one for one, so a line added or cut at the Source waits until after it`);
    lines.forEach((line, index) => {
      const was = keptLines[index]!;
      if (was.speaker !== undefined && was.speaker !== line.characterId) throw new Error(`${label}'s ${line.lineId} (${line.characterId}) would be ${was.id} (${was.speaker}), the line in its place in ${conversation}: a renumbering keeps each line's speaker, so the two don't pair`);
      if (was.id !== line.lineId) renames.set(was.id, line.lineId);
    });
    originals = keptLines;
  }
  const oldId = new Map(lines.map((line, index) => [line.lineId, originals[index]!.id]));

  const importedSounds = Object.fromEntries(lines.flatMap((line, index) => {
    const sound = originals[index]!.sound;
    return sound !== undefined && sound !== line.soundId ? [[line.lineId, sound]] : [];
  }));
  const importedFacialAnims = Object.fromEntries(lines.flatMap((line, index) => {
    const anim = originals[index]!.facialAnim;
    return anim !== undefined ? [[line.lineId, anim]] : [];
  }));
  const overlaps = new Set(keptLines.map((line) => line.overlap));
  if (overlaps.size > 1) throw new Error(`${conversation}'s lines overlap the one before by ${[...overlaps].map((overlap) => (overlap === undefined ? "the default" : `${overlap} ms`)).join(", ")}: a Screenplay's lines all overlap alike`);
  const overlap = Number([...overlaps][0] ?? OVERLAP_PREVIOUS_MS);

  // Each scene's Kept group: the one of its id, which, renumbered, must hold the scene's lines (by their Kept ids); and, renumbered, the Kept group that does hold them, if under another id.
  const groups = keptGroups(imported.fields["Groups"]);
  const sceneGroups = new Map(script.scenes.map((scene) => {
    const children = scene.items.flatMap((item) => (item.kind === "line" ? [oldId.get(item.lineId)!] : [])).join("\n");
    const own = groups.find((group) => group.id === groupId(scene.number));
    const same = own && (renames.size === 0 || own.children.join("\n") === children) ? own : undefined;
    const moved = renames.size > 0 && children !== "" ? groups.find((group) => group.children.join("\n") === children) : undefined;
    return [scene.number, { same, movedFrom: moved && moved.id !== groupId(scene.number) ? moved.id : undefined }];
  }));
  const sameGroup = (scene: Script["scenes"][number]) => sceneGroups.get(scene.number)!.same;
  // Each group's name, where the Editor kept one the shape wouldn't give (a stale one from before its Conversation was renamed).
  const importedGroupNames: Record<string, string> = {};
  for (const scene of script.scenes) {
    const name = sameGroup(scene)?.name;
    if (name !== undefined && name !== `Conversation/${conversation}/${groupId(scene.number)}`) importedGroupNames[groupId(scene.number)] = name;
  }
  const screenplay: ModScreenplay = {
    ...declared,
    importedSounds,
    ...(Object.keys(importedGroupNames).length > 0 ? { importedGroupNames } : {}),
    ...(Object.keys(importedFacialAnims).length > 0 ? { importedFacialAnims } : {}),
    ...(overlap !== OVERLAP_PREVIOUS_MS ? { overlapPrevious: overlap } : {}),
  };

  // With those, the Conversation must compile as the Editor has it, or as the author accepts; its lines always must, under their Kept ids.
  const item = `catalog-entry:${file}:${kept.key}`;
  const compiled = conversationEntry({ screenplay, script: named(screenplay) });
  const accepted: AcceptedDifference[] = [];
  const entryDifference = difference(item, kept.text, entryXml(compiled));
  if (entryDifference) {
    if (!options.accept) throw new Error(`${conversation} wouldn't compile from ${label} as the Editor has it (${entryDifference}): leave it Kept until the shape writes what it holds, or, for a difference the author means, convert it with accept and the reason`);
    const linesOnly = (entry: GenericEntry, lineList: FieldValue | undefined): string => entryXml({ ...entry, fields: { Lines: lineList ?? [] } });
    const underKeptIds = [compiled.fields["Lines"] ?? []].flat().map((line) => {
      if (typeof line !== "object" || Array.isArray(line)) return line;
      const id = oldId.get(fieldValue(line, "Id") ?? "") ?? fieldValue(line, "Id")!;
      return { ...line, Id: { value: id }, Text: { value: `Conversation/${conversation}/${id}` } };
    });
    const linesDiffer = difference(item, linesOnly(imported, imported.fields["Lines"]), linesOnly(compiled, underKeptIds));
    if (linesDiffer) throw new Error(`${conversation}'s lines wouldn't compile as the Editor has them (${linesDiffer}): accept covers its groups and, renumbered, its ids, but each line's Sound, speaker, facial animation and timing must be the Editor's, so leave ${conversation} Kept until the shape writes what it holds`);
    accepted.push({ item, reason: options.accept });
  }

  // Its strings: a key a renumbering gave another line or scene is accepted with it; any other text that differs is listed.
  const keptStrings = await packageStringTable(pkg, files, CONVERSATION_STRINGS);
  const moved = new Set([
    ...[...renames.keys()].map((id) => `Conversation/${conversation}/${id}`),
    ...(renames.size > 0 ? script.scenes.filter((scene) => !sameGroup(scene)).map((scene) => groupName(screenplay, conversation, scene.number)) : []),
  ]);
  const textDifferences: { item: string; kept: string; script: string }[] = [];
  for (const [key, text] of Object.entries(conversationStrings({ screenplay, script }))) {
    // Compared as the Equivalence Check compares strings: trailing space doesn't count.
    const was = keptStrings.get(key)?.replace(/\s+$/, "");
    if (was === undefined || was === text.replace(/\s+$/, "")) continue;
    const string = `string:${CONVERSATION_STRINGS}:${key}`;
    if (moved.has(key)) accepted.push({ item: string, reason: options.accept! });
    else textDifferences.push({ item: string, kept: was, script: text });
  }
  // A raw name other than the Kept one, which the compile writes over it, differs as a line's text does.
  if (name !== undefined && keptName !== undefined && name.replace(/\s+$/, "") !== keptName.replace(/\s+$/, "")) textDifferences.push({ item: nameItem, kept: keptName, script: name });
  // A group a renumbering moved: the Kept one with a scene's lines, under another id.
  const groupRenames = new Map(script.scenes.flatMap((scene) => {
    const from = sceneGroups.get(scene.number)!.movedFrom;
    return from ? [[from, groupId(scene.number)] as const] : [];
  }));
  const references = await followKeptReferences(pkg, files, record, conversation, { lines: renames, groups: groupRenames });

  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
  const already = (raw.acceptedDifferences as AcceptedDifference[] | undefined) ?? [];
  const adding = accepted.filter((difference) => !already.some((other) => other.item === difference.item));
  const next = {
    ...raw,
    screenplays: [...((raw.screenplays as unknown[] | undefined) ?? []), screenplay],
    ...(adding.length > 0 ? { acceptedDifferences: [...already, ...adding] } : {}),
  };
  // The name leaves the raw strings: the Screenplay writes it now.
  const withName = rawNameFile !== undefined ? withRawStrings(next, stringsLess(raw.strings as Strings, (file, key) => file === rawNameFile && key === nameKey)) : next;
  ModBlueprintSchema.parse(withName);
  // The references and the Blueprint go in together: a failed write puts back every reference already written.
  const written: { readonly file: string; readonly before: string }[] = [];
  try {
    for (const followed of references) {
      const full = path.join(pkg, ...followed.file.split("/"));
      const before = await readFile(full, "utf8");
      await replaceFile(full, followed.text);
      written.push({ file: full, before });
    }
    if (sourceOfScreenplays) await writeScreenplay(target, markdown);
    await replaceFile(blueprintPath, `${JSON.stringify(withName, null, 2)}\n`);
  } catch (error) {
    for (const { file: back, before } of written.reverse()) await replaceFile(back, before).catch(() => undefined);
    throw error;
  }
  return {
    index: blueprint.screenplays.length,
    ...(ref ? { ref } : {}),
    source,
    lines: lines.length,
    importedSounds: Object.keys(importedSounds).length,
    ...(name !== undefined ? { name } : {}),
    textDifferences,
    ...(entryDifference ? { entryDifference } : {}),
    ...(renames.size > 0 ? { renumbered: [...renames].map(([from, to]) => ({ from, to })), references: references.map(({ file: changed, count }) => ({ file: changed, count })) } : {}),
  };
}

/** A struct's field `name`, as a generic entry reads it: `{ value }`, or an attribute's text. */
export function fieldValue(struct: FieldStruct, name: string): string | undefined {
  const found = struct[name];
  if (typeof found === "string" || typeof found === "number") return String(found);
  return found !== undefined && typeof found === "object" && !Array.isArray(found) && "value" in found ? String(found["value"]) : undefined;
}

/** A Kept conversation's groups, as its generic entry reads them: each one's id, name and children. */
export function keptGroups(groups: FieldValue | undefined): { readonly id: string; readonly name?: string; readonly children: readonly string[] }[] {
  return [groups ?? []].flat().flatMap((group) => {
    if (typeof group !== "object" || Array.isArray(group)) return [];
    const id = fieldValue(group, "Id");
    if (id === undefined) return [];
    const name = fieldValue(group, "Name");
    // One child reads as { value }, several as their values.
    const children = [group["Children"] ?? []].flat().flatMap((child) => (typeof child !== "object" ? [String(child)] : !Array.isArray(child) && "value" in child ? [String(child["value"])] : []));
    return [{ id, ...(name !== undefined ? { name } : {}), children }];
  });
}

/** What a conversion did, for the author. */
export function formatConvertedScreenplay(conversation: string, converted: ConvertedScreenplay): string {
  return [
    `Declared ${conversation}'s Screenplay as screenplays.${converted.index}${converted.ref ? `, ${converted.ref}` : ""}, in ${converted.source}: ${converted.lines} line(s), ${converted.importedSounds} keeping their imported Sound`,
    ...(converted.name !== undefined ? [`Its name, "${converted.name}", is the Screenplay's now`] : []),
    ...(converted.entryDifference ? [`It compiles other than as the Editor has it (${converted.entryDifference}), as the Blueprint now accepts`] : []),
    ...(converted.renumbered ? [`Renumbered ${converted.renumbered.length} line(s): ${converted.renumbered.map(({ from, to }) => `${from} → ${to}`).join(", ")}`] : []),
    ...(converted.references ? (converted.references.length ? converted.references.map(({ file, count }) => `  ${file}: ${count} reference(s) follow the new ids`) : ["  No Kept file of the mod names them"]) : []),
    ...(converted.textDifferences.length
      ? [
          `${converted.textDifferences.length} line(s) of the Screenplay differ from the Kept text; name each in acceptedDifferences, or change it at the Source, before compiling:`,
          ...converted.textDifferences.map((item) => `  ${item.item}\n    Kept:       ${item.kept}\n    Screenplay: ${item.script}`),
        ]
      : []),
  ].join("\n");
}
