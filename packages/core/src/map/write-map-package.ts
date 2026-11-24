import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { missingDoodadDependencies, checkDoodad, unknownPlacedDoodads } from "../catalog/stock-catalog.js";
import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { customDoodadEntries, type DoodadFile } from "../mods/custom-doodads.js";
import type { SwapSlot } from "../mods/texture-swaps.js";
import { entryXml } from "../mods/generic-entries.js";
import type { GameLibrary } from "../mods/library-galaxy.js";
import { INDEX_VERSION } from "../cutscene/write-shot-cutscene.js";
import type { TimedTriggerScene } from "../cutscene/trigger-scene.js";
import { expandDressing } from "../dressing/expand-dressing.js";
import { missionTextures } from "../catalog/tileset-textures.js";
import { isPlaced, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { bindLikeOriginal, type CampaignLibrary } from "../plugins/plugin-api.js";
import { rasterizeTerrain, type TerrainRasterizationResult, terrainHeightAt, terraceNotes } from "../terrain/rasterize.js";
import type { Rot180 } from "../terrain/symmetry.js";
import { buildMechanicGameData, buildMechanicWarnings, buildMissionGameData, buildMissionGameHotkeys, buildMissionGameStrings, buildMissionTriggers } from "../triggers/build-mission-triggers.js";
import { boundsFindings } from "../layout/bounds-checks.js";
import { boundsRegions, boundsWarnings } from "../triggers/beat-bounds.js";
import { waveWarningRegions, waveWarnings } from "../triggers/wave-triggers.js";
import { assumedPlayableBounds, playableBounds, playableMarginWarnings } from "./map-bounds.js";
import { MAP_BOUNDS_ENTRY_NAME, type MapBoundsEntry, mapInfoBounds, maskMinimap, patchMapInfoBounds, planKeptBounds } from "./patch-map-info.js";

/** Core's game strings with the Mechanics' added; a Mechanic's key can't replace one of core's (DocInfo/Name, a trigger's text). */
function mergeStrings(core: Readonly<Record<string, string>>, mechanics: Readonly<Record<string, string>>): Record<string, string> {
  const clash = Object.keys(mechanics).find((key) => Object.hasOwn(core, key));
  if (clash) throw new Error(`A Mechanic sets the game string ${clash}, which core already writes`);
  return { ...core, ...mechanics };
}
import type { TriggerDocument } from "../triggers/trigger-model.js";
import { type Script, scriptLines } from "../script/name-script.js";
import { type Derive, machineDerive } from "../host/derive.js";
import { emptyMachineConfig } from "../host/machine-config.js";
import { DEFAULT_VOICE_FORMAT, packageVoiceFiles, type VoiceFormat } from "../host/voice-files.js";
import { conversationDataXml, conversationStrings, soundDataXml, voiceAssetPath } from "../script/write-conversation-data.js";
import { writeMapScript } from "../triggers/write-map-script.js";
import { type AuthoredTriggers, blueprintTriggerLibraries, compileBlueprintTriggers, hasAuthoredTriggers, type KeptTriggers } from "../triggers/blueprint-triggers.js";
import { triggerNameStrings, triggerTextStrings, writeStringsFile } from "../triggers/write-trigger-strings.js";
import { writeTriggersXml } from "../triggers/write-triggers-xml.js";
import { type MapInfoPlayer, writeMapInfo } from "../terrain/write-map-info.js";
import { keptMaskWarnings, revealWarnings } from "../triggers/beat-reveals.js";
import { beatOrderWarnings } from "../triggers/beat-order.js";
import { meleeInitializationTriggers } from "../triggers/melee-triggers.js";
import { readMapInfo } from "./read-map-info.js";
import { MAPINFO_FOG } from "../domain/unexplored-areas.js";
import { PATHING_FILE, writeCellAttribute } from "../terrain/write-cell-attribute.js";
import { writeT3CellFlags } from "../terrain/write-t3-cell-flags.js";
import { hiddenCellMask, writeHiddenBit } from "../terrain/hidden-cells.js";
import { CELL_FLAG_HIDDEN } from "../terrain/cliffs.js";
import { hiddenCells } from "./hidden-cells-changes.js";
import { readCellFlagCells } from "../kept-terrain/kept-cliffs.js";
import { heightQuantization, writeT3HeightMap } from "../terrain/write-t3-height-map.js";
import { writeT3SyncCliffLevel } from "../terrain/write-t3-sync-cliff-level.js";
import { writeT3SyncHeightMap } from "../terrain/write-t3-sync-height-map.js";
import { writeT3SyncTextureInfo } from "../terrain/write-t3-sync-texture-info.js";
import { writeT3TerrainXml } from "../terrain/write-t3-terrain-xml.js";
import { texelMasks, writeT3TextureMasks } from "../terrain/write-t3-texture-masks.js";
import { componentVersionFileName, writeComponentVersion } from "./write-component-version.js";
import { writeDocumentHeader } from "./write-document-header.js";
import { writeMinimapTga } from "./write-minimap-tga.js";
import { DEFAULT_DEPENDENCIES, writeDocumentInfoXml } from "./write-document-info-xml.js";
import { LIGHTING_MAP, lightingMapTga, lightRegionWarnings } from "./light-regions.js";
import { unknownLightWarnings } from "./write-lights.js";
import { skyWarnings } from "./write-sky.js";
import { t3WaterBuffer, waterWarnings } from "./write-water.js";
import { enemyAiSettings, enemyPlayers, unitAi } from "../ai/enemy-ai.js";
import { expandPlacements, type PlacedUnit } from "./expand-placements.js";
import { writeObjectsXml } from "./write-objects-xml.js";
import { compositeActors, compositeActorWarnings } from "./write-composite-actors.js";
import { missionRegions, numberRegions, writeRegionsXml } from "./write-regions-xml.js";
import { readRegionsXml } from "./read-regions-xml.js";
import { renumberRegions } from "../triggers/renumber-regions.js";
import { anchorObjectId, stableObjectId } from "./stable-object-id.js";
import { anchorDoodadDefaults } from "./anchor-doodad-defaults.js";
import { compiledPathing, pathingCutWarnings, pathWidthWarnings } from "./compiled-pathing.js";
import { PackageOutput } from "./package-output.js";
import { type OwnershipPlan, planOwnership } from "./ownership-plan.js";
import { EquivalenceCheck } from "../mods/equivalence.js";
import { CUTSCENES_DIR, packageFilesBelow } from "./kept-package.js";
import { CONVERSATION_DATA, conversationItemNames, conversationParts, keptTriggersName, keptVoiceFile, orphanedParts, ownSounds, relinkCutscene, SOUND_DATA, voicedHere, withoutEntries } from "./mission-conversation.js";
import { catalogModelAnims } from "../catalog/model-anims.js";
import { catalogEntries } from "./catalog-entries.js";
import { type CompileRecord, entryName, recordedIds } from "../domain/compile-record.js";
import { describeUnusedKept, type EditorDecisions, editorDecision, TRIGGER_STRINGS, UNWRITTEN } from "./editor-changes.js";
import { refuseKeptScriptNames, resolveKeptReferences } from "./kept-references.js";
import { applyKeptHolds, holdBlueprintTriggers, keptHolds, type KeptHoldEntry } from "../triggers/kept-holds.js";
import { recordedItemKeys } from "../triggers/splice-triggers.js";
import { triggerStringNames } from "../triggers/triggers-file.js";
import { setDoodadHeights } from "./edit-kept-objects.js";
import { TERRAIN_DATA, zonesBesideKept } from "./zones-beside-kept.js";
import { blockOf } from "../terrain/texture-grid.js";
import { setBoundaryWarnings } from "../kept-terrain/set-boundaries.js";
import { textureSetTerrainEntries, writeTextureSetXml } from "../kept-terrain/texture-sets.js";
import { vertexHeightAt } from "../study/terrain-grid.js";

export type WriteMapPackageOptions = {
  readonly blueprint: MissionBlueprint;
  readonly outputDir: string;
  readonly includeObjects?: boolean;
  readonly includeRegions?: boolean;
  /** Writes Triggers, MapScript.galaxy and localized strings; outcome triggers reference placed Objects. */
  readonly includeTriggers?: boolean;
  /** Replaces the triggers built from the blueprint (implies includeTriggers). */
  readonly triggers?: TriggerDocument;
  /** Extra catalog files written to Base.SC2Data/GameData, e.g. { "LightData.xml": "<Catalog>…" }. */
  readonly gameData?: Readonly<Record<string, string>>;
  /** The screenplay's parsed script, its voice files and their format in the package, .ogg unless given (required when the blueprint references a script). */
  readonly script?: { readonly script: Script; readonly audioDir: string; readonly voiceFormat?: VoiceFormat };
  /** Encodes a .wav voice file to Ogg Vorbis; ffmpeg, cached by content in the system's temporary folder, by default. */
  readonly derive?: Derive;
  /** The Campaign Mod's library, which the Mechanics' triggers may call (mods/library.ts). */
  readonly library?: CampaignLibrary;
  /** The libraries in reach of the map, which its triggers' calls are written from: the game's and its Workspace dependency mods' (librariesInReach); the game's alone when left out. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
  readonly dependencies?: readonly string[];
  /** Cutscene Editor files written to Base.SC2Data/Cutscenes/<name>.SC2Cutscene, by name: the Mission's Cinematics. */
  readonly cutscenes?: Readonly<Record<string, string>>;
  /** The Light ids those Cinematics switch to: a Plugin's Light among them goes into LightData. */
  readonly cinematicLights?: readonly string[];
  /** The Blueprint's own trigger elements, read from its `triggers` files, and its `triggerFolders` (ADR-0026): compiled beside the concepts' triggers. */
  readonly authoredTriggers?: AuthoredTriggers;
  /** The Mission's trigger scenes, checked and timed (cutscene/trigger-scene.ts); the Blueprint's `screenplay.script.triggerScenes` need them. */
  readonly triggerScenes?: readonly TimedTriggerScene[];
  /** Timestamp recorded in each component's .version file; defaults to now. */
  readonly savedAt?: Date;
  /** Playable bounds [left, bottom, right, top], in place of the Blueprint's (map-bounds.ts playableBounds): a melee map's. */
  readonly playableBounds?: readonly [number, number, number, number];
  /**
   * Writes a melee map (#213) instead of a Mission: User players with any race and a random start
   * and no Computer players, a StartLoc point at each start, the stock Melee Initialization trigger
   * in place of the blueprint's, and only the cosmetic catalogs (melee research §4).
   */
  readonly melee?: MeleeOptions;
  /**
   * The last compile's record (ADR-0010). With one, the package is merged: what the record lists
   * is replaced and everything else is left byte for byte. Without, every file is written whole.
   */
  readonly previousRecord?: CompileRecord;
  /** Saves the record: before the package is written (with the previous record's entries too, in case the compile is cut short) and after. */
  readonly saveRecord?: (record: CompileRecord) => Promise<void>;
  /**
   * What the author decided for Compiled Content the Editor changed (editor-changes.ts): kept or
   * discarded, by entry name. A change with no decision stops the compile before it writes anything.
   */
  readonly decisions?: EditorDecisions;
  /** Only compares the record with the package, throwing EditorChangesError as the compile would, and writes nothing. */
  readonly dryRun?: boolean;
  /** The files of the Blueprint's own doodads (missionDoodadFiles), each written at its storage path: given whenever it has any. */
  readonly doodadFiles?: readonly DoodadFile[];
  /** The slot of each of a Blueprint doodad's swaps (missionDoodadFiles), by its id: given for every doodad that swaps textures. */
  readonly doodadSwaps?: ReadonlyMap<string, readonly SwapSlot[]>;
  /**
   * The Campaign Mod's doodad types, when the map's dependencies don't load the Campaign Mod (its
   * `dependency`): a placed one is warned about, naming the dependency to add, since the Editor shows
   * a placeholder for it. Core's doodad catalog knows only the game's, so missingDoodadDependencies can't.
   */
  readonly unloadedModDoodads?: { readonly dependency: string; readonly types: ReadonlySet<string> };
};

export type MeleeOptions = {
  /** Each spawn's start location, at its town hall's centre: Player 1's first. */
  readonly startLocations: readonly { readonly x: number; readonly y: number }[];
  /** The rotation the blueprint's two halves keep to (#214): the terrain and resource bases are drawn to match. */
  readonly symmetry?: Rot180;
  /** The mains (#215): a ramp connection up onto one is always the Editor's diagonal ramp. */
  readonly diagonalRampsOnto?: ReadonlySet<string>;
  /** Places the map's units on the drawn terrain in place of the Mission placements (#215: standard bases, plates). */
  readonly placeUnits?: (terrain: TerrainRasterizationResult) => { readonly units: readonly PlacedUnit[]; readonly warnings: readonly string[] };
};

/** The catalogs a melee map may carry and stay Melee: the ladder maps' cosmetic ones, and ActorData's Doodad Composites (tested 2026-10-31). */
const MELEE_CATALOGS = new Set(["LightData.xml", "WaterData.xml", "TerrainData.xml", "ActorData.xml"]);

/**
 * The options with CellAttribute_Pnp on the previous record when the last compile wrote none (it
 * painted nothing) but the package has one: a layer the author painted in the Editor since, which
 * the compile now decides on, or that sync brings back, as any Compiled file the Editor changed.
 * Its fingerprint is no file's (UNWRITTEN), so it reads as changed unless nothing is painted in it.
 * Beside Kept ground the file is the package's.
 */
function pathingOnRecord(options: WriteMapPackageOptions, plan: OwnershipPlan): WriteMapPackageOptions {
  const record = options.previousRecord;
  if (!record || plan.owner("pathing") === "package" || !existsSync(path.join(options.outputDir, PATHING_FILE))) return options;
  const listed = (entries: readonly { readonly kind: string; readonly path?: string }[]): boolean => entries.some((entry) => entry.kind === "file" && entry.path === PATHING_FILE);
  if (listed(record.entries) || listed(record.kept ?? [])) return options;
  return { ...options, previousRecord: { ...record, entries: [...record.entries, { kind: "file", path: PATHING_FILE, fingerprint: UNWRITTEN }] } };
}

/** Writes the package; returns advice for the author that didn't stop the compile. */

export async function writeMapPackage(given: WriteMapPackageOptions): Promise<{ readonly warnings: readonly string[]; readonly record: CompileRecord }> {
  // Who owns each part of the package, decided once; the sections below ask it.
  const plan = planOwnership({ blueprint: given.blueprint, outputDir: given.outputDir, melee: given.melee !== undefined });
  const options = pathingOnRecord(given, plan);
  const {
    blueprint,
    outputDir,
    includeObjects = false,
    includeRegions = false,
    melee,
    triggers: triggerOverride = melee ? meleeInitializationTriggers() : undefined,
    includeTriggers: triggersRequested = triggerOverride !== undefined,
    // A Mission's cosmetic catalogs come with its triggers; a melee map has the stock trigger, so they come here.
    gameData = melee ? buildMissionGameData(blueprint, []) : {},
    script: scriptRequested,
    cutscenes = {},
    cinematicLights = [],
    // DocumentInfo and DocumentHeader must agree; the game resolves dependencies from the header.
    dependencies: declaredDependencies = blueprint.dependencies ?? DEFAULT_DEPENDENCIES,
    savedAt = new Date(),
  } = options;

  // A Blueprint with Kept terrain keeps its package's terrain, map info and triggers (ADR-0010): the
  // compile writes only what the Blueprint declares beside them, its triggers spliced in beside the
  // Kept ones.
  // Compiled against the Catalog the Blueprint was validated against, its Campaign Mod's entries with the game's.
  const catalog = blueprintCatalog(blueprint);
  const packageRefusal = plan.packageRefusal(options.previousRecord !== undefined, existsSync(path.join(outputDir, "MapInfo")));
  if (packageRefusal) throw new Error(packageRefusal);
  // Kept References are what the Mission's triggers call in the package, so they matter only to a
  // compile that builds them, and only in the Mission's own package: its record keeps the Kept
  // triggers they name from being written over, and elsewhere what they name isn't there.
  const buildsMissionTriggers = triggersRequested && !triggerOverride;
  // The Blueprint's own triggers' element Ids (ADR-0026): a reference or a hold naming one names nothing in the package.
  const blueprintTriggers = new Set((options.authoredTriggers?.triggers ?? []).map(({ trigger }) => trigger.id));
  const referencesRefusal = plan.keptReferencesRefusal(buildsMissionTriggers, options.previousRecord !== undefined, blueprintTriggers);
  if (referencesRefusal) throw new Error(referencesRefusal);
  // Each Kept Reference found in the package, a Kept trigger or variable called by the Editor's names.
  // A trigger reference may name one of the Blueprint's own triggers instead, by the same element Id (ADR-0026).
  const resolved = buildsMissionTriggers ? await resolveKeptReferences(blueprint, outputDir, (options.authoredTriggers?.triggers ?? []).map(({ trigger }) => trigger)) : blueprint;
  // Beside Kept terrain the package keeps its own conversation, so the Screenplay's script plays no
  // line, unless it has been converted to the Screenplay (map/mission-conversation.ts): then the
  // compile writes it over the Kept one, and its lines play.
  const conversion = plan.besideKept ? blueprint.screenplay.script?.conversion : undefined;
  const script = plan.besideKept && !conversion ? undefined : scriptRequested;
  const keptTriggers =
    plan.besideKept && triggersRequested && !triggerOverride
      ? conversion
        ? buildMissionTriggers(resolved, {
            ...(script ? { script: script.script } : {}),
            ...(options.library ? { library: options.library } : {}),
            ...(options.triggerScenes ? { triggerScenes: options.triggerScenes } : {}),
          })
        : buildMissionTriggers(bindLikeOriginal({ ...resolved, screenplay: { ...resolved.screenplay, script: undefined } }, resolved), options.library ? { library: options.library } : {})
      : undefined;
  // The Blueprint's own triggers are compiled with the Mission's, never into a stock trigger's map (a melee map's).
  const authored = buildsMissionTriggers && hasAuthoredTriggers(options.authoredTriggers) ? options.authoredTriggers : undefined;
  const includeTriggers = plan.writesTriggers(triggersRequested, authored !== undefined || (keptTriggers !== undefined && keptTriggers.triggers.length + keptTriggers.variables.length > 0));
  const triggersRefusal = plan.triggersRefusal(includeTriggers, existsSync(path.join(outputDir, "Triggers")));
  if (triggersRefusal) throw new Error(triggersRefusal);
  // Beside Kept terrain the package's MapInfo, read once for what reads it (the mask warnings, the bounds).
  let keptMapInfoRead: Promise<Buffer | undefined> | undefined;
  const keptMapInfo = (): Promise<Buffer | undefined> => (keptMapInfoRead ??= readFile(path.join(outputDir, "MapInfo")).catch(() => undefined));
  // Beside Kept terrain the package's MapInfo, and so its Unexplored Areas, is the author's: the
  // warnings go by its fog string, not the Blueprint's. It's read when a Beat reveals something, or
  // the Blueprint asks for a mask the package may not have; a MapInfo that can't be read costs the
  // warnings, not the compile.
  const maskWarnings: string[] = [];
  const reveals = includeTriggers && !triggerOverride && blueprint.beats.some((beat) => beat.reveals.length > 0);
  if (plan.besideKept && (reveals || blueprint.unexploredAreas !== undefined)) {
    try {
      maskWarnings.push(...keptMaskWarnings(blueprint, readMapInfo((await keptMapInfo())!).fogType, { reveals }));
    } catch (error) {
      const why = reveals ? ", so the Beats' reveals may only ping the minimap" : "";
      maskWarnings.push(`Couldn't read the package's Unexplored Areas from its MapInfo (${error instanceof Error ? error.message : String(error)})${why}: check Map > Map Options`);
    }
  }
  const symmetry = melee?.symmetry;
  // Beside Kept ground the terrain is the package's: Zones that generate theirs write it cell by cell
  // into it (src/map/zones-beside-kept.ts), and the dressing and units stand on it as written. With
  // no generating Zone, nothing is generated: Kept Zones get no generated ground or dressing.
  const besideKept = plan.besideKept ? await zonesBesideKept(outputDir, blueprint, options.previousRecord!, options.decisions) : undefined;
  const terrain = besideKept?.zones.terrain ?? rasterizeTerrain(blueprint, { symmetry, diagonalRampsOnto: melee?.diagonalRampsOnto, limitCliffSets: true });
  const dressing = besideKept?.zones.dressing ?? expandDressing(blueprint, terrain);
  // Beside Kept ground the ground is the package's with the Zones written in, not the generator's alone.
  const groundAt = (x: number, y: number): number =>
    besideKept ? vertexHeightAt(besideKept.zones.heights, blueprint.mapSize.width + 1, x, y) : terrainHeightAt(terrain, blueprint.mapSize.width, x, y);
  const placed = melee?.placeUnits ? melee.placeUnits(terrain) : expandPlacements(blueprint, terrain, { symmetry });
  const aiSettings = enemyAiSettings(blueprint.enemyAi);
  // Doodads from campaign packages need their campaign as a dependency, or the Editor shows them
  // as unknown: add what's missing, and say so.
  const doodadTypes = [
    ...blueprint.anchors.flatMap((anchor) => (anchor.kind === "doodad" && anchor.doodadType ? [anchor.doodadType] : [])),
    ...dressing.doodads.map((doodad) => doodad.type),
  ];
  // A custom mod (a file: dependency) may bring them in through its own dependencies, which we
  // can't see: then only warn.
  const missing = missingDoodadDependencies(doodadTypes, declaredDependencies);
  const customMod = declaredDependencies.find((dependency) => dependency.startsWith("file:"));
  const add = customMod ? [] : [...missing.keys()].filter((dependency) => !dependency.startsWith("("));
  const dependencies = [...declaredDependencies, ...add];
  const dependencyWarnings = [...missing].map(([dependency, types]) =>
    dependency.startsWith("(")
      ? `Doodads ${types.join(", ")} come from a package with no known dependency ${dependency.slice(1, -1)}; add it in the Editor.`
      : customMod
        ? `Doodads ${types.join(", ")} need ${dependency}; check that ${customMod} brings it in, or add it to the blueprint's dependencies.`
        : `Added dependency ${dependency} for doodads ${types.join(", ")}.`,
  );
  const unloaded = options.unloadedModDoodads;
  const ownTypes = new Set(blueprint.doodads.map((doodad) => doodad.id));
  const needMod = unloaded ? [...new Set(doodadTypes)].filter((type) => unloaded.types.has(type) && !ownTypes.has(type)) : [];
  if (unloaded && needMod.length > 0) {
    dependencyWarnings.push(`Doodads ${needMod.join(", ")} are the Campaign Mod's, which the map doesn't load: add ${unloaded.dependency} to the Blueprint's dependencies, or the Editor shows a placeholder for each.`);
  }
  const tilesetId = blueprint.tilesetId ?? "KorhalCityEx2";
  const { width, height } = blueprint.mapSize;
  const cellCount = width * height;

  await mkdir(outputDir, { recursive: true });
  // A converted conversation's parts, and the Equivalence Check its first compile writes them over their Kept originals under.
  const conversation = conversion && script ? conversationParts(script.script, conversion, outputDir, script.voiceFormat ?? DEFAULT_VOICE_FORMAT) : undefined;
  const conversationItems = conversation ? conversationItemNames(conversation) : undefined;
  // And the Kept triggers the Blueprint's own convert (ADR-0026), each part named once compileBlueprintTriggers finds them.
  const convertedTriggerParts = new Set<string>();
  const equivalence = conversation || authored ? new EquivalenceCheck(blueprint.acceptedDifferences ?? [], "Mission Blueprint") : undefined;
  const out = new PackageOutput(outputDir, options.previousRecord, options.decisions, equivalence?.replaceKept, {}, equivalence ? (name) => (conversationItems?.has(name) ?? false) || convertedTriggerParts.has(name) : undefined);
  out.adoptObjects(blueprint.anchors.flatMap((anchor) => (anchor.editorId !== undefined ? [anchor.editorId] : [])));
  // A line with two voice files neither is known to be the placeholder of (host/voice-files.ts).
  const voiceWarnings: string[] = [];
  // Whether the texture sets' CTerrain overrides go in TerrainData.xml: then the package needs its GameData component.
  let writesTerrainData = false;
  if (plan.keptFiles.length > 0) out.keep(plan.keptFiles);
  if (besideKept) {
    const { zones, changes } = besideKept;
    for (const entry of zones.entries) out.writeCells(entry.file, zones.files[entry.file], [entry]);
    // Texture sets change lines and blocks beyond the Zones' cells (ADR-0016): written even with no cell to own.
    if (zones.textureSetsChanged) {
      for (const file of ["t3Terrain.xml", "t3SyncTextureInfo"] as const) if (!zones.entries.some((entry) => entry.file === file)) out.writeCells(file, zones.files[file], []);
    }
    out.recordEntries(zones.textureSets);
    // Each set's tileset lists its textures in a map-local CTerrain override, or the Editor swaps them for the tileset's own (ADR-0016).
    // Written whenever the last compile wrote one too, so a dropped set's override goes.
    const hadTerrain = (options.previousRecord?.entries ?? []).some((entry) => entry.kind === "catalog-entry" && entry.file === TERRAIN_DATA && entry.id.startsWith("CTerrain:"));
    if (zones.textureSetTerrain.length > 0 || hadTerrain) {
      // A kept set's override stays as the package has it: rewritten as it stands, so the merge doesn't drop the entry it recorded.
      const terrainDataFile = path.join(outputDir, TERRAIN_DATA);
      const keptOverrides = zones.keptSetTilesets.length && existsSync(terrainDataFile)
        ? catalogEntries(await readFile(terrainDataFile, "utf8")).filter((entry) => entry.className === "CTerrain" && entry.id !== undefined && zones.keptSetTilesets.includes(entry.id)).map((entry) => `    ${entry.text.trim()}`)
        : [];
      out.write(TERRAIN_DATA, ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...zones.textureSetTerrain, ...keptOverrides, "</Catalog>", ""].join("\r\n"), "catalog");
      writesTerrainData = true;
    }
    out.addChanges(changes);
    if (besideKept.hiddenCells) out.recordEntries([besideKept.hiddenCells]);
    if (zones.doodadHeights.size > 0) out.amend("Objects", (text) => setDoodadHeights(text, zones.doodadHeights));
  }

  // Ours when the heights fit it, else wider, as the Editor saves a map with high cliffs.
  const quantization = heightQuantization(terrain.heights, terrain.cliffHeights);
  // A generated map's own texture sets (ADR-0016): their names, slots and blocks written into the terrain as planned.
  const textureSets = terrain.textureSets;
  const terrainXml = writeT3TerrainXml({
    tilesetId,
    width,
    height,
    textureSetIndex: 0,
    cliffCells: terrain.cliffCells,
    cliffSets: terrain.cliffSets,
    textures: missionTextures(catalog, blueprint),
    ramps: terrain.ramps,
    terrainObjects: terrain.terrainObjects,
    catalog,
    quantization,
  });
  const writtenTerrainXml = textureSets ? writeTextureSetXml(terrainXml, textureSets.before, textureSets.plan) : terrainXml;
  out.write("t3Terrain.xml", writtenTerrainXml);

  out.write(
    "t3HeightMap",
    writeT3HeightMap({
      width,
      height,
      heights: terrain.heights,
      cliffHeights: terrain.cliffHeights,
      cliffLevels: terrain.vertexCliffLevels,
      quantization,
    }),
  );

  out.write(
    "t3SyncHeightMap",
    writeT3SyncHeightMap({
      width,
      height,
      syncHeights: terrain.syncHeights,
      cliffLevels: terrain.vertexCliffLevels,
    }),
  );

  out.write(
    "t3SyncCliffLevel",
    writeT3SyncCliffLevel({
      width,
      height,
      syncCliff: terrain.syncCliff,
    }),
  );

  out.write(
    "t3TextureMasks",
    writeT3TextureMasks({
      width,
      height,
      textureWeights: terrain.textureWeights,
      texelWeights: terrain.texelWeights,
    }),
  );

  const textureNames = missionTextures(catalog, blueprint);

  const dominantTextureIndices = new Uint32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    let dominantLayer = 0;
    let dominantWeight = -1;
    for (let layer = 0; layer < 8; layer++) {
      const weight = terrain.textureWeights[cell * 8 + layer] ?? 0;
      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantLayer = layer;
      }
    }
    dominantTextureIndices[cell] = dominantLayer;
  }

  // With texture sets, set_count sets of 8 names, and each cell on its block's set.
  const setTextures = textureSets?.plan.textures;
  out.write(
    "t3SyncTextureInfo",
    writeT3SyncTextureInfo({
      width,
      height,
      textureSetCount: setTextures?.setCount ?? 1,
      textureNames: setTextures?.syncNames ?? textureNames,
      dominantTextureIndices,
      textureSetIndices: setTextures
        ? Uint32Array.from({ length: cellCount }, (_, cell) => setTextures.blockSets[blockOf(setTextures.blocksPerRow, cell % width, Math.floor(cell / width))]!)
        : new Uint32Array(cellCount).fill(0),
    }),
  );
  // Where the sets meet, the boundary needs cover, as beside Kept ground (#539).
  const textureSetWarnings = textureSets
    ? [...textureSets.warnings, ...setBoundaryWarnings(textureSets.plan, { ...textureSets.plan.textures, masks: texelMasks(width, height, terrain.texelWeights) }, terrain.cellFlags)]
    : [];

  // The hidden bit, as the Zones' hiddenCells say, but where the Editor changed it (src/map/hidden-cells-changes.ts).
  // Beside Kept terrain, zones-beside-kept.ts does this for the Zones' cells, and t3CellFlags is the package's.
  // A kept terrain file keeps t3CellFlags as the Editor saved it (PackageOutput), so the compile writes no bit of it.
  const discarded = Array.isArray(options.decisions?.discard) ? options.decisions.discard : [];
  const kept = Array.isArray(options.decisions?.keep) ? options.decisions.keep : [];
  const flagsKept =
    (options.previousRecord?.kept ?? []).some((entry) => entry.kind === "file" && entry.path.startsWith("t3") && !discarded.includes(entryName(entry))) || kept.some((name) => name.startsWith("file:t3"));
  const packageFlags = options.previousRecord && plan.owner("terrain") === "compile" ? await readCellFlagCells(outputDir, width, height) : undefined;
  const hidden = hiddenCells({ width, height, field: hiddenCellMask(blueprint, width, height), packageFlags, record: options.previousRecord, decisions: options.decisions });
  if (plan.owner("terrain") === "compile" && !flagsKept) {
    out.addChanges(hidden.changes);
    if (hidden.entry) out.recordEntries([hidden.entry]);
  }
  out.write(
    "t3CellFlags",
    writeT3CellFlags({
      width,
      height,
      // A cell the author kept takes the package's bit.
      flags: writeHiddenBit(packageFlags && hidden.writable.includes(0) ? writeHiddenBit(terrain.cellFlags, Uint8Array.from(packageFlags, (flags) => (flags & CELL_FLAG_HIDDEN ? 1 : 0))) : terrain.cellFlags, hidden.hidden, hidden.writable),
    }),
  );

  out.write("t3Water", t3WaterBuffer(blueprint));
  // Painted "no pathing": over dug pools, under solid doodads, and the author's own (map/compiled-pathing.ts);
  // like the Editor, no file when nothing is painted. Beside Kept terrain the file is the package's.
  const pathing = plan.owner("pathing") === "package" ? undefined : compiledPathing(blueprint, terrain, dressing.doodads, catalog, { includeDoodads: includeObjects });
  const cut = new Set<string>();
  const pathingWarnings = pathing ? [...pathing.warnings, ...pathingCutWarnings(blueprint, terrain, pathing, cut), ...pathWidthWarnings(blueprint, terrain, pathing, cut)] : blueprint.pathingPaint?.length ? ["pathingPaint isn't compiled beside Kept ground, whose CellAttribute_Pnp is the package's: paint pathing there in the Editor, or with edit_kept_terrain's block-pathing and clear-pathing"] : [];
  const noPathing = pathing?.cells ?? terrain.noPathing;
  if (noPathing.some((value) => value !== 0)) out.write("CellAttribute_Pnp", writeCellAttribute(noPathing));
  else await out.remove("CellAttribute_Pnp");

  // Beside Kept terrain both are the package's, and only the Blueprint's bounds.playable patches MapInfo (below).
  const playable = options.playableBounds ?? assumedPlayableBounds(blueprint);
  // Not a component: the game draws it as the minimap (black without it).
  out.write(
    "Minimap.tga",
    writeMinimapTga({ width, height, dominantLayers: dominantTextureIndices, playableBounds: playable }),
  );
  // The lighting regions' mask (light-regions.ts): like the Editor, no file when nothing is painted. Beside Kept terrain it's the package's.
  const lightingMap = lightingMapTga(blueprint);
  if (lightingMap) out.write(LIGHTING_MAP, lightingMap);
  else if (plan.owner("lightingMap") !== "package") await out.remove(LIGHTING_MAP);

  const players: MapInfoPlayer[] = melee
    ? [
        { id: 0, controller: "Neutral" },
        // Race Any and a random start are MapInfo's blanks: no race name and start location 0.
        ...melee.startLocations.map((_, index) => ({ id: index + 1, controller: "User" as const, team: -1 })),
        { id: 15, controller: "Hostile" },
      ]
    : [
        { id: 0, controller: "Neutral" },
        { id: 1, controller: "User", team: -1 },
        // Players 2-14 that own units (the enemy) are computer players, red, no AI script.
        ...enemyPlayers(blueprint, placed.units).map((id) => ({ id, controller: "Computer" as const, colorIndex: 1 })),
        { id: 15, controller: "Hostile" },
      ];
  out.write(
    "MapInfo",
    writeMapInfo({
      width,
      height,
      tilesetId,
      // Unexplored Areas: a Mission's start black (Black Mask) unless its Blueprint asks for grey or
      // the reduced radius, as Blizzard's campaign maps mostly do, and its Beats' reveals explore what
      // the story points at; a Melee Map's start grey (Grey Mask), which Map Status requires
      // (docs/reference/editor-and-engine.md, "Unexplored areas").
      fogType: MAPINFO_FOG[plan.melee ? "grey" : (blueprint.unexploredAreas ?? "black")],
      playableBounds: playable,
      players,
      ...(melee ? { speedMode: 0 as const, hideErrorsDuringTest: false } : {}),
    }),
  );

  // Beside Kept terrain MapInfo is the package's, and the Blueprint's bounds.playable sets its playable area in place (ADR-0015).
  const boundsNotes: string[] = [];
  if (melee === undefined) {
    const wanted = plan.owner("mapInfo") === "patch" ? playableBounds(blueprint, { keptTerrain: true }) : playable;
    if (wanted && !options.playableBounds) boundsNotes.push(...playableMarginWarnings(blueprint, wanted));
    // Every map-bounds entry the record lists: a compile cut short leaves the last one's beside the new.
    const previous = (options.previousRecord?.entries ?? []).filter((entry): entry is MapBoundsEntry => entry.kind === "map-bounds");
    // The rectangle the map plays in: beside Kept terrain the package's, unless the Blueprint sets one.
    let mapRect = wanted;
    if (plan.owner("mapInfo") === "patch" && (wanted || previous.length > 0)) {
      const mapInfo = (await keptMapInfo())!;
      const current = mapInfoBounds(mapInfo);
      const boundsPlan = planKeptBounds({ current, previous, wanted, decision: editorDecision(options.decisions ?? {}, MAP_BOUNDS_ENTRY_NAME) });
      if (boundsPlan.change) out.addChanges([boundsPlan.change]);
      if (boundsPlan.write) {
        out.patchKept("MapInfo", patchMapInfoBounds(mapInfo, boundsPlan.write));
        // The Kept minimap is black outside the bounds it was drawn for: masked to the new ones, or redrawn by an Editor save.
        const minimapFile = path.join(outputDir, "Minimap.tga");
        const minimap = existsSync(minimapFile) ? maskMinimap(await readFile(minimapFile), blueprint.mapSize, current, boundsPlan.write) : undefined;
        if (minimap?.content) out.patchKept("Minimap.tga", minimap.content);
        if (minimap?.warning) boundsNotes.push(minimap.warning);
      }
      if (boundsPlan.entry) out.recordEntries([boundsPlan.entry]);
      if (boundsPlan.warning) boundsNotes.push(boundsPlan.warning);
      mapRect = boundsPlan.write ?? current;
    } else if (plan.owner("mapInfo") === "patch") {
      // Only read for the checks: a MapInfo that can't be read costs them, not the compile.
      mapRect = await keptMapInfo()
        .then((buffer) => (buffer ? mapInfoBounds(buffer) : undefined))
        .catch(() => undefined);
    }
    if (mapRect) boundsNotes.push(...boundsFindings(blueprint, mapRect, options.triggerScenes ?? []));
  }

  out.write(
    "DocumentInfo",
    writeDocumentInfoXml({ dependencies }),
  );

  // The game client (Test Document) won't load a map without this; the Editor doesn't need it.
  out.write(
    "DocumentHeader",
    writeDocumentHeader({
      dependencies,
      documentId: stableObjectId(blueprint.id),
      attributes: {
        "DocInfo/Name": blueprint.title,
        "DocInfo/DescLong": blueprint.summary ?? blueprint.setting,
        "DocInfo/DescShort": blueprint.setting,
        ...(melee
          ? // The Editor numbers these by the player's place in MapInfo, not its id.
            Object.fromEntries(players.map((player, index) => [`MapInfo/Player${String(index).padStart(2, "0")}/Name`, playerName(player)]))
          : {
              "MapInfo/Player00/Name": "Neutral",
              "MapInfo/Player01/Name": "Player 1",
              "MapInfo/Player15/Name": "Hostile",
            }),
      },
    }),
  );

  // Same order as an Editor-saved map's ComponentList.
  const components: { type: string; path: string; locale?: string }[] = [];
  // Mechanics' catalogs come with the blueprint's triggers; explicit gameData wins on a clash.
  // Beside Kept terrain an unconverted conversation is the package's own, and the compile warns (compileMission).
  if (blueprint.screenplay.script && includeTriggers && !triggerOverride && !script && !(plan.besideKept && !conversion)) {
    throw new Error("The blueprint's screenplay references a script; pass `script` to writeMapPackage");
  }
  // Each Plugin Mechanic's buildGameData hook runs once for this compile, for its catalogs, strings and hotkeys.
  // Beside Kept terrain the map's data is Kept Content, edited in place: the compile writes none.
  const compilesData = includeTriggers && !triggerOverride && plan.owner("missionData") === "compile";
  const mechanicData = compilesData ? buildMechanicGameData(blueprint) : [];
  const gameDataFiles = Object.entries({
    ...(compilesData ? buildMissionGameData(blueprint, mechanicData, cinematicLights) : {}),
    ...(script && !conversation
      ? { "ConversationData.xml": conversationDataXml(script.script), "SoundData.xml": soundDataXml(script.script, script.voiceFormat ?? DEFAULT_VOICE_FORMAT) }
      : {}),
    ...gameData,
  });
  // Each set's tileset lists its textures in a map-local CTerrain override, or the Editor swaps them for the tileset's own (ADR-0016).
  if (textureSets) {
    const entries = textureSetTerrainEntries(textureSets.plan);
    const at = gameDataFiles.findIndex(([fileName]) => fileName === "TerrainData.xml");
    if (at < 0) gameDataFiles.push(["TerrainData.xml", ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...entries, "</Catalog>", ""].join("\r\n")]);
    else {
      const [fileName, content] = gameDataFiles[at]!;
      const end = content.lastIndexOf("</Catalog>");
      if (end < 0) throw new Error("TerrainData.xml has no </Catalog> for the texture sets' CTerrain overrides to go before");
      gameDataFiles[at] = [fileName, `${content.slice(0, end)}${entries.join("\r\n")}\r\n${content.slice(end)}`];
    }
  }
  // A converted conversation goes into the Kept catalogs by entry, beside the package's other entries.
  const removedParts: string[] = [];
  if (conversation && script) {
    // What it no longer plays goes, so no junk stays: each Sound the package's conversation plays and
    // the Screenplay's doesn't, with its recording, and each dropped line's or scene's string. A Sound
    // a Kept trigger names stays, as it still plays there: one the compile wrote last time is written again.
    const read = async (name: string): Promise<string> => readFile(path.join(outputDir, ...name.split("/")), "utf8").catch(() => "");
    const current = catalogEntries(await read(CONVERSATION_DATA)).find((entry) => entry.key === `CConversation:${script.script.conversationId}`);
    const orphans = current ? orphanedParts(current.text, script.script, conversion!) : { sounds: [], strings: [] };
    const named = await keptTriggersName(outputDir, options.previousRecord);
    const sounds = orphans.sounds.filter((sound) => !named(sound));
    const stays = orphans.sounds.filter(named);
    const soundData = await read(SOUND_DATA);
    // Every CSound the compile wrote last time and no longer writes that a Kept trigger names, this time's orphans and earlier ones alike.
    const writing = new Set(catalogEntries(conversation.soundData).map((entry) => entry.key));
    const carried = catalogEntries(soundData).filter(
      (entry) =>
        entry.className === "CSound" &&
        entry.id !== undefined &&
        !writing.has(entry.key) &&
        named(entry.id) &&
        (options.previousRecord?.entries ?? []).some((recorded) => recorded.kind === "catalog-entry" && recorded.file === SOUND_DATA && recorded.id === entry.key),
    );
    const written = carried.length > 0 ? conversation.soundData.replace("</Catalog>", `${carried.map((entry) => entry.text).join("\r\n")}\r\n</Catalog>`) : conversation.soundData;
    out.write(CONVERSATION_DATA, conversation.conversationData, "catalog");
    out.write(SOUND_DATA, written, "catalog");
    for (const sound of stays) removedParts.push(`Kept the Sound ${sound}, which the conversation no longer plays, since a Kept trigger names it`);
    if (current) {
      if (sounds.length > 0) out.amend(SOUND_DATA, (text) => withoutEntries(text, new Set(sounds.map((sound) => `CSound:${sound}`))));
      const recordings = sounds.flatMap((sound) => {
        const kept = keptVoiceFile(outputDir, sound);
        return kept ? [kept.file] : [];
      });
      out.removeKept([
        ...recordings.map((file) => ({ kind: "file" as const, path: file })),
        ...orphans.strings.map((key) => ({ kind: "string" as const, file: `enUS.SC2Data/LocalizedData/ConversationStrings.txt`, key })),
      ]);
      if (sounds.length > 0) removedParts.push(`Removed ${sounds.length} Sound(s) the conversation no longer plays, with ${recordings.length} recording(s): ${sounds.join(", ")}`);
      if (orphans.strings.length > 0) removedParts.push(`Removed the string(s) of ${orphans.strings.length} dropped line(s) or scene(s): ${orphans.strings.join(", ")}`);
    }
  }
  // The Blueprint's own doodads (custom-doodads.ts): their files at their storage paths, and a CModel
  // and a CActorDoodad each (and a CTexture per swap), in the catalog file the compile writes, else merged by entry beside the Kept ones.
  // Doodads a recipe makes from a model are the map's own, not the catalog's.
  const ownActors = new Set(compositeActors(blueprint).map((actor) => actor.id));
  // Only with the objects that place them: a terrain-only package has no use for them.
  const ownDoodads = includeObjects ? blueprint.doodads : [];
  if (ownDoodads.length > 0 && !options.doodadFiles) throw new Error(`${blueprint.id} declares doodads: pass their files (missionDoodadFiles) to writeMapPackage`);
  if (ownDoodads.length > 0) for (const file of options.doodadFiles ?? []) out.write(file.path, file.data);
  const doodadEntries = ownDoodads.flatMap((doodad) => {
    const swaps = options.doodadSwaps?.get(doodad.id);
    if (doodad.swaps.length > 0 && !swaps) throw new Error(`${blueprint.id}'s doodad ${doodad.id} swaps textures: pass its swaps' slots (missionDoodadFiles) to writeMapPackage`);
    return customDoodadEntries(doodad, swaps);
  });
  const clash = ownDoodads.find((doodad) => ownActors.has(doodad.id));
  if (clash) throw new Error(`The Blueprint's doodad ${clash.id} has the id of a Composite's actor: give one of them another id`);
  let writesDoodadData = false;
  for (const [fileName, catalogName] of [["ModelData.xml", "Model"], ["ActorData.xml", "Actor"], ["TextureData.xml", "Texture"]] as const) {
    const entries = doodadEntries.filter((entry) => entry.catalog === catalogName).map(entryXml);
    if (entries.length === 0) continue;
    // A file the compile writes whole has the CRLF lines of the rest of its catalogs.
    const lines = entries.map((entry) => entry.replace(/\n/g, "\r\n"));
    const at = gameDataFiles.findIndex(([name]) => name === fileName);
    if (at >= 0) {
      const [name, content] = gameDataFiles[at]!;
      const end = content.lastIndexOf("</Catalog>");
      if (end < 0) throw new Error(`${name} has no </Catalog> for the Blueprint's doodads to go before`);
      gameDataFiles[at] = [name, `${content.slice(0, end)}${lines.join("\r\n")}\r\n${content.slice(end)}`];
    } else if (plan.owner("doodadCatalogs") === "patch") {
      out.write(`Base.SC2Data/GameData/${fileName}`, `<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n${entries.map((entry) => `${entry}\n`).join("")}</Catalog>\n`, "catalog");
      writesDoodadData = true;
    } else gameDataFiles.push([fileName, ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...lines, "</Catalog>", ""].join("\r\n")]);
  }
  const placedDoodadWarnings: string[] = [];
  const customData = plan.melee ? gameDataFiles.map(([fileName]) => fileName).filter((fileName) => !MELEE_CATALOGS.has(fileName)) : [];
  if (customData.length > 0) throw new Error(`A melee map can't carry ${customData.join(", ")}: the Editor would call it Custom`);
  if (gameDataFiles.length > 0 || conversation || writesTerrainData || writesDoodadData) {
    for (const [fileName, content] of gameDataFiles) out.write(`Base.SC2Data/GameData/${fileName}`, content);
    components.push({ type: "gada", path: "GameData" });
  }
  if (includeTriggers || conversation) {
    components.push({ type: "text", path: "GameText", locale: "enUS" });
  }
  components.push({ type: "info", path: "DocumentInfo" }, { type: "mapi", path: "MapInfo" });
  if (includeTriggers) {
    components.push({ type: "trig", path: "Triggers" });
  }
  components.push({ type: "terr", path: "t3Terrain.xml" });
  if (Object.keys(cutscenes).length > 0) {
    for (const [name, xml] of Object.entries(cutscenes)) out.write(`Base.SC2Data/Cutscenes/${name}.SC2Cutscene`, xml);
    // The Editor's own stamp, not a component version (compile-cutscene writes the same).
    out.write("Base.SC2Data/Cutscenes/Index.version", INDEX_VERSION, "version");
    components.push({ type: "cuts", path: "Cutscenes/Index" });
  }

  if (includeObjects) {
    for (const anchor of blueprint.anchors) {
      if (anchor.kind === "doodad") checkDoodad(catalog, anchor.id, anchor.doodadType, anchor.variation);
    }
    for (const doodad of dressing.doodads) if (!ownActors.has(doodad.type)) checkDoodad(catalog, doodad.id, doodad.type, doodad.variation);
    // The Kept doodads the Editor placed (not the last compile's, checked above): each type must be a doodad, or the Editor shows a placeholder.
    if (plan.besideKept) {
      const compiledObjects = options.previousRecord ? recordedIds(options.previousRecord, "object") : new Set<number>();
      placedDoodadWarnings.push(...unknownPlacedDoodads(await readFile(path.join(outputDir, "Objects"), "utf8").catch(() => ""), catalog, compiledObjects));
    }
    out.write(
    "Objects",
      writeObjectsXml({
        // Nothing for a Wave's unit's Anchor, which has no position: its send creates the unit.
        anchors: blueprint.anchors.filter(isPlaced).map((anchor) => ({
          id: anchorObjectId(anchor),
          name: anchor.name,
          zoneId: anchor.zoneId,
          kind: anchor.kind,
          // Doodads sit at the absolute terrain height; units use 0 (snap to ground).
          position: {
            x: anchor.position.x,
            y: anchor.position.y,
            z: anchor.position.z ?? (anchor.kind === "doodad" ? groundAt(anchor.position.x, anchor.position.y) : 0),
          },
          rotation: anchor.rotation ?? (anchor.kind === "doodad" ? anchorDoodadDefaults(anchor.id).rotation : 0),
          pitch: anchor.pitch,
          roll: anchor.roll,
          scale: (anchor.scale ?? (anchor.kind === "doodad" ? anchorDoodadDefaults(anchor.id).scale : undefined)) as
            | number
            | readonly [number, number, number]
            | undefined,
          unitType: anchor.unitType,
          player: anchor.player,
          pointType: anchor.pointType,
          cameraTarget: anchor.cameraTarget,
          cameraValues: anchor.cameraValues,
          doodadType: anchor.doodadType,
          variation: anchor.variation,
          tint: anchor.tint,
          forcePlacement: anchor.forcePlacement,
          resources: anchor.resources,
          flags: anchor.flags,
          // Enemy heroes and camp Sentries stay home and aren't rebuilt.
          ai: anchor.kind === "unit" && anchor.unitType && anchor.player !== undefined && anchor.player >= 2 ? unitAi(aiSettings, anchor.unitType) : undefined,
        })).concat(
          // A melee map's start locations, named as the Editor names them.
          (melee?.startLocations ?? []).map((start, index) => ({
            id: stableObjectId(`${blueprint.id}/start/${index}`),
            name: `Start Location ${String(index + 1).padStart(3, "0")}`,
            zoneId: "",
            kind: "point" as const,
            position: { x: start.x, y: start.y, z: 0 },
            rotation: 0,
            pitch: undefined,
            roll: undefined,
            scale: undefined,
            unitType: undefined,
            player: undefined,
            pointType: "StartLoc",
            cameraTarget: undefined,
            cameraValues: undefined,
            doodadType: undefined,
            variation: undefined,
            tint: undefined,
            forcePlacement: undefined,
            resources: undefined,
            flags: undefined,
            ai: undefined,
          })),
          // Resource bases and encounter groups with `at`, as placed units.
          placed.units.map((unit) => ({
            id: stableObjectId(unit.id),
            name: unit.id,
            zoneId: unit.zoneId,
            kind: "unit" as const,
            position: { x: unit.x, y: unit.y, z: 0 },
            rotation: unit.rotation,
            pitch: undefined,
            roll: undefined,
            scale: undefined,
            unitType: unit.unitType,
            player: unit.player,
            pointType: undefined,
            cameraTarget: undefined,
            cameraValues: undefined,
            doodadType: undefined,
            variation: undefined,
            tint: undefined,
            forcePlacement: undefined,
            resources: unit.resources,
            flags: undefined,
            ai: unit.ai,
          })),
          // Dressing doodads (DL-05, DL-06), placed at the terrain height like doodad anchors.
          dressing.doodads.map((doodad) => ({
            id: stableObjectId(doodad.id),
            name: doodad.id,
            zoneId: doodad.setPieceId ?? "",
            kind: "doodad" as const,
            position: { x: doodad.x, y: doodad.y, z: doodad.z },
            rotation: doodad.rotation,
            pitch: doodad.pitch,
            roll: doodad.roll,
            scale: doodad.scale,
            unitType: undefined,
            player: undefined,
            pointType: undefined,
            cameraTarget: undefined,
            cameraValues: undefined,
            doodadType: doodad.type,
            variation: doodad.variation,
            tint: doodad.tint,
            forcePlacement: doodad.forcePlacement,
            resources: undefined,
            flags: doodad.flags ? [...doodad.flags] : undefined,
            ai: undefined,
          })),
        ),
      }),
      "objects",
    );
    components.push({ type: "plob", path: "Objects" });
  }

  // Compiled regions keep their numbers unless a Kept region holds one; the triggers follow (ADR-0010).
  const regions = includeRegions ? missionRegions(blueprint, dressing.setPieces, waveWarningRegions(blueprint), boundsRegions(blueprint)) : [];
  const regionIds = numberRegions(regions.length, await keptRegionIds(outputDir, options.previousRecord));
  if (includeRegions) {
    out.write("Regions", writeRegionsXml({ regions, ids: regionIds }), "regions");
    components.push({ type: "regi", path: "Regions" });
  }

  if (includeTriggers) {
    const built = triggerOverride ?? keptTriggers ?? buildMissionTriggers(resolved, {
        ...(script ? { script: script.script } : {}),
        ...(options.library ? { library: options.library } : {}),
        ...(options.triggerScenes ? { triggerScenes: options.triggerScenes } : {}),
      });
    // A Beat's bounds regions are named by their source, from where they were written.
    const boundsIds = regions.flatMap((region, index) => (region.source.kind === "bounds" ? [regionIds[index]!] : []));
    const triggers = includeRegions ? renumberRegions(built, regionIds, boundsIds) : built;
    if (options.previousRecord) {
      // A Compiled trigger the author kept is the compile's own name, which it no longer writes.
      const compiled = recordedItemKeys([...options.previousRecord.entries, ...(options.previousRecord.kept ?? [])], ["trigger", "variable"]);
      await refuseKeptScriptNames(outputDir, compiled, triggers);
    }
    const generated = {
      triggers: writeTriggersXml(triggers),
      script: writeMapScript({ mapName: blueprint.title, triggers, ...(options.libraries ? { libraries: options.libraries } : {}), ...(authored ? { uses: [...blueprintTriggerLibraries(authored)] } : {}) }),
      names: triggerNameStrings(triggers),
    };
    // The Blueprint's own triggers go in beside the compile's, among the Kept elements they may name (ADR-0026).
    // A hold on a Blueprint trigger (one converted from Kept) switches its start off in its body, as applyKeptHolds does a Kept one's (ADR-0014).
    const withAuthored = authored ? compileBlueprintTriggers({ ...authored, triggers: holdBlueprintTriggers(authored.triggers, keptHolds(resolved)) }, generated, { ...(options.libraries ? { libraries: options.libraries } : {}), ...(await keptTriggersOf(outputDir, options.previousRecord)) }) : undefined;
    if (withAuthored && authored) {
      // Written where the package has them, a converted one in place of its Kept original, under the Equivalence Check.
      out.placeTriggers([...authored.triggers.map(({ trigger }) => `Trigger/${trigger.id}`), ...(authored.variables ?? []).map((variable) => `Variable/${variable.id}`), ...authored.folders.map((folder) => `Category/${folder.id}`)]);
      for (const { id, scriptName, disabled } of withAuthored.converted) {
        convertedTriggerParts.add(`trigger:${id}`);
        if (!disabled) for (const block of ["trigger-variable", "trigger", "trigger-init"]) convertedTriggerParts.add(`galaxy:MapScript.galaxy:${block}:${scriptName}`);
      }
    }
    out.write("Triggers", withAuthored?.triggers ?? generated.triggers, "triggers");
    out.write("MapScript.galaxy", withAuthored?.script ?? generated.script, "mapscript");

    const localized = "enUS.SC2Data/LocalizedData";
    out.write(
      `${localized}/GameStrings.txt`,
      writeStringsFile(
        mergeStrings(
          {
            // Beside Kept terrain the map's name and descriptions are the package's own.
            ...(plan.owner("missionData") === "package"
              ? {}
              : { "DocInfo/Name": blueprint.title, "DocInfo/DescLong": blueprint.summary ?? blueprint.setting, "DocInfo/DescShort": blueprint.setting }),
            ...triggerTextStrings(triggers),
            ...withAuthored?.gameStrings[`${localized}/GameStrings.txt`],
          },
          triggerOverride || plan.owner("missionData") === "package" ? {} : buildMissionGameStrings(blueprint, mechanicData),
        ),
      ),
      "strings",
    );
    out.write(`${localized}/TriggerStrings.txt`, writeStringsFile({ ...generated.names, ...withAuthored?.triggerStrings }), "strings");
    // A Blueprint trigger's words in another locale's GameStrings.
    for (const [file, strings] of Object.entries(withAuthored?.gameStrings ?? {})) if (file !== `${localized}/GameStrings.txt`) out.write(file, writeStringsFile(strings), "strings");
    const hotkeys = triggerOverride || plan.owner("missionData") === "package" ? {} : buildMissionGameHotkeys(blueprint, mechanicData);
    if (Object.keys(hotkeys).length > 0) {
      out.write(`${localized}/GameHotkeys.txt`, writeStringsFile(hotkeys), "strings");
    }
  }
  if (script && (includeTriggers || conversation)) {
    const localized = "enUS.SC2Data/LocalizedData";
    out.write(`${localized}/ConversationStrings.txt`, writeStringsFile(conversation ? conversation.strings : conversationStrings(script.script)), "strings");
    // Voice files sit in the map folder by path, as in Editor-saved maps; they aren't a component.
    // Each is in the Mission's voice format: a .wav is encoded to .ogg for an "ogg" Mission (host/voice-files.ts).
    // A converted conversation's imported Sounds play their Kept recordings, already in the package.
    const format = script.voiceFormat ?? DEFAULT_VOICE_FORMAT;
    const lines = scriptLines(script.script).filter((line) => !conversion || voicedHere(conversion, line));
    const voices = await packageVoiceFiles(script.audioDir, lines.map((line) => line.soundId), format, options.derive ?? machineDerive(emptyMachineConfig()));
    voiceWarnings.push(...voices.warnings);
    for (const line of lines) {
      const content = voices.files.get(line.soundId);
      if (content) out.write(voiceAssetPath(line, format).split(path.sep).join("/"), content);
    }
    if (voices.missing.length > 0) {
      // compileMission writes a placeholder for every line first, so only a direct caller (with its own audio folder) gets here.
      throw new Error(`${voices.missing.length} voice file(s) missing in ${script.audioDir} (e.g. ${voices.missing[0]}): put an .ogg or .wav per line there, or compile with compile_map or npm run compile-map, which write placeholders for missing lines`);
    }
  }

  // A held Kept trigger's start is switched off in the package, and back on once no hold keeps it (ADR-0014).
  const holdNotes: string[] = [];
  const previousHolds = (options.previousRecord?.entries ?? []).filter((entry): entry is KeptHoldEntry => entry.kind === "kept-hold");
  const holds = keptHolds(resolved);
  // A hold whose call sits in a Blueprint trigger is switched off in its body (holdBlueprintTriggers), so only the others need the package's Kept triggers.
  const anyHoldInPackage = holds.some((hold) => !blueprintTriggers.has((hold.from ?? hold.trigger).id)) || previousHolds.some((entry) => !blueprintTriggers.has(entry.trigger));
  if (buildsMissionTriggers && anyHoldInPackage) {
    const holdsRefusal = plan.holdsRefusal(existsSync(path.join(outputDir, "Triggers")));
    if (holdsRefusal) throw new Error(holdsRefusal);
    const read = (file: string): Promise<string> => readFile(path.join(outputDir, ...file.split("/")), "utf8");
    const names = triggerStringNames(existsSync(path.join(outputDir, ...TRIGGER_STRINGS.split("/"))) ? await read(TRIGGER_STRINGS) : "");
    const held = applyKeptHolds(await read("Triggers"), await read("MapScript.galaxy"), names, holds, previousHolds, options.previousRecord ? recordedIds(options.previousRecord, "trigger") : new Set(), blueprintTriggers);
    // Merged with the Compiled triggers when there are any; written as they are when the compile writes none.
    out.amendKept("Triggers", () => held.triggers, { merged: true });
    out.amendKept("MapScript.galaxy", () => held.script, { merged: true });
    out.recordEntries(held.entries);
    holdNotes.push(...held.notes);
  }

  // A Kept cutscene playing a converted line by the Kept recording of the words it had links the line's own Sound now.
  const relinks: string[] = [];
  if (conversation && script) {
    const sounds = ownSounds(script.script, conversion!);
    const compiledFiles = new Set((options.previousRecord?.entries ?? []).flatMap((entry) => (entry.kind === "file" ? [entry.path] : [])));
    for (const name of await packageFilesBelow(path.join(outputDir, CUTSCENES_DIR), ".SC2Cutscene")) {
      const file = `${CUTSCENES_DIR}/${name}`;
      if (compiledFiles.has(file) || cutscenes[name.replace(/\.SC2Cutscene$/i, "")] !== undefined) continue;
      const { relinked } = relinkCutscene(await readFile(path.join(outputDir, ...file.split("/")), "utf8"), script.script.conversationId, sounds);
      if (relinked.length === 0) continue;
      out.amendKept(file, (text) => relinkCutscene(text, script.script.conversationId, sounds).text);
      relinks.push(`Relinked the Kept cutscene ${file}: ${relinked.map((relink) => `${relink.line} ${relink.from} → ${relink.to}`).join(", ")}, since those lines' words changed`);
    }
  }

  for (const component of components) {
    // Cutscenes/Index.version is the Editor's own stamp, written above.
    if (component.type === "cuts") continue;
    out.write(componentVersionFileName(component.path), writeComponentVersion({ type: component.type, savedAt }), "version");
  }

  const componentLines = components.map(
    (component) =>
      `  <DataComponent Type="${component.type}"${component.locale ? ` Locale="${component.locale}"` : ""}>${component.path}</DataComponent>`,
  );
  out.write(
    "ComponentList.SC2Components",
    `<?xml version="1.0" encoding="utf-8"?>\n<Components>\n  <Optimized/>\n${componentLines.join("\n")}\n</Components>\n`,
    plan.componentListKind,
  );

  const record = await out.finish(options.dryRun ? undefined : options.saveRecord, { dryRun: options.dryRun ?? false, ...(equivalence ? { beforeWrite: () => equivalence.assertPassed() } : {}) });

  return {
    record,
    warnings: [
      ...out.unusedKept.map((entry) => describeUnusedKept(entry, blueprint)),
      ...relinks,
      ...holdNotes,
      ...removedParts,
      ...(equivalence?.unneeded ?? []).map(({ item }) => `acceptedDifferences names ${item}, which the compile writes as the Editor had it: the difference is gone, so it can come out`),
      ...(besideKept?.warnings ?? []),
      ...dependencyWarnings,
      ...terrain.textureWarnings,
      ...textureSetWarnings,
      ...terrain.terrainObjectWarnings,
      ...(besideKept ? [] : terraceNotes(terrain.terraces)),
      ...dressing.warnings,
      ...compositeActorWarnings(compositeActors(blueprint), await catalogModelAnims(catalog)),
      ...pathingWarnings,
      ...placed.warnings,
      ...placedDoodadWarnings,
      ...voiceWarnings,
      ...boundsNotes,
      // The mask warnings say whether they need the triggers (keptMaskWarnings' `reveals`): a mismatch with the Kept package doesn't.
      ...maskWarnings,
      ...(includeTriggers && !triggerOverride ? [...waveWarnings(blueprint), ...revealWarnings(blueprint), ...beatOrderWarnings(blueprint), ...boundsWarnings(blueprint), ...buildMechanicWarnings(blueprint)] : []),
      ...(includeTriggers && plan.besideKept && blueprint.mechanics.length > 0
        ? ["Mechanics' game data, strings and hotkeys aren't compiled beside Kept terrain: the map's data is Kept Content, so only their triggers are written"]
        : []),
      ...unknownLightWarnings(blueprint),
      ...lightRegionWarnings(blueprint),
      ...skyWarnings(blueprint, terrain.syncCliff),
      ...waterWarnings(blueprint, terrain),
    ],
  };
}

/** The ids of the package's Kept regions: those in its Regions that the previous compile didn't write. None without a record. */
async function keptRegionIds(outputDir: string, previousRecord: CompileRecord | undefined): Promise<Set<number>> {
  const file = path.join(outputDir, "Regions");
  if (!previousRecord || !existsSync(file)) return new Set();
  // A region the author kept from the compile holds its own number: the Blueprint still declares it there.
  const recorded = recordedIds(previousRecord, "region");
  return new Set(readRegionsXml(await readFile(file, "utf8")).flatMap((region) => (recorded.has(region.id) ? [] : [region.id])));
}

/** A player's name as the Editor gives it. */
function playerName(player: MapInfoPlayer): string {
  return player.controller === "Neutral" ? "Neutral" : player.controller === "Hostile" ? "Hostile" : `Player ${player.id}`;
}

/**
 * The package's Triggers the Blueprint's own triggers are compiled beside, with its names and the
 * previous compile's items in it, which aren't Kept: none on a first compile, which writes the file whole.
 */
async function keptTriggersOf(outputDir: string, record: CompileRecord | undefined): Promise<{ readonly kept?: KeptTriggers }> {
  const file = path.join(outputDir, "Triggers");
  if (!record || !existsSync(file)) return {};
  const strings = path.join(outputDir, ...TRIGGER_STRINGS.split("/"));
  return {
    kept: {
      triggers: await readFile(file, "utf8"),
      names: triggerStringNames(existsSync(strings) ? await readFile(strings, "utf8") : ""),
      compiled: recordedItemKeys(record.entries),
    },
  };
}
