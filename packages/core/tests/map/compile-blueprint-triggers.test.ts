// A Mission Blueprint's own triggers (ADR-0026) compiled into its Map Package beside Kept content:
// the Harbour Mission imported from an Editor-made package, every trigger in it Kept, with the Kept
// global and map functions of the authored-trigger fixture (cut from Heart of the Swarm's zspace01)
// added to its Triggers as the Editor would hold them. The Blueprint's triggers call those functions
// and set that global by their Ids.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const CROSSING = path.join(FIXTURES, "workspaces", "crossing");
const savedAt = new Date("2026-01-01T00:00:00Z");
const TRIGGER_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A trigger that sets the Kept global to the Kept function's value, by their Ids. */
const gatherFighters = {
  kind: "trigger",
  id: "5A5A1001",
  name: "Gather Fighters",
  actions: [
    {
      id: "5A5A1002",
      function: "Ntve/00000136",
      params: [
        { id: "5A5A1003", def: "Ntve/00000219", variable: "863AD0ED" },
        { id: "5A5A1004", def: "Ntve/00000220", call: { id: "5A5A1005", function: "EDA10F5E" } },
      ],
    },
  ],
};

/** A global the Blueprint declares, filed in a folder inside the triggers' folder. */
const fighterCount = { id: "5A5A3001", name: "Fighter Count", type: { type: "int" }, value: { id: "5A5A3002", type: "int", value: "3" } };

type Mission ={ readonly workspace: Workspace; readonly mapDir: string; readonly blueprintPath: string };

/** The Harbour Mission, imported, with the fixture's Kept global and map functions in its Triggers and the Blueprint's two triggers. */
async function harbour(): Promise<Mission> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-blueprint-triggers-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  // The fixture's Kept global and functions, added as the Editor holds them: filed in Root, their elements at the end.
  const cut = await readFile(path.join(FIXTURES, "editor-triggers", "authored-trigger", "Triggers"), "utf8");
  const keptElements = [...cut.matchAll(/^    <Element Type="(Variable|FunctionDef|ParamDef)" Id="(863AD0ED|EDA10F5E|82A32553|23A2DB1A)">\n[\s\S]*?^    <\/Element>\n/gm)].map((match) => match[0]);
  const triggersFile = path.join(source, "Triggers");
  const triggers = await readFile(triggersFile, "utf8");
  const items = ['<Item Type="Variable" Id="863AD0ED"/>', '<Item Type="FunctionDef" Id="EDA10F5E"/>', '<Item Type="FunctionDef" Id="82A32553"/>'].map((line) => `        ${line}\r\n`).join("");
  await writeFile(triggersFile, triggers.replace("    </Root>", `${items}    </Root>`).replace("</TriggerData>", `${keptElements.join("").replace(/\n/g, "\r\n")}</TriggerData>`));
  const stringsFile = path.join(source, TRIGGER_STRINGS);
  const names = (await readFile(path.join(FIXTURES, "editor-triggers", "authored-trigger", "TriggerStrings.txt"), "utf8")).replace(/^﻿/, "").split("\n").filter((line) => /(863AD0ED|EDA10F5E|82A32553|23A2DB1A)=/.test(line));
  await writeFile(stringsFile, `${await readFile(stringsFile, "utf8")}${names.map((line) => `${line}\r\n`).join("")}`);

  const workspace = await loadWorkspace(workspaceRoot);
  await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  const blueprintPath = path.join(missionDir, "blueprint.json");
  await mkdir(path.join(missionDir, "triggers"));
  await cp(path.join(FIXTURES, "blueprint-triggers", "acquire-target.json"), path.join(missionDir, "triggers", "acquire-target.json"));
  await writeFile(path.join(missionDir, "triggers", "gather-fighters.json"), JSON.stringify(gatherFighters, null, 2));
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.triggers = ["triggers/acquire-target.json", "triggers/gather-fighters.json"];
  blueprint.triggerVariables = [fighterCount];
  blueprint.triggerFolders = [
    { id: "5A5A2001", name: "Fighters", items: ["category:5A5A2002", "trigger:7611B84F", "trigger:5A5A1001"] },
    { id: "5A5A2002", name: "Fighter Variables", items: ["variable:5A5A3001"] },
  ];
  await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
  return { workspace: await loadWorkspace(workspaceRoot), mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath };
}

describe("a Mission Blueprint's own triggers beside Kept content", () => {
  it("compile into Triggers and MapScript.galaxy, calling a Kept function and setting a Kept global by Id, the Kept lines left as they were", async () => {
    const mission = await harbour();
    const before = await readFile(path.join(mission.mapDir, "Triggers"), "utf8");

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });

    const triggers = await readFile(path.join(mission.mapDir, "Triggers"), "utf8");
    // Every line the Editor wrote is still there, in order.
    const lines = triggers.split("\r\n");
    let at = 0;
    for (const line of before.split("\r\n")) {
      at = lines.indexOf(line, at);
      expect(at, line).toBeGreaterThanOrEqual(0);
      at += 1;
    }
    expect(triggers).toContain('    <Element Type="Category" Id="5A5A2001">\r\n        <Item Type="Category" Id="5A5A2002"/>\r\n        <Item Type="Trigger" Id="7611B84F"/>\r\n        <Item Type="Trigger" Id="5A5A1001"/>\r\n    </Element>');
    expect(triggers).toContain('    <Element Type="Variable" Id="5A5A3001">\r\n        <VariableType>\r\n            <Type Value="int"/>\r\n        </VariableType>\r\n        <Value Type="Param" Id="5A5A3002"/>\r\n    </Element>');
    expect(triggers).toContain('    <Element Type="Trigger" Id="7611B84F">\r\n        <InitOff/>');
    const script = await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain("    lv_targetGroup = gf_HyperionFighterTargetGroup();\r\n");
    expect(script).toContain("        gf_HyperionFighterLeashing(EventUnit());\r\n");
    expect(script).toContain("    gv_hyperionFighterGroup = gf_HyperionFighterTargetGroup();\r\n");
    expect(script).toContain("    gt_HyperionFighterAcquireTarget_Init();\r\n    gt_GatherFighters_Init();\r\n");
    expect(script).toContain("\r\nint gv_fighterCount;\r\n");
    expect(script).toContain("    gv_fighterCount = 3;\r\n");
    const strings = await readFile(path.join(mission.mapDir, TRIGGER_STRINGS), "utf8");
    expect(strings).toContain("Trigger/Name/5A5A1001=Gather Fighters\r\n");
    expect(strings).toContain("Category/Name/5A5A2001=Fighters\r\n");
  });

  it("compile again to the same package", async () => {
    const mission = await harbour();
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const first = await Promise.all(["Triggers", "MapScript.galaxy", TRIGGER_STRINGS].map((file) => readFile(path.join(mission.mapDir, file), "utf8")));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const second = await Promise.all(["Triggers", "MapScript.galaxy", TRIGGER_STRINGS].map((file) => readFile(path.join(mission.mapDir, file), "utf8")));
    expect(second).toEqual(first);
  });

  it("compile a global the Blueprint declares with no trigger of its own", async () => {
    const mission = await harbour();
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, triggers: undefined, triggerFolders: undefined }));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readFile(path.join(mission.mapDir, "Triggers"), "utf8")).toContain('        <Item Type="Variable" Id="5A5A3001"/>\r\n');
    expect(await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8")).toContain("    gv_fighterCount = 3;\r\n");
  });

  it("refuses a trigger whose Id a Kept element has, naming it, and writes nothing", async () => {
    const mission = await harbour();
    const file = path.join(path.dirname(mission.blueprintPath), "triggers", "gather-fighters.json");
    await writeFile(file, JSON.stringify({ ...gatherFighters, id: "EDA10F5E" }));
    const before = await readFile(path.join(mission.mapDir, "Triggers"), "utf8");
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow('the Blueprint trigger "Gather Fighters" (EDA10F5E, triggers/gather-fighters.json) gives the element Id EDA10F5E, which the Kept FunctionDef EDA10F5E in Triggers has');
    expect(await readFile(path.join(mission.mapDir, "Triggers"), "utf8")).toBe(before);
  });
});

describe("Beats on a Blueprint trigger, named by its element Id as a Kept one is (ADR-0014)", () => {
  const read = (mission: Mission): Promise<string[]> => Promise.all(["Triggers", "MapScript.galaxy"].map((name) => readFile(path.join(mission.mapDir, name), "utf8")));

  /** The Harbour Mission with "Gather Fighters" starting at Map Initialization, trigger references to both Blueprint triggers, `edit` applied, compiled. */
  async function withReferences(edit: (blueprint: any) => any, { disabled = false } = {}): Promise<{ readonly mission: Mission; readonly triggers: string; readonly script: string }> {
    const mission = await harbour();
    const triggersDir = path.join(path.dirname(mission.blueprintPath), "triggers");
    await writeFile(path.join(triggersDir, "gather-fighters.json"), JSON.stringify({ ...gatherFighters, events: [{ id: "5A5A1006", function: "Ntve/00000120" }] }, null, 2));
    if (disabled) {
      // "Hyperion Fighter Acquire Target" disabled, as the Editor's Disabled flag.
      const acquire = path.join(triggersDir, "acquire-target.json");
      await writeFile(acquire, JSON.stringify({ ...JSON.parse(await readFile(acquire, "utf8")), disabled: true }, null, 2));
    }
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    const kept = [
      ...(blueprint.kept ?? []),
      { id: "gather-fighters", kind: "trigger", editorId: "5A5A1001", name: "Gather Fighters" },
      { id: "acquire-target", kind: "trigger", editorId: "7611B84F", name: "Hyperion Fighter Acquire Target" },
    ];
    await writeFile(mission.blueprintPath, JSON.stringify(edit({ ...blueprint, kept }), null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const [triggers, script] = await read(mission);
    return { mission, triggers: triggers!, script: script! };
  }

  it("checks a reference to a Blueprint trigger against the trigger's file, not the package, which doesn't have it yet", async () => {
    const mission = await harbour();
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    const kept = [{ id: "gather-fighters", kind: "trigger", editorId: "5A5A1001", name: "Gathering" }];
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept }, null, 2));
    const problems = (await checkWorkspace(mission.workspace.root)).problems.filter((problem) => String(problem.path).startsWith("kept"));
    expect(problems.map(({ message, severity }) => ({ message, severity }))).toEqual([
      { message: 'Kept Reference gather-fighters is named "Gathering", but the Blueprint trigger 5A5A1001 it names is "Gather Fighters"', severity: "warning" },
    ]);
  });

  it("refuses a reference to a disabled Blueprint trigger, which has no script to wait on", async () => {
    await expect(
      withReferences((blueprint) => ({ ...blueprint, beats: [{ id: "arrive", title: "Arrive", summary: "The fighters launch." }, { id: "gathered", title: "Gathered", summary: "They form up.", startsWhen: [{ type: "keptTriggerRuns", triggerId: "acquire-target" }] }] }), { disabled: true }),
    ).rejects.toThrow('The Blueprint trigger 7611B84F ("Hyperion Fighter Acquire Target"), which the Kept Reference acquire-target names, is disabled');
  });

  it("starts a Beat once the Blueprint trigger has run, waiting on it from map start as on a Kept one", async () => {
    const { script } = await withReferences((blueprint) => ({
      ...blueprint,
      beats: [
        { id: "arrive", title: "Arrive", summary: "The fighters launch." },
        { id: "gathered", title: "Gathered", summary: "The fighters form up.", startsWhen: [{ type: "keptTriggerRuns", triggerId: "gather-fighters" }] },
      ],
    }));
    const after = script.slice(script.indexOf("// Trigger: After Gather Fighters"));
    expect(after).toContain("    TriggerWaitForTrigger(gt_GatherFighters, true);\r\n");
    expect(after).toContain("    if ((TriggerIsEnabled(gt_BeatGathered) == true)) {\r\n        TriggerExecute(gt_BeatGathered, true, false);\r\n    }");
    expect(after).toContain("    TriggerAddEventMapInit(gt_AfterGatherFighters);");
  });

  it("holds a Blueprint trigger until its cue: its Map Initialization event switched off in its body, the cue running it", async () => {
    const { triggers, script, mission } = await withReferences((blueprint) => ({
      ...blueprint,
      kept: blueprint.kept.map((reference: any) => (reference.id === "gather-fighters" ? { ...reference, hold: { until: { type: "keptTriggerRuns", triggerId: "acquire-target" } } } : reference)),
    }));
    expect(triggers).toMatch(/<Element Type="FunctionCall" Id="5A5A1006">\r\n {8}<Disabled\/>/);
    const init = script.slice(script.indexOf("void gt_GatherFighters_Init"));
    expect(init.slice(0, init.indexOf("}"))).not.toContain("TriggerAddEventMapInit(gt_GatherFighters);");
    expect(script).toContain("    TriggerWaitForTrigger(gt_HyperionFighterAcquireTarget, true);\r\n    TriggerExecute(gt_GatherFighters, true, false);\r\n");

    // Compiled again, the package is the same; the hold gone, its start is on again.
    const first = await read(mission);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await read(mission)).toEqual(first);
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept: blueprint.kept.map(({ hold: _, ...reference }: any) => reference) }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect((await read(mission))[1]).toContain("    TriggerAddEventMapInit(gt_GatherFighters);\r\n");
  });

  it("refuses to hold a Blueprint trigger that starts on another event, or from a trigger that doesn't run it, as for a Kept one", async () => {
    const hold = (id: string, value: unknown) => (blueprint: any) => ({ ...blueprint, kept: blueprint.kept.map((reference: any) => (reference.id === id ? { ...reference, hold: value } : reference)) });
    await expect(withReferences(hold("acquire-target", { until: { type: "keptTriggerRuns", triggerId: "gather-fighters" } }))).rejects.toThrow(
      "Hyperion Fighter Acquire Target starts on an event other than Map Initialization, which a hold can't stand in for",
    );
    await expect(withReferences(hold("acquire-target", { from: "gather-fighters", until: { type: "keptTriggerRuns", triggerId: "gather-fighters" } }))).rejects.toThrow("Gather Fighters has no Run Trigger of Hyperion Fighter Acquire Target, so there is nothing to hold");
  });
});
