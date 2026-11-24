// What a Plugin's code imports from core, as `@team-antioch/sc2-adjutant/plugin-sdk`: the plugin API, the typed GUI
// trigger primitives (ADR-0002) that Mechanics build their triggers from, the types a Mechanic
// contributes its own primitives with, the types a Campaign Pack names its Screenplays with, the
// types a Style Pack's rules fill the dresser's and painter's slots with, and what a Host
// Adapter's capabilities take, return and read and write images with, and the WhiteoutFlakes
// viewer driver the macOS and Windows Host Adapters render and export models with.

export { type GameSystem, ownedGame, QUIT_GRACE_SECONDS, quitOwnedGame, refuseForeignGame, sameGame, stillRuns } from "../host/game-ownership.js";
export {
  CAPTURE_MAPS_FOLDER,
  FOREIGN_GAME_REFUSAL,
  type GameProcess,
  type CaptureTourRequest,
  type CaptureTourResult,
  type HostContext,
  modelNotFound,
  type ChoosePieces,
  type CliffPileShape,
  type CliffTexturePair,
  type ConnectionState,
  type CutsceneSourceKind,
  defineMechanic,
  type Footprint,
  type LineNamingContext,
  type Mechanic,
  type MechanicConnectionChange,
  type MechanicContext,
  type MechanicEntryContext,
  type MechanicGameData,
  type MechanicMomentRef,
  type MechanicIssue,
  type MechanicPlacedUnit,
  type MechanicPrimitives,
  type MechanicThreat,
  type MechanicThreatContext,
  type MechanicTriggerContext,
  type MechanicTriggers,
  type NamingTemplate,
  type PilePiece,
  type PileRole,
  type PluginCode,
  type PluginLight,
  type ScaleRange,
  type ScreenplayNamingContext,
  type ScreenplayRequest,
  type ScreenplaySource,
  type Schedule,
  type ShorePileShape,
  type StampedComposite,
  type StyleRandom,
  type StyleRule,
  type StyleRuleSlot,
  type StyleRuleSlots,
  type ThreatConsequence,
} from "./plugin-api.js";
export type { CliffPile, DressingMember } from "../domain/mission-blueprint.js";
export { slugId } from "../domain/mission-blueprint.js";
export { COUNTDOWN_TELEGRAPH } from "../domain/threat.js";
export { findPackageFile, packageAssetRoots, type PackageFile } from "../catalog/package-files.js";
export { readM3MaterialTextures, readM3TexturePaths, type M3LayerSlot, type M3MaterialTextures } from "../catalog/m3-textures.js";
export { readPng, type RgbaImage } from "../preview/read-png.js";
export { exportGltfWithViewer, exportWithViewer, renderWithViewer, stageModel, type TexturePlacement, type ViewerRun, viewerRendererKey, WorkerPool } from "../host/whiteoutflakes.js";
export { writeRgbaPng } from "../preview/write-png.js";
export { regionIdForZone } from "../map/write-regions-xml.js";
export { stableObjectId } from "../map/stable-object-id.js";
export {
  behaviorLink,
  block,
  call,
  callValue,
  pickedUnit,
  setLighting,
  stableElementId,
  triggeringUnit,
  triggerVariable,
  turnOffCurrentTrigger,
  USER_PLAYER,
} from "../triggers/build-mission-triggers.js";
export { compare, debugMessage, type DebugPiece, ifThen, runTrigger, titleWords, unitIsAlive } from "../triggers/trigger-builders.js";
export { NTVE_FUNCTIONS, NTVE_PRESETS, SUB_FUNCTIONS, type FunctionDef, type ParamDef, type PresetDef, type SubFunctionDef } from "../triggers/trigger-catalog.js";
export type { ElementId, Trigger, TriggerBlock, TriggerCall, TriggerParam, TriggerVariable } from "../triggers/trigger-model.js";
// For a Utility that builds test maps (anim-testbed): the game's packages' ids, the Workspace's own
// sounds and recorded animations, a model's clips, writing a script into a map, and running a
// capture tour through the Editor Broker.
export { packageEntries, packageName, type PackageEntries } from "../map/game-packages.js";
export { gameUnitIds } from "../catalog/tech-catalog.js";
export { readM3Sequences, type M3Sequence } from "../catalog/m3-sequences.js";
export { catalogModelAnims, type ModelAnims } from "../catalog/model-anims.js";
export { definedSounds, workspaceSounds } from "../mods/sound-mix.js";
export { withCustomScript, withCustomScriptInMapScript } from "../triggers/custom-script.js";
export { writeMapScript } from "../triggers/write-map-script.js";
export { workspaceFor, workspaceRootFor, type Workspace } from "./workspace.js";
export { loadHost, requireCapability } from "../host/host.js";
export { loadMachineConfig } from "../host/machine-config.js";
export { runBrokeredCapture } from "../capture/editor-broker-client.js";
