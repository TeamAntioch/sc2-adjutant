// The authoring tool (#1033): a Blueprint trigger written from calls in the Editor's terms, into the
// Harbour Mission imported from an Editor-made package, with the Kept global and map functions of the
// authored-trigger fixture (cut from Heart of the Swarm's zspace01) in its Triggers as the Editor
// holds them. What it writes is compiled and checked against the Editor's Galaxy for the same body.
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { writeBlueprintTriggerShowingChange } from "../../src/map/outline-diff.js";
import { writeBlueprintTrigger } from "../../src/map/write-blueprint-trigger.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import type { AuthoringCall, AuthoringTrigger } from "../../src/triggers/author-trigger.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const CROSSING = path.join(FIXTURES, "workspaces", "crossing");
const AUTHORED = path.join(FIXTURES, "editor-triggers", "authored-trigger");
const savedAt = new Date("2026-01-01T00:00:00Z");
const TRIGGER_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Mission = { readonly workspace: Workspace; readonly mapDir: string; readonly blueprintPath: string };

/** The Harbour Mission, imported, with the fixture's Kept global and map functions in its Triggers. */
async function harbour(): Promise<Mission> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-author-trigger-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const cut = await readFile(path.join(AUTHORED, "Triggers"), "utf8");
  const keptElements = [...cut.matchAll(/^    <Element Type="(Variable|FunctionDef|ParamDef)" Id="(863AD0ED|EDA10F5E|82A32553|23A2DB1A)">\n[\s\S]*?^    <\/Element>\n/gm)].map((match) => match[0]);
  const triggersFile = path.join(source, "Triggers");
  const triggers = await readFile(triggersFile, "utf8");
  const items = ['<Item Type="Variable" Id="863AD0ED"/>', '<Item Type="FunctionDef" Id="EDA10F5E"/>', '<Item Type="FunctionDef" Id="82A32553"/>'].map((line) => `        ${line}\r\n`).join("");
  await writeFile(triggersFile, triggers.replace("    </Root>", `${items}    </Root>`).replace("</TriggerData>", `${keptElements.join("").replace(/\n/g, "\r\n")}</TriggerData>`));
  const stringsFile = path.join(source, TRIGGER_STRINGS);
  const names = (await readFile(path.join(AUTHORED, "TriggerStrings.txt"), "utf8")).replace(/^﻿/, "").split("\n").filter((line) => /(863AD0ED|EDA10F5E|82A32553|23A2DB1A)=/.test(line));
  await writeFile(stringsFile, `${await readFile(stringsFile, "utf8")}${names.map((line) => `${line}\r\n`).join("")}`);
  const workspace = await loadWorkspace(workspaceRoot);
  await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  return { workspace: await loadWorkspace(workspaceRoot), mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath: path.join(missionDir, "blueprint.json") };
}

/** The fixture's trigger in the Editor's terms: its Kept functions and global by name, presets by value name, the If Then Else's slots by name. */
const acquireTarget: AuthoringTrigger = {
  name: "Hyperion Fighter Acquire Target",
  initiallyOff: true,
  variables: [{ name: "TargetGroup", type: "Unit Group", value: { function: "Empty Unit Group" } }],
  events: [{ function: "Unit Acquires Target" }],
  conditions: [
    {
      function: "Comparison",
      params: { "Value 1": { function: "Unit In Unit Group", params: { "Unit Group": { variable: "HyperionFighterGroup" } } }, Operator: "==", "Value 2": true },
    },
  ],
  actions: [
    { function: "Set Variable", params: { Variable: { variable: "TargetGroup" }, Value: { function: "Hyperion Fighter Target Group" } } },
    {
      function: "If Then Else",
      blocks: {
        If: [{ function: "Comparison", params: { "Value 1": { function: "Unit In Unit Group", params: { "Unit Group": { variable: "TargetGroup" }, Unit: { function: "Acquired Target" } } }, Operator: "==", "Value 2": false } }],
        Then: [{ function: "Hyperion Fighter Leashing", params: { Fighter: { function: "Triggering Unit" } } }],
      },
    },
  ],
};

/** A script's section for a trigger: from its rule line above `// Trigger: <name>` to its _Init's close, line ends as LF. */
function section(script: string, name: string): string {
  const text = script.replace(/\r\n/g, "\n");
  const start = text.indexOf(`//--------------------------------------------------------------------------------------------------\n// Trigger: ${name}\n`);
  const end = text.indexOf("\n}\n", text.indexOf(`_Init () {`, start)) + 3;
  expect(start, name).toBeGreaterThanOrEqual(0);
  return text.slice(start, end);
}

describe("writeBlueprintTrigger", () => {
  it("writes a trigger given in the Editor's terms that compiles to the Editor's Galaxy for the same body", async () => {
    const mission = await harbour();

    const written = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, acquireTarget);

    expect(written.file).toBe("triggers/hyperion-fighter-acquire-target.json");
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    expect(blueprint.triggers).toEqual(["triggers/hyperion-fighter-acquire-target.json"]);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const script = await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8");
    const editor = await readFile(path.join(AUTHORED, "MapScript.galaxy"), "utf8");
    expect(section(script, "Hyperion Fighter Acquire Target")).toBe(section(editor, "Hyperion Fighter Acquire Target"));
  });

  it("writes a periodic trigger calling functions outside the catalog, with defaults filled in, a text's words and custom script asked for", async () => {
    const mission = await harbour();

    await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, {
      name: "Ping",
      events: [{ function: "Periodic Event", params: { Duration: 2.5 } }],
      actions: [
        { function: "MinimapPing", params: { Position: { function: "Point", params: { X: 10, Y: 20 } } } },
        { function: "Text Message", params: { Message: "Ping!" } },
        { customScript: "UISetCursorVisible(PlayerGroupAll(), true);" },
      ],
    });

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const script = (await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8")).replace(/\r\n/g, "\n");
    const ping = section(script, "Ping");
    // Each parameter left out is the default a new call takes in the Editor: All Players, 2 seconds, red, Game Time, the subtitle area.
    expect(ping).toContain("    MinimapPing(PlayerGroupAll(), Point(10.0, 20.0), 2.0, Color(100.00, 0.00, 0.00));\n");
    expect(ping).toMatch(/ {4}UIDisplayMessage\(PlayerGroupAll\(\), c_messageAreaSubtitle, StringExternal\("Param\/Value\/([0-9A-F]{8})"\)\);\n/);
    expect(ping).toContain("    UISetCursorVisible(PlayerGroupAll(), true);\n");
    expect(ping).toContain("    TriggerAddEventTimePeriodic(gt_Ping, 2.5, c_timeGame);\n");
    const key = /StringExternal\("(Param\/Value\/[0-9A-F]{8})"\)/.exec(ping)![1]!;
    expect(await readFile(path.join(mission.mapDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8")).toContain(`${key}=Ping!`);
  });

  it("shows a rewrite in the Editor's form with its changed lines marked, and a new trigger with none", async () => {
    const mission = await harbour();
    const first = await writeBlueprintTriggerShowingChange(mission.workspace, mission.blueprintPath, acquireTarget);
    const second = await writeBlueprintTriggerShowingChange(mission.workspace, mission.blueprintPath, { ...acquireTarget, actions: [...acquireTarget.actions, { function: "Wait", params: { Time: 1 } }] });
    const marked = second.diff!.split("\n").filter((line) => line.includes("←"));

    expect(first.diff).toBeUndefined();
    expect(second.written).toMatchObject({ created: false });
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((line) => line.endsWith("← new"))).toBe(true);
    expect(second.diff).toContain('"function": "Wait",  ← new');
    expect(second.diff).toContain('"name": "Hyperion Fighter Acquire Target",\n');
  }, 60_000);

  it("rewrites a trigger keeping its Id, its local's and its unchanged calls' Ids, and gives a new call Ids nothing in reach has", async () => {
    const mission = await harbour();
    const first = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, acquireTarget);
    const file = path.join(path.dirname(mission.blueprintPath), ...first.file.split("/"));
    const before = JSON.parse(await readFile(file, "utf8"));
    const [setVariable, ifThenElse] = acquireTarget.actions as [AuthoringCall, AuthoringCall];

    const second = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, {
      ...acquireTarget,
      actions: [
        setVariable,
        { ...ifThenElse, blocks: { ...ifThenElse.blocks, Then: [{ function: "Hyperion Fighter Leashing", params: { Fighter: { function: "Acquired Target" } } }] } },
        { function: "Wait", params: { Time: 1 } },
      ],
    });

    expect(second).toMatchObject({ id: first.id, file: first.file, created: false });
    const after = JSON.parse(await readFile(file, "utf8"));
    expect(after.id).toBe(before.id);
    expect(after.variables).toEqual(before.variables);
    expect(after.events).toEqual(before.events);
    expect(after.conditions).toEqual(before.conditions);
    expect(after.actions[0]).toEqual(before.actions[0]);
    // The If Then Else changed in its Then: it and its If keep their Ids; the Then's call, the same function where it was, keeps its own.
    expect(after.actions[1].id).toBe(before.actions[1].id);
    const slot = (call: { body: { sub: string }[] }, sub: string) => call.body.find((statement) => statement.sub === sub)!;
    expect(slot(after.actions[1], "Ntve/00000003")).toEqual(slot(before.actions[1], "Ntve/00000003"));
    const [thenBefore, thenAfter] = [slot(before.actions[1], "Ntve/00000004"), slot(after.actions[1], "Ntve/00000004")] as { id: string; params: { id: string }[] }[];
    expect(thenAfter!.id).toBe(thenBefore!.id);
    expect(thenAfter!.params[0]!.id).not.toBe(thenBefore!.params[0]!.id);
    // The new call's Ids are new: none the trigger had, nor the package's.
    const triggers = await readFile(path.join(mission.mapDir, "Triggers"), "utf8");
    const wait = after.actions[2] as { id: string; params: { id: string }[] };
    for (const id of [wait.id, ...wait.params.map((param) => param.id)]) {
      expect(JSON.stringify(before)).not.toContain(id);
      expect(triggers).not.toContain(`Id="${id}"`);
    }
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8")).triggers).toEqual([first.file]);
  });

  it("settles a name two of a library's functions share by where the call stands, and renames a trigger given its Id", async () => {
    const mission = await harbour();
    // Built-In has an event and a function named Unit Is Selected.
    const first = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, { name: "Selected", events: [{ function: "Unit Is Selected" }] });
    const file = path.join(path.dirname(mission.blueprintPath), ...first.file.split("/"));
    const written = JSON.parse(await readFile(file, "utf8"));
    expect(written.events[0].function).toBe("Ntve/00000222");

    const renamed = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, { id: first.id, name: "Fighter Selected", events: [{ function: "Unit Is Selected" }] });

    expect(renamed).toMatchObject({ id: first.id, file: first.file, created: false, keptCalls: renamed.calls });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ...written, name: "Fighter Selected" });
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8")).triggers).toEqual([first.file]);
  });

  it("refuses wrong types, unknown names and ambiguous names in the Editor's terms, and writes nothing", async () => {
    const mission = await harbour();
    const before = await readFile(mission.blueprintPath, "utf8");

    const refusal = await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, {
      name: "Broken",
      events: [{ function: "Periodic Event", params: { Duration: { function: "Triggering Unit" }, "Time Type": "Lunch Time" } }],
      // Value 2 is Same As Value 1, and its default, Integer 1, isn't a Real.
      conditions: [{ function: "Comparison", params: { "Value 1": 2.5 } }],
      actions: [
        { function: "Ping Everyone" },
        { function: "Wait", params: { Length: 3 } },
        { function: "Set Variable", params: { Variable: { variable: "Fighters" }, Value: 1 } },
        { function: "Set Variable", params: { Variable: { variable: "HyperionFighterGroup" }, Value: 1 } },
        // Both of Built-In's Nots give a value, so where it stands doesn't settle it.
        { function: "Set Variable", params: { Variable: { variable: "HyperionFighterGroup" }, Value: { function: "Not" } } },
      ],
    }).catch((error: Error) => error.message);

    expect(refusal).toContain('event 1 (Periodic Event), Duration: takes a Real, but Triggering Unit\'s value is a Unit');
    expect(refusal).toContain('event 1 (Periodic Event), Time Type: Time Type has no value "Lunch Time": its values are "Real Time", "Game Time", "AI Time"');
    expect(refusal).toMatch(/action 5 \(Set Variable\), Value: "Not" is ambiguous: it is Not \(Built-In, [^;]+; Ntve\/[0-9A-F]{8}\), Not \(Built-In, [^;]+; Ntve\/[0-9A-F]{8}\); give it as <library>\/<id>/);
    expect(refusal).toContain('action 1: no function in reach is named "Ping Everyone": find one with search_trigger_functions; if no game function does the job, write custom script only where asked for');
    expect(refusal).toContain("the report-missing-feature skill");
    expect(refusal).toContain('action 2 (Wait): Wait has no parameter "Length": its parameters are "Time", "Time Type"');
    expect(refusal).toContain('action 3 (Set Variable), Variable: no variable named "Fighters" is in reach');
    expect(refusal).toContain("action 4 (Set Variable), Value: takes a Unit Group, but 1 is an Integer");
    expect(refusal).toContain("condition 1 (Comparison), Value 2: takes a Real, but its default is an Integer: give it");
    expect(await readFile(mission.blueprintPath, "utf8")).toBe(before);
    expect(existsSync(path.join(path.dirname(mission.blueprintPath), "triggers"))).toBe(false);
  });
});
