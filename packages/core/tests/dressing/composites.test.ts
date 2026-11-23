import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { captureComposite } from "../../src/dressing/capture-composite.js";
import { expandDressing, type PlacedDoodad } from "../../src/dressing/expand-dressing.js";
import type { PlacedDoodad as EditorDoodad } from "../../src/map/read-objects-xml.js";
import { compositeActorLines } from "../../src/map/write-composite-actors.js";
import { readDoodadActors } from "../../src/map/read-doodad-actors.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { syncDoodads } from "../../src/sync/sync-doodads.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import type { PluginRegistry } from "../../src/plugins/plugin-api.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";

// The shared recipes come from the Antioch Style Pack, as the `antioch` fixture Workspace loads it.
let registry: PluginRegistry;
beforeAll(async () => {
  ({ registry } = await loadWorkspace(fileURLToPath(new URL("../fixtures/workspaces/antioch/", import.meta.url))));
});

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

type Members = { anchor?: unknown[]; props?: unknown[]; clutter?: unknown[] };
const setPiece = (id: string, at: { x: number; y: number }, members: Members) => ({
  id,
  zoneId: "field",
  kind: "set-piece",
  params: { story: "a test", at, radius: 8, ...members },
});

/** A flat 96x96 field with the given set pieces and the mission's own composites. */
function blueprint(placements: unknown[], composites: unknown[] = []): Record<string, unknown> {
  return {
    id: "composites",
    campaignId: "test",
    title: "Composites",
    setting: "test",
    mapSize: { width: 96, height: 96 },
    tilesetId: "MarSara",
    zones: [{ id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 96, 96) }],
    placements,
    composites,
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Composites" },
  };
}

const expand = (raw: Record<string, unknown>) => {
  const parsed = missionBlueprintSchema(registry).parse(raw);
  return expandDressing(parsed, rasterizeTerrain(parsed));
};
const copiesOf = (doodads: PlacedDoodad[], prefix: string) => Map.groupBy(doodads.filter((d) => d.id.startsWith(prefix)), (d) => d.id.split("/").slice(0, 3).join("/"));

describe("Doodad Composites (DL-07)", () => {
  it("has four of the five recipes DL-07 confirmed in the shared library, then the four Blizzard shapes, then the author's", () => {
    // 3-3's stretched trim is no shape: it needs a placement along an edge.
    expect(registry.contributions("composites").map((c) => c.id)).toEqual([
      "missile-tower",
      "conduit-ring",
      "crowned-column",
      "sunk-tar",
      // Cut whole from Blizzard's interiors, from blizzard-composites.json.
      "console-bank",
      "supply-stack",
      "pipe-manifold",
      "steam-hatch",
      // Built and checked in the Editor by the author, from author-composites.json.
      "crusher-press",
    ]);
    // The press head hangs over the belt and takes no room, so units pass under it.
    const head = registry.composite("crusher-press")!.members.find((m) => m.type === "DOM_Crate")!;
    expect(head).toMatchObject({ x: 0, y: 0, height: 3, scale: 3, variation: 1, noFootprint: true });
    // The steam jet is sunk under its hatch, so only its plume shows (DL-19).
    expect(registry.composite("steam-hatch")!.members.find((m) => m.type === "SpaceSteamJet")!.height).toBeLessThan(-1);
    // The tower brings 3-4's own doodad made from the Scout's missile model.
    expect(registry.composite("missile-tower")!.actors).toEqual([{ id: "AntimatterMissileDoodad", model: "ScoutAirWeaponLeft", scale: 3, animate: false }]);
    expect(registry.composite("crowned-column")!.members).toHaveLength(5);
  });

  it("stamps a recipe rigidly: each member in place relative to the others, ignoring placement", () => {
    const { doodads } = expand(blueprint([setPiece("shrine", { x: 48, y: 48 }, { anchor: [{ composite: "crowned-column" }] })]));
    const column = doodads.filter((d) => d.id.startsWith("shrine/crowned-column/0/"));
    expect(column).toHaveLength(5);
    const base = column.find((d) => d.scale === 0.9)!;
    for (const crown of column.filter((d) => d !== base)) {
      expect(Math.hypot(crown.x - base.x, crown.y - base.y)).toBeCloseTo(0.75, 2);
      expect(crown.z - base.z).toBeCloseTo(3.6, 2);
      expect(crown.forcePlacement).toBe(true);
    }
  });

  it("varies each copy: its turn (45° steps when built), its size within the range, and members' variants", () => {
    const { doodads } = expand(blueprint([setPiece("tar-field", { x: 48, y: 48 }, { clutter: [{ composite: "sunk-tar", count: 8 }] })]));
    const tar = doodads.filter((d) => d.id.startsWith("tar-field/sunk-tar/"));
    expect(tar.length).toBeGreaterThan(4);
    const sizes = new Set(tar.map((d) => d.scale));
    expect(sizes.size).toBeGreaterThan(3);
    for (const d of tar) {
      expect(d.scale as number).toBeGreaterThanOrEqual(0.2);
      expect(d.scale as number).toBeLessThanOrEqual(1.1);
      expect(d.tint).toBe("47,187,255");
    }
    expect(new Set(tar.map((d) => Math.round(d.rotation * 100))).size).toBe(tar.length);
    // Crates (7 variants) pick their own in each copy; the pipes keep the recipe's.
    const { doodads: rings } = expand(blueprint([setPiece("hold", { x: 48, y: 48 }, { anchor: [{ composite: "conduit-ring" }] })]));
    expect(new Set(rings.filter((d) => d.type === "ProtossCratesDoodad").map((d) => d.variation)).size).toBeGreaterThan(3);
    const pipes = (members: { type: string; variation: unknown }[]) => members.filter((m) => m.type === "GenericSpacePipes").map((m) => m.variation).sort();
    expect(pipes(rings)).toEqual(pipes(registry.composite("conduit-ring")!.members));
    // A built recipe turns in 45° steps: every member keeps the recipe's yaw plus a step.
    const { doodads: columns } = expand(blueprint([setPiece("shrine", { x: 48, y: 48 }, { anchor: [{ composite: "crowned-column" }] })]));
    const base = columns.find((d) => d.id === "shrine/crowned-column/0/1")!;
    const steps = (base.rotation - 3.1413) / (Math.PI / 4);
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.01);
  });

  it("faces every copy with a fixed yaw, in degrees, over the recipe's own turns", () => {
    const { doodads } = expand(blueprint([setPiece("shrine", { x: 48, y: 48 }, { anchor: [{ composite: "crowned-column", yaw: 10 }] })]));
    const recipe = registry.composite("crowned-column")!;
    recipe.members.forEach((m, n) => {
      const d = doodads.find((x) => x.id === `shrine/crowned-column/0/${n}`)!;
      const want = (((m.yaw + (10 * Math.PI) / 180) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(d.rotation).toBeCloseTo(want, 9);
    });
  });

  it("warns when copies find no room, and nestles them when asked", () => {
    const crowded = (extra: Record<string, unknown>) =>
      expand(blueprint([{ ...setPiece("hold", { x: 48, y: 48 }, { anchor: [{ composite: "conduit-ring", count: 3, ...extra }] }), params: { story: "a test", at: { x: 48, y: 48 }, radius: 1, anchor: [{ composite: "conduit-ring", count: 3, ...extra }] } }]));
    const { doodads, warnings } = crowded({});
    const copies = copiesOf(doodads, "hold/conduit-ring/").size;
    expect(copies).toBeLessThan(3);
    expect(warnings).toContain(`Set piece hold: placed ${copies} of 3 conduit-ring (no room after 8 tries); give it room or nestle it.`);
    const nestled = crowded({ nestle: true });
    expect(copiesOf(nestled.doodads, "hold/conduit-ring/").size).toBe(3);
    expect(nestled.warnings.filter((w) => w.startsWith("Set piece hold"))).toEqual([]);
  });

  it("warns when a landmark repeats: past three copies, or two within a screen in different set pieces", () => {
    const many = expand(blueprint([setPiece("avenue", { x: 48, y: 48 }, { props: [{ composite: "crowned-column", count: 4 }] })]));
    expect(many.warnings).toEqual([expect.stringContaining("crowned-column is used 4 times")]);
    const pair = expand(blueprint([setPiece("gate", { x: 48, y: 48 }, { props: [{ composite: "crowned-column", count: 2 }] })]));
    expect(pair.warnings).toEqual([]);
    const near = expand(
      blueprint([setPiece("east", { x: 40, y: 48 }, { anchor: [{ composite: "crowned-column" }] }), setPiece("west", { x: 52, y: 48 }, { anchor: [{ composite: "crowned-column" }] })]),
    );
    expect(near.warnings).toEqual([expect.stringContaining("stands in both east and west")]);
    // Details repeat freely.
    expect(expand(blueprint([setPiece("tar-field", { x: 48, y: 48 }, { clutter: [{ composite: "sunk-tar", count: 8 }] })])).warnings).toEqual([]);
  });

  it("prefers the mission's own recipe, and names a missing one", () => {
    const own = { id: "sunk-tar", kind: "detail", members: [{ type: "Bonepile", x: 0, y: 0 }] };
    const { doodads } = expand(blueprint([setPiece("bones", { x: 48, y: 48 }, { anchor: [{ composite: "sunk-tar" }] })], [own]));
    expect(doodads.filter((d) => d.id.startsWith("bones/")).map((d) => d.type)).toEqual(["Bonepile"]);
    expect(() => expand(blueprint([setPiece("bones", { x: 48, y: 48 }, { anchor: [{ composite: "nope" }] })]))).toThrow("no composite nope");
  });

  it("refuses a library recipe for a Blueprint copied in code, which has no Style Pack bound", () => {
    const parsed = missionBlueprintSchema(registry).parse(blueprint([setPiece("arch", { x: 48, y: 48 }, { anchor: [{ composite: registry.contributions("composites")[0]!.id }] })]));
    expect(() => expandDressing({ ...parsed }, rasterizeTerrain(parsed))).toThrow(
      "Doodad Composite missile-tower, which isn't one of the Mission's own, needs a Plugin, but this Blueprint wasn't parsed with missionBlueprintSchema(registry)",
    );
  });

  it("captures a recipe from the doodads in a region, leaving out its negative shapes", () => {
    const doodad = (type: string, x: number, y: number, z: number, more: Partial<EditorDoodad> = {}): EditorDoodad => ({
      id: 1,
      type,
      position: { x, y, z },
      yaw: 0.5,
      pitch: 0,
      roll: 0,
      scale: { x: 1, y: 1, z: 1 },
      flags: [],
      ...more,
    });
    const recipe = captureComposite(
      [
        doodad("Rock", 10, 10, 2),
        doodad("Rock", 12, 10, 5, { pitch: 1.57, scale: { x: 1, y: 2, z: 1 }, tintColor: "90,90,90,255", flags: ["NoDoodadFootprint"] }),
        doodad("Bush", 11, 10.5, 2),
        doodad("Rock", 30, 30, 2),
      ],
      [
        { type: "rect", quad: [8, 8, 14, 12] },
        { type: "circle", center: { x: 11, y: 10.5 }, radius: 0.2, negative: true },
      ],
      () => 2,
      { id: "leaning-rock", kind: "detail" },
    );
    expect(recipe).toEqual({
      id: "leaning-rock",
      kind: "detail",
      style: "natural",
      scale: [1, 1],
      actors: [],
      members: [
        { type: "Rock", x: -1, y: 0, height: 0, yaw: 0.5, scale: 1, variation: 0 },
        { type: "Rock", x: 1, y: 0, height: 3, yaw: 0.5, pitch: 1.57, scale: [1, 2, 1], tint: "90,90,90", variation: 0, noFootprint: true },
      ],
    });
  });

  it("writes a recipe's doodads made from models into the map's ActorData, still by default", async () => {
    const raw = blueprint([setPiece("silo", { x: 48, y: 48 }, { anchor: [{ composite: "missile-tower" }] })]);
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-composite-actors-"));
    try {
      await writeMapPackage({ blueprint: missionBlueprintSchema(registry).parse(raw), outputDir, includeObjects: true, includeTriggers: true });
      const actorData = await readFile(path.join(outputDir, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8");
      expect(actorData).toContain('<CActorDoodad id="AntimatterMissileDoodad">');
      expect(actorData).toContain('<Model value="ScoutAirWeaponLeft"/>');
      // Read back as the capture reads a map's own actors.
      expect(readDoodadActors(actorData).get("AntimatterMissileDoodad")).toEqual({ id: "AntimatterMissileDoodad", model: "ScoutAirWeaponLeft", scale: 3, animate: false });
      const objects = readObjectsXml(await readFile(path.join(outputDir, "Objects"), "utf8"));
      expect(objects.doodads.filter((d) => d.type === "AntimatterMissileDoodad")).toHaveLength(16);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("writes an actor's animation as an ActorCreation event in place of the stock Stand loop, and reads it back", () => {
    const actor = { id: "HarbourLamp", model: "HarbourLampModel", scale: 1, animate: false, animation: "Unpowered" };
    const xml = compositeActorLines([actor]).join("\n");
    expect(xml).toContain('<On index="0" removed="1"/>');
    expect(xml).toContain('<On index="1" removed="1"/>');
    expect(xml).toContain('<On Terms="ActorCreation" Send="AnimPlay Unpowered Stand,Unpowered PlayForever"/>');
    expect(readDoodadActors(xml).get("HarbourLamp")).toEqual(actor);
    // Beside a kept Stand loop, or with a name the Blueprint rejects, it isn't read back.
    const event = '<On Terms="ActorCreation" Send="AnimPlay Unpowered Stand,Unpowered PlayForever"/>';
    const loop = (on: string, send = event) => `<CActorDoodad id="A"><${on}/>${send}<Model value="M"/></CActorDoodad>`;
    expect(readDoodadActors(loop('On index="0" removed="1"')).get("A")).toEqual({ id: "A", model: "M", scale: 1, animate: true });
    expect(readDoodadActors(loop('On index="1" removed="1"', event.replaceAll("Unpowered", "Foo_Bar"))).get("A")).toEqual({ id: "A", model: "M", scale: 1, animate: false });
    // No animation, no event.
    expect(compositeActorLines([{ ...actor, animation: undefined }]).join("\n")).not.toContain("ActorCreation");
  });

  it("rejects an actor that is both animate and has an animation, or an animation that is not one word", () => {
    const withActor = (a: Record<string, unknown>) =>
      missionBlueprintSchema(registry).safeParse(blueprint([], [{ id: "lamp", kind: "landmark", actors: [{ id: "HarbourLamp", model: "HarbourLampModel", ...a }], members: [{ type: "HarbourLamp", x: 0, y: 0 }] }]));
    expect(withActor({ animation: "Unpowered" }).success).toBe(true);
    expect(withActor({ animation: "Unpowered", animate: true }).success).toBe(false);
    expect(withActor({ animation: "Stand Unpowered" }).success).toBe(false);
  });

  it("writes members' NoDoodadFootprint, and syncs an Editor edit to one member by its seed", async () => {
    const trim = { id: "trim", kind: "detail", style: "built", members: [{ type: "StarshipHallTrim", x: 0, y: 0, scale: [1, 1.7, 1], noFootprint: true }] };
    const raw = blueprint([setPiece("hall", { x: 48, y: 48 }, { anchor: [{ composite: "trim" }, { composite: "crowned-column" }] })], [trim]);
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-composites-"));
    try {
      await writeMapPackage({ blueprint: missionBlueprintSchema(registry).parse(raw), outputDir, includeObjects: true });
      const xml = await readFile(path.join(outputDir, "Objects"), "utf8");
      expect(xml).toContain('<Flag Index="NoDoodadFootprint" Value="1"/>');
      const objects = readObjectsXml(xml);
      const crown = stableObjectId("hall/crowned-column/0/0");
      const edited = { ...objects, doodads: objects.doodads.filter((d) => d.id !== crown) };
      const { blueprint: synced, report } = syncDoodads(raw, edited, { registry, catalog: EMPTY_CATALOG });
      expect(report.dressingRemoved).toEqual(["hall/crowned-column/0/0"]);
      const params = (synced["placements"] as { params: { edits: Record<string, unknown> } }[])[0]!.params;
      expect(params.edits).toEqual({ "crowned-column/0/0": { removed: true } });
      expect(copiesOf(expand(synced).doodads, "hall/crowned-column").get("hall/crowned-column/0")).toHaveLength(4);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 20_000);
});
