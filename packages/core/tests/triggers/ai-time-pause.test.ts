import { describe, expect, it } from "vitest";

import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, type PresetDef } from "../../src/triggers/trigger-catalog.js";
import type { TriggerCall, TriggerDocument, TriggerVariable } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const pauseAI = (id: string, preset: PresetDef): TriggerCall => ({ id, def: F.aiTimePause, params: { pause: { id: `${id.slice(0, 7)}P`, value: { kind: "preset", preset } } } });

const wasPaused: TriggerVariable = { id: "BBBB0003", name: "ai_was_paused", type: "bool", initial: { id: "BBBB0004", value: { kind: "bool", value: false } } };
const saveState: TriggerCall = {
  id: "BBBB0005",
  def: F.setVariable,
  params: {
    variable: { id: "BBBB0006", value: { kind: "variable", variable: wasPaused } },
    value: { id: "BBBB0007", value: { kind: "call", call: { id: "BBBB0008", def: F.aiTimeIsPaused, params: {} } } },
  },
};

const doc: TriggerDocument = {
  variables: [wasPaused],
  triggers: [
    {
      id: "BBBB0001",
      name: "Scene",
      events: [{ id: "BBBB0002", def: F.mapInit, params: {} }],
      actions: [saveState, pauseAI("BBBB0010", P.pause), pauseAI("BBBB0020", P.unpause)],
    },
  ],
};

describe("Pause AI Time", () => {
  it("saves whether AI time was paused, then pauses and unpauses it, in the script the game runs", () => {
    const script = writeMapScript({ mapName: "Scene", triggers: doc });
    expect(script).toContain("    gv_ai_was_paused = AITimeIsPaused();\r\n    AITimePause(true);\r\n    AITimePause(false);");
  });

  it("is NativeLib's Pause AI Time in the Editor, with its Pause/Unpause presets", () => {
    const xml = writeTriggersXml(doc);
    expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="BC622053"/>');
    expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="D59E1980"/>');
    expect(xml).toContain('<ParameterDef Type="ParamDef" Library="Ntve" Id="90FC545F"/>');
    expect(xml).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000115"/>');
    expect(xml).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000116"/>');
  });
});
