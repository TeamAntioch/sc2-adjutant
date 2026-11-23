// Reading a Map Package's Kept Content as the Editor wrote it: its text files, conversations,
// cutscenes' lines, GameData entries and trigger script names. The survey, Kept References and the
// checks over Kept Content share these, so each reads the package the same way.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { decodeXmlText, xmlElements } from "./xml-elements.js";

/** A package file's text, without the byte-order marks the Editor starts some with (sometimes two); "" when it's absent. */
export const readPackageText = async (file: string): Promise<string> => (existsSync(file) ? (await readFile(file, "utf8")).replace(/^﻿+/, "") : "");

/** A folder's file names with `extension`, sorted; none when the folder is absent. */
export const packageFiles = async (dir: string, extension: string): Promise<string[]> =>
  existsSync(dir) ? (await readdir(dir)).filter((name) => name.endsWith(extension)).sort((a, b) => a.localeCompare(b)) : [];

/**
 * A folder's files with `extension` (matched without regard to case, as the game does), in its
 * subfolders too, each as its path below `dir` with `/`, sorted; none when the folder is absent.
 */
export async function packageFilesBelow(dir: string, extension: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const suffix = extension.toLowerCase();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(suffix))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort((a, b) => a.localeCompare(b));
}

export const CONVERSATION_DATA = "Base.SC2Data/GameData/ConversationData.xml";
export const CUTSCENES_DIR = "Base.SC2Data/Cutscenes";

/** One conversation line in ConversationData.xml: its speaker, its sound, and the text ConversationStrings gives. */
export type PackageConversationLine = { readonly speaker?: string; readonly sound?: string; readonly text?: string };
/** The package's conversations, by id, each with its lines by id. */
export type PackageConversations = ReadonlyMap<string, ReadonlyMap<string, PackageConversationLine>>;

/** The conversations in ConversationData.xml, with the text in ConversationStrings.txt. */
export function readConversations(data: string, strings: string): PackageConversations {
  const texts = new Map([...strings.matchAll(/^([^=\r\n]+)=([^\r\n]*)/gm)].map(([, key, text]) => [key!, text!]));
  const out = new Map<string, Map<string, PackageConversationLine>>();
  const starts = [...data.matchAll(/<CConversation\b[^>]*\bid="([^"]+)"/g)];
  starts.forEach((start, index) => {
    const body = data.slice(start.index!, starts[index + 1]?.index ?? data.length);
    const lines = new Map<string, PackageConversationLine>();
    // Decoded, as a cutscene's links are (xmlElements), so "A&amp;B" here is the "A&B" a cutscene plays.
    const conversation = decodeXmlText(start[1]!);
    for (const [, line] of body.matchAll(/<Lines>([\s\S]*?)<\/Lines>/g)) {
      const value = (tag: string): string | undefined => {
        const raw = new RegExp(`<${tag} value="([^"]*)"`).exec(line!)?.[1];
        return raw === undefined ? undefined : decodeXmlText(raw);
      };
      const id = value("Id");
      if (!id) continue;
      const speaker = value("SpeakerCharacter");
      const sound = value("Sound");
      const text = texts.get(value("Text") ?? `Conversation/${conversation}/${id}`);
      lines.set(id, { ...(speaker ? { speaker } : {}), ...(sound ? { sound } : {}), ...(text !== undefined ? { text } : {}) });
    }
    out.set(conversation, lines);
  });
  return out;
}

/**
 * Every id each conversation in ConversationData.xml gives its parts (lines, groups, choices,
 * comments …: an `<Id value="…"/>` or an `Id="…"` attribute), by conversation id, decoded.
 */
export function conversationPartIds(data: string): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  const starts = [...data.matchAll(/<CConversation\b[^>]*\bid="([^"]+)"/g)];
  starts.forEach((start, index) => {
    const body = data.slice(start.index!, starts[index + 1]?.index ?? data.length);
    const ids = [...body.matchAll(/<Id value="([^"]*)"|\bId="([^"]*)"/g)].map((match) => decodeXmlText(match[1] ?? match[2]!));
    out.set(decodeXmlText(start[1]!), new Set(ids));
  });
  return out;
}

/** A conversation line a cutscene element plays, at `start` ms, with the sound and length the element gives, if any. */
export type CutsceneLineElement = {
  readonly conversation: string;
  readonly line: string;
  readonly start: number;
  readonly durationMs?: number;
  readonly soundLink?: string;
};

/**
 * A cutscene's conversation lines: those its Conversation Drivers play, and its actors' entries
 * (each speaking actor holds one per line it lip-syncs, and with no driver they're what plays).
 */
export function cutsceneLineElements(xml: string): { readonly driven: CutsceneLineElement[]; readonly onActors: CutsceneLineElement[] } {
  const driven = xmlElements(xml, "CCutsceneNodeConversationDriver").flatMap(({ attrs, body }) =>
    attrs.conversationLink
      ? xmlElements(body, "CCutsceneElementConversationDriver").flatMap((element) => (element.attrs.lineId ? [{ conversation: attrs.conversationLink!, line: element.attrs.lineId, start: Number(element.attrs.start ?? 0) }] : []))
      : [],
  );
  const onActors = xmlElements(xml, "CCutsceneElementConversation").flatMap(({ attrs }) =>
    attrs.conversationLink && attrs.conversationLine
      ? [
          {
            conversation: attrs.conversationLink,
            line: attrs.conversationLine,
            start: Number(attrs.start ?? 0),
            ...(attrs.duration ? { durationMs: Number(attrs.duration) } : {}),
            ...(attrs.soundLink ? { soundLink: attrs.soundLink } : {}),
          },
        ]
      : [],
  );
  return { driven, onActors };
}

/** A GameData file's catalog entries, in its order: each top-level `<C… id="…">`, with where it starts. */
export const gameDataEntries = (xml: string): { readonly type: string; readonly id: string; readonly index: number }[] =>
  [...xml.matchAll(/^[ \t]*<(C\w+)\s[^>]*?\bid="([^"]+)"/gm)].map((match) => ({ type: match[1]!, id: match[2]!, index: match.index! }));

/**
 * The Editor's names from TriggerStrings, by `<Type>:<Id>` (Trigger/Name/<Id>, Variable/Name/<Id>,
 * Category, FunctionDef, Structure, Preset …). The Editor starts the file with a byte-order mark,
 * sometimes two.
 */
export function triggerStringNames(strings: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of strings.replace(/^\uFEFF+/, "").matchAll(/^(\w+)\/Name\/([0-9A-F]{8})=([^\r\n]*)/gm)) names.set(`${match[1]}:${match[2]}`, match[3]!);
  return names;
}

/** An element's `<Identifier>`, which names it in Galaxy in place of its name. */
export const elementIdentifier = (elementBody: string): string | undefined => /<Identifier>([^<]*)<\/Identifier>/.exec(elementBody)?.[1];
