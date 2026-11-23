// Actor events on a unit in a trigger scene: the `cinematic` fixture Workspace's Radio Field plays a
// scene 2 of one line as the trigger scene `landing` when Nova reaches the field. On the line a live
// pillar is sent actor messages at the cut: a model swap and a signal, which it keeps, and a flash,
// which plays once. Both paths, watched and skipped, end with the pillar swapped and signalled; the
// flash is never replayed. The compiled map's MapScript.galaxy and Triggers are read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n");
const LINE = "radio_field-2-1";

const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "field",
  kind: "camera",
  position: { x, y },
  cameraTarget: { x, y },
  cameraValues: [{ index: "Distance", value: 30 }],
});
const point = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "point", position: { x, y, z: 0 } });
const unit = (id: string, x: number, y: number, player = 1) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player, position: { x, y, z: 0 }, rotation: 0 });

/** A held wide, then a cut on the line where the pillar is swapped, signalled and flashed. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    {
      camera: "cam-goal",
      line: LINE,
      actorEvents: [{ unit: "pillar", messages: ["ModelSwap PillarWhole 0", "Signal GlyphsOn"], effects: ["Create EnergyStreaks"] }],
    },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("beacon", 40, 40), unit("nova", 10, 10), unit("pillar", 40, 42, 2)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const PILLAR = stableObjectId("pillar");
const SENT = "gv_trigger_scene_landing_actor_event_2_1";
const send = (message: string): string => `libNtve_gf_SendActorMessageToUnit(UnitFromId(${PILLAR}), "${message}");`;

describe("an actor event on a unit", () => {
  it("sends its messages, then its effects, to the unit's actor at the shot's cut, and records that it was sent", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(
      lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, send("ModelSwap PillarWhole 0"), send("Signal GlyphsOn"), send("Create EnergyStreaks"), `${SENT} = true;`),
    );
    expect(cinematic.indexOf(send("Create EnergyStreaks"))).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
  });
});

describe("an actor event, skipped before", () => {
  it("has the Cleanup send its lasting messages, not its effects, if it wasn't sent and the unit is alive", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(
      lines(`if ((${SENT} == false)) {`, `    if ((UnitIsAlive(UnitFromId(${PILLAR})) == true)) {`, `        ${send("ModelSwap PillarWhole 0")}`, `        ${send("Signal GlyphsOn")}`, "    }", "", "}"),
    );
    expect(cleanup).not.toContain("Create EnergyStreaks");
    // Under black, on both paths: before the handback's branches.
    expect(cleanup.indexOf(send("Signal GlyphsOn"))).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("is sent again in the order the scene sends them, so the last message for a unit wins", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].actorEvents = [
          { unit: "pillar", atMs: 500, messages: ["ModelSwap PillarLit 0"] },
          { unit: "pillar", messages: ["ModelSwap PillarWhole 0"] },
        ];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf("ModelSwap PillarWhole 0")).toBeGreaterThan(-1);
    expect(cleanup.indexOf("ModelSwap PillarWhole 0")).toBeLessThan(cleanup.indexOf("ModelSwap PillarLit 0"));
  });

  it("is sent again after a skip on the scene's second run too: Setup clears the record, before the skip's branch", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup.indexOf(`${SENT} = false;`)).toBeGreaterThan(-1);
    expect(setup.indexOf(`${SENT} = false;`)).toBeLessThan(setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))"));
  });

  it("adds nothing to the Cleanup, and no flag, when it has only effects", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ unit: "pillar", effects: ["Create EnergyStreaks"] }];
    });
    expect(script).not.toContain(SENT);
    expect(section(script, "TriggerSceneLandingCleanup")).not.toContain("SendActorMessageToUnit");
  });
});

describe("an actor event atMs into its shot", () => {
  const LATER = "gt_TriggerSceneLandingActorEventShot2Event1";

  it("is sent that long after the cut, on a thread of its own, while the shots still play", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].actorEvents[0].atMs = 800;
    });
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, `TriggerExecute(${LATER}, true, false);`));
    expect(cinematic).not.toContain("SendActorMessageToUnit");
    expect(section(script, LATER.slice(3))).toContain(
      lines("Wait(0.8, c_timeReal);", "if ((gv_trigger_scene_landing_playing == true)) {", `    ${send("ModelSwap PillarWhole 0")}`, `    ${send("Signal GlyphsOn")}`, `    ${send("Create EnergyStreaks")}`, `    ${SENT} = true;`, "}"),
    );
  });
});

describe("an actor event in the map's Triggers", () => {
  it("is Send Actor Message To Unit with the message as the Editor writes one", async () => {
    const { root, blueprintPath } = await workspace();
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const triggers = await readFile(path.join(map, "Triggers"), "utf8");
    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="E1552C18"/>');
    expect(triggers).toMatch(/<ParameterDef Type="ParamDef" Library="Ntve" Id="8FF77F87"\/>\s*<Value>Signal GlyphsOn<\/Value>\s*<ValueType Type="actormsg"\/>/);
    expect(triggers).toMatch(/<ParameterDef Type="ParamDef" Library="Ntve" Id="5A8D5B9F"\/>\s*<ValueType Type="unit"\/>\s*<ValueId Id="\d+"\/>/);
  });
});

describe("actor events, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the fixture Cinematic's, and not the cinematography checks'
    // findings on its framing and timing (trigger-scene-checks.test.ts covers those).
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });

  it("reports an event on a unit that isn't a unit Anchor, or after the unit warps out", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[0].warpOuts = [{ units: ["nova"] }];
      scene.shots[1].actorEvents = [{ unit: "beacon", messages: ["Signal On"] }, { unit: "nova", effects: ["Create Flash"] }];
    });
    expect(found).toContain("shots.1.actorEvents.0.unit: beacon is a point Anchor, not a unit");
    expect(found).toContain("shots.1.actorEvents.1.unit: nova has warped out by then (shots.0.warpOuts.0)");
  });

  it("reports an event with nothing to send, and a message the Editor would have to escape", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ unit: "pillar" }, { unit: "pillar", messages: ['Signal "On"'] }, { unit: "pillar", effects: ["Signal On "] }];
    });
    expect(found).toContain("shots.1.actorEvents.2.effects.0: An actor message has no space at either end");
    expect(found).toContain("shots.1.actorEvents.0: An actor event sends messages, effects or both: give one");
    expect(found).toContain('shots.1.actorEvents.1.messages.0: An actor message is one line with no ", \\, <, > or &');
  });

  it("reports an event atMs at or past its shot's end, and the compile refuses it", async () => {
    const late = (_blueprint: any, scene: any): void => {
      scene.shots[1].actorEvents[0].atMs = 99000;
    };
    expect(await messages(late)).toEqual([expect.stringMatching(/^shots\.1\.actorEvents\.0\.atMs: 99000 ms into the shot is at or past its end, at \d+ ms; give it in the shot it falls in$/)]);
    await expect(compiled(late)).rejects.toThrow(/shots\.1\.actorEvents\.0\.atMs: 99000 ms into the shot is at or past its end/);
  });
});
