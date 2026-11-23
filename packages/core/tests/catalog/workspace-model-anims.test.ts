// Workspace-recorded model animations (ADR-0026): a game model's in model-anims.json at the
// Workspace root, a Campaign Mod's own in mods/<id>/model-anims.json, a Mission's own in
// missions/<id>/model-anims.json, each laid over the one before and all over core's, per model.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bundledModelAnims, catalogModelAnims } from "../../src/catalog/model-anims.js";
import { missionCatalogFor } from "../../src/map/mission-catalog.js";
import { checkWorkspace, type WorkspaceCheck } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf } from "../mcp/harness.js";
import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { put } from "../mods/mod-fixture.js";

afterEach(cleanupLantern);

const BLUEPRINT = "missions/radio-field/blueprint.json";
const CINEMATIC = "missions/radio-field/cinematics/radio.json";

/** A recorded model with the given animations, each 1 s, still. */
const recorded = (file: string, ...anims: string[]) => ({ file, anims: anims.map((name) => ({ name, durationMs: 1000, moveSpeed: 0, looping: true })) });

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The check's problems as `file path: severity: message`, the fixture's own Model Guide notes aside. */
const reported = (check: WorkspaceCheck) =>
  check.problems.filter(({ message }) => !message.includes("but no Model Guide")).map(({ file, path: at, severity, message }) => `${file}${at ? ` ${at}` : ""}: ${severity ? `${severity}: ` : ""}${message}`);

describe("a Workspace's recorded model animations", () => {
  it("reads a game model's from model-anims.json at the Workspace root, with no Campaign Mod, over core's", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), json({ Operator: recorded("Assets/Operator.m3", "Stand", "Talk"), SMX3_BGPeople_06: recorded("Assets/People06.m3", "Stand") }));
    const anims = await catalogModelAnims((await loadWorkspace(root)).catalog);
    expect(anims.Operator?.anims.map(({ name }) => name)).toEqual(["Stand", "Talk"]);
    // The Workspace's entry replaces core's whole entry for its model; core's others stand.
    expect(anims.SMX3_BGPeople_06?.file).toBe("Assets/People06.m3");
    expect(anims.SMX3_BGPeople_01).toEqual((await bundledModelAnims()).SMX3_BGPeople_01);
  });

  it("lays a Mission's own over the root's, for that Mission only", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), json({ Operator: recorded("Assets/Operator.m3", "Stand") }));
    await writeFile(path.join(root, "missions/radio-field/model-anims.json"), json({ Operator: recorded("Assets/RadioOperator.m3", "Stand", "Talk") }));
    const workspace = await loadWorkspace(root);
    expect((await catalogModelAnims(workspace.catalog)).Operator?.file).toBe("Assets/Operator.m3");
    expect((await catalogModelAnims(await missionCatalogFor(workspace.catalog, path.join(root, BLUEPRINT)))).Operator?.file).toBe("Assets/RadioOperator.m3");
  });

  it("lays the Campaign Mod's over the root's, and a Mission's over both", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await writeFile(path.join(root, "model-anims.json"), json({ Marine: recorded("Assets/Root.m3", "Stand"), Ghost: recorded("Assets/Ghost.m3", "Stand") }));
    await put(path.join(root, "mods/lantern-story/model-anims.json"), json({ Marine: recorded("Assets/Mod.m3", "Stand") }));
    await put(path.join(path.dirname(blueprintPath), "model-anims.json"), json({ Ghost: recorded("Assets/Mission.m3", "Stand") }));
    const workspace = await loadWorkspace(root);
    const anims = await catalogModelAnims(workspace.catalog);
    expect([anims.Marine?.file, anims.Ghost?.file]).toEqual(["Assets/Mod.m3", "Assets/Ghost.m3"]);
    const mission = await catalogModelAnims(await missionCatalogFor(workspace.catalog, blueprintPath));
    expect([mission.Marine?.file, mission.Ghost?.file]).toEqual(["Assets/Mod.m3", "Assets/Mission.m3"]);
  });

  it("casts a speaker on a model the Workspace recorded, and names that file for an anim it lacks", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), json({ Operator: recorded("Assets/Operator.m3", "Stand", "Talk") }));
    const cinematic = JSON.parse(await readFile(path.join(root, CINEMATIC), "utf8"));
    cinematic.cast[0].model = "Operator";
    cinematic.cast[0].anim = "Dance";
    await writeFile(path.join(root, CINEMATIC), JSON.stringify(cinematic));
    const errors = (await checkWorkspace(root)).problems.filter(({ severity }) => severity === undefined).map(({ path: at, message }) => `${at}: ${message}`);
    expect(errors).toEqual(["cast.0.anim: Operator has no animation Dance (model-anims.json)"]);
  });

  it("refuses a speaker on an unrecorded model, saying how a Workspace records it", async () => {
    const root = await copyOf("cinematic");
    const cinematic = JSON.parse(await readFile(path.join(root, CINEMATIC), "utf8"));
    cinematic.cast[0].model = "Operator";
    await writeFile(path.join(root, CINEMATIC), JSON.stringify(cinematic));
    const errors = (await checkWorkspace(root)).problems.filter(({ severity }) => severity === undefined).map(({ message }) => message);
    expect(errors).toEqual(["Operator's animations aren't recorded, so NOVA can't talk: record them with record_model_anims (from a shell, npm run model-anims -- Operator)"]);
  });

  it("reports a file that isn't recorded animations, and reads the others", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), "{ not json");
    await writeFile(path.join(root, "missions/radio-field/model-anims.json"), json({ Operator: { file: "Assets/Operator.m3", anims: [{ name: "Stand" }] } }));
    const workspace = await loadWorkspace(root);
    expect((await catalogModelAnims(workspace.catalog)).Operator).toBeUndefined();
    const problems = reported(await checkWorkspace(root));
    expect(problems).toEqual([
      expect.stringMatching(/^missions\/radio-field\/model-anims\.json: missions\/radio-field\/model-anims\.json isn't recorded model animations: Operator\.anims\.0\.durationMs: /),
      expect.stringMatching(/^model-anims\.json: model-anims\.json isn't JSON: /),
    ]);
  });

  it("notes a root entry core records too, the same or not", async () => {
    const root = await copyOf("cinematic");
    const core = await bundledModelAnims();
    await writeFile(path.join(root, "model-anims.json"), json({ SMX3_BGPeople_01: core.SMX3_BGPeople_01, SMX3_BGPeople_06: recorded("Assets/People06.m3", "Stand") }));
    expect(reported(await checkWorkspace(root))).toEqual([
      "model-anims.json SMX3_BGPeople_01: note: core records SMX3_BGPeople_01 too, the same: drop it from model-anims.json",
      "model-anims.json SMX3_BGPeople_06: note: core records SMX3_BGPeople_06 too, differently: model-anims.json's is used until it's dropped from there",
    ]);
  });

  it("warns of an entry in another owner's file, and passes each in its owner's", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    const mission = path.dirname(blueprintPath);
    await put(path.join(root, "mods/lantern-story/Lantern-Story.SC2Mod/Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="LanternBuoy"/>\n    <CModel id="LanternFlag"/>\n</Catalog>\n`);
    await put(path.join(mission, "Ashen.SC2Map/Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="AshenSignal"/>\n    <CModel id="AshenMast"/>\n</Catalog>\n`);
    await put(path.join(mission, "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
    await writeFile(path.join(root, "model-anims.json"), json({ Marine: recorded("Assets/Marine.m3", "Stand"), LanternBuoy: recorded("Assets/Buoy.m3", "Stand"), AshenMast: recorded("Assets/Mast.m3", "Stand") }));
    await put(path.join(root, "mods/lantern-story/model-anims.json"), json({ LanternFlag: recorded("Assets/Flag.m3", "Stand"), Ghost: recorded("Assets/Ghost.m3", "Stand") }));
    await put(path.join(mission, "model-anims.json"), json({ AshenSignal: recorded("Assets/Signal.m3", "Stand"), Zealot: recorded("Assets/Zealot.m3", "Stand"), LanternFlag: recorded("Assets/Flag.m3", "Stand") }));
    const problems = reported(await checkWorkspace(root)).filter((problem) => problem.includes("model-anims.json"));
    expect(problems).toEqual([
      "missions/ashen-crossing/model-anims.json Zealot: warning: Zealot isn't one of the Mission's own models (its Map Package's Kept CModels): record a game model's animations in model-anims.json at the Workspace root",
      "missions/ashen-crossing/model-anims.json LanternFlag: warning: LanternFlag is the Campaign Mod's own model: record its animations in mods/lantern-story/model-anims.json",
      "model-anims.json AshenMast: warning: AshenMast is the Mission ashen-crossing's own model: record its animations in missions/ashen-crossing/model-anims.json",
      "model-anims.json LanternBuoy: warning: LanternBuoy is the Campaign Mod's own model: record its animations in mods/lantern-story/model-anims.json",
      "mods/lantern-story/model-anims.json Ghost: warning: Ghost isn't one of the Campaign Mod's own models: record a game model's animations in model-anims.json at the Workspace root",
    ]);
  });

  it("doesn't judge a Mission's file while which of its package's data is Kept can't be told", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    const mission = path.dirname(blueprintPath);
    await put(path.join(mission, "Ashen.SC2Map/Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="AshenSignal"/>\n</Catalog>\n`);
    await put(path.join(mission, "compile-record.json"), "{ not a record");
    await put(path.join(mission, "model-anims.json"), json({ AshenSignal: recorded("Assets/Signal.m3", "Stand") }));
    expect(reported(await checkWorkspace(root)).filter((problem) => problem.includes("AshenSignal"))).toEqual([]);
  });
});
