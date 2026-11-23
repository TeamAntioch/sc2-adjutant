// A set built by hand (no source file, Lights or marks) filmed by a test Cinematic: one its
// Blueprint doesn't list, compiled silent to judge the set's framing in game. Its cast moves along
// follow paths through a shot's steps, and a shot can start a member's animation part-way through, once.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileCinematicCutscene, compileShotCutscene } from "../../src/cutscene/compile-cutscene.js";
import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, copyOf, text } from "../mcp/harness.js";
import { apart, curveValue, engine, offTurn, own, times } from "../support/rotations.js";

const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
const MISSION = "missions/radio-field";

/** A test Cinematic of the fixture's built orbit set, placed 1000 cells north: a ship arrives in the first shot and leaves in the second. */
const orbitTest = () => ({
  sets: [{ id: "orbit", file: "sets/radio-orbit.json", offset: [0, 1000, 0] }],
  cast: [
    { id: "ship", model: "OrbitShip", set: "orbit", at: [0, -1, 0], facing: [0, 0, 90], teamColor: { diffuse: [0.2, 0.1, 0.8, 0.9] } },
    { id: "flash", model: "OrbitFlash", set: "orbit", at: [0, 5, 0] },
  ],
  shots: [
    {
      camera: "orbit/Arrival",
      afterMs: 0,
      pauseAfterMs: 9000,
      moves: { ship: [{ to: [0, 5, 0], afterMs: 1500, ms: 500 }, { to: [0, 8, 0], move: "linear" }] },
      anims: { flash: { anim: "Birth", atMs: 1500, once: true } },
    },
    { camera: "orbit/Departure", afterMs: 0, pauseAfterMs: 6000, hide: ["flash"], moves: { ship: [{ to: [0, 60, -30], facing: [30, 0, 90] }] } },
  ],
});

/** The fixture with `cinematic` written as cinematics/<id>.json (unlisted) and its Blueprint edited, compiled into a fresh map. */
async function withTest(cinematic: unknown, { id = "test-orbit", blueprint, set }: { id?: string; blueprint?: (blueprint: any) => void; set?: (set: any) => void } = {}) {
  const root = await copyOf("cinematic");
  if (set) {
    const setFile = path.join(root, MISSION, "sets", "radio-orbit.json");
    const parsed = JSON.parse(await readFile(setFile, "utf8"));
    set(parsed);
    await writeFile(setFile, JSON.stringify(parsed));
  }
  await writeFile(path.join(root, MISSION, "cinematics", `${id}.json`), JSON.stringify(cinematic));
  const blueprintPath = path.join(root, MISSION, "blueprint.json");
  if (blueprint) {
    const parsed = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint(parsed);
    await writeFile(blueprintPath, JSON.stringify(parsed));
  }
  const workspace = await loadWorkspace(root);
  const map = path.join(root, MISSION, "Radio-Field.SC2Map");
  await compileMission(workspace, blueprintPath, map);
  return { root, workspace, blueprintPath, map, id };
}

/** No cue plays a Cinematic at mission start, so a test can loop from map start on its own. */
const noStartCinematic = (blueprint: any) => {
  blueprint.screenplay.script.cues = [{ scene: 1, cue: { type: "anchorEntersZone", anchorId: "radio", zoneId: "field" } }];
  blueprint.anchors = [{ id: "radio", name: "Radio", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 32, y: 32, z: 0 }, rotation: 0 }];
};

async function compiledTest(cinematic: unknown, set?: (set: any) => void) {
  const { workspace, blueprintPath, map, id } = await withTest(cinematic, { blueprint: noStartCinematic, ...(set ? { set } : {}) });
  const result = await compileCinematicCutscene(workspace, blueprintPath, id, map);
  return { result, nodes: all(readCutscene(await readFile(result.file, "utf8"))) };
}

const actorNamed = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!;
const ties = (node: CutsceneNode) => node.children.filter((child) => child.tag === "CCutsceneNodeActiveShot").map((tie) => tie.attrs.cameraGUID);
/** Each animated property of a node: its keys' start, value and Bezier handles. */
const curvesOf = (node: CutsceneNode) =>
  Object.fromEntries(
    node.children
      .filter((child) => child.tag === "CCutsceneNodePropertyValue")
      .map((property) => [property.attrs.propertyName, property.children.map(({ attrs }) => [attrs.start ?? "0", attrs.value, attrs.curveInValue, attrs.curveOutValue])]),
  );
const at = (time: number, value: number) => `${time.toFixed(6)},${value.toFixed(6)}`;

describe("a test Cinematic of a built set", () => {
  it("compiles silent: no lines, no conversation, no Light the set doesn't name, its shots timed by their pauses", async () => {
    const { result, nodes } = await compiledTest(orbitTest());
    expect(result).toMatchObject({ shots: 2 });
    expect(path.basename(result.file)).toBe("test-orbit.SC2Cutscene");
    expect(nodes.some((node) => node.tag === "CCutsceneNodeConversationDriver" || node.tag === "CCutsceneNodeConversation")).toBe(false);
    expect(nodes.some((node) => node.tag === "CCutsceneNodeActiveLight")).toBe(false);
    // The fade in, 9 s and 6 s of shots, then the fade out and the black.
    expect(nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera").map(({ attrs }) => attrs.start ?? "0")).toEqual(["0", "10000"]);
    expect(nodes.find((node) => node.tag === "CCutsceneElementEndScene")!.attrs.start).toBe("19000");
  });

  it("copies each backdrop piece only into the shot through the camera it's tied to, and stands the rest of the set at the top level through every shot", async () => {
    const { nodes } = await compiledTest(orbitTest());
    const folders = nodes[0]!.children.filter((node) => node.tag === "CCutsceneNodeFolder");
    expect(folders.map((folder) => [folder.attrs.name, folder.children.map((child) => child.attrs.name)])).toEqual([
      ["Set", ["orbit OrbitStars", "orbit OrbitPlanet"]],
      ["LIGHTS", ["Sun Key"]],
      // The flash is hidden from the departure.
      ["s010 Arrival", ["Arrival", "s010 orbit OrbitSun", "s010 ship", "s010 ship path", "s010 flash"]],
      ["s020 Departure", ["Departure", "s020 orbit OrbitSun", "s020 ship", "s020 ship path"]],
    ]);
    const pieces = nodes.filter((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name!.includes("orbit "));
    expect(pieces.map((piece) => [piece.attrs.name, piece.attrs.position, ties(piece)])).toEqual([
      ["orbit OrbitStars", "0.000000,1000.000000,0.000000", []],
      ["orbit OrbitPlanet", "0.000000,1120.000000,-20.000000", []],
      ["s010 orbit OrbitSun", "-60.000000,1200.000000,30.000000", []],
      ["s020 orbit OrbitSun", "60.000000,800.000000,30.000000", []],
    ]);
    expect(pieces[1]!.attrs.rotation).toBe("10.000000,0.000000,45.000000");
    expect(pieces.map((piece) => piece.children[0]!.attrs)).toMatchObject([{ duration: "19000" }, { duration: "19000" }, { duration: "10000" }, { start: "10000", duration: "9000" }]);
  });

  it("gives a cast member the Editor's rotation and team colours", async () => {
    const { nodes } = await compiledTest(orbitTest());
    expect(actorNamed(nodes, "s010 ship").attrs).toMatchObject({ position: "0.000000,999.000000,0.000000", rotation: "0.000000,0.000000,90.000000", teamColorDiffuse: "0.200000,0.100000,0.800000,0.900000" });
    expect(actorNamed(nodes, "s020 ship").attrs).toMatchObject({ rotation: "0.000000,0.000000,90.000000", teamColorDiffuse: "0.200000,0.100000,0.800000,0.900000" });
  });

  /** A copy's follow elements and its paths' markers, and its anim layer's paces: start, duration and movespeed. */
  const flightOf = (nodes: CutsceneNode[], name: string) => {
    const actor = actorNamed(nodes, name);
    const follows = actor.children.find((child) => child.tag === "CCutsceneNodeFollowPath")?.children.map((element) => element.attrs) ?? [];
    const paths = follows.map((follow) => nodes.find((node) => node.attrs.guid === follow.pathGuid)!.children.map((marker) => marker.attrs.position));
    const paces = actor.children.find((child) => child.attrs.name === "Animation Layer")!.children.map(({ attrs }) => [attrs.start ?? "0", attrs.duration, attrs.movespeed]);
    return { follows, paths, paces };
  };

  it("flies a cast member along a path through each shot's steps, one after another from the cut, and starts its next shot's copy where the last one ends", async () => {
    const { nodes } = await compiledTest(orbitTest());
    // Held at its point until 1.5 s in, eased in to (0, 5, 0) by 2 s, drifting on to (0, 8, 0) at one
    // speed to the cut at 10 s, along one path from where it stood; no position or rotation is keyed.
    const first = flightOf(nodes, "s010 ship");
    expect(first.paths).toEqual([["0.000000,999.000000,0.000000", "0.000000,1005.000000,0.000000", "0.000000,1008.000000,0.000000"]]);
    expect(first.follows.map((attrs) => [attrs.start, attrs.duration, attrs.pathRotationOffset])).toEqual([["1500", "8500", undefined]]);
    // The eased arrival's four paces slow as it settles; the drift goes 3 cells in 8 s.
    expect(first.paces[0]).toEqual(["0", "1500", undefined]);
    const arrival = first.paces.slice(1, 5).map(([, , speed]) => Number(speed));
    expect(arrival.every((speed, index) => index === 0 || speed < arrival[index - 1]!)).toBe(true);
    expect(first.paces[5]).toEqual(["2000", "8000", "37.500000"]);
    expect(curvesOf(actorNamed(nodes, "s010 ship"))).toEqual({});
    // The second shot's copy, standing at (0, 8, 0), eases to (0, 60, -30) over its shot, turned
    // (30, 0, 90) off its path by the step's facing.
    const second = actorNamed(nodes, "s020 ship");
    expect(second.attrs.position).toBe("0.000000,1008.000000,0.000000");
    const flight = flightOf(nodes, "s020 ship");
    expect(flight.paths).toEqual([["0.000000,1008.000000,0.000000", "0.000000,1060.000000,-30.000000"]]);
    expect(flight.follows.map((attrs) => [attrs.start, attrs.duration, attrs.pathRotationOffset])).toEqual([["10000", "9000", "30.000000,0.000000,90.000000"]]);
    expect(curvesOf(second)).toEqual({});
  });

  it("faces a member along its path with a step's facing in its own frame, which holds through later steps until one gives another", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1].moves = {
      ship: [
        { to: [0, 20, 0], facing: { heading: 0, roll: -30 }, ms: 1000, move: "linear" },
        { to: [10, 30, 0], ms: 1000, move: "linear" },
        { to: [10, 40, 0], facing: 20, ms: 1000, move: "linear" },
        { to: [10, 50, 0], facing: { heading: 0 }, move: "linear" },
      ],
    };
    const { follows, paths } = flightOf((await compiledTest(cinematic)).nodes, "s020 ship");
    // A bank about its nose is a roll (x) off the path, written reversed as the engine banks it (a
    // positive x banks left); degrees turn it off its path and keep the bank.
    expect(follows.map((attrs) => [attrs.start, attrs.pathRotationOffset])).toEqual([
      ["10000", "30.000000,0.000000,0.000000"],
      ["12000", expect.any(String)],
      ["13000", undefined],
    ]);
    expect(apart(engine(follows[1]!.pathRotationOffset!.split(",").map(Number)), own({ heading: 20, roll: 30 }))).toBeLessThan(1e-4);
    expect(paths.map((markers) => markers.length)).toEqual([3, 2, 2]);
  });

  it("keys a member a shot lists as keyed, position and rotation, with no path, and turns it along the true turn to a facing in its own frame", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1].keyed = ["ship"];
    cinematic.shots[1].moves = {
      ship: [
        { to: [0, 20, 0], facing: { heading: 90, pitch: -40, roll: -20 }, ms: 1000, move: "linear" },
        { to: [0, 40, -10], facing: { heading: 90, pitch: -40, roll: -60 }, move: "linear" },
      ],
    };
    const { nodes } = await compiledTest(cinematic);
    const second = actorNamed(nodes, "s020 ship");
    expect(second.children.some((child) => child.tag === "CCutsceneNodeFollowPath")).toBe(false);
    expect(nodes.some((node) => node.attrs.name === "s020 ship path")).toBe(false);
    const curves = curvesOf(second);
    expect(curves.positionY!.map(([start, value]) => [start, value])).toEqual([
      ["10000", "1008.000000"],
      ["11000", "1020.000000"],
      ["16000", "1040.000000"],
    ]);
    // It ends facing the last step's pose, keyed through the turn's in-between rotations.
    const last = ["rotationX", "rotationY", "rotationZ"].map((axis) => Number(curves[axis]!.at(-1)![1]));
    expect(apart(engine(last), own({ heading: 90, pitch: -40, roll: -60 }))).toBeLessThan(1e-4);
    expect(curves.rotationX!.length).toBeGreaterThan(3);
    // The first shot's copy still flies its path.
    expect(flightOf(nodes, "s010 ship").follows).toHaveLength(1);
  });

  it("refuses a keyed member the shot doesn't move", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1].keyed = ["flash"];
    await expect(compiledTest(cinematic)).rejects.toThrow(/doesn't move flash/);
  });

  it("keeps a member's facing through a jump, and turns one stepped to where it stands on the spot", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[0].moves.ship = [{ to: [0, 100, 50], ms: 1 }];
    cinematic.shots[1].moves = { ship: [{ to: [0, 100, 50], facing: 30, ms: 1000 }] };
    const { nodes } = await compiledTest(cinematic);
    const second = actorNamed(nodes, "s020 ship");
    expect(second.attrs).toMatchObject({ position: "0.000000,1100.000000,50.000000", rotation: "0.000000,0.000000,90.000000" });
    expect(second.children.some((child) => child.tag === "CCutsceneNodeFollowPath")).toBe(false);
    expect(curvesOf(second).rotationZ!.map(([start, value]) => [start, value])).toEqual([
      ["10000", "90.000000"],
      ["11000", "30.000000"],
    ]);
  });

  it("walks a member whose walk has a move speed of its own at that walk's priority and speed, and its movespeed for the leg", async () => {
    const cinematic: any = orbitTest();
    cinematic.cast[0].model = "Stalker_Purifier";
    cinematic.cast[0].anim = "Walk";
    const { nodes } = await compiledTest(cinematic);
    const { paces } = flightOf(nodes, "s010 ship");
    const actor = actorNamed(nodes, "s010 ship");
    const drift = actor.children.find((child) => child.attrs.name === "Animation Layer")!.children.find((element) => element.attrs.start === "2000")!;
    // Stalker_Purifier's Walk is 667 ms at 281.25 (data/model-anims.json).
    expect(drift.attrs).toMatchObject({ anim: "Walk", priority: "5", originalDuration: "667", originalMoveSpeed: "281.250000", movespeed: "37.500000" });
    expect(paces[0]).toEqual(["0", "1500", undefined]);
  });

  it("carries a member's scale, fade and the way its path left it facing from one shot into its next shot's copy", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[0].moves.ship.push({ to: [0, 9, 0], facing: [0, 10, 90], scale: [2, 1, 1], opacity: 0.4, ms: 0 });
    cinematic.shots[0].moves.ship[1].ms = 7000;
    cinematic.shots[0].moves.ship[2].ms = 1000;
    delete cinematic.shots[1].moves;
    const second = actorNamed((await compiledTest(cinematic)).nodes, "s020 ship");
    expect(second.attrs).toMatchObject({ position: "0.000000,1009.000000,0.000000", scale: "2.000000,1.000000,1.000000", opacity: "0.400000" });
    // Its last leg runs along +y (heading 90), and its facing turns it (0, 10, 90) off that.
    expect(apart(engine(second.attrs.rotation!.split(",").map(Number)), times(own({ heading: 90 }), engine([0, 10, 90])))).toBeLessThan(1e-4);
    expect(curvesOf(second)).toEqual({});
  });

  it("starts a shot's anim part-way into the shot and plays it once, then the member's own again after the shot", async () => {
    const { nodes } = await compiledTest(orbitTest());
    const flash = actorNamed(nodes, "s010 flash");
    const clips = flash.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children.map(({ attrs }) => [attrs.anim, attrs.start ?? "0", attrs.duration, attrs.looping]);
    expect(clips).toEqual([
      ["Stand", "0", "1500", "1"],
      ["Birth", "1500", "8500", undefined],
    ]);
    // Hidden from the departure, so it has no copy there.
    expect(nodes.some((node) => node.attrs.name === "s020 flash")).toBe(false);
  });

  it("turns the short way round, and a step's facing in degrees turns it about z and keeps its tilt", async () => {
    const cinematic: any = orbitTest();
    cinematic.cast[0].facing = [20, 0, 350];
    delete cinematic.shots[0].moves;
    cinematic.shots[1].moves = { ship: [{ facing: 10 }] };
    const ship = actorNamed((await compiledTest(cinematic)).nodes, "s020 ship");
    const curves = curvesOf(ship);
    expect(ship.attrs.rotation).toBe("20.000000,0.000000,350.000000");
    expect(curves.rotationZ!.map(([start, value]) => [start, value])).toEqual([
      ["10000", "350.000000"],
      ["16000", "370.000000"],
    ]);
    expect(curves.rotationX).toBeUndefined();
  });

  /** The ship's pose (its rotation curves read as the engine turns them) every 20 ms of the first shot, from `fromMs` to `toMs`. */
  const posesOf = (ship: CutsceneNode, rest: readonly number[], fromMs: number, toMs: number) => {
    const curve = (axis: number) => ship.children.find((child) => child.attrs.propertyName === `rotation${"XYZ"[axis]}`);
    return Array.from({ length: (toMs - fromMs) / 20 + 1 }, (_, at) => engine([0, 1, 2].map((axis) => (curve(axis) ? curveValue(curve(axis)!, fromMs + at * 20) : rest[axis]!))));
  };

  it("keys a big banked turn finely enough that every pose on the way stays on the true turn", async () => {
    const cinematic: any = orbitTest();
    const [from, to] = [{ heading: 0, roll: -30 }, { heading: 90, roll: -30 }];
    cinematic.cast[0].facing = from;
    cinematic.shots[0].moves = { ship: [{ facing: to, afterMs: 1000, ms: 4000 }] };
    const ship = actorNamed((await compiledTest(cinematic)).nodes, "s010 ship");
    const poses = posesOf(ship, [], 1000, 5000);
    expect(Math.max(...poses.map((pose) => offTurn(pose, own(from), own(to))))).toBeLessThan(0.5);
    // It starts and ends on the two facings.
    expect(apart(poses[0]!, own(from))).toBeLessThan(1e-3);
    expect(apart(poses.at(-1)!, own(to))).toBeLessThan(1e-3);
  });

  it("times a set piece's life, fades and scales it through a shot, as a cast member's", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[0].enters = { "orbit/planet": 2000 };
    cinematic.shots[0].moves["orbit/planet"] = [{ opacity: 0.5, scale: 6, afterMs: 3000, ms: 1000, move: "linear" }];
    cinematic.shots[1].exits = { "orbit/planet": 1000 };
    const { nodes } = await compiledTest(cinematic, (set) => {
      set.pieces[1].id = "planet";
    });
    // In every shot, so it stands once at the top level, timed as before.
    const planet = actorNamed(nodes, "orbit OrbitPlanet");
    // In being from 2 s into the first shot to 1 s into the second (at 10 s).
    expect(planet.children.find((child) => child.tag === "CCutsceneElementObject")!.attrs).toMatchObject({ start: "2000", duration: "9000" });
    const curves = curvesOf(planet);
    expect(curves.opacity).toEqual([
      ["3000", "1.000000", at(2999, 1), at(3000 + 1000 / 3, 1 - 0.5 / 3)],
      ["4000", "0.500000", at(4000 - 1000 / 3, 0.5 + 0.5 / 3), at(4001, 0.5)],
    ]);
    expect(curves.scaleX!.map(([start, value]) => [start, value])).toEqual([
      ["3000", "12.000000"],
      ["4000", "6.000000"],
    ]);
    expect(curves.positionX).toBeUndefined();
  });

  it("keeps a mirrored piece mirrored through an even scale step", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[0].moves["orbit/planet"] = [{ scale: 6, ms: 1000 }];
    const { nodes } = await compiledTest(cinematic, (set) => {
      set.pieces[1].id = "planet";
      set.pieces[1].scale = [-12, 12, 12];
    });
    const curves = curvesOf(actorNamed(nodes, "orbit OrbitPlanet"));
    expect(curves.scaleX!.map(([start, value]) => [start, value])).toEqual([
      ["0", "-12.000000"],
      ["1000", "-6.000000"],
    ]);
  });

  it("tints a cast member", async () => {
    const cinematic: any = orbitTest();
    cinematic.cast[0].tint = [0.5, 0.25, 1.5];
    const { nodes } = await compiledTest(cinematic);
    expect(actorNamed(nodes, "s020 ship").attrs).toMatchObject({ tintColorRed: "0.500000", tintColorGreen: "0.250000", tintColorBlue: "1.500000" });
  });

  it("flies a shot's camera along its path, rolling into a bank and back, smoothly through each key, and shakes it for a while", async () => {
    const cinematic: any = orbitTest();
    // The first shot (10 s) arcs from the set's Arrival camera through a banked camera of its own at 3 s to Departure at its end.
    cinematic.shots[0].path = [{ atMs: 3000, camera: { target: [5, 20, 2], distance: 30, pitch: 5, yaw: 210, fov: 40, roll: -8 } }, { camera: "orbit/Departure" }];
    cinematic.shots[0].shake = { atMs: 6000, ms: 500, amplitude: 0.3, hz: 4, roll: 1 };
    const { nodes } = await compiledTest(cinematic);
    const camera = nodes.find((node) => node.tag === "CCutsceneNodeCamera" && node.attrs.name === "Arrival")!;
    const curves = curvesOf(camera);
    // y 1010 → 1020 → 1030 (the set sits 1000 north): the middle key at the slope from first to last,
    // 20 / 10000 ms, so 2 a third of the way back. Its out handle, 14/3 up a third of the way to 10 s,
    // is cut down with its span where the shake starts at 6 s, 3/7 of the way: 2 up at 4 s.
    expect(curves.positionY!.slice(0, 2)).toEqual([
      ["0", "1010.000000", at(-1, 1010), at(1000, 1010)],
      ["3000", "1020.000000", at(2000, 1018), at(4000, 1022)],
    ]);
    // The shake keys each 125 ms from 6 s to 6.5 s, then the path runs on to Departure.
    expect(curves.positionY!.map(([start]) => start)).toEqual(["0", "3000", "6000", "6125", "6250", "6375", "6500", "10000"]);
    // Roll 0 → -8 → 0, flat at the bank's deepest; shaken too, so keyed at the shake's times as well.
    expect(curves.roll!.slice(0, 2)).toEqual([
      ["0", "0.000000", at(-1, 0), at(1000, 0)],
      ["3000", "-8.000000", at(2000, -8), at(4000, -8)],
    ]);
    expect(curves.roll!.map(([start]) => start)).toEqual(["0", "3000", "6000", "6125", "6250", "6375", "6500", "10000"]);
  });

  it("keeps the roll of a shot's camera through a move to a camera of its own that gives none", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1] = { ...cinematic.shots[1], set: "orbit", camera: { target: [0, 30, 0], distance: 40, pitch: -5, yaw: 20, fov: 40, roll: 6 }, to: { target: [0, 40, 0], distance: 40, pitch: -5, yaw: 20, fov: 40 } };
    const { nodes } = await compiledTest(cinematic);
    const camera = nodes.filter((node) => node.tag === "CCutsceneNodeCamera")[1]!;
    expect(camera.attrs.roll).toBe("6.000000");
    expect(Object.keys(curvesOf(camera))).toEqual(["positionY"]);
  });

  it("refuses a path key or a shake past its shot's end, and two keys at its end", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1].path = [{ atMs: 7000, camera: "orbit/Arrival" }];
    await expect(compiledTest(cinematic)).rejects.toThrow("Shot 1's camera path reaches its key 0 7000 ms in, past the shot's end at 6000 ms");
    cinematic.shots[1].path = [{ atMs: 6000, camera: "orbit/Arrival" }, { camera: "orbit/Departure" }];
    await expect(compiledTest(cinematic)).rejects.toThrow("Shot 1's camera path reaches its key 0 at the shot's end, 6000 ms in, before its last key");
    delete cinematic.shots[1].path;
    cinematic.shots[1].shake = { atMs: 5000, ms: 2000, amplitude: 0.2, hz: 5 };
    await expect(compiledTest(cinematic)).rejects.toThrow("Shot 1's shake runs until 7000 ms into it, past its end at 6000 ms");
  });

  it("refuses a timed anim that starts at or past its shot's end", async () => {
    const cinematic: any = orbitTest();
    cinematic.shots[1].anims = { flash: { anim: "Birth", atMs: 6000, once: true } };
    await expect(compiledTest(cinematic)).rejects.toThrow("Shot 1 starts flash's Birth 6000 ms into it, at or past its end at 6000 ms");
  });

  it("refuses a step that runs past its shot's end, or in the last shot past the fade out's", async () => {
    const early = orbitTest();
    early.shots[0]!.moves = { ship: [{ to: [0, 60, -30], ms: 10500 } as never] };
    // The first shot runs 10 s: the 1 s fade in, then its 9 s.
    await expect(compiledTest(early)).rejects.toThrow("Shot 0 moves ship until 10500 ms into it, past its end at 10000 ms");
    // The last shot's copies stay through the 1 s fade out, so its steps may run on through it.
    const last = orbitTest();
    last.shots[1]!.moves = { ship: [{ to: [0, 60, -30], ms: 7001 } as never] };
    await expect(compiledTest(last)).rejects.toThrow("Shot 1 moves ship until 7001 ms into it, past its end at 7000 ms (the fade out's end)");
  });

  it("flies a step in the last shot on through the fade out", async () => {
    const cinematic = orbitTest();
    cinematic.shots[1]!.moves = { ship: [{ to: [0, 60, -30], ms: 7000, move: "linear" } as never] };
    await expect(compiledTest(cinematic)).resolves.toBeDefined();
  });

  it("adds a Plugin's Light it names to the map's LightData, beside the Mission's own, once however often it's written", async () => {
    const cinematic = { ...orbitTest(), light: "NoonGlare" };
    const lightIds = async (map: string) => (await readFile(path.join(map, "Base.SC2Data/GameData/LightData.xml"), "utf8").catch(() => "")).match(/<CLight id="[^"]+"/g);
    const own = await withTest(cinematic, { blueprint: (blueprint) => void (blueprint.lights = [{ id: "FieldDusk", from: "ArcadeCityLight", exposure: 1 }]) });
    expect(await lightIds(own.map)).toEqual(['<CLight id="FieldDusk"']);
    await compileCinematicCutscene(own.workspace, own.blueprintPath, own.id, own.map);
    await compileCinematicCutscene(own.workspace, own.blueprintPath, own.id, own.map);
    expect(await lightIds(own.map)).toEqual(['<CLight id="FieldDusk"', '<CLight id="NoonGlare"']);
    const none = await withTest(cinematic);
    expect(await lightIds(none.map)).toBeNull();
    await compileCinematicCutscene(none.workspace, none.blueprintPath, none.id, none.map);
    expect(await lightIds(none.map)).toEqual(['<CLight id="NoonGlare"']);
  });

  it("rewrites a Plugin's Light the map already has with its values now, as the Light is tuned", async () => {
    const { root, workspace, blueprintPath, map, id } = await withTest({ ...orbitTest(), light: "NoonGlare" });
    await compileCinematicCutscene(workspace, blueprintPath, id, map);
    const lightsFile = path.join(root, "plugins/noon/lights.json");
    const lights = JSON.parse(await readFile(lightsFile, "utf8"));
    lights.lights[0].exposure = 1.4;
    await writeFile(lightsFile, JSON.stringify(lights));
    await compileCinematicCutscene(await loadWorkspace(root), blueprintPath, id, map);
    const xml = await readFile(path.join(map, "Base.SC2Data/GameData/LightData.xml"), "utf8");
    expect(xml.match(/<CLight id="[^"]+"/g)).toEqual(['<CLight id="NoonGlare"']);
    expect(xml).toContain('<Param index="HDRExposure" value="1.400000"/>');
  });
});

describe("checking a test Cinematic", () => {
  /** Why the test Cinematic `edit` makes of orbitTest can't be written, one problem a line. */
  async function refused(edit: (cinematic: any) => void, set?: (set: any) => void): Promise<{ file: string; problems: string[] }> {
    const cinematic: any = orbitTest();
    edit(cinematic);
    const { workspace, blueprintPath, map, id } = await withTest(cinematic, { blueprint: noStartCinematic, ...(set ? { set } : {}) });
    const failure = await compileCinematicCutscene(workspace, blueprintPath, id, map).then(
      () => "",
      (error: Error) => error.message,
    );
    return { file: path.join(workspace.root, MISSION, "cinematics", `${id}.json`), problems: failure.replace("The Cinematics can't be written: ", "").split("; ") };
  }

  it("rejects a piece the set doesn't have or switched off, a piece moved or turned, and a piece that enters twice", async () => {
    const { file, problems } = await refused(
      (cinematic) => {
        cinematic.shots[0].enters = { "orbit/moon": 100, "orbit/sun": 100, "nowhere/planet": 100, "orbit/planet": 100 };
        cinematic.shots[1].enters = { "orbit/planet": 200 };
        cinematic.shots[0].moves["orbit/planet"] = [{ opacity: 0, ms: 100 }, { to: [0, 0, 0], facing: 90 }];
      },
      (set) => {
        set.pieces[1].id = "planet";
        set.pieces[2].id = "sun";
        set.pieces[2].hidden = true;
      },
    );
    // Joined again: a message of its own may hold "; ".
    expect(problems.join("; ")).toEqual([
      `${file} shots.0.moves.orbit/planet.1: A set piece only fades and scales (opacity, scale): make it a cast member to move or turn it`,
      `${file} shots.0.enters.orbit/moon: The set orbit has no piece moon (its pieces with ids: planet, sun)`,
      `${file} shots.0.enters.orbit/sun: The set orbit's piece sun is switched off (hidden), so it's never written`,
      `${file} shots.0.enters.nowhere/planet: No set nowhere in this Cinematic (its sets: orbit)`,
      `${file} shots.1.enters.orbit/planet: orbit/planet enters once; shot 0 already enters it`,
    ].join("; "));
  });

  it("rejects a set whose pieces share an id", async () => {
    const { file, problems } = await refused(
      () => {},
      (set) => {
        set.pieces[1].id = "planet";
        set.pieces[2].id = "planet";
      },
    );
    expect(problems).toEqual([`${path.join(path.dirname(path.dirname(file)), "sets", "radio-orbit.json")} pieces.2.id: Two pieces are called planet`]);
  });

  it("rejects a step with no length before a shot's last", async () => {
    const { file, problems } = await refused((cinematic) => {
      cinematic.shots[1].moves.ship = [{ to: [0, 1, 0] }, { to: [0, 2, 0] }];
    });
    expect(problems).toEqual([`${file} shots.1.moves.ship.0.ms: Only a shot's last step may leave out ms: it takes the rest of the shot`]);
  });

  it("rejects a path beside a move to one camera, keys out of time order, and a key before the last with no time", async () => {
    const { file, problems } = await refused((cinematic) => {
      cinematic.shots[0].to = "orbit/Departure";
      cinematic.shots[0].path = [{ camera: "orbit/Departure" }];
      cinematic.shots[1].path = [{ atMs: 3000, camera: "orbit/Arrival" }, { atMs: 2000, camera: "orbit/Departure" }, { camera: "orbit/Arrival" }, { camera: "orbit/Departure" }];
    });
    expect(problems).toEqual([
      `${file} shots.0.path: A shot's camera moves to one camera (to) or along a path, not both`,
      `${file} shots.1.path.1.atMs: A path's keys come in time order, each after the one before`,
      `${file} shots.1.path.2.atMs: Only a path's last key may leave out atMs: it's at the shot's end`,
    ]);
  });

  it("rejects a path through a camera of a set the Cinematic doesn't place", async () => {
    const { file, problems } = await refused((cinematic) => {
      cinematic.shots[1].path = [{ atMs: 1000, camera: { target: [0, 0, 0], distance: 30, pitch: 0, yaw: 0, fov: 40 } }, { camera: "elsewhere/Wide" }];
    });
    expect(problems).toEqual([`${file} shots.1.path.1.camera: No set elsewhere in this Cinematic (its sets: orbit)`]);
  });

  it("rejects a cut on a line, and a move or anim of no cast member", async () => {
    const { file, problems } = await refused((cinematic) => {
      delete cinematic.shots[0].afterMs;
      cinematic.shots[0].line = "radio_field-1-1";
      cinematic.shots[0].moves.ghost = [{ to: [0, 0, 0] }];
      cinematic.shots[1].anims = { ghost: { anim: "Birth", atMs: 100 } };
    });
    expect(problems).toEqual([
      `${file} shots.0.moves.ghost: No cast member ghost in this Cinematic`,
      `${file} shots.0.line: A test Cinematic (one its Blueprint doesn't list) plays no scene, so its shots start afterMs after the shot before`,
      `${file} shots.1.anims.ghost: No cast member ghost in this Cinematic`,
    ]);
  });
});

describe("compile_cutscene on a test Cinematic", () => {
  it("loops it from map start in a full-screen dialog, under its file's name", async () => {
    const { root } = await withTest(orbitTest(), { blueprint: noStartCinematic });
    const client = await connect(root);
    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "radio-field", shotList: `${MISSION}/cinematics/test-orbit.json`, play: true } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/^2 shots written to .*test-orbit\.SC2Cutscene\nPlays from map start in a full-screen dialog\n/);
    const script = await readFile(path.join(root, MISSION, "Radio-Field.SC2Map/MapScript.galaxy"), "utf8");
    expect(script).toContain('libNtve_gf_SetDialogItemCutscene(DialogControlLastCreated(), "Cutscenes\\\\test-orbit.SC2Cutscene", PlayerGroupAll());');
  });

  it("writes it in place of the Cinematic the map's mission start cue plays, so that cue plays it", async () => {
    const { root, map } = await withTest(orbitTest());
    const client = await connect(root);
    const loop = await client.callTool({ name: "compile_cutscene", arguments: { mission: "radio-field", shotList: `${MISSION}/cinematics/test-orbit.json`, play: true } });
    expect(loop.isError).toBe(true);
    expect(text(loop)).toContain("The map's mission start cue plays the Cinematic radio, which would play over a test loop; write the test in its place: name it radio");
    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "radio-field", shotList: `${MISSION}/cinematics/test-orbit.json`, name: "radio", play: true } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/^2 shots written to .*radio\.SC2Cutscene\nPlays from map start in a full-screen dialog, from its scene's missionStart cue\n/);
    const nodes = all(readCutscene(await readFile(path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene"), "utf8")));
    expect(nodes.some((node) => node.attrs.name === "s010 ship")).toBe(true);
    expect(await readFile(path.join(map, "MapScript.galaxy"), "utf8")).not.toContain("Cinematic_Init");
  });

  it("refuses a name that would overwrite a listed Cinematic its mission start cue doesn't play, played or not", async () => {
    const { workspace, blueprintPath, map, id } = await withTest(orbitTest(), { blueprint: noStartCinematic });
    const radio = path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene");
    await mkdir(path.dirname(radio), { recursive: true });
    await writeFile(radio, "the listed Cinematic");
    for (const [name, play] of [["radio", false], ["radio", true], ["Radio", false]] as const) {
      await expect(compileCinematicCutscene(workspace, blueprintPath, id, map, { name, play })).rejects.toThrow(
        `The Blueprint lists a Cinematic radio, which its cues play, and a test written as ${name}.SC2Cutscene would replace it; name the test something else`,
      );
    }
    expect(await readFile(radio, "utf8")).toBe("the listed Cinematic");
  });
});

describe("compile_cutscene on a plain shot list", () => {
  const shots = { origin: [20, 30, 0] as [number, number, number], shots: [{ name: "Wide", durationMs: 2000, from: { target: [16, 32, 1] as [number, number, number], distance: 20, pitch: 30, yaw: 180, fov: 40 } }] };

  it("refuses a name a Cinematic the map plays owns, played or not, ignoring case", async () => {
    const { map } = await withTest(orbitTest());
    const radio = path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene");
    await writeFile(radio, "the listed Cinematic");
    for (const [name, play] of [["radio", false], ["radio", true], ["Radio", false]] as const) {
      await expect(compileShotCutscene(shots, map, name, { play })).rejects.toThrow(
        `The map plays a Cinematic radio, and a shot list written as ${name}.SC2Cutscene would replace it; name the shot list something else`,
      );
    }
    expect(await readFile(radio, "utf8")).toBe("the listed Cinematic");
    expect(await readFile(path.join(map, "MapScript.galaxy"), "utf8")).not.toContain("ShotCutscene_Init");
    // Any other name is written as before.
    const other = await compileShotCutscene(shots, map, "radio-wide");
    expect(await readFile(other.file, "utf8")).toContain("Wide");
  });
});
