// A Mission's own custom doodads (#607): models in the Mission's folder, written into its Map
// Package at their storage paths with a CModel and a CActorDoodad each, under the same file checks
// as a Campaign Mod's; and the warning for a Kept placed doodad whose type isn't a doodad, as the
// Editor's "Invalid placed doodad" placeholder shows; and the Workspace mods a Mission loads, which
// alone give its doodads files, and which a placed Campaign Mod doodad needs. The packages are synthetic.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { getDoodad } from "../../src/catalog/stock-catalog.js";
import { MissionDoodadSchema } from "../../src/domain/custom-doodad.js";
import { DEFAULT_DEPENDENCIES } from "../../src/map/write-document-info-xml.js";
import { importMod } from "../../src/mods/import-mod.js";
import { blueprintCatalog } from "../../src/catalog/catalog-layer.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { loadWorkspace, parseMissionBlueprint, WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { m3 } from "../fixtures/m3.js";
import { cleanupMods, declare as declareMod, documentHeader, put, setup } from "../mods/mod-fixture.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

const RING_OBJECT = `    <ObjectDoodad Id="1101" Position="62,165,10" Rotation="0" Scale="1,1,1" Type="StabilizerRing">\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n    </ObjectDoodad>`;
/** The hand-made CModel the Editor found no actor for. */
const MODEL_ONLY = `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CModel id="StabilizerRing" parent="Doodad">\r\n        <Model value="Assets\\Models\\Rings\\StabilizerRing.m3"/>\r\n    </CModel>\r\n</Catalog>\r\n`;

const MODEL = "Assets/Models/Rings/StabilizerRing.m3";
const DIFFUSE = "Assets/Textures/StabilizerRing_Diff.dds";
const EMISSIVE = "Assets/Textures/StabilizerRing_Em.dds";
const RING = m3([], { bounds: { min: [-16, -16, 0], max: [16, 16, 2.25] }, vertices: [[-16, 0, 0], [16, 0, 2.2]], strings: [DIFFUSE, EMISSIVE] });
const DDS = (seed: number) => Uint8Array.from({ length: 128 }, (_, index) => (index * 13 + seed) % 256);

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
afterEach(cleanupMods);

/**
 * The Mission `yard`, imported, every part of its package Kept: Ashen Crossing compiled elsewhere,
 * with the ring placed in its Objects, `data` as its ModelData and the ring's files in the Mission's art/.
 */
async function yard(data?: string) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mission-doodads-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Yard.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const objects = path.join(source, "Objects");
  await writeFile(objects, (await readFile(objects, "utf8")).replace("</PlacedObjects>", `${RING_OBJECT}\r\n</PlacedObjects>`));
  if (data) {
    await mkdir(path.join(source, "Base.SC2Data", "GameData"), { recursive: true });
    await writeFile(path.join(source, "Base.SC2Data", "GameData", "ModelData.xml"), data);
  }
  const { blueprintPath, mapPackage } = await importMap(await loadWorkspace(workspaceRoot), source, "yard", { title: "Yard" });
  const missionDir = path.dirname(blueprintPath);
  await mkdir(path.join(missionDir, "art"), { recursive: true });
  await writeFile(path.join(missionDir, "art", "StabilizerRing.m3"), RING);
  await writeFile(path.join(missionDir, "art", "StabilizerRing_Diff.dds"), DDS(1));
  await writeFile(path.join(missionDir, "art", "StabilizerRing_Em.dds"), DDS(2));
  const imported = JSON.parse(await readFile(blueprintPath, "utf8"));
  return { workspaceRoot, blueprintPath, missionDir, mapPackage, declare: (fields: Record<string, unknown>) => writeFile(blueprintPath, JSON.stringify({ ...imported, ...fields }, null, 2)) };
}

const RING_DOODAD = { id: "StabilizerRing", model: MODEL, source: "art/StabilizerRing.m3", group: "Structures", textures: { [DIFFUSE]: "art/StabilizerRing_Diff.dds", [EMISSIVE]: "art/StabilizerRing_Em.dds" } };
const compile = async (workspaceRoot: string, blueprintPath: string) => compileMission(await loadWorkspace(workspaceRoot), blueprintPath, undefined, { savedAt });

describe("a Kept placed doodad", () => {
  it("is warned about when its type is a CModel with no CActorDoodad, as the Editor shows a placeholder", async () => {
    const { workspaceRoot, blueprintPath } = await yard(MODEL_ONLY);

    const { warnings } = await compile(workspaceRoot, blueprintPath);

    expect(warnings.filter((warning) => warning.startsWith("Objects places"))).toEqual([
      "Objects places a copy of StabilizerRing (at 62, 165, 10), which isn't a doodad type: there is a CModel StabilizerRing but no CActorDoodad of that id, and a doodad type is its actor, so the Editor shows a placeholder model and its palette leaves it out. Declare it in the Blueprint's doodads (or the Campaign Mod's), which write its CModel and CActorDoodad",
    ]);
  });

  it("is warned about, more cautiously, when nothing core knows defines its type", async () => {
    const { workspaceRoot, blueprintPath } = await yard();

    const { warnings } = await compile(workspaceRoot, blueprintPath);

    expect(warnings.filter((warning) => warning.startsWith("Objects places"))).toEqual([expect.stringMatching(/^Objects places a copy of StabilizerRing \(at 62, 165, 10\), a doodad type that isn't in core's catalog/)]);
  });
});

describe("a Mission Blueprint's doodads", () => {
  it("write the model and its textures into the Map Package, with a CModel and a CActorDoodad, and the placed ring is a doodad", async () => {
    const { workspaceRoot, blueprintPath, mapPackage, declare } = await yard();
    await declare({ doodads: [RING_DOODAD] });

    const { warnings } = await compile(workspaceRoot, blueprintPath);

    expect(warnings.filter((warning) => warning.includes("StabilizerRing"))).toEqual([]);
    expect(new Uint8Array(await readFile(path.join(mapPackage, ...MODEL.split("/"))))).toEqual(RING);
    expect(new Uint8Array(await readFile(path.join(mapPackage, ...EMISSIVE.split("/"))))).toEqual(DDS(2));
    expect(await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ModelData.xml"), "utf8")).toContain(`<CModel id="StabilizerRing" parent="Doodad">\n        <Model value="Assets\\Models\\Rings\\StabilizerRing.m3"/>`);
    expect(await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8")).toContain(`<CActorDoodad id="StabilizerRing">\n        <On index="0" removed="1"/>`);
    const catalog = blueprintCatalog(await parseMissionBlueprint(await loadWorkspace(workspaceRoot), blueprintPath));
    expect(getDoodad(catalog, "StabilizerRing")).toMatchObject({ kind: "campaign-mod" });

    // Compiled again, nothing changes.
    const before = await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8");
    await compile(workspaceRoot, blueprintPath);
    expect(await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8")).toBe(before);
  });

  it("take a texture the Map Package already holds, and refuse one that is nowhere, naming it", async () => {
    const { workspaceRoot, blueprintPath, mapPackage, declare } = await yard();
    await mkdir(path.join(mapPackage, "Assets", "Textures"), { recursive: true });
    await writeFile(path.join(mapPackage, ...DIFFUSE.split("/")), DDS(1));
    await declare({ doodads: [{ ...RING_DOODAD, textures: {} }] });

    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(
      `doodads.0 (StabilizerRing)'s model ${MODEL} names a texture that isn't in the doodad's own files (its source and textures), the Map Package or a Workspace mod package (the Mission depends on none): ${EMISSIVE}. Add each file at that path, or, when it is the game's own texture, list it in the doodad's gameTextures`,
    );

    await declare({ doodads: [{ ...RING_DOODAD, textures: { [EMISSIVE]: "art/StabilizerRing_Em.dds" } }] });
    await expect(compile(workspaceRoot, blueprintPath)).resolves.toBeDefined();
  });

  it("don't take the last compile's copy of a texture the Blueprint no longer ships for a Kept one", async () => {
    const { workspaceRoot, blueprintPath, declare } = await yard();
    await declare({ doodads: [RING_DOODAD] });
    await compile(workspaceRoot, blueprintPath);

    await declare({ doodads: [{ ...RING_DOODAD, textures: { [DIFFUSE]: "art/StabilizerRing_Diff.dds" } }] });
    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(`names a texture that isn't in the doodad's own files (its source and textures), the Map Package or a Workspace mod package (the Mission depends on none): ${EMISSIVE}`);
  });

  it("are checked against the game's data schema, as a Campaign Mod's are", async () => {
    const { workspaceRoot, blueprintPath, declare } = await yard();
    await declare({ doodads: [{ ...RING_DOODAD, fields: { actor: { NoSuchField: 1 } } }] });

    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(/doodads\.0 \(StabilizerRing\): .*NoSuchField/);
  });

  it("refuse a file outside the Workspace, and one storage path given two different files", async () => {
    const { workspaceRoot, blueprintPath, declare } = await yard();
    await declare({ doodads: [{ ...RING_DOODAD, source: "art/Missing.m3" }] });
    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(/doodads\.0 \(StabilizerRing\)'s file art\/Missing\.m3 can't be read/);

    await declare({ doodads: [RING_DOODAD, { ...RING_DOODAD, id: "StabilizerRingCopy", textures: { [DIFFUSE]: "art/StabilizerRing_Em.dds" } }] });
    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(/writes Assets\/Models\/Rings\/StabilizerRing\.m3 from art\/StabilizerRing\.m3|writes Assets\/Textures\/StabilizerRing_Diff\.dds from art\/StabilizerRing_Em\.dds, and another doodad writes it from art\/StabilizerRing_Diff\.dds, which differs/);
  });
});

const PYLON = "Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3";

describe("a Mission Blueprint's gameModel doodad", () => {
  it("draws the game's own model: a CModel at the game's path and no copy of the file", async () => {
    const { workspaceRoot, blueprintPath, mapPackage, declare } = await yard();
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true }] });

    const { warnings } = await compile(workspaceRoot, blueprintPath);

    expect(warnings.filter((warning) => warning.includes("GreenPylon"))).toEqual([]);
    expect(await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ModelData.xml"), "utf8")).toContain(`<CModel id="GreenPylon" parent="Doodad">\n        <Model value="Assets\\Buildings\\Protoss\\PylonEx2\\PylonEx2.m3"/>`);
    expect(await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8")).toContain(`<CActorDoodad id="GreenPylon">`);
    await expect(readFile(path.join(mapPackage, ...PYLON.split("/")))).rejects.toThrow(/ENOENT/);
  });

  it("is refused at a path the game has no model at, naming it", async () => {
    const { workspaceRoot, blueprintPath, declare } = await yard();
    await declare({ doodads: [{ id: "GreenPylon", model: "Assets/Buildings/Protoss/PylonEx9/PylonEx9.m3", gameModel: true }] });

    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow("doodads.0 (GreenPylon)'s model Assets/Buildings/Protoss/PylonEx9/PylonEx9.m3 is a gameModel, but core knows of no game model at that path");
  });

  it("is refused with a source, which a game model has none of", async () => {
    const { workspaceRoot, blueprintPath, declare } = await yard();
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true, source: "art/StabilizerRing.m3" }] });

    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(/doodads\.0\.source.*a gameModel is the game's own file: leave source out/s);
  });

  it("is refused with textures or gameTextures other than its swaps' new ones, since a file at a game texture's path replaces it for every model in the map", () => {
    const green = "Assets/Textures/Green_Pylon_Emissive.dds";
    const swapped = { id: "GreenPylon", model: PYLON, gameModel: true, swaps: [{ replace: PYLON_EMISSIVE, with: green }] };
    expect(MissionDoodadSchema.safeParse({ ...swapped, textures: { [green]: "art/Green.dds" } }).success).toBe(true);
    expect(MissionDoodadSchema.safeParse({ ...swapped, gameTextures: [green] }).success).toBe(true);
    const parsed = MissionDoodadSchema.safeParse({ ...swapped, textures: { [PYLON_EMISSIVE]: "art/Green.dds", [green]: "art/Green.dds" }, gameTextures: ["Assets/Textures/Pylon_Diffuse.dds"] });
    expect(parsed.error?.issues.map(({ path: at, message }) => `${at.join(".")}: ${message}`)).toEqual([
      `textures: a gameModel's textures are the game's own: a file shipped at one of their paths replaces it for every model in the map, so ship only a swap's with texture, not ${PYLON_EMISSIVE}`,
      "gameTextures: a gameModel's textures are the game's own: list only a swap's with texture in gameTextures, not Assets/Textures/Pylon_Diffuse.dds",
    ]);
  });
});

const PYLON_EMISSIVE = "Assets/Textures/Pylon_Emissive.dds";
const PYLON_ENVIRO = "Assets/Textures/EnviroTest2.dds";
const GREEN_EMISSIVE = "Assets/Textures/Green_Pylon_Emissive.dds";
const GREEN_ENVIRO = "Assets/Textures/Green_EnviroTest2.dds";
/** A Pylon-like model: its crystal's emissive (MAT_ layer 4) and environment map (6). */
const PYLON_M3 = m3([], { bounds: { min: [-1, -1, 0], max: [1, 1, 2] }, materials: [{ blendMode: 0 }], materialLayers: [{ name: "pylon_crystal_zeus", layers: { 4: PYLON_EMISSIVE, 6: PYLON_ENVIRO } }] });
const PYLON_SWAPS = { swaps: [{ replace: PYLON_EMISSIVE, with: GREEN_EMISSIVE }, { replace: PYLON_ENVIRO, with: GREEN_ENVIRO }], textures: { [GREEN_EMISSIVE]: "art/Green_Emissive.dds", [GREEN_ENVIRO]: "art/Green_Enviro.dds" } };
const STUDIO = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));

/** The `studio` test Host Adapter, whose game holds `models` at their storage paths. */
async function studioHost(models: Record<string, Uint8Array>) {
  const cacheDir = path.join(root!, "cache");
  for (const [model, data] of Object.entries(models)) {
    await mkdir(path.dirname(path.join(cacheDir, "game", model)), { recursive: true });
    await writeFile(path.join(cacheDir, "game", model), data);
  }
  const machine = path.join(root!, "machine.json");
  await writeFile(machine, JSON.stringify({ hostAdapter: STUDIO, cacheDir }));
  return { host: await loadHost(await loadMachineConfig({ file: machine, env: {} })), log: () => readFile(path.join(cacheDir, "host.log"), "utf8") };
}

describe("a Mission Blueprint's doodad swaps", () => {
  it("write the declarations, a CTexture per swap in the slot of its layer, the actor's events and the new textures, on a Workspace model", async () => {
    const { workspaceRoot, blueprintPath, missionDir, mapPackage, declare } = await yard();
    await writeFile(path.join(missionDir, "art", "Pylon.m3"), PYLON_M3);
    await writeFile(path.join(missionDir, "art", "Green_Emissive.dds"), DDS(3));
    await writeFile(path.join(missionDir, "art", "Green_Enviro.dds"), DDS(4));
    await writeFile(path.join(missionDir, "art", "Pylon_Emissive.dds"), DDS(5));
    await writeFile(path.join(missionDir, "art", "EnviroTest2.dds"), DDS(6));
    const model = "Assets/Doodads(Custom)/Pylon/Pylon.m3";
    const textures = { ...PYLON_SWAPS.textures, [PYLON_EMISSIVE]: "art/Pylon_Emissive.dds", [PYLON_ENVIRO]: "art/EnviroTest2.dds" };
    await declare({ doodads: [{ id: "GreenPylon", model, source: "art/Pylon.m3", ...PYLON_SWAPS, textures }] });

    const { warnings } = await compile(workspaceRoot, blueprintPath);

    expect(warnings.filter((warning) => warning.includes("GreenPylon"))).toEqual([]);
    const data = (file: string) => readFile(path.join(mapPackage, "Base.SC2Data", "GameData", file), "utf8");
    expect(await data("ModelData.xml")).toContain(`        <TextureDeclares Prefix="Pylon_Emissive">\n            <Adaptions Slot="swap1"/>\n        </TextureDeclares>\n        <TextureDeclares Prefix="EnviroTest2">`);
    expect(await data("ActorData.xml")).toContain(`        <On Terms="ActorCreation" Send="TextureSelectById GreenPylon_Swap2"/>\n        <On Terms="ModelSwapped" Send="TextureSelectById GreenPylon_Swap2"/>`);
    expect(await data("TextureData.xml")).toContain(
      [`<CTexture id="GreenPylon_Swap1">`, `        <File value="Assets\\Textures\\Green_Pylon_Emissive.dds"/>`, `        <Slot value="swap1.emissive"/>`, `    </CTexture>`, `    <CTexture id="GreenPylon_Swap2">`].join("\n"),
    );
    expect(await data("TextureData.xml")).toContain(`<Slot value="swap2"/>`);
    expect(new Uint8Array(await readFile(path.join(mapPackage, ...GREEN_ENVIRO.split("/"))))).toEqual(DDS(4));

    // Compiled again, nothing changes; compiled without the swaps, their CTextures go.
    const before = await data("TextureData.xml");
    await compile(workspaceRoot, blueprintPath);
    expect(await data("TextureData.xml")).toBe(before);
    await declare({ doodads: [{ id: "GreenPylon", model, source: "art/Pylon.m3", textures }] });
    await compile(workspaceRoot, blueprintPath);
    expect(await data("TextureData.xml").catch(() => "")).not.toContain("GreenPylon_Swap");

    // A swap of a texture the model doesn't name is refused, naming the ones it does.
    await declare({ doodads: [{ id: "GreenPylon", model, source: "art/Pylon.m3", swaps: [{ replace: "Assets/Textures/Nope.dds", with: GREEN_EMISSIVE }], textures }] });
    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(`doodads.0 (GreenPylon)'s swaps.0 replaces Assets/Textures/Nope.dds, which its model ${model} doesn't name. It names ${PYLON_EMISSIVE}, ${PYLON_ENVIRO}`);
  });

  it("on a gameModel read the game's .m3 through the Host Adapter for each texture's layer", async () => {
    const { workspaceRoot, blueprintPath, missionDir, mapPackage, declare } = await yard();
    await writeFile(path.join(missionDir, "art", "Green_Emissive.dds"), DDS(3));
    await writeFile(path.join(missionDir, "art", "Green_Enviro.dds"), DDS(4));
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true, ...PYLON_SWAPS }] });
    const { host, log } = await studioHost({ [PYLON]: PYLON_M3 });

    const { warnings } = await compileMission(await loadWorkspace(workspaceRoot), blueprintPath, undefined, { savedAt, host });

    expect(warnings.filter((warning) => warning.includes("GreenPylon"))).toEqual([]);
    expect(await log()).toContain(`export ${PYLON}`);
    const textures = await readFile(path.join(mapPackage, "Base.SC2Data", "GameData", "TextureData.xml"), "utf8");
    expect(textures).toContain(`<Slot value="swap1.emissive"/>`);
    expect(textures).toContain(`<Slot value="swap2"/>`);
    await expect(readFile(path.join(mapPackage, ...PYLON.split("/")))).rejects.toThrow(/ENOENT/);
  });

  it("refuse a new texture that is a Git LFS pointer, and one a gameModel ships at a path its model names, which would replace the game's across the map", async () => {
    const { workspaceRoot, blueprintPath, missionDir, declare } = await yard();
    await writeFile(path.join(missionDir, "art", "Green_Emissive.dds"), "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 128\n");
    await writeFile(path.join(missionDir, "art", "Green_Enviro.dds"), DDS(4));
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true, ...PYLON_SWAPS }] });
    const { host } = await studioHost({ [PYLON]: PYLON_M3 });
    const compileWith = async () => compileMission(await loadWorkspace(workspaceRoot), blueprintPath, undefined, { savedAt, host });

    await expect(compileWith()).rejects.toThrow(`doodads.0 (GreenPylon)'s swaps.0 draws ${GREEN_EMISSIVE} from art/Green_Emissive.dds, which is a Git LFS pointer, its file not pulled on this machine: run git lfs pull, then compile again`);

    await writeFile(path.join(missionDir, "art", "Green_Emissive.dds"), DDS(3));
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true, swaps: [{ replace: PYLON_EMISSIVE, with: PYLON_ENVIRO }], textures: { [PYLON_ENVIRO]: "art/Green_Enviro.dds" } }] });
    await expect(compileWith()).rejects.toThrow(
      `doodads.0 (GreenPylon)'s swaps.0 ships ${PYLON_ENVIRO}, a texture its gameModel ${PYLON} names: that file replaces the game's for every model in the map that draws it, so give the new texture a path of its own`,
    );
  });

  it("on a gameModel are refused without a Host Adapter that reads the game's models, since a slot it can't check fails silently in the game", async () => {
    const { workspaceRoot, blueprintPath, missionDir, declare } = await yard();
    await writeFile(path.join(missionDir, "art", "Green_Emissive.dds"), DDS(3));
    await writeFile(path.join(missionDir, "art", "Green_Enviro.dds"), DDS(4));
    await declare({ doodads: [{ id: "GreenPylon", model: PYLON, gameModel: true, ...PYLON_SWAPS }] });

    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(
      `doodads.0 (GreenPylon) swaps textures on the gameModel ${PYLON}, whose .m3 the compile reads from the game for the layer each texture is in, through the Host Adapter's model.export, and this machine's Host Adapter (none) doesn't have it: compile on a machine whose Host Adapter does, or take the swaps out`,
    );
  });
});

describe("a generated Mission's doodads", () => {
  it("are placed by an Anchor of their id, their entries in the ActorData and ModelData the compile writes", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mission-doodads-"));
    await cp(CROSSING, root, { recursive: true });
    const missionDir = path.join(root, "missions", "ashen-crossing");
    const blueprintPath = path.join(missionDir, "blueprint.json");
    await mkdir(path.join(missionDir, "art"), { recursive: true });
    await writeFile(path.join(missionDir, "art", "StabilizerRing.m3"), RING);
    await writeFile(path.join(missionDir, "art", "StabilizerRing_Diff.dds"), DDS(1));
    await writeFile(path.join(missionDir, "art", "StabilizerRing_Em.dds"), DDS(2));
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    const anchor = { id: "overhang_ring", name: "Ring", zoneId: "overhang", kind: "doodad", position: { x: 44, y: 24 }, doodadType: "StabilizerRing" };
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, doodads: [RING_DOODAD], anchors: [...blueprint.anchors, anchor] }, null, 2));

    const { outputDir } = await compile(root, blueprintPath);

    expect(await readFile(path.join(outputDir, "Objects"), "utf8")).toMatch(/<ObjectDoodad [^>]*Type="StabilizerRing"/);
    expect(await readFile(path.join(outputDir, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8")).toContain(`<CActorDoodad id="StabilizerRing">`);
    expect(await readFile(path.join(outputDir, "Base.SC2Data", "GameData", "ModelData.xml"), "utf8")).toContain(`<CModel id="StabilizerRing" parent="Doodad">`);
    expect(await readFile(path.join(outputDir, "ComponentList.SC2Components"), "utf8")).toContain(">GameData<");
  });
});

/**
 * Ashen Crossing in a Workspace whose Campaign Mod Harbour-Story declares the doodad HarbourCrate
 * and depends on the Asset Mod Harbour-Art, which holds the ring's emissive texture; the ring's
 * files in the Mission's art/. Blueprints are written with `declare`.
 */
async function harbourCrossing() {
  const story = await setup();
  const art = path.join(path.dirname(story.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
  await put(path.join(art, "DocumentHeader"), documentHeader([], 6));
  await put(path.join(art, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo/>\r\n`);
  await put(path.join(art, "Base.SC2Assets", ...EMISSIVE.split("/")), DDS(2));
  await importMod(await loadWorkspace(story.workspaceRoot), art, "harbour-art", { kind: "asset" });
  const config = JSON.parse(await readFile(path.join(story.workspaceRoot, WORKSPACE_FILE), "utf8"));
  await writeFile(
    path.join(story.workspaceRoot, WORKSPACE_FILE),
    JSON.stringify({ ...config, campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["bundled:hazard"], campaignMod: "Harbour-Story", mods: ["harbour-story", "harbour-art"] }),
  );
  await declareMod(story, { doodads: [{ id: "HarbourCrate", model: "Assets/Doodads(Custom)/HarbourCrate.m3" }] });
  const missionDir = path.join(story.workspaceRoot, "missions", "ashen-crossing");
  await cp(path.join(CROSSING, "missions", "ashen-crossing"), missionDir, { recursive: true });
  await mkdir(path.join(missionDir, "art"), { recursive: true });
  await writeFile(path.join(missionDir, "art", "StabilizerRing.m3"), RING);
  await writeFile(path.join(missionDir, "art", "StabilizerRing_Diff.dds"), DDS(1));
  await writeFile(path.join(missionDir, "art", "StabilizerRing_Em.dds"), DDS(2));
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const original = JSON.parse(await readFile(blueprintPath, "utf8"));
  // Its Screenplay's speakers are no characters of Harbour-Story's: it plays none here.
  const declare = (fields: Record<string, unknown>) => writeFile(blueprintPath, JSON.stringify({ ...original, screenplay: { ...original.screenplay, script: undefined }, ...fields }, null, 2));
  return { workspaceRoot: story.workspaceRoot, blueprintPath, original, declare };
}

const LOADS_STORY = [...DEFAULT_DEPENDENCIES, "file:Mods\\Harbour-Story.SC2Mod"];

describe("a Mission's doodads and the Workspace's mods", () => {
  it("find a texture in a Workspace mod only when the Mission depends on it, and warn about an own file that replaces a mod's", async () => {
    const { workspaceRoot, blueprintPath, declare } = await harbourCrossing();
    const diffuseOnly = { ...RING_DOODAD, textures: { [DIFFUSE]: "art/StabilizerRing_Diff.dds" } };
    await declare({ doodads: [diffuseOnly] });
    await expect(compile(workspaceRoot, blueprintPath)).rejects.toThrow(
      `names a texture that isn't in the doodad's own files (its source and textures), the Map Package or a Workspace mod package (the Mission depends on none): ${EMISSIVE}`,
    );

    await declare({ doodads: [diffuseOnly], dependencies: LOADS_STORY });
    expect((await compile(workspaceRoot, blueprintPath)).warnings.filter((warning) => warning.includes("StabilizerRing"))).toEqual([]);

    await declare({ doodads: [RING_DOODAD], dependencies: LOADS_STORY });
    expect((await compile(workspaceRoot, blueprintPath)).warnings.filter((warning) => warning.includes("StabilizerRing"))).toEqual([
      `art/StabilizerRing_Em.dds is written at ${EMISSIVE}, where mods/harbour-art/Harbour-Art.SC2Mod/Base.SC2Assets/${EMISSIVE} is too: in this map it replaces that file for everything that draws it. Give it a path of its own, unless that replacement is the point`,
    ]);
  });

  it("warn when the Mission places a Campaign Mod doodad but doesn't load the Campaign Mod", async () => {
    const { workspaceRoot, blueprintPath, original, declare } = await harbourCrossing();
    await declare({});
    const anchor = { id: "overhang_crate", name: "Crate", zoneId: "overhang", kind: "doodad", position: { x: 44, y: 24 }, doodadType: "HarbourCrate" };
    await declare({ anchors: [...original.anchors, anchor] });
    expect((await compile(workspaceRoot, blueprintPath)).warnings).toContain(
      "Doodads HarbourCrate are the Campaign Mod's, which the map doesn't load: add file:Mods\\Harbour-Story.SC2Mod to the Blueprint's dependencies, or the Editor shows a placeholder for each.",
    );

    await declare({ anchors: [...original.anchors, anchor], dependencies: LOADS_STORY });
    expect((await compile(workspaceRoot, blueprintPath)).warnings.filter((warning) => warning.includes("HarbourCrate"))).toEqual([]);
  });
});
