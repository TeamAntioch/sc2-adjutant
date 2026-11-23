// Schedules as Mechanics give them (ADR-0006): what the checker refuses in one.
import { describe, expect, it } from "vitest";

import type { MissionBlueprint } from "../../src/domain/mission-blueprint.js";
import type { Schedule } from "../../src/domain/schedule.js";
import { scheduleProblems } from "../../src/layout/schedules.js";

const blueprint = { beats: [{ id: "land" }, { id: "dig" }, { id: "flee" }], mechanics: [] } as unknown as MissionBlueprint;
const problems = (schedule: Schedule) => scheduleProblems(blueprint, schedule);

describe("scheduleProblems", () => {
  it("accepts a schedule that ends after it starts", () => {
    expect(problems({ kind: "from-beat", beatId: "dig", untilBeatId: "flee" })).toEqual([]);
    expect(problems({ kind: "cycle", firstSeconds: 10, untilBeatId: "dig" })).toEqual([]);
  });

  it("refuses a schedule that ends at or before the beat it starts at", () => {
    expect(problems({ kind: "from-beat", beatId: "flee", untilBeatId: "dig" })).toEqual(["untilBeatId dig doesn't come after the Beat it starts from"]);
    expect(problems({ kind: "cycle", fromBeatId: "dig", untilBeatId: "dig", firstSeconds: 0 })).toHaveLength(1);
  });

  it("names unknown beats rather than judging their order", () => {
    expect(problems({ kind: "from-beat", beatId: "nap", untilBeatId: "land" })).toEqual(["unknown beat id nap"]);
  });
});
