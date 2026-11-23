// A synthetic Mission on Kept ground, for the terrain brushes: the crossing fixture compiled
// elsewhere and imported, so every cell is Kept Content, then given what an Editor save has and
// our compile doesn't: the per-map height quantization the Editor picks, and sync heights that
// differ from the render heights at cliff vertices (walking heights), a static shadow bake in
// t3VertCol, and a stroke of painted pathing (CellAttribute_Pnp) with a ragged edge. A Kept point and region, and a doodad on open ground, are added to its Objects and
// Regions in the Editor's form.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { readT3TerrainXml } from "../../src/terrain/read-t3-terrain-xml.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

/** The quantization the Editor chose for one real map: its bias isn't ours. */
export const EDITOR_BIAS = 9.002548;
export const EDITOR_SCALE = 2.746134e-4;
/** How far (in 1/256 units) the sync height sits above the render height at each walking-height cliff vertex. */
export const WALKING_OFFSET = 300;
/** A doodad on level-1 open ground near the Well, as the Editor writes one (absolute height). */
export const BENCH_ID = 900001;
export const WELL = { x: 20, y: 64 };
/**
 * Painted pathing east of the Well, as the Editor's pathing brush leaves it: whole cells (255) at
 * x 26..27, y 62..65, and a ragged edge at x 28 painting the left half of each cell (sub-cell
 * column 0, bits 0x33).
 */
export const PAINTED = { whole: { x: 26, y: 62, width: 2, height: 4 }, edge: { x: 28, y: 62, width: 1, height: 4 }, edgeValue: 0x33 } as const;

export type KeptGroundFixture = { readonly root: string; readonly workspace: Workspace; readonly blueprintPath: string; readonly mapPackage: string; readonly missionDir: string };

let template: Promise<string> | undefined;
const generatedTemplates = new Map<boolean, Promise<string>>();

/** Builds the template once per test file; each call copies it. */
export async function keptGround(): Promise<KeptGroundFixture> {
  template ??= buildTemplate();
  return copyOf(await template);
}

/**
 * The crossing imported as the generator wrote it, with no Editor save, so its files are the
 * generator's to the byte: with its ramps, or with none (its ramp connection open). The temple gate
 * is built ground, whose outline stays straight with or without its ramp (a natural outline is
 * ragged, and only a ramp straightens it), so the two differ by the ramp alone.
 */
export async function generatedGround({ ramps }: { readonly ramps: boolean }): Promise<KeptGroundFixture> {
  if (!generatedTemplates.has(ramps)) generatedTemplates.set(ramps, buildTemplate({ editor: false, ramps, builtTemple: true }));
  return copyOf(await generatedTemplates.get(ramps)!);
}

async function copyOf(source: string): Promise<KeptGroundFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-ground-"));
  await cp(source, root, { recursive: true });
  const missionDir = path.join(root, "missions", "quarry");
  return { root, workspace: await loadWorkspace(root), blueprintPath: path.join(missionDir, "blueprint.json"), mapPackage: path.join(missionDir, "Quarry.SC2Map"), missionDir };
}

export async function removeKeptGround(fixture: KeptGroundFixture | undefined): Promise<void> {
  if (fixture) await rm(fixture.root, { recursive: true, force: true });
}

async function buildTemplate({ editor = true, ramps = true, builtTemple = false } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-ground-template-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Quarry.SC2Map");
  const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
  if (!ramps || builtTemple) {
    type Zone = { id: string; surface?: string; connections: { type: string }[] };
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { ramps?: unknown[]; zones: Zone[] };
    const zones = blueprint.zones.map((zone) => ({
      ...zone,
      ...(builtTemple && zone.id === "temple_gate" ? { surface: "built" } : {}),
      // Without ramps, the ramp connection one served would need a ramp of its own: it becomes open.
      connections: zone.connections.map((connection) => ({ ...connection, type: !ramps && connection.type === "ramp" ? "open" : connection.type })),
    }));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, ...(ramps ? {} : { ramps: [] }), zones }, null, 2));
  }
  await compileMission(await loadWorkspace(workspaceRoot), blueprintPath, source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  if (editor) await editorise(source);
  await importMap(await loadWorkspace(workspaceRoot), source, "quarry");
  return workspaceRoot;
}

/** What an Editor save would have: its quantization, walking heights, and the Kept things the tests name. */
async function editorise(dir: string): Promise<void> {
  const xmlPath = path.join(dir, "t3Terrain.xml");
  const xml = await readFile(xmlPath, "utf8");
  const terrain = readT3TerrainXml(xml);
  const heightPath = path.join(dir, "t3HeightMap");
  const bytes = await readFile(heightPath);
  const map = readT3HeightMap(bytes, terrain);
  const quantize = (value: number) => Math.round((value + EDITOR_BIAS) / EDITOR_SCALE);
  for (let v = 0; v < map.heights.length; v++) {
    bytes.writeUInt16LE(quantize(map.heights[v]! - map.cliffHeights[v]!), 32 + v * 6);
    bytes.writeUInt16LE(quantize(map.cliffHeights[v]!), 32 + v * 6 + 2);
  }
  await writeFile(heightPath, bytes);
  await writeFile(xmlPath, xml.replace(/quantizeBias="[^"]*"/, `quantizeBias="${EDITOR_BIAS.toExponential(6)}"`).replace(/quantizeScale="[^"]*"/, `quantizeScale="${EDITOR_SCALE.toExponential(6)}"`));

  // Walking heights: the sync map sits above the render map at vertices where the cliff level changes.
  const syncPath = path.join(dir, "t3SyncHeightMap");
  const sync = await readFile(syncPath);
  const columns = map.vertexWidth;
  for (let v = 0; v < map.heights.length; v++) {
    const x = v % columns;
    const y = Math.floor(v / columns);
    const level = map.cliffLevels[v]!;
    const step = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < columns && ny! < map.vertexHeight && map.cliffLevels[ny! * columns + nx!] !== level);
    if (step) sync.writeInt16LE(sync.readInt16LE(64 + v * 4) + WALKING_OFFSET, 64 + v * 4);
  }
  await writeFile(syncPath, sync);

  const objectsPath = path.join(dir, "Objects");
  const objects = await readFile(objectsPath, "utf8");
  const newline = objects.includes("\r\n") ? "\r\n" : "\n";
  const ground = map.heights[WELL.y * columns + WELL.x + 2]!;
  const bench = `    <ObjectDoodad Id="${BENCH_ID}" Position="${WELL.x + 2},${WELL.y},${ground}" Rotation="0" Scale="1,1,1" Type="Bench">${newline}        <Flag Index="HeightAbsolute" Value="1"/>${newline}    </ObjectDoodad>${newline}`;
  const well = `    <ObjectPoint Id="900002" Position="${WELL.x},${WELL.y},0" Scale="1,1,1" Type="Normal" Name="Well" Color="0,0,0,0"/>${newline}`;
  await writeFile(objectsPath, objects.replace("</PlacedObjects>", `${bench}${well}</PlacedObjects>`));

  await writeFile(path.join(dir, "t3VertCol"), bakedVertCol(map.vertexWidth - 1, map.vertexHeight - 1, map.cliffLevels));
  await writeFile(path.join(dir, "CellAttribute_Pnp"), paintedPathing(map.vertexWidth - 1, map.vertexHeight - 1));
}

/** CellAttribute_Pnp as the Editor writes it: the count of sub-cell bits (8 a cell, uint32), then a byte per cell, with {@link PAINTED}'s stroke. */
function paintedPathing(width: number, height: number): Buffer {
  const file = Buffer.alloc(4 + width * height);
  file.writeUInt32LE(width * height * 8, 0);
  const fill = (rect: { x: number; y: number; width: number; height: number }, value: number) => {
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) file[4 + y * width + x] = value;
  };
  fill(PAINTED.whole, 0xff);
  fill(PAINTED.edge, PAINTED.edgeValue);
  return file;
}

/**
 * A t3VertCol (v104) as the Editor's static shadow bake leaves one: the kind-1 tiles of 4×4 cells,
 * one byte per vertex, darkened (to 180) beside every change of cliff level, and one kind-2 model
 * entry. Elsewhere 255.
 */
export function bakedVertCol(width: number, height: number, cliffLevels: Uint8Array): Buffer {
  const columns = width + 1;
  const dark = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const nx = x + dx!;
    const ny = y + dy!;
    return nx >= 0 && ny >= 0 && nx <= width && ny <= height && cliffLevels[ny * columns + nx] !== cliffLevels[y * columns + x];
  });
  const entries: Buffer[] = [];
  const entry = (id: number, kind: number, rect: readonly number[], data: Uint8Array) => {
    const head = Buffer.alloc(36);
    head.writeInt32LE(id, 0);
    head.writeInt32LE(kind, 4);
    rect.forEach((value, i) => head.writeFloatLE(value, 8 + i * 4));
    head.writeUInt32LE(data.length, 32);
    entries.push(head, Buffer.from(data));
  };
  let count = 0;
  for (let y0 = 0; y0 < height; y0 += 4) {
    for (let x0 = 0; x0 < width; x0 += 4) {
      const data = new Uint8Array(25);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) data[j * 5 + i] = dark(x0 + i, y0 + j) ? 180 : 255;
      entry(0, 1, [x0, y0, x0 + 4, y0 + 4], data);
      count++;
    }
  }
  entry(0x1234, 2, [40, 28, 42, 30], new Uint8Array(12).fill(120));
  count++;
  const header = Buffer.alloc(32);
  header.write("VTCL", 0, "ascii");
  header.writeUInt32LE(104, 4);
  header.writeUInt32LE(count, 8);
  return Buffer.concat([header, ...entries]);
}
