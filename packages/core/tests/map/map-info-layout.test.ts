// MapInfo's v39 layout, end to end (#746, part of #735): our melee map's player table and game-option
// bits against the layout in sc2-arcade-watcher/sc2-file-format-docs mapinfo.md and against what
// Blizzard's ladder maps and the Mac Editor write (docs/reference/mapinfo-checks.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileMeleeMap } from "../../src/map/compile-melee-map.js";
import { GAME_OPTION_BITS, gameOptionNames, type MapInfoLayout, readMapInfoLayout } from "../../src/map/read-map-info-layout.js";
import { mapInfoIntegrityHash, writeMapInfo } from "../../src/terrain/write-map-info.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));

let outputDir: string;
let compiled: MapInfoLayout;

beforeAll(async () => {
  outputDir = path.join(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-map-info-layout-")), "two-spawns.SC2Map");
  await compileMeleeMap(FIXTURE, outputDir, { savedAt: new Date("2026-11-19T00:00:00Z") });
  compiled = readMapInfoLayout(await readFile(path.join(outputDir, "MapInfo")));
}, 30_000);

afterAll(async () => {
  await rm(path.dirname(outputDir), { recursive: true, force: true });
});

/** The player table on every two-player ladder map (21 Blizzard maps read 2026-11-19, see mapinfo-checks.md). */
const LADDER_PLAYERS = [
  { slot: 0, control: 3, team: 0, aiName: "", colorIndex: 0, startLocation: 0, resourceFlags: 0, personality: "" },
  { slot: 1, control: 1, team: -1, aiName: "", colorIndex: 0, startLocation: 0, resourceFlags: 0, personality: "" },
  { slot: 2, control: 1, team: -1, aiName: "", colorIndex: 0, startLocation: 0, resourceFlags: 0, personality: "" },
  { slot: 15, control: 4, team: 0, aiName: "", colorIndex: 0, startLocation: 0, resourceFlags: 0, personality: "" },
];

describe("a compiled melee map's MapInfo", { timeout: 30_000 }, () => {
  it("is read to its last byte, as version 39", () => {
    expect(compiled.version).toBe(39);
  });

  it("has the player table of a two-player ladder map", () => {
    expect(compiled.players).toEqual(LADDER_PLAYERS);
  });

  it("sets one game-option bit, All Units Use Base Height, as every ladder map does", () => {
    expect(compiled.gameOptions).toBe(0x4000);
    expect(gameOptionNames(compiled.gameOptions)).toEqual({ names: ["allUnitsUseBaseHeight"], unnamed: 0 });
  });

  it("matches the ladder's melee fields", () => {
    expect(compiled).toMatchObject({
      localeMode: 1,
      previewType: 1,
      minimapResolution: 1,
      difficulty: 0,
      fog: "Dark",
      loadingScreenType: 0,
      loadingImage: "",
      speedMode: 0,
      publishMode: 0,
      lightScale: 8192,
      defaultObservedPlayer: 0x10,
      authors: [],
      startLocationIds: [],
      teamSlotIds: [],
      teams: [],
    });
    expect(compiled.allianceFlags).toEqual({ bits: 0, inner: 0, hex: "" });
    expect(compiled.enemyFlags).toEqual({ bits: 0, inner: 0, hex: "" });
  });

  it("carries the integrity hash of its fields", () => {
    expect(compiled.integrityHash).toBe(
      mapInfoIntegrityHash({ width: compiled.width, height: compiled.height, descriptionLength: compiled.description.length, bounds: compiled.bounds, gameOptionsFlags: compiled.gameOptions }),
    );
  });

  it("writes the lighting and camera block as the Mac Editor does: no lighting, no camera", () => {
    expect([compiled.lightingType, compiled.lightingParams, compiled.cameraType, compiled.cameraRect]).toEqual([0, [], 0, [0, 0, 0, 0]]);
  });
});

describe("the game options flags", () => {
  const players = [{ id: 0, controller: "Neutral" as const }];
  const flagsFor = (hideErrorsDuringTest: boolean) =>
    readMapInfoLayout(writeMapInfo({ width: 64, height: 64, tilesetId: "KorhalCityEx2", fogType: "Dark", playableBounds: [0, 0, 64, 64], players, hideErrorsDuringTest })).gameOptions;

  it("are 0x4000 for a ladder map and add Hide Errors During Test Document (0x20) for a Mission", () => {
    expect(flagsFor(false)).toBe(0x4000);
    expect(flagsFor(true)).toBe(0x4020);
  });

  it("name the Options tab's twelve checkboxes and the Loading tab's Wait For Key", () => {
    expect(Object.values(GAME_OPTION_BITS).sort((a, b) => a - b)).toEqual([0x1, 0x2, 0x4, 0x10, 0x20, 0x40, 0x200, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000]);
    expect(gameOptionNames(0x4021)).toEqual({ names: ["disableReplay", "hideErrorsDuringTestDocument", "allUnitsUseBaseHeight"], unnamed: 0 });
    expect(gameOptionNames(0x8).unnamed).toBe(0x8);
  });

  it("move the integrity hash by one per bit set", () => {
    const hash = (gameOptionsFlags: number) => mapInfoIntegrityHash({ width: 64, height: 64, descriptionLength: 13, bounds: [0, 0, 64, 64], gameOptionsFlags });
    expect(hash(0x4000) - hash(0x4020)).toBe(1n);
    expect(hash(0)).toBe(hash(0x4020) + 2n);
  });
});

describe("a four-player table", () => {
  it("reads back as written: users on teams -1, the start list empty", () => {
    const layout = readMapInfoLayout(
      writeMapInfo({
        width: 128,
        height: 128,
        tilesetId: "KorhalCityEx2",
        fogType: "Dark",
        playableBounds: [8, 8, 120, 120],
        speedMode: 0,
        hideErrorsDuringTest: false,
        players: [{ id: 0, controller: "Neutral" }, ...[1, 2, 3, 4].map((id) => ({ id, controller: "User" as const, team: -1 })), { id: 15, controller: "Hostile" }],
      }),
    );
    expect(layout.players.map((player) => [player.slot, player.control, player.team])).toEqual([[0, 3, 0], [1, 1, -1], [2, 1, -1], [3, 1, -1], [4, 1, -1], [15, 4, 0]]);
    expect(layout.startLocationIds).toEqual([]);
  });
});

describe("readMapInfoLayout", () => {
  const good = writeMapInfo({ width: 64, height: 64, tilesetId: "KorhalCityEx2", fogType: "Dark", playableBounds: [0, 0, 64, 64], players: [{ id: 0, controller: "Neutral" }] });

  it("refuses a file with a byte left over", () => {
    expect(() => readMapInfoLayout(Buffer.concat([good, Buffer.from([0])]))).toThrow("1 bytes are left");
  });

  it("refuses a file cut short", () => {
    expect(() => readMapInfoLayout(good.subarray(0, good.length - 1))).toThrow("runs past the end");
  });

  it("refuses another version", () => {
    const other = Buffer.from(good);
    other.writeUInt32LE(38, 4);
    expect(() => readMapInfoLayout(other)).toThrow("not 39");
  });
});

// The Blizzard ladder maps, unpacked, are not in the repo: point this at a folder of them (each map a
// folder holding its MapInfo) to run the same layout check over every one of them.
const LADDER_DIR = process.env.SC2_LADDER_MAPS;
describe.skipIf(!LADDER_DIR || !existsSync(LADDER_DIR))("Blizzard's ladder maps (SC2_LADDER_MAPS)", () => {
  const maps = LADDER_DIR && existsSync(LADDER_DIR) ? readdirSync(LADDER_DIR).filter((name) => existsSync(path.join(LADDER_DIR, name, "MapInfo"))) : [];

  it.each(maps)("%s is read to its last byte with a hash that holds", (name) => {
    const layout = readMapInfoLayout(readFileSync(path.join(LADDER_DIR!, name, "MapInfo")));
    expect(layout.integrityHash).toBe(
      mapInfoIntegrityHash({ width: layout.width, height: layout.height, descriptionLength: layout.description.length, bounds: layout.bounds, gameOptionsFlags: layout.gameOptions }),
    );
    expect(layout.players[0]).toEqual(LADDER_PLAYERS[0]);
    for (const player of layout.players.filter((entry) => entry.control === 1)) expect(player).toEqual({ ...LADDER_PLAYERS[1], slot: player.slot });
  });
});
