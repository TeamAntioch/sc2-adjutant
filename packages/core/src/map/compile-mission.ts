// Compiles a Mission Blueprint into a Map Package with everything it declares: what the
// `compile-map` CLI and the MCP server's `compile_map` tool both run.

import path from "node:path";

import { castModels, compileCinematics, formatCinematicProblem, loadCinematics } from "../cutscene/cinematic.js";
import { missionCinematicDependencyProblems } from "../cutscene/cinematic-dependencies.js";
import { missionFeedChannelProblems } from "../cutscene/feed-channels.js";
import { compileTriggerScenes } from "../cutscene/trigger-scene.js";
import type { CompileRecord } from "../domain/compile-record.js";
import { hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { type Derive, machineDerive } from "../host/derive.js";
import { bareHost, type Host } from "../host/host.js";
import { type PlaceholderVoices, writePlaceholderVoices } from "../host/placeholder-voices.js";
import { hostGameModels, missionDoodadFiles } from "../mods/custom-doodads.js";
import { campaignMod, mapModPackages, MOD_PACKAGE_EXTENSION } from "../mods/workspace-mods.js";
import { DEFAULT_DEPENDENCIES } from "./write-document-info-xml.js";
import { missionCatalogFor } from "./mission-catalog.js";
import { parseMissionBlueprint, validateMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { syncPreview } from "../sync/sync-mission.js";
import { readMissionScript, scriptLines } from "../script/name-script.js";
import type { VoicedScript } from "../cutscene/cinematic.js";
import { keptVoiceFile, playedSound, voicedHere, voicedScript } from "./mission-conversation.js";
import { isInside } from "../util/inside.js";
import { compileRecordPath, missionMapPackage, prepareMissionCopy, readCompileRecordAt, saveCompileRecordAt } from "./mission-package.js";
import { type EditorDecisions, EditorChangesError, formatEditorChanges } from "./editor-changes.js";
import { workspaceLibrary } from "../mods/library.js";
import { librariesInReach, refusedLibrary } from "../mods/library-reach.js";
import type { GameLibrary } from "../mods/library-galaxy.js";
import type { CampaignLibrary } from "../plugins/plugin-api.js";
import type { UiComponent } from "../ui/ui-component.js";
import { writeMapPackage, type WriteMapPackageOptions } from "./write-map-package.js";
import { declaresContent, missionFileFinder, readMissionDeclared } from "./mission-declared.js";
import { hasAuthoredTriggers, readAuthoredTriggers } from "../triggers/blueprint-triggers.js";

export type CompileMissionOptions = {
  /** Where the voice files are, instead of the screenplay's `audioDir`; the golden test writes its own. */
  readonly audioDir?: string;
  /** Timestamp recorded in each component's .version file; defaults to now. */
  readonly savedAt?: Date;
  /** The machine, whose Host Adapter speaks missing voice lines; without one they get silence. */
  readonly host?: Host;
  /** What the author decided for Compiled Content the Editor changed: kept or discarded (compile-map --keep, --discard). */
  readonly decisions?: EditorDecisions;
  /** Encodes a .wav voice file or placeholder to Ogg Vorbis; the machine's ffmpeg, cached by content, by default. */
  readonly derive?: Derive;
  /** The UI Components the Mission's uiActions and its Campaign Mod's `ui` come from; core's when not given. */
  readonly uiComponents?: readonly UiComponent[];
  /**
   * Compile into a copy of the Mission's committed Map Package at `outputDir`, merged by a copy of
   * its compile record as an in-place compile is, so Kept Content stays; the committed package and
   * record are left alone (prepareMissionCopy).
   */
  readonly copy?: boolean;
};

export type CompiledMission = {
  readonly blueprint: MissionBlueprint;
  /** The Map Package it wrote. */
  readonly outputDir: string;
  readonly warnings: readonly string[];
  /** The placeholder voice lines written for lines that had no voice file, when the Mission has a Screenplay script. */
  readonly placeholders?: PlaceholderVoices;
};

/**
 * Compiles into `outputDir`, or by default into the Mission's committed Map Package
 * (missionMapPackage). The Mission's own package is merged by its compile record (ADR-0010), which
 * the compile then rewrites; any other folder is written whole and leaves the record alone. With
 * `copy`, `outputDir` gets a fresh copy of the committed package and its record, merged as the
 * package is in place, and the copy's own record, beside it, is rewritten instead.
 */
export async function compileMission(workspace: Workspace, blueprintPath: string, outputDir: string | undefined, options: CompileMissionOptions = {}): Promise<CompiledMission> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const inPlace = await missionMapPackage(blueprintPath);
  if (options.copy && outputDir === undefined) throw new Error(`A compile into a copy of ${blueprint.id}'s Map Package needs the folder to copy it to`);
  const copy = options.copy && outputDir !== undefined ? await prepareMissionCopy(blueprintPath, blueprint.id, outputDir) : undefined;
  const target = outputDir ?? inPlace;
  const recorded = copy !== undefined || path.resolve(target) === path.resolve(inPlace);
  const recordFile = copy?.record ?? compileRecordPath(blueprintPath);
  const previousRecord = recorded ? await readCompileRecordAt(recordFile) : undefined;
  const reference = blueprint.screenplay.script;
  // The Screenplay is read from inside the Workspace only, as a pull writes it.
  if (reference && !(await isInside(workspace.root, path.resolve(path.dirname(blueprintPath), reference.source)))) {
    throw new Error(`${blueprintPath}'s screenplay.script.source ${reference.source} is outside the Workspace ${workspace.root}`);
  }
  // Named with the Workspace's Campaign Pack, which also gives each speaker's placeholder voice.
  // Beside Kept terrain the package keeps its own conversation, so the Screenplay's script plays no
  // line (writeMapPackage), unless that conversation has been converted to it (convert-screenplay).
  const keptTerrain = hasKeptTerrain(blueprint);
  const conversion = keptTerrain ? reference?.conversion : undefined;
  const found = keptTerrain && !conversion ? undefined : await readMissionScript(blueprint, blueprintPath, workspace);
  // The Blueprint's voice folder is written into, so it must be inside the Workspace; a caller's own (the golden test's) is its business.
  if (found && !options.audioDir && !(await isInside(workspace.root, found.audioDir))) {
    throw new Error(`${blueprintPath}'s screenplay.script.audioDir ${blueprint.screenplay.script!.audioDir} is outside the Workspace ${workspace.root}`);
  }
  const script = found && options.audioDir ? { ...found, audioDir: options.audioDir } : found;
  // Every line gets a voice file at its final path, so a Mission compiles before any are recorded;
  // a converted conversation's imported line plays its Kept recording, so it needs none.
  const host = options.host ?? bareHost();
  const derive = options.derive ?? machineDerive(host.machine);
  const placeholders = script ? await writePlaceholderVoices(host, conversion ? voicedScript(script.script, conversion) : script.script, script.audioDir, "missing", { format: script.voiceFormat, derive }) : undefined;
  // A converted conversation's imported lines are timed by their Kept recordings, and play their imported Sounds.
  const pkg = conversion ? target : undefined;
  const voiced: VoicedScript | undefined =
    script && conversion && pkg
      ? {
          ...script,
          voiceFile: (soundId) => {
            const line = scriptLines(script.script).find((candidate) => candidate.soundId === soundId);
            const kept = line && !voicedHere(conversion, line) ? keptVoiceFile(pkg, playedSound(conversion, line)) : undefined;
            return kept ? path.join(pkg, ...kept.file.split("/")) : undefined;
          },
          soundOf: (line) => playedSound(conversion, line),
        }
      : script;

  // Each Cinematic is checked and timed from the voice files just written.
  const cutscenes = await compileCinematics(workspace.root, blueprint, blueprintPath, voiced);
  // And what they film against what the map's dependencies load: a Set or cast of a package it doesn't load isn't there in the game.
  // And each feed against the screens on its shot's Set: a feed no screen shows shows nowhere.
  const filmedCinematics = (await loadCinematics(workspace.root, blueprint, blueprintPath)).loaded;
  const unloaded = [...(await missionCinematicDependencyProblems(workspace, blueprint, filmedCinematics)), ...(await missionFeedChannelProblems(filmedCinematics))];
  // And each trigger scene, against the Blueprint's camera Anchors, its moves timed the same way.
  const triggerScenes = await compileTriggerScenes(blueprint, blueprintPath, voiced);
  // The Blueprint's own doodads' files, from its folder, checked before anything is written (custom-doodads.ts).
  const compiledFiles = new Set((previousRecord?.entries ?? []).flatMap((entry) => (entry.kind === "file" ? [entry.path.toLowerCase()] : [])));
  const dependencies = blueprint.dependencies ?? DEFAULT_DEPENDENCIES;
  // The Workspace mods the map loads: a doodad's file is found in them, and the Campaign Mod's doodads need it among them.
  const modPackages = await mapModPackages(workspace, dependencies);
  // A gameModel's swaps read the game's .m3 through the Host Adapter.
  const doodads = blueprint.doodads.length > 0 ? await missionDoodadFiles(blueprint.doodads, path.dirname(blueprintPath), workspace, modPackages, target, compiledFiles, hostGameModels(host)) : undefined;
  const top = await campaignMod(workspace);
  const topDependency = top ? `file:Mods\\${top.name}${MOD_PACKAGE_EXTENSION}` : undefined;
  const unloadedModDoodads = top && topDependency && !modPackages.includes(top.modPackage) ? { dependency: topDependency, types: new Set(workspace.catalog.doodads.keys()) } : undefined;
  const library = await workspaceLibrary(workspace, options.uiComponents);
  const libraries = await missionLibraries(workspace, dependencies, library);
  // The Blueprint's own trigger elements, each from its file in the Mission's triggers folder (ADR-0026).
  const authoredTriggers = await readAuthoredTriggers(blueprint, blueprintPath);
  // Its Declared Content (catalog entries, strings, files, Set cutscenes …), read and checked as a mod's is (mission-declared.ts).
  const declared =
    declaresContent(blueprint) || blueprint.doodads.some((doodad) => doodad.name !== undefined)
      ? await readMissionDeclared(blueprint, blueprintPath, {
          mapPackage: target,
          assetFiles: async () => missionFileFinder(workspace, modPackages, target, blueprint.files.map(({ path: file }) => file)),
          models: () => castModels(workspace.catalog),
        })
      : undefined;
  // A Set cutscene is one of the map's Cutscenes, beside the Cinematics: one name, one writer.
  const cinematicNames = new Map(Object.keys(cutscenes).map((id) => [id.toLowerCase(), id]));
  for (const { index, name } of declared?.setCutscenes ?? []) {
    const other = cinematicNames.get(name.toLowerCase());
    if (other !== undefined) throw new Error(`setCutscenes.${index} writes the cutscene ${name}, which the Cinematic ${other} writes too: a cutscene is a Cinematic or a Set cutscene`);
  }
  const packageOptions: WriteMapPackageOptions = {
    blueprint,
    outputDir: target,
    ...(previousRecord ? { previousRecord } : {}),
    ...(recorded ? { saveRecord: (record: CompileRecord) => saveCompileRecordAt(recordFile, record) } : {}),
    includeObjects: true,
    includeRegions: true,
    includeTriggers: true,
    ...(script ? { script } : {}),
    derive,
    library,
    libraries,
    cutscenes: Object.fromEntries([...Object.entries(cutscenes).map(([id, { xml }]) => [id, xml] as const), ...(declared?.setCutscenes ?? []).map(({ name, xml }) => [name, xml] as const)]),
    // The Lights the Cinematics and the trigger scenes switch to, so a Plugin's among them is written too.
    cinematicLights: [...Object.values(cutscenes).flatMap(({ lights }) => lights), ...triggerScenes.flatMap(({ triggerScene }) => (triggerScene.light ? [triggerScene.light] : []))],
    ...(triggerScenes.length ? { triggerScenes } : {}),
    ...(hasAuthoredTriggers(authoredTriggers) ? { authoredTriggers } : {}),
    ...(options.savedAt ? { savedAt: options.savedAt } : {}),
    ...(options.decisions ? { decisions: options.decisions } : {}),
    ...(doodads ? { doodadFiles: doodads.files, doodadSwaps: doodads.swaps } : {}),
    ...(unloadedModDoodads ? { unloadedModDoodads } : {}),
    ...(declared ? { declared } : {}),
  };
  const written = await writeMapPackage(packageOptions).catch(async (error: unknown) => {
    if (!(error instanceof EditorChangesError) || !recorded) throw error;
    throw new EditorChangesError(error.changes, formatEditorChanges(error.changes, await syncable(workspace, blueprintPath, target, packageOptions, error), blueprint));
  });
  const warnings = [
    ...(doodads?.warnings ?? []),
    ...written.warnings,
    ...unloaded.map(formatCinematicProblem),
    ...(placeholders?.failed ?? []).map(({ soundId, reason }) => `The Host Adapter couldn't speak ${soundId}, so it got a silent placeholder: ${reason}`),
    ...(reference && keptTerrain && !conversion
      ? [
          `screenplay.script isn't compiled: a Blueprint with ${blueprint.zones.length === 0 ? "no Zones" : "Kept terrain"} keeps its Map Package's own conversation${reference.conversationId ? ` ${reference.conversationId}` : ""}, so only inline screenplay.scenes play from Compiled triggers. ${reference.conversationId ? "Convert it to the Screenplay with convert-screenplay" : "Name it in screenplay.script.conversationId and convert it with convert-screenplay"} to compile the Screenplay over it`,
        ]
      : []),
    ...(reference?.act !== undefined ? [`screenplay.script.act is deprecated and read as ref; rename it ref in ${blueprintPath}`] : []),
  ];
  return { blueprint, outputDir: target, warnings, ...(placeholders ? { placeholders } : {}) };
}

/**
 * The libraries in reach of a map with these dependencies, the game's and its Workspace mods', which
 * its triggers' calls are written from, as the Kept renderer's are (ADR-0025). A call into the
 * Campaign Mod's library from a map that doesn't load the mod is refused, saying to add it.
 */
export async function missionLibraries(workspace: Workspace, dependencies: readonly string[], library?: CampaignLibrary): Promise<Record<string, GameLibrary>> {
  const top = await campaignMod(workspace);
  const libraries = { ...(await librariesInReach(workspace, dependencies)) };
  const id = (library ?? (await workspaceLibrary(workspace))).id;
  if (top && id !== undefined && !(id in libraries)) {
    libraries[id] = refusedLibrary(`the map doesn't load the Campaign Mod ${top.name}, whose library ${id} is: add file:Mods\\${top.name}${MOD_PACKAGE_EXTENSION} to the Blueprint's dependencies`);
  }
  return libraries;
}

/** A sentence on the placeholder voice lines a compile wrote, or undefined when it wrote none. */
export function describePlaceholders(placeholders: PlaceholderVoices | undefined): string | undefined {
  if (!placeholders) return undefined;
  const parts = [
    ...(placeholders.spoken.length ? [`${placeholders.spoken.length} spoken`] : []),
    ...(placeholders.silent.length ? [`${placeholders.silent.length} silent`] : []),
  ];
  return parts.length ? `Wrote ${parts.join(" and ")} placeholder voice line(s) in ${placeholders.audioDir}` : undefined;
}

/**
 * Which of the Editor's changes sync brings back: those the compile wouldn't overwrite once sync has
 * brought the Editor's objects, regions and hidden cells into the Blueprint. Found by syncing in memory and
 * comparing again, writing nothing.
 */
async function syncable(workspace: Workspace, blueprintPath: string, mapPath: string, options: WriteMapPackageOptions, stopped: EditorChangesError): Promise<string[]> {
  const preview = await syncPreview(workspace, blueprintPath, mapPath).catch(() => undefined);
  if (!preview) return [];
  const synced = validateMissionBlueprint(workspace, preview.blueprint, await missionCatalogFor(workspace.catalog, blueprintPath));
  if (!synced.success) return [];
  // Sync takes the Editor's pathing layer onto the record once it has the strokes.
  const left = await writeMapPackage({ ...options, blueprint: synced.blueprint, ...(preview.record ? { previousRecord: preview.record } : {}), dryRun: true }).then(
    (): string[] => [],
    (error: unknown) => (error instanceof EditorChangesError ? error.changes.map((change) => change.name) : undefined),
  );
  if (left === undefined) return [];
  return stopped.changes.map((change) => change.name).filter((name) => !left.includes(name));
}
