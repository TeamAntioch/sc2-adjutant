import { Buffer } from "node:buffer";

import type { MapInfoFog } from "../domain/unexplored-areas.js";

// Layout and integrity hash from sc2-arcade-watcher/sc2-ida-mcp-setup
// docs/file-format/mapinfo.md (MapInfo version 39); field values from a known-good
// Editor-saved 128x128 map.

export type MapInfoPlayer = {
  /** Player slot: 0 = Neutral, 1–14 = players, 15 = Hostile. */
  readonly id: number;
  readonly controller: "User" | "Computer" | "Neutral" | "Hostile";
  readonly team?: number;
  readonly aiName?: string;
  readonly colorIndex?: number;
  readonly startLocation?: number;
};

export type MapInfoOptions = {
  readonly width: number;
  readonly height: number;
  /** MapInfo's description string; the Editor writes the tileset id here. */
  readonly tilesetId: string;
  /** Unexplored Areas: `Dark` is Grey Mask, `Black` is Black Mask, `BlackNoUnhide` is Black Mask (Reduced Radius). */
  readonly fogType: MapInfoFog;
  /** Playable bounds: left, bottom, right, top. */
  readonly playableBounds: readonly [number, number, number, number];
  readonly players: readonly MapInfoPlayer[];
  readonly minimapImagePath?: string;
  readonly loadingImagePath?: string;
  /** The Editor's speed-mode selector: 1 (its default) on Missions, 0 on every ladder map. */
  readonly speedMode?: 0 | 1;
  /** Map Properties' Hide Errors During Test Document: on (the default) on Missions, so data errors don't print over a test; off on ladder maps, as Blizzard's are. */
  readonly hideErrorsDuringTest?: boolean;
};

/** MapInfo's first four bytes. */
export const MAPINFO_MAGIC = "IpaM";
const MAPINFO_VERSION = 39;
const MAX_DIMENSION = 256;
const MAX_PLAYERS = 16;

const CONTROLLER_MAP: Record<MapInfoPlayer["controller"], number> = {
  User: 1,
  Computer: 2,
  Neutral: 3,
  Hostile: 4,
};

// Set on every map the Editor saves.
const GAME_OPTIONS_FLAGS = 0x4000;
/** The game options flag Hide Errors During Test Document. */
const HIDE_ERRORS_DURING_TEST = 0x20;
// Fixed-point (×4096) values as the Editor writes them.
const BASE_HEIGHT = 7.5 * 4096;
const DEFAULT_SIM_MAX_STEPS = 0x2000;
const SPEED_BELOW_MODE_UNSET = 0x10;

class MapInfoStream {
  private readonly parts: Buffer[] = [];

  u8(value: number): void {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    this.parts.push(buffer);
  }

  i32(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value, 0);
    this.parts.push(buffer);
  }

  u32(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    this.parts.push(buffer);
  }

  u64(value: bigint): void {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt.asUintN(64, value), 0);
    this.parts.push(buffer);
  }

  /** Null-terminated string. */
  cString(value: string): void {
    this.parts.push(Buffer.from(value + "\0", "utf8"));
  }

  /** uint16 length-prefixed string (the small SSOString fields). */
  lpString(value: string): void {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(2);
    length.writeUInt16LE(bytes.length, 0);
    this.parts.push(length, bytes);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

function popcount32(value: number): number {
  let v = value >>> 0;
  let count = 0;
  while (v) {
    count += v & 1;
    v >>>= 1;
  }
  return count;
}

/**
 * The game recomputes this from the parsed fields and refuses the file on a mismatch.
 * `descriptionLength` counts the description string's characters.
 */
export function mapInfoIntegrityHash(options: {
  readonly width: number;
  readonly height: number;
  readonly descriptionLength: number;
  readonly bounds: readonly [number, number, number, number];
  readonly gameOptionsFlags: number;
}): bigint {
  const [left, bottom, right, top] = options.bounds;
  const dx = right - left;
  const dy = top - bottom;
  return BigInt(
    options.descriptionLength +
      7 * options.height +
      2 * (dx * dx + dy * dy) +
      3 * options.width -
      popcount32(options.gameOptionsFlags) -
      17,
  );
}

export function writeMapInfo(options: MapInfoOptions): Buffer {
  const {
    width,
    height,
    tilesetId,
    fogType,
    playableBounds,
    players,
    minimapImagePath = "",
    loadingImagePath = "",
    speedMode = 1,
    hideErrorsDuringTest = true,
  } = options;
  const gameOptionsFlags = (GAME_OPTIONS_FLAGS | (hideErrorsDuringTest ? HIDE_ERRORS_DURING_TEST : 0)) >>> 0;

  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
      throw new Error(`MapInfo ${name} must be an integer in 1..${MAX_DIMENSION}: ${value}`);
    }
  }
  if (playableBounds.some((value) => value < 0 || value > MAX_DIMENSION)) {
    throw new Error(`MapInfo bounds must be within 0..${MAX_DIMENSION}: ${playableBounds.join(", ")}`);
  }
  if (players.length > MAX_PLAYERS) {
    throw new Error(`MapInfo supports at most ${MAX_PLAYERS} players: ${players.length}`);
  }

  const stream = new MapInfoStream();

  stream.u64(
    mapInfoIntegrityHash({
      width,
      height,
      descriptionLength: [...tilesetId].length,
      bounds: playableBounds,
      gameOptionsFlags,
    }),
  );
  stream.u32(width);
  stream.u32(height);
  stream.u32(1); // locale mode
  stream.u32(1); // preview image: use map preview
  stream.cString(minimapImagePath);
  stream.cString(""); // hover image
  stream.u32(1); // minimap resolution: normal
  stream.u32(0); // difficulty level
  stream.cString(fogType);
  stream.cString(tilesetId);
  for (const value of playableBounds) {
    stream.i32(value);
  }
  stream.i32(BASE_HEIGHT);
  stream.u32(loadingImagePath ? 1 : 0); // loading screen: melee or custom
  stream.cString(loadingImagePath);
  stream.lpString(""); // loading bar
  stream.u32(0); // loading image scale: normal
  stream.i32(-1); // loading text anchor
  for (const value of [0, 0, 800, 600]) {
    stream.i32(value); // loading text offset x/y, size x/y
  }
  stream.cString(""); // custom layout path
  stream.lpString(""); // custom layout locale key
  stream.lpString("");
  stream.u32(gameOptionsFlags);
  stream.i32(speedMode);
  stream.u32(0); // publish mode (the game's sim frame mode): 0, Melee/Custom + Allow Expansion
  stream.u32(DEFAULT_SIM_MAX_STEPS);
  stream.u32(0); // sim step size
  stream.u32(0);
  stream.u8(SPEED_BELOW_MODE_UNSET);
  stream.u32(0); // author count
  stream.lpString(""); // loading music

  stream.u32(players.length);
  for (const player of players) {
    stream.u8(player.id);
    stream.i32(CONTROLLER_MAP[player.controller]);
    stream.i32(player.team ?? 0);
    stream.cString(player.aiName ?? "");
    stream.i32(player.colorIndex ?? 0);
    stream.i32(player.startLocation ?? 0);
    stream.u32(0); // resource flags
    stream.cString(""); // AI personality
  }

  // Variant block: start locations, alliances, team slots, teams, enemies (all empty).
  stream.u32(0);
  stream.u32(0);
  stream.u32(0);
  stream.u32(0);
  stream.u32(0);
  stream.u32(0);
  stream.u32(0);

  // Lighting/camera block: default lighting, no camera rect.
  stream.u32(0);
  stream.u32(0);
  for (let i = 0; i < 4; i += 1) {
    stream.i32(0);
  }

  const header = Buffer.alloc(8);
  header.write(MAPINFO_MAGIC, 0, "ascii");
  header.writeUInt32LE(MAPINFO_VERSION, 4);
  return Buffer.concat([header, stream.toBuffer()]);
}
