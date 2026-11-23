// A staged unit as a line's speaker, and actor events on the staged cast: the `cinematic` fixture
// Workspace's Radio Field plays a scene 2 of two lines as the trigger scene `landing` when Nova
// reaches the field. The scene stages a relay (`relay`) and maps the ORACLE speaker to it, so the
// Oracle's line plays from the relay, which flares on the line with an effect. Nova's line keeps her
// own source. The compiled map's MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", "**ORACLE** `D-01-01-02-002-ORACLE`: The field remembers you.", ""].join("\n");
const NOVA_LINE = "radio_field-2-1";
const ORACLE_LINE = "radio_field-2-2";

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

/** Nova's line on a wide, then a cut to the relay on the Oracle's, which it speaks and flares on. */
const SCENE = {
  cast: [{ id: "relay", unitType: "Marine", player: 0, at: "relay-spot" }],
  speakers: { ORACLE: "relay" },
  shots: [
    { camera: "cam-wide", line: NOVA_LINE },
    { camera: "cam-goal", line: ORACLE_LINE, actorEvents: [{ cast: "relay", effects: ["Signal Flare"] }] },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("relay-spot", 40, 40), unit("nova", 10, 10)];
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
const RELAY = "gv_trigger_scene_landing_cast_relay";
const FROM_RELAY = `TransmissionSourceFromUnit(UnitGroupUnit(${RELAY}, 1), true, false, "Talk")`;
/** The trigger's `nth` Transmission statement. */
const transmissionOf = (cinematic: string, nth: number): string => cinematic.split("\r\n").filter((statement) => statement.includes("TransmissionSendForPlayerSelect("))[nth]!;

describe("a staged unit as a line's speaker", () => {
  it("plays that speaker's lines from the first staged unit of its cast group, with its flash, portrait left", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    const oracle = transmissionOf(cinematic, 1);
    expect(oracle).toContain(FROM_RELAY);
    expect(oracle).toContain("libNtve_gf_CinematicPortrait(libNtve_ge_CinematicPortraitPosition_CenterLeft)");
  });

  it("leaves every other speaker's lines as they were", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(transmissionOf(cinematic, 0)).not.toContain(RELAY);
  });

  it("matches the speaker as the Blueprint's speakerAnchors do, by name whatever its case", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.speakers = { Oracle: "relay" };
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(transmissionOf(cinematic, 1)).toContain(FROM_RELAY);
  });
});

describe("an actor event on the staged cast", () => {
  it("sends its effects to every unit of the cast group at the shot's cut, before the shot's lines", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(cinematic).toMatch(new RegExp(`(auto\\w+)_g = ${RELAY};[\\s\\S]*?libNtve_gf_SendActorMessageToUnit\\(\\1_var, "Signal Flare"\\);`));
    expect(cinematic.indexOf('"Signal Flare"')).toBeLessThan(cinematic.indexOf(FROM_RELAY));
  });

  it("adds nothing to the Cleanup, which removes the cast", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).not.toContain("Signal Flare");
  });

  it("is sent atMs after the cut on a thread of its own, while the shots still play", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].actorEvents[0].atMs = 500;
    });
    const later = section(script, "TriggerSceneLandingActorEventShot2Event1");
    expect(later).toContain("Wait(0.5, c_timeReal);");
    expect(later).toContain("if ((gv_trigger_scene_landing_playing == true)) {");
    expect(later).toMatch(new RegExp(`(auto\\w+)_g = ${RELAY};[\\s\\S]*?libNtve_gf_SendActorMessageToUnit\\(\\1_var, "Signal Flare"\\);`));
  });
});

describe("a player's army warping out, with a staged unit of that player's", () => {
  it("leaves the staged cast out, as the scene's own: it goes by a withdraw or the Cleanup", async () => {
    const warpOut = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].warpOuts = [{ player: 0 }];
      }),
      "TriggerSceneLandingWarpOutShot1WarpOut1",
    );
    const held = "gv_trigger_scene_landing_warp_out_1_1";
    expect(warpOut.indexOf(`UnitGroupAddUnitGroup(${held}, UnitGroup(null, 0,`)).toBeGreaterThan(-1);
    expect(warpOut.indexOf(`UnitGroupRemoveUnitGroup(${held}, ${RELAY});`)).toBeGreaterThan(warpOut.indexOf(`UnitGroupAddUnitGroup(${held}, UnitGroup(null, 0,`));
    expect(warpOut.indexOf(`UnitGroupRemoveUnitGroup(${held}, ${RELAY});`)).toBeLessThan(warpOut.indexOf("gv_trigger_scene_landing_warped_out_1_1 = true;"));
  });

  it("leaves out only a staged unit of the warping player's", async () => {
    const warpOut = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].warpOuts = [{ player: 2 }];
      }),
      "TriggerSceneLandingWarpOutShot1WarpOut1",
    );
    expect(warpOut).not.toContain(`UnitGroupRemoveUnitGroup(gv_trigger_scene_landing_warp_out_1_1, ${RELAY});`);
  });
});

describe("cast speakers and cast actor events, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the fixture Cinematic's, and not the cinematography checks'.
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });

  it("reports a speaker with no line in the scene's shots, and one mapped to a staged unit the cast hasn't", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.speakers = { ORACLE: "beacon", ZERATUL: "relay" };
    });
    expect(found).toContain("speakers.ORACLE: No staged unit beacon in the scene's cast");
    expect(found).toContain("speakers.ZERATUL: ZERATUL speaks no line in scene 2's shots");
  });

  it("reports one speaker given twice, by names that differ only in case or spacing", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.speakers = { ORACLE: "relay", Oracle: "relay" };
    });
    expect(found).toEqual(["speakers.Oracle: Oracle and ORACLE are one speaker; give it once"]);
  });

  it("reports a speaker whose line plays after the handback, once the cast is removed", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots = [{ camera: "cam-wide", line: NOVA_LINE }];
      scene.handback = { linesFrom: ORACLE_LINE };
    });
    expect(found).toContain(`speakers.ORACLE: ${ORACLE_LINE} plays after the handback (handback.linesFrom), once the Cleanup has removed the staged cast, so relay can't speak it`);
  });

  it("reports an actor event to a staged unit the cast hasn't", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ cast: "beacon", effects: ["Signal Flare"] }];
    });
    expect(found).toEqual(["shots.1.actorEvents.0.cast: No staged unit beacon in the scene's cast"]);
  });

  it("reports an actor event to both a staged unit and a live unit, or to neither", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ cast: "relay", unit: "nova", effects: ["Signal Flare"] }, { effects: ["Signal Flare"] }];
    });
    expect(found).toContain("shots.1.actorEvents.0: An actor event is to a staged unit (cast) or a live unit (unit): give one");
    expect(found).toContain("shots.1.actorEvents.1: An actor event is to a staged unit (cast) or a live unit (unit): give one");
  });

  it("reports lasting messages to the staged cast, which the Cleanup removes", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ cast: "relay", messages: ["Signal Flare"] }];
    });
    expect(found).toContain("shots.1.actorEvents.0.messages: The staged cast is removed in the Cleanup, so its actor events send effects only: move these to effects");
  });

  it("reports an actor event on a staged unit after it has withdrawn", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[0].orders = [{ cast: "relay", moveTo: "relay-spot", withdraw: true }];
    });
    expect(found).toEqual(["shots.1.actorEvents.0.cast: relay has withdrawn by then (shots.0.orders.0)"]);
  });

  it("reports a speaker's line in a shot after its staged unit has withdrawn, and the compile refuses it", async () => {
    const withdrawn = (_blueprint: any, scene: any): void => {
      scene.shots[0].orders = [{ cast: "relay", moveTo: "relay-spot", withdraw: true }];
      delete scene.shots[1].actorEvents;
    };
    expect(await messages(withdrawn)).toEqual([`speakers.ORACLE: relay withdraws in shot 1 (shots.0.orders.0), so it can't speak ${ORACLE_LINE}, in shot 2: it's removed on arriving, which may come while that shot's lines play`]);
    await expect(compiled(withdrawn)).rejects.toThrow(/speakers\.ORACLE: relay withdraws in shot 1/);
  });

  it("reports a speaker's line in the very shot whose order withdraws its staged unit, which may arrive mid-line", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].orders = [{ cast: "relay", moveTo: "relay-spot", withdraw: true, atMs: 500 }];
      delete scene.shots[1].actorEvents;
    });
    expect(found).toEqual([`speakers.ORACLE: relay withdraws in shot 2 (shots.1.orders.0), so it can't speak ${ORACLE_LINE}, in shot 2: it's removed on arriving, which may come while that shot's lines play`]);
  });

  it("passes an actor event on the staged unit at its withdrawing order's own moment", async () => {
    const found = await messages((_blueprint, scene) => {
      delete scene.speakers;
      scene.shots[1].orders = [{ cast: "relay", moveTo: "relay-spot", withdraw: true, atMs: 500 }];
      scene.shots[1].actorEvents[0].atMs = 500;
    });
    expect(found).toEqual([]);
  });

  it("refuses to compile a speaker mapped to a staged unit the cast hasn't", async () => {
    await expect(
      compiled((_blueprint, scene) => {
        scene.speakers = { ORACLE: "beacon" };
      }),
    ).rejects.toThrow(/speakers\.ORACLE: No staged unit beacon in the scene's cast/);
  });
});
