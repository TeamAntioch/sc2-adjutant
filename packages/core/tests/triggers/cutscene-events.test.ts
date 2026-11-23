// A running cutscene's events as catalog primitives (docs/reference/editor-and-engine.md, "A cutscene's
// events"): Cutscene Bookmark Fired and Cutscene End Scene Fired with their responses, written to Galaxy
// and to the Triggers XML. The ids are NativeLib.TriggerLib's.
import { describe, expect, it } from "vitest";

import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "../../src/triggers/trigger-catalog.js";
import type { ParamValue, TriggerCall, TriggerDocument } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

let next = 0;
const id = (): string => (0x20000000 + next++).toString(16).toUpperCase();
const call = (def: TriggerCall["def"], values: Record<string, ParamValue>): TriggerCall => ({
  id: id(),
  def,
  params: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { id: id(), value }])),
});

const any: ParamValue = { kind: "preset", preset: P.anyCutscene };
const doc: TriggerDocument = {
  variables: [],
  triggers: [
    {
      id: "CCCC0001",
      name: "Spawn On Bookmark",
      events: [call(F.cutsceneBookmarkFired, { cutscene: any, bookmark: { kind: "string", value: "Spawn \"It\"" } })],
      conditions: [],
      actions: [call(F.cutsceneStop, { cutscene: { kind: "call", call: call(F.eventCutsceneId, {}) } })],
    },
    {
      id: "CCCC0002",
      name: "Clean Up On End",
      events: [call(F.cutsceneEndSceneFired, { cutscene: any })],
      conditions: [],
      actions: [],
    },
  ],
};

describe("cutscene events", () => {
  const script = writeMapScript({ mapName: "CutsceneEvents", triggers: doc });
  const xml = writeTriggersXml(doc);

  it("registers a bookmark by name, quoting it, on any cutscene", () => {
    expect(script).toContain('TriggerAddEventCutsceneBookmarkFired(gt_SpawnOnBookmark, c_cutsceneNone, "Spawn \\"It\\"");');
  });

  it("registers the End Scene event on any cutscene", () => {
    expect(script).toContain("TriggerAddEventCutsceneEndSceneFired(gt_CleanUpOnEnd, c_cutsceneNone);");
  });

  it("reads the triggering cutscene in an action", () => {
    expect(script).toContain("CutsceneStop(EventCutsceneId());");
  });

  it("writes the events' and the response's function ids, and the bookmark's name as its Value", () => {
    expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="22F7DAC6"/>');
    expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="2C194B61"/>');
    expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="798AC00C"/>');
    expect(xml).toContain('<Value>Spawn "It"</Value>\r\n        <ValueType Type="string"/>');
  });

  it("still writes an empty string without a Value", () => {
    const empty = writeTriggersXml({ variables: [], triggers: [{ ...doc.triggers[0]!, events: [call(F.cutsceneBookmarkFired, { cutscene: any, bookmark: { kind: "string", value: "" } })] }] });
    expect(empty).not.toContain("<Value></Value>");
    expect(empty).toContain('<ValueType Type="string"/>');
  });
});
