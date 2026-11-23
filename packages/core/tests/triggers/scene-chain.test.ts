// The Scene Chain (ADR 0012), through its interface: which scenes hand on, hand back or take over on a
// cue's run, and the victory outro rules, on hand-made cues and trigger scenes, without the builder.
import { describe, expect, it } from "vitest";

import type { Cue, MissionBlueprint } from "../../src/domain/mission-blueprint.js";
import { cuePath } from "../../src/triggers/cue-triggers.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript } from "../support/workspaces.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { cueRuns, requireLoaded, sceneChain, sceneStraightAfter, sceneStraightBefore } from "../../src/triggers/scene-chain.js";

type Entry = { cue: Cue; scene: number; afterSeconds?: number; after?: { scene: number } };

const START: Cue = { type: "missionStart" };
const WINS: Cue = { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" };

function chainOf(cues: Entry[], triggerScenes: { id: string; scene?: number; outcome?: "victory" }[] = [], victory: Cue[] = [], outros: string[] = []) {
  const blueprint = {
    outcomes: { victory, defeat: [] },
    screenplay: { script: { cues, triggerScenes } },
  } as unknown as MissionBlueprint;
  const timed = new Map(triggerScenes.map(({ id }) => [id, { triggerScene: outros.includes(id) ? { outro: "victory" } : {} }]));
  const chain = sceneChain(blueprint);
  // The legality rules, in the order the compile runs them.
  chain.assertOutros(timed);
  chain.assertOutcomeOutro(timed);
  return chain;
}

describe("cueRuns", () => {
  it("keys each cue's undelayed entries in cue order, marking those behind another", () => {
    const runs = cueRuns([
      { cue: START, scene: 1 },
      { cue: START, scene: 2, after: { scene: 1 } as never },
      { cue: START, scene: 3, afterSeconds: 5 },
    ]);
    expect([...runs.keys()]).toEqual(["missionStart"]);
    expect(runs.get("missionStart")!.entries).toEqual([
      { scene: 1, behind: false },
      { scene: 2, behind: true },
    ]);
  });

  it("finds the scene straight before and after an entry, none beside one behind another", () => {
    const entries = [
      { scene: 1, behind: false },
      { scene: 2, behind: false },
      { scene: 3, behind: true },
    ];
    expect(sceneStraightAfter(entries, 0)).toBe(2);
    expect(sceneStraightBefore(entries, 1)).toBe(1);
    expect(sceneStraightAfter(entries, 1)).toBeUndefined();
    expect(sceneStraightBefore(entries, 0)).toBeUndefined();
  });
});

describe("sceneChain roles", () => {
  const chain = chainOf(
    [
      { cue: START, scene: 1 },
      { cue: START, scene: 2 },
      { cue: START, scene: 3 },
    ],
    [
      { id: "b", scene: 2 },
      { id: "c", scene: 3 },
    ],
  );

  it("hands a scene on to the trigger scene straight after it", () => {
    expect(chain.handsOn(1)).toBe(true);
    expect(chain.handsOn(2)).toBe(true);
    expect(chain.handsOn(3)).toBe(false);
  });

  it("hands back from the last scene of a run only", () => {
    expect(chain.role(1)).toEqual({ handsOn: true, handsBack: false, takesOver: false });
    expect(chain.role(3)).toEqual({ handsOn: false, handsBack: true, takesOver: true });
  });

  it("takes over a trigger scene after a trigger scene", () => {
    expect(chain.role(3).takesOver).toBe(true);
    expect(chain.role(2).takesOver).toBe(false);
  });

  it("hands back a scene played alone, delayed or after another", () => {
    const alone = chainOf(
      [
        { cue: START, scene: 1 },
        { cue: START, scene: 2, afterSeconds: 3 },
        { cue: START, scene: 3, after: { scene: 1 } },
      ],
      [{ id: "b", scene: 2 }],
    );
    expect(alone.handsOn(1)).toBe(false);
    expect(alone.role(2).handsBack).toBe(true);
    expect(alone.role(3).handsBack).toBe(true);
  });
});

describe("sceneChain victory outro", () => {
  const victory = [WINS];

  it("appends the outcome's outro to each victory condition's run", () => {
    const chain = chainOf([{ cue: WINS, scene: 4 }], [{ id: "t", scene: 4 }, { id: "o", outcome: "victory" }], victory, ["o"]);
    // The outro ends the run: scene 4 hands on to it, and it takes over from scene 4.
    expect(chain.role(0)).toEqual({ handsOn: false, handsBack: true, takesOver: true });
    expect(chain.listed).toEqual([
      { id: "t", scene: 4 },
      { id: "o", scene: 0 },
    ]);
    expect(chain.handsOn(4)).toBe(true);
  });

  it("lists the outros by scene number", () => {
    const chain = chainOf([{ cue: WINS, scene: 4 }], [{ id: "o", scene: 4 }], victory, ["o"]);
    expect([...chain.outros(new Map([["o", { triggerScene: { outro: "victory" } }]]))]).toEqual([4]);
  });

  it("refuses a second outro beside the outcome's", () => {
    expect(() => chainOf([{ cue: WINS, scene: 4 }], [{ id: "o", scene: 4 }, { id: "v", outcome: "victory" }], victory, ["o", "v"])).toThrow(
      "Trigger scene v plays on the victory outcome, last on every victory condition, so scene 4's victory outro (o) can't end the game too: list one victory outro",
    );
  });

  it("refuses an outcome scene that isn't an outro", () => {
    expect(() => chainOf([], [{ id: "v", outcome: "victory" }], victory)).toThrow('Trigger scene v plays on the victory outcome, so it is a victory outro: give it outro "victory"');
  });

  it("keeps the outcome scene's missing outro apart from the outros' rules, for the caller to run where it needs", () => {
    const blueprint = { outcomes: { victory, defeat: [] }, screenplay: { script: { cues: [], triggerScenes: [{ id: "v", outcome: "victory" }] } } } as unknown as MissionBlueprint;
    const timed = new Map([["v", { triggerScene: {} }]]);
    const chain = sceneChain(blueprint);
    expect(() => chain.assertOutros(timed)).not.toThrow();
    expect(() => chain.assertOutcomeOutro(timed)).toThrow('give it outro "victory"');
  });

  it("says a trigger scene wasn't loaded, rather than failing on it", () => {
    const blueprint = { outcomes: { victory, defeat: [] }, screenplay: { script: { cues: [], triggerScenes: [{ id: "v", scene: 2 }] } } } as unknown as MissionBlueprint;
    const message = "The trigger scene v wasn't loaded; pass the Mission's timed trigger scenes to buildMissionTriggers";
    expect(() => requireLoaded(blueprint, new Map())).toThrow(message);
    expect(() => sceneChain(blueprint).outros(new Map())).toThrow(message);
  });

  it("refuses a delayed outro", () => {
    expect(() => chainOf([{ cue: WINS, scene: 4, afterSeconds: 2 }], [{ id: "o", scene: 4 }], victory, ["o"])).toThrow("so its cue plays it with no delay: drop the afterSeconds");
  });

  it("refuses an outro cued off a victory condition", () => {
    expect(() => chainOf([{ cue: START, scene: 4 }], [{ id: "o", scene: 4 }], victory, ["o"])).toThrow("and its missionStart cue isn't one: cue it on one of the Blueprint's victory outcomes");
  });

  it("refuses an outro with a scene playing after it", () => {
    expect(() =>
      chainOf(
        [
          { cue: WINS, scene: 4 },
          { cue: WINS, scene: 5 },
        ],
        [{ id: "o", scene: 4 }],
        victory,
        ["o"],
      ),
    ).toThrow(`so it plays last on its ${cuePath(WINS)} cue: scene 5 plays after it`);
  });
});

describe("the compile's order of problems", () => {
  // Ashen Crossing's victory is Zeratul reaching the temple gate, where scene 3 plays. List a scene by the
  // victory outcome that is no outro, and cue a scene on scene 3 having played, which never fires.
  const raw = structuredClone(crossingRaw) as any;
  raw.screenplay.script.triggerScenes = [{ id: "closing", outcome: "victory" }];
  const cues = (extra: unknown[]) => ({ ...raw, screenplay: { ...raw.screenplay, script: { ...raw.screenplay.script, cues: [...raw.screenplay.script.cues, ...extra] } } });
  const closing = { id: "closing", scene: 0, triggerScene: {}, shots: [] } as never;
  const compile = (extra: unknown[]) => () => buildMissionTriggers(CrossingBlueprintSchema.parse(cues(extra)), { script: crossingScript, triggerScenes: [closing] });

  it("reports a scenePlayed cue that never fires before the outcome scene's missing outro", () => {
    expect(compile([{ scene: 2, cue: { type: "scenePlayed", scene: 3 } }])).toThrow("Scene 3 plays only on a condition that ends the game, so a scenePlayed cue on it would never fire");
  });

  it("reports the missing outro once nothing before it is wrong", () => {
    expect(compile([])).toThrow('Trigger scene closing plays on the victory outcome, so it is a victory outro: give it outro "victory"');
  });
});
