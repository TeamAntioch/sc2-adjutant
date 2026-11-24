// The compile, import and convert tools: Map Packages and mods from Blueprints, and Kept content brought under a Blueprint's ownership.

import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { readMeleeMapBlueprint, writeMeleeMap } from "../../map/compile-melee-map.js";
import { formatMeleeReport } from "../../map/melee-checks.js";
import { compileMission, describePlaceholders } from "../../map/compile-mission.js";
import { importMap } from "../../map/import-map.js";
import { MOD_KINDS } from "../../domain/mod-blueprint.js";
import { formatPlaceholder } from "../../mods/asset-sources.js";
import { compileMod } from "../../mods/compile-mod.js";
import { OriginSchema } from "../../domain/asset-source.js";
import { convertAssets, formatConvertedAssets } from "../../mods/convert-assets.js";
import { convertEntries, formatConvertedEntries } from "../../mods/convert-entries.js";
import { type ConvertedSoundSet, convertSoundSet, formatConvertedSoundSet } from "../../mods/convert-sound-set.js";
import { convertFiles, formatConvertedFiles } from "../../mods/convert-files.js";
import { convertLibrary, formatConvertedLibrary } from "../../mods/convert-library.js";
import { convertTriggers, formatConvertedTriggers } from "../../mods/convert-triggers.js";
import { convertMissionTriggers, formatConvertedMissionTriggers } from "../../map/convert-mission-triggers.js";
import { convertScreenplay, formatConvertedScreenplay } from "../../mods/convert-screenplay.js";
import { convertMissionScreenplay, formatConvertedMissionScreenplay, missionConversionNextStep } from "../../map/convert-mission-screenplay.js";
import { importMod } from "../../mods/import-mod.js";
import { formatKeptReport, KEPT_COMPONENTS, keptReport } from "../../mods/kept-report.js";
import { formatProposedRemovals, proposeRemovals } from "../../mods/removals.js";
import { readWorkspaceMod } from "../../mods/workspace-mods.js";
import { missionMapPackage } from "../../map/mission-package.js";
import { missionBlueprintPath } from "../../plugins/workspace.js";
import { editorDecisions } from "../../map/editor-changes.js";
import { realPathOf } from "../../util/inside.js";
import { MissionSchema, plain } from "./schemas.js";
import { stageHint, insideWorkspace, defaultOutputDir, oneAtATime, readingMapToEdit } from "./mission-files.js";
import { closeForRefresh, describeHandoff, editorHasOpen, reopenMap, TEST_BUDGET_SECONDS, TEST_MIN_SECONDS, testInGame } from "./editor-handoff.js";
import { hasKeptTerrain } from "../../domain/mission-blueprint.js";
import { buildLayoutModel } from "../../layout/layout-model.js";
import { routeTestResults } from "../../layout/route-checks.js";
import { type CallContext } from "../call-context.js";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, toolGroup } from "./tool-group.js";

const LineChangeSchema = z.object({ line: z.string(), kept: z.string(), script: z.string() });

/** What convert_screenplay found converting a Kept-terrain Mission's own conversation (map/convert-mission-screenplay.ts). */
const ConvertedMissionScreenplaySchema = z.object({
  conversation: z.string(),
  lines: z.number(),
  keptLines: z.number(),
  keepingSounds: z.number(),
  changed: z.array(LineChangeSchema),
  added: z.array(z.string()),
  dropped: z.array(z.object({ line: z.string(), cutscenes: z.array(z.string()) })),
  speakers: z.array(LineChangeSchema),
  unrecorded: z.array(z.string()),
  relinks: z.array(z.object({ file: z.string(), line: z.string(), from: z.string(), to: z.string() })),
  removes: z.object({ sounds: z.array(z.string()), strings: z.array(z.string()), keptForTriggers: z.array(z.string()) }),
  differences: z.array(z.object({ item: z.string(), detail: z.string() })),
  accepted: z.number(),
  unaccepted: z.number(),
});

/** A mod's conversion (mods/convert-screenplay.ts), as convert_screenplay returns it. */
const ConvertedModScreenplaySchema = z.object({
  index: z.number(),
  ref: z.string().optional(),
  source: z.string(),
  lines: z.number(),
  importedSounds: z.number(),
  name: z.string().optional(),
  textDifferences: z.array(z.object({ item: z.string(), kept: z.string(), script: z.string() })),
  entryDifference: z.string().optional(),
  renumbered: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  references: z.array(z.object({ file: z.string(), count: z.number() })).optional(),
});

/** convert_screenplay's structured output: a mod's conversion whole, or a Mission's alone under mission. */
const ConvertScreenplayOutputSchema = ConvertedModScreenplaySchema.partial()
  .extend({ mission: ConvertedMissionScreenplaySchema.optional() })
  .superRefine((value, context) => {
    const { mission, ...mod } = value;
    if (mission) {
      const fields = Object.keys(mod);
      if (fields.length) context.addIssue({ code: "custom", message: `A Mission's conversion is under mission alone, but the result has ${fields.join(", ")} too` });
      return;
    }
    for (const issue of ConvertedModScreenplaySchema.safeParse(mod).error?.issues ?? []) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });

/** compile_map's and test_mission's answers to a compile that stopped on the author's Editor changes (editor-changes.ts). */
const DECISION_INPUTS = {
  keep: z.array(z.string().min(1)).optional().describe("Entries the compile listed as changed in the Editor to keep as the Editor left them (object:<id>, trigger:<id> …): each leaves the compile record, as Kept Content the Blueprint no longer writes"),
  discard: z.array(z.string().min(1)).optional().describe("Entries the compile listed as changed in the Editor to discard: overwritten with what the Blueprint says"),
  keepAll: z.boolean().optional().describe("Keep every change the compile lists (an entry in discard still goes)"),
  discardAll: z.boolean().optional().describe("Discard every change the compile lists (an entry in keep still stays)"),
};

/** The tools registerCompileTools can register, the compile group. */
export const COMPILE_TOOLS = ["compile_map", "import_map", "import_mod", "compile_mod", "convert_sound_set", "convert_entries", "convert_files", "convert_assets", "convert_library", "convert_triggers", "convert_screenplay", "propose_removals", "kept_report", "compile_melee_map", "test_mission"] as const;

export function registerCompileTools(server: McpServer, ctx: CallContext): void {
  const tool = toolGroup(server, COMPILE_TOOLS);
  tool(
    "compile_map",
    {
      title: "Compile a Mission",
      annotations: DESTRUCTIVE,
      description:
        "Compiles a Mission's Blueprint into a Map Package the Galaxy Editor opens, with its terrain, objects, regions and triggers. By default it compiles in place, into the Mission's committed package beside its Blueprint: the compile record there (compile-record.json) lists what the last compile wrote, which is replaced, and everything else in the package (Kept Content, such as the author's own doodads, units, regions and strings) is left byte for byte. Kept triggers stay beside the compiled ones, their XML and Galaxy as the Editor wrote them. When the author has changed Compiled Content in the Editor since the last compile, the compile stops, writing nothing, and lists each change by entry (object:<id>, region:<id>, trigger:<id>, string:<file>:<key>, file:<path>): run sync first for what it brings back (moved Anchors, redrawn regions), and for the rest ask the author whether to keep each one (it stays as the Editor left it and leaves the record, as Kept Content the Blueprint no longer writes) or discard it (overwritten), then compile again with keep, discard, keepAll or discardAll. A Screenplay line with no voice file (<sound id>.ogg or .wav in the Screenplay's audioDir) gets a placeholder at its final path: spoken when the machine's Host Adapter can speak, silent otherwise. Voice files go into the package as .ogg, a .wav encoded with ffmpeg, unless screenplay.script.voiceFormat is wav. Returns where it wrote the package and any warnings for the author. Refuses, writing nothing, while the Editor has the package open (when the machine's Host Adapter can tell): ask the author to close the map in the Editor without saving, then compile again. With refresh, an open map is instead closed from the Editor's File menu (never saved, and refused while the Editor's title shows unsaved changes), the package is compiled, and the same map is opened again; it needs the Editor in front, so it refuses when the author is in another app.",
      inputSchema: {
        mission: MissionSchema,
        outputDir: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Where to write the Map Package: a folder inside the Workspace, relative to its root, written whole. By default the Mission's committed package, <mission folder>/<Name>.SC2Map, compiled in place",
          ),
        refresh: z.boolean().optional().describe("Close the map in the Editor first when the author has it open and its document has no unsaved changes, compile, then open it again, instead of refusing"),
        ...DECISION_INPUTS,
      },
      outputSchema: { outputDir: z.string(), warnings: z.array(z.string()) },
    },
    async ({ mission, outputDir, refresh, ...choices }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const target = outputDir ? await insideWorkspace(workspace.root, outputDir) : await missionMapPackage(blueprintPath);
      let closed = false;
      if (refresh) {
        const refreshed = await closeForRefresh(ctx.host, target, "compile_map");
        if (refreshed.fail) return ctx.fail(refreshed.fail);
        closed = refreshed.closed;
      }
      // Checked before the compile, which would rewrite the map under the Editor.
      const open = await editorHasOpen(ctx.host, target, "compile_map", "Not compiled");
      if (open) return ctx.fail(open.text);
      let compiled;
      try {
        compiled = await oneAtATime(await realPathOf(target), () => compileMission(workspace, blueprintPath, target, { host: ctx.host, decisions: editorDecisions(choices) }));
      } catch (error) {
        // A compile that stops writes nothing: the author's map goes back as it was.
        if (closed) await reopenMap(ctx.host, target);
        throw error;
      }
      const { blueprint, warnings, placeholders } = compiled;
      const voices = describePlaceholders(placeholders);
      const lines = [
        `Compiled ${blueprint.title} to ${target}`,
        ...(closed ? [await reopenMap(ctx.host, target)] : []),
        ...(voices ? [voices] : []),
        ...warnings.map((warning) => `Warning: ${warning}`),
        await stageHint(blueprintPath),
      ];
      return ctx.reply(lines.join("\n"), { outputDir: target, warnings });
    },
  );

  tool(
    "import_map",
    {
      title: "Import a map",
      annotations: ADDITIVE,
      description:
        "Makes a Mission from a Map Package built outside the Workspace (Import, ADR-0010). Copies the package byte for byte to <missions>/<mission>/<Name>.SC2Map, never writing to the source, and writes a minimal Blueprint read from it (id, title, Campaign, setting, map size, tileset, dependencies, and the Screenplay reference when the Campaign's Screenplay Source knows the package's conversation, which is then pulled) and an empty compile record: everything in the package starts as Kept Content. The Blueprint has no Zones or Beats, so the layout checks skip and a compile leaves the terrain, map info and triggers as they are. The Editor's default map name is replaced with the title.",
      inputSchema: {
        source: z.string().min(1).describe("The unpacked .SC2Map folder to import: absolute, or relative to the Workspace root. Only read"),
        mission: z.string().min(1).describe("The new Mission's id, which is also its folder name: lowercase letters, numbers, hyphens and underscores"),
        title: z.string().min(1).optional().describe("The Mission's title; by default the map's own name, or its file name while that is the Editor's default"),
        setting: z.string().min(1).optional().describe("One line on where the Mission is set; by default where it was imported from"),
      },
      outputSchema: { blueprint: z.string(), mapPackage: z.string() },
    },
    async ({ source, mission, title, setting }) => {
      const workspace = await ctx.workspace();
      const imported = await importMap(workspace, path.resolve(workspace.root, source), mission, { ...(title ? { title } : {}), ...(setting ? { setting } : {}) });
      const relative = (file: string) => path.relative(workspace.root, file).split(path.sep).join("/");
      return ctx.reply([...imported.notes, `Wrote ${relative(imported.blueprintPath)} and its empty compile record`].join("\n"), { blueprint: relative(imported.blueprintPath), mapPackage: relative(imported.mapPackage) });
    },
  );

  tool(
    "import_mod",
    {
      title: "Import a mod",
      annotations: ADDITIVE,
      description:
        "Makes a Workspace mod from a mod built outside the Workspace (Import, ADR-0011). Copies the unpacked .SC2Mod byte for byte to mods/<mod>/<Name>.SC2Mod, keeping its name, never writing to the source, and writes a minimal Mod Blueprint (id, kind and the dependencies its DocumentInfo lists) and an empty compile record: everything in the package starts as Kept Content, and the first compile changes nothing. The Workspace config's mods names it. The kind is campaign (a Campaign Mod: game data, triggers, cutscenes, UI) when the package has game data or triggers, else asset (an Asset Mod: art and audio files only), unless given. An Asset Mod's binaries (models, textures, audio, fonts) are tracked by Git LFS: the Workspace's .gitattributes gains the patterns it lacks.",
      inputSchema: {
        source: z.string().min(1).describe("The unpacked .SC2Mod folder to import: absolute, or relative to the Workspace root. Only read"),
        mod: z.string().min(1).describe("The new mod's id, which is also its folder name in mods/: lowercase letters, numbers, hyphens and underscores"),
        kind: z.enum(MOD_KINDS).optional().describe("campaign or asset; by default read from the package"),
      },
      outputSchema: { blueprint: z.string(), modPackage: z.string(), kind: z.enum(MOD_KINDS) },
    },
    async ({ source, mod, kind }) => {
      const workspace = await ctx.workspace();
      const imported = await importMod(workspace, path.resolve(workspace.root, source), mod, kind ? { kind } : {});
      const relative = (file: string) => path.relative(workspace.root, file).split(path.sep).join("/");
      return ctx.reply([...imported.notes, `Wrote ${relative(imported.blueprintPath)} and its empty compile record`].join("\n"), { blueprint: relative(imported.blueprintPath), modPackage: relative(imported.modPackage), kind: imported.kind });
    },
  );

  tool(
    "compile_mod",
    {
      title: "Compile a mod",
      annotations: DESTRUCTIVE,
      description:
        "Compiles a Workspace mod's Mod Blueprint into its committed mod package in place (ADR-0011, under ADR-0010's compile record). Its writers replace only what compile-record.json lists and leave every Kept byte as the Editor wrote it: catalog entries by entry in their GameData files (gameData raw, and entries: generic typed entries, each checked against the game's data schema first, every problem listed by entry, as convert_entries writes them), string keys (strings: the Blueprint's raw strings, each generic entry's and character's own strings, and DocInfo/Name, DescShort and DescLong from the Blueprint's name and description), the library's functions from its interface (library: each function's FunctionDef spliced into Triggers, its strings, and a GUI function's Galaxy written into Lib<id>.galaxy as the Editor generates it, as convert_library writes them; an interface change that would renumber an id the package has fails the compile), the Campaign Mod's Screenplays (screenplays: each interlude or set of hub chats, from its pulled copy in the mod's folder, compiled into the CConversation it names, each scene a group and each line a conversation line with the naming template's line id, its imported Sound kept, its speaker's character from the Blueprint's characters, and its text and scene titles into ConversationStrings, as convert_screenplay declares them), the library's triggers and globals spliced into Triggers (triggers), files written whole (files: scripts, cutscenes, UI, plain files), a Campaign Mod's Set cutscenes (setCutscenes: each Set written back as the cutscene it names, with no shots, so its room opens in the Cutscene Editor; an Editor change to one comes back through sync_mod), a Campaign Mod's sound sets (soundSets: a CSound in SoundData for each line of a conversation, on a dialogue parent in the template form or with its AssetArray in full, a line in a form of its own if it has one, playing the voice file its Asset Mod declares for the line's Sound, as convert_sound_set writes them), and an Asset Mod's files from their Asset Sources (assets: a Workspace file checked against its SHA-256, a community asset fetched once to the machine's cache and checked against its SHA-256, a generated placeholder, or one derived from another by a named step such as wav-to-ogg; voices: a voice file per line of a Campaign Mod conversation, its recording if it has one (a recording whose file this machine doesn't have leaves the package's voice file as it is, with a warning), else a placeholder spoken in its character's voice; a community asset or placeholder is git-ignored by the mod folder's .gitignore, which the compile writes); once the Blueprint owns anything it also generates DocumentInfo (its dependencies, and preloads derived from the model, sound and texture files its entries name) and DocumentHeader with its dependencies, the ComponentList and the .version stamps. A part written over a Kept one is converted under the Equivalence Check: compared with the original as the Editor reads it (ordering, whitespace, attribute order and number formatting ignored), and any difference the Blueprint's acceptedDifferences doesn't name, with a reason, fails the compile, writing nothing, and lists each. Each of the Blueprint's removals (Accepted Removals: a Kept string:<strings file>:<key>, line:<strings file>:<text> for a line with no key, or file:<path>, with its reason) is removed from the package, and the check expects it gone: a whole strings file is compared with its original less them, and a part that writes one back fails. When the author has changed Compiled Content in the Editor since the last compile, the compile stops, writing nothing, and lists each change by entry (catalog-entry:<file>:<Class>:<id>, string:<file>:<key>, trigger:<id>, function:<id>, file:<path>): ask the author whether to keep each one (it stays as the Editor left it and leaves the record, as Kept Content) or discard it (overwritten), then compile again with keep, discard, keepAll or discardAll. Returns what it converted, any warnings, the voice files that are placeholders (each line's, and why it has no recording), and the mod's Kept report by component.",
      inputSchema: {
        mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        ...DECISION_INPUTS,
      },
      outputSchema: {
        modPackage: z.string(),
        conversions: z.array(z.object({ item: z.string(), accepted: z.string().optional() })),
        removed: z.array(z.object({ item: z.string(), reason: z.string() })),
        warnings: z.array(z.string()),
        placeholders: z.array(z.object({ path: z.string(), line: z.string(), speaker: z.string(), reason: z.string() })),
        kept: z.object({ total: z.number(), components: z.array(z.object({ component: z.enum(KEPT_COMPONENTS), count: z.number() })), notConvertibleYet: z.number(), leftToEditor: z.number() }),
      },
    },
    async ({ mod, ...choices }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const compiled = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => compileMod(blueprintPath, { decisions: editorDecisions(choices), workspace, host: ctx.host }));
      const report = await keptReport(blueprintPath);
      const relative = (file: string) => path.relative(workspace.root, file).split(path.sep).join("/");
      return {
        content: [
          {
            type: "text",
            text: [
              `Mod compiled in ${relative(compiled.modPackage)}`,
              ...compiled.conversions.map((conversion) => `Converted ${conversion.item}${conversion.accepted ? ` (Accepted Difference: ${conversion.accepted})` : ""}`),
              ...compiled.removed.map((removal) => `Removed ${removal.item} (Accepted Removal: ${removal.reason})`),
              ...compiled.warnings.map((warning) => `Warning: ${warning}`),
              ...compiled.placeholders.map(formatPlaceholder),
              formatKeptReport(report),
            ].join("\n"),
          },
        ],
        structuredContent: {
          modPackage: relative(compiled.modPackage),
          conversions: compiled.conversions.map((conversion) => ({ ...conversion })),
          removed: compiled.removed.map((removal) => ({ ...removal })),
          warnings: [...compiled.warnings],
          placeholders: compiled.placeholders.map((placeholder) => ({ ...placeholder })),
          kept: { total: report.total, components: report.components.map(({ component, count }) => ({ component, count })), notConvertibleYet: report.notConvertibleYet.count, leftToEditor: report.leftToEditor.count },
        },
      };
    },
  );

  tool(
    "convert_sound_set",
    {
      title: "Convert a conversation's CSounds and voice files to its sound set and voices",
      annotations: DESTRUCTIVE,
      description:
        "Writes the sound set of one of a Workspace Campaign Mod's Screenplay conversations into its Mod Blueprint's soundSets, and the conversation's voices into the Blueprint of the Asset Mod it depends on that holds the voice files (ADR-0011), from each line's Kept CSound and voice file. A CSound with a Template is written in the template form (on its parent, whose AssetArrayTemplate File gives the file), one with its AssetArray in full in the AssetArray form; the most common form is the set's, and a line in another has its own (lines). Each line's voice file becomes its recording: the Asset Mod's own assets declaration of the file, moved into voices, else the package's file copied to voices/<Sound>.<format> in the Asset Mod's folder with its SHA-256. A voice file that is a Git LFS pointer is recorded by the SHA-256 it points to, so compile_mod holds the package's file until the recording is pulled and never writes over a voice without it. A line with no voice file gets a placeholder until it's recorded. A line CSound convert_entries wrote as a Generic Entry moves into the sound set. Each line CSound's name (Sound/Name/<id> in ObjectStrings) is the sound set's, which writes its id: it leaves the Blueprint's raw strings and a moved CSound's strings, and a Kept name that isn't the id is listed as a difference. A CSound no sound set can write refuses the conversation, naming each, and nothing is written. What the compile will find different from the Kept CSounds (such as a renumbered line's Line) is listed, to name in acceptedDifferences. Nothing in either package changes: compile_mod on the Asset Mod, then on the Campaign Mod, writes them over their Kept originals under the Equivalence Check.",
      inputSchema: {
        mod: z.string().min(1).describe("The Campaign Mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        conversation: z.string().min(1).describe("The conversation, one of its Screenplays compiles, such as HubConversation-Medic"),
      },
      outputSchema: {
        conversation: z.string(),
        assetMod: z.string(),
        recorded: z.array(z.string()),
        placeholders: z.array(z.object({ lineId: z.string(), sound: z.string() })),
        differences: z.array(z.string()),
        strings: z.array(z.string()),
        movedEntries: z.array(z.string()),
        movedAssets: z.array(z.string()),
      },
    },
    async ({ mod, conversation }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      // It writes the Asset Mod's Blueprint and folder too: each Asset Mod's lock is held as well, in one order.
      const assetDirs: string[] = [];
      for (const id of workspace.mods) {
        const found = await readWorkspaceMod(workspace, id).catch(() => undefined);
        if (found?.kind === "asset") assetDirs.push(await realPathOf(path.dirname(found.blueprintPath)));
      }
      const locked = [await realPathOf(path.dirname(blueprintPath)), ...assetDirs.sort()].reduceRight<() => Promise<ConvertedSoundSet>>((task, key) => () => oneAtATime(key, task), () => convertSoundSet(blueprintPath, { conversation, workspace }));
      const converted = await locked();
      return ctx.reply(`${formatConvertedSoundSet(converted)}\nCompile the Asset Mod, then the Campaign Mod (compile_mod), to write them over their Kept originals, under the Equivalence Check.`, {
          ...converted,
          recorded: [...converted.recorded],
          placeholders: converted.placeholders.map((item) => ({ ...item })),
          differences: [...converted.differences],
          movedEntries: [...converted.movedEntries],
          movedAssets: [...converted.movedAssets],
        });
    },
  );

  tool(
    "convert_entries",
    {
      title: "Convert a mod's catalog entries",
      annotations: DESTRUCTIVE,
      description:
        "Writes Kept entries of one GameData file of a Workspace mod into its Mod Blueprint as generic typed catalog entries (ADR-0011): each { catalog, class, id, parent, fields }, keeping its imported id, in entries/<file name>.json in the mod's folder, which the Blueprint's entries lists. Fields are written as Blizzard's catalogs write them: a field given as a number or string is its value attribute; an object is a structure whose numbers and strings are its attributes and whose objects and arrays are its own fields; an array is the field once per item. A comment inside an entry is kept where it stands: a $comment key among a structure's fields ($comment2 … for more), or an item holding only $comment among an array's. A class's default is the one entry with no id, and gives attributes { default: \"1\" }. Each entry takes the localized strings keyed to it with it, by strings file, from the package's Kept strings or the Blueprint's raw strings (which they leave): those its catalog's convention names for its id (<Catalog>/<Field>/<id>, such as Unit/Name/<id>, Button/Tooltip/<id>, Button/Hotkey/<id>, */EditorPrefix/<id>) and those its fields name (UserData text, a ConversationState's names) unless the convention gives them to another entry of the mod; so does each entry of the file the Blueprint already writes, a generic one or a declared character's CCharacter, so running it again gives earlier conversions their strings. An entry stays Kept, with the reason, when its class isn't in the game's data schema, it doesn't fit the schema (an unknown field, a wrong kind of value), its generic form wouldn't read back the same (a comment included) or the file has its key twice. Nothing in the package changes: compile_mod then writes the entries over their Kept originals under the Equivalence Check, moving them from Kept to Compiled.",
      inputSchema: {
        mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        file: z.string().min(1).describe("The GameData file, as a path in the mod package: Base.SC2Data/GameData/WaterData.xml"),
        entries: z.array(z.string().min(1)).optional().describe("The entries to convert, by <Class>:<id> (CWater:MyWater), or the class alone for a class default; every Kept entry of the file when not given"),
      },
      outputSchema: {
        source: z.string(),
        converted: z.array(z.string()),
        refused: z.array(z.object({ key: z.string(), reason: z.string() })),
        strings: z.array(z.string()),
      },
    },
    async ({ mod, file, entries }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => convertEntries(blueprintPath, { file, workspace, ...(entries ? { keys: entries } : {}) }));
      return ctx.reply(`${formatConvertedEntries(converted)}\nCompile the mod (compile_mod) to write them over their Kept originals, under the Equivalence Check.`, { source: converted.source, converted: [...converted.converted], refused: converted.refused.map((item) => ({ ...item })), strings: [...converted.strings] });
    },
  );

  tool(
    "convert_files",
    {
      title: "Convert a mod's whole files",
      annotations: DESTRUCTIVE,
      description:
        "Writes Kept whole files of a Workspace mod into its Mod Blueprint's files (ADR-0011): each copied into the mod's folder at its path in the package less Base.SC2Data/ (scripts/… for Base.SC2Data/scripts/…), which the Blueprint then owns. Without paths it takes every Kept Galaxy script, UI layout (.SC2Layout) and font style (.SC2Style). A file the Blueprint already writes (in files, as its library's Galaxy or as an Asset Source) stays as it is; a package file the compile generates, a GameData catalog, a strings file and Triggers are refused, since they're owned by their parts. Each file takes the strings it names as @<key> (a UI layout's <Text val=\"@UI/…\"/>) into its strings, by the strings file the package has each in, from the Kept strings or the Blueprint's raw strings, which it leaves; a file the Blueprint already writes takes those it didn't then, and one removals names stays removed. Nothing in the package changes: compile_mod then writes them over their Kept originals under the Equivalence Check.",
      inputSchema: {
        mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        paths: z.array(z.string().min(1)).optional().describe("The files to convert, by path in the package (Base.SC2Data/UI/Layout/Main.SC2Layout); every Kept Galaxy, layout and style file when not given"),
      },
      outputSchema: { converted: z.array(z.string()), refused: z.array(z.object({ path: z.string(), reason: z.string() })), strings: z.array(z.string()) },
    },
    async ({ mod, paths }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => convertFiles(blueprintPath, paths ? { paths } : {}));
      return ctx.reply(`${formatConvertedFiles(converted)}\nCompile the mod (compile_mod) to write them over their Kept originals, under the Equivalence Check.`, { converted: [...converted.converted], refused: converted.refused.map((item) => ({ ...item })), strings: [...converted.strings] });
    },
  );

  tool(
    "convert_assets",
    {
      title: "Convert an Asset Mod's files",
      annotations: DESTRUCTIVE,
      description:
        "Declares a Workspace Asset Mod's Kept art and audio files (those in its .SC2Assets folders) as Workspace-file Asset Sources in bulk (ADR-0011): each copied into the mod's folder as assets/<path in the package>, one Git LFS object with the package's copy, and listed in the Blueprint's assets with its SHA-256. A file that's a Git LFS pointer this machine hasn't pulled stays Kept. Lists the Workspace files with no recorded origin whose names suggest another (Heroes of the Storm's storm_ prefix, and the suspects globs given): ask the author where each came from, then record it with origins, each { match: <glob>, origin } on every Workspace file it matches, converted now or before. An origin is a port ({ kind: port, of: <game>, owner: <rights holder>, by: <who ported it> }) or a community asset kept in the Workspace ({ kind: community, credit, site?, url? }); it's provenance only, the file still compiles from the Workspace. A glob without a slash matches a file's name; * is any run of a name, ** any run of folders. Nothing in the package changes: compile_mod then writes the files over their Kept originals under the Equivalence Check.",
      inputSchema: {
        mod: z.string().min(1).describe("The Asset Mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        paths: z.array(z.string().min(1)).optional().describe("The files to convert, by path in the package; every Kept file of its .SC2Assets folders when not given"),
        suspects: z.array(z.string().min(1)).optional().describe("More globs whose files the author should check the provenance of (NanaKey_*)"),
        origins: z.array(z.object({ match: z.string().min(1), origin: OriginSchema })).optional().describe("Origins the author gave, each recorded on every Workspace file its glob matches"),
      },
      outputSchema: {
        converted: z.array(z.string()),
        refused: z.array(z.object({ path: z.string(), reason: z.string() })),
        origins: z.array(z.object({ path: z.string(), origin: OriginSchema })),
        suspects: z.array(z.object({ path: z.string(), why: z.string() })),
      },
    },
    async ({ mod, paths, suspects, origins }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () =>
        convertAssets(blueprintPath, { ...(paths ? { paths } : {}), ...(suspects ? { suspects } : {}), ...(origins ? { origins } : {}) }),
      );
      return ctx.reply(`${formatConvertedAssets(converted)}\nCompile the mod (compile_mod) to write them over their Kept originals, under the Equivalence Check.`, {
          converted: [...converted.converted],
          refused: converted.refused.map((item) => ({ ...item })),
          origins: converted.origins.map((item) => ({ ...item })),
          suspects: converted.suspects.map((item) => ({ ...item })),
        });
    },
  );

  tool(
    "convert_library",
    {
      title: "Convert a mod's library functions",
      annotations: DESTRUCTIVE,
      description:
        "Writes Kept functions of a Workspace Campaign Mod's GUI trigger library into its Mod Blueprint's library interface (ADR-0011), keeping their imported ids: each function's name, kind, parameters with their types and defaults, grammar and hint. A GUI function's body goes in library/<identifier>.json, typed calls stored as data; a native one's body is the script file in the package that defines it, copied into the mod's folder (scripts/… for Base.SC2Data/scripts/…), which the Blueprint then owns. It writes the library's other items into the interface too: its categories (trigger folders) with what each files, in order, preset types and their values, structures and their members, comments and custom script, with their names, and the Root's order the first time one converts; a category may file a Kept item, such as a trigger convert_triggers hasn't converted. A function or item stays Kept, with the reason, when its XML holds a form the conversion doesn't write yet, its Galaxy can't be written as the Editor would (a call to a function the game's libraries don't define, a template macro it doesn't know, a function that runs in its own thread), or no one script file defines a native one. Nothing in the package changes: compile_mod then writes the functions, their strings and their Galaxy over the Kept originals under the Equivalence Check.",
      inputSchema: {
        mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        functions: z.array(z.string().min(1)).optional().describe("The functions and other items to convert, by name (Send Transmission (Custom), Cutscene Tools) or element id (B8B27D5C); every Kept one it can convert when not given"),
      },
      outputSchema: {
        converted: z.array(z.string()),
        refused: z.array(z.object({ function: z.string(), reason: z.string() })),
        items: z.array(z.string()),
        refusedItems: z.array(z.object({ item: z.string(), reason: z.string() })),
      },
    },
    async ({ mod, functions }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => convertLibrary(blueprintPath, functions ? { functions } : {}));
      return ctx.reply(`${formatConvertedLibrary(converted)}\nCompile the mod (compile_mod) to write them over their Kept originals, under the Equivalence Check.`, { converted: [...converted.converted], refused: converted.refused.map((item) => ({ ...item })), items: [...converted.items], refusedItems: converted.refusedItems.map((item) => ({ ...item })) });
    },
  );

  tool(
    "convert_triggers",
    {
      title: "Convert Kept triggers into a Blueprint",
      annotations: DESTRUCTIVE,
      description:
        "Writes Kept triggers and globals of a Workspace Campaign Mod's GUI trigger library into its Mod Blueprint's triggers (ADR-0011), keeping their element ids: each item's elements go into the Blueprint's triggers source (library/triggers.xml unless the Blueprint names another), as the Editor wrote them, and its name and a trigger's local variables' names into triggers.names, and each text parameter's value (Param/Value/lib_<library>_<id>) into triggers.strings, by the strings file the package has it in, from the Kept strings or the Blueprint's raw strings, which it leaves; triggers converted earlier take the values they didn't then, and a value removals names stays removed. A category of the library interface (convert_library) that files one keeps filing it. Nothing in the package changes: compile_mod then writes them and their names over the Kept originals under the Equivalence Check. The compile doesn't write their Galaxy: it leaves the Editor's. Given a Mission instead of a mod, it reads chosen Kept triggers, functions, globals, comments, Trigger Folders, preset types, records and custom script of the Mission's Map Package into its Blueprint's own trigger elements (ADR-0026): a global into the Blueprint's triggerVariables, a folder into its triggerFolders (filing what it did, Kept or converted), every other one into a file of its own in triggers/ (triggers/<name>.json, listed in the Blueprint's triggers), a GUI Body keeping the element's Ids, its name and its local variables', a trigger's flags, events, conditions and actions, a function's kind, flags, return type, parameters and actions, a preset type's values, a record's members, custom script as data, and its text values' words in strings. A trigger stays where the package files it: a Kept folder keeps filing it, and the compile writes it in place of the Kept one. One converts only when it reads back as it is, its XML and Galaxy come out as the Editor's, and everything it names is in reach (a library the map loads, a Kept element, the Blueprint's); else it stays Kept, with why, in the Editor's terms. Kept References and holds that name it keep working, by its Id and Galaxy name. Nothing in the package changes: compile_map, in place, then writes each over its Kept original under the Equivalence Check. The result is under mission in the structured output.",
      inputSchema: {
        mod: z.string().min(1).optional().describe("The mod's id, as the Workspace config's mods names it (its folder in mods/); give this or mission"),
        mission: MissionSchema.optional().describe("A Mission whose Map Package's Kept triggers are converted into its Blueprint, its folder name in the Workspace's missions folder; give this or mod"),
        items: z.array(z.string().min(1)).optional().describe("The triggers (and, for a mod, globals; for a Mission, functions, globals, comments, folders, preset types, records and custom script, a comment by its element id) to convert, by name or element id; every Kept one that can convert when not given"),
      },
      outputSchema: {
        converted: z.array(z.string()).optional(),
        refused: z.array(z.object({ item: z.string(), reason: z.string() })).optional(),
        strings: z.array(z.string()).optional(),
        mission: z
          .object({
            converted: z.array(z.object({ kind: z.enum(["trigger", "function", "global", "comment", "folder", "preset", "record", "custom-script"]), name: z.string(), id: z.string(), file: z.string() })),
            refused: z.array(z.object({ kind: z.enum(["trigger", "function", "global", "comment", "folder", "preset", "record", "custom-script"]), element: z.string(), reason: z.string() })),
          })
          .optional(),
      },
    },
    async ({ mod, mission, items }) => {
      if (mission !== undefined && mod === undefined) {
        const workspace = await ctx.workspace();
        const blueprintPath = await missionBlueprintPath(workspace, mission);
        const mapPackage = await missionMapPackage(blueprintPath);
        // It writes the Blueprint and reads the package: one at a time with the compile and with Blueprint edits.
        const converted = await readingMapToEdit(mapPackage, blueprintPath, () => convertMissionTriggers(workspace, blueprintPath, items ? { triggers: items } : {}));
        return ctx.reply(`${formatConvertedMissionTriggers(converted)}\nCompile the Mission in place (compile_map) to write them over their Kept originals, under the Equivalence Check.`, {
          mission: { converted: converted.converted.map((item) => ({ ...item })), refused: converted.refused.map((item) => ({ ...item })) },
        });
      }
      if (mod === undefined || mission !== undefined) throw new Error(`Give a mod or a mission whose Kept triggers to convert${mod === undefined ? "" : ", not both"}`);
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => convertTriggers(blueprintPath, items ? { items } : {}));
      return ctx.reply(`${formatConvertedTriggers(converted)}\nCompile the mod (compile_mod) to write them over their Kept originals, under the Equivalence Check.`, { converted: [...converted.converted], refused: converted.refused.map((item) => ({ ...item })), strings: [...converted.strings] });
    },
  );

  tool(
    "convert_screenplay",
    {
      title: "Convert a Kept Conversation to its Screenplay",
      annotations: DESTRUCTIVE,
      description:
        "Declares the Screenplay a Kept CConversation of a Workspace Campaign Mod comes from (an interlude or a set of hub chats) in its Mod Blueprint's screenplays (ADR-0011): it asks the Screenplay Source which Screenplay that is (or takes ref), pulls it into screenplays/<conversation>.md in the mod's folder, and keeps the imported ids. The Conversation's name (Conversation/Name/<conversation> in ObjectStrings), from the Blueprint's raw strings or the Kept ones, is recorded as the declaration's name, which the compile writes; it leaves the raw strings, and one that removals names refuses the conversion. The naming template names each line, and those must be the Conversation's line ids line for line, or it is refused, naming each line on either side; each line keeps the Sound it was imported with. A wordless scene (directions, no lines) is an empty group, and a group keeps the stale name the Editor gave it (importedGroupNames). The Conversation must then compile as the Editor has it, so what can still differ is the lines' text: each string whose Screenplay text differs from the Kept one is listed (trailing space aside, which the check ignores), to name in the Mod Blueprint's acceptedDifferences or change at the Source. Only on the author's decision: accept (the reason) lets the Conversation's groups or ids differ, recorded as its Accepted Difference, while each line must still compile as the Editor's under its Kept id; and renumber, with accept, pairs the lines of a Screenplay the author renumbered at the Source with the Conversation's in order (one for one, same speakers), keeps their Sounds under the new ids, accepts the strings the new ids collide with, and makes the mod package's Kept references follow (convline values in Triggers and Galaxy, line ids in cutscenes), listing each file. Otherwise nothing in the package changes: compile_mod then writes the Conversation and its strings over their Kept originals under the Equivalence Check. Given a Kept-terrain Mission instead of a mod (and no conversation, ref, source or renumber), it converts the Map Package's own conversation, the one the Blueprint's screenplay.script.conversationId names, to the Mission's Screenplay, pulled from the Source: it records in screenplay.script.conversion what each line keeps (a line whose words are unchanged keeps its imported Sound and recording; a changed or added line gets the naming template's Sound and a placeholder voice; a dropped line is left out), and lists every difference: changed, added and dropped lines, speaker changes, the Kept cutscene elements the compile relinks, the Sounds (with their recordings) and strings the first compile removes as nothing plays them (a Sound a Kept trigger names stays, listed apart), and each part the first compile writes other than as the Editor has it, which the Equivalence Check refuses until acceptedDifferences names it. Only on the author's decision, accept (the reason) names each of those as accepted. Nothing in the package changes: compile_map, in place, then writes the conversation over its Kept original. The result is under mission in the structured output.",
      inputSchema: {
        mod: z.string().min(1).optional().describe("The mod's id, as the Workspace config's mods names it (its folder in mods/); give this or mission"),
        mission: MissionSchema.optional().describe("A Kept-terrain Mission whose Map Package's own conversation is converted, its folder name in the Workspace's missions folder; give this or mod"),
        conversation: z.string().min(1).optional().describe("The mod's Kept CConversation id, such as HubConversation-Medic; needed with mod. A Mission's comes from its screenplay.script.conversationId"),
        ref: z.string().min(1).optional().describe("What the Screenplay Source knows its Screenplay by, when the Source can't tell from the conversation"),
        source: z.string().min(1).optional().describe("The Screenplay file in the mod's folder; screenplays/<conversation>.md when not given. Without a Screenplay Source, it must already be there"),
        accept: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The author's reason the Conversation may compile other than as the Editor has it (such as the naming template's Line01001 for the Editor's Line00001), recorded as its Accepted Difference; for a Mission, each difference the first compile meets is named in acceptedDifferences with it. Only on the author's decision",
          ),
        renumber: z.boolean().optional().describe("The author renumbered the Screenplay at its Source on purpose: pair its lines with the Conversation's in order and make the Kept references follow the new ids; needs accept"),
      },
      outputSchema: ConvertScreenplayOutputSchema,
    },
    async ({ mod, mission, ...options }) => {
      if (mod !== undefined && mission === undefined) return convertModScreenplay(mod, options);
      if (mission !== undefined && mod === undefined) return convertMissionConversation(mission, options);
      throw new Error(`Give a mod (with its conversation) or a Kept-terrain mission to convert${mod === undefined ? "" : ", not both"}`);
    },
  );

  type ConvertScreenplayOptions = { conversation?: string | undefined; ref?: string | undefined; source?: string | undefined; accept?: string | undefined; renumber?: boolean | undefined };

  async function convertModScreenplay(mod: string, { conversation, ref, source, accept, renumber }: ConvertScreenplayOptions) {
    if (conversation === undefined) throw new Error("Give the mod's Kept CConversation id to convert (conversation)");
    const workspace = await ctx.workspace();
    const { blueprintPath } = await readWorkspaceMod(workspace, mod);
    const converted = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () =>
      convertScreenplay(blueprintPath, { conversation, workspace, ...(ref ? { ref } : {}), ...(source ? { source } : {}), ...(accept ? { accept } : {}), ...(renumber ? { renumber } : {}) }),
    );
    return ctx.reply(`${formatConvertedScreenplay(conversation, converted)}\nCompile the mod (compile_mod) to write it over its Kept original, under the Equivalence Check.`, plain(converted));
  }

  async function convertMissionConversation(mission: string, { conversation, ref, source, accept, renumber }: ConvertScreenplayOptions) {
    if (conversation || ref || source || renumber) throw new Error("A Mission's conversation is the one its screenplay.script.conversationId names, converted to that Screenplay, so it takes only accept");
    const workspace = await ctx.workspace();
    const blueprintPath = await missionBlueprintPath(workspace, mission);
    const mapPackage = await missionMapPackage(blueprintPath);
    // It writes the Blueprint and reads the package: one at a time with the compile and with Blueprint edits.
    const converted = await readingMapToEdit(mapPackage, blueprintPath, () => convertMissionScreenplay(blueprintPath, { workspace, mapPackage, ...(accept ? { accept } : {}) }));
    return ctx.reply(`${formatConvertedMissionScreenplay(converted, { acceptHint: "accept" })}\n${missionConversionNextStep(converted, "compile_map")}`, { mission: plain(converted) });
  }

  tool(
    "propose_removals",
    {
      title: "Propose removals for a mod's Kept leftovers",
      annotations: READ_ONLY,
      description:
        "Lists the Kept leftovers of a Workspace mod that look safe to drop as Accepted Removals (ADR-0011), each with a reason, read from its package as the last compile left it: a ConversationStrings Conversation/… key that no GameData file names (a line or group the conversation no longer has), a strings file's line an old version-control merge conflict left (<<<<<<< .mine, =======, >>>>>>> …), and an empty GameData Assets.txt (an asset-key table that overrides nothing). Compiled items and those the Blueprint already removes are left out. Nothing is applied: show the author each one and add only those they confirm to the Mod Blueprint's removals, as { item, reason }, then compile_mod.",
      inputSchema: { mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)") },
      outputSchema: { mod: z.string(), proposals: z.array(z.object({ item: z.string(), reason: z.string(), text: z.string().optional() })) },
    },
    async ({ mod }) => {
      const workspace = await ctx.workspace();
      const proposed = await proposeRemovals((await readWorkspaceMod(workspace, mod)).blueprintPath);
      return ctx.reply(formatProposedRemovals(proposed), { mod: proposed.mod, proposals: proposed.proposals.map((proposal) => ({ ...proposal })) });
    },
  );

  tool(
    "kept_report",
    {
      title: "Kept report of a mod",
      annotations: READ_ONLY,
      description:
        "Lists the Kept Content left in a Workspace mod (ADR-0011), by component (GameData, Strings, Triggers, Scripts, Cutscenes, UI, Package files, Files) and item, with a count: what its Mod Blueprint doesn't own yet, the to-do list of its conversion. An item is named as the compile record would list it once converted (catalog-entry:<file>:<Class>:<id>, string:<file>:<key>, trigger:<id>, variable:<id>, function:<id>, <LibraryItemType>:<id>, file:<path>). The Editor-only files left to the Editor (its EditorCategories.xml and EditorCatalogStringsSC2.txt files), which no compile writes, stay Kept for good and are listed apart, out of the count.",
      inputSchema: {
        mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)"),
        items: z.boolean().optional().describe("List every item in the text as well as the counts (the structured result always has them)"),
      },
      outputSchema: {
        mod: z.string(),
        total: z.number(),
        components: z.array(z.object({ component: z.enum(KEPT_COMPONENTS), count: z.number(), items: z.array(z.object({ item: z.string(), file: z.string(), label: z.string().optional() })) })),
        notConvertibleYet: z.object({ count: z.number(), items: z.array(z.object({ item: z.string(), file: z.string(), label: z.string().optional() })) }),
        leftToEditor: z.object({ count: z.number(), items: z.array(z.object({ item: z.string(), file: z.string() })) }),
      },
    },
    async ({ mod, items }) => {
      const workspace = await ctx.workspace();
      const report = await keptReport((await readWorkspaceMod(workspace, mod)).blueprintPath);
      return ctx.reply(formatKeptReport(report, { items: items ?? false }), {
          mod: report.mod,
          total: report.total,
          components: report.components.map((component) => ({ ...component, items: component.items.map((item) => ({ ...item })) })),
          notConvertibleYet: { count: report.notConvertibleYet.count, items: report.notConvertibleYet.items.map((item) => ({ ...item })) },
          leftToEditor: { count: report.leftToEditor.count, items: report.leftToEditor.items.map(({ item, file }) => ({ item, file })) },
        });
    },
  );

  tool(
    "compile_melee_map",
    {
      title: "Compile a melee map",
      annotations: DESTRUCTIVE,
      description:
        "Compiles a Melee Map Blueprint (a 1v1 ladder-style map: zones, ramps, resource bases and a start base per spawn, with no Beats or Screenplay) into a Map Package the Galaxy Editor calls Melee: User players with any race and a random start, every resource base the standard ladder base, each main's ramp the diagonal ladder ramp with an unbuildable plate at its foot, a StartLoc at each start base, the stock Melee Initialization trigger and Void (Mod) as the only dependency. A melee map needs no Mission: the blueprint can be in any folder. A broken melee rule (the Editor's melee checklist, a non-standard start base, a missing symmetry partner, a main's second ground entrance, no standard main ramp, a feature TLMC forbids) fails the call, naming the rule and the object, and writes nothing. Returns where it wrote the package, any warnings from drawing it, and the distance report: worker seconds ramp to ramp, main to main, natural to natural, main to natural and to the thirds, rocks up and down, and air against ground, with a warning for each number outside the Standard bands.",
      inputSchema: {
        blueprint: z.string().min(1).describe("The Melee Map Blueprint's JSON file: an absolute path, or relative to the Workspace root"),
        outputDir: z
          .string()
          .min(1)
          .optional()
          .describe("Where to write the Map Package: an absolute path, or relative to the Workspace root. By default <blueprint folder>/output/<blueprint id>.SC2Map, a folder git ignores"),
      },
      outputSchema: {
        outputDir: z.string(),
        warnings: z.array(z.string()),
        report: z.object({
          distances: z.record(z.string(), z.unknown()),
          bases: z.number(),
          goldBases: z.number(),
          richGasBases: z.number(),
          warnings: z.array(z.object({ rule: z.string(), object: z.string(), message: z.string() })),
        }),
      },
    },
    async ({ blueprint: blueprintFile, outputDir }) => {
      const root = await ctx.root();
      const blueprintPath = path.resolve(root, blueprintFile);
      const blueprint = await readMeleeMapBlueprint(blueprintPath);
      const target = outputDir ? path.resolve(root, outputDir) : await defaultOutputDir(blueprintPath, blueprint.id);
      const { warnings, report } = await oneAtATime(await realPathOf(target), () => writeMeleeMap(blueprint, target));
      const lines = [`Compiled the melee map ${blueprint.title} to ${target}`, ...warnings.map((warning) => `Warning: ${warning}`), "", formatMeleeReport(report)];
      return ctx.reply(lines.join("\n"), { outputDir: target, warnings, report: { ...report, distances: { ...report.distances } } });
    },
  );

  tool(
    "test_mission",
    {
      title: "Test a Mission in the game",
      annotations: DESTRUCTIVE,
      description:
        "Compiles a Mission in place, into its committed Map Package (as compile_map does by default), runs the Blueprint's declared route tests (tests.routes) on the generated terrain without the game and reports each as passed or failed, then plays it in the game through the Editor's Test Document. The route tests are static: nothing is read back from the running game yet. When the machine's Host Adapter can't run Test Document, it returns step-by-step instructions for the author instead. Ask the author to close the Mission in the Editor first: rewriting a map the Editor has open can crash it, and the Editor keeps testing the copy it loaded.",
      inputSchema: { mission: MissionSchema, ...DECISION_INPUTS },
      outputSchema: {
        mapPath: z.string(),
        /** What the Host Adapter did. */
        automated: z.array(z.string()),
        /** What is left for the author, in order; empty when the Host Adapter did it all. */
        steps: z.array(z.string()),
        /** The Blueprint's declared route tests, walked on the generated terrain; empty when it declares none. */
        routeTests: z.array(z.object({ id: z.string(), passed: z.boolean(), message: z.string() })),
      },
    },
    async ({ mission, ...choices }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPath = await missionMapPackage(blueprintPath);
      // Checked before the compile, which would rewrite the map under the Editor.
      const open = await editorHasOpen(ctx.host, mapPath, "test_mission", "Not compiled");
      if (open) return ctx.fail(open.text, { mapPath, automated: [], steps: open.steps });
      const started = Date.now();
      const { blueprint, warnings, placeholders } = await oneAtATime(await realPathOf(mapPath), () => compileMission(workspace, blueprintPath, mapPath, { host: ctx.host, decisions: editorDecisions(choices) }));
      // What is left of the request's time after the compile and its voice lines, for the Editor and the game.
      const seconds = Math.max(TEST_MIN_SECONDS, TEST_BUDGET_SECONDS - Math.ceil((Date.now() - started) / 1000));
      const handoff = await testInGame(ctx.host, mapPath, seconds);
      const voices = describePlaceholders(placeholders);
      const declared = blueprint.tests?.routes.length ?? 0;
      const kept = declared > 0 && hasKeptTerrain(blueprint);
      const routeTests = declared > 0 && !kept ? routeTestResults(buildLayoutModel(blueprint)) : [];
      const lines = [
        `Compiled ${blueprint.title} to ${mapPath}`,
        ...warnings.map((warning) => `Warning: ${warning}`),
        ...(voices ? [voices] : []),
        ...(kept ? ["Route tests not run: the Mission has Kept terrain, which they don't read yet."] : []),
        ...(routeTests.length > 0
          ? [`Route tests (static, from the terrain; not read back from the game): ${routeTests.filter((test) => test.passed).length} of ${routeTests.length} passed`, ...routeTests.map((test) => `  ${test.passed ? "pass" : "FAIL"} ${test.message}`)]
          : []),
        ...describeHandoff(handoff),
        await stageHint(blueprintPath),
      ];
      return ctx.reply(lines.join("\n"), { mapPath, automated: handoff.automated, steps: handoff.steps, routeTests });
    },
  );
}
