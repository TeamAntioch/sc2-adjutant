// A Mission's own texture sets beside Kept ground (ADR-0016): a `textureSets` entry becomes one of
// the map's 8 sets, the blocks its Zones' cells are in move onto it, and its Zones are painted
// from it, with every Kept texel kept. The package is the synthetic Kept ground of
// tests/support/kept-ground.ts: 128 cells square, one set of 8 Meinhoff textures.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { readCompileRecord } from "../../src/map/mission-package.js";
import { missionTextureUsage } from "../../src/map/texture-usage.js";
import { readKeptTextures, type KeptTextures } from "../../src/kept-terrain/paint-brushes.js";
import { blockRects, blocksOfRects, defaultSetName } from "../../src/kept-terrain/texture-sets.js";
import { validateMissionBlueprint } from "../../src/plugins/workspace.js";
import { listedZoneIds, textureSetOfZone } from "../../src/domain/mission-blueprint.js";
import { type KeptGroundFixture, keptGround, removeKeptGround } from "../support/kept-ground.js";

const savedAt = new Date("2026-01-01T00:00:00Z");

let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
});

/** The generating Zone: 16×16 cells, so its 2×2 cells reach into blocks 1-3 × 7-8, whose edges are Kept. */
const AREA = { x: 14, y: 56, width: 16, height: 16 };
const square = ({ x, y, width, height }: typeof AREA) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const FACTORY = ["BraxisAlphaPlatesEx2", "KorhalPlatformEx2_4", "PortCityB7", "MarSaraPanels", "NewFolsomGrating", "BraxisAlphaMeshEx2", "BraxisAlphaWreckedPlatesEx2"];

/** The Blueprint with a generating Zone over AREA (and a door with no texture beside it), a Kept Zone, and `extra` (any earlier textureSets dropped). */
async function withZones(fixture: KeptGroundFixture, extra: Record<string, unknown> = {}, texture = "BraxisAlphaPlatesEx2"): Promise<void> {
  const { textureSets: _textureSets, ...blueprint } = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
  const zones = [
    { id: "hall", name: "Hall", elevation: 1, landform: "flat", role: "path", terrain: "generate", texture, polygon: square(AREA), connections: [] },
    { id: "door", name: "Door", elevation: 1, landform: "flat", role: "path", terrain: "generate", polygon: square({ x: 30, y: 62, width: 2, height: 4 }), connections: [] },
    { id: "east_yard", name: "East yard", elevation: 1, landform: "flat", role: "path", terrain: "kept", polygon: square({ x: 32, y: 56, width: 12, height: 16 }) },
  ];
  await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, zones, ...extra }, null, 2));
}

async function textures(fixture: KeptGroundFixture): Promise<KeptTextures> {
  const read = (file: string) => readFile(path.join(fixture.mapPackage, file));
  return readKeptTextures((await read("t3Terrain.xml")).toString("utf8"), await read("t3TextureMasks"), await read("t3SyncTextureInfo"));
}

/** The set's textures with the Kept ground's own at the layers it uses there, as texture_usage orders them. */
async function arranged(fixture: KeptGroundFixture, zones = ["hall", "door"]): Promise<string[]> {
  const result = await missionTextureUsage(fixture.workspace, fixture.blueprintPath, { proposal: { textures: FACTORY.slice(0, 5), zones } });
  // The Kept textures the set must hold, then FACTORY's to fill.
  const required = [...new Set(result.proposal!.required.map((need) => need.texture))];
  const usage = await missionTextureUsage(fixture.workspace, fixture.blueprintPath, { proposal: { textures: [...required, ...FACTORY].slice(0, 8), zones } });
  return [...usage.proposal!.order!];
}

const terrainFiles = async (fixture: KeptGroundFixture) =>
  Object.fromEntries(await Promise.all(["t3Terrain.xml", "t3TextureMasks", "t3SyncTextureInfo"].map(async (file) => [file, await readFile(path.join(fixture.mapPackage, file))] as const)));

describe("a texture set of the Blueprint's own", { timeout: 180_000 }, () => {
  it("is refused when the Kept ground in its blocks would change look, naming the texture and its slot", async () => {
    fixture = await keptGround();
    await withZones(fixture, { textureSets: [{ id: "factory", textures: FACTORY, zones: ["hall", "door"] }] });
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(/Kept ground there has weight on layer \d, which shows Meinhoff\w+ now and set 1 would show as \w+: fill the rest of those blocks with a generating Zone of the set, so no Kept ground is left in it; or put Meinhoff\w+ at position \d of textureSets\[0\]\.textures \(slot \d+\)/);
  });

  it("with the Kept ground's textures on their layers, moves the blocks onto a new set and paints its Zones from it, keeping every Kept texel", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    const before = await textures(fixture);
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await textures(fixture);
    // The shared Kept texture meets itself across the set's boundary, at the same slot: the Editor renders that with an artifact.
    const shared = order.filter((texture) => texture.startsWith("Meinhoff"));
    expect(compiled.warnings.some((warning) => warning.startsWith("Texture set factory's boundary") && shared.some((texture) => warning.includes(`${texture} meeting itself`)))).toBe(true);

    expect(after.setCount).toBe(2);
    expect(after.sets[1]).toBe(defaultSetName(order, new Set([before.sets[0]!])));
    expect(after.slots.slice(8, 8 + order.length)).toEqual(order);
    expect(after.syncNames.slice(8, 8 + order.length)).toEqual(order);
    // Blocks 1-4 × 7-8: the hall's cells reach x 14-29 and the door's x 30-31.
    const moved = [...after.blockSets.keys()].filter((block) => after.blockSets[block] === 1);
    expect(moved).toEqual([113, 114, 115, 129, 130, 131]);
    expect(blocksOfRects(blockRects(moved, after.blocksPerRow), after.blocksPerRow)).toEqual(moved);

    // Every Kept cell's texels are as they were, and every cell's sync set is its block's (readKeptTextures checks).
    const record = await readCompileRecord(fixture.blueprintPath);
    const owned = new Set<number>();
    for (const entry of record!.entries) if (entry.kind === "terrain-cells") for (const [x, y, w, h] of entry.cells) for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) owned.add(cy * 128 + cx);
    let keptChanged = 0;
    let hall = 0;
    const mw = after.masks.maskWidth;
    for (let t = 0; t < mw * after.masks.maskHeight; t++) {
      const cell = Math.floor(Math.floor(t / mw) / 8) * 128 + Math.floor((t % mw) / 8);
      const same = after.masks.layers.every((layer, l) => layer[t] === before.masks.layers[l]![t]);
      if (!owned.has(cell) && !same) keptChanged++;
      if (owned.has(cell) && after.masks.layers[order.indexOf("BraxisAlphaPlatesEx2")]![t] === 15) hall++;
    }
    expect(keptChanged).toBe(0);
    expect(hall).toBeGreaterThan(12 * 12 * 64);
    // Painted up to the boundary between sets: no texel of the hall's cells is left on an old layer.
    expect(record!.entries.filter((entry) => entry.kind === "texture-set")).toMatchObject([{ id: "factory", set: 1, blocks: [[8, 56, 24, 8], [8, 64, 24, 8]] }]);
  });

  it("leaves its slots to the Blueprint when emptying one, and counts only a set's own blocks as painting its slot", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const clear = (slot: number) => editKeptTerrain(fixture!.workspace, fixture!.blueprintPath, { brush: { op: "clear-slot", slot } }, { name: "clear" });
    const before = await terrainFiles(fixture);
    await expect(clear(8 + order.indexOf("PortCityB7"))).rejects.toThrow(
      `Slot ${8 + order.indexOf("PortCityB7")} is in texture set 1, the Blueprint's textureSets[0] (factory), which is Compiled Content: leave position ${order.indexOf("PortCityB7") + 1} of its textures empty ("") in the Blueprint instead. Nothing was written`,
    );
    // Swapping one is refused the same way.
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "swap-slot", slot: 8 + order.indexOf("PortCityB7"), texture: "KorhalCityEx2_3" } }, { confirm: true })).rejects.toThrow(
      `Slot ${8 + order.indexOf("PortCityB7")} is in texture set 1, the Blueprint's textureSets[0] (factory), which is Compiled Content: put the texture at position ${order.indexOf("PortCityB7") + 1} of its textures in the Blueprint instead. Nothing was written`,
    );
    expect(await terrainFiles(fixture)).toEqual(before);

    // The hall paints layer 0 all over set 1's blocks, which is BraxisAlphaPlatesEx2 there: slot 0 (set 0's layer 0) is still painted nowhere.
    expect(order[0]).toBe("BraxisAlphaPlatesEx2");
    const emptied = await clear(0);
    expect(emptied.files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
    const after = await textures(fixture);
    expect(after.slots[0]).toBe("");
    expect(after.syncNames[0]).toBe("");
    expect(after.slots.slice(8, 16)).toEqual(order);
    // A compile afterwards leaves the emptied slot as it is.
    const cleared = await terrainFiles(fixture);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(cleared);
    // MeinhoffCraters (slot 3) covers 15,617 cells on one set. The 6 moved blocks' 384 cells are set 1's now, but their Kept
    // cells, which hold it at layer 3, go back onto set 0 if the Blueprint drops the set, so they count as well.
    const refusal = await clear(3).then(
      () => "",
      (error: Error) => error.message,
    );
    const [, count, back] = /^MeinhoffCraters \(slot 3\) has weight in (\d+) cells, so it isn't emptied: .*\. (\d+) of them are Kept ground in blocks a texture set of the Blueprint's took from set 0, with MeinhoffCraters on that layer in both sets: a compile sends such a block back to set 0 once no Zone of the set holds a cell in it, and they would then show an empty slot\. /.exec(refusal) ?? [];
    expect(Number(count) - Number(back)).toBe(15617 - 384);
    expect(Number(back)).toBeGreaterThan(0);
    expect(Number(back)).toBeLessThan(384);
    // With another texture in set 0's slot 3, those Kept cells can't go back to set 0 unchanged anyway: emptying the slot changes nothing for them.
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "swap-slot", slot: 3, texture: "PortCityB7" } }, { confirm: true, name: "swap" });
    const swapped = await clear(3).then(
      () => "",
      (error: Error) => error.message,
    );
    expect(swapped).toMatch(new RegExp(`^PortCityB7 \\(slot 3\\) has weight in ${15617 - 384} cells, so it isn't emptied: [^.]*\\. Paint them with another texture first\\. Nothing was written$`));
  });

  it("compiles again unchanged, goes back to set 0 byte for byte when the Blueprint drops it, and comes back the same", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    // Painted from set 0 first: the package as it is without the set.
    await withZones(fixture, {}, "MeinhoffConcrete");
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const plain = await terrainFiles(fixture);

    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const withSet = await terrainFiles(fixture);
    expect(withSet["t3Terrain.xml"]).not.toEqual(plain["t3Terrain.xml"]);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(withSet);

    // Dropped, with the hall painted from set 0 again: every file is as it was, and the record lists no set.
    await withZones(fixture, {}, "MeinhoffConcrete");
    const dropped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(plain);
    expect(dropped.warnings.some((warning) => warning.includes("6 blocks the last compile put on a texture set of the Blueprint's went back to set 0"))).toBe(true);
    expect((await readCompileRecord(fixture.blueprintPath))!.entries.some((entry) => entry.kind === "texture-set")).toBe(false);

    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(withSet);
  });

  it("changed in the Editor, stops the compile until the author keeps or discards it; kept, it is left as the Editor has it", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    // The author swaps the set's last slot in Map Textures.
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    const last = 8 + order.length - 1;
    const edited = (await readFile(xmlFile, "utf8")).replace(new RegExp(`(<texture i="${last}" name=")[^"]*`), "$1CharDunes_1");
    await writeFile(xmlFile, edited);

    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => change.name)).toContain("texture-set:factory");

    const kept = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["texture-set:factory"] } });
    expect(await readFile(xmlFile, "utf8")).toContain(`<texture i="${last}" name="CharDunes_1"/>`);
    const record = await readCompileRecord(fixture.blueprintPath);
    expect(record!.kept).toContainEqual({ kind: "texture-set", id: "factory", set: 1, blocks: [[8, 56, 24, 8], [8, 64, 24, 8]] });
    expect(record!.entries.some((entry) => entry.kind === "texture-set")).toBe(false);
    expect(kept.warnings.some((warning) => warning.includes("Texture set factory (set 1) was kept"))).toBe(true);

    // Discarded by name, the Blueprint's set is written again.
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { discard: ["texture-set:factory"] } });
    expect(await readFile(xmlFile, "utf8")).toContain(`<texture i="${last}" name="${order[order.length - 1]}"/>`);
  });

  it("is refused a block that another set's Zone holds cells of, and more than 16 textures", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, {
      textureSets: [
        { id: "factory", textures: order, zones: ["hall"] },
        { id: "doors", textures: order, zones: ["door"] },
      ],
    });
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(/Block 115 \(cells 24-31 × 56-63\) holds cells of texture sets (factory and doors|doors and factory)/);

    const many = ["CharDunes_1", "CharDunes_3", "CharDunes_5", "CharDunes_6", "BelShirDirtLight", "BelShirGrassLight", "AgriaDirt", "AgriaRock"];
    const kept = order.filter((texture) => texture.startsWith("Meinhoff"));
    await withZones(
      fixture,
      { textureSets: [{ id: "factory", textures: [...kept, ...FACTORY, ...many].slice(0, 8), zones: ["hall", "door"] }, { id: "far", textures: many, zones: ["far"] }] },
      order.find((texture) => !texture.startsWith("Meinhoff"))!,
    );
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: unknown[] };
    blueprint.zones.push({ id: "far", name: "Far", elevation: 1, landform: "flat", role: "path", terrain: "generate", texture: "CharDunes_1", polygon: square({ x: 96, y: 96, width: 16, height: 16 }), connections: [] });
    await writeFile(fixture.blueprintPath, JSON.stringify(blueprint, null, 2));
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(/different textures on the map, and the Editor allows 16/);
  });

  it("refuses a Zone outside the set whose cells fall in its blocks without its texture", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture, ["hall"]);
    // The door's cells share block 115 with the hall's; it is painted with a set-0 texture the set doesn't hold.
    const outside = (await textures(fixture)).slots.slice(0, 8).find((texture) => texture !== "" && !order.includes(texture))!;
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: { id: string; texture?: string }[] };
    blueprint.zones.find((zone) => zone.id === "door")!.texture = outside;
    await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, textureSets: [{ id: "factory", textures: order, zones: ["hall"] }] }, null, 2));
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(new RegExp(`Zone door's texture ${outside} isn't in texture set 1`));
  });
});

describe("the textureSets field", () => {
  it("is checked: known Zones, generating ones beside Kept ground (any on a generated map), one set a Zone, the Zone's texture in its set, no texture twice, and textures the game has", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
    const issues = (extra: Record<string, unknown>) => {
      const parsed = validateMissionBlueprint(fixture!.workspace, { ...blueprint, ...extra }, fixture!.workspace.catalog);
      return parsed.success ? [] : parsed.issues.map((issue) => `${issue.path}: ${issue.message}`);
    };
    expect(issues({ textureSets: [{ id: "factory", textures: FACTORY, zones: ["hall"] }] })).toEqual([]);
    expect(issues({ textureSets: [{ id: "factory", textures: FACTORY, zones: ["nowhere", "east_yard"] }] }).join("\n")).toMatch(/Unknown zone id: nowhere[\s\S]*Zone east_yard is drawn over Kept ground/);
    expect(issues({ textureSets: [{ id: "a", textures: FACTORY, zones: ["hall"] }, { id: "b", textures: FACTORY, zones: ["hall"] }] }).join("\n")).toContain("Zone hall is in texture set a already");
    expect(issues({ textureSets: [{ id: "a", textures: FACTORY.slice(1), zones: ["hall"] }] }).join("\n")).toContain("Zone hall's texture BraxisAlphaPlatesEx2 isn't one of texture set a's");
    expect(issues({ textureSets: [{ id: "a", textures: [...FACTORY.slice(0, 2), FACTORY[0]], zones: ["hall"] }] }).join("\n")).toContain("BraxisAlphaPlatesEx2 is in the set twice");
    expect(issues({ textureSets: [{ id: "a", textures: [...FACTORY, "NoSuchTexture"], zones: ["hall"] }] }).join("\n")).toContain("NoSuchTexture isn't a terrain texture the game has");
    const generated = { ...blueprint, zones: (blueprint.zones as { terrain?: string }[]).map(({ terrain: _terrain, ...zone }) => zone) };
    // On a generated map every Zone generates, so a set may paint east_yard, and a pattern match it.
    const parsed = validateMissionBlueprint(fixture.workspace, { ...generated, textureSets: [{ id: "a", textures: FACTORY, zones: ["hall", "east_*"] }] }, fixture.workspace.catalog);
    expect(parsed.success ? [] : parsed.issues.filter((issue) => String(issue.path).startsWith("textureSets"))).toEqual([]);
    expect(listedZoneIds({ zones: ["east_*"] }, generated.zones as { id: string }[])).toEqual(["east_yard"]);
    // Beside Kept ground a set's levels take generating Zones alone, and a palette, a generated map's, is refused.
    const zones = blueprint.zones as { id: string; elevation: number; terrain?: "generate" | "kept" }[];
    const hall = zones.find((zone) => zone.id === "hall")!;
    const byLevel = [...textureSetOfZone([{ zones: [], levels: [hall.elevation] }], zones).keys()];
    expect(byLevel).toContain("hall");
    expect(byLevel.filter((id) => zones.find((zone) => zone.id === id)!.terrain !== "generate")).toEqual([]);
    expect(issues({ textureSets: [{ id: "a", textures: FACTORY, zones: ["hall"], palette: { main: FACTORY[0] } }] })).toEqual([
      "textureSets.0.palette: Texture set a's palette paints a fully generated map only: beside Kept ground give each of its Zones a texture",
    ]);
  });
});

describe("a texture set's CTerrain override", { timeout: 180_000 }, () => {
  const TERRAIN_DATA = "Base.SC2Data/GameData/TerrainData.xml";
  it("lists the set's textures in slot order under its tileset, goes when the set does, and won't take a tileset the package overrides already", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    const terrainData = () => readFile(path.join(fixture!.mapPackage, TERRAIN_DATA), "utf8").catch(() => "");
    const before = await terrainData();
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const name = (await textures(fixture)).sets[1]!;
    const written = await terrainData();
    expect(written).toContain(`<CTerrain id="${name}">\r\n${order.map((texture, index) => `        <BlendTextures index="${index}" value="${texture}"/>`).join("\r\n")}\r\n    </CTerrain>`);
    // The Kept entries stay as they were.
    for (const kept of before.match(/<CTerrain id="[^"]+">[\s\S]*?<\/CTerrain>/g) ?? []) expect(written).toContain(kept);
    expect((await readCompileRecord(fixture.blueprintPath))!.entries).toContainEqual(expect.objectContaining({ kind: "catalog-entry", file: TERRAIN_DATA, id: `CTerrain:${name}` }));

    await withZones(fixture, {}, "MeinhoffConcrete");
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainData()).not.toContain(`<CTerrain id="${name}">`);

    const keptTileset = /<CTerrain id="([^"]+)">/.exec(before)?.[1];
    expect(keptTileset).toBeDefined();
    await withZones(fixture, { textureSets: [{ id: "factory", name: keptTileset, textures: order, zones: ["hall", "door"] }] });
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(`whose CTerrain the package's TerrainData.xml overrides already as Kept Content`);
  });
});

describe("a texture set, the review's cases", { timeout: 180_000 }, () => {
  it("changed in the Editor on a layer the Kept ground shows, asks to keep or discard rather than refusing; kept, it keeps its index", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    // Swap a slot the Kept edge texels show: generating with the Blueprint's set would now change their look.
    const shared = order.findIndex((texture) => texture.startsWith("Meinhoff"));
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    await writeFile(xmlFile, (await readFile(xmlFile, "utf8")).replace(new RegExp(`(<texture i="${8 + shared}" name=")[^"]*`), "$1CharDunes_1"));
    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => change.name)).toEqual(["texture-set:factory"]);

    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["texture-set:factory"] } });
    const keptOnce = await terrainFiles(fixture);
    // Compiled again, the kept set stays at index 1 and nothing changes.
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(keptOnce);
    expect((await textures(fixture)).setCount).toBe(2);
  });

});

describe("a texture set, the code review's cases", { timeout: 240_000 }, () => {
  const TERRAIN_DATA = "Base.SC2Data/GameData/TerrainData.xml";

  it("renamed, takes its blocks onto its new index rather than calling them the Editor's", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await withZones(fixture, { textureSets: [{ id: "factory-set", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await textures(fixture);
    expect(after.blockSets[113]).toBe(2);
    expect(after.sets[1]).toBe("");
    expect(after.slots.slice(8, 16)).toEqual(new Array(8).fill(""));
  });

  it("refuses a name another set has or a tileset the game lacks, and a set every tileset of whose textures is taken", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    const setZero = (await textures(fixture)).sets[0]!;
    // Set 0's tileset: the set's override would replace set 0's list. (The fixture overrides it as Kept Content too, which is refused first.)
    await withZones(fixture, { textureSets: [{ id: "factory", name: setZero, textures: order, zones: ["hall", "door"] }] });
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow(new RegExp(`named ${setZero}, (whose CTerrain|which another)`));
    // Two sets with one name.
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: unknown[] };
    blueprint.zones.push({ id: "far", name: "Far", elevation: 1, landform: "flat", role: "path", terrain: "generate", texture: "CharDunes_1", polygon: square({ x: 96, y: 96, width: 16, height: 16 }), connections: [] });
    await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, textureSets: [{ id: "factory", name: "CharDunes", textures: order, zones: ["hall", "door"] }, { id: "far", name: "CharDunes", textures: ["CharDunes_1"], zones: ["far"] }] }, null, 2));
    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).rejects.toThrow("is named CharDunes, which another of the map's texture sets has");
    // A tileset the game doesn't have.
    const parsed = validateMissionBlueprint(fixture.workspace, { ...blueprint, textureSets: [{ id: "factory", name: "KorhalCityEx", textures: order, zones: ["hall", "door"] }] }, fixture.workspace.catalog);
    expect(parsed.success ? "" : parsed.issues.map((issue) => issue.message).join("\n")).toContain("Unknown tileset KorhalCityEx");
    expect(defaultSetName(["CharDunes_1"], new Set(["CharDunes"]))).toBeUndefined();
  });

  it("adds the GameData component the CTerrain override needs, and keeps a kept set's override", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    const components = path.join(fixture.mapPackage, "ComponentList.SC2Components");
    await writeFile(components, (await readFile(components, "utf8")).replace(/\s*<DataComponent Type="gada">GameData<\/DataComponent>/, ""));
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await readFile(components, "utf8")).toContain('Type="gada">GameData<');

    // Kept after an Editor change, the set keeps its override at the next compile.
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    const last = 8 + order.length - 1;
    await writeFile(xmlFile, (await readFile(xmlFile, "utf8")).replace(new RegExp(`(<texture i="${last}" name=")[^"]*`), "$1CharDunes_1"));
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["texture-set:factory"] } });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const name = (await textures(fixture)).sets[1]!;
    expect(await readFile(path.join(fixture.mapPackage, TERRAIN_DATA), "utf8")).toContain(`<CTerrain id="${name}">`);
  });

  it("asks for a partial proposal's missing part rather than failing", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    await expect(missionTextureUsage(fixture.workspace, fixture.blueprintPath, { proposal: { textures: FACTORY } })).rejects.toThrow("A proposal needs its zones, or set: one of the Blueprint's textureSets");
  });
});

describe("a texture set's Zones as a pattern", { timeout: 180_000 }, () => {
  it("matches every generating Zone whose id fits, so the set follows a relayout, and refuses one that matches none", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const listed = await terrainFiles(fixture);
    // "*" matches hall and door, both generating; the Kept east_yard isn't painted.
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["*"] }] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await terrainFiles(fixture)).toEqual(listed);
    expect(listedZoneIds({ zones: ["h*", "door"] }, [{ id: "hall", terrain: "generate" }, { id: "hut", terrain: "kept" }, { id: "door", terrain: "generate" }])).toEqual(["hall", "door"]);
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
    const parsed = validateMissionBlueprint(fixture.workspace, { ...blueprint, textureSets: [{ id: "factory", textures: order, zones: ["factory-*"] }] }, fixture.workspace.catalog);
    expect(parsed.success ? "" : parsed.issues.map((issue) => issue.message).join("\n")).toContain("factory-* matches no generating Zone");
  });
});

describe("texture usage", { timeout: 120_000 }, () => {
  it("says what each slot paints by Zone, and what a proposed set reuses, adds, needs and in what order", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const plain = await missionTextureUsage(fixture.workspace, fixture.blueprintPath);
    expect(plain.usage.sets).toEqual([{ index: 0, name: (await textures(fixture)).sets[0], blocks: 256 }]);
    expect(plain.usage.distinct).toHaveLength(8);
    expect(plain.usage.room).toBe(8);
    expect(plain.text).toMatch(/slot 3: MeinhoffCraters: dominant in \d+ cells \(\(no Zone\) \d+, hall \d+/);
    expect(plain.text).toContain("slot 0: MeinhoffSandDunes: dominant in 0 cells, any weight in 0: painted nowhere");
    expect(plain.usage.slots.reduce((sum, slot) => sum + slot.dominant, 0)).toBe(128 * 128);

    const { proposal } = await missionTextureUsage(fixture.workspace, fixture.blueprintPath, { proposal: { textures: FACTORY, zones: ["hall", "door"] } });
    expect(proposal!.added).toEqual(FACTORY);
    expect(proposal!.reused).toEqual([]);
    expect(proposal!.blocks).toEqual([113, 114, 115, 129, 130, 131]);
    expect(proposal!.required.length).toBeGreaterThan(0);
    expect(proposal!.missing).toEqual([...new Set(proposal!.required.map((need) => need.texture))]);
    expect(proposal!.order).toBeUndefined();
    expect(proposal!.distinctAfter).toBe(15);
    expect(proposal!.fits).toBe(true);

    const order = await arranged(fixture);
    const fixed = (await missionTextureUsage(fixture.workspace, fixture.blueprintPath, { proposal: { textures: [...order].reverse(), zones: ["hall", "door"] } })).proposal!;
    expect(fixed.missing).toEqual([]);
    expect(fixed.order).toEqual(order.length === new Set(order).size ? expect.arrayContaining(order) : order);
    for (const need of fixed.required) expect(fixed.order![need.layer]).toBe(need.texture);
    expect(fixed.reused.map((reuse) => reuse.texture).sort()).toEqual(fixed.required.map((need) => need.texture).sort());
  });
});

describe("a texture set's boundary", { timeout: 180_000 }, () => {
  it("is listed stretch by stretch by texture_usage and the compile, each with its cells and the texture on each side, and rendered", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const order = await arranged(fixture);
    await withZones(fixture, { textureSets: [{ id: "factory", textures: order, zones: ["hall", "door"] }] });
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });

    // The set's blocks are cells 8-31 × 56-71: 24 + 24 + 16 + 16 pairs of cells along its four sides.
    const { usage, text } = await missionTextureUsage(fixture.workspace, fixture.blueprintPath);
    const { stretches, underCliff } = usage.boundaries;
    const sides: [string, number, number, number][] = [
      ["x", 8, 56, 71],
      ["x", 32, 56, 71],
      ["y", 56, 8, 31],
      ["y", 72, 8, 31],
    ];
    for (const stretch of stretches) expect(sides.some(([line, at, from, to]) => stretch.line === line && stretch.at === at && stretch.from >= from && stretch.to <= to)).toBe(true);
    expect(stretches.reduce((sum, stretch) => sum + stretch.to - stretch.from + 1, 0) + underCliff).toBe(80);
    // The Kept edge of the set's blocks shows set 0's textures again, on the same layers: they meet themselves.
    expect(stretches.some((stretch) => stretch.kind === "artifact" && stretch.shared.every((texture) => order.includes(texture)))).toBe(true);
    for (const stretch of stretches) expect(stretch.sides.map((side) => side.set).sort()).toEqual([0, 1]);
    expect(text).toMatch(/Set boundaries: \d+ stretches? need cover/);
    expect(text).toMatch(/(Artifact|Hard cut) along [xy] = (8|32|56|72), [xy] \d+(-\d+)? \(\d+ cells?\)/);

    // The compile warns with the same stretches, for the set it wrote.
    const warning = compiled.warnings.find((line) => line.startsWith("Texture set factory's boundary"));
    expect(warning).toContain(`${stretches.length} stretch`);
    if (underCliff) expect(warning).toContain(`${underCliff} pair`);
    expect(compiled.warnings.some((line) => line.includes("touches itself across a boundary"))).toBe(false);

    // Rendered on request, the hard cuts and artifacts in the legend's colours.
    expect((await missionTextureUsage(fixture.workspace, fixture.blueprintPath)).render).toBeUndefined();
    const { views, legend } = (await missionTextureUsage(fixture.workspace, fixture.blueprintPath, { render: true })).render!;
    // One set, so one view round it.
    expect(views).toHaveLength(1);
    const { image } = views[0]!;
    const shows = (colour: string) => {
      const [r, g, b] = colour.match(/\d+/g)!.map(Number);
      for (let o = 0; o < image.rgb.length; o += 3) if (image.rgb[o] === r && image.rgb[o + 1] === g && image.rgb[o + 2] === b) return true;
      return false;
    };
    expect(shows(legend["hard cut"]!)).toBe(true);
    expect(shows(legend.artifact!)).toBe(true);
  });
});

describe("the set's default name", () => {
  it("is the tileset listing most of its textures, not one another set has", () => {
    expect(defaultSetName(["KorhalCityEx2_1", ...FACTORY], new Set())).toBe("BraxisAlphaEx2");
    expect(defaultSetName(["KorhalCityEx2_1", ...FACTORY], new Set(["BraxisAlphaEx2"]))).not.toBe("BraxisAlphaEx2");
  });
});
