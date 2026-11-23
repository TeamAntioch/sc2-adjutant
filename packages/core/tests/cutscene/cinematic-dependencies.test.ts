// A Cinematic whose Set or cast is a game package's that the map's dependencies don't load (#1019):
// the bridge and the cast compile, then simply aren't there in the game. compile_map, compile_cutscene
// and check warn, naming what needs the package and the dependency to add.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LoadedCinematic } from "../../src/cutscene/cinematic.js";
import { cinematicDependencyProblems } from "../../src/cutscene/cinematic-dependencies.js";
import { compileCinematicCutscene } from "../../src/cutscene/compile-cutscene.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { dependencyToAdd, packageReachOf } from "../../src/map/game-packages.js";
import { DEFAULT_DEPENDENCIES } from "../../src/map/write-document-info-xml.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf } from "../mcp/harness.js";

const MISSION = "missions/radio-field";
const NOVA_ASSETS = "bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod";
const VOID_STORY = "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign";

async function edit(file: string, change: (json: any) => void): Promise<void> {
  const json = JSON.parse(await readFile(file, "utf8"));
  change(json);
  await writeFile(file, JSON.stringify(json));
}

/**
 * The fixture's radio Cinematic on a room imported from a Nova Covert Ops cutscene, the first officer on its
 * operator's mark under the bridge's Light, with the Blueprint's `dependencies` (none: the default).
 */
async function novaRoom(dependencies?: readonly string[]) {
  const root = await copyOf("cinematic");
  const mission = path.join(root, MISSION);
  await edit(path.join(mission, "sets", "radio-room.json"), (set) => {
    set.provenance = { setId: "nova-bridge", catalogName: "Nova Bridge", kind: "blizzard", file: "mods/novastoryassets.sc2mod/base.sc2data/Cutscenes/SMX3_Cutscene_MP03_030.SC2Cutscene", origin: [0, 0, 0] };
  });
  await edit(path.join(mission, "cinematics", "radio.json"), (cinematic) => {
    cinematic.cast[0].model = "SMX3_FirstOfficer";
    cinematic.light = "SMX3_Cutscene_MP03_030_Bridge";
  });
  const blueprintPath = path.join(mission, "blueprint.json");
  if (dependencies) await edit(blueprintPath, (blueprint) => (blueprint.dependencies = dependencies));
  return { root, workspace: await loadWorkspace(root), blueprintPath, map: path.join(mission, "Radio-Field.SC2Map") };
}

const aboutNova = (warnings: readonly string[]) => warnings.filter((warning) => warning.includes("NovaStoryAssets.SC2Mod"));

describe("a Cinematic whose Set and cast are a package the map doesn't load", () => {
  it("compile_map warns once for the Cinematic: the Set from the package's cutscene, the cast's model, the Light, and the dependency to add", async () => {
    const { workspace, blueprintPath, map } = await novaRoom();
    const [warning, ...others] = aboutNova((await compileMission(workspace, blueprintPath, map)).warnings);
    expect(others).toEqual([]);
    expect(warning).toContain("cinematics/radio.json");
    expect(warning).toContain(": Its Set room (imported from mods/novastoryassets.sc2mod/base.sc2data/Cutscenes/SMX3_Cutscene_MP03_030.SC2Cutscene)");
    expect(warning).toContain("its cast member operator's model SMX3_FirstOfficer");
    expect(warning).toContain("its Light SMX3_Cutscene_MP03_030_Bridge");
    expect(warning).toContain(`add ${NOVA_ASSETS} to the Blueprint's dependencies`);
    // The member whose model is one of the base mods' is loaded.
    expect(warning).not.toContain("SMX3_BGPeople_06");
  });

  it("is quiet when a dependency loads the package, though it replaces the default Void (Mod)", async () => {
    const { workspace, blueprintPath, map } = await novaRoom([NOVA_ASSETS]);
    expect(aboutNova((await compileMission(workspace, blueprintPath, map)).warnings)).toEqual([]);
  });

  it("still warns on a dependency whose chain doesn't reach the package: Void Story doesn't bring the art mod in", async () => {
    const { workspace, blueprintPath, map } = await novaRoom([VOID_STORY]);
    expect(aboutNova((await compileMission(workspace, blueprintPath, map)).warnings)).toHaveLength(1);
  });

  it("is quiet when a dependency can't be followed (a mod outside the Workspace), which may load it", async () => {
    const { workspace, blueprintPath, map } = await novaRoom(["file:Mods\\Elsewhere.SC2Mod"]);
    expect(aboutNova((await compileMission(workspace, blueprintPath, map)).warnings)).toEqual([]);
  });

  it("compile_cutscene warns the same, for the Cinematic it writes", async () => {
    const { workspace, blueprintPath, map } = await novaRoom();
    await compileMission(workspace, blueprintPath, map);
    const written = await compileCinematicCutscene(workspace, blueprintPath, "radio", map);
    expect(aboutNova(written.warnings ?? [])).toHaveLength(1);
    expect(aboutNova(written.warnings ?? [])[0]).toContain(`add ${NOVA_ASSETS}`);
  });

  it("check warns at the Cinematic's file", async () => {
    const { root } = await novaRoom();
    const found = (await checkWorkspace(root)).problems.filter((problem) => problem.message.includes("NovaStoryAssets.SC2Mod"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning" });
    expect(found[0]!.file).toMatch(/cinematics[\\/]radio\.json$/);
  });
});

describe("what a Cinematic films, against what the map loads", () => {
  /** A Cinematic on one hand-built Set of `pieces`, with `cast` (models), `shots` and no Light, as loaded. */
  const filming = ({ pieces = [], cast = [], shots = [] }: { pieces?: string[]; cast?: string[]; shots?: object[] }): LoadedCinematic =>
    ({
      id: "test",
      index: -1,
      scene: undefined,
      file: "cinematics/test.json",
      cinematic: { sets: [{ id: "hall", file: "sets/hall.json", offset: [0, 0, 0] }], cast: cast.map((model, at) => ({ id: `member-${at}`, model, set: "hall", at: [0, 0, 0] })), shots },
      sets: new Map([["hall", { name: "Hall", lights: [], pieces: pieces.map((model) => ({ model, at: [0, 0, 0] })), marks: [], cameras: [], lamps: [] }]]),
    }) as unknown as LoadedCinematic;
  const none = { models: new Set<string>(), lights: new Set<string>() };
  const voidOnly = packageReachOf(DEFAULT_DEPENDENCIES, []);

  it("lists a Set's pieces of one package together, the first few by name", () => {
    const [problem, ...others] = cinematicDependencyProblems(filming({ pieces: ["AlarakWarpIn", "Banshee_BlackOps", "Banshee_BlackOps", "Banshee_BlackOps_Death", "BansheeBombingRunImpact", "RadioDesk"] }), voidOnly, none);
    expect(others).toEqual([]);
    expect(problem!.message).toMatch(/^Its Set hall's pieces AlarakWarpIn, Banshee_BlackOps, Banshee_BlackOps_Death and 1 more are NovaStoryAssets\.SC2Mod's/);
  });

  it("counts the rig a set camera's feed films through, the Nova bridge's main screen, naming the shots it films for", () => {
    const [problem, ...others] = cinematicDependencyProblems(
      filming({ shots: [{ camera: "hall/Wide", feed: "hall/Screen" }, { camera: "hall/Wide" }, { name: "on the screen", camera: "hall/Wide", feed: { camera: "hall/Screen", channel: 6 } }, { name: "on the screen", camera: "hall/Wide", feed: "hall/Screen" }, { camera: "hall/Wide", feed: "/Screen" }] }),
      voidOnly,
      none,
    );
    expect(others).toEqual([]);
    expect(problem!.message).toMatch(/^The feed rig SMX3_Nova_Ship_Bridge_MainScreen \(for the feeds of shots\.0, on the screen\) is NovaStoryAssets\.SC2Mod's/);
    expect(problem!.message).toContain(`add ${NOVA_ASSETS}`);
  });

  it("needs no rig for a feed through a cast member's own camera, as a portrait's", () => {
    expect(cinematicDependencyProblems(filming({ cast: ["Marine"], shots: [{ camera: "hall/Wide", feed: "member-0" }] }), voidOnly, none)).toEqual([]);
  });

  it("leaves out a model the Workspace defines itself, as its Campaign Mod may one of the game's ids", () => {
    expect(cinematicDependencyProblems(filming({ cast: ["SMX3_FirstOfficer"] }), voidOnly, { models: new Set(["SMX3_FirstOfficer"]), lights: new Set() })).toEqual([]);
  });

  it("names a package with no dependency the Editor has been seen to write by its path, to add in the Editor", () => {
    const [problem] = cinematicDependencyProblems(filming({ cast: ["ErrisTempleDoor"] }), voidOnly, none);
    expect(problem!.message).toContain("is mods/voidprologue.sc2mod's");
    expect(problem!.message).toContain("add a dependency on mods/voidprologue.sc2mod");
  });

  it("suggests the dependency whose chain brings the package in and loads least, for one with none of its own", () => {
    // Liberty's campaign comes in with Swarm's, and with every campaign after.
    expect(dependencyToAdd(["campaigns/liberty.sc2campaign"])).toBe("bnet:Swarm (Campaign)/0.0/999,file:Campaigns/Swarm.SC2Campaign");
  });
});
