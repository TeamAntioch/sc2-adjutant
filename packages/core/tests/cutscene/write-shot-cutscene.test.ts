import { describe, expect, it } from "vitest";

import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { type ActorMove, playCinematicScript, playShotCutsceneScript, shotCutscene, type ShotCamera, type StandingActor, walkSpeed } from "../../src/cutscene/write-shot-cutscene.js";

const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
const wide: ShotCamera = { target: [48, 74, 9], distance: 53.5, pitch: 10, yaw: 180, fov: 40 };
const low: ShotCamera = { target: [48, 40, 9.2], distance: 12, pitch: 6, yaw: 180, fov: 40 };

describe("shotCutscene", () => {
  const nodes = all(
    readCutscene(
      shotCutscene({
        light: "KorhalNight",
        shots: [
          { name: "Establish", durationMs: 8000, from: wide, to: low, backdrop: [{ model: "KorhalSkyboxCityNight", at: [48, 140, 20], rotation: -90, scale: 0.1, tint: [0.45, 0.53, 0.84] }] },
          { name: "Hold", durationMs: 4000, from: low },
        ],
      }),
    ),
  );
  const byTag = (tag: string): CutsceneNode[] => nodes.filter((node) => node.tag === tag);

  it("cuts to each shot's camera at its start", () => {
    const cameras = byTag("CCutsceneNodeCamera");
    expect(cameras.map((camera) => camera.attrs.name)).toEqual(["Establish", "Hold"]);
    expect(byTag("CCutsceneElementActiveCamera").map((cut) => [cut.attrs.start, cut.attrs.objectGuid])).toEqual([
      [undefined, cameras[0]!.attrs.guid],
      ["8000", cameras[1]!.attrs.guid],
    ]);
  });

  it("moves a camera by curving only the values that change, over its shot", () => {
    const establish = byTag("CCutsceneNodeCamera")[0]!;
    const curves = establish.children.filter((child) => child.tag === "CCutsceneNodePropertyValue");
    expect(curves.map((curve) => curve.attrs.propertyName)).toEqual(["positionY", "positionZ", "distance", "pitch"]);
    const distance = curves.find((curve) => curve.attrs.propertyName === "distance")!.children;
    expect(distance.map((key) => [Number(key.attrs.time), Number(key.attrs.value)])).toEqual([
      [0, 53.5],
      [8000, 12],
    ]);
  });

  it("keeps a shot's backdrop on screen only during that shot", () => {
    const sky = byTag("CCutsceneNodeActor")[0]!;
    expect(sky.attrs).toMatchObject({ modelLink: "KorhalSkyboxCityNight", rotation: "0.000000,0.000000,-90.000000", tintColorBlue: "0.840000" });
    expect(sky.children[0]!.attrs).toMatchObject({ duration: "8000" });
    expect(sky.children[0]!.attrs.start).toBeUndefined();
  });

  it("keeps a full rotation as the Editor wrote it", () => {
    const xml = shotCutscene({ shots: [{ name: "Wide", durationMs: 1000, from: wide, backdrop: [{ model: "KorhalSkyboxCityNight", at: [0, 0, 0], rotation: [98.7, 12.36, -76.37] }] }] });
    expect(all(readCutscene(xml)).find((node) => node.tag === "CCutsceneNodeActor")!.attrs.rotation).toBe("98.700000,12.360000,-76.370000");
  });

  it("moves map coordinates so the origin point lands at the cutscene's 0,0,0", () => {
    const xml = shotCutscene({ origin: [48, 72, 0], shots: [{ name: "Wide", durationMs: 1000, from: wide, backdrop: [{ model: "Tower", at: [60, 110, 8] }] }] });
    const moved = all(readCutscene(xml));
    expect(moved.find((node) => node.tag === "CCutsceneNodeCamera")!.attrs.position).toBe("0.000000,2.000000,9.000000");
    expect(moved.find((node) => node.tag === "CCutsceneNodeActor")!.attrs.position).toBe("12.000000,38.000000,8.000000");
  });

  it("walks an actor along a path over its shot", () => {
    const xml = shotCutscene({
      shots: [
        { name: "Wide", durationMs: 1000, from: wide },
        { name: "Track", durationMs: 5000, from: low, backdrop: [{ name: "Walker", model: "Civilian", at: [42, 30, 8], walkTo: [[42, 42, 8]] }] },
      ],
    });
    const walked = all(readCutscene(xml));
    const path = walked.find((node) => node.tag === "CCutsceneNodePath")!;
    expect(path.children.map((marker) => marker.attrs.position)).toEqual(["42.000000,30.000000,8.000000", "42.000000,42.000000,8.000000"]);
    expect(walked.find((node) => node.tag === "CCutsceneElementFollowPath")!.attrs).toMatchObject({ start: "1000", duration: "5000", pathGuid: path.attrs.guid });
    expect(walked.find((node) => node.tag === "CCutsceneElementAnim")!.attrs.anim).toBe("Walk");
  });

  it("gives a walk its move speed, as the Editor does once the animation is picked", () => {
    const xml = shotCutscene({ shots: [{ name: "Track", durationMs: 5000, from: low, backdrop: [{ model: "SMX3_BGPeople_07", at: [42, 30, 8], walkTo: [[42, 37, 8]], anim: { name: "Walk A", durationMs: 2567, moveSpeed: 38 } }] }] });
    expect(all(readCutscene(xml)).find((node) => node.tag === "CCutsceneElementAnim")!.attrs).toMatchObject({ anim: "Walk A", priority: "5", originalDuration: "2567", originalMoveSpeed: "38.000000", movespeed: "38.000000" });
  });

  it("blurs past a camera's target, and racks focus with the move", () => {
    const xml = shotCutscene({ shots: [{ name: "Track", durationMs: 5000, from: { ...low, blur: 0.5 }, to: { ...low, distance: 6, blur: 0.5 } }] });
    const camera = all(readCutscene(xml)).find((node) => node.tag === "CCutsceneNodeCamera")!;
    expect(camera.attrs).toMatchObject({ doftype: "0.000000", depthOfField: "0.500000", focalDepth: "12.000000", falloffEnd: "2.000000", falloffStartNear: "0.000000" });
    expect(camera.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => curve.attrs.propertyName)).toEqual(["distance", "focalDepth"]);
  });

  it("keeps a linear move at one speed", () => {
    const xml = shotCutscene({ shots: [{ name: "Track", durationMs: 3000, from: { ...low, target: [42, 30, 9] }, to: { ...low, target: [42, 42, 9] }, move: "linear" }] });
    const keys = all(readCutscene(xml)).filter((node) => node.tag === "CCutsceneElementPropertyCurve");
    expect(keys.map((key) => [key.attrs.curveInValue, key.attrs.curveOutValue])).toEqual([
      ["-1.000000,30.000000", "1000.000000,34.000000"],
      ["2000.000000,38.000000", "3001.000000,42.000000"],
    ]);
  });

  /** Each animated camera property's keys: time, value, handles and tangent types. */
  const cameraCurves = (xml: string) =>
    Object.fromEntries(
      all(readCutscene(xml))
        .find((node) => node.tag === "CCutsceneNodeCamera")!
        .children.filter((child) => child.tag === "CCutsceneNodePropertyValue")
        .map((curve) => [curve.attrs.propertyName, curve.children.map(({ attrs }) => [attrs.start ?? "0", attrs.value, attrs.curveInValue, attrs.curveOutValue, `${attrs.curveInType}/${attrs.curveOutType}`])]),
    );
  const at = (time: number, value: number) => `${time.toFixed(6)},${value.toFixed(6)}`;

  it("flies a camera through a path's keys smoothly, as the Editor's Auto tangent does: through each key at the slope between its neighbours, at rest at the ends", () => {
    const xml = shotCutscene({
      shots: [{ name: "Arc", durationMs: 4000, from: { ...low, target: [0, 40, 9] }, path: [{ atMs: 2000, camera: { ...low, target: [10, 40, 9] } }, { atMs: 4000, camera: { ...low, target: [30, 40, 9] } }], move: "smooth" }],
    });
    // 0 → 10 → 30: the middle key's slope is (30 - 0) / 4000 ms, its handles a third of the way to each neighbour.
    expect(cameraCurves(xml)).toEqual({
      positionX: [
        ["0", "0.000000", at(-1, 0), at(2000 / 3, 0), "7/7"],
        ["2000", "10.000000", at(2000 - 2000 / 3, 5), at(2000 + 2000 / 3, 15), "7/7"],
        ["4000", "30.000000", at(4000 - 2000 / 3, 30), at(4001, 30), "7/7"],
      ],
    });
  });

  it("keeps a smooth key's handles on one line when a neighbour is close, easing the slope off so it doesn't overshoot", () => {
    const xml = shotCutscene({
      shots: [{ name: "Near", durationMs: 1100, from: { ...low, target: [0, 40, 9] }, path: [{ atMs: 1000, camera: { ...low, target: [9.9, 40, 9] } }, { atMs: 1100, camera: { ...low, target: [10, 40, 9] } }] }],
    });
    // The slope from 0 to 10 over 1.1 s would carry the out handle past 10; at most 0.1 × 3 / 100 ms, it stays on 10.
    const middle = cameraCurves(xml).positionX![1]!;
    expect(middle.slice(1, 4)).toEqual(["9.900000", at(1000 - 1000 / 3, 9.9 - 0.003 * (1000 / 3)), at(1000 + 100 / 3, 10)]);
  });

  it("rolls a camera through a move, a camera with no roll at 0", () => {
    const xml = shotCutscene({ shots: [{ name: "Bank", durationMs: 3000, from: low, to: { ...low, roll: 12 } }] });
    expect(cameraCurves(xml)).toEqual({
      roll: [
        ["0", "0.000000", at(-1, 0), at(1000, 6), "3/3"],
        ["3000", "12.000000", at(2000, 12), at(3001, 12), "3/3"],
      ],
    });
  });

  it("shakes a held camera's target and roll from a time for a while, a key each half cycle, and leaves it still around the shake", () => {
    const xml = shotCutscene({ shots: [{ name: "Impact", durationMs: 4000, from: { ...low, roll: 2 }, shake: { startMs: 1000, durationMs: 1000, amplitude: 0.4, hz: 5, roll: 1.5 } }] });
    const curves = cameraCurves(xml);
    expect(Object.keys(curves)).toEqual(["positionX", "positionY", "positionZ", "roll"]);
    for (const [property, held, amplitude] of [["positionX", 48, 0.4], ["positionY", 40, 0.4], ["positionZ", 9.2, 0.4], ["roll", 2, 1.5]] as const) {
      const keys = curves[property]!;
      // At rest at 1 s and 2 s, and a key every 100 ms between, jolting each way in turn by half to all of the amplitude.
      expect(keys.map(([start]) => Number(start))).toEqual([1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000]);
      expect([Number(keys[0]![1]), Number(keys.at(-1)![1])]).toEqual([held, held]);
      const side = Math.sign(Number(keys[1]![1]) - held);
      keys.slice(1, -1).forEach(([, value], at) => {
        const jolt = (Number(value) - held) * side * (at % 2 ? -1 : 1);
        expect(jolt).toBeGreaterThanOrEqual(amplitude / 2 - 1e-6);
        expect(jolt).toBeLessThanOrEqual(amplitude + 1e-6);
      });
      expect(keys.slice(1, -1).every(([, , , , types]) => types === "7/7")).toBe(true);
    }
    // The axes don't jolt in step: they don't all start the same way.
    const firstSides = ["positionX", "positionY", "positionZ"].map((property) => Number(curves[property]![1]![1]) > Number(curves[property]![0]![1]));
    expect(new Set(firstSides).size).toBe(2);
    expect(cameraCurves(xml)).toEqual(curves);
  });

  it("shakes a moving camera about its path, keeping the path's shape outside the shake", () => {
    const shot = { name: "Pass", durationMs: 3000, from: { ...low, target: [0, 40, 9] as const }, to: { ...low, target: [30, 40, 9] as const }, move: "linear" as const };
    const still = cameraCurves(shotCutscene({ shots: [shot] }));
    const shook = cameraCurves(shotCutscene({ shots: [{ ...shot, shake: { startMs: 1000, durationMs: 1000, amplitude: 0.2, hz: 5 } }] }));
    // Linear 0 → 30 over 3 s: 10 at 1 s and 20 at 2 s, the spans either side still straight.
    const x = shook.positionX!;
    expect([x[0], x[1]!.slice(0, 3), x.at(-2)!.slice(0, 2), x.at(-1)]).toEqual([
      ["0", "0.000000", at(-1, 0), at(1000 / 3, 10 / 3), "3/3"],
      ["1000", "10.000000", at(1000 - 1000 / 3, 10 - 10 / 3)],
      ["2000", "20.000000"],
      ["3000", "30.000000", at(3000 - 1000 / 3, 30 - 10 / 3), at(3001, 30), "3/3"],
    ]);
    expect(still.positionX).toHaveLength(2);
    expect(Math.abs(Number(x[2]![1]) - 11)).toBeGreaterThanOrEqual(0.1 - 1e-6);
  });

  it("plays the cutscene in game at its origin, in a loop", () => {
    const script = playShotCutsceneScript("Korhal Street.SC2Cutscene", [64, 64, 0]);
    expect(script).toContain('CutsceneCreateNew("Cutscenes\\\\Korhal Street.SC2Cutscene", Point(64.0, 64.0), 0.0, PlayerGroupAll(), true);');
    expect(script).toContain('TriggerAddEventMapInit(TriggerCreate("ShotCutscene_Play"));');
    expect(script).toContain("UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeErrorDisplayPanel, false);");
  });

  it("pauses AI time for each run, and the run's caller restores it whether the run ends or is skipped", () => {
    const script = playShotCutsceneScript("Korhal Street.SC2Cutscene");
    const raw = script.split("\n");
    const lines = raw.map((line) => line.trim());
    /** A trigger function's body, by name: up to its own closing brace, the first one unindented. */
    const body = (name: string): string[] => {
      const start = lines.findIndex((line) => line.startsWith(`bool ${name}(`));
      expect(start, name).toBeGreaterThanOrEqual(0);
      return lines.slice(start + 1, raw.indexOf("}", start));
    };
    // A skip ends the skippable trigger early (cutscene §3.2), so it holds only the wait: nothing
    // after the wait there is sure to run.
    const watch = body("ShotCutscene_Watch");
    expect(watch).toEqual(["TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);", "WaitForCutsceneToEnd(ShotCutscene_cutscene);", "return true;"]);
    expect(lines).toContain('ShotCutscene_WatchTrigger = TriggerCreate("ShotCutscene_Watch");');
    // The loop runs it with wait, and on either path carries on to one stop and one restore.
    const play = body("ShotCutscene_Play");
    const run = play.indexOf("TriggerExecute(ShotCutscene_WatchTrigger, true, true);");
    expect(play.slice(run - 3, run)).toEqual(["aiWasPaused = AITimeIsPaused();", "AITimePause(true);", expect.stringMatching(/^ShotCutscene_cutscene = CutsceneCreateNew\(/)]);
    expect(play.slice(run + 1, run + 5)).toEqual(["CutsceneStop(ShotCutscene_cutscene);", "if (!aiWasPaused) {", "AITimePause(false);", "}"]);
    expect(script.match(/CutsceneStop\(/g)).toHaveLength(1);
    expect(script).not.toContain("TriggerSkippableEnd");
  });

  it("lights a shot with its own rig, seen only through its camera", () => {
    const xml = shotCutscene({
      shots: [
        { name: "Wide", durationMs: 1000, from: wide },
        { name: "Track", durationMs: 5000, from: low, lights: [{ name: "Rim", at: [41, 32, 9.5], color: [0.5, 0.7, 1], strength: 3, range: 3 }] },
      ],
    });
    const nodes = all(readCutscene(xml));
    const track = nodes.filter((node) => node.tag === "CCutsceneNodeCamera")[1]!;
    const rim = nodes.find((node) => node.tag === "CCutsceneNodeLight")!;
    expect(rim.attrs).toMatchObject({ type: "1", colorMultiplier: "3.000000", attenuationStart: "1.500000", range: "3.000000" });
    expect(rim.children.map((child) => [child.tag, child.attrs.start ?? child.attrs.cameraGUID])).toEqual([
      ["CCutsceneElementObject", "1000"],
      ["CCutsceneNodeActiveShot", track.attrs.guid],
    ]);
  });

  it("lays a cutscene out shot first: a folder a shot with its camera, copies and backdrop, its lights in LIGHTS, and only what stands through every shot at the top", () => {
    const xml = shotCutscene({
      shots: [
        { name: "Wide", durationMs: 1000, from: wide, backdrop: [{ model: "Sky", at: [0, 0, 0] }] },
        { name: "Track", durationMs: 5000, from: low, lights: [{ name: "Rim", at: [41, 32, 9.5], color: [0.5, 0.7, 1], strength: 3, range: 3 }] },
      ],
      standing: [
        { model: "Floor", at: [0, 0, 0] },
        { model: "Ship", name: "ship", at: [0, 0, 0], shots: [0, 1], moves: [{ startMs: 500, durationMs: 1000, to: [0, 10, 0], opacity: 0.5 }] },
      ],
      lamps: [
        { name: "Sun", type: "omni", at: [0, 0, 50], color: [1, 1, 1], strength: 1 },
        { name: "Practical", type: "omni", at: [0, 0, 2], color: [1, 1, 1], strength: 1, shots: [1] },
      ],
    });
    const root = readCutscene(xml);
    const of = (node: CutsceneNode): unknown => (node.tag === "CCutsceneNodeFolder" ? { [node.attrs.name!]: node.children.map(of) } : node.attrs.name);
    expect(root.children.map(of)).toEqual([
      "Director",
      { Set: ["Floor"] },
      { LIGHTS: ["Sun", { "s020 Track": ["Rim", "s020 Practical"] }] },
      { "s010 Wide": ["Wide", "s010 ship", "s010 ship path", "s010 Sky"] },
      { "s020 Track": ["Track", "s020 ship", "s020 ship path"] },
    ]);
    const nodes = all(root);
    const ship = (name: string) => nodes.find((node) => node.attrs.name === name)!;
    // A move that runs over the cut flies on both copies: the second goes on from where the first had got to at the cut, halfway in time.
    expect(ship("s010 ship").children[0]!.attrs).toMatchObject({ duration: "1000" });
    expect(ship("s020 ship").children[0]!.attrs).toMatchObject({ start: "1000", duration: "5000", lockedToEnd: "1" });
    expect(ship("s020 ship").attrs.position).toBe("0.000000,0.000000,0.000000");
    expect(ship("s020 ship path").children.map((marker) => marker.attrs.position)).toEqual(["0.000000,6.875000,0.000000", "0.000000,10.000000,0.000000"]);
    expect(ship("s020 ship").children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => curve.attrs.propertyName)).toEqual(["opacity"]);
  });

  it("walks an actor at its walk's own speed, whatever its scale", () => {
    expect(walkSpeed({ name: "Walk A", durationMs: 2567, moveSpeed: 38 })).toBeCloseTo(0.38);
    expect(walkSpeed({ name: "Walk B", durationMs: 1334, moveSpeed: 60 })).toBeCloseTo(0.6);
  });

  it("switches to the base Light", () => {
    expect(byTag("CCutsceneElementActiveLight")[0]!.attrs.lightID).toBe("KorhalNight");
  });
});

describe("a standing actor's steps to points", () => {
  /** A ship over one 6 s shot, its anims, Talk and follow path and the paths beside it, with `steps`. */
  const flown = (ship: Partial<StandingActor>, moves: ActorMove[]) => {
    const root = readCutscene(shotCutscene({ shots: [{ name: "Wide", durationMs: 6000, from: wide }], standing: [{ model: "Ship", name: "ship", at: [0, 0, 10], shots: [0], ...ship, moves }] }));
    const nodes = all(root);
    const actor = nodes.find((node) => node.tag === "CCutsceneNodeActor")!;
    const layer = (name: string) => actor.children.find((child) => child.tag === "CCutsceneNodeAnimLayer" && child.attrs.name === name)?.children.map((element) => element.attrs) ?? [];
    return {
      folder: root.children.find((node) => node.attrs.name === "s010 Wide")!.children.map((node) => node.attrs.name),
      anims: layer("Animation Layer"),
      talks: layer("Talk"),
      follows: actor.children.find((child) => child.tag === "CCutsceneNodeFollowPath")?.children.map((element) => element.attrs) ?? [],
      paths: nodes.filter((node) => node.tag === "CCutsceneNodePath").map((path) => ({ guid: path.attrs.guid, name: path.attrs.name, markers: path.children.map((marker) => marker.attrs.position) })),
      curves: actor.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => curve.attrs.propertyName),
    };
  };
  const speeds = (anims: readonly Record<string, string | undefined>[]) => anims.map((attrs) => [attrs.start ?? "0", attrs.duration, attrs.movespeed]);
  // Three straight legs along x: 10 cells in 1 s, 20 in 1 s, 10 in 2 s.
  const threeLegs: ActorMove[] = [
    { startMs: 0, durationMs: 1000, to: [10, 0, 10], move: "linear" },
    { startMs: 1000, durationMs: 1000, to: [30, 0, 10], move: "linear" },
    { startMs: 2000, durationMs: 2000, to: [40, 0, 10], move: "linear" },
  ];

  it("flies three steps along one path of four markers beside it, a movespeed a leg that covers it in its time, then stops at the last marker", () => {
    const { folder, anims, follows, paths, curves } = flown({}, threeLegs);
    expect(folder).toEqual(["Wide", "s010 ship", "s010 ship path"]);
    expect(paths).toEqual([{ guid: follows[0]!.pathGuid, name: "s010 ship path", markers: ["0.000000,0.000000,10.000000", "10.000000,0.000000,10.000000", "30.000000,0.000000,10.000000", "40.000000,0.000000,10.000000"] }]);
    // One follow from the first leg to the end of its life; it stops at the last marker.
    expect(follows).toEqual([{ guid: expect.any(String), duration: "6000", lockedToEnd: "1", pathGuid: paths[0]!.guid }]);
    // movespeed is 100 × cells a second. After the last leg its anim carries none.
    expect(speeds(anims)).toEqual([
      ["0", "1000", "1000.000000"],
      ["1000", "1000", "2000.000000"],
      ["2000", "2000", "500.000000"],
      ["4000", "2000", undefined],
    ]);
    expect(curves).toEqual([]);
  });

  it("gives a leg the same movespeed at any scale, since the pace along a path doesn't scale with the actor", () => {
    expect(speeds(flown({ scale: 0.5 }, threeLegs).anims)).toEqual(speeds(flown({}, threeLegs).anims));
  });

  it("holds still between legs, and ramps an eased leg's pace down as its curve would, covering the leg in its time", () => {
    const { anims } = flown({}, [
      { startMs: 1000, durationMs: 1000, to: [10, 0, 10], move: "linear" },
      { startMs: 3000, durationMs: 2000, to: [30, 0, 10] },
    ]);
    const paced = speeds(anims);
    expect(paced.slice(0, 3)).toEqual([
      ["0", "1000", undefined],
      ["1000", "1000", "1000.000000"],
      ["2000", "1000", "0.000000"],
    ]);
    const eased = anims.slice(3, 7).map((attrs) => Number(attrs.movespeed));
    expect(eased).toHaveLength(4);
    expect(eased.every((speed, at) => at === 0 || speed < eased[at - 1]!)).toBe(true);
    // 500 ms a piece: the four together cover the leg's 20 cells.
    expect(eased.reduce((sum, speed) => sum + (speed / 100) * 0.5, 0)).toBeCloseTo(20, 6);
  });

  it("keys a turn on the spot, a scale and a fade as curves, and never the position", () => {
    const { curves } = flown({}, [
      { startMs: 0, durationMs: 1000, rotation: [0, 0, 90] },
      { startMs: 1000, durationMs: 1000, to: [10, 0, 10], scale: [2, 1, 1], opacity: 0.5 },
    ]);
    expect(curves).toEqual(["rotationZ", "scaleX", "opacity"]);
  });

  it("starts a path of its own at a leg more than UNEVEN times longer or shorter than the one before, so the curve can't swing past the short one", () => {
    const { paths, follows } = flown({}, [
      { startMs: 0, durationMs: 1000, to: [10, 0, 10], move: "linear" },
      { startMs: 1000, durationMs: 1000, to: [11, 0, 10], move: "linear" },
      { startMs: 2000, durationMs: 1000, to: [12, 0, 10], move: "linear" },
      { startMs: 3000, durationMs: 1000, to: [42, 0, 10], move: "linear" },
    ]);
    expect(paths.map(({ markers }) => markers.map((marker) => Number(marker.split(",")[0])))).toEqual([[0, 10], [10, 11, 12], [12, 42]]);
    expect(follows.map((attrs) => attrs.start ?? "0")).toEqual(["0", "1000", "3000"]);
  });

  it("turns it off its path by a leg's facing along it, as its follow's rotation offset, a follow a stretch with one facing", () => {
    const { follows, paths } = flown({}, [
      { startMs: 0, durationMs: 1000, to: [10, 0, 10], move: "linear" },
      { startMs: 1000, durationMs: 1000, to: [20, 5, 10], along: [30, 0, 0], move: "linear" },
      { startMs: 2000, durationMs: 1000, to: [30, 5, 10], along: [30, 0, 0], move: "linear" },
      { startMs: 3000, durationMs: 1000, to: [40, 0, 10], move: "linear" },
    ]);
    expect(paths.map(({ name, markers }) => [name, markers.length])).toEqual([
      ["s010 ship path", 2],
      ["s010 ship path 2", 3],
      ["s010 ship path 3", 2],
    ]);
    expect(paths[1]!.markers[0]).toBe("10.000000,0.000000,10.000000");
    expect(follows.map((attrs) => [attrs.start ?? "0", attrs.duration, attrs.pathGuid, attrs.pathRotationOffset])).toEqual([
      ["0", "1000", paths[0]!.guid, undefined],
      ["1000", "2000", paths[1]!.guid, "30.000000,0.000000,0.000000"],
      ["3000", "3000", paths[2]!.guid, undefined],
    ]);
  });

  it("writes a walk that has a move speed of its own at a Walk's priority with that speed, playing on through each change of pace, and a Talk on the path with the pace too", () => {
    const walk = { name: "Walk", durationMs: 4000, moveSpeed: 300 };
    const { anims, talks } = flown(
      { anim: walk, animSpeed: 0.5, says: [{ lineId: "1", soundId: "S1", startMs: 500, durationMs: 1000, talk: { name: "Talk", durationMs: 2000 } }] },
      threeLegs,
    );
    expect(anims.slice(0, 3).map((attrs) => [attrs.start ?? "0", attrs.priority, attrs.originalDuration, attrs.originalMoveSpeed, attrs.movespeed, attrs.timeScale, attrs.startOffset])).toEqual([
      ["0", "5", "4000", "300.000000", "1000.000000", "0.500000", undefined],
      ["1000", "5", "4000", "300.000000", "2000.000000", "0.500000", "500"],
      ["2000", "5", "4000", "300.000000", "500.000000", "0.500000", "1000"],
    ]);
    // Off the path, its own priority and no pace.
    expect(anims[3]).toMatchObject({ start: "4000", priority: "3", startOffset: "2000" });
    expect(anims[3]!.movespeed).toBeUndefined();
    expect(talks.map((attrs) => [attrs.start, attrs.duration, attrs.movespeed, attrs.blendTime, attrs.blendOutTime, attrs.startOffset])).toEqual([
      ["500", "500", "1000.000000", "300", "0", undefined],
      ["1000", "500", "2000.000000", "0", "300", "500"],
    ]);
  });

  it("starts a run at its in-point (startOffset), each piece of it split by a change of pace going on from there, and a loop round its cycle", () => {
    const dialogue = { name: "Dialogue 08", durationMs: 30000 };
    const fidget = { name: "Fidget", durationMs: 4000 };
    const { anims } = flown({ animFrom: [{ startMs: 500, anim: dialogue, once: true, startOffsetMs: 10000 }, { startMs: 3000, anim: fidget, startOffsetMs: 3500 }] }, threeLegs);
    expect(anims.map((attrs) => [attrs.anim, attrs.start ?? "0", attrs.duration, attrs.originalDuration, attrs.looping, attrs.startOffset])).toEqual([
      ["Stand", "0", "500", undefined, "1", undefined],
      // The clip's whole length stays its originalDuration, as Blizzard's keep it beside a startOffset.
      ["Dialogue 08", "500", "500", "30000", undefined, "10000"],
      ["Dialogue 08", "1000", "1000", "30000", undefined, "10500"],
      ["Dialogue 08", "2000", "1000", "30000", undefined, "11500"],
      ["Fidget", "3000", "1000", "4000", "1", "3500"],
      // 3500 + 1000 into a 4000 ms loop: 500 into its next cycle.
      ["Fidget", "4000", "2000", "4000", "1", "500"],
    ]);
  });

  it("holds a run played once at its clip's end when a change of pace splits it past there, never writing a startOffset beyond it", () => {
    const { anims } = flown({ animFrom: [{ startMs: 0, anim: { name: "Dialogue 08", durationMs: 30000 }, once: true, startOffsetMs: 29500 }] }, threeLegs);
    expect(anims.map((attrs) => [attrs.start ?? "0", attrs.startOffset])).toEqual([
      ["0", "29500"],
      ["1000", "30000"],
      ["2000", "30000"],
      ["4000", "30000"],
    ]);
  });

  it("lets go of a copy at its last marker when it turns on the spot after its path, holding it there by keys and turning it from where the path left it facing", () => {
    const root = readCutscene(
      shotCutscene({
        shots: [{ name: "Wide", durationMs: 6000, from: wide }],
        standing: [
          {
            model: "Ship",
            name: "ship",
            at: [0, 0, 10],
            rotation: [0, 0, 180],
            shots: [0],
            moves: [
              { startMs: 0, durationMs: 2000, to: [10, 0, 10], rotation: [0, 0, 0], move: "linear" },
              { startMs: 3000, durationMs: 1000, rotation: [0, 0, 90] },
            ],
          },
        ],
      }),
    );
    const actor = all(root).find((node) => node.tag === "CCutsceneNodeActor")!;
    expect(actor.children.find((child) => child.tag === "CCutsceneNodeFollowPath")!.children.map(({ attrs }) => [attrs.start, attrs.duration])).toEqual([[undefined, "2000"]]);
    const curves = Object.fromEntries(actor.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => [curve.attrs.propertyName, curve.children.map(({ attrs }) => [attrs.start ?? "0", attrs.value])]));
    expect(curves.positionX).toEqual([
      ["2000", "10.000000"],
      ["6000", "10.000000"],
    ]);
    expect(curves.rotationZ).toEqual([
      ["0", "180.000000"],
      ["2000", "0.000000"],
      ["3000", "0.000000"],
      ["4000", "90.000000"],
    ]);
  });

  it("covers a leg shorter than a whole ms in one, so the path keeps its length", () => {
    const { anims } = flown({}, [
      { startMs: 0, durationMs: 1000, to: [10, 0, 10], move: "linear" },
      { startMs: 1000.2, durationMs: 0.2, to: [20, 0, 10], move: "linear" },
      { startMs: 1000.4, durationMs: 999.6, to: [30, 0, 10], move: "linear" },
    ]);
    const covered = anims.filter((attrs) => attrs.movespeed).reduce((sum, attrs) => sum + (Number(attrs.movespeed) / 100) * (Number(attrs.duration) / 1000), 0);
    expect(covered).toBeCloseTo(30, 6);
  });

  it("starts a copy where a jump at its birth lands it, and flies it on from there", () => {
    const { paths, anims } = flown({}, [
      { startMs: 0, durationMs: 1, to: [100, 0, 10] },
      { startMs: 1, durationMs: 999, to: [110, 0, 10], move: "linear" },
    ]);
    expect(paths[0]!.markers).toEqual(["100.000000,0.000000,10.000000", "110.000000,0.000000,10.000000"]);
    expect(speeds(anims)[1]).toEqual(["1", "999", expect.stringMatching(/^1001\.0/)]);
  });
});

describe("the --play loop for a Cinematic", () => {
  it("hides the UI with Cinematic Mode and a full screen, not Story Mode, which only Blizzard's maps may call", () => {
    const script = playCinematicScript("radio.SC2Cutscene");
    expect(script).not.toMatch(/StoryMode/);
    const on = script.indexOf("CinematicMode(PlayerGroupAll(), true, 0.0);");
    expect(on).toBeGreaterThan(-1);
    expect(script.indexOf("UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);")).toBeGreaterThan(on);
  });

  it("hides the map's environment, which would show through a set's windows, before the first run", () => {
    const script = playCinematicScript("radio.SC2Cutscene");
    const hidden = script.indexOf("EnvironmentShow(c_environmentAll, false);");
    expect(hidden).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(script.indexOf("CutscenePlay("));
  });

  it("leaves the environment showing when it's shown, for a Cinematic on the map's own ground", () => {
    const script = playCinematicScript("radio.SC2Cutscene", { environmentShown: true });
    expect(script).not.toContain("EnvironmentShow(");
    expect(script).toContain('Cinematic_cutscene = CutsceneCreateNew("Cutscenes\\\\radio.SC2Cutscene", Point(64, 64), 0.0, PlayerGroupAll(), false);');
    expect(script).not.toContain("DialogCreate(");
  });

  it("pauses the map's music and ambience under each run, and unpauses them after it, skipped or not", () => {
    const script = playCinematicScript("radio.SC2Cutscene");
    const play = script.indexOf("CutscenePlay(");
    const stop = script.indexOf("CutsceneStop(Cinematic_cutscene);");
    for (const category of ["Music", "Ambience"]) {
      const pause = script.indexOf(`SoundtrackPause(PlayerGroupAll(), c_soundtrackCategory${category}, true, true);`);
      const unpause = script.indexOf(`SoundtrackPause(PlayerGroupAll(), c_soundtrackCategory${category}, false, true);`);
      expect(pause, category).toBeGreaterThan(script.indexOf("while (true)"));
      expect(pause, category).toBeLessThan(play);
      expect(unpause, category).toBeGreaterThan(stop);
    }
  });

  it("pauses and hides the map's units for the session too, before the first run, since they'd show through a set's gaps", () => {
    const script = playCinematicScript("radio.SC2Cutscene");
    const loop = script.indexOf("while (true)");
    for (const statement of ["units = UnitGroup(null, c_playerAny, RegionEntireMap(), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0);", "libNtve_gf_PauseUnit(picked, true);", "libNtve_gf_ShowHideUnit(picked, false);"]) {
      const at = script.indexOf(statement);
      expect(at, statement).toBeGreaterThan(-1);
      expect(at, statement).toBeLessThan(loop);
    }
  });
});

describe("attachments", () => {
  // Two shots of a ship with a fire riding its hull and a camera riding an invisible marine, each copied into both shots.
  const root = readCutscene(
    shotCutscene({
      shots: [
        { name: "Wide", durationMs: 2000, from: wide, to: { ...wide, distance: 40, target: [0, 0, 0] }, shake: { startMs: 0, durationMs: 2000, amplitude: 0.2, hz: 4 }, attach: { actor: 2, point: "Ref_Head", offset: [0, 0, -0.6] } },
        { name: "Close", durationMs: 3000, from: low },
      ],
      standing: [
        { model: "Ship", name: "ship", at: [10, 20, 5], shots: [0, 1] },
        { model: "Fire", name: "fire", at: [99, 99, 99], rotation: 45, scale: 2, opacity: 0.5, anim: "Birth", shots: [0, 1], attach: { actor: 0, point: "Ref_Damage 03", offset: [0, 1, 0], rotation: [0, 0, 90] }, moves: [{ startMs: 2500, durationMs: 500, opacity: 0 }] },
        { model: "MarineXPR", name: "rig", at: [1, 2, 3], opacity: 0, anim: "Flail", shots: [0] },
      ],
    }),
  );
  const nodes = all(root);
  const named = (name: string) => nodes.find((node) => node.attrs.name === name)!;
  const attachmentOf = (node: CutsceneNode) => node.children.find((child) => child.tag === "CCutsceneNodeAttachment")?.children.map(({ attrs: { guid: _guid, ...attrs } }) => attrs);

  it("rides a copy on the other actor's copy in its shot, over its own life, after its anim layers as the Editor writes it", () => {
    expect(attachmentOf(named("s010 fire"))).toEqual([
      { duration: "2000", attachGuid: named("s010 ship").attrs.guid, attachName: "Ref_Damage 03", offsetX: "0.000000", offsetY: "1.000000", offsetZ: "0.000000", rotationX: "0.000000", rotationY: "0.000000", rotationZ: "90.000000" },
    ]);
    expect(attachmentOf(named("s020 fire"))).toEqual([expect.objectContaining({ start: "2000", duration: "3000", lockedToEnd: "1", attachGuid: named("s020 ship").attrs.guid })]);
    expect(named("s020 fire").children.map((child) => child.tag)).toEqual(["CCutsceneElementObject", "CCutsceneNodeAnimLayer", "CCutsceneNodeAttachment", "CCutsceneNodePropertyValue"]);
  });

  it("gives a rider no position or rotation of its own, which its attach point gives, and keeps its scale, opacity, anim and fades", () => {
    const fire = named("s020 fire");
    expect(fire.attrs.position).toBeUndefined();
    expect(fire.attrs.rotation).toBeUndefined();
    expect(fire.attrs).toMatchObject({ scale: "2.000000,2.000000,2.000000", opacity: "0.500000" });
    expect(fire.children[1]!.children[0]!.attrs.anim).toBe("Birth");
    expect(fire.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => curve.attrs.propertyName)).toEqual(["opacity"]);
  });

  it("rides a shot's camera on an actor's copy from its cut to its end, as a handheld camera rides an invisible marine's head, keeping its own target as its position", () => {
    const camera = named("Wide");
    expect(camera.attrs.position).toBe("48.000000,74.000000,9.000000");
    expect(camera.children.map((child) => child.tag)).toEqual(["CCutsceneElementObject", "CCutsceneNodeAttachment", "CCutsceneNodePropertyValue"]);
    expect(attachmentOf(camera)).toEqual([
      { duration: "2000", attachGuid: named("s010 rig").attrs.guid, attachName: "Ref_Head", offsetX: "0.000000", offsetY: "0.000000", offsetZ: "-0.600000", rotationX: "0.000000", rotationY: "0.000000", rotationZ: "0.000000" },
    ]);
  });

  it("keys a riding camera's move but not its target, which the actor carries, and leaves out a shake of it", () => {
    const curves = named("Wide").children.filter((child) => child.tag === "CCutsceneNodePropertyValue");
    expect(curves.map((curve) => curve.attrs.propertyName)).toEqual(["distance"]);
    expect(curves[0]!.children).toHaveLength(2);
    expect(attachmentOf(named("Close"))).toBeUndefined();
  });

  it("rides only while the actor it rides exists: a camera on a carrier that enters late, and a rider that outlives its carrier", () => {
    const later = all(
      readCutscene(
        shotCutscene({
          shots: [{ name: "Wide", durationMs: 4000, from: wide, attach: { actor: 0, point: "Ref_Head" } }],
          standing: [
            { model: "MarineXPR", name: "rig", at: [0, 0, 0], shots: [0], fromMs: 1500, untilMs: 3000 },
            { model: "Fire", name: "fire", at: [0, 0, 0], shots: [0], attach: { actor: 0, point: "Ref_Center" } },
          ],
        }),
      ),
    );
    const find = (name: string) => later.find((node) => node.attrs.name === name)!;
    expect(attachmentOf(find("Wide"))).toEqual([expect.objectContaining({ start: "1500", duration: "1500", attachGuid: find("s010 rig").attrs.guid })]);
    expect(attachmentOf(find("s010 fire"))).toEqual([expect.objectContaining({ start: "1500", duration: "1500" })]);
  });

  it("refuses a camera riding an actor with no copy in its shot", () => {
    expect(() => shotCutscene({ shots: [{ name: "Wide", durationMs: 1000, from: wide, attach: { actor: 0, point: "Ref_Head" } }, { name: "Close", durationMs: 1000, from: low }], standing: [{ model: "MarineXPR", name: "rig", at: [0, 0, 0], shots: [1] }] })).toThrow(
      "Shot 0's camera rides rig, which doesn't exist in that shot",
    );
  });
});

describe("shotCutscene bookmarks", () => {
  const shots = [{ name: "Only", durationMs: 6000, from: wide }];
  const bookmarks = (spec: Parameters<typeof shotCutscene>[0]): CutsceneNode[] => all(readCutscene(shotCutscene(spec))).filter((node) => node.tag === "CCutsceneElementBookmark");

  it("writes a bookmark track on the Director, in time order, with a start only where it isn't 0", () => {
    const root = readCutscene(shotCutscene({ shots, bookmarks: [{ name: "Late", atMs: 4500 }, { name: "Early", atMs: 0 }, { name: "Mid", atMs: 1500 }] }));
    const director = root.children.find((node) => node.tag === "CCutsceneNodeDirector")!;
    const track = director.children.find((node) => node.tag === "CCutsceneNodeBookmark")!;
    expect(track.attrs.name).toBe("Bookmarks");
    expect(track.children.map((mark) => [mark.attrs.bookmarkName, mark.attrs.start])).toEqual([
      ["Early", undefined],
      ["Mid", "1500"],
      ["Late", "4500"],
    ]);
  });

  it("writes no track without bookmarks, and leaves the rest of the file as it was", () => {
    expect(bookmarks({ shots })).toEqual([]);
    expect(shotCutscene({ shots, bookmarks: [] })).toBe(shotCutscene({ shots }));
  });

  it("allows a bookmark anywhere up to the end, bookends included", () => {
    expect(bookmarks({ shots, bookends: true, bookmarks: [{ name: "End", atMs: 6000 + 3000 }] })).toHaveLength(1);
  });

  it("refuses an empty name, since a trigger can't listen for one", () => {
    expect(() => shotCutscene({ shots, bookmarks: [{ name: " ", atMs: 100 }] })).toThrow(/needs a name/);
  });

  it("refuses a bookmark outside the timeline", () => {
    expect(() => shotCutscene({ shots, bookmarks: [{ name: "Late", atMs: 6001 }] })).toThrow(/Late is at 6001 ms, outside the cutscene's 0 to 6000 ms/);
    expect(() => shotCutscene({ shots, bookmarks: [{ name: "Early", atMs: -1 }] })).toThrow(/outside/);
  });
});
