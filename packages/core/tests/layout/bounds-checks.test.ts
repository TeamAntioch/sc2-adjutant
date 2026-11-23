// The map's bounds against what plays in them (ADR-0015, #529): Zones inside the playable area,
// and each Beat's Anchors, Waves and trigger scenes' cameras inside the bounds that hold then.
import { describe, expect, it } from "vitest";

import type { LoadedTriggerScene } from "../../src/cutscene/trigger-scene.js";
import { boundsFindings } from "../../src/layout/bounds-checks.js";
import { runLayoutChecks } from "../../src/layout/checks.js";
import { buildLayoutModel } from "../../src/layout/layout-model.js";
import { playableBounds } from "../../src/map/map-bounds.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";

const ENTERS_ARCH = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];

/** Ashen Crossing (128×128; its Surface reaches the map's edges, so its playable area is the inset, [10, 8, 118, 108]) with `edit` applied. */
function crossing(edit: (raw: any) => void = () => {}) {
  const raw = structuredClone(crossingRaw) as any;
  edit(raw);
  const blueprint = CrossingBlueprintSchema.parse(raw);
  return { blueprint, findings: (triggerScenes: LoadedTriggerScene[] = []) => boundsFindings(blueprint, playableBounds(blueprint)!, triggerScenes) };
}

describe("the bounds checks", () => {
  it("pass a map whose Zones reach only into the Editor's edge inset, the camera's apron", () => {
    expect(crossing().findings()).toEqual([]);
    const check = runLayoutChecks(buildLayoutModel(crossing().blueprint)).find((result) => result.id === "bounds");
    expect(check).toMatchObject({ status: "pass", source: "ADR-0015" });
  });

  it("find a Zone the playable area cuts across inside the inset", () => {
    const { findings } = crossing((raw) => (raw.bounds = { playable: [20, 8, 118, 108] }));
    expect(findings()).toEqual([
      "Surface runs 10 cells past the left edge of the playable area [20, 8, 118, 108]: units can't go there, and the edge is an invisible wall across its ground. Pull the Zone in, end it at a cliff or backdrop there, or widen bounds.playable",
      "Landing Zone runs 10 cells past the left edge of the playable area [20, 8, 118, 108]: units can't go there, and the edge is an invisible wall across its ground. Pull the Zone in, end it at a cliff or backdrop there, or widen bounds.playable",
    ]);
  });

  it("find a Beat's Zones and Anchors outside the playable area it sets, and its units too far past its camera bounds", () => {
    const { findings } = crossing((raw) => {
      raw.beats[0].playable = [30, 8, 118, 108];
      raw.beats[1].startsWhen = ENTERS_ARCH;
      raw.beats[1].playable = "entire";
      raw.beats[1].camera = { bounds: ["rock_arch"] };
    });
    expect(findings()).toEqual([
      "Beat landfall plays in Landing Zone, which runs 20 cells past the left edge of the playable area [30, 8, 118, 108] then",
      "Beat landfall uses Zeratul, 10 cells outside the playable area [30, 8, 118, 108] then: a unit there can't move, and one created there can't walk in",
      // The Run's camera is held to the Rock Arch, (78, 40)-(90, 54); Zeratul stands at (20, 20).
      expect.stringContaining("Beat the_run uses Zeratul, 61.4 cells past the camera bounds [78, 40, 90, 54] then, more than the 7.5 the camera shows past them"),
    ]);
  });

  it("find camera bounds reaching outside the playable area then, against the map's own playable area too", () => {
    const { findings } = crossing((raw) => {
      raw.beats[0].camera = { bounds: [0, 0, 60, 60] };
    });
    expect(findings()).toEqual([
      "Beat landfall's camera bounds [0, 0, 60, 60] reach 10 cells past the left edge, 8 cells past the bottom edge of the playable area [10, 8, 118, 108] then, and the game keeps the camera inside the playable area: pull them in, or widen the playable area",
    ]);
  });

  it("find a camera Anchor a Beat uses, or a trigger scene cued as it starts, aiming outside its camera bounds", () => {
    const { findings } = crossing((raw) => {
      raw.anchors.push({ id: "arch_cam", name: "Arch Cam", zoneId: "rock_arch", kind: "camera", position: { x: 84, y: 47 }, cameraTarget: { x: 84, y: 30 } });
      raw.beats[1].startsWhen = ENTERS_ARCH;
      raw.beats[1].camera = { bounds: ["rock_arch"] };
      raw.beats[1].anchorIds = ["arch_cam"];
      raw.screenplay.script.cues.push({ scene: 2, cue: { type: "beatStarts", beatId: "the_run" } });
    });
    const scene = { id: "arch", index: 0, scene: 2, file: "arch.json", triggerScene: { shots: [{ camera: "arch_cam" }] } } as unknown as LoadedTriggerScene;
    const found = findings([scene]);
    expect(found).toContainEqual(expect.stringContaining("Beat the_run's camera Arch Cam aims 10 cells outside the camera bounds [78, 40, 90, 54] then; whether the game holds a camera move to the bounds isn't yet checked in game"));
    expect(found).toContainEqual(expect.stringContaining("Trigger scene arch, cued as Beat the_run starts, aims its camera Arch Cam 10 cells outside the camera bounds [78, 40, 90, 54] then"));
  });

  it("hold a camera Anchor, and a mission-start scene's cameras, to the playable area before any Beat bounds the camera", () => {
    const { findings } = crossing((raw) => {
      raw.anchors.push({ id: "edge_cam", name: "Edge Cam", zoneId: "surface", kind: "camera", position: { x: 64, y: 64 }, cameraTarget: { x: 64, y: 120 } });
      raw.beats[0].anchorIds = ["edge_cam"];
    });
    const scene = { id: "edge", index: 0, scene: 1, file: "edge.json", triggerScene: { shots: [{ camera: "edge_cam" }] } } as unknown as LoadedTriggerScene;
    expect(findings([scene])).toEqual([
      expect.stringContaining("Beat landfall's camera Edge Cam aims 12 cells outside the camera bounds [10, 8, 118, 108] then"),
      expect.stringContaining("Trigger scene edge, cued as Beat landfall starts, aims its camera Edge Cam 12 cells outside the camera bounds [10, 8, 118, 108]"),
    ]);
  });

  it("find a placed unit no Beat lists outside the playable area the map starts with", () => {
    const { findings } = crossing((raw) => {
      raw.bounds = { playable: [20, 8, 118, 108] };
      raw.zones[0].backdrop = true;
      raw.zones[1].polygon = [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 20, y: 30 }];
      raw.anchors.push({ id: "guard", name: "Guard", zoneId: "surface", kind: "unit", unitType: "Zergling", player: 2, position: { x: 12, y: 50 } });
    });
    expect(findings()).toContainEqual(expect.stringContaining("Guard stands 8 cells outside the playable area [20, 8, 118, 108] the map starts with"));
  });

  it("find a repeating Wave's spawn outside a later Beat's playable area it still sends into", () => {
    const { findings } = crossing((raw) => {
      raw.anchors.push({ id: "raid_spawn", name: "Raid Spawn", zoneId: "surface", kind: "point", position: { x: 20, y: 60 } });
      raw.beats[1].startsWhen = ENTERS_ARCH;
      raw.beats[1].playable = [40, 8, 118, 108];
      raw.waves = [{ id: "raid", spawnZoneId: "surface", spawnAnchorId: "raid_spawn", targetZoneIds: ["landing_zone"], arrival: "ground", startsAtBeat: "landfall", firstSeconds: 30, intervalSeconds: 60, units: [{ type: "Zergling", count: 4 }] }];
    });
    expect(findings()).toContainEqual(expect.stringContaining("Wave raid forms at Raid Spawn, 20 cells outside the playable area [40, 8, 118, 108] from Beat the_run, which it still sends into"));
  });

  it("find a camera transition reaching past the playable area", () => {
    const { findings } = crossing((raw) => {
      raw.beats[1].startsWhen = ENTERS_ARCH;
      raw.beats[1].playable = [40, 8, 118, 108];
      raw.beats[1].camera = { bounds: ["rock_arch"], transition: [20, 20, 100, 60] };
    });
    expect(findings()).toContainEqual(expect.stringContaining("Beat the_run's camera transition [20, 20, 100, 60] reaches 20 cells past the left edge of the playable area [40, 8, 118, 108]"));
  });

  it("read the trigger scenes in check_layout when the caller gives them", () => {
    const { blueprint } = crossing((raw) => {
      raw.anchors.push({ id: "edge_cam", name: "Edge Cam", zoneId: "surface", kind: "camera", position: { x: 64, y: 64 }, cameraTarget: { x: 64, y: 120 } });
    });
    const scene = { id: "edge", index: 0, scene: 1, file: "edge.json", triggerScene: { shots: [{ camera: "edge_cam" }] } } as unknown as LoadedTriggerScene;
    const check = runLayoutChecks(buildLayoutModel(blueprint), { triggerScenes: [scene] }).find((result) => result.id === "bounds");
    expect(check?.findings).toEqual([expect.stringContaining("Trigger scene edge, cued as Beat landfall starts, aims its camera Edge Cam 12 cells outside")]);
  });

  it("read a transition's rectangle for the scenes a Beat's start plays", () => {
    const { findings } = crossing((raw) => {
      raw.anchors.push({ id: "arch_cam", name: "Arch Cam", zoneId: "rock_arch", kind: "camera", position: { x: 84, y: 47 }, cameraTarget: { x: 84, y: 30 } });
      raw.beats[0].camera = { bounds: ["landing_zone"] };
      raw.beats[1].startsWhen = ENTERS_ARCH;
      raw.beats[1].camera = { bounds: ["rock_arch"], transition: true };
      raw.screenplay.script.cues.push({ scene: 2, cue: { type: "beatStarts", beatId: "the_run" } });
    });
    const scene = { id: "arch", index: 0, scene: 2, file: "arch.json", triggerScene: { shots: [{ camera: "arch_cam" }] } } as unknown as LoadedTriggerScene;
    expect(findings([scene]).filter((finding) => finding.startsWith("Trigger scene"))).toEqual([]);
  });
});
