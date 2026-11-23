import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { previewRamps, rasterizeTerrain } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 64×64 field with a raised mesa (30..50) joined to it by a connection of the given type. */
function blueprint(connection: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: "connections",
    campaignId: "test",
    title: "Connections",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "BelShirEx2",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(30, 30, 50, 50), connections: [{ toZoneId: "field", ...connection }] },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Connections" },
    ...extra,
  };
}

describe("ramp connections", () => {
  it("generate a ramp on the high zone's edge facing the low zone, towards it", () => {
    const terrain = rasterizeTerrain(MissionBlueprintSchema.parse(blueprint({ type: "ramp" })));
    // The field's centre (32,32) is south-west of the mesa's (40,40); ties go to north/south,
    // and the offset towards it is clamped so the 8-wide ramp fits the 20-wide edge.
    expect(terrain.ramps).toEqual([{ id: "mesa-field", direction: 1, edge: { x: 34, y: 30 }, lowLevel: 1 }]);
  });

  it("go at the declared point", () => {
    const terrain = rasterizeTerrain(MissionBlueprintSchema.parse(blueprint({ type: "ramp", at: { x: 50, y: 42 } })));
    expect(terrain.ramps).toEqual([{ id: "mesa-field", direction: 2, edge: { x: 50, y: 42 }, lowLevel: 1 }]);
  });

  it("go at the nearest spot that fits when the declared point doesn't", () => {
    // Near the mesa's north-east corner: the 8-wide ramp fits the east edge no higher than y = 46.
    const terrain = rasterizeTerrain(MissionBlueprintSchema.parse(blueprint({ type: "ramp", at: { x: 50, y: 49 } })));
    expect(terrain.ramps).toEqual([{ id: "mesa-field", direction: 2, edge: { x: 50, y: 46 }, lowLevel: 1 }]);
  });

  it("move a little ground to fit a ramp onto a mesa too small for one", () => {
    const tiny = blueprint({ type: "ramp" });
    (tiny.zones[1] as { polygon: unknown }).polygon = rect(30, 30, 36, 36);
    const terrain = rasterizeTerrain(MissionBlueprintSchema.parse(tiny));
    expect(terrain.ramps).toHaveLength(1);
  });

  it("are listed for the preview, not thrown, when no spot fits", () => {
    // A ring of higher ground round the mesa: every spot would need a corner at a third level.
    const ringed = blueprint({ type: "ramp" });
    ringed.zones.splice(1, 0, { id: "ring", name: "Ring", elevation: 3, landform: "ridge", role: "path", polygon: rect(22, 22, 58, 58) });
    const parsed = MissionBlueprintSchema.parse(ringed);
    expect(() => rasterizeTerrain(parsed)).toThrow(/no room for a ramp from field up onto mesa/);
    expect(previewRamps(parsed)).toEqual({ ramps: [], unplaced: ["Ramp mesa-field: no room for a ramp from field up onto mesa, even moving 12 corners"] });
  });

  it("yield to explicit ramps on the same zone", () => {
    const parsed = MissionBlueprintSchema.parse(
      blueprint({ type: "ramp" }, { ramps: [{ id: "front", zoneId: "mesa", edge: "north" }] }),
    );
    expect(rasterizeTerrain(parsed).ramps.map((ramp) => ramp.id)).toEqual(["front"]);
  });

  it("aren't generated for other connection types", () => {
    const terrain = rasterizeTerrain(MissionBlueprintSchema.parse(blueprint({ type: "narrow", width: 6 })));
    expect(terrain.ramps).toEqual([]);
  });
});

describe("connection validation", () => {
  const errors = (raw: unknown): string[] => {
    const result = MissionBlueprintSchema.safeParse(raw);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it("accepts the base blueprint", () => {
    expect(errors(blueprint({ type: "ramp" }))).toEqual([]);
  });

  it("requires a ramp to join zones exactly one level apart, never into a pit", () => {
    const tooHigh = blueprint({ type: "ramp" });
    (tooHigh.zones[1] as { elevation: number }).elevation = 3;
    expect(errors(tooHigh)).toEqual([expect.stringMatching(/exactly one level apart/)]);

    const pit = blueprint({ type: "ramp" });
    (pit.zones[0] as { elevation: number }).elevation = 0;
    (pit.zones[1] as { elevation: number }).elevation = 1;
    expect(errors(pit)).toEqual([expect.stringMatching(/level-0 pit/)]);
  });

  it("rejects both sides of a crossing disagreeing on its type", () => {
    const disagree = blueprint({ type: "ramp" });
    (disagree.zones[0] as { connections?: unknown[] }).connections = [{ toZoneId: "mesa", type: "narrow" }];
    expect(errors(disagree)).toContainEqual(expect.stringMatching(/disagree on their connection type/));
  });

  it("no longer accepts edge and offset (replaced by at)", () => {
    expect(errors(blueprint({ type: "ramp", edge: "east", offset: 2 }))).toEqual([expect.stringMatching(/Unrecognized key/)]);
  });
});
