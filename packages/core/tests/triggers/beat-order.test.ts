// Beats started on moments that could start out of order (beat-start.ts, beatOrderWarnings): a Beat
// starts only while its trigger is on, and each start turns the earlier Beats' off.
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { beatOrderWarnings } from "../../src/triggers/beat-order.js";

const { registry } = await loadWorkspace(fileURLToPath(new URL("../fixtures/workspaces/basic/", import.meta.url)));

const lit = (mechanicId: string) => ({ type: "mechanic", mechanicId, cue: "lit" });
const mission = (beacons: object[], starts: object[][]) =>
  missionBlueprintSchema(registry).parse({
    id: "order_fixture",
    campaignId: "fixtures",
    title: "Order Fixture",
    setting: "A test field",
    mapSize: { width: 16, height: 16 },
    zones: [{ id: "field", name: "Field", elevation: 1, landform: "flat", role: "path", polygon: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }] }],
    beats: [{ id: "zero", title: "Zero", summary: "Zero." }, ...starts.map((startsWhen, index) => ({ id: `b${index + 1}`, title: `B${index + 1}`, summary: "A Beat.", startsWhen }))],
    anchors: [{ id: "hero", name: "Hero", zoneId: "field", kind: "unit", player: 1, position: { x: 4, y: 8 } }],
    mechanics: beacons,
    screenplay: { title: "Fixture" },
  });
const beacon = (id: string, params: object = {}) => ({ id, type: "beacon", params: { zoneId: "field", ...params } });

describe("Beats on moments out of order", () => {
  it("warns that the earlier may never start when nothing orders the two moments", () => {
    expect(beatOrderWarnings(mission([beacon("one"), beacon("two")], [[lit("one")], [lit("two")]]))).toEqual([
      "Beat b1 may never start: Beat b2, after it, starts on Mechanic two's lit, which nothing orders after Mechanic one's lit, and if it comes first its start turns b1's trigger off. Order the two moments (a Mechanic can guarantee an order, as a meditation's after does), or start the Beats on moments that are",
    ]);
  });

  it("says nothing once a Mechanic guarantees the order, along a chain of them", () => {
    expect(beatOrderWarnings(mission([beacon("one"), beacon("two", { litAfter: "one" }), beacon("three", { litAfter: "two" })], [[lit("one")], [lit("two")], [lit("three")]]))).toEqual([]);
  });

  it("says the earlier never starts when the later Beat's moment always comes first", () => {
    expect(beatOrderWarnings(mission([beacon("one"), beacon("two", { litAfter: "one" })], [[lit("two")], [lit("one")]]))).toEqual([
      "Beat b1 never starts: Beat b2, after it, starts on Mechanic one's lit, which always comes before Mechanic two's lit, and its start turns b1's trigger off. Swap the two Beats, or start b1 on an earlier moment",
    ]);
  });

  it("leaves alone Beats on Kept triggers or scenes, whose order is the cues' and the author's", () => {
    const base = mission([beacon("one")], [[lit("one")]]);
    const starts = [[{ type: "keptTriggerRuns", triggerId: "door" }], [{ type: "keptTriggerRuns", triggerId: "gate" }], [{ type: "scenePlays", scene: 3 }], [{ type: "scenePlays", scene: 2 }], [lit("one")]];
    const beats = [base.beats[0]!, ...starts.map((startsWhen, index) => ({ id: `on${index}`, title: `On ${index}`, summary: "A Beat.", startsWhen }))];
    expect(beatOrderWarnings({ ...base, beats } as unknown as typeof base)).toEqual([]);
  });

  it("leaves alone a pair where an Anchor's event starts either Beat, whose order it can't judge", () => {
    expect(beatOrderWarnings(mission([beacon("one")], [[lit("one")], [{ type: "anchorDies", anchorId: "hero" }]]))).toEqual([]);
  });
});
