// A Beat's reveals compiled (#416): each revealed Zone explored under fog and pinged on the
// minimap as its Beat starts. Ashen Crossing (the `crossing` fixture) plays scene 1 as
// Transmissions at mission start; Radio Field (the `cinematic` fixture) plays a Cinematic there.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { regionIdForZone } from "../../src/map/write-regions-xml.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { keptMaskWarnings, revealShape, revealWarnings, widestCircleInside } from "../../src/triggers/beat-reveals.js";
import { objectIdOf } from "../../src/triggers/kept-ids.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { formatFixed, writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";
import { copyOf, tempFolder } from "../mcp/harness.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript } from "../support/workspaces.js";

type RawBeat = { id: string; reveals?: unknown[]; startsWhen?: unknown[] };

/** A point Anchor in the temple gate (100-116 by 80-96), 6 cells from its nearest edges. */
const GATE_VIEW = { id: "gate_view", name: "Gate View", zoneId: "temple_gate", kind: "point", position: { x: 106, y: 86 } };

/** Ashen Crossing with its Beats edited and a point Anchor added, compiled to triggers and Galaxy. */
function crossing(editBeats: (beats: RawBeat[]) => void, edit: (raw: any) => void = () => {}) {
  const raw = structuredClone(crossingRaw) as any;
  raw.anchors.push(GATE_VIEW);
  editBeats(raw.beats);
  edit(raw);
  const blueprint = CrossingBlueprintSchema.parse(raw);
  const doc = buildMissionTriggers(blueprint, { script: crossingScript });
  const script = writeMapScript({ mapName: blueprint.title, triggers: doc });
  const section = (name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
  const zone = (zoneId: string) => blueprint.zones.find((candidate) => candidate.id === zoneId)!;
  return { blueprint, doc, script, section, zone };
}

const PING = "5.0, Color(0.0, 100.0, 0.0));";
const explore = (point: string, radius: number): string => `VisExploreArea(1, RegionCircle(${point}, ${formatFixed(radius)}), true, false);`;
const ping = (point: string): string => `MinimapPing(PlayerGroupAll(), ${point}, ${PING}`;
/** The section explores a circle at the point and, later, pings it. */
function expectRevealed(section: string, point: string, radius: number): void {
  expect(section).toContain(explore(point, radius));
  expect(section.indexOf(ping(point))).toBeGreaterThan(section.indexOf(explore(point, radius)));
}
const point = ({ x, y }: { x: number; y: number }): string => `Point(${formatFixed(x)}, ${formatFixed(y)})`;

describe("the widest circle inside a Zone", () => {
  it("sits in the middle of a square, as wide as the square", () => {
    expect(widestCircleInside([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toEqual({ center: { x: 5, y: 5 }, radius: 5 });
  });

  it("stays inside an L, in its wider arm", () => {
    const l = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    const { center, radius } = widestCircleInside(l)!;
    expect(radius).toBeGreaterThanOrEqual(5);
    expect(radius).toBeLessThan(10);
    expect(center.x + radius <= 30 && center.y + radius <= 40 && center.x - radius >= 0 && center.y - radius >= 0).toBe(true);
  });

  it("keeps clear of a Zone drawn over it, which owns that ground", () => {
    const square = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
    const fortress = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
    const { center, radius } = widestCircleInside(square, [fortress])!;
    // Not reaching into the fortress: the nearest point of it is at least the radius away.
    const nearest = { x: Math.min(30, Math.max(10, center.x)), y: Math.min(30, Math.max(10, center.y)) };
    expect(Math.hypot(center.x - nearest.x, center.y - nearest.y)).toBeGreaterThanOrEqual(radius);
    // In a corner, between the fortress's corner and the square's sides.
    expect(radius).toBeGreaterThan(5);
    expect(radius).toBeLessThan(6);
  });

  it("finds none in a sliver no half-cell point lies in", () => {
    expect(widestCircleInside([{ x: 0, y: 0.1 }, { x: 20, y: 20.1 }, { x: 20, y: 20.4 }, { x: 0, y: 0.4 }])).toBeUndefined();
  });

  it("gives a reveal by bare id the Zone's own ground, and a sliver its whole region", () => {
    const zones = [
      { id: "outskirts", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }] },
      { id: "fortress", polygon: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }] },
      { id: "sliver", polygon: [{ x: 50, y: 0.1 }, { x: 70, y: 20.1 }, { x: 70, y: 20.4 }, { x: 50, y: 0.4 }] },
    ];
    const blueprint = { zones, anchors: [], beats: [], kept: undefined } as any;
    const outskirts = revealShape(blueprint, "outskirts");
    expect(outskirts).toMatchObject({ kind: "circle", radius: widestCircleInside(zones[0]!.polygon, [zones[1]!.polygon])!.radius });
    expect(revealShape(blueprint, "sliver")).toEqual({ kind: "region", zoneId: "sliver", thin: true });
  });
});

describe("a Beat's reveals", () => {
  it("explores a circle at a point Anchor chosen in advance and pings that point, in Mission Start after the scenes cued at mission start", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view", radius: 9 }];
    });
    const start = section("MissionStart");
    expectRevealed(start, `PointFromId(${objectIdOf(blueprint, "gate_view")})`, 9);
    // Explored at map start, so the ground shows in a scene played on the map; scene 1's
    // Transmissions wait, so the ping comes at their handback.
    expect(start.indexOf("VisExploreArea(")).toBeLessThan(start.indexOf("TransmissionSendForPlayerSelect("));
    expect(start.lastIndexOf("TransmissionSendForPlayerSelect(")).toBeLessThan(start.indexOf("MinimapPing("));
  });

  it("explores as far as the Zone's edge when the point Anchor's reveal gives no radius", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
    });
    expectRevealed(section("MissionStart"), `PointFromId(${objectIdOf(blueprint, "gate_view")})`, 6);
  });

  it("explores the widest circle inside the Zone for a bare Zone id, and warns that no point was chosen", () => {
    const { section, zone, blueprint } = crossing((beats) => {
      beats[0]!.reveals = ["overhang", "temple_gate"];
    });
    const overhang = widestCircleInside(zone("overhang").polygon)!;
    const gate = widestCircleInside(zone("temple_gate").polygon)!;
    expect(gate).toEqual({ center: { x: 108, y: 88 }, radius: 8 });
    const start = section("MissionStart");
    expect(start).toContain([explore(point(overhang.center), overhang.radius), explore(point(gate.center), gate.radius)].join("\r\n    "));
    expectRevealed(start, point(overhang.center), overhang.radius);
    expectRevealed(start, point(gate.center), gate.radius);
    expect(revealWarnings(blueprint)).toEqual([
      expect.stringMatching(/^Beat landfall reveals .+ with no point chosen, so it explores the widest circle inside the Zone/),
      expect.stringContaining("at (108, 88) with radius 8"),
    ]);
  });

  it("explores the Zone's whole region when asked, and pings its centre", () => {
    const { section, zone, blueprint } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "overhang", region: true }];
    });
    const region = regionIdForZone(blueprint.zones, zone("overhang").id);
    const start = section("MissionStart");
    expect(start).toContain(`VisExploreArea(1, RegionFromId(${region}), true, false);`);
    expect(start.indexOf(`MinimapPing(PlayerGroupAll(), RegionGetCenter(RegionFromId(${region})), ${PING}`)).toBeGreaterThan(start.indexOf("VisExploreArea("));
    expect(revealWarnings(blueprint)).toEqual([]);
  });

  it("explores them at map start when nothing is cued at mission start", () => {
    const { doc, section } = crossing(
      (beats) => {
        beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
      },
      (raw) => {
        raw.screenplay.script.cues = raw.screenplay.script.cues.filter((entry: { cue: { type: string } }) => entry.cue.type !== "missionStart");
      },
    );
    expect(doc.triggers.find((trigger) => trigger.name === "Mission Start")?.events.length).toBe(1);
    expect(section("MissionStart")).not.toContain("TransmissionSendForPlayerSelect(");
    expect(section("MissionStart")).toContain("VisExploreArea(1, RegionCircle(PointFromId(");
  });

  it("explores a later Beat's Zones in its own trigger, after it turns the earlier Beats off", () => {
    const { section } = crossing((beats) => {
      beats[1]!.startsWhen = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];
      beats[1]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
    });
    const beat = section("BeatTheRun");
    expect(beat).toContain("VisExploreArea(1, RegionCircle(PointFromId(");
    expect(beat.indexOf("TriggerEnable(gt_BeatTheRun, false);")).toBeLessThan(beat.indexOf("VisExploreArea("));
    expect(section("MissionStart")).not.toContain("VisExploreArea(");
  });

  it("writes nothing for a Beat that reveals nothing", () => {
    expect(crossing(() => {}).script).not.toMatch(/VisExploreArea|MinimapPing/);
  });

  it("writes the explore in the Triggers XML as Blizzard's maps save it: player, Explored, Do Not check cliff level, a circle at the point", () => {
    const { doc, blueprint } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
    });
    const xml = writeTriggersXml(doc);
    const explore = xml.slice(xml.indexOf('<FunctionDef Type="FunctionDef" Library="Ntve" Id="D463A836"/>'));
    const params = [...explore.matchAll(/<ParameterDef Type="ParamDef" Library="Ntve" Id="([0-9A-F]{8})"\/>/g)].slice(0, 4).map((match) => match[1]);
    expect(params).toEqual(["43734BD9", "CC757781", "85DE9A69", "ACB6148E"]);
    expect(explore).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000104"/>');
    expect(explore).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000072"/>');
    // Convert Circle To Region, at the point Anchor's Editor point.
    expect(explore).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="00000030"/>');
    expect(explore).toMatch(new RegExp(`<ValueType Type="point"/>\\s*<ValueId Id="${objectIdOf(blueprint, "gate_view")}"/>`));
  });

  it("runs the first Beat's reveals after the opening scenes only while no later Beat has started", () => {
    const { section } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
      beats[1]!.startsWhen = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];
    });
    const start = section("MissionStart");
    const guard = start.indexOf("TriggerIsEnabled(gt_BeatTheRun)");
    expect(guard).toBeGreaterThan(start.lastIndexOf("TransmissionSendForPlayerSelect("));
    expect(guard).toBeLessThan(start.indexOf("MinimapPing("));
    // The explore isn't guarded: the ground stays shown either way.
    expect(start.indexOf("VisExploreArea(")).toBeLessThan(guard);
  });

  it("runs them unguarded at map start, with no scenes to wait for", () => {
    const { section } = crossing(
      (beats) => {
        beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }];
        beats[1]!.startsWhen = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];
      },
      (raw) => {
        raw.screenplay.script.cues = raw.screenplay.script.cues.filter((entry: { cue: { type: string } }) => entry.cue.type !== "missionStart");
      },
    );
    expect(section("MissionStart")).toContain("VisExploreArea(");
    expect(section("MissionStart")).not.toContain("TriggerIsEnabled(");
  });

  it("gives a Zone revealed twice element ids no other Zone's reveal can have", () => {
    const { doc } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }, "temple_gate"];
    });
    const ids = [...writeTriggersXml(doc).matchAll(/<Element Type="\w+" Id="([0-9A-F]{8})">/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reveals an entry listed twice once, and two circles in one Zone both", () => {
    const twice = crossing((beats) => {
      beats[0]!.reveals = ["overhang", "overhang"];
    });
    expect(twice.script.split("VisExploreArea(").length - 1).toBe(1);
    const two = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "temple_gate", at: "gate_view" }, "temple_gate"];
    });
    expect(two.script.split("VisExploreArea(").length - 1).toBe(2);
  });

  it("refuses a reveal at an Anchor that isn't a point or isn't in the Zone, and a whole-region reveal with a point", () => {
    const parse = (reveal: unknown) => {
      const raw = structuredClone(crossingRaw) as any;
      raw.anchors.push(GATE_VIEW);
      raw.beats[0].reveals = [reveal];
      return CrossingBlueprintSchema.safeParse(raw);
    };
    expect(parse({ zoneId: "temple_gate", at: "hero_zeratul" }).error?.issues[0]?.message).toBe("Unknown point anchor id: hero_zeratul");
    expect(parse({ zoneId: "temple_gate", at: "gate_view", region: true }).error?.issues[0]?.message).toBe("A reveal of the Zone's whole region takes no at or radius");
    expect(parse({ zoneId: "overhang", at: "gate_view" }).error?.issues[0]?.message).toBe("gate_view is in Zone temple_gate: a reveal's point sits in the Zone it reveals (overhang)");
    expect(parse({ zoneId: "temple_gate", at: "gate_view" }).success).toBe(true);
  });

  it("warns that a later Beat with no startsWhen has its reveals compiled nowhere, unless a Beat that starts reveals them already", () => {
    const { blueprint } = crossing((beats) => {
      beats[0]!.reveals = [{ zoneId: "overhang", region: true }];
      beats[1]!.startsWhen = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];
      beats[1]!.reveals = [{ zoneId: "rock_arch", region: true }];
      beats[2]!.reveals = ["overhang", "rock_arch", "temple_gate"];
    });
    const warnings = revealWarnings(blueprint);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Beat threshold reveals [^,]+, but it has no startsWhen/);
    expect(warnings[0]).toContain(blueprint.zones.find((zone) => zone.id === "temple_gate")!.name);
  });

  it("warns of a later Beat's circle no earlier reveal covers, even in a Zone an earlier Beat reveals", () => {
    const warn = (reveal: unknown) =>
      revealWarnings(
        crossing((beats) => {
          beats[0]!.reveals = ["temple_gate"];
          beats[2]!.reveals = [reveal];
        }).blueprint,
      ).filter((warning) => warning.includes("no startsWhen"));
    // The widest circle is at (108, 88), radius 8; the gate view at (106, 86).
    expect(warn({ zoneId: "temple_gate", at: "gate_view", radius: 9 })).toHaveLength(1);
    expect(warn({ zoneId: "temple_gate", at: "gate_view", radius: 2 })).toEqual([]);
  });

  it("warns that a Kept package's Grey Mask leaves its reveals only a ping, and not under either Black Mask", () => {
    const { blueprint } = crossing((beats) => {
      beats[0]!.reveals = ["overhang"];
    });
    expect(keptMaskWarnings(blueprint, "Dark")).toEqual([expect.stringContaining("Unexplored Areas at Grey Mask")]);
    expect(keptMaskWarnings(blueprint, "Black")).toEqual([]);
    expect(keptMaskWarnings(blueprint, "BlackNoUnhide")).toEqual([]);
    expect(keptMaskWarnings(crossing(() => {}).blueprint, "Dark")).toEqual([]);
    // From the package's fog, not the Blueprint's: an imported Grey Mask package still warns.
    expect(keptMaskWarnings({ ...blueprint, unexploredAreas: "grey" }, "Dark")).toEqual([expect.stringContaining("Unexplored Areas at Grey Mask")]);
    // Without the reveals compiled (no triggers), only a mismatch warns.
    expect(keptMaskWarnings(blueprint, "Dark", { reveals: false })).toEqual([]);
  });

  it("warns when the Blueprint asks for a mask the Kept package doesn't have, naming how to match", () => {
    const { blueprint } = crossing(() => {});
    expect(keptMaskWarnings({ ...blueprint, unexploredAreas: "black-reduced-radius" }, "BlackNoUnhide")).toEqual([]);
    expect(keptMaskWarnings({ ...blueprint, unexploredAreas: "black-reduced-radius" }, "Black")).toEqual([
      `The Blueprint asks for Unexplored Areas Black Mask (Reduced Radius), but beside Kept terrain the package keeps its own, Black Mask: set Black Mask (Reduced Radius) in the Editor (Map > Map Options), or set unexploredAreas to "black" to match the package`,
    ]);
    expect(keptMaskWarnings({ ...blueprint, unexploredAreas: "grey" }, "Murky")).toEqual([expect.stringMatching(/its own, "Murky": .*or remove unexploredAreas to match the package$/)]);
    // A Blueprint that leaves the field out takes the package's, whatever it is.
    expect(keptMaskWarnings(blueprint, "BlackNoUnhide")).toEqual([]);
  });
});

describe("a Beat's reveals after a mission-start Cinematic", () => {
  it("run after the Cinematic's cleanup has handed back", async () => {
    const root = await copyOf("cinematic");
    const blueprintPath = path.join(root, "missions/radio-field/blueprint.json");
    const raw = JSON.parse(await readFile(blueprintPath, "utf8"));
    raw.beats[0].reveals = [{ zoneId: raw.zones[0].id, region: true }];
    await writeFile(blueprintPath, JSON.stringify(raw));
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const script = await readFile(path.join(map, "MapScript.galaxy"), "utf8");
    const start = script.slice(script.indexOf("bool gt_MissionStart_Func"), script.indexOf("void gt_MissionStart_Init"));
    expect(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);")).toBeGreaterThan(-1);
    expect(start.indexOf("VisExploreArea(1, RegionFromId(1), true, false);")).toBeLessThan(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    expect(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);")).toBeLessThan(start.indexOf("MinimapPing("));
  });
});
