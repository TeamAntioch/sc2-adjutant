// The static route check: a Connection that the generated terrain proves impassable, from the
// cliff cells and the author's no-pathing paint, without running the game.
import { describe, expect, it } from "vitest";

import { runLayoutChecks } from "../../src/layout/checks.js";
import { buildLayoutModel } from "../../src/layout/layout-model.js";
import { routeFindings, routeTestResults } from "../../src/layout/route-checks.js";
import { CrossingBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

type ZoneInput = { id: string; elevation?: number; polygon: { x: number; y: number }[]; connections?: object[] };

/** Zones on a 48x16 map, each declared as given; the first holds player 1's hero. */
function layout(zones: ZoneInput[], extra: Record<string, unknown> = {}) {
  const blueprint = CrossingBlueprintSchema.parse({
    id: "route_fixture",
    campaignId: "fixtures",
    title: "Route Fixture",
    setting: "A test strip",
    mapSize: { width: 48, height: 16 },
    raggedCliffs: 0,
    zones: zones.map((zone) => ({ name: zone.id.replace(/_/g, " "), elevation: 1, landform: "flat", role: "path", ...zone })),
    anchors: [{ id: "hero", name: "Hero", zoneId: zones[0]!.id, kind: "unit", player: 1, position: { x: 4, y: 8 } }],
    beats: [{ id: "start", title: "Start", summary: "Set out." }],
    objectives: [],
    screenplay: { title: "Fixture" },
    ...extra,
  });
  return buildLayoutModel(blueprint);
}

const link = (to: string, type: string, more: object = {}) => [{ toZoneId: to, type, ...more }];

/** west (0-16) and east (16-32), joined by `type`. */
const pair = (type: string, eastLevel = 1, extra: Record<string, unknown> = {}) =>
  layout(
    [
      { id: "west", polygon: rect(0, 0, 16, 16), connections: link("east", type) },
      { id: "east", elevation: eastLevel, polygon: rect(16, 0, 32, 16), connections: link("west", type) },
    ],
    extra,
  );

describe("routeFindings", () => {
  it("passes a Connection between zones that meet on level ground", () => {
    expect(routeFindings(pair("open"))).toEqual([]);
  });

  it("passes a ramp up a level, which the terrain builds as a walkable lane", () => {
    expect(routeFindings(pair("ramp", 2))).toEqual([]);
  });

  it("reports an open Connection up a cliff, naming the levels and the cells", () => {
    const [finding, ...rest] = routeFindings(pair("open", 2));
    expect(rest).toEqual([]);
    expect(finding).toContain("west and east (open)");
    expect(finding).toContain("blocked");
    expect(finding).toMatch(/cliff/);
    expect(finding).toContain("west at level 1 against east at level 2");
    expect(finding).toMatch(/\(\d+, \d+\)/);
  });

  it("passes a ramp up onto even a small zone, which the terrain still fits", () => {
    const model = layout([
      { id: "west", polygon: rect(0, 0, 16, 16), connections: link("east", "ramp") },
      { id: "east", elevation: 2, polygon: rect(16, 0, 20, 4), connections: link("west", "ramp") },
    ]);
    expect(routeFindings(model)).toEqual([]);
  });

  it("reports ground the author painted no-pathing across the whole meeting edge", () => {
    // Cells 15 and 16 wide, full height: sub-cells are halves of a cell by quarters.
    const [finding, ...rest] = routeFindings(pair("open", 1, { pathingPaint: [{ block: [[15, 0, 2, 16]] }] }));
    expect(rest).toEqual([]);
    expect(finding).toContain("west and east (open)");
    expect(finding).toContain("cut out by pathingPaint");
    expect(finding).not.toMatch(/cliff/);
  });

  it("passes when the paint leaves a gap", () => {
    expect(routeFindings(pair("open", 1, { pathingPaint: [{ block: [[15, 0, 2, 6], [15, 8, 2, 8]] }] }))).toEqual([]);
  });

  it("leaves air-only and bridge Connections alone", () => {
    expect(routeFindings(pair("air-only", 3))).toEqual([]);
    expect(routeFindings(pair("bridge", 1))).toEqual([]);
  });

  it("leaves zones that don't touch to terrain-agreement", () => {
    const model = layout([
      { id: "west", polygon: rect(0, 0, 10, 16), connections: link("east", "open") },
      { id: "east", polygon: rect(20, 0, 30, 16), connections: link("west", "open") },
    ]);
    expect(routeFindings(model)).toEqual([]);
  });

  it("reports a pair once, though each side declares it", () => {
    expect(routeFindings(pair("open", 2))).toHaveLength(1);
  });

  it("is a layout check: warn when blocked, pass when open", () => {
    const find = (model: ReturnType<typeof pair>) => runLayoutChecks(model).find((result) => result.id === "route-open")!;
    expect(find(pair("open"))).toMatchObject({ status: "pass", findings: [] });
    expect(find(pair("open", 2))).toMatchObject({ status: "warn" });
    expect(find(pair("ramp", 2))).toMatchObject({ status: "pass" });
  });
});
