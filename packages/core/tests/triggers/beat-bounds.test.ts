// A Beat's camera bounds and playable area (ADR-0015, #529): compiled to Set Playable Map Area and
// Set Camera Bounds as the Beat starts, with bounds regions for areas given by Zones or rectangles.
// Ashen Crossing (the `crossing` fixture): Landfall starts with the mission, which plays scene 1 as
// Transmissions; The Run and Temple Threshold start when their tests give them a startsWhen.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readRegionsXml } from "../../src/map/read-regions-xml.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { missionRegions } from "../../src/map/write-regions-xml.js";
import { beatBounds, boundsPlan, boundsRegions, boundsWarnings } from "../../src/triggers/beat-bounds.js";
import { renumberRegions } from "../../src/triggers/renumber-regions.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";
import { waveWarnings } from "../../src/triggers/wave-triggers.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript } from "../support/workspaces.js";

type RawBeat = Record<string, unknown> & { id: string };

const ENTERS_ARCH = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" }];
const ENTERS_GATE = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "temple_gate" }];

/** Ashen Crossing with its Beats edited, compiled to triggers and Galaxy. */
function crossing(editBeats: (beats: RawBeat[]) => void, edit: (raw: any) => void = () => {}) {
  const raw = structuredClone(crossingRaw) as any;
  editBeats(raw.beats);
  edit(raw);
  const blueprint = CrossingBlueprintSchema.parse(raw);
  const doc = buildMissionTriggers(blueprint, { script: crossingScript });
  const script = writeMapScript({ mapName: blueprint.title, triggers: doc });
  const section = (name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
  return { blueprint, doc, script, section };
}

/** The region id of the `index`th bounds region: after the six Zones' regions (the fixture has no Wave warnings). */
const boundsRegion = (index: number): number => 6 + index + 1;

describe("a Beat's bounds", () => {
  it("compiles nothing when no Beat sets any", () => {
    const { script, blueprint } = crossing(() => {});
    expect(script).not.toMatch(/CameraSetBounds|RegionPlayableMapSet/);
    expect(boundsRegions(blueprint)).toEqual([]);
  });

  it("sets the first Beat's camera bounds at the top of Mission Start, as a bounds region round its Zones, minimap on", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone", "overhang"] };
    });
    const start = section("MissionStart");
    expect(start).toContain(`CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(0)}), true);`);
    // Before the objectives and the opening Transmissions.
    expect(start.indexOf("CameraSetBounds(")).toBeLessThan(start.indexOf("TransmissionSendForPlayerSelect("));
    // Camera bounds only: the playable area stands as MapInfo has it.
    expect(start).not.toContain("RegionPlayableMapSet(");
    expect(boundsRegions(blueprint)).toEqual([
      { name: "Bounds Landfall Camera", shapes: [{ type: "rect", quad: [10, 10, 52, 30] }], source: { kind: "bounds", beatId: "landfall", role: "camera" } },
    ]);
  });

  it("writes bounds regions after every other region, so adding one renumbers nothing", () => {
    const { blueprint } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone"] };
    });
    const names = missionRegions(blueprint, [{ id: "piece", x: 5, y: 5, radius: 2 } as never], [], boundsRegions(blueprint)).map((region) => region.name);
    expect(names.slice(5)).toEqual(["Temple Gate", "piece", "Bounds Landfall Camera"]);
  });

  it("sets a later Beat's playable area, rounded to even cells, then its camera bounds, in its own trigger", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.playable = ["overhang_crag", "rock_arch"];
      beats[1]!.camera = { bounds: "rock_arch", minimap: false };
    });
    const beat = section("BeatTheRun");
    const playable = beat.indexOf(`RegionPlayableMapSet(RegionFromId(${boundsRegion(0)}));`);
    const camera = beat.indexOf("CameraSetBounds(PlayerGroupAll(), RegionFromId(5), false);");
    expect(playable).toBeGreaterThan(beat.indexOf("TriggerEnable(gt_BeatTheRun, false);"));
    expect(camera).toBeGreaterThan(playable);
    // (38, 28)-(90, 54) rounded out to even cells is the same.
    expect(boundsPlan(blueprint).regions[0]!.rect).toEqual([38, 28, 90, 54]);
    expect(section("MissionStart")).not.toMatch(/CameraSetBounds|RegionPlayableMapSet/);
  });

  it("rounds a playable area round odd-edged Zones out to even cells", () => {
    const { blueprint } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.playable = ["overhang"];
    }, (raw) => (raw.zones[3].polygon = [{ x: 41, y: 13 }, { x: 51, y: 13 }, { x: 51, y: 25 }, { x: 41, y: 25 }]));
    expect(boundsPlan(blueprint).regions[0]!.rect).toEqual([40, 12, 52, 26]);
  });

  it("ends earlier camera bounds at a Beat that sets a playable area alone: the camera follows it, minimap back on", () => {
    const { section } = crossing((beats) => {
      beats[0]!.camera = { bounds: "landing_zone", minimap: false };
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.playable = ["overhang_crag", "rock_arch"];
    });
    const beat = section("BeatTheRun");
    expect(beat).toContain("CameraSetBounds(PlayerGroupAll(), RegionPlayableMap(), true);");
    expect(beat).not.toContain("RegionFromId(2), false");
  });

  it("reads a playable Zone region off the even cells as the game rounds it, and warns", () => {
    const { blueprint } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.playable = "overhang";
    }, (raw) => (raw.zones[3].polygon = [{ x: 41, y: 13 }, { x: 51, y: 13 }, { x: 51, y: 25 }, { x: 41, y: 25 }]));
    // Read as all the game is sure to keep, whichever way it rounds each odd edge.
    expect(boundsPlan(blueprint).beats[1]!.playable.rect).toEqual([42, 14, 50, 24]);
    expect(boundsWarnings(blueprint)).toContainEqual(expect.stringContaining("Beat the_run's playable area is Overhang's trigger region [41, 13, 51, 25], whose edges are off the even cells"));
  });

  it("reads a playable rectangle off the even cells drawn in to them", () => {
    const { blueprint } = crossing((beats) => {
      beats[0]!.playable = [11, 8, 118, 101];
    });
    expect(boundsPlan(blueprint).beats[0]!.playable.rect).toEqual([12, 8, 118, 100]);
  });

  it("names each bounds region by its place among them when the compile renumbers, whatever place the triggers guessed", () => {
    const { doc } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone"] };
    });
    // The bounds region was written at id 42, the zones as they are.
    const renumbered = renumberRegions(doc, [1, 2, 3, 4, 5, 6, 99], [42]);
    const script = writeMapScript({ mapName: "x", triggers: renumbered });
    expect(script).toContain("CameraSetBounds(PlayerGroupAll(), RegionFromId(42), true);");
    expect(script).not.toContain("RegionFromId(99)");
  });

  it("forms a Wave spawned in a Zone inside every playable area its stream sends into", () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const blueprint = MissionBlueprintSchema.parse({
      id: "fields",
      campaignId: "test",
      title: "Fields",
      setting: "test",
      mapSize: { width: 128, height: 128 },
      zones: [
        { id: "field", name: "Field", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 128, 64), connections: [{ toZoneId: "yard", type: "open" }] },
        { id: "yard", name: "Yard", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 64, 128, 128), connections: [{ toZoneId: "field", type: "open" }] },
      ],
      anchors: [
        { id: "hero", name: "Hero", zoneId: "yard", kind: "unit", unitType: "Marine", player: 1, position: { x: 64, y: 100 } },
        { id: "foe", name: "Foe", zoneId: "field", kind: "unit", unitType: "Zergling", player: 2, position: { x: 100, y: 30 } },
      ],
      beats: [
        { id: "one", title: "One", summary: "First." },
        { id: "two", title: "Two", summary: "Second.", startsWhen: [{ type: "anchorDies", anchorId: "foe" }], playable: [70, 8, 118, 108] },
      ],
      waves: [{ id: "raid", spawnZoneId: "field", targetZoneIds: ["yard"], arrival: "ground", startsAtBeat: "one", firstSeconds: 30, intervalSeconds: 60, units: [{ type: "Zergling", count: 4 }] }],
      screenplay: { title: "Fields" },
    });
    const script = writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint) });
    const xs = [...script.matchAll(/Point\(([\d.]+), ([\d.]+)\)/g)].map((match) => [Number(match[1]), Number(match[2])] as const).filter(([, y]) => y < 64);
    // The spawn, in the Field, inside Two's playable area as well as One's.
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every(([x]) => x >= 70)).toBe(true);
  });

  it("holds a Beat's bounds on later Beats, setting them again as each starts", () => {
    const { section } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.camera = { bounds: [30, 20, 100, 60] };
      beats[2]!.startsWhen = ENTERS_GATE;
    });
    const set = `CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(0)}), true);`;
    expect(section("BeatTheRun")).toContain(set);
    expect(section("BeatTempleThreshold")).toContain(set);
  });

  it("opens the whole map or bounds the camera to the playable area as it stands, by name", () => {
    const { section } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.playable = "entire";
      beats[1]!.camera = { bounds: "playable" };
    });
    const beat = section("BeatTheRun");
    expect(beat).toContain("RegionPlayableMapSet(RegionEntireMap());");
    expect(beat).toContain("CameraSetBounds(PlayerGroupAll(), RegionPlayableMap(), true);");
  });

  it("holds a transition's wider rectangle, minimap left as it is, until the Beat's start scenes hand back", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone"] };
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.camera = { bounds: ["rock_arch"], transition: true };
    });
    const [, own, transition] = boundsPlan(blueprint).regions;
    expect(transition).toMatchObject({ name: "Bounds The Run Transition", rect: [10, 10, 90, 54] });
    expect(own).toMatchObject({ name: "Bounds The Run Camera", rect: [78, 40, 90, 54] });
    const { start, settled } = beatBounds(blueprint, "the_run");
    expect(start).toHaveLength(1);
    expect(settled).toHaveLength(1);
    const beat = section("BeatTheRun");
    const wide = beat.indexOf(`CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(2)}), false);`);
    const tight = beat.indexOf(`CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(1)}), true);`);
    expect(wide).toBeGreaterThan(-1);
    expect(tight).toBeGreaterThan(wide);
  });

  it("pans from the playable area itself when no Beat bounded the camera before", () => {
    const { section, blueprint } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.camera = { bounds: ["rock_arch"], transition: true };
    });
    expect(boundsPlan(blueprint).regions.map((region) => region.name)).toEqual(["Bounds The Run Camera"]);
    const beat = section("BeatTheRun");
    expect(beat.indexOf("CameraSetBounds(PlayerGroupAll(), RegionPlayableMap(), false);")).toBeGreaterThan(-1);
    expect(beat.indexOf(`CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(0)}), true);`)).toBeGreaterThan(beat.indexOf("RegionPlayableMap(), false"));
  });

  it("names the regions the package writes, past the set pieces and the author's own: each Set Camera Bounds points at its own bounds region", async () => {
    const { blueprint, doc } = crossing(
      (beats) => {
        beats[0]!.playable = ["landing_zone", "overhang"];
        beats[0]!.camera = { bounds: ["landing_zone"] };
      },
      (raw) => {
        raw.placements.push({ id: "wreck", zoneId: "surface", kind: "set-piece", params: { story: "a wreck", at: { x: 64, y: 64 }, radius: 4, anchor: ["BunkerWrecked"] } });
        raw.regions = [{ id: "ambush", name: "Ambush", shapes: [{ type: "rect", quad: [1, 1, 5, 5] }] }];
      },
    );
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-beat-bounds-"));
    try {
      await writeMapPackage({ blueprint, outputDir, includeRegions: true, includeObjects: true, triggers: doc });
      const regions = readRegionsXml(await readFile(path.join(outputDir, "Regions"), "utf8"));
      const script = await readFile(path.join(outputDir, "MapScript.galaxy"), "utf8");
      const named = (pattern: RegExp): string | undefined => regions.find((region) => region.id === Number(pattern.exec(script)?.[1]))?.name;
      expect(named(/RegionPlayableMapSet\(RegionFromId\((\d+)\)\)/)).toBe("Bounds Landfall Playable");
      expect(named(/CameraSetBounds\(PlayerGroupAll\(\), RegionFromId\((\d+)\)/)).toBe("Bounds Landfall Camera");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("guards the first Beat's settled bounds on the next Beat, after the opening scenes", () => {
    const { section } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone"], transition: true };
      beats[1]!.startsWhen = ENTERS_ARCH;
    });
    const start = section("MissionStart");
    expect(start.indexOf("CameraSetBounds(PlayerGroupAll(), RegionPlayableMap(), false);")).toBeLessThan(start.indexOf("TransmissionSendForPlayerSelect("));
    const guard = start.indexOf("TriggerIsEnabled(gt_BeatTheRun)");
    expect(guard).toBeGreaterThan(start.lastIndexOf("TransmissionSendForPlayerSelect("));
    expect(start.indexOf(`CameraSetBounds(PlayerGroupAll(), RegionFromId(${boundsRegion(0)}), true);`)).toBeGreaterThan(guard);
  });

  it("pans to the playable area as it stands, not a guessed rectangle, when the new bounds are the playable area", () => {
    const { blueprint, section } = crossing((beats) => {
      beats[0]!.camera = { bounds: ["landing_zone"] };
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.camera = { bounds: "playable", transition: true };
    });
    expect(boundsPlan(blueprint).regions.map((region) => region.name)).toEqual(["Bounds Landfall Camera"]);
    expect(section("BeatTheRun")).toContain("CameraSetBounds(PlayerGroupAll(), RegionPlayableMap(), false);");
  });

  it("warns of a Zone-spawned Wave sending while a Kept region it can't see bounds the playable area", () => {
    const { blueprint } = crossing(
      (beats) => {
        beats[0]!.playable = "arena";
      },
      (raw) => {
        (raw.kept ??= []).push({ id: "arena", kind: "region", editorId: 900, name: "Arena" });
        raw.anchors.push({ id: "foe", name: "Foe", zoneId: "surface", kind: "unit", unitType: "Zergling", player: 2, position: { x: 100, y: 100 } });
        raw.waves = [{ id: "raid", spawnZoneId: "surface", targetZoneIds: ["surface"], arrival: "ground", startsAtBeat: "landfall", firstSeconds: 30, intervalSeconds: 60, units: [{ type: "Zergling", count: 4 }] }];
      },
    );
    expect(waveWarnings(blueprint)).toContainEqual(expect.stringContaining("Wave raid sends while Beat landfall's playable area is a Kept region whose rectangle the Blueprint doesn't know"));
  });

  it("takes a transition given as a rectangle as it is", () => {
    const { blueprint } = crossing((beats) => {
      beats[1]!.startsWhen = ENTERS_ARCH;
      beats[1]!.camera = { bounds: ["rock_arch"], transition: [0, 0, 100, 100] };
    });
    expect(boundsPlan(blueprint).regions.map((region) => region.rect)).toEqual([[78, 40, 90, 54], [0, 0, 100, 100]]);
  });

  it("writes Set Camera Bounds and Set Playable Map Area in the Triggers XML by NativeLib's ids", () => {
    const { doc } = crossing((beats) => {
      beats[0]!.playable = [10, 8, 118, 100];
      beats[0]!.camera = { bounds: ["landing_zone"] };
    });
    const xml = writeTriggersXml(doc);
    const after = (id: string): string => xml.slice(xml.indexOf(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`));
    const params = (text: string, count: number) => [...text.matchAll(/<ParameterDef Type="ParamDef" Library="Ntve" Id="([0-9A-F]{8})"\/>/g)].slice(0, count).map((match) => match[1]);
    expect(params(after("9AD8B4CA"), 1)).toEqual(["31FFB516"]);
    expect(params(after("F470860B"), 3)).toEqual(["3FA8845D", "A8B2F758", "B29D7650"]);
    // Minimap: Do, the Do/Do Not Option's other value.
    expect(after("F470860B").slice(0, 2000)).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000071"/>');
  });

  it("warns of bounds on a Beat nothing starts, a playable rectangle off the even cells, and a transition it can't draw", () => {
    const { blueprint } = crossing(
      (beats) => {
        beats[0]!.playable = [11, 8, 118, 100];
        beats[0]!.camera = { bounds: [0, 0, 60, 60] };
        beats[1]!.camera = { bounds: ["rock_arch"] };
        beats[2]!.startsWhen = ENTERS_GATE;
        beats[2]!.camera = { bounds: "author-region", transition: true };
      },
      (raw) => (raw.kept ??= []).push({ id: "author-region", kind: "region", editorId: 900, name: "Author's Region" }),
    );
    const warnings = boundsWarnings(blueprint);
    expect(warnings).toContainEqual(expect.stringContaining("Beat the_run sets camera bounds, but it has no startsWhen"));
    expect(warnings).toContainEqual(expect.stringContaining("Beat landfall's playable area [11, 8, 118, 100] has edges off the even cells"));
        expect(warnings).toContainEqual(expect.stringContaining("Beat threshold's camera transition is the box round the last camera bounds and its own, but Author's Region is a Kept region"));
  });

  it("names a Kept region by its own id", () => {
    const { section } = crossing(
      (beats) => {
        beats[0]!.camera = { bounds: "author-region" };
      },
      (raw) => (raw.kept ??= []).push({ id: "author-region", kind: "region", editorId: 900, name: "Author's Region" }),
    );
    expect(section("MissionStart")).toContain("CameraSetBounds(PlayerGroupAll(), RegionFromId(900), true);");
  });

  it("refuses unknown Zones and regions, and a rectangle off the map", () => {
    const issues = (edit: (beats: RawBeat[]) => void): string[] => {
      const raw = structuredClone(crossingRaw) as any;
      edit(raw.beats);
      const result = CrossingBlueprintSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    };
    expect(issues((beats) => (beats[0]!.camera = { bounds: ["landing_zone", "nowhere"] }))).toEqual(["beats.0.camera.bounds.1: Unknown zone id: nowhere"]);
    expect(issues((beats) => (beats[0]!.playable = "nowhere"))).toEqual(["beats.0.playable: Unknown zone or Kept region id: nowhere"]);
    expect(issues((beats) => (beats[0]!.camera = { bounds: [0, 0, 200, 60] }))).toEqual(["beats.0.camera.bounds: [0, 0, 200, 60] runs off the 128×128 map"]);
  });

  it("refuses \"entire\" and \"playable\" where a Zone has that id, which they would hide", () => {
    const raw = structuredClone(crossingRaw) as any;
    raw.zones[1].id = "entire";
    raw.beats[0].zoneIds = ["entire"];
    raw.anchors[0].zoneId = "entire";
    raw.beats[0].playable = "entire";
    const result = CrossingBlueprintSchema.safeParse(raw);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining('"entire" here is the whole map, not the Zone or Kept region entire'));
  });
});
