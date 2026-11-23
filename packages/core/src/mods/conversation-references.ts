// The Kept references to a Campaign Mod Conversation's lines (ADR-0011): where a mod's own Kept
// Content names a line by its id, which a renumbering at the Screenplay Source changes, so
// convert-screenplay can make them follow the new ids. A reference is
//
//   Triggers, Galaxy    a conversation line value, <conversation>|<line id>, such as a library
//                       trigger's <Value>Interlude1-01|Line02004</Value>
//   .SC2Cutscene        a conversation element's conversationLine, where its conversationLink is the
//                       conversation, and the lineId of each element of the conversation's driver;
//                       and, in a cutscene whose drivers all play the conversation, each bookmark
//                       named after one of its lines or groups (the Editor's Lines bookmarks)
//
// Every reference is replaced in one pass, so ids that trade places (Line02001 → Line01001 while
// Line03001 → Line02001) never chain. Missions' packages aren't searched: a Mission that names one
// of the lines follows it by hand.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CompileRecord } from "../domain/compile-record.js";

/** Where a renumbering changes a Kept file: the file in the package, its text after, and how many references follow. */
export type FollowedReferences = { readonly file: string; readonly text: string; readonly count: number };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A renumbering: each line's and each group's Kept id, to its new one. */
export type Renames = { readonly lines: ReadonlyMap<string, string>; readonly groups: ReadonlyMap<string, string> };

/** `text` with each reference to `conversation`'s lines and groups in `renames` following it, and how many did, for a file of `kind`. */
export function followRenames(text: string, kind: "triggers" | "cutscene", conversation: string, { lines: renames, groups }: Renames): { readonly text: string; readonly count: number } {
  let count = 0;
  const renamed = (id: string): string => {
    const to = renames.get(id);
    if (to === undefined) return id;
    count++;
    return to;
  };
  const conv = escape(conversation);
  if (kind === "triggers") {
    const next = text.replace(new RegExp(`(?<![\\w-])${conv}\\|(\\w+)`, "g"), (whole, id: string) => (renames.has(id) ? `${conversation}|${renamed(id)}` : whole));
    return { text: next, count };
  }
  // An element naming the conversation and one of its lines, in either attribute order.
  const elements = text.replace(/<CCutsceneElementConversation\b[^>]*>/g, (tag) =>
    new RegExp(`\\sconversationLink="${conv}"`).test(tag) ? tag.replace(/(\sconversationLine=")([^"]*)(")/, (_, open: string, id: string, close: string) => `${open}${renamed(id)}${close}`) : tag,
  );
  // The conversation's driver, whose elements name its lines by lineId.
  // A self-closing driver has no elements, so the lazy match never runs on into the next driver's.
  const next = elements.replace(/<CCutsceneNodeConversationDriver\b[^>]*?(?:\/>|>[\s\S]*?<\/CCutsceneNodeConversationDriver>)/g, (node) => {
    const open = node.slice(0, node.indexOf(">") + 1);
    if (open.endsWith("/>") || !new RegExp(`\\sconversationLink="${conv}"`).test(open)) return node;
    return open + node.slice(open.length).replace(/(\slineId=")([^"]*)(")/g, (_, before: string, id: string, after: string) => `${before}${renamed(id)}${after}`);
  });
  // Bookmarks are named, not linked, so they follow only where every driver plays this conversation.
  const drivers = [...next.matchAll(/<CCutsceneNodeConversationDriver\b[^>]*>/g)].map((match) => match[0]);
  if (drivers.length === 0 || !drivers.every((open) => new RegExp(`\\sconversationLink="${conv}"`).test(open))) return { text: next, count };
  const bookmarked = next.replace(/(<CCutsceneElementBookmark\b[^>]*\sbookmarkName=")([^"]*)(")/g, (whole, before: string, name: string, after: string) => {
    const to = renames.get(name) ?? groups.get(name);
    if (to === undefined) return whole;
    count++;
    return `${before}${to}${after}`;
  });
  return { text: bookmarked, count };
}

/** The kind of reference a package file can hold, by its name: undefined for one that holds none. */
const kindOf = (file: string): "triggers" | "cutscene" | undefined => (file === "Triggers" || /\.galaxy$/i.test(file) ? "triggers" : /\.sc2cutscene$/i.test(file) ? "cutscene" : undefined);

/**
 * Each of the package's files (`files`, in `pkg`) whose Kept references to `conversation`'s lines
 * and groups follow `renames`, with its text after; throws, naming it, when such a file is Compiled Content,
 * which the Blueprint's source writes.
 */
export async function followKeptReferences(pkg: string, files: readonly string[], record: CompileRecord, conversation: string, renames: Renames): Promise<FollowedReferences[]> {
  const out: FollowedReferences[] = [];
  if (renames.lines.size === 0 && renames.groups.size === 0) return out;
  for (const file of [...files].sort()) {
    const kind = kindOf(file);
    if (!kind) continue;
    const before = await readFile(path.join(pkg, ...file.split("/")), "utf8");
    const { text, count } = followRenames(before, kind, conversation, renames);
    if (count === 0) continue;
    const compiled = record.entries.some(
      (entry) =>
        ((entry.kind === "file" || entry.kind === "uncommitted") && entry.path === file) ||
        (file === "Triggers" && (entry.kind === "trigger" || entry.kind === "variable" || entry.kind === "function")) ||
        (/\.galaxy$/i.test(file) && entry.kind === "galaxy-block"),
    );
    if (compiled) throw new Error(`${file} names ${conversation}'s renumbered lines, and the Mod Blueprint writes ${file === "Triggers" ? "some of its items" : "it"}: renumber before converting it, or change the Blueprint's source to the new ids`);
    out.push({ file, text, count });
  }
  return out;
}
