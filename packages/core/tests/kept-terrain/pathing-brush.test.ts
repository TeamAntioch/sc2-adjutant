// The pathing brush on Kept ground (spec #247, ticket #251): paint an area unpathable, or clear
// the paint so it is pathable again, in the Editor's painted pathing layer (CellAttribute_Pnp). The
// package is synthetic (tests/support/kept-ground.ts): the crossing fixture imported, with a stroke
// of painted pathing east of the Well whose edge paints only half of each cell.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { readPng } from "../../src/preview/read-png.js";
import { loadMapPackage } from "../../src/study/load-map-package.js";
import { buildMapStudy } from "../../src/study/map-study.js";
import { renderPathing } from "../../src/study/render-layers.js";
import { readCellAttribute, writeCellAttribute } from "../../src/terrain/write-cell-attribute.js";
import { connect, text } from "../mcp/harness.js";
import { type KeptGroundFixture, keptGround, PAINTED, removeKeptGround } from "../support/kept-ground.js";

const SIZE = 128;
/** Open level-1 ground round the Well, overlapping the painted stroke's west column (x 26) and none of its edge. */
const ALLEY = { rect: { x: 22, y: 60, width: 5, height: 8 } };

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

let fixture: KeptGroundFixture | undefined;
let other: string | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
  if (other) await rm(other, { recursive: true, force: true });
  other = undefined;
});

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}
const changedFiles = (before: Record<string, string>, after: Record<string, string>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => after[file] !== before[file]).sort();
const pathingOf = async (mapPackage: string) => readFile(path.join(mapPackage, "CellAttribute_Pnp"));
const cell = (file: Buffer, x: number, y: number) => file[4 + y * SIZE + x]!;
const inRect = (rect: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

describe("the pathing brush", () => {
  it("blocks only the area's cells in CellAttribute_Pnp, and clearing opens them again", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const original = await pathingOf(fixture.mapPackage);

    const blocked = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } });
    expect(changedFiles(before, await hashTree(fixture.mapPackage))).toEqual(["CellAttribute_Pnp"]);
    const after = await pathingOf(fixture.mapPackage);
    expect(after.subarray(0, 4).equals(original.subarray(0, 4))).toBe(true);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (inRect(ALLEY.rect, x, y)) expect(cell(after, x, y), `(${x}, ${y})`).toBe(0xff);
        else expect(cell(after, x, y), `(${x}, ${y})`).toBe(cell(original, x, y));
      }
    }
    // 40 cells, 4 of them already blocked by the stroke.
    expect(blocked.cells).toBe(36);
    expect(blocked.files).toEqual(["CellAttribute_Pnp"]);
    expect(blocked.summary).toMatch(/^Blocked pathing on the 5×8 cells at \(22, 60\): 36 cells changed/);

    const cleared = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "clear-pathing" } });
    const final = await pathingOf(fixture.mapPackage);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) expect(cell(final, x, y), `(${x}, ${y})`).toBe(inRect(ALLEY.rect, x, y) ? 0 : cell(original, x, y));
    }
    expect(cleared.cells).toBe(40);
    expect(cleared.summary).toMatch(/^Cleared pathing on the 5×8 cells at \(22, 60\): 40 cells changed/);
  }, 60_000);

  it("writes the Editor's file on a map with no paint, and clearing the last paint takes it away again", async () => {
    fixture = await keptGround();
    await rm(path.join(fixture.mapPackage, "CellAttribute_Pnp"));
    const before = await hashTree(fixture.mapPackage);

    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } });
    const file = await pathingOf(fixture.mapPackage);
    // The header counts the sub-cells, 8 a cell: 00 00 02 00 on a 128×128 map, as the Editor writes it.
    expect([...file.subarray(0, 4)]).toEqual([0x00, 0x00, 0x02, 0x00]);
    expect(file.length).toBe(4 + SIZE * SIZE);

    const cleared = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "clear-pathing" } });
    expect(existsSync(path.join(fixture.mapPackage, "CellAttribute_Pnp"))).toBe(false);
    expect(cleared.files).toEqual([]);
    expect(cleared.removed).toEqual(["CellAttribute_Pnp"]);
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  }, 60_000);

  it("makes a part-painted edge whole, and says so", async () => {
    fixture = await keptGround();
    const area = { rect: { x: 26, y: 62, width: 3, height: 4 } };
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area, brush: { op: "block-pathing" } });
    const file = await pathingOf(fixture.mapPackage);
    for (let y = 62; y < 66; y++) expect(cell(file, PAINTED.edge.x, y)).toBe(0xff);
    expect(result.cells).toBe(4);
    expect(result.summary).toContain("4 cells changed, 4 of them painted in part before");
  }, 60_000);

  it("writes nothing on a dry run, or while the Editor has the map open", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const dry = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } }, { dryRun: true });
    expect(dry.files).toEqual([]);
    expect(dry.summary).toMatch(/^Would block pathing on the 5×8 cells at \(22, 60\): 36 cells changed/);
    expect(existsSync(dry.renders.after)).toBe(true);

    const host = { has: (capability: string) => capability === "editor.checkClosed", run: async () => Promise.reject(new Error("the Editor has Quarry.SC2Map open")) } as unknown as Host;
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } }, { host })).rejects.toThrow(/^Not edited: the Editor has Quarry.SC2Map open/);
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  }, 60_000);

  it("refuses a falloff, and a layer whose header doesn't fit the map, writing nothing", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { ...ALLEY, falloff: "soft" }, brush: { op: "block-pathing" } })).rejects.toThrow(
      /^Pathing is painted on whole cells, with no falloff/,
    );
    const sharp = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { ...ALLEY, falloff: "sharp" }, brush: { op: "block-pathing" } }, { dryRun: true });
    expect(sharp.cells).toBe(36);

    const file = await pathingOf(fixture.mapPackage);
    file.writeUInt32LE(256 * 256 * 8, 0);
    await writeFile(path.join(fixture.mapPackage, "CellAttribute_Pnp"), file);
    const edited = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } })).rejects.toThrow(/CellAttribute_Pnp isn't a painted layer of 128×128 cells/);
    expect(await hashTree(fixture.mapPackage)).toEqual(edited);
    expect(edited["t3HeightMap"]).toBe(before["t3HeightMap"]);
  }, 60_000);
});

describe("the pathing renders", () => {
  const WHITE = [255, 255, 255];
  const pixel = (image: { width: number; rgb: Uint8Array }, x: number, y: number) => [...image.rgb.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];

  it("tint each painted sub-cell: a cell's left half (0x33) and its bottom half (0xf0)", () => {
    // Two cells side by side, 4 px each, north up: the image's rows run top-down.
    const image = renderPathing({ width: 2, height: 1 }, [0x33, 0xf0]);
    expect(image).toMatchObject({ width: 8, height: 4 });
    for (let y = 0; y < 4; y++) {
      expect(pixel(image, 0, y), `left half, row ${y}`).not.toEqual(WHITE);
      expect(pixel(image, 1, y)).not.toEqual(WHITE);
      expect(pixel(image, 2, y), `right half, row ${y}`).toEqual(WHITE);
      expect(pixel(image, 3, y)).toEqual(WHITE);
      for (let x = 4; x < 8; x++) {
        if (y >= 2) expect(pixel(image, x, y), `bottom half (${x}, ${y})`).not.toEqual(WHITE);
        else expect(pixel(image, x, y), `top half (${x}, ${y})`).toEqual(WHITE);
      }
    }
  });

  it("show a block in red and a clear in blue, only in the area", async () => {
    fixture = await keptGround();
    const reds = (png: string) => countColour(readPng(readFileSync(png)), [220, 30, 60]);
    const blues = (png: string) => countColour(readPng(readFileSync(png)), [30, 110, 230]);
    const blocked = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } }, { name: "block" });
    // 36 changed cells, 16 px each, enlarged k × k: a 21×24-cell crop is drawn at 84×96 px, so k = 5.
    const k = 5;
    // All of them red but where the area's outline is drawn over them.
    const full = 36 * 16 * k * k;
    expect(reds(blocked.renders.difference)).toBeGreaterThan(0.75 * full);
    expect(reds(blocked.renders.difference)).toBeLessThanOrEqual(full);
    expect(blues(blocked.renders.difference)).toBe(0);
    expect(readFileSync(blocked.renders.before).equals(readFileSync(blocked.renders.after))).toBe(false);
    const cleared = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "clear-pathing" } }, { name: "clear" });
    expect(reds(cleared.renders.difference)).toBe(0);
    expect(blues(cleared.renders.difference)).toBeGreaterThan(0.75 * 40 * 16 * k * k);
  }, 60_000);

  it("dot the doodads in white over the painted tint, not pink like the paint", async () => {
    fixture = await keptGround();
    // The Bench stands at (22, 64), in the alley: once blocked, the alley is tinted round it.
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } }, { name: "block" });
    const cleared = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "clear-pathing" } }, { name: "clear" });
    // The 21×24-cell crop from (14, 52) at 4 px a cell, enlarged 5 times: the Bench's dot is round its position.
    const image = readPng(readFileSync(cleared.renders.area));
    expect([image.width, image.height]).toEqual([21 * 20, 24 * 20]);
    // Just inside the alley from the Bench at (22, 64), clear of the area's outline on x = 22.
    const at = ((24 - (64 - 52)) * 20 + 4) * image.width * 4 + ((22 - 14) * 20 + 5) * 4;
    expect([...image.rgba.subarray(at, at + 3)]).toEqual([255, 255, 255]);
  }, 60_000);

  it("are one of Map Study's layer renders", async () => {
    fixture = await keptGround();
    const { images, study } = buildMapStudy({ id: "quarry", provenance: "synthetic" }, loadMapPackage(fixture.mapPackage));
    const image = images["pathing.png"]!;
    expect(image).toMatchObject({ width: 512, height: 512 });
    expect(study.layers.note).toContain("pathing.png: painted pathing");
    // The stroke's whole cells are tinted; the open yard west of it isn't.
    const at = (x: number, y: number) => pixel(image, x * 4 + 1, (SIZE - 1 - y) * 4 + 1);
    expect(at(26, 63)[0]).toBeGreaterThan(at(18, 63)[0]! - 1);
    expect(at(26, 63)).not.toEqual(at(26, 70));
    expect(at(26, 63)[1]).toBeLessThan(at(18, 63)[1]!);
  }, 60_000);
});

/** Pixels exactly `colour`. */
function countColour(image: { width: number; height: number; rgba: Uint8Array }, colour: readonly number[]): number {
  let count = 0;
  for (let i = 0; i < image.width * image.height; i++) if (image.rgba[i * 4] === colour[0] && image.rgba[i * 4 + 1] === colour[1] && image.rgba[i * 4 + 2] === colour[2]) count++;
  return count;
}

describe("the doodads a clear can't open", () => {
  it("are those whose footprint reaches the area, by their model's bounds where recorded, and none with no footprint", async () => {
    fixture = await keptGround();
    const objectsPath = path.join(fixture.mapPackage, "Objects");
    const objects = await readFile(objectsPath, "utf8");
    // Rocks centred east of the alley (22..26) whose bounds (x -1.4..1.42) reach into it; two footprintless ones inside it.
    const rocks = '    <ObjectDoodad Id="900101" Position="28.2,64,8" Rotation="0" Scale="1,1,1" Type="BrokenRocks"/>\n';
    const ghost = '    <ObjectDoodad Id="900102" Position="24.5,62.5,8" Rotation="0" Scale="1,1,1" Type="BrokenRocks">\n        <Flag Index="NoDoodadFootprint" Value="1"/>\n    </ObjectDoodad>\n';
    await writeFile(objectsPath, objects.replace("</PlacedObjects>", `${rocks}${ghost}${ghost.replace("900102", "900103").replace("24.5,62.5", "23.5,66.5")}</PlacedObjects>`));
    const cleared = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "clear-pathing" } }, { name: "clear" });
    // The Bench, by its centre, and the rocks, by their bounds.
    expect(cleared.warnings).toContain("2 doodads stand in the area: a doodad with a footprint blocks pathing whatever is painted, so clearing the paint doesn't open the ground under one");
  }, 60_000);
});

describe("pathing and the compile", () => {
  it("survives a compile in place, which keeps Kept ground's painted pathing", async () => {
    fixture = await keptGround();
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: ALLEY, brush: { op: "block-pathing" } });
    const painted = await pathingOf(fixture.mapPackage);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect((await pathingOf(fixture.mapPackage)).equals(painted)).toBe(true);
  }, 60_000);

  it("is refused on generated ground, whose compile writes the painted pathing whole", async () => {
    other = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-pathing-"));
    await cp(CROSSING, other, { recursive: true });
    const blueprintPath = path.join(other, "missions", "ashen-crossing", "blueprint.json");
    const workspace = await loadWorkspace(other);
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const before = await hashTree(outputDir);
    await expect(editKeptTerrain(workspace, blueprintPath, { area: { rect: { x: 104, y: 84, width: 4, height: 4 } }, brush: { op: "block-pathing" } })).rejects.toThrow(
      "The terrain is Compiled Content (t3Terrain.xml is on the compile record), and its compile owns CellAttribute_Pnp, writing it whole under dug pools and solid doodads with the Blueprint's pathingPaint: paint pathing in the Editor and sync it back (or give pathingPaint in the Blueprint), or paint pathing on Kept ground. Nothing was written",
    );
    expect(await hashTree(outputDir)).toEqual(before);
  }, 60_000);
});

describe("the edit_kept_terrain MCP tool's pathing brush", () => {
  it("blocks and clears", async () => {
    fixture = await keptGround();
    const client = await connect(fixture.root);
    const blocked = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", area: ALLEY, brush: { op: "block-pathing" }, name: "mcp" } });
    expect(blocked.isError).toBeFalsy();
    expect(text(blocked)).toMatch(/^Blocked pathing on the 5×8 cells at \(22, 60\): 36 cells changed/);
    expect((blocked.structuredContent as { files: string[] }).files).toEqual(["CellAttribute_Pnp"]);
    const cleared = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", area: ALLEY, brush: { op: "clear-pathing" }, name: "mcp" } });
    expect((cleared.structuredContent as { cells: number }).cells).toBe(40);
  }, 60_000);
});


describe("CellAttribute_Pnp's header", () => {
  it("counts the sub-cells, 8 a cell, as the Editor writes it at 128×128 and at 256×256", () => {
    expect([...writeCellAttribute(new Uint8Array(128 * 128)).subarray(0, 4)]).toEqual([0x00, 0x00, 0x02, 0x00]);
    expect([...writeCellAttribute(new Uint8Array(256 * 256)).subarray(0, 4)]).toEqual([0x00, 0x00, 0x08, 0x00]);
    // A ladder map of 216×216 cells (Triton LE) has 373,248.
    expect(writeCellAttribute(new Uint8Array(216 * 216)).readUInt32LE(0)).toBe(373_248);
  });

  it("is read as our compile wrote it before it counted the sub-cells (00 00 02 00 at every size), and written back right", () => {
    const old = Buffer.concat([Buffer.from([0x00, 0x00, 0x02, 0x00]), Buffer.alloc(256 * 256, 0xff)]);
    const cells = readCellAttribute(old, 256, 256);
    expect([...writeCellAttribute(cells).subarray(0, 4)]).toEqual([0x00, 0x00, 0x08, 0x00]);
    expect(() => readCellAttribute(Buffer.concat([Buffer.from([0x00, 0x00, 0x04, 0x00]), Buffer.alloc(256 * 256)]), 256, 256)).toThrow("CellAttribute_Pnp isn't a painted layer of 256×256 cells");
  });
});
