// sync on a Mission whose Zones are beside Kept ground (#603): it runs on the Mission's own Map
// Package with its compile record, compares with the ground and dressing the compile writes there
// (the package's ground with the generating Zones in it), adopts the doodads standing on a
// generating Zone's ground as Anchors at their own Editor Ids, and leaves the rest Kept. Synthetic:
// the crossing fixture imported onto Kept ground, with a generating block round its Kept Bench.
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { readCompileRecord } from "../../src/map/mission-package.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { readKeptGround } from "../../src/kept-terrain/kept-ground.js";
import { vertexHeightAt } from "../../src/study/terrain-grid.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { validateMissionBlueprint } from "../../src/plugins/workspace.js";
import { BENCH_ID, type KeptGroundFixture, keptGround, removeKeptGround, WELL } from "../support/kept-ground.js";

const savedAt = new Date("2026-01-01T00:00:00Z");
const BLOCK = { x: 14, y: 56, width: 16, height: 16 };
const square = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const inBlock = (x: number, y: number) => x >= BLOCK.x && x <= BLOCK.x + BLOCK.width && y >= BLOCK.y && y <= BLOCK.y + BLOCK.height;
/** A doodad Anchor in the block, a little way from the Bench. */
const CRATE = { id: "block_crate", name: "Crate", zoneId: "new_block", kind: "doodad", doodadType: "DOM_Crate", position: { x: 24, y: 60 }, rotation: 0, scale: 1 };

let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
});

type Anchor = { id: string; editorId?: number; position: { x: number; y: number; z?: number } };
const blueprintOf = async (fixture: KeptGroundFixture) => JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { anchors: Anchor[]; placements: { params: Record<string, unknown> }[] };
const objectsOf = async (fixture: KeptGroundFixture) => readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8"));

/** The fixture with a generating block at level 2 round the Bench, a set piece and a doodad Anchor in it, and a Kept yard east; compiled once in place. */
async function compiledBesideKept(): Promise<KeptGroundFixture> {
  const made = await keptGround();
  const blueprint = JSON.parse(await readFile(made.blueprintPath, "utf8")) as Record<string, unknown>;
  const zones = [
    { id: "new_block", name: "New block", elevation: 2, landform: "flat", role: "path", terrain: "generate", texture: "MeinhoffConcrete", polygon: square(BLOCK), connections: [] },
    { id: "east_yard", name: "East yard", elevation: 1, landform: "flat", role: "path", terrain: "kept", polygon: square({ x: 30, y: 56, width: 12, height: 16 }) },
  ];
  const placements = [{ id: "rubble", kind: "set-piece", zoneId: "new_block", params: { story: "A collapsed shed.", at: { x: WELL.x + 2, y: WELL.y }, radius: 5, clutter: [{ type: "Korhal_Debris", count: 30 }] } }];
  await writeFile(made.blueprintPath, JSON.stringify({ ...blueprint, zones, placements, anchors: [...((blueprint.anchors as unknown[]) ?? []), CRATE] }, null, 2));
  await compileMission(made.workspace, made.blueprintPath, undefined, { savedAt });
  return made;
}

/** Edits the package's Objects as the Editor would save it. */
async function editObjects(fixture: KeptGroundFixture, change: (objects: string) => string): Promise<void> {
  const file = path.join(fixture.mapPackage, "Objects");
  const before = await readFile(file, "utf8");
  const after = change(before);
  expect(after).not.toBe(before);
  await writeFile(file, after);
}

describe("sync beside Kept ground", { timeout: 120_000 }, () => {
  it("adopts the Kept doodads on a generating Zone's ground the compile can write, and finds nothing else changed after a compile", async () => {
    fixture = await compiledBesideKept();
    const kept = (await objectsOf(fixture)).doodads.filter((doodad) => !inBlock(doodad.position.x, doodad.position.y));

    const result = await syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage);

    // The compile's own dressing and Anchors compare the same with the ground it wrote: nothing else came back.
    expect(result.changes.map((change) => change.label)).toEqual(["Doodads placed in the Editor on ground the compile writes, adopted as Anchors"]);
    const blueprint = await blueprintOf(fixture);
    const adopted = blueprint.anchors.filter((anchor) => anchor.editorId !== undefined);
    expect(adopted.length).toBeGreaterThan(0);
    for (const anchor of adopted) expect(inBlock(anchor.position.x, anchor.position.y)).toBe(true);
    expect(adopted.some((anchor) => kept.some((doodad) => doodad.id === anchor.editorId))).toBe(false);
    // The Bench's type is the fixture's own, which the catalog lacks: the compile couldn't write it, so it stays Kept.
    expect(adopted.map((anchor) => anchor.editorId)).not.toContain(BENCH_ID);
    expect(result.notes).toContainEqual({ label: expect.stringMatching(/left Kept/), items: [`Bench ${BENCH_ID}`] });

    // The compile writes an adopted doodad at its own Id, where it stood, and the next sync has nothing to bring back.
    const id = adopted[0]!.editorId!;
    const before = (await objectsOf(fixture)).doodads.find((doodad) => doodad.id === id)!;
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const objects = await objectsOf(fixture);
    const written = objects.doodads.filter((doodad) => doodad.id === id);
    expect(written).toHaveLength(1);
    expect(written[0]!.position.x).toBeCloseTo(before.position.x, 2);
    expect(written[0]!.position.z).toBeCloseTo(before.position.z, 1);
    expect((await readCompileRecord(fixture.blueprintPath))!.entries).toContainEqual(expect.objectContaining({ kind: "object", id }));
    expect(objects.doodads.filter((doodad) => doodad.id === BENCH_ID)).toHaveLength(1);
    for (const doodad of kept) expect(objects.doodads.find((other) => other.id === doodad.id)).toEqual(doodad);
    expect((await syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage)).changes).toEqual([]);
  });

  it("brings back a moved Anchor, standing it on the package's ground, and a removed dressing doodad", async () => {
    fixture = await compiledBesideKept();
    const record = (await readCompileRecord(fixture.blueprintPath))!;
    const recorded = new Set(record.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
    const crate = stableObjectId(CRATE.id);
    const objects = await objectsOf(fixture);
    const debris = objects.doodads.find((doodad) => recorded.has(doodad.id) && doodad.type === "Korhal_Debris")!;
    // Moved onto the ground where the compile wrote it, as the Editor sets a moved doodad's height.
    const ground = await readKeptGround(fixture.mapPackage);
    const to = { x: 26, y: 68 };
    const z = vertexHeightAt(ground.heights, ground.columns, to.x, to.y);
    await editObjects(fixture, (text) =>
      text
        .replace(new RegExp(`(<ObjectDoodad Id="${crate}"[^>]*? Position=")[^"]*`), `$1${to.x},${to.y},${z.toFixed(4)}`)
        .replace(new RegExp(`\\s*<ObjectDoodad Id="${debris.id}"[^>]*?(?:/>|>[\\s\\S]*?</ObjectDoodad>)`), ""),
    );

    const result = await syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage);

    expect(result.changes).toContainEqual({ label: "Doodad anchors changed", ids: [CRATE.id] });
    expect(result.changes.find((change) => change.label === "Dressing doodads removed")?.ids).toHaveLength(1);
    const blueprint = await blueprintOf(fixture);
    // On the ground the compile writes there: no height of its own.
    expect(blueprint.anchors.find((anchor) => anchor.id === CRATE.id)!.position).toEqual(to);
    expect(JSON.stringify(blueprint.placements[0]!.params)).toContain('"removed":true');
  });

  it("adopts a doodad the author places in the generating Zone, and leaves one placed on Kept ground Kept", async () => {
    fixture = await compiledBesideKept();
    const placed = (id: number, x: number, y: number) => `    <ObjectDoodad Id="${id}" Position="${x},${y},9" Rotation="0" Scale="1,1,1" Type="DOM_Crate"/>\n`;
    await editObjects(fixture, (text) => text.replace("</PlacedObjects>", `${placed(700001, 22, 70)}${placed(700002, 36, 64)}</PlacedObjects>`));

    await syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage);

    const ids = (await blueprintOf(fixture)).anchors.flatMap((anchor) => (anchor.editorId !== undefined ? [anchor.editorId] : []));
    expect(ids).toContain(700001);
    expect(ids).not.toContain(700002);
  });

  it("tells the compile what it brings back, so the compile says to run it first", async () => {
    fixture = await compiledBesideKept();
    const crate = stableObjectId(CRATE.id);
    await editObjects(fixture, (text) => text.replace(new RegExp(`(<ObjectDoodad Id="${crate}"[^>]*? Position=")[^,]*,[^,]*`), "$126,68"));

    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error as Error);

    expect(stopped).toBeInstanceOf(Error);
    expect((stopped as Error).message).toMatch(new RegExp(`Run sync first[\\s\\S]*sync brings back: object:${crate}`));
  });

  it("is refused with no compile record, which alone says what is Compiled", async () => {
    fixture = await compiledBesideKept();
    await rm(path.join(fixture.missionDir, "compile-record.json"));

    await expect(syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage)).rejects.toThrow(/no compile record yet/);
  });

  it("refuses an editorId on anything but a doodad Anchor, or at a Kept Reference's object", async () => {
    fixture = await compiledBesideKept();
    const raw = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { anchors: Record<string, unknown>[]; kept?: Record<string, unknown>[] };
    const issues = (blueprint: unknown) => {
      const result = validateMissionBlueprint(fixture!.workspace, blueprint, fixture!.workspace.catalog);
      return result.success ? [] : result.issues.map((issue) => issue.message);
    };
    const point = { id: "block_mark", name: "Mark", zoneId: "new_block", kind: "point", position: { x: 20, y: 60 }, editorId: 700003 };
    expect(issues({ ...raw, anchors: [...raw.anchors, point] })).toContainEqual(expect.stringMatching(/Only a doodad Anchor takes an editorId/));
    const kept = { id: "yard_marine", kind: "unit", name: "Marine", editorId: 700004 };
    const crate = { ...CRATE, id: "block_crate_2", editorId: 700004 };
    expect(issues({ ...raw, kept: [...(raw.kept ?? []), kept], anchors: [...raw.anchors, crate] })).toContainEqual(expect.stringMatching(/editorId 700004 is the object Kept Reference yard_marine writes too/));
  });

  it("is refused on a map other than the Mission's own package", async () => {
    fixture = await compiledBesideKept();
    const copy = path.join(fixture.root, "elsewhere", "Copy.SC2Map");
    await cp(fixture.mapPackage, copy, { recursive: true });

    await expect(syncMission(fixture.workspace, fixture.blueprintPath, copy)).rejects.toThrow(/sync only from its own Map Package/);
  });
});
