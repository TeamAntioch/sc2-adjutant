import { describe, expect, it } from "vitest";

import { missingDoodadDependencies } from "../../src/catalog/stock-catalog.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { StyleBlueprintSchema, styleWorkspace } from "../support/workspaces.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { freezeSetPiece } from "../../src/dressing/freeze-set-piece.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 64×64 field with a mesa (ramp at (46, 36)) and a set piece of a wrecked bunker. */
function blueprint(setPiece: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: "dressing",
    campaignId: "test",
    title: "Dressing",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    raggedCliffs: 0,
    tilesetId: "MarSara",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      {
        id: "mesa",
        name: "Mesa",
        elevation: 2,
        landform: "ridge",
        role: "path",
        polygon: rect(36, 36, 56, 56),
        connections: [{ toZoneId: "field", type: "ramp", at: { x: 46, y: 36 } }],
      },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    placements: [
      {
        id: "bunker-fight",
        zoneId: "field",
        kind: "set-piece",
        params: {
          story: "marines held a bunker here and lost",
          at: { x: 18, y: 18 },
          radius: 7,
          anchor: ["BunkerWrecked"],
          props: ["AvernusBarrier"],
          clutter: ["Bonepile", "MarSaraCrack"],
          ...setPiece,
        },
      },
    ],
    screenplay: { title: "Dressing" },
    ...extra,
  };
}

const expand = (raw: ReturnType<typeof blueprint>) => {
  const parsed = StyleBlueprintSchema.parse(raw);
  return expandDressing(parsed, rasterizeTerrain(parsed));
};

describe("set pieces (DL-06, DL-08)", () => {
  const { doodads, setPieces } = expand(blueprint());

  it("places the anchor at the centre, props round it, clutter within the radius", () => {
    const anchor = doodads.find((d) => d.type === "BunkerWrecked")!;
    expect(Math.hypot(anchor.x - 18, anchor.y - 18)).toBeLessThan(0.01);
    expect(doodads.filter((d) => d.type === "AvernusBarrier")).toHaveLength(3);
    expect(doodads.filter((d) => d.type === "Bonepile").length + doodads.filter((d) => d.type === "MarSaraCrack").length).toBeGreaterThanOrEqual(6);
    for (const d of doodads) expect(Math.hypot(d.x - 18, d.y - 18)).toBeLessThanOrEqual(7.01);
    expect(setPieces).toEqual([{ id: "bunker-fight", x: 18, y: 18, radius: 7 }]);
  });

  it("snaps built doodads to 45° and turns natural ones freely (DL-11), at scale 1", () => {
    const quarter = Math.PI / 4;
    for (const d of doodads.filter((x) => x.type === "BunkerWrecked" || x.type === "AvernusBarrier")) {
      expect(Math.abs(d.rotation / quarter - Math.round(d.rotation / quarter))).toBeLessThan(1e-9);
    }
    expect(doodads.every((d) => d.scale === 1)).toBe(true);
  });

  it("leaves every other doodad where it was when a type is added", () => {
    const more = expand(blueprint({ clutter: ["Bonepile", "MarSaraCrack", "ShakurasRuinDebris"] })).doodads;
    for (const d of doodads) expect(more.find((m) => m.id === d.id)).toEqual(d);
  });

  it("gives a type that is both the anchor and a prop a distinct id for each doodad", () => {
    const both = expand(blueprint({ props: [{ type: "BunkerWrecked", count: 1 }, "AvernusBarrier"] })).doodads;
    const ids = both.filter((d) => d.type === "BunkerWrecked").map((d) => d.id);
    expect(ids).toEqual(["bunker-fight/BunkerWrecked/0", "bunker-fight/BunkerWrecked/props/0"]);
    expect(new Set(both.map((d) => d.id)).size).toBe(both.length);
  });

  it("keeps a later member's ids when an earlier member of its type changes count", () => {
    const clutterIds = (density: string) =>
      expand(blueprint({ density, props: ["AvernusBarrier"], clutter: ["AvernusBarrier", "Bonepile"] }))
        .doodads.filter((d) => d.id.startsWith("bunker-fight/AvernusBarrier/clutter/"))
        .map((d) => d.id);
    expect(clutterIds("sparse")).toContain("bunker-fight/AvernusBarrier/clutter/0");
    expect(clutterIds("dense")).toEqual(expect.arrayContaining(clutterIds("sparse")));
  });

  it("scales prop and clutter counts with density", () => {
    const dense = expand(blueprint({ density: "dense" })).doodads;
    expect(dense.filter((d) => d.type === "AvernusBarrier")).toHaveLength(6);
    expect(dense.filter((d) => d.type === "BunkerWrecked")).toHaveLength(1);
  });

  it("keeps off ramps, crossing points and other levels", () => {
    // A set piece centred by the ramp foot: nothing within 4 cells of the crossing point.
    const byRamp = expand(blueprint({ at: { x: 46, y: 31 }, radius: 8 })).doodads;
    for (const d of byRamp) expect(Math.hypot(d.x - 46, d.y - 36)).toBeGreaterThan(4);
    const parsed = StyleBlueprintSchema.parse(blueprint({ at: { x: 46, y: 31 }, radius: 8 }));
    const terrain = rasterizeTerrain(parsed);
    for (const d of byRamp) expect(terrain.syncCliff[Math.floor(d.y) * 64 + Math.floor(d.x)]).toBe(64);
  });

  describe("nestling, dropped members and fixed yaw", () => {
    // A huge vault needs 4 cells of room, while a radius-5 set piece tries its props 1.5-3.75 cells out.
    const vault = (extra: Record<string, unknown> = {}) =>
      blueprint({ radius: 5, anchor: ["Aiur_CityBuilding_Spire"], props: [{ type: "AvernusBarrier", count: 3 }], clutter: [], ...extra });

    it("drops props the spacing check rejects, and warns with the set piece, type and counts", () => {
      const { doodads, warnings } = expand(vault());
      expect(doodads.filter((d) => d.type === "AvernusBarrier")).toHaveLength(0);
      expect(warnings).toContain("Set piece bunker-fight: placed 0 of 3 AvernusBarrier (no room after 8 tries); give it room or nestle it.");
    });

    it("warns nothing when every member lands", () => {
      expect(expand(blueprint()).warnings).toEqual([]);
    });

    it("places nestled members by other doodads, with forced placement", () => {
      const { doodads, warnings } = expand(vault({ nestle: true }));
      const props = doodads.filter((d) => d.type === "AvernusBarrier");
      expect(props).toHaveLength(3);
      expect(props.every((d) => d.forcePlacement === true)).toBe(true);
      expect(warnings).toEqual([]);
      // A member's own setting wins over the set piece's.
      const one = expand(vault({ props: [{ type: "AvernusBarrier", count: 3, nestle: true }] })).doodads;
      expect(one.filter((d) => d.type === "AvernusBarrier" && d.forcePlacement)).toHaveLength(3);
      expect(one.find((d) => d.type === "Aiur_CityBuilding_Spire")!.forcePlacement).toBeUndefined();
      const not = expand(vault({ nestle: true, props: [{ type: "AvernusBarrier", count: 3, nestle: false }] })).doodads;
      expect(not.filter((d) => d.type === "AvernusBarrier")).toHaveLength(0);
    });

    it("keeps nestled members off ramps, crossing points and other levels", () => {
      const raw = blueprint({ at: { x: 46, y: 31 }, radius: 8, nestle: true, clutter: [{ type: "Bonepile", count: 40 }] });
      const byRamp = expand(raw).doodads;
      expect(byRamp.length).toBeGreaterThan(20);
      for (const d of byRamp) expect(Math.hypot(d.x - 46, d.y - 36)).toBeGreaterThan(4);
      const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(raw));
      for (const d of byRamp) expect(terrain.syncCliff[Math.floor(d.y) * 64 + Math.floor(d.x)]).toBe(64);
    });

    it("faces a member with a fixed yaw, in degrees, unsnapped", () => {
      const { doodads } = expand(blueprint({ props: [{ type: "AvernusBarrier", yaw: 10 }], clutter: [{ type: "MarSaraCrack", yaw: 270 }] }));
      const props = doodads.filter((d) => d.type === "AvernusBarrier");
      expect(props).toHaveLength(3);
      for (const d of props) expect(d.rotation).toBeCloseTo((10 * Math.PI) / 180, 9);
      for (const d of doodads.filter((x) => x.type === "MarSaraCrack")) expect(d.rotation).toBeCloseTo((3 * Math.PI) / 2, 9);
    });
  });

  describe("cliff piles (DL-05)", () => {
    const rocks = { large: ["ZerusRockLarge", "Aiur_ChiseledRock_Brown"], small: ["AgriaDebris", "MarSaraGroundProps"], tint: "180,120,100" };
    const wreck = { large: ["BunkerWrecked"], small: ["Tarsonis_Debris_Splat"], accent: ["AvernusBarrier"] };
    const piles = (cliffs: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      expand(blueprint({}, { dressing: { cliffs: { spacing: 4, ...cliffs } }, ...extra })).doodads.filter((d) => !d.setPieceId);

    it("heaps a large piece and small ones of mixed sizes at the foot of each pile, tinted", () => {
      const placed = piles({ natural: rocks });
      const byPile = new Map<string, typeof placed>();
      for (const d of placed) byPile.set(d.id.split("/").slice(0, 2).join("/"), [...(byPile.get(d.id.split("/").slice(0, 2).join("/")) ?? []), d]);
      expect(byPile.size).toBeGreaterThan(2);
      const counts = [...byPile.values()].map((members) => members.length);
      expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
      for (const members of byPile.values()) {
        // A pile is heaped: its members within a few cells of each other.
        for (const a of members) for (const b of members) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(5);
      }
      expect(new Set(placed.map((d) => d.scale)).size).toBeGreaterThan(3);
      expect(placed.every((d) => d.tint === "180,120,100")).toBe(true);
      for (const d of placed) expect(d.x > 30 && d.x < 62 && d.y > 30 && d.y < 62).toBe(true);
    });

    it("pushes a natural pile's large pieces against the cliff, at the foot's height", () => {
      const raw = blueprint({}, { dressing: { cliffs: { spacing: 4, natural: rocks } } });
      const parsed = StyleBlueprintSchema.parse(raw);
      const terrain = rasterizeTerrain(parsed);
      const large = expandDressing(parsed, terrain).doodads.filter((d) => d.id.includes("/large/"));
      expect(large.length).toBeGreaterThan(3);
      // Distance from each to the mesa's edge (x or y = 36 or 56), along whichever is nearest.
      for (const d of large) {
        // From the cliff's toe: the mesh spans the 2 cells outside the mesa (34-36 and 56-58).
        const edge = Math.hypot(Math.max(34 - d.x, 0, d.x - 58), Math.max(34 - d.y, 0, d.y - 58));
        expect(edge).toBeLessThan(0.5);
        expect(d.z).toBeDefined();
        expect(d.z!).toBeLessThan(terrainHeightAt(terrain, 64, 46, 46) - 1); // the ground's height, not up the wall
        expect(d.forcePlacement).toBe(true); // the Editor's "ignore placement", as the author sets it by hand
      }
    });

    it("gives a built cliff the built pile", () => {
      const fort = { cliffPalette: { natural: "MarSaraCliff0", built: "MarSaraCliff1" } };
      const raw = blueprint({}, { ...fort, dressing: { cliffs: { spacing: 4, natural: rocks, built: wreck } } });
      (raw.zones[1] as { surface?: string }).surface = "built";
      const placed = expand(raw).doodads.filter((d) => !d.setPieceId);
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.every((d) => ["BunkerWrecked", "Tarsonis_Debris_Splat", "AvernusBarrier"].includes(d.type))).toBe(true);
    });
  });

  describe("with no Style Pack", () => {
    // Core alone: no Style Pack rules, so plain dressing.
    const rocks = { large: ["ZerusRockLarge", "Aiur_ChiseledRock_Brown"], small: ["AgriaDebris", "MarSaraGroundProps"], tint: "180,120,100" };
    const parsed = MissionBlueprintSchema.parse(blueprint({}, { dressing: { cliffs: { spacing: 4, natural: rocks } } }));
    const plain = expandDressing(parsed, rasterizeTerrain(parsed)).doodads;

    it("piles one large piece at scale 1 off the wall at each cliff foot", () => {
      const piles = plain.filter((d) => d.id.startsWith("cliffs/"));
      expect(piles.length).toBeGreaterThan(3);
      expect(piles.every((d) => d.id.endsWith("/large/0") && d.scale === 1 && !d.forcePlacement && d.tint === "180,120,100")).toBe(true);
    });

    it("turns built doodads freely", () => {
      const quarter = Math.PI / 4;
      const built = plain.filter((x) => x.type === "BunkerWrecked" || x.type === "AvernusBarrier");
      expect(built.some((d) => Math.abs(d.rotation / quarter - Math.round(d.rotation / quarter)) > 1e-3)).toBe(true);
    });
  });

  it("validates set pieces", () => {
    const errors = (raw: unknown): string[] => {
      const result = StyleBlueprintSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(errors(blueprint())).toEqual([]);
    expect(errors(blueprint({ anchor: [], props: [], clutter: [] }))).toEqual(["A set piece needs at least one doodad"]);
    expect(errors(blueprint({ story: undefined })).length).toBeGreaterThan(0);
    expect(errors(blueprint({ nestle: true, props: [{ type: "AvernusBarrier", nestle: false, yaw: 90 }, { composite: "tower", yaw: -45, nestle: true }] }))).toEqual([]);
    expect(errors(blueprint({ props: [{ type: "AvernusBarrier", yaw: "north" }] })).length).toBeGreaterThan(0);
  });
});

describe("doodad dependencies", () => {
  const campaign = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";
  const story = "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign";
  const voidMod = "bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod";

  it("names the campaign a campaign doodad needs, and nothing for base-mod doodads", () => {
    expect(Object.fromEntries(missingDoodadDependencies(["InfestedHomeSmall", "BunkerWrecked"], [voidMod]))).toEqual({ [campaign]: ["InfestedHomeSmall"] });
  });

  it("counts Void Story as bringing in the Void campaign", () => {
    expect(missingDoodadDependencies(["InfestedHomeSmall"], [voidMod, story]).size).toBe(0);
  });
});

describe("freezing a set piece", () => {
  it("writes its doodads as anchors at the same places, and drops the placement", () => {
    const raw = blueprint();
    const { blueprint: frozen, frozen: count } = freezeSetPiece(raw as unknown as Record<string, unknown>, "bunker-fight", styleWorkspace);
    const { doodads } = expand(raw);
    expect(count).toBe(doodads.length);
    const parsed = StyleBlueprintSchema.parse(frozen);
    expect(parsed.placements).toEqual([]);
    const anchors = parsed.anchors.filter((a) => a.kind === "doodad");
    expect(anchors.map((a) => a.doodadType)).toEqual(doodads.map((d) => d.type));
    anchors.forEach((a, index) => {
      expect(a.id).toBe(`bunker-fight-${index + 1}`);
      expect(a.position.x).toBeCloseTo(doodads[index]!.x, 2);
      expect(a.rotation).toBeCloseTo(doodads[index]!.rotation, 2);
    });
  });
});

describe("decal variations (the published catalog's decal descriptions)", () => {
  // Decal's variations 4-13 are the numbers 0-9 and 23-28 stencilled words; 14-16 and 22 are hazard signs.
  const picked = (member: unknown) =>
    expand(blueprint({ anchor: ["BunkerWrecked"], props: [], clutter: [{ type: "Decal", count: 40 }], ...(member ? { clutter: [member] } : {}) }))
      .doodads.filter((d) => d.type === "Decal")
      .map((d) => d.variation);

  it("scatters only plain markings: no numbers, words or signs", () => {
    const variations = picked(undefined);
    expect(variations.length).toBeGreaterThan(10);
    for (const variation of variations) expect([0, 1, 2, 3, 17, 18, 19, 20, 21]).toContain(variation);
  });

  it("places numbers where a member names them", () => {
    const variations = picked({ type: "Decal", count: 12, variations: [5, 6] });
    expect(variations.length).toBeGreaterThan(0);
    for (const variation of variations) expect([5, 6]).toContain(variation);
  });

  it("reports a named variation the doodad lacks, and leaves it out", () => {
    const parsed = StyleBlueprintSchema.parse(blueprint({ anchor: ["BunkerWrecked"], props: [], clutter: [{ type: "Decal", count: 6, variations: [5, 40] }] }));
    const { doodads, warnings } = expandDressing(parsed, rasterizeTerrain(parsed));
    expect(doodads.filter((d) => d.type === "Decal").every((d) => d.variation === 5)).toBe(true);
    expect(warnings).toContain("Decal has 29 variations (0-28), not 40; those are left out.");
  });
});
