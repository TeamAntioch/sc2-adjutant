// The compile names a global as the Editor's save does, so a save doesn't rename it (#902).
import { describe, expect, it } from "vitest";

import { NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import { call, triggerVariable } from "../../src/triggers/trigger-builders.js";
import type { TriggerDocument } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

describe("a compiled global's script name", () => {
  it("starts lower case, as the Editor writes it, in its declaration, its InitGlobals line and a trigger that uses it", () => {
    const on = triggerVariable("on", "Waveraid On", "bool", { kind: "bool", value: true });
    const doc: TriggerDocument = {
      variables: [on],
      triggers: [{ id: "AAAA2000", name: "Raid Off", events: [], actions: [call("off", F.setVariable, { variable: { kind: "variable", variable: on }, value: { kind: "bool", value: false } })] }],
    };

    const script = writeMapScript({ mapName: "Names", triggers: doc });

    expect(script).toContain("bool gv_waveraidOn;");
    expect(script).toContain("    gv_waveraidOn = true;");
    expect(script).toContain("    gv_waveraidOn = false;");
    expect(script).not.toMatch(/gv_[A-Z]/);
  });
});
