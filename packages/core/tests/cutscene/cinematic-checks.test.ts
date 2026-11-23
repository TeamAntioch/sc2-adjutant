// The cinematography checks the checker runs on each Cinematic's timeline (CHECKS.md "Cinematic"):
// the `cinematic` fixture Workspace's Radio Field plays its two lines as two shots, timed at check
// time by the estimate (0.91 s + 0.39 s a word: 2.86 s and 9.88 s), since it has no voice files.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type CinematicTiming, timingProblems } from "../../src/cutscene/cinematic-checks.js";
import { checkWorkspace, formatWorkspaceCheck } from "../../src/plugins/check-workspace.js";
import { connect, copyOf, text } from "../mcp/harness.js";

const CINEMATIC = "missions/radio-field/cinematics/radio.json";

/** A copy of the fixture with its Cinematic changed by `edit`. */
async function workspaceWith(edit: (cinematic: any) => void): Promise<string> {
  const root = await copyOf("cinematic");
  const cinematic = JSON.parse(await readFile(path.join(root, CINEMATIC), "utf8"));
  edit(cinematic);
  await writeFile(path.join(root, CINEMATIC), JSON.stringify(cinematic));
  return root;
}

/** The fixture with its Cinematic changed by `edit`, checked: each problem with its severity, but the notes that its cast models have no Model Guide. */
async function checkedWith(edit: (cinematic: any) => void) {
  return (await checkWorkspace(await workspaceWith(edit))).problems.filter(({ severity }) => severity !== "note").map(({ path, message, severity }) => ({ ...(path ? { path } : {}), message, ...(severity ? { severity } : {}) }));
}

/** `count` shots with no line after the fixture's two, each held `ms`. */
const silent = (count: number, ms: number) => Array.from({ length: count }, () => ({ camera: "room/Wide", afterMs: 0, pauseAfterMs: ms }));

describe("T4: a Cinematic's length", () => {
  it("passes a story cinematic of about a minute or less", async () => {
    expect(await checkedWith(() => {})).toEqual([]);
  });

  it("is a review item past about a minute, and a warning past 140 s, timed by the estimate", async () => {
    // 16.74 s for the two lines and the bookends, and 7 s a silent shot.
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(7, 7000)))).toEqual([
      { message: "T4: it runs 65.7 s, over the about 60 s of a story cinematic; review what could go (2 of 2 lines timed by the estimate)", severity: "review" },
    ]);
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(18, 7000)))).toEqual([
      { message: "T4: it runs 142.7 s, over the 140 s warning for a story cinematic (about 60 s); review what could go (2 of 2 lines timed by the estimate)", severity: "warning" },
    ]);
  });

  it("holds an insert to about 15 s, and warns past 40 s", async () => {
    expect(await checkedWith((cinematic) => (cinematic.kind = "insert"))).toEqual([
      { message: "T4: it runs 16.7 s, over the about 15 s of an insert; review what could go (2 of 2 lines timed by the estimate)", severity: "review" },
    ]);
    expect(await checkedWith((cinematic) => ((cinematic.kind = "insert"), cinematic.shots.push(...silent(4, 6000))))).toEqual([
      { message: "T4: it runs 40.7 s, over the 40 s warning for an insert (about 15 s); review what could go (2 of 2 lines timed by the estimate)", severity: "warning" },
    ]);
  });
});

describe("C4: shot lengths", () => {
  it("passes shots of 1-12 s whose median is 3-7.3 s", async () => {
    // 3.86 s (the fade in and the first line) and 9.88 s.
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(1, 4000)))).toEqual([]);
  });

  it("warns of a shot over 12 s or under 1 s", async () => {
    expect(await checkedWith((cinematic) => cinematic.shots.splice(1))).toEqual([{ path: "shots.0", message: "C4: shot 0 runs 13.7 s, over the 12 s a cinematic's shots keep to", severity: "warning" }]);
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(1, 500), ...silent(1, 4000)))).toEqual([{ path: "shots.2", message: "C4: shot 2 runs 0.5 s, under the 1 s a cinematic's shots keep to", severity: "warning" }]);
  });

  it("warns of a scene whose median shot runs outside 3-7.3 s", async () => {
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(3, 1500)))).toEqual([{ message: "C4: its median shot runs 1.5 s, outside a cinematic's 3-7.3 s", severity: "warning" }]);
    expect(await checkedWith((cinematic) => cinematic.shots.push(...silent(3, 9000)))).toEqual([{ message: "C4: its median shot runs 9.0 s, outside a cinematic's 3-7.3 s", severity: "warning" }]);
  });
});

describe("shots held past their lines", () => {
  it("passes a shot that holds up to 2 s after its lines", async () => {
    expect(await checkedWith((cinematic) => ((cinematic.shots[0].pauseAfterMs = 2000), cinematic.shots.push(...silent(1, 4000))))).toEqual([]);
  });

  it("warns of a shot that holds longer after its lines", async () => {
    expect(await checkedWith((cinematic) => ((cinematic.shots[0].pauseAfterMs = 2500), cinematic.shots.push(...silent(1, 4000))))).toEqual([
      { path: "shots.0", message: "Shot 0 holds 2.5 s after its lines end, over the 2 s a shot is the line it plays under", severity: "warning" },
    ]);
  });
});

describe("a cut inside a line", () => {
  const into = (ms: number) => (cinematic: any) => cinematic.shots.push({ camera: "room/Wide", line: "radio_field-1-2", intoLineMs: ms });

  it("passes a cut inside its line", async () => {
    expect(await checkedWith(into(5000))).toEqual([]);
  });

  it("warns of a cut past its line's end, as timed now, and skips the checks on a timeline it can't build", async () => {
    expect(await checkedWith(into(10_000))).toEqual([
      { path: "shots.2.intoLineMs", message: "It cuts 10000 ms into radio_field-1-2, which runs 9880 ms by the estimate, so the Cinematic won't compile until the line is longer or the cut earlier; its other timing checks wait for that", severity: "warning" },
    ]);
  });
});

describe("a cast member's move", () => {
  const moving = (steps: unknown[]) => (cinematic: any) => (cinematic.shots[1].moves = { visitor: steps });

  it("passes steps inside their shot, and a last step that takes the rest of it", async () => {
    expect(await checkedWith(moving([{ to: [0, 0, 0], afterMs: 1000, ms: 2000 }, { to: [0, 1, 0] }]))).toEqual([]);
  });

  it("warns of steps that run to or past their shot's end, as timed now", async () => {
    // The second shot carries the 9.88 s line.
    // The second shot is the last, so its steps may run on through the 1 s fade out, to 10880 ms.
    expect(await checkedWith(moving([{ to: [0, 0, 0], afterMs: 5000, ms: 5000 }]))).toEqual([]);
    expect(await checkedWith(moving([{ to: [0, 0, 0], afterMs: 5000, ms: 6000 }]))).toEqual([
      { path: "shots.1.moves.visitor", message: "Its steps run 11000 ms, to or past the fade out's end at 10880 ms, so the Cinematic won't compile until the shot is longer or the steps shorter", severity: "warning" },
    ]);
    expect(await checkedWith(moving([{ to: [0, 0, 0], ms: 9880 }, { to: [0, 1, 0] }]))).toHaveLength(1);
  });

  it("warns of a member entering or exiting past its shot's end, and a light's steps that run past it", async () => {
    const problems = await checkedWith((cinematic: any) => {
      cinematic.shots[1].enters = { visitor: 9880 };
      cinematic.shots[1].exits = { operator: 9881 };
      cinematic.shots[1].set = "room";
      cinematic.shots[1].camera = { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 };
      cinematic.shots[1].lights = [{ name: "Flash", at: [0, 0, 1], color: [1, 1, 1], strength: 0, range: 2, steps: [{ strength: 10, afterMs: 9000, ms: 1000 }] }];
    });
    expect(problems).toEqual([
      { path: "shots.1.lights.0.steps", message: "Its steps run 10000 ms, to or past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the steps shorter", severity: "warning" },
      { path: "shots.1.enters.visitor", message: "It enters visitor 9880 ms in, past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the time earlier", severity: "warning" },
      { path: "shots.1.exits.operator", message: "It exits operator 9881 ms in, past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the time earlier", severity: "warning" },
    ]);
  });

  it("warns of a timed anim that starts at or past its shot's end", async () => {
    expect(await checkedWith((cinematic) => (cinematic.shots[1].anims = { visitor: { anim: "Stand", atMs: 9880 } }))).toEqual([
      { path: "shots.1.anims.visitor", message: "Its anim starts 9880 ms in, at or past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the anim earlier", severity: "warning" },
    ]);
  });
});

// A generated timeline ends, and plays every line inside its shots, by construction; these checks
// guard the timing the writer is given, so they're tried on timings written out by hand.
describe("F1, F3 and lines with no shot, on a timing", () => {
  /** Two 4 s shots after a 1 s fade in, a 3 s line in each, then the fade out and 2 s of black. */
  const timing = (change: Partial<CinematicTiming> = {}): CinematicTiming => ({
    shots: [
      { startMs: 0, durationMs: 4000 },
      { startMs: 4000, durationMs: 4000 },
    ],
    lines: [
      { soundId: "a", startMs: 1000, durationMs: 3000 },
      { soundId: "b", startMs: 4000, durationMs: 3000 },
    ],
    fadeInMs: 1000,
    fadeOutMs: 8000,
    endSceneMs: 11_000,
    ...change,
  });

  it("passes a timeline that ends after its lines, with every line on a shot before the fade", () => {
    expect(timingProblems(timing(), "story")).toEqual([]);
  });

  it("F1: is an error with no End Scene marker, one at t=0, or one before the last line ends", () => {
    expect(timingProblems(timing({ endSceneMs: undefined }), "story")).toEqual([{ message: "F1: it has no End Scene marker, so WaitForCutsceneToEnd never returns" }]);
    expect(timingProblems(timing({ endSceneMs: 0 }), "story")).toEqual([{ message: "F1: its End Scene marker is at t=0, so it ends as it starts" }]);
    expect(timingProblems(timing({ endSceneMs: 6000, fadeOutMs: 6000, shots: [{ startMs: 0, durationMs: 4000 }, { startMs: 4000, durationMs: 2000 }] }), "story")).toContainEqual({
      message: "F1: its End Scene marker at 6.0 s comes before its last line, b, ends at 7.0 s",
    });
  });

  it("F3: warns of a line or a shot that runs on into the fade to black", () => {
    expect(timingProblems(timing({ fadeOutMs: 6500, shots: [{ startMs: 0, durationMs: 4000 }, { startMs: 4000, durationMs: 4000 }] }), "story")).toEqual([
      { path: "shots.1", message: "F3: shot 1 runs on to 8.0 s, past the fade to black at 6.5 s", severity: "warning" },
      { message: "F3: line b runs to 7.0 s, past the fade to black at 6.5 s, so it's cut off", severity: "warning" },
    ]);
  });

  it("warns of a line that plays with no shot on screen: under the fade in, between shots, or after the last shot", () => {
    const lines = [
      { soundId: "a", startMs: 500, durationMs: 3000 },
      { soundId: "b", startMs: 4000, durationMs: 3000 },
      { soundId: "c", startMs: 8000, durationMs: 0 },
    ];
    expect(timingProblems(timing({ lines }), "story")).toEqual([
      { message: "Line a starts at 0.5 s, under the fade in, with no shot on screen", severity: "warning" },
      { message: "Line c starts at 8.0 s, after the last shot, with no shot on screen", severity: "warning" },
    ]);
    const gap = [
      { startMs: 0, durationMs: 4000 },
      { startMs: 4500, durationMs: 3500 },
    ];
    expect(timingProblems(timing({ shots: gap, lines: [{ soundId: "a", startMs: 1000, durationMs: 3000 }, { soundId: "b", startMs: 4000, durationMs: 3000 }] }), "story")).toEqual([
      { message: "Line b starts at 4.0 s, between shots, with no shot on screen", severity: "warning" },
    ]);
  });
});

describe("a Cinematic's warnings and review items", () => {
  it("are reported, each marked, but leave its Mission valid and the check_workspace reply no error", async () => {
    const root = await workspaceWith((cinematic) => cinematic.shots.push(...silent(18, 7000)));
    const check = await checkWorkspace(root);
    expect(formatWorkspaceCheck(check).split("\n")).toEqual([
      expect.stringMatching(new RegExp(`^radio-field: ${CINEMATIC} cast\\.0\\.model: note: SMX3_BGPeople_01 has recorded animations but no Model Guide`)),
      expect.stringMatching(new RegExp(`^radio-field: ${CINEMATIC} cast\\.1\\.model: note: SMX3_BGPeople_06 has recorded animations but no Model Guide`)),
      `radio-field: ${CINEMATIC}: warning: T4: it runs 142.7 s, over the 140 s warning for a story cinematic (about 60 s); review what could go (2 of 2 lines timed by the estimate)`,
      `1 Mission(s) in ${root} are valid, with 1 warning(s), 0 review item(s) and 2 note(s).`,
    ]);
    const reply = await (await connect(root)).callTool({ name: "check_workspace", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toBe(formatWorkspaceCheck(check));
    expect(reply.structuredContent).toMatchObject({ problems: [{ mission: "radio-field", severity: "note" }, { mission: "radio-field", severity: "note" }, { mission: "radio-field", severity: "warning" }] });
  });

  it("are counted apart from the errors that fail the check", () => {
    const review = { mission: "radio-field", file: CINEMATIC, message: "T4: it runs 64.7 s", severity: "review" as const };
    const broken = { mission: "broken-field", file: "missions/broken-field/blueprint.json", message: "Broken" };
    expect(formatWorkspaceCheck({ root: "/w", missions: ["broken-field", "radio-field"], problems: [broken, review] }).split("\n")).toEqual([
      "broken-field: missions/broken-field/blueprint.json: Broken",
      `radio-field: ${CINEMATIC}: review: T4: it runs 64.7 s`,
      "1 problem(s) in 1 of 2 Mission(s), in /w, with 0 warning(s) and 1 review item(s).",
    ]);
  });
});

describe("a camera's path and shake", () => {
  const own = (yaw: number) => ({ target: [0, 1, 1], distance: 4, pitch: 5, yaw, fov: 20 });

  it("passes a path and a shake inside their shot", async () => {
    expect(await checkedWith((cinematic) => ((cinematic.shots[1].path = [{ atMs: 4000, camera: own(30) }, { camera: own(60) }]), (cinematic.shots[1].shake = { atMs: 8000, amplitude: 0.2, hz: 5 })))).toEqual([]);
  });

  it("warns of a path key or a shake past its shot's end, as timed now", async () => {
    // The second shot carries the 9.88 s line.
    const problems = await checkedWith((cinematic) => ((cinematic.shots[1].path = [{ atMs: 4000, camera: own(30) }, { atMs: 9900, camera: own(60) }]), (cinematic.shots[1].shake = { atMs: 9000, ms: 1000, amplitude: 0.2, hz: 5 })));
    expect(problems).toEqual([
      { path: "shots.1.path.1.atMs", message: "Its camera reaches this key 9900 ms in, past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the time earlier", severity: "warning" },
      { path: "shots.1.shake", message: "Its shake runs 10000 ms, to or past the shot's end at 9880 ms, so the Cinematic won't compile until the shot is longer or the shake shorter", severity: "warning" },
    ]);
  });
});

describe("two path keys at a shot's end", () => {
  it("warns of a key before the last at the shot's end, where the last one lands too", async () => {
    const own = { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 30, fov: 20 };
    expect(await checkedWith((cinematic) => (cinematic.shots[1].path = [{ atMs: 9880, camera: own }, { camera: { ...own, yaw: 60 } }]))).toEqual([
      { path: "shots.1.path.0.atMs", message: "Its camera reaches this key at the shot's end, 9880 ms in, before its last key, so the Cinematic won't compile until the shot is longer or the time earlier", severity: "warning" },
    ]);
  });
});
