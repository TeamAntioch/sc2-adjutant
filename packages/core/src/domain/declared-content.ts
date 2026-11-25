// Declared Content (issue #109): what a Mod Blueprint and a Mission Blueprint both declare the same
// way, from one schema both spread into theirs, so a part authored in one moves to the other by
// moving its declaration and its source file. Each is compiled the same way into either package
// (src/mods/declared-parts.ts): a Mod's compile writes it into the mod package, a Mission's into
// its Map Package, merged by entry and by key beside what the Mission's compile generates itself.
//
//   gameData       raw catalog entries, by the GameData file they go in
//   includes       the includes list (Base.SC2Data/GameData.xml)
//   entries        Generic Entries, checked against the game's data schema
//   characters     Characters, written into CharacterData as generic entries
//   strings        localized strings by file and key that no entry owns
//   files          package files written whole, and the strings they name
//   setCutscenes   Sets written back as cutscenes with no shots
//   acceptedDifferences, removals   the Equivalence Check's Accepted Differences and Removals
//
// The Mod Blueprint's other fields are either a Mod's by nature or have a Mission counterpart of
// their own shape: MOD_ONLY_FIELDS and MISSION_COUNTERPARTS say which, and why. A test fails when a
// Mod Blueprint field is none of the three.

import path from "node:path";

import { z } from "zod";

import { CharactersSchema } from "./character.js";
import { LOCALIZED_STRINGS_FILE, PackageFilePath as PackagePath, StringsSchema } from "./entry-strings.js";
import { ModSetCutscenesSchema } from "./mod-cinematic.js";

/** A source file in the Blueprint's folder (mods/<id>/, missions/<id>/), relative to it. */
export const SourcePath = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."), "A source is a file in the Blueprint's folder, relative to it");

/** What an Accepted Removal names: a strings file's key, a line of one that holds no key (by its text), or a file. */
export type Removal = { readonly kind: "string"; readonly file: string; readonly key: string } | { readonly kind: "line"; readonly file: string; readonly text: string } | { readonly kind: "file"; readonly path: string };

/**
 * The Kept item an Accepted Removal's name gives: `string:<strings file>:<key>`,
 * `line:<strings file>:<text>` (a line with no key, its text without the line ending and trailing
 * spaces) or `file:<path>`. Throws, saying why, for any other name.
 */
export function parseRemoval(item: string): Removal {
  const kind = item.slice(0, item.indexOf(":"));
  const rest = item.slice(kind.length + 1);
  if (kind === "file") {
    if (!PackagePath.safeParse(rest).success) throw new Error(`${item} names no package path: a file removal is file:<path>, with forward slashes`);
    return { kind, path: rest };
  }
  if (kind !== "string" && kind !== "line") throw new Error(`${item} isn't a Kept item a removal drops: name string:<strings file>:<key>, line:<strings file>:<text> or file:<path>`);
  const at = rest.indexOf(":");
  const file = at < 0 ? rest : rest.slice(0, at);
  if (!LOCALIZED_STRINGS_FILE.test(file)) throw new Error(`${item} doesn't name a strings file (<locale>.SC2Data/LocalizedData/<name>.txt): a ${kind} removal is in one`);
  const after = at < 0 ? "" : rest.slice(at + 1);
  if (kind === "string") {
    if (after === "" || /[=\r\n]/.test(after)) throw new Error(`${item} names no string key: a string removal is string:<strings file>:<key>`);
    return { kind, file, key: after };
  }
  if (after.trim() === "" || after !== after.trimEnd() || /[\r\n]/.test(after)) throw new Error(`${item} names no line: a line removal is a line with text, line:<strings file>:<text>, without its trailing spaces`);
  if (after.includes("=") && !after.startsWith("=")) throw new Error(`${item} is a line with a key (${after.slice(0, after.indexOf("="))}): remove it as string:${file}:${after.slice(0, after.indexOf("="))}`);
  return { kind, file, text: after };
}

/**
 * The name of the removal among `removals` that drops `line` of the strings file `file`, as
 * stringLines reads it with keyless lines: a `line:` removal takes a line with no key (none, or no
 * `=` at all) by its text, and a `string:` removal a key.
 */
export function removalOfLine(file: string, line: { readonly key: string; readonly text: string }, removals: readonly Removal[]): string | undefined {
  const text = line.text.trimEnd();
  const keyless = line.key === "" || !line.text.includes("=");
  for (const removal of removals) {
    if (removal.kind === "file" || removal.file !== file) continue;
    if (removal.kind === "line" && keyless && text === removal.text) return `line:${file}:${removal.text}`;
    if (removal.kind === "string" && line.key !== "" && line.key === removal.key) return `string:${file}:${removal.key}`;
  }
  return undefined;
}

/** Where a GameData catalog file sits in a package. */
export const GAME_DATA_DIR = "Base.SC2Data/GameData/";

/** A GameData catalog file, by its path in the package. */
const GameDataFile = PackagePath.refine((file) => file.startsWith(GAME_DATA_DIR) && file.toLowerCase().endsWith(".xml"), `A GameData file is a .xml in ${GAME_DATA_DIR}`);

/** The fields both Blueprints declare the same way: spread into each one's object schema. */
export const DeclaredContentShape = {
  /**
   * Catalog entries the Blueprint owns, by the GameData file they go in: each source is a
   * `<Catalog>` whose entries are written into that file one by one, beside its Kept entries.
   */
  gameData: z.array(z.object({ file: GameDataFile, source: SourcePath }).strict()).default([]),
  /**
   * The includes list (Base.SC2Data/GameData.xml) the Blueprint owns: the catalog files outside
   * the standard ones (one in a folder of GameData, or one not named for its catalog), in the
   * order the game loads them. Import fills it in from a mod package's list. The compile writes the
   * list from it, adding at the end a catalog file the Blueprint writes that it doesn't name and
   * leaving out one the package doesn't have, and writes none when nothing is left to list.
   * Without it, a package's list is Kept.
   */
  includes: z
    // As the list spells it: the game reads the folders in any case.
    .array(PackagePath.refine((file) => file.toLowerCase().startsWith(GAME_DATA_DIR.toLowerCase()) && file.toLowerCase().endsWith(".xml"), `An included file is a .xml in ${GAME_DATA_DIR}`))
    .refine((files) => new Set(files.map((file) => file.toLowerCase())).size === files.length, "Each catalog file is included once, in any case: the game reads its files in any case")
    .optional(),
  /**
   * Generic typed catalog entries the Blueprint owns (src/mods/generic-entries.ts): each source a
   * JSON array of entries ({ catalog, class, id, parent, fields }), checked against the game's
   * data schema and written by entry into their catalogs' GameData files.
   */
  entries: z.array(z.object({ source: SourcePath }).strict()).default([]),
  /**
   * Characters (domain/character.ts), each speaker once, written into CharacterData as generic
   * entries. A Campaign Mod's are its Campaign's, read by Mission compiles for their Screenplays'
   * speakers; a Mission's are its map's alone.
   */
  characters: CharactersSchema.default([]),
  /**
   * Localized strings the Blueprint owns that no entry does: by strings file (such as
   * `enUS.SC2Data/LocalizedData/GameStrings.txt`), each key's text. A catalog entry's own strings
   * are its own (a generic entry's or a character's strings, src/mods/entry-strings.ts).
   */
  strings: StringsSchema.default({}),
  /**
   * Files the Blueprint writes whole: scripts, cutscenes, UI layouts and font styles, and plain
   * files; and, by the strings file each is in, the strings a file names as @<key>, as a layout's
   * <Text val="@UI/CreditItemBase/Actor"/> does.
   */
  files: z.array(z.object({ path: PackagePath, source: SourcePath, strings: StringsSchema.optional() }).strict()).default([]),
  /**
   * Set cutscenes (domain/mod-cinematic.ts): Sets in the Blueprint's folder written back as
   * cutscenes with no shots, so the author can open each room in the Cutscene Editor.
   */
  setCutscenes: ModSetCutscenesSchema.default([]),
  /**
   * Differences from the Kept original that a conversion means to make, each named by its entry
   * (`catalog-entry:<file>:<Class>:<id>`, `string:<file>:<key>`, `trigger:<id>`, `file:<path>` …)
   * with the reason; any other difference fails the compile.
   */
  acceptedDifferences: z.array(z.object({ item: z.string().min(1), reason: z.string().min(1) }).strict()).default([]),
  /**
   * Accepted Removals: Kept items the package drops on purpose, each named (`string:<file>:<key>`,
   * `line:<file>:<text>` for a line with no key, `file:<path>`) with the reason. The compile
   * removes each one, and the Equivalence Check expects it gone: a part that writes it back fails.
   */
  removals: z
    .array(
      z
        .object({
          item: z
            .string()
            .min(1)
            .superRefine((item, context) => {
              try {
                parseRemoval(item);
              } catch (error) {
                context.addIssue({ code: "custom", message: (error as Error).message });
              }
            }),
          reason: z.string().min(1),
        })
        .strict(),
    )
    .default([])
    .refine((removals) => new Set(removals.map((removal) => removal.item)).size === removals.length, "Each removal is named once"),
};

/** The Declared Content fields, as a Blueprint has them once parsed. */
export type DeclaredContent = z.infer<z.ZodObject<typeof DeclaredContentShape>>;

/** The names of the Declared Content fields. */
export const DECLARED_CONTENT_FIELDS = Object.keys(DeclaredContentShape) as (keyof typeof DeclaredContentShape)[];

/**
 * The Mod Blueprint's fields a Mission Blueprint has no field for, each because of what a mod is,
 * with the reason.
 */
export const MOD_ONLY_FIELDS: Readonly<Record<string, string>> = {
  kind: "A Map Package is neither a Campaign Mod nor an Asset Mod: kind says which of the two a mod is.",
  library:
    "A map can't hold a trigger library: the Editor makes libraries in mods only. A Mission's own functions are FunctionDefs among its triggers (domain/blueprint-trigger.ts), with the same interface schema as a library function's.",
  ui: "A UI Component's functions go into the Campaign Mod's library, which a map can't hold. A Mission turns the Campaign Mod's components on and drives them with its uiActions.",
  assets: "Only an Asset Mod has Asset Sources: a Campaign's art and audio live in its Asset Mod, as a Campaign Mod holds none. A Mission's own model and texture files are its doodads' sources.",
  voices: "Only an Asset Mod has voice files for a Campaign Mod's conversation. A Mission's voice files are its Screenplay's (screenplay.script.audioDir), placeholders spoken in their place.",
};

/**
 * The Mod Blueprint's fields a Mission Blueprint declares in a field of its own shape: the Mission's
 * field, and why its shape differs.
 */
export const MISSION_COUNTERPARTS: Readonly<Record<string, { readonly field: string; readonly reason: string }>> = {
  id: { field: "id", reason: "Both are slug ids; a Mission's also names its Campaign's mission." },
  name: { field: "title", reason: "A Mission's title is its DocInfo/Name, as a mod's name is." },
  description: { field: "summary", reason: "A Mission's summary and setting are its DocInfo/DescLong and DocInfo/DescShort, as a mod's descriptions are." },
  dependencies: { field: "dependencies", reason: "Without dependencies a map gets the default one (Void, DEFAULT_DEPENDENCIES), so a Mission's are optional and at least one when given." },
  triggers: {
    field: "triggers",
    reason: "A mod's triggers are its library's, spliced from a Triggers file; a map has no library, so a Mission's are its own trigger elements, one JSON file each (ADR-0026), with triggerVariables and triggerFolders.",
  },
  doodads: {
    field: "doodads",
    reason: "A Campaign Mod's doodads' files are in its Asset Mod; a Mission's are files in its own folder, so its doodad gives their sources (source, textures). Otherwise it is the same doodad (domain/custom-doodad.ts).",
  },
  screenplays: { field: "screenplay", reason: "A Mission plays one Screenplay, whose scenes its Beats cue; a Campaign Mod's Screenplays are its interludes and hub chats, each a Conversation." },
  soundSets: { field: "screenplay", reason: "A Mission's Screenplay lines' CSounds are compiled from its own voice files (screenplay.script.audioDir); a Campaign Mod's sound sets play its Asset Mod's." },
  cinematics: { field: "screenplay", reason: "A Mission's Cinematics are its Screenplay's (screenplay.cinematics), cued by its Beats; a Campaign Mod's are scenes of its own Screenplays." },
};

/** Declared Content that declares nothing, as a Blueprint without any parses to: for a Blueprint built in code (a melee map's terrain). */
export const noDeclaredContent = (): DeclaredContent => ({ gameData: [], entries: [], characters: [], strings: {}, files: [], setCutscenes: [], acceptedDifferences: [], removals: [] });
