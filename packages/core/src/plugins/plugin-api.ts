// The plugin API (ADR-0005): what a Plugin's code entry point exports, and what the rest of the
// mapper asks of the registry. Hooks are pure functions from a read-only context to typed data, so
// a sandbox can be added later without changing the contract.

import { bindCatalog, blueprintCatalog } from "../catalog/catalog-layer.js";
import type { z } from "zod";

import type { CliffPile, Composite, DressingMember, MissionBlueprint, MissionLight, PlacedAnchor } from "../domain/mission-blueprint.js";
import type { MechanicConnectionChange } from "../domain/schedule.js";
import type { PlacedUnit } from "../map/expand-placements.js";
import type { MechanicThreat } from "../domain/threat.js";
import type { FunctionDef, PresetDef, SubFunctionDef } from "../triggers/trigger-catalog.js";
import type { ParamValue, Trigger, TriggerCall, TriggerVariable } from "../triggers/trigger-model.js";
import type { UiActionContext } from "../ui/ui-component.js";

export type { ConnectionState, MechanicConnectionChange } from "../domain/schedule.js";
export type { Footprint, MechanicThreat, Schedule, ThreatConsequence } from "../domain/threat.js";

/** The plugin API this core provides; a manifest that pins another version is refused. */
export const PLUGIN_API_VERSION = 2;

export const PLUGIN_ROLES = ["campaign-pack", "style-pack", "host-adapter", "utility"] as const;
export type PluginRole = (typeof PLUGIN_ROLES)[number];

/** The parts of the Mission Blueprint a Mechanic's hooks can read. */
export type MechanicContext = {
  readonly zones: MissionBlueprint["zones"];
  /** The Anchors on the map: all but a Wave's unit's, which has no position until its send creates it. */
  readonly anchors: readonly PlacedAnchor[];
  /**
   * The Anchors Waves' units bind (a unit entry's `anchorId`), left out of `anchors`: each isn't
   * on the map until its send creates it, so a Mechanic that needs its unit from the start can say so.
   */
  readonly waveUnitAnchorIds: ReadonlySet<string>;
  readonly beats: MissionBlueprint["beats"];
  readonly regions: MissionBlueprint["regions"];
  /**
   * Every `mechanics[]` entry's id, type and params as the Blueprint writes them (unparsed), for a
   * Mechanic that builds on another (capture on the sun) or checks its entries against each other.
   */
  readonly mechanics: readonly { readonly id: string; readonly type: string; readonly params: unknown }[];
  /** The CLight the Mission plays in: its `lighting`, else its tileset's own. */
  readonly light: string;
  /** Whether a behaviour id (a CBehavior of any class) is the game's or the Campaign Mod's, as the Catalog knows them, or one a Mechanic's `behaviorIds` declares its game data defines. */
  knowsBehavior(id: string): boolean;
  /**
   * The units the built Placements place, where the compile puts them (a resource base's
   * Assimilators, a camp's Pylon). A trigger refers to one as `stableObjectId(unit.id)`.
   * Expanding them parses the Placements' params, which a `validate` hook can't count on yet, so
   * read it from the other hooks only.
   */
  placedUnits(): readonly MechanicPlacedUnit[];
};

/** One of a Mechanic entry's moments: the entry's id and one of its Mechanic's `cues`. */
export type MechanicMomentRef = { readonly mechanicId: string; readonly cue: string };

/** What the hooks that run per `mechanics[]` entry read: the context, and that entry's id. */
export type MechanicEntryContext = MechanicContext & {
  /** This `mechanics[]` entry's id. */
  readonly mechanicId: string;
};

/** A unit a built Placement places. */
export type MechanicPlacedUnit = Pick<PlacedUnit, "id" | "zoneId" | "unitType" | "player" | "x" | "y">;

/** A problem with a Mechanic's params; the path is relative to its `params`. */
export type MechanicIssue = {
  readonly message: string;
  readonly path: readonly (string | number)[];
};

/**
 * What a Mechanic's `buildTriggers` hook gives when its triggers need more than themselves.
 * Variable names are global in the map script, as trigger names are: name them from the Mechanic.
 */
export type MechanicTriggers = {
  readonly triggers: readonly Trigger[];
  /** Global variables the triggers read and set, declared after core's. */
  readonly variables?: readonly TriggerVariable[];
  /**
   * The timers among `variables` that are gameplay clocks (a hazard's countdown, a day's cycle):
   * core pauses them while a Cinematic or trigger scene plays, from before the first scene of a
   * chain until the last hands back, and unpauses the ones it paused (cinematography H4).
   */
  readonly clocks?: readonly TriggerVariable[];
  /**
   * Actions to run when a Beat starts, by Beat id, after its trigger turns the earlier Beats off.
   * Only a Beat with `startsWhen` has a trigger, so naming any other fails the compile.
   */
  readonly beatActions?: Readonly<Record<string, readonly TriggerCall[]>>;
  /**
   * Actions each victory trigger runs first, before it completes objectives and ends the game,
   * such as stopping a countdown. `path` is that trigger's element path: derive the calls' element
   * ids from it, since a Mission can have several victory triggers.
   */
  readonly victoryActions?: (path: string) => readonly TriggerCall[];
};

/**
 * The Campaign Mod's library, as Mission triggers call it: its functions as typed trigger
 * primitives, read from the library interface its Mod Blueprint declares (ADR-0011), with the ids
 * found at Import. Core wraps no Campaign's library of its own.
 */
export type CampaignLibrary = {
  /** The library's id (`Library="…"`), or undefined when the Campaign Mod declares none. */
  readonly id?: string;
  /** The function the interface declares by this Galaxy identifier, such as RingBell; throws, naming the interface, when it declares none. */
  function(identifier: string): FunctionDef;
  /** Every function the interface declares, by Galaxy identifier. */
  readonly functions: Readonly<Record<string, FunctionDef>>;
  /**
   * The call a Mission's UI Component action (`uiActions`, ADR-0019) makes with its params: the
   * component's function in this library and its arguments. Throws, saying why, for an action no
   * component has, params it refuses, or a component the Campaign Mod hasn't turned on. None when
   * the Workspace names no Campaign Mod.
   */
  uiCall?(action: string, params: unknown, mission: UiActionContext): { readonly def: FunctionDef; readonly args: Readonly<Record<string, ParamValue>> };
};

/** What a Mechanic's `buildTriggers` hook reads beyond the Blueprint. */
export type MechanicTriggerContext = MechanicEntryContext & {
  /** The Campaign Mod's library: its functions, to call from these triggers. */
  readonly library: CampaignLibrary;
  /**
   * The actions for one of this Mechanic's `cues`: the start of each Beat whose `startsWhen` names
   * the moment (`{ type: "mechanic", mechanicId, cue }`), as `beatStarts` gives it, then what the
   * Blueprint cues there: scenes, script scenes and transitions. `{ beats: false }` leaves the Beats
   * out, for a Mechanic that starts them itself with `beatStarts`. None when nothing is cued or starts
   * there. Run them where the moment happens, once: a Beat starts only once anyway.
   */
  cueActions(cue: string, options?: { readonly beats?: boolean }): readonly TriggerCall[];
  /**
   * The start of each Beat on one of this Mechanic's `cues`, in Blueprint order: each runs its whole
   * start (it turns the earlier Beats off at once, then plays its own scenes) before the next action,
   * so nothing after them in the trigger comes before they have started.
   */
  beatStarts(cue: string): readonly TriggerCall[];
  /**
   * Pauses or unpauses one of this Mechanic's `clocks` for its own reasons (a channel broken and
   * resumed), so a run of scenes holding the clocks (H4) neither unpauses it at its release nor
   * lets it run under the scenes: unpaused while held, it runs again only once the hold lets go.
   * Use it, not Pause/Unpause Timer, on a declared clock.
   */
  pauseClock(path: string, clock: TriggerVariable, paused: boolean): readonly TriggerCall[];
  /**
   * Starts one of this Mechanic's `clocks` (one-shot, game time) for `seconds`, paused at once if a
   * run of scenes holds the clocks, so it runs only once the hold lets go. Use it, not Start Timer,
   * on a declared clock that may start while a scene plays.
   */
  startClock(path: string, clock: TriggerVariable, seconds: number): readonly TriggerCall[];
};

/** What a Mechanic's `threats` hook reads beyond the Blueprint. */
export type MechanicThreatContext = MechanicEntryContext & {
  /** The zones a ground unit can walk to from a zone, itself included: for a traversal Threat that covers wherever the hero can go. */
  walkableFrom(zoneId: string): ReadonlySet<string>;
};

/** A Mechanic's map-local data. Core merges every source's, and fails the compile when two set the same string or hotkey. */
export type MechanicGameData = {
  /** Catalog entries as XML lines, by GameData file name (`BehaviorData.xml`); core wraps each file's lines from every source in one `<Catalog>`. */
  readonly catalogs?: Readonly<Record<string, readonly string[]>>;
  /** GameStrings.txt entries, such as `Button/Name/<id>`. */
  readonly strings?: Readonly<Record<string, string>>;
  /** GameHotkeys.txt entries, such as `Button/Hotkey/<id>`. */
  readonly hotkeys?: Readonly<Record<string, string>>;
};

/**
 * Typed GUI trigger primitives a Mechanic adds to core's (ADR-0002, ADR-0005): Editor functions and
 * presets core hasn't wrapped, each verified byte-exact against an Editor-saved map. Its triggers
 * may use these and core's; a call or preset that is neither fails the compile.
 */
export type MechanicPrimitives = {
  readonly functions?: Readonly<Record<string, FunctionDef>>;
  readonly presets?: Readonly<Record<string, PresetDef>>;
  /** Block slots (If Then Else's "Then") beyond core's, for a block function the Mechanic adds. */
  readonly subFunctions?: Readonly<Record<string, SubFunctionDef>>;
};

/**
 * The Mechanic contract. `paramsSchema` joins the Blueprint's strict validation; `buildTriggers`
 * returns triggers made only from the typed GUI trigger primitives (ADR-0002): core's, and the
 * Mechanic's own `primitives`. Hooks are declared as methods so a Mechanic with typed params fits
 * a list of Mechanics.
 */
export type Mechanic<Params = unknown> = {
  /** The `type` a Blueprint's `mechanics[]` entry names. */
  readonly type: string;
  readonly paramsSchema: z.ZodType<Params>;
  /** The trigger primitives this Mechanic contributes, beyond core's. */
  readonly primitives?: MechanicPrimitives;
  /** At most one entry of this type in a Mission, as for a Mechanic whose trigger and variable names are fixed. */
  readonly single?: boolean;
  /**
   * Mechanic types a Mission must also have for this one to work (capture needs the sun's tether).
   * Checked whatever the entry's params, and reported at the entry, as core's own checks are.
   */
  readonly requires?: readonly string[];
  /**
   * The moments this Mechanic's triggers can play cued scenes at, such as the flare's `firstFlare`.
   * A Blueprint cues one as `{ type: "mechanic", mechanicId, cue }`, or starts a Beat there with
   * the same object in its `startsWhen`, and the triggers get what to play and start there from
   * `context.cueActions`.
   */
  readonly cues?: readonly string[];
  /**
   * The `cues` an entry with these params reaches, when some can't (a moment its params turn off).
   * A cue or a Beat's start at one it doesn't reach is refused. Without it, every one of `cues`.
   */
  cuesOf?(params: Params): readonly string[];
  /**
   * The orders this entry guarantees its moments come in, beside other entries' (a meditation's
   * `kneels` before its `ends`, and an earlier meditation's `ends` before its `kneels`): in each
   * pair, `before` always comes first. Core reads them, and their chains, when it checks that
   * Beats started on moments can't start out of order (beat-start.ts).
   */
  momentOrder?(params: Params, context: MechanicEntryContext): readonly { readonly before: MechanicMomentRef; readonly after: MechanicMomentRef }[];
  /** Checks against the rest of the Blueprint that the params schema can't make, such as ids that must exist. */
  validate?(params: Params, context: MechanicEntryContext): readonly MechanicIssue[];
  /**
   * Advice for the author that doesn't stop the compile, such as a unit standing where the
   * Mechanic can't use it. Core prints each with the compile's own warnings, naming the Mechanic.
   */
  warnings?(params: Params, context: MechanicEntryContext): readonly string[];
  /**
   * Trigger and element ids should derive from `mechanicId` so two copies don't collide. Trigger
   * names must be unique in the map too, since each becomes the script identifier `gt_<name>` with
   * everything but letters, digits and underscores dropped: name them from `mechanicId` (or the
   * entry's params) so two entries of one type differ, and never reuse a core trigger's name such
   * as "Mission Start". A clash fails the compile, naming both triggers.
   */
  buildTriggers(params: Params, context: MechanicTriggerContext): readonly Trigger[] | MechanicTriggers;
  /**
   * The behaviour ids this entry's `buildGameData` defines (its CBehavior entries), so other
   * entries can name them where the context's `knowsBehavior` checks a behaviour.
   */
  behaviorIds?(params: Params, context: MechanicEntryContext): readonly string[];
  /** Map-local catalog entries, strings and hotkeys: static setup belongs in data, so the Editor shows what the game does. */
  buildGameData?(params: Params, context: MechanicEntryContext): MechanicGameData;
  /**
   * The Threats this Mechanic adds to the Mission (ADR-0006), which the layout checker's safety
   * checks read like any enemy's. Core checks each against the Threat schema and the Blueprint's
   * zones and beats, and names it after the Mechanic entry.
   */
  threats?(params: Params, context: MechanicThreatContext): readonly MechanicThreat[];
  /**
   * The changes this Mechanic makes to the Blueprint's Connections on a Schedule (ADR-0006): a ford
   * that floods each surge, a gate that opens on each patrol pass. Each must name a Connection the
   * Blueprint declares. The layout checker reads them with the Blueprint's `opensAtBeat` and
   * `closesAtBeat`; share a Threat's Schedule to say the two happen together.
   */
  connectionChanges?(params: Params, context: MechanicEntryContext): readonly MechanicConnectionChange[];
};

/** Keeps a Mechanic's params typed from its schema while it is written. */
export function defineMechanic<Params>(mechanic: Mechanic<Params>): Mechanic<Params> {
  return mechanic;
}

/** What every naming hook can read about the Screenplay being compiled. */
export type ScreenplayNamingContext = {
  /** The Mission Blueprint's `id`, e.g. "lava_field". */
  readonly missionId: string;
  /** The Screenplay's title, from its `#` heading. */
  readonly title: string;
  /** The Screenplay's `- Key: value` header fields, e.g. { Chapter: "3" }. */
  readonly fields: Readonly<Record<string, string>>;
};

/** What a line's naming hooks can read: where the line sits and what the Screenplay says of it. */
export type LineNamingContext = ScreenplayNamingContext & {
  readonly conversationId: string;
  /** The scene's number, from its `## Scene N:` heading. */
  readonly scene: number;
  /** The line's place among its scene's lines, from 1. */
  readonly line: number;
  /** The speaker as the Screenplay writes it, e.g. "RAYNOR". */
  readonly speaker: string;
  /** The id the Screenplay gives the line in backticks after its speaker, if any. */
  readonly scriptId?: string;
};

/**
 * A Campaign Pack's naming template: how a Screenplay's conversation, lines, sounds and speakers
 * are named in the compiled map's data. Every hook is optional, and core's default naming fills
 * in the rest (see `src/script/name-script.ts`).
 */
export type NamingTemplate = {
  /** The template's id, as the manifest declares it under `contributions.naming`. */
  readonly name: string;
  /** The CConversation id. */
  conversationId?(context: ScreenplayNamingContext): string;
  /** The conversation line's id, unique within the conversation. */
  lineId?(context: LineNamingContext): string;
  /** The line's CSound id, which also names its voice file. */
  soundId?(context: LineNamingContext): string;
  /** The CSound's `Line` attribute. */
  soundLine?(context: LineNamingContext & { readonly lineId: string }): string;
  /** The CCharacter a speaker with no character is, by the name its Transmissions show (e.g. "Raynor"); a character gives its own id. */
  characterId?(name: string): string;
};

/**
 * Which Screenplay a Screenplay Source is asked for: a Mission's, by `missionId`, or one of a
 * Campaign Mod's, by `modId`. Breaking within plugin API version 2: `missionId` was always given
 * and is now optional. A Mission's request is as it was, so a Source that knows only Missions keeps
 * working until its Campaign Mod declares Screenplays; one that reads `missionId` as a string must
 * handle `modId` to type-check (docs/plugin-api.md, Versioning).
 */
export type ScreenplayRequest = {
  /** What the Source knows the Screenplay by: a Mission Blueprint's `screenplay.script.ref`, or a Campaign Mod's Screenplay's `ref`. */
  readonly ref: string;
} & (
  | {
      /** The Mission Blueprint's `id`, for a Mission's Screenplay. */
      readonly missionId: string;
      readonly modId?: undefined;
    }
  | {
      /** The Mod Blueprint's `id`, for one of a Campaign Mod's Screenplays (an interlude or hub chats, ADR-0011). */
      readonly modId: string;
      readonly missionId?: undefined;
    }
);

/**
 * A Campaign Pack's Screenplay Source: where the Campaign keeps its Screenplays. `fetch` returns a
 * Screenplay in core's Markdown format (docs/screenplay-format.md), which the pull command writes
 * over the Blueprint's `screenplay.script.source`. Unlike the other hooks, these may read files,
 * run commands or go over the network.
 */
export type ScreenplaySource = {
  /** The Source's id, as the manifest declares it under `contributions.screenplaySource`. */
  readonly name: string;
  fetch(request: ScreenplayRequest): Promise<string>;
  /**
   * Edits the Screenplay at its source, if the Source can. `edits` is the parsed JSON of an edits
   * file in the Source's own format. A dry run changes nothing. Returns a report for the author.
   */
  edit?(request: ScreenplayRequest & { readonly edits: unknown; readonly dryRun: boolean }): Promise<string>;
  /**
   * What the Source knows the Screenplay of a conversation by (a CConversation id, such as an
   * imported map's, or a Campaign Mod's interlude or hub chats), or undefined when it knows none.
   * Import uses it for the Blueprint's `screenplay.script.ref`, convert-screenplay for a Campaign
   * Mod's Screenplay's `ref`.
   */
  refForConversation?(conversationId: string): Promise<string | undefined>;
};

/** A deterministic 0..1 from a key: the dresser's own, so a rule's choices are stable across compiles. */
export type StyleRandom = (key: string) => number;

/** A scale range [min, max]; each doodad draws its own scale from it. */
export type ScaleRange = readonly [number, number];

/** The parts of a pile: big pieces, small ones heaped round them, a decal under it, an accent. */
export type PileRole = "large" | "small" | "ground" | "accent";

/** One piece of a pile, as a rule chooses it: the dresser finds it room and places it. */
export type PilePiece = {
  readonly role: PileRole;
  readonly member: DressingMember;
  /** Its index among the pile's pieces of its role; part of its doodad id. */
  readonly index: number;
};

/** Picks `count` of a pile's members of `role` (none when it has none), each from its own key, as the dresser picks them. */
export type ChoosePieces = (role: PileRole, count: number) => readonly PilePiece[];

/**
 * A cliff-foot pile's pieces. Each tries spots along the cliff, within `along` cells, and out
 * from it, `outward.base + r * outward.reach` cells. A `snug` pile stands against the rock with the
 * Editor's "ignore placement", from the cliff face at the foot's ground height; otherwise it stands
 * off the wall on flat ground.
 */
export type CliffPileShape = {
  readonly snug: boolean;
  readonly pieces: readonly (PilePiece & { readonly along: number; readonly outward: { readonly base: number; readonly reach: number } })[];
};

/** A shore pile's pieces, each within `reach` cells of its waterline cell. */
export type ShorePileShape = { readonly pieces: readonly (PilePiece & { readonly reach: number })[] };

/** One copy of a Doodad Composite a set piece stamped. */
export type StampedComposite = {
  readonly compositeId: string;
  readonly kind: Composite["kind"];
  readonly setPieceId: string;
  readonly x: number;
  readonly y: number;
};

/** A cliff between two levels, and how many cell pairs across it wear each texture on both sides. */
export type CliffTexturePair = {
  readonly lower: number;
  readonly upper: number;
  /** Cell pairs across the cliff. */
  readonly total: number;
  /** Each texture both cells of a pair wear, with how many pairs, in the order first met. */
  readonly same: readonly { readonly texture: string; readonly pairs: number }[];
};

/**
 * The slots a Style Pack's rules fill in the dresser and the texture painter. Core places and
 * paints; the rules decide what the author's Design Lessons decide. A slot no rule fills gets
 * core's plain behaviour, described on each slot.
 */
export type StyleRuleSlots = {
  /**
   * The yaw (radians) of a pile piece, set-piece member or Composite copy, from its free turn and
   * whether it is built. Edge lines turn by their own `aligned` and `turn`. Plain: the free turn.
   */
  yaw?(doodad: { readonly turn: number; readonly built: boolean }): number;
  /** Each pile role's scale range, where a member gives none. Plain: 1. */
  readonly pileScale?: Readonly<Record<PileRole, ScaleRange>>;
  /** A lip piece's scale range, where a member gives none. Plain: 1. */
  readonly lipScale?: ScaleRange;
  /**
   * The pieces of the pile at one cliff cell's foot. `choose(role, count)` picks `count` of the
   * pile's members of that role (none when it has none), as the dresser picks them. Plain: one
   * large piece, off the wall.
   */
  cliffPile?(input: { readonly key: string; readonly kind: "natural" | "built"; readonly pile: CliffPile; readonly random: StyleRandom; readonly choose: ChoosePieces }): CliffPileShape;
  /** The pieces of the pile at one waterline cell, chosen as for `cliffPile`. Plain: one large piece. */
  shorePile?(input: { readonly key: string; readonly pile: CliffPile; readonly random: StyleRandom; readonly choose: ChoosePieces }): ShorePileShape;
  /**
   * How a lip line with `clumps` grows in clumps: the clump noise's period and edge sharpness, and
   * the period of how far a clump reaches in (cells). Plain: none, so every lip line spaces evenly.
   */
  readonly lipClumps?: { readonly period: number; readonly edge: number; readonly reachPeriod: number };
  /**
   * A broken built run's wear: `capsPerEnd` bits over each cut end and 1 to `maxDebris` bits in
   * each gap, at these scale ranges. Plain: one of each, at scale 1.
   */
  readonly breakWear?: {
    readonly capsPerEnd: number;
    readonly capScale: ScaleRange;
    readonly maxDebris: number;
    readonly debrisScale: ScaleRange;
  };
  /** Advice on the Mission's Doodad Composite copies. Plain: none. */
  compositeWarnings?(copies: readonly StampedComposite[]): readonly string[];
  /**
   * Variety patches in natural ground under a texture palette: the patch noise's period (cells),
   * and the noise it takes to start one at full strength and as a light touch. Plain: none, so a
   * zone wears its one texture.
   */
  readonly varietyPatches?: { readonly period: number; readonly threshold: number; readonly touchThreshold: number };
  /**
   * Which textures the wide blend joins: textures in one group blend widely into each other and
   * keep a narrow seam against other groups. `tone` is the texture catalog's (light, mid or dark),
   * where it has one. Plain: one group, so every seam on a level may blend widely.
   */
  blendGroup?(texture: { readonly name: string; readonly tone: string | undefined }): string;
  /** Advice on the palette from the textures worn across each cliff; with a palette only. Plain: none. */
  cliffTextureWarnings?(input: {
    readonly pairs: readonly CliffTexturePair[];
    readonly mainLevel: number;
    readonly lowBands: number;
    readonly highBands: number;
  }): readonly string[];
};
export type StyleRuleSlot = keyof StyleRuleSlots;

/** A rule Contribution: a Design Lesson as code, filling one or more slots of the dresser or painter. */
export type StyleRule = StyleRuleSlots & {
  /** Unique within its Plugin. */
  readonly id: string;
  /** The Design Lesson it puts into code, such as DL-05. */
  readonly lesson?: string;
};

/**
 * The named things a Host Adapter can do on the author's machine beyond reading and writing files.
 * Core asks whether one exists: a tool in the co-design loop hands the step to the author as
 * instructions when it doesn't, and a bulk tool with no manual form isn't listed at all.
 */
export const HOST_CAPABILITIES = [
  "editor.open",
  "editor.checkClosed",
  "editor.refresh",
  "editor.testDocument",
  "editor.save",
  "editor.captureTour",
  "editor.closeCaptureCopies",
  "game.running",
  "screen.capture",
  "tts.speak",
  "model.render",
  "model.rendererKey",
  "model.export",
  "model.exportGltf",
  "game.launch",
] as const;
export type HostCapabilityName = (typeof HOST_CAPABILITIES)[number];

/** The machine settings a Host Adapter can read; paths are absolute. */
export type MachineSettings = {
  /** The StarCraft II install folder. */
  readonly sc2Path?: string;
  /** The Galaxy Editor application the Host Adapter launches. */
  readonly editorPath?: string;
  /** A folder for the caches and scratch files core and the Host Adapter keep. */
  readonly cacheDir?: string;
  /** The model viewer program the Host Adapter renders and exports game models with. */
  readonly modelViewerPath?: string;
  /** The folder holding the source maps of the Style Pack's Exemplar Maps. */
  readonly exemplarMaps?: string;
};
export type MachinePathSetting = keyof MachineSettings;

/** What every capability receives besides its request. */
export type HostContext = {
  readonly machine: MachineSettings;
  /** A machine path setting, or an error naming the setting, the machine config file and its env var. */
  requirePath(setting: MachinePathSetting): string;
};

/**
 * Where capture maps live, inside the machine's `cacheDir`. `editor.captureTour` closes its map
 * without saving, so it only takes maps from here.
 */
export const CAPTURE_MAPS_FOLDER = "capture/maps";

/** A camera tour to capture: see `editor.captureTour`. */
export type CaptureTourRequest = {
  /** A Map Package inside `<cacheDir>/capture/maps/`, whose script announces each stop in a bank. */
  readonly mapPath: string;
  /** The bank the map saves (`BankLoad("<bank>", 1)`): its int key `stop` counts up from 1, and -1 ends the tour. */
  readonly bank: string;
  /** Frames are written here as `<stop>.jpg`, the stop zero-padded to `frameDigits`. */
  readonly outputDir: string;
  readonly frameDigits: number;
  /** Fixed-point bank keys saved beside `stop`; each frame appends `<stop> <values...>` to `stops.txt` in `outputDir`. */
  readonly recordKeys?: readonly string[];
  /** Frames are scaled down to this width, with the window's title bar cut off. */
  readonly width: number;
  /** JPEG quality, 1-100. */
  readonly quality: number;
  /** How long to wait for the first stop once the game runs, in seconds, before giving up. */
  readonly startSeconds: number;
  /**
   * Records the game window as well, from when it appears until the tour ends: `video.mp4` in
   * `outputDir`, `width` pixels wide at up to `fps` frames a second, at `quality` (0-1, the
   * encoder's constant-quality setting; the Host Adapter picks one when it isn't given), with `video-stops.txt` giving
   * each stop's time into it (`<stop> <seconds>` per line), and the time of each change of the bank's int key `mark`, if the map saves one (`m<mark> <seconds>`). For what a screenshot misses: a burst
   * of particles that is over before the frame is taken. A Host Adapter that can't record ignores it.
   */
  readonly video?: { readonly width: number; readonly fps: number; readonly quality?: number };
  /**
   * After this many seconds with no stop, press Space now and then, for a loading screen that waits
   * for it. Pressing takes focus from whoever is using the machine, so not too soon.
   */
  readonly pressSpaceAfterSeconds: number;
  /**
   * Writes the map at `mapPath`. Called once any copy of it the Editor still has open is closed,
   * since rewriting a map the Editor has open can crash it, and before the Editor opens it.
   */
  readonly writeMap?: () => Promise<unknown>;
  /** The game is already running the map (the author started it): only watch, and leave the Editor alone. */
  readonly attach?: boolean;
  /** Progress lines for the author. */
  readonly log?: (line: string) => void;
  /**
   * Aborted when no one wants the tour any more (the Editor Broker's clients all hung up): the
   * tour stops at its next wait or stop, cleans up as it would after a failure (quits the game,
   * closes the copy unsaved), and rejects.
   */
  readonly signal?: AbortSignal;
};

export type CaptureTourResult = {
  /** How many stops were captured. */
  readonly frames: number;
  /** Why the tour stopped: the map announced its end, the game quit first, or no stop was announced in time. */
  readonly end: "done" | "game exited" | "never started";
};

/**
 * Each capability's request and result. A capability resolves when it has done its job and rejects
 * with a reason the author can act on; a tool in the co-design loop then falls back to a manual
 * hand-off.
 */
export type HostCapabilities = {
  /** Opens a Map Package folder (`<name>.SC2Map`) in the Galaxy Editor. */
  readonly "editor.open": (request: { readonly mapPath: string }, context: HostContext) => Promise<void>;
  /**
   * Rejects, saying why, when the Editor has the Map Package open: rewriting a map the Editor has
   * open can crash it, and it keeps the copy it loaded. Run before a compile that replaces it.
   */
  readonly "editor.checkClosed": (request: { readonly mapPath: string }, context: HostContext) => Promise<void>;
  /**
   * Closes the author's own map in the Editor so a compile can rewrite its package and the caller
   * reopen it with `editor.open`. Rejects, closing nothing, when the document has unsaved changes,
   * when it can't tell which map a window is, or when the Editor can't be brought forward; never
   * saves and never discards the author's changes. Resolves when the map is closed, or wasn't open.
   */
  readonly "editor.refresh": (request: { readonly mapPath: string }, context: HostContext) => Promise<void>;
  /**
   * Opens a Map Package in the Editor and runs File > Test Document, so the game starts on it.
   * `seconds`, when given, is how long it may take in all, so the caller's own time (a compile)
   * leaves the tool inside its client's request timeout.
   */
  readonly "editor.testDocument": (request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext) => Promise<void>;
  /**
   * Opens a Map Package in the Editor, saves it there (File > Save), so the Editor rewrites its
   * files, MapScript.galaxy among them, from Triggers, and closes it. Only for a copy the caller
   * made for the purpose, such as the MapScript drift test's under `<cacheDir>/drift/`: the save
   * rewrites the package. `seconds`, when given, is how long it may take in all.
   */
  readonly "editor.save": (request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext) => Promise<void>;
  /**
   * Opens a capture map in the Editor, runs Test Document, and screenshots the game each time the
   * map announces a new stop in its bank, until it announces the end. Then it quits the game and
   * closes the map without saving. A bulk job with no manual form.
   */
  readonly "editor.captureTour": (request: CaptureTourRequest, context: HostContext) => Promise<CaptureTourResult>;
  /**
   * Closes, without saving, every map in `<cacheDir>/capture/maps/` the Editor has open, and quits
   * a game it may be testing. The Editor Broker runs it as it starts and after a failed tour, so a
   * copy an earlier run left open is never tested in place of a new one. Never touches another map.
   */
  readonly "editor.closeCaptureCopies": (request: { readonly log?: (line: string) => void }, context: HostContext) => Promise<void>;
  /**
   * Whether a StarCraft II game is running. The Editor Broker asks it after a Test Document it ran,
   * and starts no capture until the game has quit, since a capture quits any game it finds.
   */
  readonly "game.running": (request: Record<string, never>, context: HostContext) => Promise<boolean>;
  /** Captures the game window (else the Editor's) to an image, JPEG or PNG by the path's extension. */
  readonly "screen.capture": (request: { readonly outputPath: string }, context: HostContext) => Promise<void>;
  /**
   * Speaks a placeholder line into a 16-bit mono WAV at `outputPath`. `voice` is the voice the
   * Campaign asks for the character, if any, in the host's own terms.
   */
  readonly "tts.speak": (request: { readonly text: string; readonly character: string; readonly voice?: string; readonly outputPath: string }, context: HostContext) => Promise<void>;
  /**
   * Renders a model, named by its storage path (`Assets/Doodads/<id>/<id>.m3`), on a turntable:
   * one `size`×`size` PNG with a transparent background per output path, at evenly spaced angles.
   * `packages` are mod package folders in load order (a Workspace's, from campaignModPackages):
   * the model is read from the newest-loaded one that holds it, as findPackageFile finds it, else
   * from the game; a model read from a package has every texture it names read from the packages
   * first too (ADR-0017). A game model draws with the game's textures. Nothing is written into them.
   * Rejects with `modelNotFound` when neither the packages nor the game has the model, so core can
   * try another file, and with any other error when it doesn't draw cleanly.
   */
  readonly "model.render": (
    request: { readonly model: string; readonly outputPaths: readonly string[]; readonly size: number; readonly packages?: readonly string[] },
    context: HostContext,
  ) => Promise<void>;
  /**
   * What model.render draws with, as a string that changes whenever its output would: the
   * renderer's build and the recipe it is given for `outputs` angles at `size`. Kept with each
   * thumbnail, so a rebuilt renderer or a changed recipe renders them again.
   */
  readonly "model.rendererKey": (request: { readonly outputs: number; readonly size: number }, context: HostContext) => Promise<string>;
  /**
   * Writes a game model's `.m3` file, with the animation files it requires merged in, to
   * `outputPath`. With `textures`, also writes each texture the model names, at its path
   * (`Assets/Textures/x.dds`) under the output file's folder.
   */
  readonly "model.export": (request: { readonly model: string; readonly outputPath: string; readonly textures?: boolean }, context: HostContext) => Promise<void>;
  /** Writes a game model, or a model file on disk, to `outputPath` as a glTF binary (`.glb`) with its textures embedded. */
  readonly "model.exportGltf": (request: { readonly model: string; readonly outputPath: string }, context: HostContext) => Promise<void>;
  /** Starts the game on a Map Package without the Editor. */
  readonly "game.launch": (request: { readonly mapPath: string }, context: HostContext) => Promise<void>;
};

/** The error `model.render` rejects with when the game has no model at that path. */
export function modelNotFound(model: string): Error {
  return Object.assign(new Error(`model not found: ${model}`), { code: "model-not-found" });
}

/** Whether a capability's error is `modelNotFound`'s; checked by code, since a Plugin may bundle its own copy of this module. */
export function isModelNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | undefined)?.code === "model-not-found";
}

/**
 * A kind of Cutscene Editor source the cinematic set catalog reads, such as a Campaign's own
 * repo: how the catalog names it, and how actor names in its files read as mark names.
 */
export type CutsceneSourceKind = {
  /** The name a catalog run gives the source's folder, such as `mycampaign` in `--source mycampaign=<dir>`. */
  readonly id: string;
  /** The source in the catalog's plans and index, such as "My Campaign". */
  readonly label: string;
  /** What the source is, in the index's opening line, such as "My Campaign's repo". */
  readonly description: string;
  /**
   * Strips the Campaign's own naming conventions from an actor's name in this source's files
   * ("(Hub) - Ana Ortiz (Facing Raynor)" -> "Ana Ortiz"). Core then drops a
   * trailing number, and falls back to the model when nothing is left.
   */
  markName?(actorName: string): string;
};

/** The cutscene sources core knows itself: Blizzard's game data (the sc2-game-data mirror). */
export const CORE_CUTSCENE_SOURCES: readonly CutsceneSourceKind[] = [{ id: "blizzard", label: "Blizzard", description: "Blizzard's game data" }];

/**
 * A Light a Plugin contributes, from the JSON file its manifest names in `contributions.lights`
 * (`{ "lights": [...] }`): a full copy of a stock Light (`from`, an id in data/light-catalog.json)
 * with its key, fill, back, ambient and exposure retuned, as a Mission's own `lights` entry is.
 * A Mission names one as its `lighting`, a transition's Light, a Cinematic's base `light` or a
 * shot's `light`, and only then is it written to the Map Package's LightData.
 */
export type PluginLight = MissionLight;

/** What a Plugin's code entry point exports by default. */
export type PluginCode = {
  readonly mechanics?: readonly Mechanic[];
  readonly cutsceneSources?: readonly CutsceneSourceKind[];
  /**
   * Only the Workspace's Campaign Pack may contribute a naming template and a Screenplay Source.
   * Its characters are declared in its Campaign Mod's Blueprint (ADR-0011), not here.
   */
  readonly naming?: NamingTemplate;
  readonly screenplaySource?: ScreenplaySource;
  /** Design Lessons as code; only the rules of the Plugin the Workspace names as its stylePack apply. */
  readonly styleRules?: readonly StyleRule[];
  /** Only a Plugin named as the machine's Host Adapter may contribute capabilities. */
  readonly capabilities?: Partial<HostCapabilities>;
};

/**
 * A knowledge document a Plugin contributes, served as an MCP resource: a guide, Design Lesson
 * prose, or one of the data documents the registry derives from a Plugin's Exemplar Maps (their
 * list and each one's Map Study) and Doodad Composites.
 */
export type KnowledgeDocument = {
  /** The contributing Plugin's name. */
  readonly plugin: string;
  /** Unique within its Plugin. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly mimeType: string;
  /** Absolute; inside the Plugin's folder. Read only when asked for. */
  readonly file: string;
};

export const EXEMPLAR_PROVENANCES = ["made", "edited", "approved"] as const;
export type ExemplarProvenance = (typeof EXEMPLAR_PROVENANCES)[number];

/** An Exemplar Map a Style Pack draws its lessons from. Its source map isn't part of the Plugin. */
export type ExemplarMap = {
  readonly plugin: string;
  readonly id: string;
  readonly provenance: ExemplarProvenance;
  /** The source map's path inside the Workspace's Exemplar Map folder (or absolute). */
  readonly map: string;
  readonly note?: string;
  /** Absolute: the folder its Map Study (`study.json`) and layer renders are written to. */
  readonly studyDir: string;
  /** Everything else its entry records, such as capture settings, for the pack's own tools. */
  readonly settings: Readonly<Record<string, unknown>>;
};

/** An MCP prompt a Plugin contributes, for one of its own workflows. */
export type PluginPrompt = {
  readonly plugin: string;
  /** Unique across the loaded Plugins. */
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly arguments: readonly { readonly name: string; readonly description?: string; readonly required: boolean }[];
  /** Absolute: the prompt's text, with `{{argument}}` for each argument. */
  readonly file: string;
};

/**
 * A skill a Plugin contributes (ADR-0023): a folder holding a SKILL.md and its files, copied into
 * the Workspace's `.claude/skills/` for Claude Code (src/plugins/plugin-skills.ts).
 */
export type PluginSkill = {
  readonly plugin: string;
  /** The name it's copied as, unique across the loaded Plugins: its folder's name after its Plugin's (`copiedSkillName`), the copy's folder name and the skill's name. */
  readonly name: string;
  /** Its folder's name in the Plugin. */
  readonly folderName: string;
  /** Absolute: the skill's folder in the Plugin. */
  readonly folder: string;
  /** Absolute: the Plugin's folder, filled in for the placeholder in the skill's text. */
  readonly pluginFolder: string;
};

/** Each Contribution kind, and what the registry returns for it. */
export type ContributionKinds = {
  readonly mechanics: Mechanic;
  readonly naming: NamingTemplate;
  readonly screenplaySource: ScreenplaySource;
  readonly knowledge: KnowledgeDocument;
  readonly exemplarMaps: ExemplarMap;
  readonly composites: Composite;
  readonly prompts: PluginPrompt;
  readonly styleRules: StyleRule;
  readonly capabilities: HostCapabilityName;
  readonly cutsceneSources: CutsceneSourceKind;
  readonly lights: PluginLight;
  readonly skills: PluginSkill;
};
export type ContributionKind = keyof ContributionKinds;

export type LoadedPlugin = {
  readonly name: string;
  readonly version: string;
  /** As the Workspace config names it. */
  readonly source: string;
  /** Absolute, for a Plugin loaded from a folder (a local folder, or a bundled Plugin package); a Plugin built into core has none. */
  readonly folder?: string;
  readonly roles: readonly PluginRole[];
  /** Each kind's Contribution ids (a prompt's name), in the manifest's order. */
  readonly contributions: { readonly [Kind in ContributionKind]: readonly string[] };
};

/** The loaded Plugins and their Contributions; every other module looks Contributions up here. */
export type PluginRegistry = {
  readonly plugins: readonly LoadedPlugin[];
  /** Every loaded Plugin's Contributions of one kind, in load order. */
  contributions<Kind extends ContributionKind>(kind: Kind): readonly ContributionKinds[Kind][];
  mechanic(type: string): Mechanic | undefined;
  /** The name of the Plugin that contributes a Mechanic type. */
  mechanicPlugin(type: string): string | undefined;
  /** The Campaign Pack's naming template, if it contributes one. */
  naming(): NamingTemplate | undefined;
  /** The Campaign Pack's Screenplay Source, if it contributes one; without one, Screenplays are files in the Workspace. */
  screenplaySource(): ScreenplaySource | undefined;
  /**
   * The name of the Campaign Mod the Campaign Pack names (its package name without `.SC2Mod`, such
   * as `MyCampaign` for `MyCampaign.SC2Mod`), if it names one. A Workspace mod of that name is it.
   */
  campaignMod(): string | undefined;
  /** A Doodad Composite recipe from the Plugins' shared libraries. */
  composite(id: string): Composite | undefined;
  /** A Light a Plugin contributes, with that Plugin's name. */
  light(id: string): { readonly light: PluginLight; readonly plugin: string } | undefined;
  /** The slots the Style Pack's rules fill: the rules of the Plugin the Workspace names as its stylePack. None without one. */
  styleRules(): StyleRuleSlots;
  /** A Host Adapter capability, if the loaded Host Adapter contributes it. */
  capability<Name extends HostCapabilityName>(name: Name): HostCapabilities[Name] | undefined;
};

/** No Plugins: core alone. */
export const EMPTY_REGISTRY: PluginRegistry = {
  plugins: [],
  contributions: () => [],
  mechanic: () => undefined,
  mechanicPlugin: () => undefined,
  naming: () => undefined,
  screenplaySource: () => undefined,
  campaignMod: () => undefined,
  composite: () => undefined,
  light: () => undefined,
  styleRules: () => ({}),
  capability: () => undefined,
};

/** The registry each parsed Blueprint was validated against (see `bindPlugins`). */
const BOUND = new WeakMap<object, PluginRegistry>();

/** Records the Plugins a Blueprint was validated against; the Mission Blueprint schema calls it on every parse. */
export function bindPlugins<Blueprint extends object>(blueprint: Blueprint, plugins: PluginRegistry): Blueprint {
  BOUND.set(blueprint, plugins);
  return blueprint;
}

/** Binds a copy of a Blueprint (a spread with fields changed) to the Plugins and Catalog its original was validated against, as a copy doesn't keep them. */
export function bindLikeOriginal<Blueprint extends object>(copy: Blueprint, original: object): Blueprint {
  const plugins = BOUND.get(original);
  if (plugins) BOUND.set(copy, plugins);
  return bindCatalog(copy, blueprintCatalog(original));
}

/**
 * The Plugins a Blueprint was validated against, so it is compiled and checked with the same
 * ones. A Blueprint made in code rather than parsed (a test's spread copy) has none bound: it gets
 * core alone if it needs nothing from a Plugin, and is refused if it does. It needs a Plugin if it
 * has any Mechanics, since every Mechanic comes from one, or if the caller names a `need` of its
 * own, such as a Doodad Composite that isn't the Mission's.
 */
export function blueprintPlugins(blueprint: MissionBlueprint, need?: string): PluginRegistry {
  const bound = BOUND.get(blueprint);
  if (bound) return bound;
  const entry = blueprint.mechanics[0];
  const needs = need ?? (entry ? `Mechanic mechanics.0 (${entry.id}, type ${entry.type})` : undefined);
  if (needs) throw new Error(`${needs} needs a Plugin, but this Blueprint wasn't parsed with missionBlueprintSchema(registry), so no Plugins are bound to it`);
  return EMPTY_REGISTRY;
}

/** The Plugins a Blueprint was validated against, or none: for advice that may go without a Plugin's knowledge rather than fail. */
export function boundPlugins(blueprint: MissionBlueprint): PluginRegistry {
  return BOUND.get(blueprint) ?? EMPTY_REGISTRY;
}

/** Names a Blueprint's `mechanics[]` entry and the Plugin that provides it, for errors. */
export function mechanicLabel(plugins: PluginRegistry, entry: { readonly id: string; readonly type: string }, index: number): string {
  const plugin = plugins.mechanicPlugin(entry.type);
  return `Mechanic mechanics.${index} (${entry.id}, type ${entry.type}${plugin ? ` from Plugin ${plugin}` : ""})`;
}

/** Runs a Plugin hook, so that an error it throws names the Mechanic entry and its Plugin. */
export function runHook<T>(label: string, hook: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw new Error(`${label}: its ${hook} threw: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** A Blueprint `mechanics[]` entry, with the Plugin Mechanic that provides its type and the entry's parsed params. */
export type PluginMechanicEntry = {
  readonly index: number;
  readonly id: string;
  readonly mechanic: Mechanic;
  readonly params: unknown;
  /** Names the entry and its Plugin, for errors. */
  readonly label: string;
};

/** The Blueprint's Mechanics in order, from the Plugins bound to it. */
export function pluginMechanicEntries(blueprint: MissionBlueprint): PluginMechanicEntry[] {
  const plugins = blueprintPlugins(blueprint);
  return blueprint.mechanics.map((entry, index) => {
    const label = mechanicLabel(plugins, entry, index);
    const mechanic = plugins.mechanic(entry.type);
    if (!mechanic) throw new Error(`${label}: no loaded Plugin provides this type`);
    return { index, id: entry.id, mechanic, params: runHook(label, "paramsSchema", () => mechanic.paramsSchema.parse(entry.params)), label };
  });
}
