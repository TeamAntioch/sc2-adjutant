// A Workspace mod's model staged for WhiteoutFlakes (#559): the viewer reads a model's textures from
// beside the model file before the game, so the model is copied beside links to (on Windows,
// copies of) the textures it names, each from the newest package that holds it, and nothing is
// written into the packages.
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stageModel } from "../../src/host/whiteoutflakes.js";

// Symbolic links need Developer Mode or an elevated process on Windows, which is why the Windows
// Host Adapter copies; the linking tests run elsewhere.
const linksWork = process.platform !== "win32";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function put(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** A minimal MD34 model naming `textures` as its material layers do: each in a CHAR block the tag index lists. */
function model(...textures: string[]): Uint8Array {
  const strings = textures.map((texture) => new TextEncoder().encode(`${texture}\0`));
  const offsets: number[] = [];
  let at = 16;
  for (const string of strings) {
    offsets.push(at);
    at += Math.ceil(string.length / 16) * 16;
  }
  const data = new Uint8Array(at + 16 * strings.length);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("43DM"), 0);
  view.setUint32(4, at, true);
  view.setUint32(8, strings.length, true);
  strings.forEach((string, i) => {
    data.set(string, offsets[i]!);
    data.set(new TextEncoder().encode("RAHC"), at + 16 * i);
    view.setUint32(at + 16 * i + 4, offsets[i]!, true);
    view.setUint32(at + 16 * i + 8, string.length, true);
  });
  return data;
}

async function packageRoot(): Promise<{ root: string; art: string; story: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-stage-"));
  folders.push(root);
  return { root, art: path.join(root, "Art.SC2Mod"), story: path.join(root, "Story.SC2Mod") };
}

describe.each(["link", "copy"] as const)("stageModel, placing textures by %s", (placement) => {
  const placing = placement === "link" ? it.skipIf(!linksWork) : it;

  placing("copies the model beside just the textures it names, the newest package's winning", async () => {
    const { root, art, story } = await packageRoot();
    const gate = path.join(art, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Gate", "Gate.m3");
    const data = model("Assets\\Textures\\gate_diff.dds", "Assets\\Textures\\GATE_SPEC.dds", "Assets\\Textures\\steel.dds");
    await put(gate, data);
    const diff = path.join(art, "Base.SC2Assets", "Assets", "Textures", "gate_diff.dds");
    await put(diff, "art diff");
    await put(path.join(art, "Base.SC2Assets", "Assets", "Textures", "gate_spec.dds"), "art spec");
    await put(path.join(art, "Base.SC2Assets", "Assets", "Textures", "unused.dds"), "unused");
    await put(path.join(art, "Base.SC2Assets", "Assets", "Sounds", "gate.ogg"), "sound");
    await put(path.join(story, "Assets", "Textures", "gate_spec.dds"), "story spec");
    const before = await readdir(art, { recursive: true });

    const stage = path.join(root, "work", "stage");
    const copy = await stageModel(stage, gate, [art, story], placement);

    expect(copy).toBe(path.join(stage, "Gate.m3"));
    expect((await lstat(copy)).isSymbolicLink()).toBe(false);
    expect(new Uint8Array(await readFile(copy))).toEqual(data);
    const placed = path.join(stage, "Assets", "Textures", "gate_diff.dds");
    if (placement === "link") expect(await readlink(placed)).toBe(diff);
    else expect((await lstat(placed)).isSymbolicLink()).toBe(false);
    expect(await readFile(placed, "utf8")).toBe("art diff");
    expect(await readFile(path.join(stage, "Assets", "Textures", "GATE_SPEC.dds"), "utf8")).toBe("story spec");
    // Only what the model names: steel.dds is the game's, and nothing else is placed.
    expect((await readdir(stage, { recursive: true })).sort()).toEqual(["Assets", "Assets/Textures", "Assets/Textures/GATE_SPEC.dds", "Assets/Textures/gate_diff.dds", "Gate.m3"].map((entry) => entry.split("/").join(path.sep)));
    expect(await readdir(art, { recursive: true })).toEqual(before);
  });

  placing("places a texture kept beside the model in its package beside the copy", async () => {
    const { root, art } = await packageRoot();
    const lamp = path.join(art, "Assets", "Doodads", "Lamp", "Lamp.m3");
    await put(lamp, model("Assets/Textures/Lamp_Diffuse.dds"));
    await put(path.join(art, "Assets", "Doodads", "Lamp", "lamp_diffuse.dds"), "beside");

    const stage = path.join(root, "stage");
    await stageModel(stage, lamp, [art], placement);

    expect(await readFile(path.join(stage, "Lamp_Diffuse.dds"), "utf8")).toBe("beside");
  });

  it("places nothing outside its folder for a texture path that climbs out of it", async () => {
    const { root, art } = await packageRoot();
    const sly = path.join(art, "Base.SC2Assets", "Assets", "Doodads", "Sly", "Sly.m3");
    // From the package's Base.SC2Assets, ../../outside.dds is a file the package can reach; from
    // the stage, it's a file beside the work folder.
    await put(sly, model("..\\..\\outside.dds"));
    await put(path.join(root, "outside.dds"), "package file");
    await put(path.join(root, "work", "outside.dds"), "keep me");

    const stage = path.join(root, "work", "render", "stage");
    await stageModel(stage, sly, [art], placement);

    expect(await readFile(path.join(root, "work", "outside.dds"), "utf8")).toBe("keep me");
    expect(await readdir(stage)).toEqual(["Sly.m3"]);
  });

  placing("still places a texture of that name kept beside the model, for a path that climbs or names a drive", async () => {
    const { root, art } = await packageRoot();
    const rock = path.join(art, "Assets", "Doodads", "Rock", "Rock.m3");
    await put(rock, model("..\\Textures\\rock_diff.dds", "C:\\art\\rock_spec.dds"));
    await put(path.join(art, "Assets", "Doodads", "Rock", "rock_diff.dds"), "diff beside");
    await put(path.join(art, "Assets", "Doodads", "Rock", "rock_spec.dds"), "spec beside");

    const stage = path.join(root, "stage");
    await stageModel(stage, rock, [art], placement);

    expect(await readFile(path.join(stage, "rock_diff.dds"), "utf8")).toBe("diff beside");
    expect(await readFile(path.join(stage, "rock_spec.dds"), "utf8")).toBe("spec beside");
    expect((await readdir(stage)).sort()).toEqual(["Rock.m3", "rock_diff.dds", "rock_spec.dds"]);
  });

  it("copies a model whose textures can't be read with none", async () => {
    const { root, art } = await packageRoot();
    const odd = path.join(art, "Assets", "Odd.m3");
    await put(odd, "not an md34");
    await put(path.join(art, "Assets", "Textures", "odd.dds"), "odd");

    const stage = path.join(root, "stage");
    await stageModel(stage, odd, [art], placement);

    expect(await readdir(stage)).toEqual(["Odd.m3"]);
  });
});
