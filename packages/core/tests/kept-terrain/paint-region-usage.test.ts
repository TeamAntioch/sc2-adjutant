// Paint Regions beside Kept ground, read back from the Map Package (#136, ADR-0028): paint_region
// checks a region's mix against the set the package has its cells' blocks on before writing (the
// schema can't, for a generating Zone in no texture set), and texture_usage measures each region's
// textures as painted beside what its mix asked. The package is tests/support/kept-ground.ts's:
// 128 cells square, one set of Meinhoff textures. On a generated map, the field Workspace's 64×64
// Mission, all on the map's textures.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { missionPaintRegion } from "../../src/edit/paint-region-edit.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { missionTextureUsage } from "../../src/map/texture-usage.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf } from "../mcp/harness.js";
import { type KeptGroundFixture, keptGround, removeKeptGround } from "../support/kept-ground.js";

const savedAt = new Date("2026-01-01T00:00:00Z");

let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
});

/** A generating Zone of 16×16 cells, in no texture set, beside a Kept Zone. */
const BLOCK = { x: 14, y: 56, width: 16, height: 16 };
const square = ({ x, y, width, height }: typeof BLOCK) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

async function withZones(fixture: KeptGroundFixture): Promise<void> {
  const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
  const zones = [
    { id: "new_block", name: "New block", elevation: 1, landform: "flat", role: "path", terrain: "generate", texture: "MeinhoffConcrete", polygon: square(BLOCK), connections: [] },
    { id: "east_yard", name: "East yard", elevation: 1, landform: "flat", role: "path", terrain: "kept", polygon: square({ x: 30, y: 56, width: 12, height: 16 }) },
  ];
  await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, zones }, null, 2));
}

describe("Paint Regions beside Kept ground", { timeout: 180_000 }, () => {
  it("are refused before writing when a texture isn't in the set the package has their cells' blocks on", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const before = await readFile(fixture.blueprintPath, "utf8");
    const result = await missionPaintRegion(fixture.workspace, fixture.blueprintPath, { id: "plates", zone: "new_block", mix: [{ texture: "BraxisAlphaPlatesEx2", weight: 0.2 }] });
    expect(result.saved).toBe(false);
    expect(!result.saved && result.issues).toEqual([
      { path: "paintRegions.0.mix", message: expect.stringMatching(/^Paint Region plates paints cells on texture set 0 \(.*\), which doesn't hold BraxisAlphaPlatesEx2: Meinhoff.*, as .*\.SC2Map has its blocks$/) },
    ]);
    expect(await readFile(fixture.blueprintPath, "utf8")).toBe(before);
  });

  it("are measured once compiled: each texture's blend weight past the falloff and over the region, and its area share, beside the target", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const saved = await missionPaintRegion(fixture.workspace, fixture.blueprintPath, { id: "worn", rect: [16, 58, 28, 70], mix: [{ texture: "MeinhoffRock", weight: 0.15 }], falloff: 1 });
    expect(saved.saved).toBe(true);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });

    const { regions, text } = await missionTextureUsage(fixture.workspace, fixture.blueprintPath);
    expect(regions).toHaveLength(1);
    const worn = regions[0]!;
    if ("unmeasured" in worn) throw new Error(worn.unmeasured);
    // 12×12 cells, 10×10 of them past the 1-cell falloff.
    expect(worn.cells).toBe(144);
    expect(worn.coreCells).toBe(100);
    const [rock] = worn.mix;
    expect(rock!.target).toEqual({ weight: 0.15 });
    expect(rock!.coreWeight).toBeCloseTo(0.15, 2);
    // The feathered edge fades in from the Zone's own MeinhoffConcrete, so the region as a whole holds less.
    expect(rock!.weight).toBeLessThan(0.15);
    expect(rock!.weight).toBeGreaterThan(0.1);
    // At 15% it is the dominant texture of no cell.
    expect(rock!.share).toBe(0);
    expect(text).toContain("Paint Regions");
    expect(text).toMatch(/worn: 144 cells, 100 past the falloff\n {4}MeinhoffRock: asked weight 0.15; painted weight 15(\.\d)?% past the falloff/);
  });
});

describe("Paint Regions on a generated map", { timeout: 180_000 }, () => {
  it("are measured on the compiled package, the texture taking the rest dominant past the falloff", async () => {
    const root = await copyOf("field");
    const workspace = await loadWorkspace(root);
    const blueprintPath = path.join(root, "missions", "lava-field", "blueprint.json");
    const mix = [{ texture: "KorhalCityEx2_3", weight: 0.15 }, { texture: "KorhalCityEx2_2" }];
    expect((await missionPaintRegion(workspace, blueprintPath, { id: "worn", rect: [40, 8, 56, 24], mix })).saved).toBe(true);
    await compileMission(workspace, blueprintPath, undefined, { savedAt });

    const [worn] = (await missionTextureUsage(workspace, blueprintPath)).regions;
    if (!worn || "unmeasured" in worn) throw new Error(`not measured: ${JSON.stringify(worn)}`);
    // 16×16 cells, 12×12 past the default 2-cell falloff.
    expect([worn.cells, worn.coreCells]).toEqual([256, 144]);
    const [stone, rest] = worn.mix;
    expect(stone!.coreWeight).toBeCloseTo(0.15, 2);
    expect(rest!.target).toEqual({ rest: true });
    expect(rest!.coreWeight).toBeCloseTo(0.85, 2);
    // Dominant in every cell past the falloff at least.
    expect(rest!.share).toBeGreaterThanOrEqual(144 / 256);
    expect(stone!.share).toBe(0);
  });
});
