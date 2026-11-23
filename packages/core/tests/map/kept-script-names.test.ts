// How the compile names Kept triggers and globals the way the Editor does (ADR-0010), on a
// synthetic Triggers file: a global is an item in Root or a trigger folder (a local or a struct
// member is a Variable element too, but not an item); the Editor starts a global's script name
// lower case; an element with its own Identifier is called by it.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { keptReferenceProblems, keptScriptNames, refuseKeptScriptNames, resolveKeptReferences } from "../../src/map/kept-references.js";
import type { MissionBlueprint } from "../../src/domain/mission-blueprint.js";
import { NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import type { TriggerDocument } from "../../src/triggers/trigger-model.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const TRIGGERS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<TriggerData>",
  "    <Root>",
  '        <Item Type="Trigger" Id="00000001"/>',
  '        <Item Type="Category" Id="00000002"/>',
  "    </Root>",
  '    <Element Type="Trigger" Id="00000001">',
  '        <Variable Type="Variable" Id="00000005"/>',
  "    </Element>",
  '    <Element Type="Category" Id="00000002">',
  '        <Item Type="Variable" Id="00000003"/>',
  '        <Item Type="Trigger" Id="00000006"/>',
  '        <Item Type="Variable" Id="00000007"/>',
  "    </Element>",
  '    <Element Type="Variable" Id="00000003">',
  "    </Element>",
  '    <Element Type="Variable" Id="00000005">',
  "    </Element>",
  '    <Element Type="Trigger" Id="00000006">',
  "        <Identifier>GateScript</Identifier>",
  "    </Element>",
  '    <Element Type="Variable" Id="00000007">',
  "        <Identifier>Flare</Identifier>",
  "    </Element>",
  "</TriggerData>",
  "",
].join("\r\n");

const STRINGS = ["Trigger/Name/00000001=Mission Start", "Variable/Name/00000003=Wave A On", "Variable/Name/00000005=Point", "Trigger/Name/00000006=Gate Opens", "Variable/Name/00000007=Flare Timer", ""].join("\r\n");

async function mapDir(script = ""): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-names-"));
  const dir = path.join(root, "Harbour.SC2Map");
  await mkdir(path.join(dir, "enUS.SC2Data", "LocalizedData"), { recursive: true });
  await writeFile(path.join(dir, "Triggers"), TRIGGERS);
  await writeFile(path.join(dir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), `﻿${STRINGS}`);
  await writeFile(path.join(dir, "MapScript.galaxy"), script);
  return dir;
}

describe("Kept script names", () => {
  it("are the Editor's: globals only, lower case first, an Identifier as it stands", async () => {
    const names = await keptScriptNames(await mapDir(), new Set());
    expect(Object.fromEntries(names)).toEqual({ gt_MissionStart: "00000001", gv_waveAOn: "00000003", gt_GateScript: "00000006", gv_Flare: "00000007" });
  });

  it("refuse a Compiled global the Editor would give a Kept one's name", async () => {
    const dir = await mapDir();
    const triggers: TriggerDocument = {
      variables: [{ id: "0000AAAA", name: "Wave A On", type: "bool", initial: { id: "0000AAAB", value: { kind: "bool", value: false } } }],
      triggers: [],
    };
    await expect(refuseKeptScriptNames(dir, new Set(), triggers)).rejects.toThrow(/"Wave A On" would have the script name gv_waveAOn, which Kept variable 00000003 has/);
    const other = { ...triggers, variables: [{ ...triggers.variables[0]!, name: "Wave B On" }] };
    await expect(refuseKeptScriptNames(dir, new Set(), other)).resolves.toBeUndefined();
  });

  it("refuse a Compiled global whose name differs from a Kept Identifier only in its first letter's case", async () => {
    // The Kept global's Identifier is Flare (gv_Flare); a Compiled "Flare" is gv_flare, which the splice can't tell apart.
    const triggers: TriggerDocument = {
      variables: [{ id: "0000AAAA", name: "Flare", type: "bool", initial: { id: "0000AAAB", value: { kind: "bool", value: false } } }],
      triggers: [],
    };
    await expect(refuseKeptScriptNames(await mapDir(), new Set(), triggers)).rejects.toThrow(/"Flare" would have the script name gv_flare, which Kept variable 00000007 has \(as gv_Flare, which the splice can.t tell from it\)/);
  });

  it("refuse a Compiled trigger named like a Kept trigger's Identifier", async () => {
    const dir = await mapDir();
    const triggers: TriggerDocument = { variables: [], triggers: [{ id: "0000BBBB", name: "Gate Script", events: [{ id: "0000BBBC", def: F.mapInit, params: {} }], actions: [] }] };
    await expect(refuseKeptScriptNames(dir, new Set(), triggers)).rejects.toThrow(/gt_GateScript, which Kept trigger 00000006 has/);
  });
});

describe("Kept References to triggers and variables", () => {
  it("find a global only, not a local or a struct member", async () => {
    const dir = await mapDir();
    const problems = await keptReferenceProblems(
      [
        { id: "wave", kind: "variable", editorId: "00000003", name: "Wave A On" },
        { id: "point", kind: "variable", editorId: "00000005", name: "Point" },
      ],
      dir,
    );
    expect(problems).toEqual([expect.objectContaining({ index: 1, message: expect.stringContaining("has no variable 00000005") })]);
  });

  it("call a Kept trigger with an Identifier by it", async () => {
    const dir = await mapDir("trigger gt_GateScript;\r\n");
    const blueprint = { kept: [{ id: "gate", kind: "trigger", editorId: "00000006", name: "Gate Opens" }] } as unknown as MissionBlueprint;
    const resolved = await resolveKeptReferences(blueprint, dir);
    expect(resolved.kept[0]).toEqual({ id: "gate", kind: "trigger", editorId: "00000006", name: "Gate Opens", scriptName: "gt_GateScript" });
  });
});
