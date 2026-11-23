// The Workspace's doodad notes (@team-antioch/sc2-asset-catalog's doodad notes, and src/catalog/mod-doodad-notes.ts
// with a Campaign Mod): adding a Doodad Use or a look, and dropping the notes core's catalogs
// already hold, over synthetic catalogs.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { addDoodadNote, readDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { addModOrGameDoodadNote, type ModKnownDoodads } from "../../src/catalog/mod-doodad-notes.js";
import { MOD_DOODAD_INDEX_FILE } from "../../src/catalog/mod-doodad-index.js";

const KNOWN: ModKnownDoodads = {
  doodads: {
    FoundryStamperHead: {
      variations: 1,
      description: { look: "heavy steel press head on a piston", kind: "built", size: "medium", role: "prop", story: ["industry"], biome: ["urban"] },
      uses: [{ use: "press head", scale: 0.6 }],
    },
    FoundryPressFrame: { variations: 1 },
  },
  terrainObjects: {
    FoundryPressPit0: {
      package: "campaigns/liberty.sc2campaign",
      model: "Assets/TerrainObjects/FoundryPressPit/FoundryPressPit.m3",
      description: { look: "sunken pit under a press", kind: "built", story: ["industry"], biome: ["urban"] },
    },
  },
  mod: { ...EMPTY_CATALOG, doodads: new Map([["LanternPressRig", {}]]) },
};

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
const workspace = async (notes?: unknown): Promise<string> => {
  root = await mkdtemp(path.join(tmpdir(), "doodad-notes-"));
  if (notes !== undefined) await writeFile(path.join(root, "doodad-notes.json"), JSON.stringify(notes));
  return root;
};

describe("readDoodadNotes", () => {
  it("reads a use written as a plain phrase, from before uses were records, as a record", async () => {
    const at = await workspace({ doodads: { FoundryPressFrame: { uses: ["gantry over a conveyor", { use: "crane rail support", variation: 3 }] } } });
    expect(await readDoodadNotes(at)).toEqual({ FoundryPressFrame: { uses: [{ use: "gantry over a conveyor" }, { use: "crane rail support", variation: 3 }] } });
  });

  it("refuses a use record with a field it doesn't know, or a scale that isn't positive", async () => {
    await expect(readDoodadNotes(await workspace({ doodads: { FoundryPressFrame: { uses: [{ use: "gantry", mission: "x" }] } } }))).rejects.toThrow(/doodads\.FoundryPressFrame\.uses\.0/);
    await expect(readDoodadNotes(await workspace({ doodads: { FoundryPressFrame: { uses: [{ use: "gantry", scale: 0 }] } } }))).rejects.toThrow(/doodads\.FoundryPressFrame\.uses\.0/);
  });
});

describe("addDoodadNote", () => {
  it("adds a game doodad's note with no Campaign Mod, and refuses any other id", async () => {
    const at = await workspace();
    const { doodads, terrainObjects } = KNOWN;
    expect((await addDoodadNote(at, { id: "FoundryPressFrame", use: "gantry over a conveyor" }, { doodads, terrainObjects })).note).toEqual({ uses: [{ use: "gantry over a conveyor" }] });
    await expect(addDoodadNote(at, { id: "LanternPressRig", use: "lamp" }, { doodads, terrainObjects })).rejects.toThrow(/LanternPressRig isn't a game doodad or a terrain object/);
    expect(await readDoodadNotes(at)).toEqual({ FoundryPressFrame: { uses: [{ use: "gantry over a conveyor" }] } });
  });
});

describe("addModOrGameDoodadNote", () => {
  it("adds a Doodad Use or a look to a game doodad or a terrain object, creating the notes file", async () => {
    const at = await workspace();
    await addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "  gantry over a conveyor " }, KNOWN);
    await addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "gantry over a conveyor" }, KNOWN);
    const { note, file } = await addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "crane rail support" }, KNOWN);
    expect(note).toEqual({ uses: [{ use: "gantry over a conveyor" }, { use: "crane rail support" }] });
    expect(file).toBeUndefined();
    await addModOrGameDoodadNote(at, { id: "FoundryPressPit0", look: "sunken pit under a press, edged in hazard stripes" }, KNOWN);
    expect(await readDoodadNotes(at)).toEqual({
      FoundryPressFrame: { uses: [{ use: "gantry over a conveyor" }, { use: "crane rail support" }] },
      FoundryPressPit0: { look: "sunken pit under a press, edged in hazard stripes" },
    });
  });

  it("keeps a use's variation, scale and source, writes them as a record, and fills them into the same use added again", async () => {
    const at = await workspace({ doodads: { FoundryPressFrame: { uses: ["gantry over a conveyor"] } } });
    const { note } = await addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "Gantry over a  conveyor", variation: 2, scale: 1.5, from: "crushing-press search, 2026-11-09" }, KNOWN);
    expect(note).toEqual({ uses: [{ use: "gantry over a conveyor", variation: 2, scale: 1.5, from: "crushing-press search, 2026-11-09" }] });
    expect(JSON.parse(await readFile(path.join(at, "doodad-notes.json"), "utf8"))).toEqual({
      doodads: { FoundryPressFrame: { uses: [{ use: "gantry over a conveyor", variation: 2, scale: 1.5, from: "crushing-press search, 2026-11-09" }] } },
    });
  });

  it("keeps a use core has when it gives a variation or scale core's lacks, and drops it once core has them", async () => {
    const at = await workspace();
    const { note, dropped } = await addModOrGameDoodadNote(at, { id: "FoundryStamperHead", use: "Press head", variation: 2 }, KNOWN);
    expect(note).toEqual({ uses: [{ use: "Press head", variation: 2 }] });
    expect(dropped).toEqual([]);
    const merged = { ...KNOWN, doodads: { ...KNOWN.doodads, FoundryStamperHead: { ...KNOWN.doodads.FoundryStamperHead!, uses: [{ use: "press head", variation: 2, scale: 0.6 }] } } };
    expect((await addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "gantry" }, merged)).dropped).toEqual(["FoundryStamperHead: use “Press head”"]);
  });

  it("refuses a variation, scale or source without a use, and a variation or scale out of range", async () => {
    const at = await workspace();
    await expect(addModOrGameDoodadNote(at, { id: "FoundryPressFrame", look: "a frame", variation: 1 }, KNOWN)).rejects.toThrow(/variation, a scale or a source goes with a use/);
    await expect(addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "frame", variation: 1.5 }, KNOWN)).rejects.toThrow(/variation/);
    await expect(addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "frame", scale: -2 }, KNOWN)).rejects.toThrow(/scale/);
    expect(await readDoodadNotes(at)).toEqual({});
  });

  it("writes a Campaign Mod doodad's Use and look into its entry in the mod's doodad index, never the Workspace's notes", async () => {
    const at = await workspace();
    const modDir = path.join(at, "mods", "lantern");
    await mkdir(modDir, { recursive: true });
    const index = path.join(modDir, MOD_DOODAD_INDEX_FILE);
    const rig = { look: "chain-hung lamp frame", kind: "built", size: "large", role: "structure", story: ["industry"], biome: ["urban"], uses: ["hanging lamp rig"] };
    await writeFile(index, JSON.stringify({ LanternPressRig: { model: "Assets/Doodads/Rig/Rig.m3", described: "agent", description: rig }, LanternCrate: { model: "Assets/Doodads/Crate/Crate.m3" } }));
    const known = { ...KNOWN, mod: { ...KNOWN.mod, modDir, doodads: new Map([["LanternPressRig", {}], ["LanternCrate", {}]]) } };

    const added = await addModOrGameDoodadNote(at, { id: "LanternPressRig", use: "gantry lamp over a press", scale: 0.8, look: "chain-hung lamp frame, rusted" }, known);
    const uses = [{ use: "hanging lamp rig" }, { use: "gantry lamp over a press", scale: 0.8 }];
    expect(added).toEqual({ note: { uses, look: "chain-hung lamp frame, rusted" }, dropped: [], file: index });
    expect(JSON.parse(await readFile(index, "utf8")).LanternPressRig).toEqual({
      model: "Assets/Doodads/Rig/Rig.m3",
      description: { ...rig, look: "chain-hung lamp frame, rusted", uses },
      described: "agent",
    });
    expect(await readDoodadNotes(at)).toEqual({});

    // One the index hasn't described yet has nowhere to keep it.
    await expect(addModOrGameDoodadNote(at, { id: "LanternCrate", use: "crate" }, known)).rejects.toThrow(/LanternCrate is a Campaign Mod doodad its doodad index .* doesn't describe yet: run index-mod-doodads, then describe it/);
    await expect(addModOrGameDoodadNote(at, { id: "LanternPressRig", use: "x" }, KNOWN)).rejects.toThrow(/no folder to keep its doodad index in/);
  });

  it("refuses an unknown doodad, and a note with neither a use nor a look", async () => {
    const at = await workspace();
    await expect(addModOrGameDoodadNote(at, { id: "NoSuchDoodad", use: "anything" }, KNOWN)).rejects.toThrow(/NoSuchDoodad isn't a game doodad, a terrain object or a Campaign Mod doodad/);
    await expect(addModOrGameDoodadNote(at, { id: "FoundryPressFrame", use: "  " }, KNOWN)).rejects.toThrow(/a use or a look/);
    expect(await readDoodadNotes(at)).toEqual({});
  });

  it("drops the notes core already holds: a use core's file lists (case and spacing aside), a look core has, and an entry left empty", async () => {
    const at = await workspace({
      doodads: {
        FoundryStamperHead: { uses: ["Press  Head", "stamping die"], look: "heavy steel press head on a piston" },
        FoundryPressPit0: { look: "sunken pit under a press" },
        LanternPressRig: { uses: ["press head"] },
      },
    });
    const { note, dropped } = await addModOrGameDoodadNote(at, { id: "FoundryStamperHead", use: "press head" }, KNOWN);
    expect(note).toEqual({ uses: [{ use: "stamping die" }] });
    expect(dropped).toEqual(["FoundryStamperHead: use “Press  Head”", "FoundryStamperHead: look", "FoundryPressPit0: look"]);
    // A Campaign Mod doodad's notes never go to core, so they stay.
    const left = { FoundryStamperHead: { uses: [{ use: "stamping die" }] }, LanternPressRig: { uses: [{ use: "press head" }] } };
    expect(await readDoodadNotes(at)).toEqual(left);
    expect(JSON.parse(await readFile(path.join(at, "doodad-notes.json"), "utf8"))).toEqual({ doodads: left });
  });
});
