// A Campaign Mod's Set cutscenes (ADR-0009, ADR-0011): a room the mod's Cinematics are filmed in,
// written back from its imported Set as a cutscene with no shots, so the author can still open the
// room in the Cutscene Editor. One that replaces a Kept, hand-built Set file is compared with it
// aspect by aspect, as a Cinematic is. An Editor change to it comes back into the Set through sync,
// or the compile refuses to overwrite it. The Wharf is synthetic.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importSetIntoMod } from "../../src/cutscene/import-set.js";
import { type CutsceneNode, readCutscene, writeCutscene } from "../../src/cutscene/read-cutscene.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { syncMod } from "../../src/mods/sync-mod.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";
import { harbour } from "./harbour-chats.js";
import { cleanupMods, declare, hashTree, type Mod, put } from "./mod-fixture.js";

afterEach(cleanupMods);

const SCENE = "Base.SC2Data/Cutscenes/Set - Wharf.SC2Cutscene";
const ITEM = `file:${SCENE}`;
const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];

/**
 * The Wharf, as import-set wrote it from a file that built it at (16, 8): three pieces (the crane
 * with an id a Cinematic moves it by, the hut tied to the close camera), the harbourmaster looking
 * at the dockhand, a wide and a close camera, a lantern riding the dockhand's hand and a key on the
 * close camera, the gulls looping, and two base Lights.
 */
const WHARF = {
  name: "Wharf",
  provenance: { setId: "wharf", catalogName: "Wharf", kind: "blizzard", file: "Harbour-Story.SC2Mod/Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene", origin: [16, 8, 0] },
  lights: ["WharfDay", "WharfDusk"],
  pieces: [
    { model: "WharfDeck", at: [0, 0, 0] },
    { id: "crane", model: "WharfCrane", at: [2, 1, 0], rotation: 90, scale: 1.5 },
    { model: "WharfHut", at: [-2, 2, 0], tint: [0.5, 0.6, 1], shots: ["Close"] },
  ],
  marks: [
    { name: "Harbourmaster", model: "SMX3_BGPeople_01", at: [1, 0, 0], facing: 90, lookAt: { mark: "Dockhand" } },
    { name: "Dockhand", model: "SMX3_BGPeople_06", at: [-1, 0, 0], facing: -90 },
  ],
  cameras: [
    { name: "Wide", target: [0, 0, 1.5], distance: 10, pitch: 10, yaw: 180, fov: 40 },
    { name: "Close", target: [1, 0, 1.6], distance: 3, pitch: 5, yaw: 90, fov: 18, blur: 0.2, focalDepth: 2.5, falloff: { far: 1, near: 0 } },
  ],
  lamps: [
    { name: "Lantern", type: "omni", at: [-1, 0, 1], color: [1, 0.8, 0.5], strength: 2, range: 4, attach: { mark: "Dockhand", point: "Ref_Hardpoint", offset: [0, 0.2, 0] } },
    { name: "Key", type: "spot", at: [1, -1, 3], rotation: [0, -30, 90], color: [1, 1, 1], strength: 1, hotspot: 0.5, falloff: 1, shadows: false, shots: ["Close"] },
  ],
  sounds: [{ sound: "Ambience_Gulls", volume: 0.5 }],
};

/** The Harbour with the Wharf in its sets folder, declared as the Set cutscene `cutscene`. */
async function wharf(cutscene = "Set - Wharf", extra: Record<string, unknown> = {}): Promise<Mod> {
  const mod = await harbour();
  await put(path.join(mod.modDir, "sets", "wharf.json"), JSON.stringify(WHARF));
  await declare(mod, { setCutscenes: [{ cutscene, set: "sets/wharf.json", lengthMs: 30000 }], ...extra });
  return mod;
}

const scene = async (mod: Mod, file = SCENE) => all(readCutscene(await readFile(path.join(mod.modPackage, ...file.split("/")), "utf8")));
/** The Wharf imported again, from the Set cutscene the compile wrote, as the Editor or another tool would read it. */
async function reimported(mod: Mod): Promise<Record<string, unknown>> {
  const imported = await importSetIntoMod(await loadWorkspace(mod.workspaceRoot), "harbour-story", "Wharf", [{ origin: "blizzard", root: mod.modDir }], { file: "Set - Wharf" });
  return imported.set as unknown as Record<string, unknown>;
}

describe("a Campaign Mod's Set cutscene", () => {
  it("is written from its Set, with no shots, holding everything the Set does where its source file had it, and a second compile changes nothing", async () => {
    const mod = await wharf();

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "file", path: SCENE }));
    const nodes = await scene(mod);
    expect(nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera")).toEqual([]);
    expect(nodes.filter((node) => node.tag === "CCutsceneNodeCamera").map((node) => node.attrs.name)).toEqual(["Wide", "Close"]);
    // In the source file's frame: the deck at the Set's origin.
    expect(nodes.find((node) => node.attrs.modelLink === "WharfDeck")!.attrs.position).toBe("16.000000,8.000000,0.000000");
    expect(Math.max(...nodes.filter((node) => node.attrs.duration).map((node) => Number(node.attrs.start ?? 0) + Number(node.attrs.duration)))).toBe(30000);

    // Read back as import-set reads a set, it's the Set again, but for the crane's id, which no cutscene holds.
    const { pieces, ...rest } = WHARF;
    const back = await reimported(mod);
    expect({ ...back, provenance: undefined }).toEqual({
      ...rest,
      provenance: undefined,
      marks: [{ ...WHARF.marks[0], lookAt: { mark: "Dockhand", type: "SlowHeadOnly", point: "Head" } }, WHARF.marks[1]],
      pieces: pieces.map(({ id: _id, ...piece }) => piece),
    });

    const before = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });
});

/** The Wharf's Set cutscene as the compile writes it, given to the package as a Kept file the Editor saved (every guid renumbered), less what `drop` takes out. */
async function keptAsCompiled(mod: Mod, drop: (node: CutsceneNode) => boolean = () => false): Promise<void> {
  await compileMod(mod.blueprintPath);
  const file = path.join(mod.modPackage, ...SCENE.split("/"));
  const prune = (node: CutsceneNode): CutsceneNode => ({ ...node, children: node.children.filter((child) => !drop(child)).map(prune) });
  const saved = writeCutscene(prune(readCutscene(await readFile(file, "utf8")))).replace(/(guid|GUID|Guid)="(\d+)"/g, (_, key: string, guid: string) => `${key}="${BigInt(guid) + 5_000_000_000_000_000_000n}"`);
  await writeFile(path.join(mod.modDir, "compile-record.json"), `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`);
  await writeFile(file, saved);
}

describe("a Campaign Mod's Set cutscene with a Model Guide's default family", () => {
  it("stands a mark's character in its model's default family, and the others as the ranking has them", async () => {
    const mod = await wharf();
    // SMX3_BGPeople_06 has Stand Cover 02 for the Cover family (data/model-anims.json).
    await put(path.join(mod.modDir, "model-guide.json"), JSON.stringify([{ model: "SMX3_BGPeople_06", families: [{ name: "Cover", shows: "Crouched in cover", default: true, source: "viewed" }] }]));
    await compileMod(mod.blueprintPath);
    const standOf = (name: string, nodes: CutsceneNode[]) => nodes.find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === name)!.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children[0]!.attrs.anim;
    const nodes = await scene(mod);
    expect([standOf("Dockhand", nodes), standOf("Harbourmaster", nodes)]).toEqual(["Stand Cover 02", "Stand"]);
  });

  it("loops a mark's own anim over the default family's Stand, and sync keeps it", async () => {
    const mod = await harbour();
    const marks = [WHARF.marks[0], { ...WHARF.marks[1], anim: "Stand Cover Fidget 02" }];
    await put(path.join(mod.modDir, "sets", "wharf.json"), JSON.stringify({ ...WHARF, marks }));
    await declare(mod, { setCutscenes: [{ cutscene: "Set - Wharf", set: "sets/wharf.json", lengthMs: 30000 }] });
    await put(path.join(mod.modDir, "model-guide.json"), JSON.stringify([{ model: "SMX3_BGPeople_06", families: [{ name: "Cover", shows: "Crouched in cover", default: true, source: "viewed" }] }]));
    await compileMod(mod.blueprintPath);
    const dockhand = (await scene(mod)).find((node) => node.tag === "CCutsceneNodeActor" && node.attrs.name === "Dockhand")!;
    expect(all(dockhand).find((node) => node.tag === "CCutsceneElementAnim")!.attrs.anim).toBe("Stand Cover Fidget 02");

    const file = path.join(mod.modPackage, ...SCENE.split("/"));
    const root = readCutscene(await readFile(file, "utf8"));
    all(root).find((node) => node.attrs.modelLink === "WharfCrane")!.attrs.position = "19.000000,9.000000,0.000000";
    await writeFile(file, writeCutscene(root));
    await syncMod(mod.blueprintPath);
    expect(JSON.parse(await readFile(path.join(mod.modDir, "sets", "wharf.json"), "utf8")).marks).toEqual(marks);
  });
});

describe("a Campaign Mod's Set cutscene that replaces a Kept one", () => {
  it("converts it with no Accepted Difference when it holds the same room, whatever its guids", async () => {
    const mod = await wharf();
    await keptAsCompiled(mod);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toContainEqual({ item: ITEM });
  });

  it("stops the compile on each aspect it holds differently, named, until each is an Accepted Difference", async () => {
    const mod = await wharf();
    // The hand-built room had no key light and no gulls.
    await keptAsCompiled(mod, (node) => node.attrs.name === "Key" || node.tag === "CCutsceneNodeSound");
    const before = await hashTree(mod.modPackage);

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(EquivalenceError);
    expect((failed as EquivalenceError).mismatches).toEqual([
      { item: `${ITEM}#lamps`, detail: "the Set cutscene adds Key at 17.000,7.000,3.000" },
      { item: `${ITEM}#sounds`, detail: "the Set cutscene adds Ambience_Gulls looped at 0.5" },
    ]);
    expect(await hashTree(mod.modPackage)).toEqual(before);

    await declare(mod, {
      acceptedDifferences: [
        { item: `${ITEM}#lamps`, reason: "The imported scene's key light shows in the room" },
        { item: `${ITEM}#sounds`, reason: "The room plays its ambience" },
      ],
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual(expect.arrayContaining([{ item: `${ITEM}#lamps`, accepted: "The imported scene's key light shows in the room" }]));
  });
});

describe("an Editor change to a Campaign Mod's Set cutscene", () => {
  /** The Wharf compiled, then changed in the Editor: the crane moved a cell east, and a barrel added to the room. */
  async function edited(): Promise<Mod> {
    const mod = await wharf();
    await compileMod(mod.blueprintPath);
    const file = path.join(mod.modPackage, ...SCENE.split("/"));
    const root = readCutscene(await readFile(file, "utf8"));
    const room = root.children.find((node) => node.attrs.name === "Wharf")!;
    const crane = room.children.find((node) => node.attrs.modelLink === "WharfCrane")!;
    crane.attrs.position = "19.000000,9.000000,0.000000";
    room.children.push({ tag: "CCutsceneNodeActor", attrs: { guid: "777", name: "WharfBarrel", position: "15.500000,7.000000,0.000000", modelLink: "WharfBarrel" }, children: [] });
    await writeFile(file, writeCutscene(root));
    return mod;
  }

  it("stops the compile, which says to run sync, rather than overwriting it", async () => {
    const mod = await edited();
    const before = await hashTree(mod.modPackage);

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(EditorChangesError);
    expect((failed as Error).message).toContain(`Run sync first: it brings these back into the Blueprint, then compile again (or --discard <entry> to overwrite one). sync brings back: ${ITEM}`);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("asks the author to keep or discard it, not to sync, when the Editor deleted it, since sync has nothing to read", async () => {
    const mod = await wharf();
    await compileMod(mod.blueprintPath);
    await rm(path.join(mod.modPackage, ...SCENE.split("/")));

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(EditorChangesError);
    expect((failed as Error).message).not.toContain("Run sync first");
    expect((failed as Error).message).toContain(`${ITEM}: removed in the Editor`);
  });

  it("comes back into the Set through sync, in the Set's own frame and keeping what no cutscene holds, and the next compile writes it", async () => {
    const mod = await edited();

    const synced = await syncMod(mod.blueprintPath);

    expect(synced.synced.map(({ cutscene, set }) => [cutscene, set])).toEqual([["Set - Wharf", "sets/wharf.json"]]);
    const set = JSON.parse(await readFile(path.join(mod.modDir, "sets", "wharf.json"), "utf8"));
    expect(set.provenance).toEqual(WHARF.provenance);
    expect(set.pieces).toEqual([WHARF.pieces[0], { ...WHARF.pieces[1], at: [3, 1, 0] }, WHARF.pieces[2], { model: "WharfBarrel", at: [-0.5, -1, 0] }]);
    expect(set.marks).toEqual(WHARF.marks);
    expect(set.cameras).toEqual(WHARF.cameras);
    expect(set.lamps).toEqual(WHARF.lamps);

    await compileMod(mod.blueprintPath);
    const nodes = await scene(mod);
    expect(nodes.find((node) => node.attrs.modelLink === "WharfCrane")!.attrs.position).toBe("19.000000,9.000000,0.000000");
    expect(nodes.some((node) => node.attrs.modelLink === "WharfBarrel")).toBe(true);
    expect((await syncMod(mod.blueprintPath)).synced).toEqual([]);
  });
});

describe("the sync_mod tool", () => {
  it("brings a Set cutscene's Editor change back into its Set and says which", async () => {
    const mod = await wharf();
    await compileMod(mod.blueprintPath);
    const file = path.join(mod.modPackage, ...SCENE.split("/"));
    await writeFile(file, (await readFile(file, "utf8")).replace('position="16.000000,8.000000,0.000000"', 'position="16.000000,8.000000,0.250000"'));
    const client = await connect(mod.workspaceRoot);

    const synced = await client.callTool({ name: "sync_mod", arguments: { mod: "harbour-story" } });

    expect(synced.isError).toBeFalsy();
    expect(synced.structuredContent).toMatchObject({ synced: [{ cutscene: "Set - Wharf", set: "mods/harbour-story/sets/wharf.json" }] });
    expect(text(synced)).toContain("Set - Wharf: synced into mods/harbour-story/sets/wharf.json");
    expect(JSON.parse(await readFile(path.join(mod.modDir, "sets", "wharf.json"), "utf8")).pieces[0].at).toEqual([0, 0, 0.25]);
  });
});

describe("the Workspace check on a Campaign Mod's Set cutscene", () => {
  it("passes one whose Set reads, and reports a Set that isn't there and one that isn't a Set, where each is, and the pieces of a Set it shows", async () => {
    const mod = await wharf();
    expect((await checkWorkspace(mod.workspaceRoot)).problems.filter((problem) => problem.severity === undefined)).toEqual([]);

    await put(path.join(mod.modDir, "sets", "broken.json"), JSON.stringify({ ...WHARF, pieces: [{ at: [0, 0, 0] }] }));
    await declare(mod, {
      setCutscenes: [
        { cutscene: "Set - Wharf", set: "sets/wharf.json" },
        { cutscene: "Set - Ferry", set: "sets/ferry.json" },
        { cutscene: "Set - Broken", set: "sets/broken.json" },
      ],
    });

    const check = await checkWorkspace(mod.workspaceRoot);

    expect(check.problems.filter((problem) => problem.severity === undefined)).toEqual([
      { mod: "harbour-story", file: "mods/harbour-story/blueprint.json", path: "setCutscenes.1.set", message: "The Set sets/ferry.json isn't there: import it with import-set --mod first" },
      { mod: "harbour-story", file: "mods/harbour-story/sets/broken.json", path: "pieces.0.model", message: expect.any(String) },
    ]);
  });
});
