// Reads a version-39 MapInfo field by field, after the stream layout in sc2-file-format-docs
// mapinfo.md (MapInfo__SerializeCoreFields, the player entries and the variant block): the fields
// the Editor reads for a map's melee status (melee-status.ts), and tests compare with ladder maps.
import type { Buffer } from "node:buffer";

export type MapInfoFields = {
  readonly version: number;
  /** The u64 at byte 8, which the game checks against `mapInfoIntegrityHash` of the fields. */
  readonly integrityHash: bigint;
  readonly width: number;
  readonly height: number;
  readonly localeMode: number;
  /** 1: the minimap preview is the map image. */
  readonly previewType: number;
  readonly difficulty: number;
  readonly fog: string;
  /** The description string, where the Editor writes the tileset id. */
  readonly description: string;
  readonly bounds: readonly [number, number, number, number];
  /** 0: Melee. */
  readonly loadingScreenType: number;
  readonly gameOptions: number;
  readonly speedMode: number;
  /** 0: Melee/Custom + Allow Expansion. */
  readonly publishMode: number;
  readonly players: readonly {
    readonly id: number;
    readonly control: number;
    readonly team: number;
    readonly race: string;
    readonly color: number;
    readonly startLocation: number;
  }[];
  /** The variant block's start-location ids. */
  readonly startLocationIds: readonly number[];
};

/** The fields MapInfo's integrity hash is computed from, and the hash stored at byte 8. */
export type MapInfoHashedFields = Pick<MapInfoFields, "version" | "integrityHash" | "width" | "height" | "description" | "bounds" | "gameOptions">;

/** A cursor over a MapInfo stream; a read past the end, or a C string with no end, throws. */
function mapInfoReader(buffer: Buffer) {
  let offset = 8;
  const need = (length: number, what: string) => {
    if (offset + length > buffer.length) throw new Error(`MapInfo: its ${what} at byte ${offset} runs past the end`);
  };
  return {
    /** The byte the next read starts at. */
    at: () => offset,
    skip: (length: number) => {
      need(length, "field");
      offset += length;
    },
    u8: () => (need(1, "field"), buffer.readUInt8(offset++)),
    i32: () => (need(4, "field"), (offset += 4), buffer.readInt32LE(offset - 4)),
    u32: () => (need(4, "field"), (offset += 4), buffer.readUInt32LE(offset - 4)),
    u64: () => (need(8, "field"), (offset += 8), buffer.readBigUInt64LE(offset - 8)),
    cString: () => {
      const end = buffer.indexOf(0, offset);
      if (end < 0) throw new Error(`MapInfo: its string at byte ${offset} has no end`);
      const value = buffer.toString("utf8", offset, end);
      offset = end + 1;
      return value;
    },
    lpString: () => {
      need(2, "string length");
      const length = buffer.readUInt16LE(offset);
      offset += 2;
      need(length, "string");
      offset += length;
      return buffer.toString("utf8", offset - length, offset);
    },
  };
}

type Reader = ReturnType<typeof mapInfoReader>;

/** The stream up to and including the game options flags, the last field the integrity hash counts. */
function readHead(read: Reader, version: number) {
  const integrityHash = read.u64();
  const width = read.u32();
  const height = read.u32();
  const localeMode = read.u32();
  const previewType = read.u32();
  read.cString(); // minimap image
  read.cString(); // hover image
  read.u32(); // minimap resolution
  const difficulty = read.u32();
  const fog = read.cString();
  const description = read.cString(); // the tileset
  const boundsOffset = read.at();
  const bounds = [read.i32(), read.i32(), read.i32(), read.i32()] as const;
  read.i32(); // base height
  const loadingScreenType = read.u32();
  read.cString(); // loading image
  read.lpString(); // loading bar
  read.skip(4 + 4 + 16); // image scale, text anchor, text offset and size
  read.cString(); // custom layout
  read.lpString();
  read.lpString();
  const gameOptions = read.u32();
  return { version, integrityHash, width, height, localeMode, previewType, difficulty, fog, description, bounds, boundsOffset, loadingScreenType, gameOptions };
}

/**
 * Only what the integrity hash needs, so a later block this reader doesn't expect can't fail it;
 * and the byte the bounds start at, for a patch of them (patch-map-info.ts).
 */
export function readMapInfoHashedFields(buffer: Buffer): MapInfoHashedFields & { readonly boundsOffset: number } {
  const { version, integrityHash, width, height, description, bounds, boundsOffset, gameOptions } = readHead(mapInfoReader(buffer), buffer.readUInt32LE(4));
  return { version, integrityHash, width, height, description, bounds, boundsOffset, gameOptions };
}

export function readMapInfoFields(buffer: Buffer): MapInfoFields {
  const read = mapInfoReader(buffer);
  const { boundsOffset: _, ...head } = readHead(read, buffer.readUInt32LE(4));
  const speedMode = read.i32();
  const publishMode = read.i32();
  read.skip(3 * 4); // sim max steps, step size, a reserved field
  read.u8(); // speed below mode
  const authors = read.u32();
  for (let index = 0; index < authors; index++) read.lpString();
  read.lpString(); // loading music

  const players = Array.from({ length: read.u32() }, () => {
    const player = { id: read.u8(), control: read.i32(), team: read.i32(), race: read.cString(), color: read.i32(), startLocation: read.i32() };
    read.u32(); // resource flags
    read.cString(); // AI personality
    return player;
  });
  const startLocationIds = Array.from({ length: read.u32() }, () => read.u32());
  return { ...head, speedMode, publishMode, players, startLocationIds };
}
