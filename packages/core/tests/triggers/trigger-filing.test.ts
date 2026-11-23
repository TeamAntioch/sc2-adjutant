// The filing rules (#818): each generated trigger and variable goes in the Trigger Folder its
// Blueprint source gives it, by #816's table, on synthetic Missions.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema, missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { type TriggerDocument, type TriggerNode, triggerTree } from "../../src/triggers/trigger-model.js";

/** Each filed item's folder path by name ("Mission/Variables"; "" for Root), and each folder's Label and element id by path. */
function filing(doc: TriggerDocument): {
  readonly folderOf: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string | undefined>;
  readonly ids: ReadonlyMap<string, string>;
  readonly order: ReadonlyMap<string, readonly string[]>;
} {
  const folderOf = new Map<string, string>();
  const labels = new Map<string, string | undefined>();
  const ids = new Map<string, string>();
  const order = new Map<string, string[]>();
  const visit = (nodes: readonly TriggerNode[], at: string): void => {
    order.set(
      at,
      nodes.map((node) => (node.type === "Variable" ? node.variable.name : node.type === "Trigger" ? node.trigger.name : `${node.folder.name}/`)),
    );
    for (const node of nodes) {
      if (node.type === "Variable") folderOf.set(node.variable.name, at);
      else if (node.type === "Trigger") folderOf.set(node.trigger.name, at);
      else {
        const path = at ? `${at}/${node.folder.name}` : node.folder.name;
        labels.set(path, node.folder.label);
        ids.set(path, node.folder.id);
        visit(node.items, path);
      }
    }
  };
  visit(triggerTree(doc), "");
  return { folderOf, labels, ids, order };
}

const fixture = MissionBlueprintSchema.parse(JSON.parse(await readFile(new URL("../fixtures/trigger-test/blueprint.json", import.meta.url), "utf8")));

describe("the trigger-test Mission's filing", () => {
  const { folderOf, order } = filing(buildMissionTriggers(fixture));

  it("leaves nothing generated in Root: only the compile's folders", () => {
    expect(order.get("")).toEqual(["Mission/", "Fight/"]);
  });

  it("files Mission Start and the outcomes in Mission, and the encounter under the first Beat", () => {
    expect(folderOf.get("Mission Start")).toBe("Mission");
    expect(folderOf.get("Zeratul Dies")).toBe("Mission");
    expect(folderOf.get("Zealot Dies")).toBe("Mission");
    expect(folderOf.get("Encounter - Crossing")).toBe("Fight/Encounters/Crossing Ambush");
  });
});

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const zone = (id: string, x0: number, connections: string[], role = "path") => ({
  id,
  name: id,
  elevation: 1,
  landform: "flat",
  role,
  polygon: rect(x0, 0, x0 + 24, 48),
  connections: connections.map((toZoneId) => ({ toZoneId, type: "open" })),
});
const unit = (id: string, zoneId: string, player: number, x: number, unitType = "Zealot") => ({ id, name: id, zoneId, kind: "unit", unitType, player, position: { x, y: 24 } });

/** home → road → lane → fort; Calm starts with the mission, Siege on the hero reaching the road, Fallback on the warden dying. */
function mission(extra: Record<string, unknown> = {}, schema: { parse: typeof MissionBlueprintSchema.parse } = MissionBlueprintSchema) {
  return schema.parse({
    id: "filing",
    campaignId: "test",
    title: "Filing",
    setting: "test",
    mapSize: { width: 96, height: 48 },
    zones: [zone("home", 0, ["road"], "base"), zone("road", 24, ["home", "lane"]), zone("lane", 48, ["road", "fort"]), zone("fort", 72, ["lane"], "base")],
    anchors: [unit("hero", "home", 1, 4, "Zeratul"), unit("warden", "fort", 2, 74), unit("guard", "lane", 2, 50), unit("scout", "road", 2, 30)],
    beats: [
      { id: "calm", title: "Calm", summary: "Nothing yet." },
      { id: "siege", title: "Siege", summary: "The fort sends raids.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "road" }] },
      { id: "fallback", title: "Fallback", summary: "The fort pulls back.", startsWhen: [{ type: "anchorDies", anchorId: "warden" }] },
    ],
    objectives: [
      { id: "reach_lane", title: "Reach the lane", description: "Get there.", type: "primary", beatId: "calm" },
      { id: "kill_guard", title: "Kill the guard", description: "Down him.", type: "secondary", beatId: "siege", completeWhen: { type: "anchorDies", anchorId: "guard" } },
    ],
    encounters: [
      { id: "lane_ambush", triggerZoneId: "lane", attackerAnchorIds: ["guard"], fromBeat: "siege" },
      { id: "road_ambush", triggerZoneId: "road", attackerAnchorIds: ["scout"] },
    ],
    waves: [
      {
        id: "raid",
        spawnZoneId: "fort",
        targetZoneIds: ["home"],
        arrival: "ground",
        units: [{ type: "Zealot", count: 2 }],
        startsAtBeat: "siege",
        endsAtBeat: "fallback",
        firstSeconds: 30,
        intervalSeconds: 90,
      },
    ],
    outcomes: { victory: [{ type: "anchorDies", anchorId: "warden" }], defeat: [{ type: "anchorDies", anchorId: "hero" }] },
    screenplay: { title: "Filing" },
    ...extra,
  });
}

describe("a Mission's Beats, Objectives, Encounters and Waves", () => {
  const { folderOf, order } = filing(buildMissionTriggers(mission()));

  it("gives each Beat a folder, in Beat order, after Mission", () => {
    expect(order.get("")?.slice(0, 4)).toEqual(["Mission/", "Calm/", "Siege/", "Fallback/"]);
  });

  it("files a Beat's own triggers in its folder", () => {
    expect(folderOf.get("Beat - Siege")).toBe("Siege");
    expect(folderOf.get("Beat - Siege Arms")).toBe("Siege");
    expect(folderOf.get("Beat - Fallback")).toBe("Fallback");
  });

  it("files an Objective's completion under its Beat's Objectives", () => {
    expect(folderOf.get("guard Dies")).toBe("Siege/Objectives");
  });

  it("files an Encounter under the Beat it's armed from, or the first Beat without one", () => {
    expect(folderOf.get("Encounter - lane")).toBe("Siege/Encounters/Lane Ambush");
    expect(folderOf.get("Encounter - road")).toBe("Calm/Encounters/Road Ambush");
  });

  it("files an Encounter's end triggers, and the variables only they use, in its folder", () => {
    const ended = filing(
      buildMissionTriggers(
        mission({
          encounters: [{ id: "lane_ambush", triggerZoneId: "lane", attackerAnchorIds: ["guard"], fromBeat: "siege", endsWhen: { afterSeconds: 15, damageTaken: 200 } }],
          screenplay: { title: "Filing", scenes: [{ id: "after", cue: { type: "encounterEnds", encounterId: "lane_ambush" }, lines: [{ id: "done", speaker: "Hero", speakerAnchorId: "hero", text: "Done." }] }] },
        }),
      ),
    );
    for (const name of ["Encounter - lane", "Encounter Ends - lane", "Encounter Timer - lane", "Encounter Damage - lane"]) expect(ended.folderOf.get(name), name).toBe("Siege/Encounters/Lane Ambush");
    expect(ended.folderOf.get("encounters_lane_ambush_ended")).toBe("Siege/Encounters/Lane Ambush/Variables");
  });

  it("files a transition cued on a Beat's start in that Beat's folder, and one cued on no Beat in Mission", () => {
    const lit = filing(
      buildMissionTriggers(
        mission({
          transitions: [
            { id: "dusk", cue: { type: "beatStarts", beatId: "siege" }, light: { to: "StarshipDark" } },
            { id: "nightfall", cue: { type: "missionStart" }, afterSeconds: 60, light: { to: "StarshipDark", seconds: 480 } },
          ],
        }),
      ),
    );
    expect(lit.folderOf.get("Transition Dusk")).toBe("Siege");
    expect(lit.folderOf.get("Transition Nightfall")).toBe("Mission");
  });

  it("files a Wave's triggers under the Beat it starts at, though it runs on", () => {
    const raid = [...folderOf].filter(([name]) => name.startsWith("Wave - raid"));
    expect(raid.length).toBeGreaterThan(1);
    for (const [name, at] of raid) expect(at, name).toBe("Siege/Waves/Raid");
  });

  it("files a variable only one folder's triggers use in that folder's Variables, first in it", () => {
    expect(folderOf.get("Wave raid Sent")).toBe("Siege/Waves/Raid/Variables");
    expect(order.get("Siege/Waves/Raid")?.[0]).toBe("Variables/");
  });

  it("files a variable several folders use in Mission's Variables: an Objective's, created at Mission Start", () => {
    expect(folderOf.get("objective_kill_guard")).toBe("Mission/Variables");
    expect(folderOf.get("beat_siege_started")).toBe("Mission/Variables");
    // Its Wave's and the Beats' that start and end it: Mission's, though Siege holds the Wave.
    expect(folderOf.get("Wave raid On")).toBe("Mission/Variables");
    expect(order.get("Mission")?.[0]).toBe("Variables/");
  });

  it("writes no empty folder", () => {
    expect(order.get("Calm")).toEqual(["Encounters/"]);
    expect(order.get("Fallback")).toEqual(["Beat - Fallback"]);
    expect([...order.keys()].filter((path) => path.startsWith("Screenplay") || path.startsWith("Mechanics"))).toEqual([]);
  });
});

// The basic Workspace's beacon Plugin, for a Mechanic's triggers.
const { registry } = await loadWorkspace(fileURLToPath(new URL("../fixtures/workspaces/basic/", import.meta.url)));

describe("a Wave's, Encounter's and Mechanic's folder name", () => {
  const [raid] = mission().waves;
  const [lane, road] = mission().encounters;
  const beacon = (title?: string) => ({ id: "fort-beacon", type: "beacon", params: { zoneId: "fort" }, ...(title ? { title } : {}) });
  const untitled = filing(buildMissionTriggers(mission({ mechanics: [beacon()] }, missionBlueprintSchema(registry))));
  const titled = filing(
    buildMissionTriggers(
      mission(
        { waves: [{ ...raid, title: "The Fort's Raid" }], encounters: [{ ...lane, title: "Lane Guard" }, road], mechanics: [beacon("Signal Fire")] },
        missionBlueprintSchema(registry),
      ),
    ),
  );

  it("is the id in words without a title: each _ or - a space, each word upper case first", () => {
    expect(untitled.folderOf.get("Wave raid Sent")).toBe("Siege/Waves/Raid/Variables");
    expect(untitled.folderOf.get("Encounter - lane")).toBe("Siege/Encounters/Lane Ambush");
    expect(untitled.folderOf.get("Beacon Lights")).toBe("Mechanics/Fort Beacon");
  });

  it("is the title when there is one", () => {
    expect(titled.folderOf.get("Wave raid Sent")).toBe("Siege/Waves/The Fort's Raid/Variables");
    expect(titled.folderOf.get("Encounter - lane")).toBe("Siege/Encounters/Lane Guard");
    expect(titled.folderOf.get("Beacon Lights")).toBe("Mechanics/Signal Fire");
  });

  it("keeps the folder's element id when the title changes, so the tree doesn't reshuffle", () => {
    expect(titled.ids.get("Siege/Waves/The Fort's Raid")).toBe(untitled.ids.get("Siege/Waves/Raid"));
    expect(titled.ids.get("Siege/Encounters/Lane Guard")).toBe(untitled.ids.get("Siege/Encounters/Lane Ambush"));
    expect(titled.ids.get("Mechanics/Signal Fire")).toBe(untitled.ids.get("Mechanics/Fort Beacon"));
  });

  it("leaves trigger and variable names alone", () => {
    expect([...titled.folderOf.keys()].sort()).toEqual([...untitled.folderOf.keys()].sort());
  });
});

describe("each kind of folder's icon", () => {
  const { labels } = filing(buildMissionTriggers(mission()));

  it("is the Native Label from #816's table", () => {
    expect(Object.fromEntries(labels)).toMatchObject({
      Mission: "0677E49B",
      "Mission/Variables": "CE915C5A",
      Siege: "C5092BE2",
      "Siege/Objectives": "00000035",
      "Siege/Encounters": "00000013",
      "Siege/Encounters/Lane Ambush": "00000013",
      "Siege/Waves": "DB711C00",
      "Siege/Waves/Raid": "DB711C00",
      "Siege/Waves/Raid/Variables": "CE915C5A",
      "Enemy AI": "00000027",
    });
  });
});
