// The filing rules (#818) on compiled Map Packages of the fixture Workspaces: the Triggers file and
// its TriggerStrings read back, each item's folder by the folders' names.
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { libraryItems } from "../../src/triggers/splice-triggers.js";
import { copyOf, fixture, tempFolder } from "../mcp/harness.js";

type Filed = { readonly type: string; readonly name: string; readonly folder: string; readonly label?: string };

/** Each item a compiled package files, by name: its type, its folder's path by name ("" for Root) and, for a folder, its Label. */
async function filedIn(map: string): Promise<Map<string, Filed>> {
  const xml = await readFile(path.join(map, "Triggers"), "utf8");
  const strings = (await readFile(path.join(map, "enUS.SC2Data/LocalizedData/TriggerStrings.txt"), "utf8")).replace(/^\uFEFF/, "");
  const names = new Map([...strings.matchAll(/^(?:Trigger|Variable|Category)\/Name\/([0-9A-F]{8})=(.*)$/gm)].map((match) => [match[1]!, match[2]!.trimEnd()]));
  const items = libraryItems(xml);
  const pathOf = (id: string | undefined): string => {
    if (id === undefined) return "";
    const parent = pathOf(items.get(`Category/${id}`)?.folder);
    return parent ? `${parent}/${names.get(id)}` : names.get(id)!;
  };
  const filed = new Map<string, Filed>();
  for (const { id, ...item } of items.values()) {
    if (!["Trigger", "Variable", "Category"].includes(item.type)) continue;
    const label = item.type === "Category" ? /<Label Type="Label" Library="Ntve" Id="([0-9A-F]{8})"\/>/.exec(item.elements.join("\n"))?.[1] : undefined;
    const name = item.type === "Category" ? pathOf(id) : names.get(id) ?? id;
    filed.set(name, { type: item.type, name, folder: pathOf(item.folder), ...(label ? { label } : {}) });
  }
  return filed;
}

async function compiledAt(root: string, blueprintPath: string): Promise<Map<string, Filed>> {
  const map = path.join(await tempFolder(), "Out.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return filedIn(map);
}

/**
 * A fixture Workspace to compile from: a copy, as a compile writes a scripted Mission's placeholder
 * voices beside it; but bell's own, whose Plugin imports core by a path a copy breaks, and whose
 * Missions have no script.
 */
const workspaceRoot = async (name: string): Promise<string> => (name === "bell" ? fixture(name) : copyOf(name));

describe("each fixture Workspace's Missions, compiled", () => {
  // These two fail to compile on purpose: broken-field its checks, gong-field its library call.
  const failing = ["checked/broken-field", "bell/gong-field"];
  const missions = ["bell/bell-field", "checked/radio-field", "cinematic/radio-field", "crossing/ashen-crossing", "dressed/yard", "field/lava-field", "radio/radio-field", "reference/ember-reach", "reference/ember-reach-run", "screenplay/outpost", "tides/ford", "tides/yard"];

  it("lists every fixture Mission but the two that fail", async () => {
    const found: string[] = [];
    for (const workspace of await readdir(fixture(""))) {
      for (const mission of await readdir(path.join(fixture(workspace), "missions")).catch(() => [])) found.push(`${workspace}/${mission}`);
    }
    expect(found.filter((mission) => !failing.includes(mission)).sort()).toEqual([...missions].sort());
  });

  it.each(missions)("%s leaves nothing generated in Root", async (mission) => {
    const [workspace, id] = mission.split("/") as [string, string];
    const root = await workspaceRoot(workspace);
    const filed = await compiledAt(root, path.join(root, "missions", id, "blueprint.json"));
    expect([...filed.values()].filter((item) => item.folder === "" && item.type !== "Category")).toEqual([]);
  });
});

describe("a Mechanic's triggers", () => {
  it("go in Mechanics/<its title, or its id in words>, whatever Plugin supplies them", async () => {
    const root = await workspaceRoot("bell");
    const filed = await compiledAt(root, path.join(root, "missions/bell-field/blueprint.json"));
    expect(filed.get("Bell Rings")?.folder).toBe("Mechanics/Bell");
    expect(filed.get("Mechanics")?.label).toBe("00000009");
    expect(filed.get("Mechanics/Bell")?.label).toBe("00000009");
  });
});

const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "field",
  kind: "camera",
  position: { x, y },
  cameraTarget: { x, y },
  cameraValues: [
    { index: "Distance", value: 30 },
    { index: "Pitch", value: 50 },
    { index: "Yaw", value: 180 },
    { index: "FieldOfView", value: 27.8 },
  ],
});
const unit = (id: string, x: number, y: number, player = 1) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player, position: { x, y, z: 0 }, rotation: 0 });
const scene = (number: number, line: string) => ["", `## Scene ${number}: SCENE ${number}`, "", `**NOVA** \`D-01-01-0${number}-001-NOVA\`: ${line}`, ""].join("\n");

const REACHES_FIELD = { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" };
const NEARS_RAYNOR = { type: "anchorNears", anchorId: "nova", distance: 4, targetId: "raynor" };

/**
 * Radio Field: scene 1 its Cinematic at mission start; scene 2 the Trigger Scene `landfall` as Nova
 * reaches the field; scene 3 lines only, 5 s later; scene 4 lines only, as Nova nears Raynor; the
 * trigger scene `closing` the victory outro, on Raynor dying.
 */
async function screenplayMission(): Promise<Map<string, Filed>> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), [scene(2, "Here we are."), scene(3, "Quiet out here."), scene(4, "Raynor.")].join(""));
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-land", 20, 20), camera("cam-victory", 30, 30), unit("nova", 10, 10), unit("raynor", 40, 40)];
  blueprint.outcomes = { victory: [{ type: "anchorDies", anchorId: "raynor" }], defeat: [] };
  blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD }, { scene: 3, cue: REACHES_FIELD, afterSeconds: 5 }, { scene: 4, cue: NEARS_RAYNOR });
  blueprint.screenplay.script.triggerScenes = [
    { id: "landfall", scene: 2 },
    { id: "closing", outcome: "victory" },
  ];
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landfall.json"), JSON.stringify({ shots: [{ camera: "cam-land", afterMs: 0, pauseAfterMs: 2000 }] }));
  await writeFile(path.join(mission, "trigger-scenes/closing.json"), JSON.stringify({ outro: "victory", shots: [{ camera: "cam-victory", afterMs: 0, pauseAfterMs: 4000 }] }));
  return compiledAt(root, blueprintPath);
}

describe("a Mission's Screenplay", async () => {
  const filed = await screenplayMission();
  const triggersIn = (folder: string): string[] => [...filed.values()].filter((item) => item.type === "Trigger" && item.folder === folder).map((item) => item.name);

  it("files a scene's Cinematic in Screenplay/Scene <n>, a Cutscene folder", () => {
    expect(triggersIn("Screenplay/Scene 1").length).toBeGreaterThan(0);
    expect(triggersIn("Screenplay/Scene 1").every((name) => name.startsWith("Cinematic Radio"))).toBe(true);
    expect(filed.get("Screenplay/Scene 1")?.label).toBe("ACD748EC");
  });

  it("files a scene's Trigger Scene in its Scene folder, a Cutscene folder", () => {
    expect(filed.get("Trigger Scene Landfall Setup")?.folder).toBe("Screenplay/Scene 2");
    expect(triggersIn("Screenplay/Scene 2").every((name) => name.startsWith("Trigger Scene Landfall"))).toBe(true);
    expect(filed.get("Screenplay/Scene 2")?.label).toBe("ACD748EC");
  });

  it("files a lines-only scene's Script Scene trigger in its Scene folder, a Conversation folder", () => {
    expect(triggersIn("Screenplay/Scene 3")).toEqual([expect.stringMatching(/^Script Scene 3 After /)]);
    expect(filed.get("Screenplay/Scene 3")?.label).toBe("00000034");
  });

  it("files the victory outcome's Trigger Scene in Mission, beside the outcome", () => {
    expect(filed.get("Trigger Scene Closing Setup")?.folder).toBe("Mission");
    expect(filed.get("raynor Dies")?.folder).toBe("Mission");
  });

  it("files Cue triggers, and a condition only a cue reacts to, in Screenplay/Cues", () => {
    expect(triggersIn("Screenplay/Cues")).toEqual(expect.arrayContaining([expect.stringMatching(/^Cue - nova Within 4 Of raynor/), "nova Reaches Field"]));
    expect(filed.get("Screenplay")?.label).toBe("A544E154");
    expect(filed.get("Screenplay/Cues")?.label).toBe("00000017");
  });

  it("leaves no lines-only scene its own folder when it files nothing", () => {
    // Scene 4 plays straight from its cue's trigger, which is Cues'.
    expect(filed.has("Screenplay/Scene 4")).toBe(false);
  });
});
