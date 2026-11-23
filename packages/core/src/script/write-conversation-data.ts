// Map-local dialogue data for a script:
// Base.SC2Data/GameData/ConversationData.xml + SoundData.xml, ConversationStrings.txt,
// and the voice files under Assets/Sounds/Conversations/. Field values follow
// a Screenplay exporter's that a campaign already ships with; the ids come from the Campaign Pack's naming template (name-script.ts).

import { type Script, type ScriptLine, scriptLines } from "./name-script.js";

/** Where a line's voice file lives inside the map (also its CSound asset path, with backslashes). */
export function voiceAssetPath(line: Pick<ScriptLine, "soundId">, extension: "wav" | "ogg"): string {
  return `Assets/Sounds/Conversations/${line.soundId}.${extension}`;
}

/** "lava_field|Line1-2": the conversation line a transmission plays. */
export function conversationLineRef(script: Script, line: ScriptLine): string {
  return `${script.conversationId}|${line.lineId}`;
}

/** How long a line overlaps the one before it, in milliseconds, unless a Campaign Mod's Screenplay says otherwise. */
export const OVERLAP_PREVIOUS_MS = 200;
/** Where a conversation's strings go: its lines' text and its scenes' titles. */
export const CONVERSATION_STRINGS = "enUS.SC2Data/LocalizedData/ConversationStrings.txt";

/** A scene's conversation group: Group00003 for scene 3. */
export const groupId = (sceneNumber: number): string => `Group${String(sceneNumber).padStart(5, "0")}`;
/** Every value put in an attribute is escaped, ids included, though the naming checks keep markup out of them. */
const xml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const catalog = (body: readonly string[]): string =>
  ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...body, "</Catalog>", ""].join("\r\n");

/** One of a conversation line's fields: its value, and the slot of an indexed one (Objects, Variations). */
export type ConversationLineField = { readonly name: string; readonly value: string | number; readonly index?: string };

/**
 * A conversation line's fields, in the order the Editor writes them, as a new line has them: its
 * Sound the naming template's and its OverlapPrevious 200 ms unless given (a Campaign Mod's
 * Screenplay keeps an imported Sound and its own overlap). A Mission's ConversationData and a
 * Campaign Mod's conversation shape both write these.
 */
export function conversationLineFields(conversationId: string, line: ScriptLine, { sound = line.soundId, overlap = OVERLAP_PREVIOUS_MS }: { readonly sound?: string; readonly overlap?: number } = {}): ConversationLineField[] {
  return [
    { name: "Id", value: line.lineId },
    { name: "Text", value: `Conversation/${conversationId}/${line.lineId}` },
    { name: "FacialBlend", value: 100 },
    { name: "Sound", value: sound },
    { name: "OverlapPrevious", value: overlap },
    { name: "AnimProps", value: "Talk" },
    { name: "AnimBlendIn", value: -1 },
    { name: "AnimBlendOut", value: -1 },
    { name: "LookAtAttach", value: "Head" },
    { name: "SpeakerCharacter", value: line.characterId },
    ...["Objects", "Variations"].flatMap((name) => ["Speaker", "Listener", "Camera"].map((index) => ({ name, index, value: "" }))),
  ];
}

export function conversationDataXml(script: Script): string {
  const id = script.conversationId;
  const body = [`    <CConversation id="${xml(id)}">`, '        <EditorCategories value="ConversationType:Mission"/>', '        <ProductionLevel value="2"/>'];
  for (const line of scriptLines(script)) {
    body.push("        <Lines>");
    for (const { name, index, value } of conversationLineFields(id, line)) body.push(`            <${name}${index === undefined ? "" : ` index="${xml(index)}"`} value="${xml(String(value))}"/>`);
    body.push("        </Lines>");
  }
  for (const scene of script.scenes) {
    const lines = scene.items.filter((item): item is ScriptLine => item.kind === "line");
    if (lines.length === 0) continue;
    body.push(`        <Groups Id="${groupId(scene.number)}" Name="${xml(`Conversation/${id}/${groupId(scene.number)}`)}">`);
    for (const line of lines) body.push(`            <Children value="${xml(line.lineId)}"/>`);
    body.push("        </Groups>", `        <RootItems value="${groupId(scene.number)}"/>`);
  }
  body.push("    </CConversation>");
  return catalog(body);
}

/**
 * SoundData.xml: a CSound per line, playing its voice file. `played` gives a line the Sound it
 * plays and its file's extension where those aren't its sound ID and `extension` (a converted
 * Kept conversation's line keeps its imported Sound and recording).
 */
export function soundDataXml(script: Script, extension: "wav" | "ogg", played?: (line: ScriptLine) => { readonly soundId: string; readonly extension: "wav" | "ogg" }): string {
  const id = script.conversationId;
  const body: string[] = [];
  for (const line of scriptLines(script)) {
    const sound = played?.(line) ?? { soundId: line.soundId, extension };
    body.push(
      `    <CSound id="${xml(sound.soundId)}" parent="Campaign2D" Subtitle="${xml(id)}" Speaker="${xml(line.characterId)}" Actor="" Line="${xml(line.soundLine)}">`,
      '        <AssetArray index="0">',
      `            <File value="${xml(voiceAssetPath({ soundId: sound.soundId }, sound.extension).replace(/\//g, "\\"))}"/>`,
      '            <FacialAnim value=""/>',
      '            <FacialGroup value=""/>',
      '            <PortraitModel value=""/>',
      `            <Speaker value="${xml(speakerNameKey(line))}"/>`,
      `            <Subtitle value="${xml(`Conversation/${id}/${line.lineId}`)}"/>`,
      "        </AssetArray>",
      '        <Category value="Dialogue"/>',
      "    </CSound>",
    );
  }
  return catalog(body);
}

/**
 * The string a line's CSound names as its speaker, which labels the line's subtitle wherever the
 * sound plays (docs/reference/editor-and-engine.md, "Speaking actors in a cutscene"). The key is
 * Blizzard's campaign template's; conversationStrings gives it the speaker's Transmission name.
 */
export function speakerNameKey(line: ScriptLine): string {
  return `ConversationState/Characters/${line.characterId}`;
}

/**
 * ConversationStrings.txt entries: each line's text, each scene's title, and each speaker's name
 * as its Transmissions show it. The name replaces a dependency's string for the same key (a Campaign
 * Mod may give CharMedic "Ana"), so a subtitle says what a Transmission says.
 */
export function conversationStrings(script: Script): Record<string, string> {
  const id = script.conversationId;
  const entries: Record<string, string> = {};
  for (const scene of script.scenes) entries[`Conversation/${id}/${groupId(scene.number)}`] = scene.title;
  for (const line of scriptLines(script)) {
    entries[`Conversation/${id}/${line.lineId}`] = line.shown;
    entries[speakerNameKey(line)] ??= line.character;
  }
  return entries;
}
