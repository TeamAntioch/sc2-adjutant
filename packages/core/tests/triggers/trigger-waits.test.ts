// `waits`: whether running some calls may hold up their trigger, which decides whether a Beat's
// pings need guarding against a later Beat starting meanwhile.
import { describe, expect, it } from "vitest";

import { call, ifTriggerOn, waits } from "../../src/triggers/trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "../../src/triggers/trigger-catalog.js";

const trigger = { kind: "trigger" as const, trigger: { id: "10000001", name: "Other" } };
const execute = (wait: boolean) =>
  call(`run/${wait}`, F.triggerExecute, { checkConditions: { kind: "preset", preset: P.checkConditions }, wait: { kind: "preset", preset: wait ? P.wait : P.dontWait }, trigger });

describe("waits", () => {
  it("is true of a Wait and of a call told to wait, however deep", () => {
    expect(waits([call("pause", F.wait, { time: { kind: "fixed", value: 2 }, timeType: { kind: "preset", preset: P.timeAI } })])).toBe(true);
    expect(waits([execute(true)])).toBe(true);
    expect(waits([ifTriggerOn("guard", trigger.trigger, [execute(true)])])).toBe(true);
  });

  it("is false of calls that run on at once, such as a trigger run without waiting", () => {
    expect(waits([])).toBe(false);
    expect(waits([execute(false)])).toBe(false);
    expect(waits([ifTriggerOn("guard", trigger.trigger, [execute(false)])])).toBe(false);
  });
});
