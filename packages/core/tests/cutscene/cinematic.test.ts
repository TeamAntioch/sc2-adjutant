// A Cinematic compiled with its Mission: the `cinematic` fixture Workspace's Radio Field plays its
// two-line scene 1 as a Cinematic on a tiny imported set, the radio room, with one held shot a line.
// The written .SC2Cutscene is read back as nodes, and through the research's timeline.py.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { castClips, cinematicTimeline, lineLengthsMs, turnedTo } from "../../src/cutscene/cinematic.js";
import { CinematicSchema } from "../../src/domain/cinematic.js";
import { worldFacing } from "../../src/cutscene/turns.js";
import { cameraEye } from "../../src/cutscene/import-set.js";
import { feedRig } from "../../src/cutscene/feeds.js";
import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace, type WorkspaceCheck } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import type { ScriptLine } from "../../src/script/name-script.js";
import { connect, copyOf, tempFolder, text } from "../mcp/harness.js";

const TIMELINE = fileURLToPath(new URL("../../../../tools/cutscene/timeline.py", import.meta.url));
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
/** A check's problems but its notes, such as that the fixture's cast models have no Model Guide. */
const unnoted = (check: WorkspaceCheck) => check.problems.filter(({ severity }) => severity !== "note");
/** The cutscene's top-level nodes as its folders hold them: a folder as { name: contents }, any other node by its name. */
const layout = (nodes: CutsceneNode[]): unknown[] => {
  const of = (node: CutsceneNode): unknown => (node.tag === "CCutsceneNodeFolder" ? { [node.attrs.name!]: node.children.map(of) } : node.attrs.name);
  return nodes[0]!.children.map(of);
};

/**
 * Compiles the fixture's Radio Field into a fresh map, its Cinematic changed by `edit` first, and
 * its radio room and hall sets by `editSet` and `editHall`; its voice lines are core's silent
 * placeholders (3 s and 11 s).
 */
async function compiled(edit?: (cinematic: any) => void, editSet?: (set: any) => void, editHall?: (set: any) => void): Promise<{ map: string; file: string; nodes: CutsceneNode[] }> {
  const root = await copyOf("cinematic");
  for (const [name, change] of [["cinematics/radio.json", edit], ["sets/radio-room.json", editSet], ["sets/radio-hall.json", editHall]] as const) {
    if (!change) continue;
    const file = path.join(root, "missions/radio-field", name);
    const data = JSON.parse(await readFile(file, "utf8"));
    change(data);
    await writeFile(file, JSON.stringify(data));
  }
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), path.join(root, "missions/radio-field/blueprint.json"), map);
  const file = path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene");
  return { map, file, nodes: all(readCutscene(await readFile(file, "utf8"))) };
}

describe("a compiled Cinematic", () => {
  it("fades in, cuts on each line's start, plays the lines in order, and ends after 2 s of black", async () => {
    const { map, file } = await compiled();
    if (!hasPython) return;
    const run = spawnSync("python3", ["-I", TIMELINE, file, map], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout.trimEnd().split(/\r?\n/)).toEqual([
      "   0.00  CUT   Wide  (fov 40.0 distance 10.0 pitch 10.0)",
      "   0.00  FADE  in 1.0s",
      "   0.00  LIGHT RoomLight blend 0",
      "   1.00  LINE  ?: Zeratul, do you read me?  [~2.9s]",
      "   4.00  CUT   Close  (fov 18.0 distance 3.0 pitch 5.0)",
      "   4.00  LINE  ?: Loud and clear. The lava is rising on the far side of the field, so get to the cave before it reaches you.  [~9.9s]",
      "  15.00  FADE  out 1.0s",
      "  18.00  END   End Scene",
    ]);
  });
});

describe("a compiled Cinematic's set and cast", () => {
  it("writes a folder a shot, numbered in tens, with its camera and its own copy of each member and piece it shows; what's in every shot stands at the top level", async () => {
    const { nodes } = await compiled();
    // The shelf is tied only to a camera no shot uses, and the crate was switched off: neither is written.
    // The operator's mark was seen only through the wide camera (and one no shot uses), so the close shot has no copy of them.
    // The Key lamp is tied to the close camera, so it's copied into that shot's lights; the Fill lights every shot.
    expect(layout(nodes)).toEqual([
      "Director",
      { Set: ["room RoomFloor", "room RadioDesk"] },
      { LIGHTS: ["Fill", { "s020 Close": ["s020 Key"] }] },
      { "s010 Wide": ["Wide", "s010 operator", "s010 visitor"] },
      { "s020 Close": ["Close", "s020 room RadioScreen", "s020 visitor"] },
    ]);
    const actors = nodes.filter((node) => node.tag === "CCutsceneNodeActor");
    expect(actors.map((actor) => [actor.attrs.name, actor.attrs.position])).toEqual([
      ["room RoomFloor", "10.000000,0.000000,0.000000"],
      ["room RadioDesk", "11.000000,2.000000,0.000000"],
      ["s010 operator", "11.000000,1.000000,0.000000"],
      ["s010 visitor", "8.000000,1.000000,0.000000"],
      ["s020 room RadioScreen", "10.000000,4.000000,1.000000"],
      ["s020 visitor", "8.000000,1.000000,0.000000"],
    ]);
    expect(actors[1]!.attrs).toMatchObject({ rotation: "0.000000,0.000000,90.000000", scale: "1.000000,-1.000000,1.000000", variation: "2", tintColorBlue: "1.000000" });
    expect(actors[2]!.attrs).toMatchObject({ modelLink: "SMX3_BGPeople_01", rotation: "0.000000,0.000000,90.000000" });
    expect(actors[3]!.attrs).toMatchObject({ modelLink: "SMX3_BGPeople_06", rotation: "0.000000,0.000000,-90.000000", scale: "0.500000,0.500000,0.500000" });
    // What stands at the top level lives all through; a copy from its shot's cut to its end, the last shot's on to the timeline's end.
    expect(actors.map((actor) => [actor.children[0]!.attrs.start ?? "0", actor.children[0]!.attrs.duration, actor.children[0]!.attrs.lockedToEnd])).toEqual([
      ["0", "18000", "1"],
      ["0", "18000", "1"],
      ["0", "4000", undefined],
      ["0", "4000", undefined],
      ["4000", "14000", "1"],
      ["4000", "14000", "1"],
    ]);
    // No copy needs hiding from a shot.
    expect(nodes.filter((node) => node.tag === "CCutsceneNodeActiveShot" && node.attrs.cameraGUID !== nodes.find((camera) => camera.attrs.name === "Close")!.attrs.guid)).toEqual([]);
    const lamps = nodes.filter((node) => node.tag === "CCutsceneNodeLight");
    expect(lamps.map((lamp) => [lamp.attrs.name, lamp.attrs.type, lamp.attrs.position, lamp.children[0]!.attrs.start ?? "0", lamp.children[0]!.attrs.duration])).toEqual([
      ["Fill", "2", "9.000000,0.000000,3.000000", "0", "18000"],
      ["s020 Key", "1", "11.000000,0.000000,3.000000", "4000", "14000"],
    ]);
    expect(lamps[0]!.attrs).toMatchObject({ rotation: "0.000000,-30.000000,90.000000", hotspot: "0.500000", shadowCasting: "0" });
  });

  it("films each shot through its set camera, moved by the offset, with the camera's own height offset, roll and lens flag", async () => {
    const { nodes } = await compiled();
    const [wide, close] = nodes.filter((node) => node.tag === "CCutsceneNodeCamera");
    expect(wide!.attrs).toMatchObject({ position: "10.000000,1.000000,1.500000", heightOffset: "-0.500000", verticalFOV: "1", fov: "40.000000" });
    expect(close!.attrs).toMatchObject({ position: "11.000000,1.000000,1.600000", roll: "2.000000", depthOfField: "0.200000", focalDepth: "2.500000" });
    expect(close!.attrs.verticalFOV).toBeUndefined();
  });

  it("writes a set camera back as it was imported: at its position, with no rig, so the game films from the same eye", async () => {
    const { nodes } = await compiled();
    const [wide] = nodes.filter((node) => node.tag === "CCutsceneNodeCamera");
    // The set's Wide: target (0, 1, 1.5) at offset (10, 0, 0), distance 10, pitch 10, yaw 180, height offset -0.5.
    expect(wide!.attrs).toMatchObject({ position: "10.000000,1.000000,1.500000", distance: "10.000000", pitch: "10.000000", yaw: "180.000000", heightOffset: "-0.500000" });
    expect(wide!.children.some((child) => child.tag === "CCutsceneNodeAttachment")).toBe(false);
    const eye = cameraEye({ target: [10, 1, 1.5], distance: 10, pitch: 10, yaw: 180, heightOffset: -0.5 });
    expect(eye.map((value) => Math.round(value * 1000) / 1000)).toEqual([10, -8.848, 2.736]);
  });

  it("plays a piece's looping Stand at its recorded length, or the piece's own anim, keeping its tint and opacity; a piece whose model isn't recorded stands as it is", async () => {
    // SMX3_BGPeople_02's Stand is 2600 ms long, SMX3_BGPeople_07's Stand Cover 02 2000 ms (data/model-anims.json).
    const { nodes } = await compiled(undefined, (set) => {
      set.pieces[0] = { model: "SMX3_BGPeople_02", at: [0, 0, 0], tint: [1, 0.5, 0.5], opacity: 0.5 };
      set.pieces[1] = { model: "SMX3_BGPeople_07", at: [1, 2, 0], anim: "Stand Cover 02" };
    });
    const actors = nodes.filter((node) => node.tag === "CCutsceneNodeActor");
    const clipOf = (name: string) => actors.find((actor) => actor.attrs.name === name)!.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children[0]!.attrs;
    expect(clipOf("room SMX3_BGPeople_02")).toMatchObject({ anim: "Stand", originalDuration: "2600", looping: "1", lockedToEnd: "1", duration: "18000" });
    expect(actors.find((actor) => actor.attrs.name === "room SMX3_BGPeople_02")!.attrs).toMatchObject({ tintColorRed: "1.000000", tintColorGreen: "0.500000" });
    expect(clipOf("room SMX3_BGPeople_07")).toMatchObject({ anim: "Stand Cover 02", originalDuration: "2000", looping: "1" });
    expect(clipOf("s020 room RadioScreen").originalDuration).toBeUndefined();
    // A copy's anim runs through its shot.
    expect(clipOf("s020 room RadioScreen")).toMatchObject({ anim: "Stand", looping: "1", start: "4000", duration: "14000" });
  });

  it("writes a cast member's own-frame facing as the engine's world-axis rotation", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast[1].facing = { heading: 90, roll: -28 };
    });
    const visitor = nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === "s010 visitor")!;
    expect(visitor.attrs.rotation).toBe("0.000000,-28.000000,90.000000");
  });

  it("plays a piece's, a member's and a shot's timed anim at their animSpeed, its clip's own length kept", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.cast[1].animSpeed = 2;
        cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02", atMs: 1000 }, { anim: "Stand Cover Talk", atMs: 3000, speed: 1.5 }] };
      },
      (set) => {
        set.pieces[0] = { model: "SMX3_BGPeople_02", at: [0, 0, 0], animSpeed: 0.5 };
      },
    );
    const clips = (name: string) =>
      nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children.map(({ attrs }) => [attrs.anim, attrs.originalDuration, attrs.timeScale]);
    expect(clips("room SMX3_BGPeople_02")).toEqual([["Stand", "2600", "0.500000"]]);
    expect(clips("s010 visitor")).toEqual([["Stand", "6666", "2.000000"]]);
    expect(clips("s020 visitor")).toEqual([
      ["Stand", "6666", "2.000000"],
      ["Stand Cover 02", "2000", "2.000000"],
      ["Stand Cover Talk", "3000", "1.500000"],
    ]);
    // A piece at its own speed writes none.
    expect(clips("room RadioDesk")).toEqual([["Stand", undefined, undefined]]);
  });

  it("writes a shot's timed anim at its priority, and every other anim at the Stand's 3", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02", atMs: 1000, priority: 7 }, { anim: "Stand Cover Talk", atMs: 3000 }] };
    });
    const visitor = nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === "s020 visitor")!;
    const clips = visitor.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children.map(({ attrs }) => [attrs.anim, attrs.start ?? "0", attrs.priority]);
    expect(clips).toEqual([
      ["Stand", "4000", "3"],
      ["Stand Cover 02", "5000", "7"],
      ["Stand Cover Talk", "7000", "3"],
    ]);
  });

  it("changes a member's anim where only its priority does, and not where a priority of 3 repeats the Stand's", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[0].anims = { visitor: { anim: "Stand Cover 02", priority: 7 } };
      cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02" }, { anim: "Stand Cover 02", atMs: 1000, priority: 3 }] };
    });
    const clips = (name: string) =>
      nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children.map(({ attrs }) => [attrs.anim, attrs.start ?? "0", attrs.priority]);
    expect(clips("s010 visitor")).toEqual([["Stand Cover 02", "0", "7"]]);
    expect(clips("s020 visitor")).toEqual([["Stand Cover 02", "4000", "3"]]);
  });

  it("plays a piece whose model has no plain Stand its first numbered one, as the game does", async () => {
    // GuardianShield's only Stand is Stand 01 (data/model-anims.json).
    const { nodes } = await compiled(undefined, (set) => {
      set.pieces[0] = { model: "GuardianShield", at: [0, 0, 0] };
    });
    const dome = nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === "room GuardianShield")!;
    const stand = dome.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children[0]!.attrs;
    expect(stand).toMatchObject({ anim: "Stand 01", looping: "1" });
    expect(Number(stand.originalDuration)).toBeGreaterThan(0);
  });

  it("drives the lines from the map's own conversation data", async () => {
    const { map, nodes } = await compiled();
    const driver = nodes.find((node) => node.tag === "CCutsceneNodeConversationDriver")!;
    const data = await readFile(path.join(map, "Base.SC2Data/GameData/ConversationData.xml"), "utf8");
    expect(data).toContain(`<CConversation id="${driver.attrs.conversationLink}">`);
    expect(driver.children.map((line) => [line.attrs.start, line.attrs.lineId])).toEqual([
      ["1000", "Line1-1"],
      ["4000", "Line1-2"],
    ]);
    for (const line of driver.children) expect(data).toContain(`<Id value="${line.attrs.lineId}"/>`);
  });
});

describe("a compiled Cinematic's talking cast", () => {
  const actorNamed = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!;
  const conversationOf = (actor: CutsceneNode) =>
    actor.children
      .filter((child) => child.tag === "CCutsceneNodeConversation")
      .flatMap((node) => node.children)
      .map(({ attrs }) => [attrs.start, attrs.duration, attrs.conversationLine, attrs.soundLink]);

  it("plays each line on its speaker's actor, at the line's time, with the line's sound", async () => {
    const { nodes } = await compiled();
    const conversation = nodes.find((node) => node.tag === "CCutsceneNodeConversationDriver")!.attrs.conversationLink;
    // The placeholder voices are 3 s and 11 s long.
    // Each on the speaker's copy in the shot where it starts: the operator's in the first, the visitor's in the second.
    expect(conversationOf(actorNamed(nodes, "s010 operator"))).toEqual([["1000", "3000", "Line1-1", "radio_field-1-1"]]);
    expect(conversationOf(actorNamed(nodes, "s010 visitor"))).toEqual([]);
    expect(conversationOf(actorNamed(nodes, "s020 visitor"))).toEqual([["4000", "11000", "Line1-2", "radio_field-1-2"]]);
    const element = nodes.find((node) => node.tag === "CCutsceneElementConversation")!;
    // The facial anim is the sound's own, as the map's SoundData writes it: none yet.
    expect(element.attrs).toMatchObject({ conversationLink: conversation, assetDuration: "3000", facialGroup: "", facialAnim: "" });
  });

  /** Each animation layer's clips: name, start, duration, priority. */
  const animsOf = (actor: CutsceneNode) =>
    actor.children
      .filter((child) => child.tag === "CCutsceneNodeAnimLayer")
      .map((layer) => layer.children.map(({ attrs }) => [attrs.anim, attrs.start ?? "0", attrs.duration, attrs.priority]));

  it("runs the model's Talk while a member speaks, over Stand, blending in and out", async () => {
    const { nodes } = await compiled();
    // The operator's model has Talk and Talk 01, the visitor's Talk 01 and Talk 02 (data/model-anims.json).
    expect(animsOf(actorNamed(nodes, "s010 operator"))).toEqual([[["Stand", "0", "4000", "3"]], [["Talk", "1000", "3000", "4"]]]);
    expect(animsOf(actorNamed(nodes, "s010 visitor"))).toEqual([[["Stand", "0", "4000", "3"]]]);
    expect(animsOf(actorNamed(nodes, "s020 visitor"))).toEqual([[["Stand", "4000", "14000", "3"]], [["Talk 01", "4000", "11000", "4"]]]);
    const [stand, talk] = actorNamed(nodes, "s020 visitor")
      .children.filter((child) => child.tag === "CCutsceneNodeAnimLayer")
      .map((layer) => layer.children[0]!.attrs);
    expect(stand).toMatchObject({ looping: "1", lockedToEnd: "1" });
    expect(talk).toMatchObject({ looping: "1", blendTime: "300", blendOutTime: "300" });
    expect(animsOf(actorNamed(nodes, "s010 operator")).flat().map(([anim]) => anim)).toEqual(["Stand", "Talk"]);
    expect(actorNamed(nodes, "s010 operator").children.filter((child) => child.tag === "CCutsceneNodeAnimLayer").map((layer) => layer.children[0]!.attrs.originalDuration)).toEqual(["2600", "3166"]);
  });

  it("runs a shot's anim for a member in place of its Stand and Talk through that shot", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1].anims = { visitor: "Stand Cover Fidget 01" };
    });
    expect(animsOf(actorNamed(nodes, "s020 visitor"))).toEqual([[["Stand Cover Fidget 01", "4000", "14000", "3"]]]);
    // It still says its line.
    expect(conversationOf(actorNamed(nodes, "s020 visitor"))).toHaveLength(1);
    expect(animsOf(actorNamed(nodes, "s010 operator"))).toEqual([[["Stand", "0", "4000", "3"]], [["Talk", "1000", "3000", "4"]]]);
  });

  it("keeps a speaker's Talk on its line over a shot's timed anim, on its layer as over Stand", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1].anims = { visitor: { anim: "Stand Cover 02", atMs: 1000, priority: 5 } };
    });
    expect(animsOf(actorNamed(nodes, "s020 visitor"))).toEqual([
      [
        ["Stand", "4000", "1000", "3"],
        ["Stand Cover 02", "5000", "13000", "5"],
      ],
      [["Talk 01", "4000", "11000", "4"]],
    ]);
  });

  it("runs a list of a shot's timed anims for a member in turn, each from its atMs", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02", atMs: 1000 }, { anim: "Stand Cover Talk", atMs: 3000 }, { anim: "Stand Cover 02", atMs: 5000, once: true }] };
    });
    expect(animsOf(actorNamed(nodes, "s020 visitor"))).toEqual([
      [
        ["Stand", "4000", "1000", "3"],
        ["Stand Cover 02", "5000", "2000", "3"],
        ["Stand Cover Talk", "7000", "2000", "3"],
        ["Stand Cover 02", "9000", "9000", "3"],
      ],
      [["Talk 01", "4000", "11000", "4"]],
    ]);
  });

  it("starts a shot's timed anim at its in-point (fromMs) as its startOffset, each anew, even after the same anim", async () => {
    // SMX3_BGPeople_06's Walk Unburrow Fidget 02 is 18000 ms long, its Walk Unburrow Fidget 03 10000 ms (data/model-anims.json).
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1].anims = {
        visitor: [
          { anim: "Walk Unburrow Fidget 02", fromMs: 10000, once: true },
          { anim: "Walk Unburrow Fidget 03", atMs: 3000, fromMs: 7000 },
          { anim: "Walk Unburrow Fidget 03", atMs: 5000, fromMs: 1000 },
        ],
      };
    });
    const visitor = actorNamed(nodes, "s020 visitor");
    const clips = visitor.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children.map(({ attrs }) => [attrs.anim, attrs.start, attrs.duration, attrs.originalDuration, attrs.looping, attrs.startOffset]);
    expect(clips).toEqual([
      ["Walk Unburrow Fidget 02", "4000", "3000", "18000", undefined, "10000"],
      ["Walk Unburrow Fidget 03", "7000", "2000", "10000", "1", "7000"],
      ["Walk Unburrow Fidget 03", "9000", "9000", "10000", "1", "1000"],
    ]);
  });

  it("refuses to compile a shot's timed anim whose in-point is at or past its clip's end", async () => {
    await expect(
      compiled((cinematic) => {
        cinematic.shots[1].anims = { visitor: { anim: "Stand Cover 02", atMs: 1000, fromMs: 2000 } };
      }),
    ).rejects.toThrow("shots.1.anims.visitor.fromMs: SMX3_BGPeople_06's Stand Cover 02 is 2000 ms long: its in-point 2000 ms is at or past its end");
  });

  it("says a line whose speaker no one plays on an Invisible actor of its own in the shot, at its camera's target", async () => {
    const { nodes } = await compiled((cinematic) => {
      delete cinematic.cast[1].speaker;
    });
    expect(conversationOf(actorNamed(nodes, "s020 visitor"))).toEqual([]);
    // The driver alone plays no sound, so the line has an actor to play on, as Blizzard's off-screen lines do.
    const voice = actorNamed(nodes, "s020 zeratul voice");
    expect(voice.attrs).toMatchObject({ modelLink: "Invisible" });
    expect(conversationOf(voice)).toEqual([["4000", "11000", "Line1-2", "radio_field-1-2"]]);
    expect(nodes.filter((node) => node.tag === "CCutsceneElementConversation")).toHaveLength(2);
    expect(nodes.filter((node) => node.tag === "CCutsceneElementConversationDriver")).toHaveLength(2);
  });

  it("keeps a voice alive through its line when a later shot cuts into it", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
      cinematic.shots[1].camera = "hall/Wide";
      cinematic.shots.push({ camera: "room/Wide", line: "radio_field-1-2", intoLineMs: 5000 });
    });
    // The visitor's line runs 4 s to 15 s, said in the hall by a voice; the third shot cuts in at 9 s.
    const voice = actorNamed(nodes, "s020 zeratul voice");
    expect(voice.children[0]!.attrs).toMatchObject({ start: "4000", duration: "11000" });
  });

  it("says a line on an Invisible actor in a shot on a set its speaker isn't on", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
      cinematic.shots[1].camera = "hall/Wide";
    });
    expect(nodes.some((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === "s020 visitor")).toBe(false);
    const voice = actorNamed(nodes, "s020 zeratul voice");
    // At the hall camera's target, which a camera node's position is.
    const hallWide = nodes.filter((node) => node.tag === "CCutsceneNodeCamera")[1]!;
    expect(voice.attrs.position).toBe(hallWide.attrs.position);
    expect(conversationOf(voice)).toEqual([["4000", "11000", "Line1-2", "radio_field-1-2"]]);
  });
});

describe("a compiled Cinematic on two sets, with moves and Light switches", () => {
  /** The fixture with the radio hall placed beside the room, a guard on its mark, and the second line filmed there. */
  const twoSets = (cinematic: any) => {
    cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
    cinematic.cast.push({ id: "guard", model: "SMX3_BGPeople_02", set: "hall", mark: "Guard" });
    cinematic.shots[1].camera = "hall/Wide";
  };
  const camerasOf = (nodes: CutsceneNode[]) => nodes.filter((node) => node.tag === "CCutsceneNodeCamera");
  const ties = (node: CutsceneNode) => node.children.filter((child) => child.tag === "CCutsceneNodeActiveShot").map((tie) => tie.attrs.cameraGUID);

  it("places each set at its offset, its cameras and marks with it, and its pieces and lamps only in the shots on it", async () => {
    const { nodes } = await compiled(twoSets);
    const [roomWide, hallWide] = camerasOf(nodes);
    // Both sets have a camera called Wide: each shot's is its own set's.
    expect(roomWide!.attrs).toMatchObject({ name: "Wide", position: "10.000000,1.000000,1.500000", distance: "10.000000" });
    expect(hallWide!.attrs).toMatchObject({ name: "Wide", position: "100.000000,1.000000,1.000000", distance: "8.000000" });
    // The hall's door is tied to a camera no shot uses. A member is copied only into the shots on its set.
    expect(layout(nodes)).toEqual([
      "Director",
      { LIGHTS: [{ "s010 Wide": ["s010 Fill"] }, { "s020 Wide": ["s020 HallKey"] }] },
      { "s010 Wide": ["Wide", "s010 room RoomFloor", "s010 room RadioDesk", "s010 operator", "s010 visitor"] },
      // The visitor's line starts in the hall, where the visitor isn't: a voice says it there.
      { "s020 Wide": ["Wide", "s020 hall HallFloor", "s020 guard", "s020 zeratul voice"] },
    ]);
    const actors = nodes.filter((node) => node.tag === "CCutsceneNodeActor");
    expect(actors.map((actor) => [actor.attrs.name, actor.attrs.position])).toEqual([
      ["s010 room RoomFloor", "10.000000,0.000000,0.000000"],
      ["s010 room RadioDesk", "11.000000,2.000000,0.000000"],
      ["s010 operator", "11.000000,1.000000,0.000000"],
      ["s010 visitor", "8.000000,1.000000,0.000000"],
      ["s020 hall HallFloor", "100.000000,0.000000,0.000000"],
      ["s020 guard", "100.000000,1.000000,0.000000"],
      // At the hall camera's target.
      ["s020 zeratul voice", "100.000000,1.000000,1.000000"],
    ]);
    expect(actors.find((actor) => actor.attrs.name === "s020 guard")!.attrs.rotation).toBe("0.000000,0.000000,180.000000");
    const lamps = nodes.filter((node) => node.tag === "CCutsceneNodeLight");
    expect(lamps.map((lamp) => [lamp.attrs.name, lamp.attrs.position, ties(lamp)])).toEqual([
      ["s010 Fill", "9.000000,0.000000,3.000000", [roomWide!.attrs.guid]],
      ["s020 HallKey", "101.000000,1.000000,3.000000", [hallWide!.attrs.guid]],
    ]);
  });

  it("switches the base Light on a shot's cut, with no blend", async () => {
    const { map, file, nodes } = await compiled((cinematic) => {
      twoSets(cinematic);
      cinematic.shots[1].light = "HallLight";
    });
    const switches = nodes.filter((node) => node.tag === "CCutsceneElementActiveLight").map(({ attrs }) => [attrs.start ?? "0", attrs.lightID, attrs.blendTime]);
    expect(switches).toEqual([
      ["0", "RoomLight", "0"],
      ["4000", "HallLight", "0"],
    ]);
    if (!hasPython) return;
    const run = spawnSync("python3", ["-I", TIMELINE, file, map], { encoding: "utf8" });
    expect(run.stdout).toContain("   4.00  LIGHT HallLight blend 0");
  });

  it("writes a Plugin's Light that a shot or the Cinematic names to the map's LightData, and no other", async () => {
    const lightData = async (map: string) => readFile(path.join(map, "Base.SC2Data/GameData/LightData.xml"), "utf8").catch(() => undefined);
    // The fixture's noon Plugin contributes NoonGlare and NoonShade; the fixture names neither.
    expect(await lightData((await compiled()).map)).toBeUndefined();
    const { map, nodes } = await compiled((cinematic) => {
      cinematic.shots[1].light = "NoonGlare";
    });
    expect(nodes.filter((node) => node.tag === "CCutsceneElementActiveLight").map(({ attrs }) => attrs.lightID)).toEqual(["RoomLight", "NoonGlare"]);
    const xml = (await lightData(map))!;
    expect(xml.match(/<CLight id="[^"]+"/g)).toEqual(['<CLight id="NoonGlare"']);
    // ArcadeCityLight's fields, retuned: the key straight down, the fill half as strong and up.
    expect(xml).toContain('<AmbientColor value="0.800000,0.500000,0.250000"/>');
    expect(xml).toContain('<Param index="HDRExposure" value="1.200000"/>');
    expect(xml).toMatch(/<DirectionalLight index="Key">[^]*?<Color value="1.000000,0.600000,0.300000"\/>[^]*?<Direction value="0.000000,0.000000,-1.000000"\/>/);
    expect(xml).toMatch(/<DirectionalLight index="Fill">[^]*?<ColorMultiplier value="1.500000"\/>[^]*?<Direction value="0.000000,0.000000,1.000000"\/>/);
    expect(xml).toMatch(/<DirectionalLight index="Back">[^]*?<Color value="0.082353,0.121569,0.200000"\/>/);
  });

  it("takes a first shot's Light as the Light at t=0", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[0].light = "RoomAlarm";
    });
    expect(nodes.filter((node) => node.tag === "CCutsceneElementActiveLight").map(({ attrs }) => attrs.lightID)).toEqual(["RoomAlarm"]);
  });

  it("moves a shot's camera to another of its set's cameras over the shot, easing out", async () => {
    const { nodes } = await compiled((cinematic) => {
      twoSets(cinematic);
      cinematic.shots[1].to = "hall/Door";
    });
    const wide = camerasOf(nodes)[1]!;
    const curves = Object.fromEntries(
      wide.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((property) => [property.attrs.propertyName, property.children.map(({ attrs }) => [attrs.start, attrs.value, attrs.curveOutValue])]),
    );
    // The hall's Wide (0, 1, 1) to its Door (0, 2, 1), both moved by the hall's offset, from the cut at 4 s to the shot's end at 15 s.
    // An eased move leaves at speed: its first handle is halfway to the end value a third of the way in.
    const third = (4000 + 11000 / 3).toFixed(6);
    expect(curves).toEqual({
      positionY: [["4000", "1.000000", `${third},1.500000`], ["15000", "2.000000", "15001.000000,2.000000"]],
      distance: [["4000", "8.000000", `${third},6.000000`], ["15000", "4.000000", "15001.000000,4.000000"]],
      fov: [["4000", "35.000000", `${third},27.500000`], ["15000", "20.000000", "15001.000000,20.000000"]],
    });
  });

  it("films a camera of a shot's own, its move and its lights in its set's frame, the lights only in that shot", async () => {
    const own = { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 };
    const { nodes } = await compiled((cinematic) => {
      twoSets(cinematic);
      cinematic.shots[1] = {
        ...cinematic.shots[1],
        set: "hall",
        camera: own,
        to: { ...own, target: [0, 2, 1] },
        move: "linear",
        lights: [
          { name: "Guard Rim", at: [1, 0, 2], color: [0.5, 0.7, 1], strength: 3, range: 4 },
          { name: "Guard Key", at: [0, 1, 2], color: [1, 1, 1], strength: 1, range: 6, shadows: true },
        ],
      };
    });
    const camera = camerasOf(nodes)[1]!;
    expect(camera.attrs.position).toBe("100.000000,1.000000,1.000000");
    const positionY = camera.children.find((child) => child.attrs.propertyName === "positionY")!.children.map(({ attrs }) => [attrs.value, attrs.curveOutValue]);
    // A linear move's handles sit on the straight line between its keys.
    expect(positionY[0]).toEqual(["1.000000", `${(4000 + 11000 / 3).toFixed(6)},${(1 + 1 / 3).toFixed(6)}`]);
    const rim = nodes.find((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name === "Guard Rim")!;
    expect([rim.attrs.position, ties(rim)]).toEqual(["101.000000,0.000000,2.000000", [camera.attrs.guid]]);
    // A shot's own lamp casts no shadow unless it asks to: the base Light's key is the one shadow-caster.
    expect(rim.attrs.shadowCasting).toBe("0");
    expect(nodes.find((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name === "Guard Key")!.attrs.shadowCasting).toBeUndefined();
    expect(layout(nodes).at(-1)).toEqual({ "s020 Camera": ["Camera", "s020 hall HallFloor", "s020 hall HallDoor", "s020 guard", "s020 zeratul voice"] });
    // The shot's own lights go in its folder of LIGHTS, beside its copies of the set's lamps.
    expect(layout(nodes)[1]).toEqual({ LIGHTS: [{ "s010 Wide": ["s010 Fill"] }, { "s020 Camera": ["Guard Rim", "Guard Key", "s020 HallKey"] }] });
  });

  it("shows a set's pieces tied to its cameras, but not its tied lamps, in a shot through a camera of its own on that set", async () => {
    // A room's walls are often tied to the cameras that see them; a new camera may see them all.
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1] = { ...cinematic.shots[1], set: "room", camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 } };
    });
    const names = nodes.map((node) => node.attrs.name);
    expect(names).toContain("s020 room RadioScreen");
    expect(names).toContain("s020 room RoomShelf");
    expect(names).not.toContain("s010 room RoomShelf");
    expect(names.some((name) => name?.includes("RoomCrate"))).toBe(false);
    expect(nodes.some((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name?.endsWith("Key"))).toBe(false);
  });

  it("shows a cast member whose mark was seen only through some set cameras in a shot through a camera of its own", async () => {
    // The operator's mark was seen only through the room's Wide (and Drift): a camera of a shot's own wasn't the source's, so it hides no one.
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1] = { ...cinematic.shots[1], set: "room", camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 } };
    });
    const names = nodes.filter((node) => node.tag === "CCutsceneNodeActor").map((node) => node.attrs.name);
    expect(names.filter((name) => name!.endsWith("operator"))).toEqual(["s010 operator", "s020 operator"]);
  });

  it("hides a cast member from the shots that name it in hide, through a camera of their own or a set camera", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1] = { ...cinematic.shots[1], set: "room", camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 }, hide: ["operator"] };
      cinematic.shots[0].hide = ["visitor"];
    });
    // A hidden member has no copy in that shot.
    const names = nodes.filter((node) => node.tag === "CCutsceneNodeActor").map((node) => node.attrs.name);
    expect(names.filter((name) => /operator|visitor/.test(name!))).toEqual(["s010 operator", "s020 visitor"]);
  });

  it("cuts inside a line a shot gives intoLineMs, the shot before carrying its start", async () => {
    const { nodes } = await compiled((cinematic) => {
      twoSets(cinematic);
      cinematic.shots.splice(1, 0, { camera: "room/Close", line: "radio_field-1-2" });
      cinematic.shots[2].line = "radio_field-1-2";
      cinematic.shots[2].intoLineMs = 5000;
    });
    const cuts = nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera").map(({ attrs }) => attrs.start ?? "0");
    expect(cuts).toEqual(["0", "4000", "9000"]);
    // The line plays once, from its start.
    expect(nodes.filter((node) => node.tag === "CCutsceneElementConversationDriver").map(({ attrs }) => attrs.start)).toEqual(["1000", "4000"]);
  });

  it("keeps a line a later shot cuts into whole on its speaker's copy where it starts, the Talk going on from the cut on the next shot's copy", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots.push({ camera: "room/Wide", line: "radio_field-1-2", intoLineMs: 5000 });
    });
    const copy = (name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!;
    const talkOf = (name: string) => copy(name).children.find((child) => child.attrs.name === "Talk")!.children.map(({ attrs }) => [attrs.start, attrs.duration, attrs.blendTime, attrs.blendOutTime]);
    const linesOf = (name: string) => copy(name).children.filter((child) => child.tag === "CCutsceneNodeConversation").flatMap((node) => node.children.map(({ attrs }) => [attrs.start, attrs.duration]));
    // The visitor's line runs 4 s to 15 s; the third shot cuts 5 s into it.
    expect(copy("s020 visitor").children[0]!.attrs).toMatchObject({ start: "4000", duration: "5000" });
    expect(linesOf("s020 visitor")).toEqual([["4000", "11000"]]);
    expect(talkOf("s020 visitor")).toEqual([["4000", "5000", "300", "0"]]);
    expect(linesOf("s030 visitor")).toEqual([]);
    expect(talkOf("s030 visitor")).toEqual([["9000", "6000", "0", "300"]]);
  });
});

describe("a compiled Cinematic's display feeds", () => {
  /** The fixture with the radio hall placed far off, a guard on its mark there, and the close shot fed `feed`. */
  const fedBy = (feed: unknown, more?: (cinematic: any) => void) => (cinematic: any) => {
    cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [1000, 0, 0] });
    cinematic.cast.push({ id: "guard", model: "SMX3_BGPeople_02", set: "hall", mark: "Guard" });
    cinematic.shots[1].feed = feed;
    more?.(cinematic);
  };
  const named = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.attrs.name === name)!;
  const elements = (nodes: CutsceneNode[]) =>
    nodes.filter((node) => node.tag === "CCutsceneNodeRTTChannel").map((channel) => [channel.attrs.RTTChannel, channel.children.map(({ attrs }) => ({ ...attrs, guid: undefined }))]);

  it("films a set camera through a rig in the shot, copying the set's pieces, cast and lamps into the shot as one on it", async () => {
    const { nodes } = await compiled(fedBy("hall/Wide"));
    // The hall's floor and guard are copied into the close shot; its door is tied to a camera the feed doesn't film through.
    expect(layout(nodes)).toEqual([
      "Director",
      { Set: ["room RoomFloor", "room RadioDesk"] },
      { LIGHTS: ["Fill", { "s020 Close": ["s020 Key", "s020 HallKey"] }] },
      { RTT: ["RTT Channel 0"] },
      { "s010 Wide": ["Wide", "s010 operator", "s010 visitor"] },
      { "s020 Close": ["Close", "s020 room RadioScreen", "s020 hall HallFloor", "s020 visitor", "s020 guard", "s020 feed hall Wide"] },
    ]);
    // From the close shot's cut to the end, through the rig's own camera.
    expect(elements(nodes)).toEqual([["0", [{ start: "4000", duration: "14000", lockedToEnd: "1", objectGUID: named(nodes, "s020 feed hall Wide").attrs.guid, cameraIndex: "0", guid: undefined }]]]);
    const rig = named(nodes, "s020 feed hall Wide");
    // The hall's Wide, (0, 1, 1) at (1000, 0, 0), 8 cells off, yaw 0: the rig turned to look south, its camera on that line.
    const { at, rotation } = feedRig({ target: [1000, 1, 1], distance: 8, pitch: 5, yaw: 0, fov: 35, heightOffset: -0.5 });
    expect(rig.attrs).toMatchObject({ modelLink: "SMX3_Nova_Ship_Bridge_MainScreen", position: at.map((value) => value.toFixed(6)).join(","), rotation: rotation.map((value) => value.toFixed(6)).join(",") });
    expect(Math.abs(rotation[2])).toBeCloseTo(180, 6);
  });

  it("films a cast member through its own model's camera, on the channel given, its set's tied pieces and all", async () => {
    const { nodes } = await compiled(fedBy({ camera: "guard", channel: 2, cameraIndex: 1, aspectRatio: 1.77 }));
    expect(layout(nodes).at(-1)).toEqual({ "s020 Close": ["Close", "s020 room RadioScreen", "s020 hall HallFloor", "s020 hall HallDoor", "s020 visitor", "s020 guard"] });
    expect(elements(nodes)).toEqual([["2", [{ start: "4000", duration: "14000", lockedToEnd: "1", objectGUID: named(nodes, "s020 guard").attrs.guid, cameraIndex: "1", aspectRatio: "1.770000", guid: undefined }]]]);
  });

  it("has a speaker on the display say their line on their copy there, not on a voice", async () => {
    const onHall = (cinematic: any) => {
      cinematic.cast[1] = { ...cinematic.cast[1], set: "hall", at: [0, 2, 0] };
    };
    const without = await compiled(fedBy(undefined, onHall));
    expect(layout(without.nodes).at(-1)).toEqual({ "s020 Close": ["Close", "s020 room RadioScreen", "s020 zeratul voice"] });
    const { nodes } = await compiled(fedBy("visitor", onHall));
    expect(layout(nodes).at(-1)).toEqual({ "s020 Close": ["Close", "s020 room RadioScreen", "s020 hall HallFloor", "s020 hall HallDoor", "s020 visitor", "s020 guard"] });
    expect(named(nodes, "s020 visitor").children.some((child) => child.tag === "CCutsceneNodeConversation")).toBe(true);
  });

  it("gives a feed through the same camera in two shots one rig, copied into each, and an element a shot", async () => {
    const { nodes } = await compiled(
      fedBy("hall/Wide", (cinematic) => {
        cinematic.shots[0].feed = "hall/Wide";
      }),
    );
    // The hall is now seen in every shot, so its floor stands once.
    expect(layout(nodes).slice(1, 3)).toEqual([{ Set: ["room RoomFloor", "room RadioDesk", "hall HallFloor"] }, { LIGHTS: ["Fill", "HallKey", { "s020 Close": ["s020 Key"] }] }]);
    expect(elements(nodes)).toEqual([
      [
        "0",
        [
          { duration: "4000", objectGUID: named(nodes, "s010 feed hall Wide").attrs.guid, cameraIndex: "0", guid: undefined },
          { start: "4000", duration: "14000", lockedToEnd: "1", objectGUID: named(nodes, "s020 feed hall Wide").attrs.guid, cameraIndex: "0", guid: undefined },
        ],
      ],
    ]);
  });

  it("feeds the channel the shot's Set's screen shows when the feed names none: 6 for the Nova bridge's main screen", async () => {
    const screen = (cinematic: any) => cinematic.cast.push({ id: "screen", model: "SMX3_Nova_Ship_Bridge_MainScreen", set: "room", at: [0, 3, 0], facing: 180 });
    expect(elements((await compiled(fedBy("hall/Wide", screen))).nodes).map(([channel]) => channel)).toEqual(["6"]);
    // A channel the feed names stands.
    expect(elements((await compiled(fedBy({ camera: "hall/Wide", channel: 0 }, screen))).nodes).map(([channel]) => channel)).toEqual(["0"]);
  });

  it("writes no RTT folder for a Cinematic with no feed", async () => {
    const { nodes } = await compiled();
    expect(nodes.some((node) => node.tag === "CCutsceneNodeRTTChannel" || node.attrs.name === "RTT")).toBe(false);
  });
});

describe("a compiled Cinematic's warp-in: lifetimes, fades, scales and light flashes", () => {
  const actorNamed = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!;
  /** Each property curve under a node: its property, and its keys as [time, value]. */
  const curvesOf = (node: CutsceneNode) =>
    Object.fromEntries(
      node.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((property) => [property.attrs.propertyName, property.children.map(({ attrs }) => [Number(attrs.time), Number(attrs.value)])]),
    );

  it("brings a member into being and takes it away at moments in its shots, fading it in and stretching then relaxing it", async () => {
    // The second shot cuts at 4 s.
    const { nodes } = await compiled((cinematic) => {
      // A voice only, since a speaker must exist through its lines.
      delete cinematic.cast[1].speaker;
      cinematic.cast[1].opacity = 0;
      cinematic.shots[1].enters = { visitor: 500 };
      cinematic.shots[1].exits = { visitor: 9000 };
      cinematic.shots[1].moves = { visitor: [{ opacity: 1, scale: [0.8, 0.5, 0.5], ms: 3000, move: "linear" }, { scale: 0.5, ms: 2000 }] };
    });
    // It enters in the second shot, so the first has no copy of it.
    expect(nodes.some((node) => node.attrs.name === "s010 visitor")).toBe(false);
    const visitor = actorNamed(nodes, "s020 visitor");
    expect(visitor.attrs.opacity).toBe("0.000000");
    expect(visitor.children[0]).toMatchObject({ tag: "CCutsceneElementObject", attrs: { start: "4500", duration: "8500" } });
    expect(visitor.children[0]!.attrs.lockedToEnd).toBeUndefined();
    // Only what changes is keyed: no position, rotation or y and z scale.
    expect(curvesOf(visitor)).toEqual({
      scaleX: [[4000, 0.5], [7000, 0.8], [9000, 0.5]],
      opacity: [[4000, 0], [7000, 1], [9000, 1]],
    });
    const fade = visitor.children.find((child) => child.attrs.propertyName === "opacity")!;
    expect(fade.attrs.name).toBe("Property - opacity");
    // Linear into the fade's end: the handles sit on the straight line, a third of the way along.
    expect(fade.children[1]!.attrs).toMatchObject({ curveInValue: "6000.000000,0.666667", curveOutType: "3", curveInType: "3" });
  });

  it("flashes a shot's spot light by its strength steps, diffuse and specular together, and draws the shot's shadows to its camera's distance", async () => {
    const own = { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20, shadowDistance: 30 };
    const { nodes } = await compiled((cinematic) => {
      cinematic.shots[1] = {
        ...cinematic.shots[1],
        set: "room",
        camera: own,
        lights: [{ name: "Warp Flash", at: [0, 2, 1], color: [0.1, 0.25, 1], strength: 0, range: 3, spot: { rotation: [58, -26, 232], hotspot: 0.2, falloff: 0.6 }, steps: [{ strength: 10, ms: 100 }, { strength: 0, ms: 1900, move: "linear" }] }],
      };
    });
    const flash = nodes.find((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name === "Warp Flash")!;
    expect(flash.attrs).toMatchObject({ type: "2", rotation: "58.000000,-26.000000,232.000000", hotspot: "0.200000", falloff: "0.600000", colorMultiplier: "0.000000" });
    const keys = [[4000, 0], [4100, 10], [6000, 0]];
    expect(curvesOf(flash)).toEqual({ colorMultiplier: keys, specularColorMultiplier: keys });
    const [wide, close] = nodes.filter((node) => node.tag === "CCutsceneNodeCamera");
    expect([wide!.attrs.shadowClip, close!.attrs.shadowClip]).toEqual(["75.000000", "30.000000"]);
  });

  it("takes a set camera's shadow distance", async () => {
    const { nodes } = await compiled(undefined, (set) => {
      set.cameras[0].shadowDistance = 20;
    });
    expect(nodes.find((node) => node.tag === "CCutsceneNodeCamera")!.attrs.shadowClip).toBe("20.000000");
  });

  it("refuses a moment or a light step past its shot's end", async () => {
    await expect(compiled((cinematic) => void (cinematic.shots[1].enters = { visitor: 99_000 }))).rejects.toThrow("Shot 1 enters visitor 99000 ms in, past the shot's end at");
    await expect(compiled((cinematic) => void (cinematic.shots[0].exits = { visitor: 0 }))).rejects.toThrow("Shot 0 exits visitor at the Cinematic's start, so it never exists");
    // The visitor says the second line, from 4 s.
    await expect(compiled((cinematic) => void (cinematic.shots[1].enters = { visitor: 1000 }))).rejects.toThrow("visitor says radio_field-1-2 from 4000 ms to 15000 ms, outside the time it exists (5000 to the end ms)");
    await expect(
      compiled((cinematic) => {
        cinematic.shots[1] = { ...cinematic.shots[1], set: "room", camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 }, lights: [{ name: "Late", at: [0, 0, 1], color: [1, 1, 1], strength: 1, range: 2, steps: [{ strength: 0, afterMs: 99_000, ms: 100 }] }] };
      }),
    ).rejects.toThrow("Shot 1's light steps run until 99100 ms into it, past its end at");
  });
});

describe("a compiled Cinematic's sounds, look-ats and attached lamps", () => {
  const sounds = (nodes: CutsceneNode[]) =>
    nodes.filter((node) => node.tag === "CCutsceneNodeSound").map((sound) => ({ ...sound.attrs, guid: undefined, lifetime: { ...sound.children[0]!.attrs, guid: undefined } }));
  const volumeKeys = (sound: CutsceneNode) =>
    sound.children
      .filter((child) => child.tag === "CCutsceneNodePropertyValue")
      .map((curve) => ({ name: curve.attrs.name, propertyName: curve.attrs.propertyName, keys: curve.children.map((key) => [key.attrs.time, key.attrs.value, key.attrs.curveInType, key.attrs.curveOutType]) }));
  const soundNodes = (nodes: CutsceneNode[]) => nodes.filter((node) => node.tag === "CCutsceneNodeSound");

  it("loops the ambience of a set in every shot through the whole scene, and plays its own sounds from a line's start or a time, at their volume, looped or once, from an in-point", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.sounds = [
          { sound: "RadioStatic", line: "radio_field-1-2", volume: 0.8 },
          { sound: "Music_Theme", atMs: 500, fromMs: 10000, loop: true },
        ];
      },
      (set) => {
        set.sounds = [{ sound: "RoomHum", volume: 0.5 }];
      },
    );
    // The scene runs 18 s; the second line starts 4 s in.
    expect(sounds(nodes)).toEqual([
      { name: "RoomHum", soundLink: "RoomHum", volumeScale: "0.500000", mode: "4294967295", guid: undefined, lifetime: { duration: "18000", lockedToEnd: "1", guid: undefined } },
      { name: "RadioStatic", soundLink: "RadioStatic", volumeScale: "0.800000", guid: undefined, lifetime: { start: "4000", duration: "14000", lockedToEnd: "1", guid: undefined } },
      { name: "Music_Theme", soundLink: "Music_Theme", mode: "4294967295", startOffset: "10000", guid: undefined, lifetime: { start: "500", duration: "17500", lockedToEnd: "1", guid: undefined } },
    ]);
    // A set in every shot loops its ambience as one sound, with no fade; so does a sound with no end.
    expect(soundNodes(nodes).map((sound) => sound.children.length)).toEqual([1, 1, 1]);
  });
  it("plays each set's ambience only in its shots: from the cut to it, one loop through back-to-back shots, fading out over 250 ms before the cut away, and in a shot of no set", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
        cinematic.shots.push(
          { camera: "hall/Wide", afterMs: 0, pauseAfterMs: 1000 },
          { camera: "room/Wide", afterMs: 0, pauseAfterMs: 1000 },
          { camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 }, afterMs: 0, pauseAfterMs: 1000 },
        );
      },
      (room) => void (room.sounds = [{ sound: "RoomHum", volume: 0.5 }]),
      (hall) => void (hall.sounds = [{ sound: "HallWind" }]),
    );
    // Cuts at 0 and 4 s on the room, 15 s to the hall, 16 s back to the room, 17 s to a camera of no set; the scene ends at 21 s.
    expect(sounds(nodes)).toEqual([
      { name: "s010 RoomHum", soundLink: "RoomHum", volumeScale: "0.500000", mode: "4294967295", guid: undefined, lifetime: { duration: "15000", guid: undefined } },
      { name: "s040 RoomHum", soundLink: "RoomHum", volumeScale: "0.500000", mode: "4294967295", guid: undefined, lifetime: { start: "16000", duration: "5000", lockedToEnd: "1", guid: undefined } },
      { name: "s030 HallWind", soundLink: "HallWind", mode: "4294967295", guid: undefined, lifetime: { start: "15000", duration: "1000", guid: undefined } },
      { name: "s050 HallWind", soundLink: "HallWind", mode: "4294967295", guid: undefined, lifetime: { start: "17000", duration: "4000", lockedToEnd: "1", guid: undefined } },
    ]);
    // Blizzard's fade: a Volume curve at its volume to where the fade starts, then linear to 0 at the cut.
    expect(soundNodes(nodes).map(volumeKeys)).toEqual([
      [{ name: "Property - Volume", propertyName: "volumeScale", keys: [["0.000000", "0.500000", "3", "3"], ["14750.000000", "0.500000", "3", "3"], ["15000.000000", "0.000000", "3", "3"]] }],
      [],
      [{ name: "Property - Volume", propertyName: "volumeScale", keys: [["15000.000000", "1.000000", "3", "3"], ["15750.000000", "1.000000", "3", "3"], ["16000.000000", "0.000000", "3", "3"]] }],
      [],
    ]);
  });
  it("starts and stops a set's ambience on a cut inside a line", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
        cinematic.shots[1].camera = "hall/Wide";
        cinematic.shots.push({ camera: "room/Close", line: "radio_field-1-2", intoLineMs: 5000 });
      },
      (room) => void (room.sounds = [{ sound: "RoomHum" }]),
    );
    // The second line starts on the hall at 4 s, and the room's close shot cuts 5 s into it.
    expect(sounds(nodes).map(({ name, lifetime }) => [name, lifetime.start, lifetime.duration])).toEqual([
      ["s010 RoomHum", undefined, "4000"],
      ["s030 RoomHum", "9000", "9000"],
    ]);
  });

  it("stops a sound at its end, on a line's start or a time, fading it out first, so one music cue hands over to the next on a line", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.sounds = [
        { sound: "Music_Calm", loop: true, volume: 0.6, untilLine: "radio_field-1-2", fadeOutMs: 1000 },
        { sound: "Music_Alert", line: "radio_field-1-2", untilMs: 12000 },
        { sound: "Sting", atMs: 11500, untilMs: 12000, fadeOutMs: 2000 },
        { sound: "Music_Outro", atMs: 12000, fadeOutMs: 3000 },
      ];
    });
    // The second line starts 4 s in; the scene ends at 18 s.
    expect(sounds(nodes)).toEqual([
      { name: "Music_Calm", soundLink: "Music_Calm", volumeScale: "0.600000", mode: "4294967295", guid: undefined, lifetime: { duration: "4000", guid: undefined } },
      { name: "Music_Alert", soundLink: "Music_Alert", guid: undefined, lifetime: { start: "4000", duration: "8000", guid: undefined } },
      { name: "Sting", soundLink: "Sting", guid: undefined, lifetime: { start: "11500", duration: "500", guid: undefined } },
      { name: "Music_Outro", soundLink: "Music_Outro", guid: undefined, lifetime: { start: "12000", duration: "6000", lockedToEnd: "1", guid: undefined } },
    ]);
    const keys = soundNodes(nodes).map((sound) => volumeKeys(sound).flatMap((curve) => curve.keys.map(([time, value]) => [Number(time), Number(value)])));
    // A fade longer than the sound plays fades all of it; one with no end fades into the scene's end.
    expect(keys).toEqual([
      [[0, 0.6], [3000, 0.6], [4000, 0]],
      [],
      [[11500, 1], [12000, 0]],
      [[12000, 1], [15000, 1], [18000, 0]],
    ]);
    // Linear, as Blizzard's fades are: each handle a third of the way to its neighbour, in time and value.
    const fade = soundNodes(nodes)[0]!.children.find((child) => child.tag === "CCutsceneNodePropertyValue")!;
    expect(fade.children.map((key) => [key.attrs.curveInValue, key.attrs.curveOutValue])).toEqual([
      ["-1.000000,0.600000", "1000.000000,0.600000"],
      ["2000.000000,0.600000", "3333.333333,0.400000"],
      ["3666.666667,0.200000", "4001.000000,0.000000"],
    ]);
    await expect(compiled((cinematic) => void (cinematic.sounds = [{ sound: "Sting", atMs: 500, untilMs: 99000 }]))).rejects.toThrow("sounds.0.untilMs: The sound Sting ends 99000 ms in, past the Cinematic's end at 18000 ms");
  });
  it("loops an ambience two of its sets share once, not doubled", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.sets.push({ id: "annex", file: "sets/radio-room.json", offset: [50, 0, 0] });
      },
      (set) => {
        set.sounds = [{ sound: "RoomHum" }];
      },
    );
    expect(sounds(nodes).map((sound) => sound.soundLink)).toEqual(["RoomHum"]);
  });

  const actorNamed = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!;
  const looks = (actor: CutsceneNode) =>
    actor.children
      .filter((child) => child.tag === "CCutsceneNodeLookAt")
      .flatMap((node) => node.children.map((look) => ({ ...look.attrs, guid: undefined })));

  /** The set with its Operator mark seen in every shot, not just the wide ones, so the operator has a copy in each. */
  const everywhere = (set: any) => void delete set.marks[0].shots;

  it("turns a member's head to another member, named by id or by the mark they stand on, from a time or a line's start until the next look-at, each copy at the other's copy in its shot", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast[1].lookAts = [
        { at: "room/Operator", atMs: 1000 },
        { at: "operator", line: "radio_field-1-2", type: "MedHeadOnly", point: "Center" },
      ];
    }, everywhere);
    // The cut is at 4 s, on the second line.
    expect(looks(actorNamed(nodes, "s010 visitor"))).toEqual([
      { guid: undefined, start: "1000", duration: "3000", lookAtGUID: actorNamed(nodes, "s010 operator").attrs.guid, lookAtType: "SlowHeadOnly", lookAtAttachId: "Head" },
    ]);
    expect(looks(actorNamed(nodes, "s020 visitor"))).toEqual([
      { guid: undefined, start: "4000", duration: "14000", lockedToEnd: "1", lookAtGUID: actorNamed(nodes, "s020 operator").attrs.guid, lookAtType: "MedHeadOnly", lookAtAttachId: "Center" },
    ]);
    expect(looks(actorNamed(nodes, "s010 operator"))).toEqual([]);
  });

  it("ends a look-at on one at \"ahead\", so the head faces ahead again until the next", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast[1].lookAts = [
        { at: "operator", atMs: 1000 },
        { at: "ahead", atMs: 2000 },
      ];
    }, everywhere);
    expect(looks(actorNamed(nodes, "s010 visitor"))).toEqual([
      { guid: undefined, start: "1000", duration: "1000", lookAtGUID: actorNamed(nodes, "s010 operator").attrs.guid, lookAtType: "SlowHeadOnly", lookAtAttachId: "Head" },
    ]);
    expect(looks(actorNamed(nodes, "s020 visitor"))).toEqual([]);
  });

  it("drops a look-at at a member with no copy in the shot", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast[1].lookAts = [{ at: "operator", line: "radio_field-1-2" }];
    });
    // The operator's mark is seen only in the wide shot.
    expect(actorNamed(nodes, "s020 operator")).toBeUndefined();
    expect(looks(actorNamed(nodes, "s020 visitor"))).toEqual([]);
  });

  it("gives a member on a mark the look-at its set's mark has, all through, at whoever stands on the other mark, unless the member has look-ats of its own", async () => {
    const markLooks = (set: any) => {
      everywhere(set);
      set.marks[0].lookAt = { mark: "Visitor", type: "InstantHeadOnly" };
      set.marks[1].lookAt = { mark: "Operator" };
    };
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast[1] = { id: "visitor", model: "SMX3_BGPeople_06", set: "room", mark: "Visitor", speaker: "ZERATUL", lookAts: [{ at: "operator", line: "radio_field-1-2" }] };
    }, markLooks);
    const guidOf = (name: string) => actorNamed(nodes, name).attrs.guid;
    expect(looks(actorNamed(nodes, "s010 operator"))).toEqual([{ guid: undefined, duration: "4000", lookAtGUID: guidOf("s010 visitor"), lookAtType: "InstantHeadOnly", lookAtAttachId: "Head" }]);
    expect(looks(actorNamed(nodes, "s020 operator"))).toEqual([{ guid: undefined, start: "4000", duration: "14000", lockedToEnd: "1", lookAtGUID: guidOf("s020 visitor"), lookAtType: "InstantHeadOnly", lookAtAttachId: "Head" }]);
    expect(looks(actorNamed(nodes, "s010 visitor"))).toEqual([]);
    expect(looks(actorNamed(nodes, "s020 visitor"))).toEqual([{ guid: undefined, start: "4000", duration: "14000", lockedToEnd: "1", lookAtGUID: guidOf("s020 operator"), lookAtType: "SlowHeadOnly", lookAtAttachId: "Head" }]);
  });
  it("attaches a set's lamp to the member cast on its mark, at its attach point, offset and turned, so it follows them: the lamp's copy to the member's copy in its shot", async () => {
    const { nodes } = await compiled(undefined, (set) => {
      everywhere(set);
      set.lamps[0].attach = { mark: "Operator", point: "Ref_Overhead", offset: [0, -0.3, -0.1], rotation: [55, 0, 0] };
    });
    const key = nodes.find((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name === "s020 Key")!;
    // Where the set puts it, attached to the operator, lighting only the close shot.
    expect(key.attrs.position).toBe("11.000000,0.000000,3.000000");
    expect(key.children.map((child) => child.tag)).toEqual(["CCutsceneElementObject", "CCutsceneNodeAttachment", "CCutsceneNodeActiveShot"]);
    expect({ ...key.children[1]!.children[0]!.attrs, guid: undefined }).toEqual({
      guid: undefined,
      start: "4000",
      duration: "14000",
      lockedToEnd: "1",
      attachGuid: actorNamed(nodes, "s020 operator").attrs.guid,
      attachName: "Ref_Overhead",
      offsetX: "0.000000",
      offsetY: "-0.300000",
      offsetZ: "-0.100000",
      rotationX: "55.000000",
      rotationY: "0.000000",
      rotationZ: "0.000000",
    });
  });

  it("casts a member on a mark who starts elsewhere, as one who walks onto it: its lamps and look-at follow them, from where they start", async () => {
    const { nodes } = await compiled(
      (cinematic) => {
        cinematic.cast[1].mark = "Visitor";
      },
      (set) => {
        set.lamps[1].attach = { mark: "Visitor", point: "Ref_Overhead" };
        set.marks[1].lookAt = { mark: "Operator" };
      },
    );
    const visitor = actorNamed(nodes, "s010 visitor");
    expect(visitor.attrs).toMatchObject({ position: "8.000000,1.000000,0.000000", rotation: "0.000000,0.000000,-90.000000" });
    expect(looks(visitor).map((look) => look.lookAtGUID)).toEqual([actorNamed(nodes, "s010 operator").attrs.guid]);
    // A lamp that lights every shot, riding a member with a copy a shot, gets a copy in each of its shots.
    const fills = nodes.filter((node) => node.tag === "CCutsceneNodeLight" && node.attrs.name?.endsWith("Fill"));
    expect(fills.map((fill) => fill.attrs.name)).toEqual(["s010 Fill", "s020 Fill"]);
    expect(fills[0]!.children[1]!.children[0]!.attrs).toMatchObject({ attachGuid: visitor.attrs.guid, attachName: "Ref_Overhead", offsetX: "0.000000", rotationZ: "0.000000" });
    expect(fills[1]!.children[1]!.children[0]!.attrs).toMatchObject({ attachGuid: actorNamed(nodes, "s020 visitor").attrs.guid });
  });
});

describe("checking a Cinematic", () => {
  const CINEMATIC = "missions/radio-field/cinematics/radio.json";
  const NOVA_ASSETS = "bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod";

  /** The fixture with its Cinematic (and Blueprint) changed by `edit`, checked. */
  async function checkedWith(edit: (cinematic: any, blueprint: any) => void) {
    const root = await copyOf("cinematic");
    const read = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));
    const [cinematic, blueprint] = [await read(CINEMATIC), await read("missions/radio-field/blueprint.json")];
    edit(cinematic, blueprint);
    await writeFile(path.join(root, CINEMATIC), JSON.stringify(cinematic));
    await writeFile(path.join(root, "missions/radio-field/blueprint.json"), JSON.stringify(blueprint));
    return unnoted(await checkWorkspace(root)).map(({ file, path, message }) => ({ file, path, message }));
  }

  it("passes the fixture's, noting its cast models have no Model Guide", async () => {
    expect(await checkedWith(() => {})).toEqual([]);
    const notes = (await checkWorkspace(await copyOf("cinematic"))).problems.filter(({ severity }) => severity === "note").map(({ path, message }) => `${path}: ${message}`);
    expect(notes).toEqual([expect.stringMatching(/^cast\.0\.model: SMX3_BGPeople_01 has recorded animations but no Model Guide/), expect.stringMatching(/^cast\.1\.model: SMX3_BGPeople_06 /)]);
  });

  it("rejects a feed through a camera or set the Cinematic lacks, a cameraIndex on a set camera's feed, a feed of no one, and a feed of a member the shot hides", async () => {
    // A set camera's feed films through the rig, NovaStoryAssets' (cinematic-dependencies.test.ts).
    const problems = await checkedWith((cinematic, blueprint) => {
      cinematic.shots[0].feed = "hall/Wide";
      cinematic.shots[1].feed = { camera: "room/Overhead", cameraIndex: 1 };
      blueprint.dependencies = [NOVA_ASSETS];
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.feed", message: "No set hall in this Cinematic (its sets: room)" },
      { file: CINEMATIC, path: "shots.1.feed.camera", message: "The set room has no camera Overhead (its cameras: Wide, Close, Drift)" },
      { file: CINEMATIC, path: "shots.1.feed.cameraIndex", message: "A feed through a set camera films through core's rig, whose camera is its own: cameraIndex picks a cast member's own camera" },
    ]);
    expect(
      await checkedWith((cinematic) => {
        cinematic.shots[0].feed = "ghost";
        cinematic.shots[1].feed = { camera: "visitor", channel: 1 };
        cinematic.shots[1].hide = ["visitor"];
      }),
    ).toEqual([
      { file: CINEMATIC, path: "shots.0.feed", message: 'ghost is neither a set camera ("<set>/<camera name>") nor a cast member of this Cinematic' },
      { file: CINEMATIC, path: "shots.1.feed.camera", message: "The shot hides visitor, so its feed has no one to film" },
    ]);
  });

  it("passes a feed of a set camera and of a cast member, and rejects a channel past 6", async () => {
    expect(
      await checkedWith((cinematic, blueprint) => {
        cinematic.shots[0].feed = "room/Close";
        cinematic.shots[1].feed = { camera: "operator", channel: 6, aspectRatio: 1.6 };
        blueprint.dependencies = [NOVA_ASSETS];
      }),
    ).toEqual([]);
    const problems = await checkedWith((cinematic, blueprint) => {
      cinematic.shots[1].feed = { camera: "room/Close", channel: 7 };
      blueprint.dependencies = [NOVA_ASSETS];
    });
    expect(problems.map(({ path }) => path)).toEqual(["shots.1.feed.channel"]);
  });

  it("warns of a feed no screen on its shot's Set shows, as channel 0 on the Nova bridge's main screen", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast.push({ id: "screen", model: "SMX3_Nova_Ship_Bridge_MainScreen", set: "room", at: [0, 3, 0], facing: 180 });
      cinematic.shots[1].feed = { camera: "room/Wide", channel: 0 };
    });
    expect(problems.filter(({ path }) => path === "shots.1.feed.channel")).toEqual([
      {
        file: CINEMATIC,
        path: "shots.1.feed.channel",
        message: expect.stringMatching(/^No screen known on the Set room shows channel 0, so this feed may show nowhere, unless one of these shows it: RadioDesk, RadioScreen/),
      },
    ]);
  });

  it("rejects an unknown cast member in a shot's hide", async () => {
    expect(
      await checkedWith((cinematic) => {
        cinematic.shots[0].hide = ["ghost"];
      }),
    ).toEqual([{ file: CINEMATIC, path: "shots.0.hide.0", message: "No cast member ghost in this Cinematic" }]);
  });

  it("rejects an unknown sound ID, camera, mark and set", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[1].line = "radio_field-1-9";
      cinematic.shots[0].camera = "room/Overhead";
      cinematic.cast[0].mark = "Doorway";
      cinematic.cast[1].set = "hall";
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.camera", message: "The set room has no camera Overhead (its cameras: Wide, Close, Drift)" },
      { file: CINEMATIC, path: "shots.1.line", message: "No line with the sound ID radio_field-1-9 in the Screenplay" },
      { file: CINEMATIC, path: "cast.0.mark", message: "The set room has no mark Doorway (its marks: Operator, Visitor)" },
      { file: CINEMATIC, path: "cast.1.set", message: "No set hall in this Cinematic (its sets: room)" },
    ]);
  });

  it("rejects a speaker whose model's animations aren't recorded, an anim its model lacks, an unknown member in a shot's anims, and a speaker twice cast", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast[0].model = "Operator";
      cinematic.cast[1].anim = "Dance";
      cinematic.cast.push({ id: "double", model: "SMX3_BGPeople_02", set: "room", mark: "Visitor", speaker: "ZERATUL" });
      cinematic.shots[1].anims = { visitor: "Stand Cover Fidget 01", guard: "Stand" };
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.1.anims.guard", message: "No cast member guard in this Cinematic" },
      { file: CINEMATIC, path: "cast.0.model", message: "Operator's animations aren't recorded, so NOVA can't talk: record them with record_model_anims (from a shell, npm run model-anims -- Operator)" },
      { file: CINEMATIC, path: "cast.1.anim", message: "SMX3_BGPeople_06 has no animation Dance (data/model-anims.json)" },
      { file: CINEMATIC, path: "cast.2.speaker", message: "ZERATUL is cast twice: visitor and double" },
    ]);
  });

  it("rejects \"ahead\" as a member's first look-at, with nothing to end", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast[1].lookAts = [{ at: "ahead", atMs: 1000 }];
    });
    expect(problems).toEqual([{ file: CINEMATIC, path: "cast.1.lookAts.0.at", message: "visitor's first look-at can't be \"ahead\": it faces ahead until one starts" }]);
  });

  it("rejects a sound or a look-at on a line the scene doesn't have, a look-at at no one, at no one cast on a mark or at the member itself, and look-ats out of order", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sounds = [{ sound: "RadioStatic", line: "radio_field-1-9" }];
      cinematic.cast[0].lookAts = [{ at: "ghost" }, { at: "room/Visitor", atMs: 1000 }, { at: "operator", atMs: 2000 }];
      cinematic.cast[1].lookAts = [{ at: "operator", line: "radio_field-1-2" }, { at: "operator", line: "radio_field-1-1" }, { at: "operator", line: "radio_field-1-9" }];
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "sounds.0.line", message: "No line with the sound ID radio_field-1-9 in the Screenplay" },
      { file: CINEMATIC, path: "cast.0.lookAts.0.at", message: "No cast member ghost in this Cinematic" },
      { file: CINEMATIC, path: "cast.0.lookAts.1.at", message: "No one in this Cinematic is cast on the mark Visitor of the set room" },
      { file: CINEMATIC, path: "cast.0.lookAts.2.at", message: "operator can't look at itself" },
      { file: CINEMATIC, path: "cast.1.lookAts.1", message: "A member's look-ats come in time order, each after the one before" },
      { file: CINEMATIC, path: "cast.1.lookAts.2.line", message: "No line with the sound ID radio_field-1-9 in the Screenplay" },
    ]);
  });

  it("warns, once the lines are timed, of a sound or look-at starting at or past the end, and of a look-at at a time before a line's look-at", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sounds = [{ sound: "RadioStatic", atMs: 16740 }];
      // Timed by the estimate, the second line starts 3.86 s in and the Cinematic ends at 16.74 s.
      cinematic.cast[1].lookAts = [{ at: "operator", line: "radio_field-1-2" }, { at: "operator", atMs: 3000 }, { at: "operator", atMs: 99000 }];
    });
    const late = ", so the Cinematic won't compile until its start moves";
    expect(problems).toEqual([
      { file: CINEMATIC, path: "sounds.0", message: `The sound RadioStatic starts 16740 ms in, at or past the Cinematic's end at 16740 ms${late}` },
      { file: CINEMATIC, path: "cast.1.lookAts.1", message: `visitor's look-at at operator starts at 3000 ms, not after the one before at 3860 ms${late}` },
      { file: CINEMATIC, path: "cast.1.lookAts.2", message: `visitor's look-at at operator starts 99000 ms in, at or past the Cinematic's end at 16740 ms${late}` },
    ]);
  });

  it("rejects a sound that ends on a line the scene doesn't have, or both on a line and at a time", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sounds = [
        { sound: "RadioStatic", untilLine: "radio_field-1-9" },
        { sound: "Music_Theme", untilLine: "radio_field-1-2", untilMs: 5000 },
      ];
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "sounds.1.untilMs", message: "A sound ends on a line or untilMs into the Cinematic, not both" },
    ]);
    const unknown = await checkedWith((cinematic) => void (cinematic.sounds = [{ sound: "RadioStatic", untilLine: "radio_field-1-9" }]));
    expect(unknown).toEqual([{ file: CINEMATIC, path: "sounds.0.untilLine", message: "No line with the sound ID radio_field-1-9 in the Screenplay" }]);
  });

  it("warns, once the lines are timed, of a sound that ends at or before its start, or past the Cinematic's end", async () => {
    const problems = await checkedWith((cinematic) => {
      // Timed by the estimate, the second line starts 3.86 s in and the Cinematic ends at 16.74 s.
      cinematic.sounds = [
        { sound: "RadioStatic", atMs: 5000, untilMs: 5000 },
        { sound: "Music_Calm", line: "radio_field-1-2", untilLine: "radio_field-1-1" },
        { sound: "Music_Alert", line: "radio_field-1-2", untilMs: 16741 },
        { sound: "Music_Outro", line: "radio_field-1-2", untilMs: 16740, fadeOutMs: 2000 },
      ];
    });
    const late = ", so the Cinematic won't compile until its end moves";
    expect(problems).toEqual([
      { file: CINEMATIC, path: "sounds.0.untilMs", message: `The sound RadioStatic ends 5000 ms in, at or before its start at 5000 ms${late}` },
      { file: CINEMATIC, path: "sounds.1.untilLine", message: `The sound Music_Calm ends 1000 ms in, at or before its start at 3860 ms${late}` },
      { file: CINEMATIC, path: "sounds.2.untilMs", message: `The sound Music_Alert ends 16741 ms in, past the Cinematic's end at 16740 ms${late}` },
    ]);
  });

  it("rejects a look-at or attached lamp aimed at a mark two members are cast on, and ambience two sets loop at different volumes", async () => {
    const root = await copyOf("cinematic");
    const read = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));
    const write = (file: string, json: unknown) => writeFile(path.join(root, file), JSON.stringify(json));
    const [room, hall, cinematic] = [await read("missions/radio-field/sets/radio-room.json"), await read("missions/radio-field/sets/radio-hall.json"), await read(CINEMATIC)];
    room.lamps[0].attach = { mark: "Operator", point: "Ref_Overhead" };
    room.sounds = [{ sound: "RoomHum", volume: 0.5 }];
    hall.sounds = [{ sound: "RoomHum" }];
    cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [40, 0, 0] });
    cinematic.cast.push({ id: "double", model: "SMX3_BGPeople_06", set: "room", mark: "Operator" });
    cinematic.cast[1].lookAts = [{ at: "room/Operator" }];
    await Promise.all([write("missions/radio-field/sets/radio-room.json", room), write("missions/radio-field/sets/radio-hall.json", hall), write(CINEMATIC, cinematic)]);
    const problems = unnoted(await checkWorkspace(root)).map(({ file, path, message }) => ({ file, path, message }));
    expect(problems).toEqual(
      expect.arrayContaining([
        { file: CINEMATIC, path: "sets.1", message: "The sets room and hall both loop the ambience RoomHum, at volumes 0.5 and 1; it plays once, so give it one volume" },
        { file: CINEMATIC, path: "sets.0", message: `operator and double are all cast on the mark Operator of the set room, so the lamp ${room.lamps[0].name} attached to it can't tell which to follow` },
        { file: CINEMATIC, path: "cast.1.lookAts.0.at", message: "operator and double are all cast on the mark Operator of the set room, so a look-at at the mark can't tell which; name the member instead" },
      ]),
    );
  });

  it("rejects a set's look-at or attached lamp on a mark it doesn't have, in the set's file", async () => {
    const root = await copyOf("cinematic");
    const setFile = path.join(root, "missions/radio-field/sets/radio-room.json");
    const set = JSON.parse(await readFile(setFile, "utf8"));
    set.marks[0].lookAt = { mark: "Doorway" };
    set.marks[1].lookAt = { mark: "Visitor" };
    set.lamps[0].attach = { mark: "Doorway", point: "Ref_Overhead" };
    await writeFile(setFile, JSON.stringify(set));
    const problems = unnoted(await checkWorkspace(root)).map(({ file, path, message }) => ({ file, path, message }));
    expect(problems).toEqual([
      { file: "missions/radio-field/sets/radio-room.json", path: "marks.0.lookAt.mark", message: "No mark Doorway in the set" },
      { file: "missions/radio-field/sets/radio-room.json", path: "marks.1.lookAt.mark", message: "A mark's character can't look at itself" },
      { file: "missions/radio-field/sets/radio-room.json", path: "lamps.0.attach.mark", message: "No mark Doorway in the set" },
    ]);
  });

  it("rejects a set piece's anim its recorded model lacks, and takes any anim on a model not recorded", async () => {
    const root = await copyOf("cinematic");
    const setFile = path.join(root, "missions/radio-field/sets/radio-room.json");
    const set = JSON.parse(await readFile(setFile, "utf8"));
    set.pieces.push({ model: "SMX3_BGPeople_02", at: [0, 0, 0], anim: "Dance" }, { model: "RoomLamp", at: [0, 0, 0], anim: "Dance" });
    await writeFile(setFile, JSON.stringify(set));
    const problems = unnoted(await checkWorkspace(root)).map(({ file, path, message }) => ({ file, path, message }));
    expect(problems).toEqual([{ file: "missions/radio-field/sets/radio-room.json", path: "pieces.5.anim", message: "SMX3_BGPeople_02 has no animation Dance (data/model-anims.json)" }]);
  });

  it("warns once on a set's flat pieces that overlap at one height, however often the Cinematic places it, against its file", async () => {
    const root = await copyOf("cinematic");
    const setFile = path.join(root, "missions/radio-field/sets/radio-room.json");
    const set = JSON.parse(await readFile(setFile, "utf8"));
    set.pieces.push({ model: "FloorTile", at: [0, 0, 0] }, { model: "FloorTile", at: [1, 0, 0] });
    await writeFile(setFile, JSON.stringify(set));
    const cinematicFile = path.join(root, "missions/radio-field/cinematics/radio.json");
    const cinematic = JSON.parse(await readFile(cinematicFile, "utf8"));
    cinematic.sets.push({ ...cinematic.sets[0], id: "room-again", offset: [40, 0, 0] });
    await writeFile(cinematicFile, JSON.stringify(cinematic));
    const modelFootprints = { FloorTile: { file: "Assets/FloorTile.m3", min: [-1, -1, 0], max: [1, 1, 0.02], materials: ["opaque"] } } as const;
    const problems = unnoted(await checkWorkspace(root, { modelFootprints })).map(({ file, path, severity }) => ({ file, path, severity }));
    expect(problems).toEqual([{ file: "missions/radio-field/sets/radio-room.json", path: "pieces.6", severity: "warning" }]);
  });

  it("rejects a list of a shot's anims out of time order, and an anim in it its model lacks", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02", atMs: 2000 }, { anim: "Dance", atMs: 1000 }] };
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.1.anims.visitor.1", message: "SMX3_BGPeople_06 has no animation Dance (data/model-anims.json)" },
      { file: CINEMATIC, path: "shots.1.anims.visitor.1.atMs", message: "A shot's anims for a member start in time order, each after the one before" },
    ]);
  });

  it("rejects a shot's timed anim whose in-point is at or past its recorded clip's end", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[1].anims = { visitor: [{ anim: "Stand Cover 02", atMs: 1000, fromMs: 1500 }, { anim: "Stand Cover Talk", atMs: 2000, fromMs: 3000 }] };
    });
    expect(problems).toEqual([{ file: CINEMATIC, path: "shots.1.anims.visitor.1.fromMs", message: "SMX3_BGPeople_06's Stand Cover Talk is 3000 ms long: its in-point 3000 ms is at or past its end (data/model-anims.json)" }]);
  });

  it("rejects an animSpeed that isn't positive", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast[0].animSpeed = 0;
    });
    expect(problems).toEqual([{ file: CINEMATIC, path: "cast.0.animSpeed", message: "Too small: expected number to be >0" }]);
  });

  it("rejects a light's step before its last that leaves out ms", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[1] = { ...cinematic.shots[1], set: "room", camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 10, fov: 20 }, lights: [{ name: "Flash", at: [0, 0, 1], color: [1, 1, 1], strength: 0, range: 2, steps: [{ strength: 10 }, { strength: 0, ms: 500 }] }] };
    });
    expect(problems).toEqual([{ file: CINEMATIC, path: "shots.1.lights.0.steps.0.ms", message: "Only a shot's last step may leave out ms: it takes the rest of the shot" }]);
  });

  it("rejects an unknown member entering or exiting, a member entered twice or exiting before it enters, and a step that changes nothing", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[0].enters = { ghost: 100, visitor: 200 };
      cinematic.shots[1].enters = { visitor: 100 };
      cinematic.shots[0].exits = { operator: 300 };
      cinematic.shots[1].enters.operator = 50;
      cinematic.shots[1].moves = { visitor: [{ ms: 100 }] };
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.1.moves.visitor.0", message: "A step moves (to), turns (facing), scales (scale) or fades (opacity) its member" },
    ]);
    const timed = await checkedWith((cinematic) => {
      cinematic.shots[0].enters = { ghost: 100, visitor: 200 };
      cinematic.shots[1].enters = { visitor: 100, operator: 50 };
      cinematic.shots[0].exits = { operator: 300 };
    });
    expect(timed).toEqual([
      { file: CINEMATIC, path: "shots.0.enters.ghost", message: "No cast member ghost in this Cinematic" },
      // Each member in cast order: the operator, then the visitor.
      { file: CINEMATIC, path: "shots.0.exits.operator", message: "operator exits before it enters, in shot 1" },
      { file: CINEMATIC, path: "shots.1.enters.visitor", message: "visitor enters once; shot 0 already enters it" },
    ]);
  });

  it("rejects a move to an unknown camera, to another set or to a camera it can't reach, and a set on a set camera's shot", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [100, 0, 0] });
      cinematic.shots[0].to = "room/Close";
      cinematic.shots[0].set = "room";
      cinematic.shots[0].move = "ease";
      cinematic.shots[1].to = "hall/Wide";
      cinematic.shots.push({ camera: "hall/Wide", afterMs: 0, pauseAfterMs: 1000, to: "hall/Nowhere" }, { camera: "hall/Wide", afterMs: 0, pauseAfterMs: 1000, move: "linear" }, {
        camera: { target: [0, 1, 1], distance: 4, pitch: 5, yaw: 0, fov: 20 },
        set: "hall",
        afterMs: 0,
        pauseAfterMs: 1000,
        to: "hall/Wide",
      });
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.set", message: "A shot through a set camera is on that camera's set" },
      { file: CINEMATIC, path: "shots.0.to", message: "Wide and Close differ in heightOffset or verticalFov, which a move doesn't animate" },
      { file: CINEMATIC, path: "shots.1.to", message: "A move stays on its shot's set, room" },
      { file: CINEMATIC, path: "shots.2.to", message: "The set hall has no camera Nowhere (its cameras: Wide, Door, Low)" },
      { file: CINEMATIC, path: "shots.3.move", message: "A shot with no move (to or path) has no move style" },
      { file: CINEMATIC, path: "shots.4.to", message: "The shot's own camera and Wide differ in heightOffset or verticalFov, which a move doesn't animate" },
    ]);
  });

  it("rejects a cut inside a line the shot before doesn't carry to that point", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots[0].intoLineMs = 500;
      cinematic.shots[1].pauseAfterMs = 1000;
      cinematic.shots.push({ camera: "room/Wide", line: "radio_field-1-2", intoLineMs: 4000 }, { camera: "room/Close", line: "radio_field-1-2", intoLineMs: 3000 });
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.intoLineMs", message: "The first shot with a line cuts on its start" },
      { file: CINEMATIC, path: "shots.2.intoLineMs", message: "The shot before holds a pause after its lines, so it can't carry radio_field-1-2 into this cut" },
      { file: CINEMATIC, path: "shots.3.intoLineMs", message: "It cuts into radio_field-1-2 no later than the shot before" },
    ]);
  });

  it("rejects lines that would play under a shot with no line before the first cut on a line", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.shots = [{ camera: "room/Wide", afterMs: 0, pauseAfterMs: 2000 }, cinematic.shots[1]];
    });
    expect(problems).toEqual([
      {
        file: CINEMATIC,
        path: "shots.1.line",
        message: "The first shot with a line cuts on the scene's first line, radio_field-1-1; radio_field-1-1 would have no shot",
      },
    ]);
  });

  it("warns of a Light it names that is neither its sets', the Mission's own, a Plugin's nor stock", async () => {
    const root = await copyOf("cinematic");
    const file = path.join(root, CINEMATIC);
    const cinematic = JSON.parse(await readFile(file, "utf8"));
    cinematic.light = "NoonGlare";
    cinematic.shots[0].light = "RoomAlarm";
    cinematic.shots[1].light = "ArcadeCityLight";
    cinematic.shots.push({ ...cinematic.shots[1], line: undefined, afterMs: 0, pauseAfterMs: 1000, light: "NoonGlair" });
    await writeFile(file, JSON.stringify(cinematic));
    expect(unnoted(await checkWorkspace(root))).toEqual([
      // A stock Light, but Liberty's campaign's, which the default Void (Mod) doesn't load (#1019).
      {
        mission: "radio-field",
        file: CINEMATIC,
        message:
          "Its Light ArcadeCityLight is campaigns/liberty.sc2campaign's, which the map's dependencies don't load, so it won't be there in the game: add bnet:Swarm (Campaign)/0.0/999,file:Campaigns/Swarm.SC2Campaign to the Blueprint's dependencies (or to a mod it depends on)",
        severity: "warning",
      },
      { mission: "radio-field", file: CINEMATIC, path: "shots.2.light", message: "No Light NoonGlair in its sets' Lights, the Mission's lights, a Plugin's Lights (NoonGlare, NoonShade), data/light-catalog.json or the Campaign Mod; check a dependency defines it", severity: "warning" },
    ]);
  });

  it("rejects a Light of the Mission's own with a Plugin Light's id", async () => {
    expect(
      await checkedWith((_, blueprint) => {
        blueprint.lights = [{ id: "NoonShade", from: "ArcadeCityLight" }];
      }),
    ).toEqual([{ file: "missions/radio-field/blueprint.json", path: "lights.0.id", message: "Plugin noon contributes a Light NoonShade too; rename this one" }]);
  });

  it("rejects a Cinematic for a scene with no cue", async () => {
    const problems = await checkedWith((_, blueprint) => {
      blueprint.screenplay.script.cues = [];
    });
    expect(problems).toEqual([
      {
        file: "missions/radio-field/blueprint.json",
        path: "screenplay.script.cinematics.0.scene",
        message: "Scene 1 has no cue, so its Cinematic would never play; cue it in screenplay.script.cues",
      },
    ]);
  });
});

describe("a facing in the ship's own frame", () => {
  const rounded = (triple: readonly number[]) => triple.map((value) => Math.round(value * 100) / 100 + 0);

  it("turns heading, pitch and roll into the world-axis triple the engine applies, z then y then x", () => {
    // A bank about the nose comes out as x at heading 0, y at 90, and a mix in between.
    expect(rounded(worldFacing({ heading: 100, roll: -28 }))).toEqual([5.28, -27.54, 101.29]);
    expect(rounded(worldFacing({ heading: 68, roll: -5 }))).toEqual([-1.88, -4.64, 67.92]);
    expect(rounded(worldFacing({ heading: 90, roll: -28 }))).toEqual([0, -28, 90]);
    expect(rounded(worldFacing({ heading: 0, roll: 10 }))).toEqual([10, 0, 0]);
    // Nose up is about the ship's own lateral axis: at heading 90, about world x.
    expect(rounded(worldFacing({ heading: 90, pitch: 15 }))).toEqual([15, 0, 90]);
  });

  it("keeps a banked ship's bank about its nose when a step turns it by degrees", () => {
    const banked = { heading: 90, roll: -28 };
    const turned = turnedTo(banked, 0, [0, -28, 90]);
    expect(turned).toEqual({ heading: 0, roll: -28 });
    expect(rounded(worldFacing(turned as { heading: number; roll: number }))).toEqual([-28, 0, 0]);
    // An Editor triple keeps its x and y, as before.
    expect(turnedTo([5, 6, 90], 0, [5, 6, 90])).toEqual([5, 6, 0]);
    expect(turnedTo(90, { heading: 10, pitch: 5 }, [0, 0, 90])).toEqual({ heading: 10, pitch: 5 });
  });

  it("is a cast member's facing and a step's, alongside degrees and the Editor's triple", () => {
    const parsed = CinematicSchema.parse({
      sets: [{ id: "space", file: "sets/space.json", offset: [0, 0, 0] }],
      cast: [
        { id: "ship", model: "Ship", set: "space", at: [0, 0, 0], facing: { heading: 90, roll: -28 } },
        { id: "other", model: "Ship", set: "space", at: [0, 0, 0], facing: [1, 2, 3] },
      ],
      shots: [{ camera: "space/Wide", afterMs: 0, pauseAfterMs: 2000, moves: { ship: [{ to: [1, 0, 0], facing: { heading: 0 } }] } }],
    });
    expect(parsed.cast[0]!.facing).toEqual({ heading: 90, roll: -28 });
    expect(parsed.cast[1]!.facing).toEqual([1, 2, 3]);
    expect(parsed.shots[0]!.moves!.ship![0]!.facing).toEqual({ heading: 0 });
  });
});

describe("castClips", () => {
  const clips = (...names: string[]) => castClips(names.map((name) => ({ name, durationMs: 1000, moveSpeed: 0, looping: true })));
  const names = ({ stand, talks }: ReturnType<typeof castClips>) => [stand?.name, talks.map((talk) => talk.name)];
  /** A hero ranked to talk in Victory, with a Victory B family too. */
  const hero = ["Stand", "Stand Victory", "Stand Victory B", "Talk Victory", "Talk Victory 01", "Talk Victory B", "Talk Victory B 01"].map((name) => ({ name, durationMs: 1000, moveSpeed: 0, looping: true }));

  it("talks with the plain Talks over Stand", () => {
    expect(names(clips("Stand", "Stand B", "Talk B 01", "Talk", "Talk 01", "Talk Angry", "Stand Cover Talk"))).toEqual(["Stand", ["Talk", "Talk 01"]]);
  });

  it("else with the B Talks over Stand B, else the Talks with the fewest other words over their own Stand", () => {
    expect(names(clips("Stand", "Stand B", "Talk B 01", "Talk B 02", "Talk Angry 01"))).toEqual(["Stand B", ["Talk B 01", "Talk B 02"]]);
    expect(names(clips("Stand", "Stand Victory", "Talk Victory", "Talk Victory 01", "Talk Victory B"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
    expect(names(clips("Stand", "Talk Angry"))).toEqual(["Stand", ["Talk Angry"]]);
  });

  it("talks in the family of the Stand a member stands in, when its model has Talks of that family", () => {
    expect(names(castClips(hero, "Stand Victory B"))).toEqual(["Stand Victory B", ["Talk Victory B", "Talk Victory B 01"]]);
    // An anim with no Talk family of its own keeps the ranking.
    expect(names(castClips(hero, "Stand Ready"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
    expect(names(castClips(hero))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
  });

  it("stands and talks in its Model Guide's default family over the ranking, when the model has a Stand of it", () => {
    expect(names(castClips(hero, undefined, "Victory B"))).toEqual(["Stand Victory B", ["Talk Victory B", "Talk Victory B 01"]]);
    // The plain family's Stand is Stand; with no plain Talks, it talks in the ranked family.
    expect(names(castClips(hero, undefined, ""))).toEqual(["Stand", ["Talk Victory", "Talk Victory 01"]]);
    // A default the model has no Stand of leaves the ranking.
    expect(names(castClips(hero, undefined, "Cover"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
  });

  it("stands in a default family with no Talks of its own, a numbered Stand of it if that's all it has, and talks in the ranked family", () => {
    expect(names(clips("Stand", "Stand Cover 02", "Talk 01", "Talk 02"))).toEqual(["Stand", ["Talk 01", "Talk 02"]]);
    const cover = ["Stand", "Stand Cover 02", "Stand Cover 03", "Talk 01", "Talk 02"].map((name) => ({ name, durationMs: 1000, moveSpeed: 0, looping: true }));
    expect(names(castClips(cover, undefined, "Cover"))).toEqual(["Stand Cover 02", ["Talk 01", "Talk 02"]]);
  });

  it("keeps a member's own anim over its Model Guide's default family", () => {
    expect(names(castClips(hero, "Stand Victory", "Victory B"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
  });

  it("talks in its Model Guide's default family when its own anim picks no family", () => {
    // Victory is ranked first, Victory B is the default; a one-off anim that's a Stand of neither.
    expect(names(castClips(hero, "Channel Interact", "Victory B"))).toEqual(["Stand Victory B", ["Talk Victory B", "Talk Victory B 01"]]);
    expect(names(castClips(hero, "Stand Ready", "Victory B"))).toEqual(["Stand Victory B", ["Talk Victory B", "Talk Victory B 01"]]);
    // A plain Stand on a model with no plain Talks picks no family either.
    expect(names(castClips(hero, "Stand", "Victory B"))).toEqual(["Stand Victory B", ["Talk Victory B", "Talk Victory B 01"]]);
    // With no default, or a default the model has no Talks of, the ranking picks.
    expect(names(castClips(hero, "Channel Interact"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
    expect(names(castClips(hero, "Channel Interact", "Cover"))).toEqual(["Stand Victory", ["Talk Victory", "Talk Victory 01"]]);
  });

  it("finds no Talk in a model without one", () => {
    expect(names(clips("Stand", "Stand Cover Talk"))).toEqual(["Stand", []]);
  });
});

describe("cinematicTimeline", () => {
  const line = (soundId: string, words: number): ScriptLine =>
    ({ kind: "line", speaker: "NOVA", character: "Nova", characterId: "Nova", soundId, lineId: soundId, soundLine: soundId, text: Array(words).fill("word").join(" "), spans: [] }) as ScriptLine;
  const lines = [line("a", 1), line("b", 1), line("c", 1), line("d", 1)];
  const lengths = new Map([["a", 2000], ["b", 3000], ["c", 1500], ["d", 2500]]);
  const camera = "room/Wide";

  it("starts a shot's line lineAtMs after its cut, a J cut the next shot cuts into", () => {
    const timeline = cinematicTimeline(
      [
        { camera, line: "a", lineAtMs: 6000 },
        { camera, line: "a", intoLineMs: 1500 },
        { camera, line: "c" },
      ],
      lines,
      lengths,
    );
    // a is heard over the first shot from 6 s, and the second cuts 1.5 s into it; b follows a.
    expect(timeline.lines.map(({ line, startMs }) => [line.soundId, startMs])).toEqual([
      ["a", 6000],
      ["b", 8000],
      ["c", 11000],
      ["d", 12500],
    ]);
    expect(timeline.shots.map(({ startMs }) => startMs)).toEqual([0, 7500, 11000]);
    // A later shot's line waits too: c from 1 s after its cut.
    const later = cinematicTimeline([{ camera, line: "a" }, { camera, line: "c", lineAtMs: 1000 }], lines, lengths);
    expect(later.shots.map(({ startMs }) => startMs)).toEqual([0, 6000]);
    expect(later.lines.find(({ line }) => line.soundId === "c")!.startMs).toBe(7000);
  });

  it("cuts on line starts, holds a pause on its shot, and gives a shot with no line its pause", () => {
    const timeline = cinematicTimeline(
      [
        { camera, line: "a" },
        { camera, line: "c", pauseAfterMs: 1000 },
        { camera, afterMs: 0, pauseAfterMs: 1600 },
        { camera, line: "d" },
      ],
      lines,
      lengths,
    );
    // a and b under the first shot from the end of the fade in; c, then a 1 s hold; a 1.6 s silent shot; d.
    expect(timeline.lines.map(({ line, startMs }) => [line.soundId, startMs])).toEqual([
      ["a", 1000],
      ["b", 3000],
      ["c", 6000],
      ["d", 10100],
    ]);
    expect(timeline.shots).toEqual([
      { startMs: 0, durationMs: 6000 },
      { startMs: 6000, durationMs: 2500 },
      { startMs: 8500, durationMs: 1600 },
      { startMs: 10100, durationMs: 2500 },
    ]);
    expect(timeline.contentMs).toBe(12600);
  });

  it("cuts a shot with intoLineMs that far into its line, and goes on from the line's end", () => {
    const timeline = cinematicTimeline(
      [
        { camera, line: "a" },
        { camera, line: "b" },
        { camera, line: "b", intoLineMs: 1200 },
        { camera, line: "c" },
      ],
      lines,
      lengths,
    );
    expect(timeline.lines.map(({ line, startMs }) => [line.soundId, startMs])).toEqual([
      ["a", 1000],
      ["b", 3000],
      ["c", 6000],
      ["d", 7500],
    ]);
    expect(timeline.shots.map(({ startMs }) => startMs)).toEqual([0, 3000, 4200, 6000]);
    expect(() => cinematicTimeline([{ camera, line: "a" }, { camera, line: "a", intoLineMs: 2000 }], lines, lengths)).toThrow("Shot 1 cuts 2000 ms into a, which lasts 2000 ms");
  });

  it("times a line with no voice file at 0.91 s and 0.39 s a word, and one whose file isn't a whole WAV the same way", async () => {
    const folder = await tempFolder();
    await writeFile(path.join(folder, "b.wav"), Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt \x10\0\0\0", "latin1"), Buffer.alloc(10)]));
    const lengths = await lineLengthsMs([line("a", 10), line("b", 1)], folder);
    expect([lengths.get("a"), lengths.get("b")]).toEqual([4810, 1300]);
  });
});

describe("compile_cutscene on a Cinematic", () => {
  it("writes it into the compiled package with its lines; play leaves a Cinematic cued at mission start to its cue, not a second loop", async () => {
    const root = await copyOf("cinematic");
    const client = await connect(root);
    const compiledMap = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    expect(compiledMap.isError, text(compiledMap)).toBeFalsy();
    const map = path.join(root, "missions/radio-field/Radio-Field.SC2Map");
    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "radio-field", shotList: "missions/radio-field/cinematics/radio.json", play: true } });
    expect(reply.isError, text(reply)).toBeFalsy();
    const file = path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene");
    expect(reply.structuredContent).toMatchObject({ file, shots: 2 });
    expect(text(reply)).toMatch(/^2 shots written to .*radio\.SC2Cutscene\nPlays from map start in a full-screen dialog, from its scene's missionStart cue\n/);
    const nodes = all(readCutscene(await readFile(file, "utf8")));
    expect(nodes.filter((node) => node.tag === "CCutsceneElementConversationDriver")).toHaveLength(2);
    const script = await readFile(path.join(map, "MapScript.galaxy"), "utf8");
    expect(script).toContain('libNtve_gf_SetDialogItemCutscene(DialogControlLastCreated(), "Cutscenes\\\\radio.SC2Cutscene", PlayerGroupAll());');
    expect(script).not.toContain("Cinematic_Init");
    expect(script).toContain("TriggerExecute(gt_CinematicRadio, true, true);");
  });

  it("plays a Cinematic with no mission start cue from map start in a loop, in a full-screen dialog", async () => {
    const root = await copyOf("cinematic");
    const blueprintPath = path.join(root, "missions/radio-field/blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint.screenplay.script.cues = [{ scene: 1, cue: { type: "anchorEntersZone", anchorId: "radio", zoneId: "field" } }];
    blueprint.anchors = [{ id: "radio", name: "Radio", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 32, y: 32, z: 0 }, rotation: 0 }];
    await writeFile(blueprintPath, JSON.stringify(blueprint));
    const client = await connect(root);
    const compiledMap = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    expect(compiledMap.isError, text(compiledMap)).toBeFalsy();
    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "radio-field", shotList: "missions/radio-field/cinematics/radio.json", play: true } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/\nPlays from map start in a full-screen dialog\n/);
    const script = await readFile(path.join(root, "missions/radio-field/Radio-Field.SC2Map/MapScript.galaxy"), "utf8");
    expect(script).toContain('libNtve_gf_SetDialogItemCutscene(DialogControlLastCreated(), "Cutscenes\\\\radio.SC2Cutscene", PlayerGroupAll());');
    expect(script).toContain("Cinematic_Init");
  });
});

describe("a compiled Cinematic's attachments", () => {
  const actorNamed = (nodes: CutsceneNode[], name: string) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name);
  const attachmentOf = (node: CutsceneNode | undefined) => node?.children.find((child) => child.tag === "CCutsceneNodeAttachment")?.children.map(({ attrs: { guid: _guid, ...attrs } }) => attrs);
  // The operator shows only in the wide shot (their mark was seen only through it); the visitor in both.
  const riders = (cinematic: any) => {
    cinematic.cast.unshift({ id: "headset", model: "Headset", set: "room", attach: { to: "operator", point: "Ref_Head", offset: [0, 0, 0.1] } });
    cinematic.cast.push({ id: "lantern", model: "Lantern", set: "room", opacity: 0.5, attach: { to: "visitor", point: "Ref_Hand Left", rotation: [0, 90, 0] } });
  };

  it("rides each copy of a member on its carrier's copy in that shot, listed before or after it, and shows it only in the shots its carrier shows in", async () => {
    const { nodes } = await compiled(riders);
    expect(actorNamed(nodes, "s020 headset")).toBeUndefined();
    expect(attachmentOf(actorNamed(nodes, "s010 headset"))).toEqual([
      { duration: "4000", attachGuid: actorNamed(nodes, "s010 operator")!.attrs.guid, attachName: "Ref_Head", offsetX: "0.000000", offsetY: "0.000000", offsetZ: "0.100000", rotationX: "0.000000", rotationY: "0.000000", rotationZ: "0.000000" },
    ]);
    expect(attachmentOf(actorNamed(nodes, "s010 lantern"))).toEqual([expect.objectContaining({ attachGuid: actorNamed(nodes, "s010 visitor")!.attrs.guid, attachName: "Ref_Hand Left", rotationY: "90.000000" })]);
    expect(attachmentOf(actorNamed(nodes, "s020 lantern"))).toEqual([expect.objectContaining({ start: "4000", duration: "14000", lockedToEnd: "1", attachGuid: actorNamed(nodes, "s020 visitor")!.attrs.guid })]);
    // Its place and turn are its carrier's point's; its own look is its own.
    expect(actorNamed(nodes, "s020 lantern")!.attrs).toMatchObject({ modelLink: "Lantern", opacity: "0.500000" });
    expect(actorNamed(nodes, "s020 lantern")!.attrs.position).toBeUndefined();
    expect(actorNamed(nodes, "s020 lantern")!.attrs.rotation).toBeUndefined();
  });

  it("exists only while its carrier does, and fades on its own", async () => {
    const { nodes } = await compiled((cinematic) => {
      riders(cinematic);
      // A voice says the visitor's line once they've gone.
      delete cinematic.cast[2].speaker;
      cinematic.shots[1].exits = { visitor: 2000 };
      cinematic.shots[1].moves = { lantern: [{ opacity: 0, ms: 1000 }] };
    });
    const lantern = actorNamed(nodes, "s020 lantern")!;
    expect(lantern.children[0]!.attrs).toMatchObject({ start: "4000", duration: "2000" });
    expect(lantern.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((curve) => curve.attrs.propertyName)).toEqual(["opacity"]);
  });

  it("rides a shot's camera on a carrier's copy in the shot, its position, distance, pitch and yaw the camera's own", async () => {
    const { nodes } = await compiled((cinematic) => {
      cinematic.cast.push({ id: "rig", model: "MarineXPR", set: "room", at: [1, 1, 0], opacity: 0, anim: "Flail", animSpeed: 0.3 });
      cinematic.shots[1].cameraAttach = { to: "rig", point: "Ref_Head", offset: [0, 0, -0.6] };
    });
    const close = nodes.find((node) => node.tag === "CCutsceneNodeCamera" && node.attrs.name === "Close")!;
    // The Close camera's own target, (1, 1, 1.6) on the room placed at offset (10, 0, 0).
    expect(close.attrs).toMatchObject({ position: "11.000000,1.000000,1.600000", distance: "3.000000", pitch: "5.000000", yaw: "90.000000" });
    expect(attachmentOf(close)).toEqual([
      { start: "4000", duration: "14000", lockedToEnd: "1", attachGuid: actorNamed(nodes, "s020 rig")!.attrs.guid, attachName: "Ref_Head", offsetX: "0.000000", offsetY: "0.000000", offsetZ: "-0.600000", rotationX: "0.000000", rotationY: "0.000000", rotationZ: "0.000000" },
    ]);
    expect(actorNamed(nodes, "s020 rig")!.attrs).toMatchObject({ modelLink: "MarineXPR", opacity: "0.000000" });
    expect(actorNamed(nodes, "s020 rig")!.children[1]!.children[0]!.attrs).toMatchObject({ anim: "Flail", looping: "1", timeScale: "0.300000" });
    expect(attachmentOf(nodes.find((node) => node.tag === "CCutsceneNodeCamera" && node.attrs.name === "Wide"))).toBeUndefined();
  });
});

describe("checking a Cinematic's attachments", () => {
  const CINEMATIC = "missions/radio-field/cinematics/radio.json";
  async function checkedWith(edit: (cinematic: any) => void) {
    const root = await copyOf("cinematic");
    const cinematic = JSON.parse(await readFile(path.join(root, CINEMATIC), "utf8"));
    edit(cinematic);
    await writeFile(path.join(root, CINEMATIC), JSON.stringify(cinematic));
    return unnoted(await checkWorkspace(root)).map(({ file, path, message, severity }) => ({ file, path, message, ...(severity ? { severity } : {}) }));
  }

  it("rejects a rider of no one, of itself, in a loop or on another set than its carrier, and steps that move or turn it", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [0, 50, 0] });
      cinematic.cast.push(
        { id: "ghost", model: "Ghost", set: "room", attach: { to: "nobody", point: "Ref_Head" } },
        { id: "selfie", model: "Selfie", set: "room", attach: { to: "selfie", point: "Ref_Head" } },
        { id: "ring-a", model: "Ring", set: "room", attach: { to: "ring-b", point: "Ref_Head" } },
        { id: "ring-b", model: "Ring", set: "room", attach: { to: "ring-a", point: "Ref_Head" } },
        { id: "far", model: "Far", set: "hall", attach: { to: "visitor", point: "Ref_Head" } },
        { id: "lantern", model: "Lantern", set: "room", attach: { to: "visitor", point: "Ref_Hand Left" } },
      );
      cinematic.shots[1].moves = { lantern: [{ to: [0, 0, 1], ms: 500 }, { facing: 90, ms: 500 }, { opacity: 0 }] };
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "cast.2.attach.to", message: "No cast member nobody in this Cinematic" },
      { file: CINEMATIC, path: "cast.3.attach.to", message: "selfie can't ride itself" },
      { file: CINEMATIC, path: "cast.4.attach.to", message: "ring-a rides in a loop: ring-a → ring-b → ring-a" },
      { file: CINEMATIC, path: "cast.5.attach.to", message: "ring-b rides in a loop: ring-b → ring-a → ring-b" },
      { file: CINEMATIC, path: "cast.6.attach.to", message: "far rides visitor, who is on the set room, not hall: put them on one set" },
      ...[0, 1].map((step) => ({ file: CINEMATIC, path: `shots.1.moves.lantern.${step}`, message: "lantern rides visitor, which moves and turns it: its steps only scale and fade it (opacity, scale); move visitor, or turn it on the attach's rotation" })),
    ]);
  });

  it("rejects a rider with a mark, point or facing of its own, and a riding camera with a shake", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast.push({ id: "lantern", model: "Lantern", set: "room", mark: "Visitor", at: [0, 0, 0], facing: 90, attach: { to: "visitor", point: "Ref_Hand Left" } });
      cinematic.shots[1].cameraAttach = { to: "visitor", point: "Ref_Head" };
      cinematic.shots[1].shake = { amplitude: 0.1, hz: 4 };
    });
    const rides = (key: string) => `lantern rides visitor's Ref_Hand Left, so it has no ${key} of its own: give its place as the attach's offset and rotation`;
    expect(problems).toEqual([
      { file: CINEMATIC, path: "cast.2.mark", message: rides("mark") },
      { file: CINEMATIC, path: "cast.2.at", message: rides("point") },
      { file: CINEMATIC, path: "cast.2.facing", message: rides("facing") },
      { file: CINEMATIC, path: "shots.1.shake", message: "The camera rides visitor, which holds its target, so a shake can't jolt it: shake visitor instead (a looping Flail or Walk anim)" },
    ]);
  });

  it("rejects a camera on a carrier with no copy in the shot (its mark unseen, its own carrier hidden, gone already), and warns of one that comes or goes mid-shot or stands away from the camera's target", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast.push({ id: "badge", model: "Badge", set: "room", attach: { to: "operator", point: "Ref_Chest" } });
      cinematic.cast.push({ id: "rig", model: "MarineXPR", set: "room", at: [1, 1, 0], opacity: 0 });
      // The operator's mark is seen only through Wide, so neither they nor their badge are in Close.
      cinematic.shots[1].cameraAttach = { to: "operator", point: "Ref_Head" };
      const close = { camera: "room/Close", afterMs: 0, pauseAfterMs: 1000 };
      cinematic.shots.push(
        { ...close, cameraAttach: { to: "badge", point: "Ref_Center" } },
        { ...close, cameraAttach: { to: "rig", point: "Ref_Head" }, enters: { rig: 500 } },
        { ...close, cameraAttach: { to: "rig", point: "Ref_Head" }, exits: { rig: 0 } },
        { ...close, cameraAttach: { to: "rig", point: "Ref_Head" } },
        { camera: { target: [4, 1, 1], distance: 3, pitch: 5, yaw: 0, fov: 30 }, set: "room", afterMs: 0, pauseAfterMs: 1000, cameraAttach: { to: "visitor", point: "Ref_Head" } },
      );
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.1.cameraAttach.to", message: "operator has no copy in this shot (its mark Operator isn't seen through room/Close), so its camera has no one to ride" },
      { file: CINEMATIC, path: "shots.2.cameraAttach.to", message: "badge has no copy in this shot (it rides operator, who has no copy in this shot), so its camera has no one to ride" },
      { file: CINEMATIC, path: "shots.3.cameraAttach.to", message: "rig comes into being 500 ms in, so the camera rides it only while it exists, and films from its own position the rest of the shot", severity: "warning" },
      ...[4, 5].map((shot) => ({ file: CINEMATIC, path: `shots.${shot}.cameraAttach.to`, message: "rig doesn't exist in this shot (it goes 0 ms into shot 4), so its camera has no one to ride" })),
      { file: CINEMATIC, path: "shots.6.camera", message: "The camera rides visitor, but its target is 6.0 cells from where visitor stands; its position is still that target, so aim it at visitor to frame the same however the engine takes the two", severity: "warning" },
    ]);
  });

  it("warns of a rider timed to come before its carrier or that no shot writes, and rejects one that never exists", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.cast.push(
        { id: "lantern", model: "Lantern", set: "room", attach: { to: "visitor", point: "Ref_Hand Left" } },
        { id: "badge", model: "Badge", set: "room", attach: { to: "operator", point: "Ref_Chest" } },
        { id: "ghost-fire", model: "Fire", set: "room", attach: { to: "operator", point: "Ref_Center" } },
      );
      cinematic.shots[0].enters = { lantern: 0 };
      cinematic.shots[1].enters = { visitor: 500 };
      // The operator is only in shot 0; the badge is hidden there.
      cinematic.shots[0].hide = ["badge"];
      cinematic.shots[0].exits = { operator: 1000 };
      cinematic.shots[1].enters["ghost-fire"] = 100;
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.enters.lantern", message: "lantern enters before visitor, which it rides, so it comes into being with visitor, 500 ms into shot 1", severity: "warning" },
      { file: CINEMATIC, path: "cast.3.attach.to", message: "No shot shows both badge and operator, which it rides, so badge is never written", severity: "warning" },
      { file: CINEMATIC, path: "cast.4.attach.to", message: "ghost-fire never exists: operator, which it rides, exists only from the start to 1000 ms into shot 0, outside ghost-fire's own time" },
    ]);
  });

  it("rejects a camera riding no one, a member the shot hides or one on another set, and warns that a move's target is the carrier's", async () => {
    const problems = await checkedWith((cinematic) => {
      cinematic.sets.push({ id: "hall", file: "sets/radio-hall.json", offset: [0, 50, 0] });
      cinematic.cast.push({ id: "guard", model: "Guard", set: "hall", mark: "Guard" });
      cinematic.shots[0].cameraAttach = { to: "nobody", point: "Ref_Head" };
      cinematic.shots[1].cameraAttach = { to: "visitor", point: "Ref_Head" };
      cinematic.shots[1].hide = ["visitor"];
      cinematic.shots.push(
        { camera: "room/Close", afterMs: 0, pauseAfterMs: 1000, cameraAttach: { to: "guard", point: "Ref_Head" } },
        { camera: { target: [-2, 1, 1], distance: 3, pitch: 5, yaw: 0, fov: 30 }, set: "room", afterMs: 0, pauseAfterMs: 1000, to: { target: [-2, 3, 1], distance: 5, pitch: 5, yaw: 0, fov: 30 }, cameraAttach: { to: "visitor", point: "Ref_Head" } },
      );
    });
    expect(problems).toEqual([
      { file: CINEMATIC, path: "shots.0.cameraAttach.to", message: "No cast member nobody in this Cinematic" },
      { file: CINEMATIC, path: "shots.1.cameraAttach.to", message: "The shot hides visitor, so its camera has no one to ride" },
      { file: CINEMATIC, path: "shots.2.cameraAttach.to", message: "guard is on the set hall, which this shot (on room) doesn't show" },
      { file: CINEMATIC, path: "shots.3.to", message: "The camera rides visitor, so this camera's target is ignored: its move only dollies, turns and zooms; move visitor to travel", severity: "warning" },
    ]);
  });
});

describe("a Cinematic's bookmarks", () => {
  const base = { sets: [{ id: "space", file: "sets/space.json", offset: [0, 0, 0] }], shots: [{ camera: "space/Wide", afterMs: 0, pauseAfterMs: 2000 }] };

  it("sit on a line or atMs into the Cinematic, one or the other", () => {
    expect(CinematicSchema.safeParse({ ...base, bookmarks: [{ name: "a", line: "l-1" }, { name: "b", atMs: 500 }] }).success).toBe(true);
    expect(CinematicSchema.safeParse({ ...base, bookmarks: [{ name: "a" }] }).success).toBe(false);
    expect(CinematicSchema.safeParse({ ...base, bookmarks: [{ name: "a", line: "l-1", atMs: 500 }] }).success).toBe(false);
  });

  it("have a name, once each", () => {
    expect(CinematicSchema.safeParse({ ...base, bookmarks: [{ name: " ", atMs: 0 }] }).success).toBe(false);
    const twice = CinematicSchema.safeParse({ ...base, bookmarks: [{ name: "a", atMs: 0 }, { name: "a", atMs: 900 }] });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.message).toBe("Two bookmarks are called a");
  });

  it("are checked against the Cinematic's end, as a sound's start is", async () => {
    const root = await copyOf("cinematic");
    const file = path.join(root, "missions/radio-field/cinematics/radio.json");
    const cinematic = JSON.parse(await readFile(file, "utf8"));
    cinematic.bookmarks = [{ name: "late", atMs: 600000 }];
    await writeFile(file, JSON.stringify(cinematic));
    const problems = unnoted(await checkWorkspace(root)).map((problem) => problem.message);
    expect(problems.join("\n")).toMatch(/The bookmark late starts 600000 ms in, at or past the Cinematic's end/);
  });
});
