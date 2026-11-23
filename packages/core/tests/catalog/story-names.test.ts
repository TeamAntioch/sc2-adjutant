// The names a Workspace's story is told in (src/catalog/story-names.ts): its Campaign's, its mods',
// its Missions' and its characters', which nothing sent to the public sc2-asset-catalog may hold.
// Over a synthetic Workspace.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { namedIn, workspaceStoryNames } from "../../src/catalog/story-names.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "story-names-"));
  folders.push(root);
  const write = async (file: string, value: unknown) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  await write("mods/tides-campaign/blueprint.json", { id: "tides-campaign", name: "Glass Tides Campaign", characters: [{ speaker: "ORLA VANCE", id: "CharOrla", name: "Orla" }, { speaker: "BRISK", id: "CharBrisk" }] });
  await write("missions/tides-0101/blueprint.json", {
    id: "tides-0101",
    campaignId: "glass_tides",
    title: "Lantern Run",
    screenplay: { title: "Lantern Run", scenes: [{ id: "intro", lines: [{ id: "a", speaker: "Harbormaster Quill", text: "Move along." }] }] },
  });
  // A Mission whose Blueprint won't read still gives its folder's name.
  await write("missions/tides-0102/blueprint.json", "{ not json");
  return { root, campaign: { id: "glass_tides", name: "Glass Tides" }, missionsDir: path.join(root, "missions"), mods: ["tides-campaign"], campaignMod: "Glass Tides Mod", registry: { campaignMod: () => "Pack Mod" } };
}

describe("workspaceStoryNames", () => {
  it("gives the Campaign's, the mods', the Missions' and the characters' names", async () => {
    const names = await workspaceStoryNames(await workspace());
    expect(names).toEqual(
      expect.arrayContaining(["glass_tides", "Glass Tides", "Glass Tides Mod", "tides-campaign", "Glass Tides Campaign", "ORLA VANCE", "Orla", "BRISK", "tides-0101", "Lantern Run", "Harbormaster Quill", "tides-0102"]),
    );
  });

  it("gives the Campaign Mod's name as the Campaign Pack names it, when the config doesn't", async () => {
    const { campaignMod: _named, ...rest } = await workspace();
    expect(await workspaceStoryNames(rest)).toContain("Pack Mod");
  });
});

describe("namedIn", () => {
  const names = ["glass_tides", "Lantern Run", "BRISK", "tides-0101", "Orla", "ab"];

  it("finds a name in any case, spacing or punctuation, as whole words", () => {
    expect(namedIn("hatch where Brisk's squad escapes", names)).toEqual(["BRISK"]);
    expect(namedIn("drop hatch (lantern-run search)", names)).toEqual(["Lantern Run"]);
    expect(namedIn("Glass Tides crate", names)).toEqual(["glass_tides"]);
    expect(namedIn("chute in TIDES_0101", names)).toEqual(["tides-0101"]);
  });

  it("gives a name once when the Workspace spells it several ways", () => {
    expect(namedIn("the lantern run belt", ["lantern-run", "Lantern Run", "lantern_run"])).toEqual(["lantern-run"]);
  });

  it("finds nothing in general words, or inside another word, and ignores names too short to tell", () => {
    expect(namedIn("brisket smoker by a briskly lit lantern on a running track", names)).toEqual([]);
    expect(namedIn("ab cd", names)).toEqual([]);
    expect(namedIn("square, heavy press head over a conveyor belt", names)).toEqual([]);
  });
});
