// Checks a whole Workspace: loads it (its config and every Plugin it names), then validates every
// Mission's Blueprint against core and those Plugins, finds its Kept References in its Map Package,
// checks each Connection from a generating Zone into Kept ground crosses at the Kept cliff level,
// warns when its Kept ground has cliffs and no static shadow bake,
// checks what the game reads to open its package and each mod's (DocumentHeader's dependencies, MapInfo's integrity hash),
// warns about each frame path a mod's Galaxy passes that no layout has (src/ui/frame-path-check.ts),
// and reads and names its Screenplay as a compile would, then checks each of its mods. Problems are collected, not thrown, each with its Mission and where it is, so one
// run reports them all. The `check-workspace` CLI and the `check_workspace` MCP tool share it.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { type Catalog, layerSource, type ModelAnimsLayer } from "../catalog/catalog-layer.js";
import { bundledModelAnims, catalogModelAnims, MODEL_ANIMS_FILE } from "../catalog/model-anims.js";
import { isKnownEffect } from "../catalog/tech-catalog.js";
import { MOD_DOODAD_INDEX_FILE, type ModDoodadIndexGaps, modDoodadIndexGaps } from "../catalog/mod-doodad-index.js";
import { MODEL_GUIDE_FILE, modelGuideProblems } from "../catalog/model-guides.js";
import { bundledModelFootprints, type ModelFootprints } from "../catalog/model-footprints.js";
import { missionCinematicDependencyProblems } from "../cutscene/cinematic-dependencies.js";
import { missionFeedChannelProblems } from "../cutscene/feed-channels.js";
import { castModels, cinematicLightWarnings, cinematicProblems, isCinematicError, type LoadedCinematic, loadCinematics, sceneLines, setFilePath, type Severity, voiceLengthsMs } from "../cutscene/cinematic.js";
import { cinematicChecks } from "../cutscene/cinematic-checks.js";
import { workspaceFilesOf } from "../domain/asset-source.js";
import { setPieceChecks } from "../cutscene/set-checks.js";
import { EMPTY_COMPILE_RECORD } from "../domain/compile-record.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { documentHeaderProblems, keptContentProblems, localDependencies, mapInfoHashProblems } from "../map/kept-checks.js";
import { blueprintCues, generatingZones, hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { ownSounds } from "../map/mission-conversation.js";
import { seamProblems } from "../kept-terrain/generating-zones.js";
import { readKeptGround } from "../kept-terrain/kept-ground.js";
import { shadowBakeWarning } from "../kept-terrain/shadow-bake.js";
import { type ReferencedBlueprintTrigger, keptReferenceProblems } from "../map/kept-references.js";
import { missionMapPackage, readCompileRecord } from "../map/mission-package.js";
import { hiddenCellProblems } from "../map/hidden-cell-checks.js";
import { missionCatalog, withMissionModelAnims } from "../map/mission-catalog.js";
import { absentProblem, workspaceFileProblem } from "../mods/asset-sources.js";
import { buildMechanicGameData, uiCall } from "../triggers/build-mission-triggers.js";
import { modFile, type ModScript, modScriptProblems, nameModScreenplay } from "../mods/conversations.js";
import { loadTriggerScenes, timedTriggerScene, triggerSceneMusicChecks, triggerSceneProblems, triggerSceneTimingProblems } from "../cutscene/trigger-scene.js";
import { triggerSceneChecks } from "../cutscene/trigger-scene-checks.js";
import { readAuthoredTriggers } from "../triggers/blueprint-triggers.js";
import { modLineLengths, playedCutscenes, readModCinematics, readModSetCutscenes } from "../mods/mod-cinematics.js";
import { dependedAssetMods } from "../mods/sound-sets.js";
import { campaignModPackages, MOD_PACKAGE_EXTENSION, ModBlueprintError, modDir, readModBlueprint, readWorkspaceModWithBlueprint, sameModName, type WorkspaceMod } from "../mods/workspace-mods.js";
import { readMissionScript } from "../script/name-script.js";
import { sceneLineProblems, scenePartProblems } from "../script/scene-parts.js";
import { isInside } from "../util/inside.js";
import { bankFixtureProblem } from "../capture/bank-fixtures.js";
import { workspaceLibrary } from "../mods/library.js";
import { modUi, uiComponentsOn, type UiComponentOn } from "../ui/components.js";
import { componentUi, modFrameWarnings } from "../ui/frame-path-check.js";
import { UI_COMPONENTS } from "../ui/core-components.js";
import type { UiComponent } from "../ui/ui-component.js";
import { KNOWN_ERRORS_FILE, readKnownErrors } from "../host/known-errors.js";
import type { CampaignLibrary } from "./plugin-api.js";
import { BLUEPRINT_FILE, campaignModName, loadWorkspace, missionIds, readRawBlueprint, validateMissionBlueprint, WORKSPACE_FILE, type Workspace } from "./workspace.js";

/** One problem found in a Workspace. */
export type WorkspaceProblem = {
  /** The Mission's folder name; absent for a problem with a mod or the Workspace itself. */
  readonly mission?: string;
  /** The mod's id, for a problem with one of the Workspace's mods. */
  readonly mod?: string;
  /** The file it is in, relative to the Workspace root. */
  readonly file: string;
  /** Where in a Blueprint (a dotted path, such as `mechanics.0.params`), or in a package file (`line 12`), when known. */
  readonly path?: string;
  readonly message: string;
  /**
   * An error when absent. A warning, a review item (a Cinematic past a cinematography norm) or a
   * note (something worth doing, such as a Model Guide for a cast model) is reported but doesn't
   * fail the check.
   */
  readonly severity?: Severity;
};

/** Whether a problem fails the check: every one but a warning, a review item or a note. */
export const isError = (problem: WorkspaceProblem): boolean => isCinematicError(problem);

export type WorkspaceCheck = {
  /** Absolute. */
  readonly root: string;
  /** The Missions found, by folder name. */
  readonly missions: readonly string[];
  /** The mods the Workspace config names, by id. */
  readonly mods?: readonly string[];
  readonly problems: readonly WorkspaceProblem[];
};

export type CheckWorkspaceOptions = {
  /** The model footprints a Set's pieces are checked against; core's data/model-footprints.json when left out. */
  readonly modelFootprints?: ModelFootprints;
  /**
   * The StarCraft II folder, where a Mission's local dependencies (`file:Mods\\…`) are found for the
   * checks over Kept Content; the machine config's `sc2Path` when left out.
   */
  readonly sc2Path?: string;
  /** The UI Components the Missions' uiActions and the Campaign Mod's `ui` come from; core's when left out. */
  readonly uiComponents?: readonly UiComponent[];
};

/** A known-errors list's problems: the file that doesn't read or fit its format, and a pattern whose reason is still the placeholder a tool proposed. */
async function knownErrorsProblems(absolute: string, file: string, mission?: string): Promise<WorkspaceProblem[]> {
  try {
    const patterns = await readKnownErrors(absolute, file);
    return patterns.flatMap((pattern, index) => (/^TODO/i.test(pattern.reason.trim()) ? [{ ...(mission ? { mission } : {}), file, path: `patterns.${index}.reason`, message: `the pattern "${pattern.match}" still has a placeholder for its reason: say why it's known`, severity: "warning" as const }] : []));
  } catch (error) {
    return [{ ...(mission ? { mission } : {}), file, message: messageOf(error) }];
  }
}

/** Why a Mission's UI action can't be called as its compile would call it, or undefined when it can. */
function uiActionProblem(library: CampaignLibrary, blueprint: MissionBlueprint, action: string, params: unknown): string | undefined {
  try {
    uiCall(library, blueprint, action, params);
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}

/** Checks the Workspace at `root`, as above. */
export async function checkWorkspace(root: string, options: CheckWorkspaceOptions = {}): Promise<WorkspaceCheck> {
  const absolute = path.resolve(root);
  const relative = (file: string) => path.relative(absolute, file).split(path.sep).join("/") || ".";
  let workspace: Workspace;
  try {
    workspace = await loadWorkspace(absolute);
  } catch (error) {
    return { root: absolute, missions: [], problems: [{ file: WORKSPACE_FILE, message: messageOf(error) }] };
  }
  const sc2Path = "sc2Path" in options ? options.sc2Path : await loadMachineConfig().then((machine) => machine.sc2Path, () => undefined);
  let missions: string[];
  try {
    missions = await missionIds(workspace);
  } catch (error) {
    return { root: absolute, missions: [], problems: [{ file: relative(workspace.missionsDir), message: messageOf(error) }, ...(await modProblems(workspace, relative, sc2Path, options.modelFootprints, options.uiComponents ?? UI_COMPONENTS))] };
  }

  const problems: WorkspaceProblem[] = [...(await knownErrorsProblems(path.join(absolute, KNOWN_ERRORS_FILE), KNOWN_ERRORS_FILE))];
  const footprints = options.modelFootprints ?? (await bundledModelFootprints());
  const uiComponents = options.uiComponents ?? UI_COMPONENTS;
  /** The Campaign Mod's library, read once a Mission has a UI action to check. */
  let campaignLibrary: Promise<CampaignLibrary> | undefined;
  const setsChecked = new Set<string>();
  for (const mission of missions) {
    const blueprintPath = path.join(workspace.missionsDir, mission, BLUEPRINT_FILE);
    const file = relative(blueprintPath);
    let raw: Record<string, unknown>;
    try {
      raw = await readRawBlueprint(blueprintPath);
    } catch (error) {
      problems.push({ mission, file, message: messageOf(error) });
      continue;
    }
    problems.push(...(await knownErrorsProblems(path.join(path.dirname(blueprintPath), KNOWN_ERRORS_FILE), relative(path.join(path.dirname(blueprintPath), KNOWN_ERRORS_FILE)), mission)));
    // The Mission's own Map Package; a folder holding two is a problem, and the rest of the Mission is still checked.
    let mapDir: string | undefined;
    try {
      mapDir = await missionMapPackage(blueprintPath);
    } catch (error) {
      problems.push({ mission, file: relative(path.dirname(blueprintPath)), message: messageOf(error) });
    }
    // What the game reads to open its package: DocumentHeader's dependencies against DocumentInfo's, and MapInfo's integrity hash, each on its own so one that throws doesn't hide the other.
    if (mapDir && existsSync(mapDir)) {
      const packageDir = mapDir;
      for (const opened of [() => documentHeaderProblems(packageDir, sc2Path), () => mapInfoHashProblems(packageDir)]) {
        try {
          for (const problem of await opened()) problems.push({ mission, file: relative(problem.file), message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
        } catch (error) {
          problems.push({ mission, file: relative(mapDir), message: messageOf(error) });
        }
      }
    }
    // Its compile record, read once: one that doesn't read is reported with the package's Kept Content below.
    const recorded = await readCompileRecord(blueprintPath).then(
      (record) => ({ record }),
      (error: unknown) => ({ error }),
    );
    // Checked against the Mission's catalog, its own package's Kept game data over the Workspace's;
    // the Workspace's alone while which of its data is Kept can't be told.
    const keptCatalog = mapDir && "record" in recorded ? await missionCatalog(workspace.catalog, mapDir, recorded.record) : workspace.catalog;
    const ownCatalog = await withMissionModelAnims(keptCatalog, blueprintPath);
    const own = ownCatalog === workspace.catalog ? workspace : { ...workspace, catalog: ownCatalog };
    // Its own recorded animations hold only its own models, and the root's none of them (ADR-0026);
    // judged only once which of its package's data is Kept can be told.
    const keptKnown = mapDir !== undefined && "record" in recorded;
    const missionOwn = (model: string) => ownCatalog.models.has(model) && !workspace.catalog.models.has(model);
    const missionLayer = ownCatalog.modelAnimsLayers.find((layer) => layer.owner === "mission");
    if (missionLayer) {
      const misplaced = (model: string) =>
        !keptKnown || missionOwn(model) ? undefined : workspace.catalog.models.has(model) ? modModelHome(workspace.catalog, model) : `${model} isn't one of the Mission's own models (its Map Package's Kept CModels): ${GAME_MODEL_HOME}`;
      for (const problem of modelAnimsLayerProblems(missionLayer, misplaced)) problems.push({ mission, ...problem });
    }
    const rootLayer = workspace.catalog.modelAnimsLayers.find((layer) => layer.owner === "workspace" && !layer.error);
    for (const model of keptKnown && rootLayer ? Object.keys(rootLayer.anims) : []) {
      if (missionOwn(model)) problems.push({ mission, file: rootLayer!.file, path: model, message: `${model} is the Mission ${mission}'s own model: record its animations in ${relative(path.join(path.dirname(blueprintPath), MODEL_ANIMS_FILE))}`, severity: "warning" });
    }
    const result = validateMissionBlueprint(own, raw, own.catalog);
    if (!result.success) {
      for (const issue of result.issues) problems.push({ mission, file, path: issue.path, message: issue.message });
      continue;
    }
    // Its own trigger elements' files, each read as the compile reads it (ADR-0026).
    let blueprintTriggers: ReferencedBlueprintTrigger[] | undefined;
    try {
      blueprintTriggers = (await readAuthoredTriggers(result.blueprint, blueprintPath)).triggers.map(({ trigger }) => trigger);
    } catch (error) {
      problems.push({ mission, file, path: "triggers", message: messageOf(error) });
    }
    // Each Kept Reference against the Mission's package, or a trigger reference against its own triggers: gone fails, renamed warns.
    // With its trigger files unreadable, its trigger references aren't checked: the files' problem is reported, not each reference as gone.
    const { kept } = result.blueprint;
    if (kept.length > 0 && mapDir) {
      try {
        for (const problem of await keptReferenceProblems(kept, mapDir, blueprintTriggers)) {
          if (!blueprintTriggers && kept[problem.index]!.kind === "trigger") continue;
          problems.push({ mission, file, path: `kept.${problem.index}`, message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
        }
      } catch (error) {
        problems.push({ mission, file, path: "kept", message: messageOf(error) });
      }
    }
    // Generating Zones beside Kept ground: each Connection across the seam at the Kept cliff level.
    if (generatingZones(result.blueprint).length > 0) {
      try {
        const mapPackage = mapDir ?? (await missionMapPackage(blueprintPath));
        if (existsSync(path.join(mapPackage, "t3HeightMap"))) {
          for (const problem of seamProblems(result.blueprint, await readKeptGround(mapPackage))) problems.push({ mission, file, path: problem.path, message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
        }
      } catch (error) {
        problems.push({ mission, file, path: "zones", message: `The seams beside Kept ground weren't checked: ${messageOf(error)}`, severity: "warning" });
      }
    }
    // Its hidden cells, from the package: something under each hole, and whether units can walk over it (#599).
    if (mapDir && existsSync(mapDir)) {
      try {
        for (const problem of await hiddenCellProblems(result.blueprint, mapDir)) problems.push({ mission, file, path: problem.path, message: problem.message, severity: "warning" });
      } catch (error) {
        problems.push({ mission, file, path: "zones", message: `The hidden cells weren't checked: ${messageOf(error)}`, severity: "warning" });
      }
    }
    // Kept ground with cliffs and no static shadow bake: the author rebakes in the Editor.
    try {
      const bake = await shadowBakeWarning(blueprintPath);
      if (bake) problems.push({ mission, file: relative(bake.file), message: bake.message, severity: "warning" });
    } catch (error) {
      problems.push({ mission, file, message: `The static shadow bake wasn't checked: ${messageOf(error)}`, severity: "warning" });
    }
    // A bank fixture (#55) that names no usable folder: test_mission would refuse to play it.
    if (result.blueprint.bankFixture !== undefined) {
      const problem = await bankFixtureProblem(absolute, blueprintPath, result.blueprint.bankFixture);
      if (problem) problems.push({ mission, file, path: "bankFixture", message: problem });
    }
    const reference = result.blueprint.screenplay.script;
    let script: Awaited<ReturnType<typeof readMissionScript>>;
    if (reference) {
      const source = path.resolve(path.dirname(blueprintPath), reference.source);
      if (!(await isInside(absolute, source))) {
        problems.push({ mission, file, path: "screenplay.script.source", message: `${reference.source} is outside the Workspace` });
      } else {
        try {
          script = await readMissionScript(result.blueprint, blueprintPath, workspace);
        } catch (error) {
          problems.push({ mission, file: relative(source), message: messageOf(error) });
        }
      }
    }
    // The Mission's own package, when it has one: its Kept Content's links, and its craft as warnings.
    if (mapDir && existsSync(mapDir)) {
      try {
        if ("error" in recorded) throw recorded.error;
        const record = recorded.record ?? EMPTY_COMPILE_RECORD;
        const dependencies = await localDependencies(result.blueprint.dependencies ?? [], sc2Path);
        // A local mod the checks can't read: the sounds and cutscene files Kept Content plays aren't judged gone, since it could hold them.
        const unread = "so the sounds and cutscene files Kept Content plays aren't checked, since it could hold them";
        for (const dependency of dependencies.missing) {
          const why =
            sc2Path === undefined
              ? `The dependency ${dependency} can't be found, since the machine config has no sc2Path, ${unread}: set sc2Path to the StarCraft II folder`
              : `The dependency ${dependency} isn't under the StarCraft II folder (${sc2Path}), ${unread}: put the mod there, or fix the dependency`;
          problems.push({ mission, file, message: why, severity: "warning" });
        }
        for (const dependency of dependencies.packed) {
          problems.push({ mission, file, message: `The dependency ${dependency} is a packed mod (an MPQ file), which can't be read, ${unread}: save it in the Editor as Components (an unpacked folder) to have them checked`, severity: "warning" });
        }
        const conversion = hasKeptTerrain(result.blueprint) ? reference?.conversion : undefined;
        const ownSoundsOf = script && conversion ? { ownSounds: ownSounds(script.script, conversion) } : {};
        for (const problem of await keptContentProblems({ mapDir, record, dependencies, ...(script ? { script: script.script } : {}), ...ownSoundsOf })) {
          problems.push({ mission, file: relative(problem.file), message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
        }
      } catch (error) {
        problems.push({ mission, file: relative(mapDir), message: messageOf(error) });
      }
    }
    // Its effectStarts cues' effects, against the data the checks can read.
    for (const problem of effectCueProblems(result.blueprint, own.catalog)) problems.push({ mission, file, path: problem.path, message: problem.message, severity: "warning" });
    // Its UI Components' actions, each against the component that has it and the Campaign Mod's `ui`, as its compile calls them.
    if (result.blueprint.uiActions.length > 0) {
      const library = await (campaignLibrary ??= workspaceLibrary(workspace, uiComponents));
      result.blueprint.uiActions.forEach((action, index) => {
        const message = uiActionProblem(library, result.blueprint, action.action, action.params);
        if (message) problems.push({ mission, file, path: `uiActions.${index}`, message });
      });
    }
    if (!script) continue;
    // Its cues on part of a scene, against the scene's stage directions, and on one line, against its lines.
    for (const { index, message } of scenePartProblems(reference?.cues ?? [], script.script.scenes)) problems.push({ mission, file, path: `screenplay.script.cues.${index}.from`, message });
    for (const { index, message } of sceneLineProblems(reference?.cues ?? [], script.script.scenes)) problems.push({ mission, file, path: `screenplay.script.cues.${index}.line`, message });
    // Its Cinematics, with their Sets, against the Screenplay.
    const cinematics = await loadCinematics(absolute, result.blueprint, blueprintPath);
    const models = await castModels(own.catalog);
    // Timed by the voice files when they're in the Workspace, else by the estimate.
    const audioDir = (await isInside(absolute, script!.audioDir)) ? script!.audioDir : undefined;
    const found = [...cinematics.problems];
    // Each Set's pieces, against its file, once however many Cinematics (of any Mission) place it.
    for (const loaded of cinematics.loaded) {
      for (const placed of loaded.cinematic.sets) {
        const setFile = setFilePath(blueprintPath, placed.file);
        const set = loaded.sets.get(placed.id);
        if (!set || setsChecked.has(setFile)) continue;
        setsChecked.add(setFile);
        found.push(...setPieceChecks(set, footprints).map((problem) => ({ file: setFile, ...problem })));
      }
    }
    // What they film against what the map's dependencies load.
    found.push(...(await missionCinematicDependencyProblems(workspace, result.blueprint, cinematics.loaded)), ...(await missionFeedChannelProblems(cinematics.loaded)));
    for (const loaded of cinematics.loaded) {
      const checked = cinematicProblems(loaded, script!.script, blueprintPath, models);
      found.push(...checked, ...cinematicLightWarnings(loaded, result.blueprint, own));
      if (checked.some(isCinematicError)) continue;
      // A Cinematic that can be written gets the cinematography checks on its timeline.
      const lines = sceneLines(script!.script, loaded.scene)!;
      const { lengths, estimated } = await voiceLengthsMs(lines, audioDir, script!.voiceFormat);
      found.push(...cinematicChecks(loaded, lines, lengths, estimated));
    }
    // Its cinematicBookmark cues, each warned about, and against the bookmarks their Cinematics declare.
    for (const problem of bookmarkCueProblems(result.blueprint, cinematics.loaded)) problems.push({ mission, file, path: problem.path, message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
    // Its trigger scenes, against the Blueprint's camera Anchors and the Screenplay, and one that
    // compiles gets the cinematography checks, timed as its Cinematics are.
    const triggerScenes = await loadTriggerScenes(result.blueprint, blueprintPath);
    found.push(...triggerScenes.problems);
    for (const loaded of triggerScenes.loaded) {
      const checked = triggerSceneProblems(loaded, result.blueprint, script!.script);
      found.push(...checked);
      if (checked.some(isCinematicError)) continue;
      // One that can be written, timed, for its orders' atMs, its music cues and the checks.
      const lines = sceneLines(script!.script, loaded.scene)!;
      const timing = await voiceLengthsMs(lines, audioDir, script!.voiceFormat);
      const timed = timedTriggerScene(loaded, lines, timing.lengths);
      found.push(...triggerSceneTimingProblems(timed), ...triggerSceneMusicChecks(timed), ...triggerSceneChecks(timed, result.blueprint, timing));
    }
    for (const problem of found) {
      problems.push({ mission, file: relative(problem.file), ...(problem.path ? { path: problem.path } : {}), message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
    }
  }
  problems.push(...(await modProblems(workspace, relative, sc2Path, footprints, uiComponents)));
  return { root: absolute, missions, ...(workspace.mods.length ? { mods: workspace.mods } : {}), problems };
}

/**
 * The Workspace's mods (ADR-0011): each one the config names has its folder, a valid Mod Blueprint
 * with its folder's id, one mod package and a compile record, and each of its Screenplays reads
 * and is named as its compile would (every speaker one of its characters), and each Workspace file
 * an Asset Mod's Asset Sources name has the hash recorded; and the Campaign Mod
 * the Workspace config or its Campaign Pack names is one of them, once the Workspace has any.
 */
async function modProblems(workspace: Workspace, relative: (file: string) => string, sc2Path: string | undefined, footprints: ModelFootprints | undefined, uiComponents: readonly UiComponent[]): Promise<WorkspaceProblem[]> {
  const problems: WorkspaceProblem[] = [];
  const read: WorkspaceMod[] = [];
  for (const mod of workspace.mods) {
    const dir = modDir(workspace, mod);
    try {
      const { mod: found, blueprint } = await readWorkspaceModWithBlueprint(workspace, mod);
      read.push(found);
      if (!(await readCompileRecord(found.blueprintPath))) problems.push({ mod, file: relative(dir), message: `${relative(found.blueprintPath)} has no compile record beside it: Import writes an empty one` });
      // Its `ui`, refused where its compile would refuse it (modUi): a component core doesn't have or a
      // look it refuses, a component on with no library for its functions, or a Galaxy name clash.
      // The components it turns on are kept for the frame paths below even where modUi refuses the rest.
      let on: UiComponentOn[] = [];
      try {
        on = uiComponentsOn(blueprint.ui, uiComponents);
        modUi(blueprint, uiComponents);
      } catch (error) {
        problems.push({ mod, file: relative(found.blueprintPath), path: "ui", message: messageOf(error) });
      }
      // The frame paths its Galaxy and Kept triggers pass, against the layouts its DescIndex loads, its components' and Blizzard's: warnings, since a path may come from a dependency.
      // A `ui` that doesn't read is reported above, and its components' layouts left out here.
      try {
        const generated = componentUi(on, found.blueprintPath, blueprint.library?.id);
        for (const warning of await modFrameWarnings(found.modPackage, generated)) problems.push({ mod, file: relative(warning.file), path: warning.where, message: warning.message, severity: "warning" });
      } catch (error) {
        problems.push({ mod, file: relative(found.modPackage), message: `The frame paths weren't checked: ${messageOf(error)}`, severity: "warning" });
      }
      // Its package's DocumentHeader against DocumentInfo: the game resolves a mod's dependencies from the header too. One that throws doesn't stop the mod's other checks.
      try {
        for (const problem of await documentHeaderProblems(found.modPackage, sc2Path)) problems.push({ mod, file: relative(problem.file), message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) });
      } catch (error) {
        problems.push({ mod, file: relative(found.modPackage), message: messageOf(error) });
      }
      const screenplays = await screenplayProblems(workspace, found, relative);
      problems.push(...screenplays.problems);
      problems.push(...(await assetSourceProblems(found, relative)));
      // Its Cinematics once its Screenplays read: their own problems are reported above.
      if (screenplays.scripts) problems.push(...(await modCinematicProblems(workspace, found, screenplays.scripts, relative, footprints)));
    } catch (error) {
      if (error instanceof ModBlueprintError) {
        for (const issue of error.zodError.issues) problems.push({ mod, file: relative(error.blueprintPath), path: issue.path.join(".") || "(blueprint)", message: issue.message });
      } else {
        problems.push({ mod, file: relative(dir), message: messageOf(error) });
      }
    }
  }
  // Two mods of one name would be one dependency, so a Mission couldn't say which it means.
  read.forEach((mod, index) => {
    const first = read.find((other) => sameModName(other.name, mod.name));
    if (first && first !== mod && read.indexOf(first) < index) {
      problems.push({ mod: mod.id, file: relative(mod.modPackage), message: `${mod.name}${MOD_PACKAGE_EXTENSION} has the name of the mod ${first.id}'s ${first.name}${MOD_PACKAGE_EXTENSION}: a Workspace has one mod of each name` });
    }
  });
  // Its catalog entries (ADR-0011), as loadWorkspace read them for Missions.
  const { catalog } = workspace;
  problems.push(...(await workspaceModelAnimsProblems(workspace)));
  const campaign = catalog.error ? read.find((mod) => sameModName(mod.name, campaignModName(workspace) ?? "")) : undefined;
  if (catalog.error) problems.push({ ...(campaign ? { mod: campaign.id, file: relative(path.dirname(campaign.blueprintPath)) } : { file: WORKSPACE_FILE }), message: catalog.error });
  // The Campaign Mod, found as campaignMod finds it but among the mods read here. It's missing only
  // once every mod reads: one that doesn't, reported above, may be it.
  const name = campaignModName(workspace);
  const namer = workspace.campaignMod ? "The Workspace config" : "The Campaign Pack";
  if (name && workspace.mods.length > 0) {
    const named = read.find((mod) => sameModName(mod.name, name));
    if (!named) {
      if (read.length === workspace.mods.length) problems.push({ file: WORKSPACE_FILE, message: `${namer} names its Campaign Mod ${name}, which none of the Workspace's mods is: import ${name}${MOD_PACKAGE_EXTENSION} with import-mod` });
    } else if (named.kind !== "campaign") {
      problems.push({ mod: named.id, file: relative(named.blueprintPath), path: "kind", message: `${namer} names ${name} as its Campaign Mod, but its Mod Blueprint says it is an Asset Mod` });
    } else if (!catalog.error) {
      // Its Model Guides, against the models' recorded animations and its characters.
      const file = relative(path.join(path.dirname(named.blueprintPath), MODEL_GUIDE_FILE));
      if (catalog.modelGuidesError) problems.push({ mod: named.id, file, message: catalog.modelGuidesError });
      const { characters } = catalog.modelGuides.length > 0 ? await readModBlueprint(named.blueprintPath) : { characters: [] };
      for (const problem of modelGuideProblems(catalog.modelGuides, await catalogModelAnims(catalog), characters.map((character) => character.speaker))) problems.push({ mod: named.id, file, ...problem });
      // Its doodad index (ADR-0017): a file that doesn't read fails; what it lacks only warns, so an unpictured doodad never blocks a compile.
      const indexFile = relative(path.join(path.dirname(named.blueprintPath), MOD_DOODAD_INDEX_FILE));
      if (catalog.doodadIndexError) problems.push({ mod: named.id, file: indexFile, message: catalog.doodadIndexError });
      else for (const message of modDoodadIndexWarnings(modDoodadIndexGaps(catalog, await campaignModPackages(workspace)))) problems.push({ mod: named.id, file: indexFile, message, severity: "warning" });
    }
  }
  return problems;
}

/** The warning for the Campaign Mod's own model recorded outside its file. */
const modModelHome = (catalog: Catalog, model: string): string => {
  const modLayer = catalog.modelAnimsLayers.find((layer) => layer.owner === "mod");
  const folder = catalog.modDir && catalog.workspaceRoot ? path.relative(catalog.workspaceRoot, catalog.modDir).split(path.sep).join("/") : modLayer?.file.split("/").slice(0, 2).join("/");
  return `${model} is the Campaign Mod's own model: record its animations in ${folder ?? "its mod's folder"}/${MODEL_ANIMS_FILE}`;
};

/** Where a game model's recorded animations belong, for the messages of an entry kept elsewhere. */
const GAME_MODEL_HOME = "record a game model's animations in model-anims.json at the Workspace root";

/**
 * A Workspace file of recorded animations's problems: the file that doesn't read, and each entry
 * `misplaced` says belongs in another owner's file (ADR-0026), as a warning.
 */
function modelAnimsLayerProblems(layer: ModelAnimsLayer, misplaced: (model: string) => string | undefined): WorkspaceProblem[] {
  if (layer.error) return [{ file: layer.file, message: layer.error }];
  return Object.keys(layer.anims).flatMap((model) => {
    const message = misplaced(model);
    return message ? [{ file: layer.file, path: model, message, severity: "warning" as const }] : [];
  });
}

/**
 * The Workspace's own files of recorded animations, the root's and the Campaign Mod's: each reads,
 * holds only its owner's models, and, for the root's, a note of each model core records too.
 */
async function workspaceModelAnimsProblems(workspace: Workspace): Promise<WorkspaceProblem[]> {
  const { catalog } = workspace;
  const problems: WorkspaceProblem[] = [];
  const modId = catalog.modelAnimsLayers.find((layer) => layer.owner === "mod")?.file.split("/")[1];
  const core = await bundledModelAnims();
  for (const layer of catalog.modelAnimsLayers) {
    if (layer.owner === "workspace") {
      problems.push(...modelAnimsLayerProblems(layer, (model) => (catalog.models.has(model) ? modModelHome(catalog, model) : undefined)));
      if (layer.error) continue;
      for (const [model, entry] of Object.entries(layer.anims)) {
        const cored = core[model];
        if (!cored || catalog.models.has(model)) continue;
        const message = isDeepStrictEqual(cored, entry) ? `core records ${model} too, the same: drop it from ${layer.file}` : `core records ${model} too, differently: ${layer.file}'s is used until it's dropped from there`;
        problems.push({ file: layer.file, path: model, message, severity: "note" });
      }
    } else if (layer.owner === "mod") {
      problems.push(...modelAnimsLayerProblems(layer, (model) => (catalog.models.has(model) ? undefined : `${model} isn't one of the Campaign Mod's own models: ${GAME_MODEL_HOME}`)).map((problem) => ({ ...(modId ? { mod: modId } : {}), ...problem })));
    }
  }
  return problems;
}

/**
 * An Asset Mod's Workspace files whose hash isn't the one its Blueprint records, or that aren't
 * there: a voice's recording this machine doesn't have (not there, or a Git LFS pointer) is no
 * problem, since the compile leaves its voice file as the package has it.
 */
async function assetSourceProblems(mod: WorkspaceMod, relative: (file: string) => string): Promise<WorkspaceProblem[]> {
  const blueprint = await readModBlueprint(mod.blueprintPath);
  const dir = path.dirname(mod.blueprintPath);
  const declared = [
    ...blueprint.assets.map((asset, index) => ({ at: `assets.${index}.source`, source: asset.source, optional: false })),
    ...blueprint.voices.flatMap((voices, index) => Object.entries(voices.recordings).map(([sound, source]) => ({ at: `voices.${index}.recordings.${sound}`, source, optional: true }))),
  ];
  const problems: WorkspaceProblem[] = [];
  for (const { at, source, optional } of declared) {
    for (const file of workspaceFilesOf(source)) {
      if (optional && (await absentProblem(file, dir))) continue;
      const problem = await workspaceFileProblem(file, dir);
      if (problem) problems.push({ mod: mod.id, file: relative(path.join(dir, file.file)), path: at, message: problem });
    }
  }
  return problems;
}

/**
 * A Campaign Mod's Cinematics, checked as a Mission's are, on its Screenplays as named (`scripts`):
 * each against its Sets and its scene, the pieces of each Set any of them places, the
 * cinematography checks on a Cinematic that can be written (timed by its Asset Mods' voice files),
 * and a warning for one whose cutscene nothing in the mod plays. And its Set cutscenes: each Set
 * read from the mod's folder, and its pieces checked as a placed Set's are.
 */
async function modCinematicProblems(workspace: Workspace, mod: WorkspaceMod, scripts: readonly ModScript[], relative: (file: string) => string, footprints?: ModelFootprints): Promise<WorkspaceProblem[]> {
  const blueprint = await readModBlueprint(mod.blueprintPath);
  if (blueprint.cinematics.length === 0 && blueprint.setCutscenes.length === 0) return [];
  const { read, loaded: all, problems: found } = await readModCinematics(blueprint, mod.blueprintPath, scripts, workspace);
  const shown = await readModSetCutscenes(blueprint, mod.blueprintPath);
  const problems = [...found, ...shown.problems];
  // Each Set's pieces, against its file, once however many Cinematics place it or Set cutscenes show it, whatever their own problems.
  const checked = new Set<string>();
  const sets = footprints ?? (await bundledModelFootprints());
  for (const { setFile, set } of shown.read) {
    if (checked.has(setFile)) continue;
    checked.add(setFile);
    problems.push(...setPieceChecks(set, sets).map((problem) => ({ file: setFile, ...problem })));
  }
  for (const loaded of all) {
    for (const placed of loaded.cinematic.sets) {
      const setFile = setFilePath(mod.blueprintPath, placed.file);
      const set = loaded.sets.get(placed.id);
      if (!set || checked.has(setFile)) continue;
      checked.add(setFile);
      problems.push(...setPieceChecks(set, sets).map((problem) => ({ file: setFile, ...problem })));
    }
  }
  const assetMods = await dependedAssetMods(blueprint, workspace, scripts);
  for (const { loaded, script } of read) {
    const lines = sceneLines(script, loaded.scene)!;
    const { lengths, estimated } = await modLineLengths(lines, assetMods);
    problems.push(...cinematicChecks(loaded, lines, lengths, estimated));
  }
  const played = await playedCutscenes(mod.modPackage, blueprint.cinematics.map((cinematic) => cinematic.cutscene));
  for (const [index, cinematic] of blueprint.cinematics.entries()) {
    if (played.has(cinematic.cutscene)) continue;
    problems.push({
      file: mod.blueprintPath,
      path: `cinematics.${index}.cutscene`,
      severity: "warning",
      message: `Nothing in the mod's data or triggers plays Cutscenes\\${cinematic.cutscene}.SC2Cutscene, so the Cinematic is written but never plays: name it in the scene's cue (a hub chat's UserData row), or name the cutscene the cue plays`,
    });
  }
  return problems.map((problem) => ({ mod: mod.id, file: relative(problem.file), ...(problem.path ? { path: problem.path } : {}), message: problem.message, ...(problem.severity ? { severity: problem.severity } : {}) }));
}

/** A mod's Screenplays, each read from its file and named as the mod's compile names it: their problems, and once there are none, the Screenplays as named. */
async function screenplayProblems(workspace: Workspace, mod: WorkspaceMod, relative: (file: string) => string): Promise<{ readonly problems: WorkspaceProblem[]; readonly scripts?: readonly ModScript[] }> {
  const blueprint = await readModBlueprint(mod.blueprintPath);
  const problems: WorkspaceProblem[] = [];
  const named: { readonly read: ModScript; readonly file: string }[] = [];
  for (const [index, screenplay] of blueprint.screenplays.entries()) {
    const at = { mod: mod.id, path: `screenplays.${index}` };
    let file: string;
    try {
      file = await modFile(mod.blueprintPath, screenplay.source);
    } catch (error) {
      problems.push({ ...at, file: relative(mod.blueprintPath), message: messageOf(error) });
      continue;
    }
    let markdown: string;
    try {
      markdown = await readFile(file, "utf8");
    } catch {
      problems.push({ ...at, file: relative(file), message: `${screenplay.source} can't be read${screenplay.ref ? `: pull ${screenplay.ref} from the Screenplay Source (pull-screenplay)` : ""}` });
      continue;
    }
    try {
      named.push({ read: { screenplay, index, script: nameModScreenplay(markdown, blueprint, index, workspace.registry, relative(mod.blueprintPath)) }, file: relative(file) });
    } catch (error) {
      problems.push({ ...at, file: relative(file), message: messageOf(error) });
    }
  }
  // Those named, together, as the compile reads them: lost imported lines, and a Sound two lines play.
  for (const { index, message } of modScriptProblems(named.map(({ read }) => read))) {
    problems.push({ mod: mod.id, path: `screenplays.${index}`, file: named.find(({ read }) => read.index === index)!.file, message });
  }
  return problems.length === 0 ? { problems, scripts: named.map(({ read }) => read) } : { problems };
}

/**
 * Every cinematicBookmark cue, warned about: a bookmark isn't heard when the player skips the
 * Cinematic (docs/reference/editor-and-engine.md, "A cutscene's events"), so what the cue plays is
 * the one thing in a Mission that depends on how the player watches a scene, and a scenePlayed cue
 * does the same job without that. A Kept hold waiting on one that a skip doesn't fire would stall
 * the Mission, said more strongly. A cue on a bookmark its Cinematic doesn't declare is an error:
 * it would never fire.
 */
function bookmarkCueProblems(blueprint: MissionBlueprint, loaded: readonly LoadedCinematic[]): { readonly path: string; readonly message: string; readonly severity?: Severity }[] {
  const prefer = "Prefer a scenePlayed cue, which fires however the Cinematic ends, and keep triggers out of cutscenes where you can";
  return blueprintCues(blueprint).flatMap(({ cue, path }) => {
    if (cue.type !== "cinematicBookmark") return [];
    const at = path.join(".");
    const name = `${cue.cinematicId}/${cue.bookmark}`;
    const fires = cue.onSkip === "fire";
    const found: { path: string; message: string; severity?: Severity }[] = [
      {
        path: at,
        severity: "warning",
        message: fires
          ? `The cue on bookmark ${name} runs when the cutscene passes it, or, if the player skips ${cue.cinematicId} first, as the Cinematic ends (onSkip "fire"): what it plays happens late for a player who skips, and missed cues run in the order they're listed. ${prefer}.`
          : `The cue on bookmark ${name} runs only when the cutscene passes it: a player who skips ${cue.cinematicId} never gets it, and nothing it plays or starts happens for them. ${prefer}, or set onSkip "fire".`,
      },
    ];
    if (path[0] === "kept" && !fires) found.push({ path: at, severity: "warning", message: `The Kept hold waits on bookmark ${name}, which a skip never fires, so the held trigger never runs for a player who skips and the Mission stalls: use onSkip "fire", or hold on a scenePlayed cue` });
    const cinematic = loaded.find((entry) => entry.id === cue.cinematicId);
    if (cinematic && !(cinematic.cinematic.bookmarks ?? []).some((bookmark) => bookmark.name === cue.bookmark)) {
      const declared = (cinematic.cinematic.bookmarks ?? []).map((bookmark) => bookmark.name);
      found.push({ path: [...path, "bookmark"].join("."), message: `${cue.cinematicId}'s shot list declares no bookmark ${cue.bookmark} (${declared.length ? `it has ${declared.join(", ")}` : "it has none"}), so the cue would never fire` });
    }
    return found;
  });
}

/** A CEffect* entry's id in catalog XML. */
const EFFECT_ENTRY = /<CEffect\w*\b[^>]*?\bid="([^"]+)"/g;

/**
 * Each effectStarts cue whose effect no data the checks can read defines: the game's
 * (data/tech-catalog.json), the Mission's catalog (the Campaign Mod's and its package's Kept data),
 * or a Plugin Mechanic's own (its buildGameData). Player Uses Effect fires on no effect it
 * doesn't know, so the cue would never fire, but data elsewhere (a dependency the checks can't read)
 * may define it, so it is a warning.
 */
function effectCueProblems(blueprint: MissionBlueprint, catalog: Catalog): { readonly path: string; readonly message: string }[] {
  const unknown = blueprintCues(blueprint).flatMap(({ cue, path: at }) => (cue.type === "effectStarts" && !isKnownEffect(catalog, cue.effectId) ? [{ effectId: cue.effectId, at }] : []));
  if (unknown.length === 0) return [];
  const own = new Set<string>();
  try {
    for (const { data } of buildMechanicGameData(blueprint)) {
      for (const line of data.catalogs?.["EffectData.xml"] ?? []) for (const match of line.matchAll(EFFECT_ENTRY)) own.add(match[1]!);
    }
  } catch {
    // A Mechanic whose data fails fails the compile, which says so.
  }
  return unknown
    .filter(({ effectId }) => !own.has(effectId))
    .map(({ effectId, at }) => ({
      path: [...at, "effectId"].join("."),
      message: `${effectId} isn't an effect the Catalog has (data/tech-catalog.json${layerSource(catalog)}), nor a Mechanic's or the map's own, so the cue would never fire: check the effect's id, or ignore this if data the checks can't read defines it`,
    }));
}

/**
 * The check as the CLI prints it: a line per problem, a warning, review item or note marked as one, then
 * a summary, which counts only errors as problems.
 */
export function formatWorkspaceCheck(check: WorkspaceCheck): string {
  const lines = check.problems.map((problem) => `${problem.mission ?? (problem.mod ? `mod ${problem.mod}` : "(Workspace)")}: ${problem.file}${problem.path ? ` ${problem.path}` : ""}: ${problem.severity ? `${problem.severity}: ` : ""}${problem.message}`);
  const errors = check.problems.filter(isError);
  const failing = new Set(errors.flatMap((problem) => (problem.mission ? [problem.mission] : []))).size;
  const ofWorkspace = errors.some((problem) => !problem.mission);
  const count = (severity: WorkspaceProblem["severity"]) => check.problems.filter((problem) => problem.severity === severity).length;
  const notes = count("note") > 0 ? `, ${count("review")} review item(s) and ${count("note")} note(s)` : ` and ${count("review")} review item(s)`;
  const noted = errors.length < check.problems.length ? `, with ${count("warning")} warning(s)${notes}` : "";
  const summary =
    errors.length === 0
      ? `${check.missions.length} Mission(s)${check.mods?.length ? ` and ${check.mods.length} mod(s)` : ""} in ${check.root} are valid${noted}.`
      : ofWorkspace
        ? `${errors.length} problem(s) in the Workspace ${check.root}${noted}.`
        : `${errors.length} problem(s) in ${failing} of ${check.missions.length} Mission(s), in ${check.root}${noted}.`;
  return [...lines, summary].join("\n");
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the Campaign Mod's doodad index lacks, as the check's warnings: one per kind of gap, naming the doodads. */
export function modDoodadIndexWarnings(gaps: ModDoodadIndexGaps): string[] {
  const named = (ids: readonly string[]) => `${ids.length} doodad${ids.length === 1 ? "" : "s"} (${ids.join(", ")})`;
  const warnings: string[] = [];
  if (gaps.missing.length > 0) warnings.push(`The doodad index lacks ${named(gaps.missing)} the Campaign Mod defines: run index-mod-doodads, then describe them`);
  if (gaps.stale.length > 0) warnings.push(`The doodad index is stale for ${named(gaps.stale)} whose model changed: run index-mod-doodads, then describe them again`);
  if (gaps.pending.length > 0) warnings.push(`${named(gaps.pending)} in the doodad index ${gaps.pending.length === 1 ? "has" : "have"} no description yet: describe ${gaps.pending.length === 1 ? "it" : "them"} from the sheet, or from the data when unpictured`);
  if (gaps.gone.length > 0) warnings.push(`The doodad index has entries for ${named(gaps.gone)} the Campaign Mod no longer gives a model of its own: run index-mod-doodads to drop them`);
  return warnings;
}
