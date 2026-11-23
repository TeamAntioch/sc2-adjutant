// Reads a version-39 MapInfo end to end, field by field, after the stream order in
// sc2-arcade-watcher/sc2-file-format-docs mapinfo.md, and refuses a file that leaves bytes over or
// runs short. `read-map-info-fields.ts` reads only what a melee check needs; this is for checking
// the whole layout of our writer against Blizzard's maps and the Editor's (docs/reference/mapinfo-checks.md).
import type { Buffer } from "node:buffer";

/** The Options tab's game-option bits, by the Editor's checkbox. Bits 3, 7-8, 10-11 and 18 up are unreferenced. */
export const GAME_OPTION_BITS = {
  disableReplay: 0x1,
  waitForKey: 0x2,
  disableTriggerPreload: 0x4,
  horizontalFieldOfView: 0x10,
  hideErrorsDuringTestDocument: 0x20,
  disableObservers: 0x40,
  staggerPeriodicEvents: 0x200,
  /** Inverted: set means errors are shown online. */
  showErrorsOnline: 0x1000,
  showGameCountdown: 0x2000,
  allUnitsUseBaseHeight: 0x4000,
  disableViewEveryone: 0x8000,
  disableTakeCommand: 0x10000,
  disableRecoverGame: 0x20000,
} as const;

/** The names of the bits set in a game-options value, and any bit left over that has no name. */
export function gameOptionNames(flags: number): { readonly names: string[]; readonly unnamed: number } {
  let named = 0;
  const names: string[] = [];
  for (const [name, bit] of Object.entries(GAME_OPTION_BITS)) {
    named |= bit;
    if (flags & bit) names.push(name);
  }
  return { names, unnamed: (flags & ~named) >>> 0 };
}

export type MapInfoPlayerEntry = {
  /** The slot: 0 Neutral, 1-14 players, 15 Hostile. */
  readonly slot: number;
  /** 0 None, 1 User, 2 Computer, 3 Neutral, 4 Hostile. */
  readonly control: number;
  /** -1 on a user slot of a ladder map, 0 on Neutral and Hostile. */
  readonly team: number;
  /** The AI name, where the Editor keeps the race: empty is Any. */
  readonly aiName: string;
  readonly colorIndex: number;
  /** 0: a random start location. */
  readonly startLocation: number;
  readonly resourceFlags: number;
  readonly personality: string;
};

export type MapInfoBitSet = { readonly bits: number; readonly inner: number; readonly hex: string };

export type MapInfoLayout = {
  readonly version: number;
  readonly integrityHash: bigint;
  readonly width: number;
  readonly height: number;
  readonly localeMode: number;
  readonly previewType: number;
  readonly minimapImage: string;
  readonly hoverImage: string;
  readonly minimapResolution: number;
  readonly difficulty: number;
  readonly fog: string;
  readonly description: string;
  readonly bounds: readonly [number, number, number, number];
  readonly baseHeight: number;
  readonly loadingScreenType: number;
  readonly loadingImage: string;
  readonly loadingBar: string;
  readonly loadingImageScale: number;
  readonly loadingTextAnchor: number;
  /** Text offset x and y, size x and y. */
  readonly loadingTextBox: readonly [number, number, number, number];
  readonly customLayout: string;
  readonly gameOptions: number;
  readonly speedMode: number;
  readonly publishMode: number;
  readonly lightScale: number;
  readonly simStepSize: number;
  readonly simReserved: number;
  readonly defaultObservedPlayer: number;
  readonly authors: readonly string[];
  readonly loadingMusic: string;
  readonly players: readonly MapInfoPlayerEntry[];
  readonly startLocationIds: readonly number[];
  readonly allianceFlags: MapInfoBitSet;
  readonly teamSlotIds: readonly number[];
  readonly teams: readonly number[];
  readonly enemyFlags: MapInfoBitSet;
  /** 0 none, 1 custom, 2 preset, 3 scripted; its parameters follow in `lightingParams`. */
  readonly lightingType: number;
  readonly lightingParams: readonly number[];
  readonly cameraType: number;
  readonly cameraRect: readonly [number, number, number, number];
};

const MAX_PLAYERS = 16;

export function readMapInfoLayout(buffer: Buffer): MapInfoLayout {
  let offset = 8;
  const need = (length: number, what: string) => {
    if (offset + length > buffer.length) throw new Error(`MapInfo: its ${what} at byte ${offset} runs past the end`);
  };
  const u8 = (what: string) => (need(1, what), buffer.readUInt8(offset++));
  const i32 = (what: string) => (need(4, what), (offset += 4), buffer.readInt32LE(offset - 4));
  const u32 = (what: string) => (need(4, what), (offset += 4), buffer.readUInt32LE(offset - 4));
  const cString = (what: string) => {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new Error(`MapInfo: its ${what} at byte ${offset} has no end`);
    const value = buffer.toString("utf8", offset, end);
    offset = end + 1;
    return value;
  };
  const lpString = (what: string) => {
    need(2, what);
    const length = buffer.readUInt16LE(offset);
    offset += 2;
    need(length, what);
    offset += length;
    return buffer.toString("utf8", offset - length, offset);
  };
  const count = (what: string, max: number) => {
    const value = u32(what);
    if (value > max) throw new Error(`MapInfo: its ${what} count ${value} at byte ${offset - 4} is over ${max}`);
    return value;
  };
  const bitSet = (what: string): MapInfoBitSet => {
    const bits = count(`${what} bit count`, 256);
    const inner = count(`${what} inner count`, 256 * 256);
    const length = Math.ceil(inner / 8);
    need(length, what);
    offset += length;
    return { bits, inner, hex: buffer.subarray(offset - length, offset).toString("hex") };
  };

  const version = buffer.readUInt32LE(4);
  if (version !== 39) throw new Error(`MapInfo: version ${version}, not 39`);
  const integrityHash = (need(8, "integrity hash"), (offset += 8), buffer.readBigUInt64LE(offset - 8));
  const width = u32("width");
  const height = u32("height");
  const localeMode = u32("locale mode");
  if (localeMode === 2) throw new Error("MapInfo: an inline locale text isn't read");
  const previewType = u32("preview type");
  const minimapImage = cString("minimap image");
  const hoverImage = cString("hover image");
  const minimapResolution = u32("minimap resolution");
  const difficulty = u32("difficulty");
  const fog = cString("fog");
  const description = cString("description");
  const bounds = [i32("left"), i32("bottom"), i32("right"), i32("top")] as const;
  const baseHeight = i32("base height");
  const loadingScreenType = u32("loading screen type");
  const loadingImage = cString("loading image");
  const loadingBar = lpString("loading bar");
  const loadingImageScale = u32("loading image scale");
  const loadingTextAnchor = i32("loading text anchor");
  const loadingTextBox = [i32("text offset x"), i32("text offset y"), i32("text size x"), i32("text size y")] as const;
  const customLayout = cString("custom layout");
  lpString("custom layout locale key");
  lpString("reserved string");
  const gameOptions = u32("game options");
  const speedMode = i32("speed mode");
  const publishMode = i32("publish mode");
  const lightScale = u32("light scale");
  const simStepSize = u32("sim step size");
  const simReserved = u32("sim reserved");
  const defaultObservedPlayer = u8("default observed player");
  const authors = Array.from({ length: count("author", 999) }, () => {
    throw new Error("MapInfo: an author entry isn't read");
  }) as string[];
  const loadingMusic = lpString("loading music");

  const players = Array.from({ length: count("player", MAX_PLAYERS) }, () => ({
    slot: u8("player slot"),
    control: i32("player control"),
    team: i32("player team"),
    aiName: cString("player AI name"),
    colorIndex: i32("player color"),
    startLocation: i32("player start location"),
    resourceFlags: u32("player resource flags"),
    personality: cString("player personality"),
  }));

  // The variant block: start locations, alliances, team slots, teams, enemies.
  const startLocationIds = Array.from({ length: count("start location", 256) }, () => u32("start location id"));
  const allianceFlags = bitSet("alliance flags");
  const teamSlotIds = Array.from({ length: count("team slot", 256) }, () => u32("team slot id"));
  const teams = Array.from({ length: count("team", 255) }, () => u32("team type"));
  const enemyFlags = bitSet("enemy flags");

  const lightingType = u32("lighting type");
  if (lightingType > 3) throw new Error(`MapInfo: lighting type ${lightingType} is over 3`);
  const lightingParams = Array.from({ length: [0, 2, 1, 2][lightingType]! }, () => u32("lighting parameter"));
  const cameraType = u32("camera type");
  const cameraRect = [i32("camera left"), i32("camera bottom"), i32("camera right"), i32("camera top")] as const;

  if (offset !== buffer.length) throw new Error(`MapInfo: ${buffer.length - offset} bytes are left after the camera rectangle, at byte ${offset}`);
  return {
    version,
    integrityHash,
    width,
    height,
    localeMode,
    previewType,
    minimapImage,
    hoverImage,
    minimapResolution,
    difficulty,
    fog,
    description,
    bounds,
    baseHeight,
    loadingScreenType,
    loadingImage,
    loadingBar,
    loadingImageScale,
    loadingTextAnchor,
    loadingTextBox,
    customLayout,
    gameOptions,
    speedMode,
    publishMode,
    lightScale,
    simStepSize,
    simReserved,
    defaultObservedPlayer,
    authors,
    loadingMusic,
    players,
    startLocationIds,
    allianceFlags,
    teamSlotIds,
    teams,
    enemyFlags,
    lightingType,
    lightingParams,
    cameraType,
    cameraRect,
  };
}
