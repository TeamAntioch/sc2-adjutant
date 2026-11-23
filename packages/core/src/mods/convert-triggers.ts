// The convert step for a Campaign Mod's library triggers and globals (ADR-0011): it writes chosen
// Kept triggers and globals of the mod's library into its Mod Blueprint's `triggers`, keeping
// their element ids, so they no longer have to be written by hand. Each item's elements go into the
// Blueprint's triggers source (library/triggers.xml unless it names another), filed in its Root, as
// the Editor wrote them; its name, and a trigger's local variables' names, into `triggers.names`.
// Their text parameters' values, Param/Value/lib_<library>_<id>, go into `triggers.strings`, by the
// strings file the package has each in, from the Kept strings or the raw ones, which they leave;
// a run gives triggers converted earlier the values they didn't take then (owned-strings.ts).
// The next compile-mod writes them over the Kept items they came from, under the Equivalence
// Check, which moves them from Kept to Compiled. A category of the library interface that files
// one keeps filing it there.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ModBlueprintSchema } from "../domain/mod-blueprint.js";
import { TRIGGER_STRINGS } from "../map/editor-changes.js";
import { readCompileRecord } from "../map/mission-package.js";
import { libraryItems, recordedItemKeys } from "../triggers/splice-triggers.js";
import { itemLine, libraryStringKey, libraryTriggersFile, packageLibraryId, stringTable } from "./library-xml.js";
import { packageFiles } from "./mod-package-files.js";
import { heldStrings, keptStrings, takeStrings, textParamValueKeys, withRawStrings } from "./owned-strings.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

/** Where convert-triggers puts the Blueprint's triggers source, unless the Blueprint names one. */
export const TRIGGERS_SOURCE = "library/triggers.xml";

export type ConvertTriggersOptions = {
  /** The triggers and globals to convert, each by id or name; every Kept one when not given. */
  readonly items?: readonly string[];
};

export type ConvertedTriggers = {
  /** Each trigger and global converted, by name, in the package's order. */
  readonly converted: readonly string[];
  /** Each one asked for and left as it was, with why. */
  readonly refused: readonly { readonly item: string; readonly reason: string }[];
  /** The text parameters' values the triggers took from the Kept strings or the raw ones, as items. */
  readonly strings: readonly string[];
};

/** Converts Kept triggers and globals of the mod's library at `blueprintPath` into its Blueprint's triggers, as above. */
export async function convertTriggers(blueprintPath: string, { items: asked }: ConvertTriggersOptions = {}): Promise<ConvertedTriggers> {
  const blueprint = await readModBlueprint(blueprintPath);
  if (blueprint.kind !== "campaign") throw new Error(`${blueprintPath} is an Asset Mod's: only a Campaign Mod has a library`);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  const dir = path.dirname(blueprintPath);
  const triggersFile = path.join(pkg, "Triggers");
  if (!existsSync(triggersFile)) throw new Error(`The mod package ${pkg} has no Triggers, so no library`);
  const xml = await readFile(triggersFile, "utf8");
  const library = packageLibraryId(xml);
  if (!library) throw new Error(`The mod package's Triggers holds no library`);
  const stringsFile = path.join(pkg, ...TRIGGER_STRINGS.split("/"));
  const strings = stringTable(existsSync(stringsFile) ? await readFile(stringsFile, "utf8") : "");
  const name = (type: string, id: string): string | undefined => strings.get(libraryStringKey(library, type, "Name", id));

  // The Blueprint's triggers so far, and what the record owns.
  const sourcePath = blueprint.triggers?.source ?? TRIGGERS_SOURCE;
  const sourceFull = path.join(dir, ...sourcePath.split("/"));
  const sourceText = blueprint.triggers && existsSync(sourceFull) ? await readFile(sourceFull, "utf8") : undefined;
  const already = sourceText === undefined ? new Map<string, { type: string; id: string; elements: readonly string[] }>() : libraryItems(sourceText, { library });
  // By element key: an older save's Trigger and Variable may share an Id.
  const owned = new Set([...already.keys(), ...recordedItemKeys(record.entries, ["trigger", "variable"])]);

  const kept = [...libraryItems(xml, { library })].filter(([, item]) => item.type === "Trigger" || item.type === "Variable").map(([key, item]) => ({ key, ...item, name: name(item.type, item.id) ?? item.id }));
  const unknown = (asked ?? []).filter((wanted) => !kept.some((item) => item.id === wanted || item.name === wanted));
  if (unknown.length > 0) throw new Error(`The library ${library} has no trigger or global ${unknown.join(", ")}`);
  const chosen = asked ? kept.filter((item) => asked.includes(item.id) || asked.includes(item.name)) : kept;

  const refused: { item: string; reason: string }[] = [];
  const converted: typeof kept = [];
  for (const item of chosen) {
    if (owned.has(item.key)) {
      if (asked) refused.push({ item: item.name, reason: "the Blueprint already has it, or the last compile wrote it" });
      continue;
    }
    converted.push(item);
  }
  if (converted.length === 0 && !blueprint.triggers) return { converted: [], refused, strings: [] };

  // The names: each item's, and a trigger's local variables'.
  const names: Record<string, string> = { ...(blueprint.triggers?.names ?? {}) };
  for (const item of converted) {
    // Its own element among those it owns, found by type and Id: an older save's call may share its Id.
    const self = item.type === "Trigger" ? item.elements.find((element) => element.trimStart().startsWith(`<Element Type="Trigger" Id="${item.id}"`)) : undefined;
    const own = self === undefined ? [] : [...self.matchAll(/<Variable Type="Variable"(?: Library="[^"]*")? Id="([^"]+)"\/>/g)].map((match) => match[1]!);
    for (const [type, id] of [[item.type, item.id], ...own.map((local) => ["Variable", local] as const)] as const) {
      const given = name(type, id);
      if (given !== undefined) names[id] = given;
    }
  }
  const all = [...already.values(), ...converted];
  const text = libraryTriggersFile(
    library,
    all.map((item) => itemLine(library, `${item.type === "Trigger" ? "trigger" : "variable"}:${item.id}`)),
    all.flatMap((item) => item.elements),
  );
  // Their text parameters' values, which triggers converted earlier may not have taken then.
  const taken = takeStrings({ blueprint, record }, await keptStrings({ pkg, files: await packageFiles(pkg) }), textParamValueKeys(text, library), { held: blueprint.triggers?.strings ?? {}, elsewhere: await heldStrings(blueprintPath, blueprint) });
  if (converted.length === 0 && taken.taken.length === 0) return { converted: [], refused, strings: [] };
  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
  const withTriggers = { ...raw, triggers: { source: sourcePath, names, ...(Object.keys(taken.strings).length > 0 ? { strings: taken.strings } : {}) } };
  const next = taken.rawLeft ? withRawStrings(withTriggers, taken.rawLeft) : withTriggers;
  ModBlueprintSchema.parse(next);
  if (converted.length > 0) {
    await mkdir(path.dirname(sourceFull), { recursive: true });
    await writeFile(sourceFull, text);
  }
  await writeFile(blueprintPath, `${JSON.stringify(next, null, 2)}\n`);
  return { converted: converted.map((item) => item.name), refused, strings: taken.taken };
}

/** What a conversion did, for the author: one line for what converted, one per item left as it was. */
export function formatConvertedTriggers({ converted, refused, strings }: ConvertedTriggers): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} library trigger${converted.length === 1 ? "" : "s"} and global${converted.length === 1 ? "" : "s"}: ${converted.join(", ")}` : "Converted no library triggers or globals",
    ...(strings.length > 0 ? [`Took ${strings.length} text parameter value(s), which the triggers write now: ${strings.join(", ")}`] : []),
    ...refused.map((item) => `Left as it was: ${item.item}: ${item.reason}`),
  ].join("\n");
}
