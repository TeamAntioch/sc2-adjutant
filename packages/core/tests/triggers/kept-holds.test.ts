// Holding a Kept trigger back (ADR-0014), on a synthetic Kept Triggers and MapScript.galaxy pair as
// the compile writes them: "Opening" starts at map initialization and runs "Stealth", which
// "Retry" runs too.
import { describe, expect, it } from "vitest";

import { applyKeptHolds, type KeptHoldEntry } from "../../src/triggers/kept-holds.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { call, debugMessage, runTrigger } from "../../src/triggers/trigger-builders.js";
import { CORE_PRIMITIVES, NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import type { Trigger, TriggerDocument } from "../../src/triggers/trigger-model.js";
import { elementOf, readTriggersFile } from "../../src/triggers/triggers-file.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const stealthRef = { id: "0000A002", name: "Stealth" };
const opening: Trigger = {
  id: "0000A001",
  name: "Opening",
  events: [call("opening/event", F.mapInit, {})],
  actions: [debugMessage("opening/hello", "Hello"), runTrigger("opening/run", stealthRef, { checkConditions: false }), debugMessage("opening/after", "After")],
};
const stealth: Trigger = { id: stealthRef.id, name: "Stealth", events: [], actions: [debugMessage("stealth/sneak", "Sneak")] };
const retry: Trigger = { id: "0000A003", name: "Retry", events: [], actions: [runTrigger("retry/run", stealthRef)] };
const kept: TriggerDocument = { variables: [], triggers: [opening, stealth, retry] };
const triggers = writeTriggersXml(kept);
const script = writeMapScript({ mapName: "Harbour", triggers: kept });
const names = new Map(kept.triggers.map((trigger) => [`Trigger/${trigger.id}`, trigger.name]));

const held = { id: stealth.id, name: "Stealth", scriptName: "gt_Stealth" };
const from = { id: opening.id, name: "Opening", scriptName: "gt_Opening" };
const runId = opening.actions[1]!.id;
const eventId = opening.events[0]!.id;

// Opening's two debug messages, around its Run Trigger.
const [hello, after] = /^(    TriggerDebugOutput[^\r]*)\r\n    TriggerExecute\(gt_Stealth, false, false\);\r\n(    TriggerDebugOutput[^\r]*)\r$/m.exec(script)!.slice(1) as [string, string];

const disabled = (xml: string, id: string): boolean => elementOf(readTriggersFile(xml), "FunctionCall", id)!.children.some((node) => node.tag === "Disabled");

describe("holding a Kept trigger's Run Trigger in another Kept trigger", () => {
  it("switches the call off in Triggers and takes its line out of the caller's Galaxy, leaving Retry's", () => {
    const result = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);

    expect(disabled(result.triggers, runId)).toBe(true);
    expect(result.triggers.replace(/        <Disabled\/>\r\n/, "")).toBe(triggers);
    expect(result.script).toContain(`${hello}\r\n${after}\r\n`);
    expect(result.script).not.toContain("TriggerExecute(gt_Stealth, false, false);");
    expect(result.script).toContain("TriggerExecute(gt_Stealth, true, false);");
    expect(result.entries).toEqual([
      {
        kind: "kept-hold",
        id: runId,
        trigger: opening.id,
        script: "gt_Opening",
        line: "    TriggerExecute(gt_Stealth, false, false);",
        gap: [hello, after],
      },
    ]);
    expect(result.notes).toEqual([`Held Stealth: switched off its Run Trigger in Opening (${runId}); its cue runs it now`, "Stealth is also run by Retry, which its hold leaves as it is"]);
  });

  it("leaves Opening's Galaxy as the Editor writes it for the triggers with the call disabled", () => {
    const result = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);
    const span = keptElementSpan(result.script, "gt_Opening")!;
    const rendered = new KeptGalaxyRenderer(readTriggersFile(result.triggers), names, CORE_PRIMITIVES).renderTrigger(opening.id);

    expect(rendered?.replace(/\r?\n/g, "\r\n")).toBe(result.script.slice(span.start, span.end));
  });

  it("changes nothing more on the next compile, and keeps the call on the record", () => {
    const first = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);
    const again = applyKeptHolds(first.triggers, first.script, names, [{ trigger: held, from }], first.entries);

    expect(again.triggers).toBe(first.triggers);
    expect(again.script).toBe(first.script);
    expect(again.entries).toEqual(first.entries);
  });

  it("switches it back on, line and all, once no hold keeps it", () => {
    const first = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);
    const released = applyKeptHolds(first.triggers, first.script, names, [], first.entries);

    expect(released.triggers).toBe(triggers);
    expect(released.script).toBe(script);
    expect(released.entries).toEqual([]);
    expect(released.notes).toEqual([`Switched Opening's call ${runId} back on, as no hold keeps it now`]);
  });

  it("leaves a call the author switched back on in the Editor, and switches it off again while the hold stays", () => {
    const first = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);

    expect(applyKeptHolds(triggers, script, names, [], first.entries).triggers).toBe(triggers);
    expect(disabled(applyKeptHolds(triggers, script, names, [{ trigger: held, from }], first.entries).triggers, runId)).toBe(true);
  });

  it("refuses to put a line back where the script around it has changed", () => {
    const first = applyKeptHolds(triggers, script, names, [{ trigger: held, from }], []);
    const edited = first.script.replace(after, "    Wait(1.0, c_timeGame);");

    expect(() => applyKeptHolds(first.triggers, edited, names, [], first.entries)).toThrow(/turn the call on in the Editor and save the map there/);
  });

  it("refuses a caller that doesn't run it, and a script that isn't what the Editor writes for the caller", () => {
    expect(() => applyKeptHolds(triggers, script, names, [{ trigger: held, from: { id: stealth.id, name: "Stealth", scriptName: "gt_Stealth" } }], [])).toThrow("Stealth has no Run Trigger of Stealth");
    const unsaved = script.replace("    TriggerExecute(gt_Stealth, false, false);\r\n", "");
    expect(() => applyKeptHolds(triggers, unsaved, names, [{ trigger: held, from }], [])).toThrow(/has 0 Run Trigger of Stealth where Triggers has 1/);
  });

  it("holds it as before in an older map, whose later Variables share the held trigger's and the call's Ids", () => {
    // thanson01's GameOver (Variable 00000029), at each Id, after every element: an Editor that numbers each type apart saves such a file.
    const variable = (id: string): string => `    <Element Type="Variable" Id="${id}">\r\n        <VariableType>\r\n            <Type Value="bool"/>\r\n        </VariableType>\r\n    </Element>\r\n`;
    const older = triggers.replace("</TriggerData>", `${variable(stealth.id)}${variable(runId)}</TriggerData>`);

    const result = applyKeptHolds(older, script, names, [{ trigger: held, from }], []);

    expect(disabled(result.triggers, runId)).toBe(true);
    expect(result.script).not.toContain("TriggerExecute(gt_Stealth, false, false);");
    expect(applyKeptHolds(result.triggers, result.script, names, [], result.entries).triggers).toBe(older);
  });
});

describe("holding a Kept trigger's own Map Initialization event", () => {
  const openingHeld = { id: opening.id, name: "Opening", scriptName: "gt_Opening" };

  it("switches the event off and takes it out of the trigger's _Init, then puts it back", () => {
    const result = applyKeptHolds(triggers, script, names, [{ trigger: openingHeld }], []);

    expect(disabled(result.triggers, eventId)).toBe(true);
    expect(result.script).not.toContain("TriggerAddEventMapInit(gt_Opening);");
    expect(result.script).toContain('    gt_Opening = TriggerCreate("gt_Opening_Func");\r\n}');
    expect(result.entries[0]).toMatchObject({ id: eventId, trigger: opening.id, line: "    TriggerAddEventMapInit(gt_Opening);" } satisfies Partial<KeptHoldEntry>);

    const released = applyKeptHolds(result.triggers, result.script, names, [], result.entries);
    expect(released.triggers).toBe(triggers);
    expect(released.script).toBe(script);
  });

  it("refuses a trigger with no Map Initialization event, or with another event", () => {
    expect(() => applyKeptHolds(triggers, script, names, [{ trigger: held }], [])).toThrow("Stealth has no Map Initialization event to hold");
    const entering: TriggerDocument = { variables: [], triggers: [{ ...opening, events: [...opening.events, call("opening/dies", F.unitDies, { unit: { kind: "preset", preset: { library: "Ntve", id: "00000000", galaxy: "null" } } })] }, stealth] };
    expect(() => applyKeptHolds(writeTriggersXml(entering), writeMapScript({ mapName: "Harbour", triggers: entering }), names, [{ trigger: openingHeld }], [])).toThrow(/starts on an event other than Map Initialization/);
  });
});
