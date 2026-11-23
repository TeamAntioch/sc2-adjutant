// A Campaign Mod's Cinematics (ADR-0009, ADR-0011): a scene of one of its Screenplays filmed from a
// shot list on an imported Set, both kept in the mod's folder, compiled into the mod's Cutscenes as
// the .SC2Cutscene its cue plays. One that replaces a Kept, hand-built scene is compared with it
// aspect by aspect (lines, speakers, cameras, cast, lamps …), since a rebuild never matches keyframe
// for keyframe: each aspect that differs is named as an Accepted Difference, or the compile stops.
// Harbour-Story is synthetic; its set is the cinematic fixture's radio room.
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { importSetIntoMod } from "../../src/cutscene/import-set.js";
import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { importMod } from "../../src/mods/import-mod.js";
import { checkWorkspace, formatWorkspaceCheck, isError } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { declareChats, harbour } from "./harbour-chats.js";
import { binary, documentHeader, cleanupMods, declare, hashTree, type Mod, put } from "./mod-fixture.js";

afterEach(cleanupMods);

const RADIO_ROOM = fileURLToPath(new URL("../fixtures/workspaces/cinematic/missions/radio-field/sets/radio-room.json", import.meta.url));
const KEPT_SCENE = "Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene";
const NEW_SCENE = "Base.SC2Data/Cutscenes/Quay - Dusk.SC2Cutscene";
const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];

/** The quay's scene 1 on the radio room, its lines named by the Sounds the Conversation plays: the harbourmaster on the Operator mark, the dockhand beside them, a wide shot then a close one. */
const QUAY_SHOTS = {
  sets: [{ id: "room", file: "sets/radio-room.json" }],
  cast: [
    { id: "harbourmaster", model: "SMX3_BGPeople_01", set: "room", mark: "Operator", speaker: "HARBOURMASTER" },
    { id: "dockhand", model: "SMX3_BGPeople_06", set: "room", at: [-2, 1, 0], facing: -90, speaker: "DOCKHAND" },
  ],
  shots: [
    { camera: "room/Wide", line: "Harbour-Quay-01-001-Harbourmaster" },
    { camera: "room/Close", line: "Harbour-Quay-01-002-Dockhand" },
  ],
};

/** The Harbour with its chats compiled, and the quay's shot list and set in the mod's folder, declared as a Cinematic written as `cutscene`. */
async function quay(cutscene = "Quay - Dusk", shots: unknown = QUAY_SHOTS, extra: Record<string, unknown> = {}): Promise<Mod> {
  const mod = await harbour();
  await declareChats(mod);
  await put(path.join(mod.modDir, "sets", "radio-room.json"), await readFile(RADIO_ROOM, "utf8"));
  await put(path.join(mod.modDir, "cinematics", "quay.json"), JSON.stringify(shots));
  await declare(mod, { cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene }], ...extra });
  return mod;
}

const scene = async (mod: Mod, file = NEW_SCENE) => all(readCutscene(await readFile(path.join(mod.modPackage, ...file.split("/")), "utf8")));

describe("a Campaign Mod's Cinematic", () => {
  it("compiles into the mod's Cutscenes, playing its scene's lines from the mod's own Conversation, and a second compile changes nothing", async () => {
    const mod = await quay();

    const compiled = await compileMod(mod.blueprintPath);

    const nodes = await scene(mod);
    const driver = nodes.find((node) => node.tag === "CCutsceneNodeConversationDriver")!;
    expect(driver.attrs.conversationLink).toBe("HarbourChats");
    expect(driver.children.map((line) => line.attrs.lineId)).toEqual(["Line01001", "Line01002"]);
    // Each speaker says their own lines, with the Sound the Conversation plays.
    const says = nodes.filter((node) => node.tag === "CCutsceneElementConversation").map((line) => [line.attrs.conversationLine, line.attrs.soundLink]);
    expect(says).toEqual([
      ["Line01001", "Harbour-Quay-01-001-Harbourmaster"],
      ["Line01002", "Harbour-Quay-01-002-Dockhand"],
    ]);
    expect(nodes.filter((node) => node.tag === "CCutsceneNodeCamera").map((camera) => camera.attrs.name)).toEqual(["Wide", "Close"]);
    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "file", path: NEW_SCENE }));
    expect(await readFile(path.join(mod.modPackage, "ComponentList.SC2Components"), "utf8")).toContain(`<DataComponent Type="cuts">Cutscenes/Index</DataComponent>`);

    const before = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });
});

/** The quay's Cinematic compiled as `Quay - Dusk`, its file given to the Kept `Quay - Dawn` as the Editor would save it, every guid renumbered. */
async function keptAsCompiled(mod: Mod): Promise<void> {
  await compileMod(mod.blueprintPath);
  let next = 5_000_000_000_000_000_000n;
  const saved = (await readFile(path.join(mod.modPackage, ...NEW_SCENE.split("/")), "utf8")).replace(/(guid|GUID|Guid)="(\d+)"/g, (_, key: string, guid: string) => `${key}="${BigInt(guid) + next}"`);
  next++;
  await writeFile(path.join(mod.modPackage, ...KEPT_SCENE.split("/")), saved);
}

const KEPT_ITEM = `file:${KEPT_SCENE}`;

describe("a Campaign Mod's Cinematic that replaces a Kept scene", () => {
  it("converts it with no Accepted Difference when it stages the same scene, whatever its guids", async () => {
    const mod = await quay();
    await keptAsCompiled(mod);
    await declare(mod, { cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toContainEqual({ item: KEPT_ITEM });
  });

  it("stops the compile on each aspect it stages differently, named, until each is an Accepted Difference", async () => {
    const mod = await quay();
    await keptAsCompiled(mod);
    // The shots the other way round, and the dockhand moved a cell.
    const restaged = structuredClone(QUAY_SHOTS);
    restaged.shots[0]!.camera = "room/Close";
    restaged.shots[1]!.camera = "room/Wide";
    restaged.cast[1]!.at = [-3, 1, 0];
    await put(path.join(mod.modDir, "cinematics", "quay.json"), JSON.stringify(restaged));
    await declare(mod, { cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }] });
    const before = await hashTree(mod.modPackage);

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(EquivalenceError);
    // The harbourmaster's mark isn't seen through the close shot, so with it first they have no copy
    // there: their line is said off screen, by an Invisible voice, with its own sound, and they don't talk.
    expect((failed as EquivalenceError).mismatches).toEqual([
      { item: `${KEPT_ITEM}#speakers`, detail: "HarbourChats/Line01001 is said by SMX3_BGPeople_01 in the Kept scene, Invisible in the Cinematic" },
      { item: `${KEPT_ITEM}#cameras`, detail: "the Kept scene cuts to Wide, Close; the Cinematic to Close, Wide" },
      { item: `${KEPT_ITEM}#actors`, detail: "the Cinematic adds SMX3_BGPeople_06 at -3.000,1.000,0.000 facing -90; drops SMX3_BGPeople_06 at -2.000,1.000,0.000 facing -90" },
      { item: `${KEPT_ITEM}#anims`, detail: expect.stringMatching(/^SMX3_BGPeople_01 plays Stand, Talk/) },
    ]);
    expect(await hashTree(mod.modPackage)).toEqual(before);

    await declare(mod, {
      acceptedDifferences: [
        { item: `${KEPT_ITEM}#cameras`, reason: "The close shot opens the scene" },
        { item: `${KEPT_ITEM}#actors`, reason: "The dockhand stands back a cell" },
        { item: `${KEPT_ITEM}#speakers`, reason: "The harbourmaster speaks off screen" },
        { item: `${KEPT_ITEM}#anims`, reason: "The harbourmaster speaks off screen" },
      ],
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual(
      expect.arrayContaining([
        { item: `${KEPT_ITEM}#cameras`, accepted: "The close shot opens the scene" },
        { item: `${KEPT_ITEM}#actors`, accepted: "The dockhand stands back a cell" },
      ]),
    );
    expect(compiled.warnings.filter((warning) => warning.startsWith("acceptedDifferences"))).toEqual([]);
  });
});

describe("a Campaign Mod's Cinematic with sounds, a look-at and an attached lamp", () => {
  /** The quay's shot list with a music cue on the dockhand's line, the dockhand looking at the harbourmaster, and the room humming, its fill riding the harbourmaster. */
  async function scored(): Promise<Mod> {
    const shots = structuredClone(QUAY_SHOTS) as any;
    shots.sounds = [{ sound: "Music_Harbour", line: "Harbour-Quay-01-002-Dockhand", volume: 0.6 }];
    shots.cast[1].lookAts = [{ at: "harbourmaster" }];
    const mod = await quay("Quay - Dusk", shots);
    const room = JSON.parse(await readFile(RADIO_ROOM, "utf8"));
    room.sounds = [{ sound: "Ambience_Harbour" }];
    // The fill lights every shot, so it rides the harbourmaster's copy in each shot they're in.
    room.lamps[1].attach = { mark: "Operator", point: "Ref_Overhead", offset: [0, -0.3, -0.1], rotation: [55, 0, 0] };
    await put(path.join(mod.modDir, "sets", "radio-room.json"), JSON.stringify(room));
    return mod;
  }

  it("converts a hand-built scene with the same nodes, as the Editor saves them, with no Accepted Difference", async () => {
    const mod = await scored();
    await keptAsCompiled(mod);
    // The Editor records each sound's asset length and speaker mix; neither changes what plays.
    const kept = path.join(mod.modPackage, ...KEPT_SCENE.split("/"));
    await writeFile(kept, (await readFile(kept, "utf8")).replace(/<CCutsceneNodeSound ([^>]*)>/g, '<CCutsceneNodeSound $1 assetDuration="60000" speakerMixLFE="0.000000">'));
    await declare(mod, { cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toContainEqual({ item: KEPT_ITEM });
    const nodes = await scene(mod, KEPT_SCENE);
    expect(nodes.filter((node) => node.tag === "CCutsceneNodeSound").map((node) => [node.attrs.soundLink, node.attrs.mode, node.attrs.volumeScale])).toEqual([
      ["Ambience_Harbour", "4294967295", undefined],
      ["Music_Harbour", undefined, "0.600000"],
    ]);
    expect(nodes.filter((node) => /^CCutsceneNode(LookAt|Attachment)$/.test(node.tag))).toHaveLength(2);
  });

  it("stops the compile, naming sounds and nodes, when the rebuild drops the hand-built scene's music, look-at and attachment", async () => {
    const mod = await scored();
    await keptAsCompiled(mod);
    await put(path.join(mod.modDir, "sets", "radio-room.json"), await readFile(RADIO_ROOM, "utf8"));
    await put(path.join(mod.modDir, "cinematics", "quay.json"), JSON.stringify(QUAY_SHOTS));
    await declare(mod, { cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }] });

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect((failed as EquivalenceError).mismatches).toEqual([
      { item: `${KEPT_ITEM}#sounds`, detail: "drops Ambience_Harbour looped, Music_Harbour at 0.6" },
      { item: `${KEPT_ITEM}#nodes`, detail: "drops Attachment, LookAt" },
    ]);
  });
});

/** One Ogg page: its granule position (the samples played by its end) and its body, as one segment. */
function oggPage(granule: bigint, body: Buffer): Buffer {
  const header = Buffer.alloc(28);
  header.write("OggS", 0, "ascii");
  header.writeBigInt64LE(granule, 6);
  header[26] = 1;
  header[27] = body.length;
  return Buffer.concat([header, body]);
}

/** A Vorbis file `ms` long at 22050 Hz, as far as its length goes: the identification header, then one page ending on its last sample. */
function vorbis(ms: number): Buffer {
  const id = Buffer.alloc(30);
  id[0] = 1;
  id.write("vorbis", 1, "ascii");
  id[11] = 1;
  id.writeUInt32LE(22050, 12);
  return Buffer.concat([oggPage(0n, id), oggPage(BigInt(Math.round((ms / 1000) * 22050)), Buffer.from(binary(5, 40)))]);
}

const VOICE_FOLDER = "Base.SC2Assets/Assets/Sounds/Conversations";

describe("a Campaign Mod's Cinematic's Accepted Differences", () => {
  it("refuse an aspect the cutscene isn't compared by, and the whole file named at once", async () => {
    const mod = await quay();
    await keptAsCompiled(mod);
    await declare(mod, {
      cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }],
      acceptedDifferences: [
        { item: `${KEPT_ITEM}#lamp`, reason: "A typo" },
        { item: KEPT_ITEM, reason: "All of it" },
      ],
    });

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect((failed as EquivalenceError).mismatches).toEqual([
      { item: KEPT_ITEM, detail: expect.stringMatching(/^it is compared aspect by aspect, so name each aspect that differs/) },
      { item: `${KEPT_ITEM}#lamp`, detail: expect.stringMatching(/^acceptedDifferences names .*#lamp, but lamp isn't an aspect it's compared by \(lines, speakers, voices, cameras, timing, actors, anims, lamps, light, sounds, nodes\)$/) },
    ]);
  });

  it("stop the compile on a Kept scene that isn't a cutscene, saying so, rather than comparing it as empty", async () => {
    // Harbour-Story's Kept "Quay - Dawn" is a bare <Cutscene/>.
    const mod = await quay("Quay - Dawn");

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect((failed as EquivalenceError).mismatches).toEqual([{ item: KEPT_ITEM, detail: "The Kept scene isn't a cutscene: its root is <Cutscene>, not <CutsceneState>" }]);
  });

  it("warn of an aspect named for a Cinematic whose cutscene is new to the package", async () => {
    const mod = await quay("Quay - Dusk", QUAY_SHOTS, { acceptedDifferences: [{ item: `file:${NEW_SCENE}#cameras`, reason: "Restaged" }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings.filter((warning) => warning.startsWith("acceptedDifferences"))).toEqual([expect.stringMatching(/^acceptedDifferences names file:.*Quay - Dusk\.SC2Cutscene#cameras, but the Cinematic's cutscene is new to the package/)]);
  });

  it("don't call a Kept scene new when the package spells its file in another case, as the game reads it", async () => {
    const mod = await quay();
    await keptAsCompiled(mod);
    // The Editor saved the Kept scene as quay - dawn.SC2Cutscene.
    const kept = path.join(mod.modPackage, ...KEPT_SCENE.split("/"));
    const saved = await readFile(kept, "utf8");
    await rm(kept);
    await writeFile(path.join(path.dirname(kept), "quay - dawn.SC2Cutscene"), saved);
    await declare(mod, {
      cinematics: [{ id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dawn" }],
      acceptedDifferences: [{ item: `${KEPT_ITEM}#cameras`, reason: "Restaged" }],
    });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings.filter((warning) => warning.includes("new to the package"))).toEqual([]);
  });
});

describe("a Campaign Mod's Cinematic's timing", () => {
  it("comes from its lines' voice files in the Asset Mod it depends on: each line starts as the one before ends, and the close shot cuts on the second", async () => {
    const mod = await quay();
    const source = path.join(path.dirname(mod.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
    await put(path.join(source, "DocumentHeader"), documentHeader([], 6));
    await put(path.join(source, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo/>\r\n`);
    await put(path.join(source, ...`${VOICE_FOLDER}/Harbour-Quay-01-001-Harbourmaster.ogg`.split("/")), vorbis(2500));
    await put(path.join(source, ...`${VOICE_FOLDER}/Harbour-Quay-01-002-Dockhand.ogg`.split("/")), vorbis(1800));
    const art = await importMod(await loadWorkspace(mod.workspaceRoot), source, "harbour-art", { kind: "asset" });
    // Declared as the Asset Mod's files, in the package as the Editor left them.
    const sounds = ["Harbour-Quay-01-001-Harbourmaster", "Harbour-Quay-01-002-Dockhand"];
    await declare(
      { ...mod, blueprintPath: art.blueprintPath, modDir: path.dirname(art.blueprintPath), modPackage: art.modPackage },
      { assets: sounds.map((sound) => ({ path: `${VOICE_FOLDER}/${sound}.ogg`, source: { generated: "tts", sound } })) },
    );

    const compiled = await compileMod(mod.blueprintPath);

    const nodes = await scene(mod);
    const starts = nodes.filter((node) => node.tag === "CCutsceneElementConversationDriver").map((line) => line.attrs.start);
    expect(starts).toEqual(["1000", "3500"]);
    const cuts = nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera").map((cut) => cut.attrs.start);
    expect(cuts).toEqual([undefined, "3500"]);
    expect(compiled.warnings).toEqual([]);
  });

  it("is the estimate for a line no Asset Mod holds a voice file for, and the compile says which, since the scene's timing changes once they land", async () => {
    const mod = await quay();

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings).toEqual([
      "The Cinematic quay is timed by the estimate for 2 line(s) no Asset Mod the mod depends on holds a voice file for (Harbour-Quay-01-001-Harbourmaster, Harbour-Quay-01-002-Dockhand): its cutscene's timing changes once they're there, so compile the Asset Mod that voices them first",
    ]);
  });
});

describe("the Workspace check on a Campaign Mod's Cinematic", () => {
  it("passes a Cinematic that can be written, and reports, where each is, a line the scene doesn't have, a missing mark and a Conversation no Screenplay compiles", async () => {
    const mod = await quay();
    const clean = await checkWorkspace(mod.workspaceRoot);
    expect(clean.problems.filter((problem) => problem.severity === undefined)).toEqual([]);

    const broken = structuredClone(QUAY_SHOTS) as any;
    broken.shots[1].line = "Harbour-Quay-02-001-Dockhand";
    broken.cast[0].mark = "Captain";
    await put(path.join(mod.modDir, "cinematics", "quay.json"), JSON.stringify(broken));
    await put(path.join(mod.modDir, "cinematics", "ferry.json"), JSON.stringify(QUAY_SHOTS));
    await declare(mod, {
      cinematics: [
        { id: "quay", conversation: "HarbourChats", scene: 1, cutscene: "Quay - Dusk" },
        { id: "ferry", conversation: "Ferry", scene: 1, cutscene: "Ferry" },
      ],
    });

    const check = await checkWorkspace(mod.workspaceRoot);

    expect(check.problems.filter((problem) => problem.severity === undefined)).toEqual([
      { mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "shots.1.line", message: "Harbour-Quay-02-001-Dockhand is a line of scene 2, not of scene 1" },
      { mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "cast.0.mark", message: expect.stringMatching(/^The set room has no mark Captain/) },
      { mod: "harbour-story", file: "mods/harbour-story/blueprint.json", path: "cinematics.1.conversation", message: expect.stringMatching(/^Cinematic ferry plays Ferry, which none of the Blueprint's Screenplays compiles/) },
    ]);
  });

  it("warns when nothing in the mod plays the Cinematic's cutscene, since its cue names the file", async () => {
    const mod = await quay();
    const warnings = async () => (await checkWorkspace(mod.workspaceRoot)).problems.filter((problem) => problem.path === "cinematics.0.cutscene");
    expect(await warnings()).toEqual([
      { mod: "harbour-story", file: "mods/harbour-story/blueprint.json", path: "cinematics.0.cutscene", severity: "warning", message: expect.stringMatching(/^Nothing in the mod's data or triggers plays Cutscenes\\Quay - Dusk\.SC2Cutscene/) },
    ]);
    // The hub chat's row, as a UserData instance names it.
    await put(path.join(mod.modPackage, "Base.SC2Data", "GameData", "UserData.xml"), `<Catalog><CUser id="Chats"><Instances Id="Quay"><String String="Cutscenes\\Quay - Dusk.SC2Cutscene"><Field Id="Cutscene"/></String></Instances></CUser></Catalog>`);
    expect(await warnings()).toEqual([]);
  });

  it("finds the cue of a cutscene whose name the catalog escapes", async () => {
    const mod = await quay("Quay & Dusk");
    await put(path.join(mod.modPackage, "Base.SC2Data", "GameData", "UserData.xml"), `<Catalog><CUser id="Chats"><Instances Id="Quay"><String String="Cutscenes\\Quay &amp; Dusk.SC2Cutscene"><Field Id="Cutscene"/></String></Instances></CUser></Catalog>`);

    const check = await checkWorkspace(mod.workspaceRoot);

    expect(check.problems.filter((problem) => problem.path === "cinematics.0.cutscene")).toEqual([]);
  });

  it("checks the pieces of a Set a Cinematic places even when the Cinematic itself has problems", async () => {
    const mod = await quay();
    const setFile = path.join(mod.modDir, "sets", "radio-room.json");
    const set = JSON.parse(await readFile(setFile, "utf8"));
    set.pieces.push({ model: "FloorTile", at: [0, 0, 0] }, { model: "FloorTile", at: [1, 0, 0] });
    await writeFile(setFile, JSON.stringify(set));
    const broken = structuredClone(QUAY_SHOTS) as any;
    broken.cast[0].mark = "Captain";
    await put(path.join(mod.modDir, "cinematics", "quay.json"), JSON.stringify(broken));
    const modelFootprints = { FloorTile: { file: "Assets/FloorTile.m3", min: [-1, -1, 0], max: [1, 1, 0.02], materials: ["opaque"] } } as const;

    const check = await checkWorkspace(mod.workspaceRoot, { modelFootprints });

    expect(check.problems.filter((problem) => problem.file === "mods/harbour-story/sets/radio-room.json").map(({ path, severity }) => ({ path, severity }))).toEqual([{ path: "pieces.6", severity: "warning" }]);
  });

  it("warns of a Light the Cinematic names that nothing defines, without pointing at a Mission's lights", async () => {
    const mod = await quay("Quay - Dusk", { ...QUAY_SHOTS, light: "NoSuchLight" });

    const check = await checkWorkspace(mod.workspaceRoot);

    const light = check.problems.filter((problem) => problem.path === "light");
    expect(light).toEqual([{ mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "light", severity: "warning", message: expect.stringMatching(/^No Light NoSuchLight in its sets' Lights, a Plugin's Lights/) }]);
  });
});

describe("import-set into a Campaign Mod", () => {
  it("writes the set into the mod's sets folder from the mod's own Kept cutscenes, so a Cinematic there can place it", async () => {
    const mod = await harbour();
    const actor = (model: string, at: string) => `<CCutsceneNodeActor guid="${model}" name="${model}" position="${at}" modelLink="${model}"/>`;
    await put(
      path.join(mod.modPackage, ...KEPT_SCENE.split("/")),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<CutsceneState cutsceneVersion="1.3"><CCutsceneNodeFolder name="Set"><CCutsceneNodeFolder name="Quay">',
        actor("QuayBollard", "1,0,0") + actor("QuayCrate", "0,1,0") + actor("QuayDeck", "0,0,0"),
        "</CCutsceneNodeFolder></CCutsceneNodeFolder>",
        '<CCutsceneNodeCamera guid="9" name="Quay Wide" position="0,0,1" fov="30" verticalFOV="1" distance="8" pitch="10" yaw="180"/>',
        "</CutsceneState>",
      ].join("\n"),
    );

    const imported = await importSetIntoMod(await loadWorkspace(mod.workspaceRoot), "harbour-story", "Quay", [{ origin: "blizzard", root: mod.modDir }]);

    expect(imported.path).toBe(path.join(mod.modDir, "sets", "quay.json"));
    const set = JSON.parse(await readFile(imported.path, "utf8"));
    expect(set.provenance).toMatchObject({ kind: "blizzard", file: `Harbour-Story.SC2Mod/${KEPT_SCENE}` });
    expect(set.pieces.map((piece: { model: string }) => piece.model)).toEqual(["QuayBollard", "QuayCrate", "QuayDeck"]);
    expect(set.cameras).toEqual([{ name: "Quay Wide", target: [0, 0, 1], distance: 8, pitch: 10, yaw: 180, fov: 30 }]);
  });

  it("refuses a mod the Workspace doesn't have", async () => {
    const mod = await harbour();
    await expect(importSetIntoMod(await loadWorkspace(mod.workspaceRoot), "ferry", "Quay", [{ origin: "blizzard", root: mod.modDir }])).rejects.toThrow("The Workspace has no mod ferry; its mods: harbour-story");
  });
});

describe("a Campaign Mod's Model Guides", () => {
  const guideFile = (mod: Mod) => path.join(mod.modDir, "model-guide.json");
  const ofGuide = async (mod: Mod) => (await checkWorkspace(mod.workspaceRoot)).problems.filter((problem) => problem.file === "mods/harbour-story/model-guide.json");

  it("pass when their families and anims are the models' recorded ones and their characters are declared", async () => {
    const mod = await quay();
    await put(
      guideFile(mod),
      JSON.stringify([
        { model: "SMX3_BGPeople_01", character: "HARBOURMASTER", families: [{ name: "", shows: "Stands and talks", default: true, source: "author" }], avoid: [{ anim: "Walk A", why: "Slides" }] },
        { model: "SMX3_BGPeople_06", families: [{ name: "Cover", shows: "Crouched in cover", source: "viewed" }], anims: [{ anim: "Morph", shows: "Turns into a ship", source: "viewed" }] },
      ]),
    );
    expect(await ofGuide(mod)).toEqual([]);
  });

  it("fail on a family or anim the model doesn't have, and on a character the mod doesn't declare", async () => {
    const mod = await quay();
    await put(
      guideFile(mod),
      JSON.stringify([{ model: "SMX3_BGPeople_01", character: "LIGHTHOUSE KEEPER", families: [{ name: "Victory", shows: "Arms up", source: "author" }], anims: [{ anim: "Dance", shows: "Dances", source: "viewed" }], avoid: [{ anim: "Walk Z", why: "Slides" }] }]),
    );
    expect(await ofGuide(mod)).toEqual([
      { mod: "harbour-story", file: "mods/harbour-story/model-guide.json", path: "0.character", message: expect.stringMatching(/^LIGHTHOUSE KEEPER isn't one of the Campaign Mod's characters \(HARBOURMASTER, /) },
      { mod: "harbour-story", file: "mods/harbour-story/model-guide.json", path: "0.families.0.name", message: expect.stringMatching(/^SMX3_BGPeople_01 has no animation in the family Victory/) },
      { mod: "harbour-story", file: "mods/harbour-story/model-guide.json", path: "0.anims.0.anim", message: expect.stringMatching(/^SMX3_BGPeople_01 has no animation Dance/) },
      { mod: "harbour-story", file: "mods/harbour-story/model-guide.json", path: "0.avoid.0.anim", message: expect.stringMatching(/^SMX3_BGPeople_01 has no animation Walk Z/) },
    ]);
  });

  it("warn of an anim a cast member or shot plays that its model's guide avoids, and note a cast model with recorded anims and no guide, neither failing the check", async () => {
    const shots = structuredClone(QUAY_SHOTS) as any;
    shots.cast[0].anim = "Fidget";
    shots.shots[1].anims = { harbourmaster: "Walk A" };
    const mod = await quay("Quay - Dusk", shots);
    await put(guideFile(mod), JSON.stringify([{ model: "SMX3_BGPeople_01", avoid: [{ anim: "Fidget", why: "Scratches the head" }, { anim: "Walk A", why: "Slides" }] }]));
    const check = await checkWorkspace(mod.workspaceRoot);
    expect(check.problems.filter(isError)).toEqual([]);
    expect(check.problems.filter((problem) => /Model Guide/.test(problem.message))).toEqual([
      { mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "shots.1.anims.harbourmaster", severity: "warning", message: "SMX3_BGPeople_01's Model Guide avoids Walk A: Slides" },
      { mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "cast.0.anim", severity: "warning", message: "SMX3_BGPeople_01's Model Guide avoids Fidget: Scratches the head" },
      { mod: "harbour-story", file: "mods/harbour-story/cinematics/quay.json", path: "cast.1.model", severity: "note", message: expect.stringMatching(/^SMX3_BGPeople_06 has recorded animations but no Model Guide/) },
    ]);
    expect(formatWorkspaceCheck(check)).toMatch(/are valid, with \d+ warning\(s\), \d+ review item\(s\) and 1 note\(s\)\.$/);
  });

  it("fail on a guide file that isn't a guide list, saying where, and leave the rest of the Campaign Mod's catalog read", async () => {
    const mod = await quay();
    await put(guideFile(mod), JSON.stringify([{ model: "SMX3_BGPeople_01", avoid: [{ anim: "Walk A" }] }]));
    const errors = (await checkWorkspace(mod.workspaceRoot)).problems.filter(isError);
    expect(errors).toEqual([{ mod: "harbour-story", file: "mods/harbour-story/model-guide.json", message: expect.stringMatching(/^mods\/harbour-story\/model-guide\.json isn't a Model Guide list: 0\.avoid\.0\.why: /) }]);
    expect((await loadWorkspace(mod.workspaceRoot)).catalog.error).toBeUndefined();
  });
});

describe("a Campaign Mod's Cinematic with a Model Guide's default family", () => {
  /** Each copy of the dockhand, by name, with the anim it first plays. */
  const dockhand = async (shots: unknown) => {
    const mod = await quay("Quay - Dusk", shots);
    await put(path.join(mod.modDir, "model-guide.json"), JSON.stringify([{ model: "SMX3_BGPeople_06", families: [{ name: "Cover", shows: "Crouched in cover", default: true, source: "viewed" }] }]));
    await compileMod(mod.blueprintPath);
    return (await scene(mod))
      .filter((node) => node.tag === "CCutsceneNodeActor" && /dockhand$/.test(node.attrs.name ?? ""))
      .map((actor) => [actor.attrs.name, actor.children.find((child) => child.tag === "CCutsceneNodeAnimLayer")!.children[0]!.attrs.anim]);
  };

  it("stands a member with no anim in its model's default family, over the ranking's plain Stand", async () => {
    // SMX3_BGPeople_06 has Talks only in the plain family, and Stand Cover 02 for the Cover family (data/model-anims.json).
    expect(await dockhand(QUAY_SHOTS)).toEqual([
      ["s010 dockhand", "Stand Cover 02"],
      ["s020 dockhand", "Stand Cover 02"],
    ]);
  });

  it("keeps a member's own anim over the default", async () => {
    const shots = structuredClone(QUAY_SHOTS) as any;
    shots.cast[1].anim = "Stand";
    expect(await dockhand(shots)).toEqual([
      ["s010 dockhand", "Stand"],
      ["s020 dockhand", "Stand"],
    ]);
  });
});
