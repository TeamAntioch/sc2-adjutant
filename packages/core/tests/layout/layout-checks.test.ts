import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { runLayoutChecks } from "../../src/layout/checks.js";
import { buildLayoutModel, deepestCell, groundRoute, playerRoute, reachableFrom, zonePoint } from "../../src/layout/layout-model.js";
import { loadPlugins } from "../../src/plugins/registry.js";

// The countdown is a fixture Plugin's Mechanic (tests/fixtures/plugins/countdown).
const plugins = await loadPlugins(fileURLToPath(new URL("../fixtures/", import.meta.url)), [{ source: "bundled:hazard" }, { source: "./plugins/countdown" }]);
const MissionBlueprintSchema = missionBlueprintSchema(plugins);

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

type ZoneInput = {
  id: string;
  elevation?: number;
  role?: string;
  polygon: { x: number; y: number }[];
  connections?: object[];
  overlooks?: string[];
};

/**
 * A strip of zones left to right, 8 cells each on a 48x16 map, with player 1's hero in the first
 * and a primary objective to reach the zone named "goal" (when there is one).
 */
function layout(zones: ZoneInput[], extra: Record<string, unknown> = {}) {
  const hasGoal = zones.some((zone) => zone.id === "goal");
  return buildLayoutModel(
    MissionBlueprintSchema.parse({
      id: "layout_fixture",
      campaignId: "fixtures",
      title: "Layout Fixture",
      setting: "A test strip",
      mapSize: { width: 48, height: 16 },
      raggedCliffs: 0,
      zones: zones.map((zone) => ({
        name: zone.id.replace(/_/g, " "),
        elevation: 1,
        landform: "flat",
        role: "path",
        ...zone,
      })),
      anchors: [{ id: "hero", name: "Hero", zoneId: zones[0]!.id, kind: "unit", player: 1, position: { x: 4, y: 8 } }],
      beats: [
        { id: "start", title: "Start", summary: "Set out." },
        { id: "end", title: "End", summary: "Arrive." },
      ],
      objectives: hasGoal
        ? [{ id: "arrive", title: "Arrive", description: "Reach the goal.", type: "primary", beatId: "end", completeWhen: { type: "anchorEntersZone", anchorId: "hero", zoneId: "goal" } }]
        : [],
      screenplay: { title: "Fixture" },
      ...extra,
    }),
  );
}

const both = (a: string, b: string, type = "open", more: object = {}) => [
  { toZoneId: b, type, ...more },
  { toZoneId: a, type, ...more },
];

/** start (0-8) → mid (8-16) → goal (16-24), all level 1 and declared open. */
function strip(goal: Partial<ZoneInput> = {}, extra: Record<string, unknown> = {}) {
  const [toMid, fromMid] = both("start", "mid");
  const [toGoal, fromGoal] = both("mid", "goal", goal.elevation === 2 ? "ramp" : "open");
  return layout(
    [
      { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [toMid] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [fromMid, toGoal] },
      { id: "goal", role: "objective", polygon: rect(16, 0, 24, 16), connections: [fromGoal], ...goal },
    ],
    extra,
  );
}

const check = (model: ReturnType<typeof layout>, id: string) => runLayoutChecks(model).find((result) => result.id === id)!;

describe("buildLayoutModel", () => {
  it("derives cells, borders and overlooks, with later zones winning", () => {
    const model = layout([
      { id: "ground", polygon: rect(0, 0, 48, 16) },
      { id: "mesa", elevation: 2, polygon: rect(16, 0, 24, 16) },
    ]);
    expect(model.zones.get("mesa")!.cells).toBe(8 * 16);
    expect(model.zones.get("ground")!.cells).toBe(48 * 16 - 8 * 16);
    expect(model.borders).toEqual([expect.objectContaining({ a: "ground", b: "mesa", length: 32 })]);
    expect([...model.overlooks.get("mesa")!]).toEqual(["ground"]);
    expect(model.overlooks.get("ground")!.size).toBe(0);
  });

  it("finds a zone's deepest cell: the walkable cell farthest from every Connection into it", () => {
    // mid is entered from both sides, so its deepest cells are in the middle (the first of the tie).
    expect(deepestCell(strip(), "mid")).toEqual({ x: 11.5, y: 0.5 });
    // goal is entered only from mid, along its whole west edge.
    expect(deepestCell(strip(), "goal")).toEqual({ x: 23.5, y: 0.5 });
    // Only cells inside the bounds count, such as the playable area.
    expect(deepestCell(strip(), "goal", [0, 4, 20, 16])).toEqual({ x: 19.5, y: 4.5 });
    expect(deepestCell(strip(), "goal", [30, 0, 48, 16])).toBeUndefined();
    // A crossing at a point is entered there: the far corner is deepest.
    const [toMid, fromMid] = both("start", "mid");
    const [toGoal, fromGoal] = both("mid", "goal", "open", { at: { x: 16, y: 2 }, width: 2 });
    const ramped = layout([
      { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [toMid] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [fromMid, toGoal] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
    ]);
    expect(deepestCell(ramped, "goal")).toEqual({ x: 23.5, y: 15.5 });
    // A zone with no way in is measured from its ways out.
    const [out] = both("start", "mid");
    const oneWay = layout([
      { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [{ ...out, oneWay: true }] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [] },
    ]);
    expect(deepestCell(oneWay, "start")).toEqual({ x: 0.5, y: 0.5 });
    // A zone with neither has no edge to hide from: its cell nearest the centre, within the bounds.
    const island = layout([
      { id: "start", polygon: rect(0, 0, 8, 16) },
      { id: "nest", elevation: 2, polygon: rect(16, 0, 24, 16) },
    ]);
    expect(deepestCell(island, "nest")).toEqual(zonePoint(island, "nest"));
    expect(zonePoint(island, "nest")).toEqual({ x: 19.5, y: 7.5 });
    expect(deepestCell(island, "nest", [0, 0, 18, 16])).toEqual({ x: 17.5, y: 7.5 });
    expect(deepestCell(island, "nest", [0, 0, 10, 16])).toBeUndefined();
  });

  it("finds the start from player 1's unit and the goal from the objective", () => {
    const model = strip();
    expect(model.startZoneId).toBe("start");
    expect(model.goals).toEqual([{ zoneId: "goal", source: "objective arrive", beatIndex: 1 }]);
  });

  it("follows one-way connections in their direction only", () => {
    const model = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "below", type: "open", oneWay: true }] },
      { id: "below", polygon: rect(8, 0, 16, 16) },
    ]);
    expect([...reachableFrom(model, "start")]).toEqual(["start", "below"]);
    expect([...reachableFrom(model, "below")]).toEqual(["below"]);
  });

  it("times ground routes on the cell grid, from the hero to the goal's edge", () => {
    const model = strip();
    const route = playerRoute(model, model.goals[0]!)!;
    expect(route.zoneIds).toEqual(["start", "mid", "goal"]);
    // The hero stands in cell x 4; the goal starts at cell x 16.
    expect(route.cells).toBe(12);
    expect(route.seconds).toBeCloseTo(12 / 3.15, 5);
  });

  it("crosses a declared bridge between zones that don't touch", () => {
    const model = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "goal", type: "bridge" }] },
      { id: "goal", polygon: rect(12, 0, 20, 16), connections: [{ toZoneId: "start", type: "bridge" }] },
    ]);
    const route = groundRoute(model, { zoneId: "start", point: { x: 4, y: 8 } }, { zoneId: "goal" })!;
    expect(route.zoneIds).toEqual(["start", "goal"]);
    // About three cells to the start's edge (one may be diagonal), then a five-cell jump across the gap.
    expect(route.cells).toBeCloseTo(8, 0);
  });

  it("crosses only near a connection's declared point", () => {
    const pair = (more: object) =>
      layout([
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "goal", type: "narrow", width: 2, ...more }] },
        { id: "goal", polygon: rect(8, 0, 16, 16), connections: [{ toZoneId: "start", type: "narrow", width: 2 }] },
      ]);
    const anywhere = groundRoute(pair({}), { zoneId: "start", point: { x: 4, y: 8 } }, { zoneId: "goal" })!;
    expect(anywhere.cells).toBeCloseTo(4, 0);
    // Through the gap at the bottom of the shared edge, within 1 + 2 cells of (8, 1): down to row 3.
    const corner = groundRoute(pair({ at: { x: 8, y: 1 } }), { zoneId: "start", point: { x: 4, y: 8 } }, { zoneId: "goal" })!;
    expect(corner.cells).toBeCloseTo(3 * Math.SQRT2 + 3, 5);

    const bridge = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "goal", type: "bridge", at: { x: 10, y: 15 } }] },
      { id: "goal", polygon: rect(12, 0, 20, 16), connections: [{ toZoneId: "start", type: "bridge" }] },
    ]);
    // Up to the top of the start's edge (about 7 cells, mostly diagonal), then across.
    expect(groundRoute(bridge, { zoneId: "start", point: { x: 4, y: 8 } }, { zoneId: "goal" })!.cells).toBeGreaterThan(10);

    const offBorder = check(pair({ at: { x: 30, y: 8 } }), "terrain-agreement");
    expect(offBorder.status).toBe("warn");
    expect(offBorder.findings).toEqual(["goal → start is declared at (30, 8), which isn't on their shared border; units can't cross there."]);
  });

  it("routes the player round enemy bases, and through them when there's no way round", () => {
    const [toFort, fromFort] = both("start", "fort");
    const [fortToGoal, goalFromFort] = both("fort", "goal");
    const enemyFort = { id: "fort", role: "base", polygon: rect(8, 0, 16, 8), connections: [fromFort, fortToGoal] };
    const groups = { placements: [{ id: "garrison", zoneId: "fort", kind: "encounter-group" }] };
    const blocked = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [toFort] },
        enemyFort,
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [goalFromFort] },
      ],
      groups,
    );
    expect([...blocked.enemyHeldZoneIds]).toEqual(["fort"]);
    expect(playerRoute(blocked, blocked.goals[0]!)!.throughEnemy).toEqual(["fort"]);
    expect(check(blocked, "critical-path").findings.join("\n")).toContain("Fights through enemy-held fort");

    const [toLane, fromLane] = both("start", "lane");
    const [laneToGoal, goalFromLane] = both("lane", "goal");
    const open = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [toFort, toLane] },
        enemyFort,
        { id: "lane", polygon: rect(8, 8, 16, 16), connections: [fromLane, laneToGoal] },
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [goalFromFort, goalFromLane] },
      ],
      groups,
    );
    const route = playerRoute(open, open.goals[0]!)!;
    expect(route.zoneIds).toEqual(["start", "lane", "goal"]);
    expect(route.throughEnemy).toEqual([]);

    // A garrison passive until after the goal's beat isn't a wall yet.
    const beats = [
      { id: "start", title: "Start", summary: "Set out." },
      { id: "end", title: "End", summary: "Arrive." },
      { id: "after", title: "After", summary: "The fort wakes." },
    ];
    const asleep = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [toFort] },
        enemyFort,
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [goalFromFort] },
      ],
      { beats, placements: [{ id: "garrison", zoneId: "fort", kind: "encounter-group", passiveUntilBeat: "after" }] },
    );
    expect([...asleep.enemyHeldFromBeat]).toEqual([["fort", 2]]);
    expect(playerRoute(asleep, asleep.goals[0]!)!.throughEnemy).toEqual([]);
  });

  it("places an encounter with a startsWhen where it starts, from the Beat that starts on the same condition", () => {
    const anchors = [
      { id: "hero", name: "Hero", zoneId: "start", kind: "unit", player: 1, position: { x: 4, y: 8 } },
      { id: "raider", name: "Raider", zoneId: "goal", kind: "unit", player: 2, position: { x: 20, y: 8 } },
      { id: "sentry", name: "Sentry", zoneId: "mid", kind: "unit", player: 2, position: { x: 12, y: 8 } },
    ];
    const enters = { type: "anchorEntersZone", anchorId: "hero", zoneId: "goal" };
    const beats = [
      { id: "start", title: "Start", summary: "Set out." },
      { id: "end", title: "End", summary: "Arrive.", startsWhen: [enters] },
    ];
    const model = strip(
      {},
      {
        anchors,
        beats,
        encounters: [
          { id: "reached", triggerZoneId: "start", attackerAnchorIds: ["raider"], startsWhen: enters },
          { id: "captured", triggerZoneId: "start", attackerAnchorIds: ["raider"], startsWhen: { type: "anchorCaptured", anchorId: "sentry" } },
        ],
      },
    );
    const [reached, captured] = model.threats();
    expect(reached).toMatchObject({ footprint: { zoneIds: ["goal"] }, schedule: { kind: "from-beat", beatId: "end" } });
    // No Zone in an Anchor's condition: where the Anchor stands, from the first Beat.
    expect(captured).toMatchObject({ footprint: { zoneIds: ["mid", "goal"] }, schedule: { kind: "from-beat", beatId: "start" } });
  });

  it("schedules an encounter with fromBeat from that Beat, or from its startsWhen's Beat if that is later", () => {
    const anchors = [
      { id: "hero", name: "Hero", zoneId: "start", kind: "unit", player: 1, position: { x: 4, y: 8 } },
      { id: "raider", name: "Raider", zoneId: "goal", kind: "unit", player: 2, position: { x: 20, y: 8 } },
    ];
    const enters = { type: "anchorEntersZone", anchorId: "hero", zoneId: "goal" };
    const beats = [
      { id: "start", title: "Start", summary: "Set out." },
      { id: "mid", title: "Mid", summary: "Halfway.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "mid" }] },
      { id: "end", title: "End", summary: "Arrive.", startsWhen: [enters] },
    ];
    const model = strip(
      {},
      {
        anchors,
        beats,
        encounters: [
          { id: "armed", triggerZoneId: "mid", attackerAnchorIds: ["raider"], fromBeat: "mid" },
          { id: "later", triggerZoneId: "start", attackerAnchorIds: ["raider"], startsWhen: enters, fromBeat: "mid" },
        ],
      },
    );
    const [armed, later] = model.threats();
    expect(armed).toMatchObject({ schedule: { kind: "from-beat", beatId: "mid" } });
    expect(later).toMatchObject({ schedule: { kind: "from-beat", beatId: "end" } });
  });

  it("makes Threats of encounters, enemy groups, waves and Mechanics", () => {
    const model = strip(
      {},
      {
        anchors: [
          { id: "hero", name: "Hero", zoneId: "start", kind: "unit", player: 1, position: { x: 4, y: 8 } },
          { id: "raider", name: "Raider", zoneId: "goal", kind: "unit", player: 2, position: { x: 20, y: 8 } },
        ],
        encounters: [{ id: "ambush", triggerZoneId: "mid", attackerAnchorIds: ["raider"] }],
        placements: [{ id: "sleepers", zoneId: "goal", kind: "encounter-group", passiveUntilBeat: "end" }],
        waves: [{ id: "rush", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units: [{ type: "Zergling", count: 1 }], startsAtBeat: "start", firstSeconds: 60, intervalSeconds: 120 }],
        mechanics: [
          {
            id: "lava",
            type: "hazard",
            params: { affectedZoneIds: ["mid"], safeZoneIds: ["start"], firstSeconds: 30, intervalSeconds: 90, deadlySeconds: 15, warningSeconds: 10 },
          },
        ],
      },
    );
    const none = { description: "none declared" };
    expect(model.threats()).toEqual([
      {
        source: { kind: "encounter", id: "ambush" },
        footprint: { zoneIds: ["mid", "goal"] },
        schedule: { kind: "from-beat", beatId: "start" },
        telegraph: none,
        safety: { zoneIds: [] },
        consequence: "combat",
      },
      {
        source: { kind: "enemy group", id: "sleepers" },
        footprint: { zoneIds: ["goal"] },
        schedule: { kind: "from-beat", beatId: "end" },
        telegraph: none,
        safety: { zoneIds: [] },
        consequence: "combat",
      },
      {
        source: { kind: "wave", id: "rush" },
        footprint: { zoneIds: ["start"] },
        schedule: { kind: "cycle", fromBeatId: "start", firstSeconds: 60, intervalSeconds: 120 },
        telegraph: none,
        safety: { zoneIds: [] },
        consequence: "combat",
      },
      {
        source: { kind: "Mechanic", id: "lava" },
        footprint: { zoneIds: ["mid"] },
        schedule: { kind: "cycle", firstSeconds: 30, intervalSeconds: 90, activeSeconds: 15 },
        telegraph: { warningSeconds: 10, description: "declared" },
        safety: { zoneIds: ["start"] },
        consequence: "damage",
      },
    ]);
  });
});

describe("runLayoutChecks", () => {
  it("passes a clean strip, and leaves checks without inputs unevaluated", () => {
    const results = Object.fromEntries(runLayoutChecks(strip()).map((result) => [result.id, result.status]));
    expect(results).toMatchObject({
      "terrain-agreement": "pass",
      "beat-gating": "not-evaluated",
      teaching: "not-evaluated",
      vaults: "not-evaluated",
      "safe-havens": "not-evaluated",
      "dead-space": "pass",
    });
  });

  it("flags same-level borders with no declared connection, and open connections across a cliff", () => {
    const model = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "mesa", type: "open" }] },
      { id: "mesa", elevation: 2, polygon: rect(8, 0, 16, 16), connections: [{ toZoneId: "start", type: "open" }] },
      { id: "beside", polygon: rect(16, 0, 24, 16) },
    ]);
    const findings = check(model, "terrain-agreement").findings.join("\n");
    expect(findings).toContain("a cliff separates them");
    const flat = layout([
      { id: "start", polygon: rect(0, 0, 8, 16) },
      { id: "next", polygon: rect(8, 0, 16, 16) },
    ]);
    expect(check(flat, "terrain-agreement").findings.join("\n")).toContain("no declared connection");
  });

  it("notes fixed crossings with no way round, and warns about ones that can close", () => {
    const fixed = check(strip(), "critical-path");
    expect(fixed.status).toBe("pass");
    expect(fixed.findings.join("\n")).toContain("Single points of failure (fixed, so usually intended): start → mid; mid → goal");
    const [toGoal, fromGoal] = both("mid", "goal", "collapsible");
    const collapsing = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], toGoal] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
    ]);
    expect(check(collapsing, "critical-path").status).toBe("warn");
    expect(check(collapsing, "critical-path").findings.join("\n")).toContain("can close or be destroyed: mid → goal");
    // Expected on an escort's road.
    const escort = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]] },
        { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], toGoal] },
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
      ],
      { archetype: "escort" },
    );
    expect(check(escort, "critical-path").status).toBe("pass");
    expect(check(escort, "critical-path").findings.join("\n")).toContain("(expected in an escort): mid → goal");
  });

  it("clears single points of failure when a ground loop exists, but not for an air-only link", () => {
    // start and goal also meet directly across a narrow pass along the top: a second ground route.
    const loop = layout([
      { id: "start", polygon: rect(0, 0, 8, 12), connections: [both("start", "mid")[0], both("start", "pass", "narrow")[0]] },
      { id: "mid", polygon: rect(8, 0, 16, 12), connections: [both("start", "mid")[1], both("mid", "goal")[0]] },
      { id: "goal", polygon: rect(16, 0, 24, 12), connections: [both("mid", "goal")[1], both("pass", "goal", "narrow")[1]] },
      { id: "pass", polygon: rect(0, 12, 24, 16), connections: [both("start", "pass", "narrow")[1], both("pass", "goal", "narrow")[0]] },
    ]);
    expect(check(loop, "critical-path").findings.join("\n")).not.toContain("Single points of failure");
    // An air-only link is no way round for a ground army.
    const air = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0], { toZoneId: "goal", type: "air-only" }] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], both("mid", "goal")[0]] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [both("mid", "goal")[1], { toZoneId: "start", type: "air-only" }] },
    ]);
    expect(check(air, "critical-path").findings.join("\n")).toContain("Single points of failure");
  });

  it("counts entrances into the player's held region and each enemy base complex", () => {
    const groups = { placements: [{ id: "garrison", zoneId: "keep", kind: "encounter-group" }] };
    const model = layout(
      [
        { id: "main", role: "base", polygon: rect(0, 0, 8, 16), connections: [both("main", "terrace", "ramp")[0]] },
        { id: "terrace", role: "base", elevation: 2, polygon: rect(8, 0, 16, 16), connections: [both("main", "terrace", "ramp")[1], both("terrace", "field", "ramp")[0]] },
        { id: "field", polygon: rect(16, 0, 32, 16), connections: [both("terrace", "field", "ramp")[1], both("field", "keep")[0], { toZoneId: "main", type: "air-only" }] },
        { id: "keep", role: "base", polygon: rect(32, 0, 40, 16), connections: [both("field", "keep")[1]] },
      ],
      groups,
    );
    const findings = check(model, "entrances").findings;
    expect(findings[0]).toBe("The player's held region (main, terrace): 1 ground entrance (ramp from field), plus 1 air-only.");
    expect(findings[1]).toBe("Enemy-held region (keep): 1 ground entrance (open from field).");
  });

  it("warns when a goal's connection opens only after the goal's beat", () => {
    const [toGoal, fromGoal] = both("mid", "goal", "rocks", { opensAtBeat: "end" });
    const onTime = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], toGoal] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
    ]);
    expect(check(onTime, "beat-gating").status).toBe("pass");
    const [late, lateBack] = both("mid", "goal", "rocks", { closesAtBeat: "end" });
    const closed = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], late] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [lateBack] },
    ]);
    expect(check(closed, "beat-gating").findings.join("\n")).toContain("can't be reached during \"End\"");
  });

  it("warns about blind goals, and passes one overlooked from high ground or a declared view", () => {
    // Uphill, or on the level: nothing seen before entering.
    expect(check(strip({ elevation: 2 }), "readable-approach").findings[0]).toContain("Nothing reveals goal by its beat");
    expect(check(strip(), "readable-approach").status).toBe("warn");
    // Descending from a ridge that borders the goal.
    const downhill = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "ridge", type: "ramp" }] },
      { id: "ridge", elevation: 2, polygon: rect(8, 0, 16, 16), connections: [{ toZoneId: "start", type: "ramp" }, { toZoneId: "goal", type: "ramp" }] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [{ toZoneId: "ridge", type: "ramp" }] },
    ]);
    expect(check(downhill, "readable-approach").status).toBe("pass");
    // A declared long view (a watchtower) from the start.
    const watchtower = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]], overlooks: ["goal"] },
      { id: "mid", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], both("mid", "goal")[0]] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [both("mid", "goal")[1]] },
    ]);
    expect(check(watchtower, "readable-approach").status).toBe("pass");
    // Enemy-held high ground beside the goal is no viewpoint for the player.
    const enemyRidge = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0], { toZoneId: "ridge", type: "ramp" }] },
        { id: "mid", polygon: rect(8, 0, 16, 8), connections: [both("start", "mid")[1], both("mid", "goal")[0]] },
        { id: "ridge", role: "base", elevation: 2, polygon: rect(8, 8, 16, 16), connections: [{ toZoneId: "start", type: "ramp" }] },
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [both("mid", "goal")[1]] },
      ],
      { placements: [{ id: "hive", zoneId: "ridge", kind: "encounter-group" }] },
    );
    expect(check(enemyRidge, "readable-approach").status).toBe("warn");
  });

  it("passes a goal the script reveals by its beat, and says how each goal is previewed", () => {
    const beats = (revealIn: string) =>
      ["start", "end", "after"].map((id) => ({ id, title: id, summary: id, reveals: id === revealIn ? ["goal"] : [] }));
    const revealed = check(strip({}, { beats: beats("start") }), "readable-approach");
    expect(revealed.status).toBe("pass");
    expect(revealed.findings).toEqual(["goal: revealed in start."]);
    expect(check(strip({}, { beats: beats("end") }), "readable-approach").status).toBe("pass");
    // A reveal after the goal's beat comes too late.
    expect(check(strip({}, { beats: beats("after") }), "readable-approach").status).toBe("warn");
  });

  it("rejects reveals of unknown zones", () => {
    const result = MissionBlueprintSchema.safeParse({
      id: "bad",
      campaignId: "fixtures",
      title: "Bad",
      setting: "Nowhere",
      mapSize: { width: 16, height: 16 },
      raggedCliffs: 0,
      zones: [{ id: "only", name: "Only", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 16, 16) }],
      beats: [{ id: "start", title: "Start", summary: "Start.", reveals: ["nowhere"] }],
      screenplay: { title: "Bad" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Unknown zone id: nowhere");
  });

  it("counts a wave's unit that joins only its first send in that send only", () => {
    const units = [
      { type: "Zergling", count: 2 },
      { type: "Ultralisk", count: [1, 1, 1, 1], sends: "first" },
    ];
    const wave = { id: "rush", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units, startsAtBeat: "start", firstSeconds: 60, intervalSeconds: 120 };
    const result = check(strip({}, { waves: [wave] }), "threat-paths");
    expect(result.findings[0]).toMatch(/^Wave rush \(Zergling ×2, and on its first send Ultralisk ×1\/1\/1\/1\) from "Start"/);
  });

  it("asks about a type a wave lists for every send and again for its first only once", () => {
    const units = [
      { type: "Zealot", count: 2 },
      { type: "Zealot", count: 1, sends: "first" },
    ];
    const beats = [
      { id: "start", title: "Start", summary: "Go.", introduces: ["Marine"] },
      { id: "end", title: "End", summary: "Done." },
    ];
    const wave = { id: "rush", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units, startsAtBeat: "start", firstSeconds: 60, intervalSeconds: 120 };
    expect(check(strip({}, { beats, waves: [wave] }), "teaching").findings).toEqual(['Wave rush brings Zealot in "Start", but no beat up to it introduces them.']);
  });

  it("routes ground waves to their target and reports the entrance and timing", () => {
    const wave = { id: "rush", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units: [{ type: "Zergling", count: 1 }], startsAtBeat: "start", firstSeconds: 60, intervalSeconds: 120 };
    const model = strip({}, { waves: [wave, { ...wave, id: "mutas", arrival: "air", units: [{ type: "Mutalisk", count: 1 }] }] });
    const result = check(model, "threat-paths");
    expect(result.status).toBe("info");
    expect(result.findings[0]).toBe('Wave rush (Zergling) from "Start" (60 s in, then every 120 s): goal → mid → start; reaches start after about 4 s (12 cells, at marine speed).');
    expect(result.findings[1]).toContain("arrives at start by air");
    // The attack on the base is reported, not warned about.
    const havens = check(model, "safe-havens");
    expect(havens.status).toBe("info");
    expect(havens.findings[0]).toContain("start is attacked by waves rush, mutas");
    // With a refuge in front of the base, the wave enters the held region there first.
    const [toMid, fromMid] = both("start", "mid");
    const [toGoal, fromGoal] = both("mid", "goal");
    const outpost = layout(
      [
        { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [toMid] },
        { id: "mid", role: "refuge", polygon: rect(8, 0, 16, 16), connections: [fromMid, toGoal] },
        { id: "goal", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
      ],
      { waves: [wave] },
    );
    expect(check(outpost, "threat-paths").findings[0]).toMatch(/goal → mid → start; enters mid from goal after about \d+ s and reaches start after about \d+ s/);
  });

  it("routes a wave to each of its candidates, threatens them all, and reads its warning as the telegraph", () => {
    const raid = {
      id: "raid",
      spawnZoneId: "goal",
      targetZoneIds: ["mid", "start"],
      arrival: "ground",
      units: [
        { type: "Zealot", count: 2 },
        { type: "Stalker", count: [0, 0, 1, 2] },
      ],
      onlyIfPlayerHolds: "Assimilator",
      warning: { seconds: 15 },
      startsAtBeat: "start",
      endsAtBeat: "end",
      firstSeconds: 60,
      intervalSeconds: 120,
    };
    const beats = [
      { id: "start", title: "Start", summary: "Set out.", introduces: ["Zealot"] },
      { id: "end", title: "End", summary: "Arrive." },
    ];
    const model = strip({}, { beats, waves: [raid] });
    const paths = check(model, "threat-paths");
    expect(paths.status).toBe("info");
    expect(paths.findings).toEqual([
      'Wave raid (Zealot ×2, Stalker ×0/0/1/2), raiding where the player holds Assimilator, from "Start" (60 s in, then every 120 s until "End"): goal → mid; reaches mid after about 1 s (4 cells, at marine speed).',
      'Wave raid (Zealot ×2, Stalker ×0/0/1/2), raiding where the player holds Assimilator, from "Start" (60 s in, then every 120 s until "End"): goal → mid → start; reaches start after about 4 s (12 cells, at marine speed).',
    ]);
    expect(model.threats()).toEqual([
      expect.objectContaining({ footprint: { zoneIds: ["mid", "start"] }, telegraph: { warningSeconds: 15, description: "a minimap ping as the wave nears" } }),
    ]);
    expect(check(model, "safe-havens").findings).toEqual(["start is attacked by wave raid; intended for a hold or a base under pressure, otherwise a scripted breach."]);
    expect(check(model, "teaching").findings).toEqual(['Wave raid brings Stalker in "Start", but no beat up to it introduces them.']);
    const screenplay = { title: "Fixture", scenes: [{ id: "alarm", lines: [{ id: "incoming", speaker: "Hero", text: "Incoming!" }] }] };
    const telegraph = (warning: object) => strip({}, { beats, screenplay, waves: [{ ...raid, warning }] }).threats()[0]!.telegraph;
    expect(telegraph({ seconds: 15, transmission: "alarm" })).toEqual({ warningSeconds: 15, description: "a minimap ping and a Transmission as the wave nears" });
    // Later sends aren't warned, so there's no warning before each strike.
    expect(telegraph({ seconds: 15, firstOnly: true })).toEqual({ description: "a minimap ping as the wave nears, 15 s out, on its first send only" });
  });

  it("warns for each candidate a wave has no ground route to", () => {
    const wave = { id: "rush", spawnZoneId: "start", targetZoneIds: ["nest", "mid"], onlyIfPlayerHolds: "Hatchery", arrival: "ground", units: [{ type: "Zergling", count: 1 }], startsAtBeat: "start", firstSeconds: 0 };
    const [toMid, fromMid] = both("start", "mid");
    const model = layout(
      [
        { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [toMid] },
        { id: "mid", polygon: rect(8, 0, 16, 16), connections: [fromMid] },
        { id: "nest", elevation: 2, polygon: rect(24, 0, 32, 16) },
      ],
      { waves: [wave] },
    );
    const result = check(model, "threat-paths");
    expect(result.status).toBe("warn");
    expect(result.findings[0]).toContain("has no ground route from start to nest");
    expect(result.findings[1]).toContain("reaches mid after about");
  });

  it("times waves at their declared speed and warns when one has no ground route", () => {
    const wave = { id: "rush", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units: [{ type: "Zergling", count: 1 }], startsAtBeat: "start", firstSeconds: 0 };
    const slow = check(strip({}, { waves: [{ ...wave, speed: 1 }] }), "threat-paths").findings[0]!;
    const fast = check(strip({}, { waves: [{ ...wave, speed: 4 }] }), "threat-paths").findings[0]!;
    const seconds = (finding: string) => Number(/reaches start after about (\d+) s/.exec(finding)![1]);
    expect(seconds(slow)).toBeGreaterThan(3 * seconds(fast));
    expect(slow).toContain("once");
    const island = layout([
      { id: "start", role: "base", polygon: rect(0, 0, 8, 16) },
      { id: "nest", elevation: 2, polygon: rect(16, 0, 24, 16) },
    ], { waves: [{ ...wave, spawnZoneId: "nest" }] });
    expect(check(island, "threat-paths").status).toBe("warn");
  });

  it("asks for wave units no beat introduces", () => {
    const beats = [
      { id: "start", title: "Start", summary: "Set out.", introduces: ["Zergling"] },
      { id: "end", title: "End", summary: "Arrive." },
    ];
    const wave = { id: "late", spawnZoneId: "goal", targetZoneIds: ["start"], arrival: "ground", units: [{ type: "Zergling", count: 1 }, { type: "Hydralisk", count: 1 }], startsAtBeat: "end", firstSeconds: 0 };
    expect(check(strip({}, { beats, waves: [wave] }), "teaching").findings).toContain(
      'Wave late brings Hydralisk in "End", but no beat up to it introduces them.',
    );
  });

  it("rejects waves that end before they start", () => {
    const result = MissionBlueprintSchema.safeParse({
      id: "bad",
      campaignId: "fixtures",
      title: "Bad",
      setting: "Nowhere",
      mapSize: { width: 16, height: 16 },
      raggedCliffs: 0,
      zones: [{ id: "only", name: "Only", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 16, 16) }],
      beats: [
        { id: "one", title: "One", summary: "One." },
        { id: "two", title: "Two", summary: "Two." },
      ],
      waves: [{ id: "w", spawnZoneId: "only", targetZoneIds: ["only"], arrival: "air", units: [{ type: "Mutalisk", count: 1 }], startsAtBeat: "two", endsAtBeat: "one", firstSeconds: 0 }],
      screenplay: { title: "Bad" },
    });
    expect(result.error?.issues[0]?.message).toBe("A wave must end at a later beat than it starts");
  });

  it("carries a beat's archetype forward from the blueprint's", () => {
    const beats = ["raid", "regroup", "end"].map((id) => ({ id, title: id, summary: id, ...(id === "regroup" ? { archetype: "assault" } : {}) }));
    expect(strip({}, { archetype: "commando", beats }).archetypes).toEqual(["commando", "assault", "assault"]);
    expect(strip().archetypes).toEqual([undefined, undefined]);
    expect(check(strip(), "archetype-bands").status).toBe("not-evaluated");
  });

  it("holds a hold to its entrance and wave bands", () => {
    // One ground entrance, and a wave that sets off next door every 60 s.
    const wave = { id: "rush", spawnZoneId: "mid", targetZoneIds: ["start"], arrival: "ground", units: [{ type: "Zergling", count: 1 }], startsAtBeat: "start", firstSeconds: 0, intervalSeconds: 60 };
    const findings = check(strip({}, { archetype: "hold", waves: [wave] }), "archetype-bands").findings.join("\n");
    expect(findings).toContain("Hold: the held region has 1 ground entrances; the band is 2-4.");
    expect(findings).toMatch(/Hold: wave rush reaches the held region about \d s after setting off; the band is at least 8 s/);
    expect(findings).toContain("Hold: wave rush repeats every 60 s; outside the final beat the band is at least 120 s.");
    // The same wave in the final beat is a finale.
    const finale = check(strip({}, { archetype: "hold", waves: [{ ...wave, startsAtBeat: "end" }] }), "archetype-bands").findings.join("\n");
    expect(finale).not.toContain("repeats every");
  });

  it("asks an assault for two ways into each enemy base", () => {
    const model = strip({ role: "base" }, { archetype: "assault", placements: [{ id: "garrison", zoneId: "goal", kind: "encounter-group" }] });
    const result = check(model, "archetype-bands");
    expect(result.status).toBe("warn");
    expect(result.findings[0]).toBe("Assault: enemy base goal has 1 ground entrance; the band is at least 2 (one into an inner keep is fine).");
    expect(result.findings[1]).toMatch(/^Assault: goal is about \d+ s from the start; the band is 30-60 s/);
  });

  it("routes an escort from the escorted unit, at its speed", () => {
    const anchors = [
      { id: "hero", name: "Hero", zoneId: "start", kind: "unit", player: 1, position: { x: 4, y: 8 } },
      { id: "truck", name: "Truck", zoneId: "mid", kind: "unit", player: 4, position: { x: 12, y: 8 }, speed: 1 },
    ];
    const objectives = [
      { id: "deliver", title: "Deliver", description: "Get the truck through.", type: "primary", beatId: "end", completeWhen: { type: "anchorEntersZone", anchorId: "truck", zoneId: "goal" } },
    ];
    const model = strip({}, { anchors, objectives, archetype: "escort" });
    expect(model.goals[0]!.from).toEqual({ anchorId: "truck", zoneId: "mid", point: { x: 12, y: 8 }, speed: 1 });
    // 4 cells to the goal's edge at 1 cell/s, not from the hero at a marine's pace.
    expect(check(model, "travel-times").findings).toEqual(["Truck → goal: about 4 s on the ground at its 1 cells/s (4 cells)."]);
    expect(check(model, "critical-path").findings).toContain("objective deliver (Truck in mid): mid → goal.");
    expect(check(model, "archetype-bands").findings).toEqual(["Escort: Truck's road to goal is about 4 cells; the band is 120-160."]);
  });

  it("treats a timer goal as holding the start", () => {
    const objectives = [{ id: "survive", title: "Survive", description: "Hold.", type: "primary", beatId: "end", completeWhen: { type: "timer", seconds: 600 } }];
    const model = strip({}, { objectives });
    expect(model.goals).toEqual([{ zoneId: "start", hold: true, source: "objective survive", beatIndex: 1 }]);
    expect(check(model, "critical-path").findings).toContain("objective survive: hold start until the timer runs out; nothing to route.");
    expect(check(model, "travel-times").findings).toEqual(["start: held until the timer runs out, so no travel."]);
    expect(check(model, "readable-approach").status).toBe("pass");
  });

  it("sends a resource quota to the resource fields, from the beat that shows each", () => {
    const beats = [
      { id: "start", title: "Start", summary: "Mine at home." },
      { id: "end", title: "End", summary: "Go further.", reveals: ["goal"] },
    ];
    const objectives = [{ id: "mine", title: "Mine", description: "Mine.", type: "primary", beatId: "start", completeWhen: { type: "resourceQuota", resource: "minerals", amount: 8000 } }];
    const placements = [
      { id: "home-minerals", zoneId: "mid", kind: "resource-base" },
      { id: "far-minerals", zoneId: "goal", kind: "resource-base" },
    ];
    const model = strip({}, { beats, objectives, placements });
    expect(model.goals.map(({ zoneId, beatIndex }) => [zoneId, beatIndex])).toEqual([
      ["mid", 0],
      ["goal", 1],
    ]);
  });

  it("checks each hazard's warning against the retreat to safe ground", () => {
    const hazard = (warningSeconds: number) => ({
      id: "lava",
      type: "hazard",
      params: { affectedZoneIds: ["mid", "goal"], safeZoneIds: ["start"], firstSeconds: 60, intervalSeconds: 300, deadlySeconds: 15, warningSeconds },
    });
    expect(check(strip(), "hazard-retreat").status).toBe("not-evaluated");
    // The far edge of goal is about 16 cells from start: about 5 s at marine speed.
    const ample = check(strip({}, { mechanics: [hazard(10)] }), "hazard-retreat");
    expect(ample.status).toBe("pass");
    expect(ample.findings[0]).toMatch(/^Threat lava: the worst retreat is about 5 s \(1[56] cells\) from goal, against 10 s of warning \(declared\)\.$/);
    // 4 s of warning allows 4 / 1.2 + 1 s of slack, about 4.3 s.
    const tight = check(strip({}, { mechanics: [hazard(4)] }), "hazard-retreat");
    expect(tight.status).toBe("warn");
    expect(tight.findings[0]).toMatch(/^Threat lava: against 4 s of warning \(declared\), the band is a retreat of at most 4 s; too far from safe ground: goal \(about 5 s/);
  });

  it("reads a countdown blast as a hazard whose countdown is the warning", () => {
    const blast = {
      id: "blast",
      type: "countdown",
      params: { heroAnchorId: "hero", shelterZoneIds: ["goal"], firstSeconds: 45, intervalSeconds: 40 },
    };
    const result = check(strip({}, { mechanics: [blast] }), "hazard-retreat");
    expect(result.status).toBe("pass");
    expect(result.findings[0]).toMatch(/from start, against 40 s of warning \(the countdown is always on screen\)\.$/);
  });

  it("rejects a hazard zone that is both affected and safe", () => {
    const result = MissionBlueprintSchema.safeParse({
      id: "bad",
      campaignId: "fixtures",
      title: "Bad",
      setting: "Nowhere",
      mapSize: { width: 16, height: 16 },
      raggedCliffs: 0,
      zones: [{ id: "only", name: "Only", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 16, 16) }],
      beats: [{ id: "one", title: "One", summary: "One." }],
      mechanics: [{ id: "lava", type: "hazard", params: { affectedZoneIds: ["only"], safeZoneIds: ["only"], firstSeconds: 0, deadlySeconds: 5, warningSeconds: 5 } }],
      screenplay: { title: "Bad" },
    });
    expect(result.error?.issues[0]?.message).toBe("A zone can't be both affected and safe: only");
  });

  it("skips goals on the player's own ground when judging approaches", () => {
    const model = layout([
      { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [both("start", "goal")[0]] },
      { id: "goal", role: "base", polygon: rect(8, 0, 16, 16), connections: [both("start", "goal")[1]] },
    ]);
    expect(check(model, "readable-approach").status).toBe("pass");
  });

  it("reports ambushes in refuges without warning", () => {
    const model = strip({}, { placements: [{ id: "burrowed", zoneId: "mid", kind: "encounter-group" }] });
    expect(check(model, "safe-havens").status).toBe("pass");
    const refuge = layout(
      [
        { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "ledge")[0]] },
        { id: "ledge", role: "refuge", polygon: rect(8, 0, 16, 16), connections: [both("start", "ledge")[1]] },
      ],
      { placements: [{ id: "burrowed", zoneId: "ledge", kind: "encounter-group" }] },
    );
    expect(check(refuge, "safe-havens")).toMatchObject({ status: "info", findings: [expect.stringContaining("one-shot ambush")] });
  });

  it("warns about threats at the start, and passes threats kept away from it", () => {
    const model = strip({}, { placements: [{ id: "ambush", zoneId: "start", kind: "encounter-group" }] });
    expect(check(model, "safe-havens").findings[0]).toBe("The start, start, has enemy group ambush in it.");
    const away = strip({}, { placements: [{ id: "guards", zoneId: "goal", kind: "encounter-group" }] });
    expect(check(away, "safe-havens").status).toBe("pass");
  });

  it("notes a passive group at the start instead of warning", () => {
    const parade = strip({}, { placements: [{ id: "parade", zoneId: "start", kind: "encounter-group", passiveUntilBeat: "end" }] });
    expect(check(parade, "safe-havens")).toEqual(
      expect.objectContaining({ status: "info", findings: ['The start, start, holds enemy group parade, passive until "End".'] }),
    );
  });

  it("only accepts passiveUntilBeat on encounter groups, naming a known beat", () => {
    const errors = (placement: object): string[] => {
      const parsed = MissionBlueprintSchema.safeParse({
        id: "passive",
        campaignId: "fixtures",
        title: "Passive",
        setting: "A test strip",
        mapSize: { width: 48, height: 16 },
        raggedCliffs: 0,
        zones: [{ id: "start", name: "Start", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 8, 16) }],
        anchors: [],
        beats: [{ id: "only", title: "Only", summary: "Test beat." }],
        placements: [{ id: "group", zoneId: "start", ...placement }],
        screenplay: { title: "Passive" },
      });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    expect(errors({ kind: "encounter-group", passiveUntilBeat: "only" })).toEqual([]);
    expect(errors({ kind: "encounter-group", passiveUntilBeat: "later" })).toEqual(["Unknown beat id: later"]);
    expect(errors({ kind: "dressing", passiveUntilBeat: "only" })).toEqual(["passiveUntilBeat only applies to encounter groups"]);
  });

  it("warns about unreachable zones and empty dead ends", () => {
    const model = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "nook")[0]] },
      { id: "nook", polygon: rect(8, 0, 16, 16), connections: [both("start", "nook")[1]] },
      { id: "island", polygon: rect(32, 0, 40, 16) },
    ]);
    const findings = check(model, "dead-space").findings.join("\n");
    expect(findings).toContain("nook is a dead end with nothing in it");
    expect(findings).toContain("island is never reachable from the start through declared connections and touches no other zone");

    // A built pad is dressing inside its zone, not a dead end.
    const pad = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "pad")[0]] },
      { id: "pad", surface: "built", polygon: rect(8, 0, 16, 16), connections: [both("start", "pad")[1]] },
    ] as ZoneInput[]);
    expect(check(pad, "dead-space").status).toBe("pass");
  });

  it("reports busy beats and final-beat twists for review, and warns about repeat introductions", () => {
    const beats = (start: string[], end: string[]) => ({
      beats: [
        { id: "start", title: "Start", summary: "Set out.", introduces: start },
        { id: "end", title: "End", summary: "Arrive.", introduces: end },
      ],
    });
    const busy = check(strip({}, beats(["blast", "zergling"], ["baneling"])), "teaching");
    expect(busy.status).toBe("info");
    expect(busy.findings.join("\n")).toContain('"Start" introduces 2 things (blast, zergling); check they arrive one at a time');
    expect(busy.findings.join("\n")).toContain('The final beat, "End", introduces baneling');
    const repeat = check(strip({}, beats(["zergling"], ["zergling"])), "teaching");
    expect(repeat.status).toBe("warn");
    expect(repeat.findings[0]).toBe('zergling is introduced twice ("Start" and "End").');
  });

  it("checks that vaults have one entrance and sit off the critical path", () => {
    const model = strip({}, {});
    expect(check(model, "vaults").status).toBe("not-evaluated");
    const onPath = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [both("start", "mid")[0]] },
      { id: "mid", role: "vault", polygon: rect(8, 0, 16, 16), connections: [both("start", "mid")[1], both("mid", "goal")[0]] },
      { id: "goal", polygon: rect(16, 0, 24, 16), connections: [both("mid", "goal")[1]] },
    ]);
    const findings = check(onPath, "vaults").findings.join("\n");
    expect(findings).toContain("Vault mid has 2 entrances");
    expect(findings).toContain("Vault mid is on the route to a goal");
    // A pocket reached only by air still has one way in.
    const island = layout([
      { id: "start", polygon: rect(0, 0, 8, 16), connections: [{ toZoneId: "isle", type: "air-only" }] },
      { id: "isle", role: "vault", polygon: rect(24, 0, 32, 16), connections: [{ toZoneId: "start", type: "air-only" }] },
    ]);
    expect(check(island, "vaults").status).toBe("pass");
  });

  describe("air-bypass", () => {
    // A U: the start and the goal stand apart on the low ground, joined only round the top; an
    // air-only isle beside the goal, and the way into the goal a collapsible pass.
    function u(tech: unknown) {
      return layout(
        [
          { id: "start", role: "base", polygon: rect(0, 0, 8, 14), connections: [both("start", "top")[0]] },
          { id: "top", polygon: rect(0, 14, 48, 16), connections: [both("start", "top")[1], both("top", "goal", "collapsible", { width: 4 })[0]] },
          { id: "goal", role: "objective", polygon: rect(16, 0, 24, 14), connections: [both("top", "goal", "collapsible", { width: 4 })[1], { toZoneId: "isle", type: "air-only" }] },
          { id: "isle", polygon: rect(32, 0, 40, 14), connections: [{ toZoneId: "goal", type: "air-only" }] },
        ],
        tech === undefined ? {} : { tech },
      );
    }

    it("isn't evaluated when the blueprint says nothing of the player's tech", () => {
      expect(check(u(undefined), "air-bypass").status).toBe("not-evaluated");
    });

    it("passes when the player's allow list has no flyer: cliffs, chasms and collapses hold", () => {
      const ground = check(u([{ player: 1, allow: { buildings: ["Nexus", "Gateway"], units: ["Probe", "Zealot"] } }]), "air-bypass");
      expect(ground).toEqual(expect.objectContaining({ status: "pass", findings: [] }));
    });

    it("lists what an allowed flyer bypasses: air-only links, closable connections and the long ground ways to goals", () => {
      const air = check(u([{ player: 1, allow: { buildings: ["Nexus", "Stargate"], units: ["Probe", "Phoenix"] } }]), "air-bypass");
      expect(air.status).toBe("info");
      expect(air.findings[0]).toBe("Player 1's tech allows flyers (Phoenix); terrain doesn't stop them:");
      expect(air.findings).toContain("  air-only goal ↔ isle opens to them");
      expect(air.findings).toContain("  top ↔ goal (collapsible) doesn't hold them once it closes");
      expect(air.findings.find((finding) => finding.startsWith("  objective arrive"))).toMatch(/^ {2}objective arrive \(goal\): \d+ cells by ground, \d+ by air \(1\.\d×\)$/);
    });

    it("lists a connection that closes at a beat", () => {
      const [toMid, fromMid] = both("start", "mid", "open", { closesAtBeat: "end" });
      const [toGoal, fromGoal] = both("mid", "goal");
      const model = layout(
        [
          { id: "start", role: "base", polygon: rect(0, 0, 8, 16), connections: [toMid] },
          { id: "mid", polygon: rect(8, 0, 16, 16), connections: [fromMid, toGoal] },
          { id: "goal", role: "objective", polygon: rect(16, 0, 24, 16), connections: [fromGoal] },
        ],
        { tech: [{ player: 1, allow: { units: ["VoidRay"] } }] },
      );
      expect(check(model, "air-bypass").findings).toContainEqual(expect.stringMatching(/^ {2}the Blueprint closes start ↔ mid .*"End".*, which doesn't hold them$/));
    });

    it("warns that disallowing alone leaves air open: restrictions stay off without an allow list", () => {
      const open = check(u([{ player: 1, disallow: { buildings: ["Stargate"] } }]), "air-bypass");
      expect(open.status).toBe("info");
      expect(open.findings[0]).toBe("Player 1's tech has no allow list, so any flyer it doesn't disallow may be buildable; terrain doesn't stop them:");
      expect(open.findings).toContain("  air-only goal ↔ isle opens to them");
    });
  });

  it("leaves route checks unevaluated without goals", () => {
    const model = layout([{ id: "start", polygon: rect(0, 0, 8, 16) }]);
    expect(check(model, "critical-path").status).toBe("not-evaluated");
    expect(check(model, "travel-times").status).toBe("not-evaluated");
  });
});
