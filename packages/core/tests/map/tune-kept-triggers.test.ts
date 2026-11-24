// Tuning a Kept trigger in place (ADR-0010): its XML in Triggers and its Galaxy in MapScript.galaxy
// change together, so Test Document runs the change without an Editor save.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { runDriftTest } from "../../src/map/drift-test.js";
import { importMap } from "../../src/map/import-map.js";
import { keptCatalog, outlineKeptTrigger, tuneKeptTriggers } from "../../src/map/tune-kept-triggers.js";
import { loadWorkspace, parseMissionBlueprint, type Workspace } from "../../src/plugins/workspace.js";
import { readMissionScript } from "../../src/script/name-script.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { elementOf, readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";
import type { Trigger, TriggerCall } from "../../src/triggers/trigger-model.js";
import { mapScriptDrift } from "../../src/triggers/map-script-drift.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const SOURCE_BLUEPRINT = path.join(CROSSING, "missions", "ashen-crossing", "blueprint.json");
const savedAt = new Date("2026-01-01T00:00:00Z");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Imported = { readonly workspace: Workspace; readonly mapDir: string; readonly blueprintPath: string };

/** The Harbour Mission imported from an Editor-made package: every trigger in it Kept. */
async function imported(): Promise<Imported> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-tune-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  return { workspace, mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath: path.join(missionDir, "blueprint.json") };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
  }
  return out;
}

/** The Param element that holds Zeratul Dies' Wait time, found in the Triggers XML. */
function waitTimeParam(triggers: string): string {
  const id = /<Element Type="Param" Id="([0-9A-F]{8})">\r?\n\s*<ParameterDef Type="ParamDef" Library="Ntve" Id="00000419"\/>\r?\n\s*<Value>3\.0<\/Value>/.exec(triggers)?.[1];
  if (!id) throw new Error("no Wait time of 3.0");
  return id;
}

/** What the Editor writes for the whole script once the Wait is 4.5: the compile's own writer, from the source Blueprint with the time changed. */
async function scriptWithWaitOf(seconds: number, mapName: string): Promise<string> {
  const workspace = await loadWorkspace(CROSSING);
  const blueprint = await parseMissionBlueprint(workspace, SOURCE_BLUEPRINT);
  const found = await readMissionScript(blueprint, SOURCE_BLUEPRINT, workspace);
  const doc = buildMissionTriggers(blueprint, found ? { script: found.script } : {});
  const retime = (call: TriggerCall): TriggerCall =>
    call.def.id === "00000242" ? { ...call, params: { ...call.params, time: { ...call.params.time!, value: { kind: "fixed", value: seconds } } } } : call;
  const triggers = doc.triggers.map((trigger): Trigger => (trigger.name === "Zeratul Dies" ? { ...trigger, actions: trigger.actions.map(retime) } : trigger));
  return writeMapScript({ mapName, triggers: { ...doc, triggers } });
}

/**
 * An action function the author made in the Editor, in the forms the Editor saves: a library's
 * struct variable (whose Galaxy name only the library knows), a Switch on it, and a member of the
 * map's own struct. Its Galaxy is as the Editor writes it.
 */
const GUARD_XML = [
  '    <Element Type="FunctionDef" Id="D0000001">',
  "        <FlagAction/>",
  '        <FunctionCall Type="FunctionCall" Id="D0000002"/>',
  '        <FunctionCall Type="Comment" Id="D00000C0"/>',
  '        <FunctionCall Type="FunctionCall" Id="D0000003"/>',
  "    </Element>",
  '    <Element Type="FunctionCall" Id="D0000002">',
  '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="9F8EF8FB"/>',
  '        <Parameter Type="Param" Id="D0000004"/>',
  '        <Parameter Type="Param" Id="D0000005"/>',
  '        <Parameter Type="Param" Id="D0000007"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000004">',
  '        <ParameterDef Type="ParamDef" Library="Ntve" Id="C7188352"/>',
  "        <Value>2</Value>",
  '        <ValueType Type="int"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000005">',
  '        <ParameterDef Type="ParamDef" Library="Ntve" Id="3BFEECBB"/>',
  '        <Variable Type="Variable" Library="Abcd" Id="A0000001"/>',
  '        <StructMember Type="Param" Id="D0000006"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000006">',
  '        <Variable Type="Variable" Library="Abcd" Id="A0000002"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000007">',
  '        <ParameterDef Type="ParamDef" Library="Ntve" Id="7E5035EE"/>',
  "        <Value>GuardSight</Value>",
  '        <ValueType Type="gamelink"/>',
  '        <ValueGameType Type="Upgrade"/>',
  "    </Element>",
  '    <Element Type="Comment" Id="D00000C0">',
  "    </Element>",
  '    <Element Type="FunctionCall" Id="D0000003">',
  '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="91C49196"/>',
  '        <Parameter Type="Param" Id="D0000008"/>',
  '        <FunctionCall Type="FunctionCall" Id="D0000010"/>',
  '        <FunctionCall Type="FunctionCall" Id="D0000020"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000008">',
  '        <ParameterDef Type="ParamDef" Library="Ntve" Id="B4ACF12A"/>',
  '        <Variable Type="Variable" Library="Abcd" Id="A0000001"/>',
  '        <StructMember Type="Param" Id="D0000009"/>',
  "    </Element>",
  '    <Element Type="Param" Id="D0000009">',
  '        <Variable Type="Variable" Library="Abcd" Id="A0000002"/>',
  "    </Element>",
  ...[1, 2].flatMap((n) => [
    `    <Element Type="FunctionCall" Id="D00000${n}0">`,
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="3A1227AB"/>',
    '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="AD43BC93"/>',
    `        <Parameter Type="Param" Id="D00000${n}1"/>`,
    `        <FunctionCall Type="FunctionCall" Id="D00000${n}2"/>`,
    "    </Element>",
    `    <Element Type="Param" Id="D00000${n}1">`,
    '        <ParameterDef Type="ParamDef" Library="Ntve" Id="9A8F1093"/>',
    `        <Value>${n}</Value>`,
    '        <ValueType Type="int"/>',
    "    </Element>",
    `    <Element Type="FunctionCall" Id="D00000${n}2">`,
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000136"/>',
    '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="363CE97C"/>',
    `        <Parameter Type="Param" Id="D00000${n}3"/>`,
    `        <Parameter Type="Param" Id="D00000${n}5"/>`,
    "    </Element>",
    `    <Element Type="Param" Id="D00000${n}3">`,
    '        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000219"/>',
    '        <Variable Type="Variable" Id="7A000001"/>',
    `        <StructMember Type="Param" Id="D00000${n}4"/>`,
    "    </Element>",
    `    <Element Type="Param" Id="D00000${n}4">`,
    '        <Variable Type="Variable" Id="7A000002"/>',
    "    </Element>",
    `    <Element Type="Param" Id="D00000${n}5">`,
    '        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000220"/>',
    `        <Value>${n === 1 ? "3.0" : "2.0"}</Value>`,
    '        <ValueType Type="fixed"/>',
    "    </Element>",
  ]),
  '    <Element Type="Structure" Id="5E000001">',
  '        <Variable Type="Variable" Id="7A000002"/>',
  "    </Element>",
  '    <Element Type="Variable" Id="7A000002">',
  "        <VariableType>",
  '            <Type Value="fixed"/>',
  "        </VariableType>",
  "    </Element>",
  '    <Element Type="Variable" Id="7A000001">',
  "        <VariableType>",
  '            <Type Value="struct"/>',
  '            <TypeElement Type="Structure" Id="5E000001"/>',
  "        </VariableType>",
  "    </Element>",
].join("\r\n");

const GUARD_NAMES = ["FunctionDef/Name/D0000001=Guard Difficulty", "Structure/Name/5E000001=Guard", "Variable/Name/7A000001=Guard", "Variable/Name/7A000002=Delay"];

/** gf_GuardDifficulty with case 2's delay at `delay`, as the Editor writes it. */
const guardGalaxy = (delay: string): string =>
  [
    "void gf_GuardDifficulty () {",
    "    // Automatic Variable Declarations",
    "    int autoD0000003_val;",
    "",
    "    // Implementation",
    '    libNtve_gf_SetUpgradeLevelForPlayer(2, "GuardSight", libAbcd_gv_stats.lv_level);',
    "    autoD0000003_val = libAbcd_gv_stats.lv_level;",
    "    if (autoD0000003_val == 1) {",
    "        gv_guard.lv_delay = 3.0;",
    "    }",
    "    else if (autoD0000003_val == 2) {",
    `        gv_guard.lv_delay = ${delay};`,
    "    }",
    "    else {",
    "    }",
    "}",
    "",
    "",
  ].join("\r\n");

/** The imported package with the author's Guard Difficulty function in its Triggers, TriggerStrings and script. */
async function withGuardFunction({ mapDir }: Imported): Promise<void> {
  const triggers = path.join(mapDir, "Triggers");
  await writeFile(triggers, (await readFile(triggers, "utf8")).replace("</TriggerData>", `${GUARD_XML}\r\n</TriggerData>`));
  const strings = path.join(mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
  await writeFile(strings, `${await readFile(strings, "utf8")}${GUARD_NAMES.join("\r\n")}\r\n`);
  const script = path.join(mapDir, "MapScript.galaxy");
  const rule = "//--------------------------------------------------------------------------------------------------";
  await writeFile(script, (await readFile(script, "utf8")).replace(`${rule}\r\n// Trigger Variables`, `${rule}\r\n// Global Functions\r\n${rule}\r\n${guardGalaxy("2.0")}${rule}\r\n// Trigger Variables`));
}

function savingHost(cacheDir: string, save: () => Promise<string>): Host {
  return {
    machine: { ...emptyMachineConfig(), cacheDir },
    adapter: undefined,
    has: (name) => name === "editor.save",
    run: (async (name: string, request: { mapPath: string }) => {
      if (name !== "editor.save") throw new Error(`no ${name}`);
      await writeFile(path.join(request.mapPath, "MapScript.galaxy"), await save());
    }) as Host["run"],
  };
}

describe("tuning a Kept trigger", () => {
  it("changes only that trigger's XML and Galaxy, and an Editor save writes the same script", async () => {
    const harbour = await imported();
    const before = await tree(harbour.mapDir);
    const param = waitTimeParam(before["Triggers"]!);

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param, value: 4.5 }]);

    expect(result.files).toEqual(["Triggers", "MapScript.galaxy"]);
    const after = await tree(harbour.mapDir);
    for (const file of Object.keys(before)) if (file !== "Triggers" && file !== "MapScript.galaxy") expect(after[file], file).toBe(before[file]);
    // One line of XML, and one of Galaxy.
    const changed = (a: string, b: string): [string, string][] => {
      const left = a.split("\r\n");
      const right = b.split("\r\n");
      expect(right).toHaveLength(left.length);
      return left.flatMap((line, index) => (line === right[index] ? [] : [[line, right[index]!] as [string, string]]));
    };
    expect(changed(before["Triggers"]!, after["Triggers"]!)).toEqual([["        <Value>3.0</Value>", "        <Value>4.5</Value>"]]);
    expect(changed(before["MapScript.galaxy"]!, after["MapScript.galaxy"]!)).toEqual([["    Wait(3.0, c_timeGame);", "    Wait(4.5, c_timeGame);"]]);

    const mapName = /^\/\/ Name:   (.*)\r$/m.exec(after["MapScript.galaxy"]!)![1]!;
    const { drift } = await runDriftTest(harbour.workspace, harbour.blueprintPath, savingHost(path.join(root!, "cache"), () => scriptWithWaitOf(4.5, mapName)), { savedAt });
    expect(drift).toEqual([]);
    // The untuned script is what an Editor save would differ from.
    expect(mapScriptDrift(after["MapScript.galaxy"]!, await scriptWithWaitOf(3, mapName)).map((item) => item.section)).toEqual(["Trigger: Zeratul Dies"]);
  }, 60_000);

  it("changes only a disabled trigger's XML, as the Editor writes no Galaxy for it", async () => {
    const harbour = await imported();
    const triggersPath = path.join(harbour.mapDir, "Triggers");
    const scriptPath = path.join(harbour.mapDir, "MapScript.galaxy");
    const triggers = await readFile(triggersPath, "utf8");
    const names = triggerStringNames(await readFile(path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8"));
    const id = [...names].find(([key, name]) => key.startsWith("Trigger/") && name === "Zeratul Dies")![0].split("/")[1];
    // Disabled in the Editor, and saved: the Editor drops its section.
    await writeFile(triggersPath, triggers.replace(`<Element Type="Trigger" Id="${id}">\r\n`, (line) => `${line}        <Disabled/>\r\n`));
    const script = await readFile(scriptPath, "utf8");
    const span = keptElementSpan(script, "gt_ZeratulDies")!;
    await writeFile(scriptPath, script.slice(0, span.start) + script.slice(span.end));
    const before = await tree(harbour.mapDir);

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: waitTimeParam(triggers), value: 4.5 }]);

    expect(result.files).toEqual(["Triggers"]);
    const after = await tree(harbour.mapDir);
    expect(after["MapScript.galaxy"]).toBe(before["MapScript.galaxy"]);
    expect(after["Triggers"]).toBe(before["Triggers"]!.replace(`<Value>3.0</Value>`, "<Value>4.5</Value>"));
  }, 60_000);

  it("is refused, naming each uncatalogued function by library and id, and writes nothing", async () => {
    const harbour = await imported();
    const triggersPath = path.join(harbour.mapDir, "Triggers");
    const triggers = await readFile(triggersPath, "utf8");
    const param = waitTimeParam(triggers);
    // The author has added an action from a library the catalog doesn't cover.
    const id = /<Element Type="FunctionCall" Id="([0-9A-F]{8})">\r\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000242"\/>/.exec(triggers)![1]!;
    const withUnknown = triggers
      .replace(`<Action Type="FunctionCall" Id="${id}"/>`, `<Action Type="FunctionCall" Id="${id}"/>\r\n        <Action Type="FunctionCall" Id="0BADC0DE"/>`)
      .replace("</TriggerData>", `    <Element Type="FunctionCall" Id="0BADC0DE">\r\n        <FunctionDef Type="FunctionDef" Library="Abcd" Id="12345678"/>\r\n    </Element>\r\n</TriggerData>`);
    await writeFile(triggersPath, withUnknown);
    const before = await tree(harbour.mapDir);

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param, value: 4.5 }])).rejects.toThrow(
      /Zeratul Dies can't be tuned here: .*the trigger catalog doesn't know the function 12345678 \(library Abcd\).*save the map there/,
    );
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);

  it("tunes a function's Switch case, writing the library's names as the Editor's script has them", async () => {
    const harbour = await imported();
    await withGuardFunction(harbour);

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Guard Difficulty", param: "D0000025", value: 2.5 }]);

    expect(result.changed).toEqual(["Guard Difficulty: parameter D0000025 set to 2.5"]);
    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain(guardGalaxy("2.5"));
    expect(script).not.toContain(guardGalaxy("2.0"));
    expect(await readFile(path.join(harbour.mapDir, "Triggers"), "utf8")).toContain('<Element Type="Param" Id="D0000025">\r\n        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000220"/>\r\n        <Value>2.5</Value>');
  }, 60_000);
  it("removes a call and copies one with a new value, its XML and Galaxy together", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const call = (functionId: string): string => new RegExp(`<Element Type="FunctionCall" Id="([0-9A-F]{8})">\\r\\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="${functionId}"/>`).exec(triggers)![1]!;
    const gameOver = call("00000198");
    const wait = call("00000242");
    const time = waitTimeParam(triggers);

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [
      { op: "copy", trigger: "Zeratul Dies", call: wait, set: { [time]: 1 } },
      { op: "remove", trigger: "Zeratul Dies", call: gameOver },
    ]);

    expect(result.changed[1]).toBe(`Zeratul Dies: removed ${gameOver}`);
    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain("        return true;\r\n    }\r\n\r\n    Wait(3.0, c_timeGame);\r\n    Wait(1.0, c_timeGame);\r\n    return true;\r\n}");
    const after = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    expect(after).not.toContain(gameOver);
    const copy = /copied [0-9A-F]{8} as ([0-9A-F]{8})/.exec(result.changed[0]!)![1]!;
    expect(after).toContain(`<Action Type="FunctionCall" Id="${wait}"/>\r\n        <Action Type="FunctionCall" Id="${copy}"/>`);
  }, 60_000);
  it("on a dry run writes nothing and shows each trigger's change in the Editor's form, the changed lines marked", async () => {
    const harbour = await imported();
    const before = await tree(harbour.mapDir);
    const triggers = before["Triggers"]!;
    const call = (functionId: string): string => new RegExp(`<Element Type="FunctionCall" Id="([0-9A-F]{8})">\\r\\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="${functionId}"/>`).exec(triggers)![1]!;

    const changedArgument = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: waitTimeParam(triggers), value: 4.5 }], { dryRun: true });
    const addedAndRemoved = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [
      { op: "copy", trigger: "Zeratul Dies", call: call("00000242") },
      { op: "remove", trigger: "Zeratul Dies", call: call("00000198") },
    ], { dryRun: true });

    expect(await tree(harbour.mapDir)).toEqual(before);
    expect(changedArgument.files).toEqual([]);
    const [argument] = changedArgument.diffs!;
    expect(argument!.trigger).toBe("Zeratul Dies");
    expect(argument!.diff.split("\n").filter((line) => line.includes("←"))).toEqual([expect.stringMatching(/^ +\S.*4\.5.*  ← was: .*3\.0/)]);
    const marked = addedAndRemoved.diffs![0]!.diff.split("\n").filter((line) => line.includes("←"));
    expect(marked.some((line) => line.endsWith("← new"))).toBe(true);
    expect(marked.some((line) => line.endsWith("← remove"))).toBe(true);
    // Every line of the outline is there, marked or not.
    expect(addedAndRemoved.diffs![0]!.diff.split("\n").length).toBeGreaterThan(marked.length);
  }, 60_000);
  it("tunes an older map's trigger whose calls and parameters share their Ids with Variables, and gives a copy Ids no type has", async () => {
    const harbour = await imported();
    const triggersPath = path.join(harbour.mapDir, "Triggers");
    const triggers = await readFile(triggersPath, "utf8");
    const call = (functionId: string): string => new RegExp(`<Element Type="FunctionCall" Id="([0-9A-F]{8})">\\r\\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="${functionId}"/>`).exec(triggers)![1]!;
    const gameOver = call("00000198");
    const wait = call("00000242");
    const time = waitTimeParam(triggers);
    // thanson01's GameOver (Variable 00000029) at each Id, after every element, as an Editor that numbers each type apart saves it.
    const variable = (id: string): string => `    <Element Type="Variable" Id="${id}">\r\n        <VariableType>\r\n            <Type Value="bool"/>\r\n        </VariableType>\r\n    </Element>\r\n`;
    // And a comment just before the Wait with the Wait's Id, as thanson01's Comment 00000030 shares a call's.
    const comment = `    <Element Type="Comment" Id="${wait}">\r\n        <Comment>\r\n            CINEMATIC BEGINS\r\n        </Comment>\r\n    </Element>\r\n`;
    const waitLine = `        <Action Type="FunctionCall" Id="${wait}"/>\r\n`;
    await writeFile(triggersPath, triggers.replace(waitLine, `        <Action Type="Comment" Id="${wait}"/>\r\n${waitLine}`).replace("</TriggerData>", `${[gameOver, wait, time].map(variable).join("")}${comment}</TriggerData>`));

    const outline = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "Zeratul Dies");
    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [
      { op: "copy", trigger: "Zeratul Dies", call: wait, set: { [time]: 1 } },
      { op: "remove", trigger: "Zeratul Dies", call: gameOver },
    ]);

    expect(outline.tunable).toBe(true);
    expect(outline.outline).toContain(`${time} time = 3.0`);
    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain("        return true;\r\n    }\r\n\r\n    Wait(3.0, c_timeGame);\r\n    Wait(1.0, c_timeGame);\r\n    return true;\r\n}");
    const after = readTriggersFile(await readFile(triggersPath, "utf8"));
    expect(["FunctionCall", "Variable"].map((type) => elementOf(after, type, gameOver)?.type)).toEqual([undefined, "Variable"]);
    expect(elementOf(after, "Variable", wait)).toBeDefined();
    const copy = /copied [0-9A-F]{8} as ([0-9A-F]{8})/.exec(result.changed[0]!)![1]!;
    const copiedTime = new RegExp(`${time} as ([0-9A-F]{8})`).exec(result.changed[0]!)![1]!;
    expect([...after.elements.values()].filter((element) => element.id === copy || element.id === copiedTime).map((element) => element.type)).toEqual(["FunctionCall", "Param"]);
    expect(after.text).toContain(`<Action Type="Comment" Id="${wait}"/>\r\n        <Action Type="FunctionCall" Id="${wait}"/>\r\n        <Action Type="FunctionCall" Id="${copy}"/>`);
    expect(elementOf(after, "Comment", wait)).toBeDefined();
  }, 60_000);
  it("refuses to remove by an Id a call and a comment of the trigger share, in an older map, rather than guess which", async () => {
    const harbour = await imported();
    const triggersPath = path.join(harbour.mapDir, "Triggers");
    const triggers = await readFile(triggersPath, "utf8");
    const wait = new RegExp(`<Element Type="FunctionCall" Id="([0-9A-F]{8})">\\r\\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000242"/>`).exec(triggers)![1]!;
    // A comment just before the Wait with the Wait's Id, as thanson01's Comment 00000030 shares a call's.
    const comment = `    <Element Type="Comment" Id="${wait}">\r\n        <Comment>\r\n            CINEMATIC BEGINS\r\n        </Comment>\r\n    </Element>\r\n`;
    const waitLine = `        <Action Type="FunctionCall" Id="${wait}"/>\r\n`;
    const edited = triggers.replace(waitLine, `        <Action Type="Comment" Id="${wait}"/>\r\n${waitLine}`).replace("</TriggerData>", `${comment}</TriggerData>`);
    await writeFile(triggersPath, edited);

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "remove", trigger: "Zeratul Dies", call: wait }])).rejects.toThrow(`${wait} is the element Id of both a call and a comment in Zeratul Dies`);
    // A copy's place, after that Id, is as unknown.
    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "Zeratul Dies", call: wait, after: wait }])).rejects.toThrow(`${wait} is the element Id of both a call and a comment in Zeratul Dies`);
    expect(await readFile(triggersPath, "utf8")).toBe(edited);
  }, 60_000);
  it("is refused when the script isn't the Editor's Galaxy for the trigger's XML", async () => {
    const harbour = await imported();
    const scriptPath = path.join(harbour.mapDir, "MapScript.galaxy");
    await writeFile(scriptPath, (await readFile(scriptPath, "utf8")).replace("Wait(3.0, c_timeGame);", "Wait(9.0, c_timeGame);"));
    const param = waitTimeParam(await readFile(path.join(harbour.mapDir, "Triggers"), "utf8"));

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param, value: 4.5 }])).rejects.toThrow(
      /gt_ZeratulDies isn't the Galaxy the Editor writes for Zeratul Dies's XML .*"    Wait\(9\.0, c_timeGame\);".*Save the map in the Editor/,
    );
  }, 60_000);

  it("refuses a Compiled trigger, which the Blueprint owns", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const strings = await readFile(path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
    const id = /^Trigger\/Name\/([0-9A-F]{8})=Zeratul Dies\r?$/m.exec(strings)![1]!;
    const recordPath = path.join(path.dirname(harbour.blueprintPath), "compile-record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    await writeFile(recordPath, JSON.stringify({ ...record, entries: [...record.entries, { kind: "trigger", id, fingerprint: "0000000000000000" }] }));

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: waitTimeParam(triggers), value: 4.5 }])).rejects.toThrow(/Zeratul Dies is Compiled Content/);
  }, 60_000);
  it("waits while the Editor has the map open, and writes nothing", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const before = await tree(harbour.mapDir);
    const host: Host = {
      machine: emptyMachineConfig(),
      adapter: undefined,
      has: (name) => name === "editor.checkClosed",
      run: (async () => {
        throw new Error("The Editor has Harbour.SC2Map open: close it, then try again");
      }) as Host["run"],
    };

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: waitTimeParam(triggers), value: 4.5 }], { host })).rejects.toThrow(/Not tuned: The Editor has Harbour.SC2Map open/);
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);

  it("writes nothing, and isn't refused while the Editor has the map open, when the edits change nothing", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const before = await tree(harbour.mapDir);
    const host: Host = {
      machine: emptyMachineConfig(),
      adapter: undefined,
      has: (name) => name === "editor.checkClosed",
      run: (async () => {
        throw new Error("The Editor has Harbour.SC2Map open: close it, then try again");
      }) as Host["run"],
    };

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: waitTimeParam(triggers), value: 3 }], { host });
    expect(result.files).toEqual([]);
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);

  it("outlines a trigger's calls and parameters by element Id, to pick what to tune", async () => {
    const harbour = await imported();
    await withGuardFunction(harbour);

    const { outline, tunable } = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "Guard Difficulty");

    expect(tunable).toBe(true);
    expect(outline.split("\n")).toEqual([
      "Guard Difficulty (function D0000001), tunable",
      "  D0000002 setUpgradeLevel",
      "      D0000004 player = 2",
      "      D0000005 level = libAbcd_gv_stats.lv_level",
      '      D0000007 upgrade = "GuardSight"',
      "  D0000003 switch",
      "      D0000008 value = libAbcd_gv_stats.lv_level",
      "      D0000010 case",
      "          D0000011 value = 1",
      "          D0000012 setVariable",
      "              D0000013 variable = gv_guard.lv_delay",
      "              D0000015 value = 3.0",
      "      D0000020 case",
      "          D0000021 value = 2",
      "          D0000022 setVariable",
      "              D0000023 variable = gv_guard.lv_delay",
      "              D0000025 value = 2.0",
    ]);
  }, 60_000);
  it("writes a string as given, and refuses values Galaxy can't hold", async () => {
    const harbour = await imported();
    await withGuardFunction(harbour);

    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Guard Difficulty", param: "D0000007", value: "Sight$&$$" }]);

    expect(await readFile(path.join(harbour.mapDir, "Triggers"), "utf8")).toContain("<Value>Sight$&amp;$$</Value>");
    expect(await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8")).toContain('libNtve_gf_SetUpgradeLevelForPlayer(2, "Sight$&$$", libAbcd_gv_stats.lv_level);');
    for (const [param, value, reason] of [
      ["D0000025", 1e-7, /a number Galaxy writes plainly/],
      ["D0000004", 2 ** 40, /an integer/],
      ["D0000007", "two\nlines", /one line of plain text/],
    ] as const) {
      await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Guard Difficulty", param, value }])).rejects.toThrow(reason);
    }
  }, 60_000);

  it("refuses a preset the catalog doesn't know when it's set", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const timeType = /<Element Type="Param" Id="([0-9A-F]{8})">\r\n        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000420"\/>/.exec(triggers)![1]!;

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Dies", param: timeType, value: { preset: "Ntve/0BADC0DE" } }])).rejects.toThrow(
      /Edit 1 \(set\): the trigger catalog doesn't know the preset Ntve\/0BADC0DE/,
    );
  }, 60_000);

  it("outlines a Compiled trigger as not tunable", async () => {
    const harbour = await imported();
    const strings = await readFile(path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
    const id = /^Trigger\/Name\/([0-9A-F]{8})=Zeratul Dies\r?$/m.exec(strings)![1]!;
    const recordPath = path.join(path.dirname(harbour.blueprintPath), "compile-record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    await writeFile(recordPath, JSON.stringify({ ...record, entries: [...record.entries, { kind: "trigger", id, fingerprint: "0000000000000000" }] }));

    const { tunable, reason } = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "Zeratul Dies");

    expect(tunable).toBe(false);
    expect(reason).toMatch(/Zeratul Dies is Compiled Content/);
  }, 60_000);

  it("renders an empty text parameter as the Editor does, so its trigger can be tuned", async () => {
    const harbour = await imported();
    const triggersPath = path.join(harbour.mapDir, "Triggers");
    const triggers = await readFile(triggersPath, "utf8");
    const scriptPath = path.join(harbour.mapDir, "MapScript.galaxy");
    const script = await readFile(scriptPath, "utf8");
    // The author clears a subtitle in the Editor and saves: its string goes, and the script says StringToText("").
    const subtitle = /StringExternal\("Param\/Value\/([0-9A-F]{8})"\), 0\.0, c_transmissionDurationAdd, true, c_maxPlayers, false\);\r\n(?:    gv_script_transmissions_playing = false;\r\n)?    GameOver/.exec(script)![1]!;
    for (const file of ["enUS.SC2Data/LocalizedData/GameStrings.txt"]) {
      const full = path.join(harbour.mapDir, file);
      await writeFile(full, (await readFile(full, "utf8")).replace(new RegExp(`^Param/Value/${subtitle}=[^\\r\\n]*\\r\\n`, "m"), ""));
    }
    await writeFile(scriptPath, script.replace(`StringExternal("Param/Value/${subtitle}")`, 'StringToText("")'));
    const gameOver = /<Element Type="Param" Id="([0-9A-F]{8})">\r\n        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000336"\/>/g;
    const showDialog = [...triggers.matchAll(gameOver)].at(-1)![1]!;

    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Reaches Temple Gate", param: showDialog, value: { preset: "Ntve/00000072" } }]);

    expect(await readFile(scriptPath, "utf8")).toContain('StringToText(""), 0.0, c_transmissionDurationAdd, true, c_maxPlayers, false);\r\n    gv_script_transmissions_playing = false;\r\n    GameOver(1, c_gameOverVictory, false, true);');
  }, 60_000);
  it("names the edit that leaves a trigger in a form whose Galaxy can't be written", async () => {
    const harbour = await imported();
    await withGuardFunction(harbour);

    await expect(
      tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [
        { op: "remove", trigger: "Guard Difficulty", call: "D0000010" },
        { op: "remove", trigger: "Guard Difficulty", call: "D0000020" },
      ]),
    ).rejects.toThrow(/^Edit 2 \(remove\): this edit leaves Guard Difficulty in a form whose Galaxy can't be written \(it holds libNtve_gf_Switch's #INITAUTOVAR of value, whose anycompare type this can't tell from the value given/);
  }, 60_000);

  it("refuses to copy or remove a call that is a parameter's value, and writes nothing", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    // Mission Start passes a call's result as a parameter.
    const [, param, call] = /<Element Type="Param" Id="([0-9A-F]{8})">\r\n {8}<ParameterDef [^\r\n]*\/>\r\n {8}<FunctionCall Type="FunctionCall" Id="([0-9A-F]{8})"\/>/.exec(triggers)!;
    const before = await tree(harbour.mapDir);

    for (const op of ["copy", "remove"] as const) {
      await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op, trigger: "Mission Start", call: call! }])).rejects.toThrow(
        new RegExp(`${call} is the value of parameter ${param}, not a call in a list, so it can't be ${op === "copy" ? "copied" : "removed"}`),
      );
    }
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);

  it("copies a call only after one in the same list: not an action after an event", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    const strings = await readFile(path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
    const id = /^Trigger\/Name\/([0-9A-F]{8})=Zeratul Dies\r?$/m.exec(strings)![1]!;
    const [, event, action] = new RegExp(`<Element Type="Trigger" Id="${id}">\\r\\n {8}<Event Type="FunctionCall" Id="([0-9A-F]{8})"/>\\r\\n {8}<Action Type="FunctionCall" Id="([0-9A-F]{8})"/>`).exec(triggers)!;

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "Zeratul Dies", call: action!, after: event! }])).rejects.toThrow(
      `${event} isn't in the same list as ${action} in Zeratul Dies`,
    );
  }, 60_000);

  it("copies a call only after one in the same block slot: not a Then action after an Else one", async () => {
    const harbour = await imported();
    await withIfFunction(harbour);
    const before = await tree(harbour.mapDir);

    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "Check Gate", call: "F0000004", after: "F0000005" }])).rejects.toThrow(
      "F0000005 isn't in the same list as F0000004 in Check Gate",
    );
    expect(await tree(harbour.mapDir)).toEqual(before);
    // After one in its own slot, it goes.
    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "Check Gate", call: "F0000004", after: "F0000004" }]);
  }, 60_000);

  it("sets a placed unit only to a unit the map holds", async () => {
    const harbour = await imported();
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    // Zeratul Reaches Temple Gate's event: a unit entering a region.
    const unit = /<Element Type="Param" Id="([0-9A-F]{8})">\r\n {8}<ParameterDef Type="ParamDef" Library="Ntve" Id="00000325"\/>\r\n {8}<ValueType Type="unit"\/>/.exec(triggers)![1]!;
    const region = /<ValueType Type="region"\/>\r\n {8}<ValueId Id="(\d+)"\/>/.exec(triggers)![1]!;
    const before = await tree(harbour.mapDir);

    const set = (id: number): Promise<unknown> => tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "Zeratul Reaches Temple Gate", param: unit, value: { id } }]);
    await expect(set(424242)).rejects.toThrow(`parameter ${unit} of Zeratul Reaches Temple Gate is a unit, and the map has no unit 424242 in Objects`);
    await expect(set(Number(region))).rejects.toThrow(`the map has no unit ${region} in Objects (${region} is a region)`);
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);

  it("removes a removed call's text strings from GameStrings", async () => {
    const harbour = await imported();
    const { call, params } = await subtitledTransmission(harbour);
    const stringsPath = path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt");
    const strings = await readFile(stringsPath, "utf8");
    const held = params.filter((param) => strings.includes(`Param/Value/${param}=`));
    expect(held.length).toBeGreaterThan(0);

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "remove", trigger: "Mission Start", call }]);

    expect(result.files).toContain("enUS.SC2Data/LocalizedData/GameStrings.txt");
    const after = await readFile(stringsPath, "utf8");
    for (const param of held) expect(after).not.toContain(`Param/Value/${param}=`);
    // Only those lines go.
    expect(after.split("\r\n")).toHaveLength(strings.split("\r\n").length - held.length);
  }, 60_000);

  it("copies a text parameter's string from GameStrings' last line, with no line break after it", async () => {
    const harbour = await imported();
    const { call, text } = await subtitledTransmission(harbour);
    const stringsPath = path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt");
    // The subtitle's string last, with no line break after it.
    const strings = (await readFile(stringsPath, "utf8")).replace(/\r\n$/, "");
    expect(strings.endsWith(text)).toBe(true);
    await writeFile(stringsPath, strings);

    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "Mission Start", call }]);

    const after = await readFile(stringsPath, "utf8");
    const lines = after.split("\r\n");
    // The copy's string on a line of its own after the original's, which is still last but one.
    expect(after).not.toContain(`${text}Param/Value/`);
    expect(lines.at(-2)).toBe(strings.split("\r\n").at(-1));
    expect(lines.at(-1)).toMatch(new RegExp(`^Param/Value/[0-9A-F]{8}=${text.replace(/[.]/g, "\\.")}$`));
    expect(await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8")).not.toContain('StringToText("")');
  }, 60_000);

  // Windows ignores a folder's mode, so the folder can't be made unwritable that way.
  it.skipIf(process.platform === "win32")("writes nothing when one file can't be written", async () => {
    const harbour = await imported();
    const { call } = await subtitledTransmission(harbour);
    const before = await tree(harbour.mapDir);
    const localized = path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData");
    // GameStrings' folder can't be written to, so its new text can't go there.
    await chmod(localized, 0o555);
    try {
      await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "remove", trigger: "Mission Start", call }])).rejects.toThrow(/^Not tuned: writing .* failed/);
    } finally {
      await chmod(localized, 0o755);
    }
    expect(await tree(harbour.mapDir)).toEqual(before);
  }, 60_000);
});

describe("tuning a Kept trigger that calls its Campaign Mod's library", () => {
  /** The `mod-library-calls` fixture: a Mission map's triggers calling the library of `mods/cmpn-story/`. */
  const MOD_CALLS = fileURLToPath(new URL("../fixtures/editor-triggers/mod-library-calls/", import.meta.url));

  /** The Harbour Mission with the fixture's triggers in its map, depending on the mod, and the mod in its Workspace when `withMod`. */
  async function harbourCallingTheMod(withMod: boolean): Promise<Imported> {
    const harbour = await imported();
    await cp(path.join(MOD_CALLS, "Triggers"), path.join(harbour.mapDir, "Triggers"));
    await cp(path.join(MOD_CALLS, "MapScript.galaxy"), path.join(harbour.mapDir, "MapScript.galaxy"));
    await cp(path.join(MOD_CALLS, "TriggerStrings.txt"), path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));
    const info = path.join(harbour.mapDir, "DocumentInfo");
    await writeFile(info, (await readFile(info, "utf8")).replace(/<Dependencies>/, "<Dependencies>\r\n        <Value>file:Mods\\Cmpn-Story.SC2Mod</Value>"));
    if (!withMod) return harbour;
    await cp(path.join(MOD_CALLS, "mods"), path.join(harbour.workspace.root, "mods"), { recursive: true });
    return { ...harbour, workspace: { ...harbour.workspace, mods: ["cmpn-story"] } };
  }

  it("tunes it, its calls to the library written as the Editor writes them", async () => {
    const harbour = await harbourCallingTheMod(true);

    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "017CF088", param: "E31EC9E7", value: true }]);

    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain("    if ((gv_eA.lv_hydroponicsAirPustulesDiscovered == true)) {\r\n");
    expect(script).toContain('        libCmpn_gf_SendTransmissionStory("Story03|Line04047", libCmpn_gv_heroUnit.lv_zeratul, true, "Default", libNtve_gf_CinematicPortrait(libNtve_ge_CinematicPortraitPosition_CenterLeft));\r\n');
  }, 60_000);

  it("is refused, naming the library's functions, when the Workspace doesn't hold the mod", async () => {
    const harbour = await harbourCallingTheMod(false);

    const { tunable, reason } = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "017CF088");

    expect(tunable).toBe(false);
    expect(reason).toMatch(/the trigger catalog doesn't know the functions BCF70417 \(library Cmpn\), B8B27D5C \(library Cmpn\), 8F0B8074 \(library Cmpn\)/);
  }, 60_000);

  it("is refused, saying why, when the mod's package can't be read", async () => {
    const harbour = await harbourCallingTheMod(true);
    // A Triggers that can't be read: a folder where the file should be.
    const triggers = path.join(harbour.workspace.root, "mods", "cmpn-story", "Cmpn-Story.SC2Mod", "Triggers");
    await rm(triggers);
    await mkdir(triggers);

    const { tunable, reason } = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "017CF088");

    expect(tunable).toBe(false);
    expect(reason).toMatch(/it calls into a library in reach that is refused \(the library Cmpn of the mod cmpn-story can't be read: .*EISDIR.*\)\. Fix that mod's package or Blueprint/);
    // The mod is at fault, not the catalog, and an Editor save of the map won't mend it.
    expect(reason).not.toMatch(/trigger catalog|Edit it in the Editor/);
  }, 60_000);

  it("outlines it, untunable with the reason, when the map's dependencies can't be read", async () => {
    const harbour = await harbourCallingTheMod(true);
    // A DocumentInfo that can't be read: a folder where the file should be.
    const info = path.join(harbour.mapDir, "DocumentInfo");
    await rm(info);
    await mkdir(info);

    const { outline, tunable, reason } = await outlineKeptTrigger(harbour.workspace, harbour.blueprintPath, "017CF088");

    expect(tunable).toBe(false);
    expect(reason).toMatch(/EISDIR/);
    expect(outline).toContain("017CF088");
  }, 60_000);
});

describe("tuning a Kept function with a text expression", () => {
  /** The `expressions/salvage-objective` fixture, cut from a current Editor's Mission save: Create Secondary Objective (Salvage), whose objective's name is a text expression. */
  const SALVAGE = fileURLToPath(new URL("../fixtures/editor-triggers/expressions/salvage-objective/", import.meta.url));
  /** The call that creates the objective: its name the text expression 5F29F17B, its description the text value C53CEFD4. */
  const CREATE = "F38B039D";
  const GERMAN = "\uFEFFParam/Expression/5F29F17B=Protoss-Technologie bergen (~A~ übrig)\r\nParam/Value/C53CEFD4=Bergt Protoss-Technologie aus den Tempelruinen.\r\n";

  /** The Harbour Mission with the fixture's function in its map, and its strings in English and in German. */
  async function harbourWithSalvage(): Promise<Imported> {
    const harbour = await imported();
    const localized = (locale: string, file: string): string => path.join(harbour.mapDir, `${locale}.SC2Data`, "LocalizedData", file);
    await cp(path.join(SALVAGE, "Triggers"), path.join(harbour.mapDir, "Triggers"));
    await cp(path.join(SALVAGE, "MapScript.galaxy"), path.join(harbour.mapDir, "MapScript.galaxy"));
    await cp(path.join(SALVAGE, "TriggerStrings.txt"), localized("enUS", "TriggerStrings.txt"));
    await cp(path.join(SALVAGE, "GameStrings.txt"), localized("enUS", "GameStrings.txt"));
    await mkdir(path.dirname(localized("deDE", "GameStrings.txt")), { recursive: true });
    await writeFile(localized("deDE", "GameStrings.txt"), GERMAN);
    return harbour;
  }

  const gameStrings = (mapDir: string, locale: string): Promise<string> => readFile(path.join(mapDir, `${locale}.SC2Data`, "LocalizedData", "GameStrings.txt"), "utf8");

  /** The Id of the copy's Param of ParamDef `def`: the one that isn't `original`. */
  const copiedParam = (triggers: string, def: string, original: string): string =>
    [...triggers.matchAll(new RegExp(`<Element Type="Param" Id="([0-9A-F]{8})">\\r\\n {8}<ParameterDef Type="ParamDef" Library="Ntve" Id="${def}"/>`, "g"))].map((match) => match[1]!).find((id) => id !== original)!;

  it("copies a call holding one with its words under the copy's Param, in every locale, and writes its Galaxy", async () => {
    const harbour = await harbourWithSalvage();

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "copy", trigger: "2C61F43A", call: CREATE }]);

    const copy = new RegExp(`copied ${CREATE} as ([0-9A-F]{8})`).exec(result.changed[0]!)![1]!;
    const triggers = await readFile(path.join(harbour.mapDir, "Triggers"), "utf8");
    expect(triggers).toContain(`<FunctionCall Type="FunctionCall" Id="${CREATE}"/>\r\n        <FunctionCall Type="FunctionCall" Id="${copy}"/>`);
    // The copy's name and description, each under its Param's new Id.
    const expression = copiedParam(triggers, "3D400D51", "5F29F17B");
    const value = copiedParam(triggers, "064A402E", "C53CEFD4");
    expect(result.files).toEqual(expect.arrayContaining(["enUS.SC2Data/LocalizedData/GameStrings.txt", "deDE.SC2Data/LocalizedData/GameStrings.txt"]));
    expect(await gameStrings(harbour.mapDir, "enUS")).toBe(
      "\uFEFFParam/Expression/5F29F17B=Salvage Protoss Technology (~A~ Remaining)\r\n" +
        `Param/Expression/${expression}=Salvage Protoss Technology (~A~ Remaining)\r\n` +
        "Param/Value/C53CEFD4=Recover Protoss technology from the temple ruins.\r\n" +
        `Param/Value/${value}=Recover Protoss technology from the temple ruins.\r\n`,
    );
    expect(await gameStrings(harbour.mapDir, "deDE")).toBe(
      "\uFEFFParam/Expression/5F29F17B=Protoss-Technologie bergen (~A~ übrig)\r\n" +
        `Param/Expression/${expression}=Protoss-Technologie bergen (~A~ übrig)\r\n` +
        "Param/Value/C53CEFD4=Bergt Protoss-Technologie aus den Tempelruinen.\r\n" +
        `Param/Value/${value}=Bergt Protoss-Technologie aus den Tempelruinen.\r\n`,
    );
    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain(
      '    ObjectiveCreate(TextExpressionAssemble("Param/Expression/5F29F17B"), StringExternal("Param/Value/C53CEFD4"), c_objectiveStateActive, false);\r\n' +
        `    TextExpressionSetToken("Param/Expression/${expression}", "A", IntToText((3 - gv_objectives.lv_scrapFound)));\r\n` +
        `    ObjectiveCreate(TextExpressionAssemble("Param/Expression/${expression}"), StringExternal("Param/Value/${value}"), c_objectiveStateActive, false);\r\n`,
    );
  }, 60_000);

  it("removes a call holding one with its words, in every locale", async () => {
    const harbour = await harbourWithSalvage();

    const result = await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "remove", trigger: "2C61F43A", call: CREATE }]);

    expect(result.changed).toEqual([`Create Secondary Objective (Salvage): removed ${CREATE}`]);
    expect(await gameStrings(harbour.mapDir, "enUS")).toBe("\uFEFF");
    expect(await gameStrings(harbour.mapDir, "deDE")).toBe("\uFEFF");
    expect(await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8")).not.toContain("Param/Expression/");
  }, 60_000);
});

describe("tuning a Kept trigger with several conditions", () => {
  /** The `three-conditions` fixture, cut from Liberty's thanson01: a trigger with three conditions, a blank line between each. */
  const THREE = fileURLToPath(new URL("../fixtures/editor-triggers/three-conditions/", import.meta.url));
  const between = /(\n {12}return false;\n {8}\}\n)\n(?= {8}if \(!)/g;

  it("tunes one saved without the blank lines between its conditions, and writes them as the Editor does", async () => {
    const harbour = await imported();
    const editors = await readFile(path.join(THREE, "MapScript.galaxy"), "utf8");
    // The layout an earlier tune or a compile wrote: no blank line between conditions.
    const older = editors.replace(between, "$1");
    expect(older).not.toBe(editors);
    await cp(path.join(THREE, "Triggers"), path.join(harbour.mapDir, "Triggers"));
    await writeFile(path.join(harbour.mapDir, "MapScript.galaxy"), older);
    await cp(path.join(THREE, "TriggerStrings.txt"), path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));

    await tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "49030CDB", param: "B2EEAB88", value: true }]);

    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toBe(editors.replace("(UnitGroupHasUnit(gv_convoyGuards, EventUnit()) == false)", "(UnitGroupHasUnit(gv_convoyGuards, EventUnit()) == true)"));
  }, 60_000);

  it("is still refused when the saved conditions differ by more than those blank lines", async () => {
    const harbour = await imported();
    const editors = await readFile(path.join(THREE, "MapScript.galaxy"), "utf8");
    await cp(path.join(THREE, "Triggers"), path.join(harbour.mapDir, "Triggers"));
    const older = editors.replace(between, "$1");
    expect(older).not.toBe(editors);
    await writeFile(path.join(harbour.mapDir, "MapScript.galaxy"), older.replace('"Marine"', '"Marauder"'));
    await cp(path.join(THREE, "TriggerStrings.txt"), path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));

    // The line named is the one that differs, not a blank line tuning accepts.
    await expect(tuneKeptTriggers(harbour.workspace, harbour.blueprintPath, [{ op: "set", trigger: "49030CDB", param: "B2EEAB88", value: true }])).rejects.toThrow(
      /isn't the Galaxy the Editor writes .*\(line \d+: the script has " +if \(!\(\(UnitGetType\(EventUnit\(\)\) == \\"Marauder\\"\)\)\) \{"/,
    );
  }, 60_000);
});

describe("the tune-kept command", () => {
  const cli = fileURLToPath(new URL("../../src/cli/tune-kept.ts", import.meta.url));
  // vite-node's own script, run by this Node: node_modules/.bin's shim is a .cmd on Windows, which execFile can't run.
  const viteNode = (() => {
    const manifest = createRequire(import.meta.url).resolve("vite-node/package.json");
    const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
    return path.join(path.dirname(manifest), bin["vite-node"]!);
  })();
  const run = (cwd: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      execFile(process.execPath, [viteNode, cli, ...args], { cwd, env: { ...process.env, INIT_CWD: cwd } }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }));
    });

  it("reports an edits file that isn't there, rather than outlining a trigger by that name", async () => {
    const harbour = await imported();

    const { code, stderr } = await run(root!, [harbour.blueprintPath, "missing-edits.json"]);

    expect(code).toBe(2);
    expect(stderr).toContain(`${path.join(root!, "missing-edits.json")}: file not found`);
  }, 60_000);

  it("fails an outline of a trigger that can't be tuned", async () => {
    const harbour = await imported();
    const strings = await readFile(path.join(harbour.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
    const id = /^Trigger\/Name\/([0-9A-F]{8})=Zeratul Dies\r?$/m.exec(strings)![1]!;
    const recordPath = path.join(path.dirname(harbour.blueprintPath), "compile-record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    await writeFile(recordPath, JSON.stringify({ ...record, entries: [...record.entries, { kind: "trigger", id, fingerprint: "0000000000000000" }] }));

    const compiled = await run(root!, [harbour.blueprintPath, "Zeratul Dies"]);
    const kept = await run(root!, [harbour.blueprintPath, "Mission Start"]);

    expect(compiled).toMatchObject({ code: 1, stdout: expect.stringMatching(/Zeratul Dies is Compiled Content/) });
    expect(kept).toMatchObject({ code: 0, stdout: expect.stringMatching(/^Mission Start \(trigger [0-9A-F]{8}\), tunable/) });
  }, 60_000);
});

/** Mission Start's last transmission: its call, its parameters, and its subtitle's text, GameStrings' last string. */
async function subtitledTransmission({ mapDir }: Imported): Promise<{ call: string; params: string[]; text: string }> {
  const triggers = await readFile(path.join(mapDir, "Triggers"), "utf8");
  const strings = await readFile(path.join(mapDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8");
  const [, subtitle, text] = /^Param\/Value\/([0-9A-F]{8})=([^\r\n]*)\r\n$/m.exec(strings.slice(strings.lastIndexOf("Param/Value/")))!;
  const element = new RegExp(`<Element Type="FunctionCall" Id="([0-9A-F]{8})">((?:\\r\\n {8}[^\\r\\n]*)*?\\r\\n {8}<Parameter Type="Param" Id="${subtitle}"/>)`).exec(triggers)!;
  return { call: element[1]!, params: [...element[2]!.matchAll(/<Parameter Type="Param" Id="([0-9A-F]{8})"\/>/g)].map((match) => match[1]!), text: text! };
}

/**
 * An action function the author made in the Editor: an If Then Else with a Wait in its Then and
 * its Else. Its Galaxy is as the renderer writes it, which the Guard function checks against the
 * Editor's; this one tests where a copy may go.
 */
async function withIfFunction({ workspace, mapDir }: Imported): Promise<void> {
  const param = (id: string, def: string, body: string): string[] => [`    <Element Type="Param" Id="${id}">`, `        <ParameterDef Type="ParamDef" Library="Ntve" Id="${def}"/>`, ...body.split("\n").map((line) => `        ${line}`), "    </Element>"];
  const wait = (id: string, slot: string, time: string, timeId: string, typeId: string): string[] => [
    `    <Element Type="FunctionCall" Id="${id}">`,
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000242"/>',
    `        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="${slot}"/>`,
    `        <Parameter Type="Param" Id="${timeId}"/>`,
    `        <Parameter Type="Param" Id="${typeId}"/>`,
    "    </Element>",
    ...param(timeId, "00000419", `<Value>${time}</Value>\n<ValueType Type="fixed"/>`),
    ...param(typeId, "00000420", '<Preset Type="PresetValue" Library="Ntve" Id="00000013"/>'),
  ];
  const xml = [
    '    <Element Type="FunctionDef" Id="F0000001">',
    "        <FlagAction/>",
    '        <FunctionCall Type="FunctionCall" Id="F0000002"/>',
    "    </Element>",
    '    <Element Type="FunctionCall" Id="F0000002">',
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000137"/>',
    '        <FunctionCall Type="FunctionCall" Id="F0000003"/>',
    '        <FunctionCall Type="FunctionCall" Id="F0000004"/>',
    '        <FunctionCall Type="FunctionCall" Id="F0000005"/>',
    "    </Element>",
    '    <Element Type="FunctionCall" Id="F0000003">',
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="C439C375"/>',
    '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000003"/>',
    '        <Parameter Type="Param" Id="F0000006"/>',
    '        <Parameter Type="Param" Id="F0000007"/>',
    '        <Parameter Type="Param" Id="F0000008"/>',
    "    </Element>",
    ...param("F0000006", "ABB380C4", '<Value>1</Value>\n<ValueType Type="int"/>'),
    ...param("F0000007", "51567265", '<Preset Type="PresetValue" Library="Ntve" Id="1E7A4625"/>'),
    ...param("F0000008", "4A15EC5F", '<Value>1</Value>\n<ValueType Type="int"/>'),
    ...wait("F0000004", "00000004", "1.0", "F0000009", "F000000A"),
    ...wait("F0000005", "00000005", "2.0", "F000000B", "F000000C"),
  ].join("\r\n");
  const triggersPath = path.join(mapDir, "Triggers");
  const triggers = (await readFile(triggersPath, "utf8")).replace("</TriggerData>", `${xml}\r\n</TriggerData>`);
  await writeFile(triggersPath, triggers);
  const stringsPath = path.join(mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
  const strings = `${await readFile(stringsPath, "utf8")}FunctionDef/Name/F0000001=Check Gate\r\n`;
  await writeFile(stringsPath, strings);
  const galaxy = new KeptGalaxyRenderer(readTriggersFile(triggers), triggerStringNames(strings), keptCatalog(workspace)).renderFunction("F0000001");
  if (!galaxy) throw new Error("Check Gate doesn't render");
  const script = path.join(mapDir, "MapScript.galaxy");
  const rule = "//--------------------------------------------------------------------------------------------------";
  await writeFile(script, (await readFile(script, "utf8")).replace(`${rule}\r\n// Trigger Variables`, `${rule}\r\n// Global Functions\r\n${rule}\r\n${galaxy}${rule}\r\n// Trigger Variables`));
}

