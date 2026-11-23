import { describe, expect, it } from "vitest";

import { hideErrorsDuringTest } from "../../src/capture/capture-copy.js";
import {
  mapInfoIntegrityHash,
  writeMapInfo,
  type MapInfoOptions,
} from "../../src/terrain/write-map-info.js";

const DEFAULT_PLAYERS: MapInfoOptions["players"] = [
  { id: 0, controller: "Neutral" },
  { id: 1, controller: "User", team: -1 },
  { id: 15, controller: "Hostile" },
];

// compile-map output for a MonlythEx1 128x128 Mission, which opens in the Editor
// and runs in Test Document, with Hide Errors During Test Document on.
const MONLYTH_128_MAPINFO =
  "4970614d2700000037ae00000000000080000000800000000100000001000000000001000000000000004461726b004d6f6e6c797468457831000a00000008000000760000006c000000007800000000000000000000000000ffffffff000000000000000020030000580200000000000000204000000100000000000000002000000000000000000000100000000000000300000000030000000000000000000000000000000000000000000101000000ffffffff00000000000000000000000000000f0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

describe("writeMapInfo", () => {
  it("reproduces the known-good 128x128 MapInfo byte for byte", () => {
    const buffer = writeMapInfo({
      width: 128,
      height: 128,
      tilesetId: "MonlythEx1",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: DEFAULT_PLAYERS,
    });
    expect(buffer.toString("hex")).toBe(MONLYTH_128_MAPINFO);
  });

  it("writes the integrity hash the game recomputes", () => {
    const buffer = writeMapInfo({
      width: 128,
      height: 128,
      tilesetId: "KorhalCityEx2",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: DEFAULT_PLAYERS,
    });
    // 13 description characters instead of 10.
    expect(buffer.readBigUInt64LE(8)).toBe(44602n);
  });

  it("derives the hash from map size and bounds", () => {
    expect(
      mapInfoIntegrityHash({
        width: 128,
        height: 128,
        descriptionLength: 10,
        bounds: [10, 8, 118, 108],
        gameOptionsFlags: 0x4000,
      }),
    ).toBe(44600n);
    expect(
      mapInfoIntegrityHash({
        width: 192,
        height: 160,
        descriptionLength: 10,
        bounds: [10, 8, 182, 140],
        gameOptionsFlags: 0x4000,
      }),
    ).toBe(BigInt(10 + 7 * 160 + 2 * (172 * 172 + 132 * 132) + 3 * 192 - 1 - 17));
  });

  it("turns on Hide Errors During Test Document by default, so data errors don't print over a test", () => {
    const options: MapInfoOptions = {
      width: 128,
      height: 128,
      tilesetId: "MonlythEx1",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: DEFAULT_PLAYERS,
    };
    const buffer = writeMapInfo(options);
    // Setting the flag again changes nothing, the hash included.
    expect(hideErrorsDuringTest(buffer).equals(buffer)).toBe(true);
    // Off, as on ladder maps, it's the same file without the flag.
    expect(hideErrorsDuringTest(writeMapInfo({ ...options, hideErrorsDuringTest: false })).equals(buffer)).toBe(true);
  });

  it("writes width and height after the hash", () => {
    const buffer = writeMapInfo({
      width: 8,
      height: 16,
      tilesetId: "KorhalCityEx2",
      fogType: "Dark",
      playableBounds: [0, 0, 8, 16],
      players: [],
    });
    expect(buffer.toString("ascii", 0, 4)).toBe("IpaM");
    expect(buffer.readUInt32LE(4)).toBe(39);
    expect(buffer.readUInt32LE(16)).toBe(8);
    expect(buffer.readUInt32LE(20)).toBe(16);
  });

  it("marks a custom loading screen and stores its path", () => {
    const plain = writeMapInfo({
      width: 128,
      height: 128,
      tilesetId: "MonlythEx1",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: [],
    });
    const custom = writeMapInfo({
      width: 128,
      height: 128,
      tilesetId: "MonlythEx1",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: [],
      loadingImagePath: "Assets\\Textures\\Loading.dds",
    });
    const loadingTypeOffset = 74 + 4;
    expect(plain.readUInt32LE(loadingTypeOffset)).toBe(0);
    expect(custom.readUInt32LE(loadingTypeOffset)).toBe(1);
    expect(custom.toString("utf8", loadingTypeOffset + 4)).toContain("Assets\\Textures\\Loading.dds\0");
    expect(custom.length - plain.length).toBe("Assets\\Textures\\Loading.dds".length);
  });

  it("rejects sizes the game can't load", () => {
    const base: MapInfoOptions = {
      width: 128,
      height: 128,
      tilesetId: "MonlythEx1",
      fogType: "Dark",
      playableBounds: [10, 8, 118, 108],
      players: [],
    };
    expect(() => writeMapInfo({ ...base, width: 512 })).toThrow(/width/);
    expect(() => writeMapInfo({ ...base, playableBounds: [0, 0, 300, 100] })).toThrow(/bounds/);
  });
});
