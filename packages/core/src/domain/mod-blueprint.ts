// The Mod Blueprint (ADR-0011): the structured specification of a Campaign Mod or an Asset Mod,
// kept in the Workspace as mods/<id>/blueprint.json beside the committed mod package and its
// compile record. It owns the mod's Compiled Content; everything else in the package is Kept. As
// Import writes it, it owns little yet: its id, its kind, the dependencies the package lists and
// the catalog files its includes list names (docs/reference/mod-includes.md). Its name and
// descriptions are the mod's DocInfo strings.
// Converting a part adds it here: catalog entries (raw, by the GameData file they go in, or as
// generic typed entries), characters, custom doodads, the library's functions and other items, Screenplays and their sound sets,
// Cinematics, strings by key, library triggers and globals, and files written whole (scripts, cutscenes, UI,
// plain files), each from a source file in the mod's folder; for an Asset Mod, the Asset Source of
// each of its files. A converted part is checked against the Kept one it
// replaces (the Equivalence Check, src/mods/equivalence.ts), and each intended difference is named
// here as an Accepted Difference, with its reason. A Kept item the mod drops on purpose (a string
// nothing names, an old merge conflict's line, a file nothing plays) is named as an Accepted
// Removal, with its reason: the compile removes it, and the Equivalence Check expects it gone.

import path from "node:path";

import { z } from "zod";

import { AssetFileSchema, VoicesSchema } from "./asset-source.js";
import { CharactersSchema } from "./character.js";
import { CustomDoodadsSchema } from "./custom-doodad.js";
import { LOCALIZED_STRINGS_FILE, PackageFilePath as PackagePath, StringsSchema, StringText } from "./entry-strings.js";

import { LibraryInterfaceSchema } from "./library-interface.js";
import { ModCinematicsSchema, ModSetCutscenesSchema } from "./mod-cinematic.js";
import { ModScreenplaysSchema } from "./mod-screenplay.js";
import { slugId } from "./mission-blueprint.js";
import { SoundSetsSchema } from "./sound-set.js";

export const MOD_KINDS = ["campaign", "asset"] as const;
export type ModKind = (typeof MOD_KINDS)[number];

/** A source file in the mod's folder (mods/<id>/), relative to it. */
const SourcePath = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."), "A source is a file in the mod's folder, relative to it");

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

/** Where a GameData catalog file sits in a mod package. */
export const GAME_DATA_DIR = "Base.SC2Data/GameData/";

/** A GameData catalog file, by its path in the package. */
const GameDataFile = PackagePath.refine((file) => file.startsWith(GAME_DATA_DIR) && file.toLowerCase().endsWith(".xml"), `A GameData file is a .xml in ${GAME_DATA_DIR}`);

export const ModBlueprintSchema = z
  .object({
    id: slugId,
    /** The mod's name, as the Editor and the game show it: DocInfo/Name in GameStrings. */
    name: StringText.min(1).optional(),
    /** The mod's descriptions, short and long: DocInfo/DescShort and DocInfo/DescLong in GameStrings. */
    description: z
      .object({ short: StringText.min(1).optional(), long: StringText.min(1).optional() })
      .strict()
      .refine((description) => description.short !== undefined || description.long !== undefined, "A description has a short or long one")
      .optional(),
    /** A Campaign Mod (game data, characters, conversations, cutscenes, UI and libraries) or an Asset Mod (art and audio files only). */
    kind: z.enum(MOD_KINDS),
    /** Dependency strings, as DocumentInfo lists them (such as `bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod`), in load order. */
    dependencies: z.array(z.string().min(1)).default([]),
    /**
     * Catalog entries the Blueprint owns, by the GameData file they go in: each source is a
     * `<Catalog>` whose entries are written into that file one by one, beside its Kept entries.
     */
    gameData: z.array(z.object({ file: GameDataFile, source: SourcePath }).strict()).default([]),
    /**
     * The includes list (Base.SC2Data/GameData.xml) the Blueprint owns: the catalog files outside
     * the standard ones (one in a folder of GameData, or one not named for its catalog), in the
     * order the game loads them. Import fills it in from the package's list. The compile writes the
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
     * The Campaign's characters (domain/character.ts), each speaker once: written into
     * CharacterData as generic entries, and read by Mission compiles for their Screenplays'
     * speakers. Only a Campaign Mod has them.
     */
    characters: CharactersSchema.default([]),
    /**
     * The Campaign Mod's custom doodads (domain/custom-doodad.ts): each a model an Asset Mod of the
     * Workspace holds, written as a CModel and a CActorDoodad of its id in ModelData and ActorData,
     * so every Mission can place it and the Editor's palette lists it. Only a Campaign Mod has them.
     */
    doodads: CustomDoodadsSchema,
    /**
     * The Campaign Mod's GUI trigger library (domain/library-interface.ts): its id, name and each
     * function's interface with the stable ids found at Import, the body GUI (a source file of typed
     * calls) or Galaxy (a script file the Blueprint owns). The compile writes each function into
     * Triggers, its strings and its Galaxy (Lib<id>.galaxy); Mission compiles call them from it.
     */
    library: LibraryInterfaceSchema.optional(),
    /**
     * The Campaign Mod's UI Components (ADR-0019, src/ui/ui-component.ts), each turned on by its id
     * (`bossBar`, `toast`) with the look fields it overrides, `{}` for its default look. The compile
     * writes each one's layout, loaded ahead of the Blueprint's own, and adds its functions to the
     * library, which Missions' uiActions call.
     */
    ui: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/, "A UI Component is named by its id, such as bossBar"), z.record(z.string(), z.unknown())).optional(),
    /**
     * The Campaign Mod's Screenplays (domain/mod-screenplay.ts): its interludes and hub chats, each
     * from the Screenplay Source and compiled into the Conversation it names, in ConversationData
     * and its strings. Every speaker is one of the Blueprint's characters.
     */
    screenplays: ModScreenplaysSchema.default([]),
    /**
     * The Campaign Mod's sound sets (domain/sound-set.ts): for a conversation one of its Screenplays
     * compiles, a CSound per line in SoundData, each playing the voice file its Asset Mod's Asset
     * Sources give it.
     */
    soundSets: SoundSetsSchema.default([]),
    /**
     * The Campaign Mod's Cinematics (domain/mod-cinematic.ts): scenes of its Screenplays filmed from
     * shot lists in its folder (cinematics/<id>.json) on its imported Sets, each compiled into the
     * mod's Cutscenes as the file its cue plays.
     */
    cinematics: ModCinematicsSchema.default([]),
    /**
     * The Campaign Mod's Set cutscenes (domain/mod-cinematic.ts): Sets in its folder written back as
     * cutscenes with no shots, so the author can open each room in the Cutscene Editor.
     */
    setCutscenes: ModSetCutscenesSchema.default([]),
    /** The Asset Mod's files, each with its Asset Source (domain/asset-source.ts): a Workspace file, a community asset, a generated placeholder, or one derived from another. */
    assets: z.array(AssetFileSchema).default([]),
    /** The Asset Mod's voice files for a Campaign Mod's conversation, a line at a time: its recording, or a placeholder in its character's voice. */
    voices: z.array(VoicesSchema).default([]),
    /**
     * Localized strings the Blueprint owns that no entry does: by strings file (such as
     * `enUS.SC2Data/LocalizedData/GameStrings.txt`), each key's text. A catalog entry's own strings
     * are its own (a generic entry's or a character's strings, src/mods/entry-strings.ts).
     */
    strings: StringsSchema.default({}),
    /**
     * Library triggers and globals the Blueprint owns: a Triggers file whose library's Trigger and
     * Variable items are spliced in beside the Kept ones, and the name of each trigger, global and
     * trigger's local variable by element id, written into TriggerStrings (as convert-triggers writes them);
     * and, by the strings file each is in, the value of each text parameter of theirs,
     * Param/Value/lib_<library>_<id> (in GameStrings, as the Editor writes it).
     */
    triggers: z
      .object({
        source: SourcePath,
        names: z.record(z.string().regex(/^[0-9A-F]{8}$/, "A name is keyed by its element id, eight upper-case hexadecimal digits"), z.string().regex(/^[^\r\n]*$/, "A name is one line")).default({}),
        strings: StringsSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * Files the Blueprint writes whole: scripts, cutscenes, UI layouts and font styles, and plain
     * files; and, by the strings file each is in, the strings a file names as @<key>, as a layout's
     * <Text val="@UI/CreditItemBase/Actor"/> does.
     */
    files: z.array(z.object({ path: PackagePath, source: SourcePath, strings: StringsSchema.optional() }).strict()).default([]),
    /**
     * Differences from the Kept original that a conversion means to make, each named by its entry
     * (`catalog-entry:<file>:<Class>:<id>`, `string:<file>:<key>`, `trigger:<id>`, `file:<path>` …)
     * with the reason; any other difference fails the compile.
     */
    acceptedDifferences: z.array(z.object({ item: z.string().min(1), reason: z.string().min(1) }).strict()).default([]),
    /**
     * Accepted Removals: Kept items the mod drops on purpose, each named (`string:<file>:<key>`,
     * `line:<file>:<text>` for a line with no key, `file:<path>`) with the reason. The compile
     * removes each one, and the Equivalence Check expects it gone: a part that writes it back fails.
     */
    removals: z
      .array(
        z
          .object({
            item: z.string().min(1).superRefine((item, context) => {
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
  })
  .strict()
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.characters.length === 0, { path: ["characters"], message: "Only a Campaign Mod declares characters; an Asset Mod holds art and audio files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.doodads.length === 0, { path: ["doodads"], message: "Only a Campaign Mod declares doodads, in its game data; an Asset Mod holds their model and texture files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.screenplays.length === 0, { path: ["screenplays"], message: "Only a Campaign Mod has Screenplays; an Asset Mod holds art and audio files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.library === undefined, { path: ["library"], message: "Only a Campaign Mod has a library; an Asset Mod holds art and audio files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.ui === undefined, { path: ["ui"], message: "Only a Campaign Mod has UI Components; an Asset Mod holds art and audio files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.cinematics.length === 0, { path: ["cinematics"], message: "Only a Campaign Mod has Cinematics; an Asset Mod holds art and audio files" })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.setCutscenes.length === 0, { path: ["setCutscenes"], message: "Only a Campaign Mod has Set cutscenes; an Asset Mod holds art and audio files" })
  .superRefine((blueprint, context) => {
    // A Cinematic and a Set cutscene are each one file's writer; the game reads a file in any case.
    const cinematics = new Map(blueprint.cinematics.map((cinematic, index) => [cinematic.cutscene.toLowerCase(), index]));
    blueprint.setCutscenes.forEach((entry, index) => {
      const other = cinematics.get(entry.cutscene.toLowerCase());
      if (other !== undefined) context.addIssue({ code: "custom", path: ["setCutscenes", index, "cutscene"], message: `cinematics.${other} and setCutscenes.${index} both write ${entry.cutscene}: a cutscene is a Cinematic or a Set cutscene` });
    });
  })
  .refine((blueprint) => blueprint.kind === "campaign" || blueprint.soundSets.length === 0, { path: ["soundSets"], message: "Only a Campaign Mod has sound sets, its SoundData; an Asset Mod holds the voice files they play" })
  .refine((blueprint) => blueprint.kind === "asset" || blueprint.assets.length === 0, { path: ["assets"], message: "Only an Asset Mod has Asset Sources: a Campaign Mod holds no art or audio files" })
  .refine((blueprint) => blueprint.kind === "asset" || blueprint.voices.length === 0, { path: ["voices"], message: "Only an Asset Mod has voice files: a Campaign Mod's sound sets play them" });

export type ModBlueprint = z.infer<typeof ModBlueprintSchema>;
