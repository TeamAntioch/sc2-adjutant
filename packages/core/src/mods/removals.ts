// Accepted Removals (ADR-0011): Kept items a Mod Blueprint drops on purpose, each named with its
// reason (domain/mod-blueprint.ts). The compile removes them (PackageOutput.removeKept), and the
// Equivalence Check compares a converted part with its Kept original less them, so a part that
// leaves them out passes and one that writes them back fails. proposeRemovals lists the leftovers
// that look safe to drop, for the author to confirm: it applies none.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_COMPILE_RECORD, entryName } from "../domain/compile-record.js";
import { GAME_DATA_DIR, type Removal, removalOfLine } from "../domain/mod-blueprint.js";
import { LOCALIZED_STRINGS_FILE } from "../domain/entry-strings.js";
import { readCompileRecord } from "../map/mission-package.js";
import { stringLines } from "../map/package-elements.js";
import { packageFiles } from "./game-data-files.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

/**
 * `replaceKept` for a Blueprint with Accepted Removals (a mod's or a Mission's): a removed item
 * written back fails as that (expectGone), not as a difference too; and a whole strings file is
 * compared with its Kept original less the keys and lines removed from it, which `removedWhole`
 * collects by name.
 */
export function replaceKeptLessRemovals(
  replaceKept: (item: string, kept: string | Uint8Array, compiled: string | Uint8Array) => boolean,
  removals: readonly { readonly item: string; readonly removal: Removal }[],
  removedWhole: Set<string> = new Set(),
): (item: string, kept: string | Uint8Array, compiled: string | Uint8Array) => boolean {
  const removing = new Set(removals.map(({ item }) => item));
  return (item, kept, compiled) => {
    if (removing.has(item)) return false;
    const file = item.startsWith("file:") ? item.slice("file:".length) : undefined;
    if (file === undefined || !LOCALIZED_STRINGS_FILE.test(file)) return replaceKept(item, kept, compiled);
    const less = stringsWithoutRemovals(file, Buffer.from(kept).toString("utf8"), removals.map(({ removal }) => removal));
    for (const name of less.removed) removedWhole.add(name);
    return replaceKept(item, less.text, compiled);
  };
}

/**
 * The Kept strings file `file`'s text less the keys and lines `removals` name in it, what a
 * conversion of the whole file is compared with, and the names of those it had.
 */
export function stringsWithoutRemovals(file: string, text: string, removals: readonly Removal[]): { readonly text: string; readonly removed: readonly string[] } {
  const { bom, lines } = stringLines(text, { keyless: true });
  const removed: string[] = [];
  const left = lines.filter((line) => {
    const removal = removalOfLine(file, line, removals);
    if (removal) removed.push(removal);
    return !removal;
  });
  return removed.length === 0 ? { text, removed } : { text: bom + left.map((line) => line.text).join(""), removed };
}

/** The package's files a game data path may be named in: its data, triggers, scripts and layouts. */
const NAMING_FILE = /\.(xml|galaxy|sc2layout)$|^Triggers$/i;

/** `text` with paths as the search compares them: in lower case, the game's backslashes (one, or two in a Galaxy string) as slashes. */
const asPaths = (text: string): string => text.toLowerCase().replace(/\\+/g, "/");

/**
 * The files of the package `pkg` (its `files`) that name each of `names`, a game data path such as
 * `Cutscenes/Quay.SC2Cutscene` or a string key, as the game reads one: in any case, with slashes or
 * backslashes. `skip` leaves files out of the search.
 */
export async function namedIn(pkg: string, files: readonly string[], names: readonly string[], skip: (file: string) => boolean = () => false): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(names.map((name) => [name, []]));
  if (names.length === 0) return out;
  for (const file of files.filter((name) => NAMING_FILE.test(name) && !skip(name))) {
    const text = asPaths(await readFile(path.join(pkg, ...file.split("/")), "utf8"));
    for (const name of names) if (text.includes(asPaths(name)) || text.includes(asPaths(escapeXml(name)))) out.get(name)!.push(file);
  }
  return out;
}

/** A removal the proposal tool suggests: its name, a reason to give, and a string's text for the author to see. */
export type ProposedRemoval = { readonly item: string; readonly reason: string; readonly text?: string };

export type ProposedRemovals = { readonly mod: string; readonly proposals: readonly ProposedRemoval[] };

/** A line an old version-control merge conflict left: <<<<<<<, |||||||, ======= or >>>>>>>, and what follows. */
const CONFLICT_LINE = /^(<{7}|\|{7}|={7}|>{7})(?=[\s=]|$)/;
const ORPHAN = "A conversation string no line or group names";
const CONFLICT = "An old merge conflict's line";
const EMPTY_ASSETS = "An empty asset-key table: the mod overrides no asset key";

/**
 * The Kept leftovers of the mod whose Mod Blueprint is at `blueprintPath` that look safe to drop
 * as Accepted Removals, read from its package as the last compile left it. Nothing is applied:
 * the author confirms each before it goes in the Blueprint's removals. Proposed are:
 *   - a ConversationStrings `Conversation/…` key no GameData file names (a line or group's text
 *     that the conversation no longer has);
 *   - a strings file's line an old merge conflict left (`<<<<<<< .mine`, `=======` …);
 *   - an empty GameData `Assets.txt`, an asset-key table that overrides nothing.
 * Compiled items and those the Blueprint already removes are left out.
 */
export async function proposeRemovals(blueprintPath: string): Promise<ProposedRemovals> {
  const blueprint = await readModBlueprint(blueprintPath);
  const pkg = await modPackage(blueprintPath);
  const record = (await readCompileRecord(blueprintPath)) ?? EMPTY_COMPILE_RECORD;
  const compiled = new Set(record.entries.map(entryName));
  const removing = new Set(blueprint.removals.map((removal) => removal.item));
  const read = (file: string): Promise<string> => readFile(path.join(pkg, ...file.split("/")), "utf8");
  const files = await packageFiles(pkg);

  const proposals: ProposedRemoval[] = [];
  /** Conversation strings, proposed only once nothing is found naming them: each proposal's key. */
  const conversationStrings = new Map<ProposedRemoval, string>();
  const propose = (proposal: ProposedRemoval): void => {
    if (!compiled.has(proposal.item) && !removing.has(proposal.item)) proposals.push(proposal);
  };
  for (const file of files) {
    if (file.startsWith(GAME_DATA_DIR) && /(^|\/)Assets\.txt$/i.test(file)) {
      if ((await read(file)).replace(/^\uFEFF/, "").trim() === "") propose({ item: `file:${file}`, reason: EMPTY_ASSETS });
      continue;
    }
    if (!LOCALIZED_STRINGS_FILE.test(file) || compiled.has(`file:${file}`)) continue;
    const conversations = file.endsWith("/ConversationStrings.txt");
    for (const line of stringLines(await read(file), { keyless: true }).lines) {
      const text = line.text.trimEnd();
      if (CONFLICT_LINE.test(text)) {
        propose({ item: line.key === "" || !text.includes("=") ? `line:${file}:${text}` : `string:${file}:${line.key}`, reason: CONFLICT });
        continue;
      }
      if (!conversations || !line.key.startsWith("Conversation/")) continue;
      const proposal = { item: `string:${file}:${line.key}`, reason: ORPHAN, text: text.slice(line.key.length + 1) };
      if (compiled.has(proposal.item) || removing.has(proposal.item)) continue;
      proposals.push(proposal);
      conversationStrings.set(proposal, line.key);
    }
  }
  // A conversation string is named by its data, and may be by a trigger, script or layout too.
  const naming = await namedIn(pkg, files, [...conversationStrings.values()]);
  const orphan = (proposal: ProposedRemoval): boolean => {
    const key = conversationStrings.get(proposal);
    return key === undefined || naming.get(key)!.length === 0;
  };
  return { mod: blueprint.id, proposals: proposals.filter(orphan) };
}

/** The proposals as the author reads them: one per line, each with its reason, and how to accept them. */
export function formatProposedRemovals({ mod, proposals }: ProposedRemovals): string {
  if (proposals.length === 0) return `${mod}: no removals to propose`;
  return [
    `${mod}: ${proposals.length} removal(s) to propose; none is applied:`,
    ...proposals.map((proposal) => `  ${proposal.item}${proposal.text !== undefined ? ` "${proposal.text}"` : ""}: ${proposal.reason}`),
    `Once the author confirms one, add it to the Mod Blueprint's removals as { "item", "reason" } and compile the mod.`,
  ].join("\n");
}

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
