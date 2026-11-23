// Terrain synced from the Editor: ground the author raised or lowered on a generated map comes back
// as the Blueprint's terrainEdits.heights, a water area they drew as a water pool with its own
// rects, and cliff or paint changes are listed, not synced. The Editor's save is mimicked as the
// Editor makes it: the whole height map at a quantization of its own, an Agria area in t3Water and
// a WaterData.xml of stock entries. Synthetic: the Ashen Crossing fixture.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { onRamp, sameTerrainFile, terrainQuantization } from "../../src/map/terrain-resave.js";
import { editorObjectForm } from "../../src/map/editor-changes.js";
import { onlyStockWater, readT3Water, sameWaterData, waterHeights } from "../../src/map/write-water.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { areas } from "../../src/sync/sync-terrain.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { applyHeightEdits } from "../../src/terrain/rasterize.js";
import { cliffHeight } from "../../src/terrain/cliffs.js";
import { type HeightQuantization, writeT3HeightMap } from "../../src/terrain/write-t3-height-map.js";
import { writeT3TextureMasks } from "../../src/terrain/write-t3-texture-masks.js";
import { readT3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const SIZE = 128;
/** The quantization the Editor saved 01-02's terrain at (2026-11-10). */
const EDITOR_QUANTIZATION: HeightQuantization = { quantizeBias: 1, quantizeScale: 2.441423e-4 };
/** A WaterData.xml as the Editor writes it once water is drawn (01-02's test save): only stock types, the drawn one at the height the author set. */
const EDITOR_WATER_DATA = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<Catalog>",
  '    <CWater id="Agria">',
  '        <State index="0" Height="7.200000"/>',
  "    </CWater>",
  '    <CWater id="Albion">',
  '        <State index="0" Height="9.000000"/>',
  "    </CWater>",
  "</Catalog>",
  "",
].join("\r\n");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Fixture = { readonly workspace: Workspace; readonly blueprintPath: string; readonly mapDir: string };
async function crossing(): Promise<Fixture> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-terrain-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
  const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
  return { workspace, blueprintPath, mapDir: outputDir };
}

const heightsOf = async (mapDir: string) => readT3HeightMap(await readFile(path.join(mapDir, "t3HeightMap")), terrainQuantization(await readFile(path.join(mapDir, "t3Terrain.xml"), "utf8")));

/**
 * Saves the package as the Editor does after a terrain edit: `edit` changes the heights (and may
 * change cliff levels), then the whole height map is written at the Editor's quantization, which
 * t3Terrain.xml's <vertData> then gives. `water` areas go into t3Water after the compile's own.
 */
async function editorSave(mapDir: string, edit: (map: { heights: Float32Array; cliffHeights: Float32Array; cliffLevels: Uint8Array; row: number }) => void, water: readonly { name: string; rect: readonly number[] }[] = []): Promise<void> {
  const map = await heightsOf(mapDir);
  edit({ heights: map.heights, cliffHeights: map.cliffHeights, cliffLevels: map.cliffLevels, row: map.vertexWidth });
  await writeFile(path.join(mapDir, "t3HeightMap"), writeT3HeightMap({ width: SIZE, height: SIZE, heights: map.heights, cliffHeights: map.cliffHeights, cliffLevels: map.cliffLevels, quantization: EDITOR_QUANTIZATION }));
  const xml = await readFile(path.join(mapDir, "t3Terrain.xml"), "utf8");
  await writeFile(
    path.join(mapDir, "t3Terrain.xml"),
    xml.replace(/quantizeBias="[^"]*"/, `quantizeBias="${EDITOR_QUANTIZATION.quantizeBias.toExponential(6)}"`).replace(/quantizeScale="[^"]*"/, `quantizeScale="${EDITOR_QUANTIZATION.quantizeScale.toExponential(6)}"`),
  );
  if (water.length === 0) return;
  const before = await readFile(path.join(mapDir, "t3Water"));
  const entries = water.map(({ name, rect }) => {
    const entry = Buffer.alloc(56);
    entry.write(name, 0, "ascii");
    rect.forEach((value, k) => entry.writeFloatLE(value, 40 + k * 4));
    return entry;
  });
  const after = Buffer.concat([before, ...entries]);
  after.writeUInt32LE(before.readUInt32LE(8) + water.length, 8);
  await writeFile(path.join(mapDir, "t3Water"), after);
  await writeFile(path.join(mapDir, "Base.SC2Data", "GameData", "WaterData.xml"), EDITOR_WATER_DATA);
}

/** Lowers the vertices x 18-22, y 18-21 (in the landing zone) by `by`. */
const lowerPatch =
  (by: number) =>
  ({ heights, row }: { heights: Float32Array; row: number }): void => {
    for (let y = 18; y <= 21; y++) for (let x = 18; x <= 22; x++) heights[y * row + x]! -= by;
  };

type RawBlueprint = { terrainEdits?: { heights?: Record<string, number> }; water?: Record<string, unknown>[] };
const blueprintOf = async (blueprintPath: string): Promise<RawBlueprint> => JSON.parse(await readFile(blueprintPath, "utf8")) as RawBlueprint;

describe("syncing terrain", { timeout: 180_000 }, () => {
  it("brings lowered ground and a drawn pool back, and the next compile writes them as the Editor left them", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    const compiled = await heightsOf(mapDir);
    // The Editor keeps the drawn water as tiles.
    await editorSave(mapDir, lowerPatch(1), [{ name: "Agria", rect: [17, 20, 21, 22] }, { name: "Agria", rect: [17, 17, 23, 20] }]);

    // Before sync the compile stops, and says sync brings all three files back.
    const stopped = await compileMission(workspace, blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    const message = (stopped as Error).message;
    expect(message).toContain("Run sync first");
    expect(message).not.toContain("Keep or discard");
    for (const file of ["file:t3HeightMap", "file:t3Water"]) expect(message).toContain(file);
    // A t3Terrain.xml the Editor changed only in its quantization holds what the compile writes.
    expect(message).not.toContain("file:t3Terrain.xml");

    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.edit?.saved).toBe(true);
    expect(synced.changes).toEqual([
      { label: "Water added", ids: ["agria-1 (Agria at 7.2, [17, 17, 23, 20] [17, 20, 21, 22])"] },
      { label: "Ground raised or lowered", ids: ["20 vertices at x 18-22, y 18-21"] },
    ]);
    expect(synced.notes).toEqual([]);
    const after = await blueprintOf(blueprintPath);
    const edits = after.terrainEdits!.heights!;
    expect(Object.keys(edits)).toHaveLength(20);
    expect(Object.keys(edits)[0]).toBe("18,18");
    for (const offset of Object.values(edits)) expect(offset).toBeCloseTo(-1, 2);
    expect(after.water).toEqual([{ id: "agria-1", zoneId: "landing_zone", type: "Agria", height: 7.2, rects: [[17, 17, 23, 20], [17, 20, 21, 22]], bank: false }]);

    // The compile writes over the Editor's stock WaterData.xml, and the ground comes out as the Editor left it.
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const recompiled = await heightsOf(mapDir);
    for (let y = 18; y <= 21; y++) for (let x = 18; x <= 22; x++) expect(recompiled.heights[y * (SIZE + 1) + x]).toBeCloseTo(compiled.heights[y * (SIZE + 1) + x]! - 1, 2);
    expect(recompiled.heights[30 * (SIZE + 1) + 30]).toBeCloseTo(compiled.heights[30 * (SIZE + 1) + 30]!, 3);
    expect(readT3Water(await readFile(path.join(mapDir, "t3Water")))).toEqual([
      { water: "Agria_Agria1", rect: [17, 17, 23, 20] },
      { water: "Agria_Agria1", rect: [17, 20, 21, 22] },
    ]);
    const waterData = await readFile(path.join(mapDir, "Base.SC2Data", "GameData", "WaterData.xml"), "utf8");
    expect(waterHeights(waterData)).toEqual(new Map([["Agria_Agria1", 7.2]]));
    expect((await syncMission(workspace, blueprintPath, mapDir)).changes).toEqual([]);
  });

  it("needs no sync after one: the Editor's re-encoding of what sync brought back isn't a change", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    await editorSave(mapDir, lowerPatch(0.5), [{ name: "Agria", rect: [17, 17, 23, 22] }]);
    await syncMission(workspace, blueprintPath, mapDir);
    // The package is still the Editor's save; the compile reads it as what the synced Blueprint writes.
    await expect(compileMission(workspace, blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  });

  it("adds a second session's edits to the first's, before any compile", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    await editorSave(mapDir, lowerPatch(1));
    await syncMission(workspace, blueprintPath, mapDir);
    // More of the same patch, and a new one; the Blueprint's height edits now differ from the compile's.
    await editorSave(mapDir, (map) => {
      lowerPatch(0.5)(map);
      map.heights[60 * map.row + 60]! += 0.4;
    });
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes).toEqual([{ label: "Ground raised or lowered", ids: ["20 vertices at x 18-22, y 18-21", "1 vertex at x 60, y 60"] }]);
    const edits = (await blueprintOf(blueprintPath)).terrainEdits!.heights!;
    expect(edits["20,20"]).toBeCloseTo(-1.5, 2);
    expect(edits["60,60"]).toBeCloseTo(0.4, 2);
  });

  it("takes ground smoothed back to the generated height off the height edits", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    await editorSave(mapDir, lowerPatch(1));
    await syncMission(workspace, blueprintPath, mapDir);
    await editorSave(mapDir, lowerPatch(-1));
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes).toEqual([{ label: "Ground raised or lowered", ids: ["20 vertices at x 18-22, y 18-21"] }]);
    expect((await blueprintOf(blueprintPath)).terrainEdits).toBeUndefined();
  });

  it("lists a cliff-level change as not synced, and still brings the height edits beside it back", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    await editorSave(mapDir, (map) => {
      lowerPatch(1)(map);
      // A level-1 corner raised to level 2, as the cliff brush does: the cliff layer and the level move together.
      for (const [x, y] of [[70, 100], [72, 100]] as const) {
        const index = y * map.row + x;
        map.cliffLevels[index] = 2;
        map.heights[index]! += cliffHeight(2) - map.cliffHeights[index]!;
        map.cliffHeights[index] = cliffHeight(2);
      }
    });
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes).toEqual([{ label: "Ground raised or lowered", ids: ["20 vertices at x 18-22, y 18-21"] }]);
    expect(synced.notes).toEqual([{ label: "Terrain edits not synced (the compile stops on them, to keep or discard)", items: ["Cliff levels changed: 1 vertex at x 70, y 100", "Cliff levels changed: 1 vertex at x 72, y 100"] }]);
    // The compile still stops on the height map, as the cliffs are only there.
    const stopped = await compileMission(workspace, blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect((stopped as Error).message).toMatch(/Keep or discard each change:\n {2}file:t3HeightMap: changed in the Editor/);
  });

  it("lists texture paint as not synced", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    const masks = readT3TextureMasks(await readFile(path.join(mapDir, "t3TextureMasks")));
    // Cell (40, 70) painted all over with layer 7.
    const texelWeights = new Uint8Array(SIZE * 8 * SIZE * 8 * 8);
    for (let texel = 0; texel < masks.layers[0]!.length; texel++) for (let layer = 0; layer < 8; layer++) texelWeights[texel * 8 + layer] = masks.layers[layer]![texel]!;
    for (let ty = 70 * 8; ty < 71 * 8; ty++) {
      for (let tx = 40 * 8; tx < 41 * 8; tx++) {
        const texel = ty * SIZE * 8 + tx;
        for (let layer = 0; layer < 8; layer++) texelWeights[texel * 8 + layer] = layer === 7 ? 15 : 0;
      }
    }
    await writeFile(path.join(mapDir, "t3TextureMasks"), writeT3TextureMasks({ width: SIZE, height: SIZE, textureWeights: new Uint8Array(SIZE * SIZE * 8), texelWeights }));
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes).toEqual([]);
    expect(synced.notes.flatMap((note) => note.items)).toEqual(["Textures painted: 1 cell at x 40, y 70"]);
  });

  it("passes over the Editor's own working-out of the compile's ramps", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    // As 01-02's save did to its 14 ramps: a ramp vertex at a slope takes the lower level, its cliff layer down 1.0.
    let ramps = 0;
    await editorSave(mapDir, (map) => {
      lowerPatch(1)(map);
      for (let i = 0; i < map.heights.length; i++) {
        if (!onRamp(map.cliffHeights, map.cliffLevels, i)) continue;
        ramps++;
        map.cliffLevels[i]! -= 1;
        map.cliffHeights[i]! -= 1;
        map.heights[i]! -= 1;
      }
    });
    expect(ramps).toBeGreaterThan(0);
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes).toEqual([{ label: "Ground raised or lowered", ids: ["20 vertices at x 18-22, y 18-21"] }]);
    expect(synced.notes).toEqual([]);
    await expect(compileMission(workspace, blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  });

  it("won't take heights from a package whose Blueprint terrain changed since the compile", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    await editorSave(mapDir, lowerPatch(1));
    // Another seed wobbles the ragged cliffs elsewhere.
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    raw.terrainSeed = "another";
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    expect(synced.changes.map((change) => change.label)).not.toContain("Ground raised or lowered");
    expect(synced.notes.find((note) => note.label.startsWith("Terrain edits not synced"))?.items[0]).toMatch(/^Ground heights and cliffs: the Blueprint's terrain has changed since the last compile/);
  });

  it("brings back a pool's rectangle and height the Editor moved, and removes one it deleted", async () => {
    const { workspace, blueprintPath, mapDir } = await crossing();
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as RawBlueprint;
    raw.water = [
      { id: "moat", zoneId: "landing_zone", type: "Agria", height: 7.5 },
      { id: "pond", zoneId: "rock_arch", type: "Albion", height: 7.6 },
    ];
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    // The Editor saved the moat's area moved and its CWater lower, and the pond's area deleted.
    const water = Buffer.alloc(32 + 56);
    water.write("WATR", 0, "ascii");
    water.writeUInt32LE(110, 4);
    water.writeUInt32LE(1, 8);
    water.write("Agria_Moat", 32, "ascii");
    [8, 8, 30, 33].forEach((value, k) => water.writeFloatLE(value, 32 + 40 + k * 4));
    await writeFile(path.join(mapDir, "t3Water"), water);
    const dataFile = path.join(mapDir, "Base.SC2Data", "GameData", "WaterData.xml");
    await writeFile(dataFile, (await readFile(dataFile, "utf8")).replace('<Height value="7.500000"/>', '<Height value="7.250000"/>'));
    const synced = await syncMission(workspace, blueprintPath, mapDir);
    // The Editor's ground keeps the banks the compile raised for the pond and for the moat at its old height, so the
    // Blueprint keeps them too, as height edits, and the doodads on them stand where they stood.
    expect(synced.changes.map((change) => change.label)).toEqual(["Water changed", "Water removed", "Ground raised or lowered"]);
    expect(synced.changes[0]!.ids).toEqual(["moat (rects [8, 8, 30, 33], height 7.25)"]);
    expect(synced.changes[1]!.ids).toEqual(["pond"]);
    expect(synced.changes[2]!.ids.some((area) => area.endsWith("at x 78-83, y 48-54"))).toBe(true);
    expect((await blueprintOf(blueprintPath)).water).toEqual([{ id: "moat", zoneId: "landing_zone", type: "Agria", height: 7.25, rects: [[8, 8, 30, 33]] }]);
    // The next compile writes the ground and water the Editor has.
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect((await syncMission(workspace, blueprintPath, mapDir)).changes).toEqual([]);
  });
});

describe("terrain edits in the Blueprint", () => {
  const base = { mapSize: { width: 4, height: 4 } };
  it("offsets the generated heights at their vertices", () => {
    const heights = new Float32Array(25).fill(8);
    applyHeightEdits({ ...base, terrainEdits: { heights: { "1,2": -1.5, "4,4": 0.25 } } }, heights);
    expect(heights[2 * 5 + 1]).toBe(6.5);
    expect(heights[24]).toBe(8.25);
    expect(heights.filter((value) => value === 8)).toHaveLength(23);
  });

  it("refuses a vertex off the map, a malformed key and edits beside Kept ground", async () => {
    const workspace = await loadWorkspace(CROSSING);
    const raw = JSON.parse(await readFile(path.join(CROSSING, "missions", "ashen-crossing", "blueprint.json"), "utf8")) as Record<string, unknown> & { zones: Record<string, unknown>[] };
    const schema = missionBlueprintSchema(workspace.registry, workspace.catalog);
    const issues = (blueprint: Record<string, unknown>) => (schema.safeParse(blueprint).error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    expect(issues({ ...raw, terrainEdits: { heights: { "129,0": 1 } } })).toEqual(["terrainEdits.heights.129,0: Vertex 129,0 is off the 128×128 map (its vertices run 0-128, 0-128)"]);
    expect(issues({ ...raw, terrainEdits: { heights: { "1-2": 1 } } })[0]).toMatch(/A height edit is keyed by its vertex/);
    const kept = { ...raw, zones: raw.zones.map((zone) => ({ ...zone, terrain: "generate" })), terrainEdits: { heights: { "1,2": 1 } } };
    expect(issues(kept).some((issue) => issue.startsWith("terrainEdits.heights.1,2: Height edits offset generated ground"))).toBe(true);
    expect(issues({ ...raw, water: [{ id: "p", zoneId: "surface", type: "Agria", height: 7, rects: [[0, 0, 4, 4], [120, 0, 130, 4]] }] })).toEqual(["water.0.rects.1: [120, 0, 130, 4] runs off the 128×128 map"]);
  });
});

describe("the Editor's re-encoding of terrain", () => {
  it("reads two height maps at two quantizations as the same heights", () => {
    const heights = Float32Array.from({ length: 25 }, (_, i) => 8 + (i % 7) * 0.13);
    const cliffLevels = new Uint8Array(25).fill(1);
    const ours = writeT3HeightMap({ width: 4, height: 4, heights, cliffLevels });
    const editor = writeT3HeightMap({ width: 4, height: 4, heights, cliffLevels, quantization: EDITOR_QUANTIZATION });
    const xml = (q: HeightQuantization) => `<terrain version="115"><vertData quantizeBias="${q.quantizeBias}" quantizeScale="${q.quantizeScale}" standardHeight="8"/></terrain>`;
    const terrainXml = { now: xml(EDITOR_QUANTIZATION), next: xml({ quantizeBias: 9, quantizeScale: 2.746134e-4 }) };
    expect(Buffer.compare(ours, editor)).not.toBe(0);
    expect(sameTerrainFile("t3HeightMap", editor, ours, terrainXml)).toBe(true);
    const moved = Float32Array.from(heights);
    moved[12]! -= 0.2;
    expect(sameTerrainFile("t3HeightMap", writeT3HeightMap({ width: 4, height: 4, heights: moved, cliffLevels, quantization: EDITOR_QUANTIZATION }), ours, terrainXml)).toBe(false);
    expect(sameTerrainFile("t3Terrain.xml", Buffer.from(terrainXml.now.replace("115", "114")), Buffer.from(terrainXml.next), terrainXml)).toBe(true);
    expect(sameTerrainFile("t3Terrain.xml", Buffer.from(terrainXml.now.replace('standardHeight="8"', 'standardHeight="9"')), Buffer.from(terrainXml.next), terrainXml)).toBe(false);
  });

  it("reads a ramp the Editor worked out again as the compile's, and a level change off it as a change", () => {
    // Vertex 12 is on a ramp, its cliff layer at 5.5 on level 4 (whose height is 6); vertex 6 is plain ground at level 1.
    const cliffLevels = new Uint8Array(25).fill(1);
    const cliffHeights = new Float32Array(25);
    cliffLevels[12] = 4;
    cliffHeights[12] = 5.5;
    const heights = Float32Array.from(cliffHeights, (cliff) => cliff + 8);
    const ours = writeT3HeightMap({ width: 4, height: 4, heights, cliffHeights, cliffLevels });
    const xml = { now: undefined, next: undefined };
    const editor = (index: number, level: number, cliff: number) => {
      const [l, c, h] = [Uint8Array.from(cliffLevels), Float32Array.from(cliffHeights), Float32Array.from(heights)];
      [l[index], c[index], h[index]] = [level, cliff, cliff + 8];
      return writeT3HeightMap({ width: 4, height: 4, heights: h, cliffHeights: c, cliffLevels: l });
    };
    expect(sameTerrainFile("t3HeightMap", editor(12, 3, 4.5), ours, xml)).toBe(true);
    expect(sameTerrainFile("t3HeightMap", editor(6, 2, 2), ours, xml)).toBe(false);
  });

  it("reads an object the Editor saved in its own form as the compile's", () => {
    const compiled = '  <ObjectDoodad Id="1" Variation="0" Position="190,40,16" Rotation="0" Scale="1,1,1" Type="LightOmniCyan">\n    <Flag Index="ForcePlacement" Value="1"/>\n  </ObjectDoodad>';
    const saved = '    <ObjectDoodad Id="1" Position="190,40,16" Scale="1,1,1" Type="LightOmniCyan">\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n        <Flag Index="ForcePlacement" Value="1"/>\r\n    </ObjectDoodad>';
    expect(editorObjectForm(saved)).toBe(editorObjectForm(compiled));
    expect(editorObjectForm('    <ObjectDoodad Id="2" Position="1,2,3" Scale="1,1,1" Type="X">\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n    </ObjectDoodad>')).toBe('<ObjectDoodad Id="2" Position="1,2,3" Scale="1,1,1" Type="X"/>');
    expect(editorObjectForm('<ObjectUnit Id="3" Position="1,2,0" Rotation="0.5" Scale="1,1,1"/>')).toContain('Rotation="0.5"');
  });

  it("tells the Editor's stock-only WaterData.xml from one with the Mission's own water", () => {
    expect(onlyStockWater(EDITOR_WATER_DATA)).toBe(true);
    expect(onlyStockWater('<Catalog>\n<CWater id="Agria_Moat" parent="Agria"><State index="0"><Height value="7"/></State></CWater>\n</Catalog>')).toBe(false);
    expect(onlyStockWater('<Catalog>\n<CWater id="Agria" parent="Albion"/>\n</Catalog>')).toBe(false);
    expect(onlyStockWater('<Catalog>\n<CLight id="Agria"/>\n</Catalog>')).toBe(false);
    expect(waterHeights(EDITOR_WATER_DATA)).toEqual(new Map([["Agria", 7.2], ["Albion", 9]]));
    // A CWater only the compile has is a pool sync brought back; one the Editor changed is a change.
    const ours = '<Catalog>\n<CWater id="Agria_Moat" parent="Agria"><State index="0"><Height value="7.000000"/></State></CWater>\n</Catalog>';
    expect(sameWaterData(EDITOR_WATER_DATA, ours)).toBe(true);
    expect(sameWaterData(ours.replace("7.000000", "6.500000"), ours)).toBe(false);
  });

  it("names each patch of changed vertices by its size and extent", () => {
    const row = 10;
    expect(areas([11, 12, 21, 22, 23, 77], row, "vertices")).toEqual(["5 vertices at x 1-3, y 1-2", "1 vertex at x 7, y 7"]);
    // A patch touches across a corner, not across the map's edge.
    expect(areas([19, 20], row, "cells")).toEqual(["1 cell at x 9, y 1", "1 cell at x 0, y 2"]);
  });
});
