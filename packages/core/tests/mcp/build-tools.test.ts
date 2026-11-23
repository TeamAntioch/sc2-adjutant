// Seam 1 (#96) for the remaining build tools: generate_terrain, sync, compile_cutscene,
// capture_composite, freeze_set_piece and import_set, through the server against a copy of the `dressed`
// fixture Workspace (Mission `yard`: a point Anchor and a `bench` set piece of three kerbs).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, tempFolder, text } from "./harness.js";

const mapOf = (root: string) => path.join(root, "missions", "yard", "Yard.SC2Map");
const blueprintOf = async (root: string) => JSON.parse(await readFile(path.join(root, "missions", "yard", "blueprint.json"), "utf8"));

/** A copy of the Workspace with `yard` compiled to its default Map Package, as the author would open it in the Editor. */
async function compiled() {
  const root = await copyOf("dressed");
  const client = await connect(root);
  const reply = await client.callTool({ name: "compile_map", arguments: { mission: "yard" } });
  expect(reply.isError, text(reply)).toBeFalsy();
  return { root, client };
}

describe("generate_terrain", () => {
  it("writes the terrain alone, beside the Mission's compiled package by default", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const reply = await client.callTool({ name: "generate_terrain", arguments: { mission: "yard" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    const outputDir = path.join(root, "missions", "yard", "output", "yard-terrain.SC2Map");
    expect(reply.structuredContent).toEqual({ outputDir, warnings: [] });
    expect(text(reply)).toMatch(new RegExp(`^Terrain of Yard generated in ${outputDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\nNext \\(Stage 1\\)`));
    expect(existsSync(path.join(outputDir, "ComponentList.SC2Components"))).toBe(true);
    expect(existsSync(path.join(outputDir, "t3HeightMap"))).toBe(true);
    expect(existsSync(path.join(outputDir, "Objects"))).toBe(false);
    expect(existsSync(path.join(root, "missions", "yard", "output", ".gitignore"))).toBe(true);
  });

  it("writes to a given folder inside the Workspace, and refuses one outside it", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const reply = await client.callTool({ name: "generate_terrain", arguments: { mission: "yard", outputDir: "build/yard.SC2Map" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(existsSync(path.join(root, "build", "yard.SC2Map", "ComponentList.SC2Components"))).toBe(true);
    const outside = await client.callTool({ name: "generate_terrain", arguments: { mission: "yard", outputDir: "../elsewhere.SC2Map" } });
    expect(outside.isError).toBe(true);
    expect(text(outside)).toContain("must be a folder inside the Workspace");
  });
});

describe("sync", () => {
  it("reports no changes on a package as compiled, and leaves the Blueprint alone", async () => {
    const { root, client } = await compiled();
    const before = await readFile(path.join(root, "missions", "yard", "blueprint.json"), "utf8");
    const reply = await client.callTool({ name: "sync", arguments: { mission: "yard" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/^No changes in .*Yard\.SC2Map\nNext \(Stage 1\)/);
    expect(reply.structuredContent).toEqual({ saved: false, changes: [], notes: [], issues: [] });
    expect(await readFile(path.join(root, "missions", "yard", "blueprint.json"), "utf8")).toBe(before);
  });

  it("syncs a point the author moved in the Editor into the Blueprint", async () => {
    const { root, client } = await compiled();
    const objects = path.join(mapOf(root), "Objects");
    const xml = await readFile(objects, "utf8");
    const moved = xml.replace(/(<ObjectPoint [^>]*Position=")8(?:\.0+)?,8(?:\.0+)?/, "$110,12");
    expect(moved).not.toBe(xml);
    await writeFile(objects, moved);

    const reply = await client.callTool({ name: "sync", arguments: { mission: "yard" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toContain("Units, points and cameras changed (1): start");
    expect(reply.structuredContent).toMatchObject({ saved: true, changes: [{ label: "Units, points and cameras changed", ids: ["start"] }] });
    const start = (await blueprintOf(root)).anchors.find((anchor: { id: string }) => anchor.id === "start");
    expect(start.position).toMatchObject({ x: 10, y: 12 });
  });

  it("copies the skills of a Utility listed since the session started, as the SessionStart hook does", async () => {
    const { root, client } = await compiled();
    const utility = path.join(root, "utilities", "sketcher");
    await mkdir(path.join(utility, "skills", "sketch"), { recursive: true });
    await writeFile(path.join(utility, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "sketcher", version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills: ["skills/sketch"] } }));
    await writeFile(path.join(utility, "skills", "sketch", "SKILL.md"), "---\nname: sketch\ndescription: Sketches. Use when asked to.\n---\n\nRun {{PLUGIN_FOLDER}}/sketch.py.\n");
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, "utf8")), utilities: ["./utilities/sketcher"] }));

    const reply = await client.callTool({ name: "sync", arguments: { mission: "yard" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toContain("Copied the Plugins' skills into .claude/skills: sketcher-sketch");
    expect(await readFile(path.join(root, ".claude", "skills", "sketcher-sketch", "SKILL.md"), "utf8")).toContain(`Run ${utility.split(path.sep).join("/")}/sketch.py.`);
    expect(existsSync(path.join(root, ".claude", "skills", "sketcher-sketch", ".sc2-adjutant-skill.json"))).toBe(true);
    // A second sync finds the copy as it is, and says nothing of it.
    expect(text(await client.callTool({ name: "sync", arguments: { mission: "yard" } }))).not.toContain(".claude/skills");
  });

  it("names compile_map when the Mission has no compiled package", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const reply = await client.callTool({ name: "sync", arguments: { mission: "yard" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/No Map Package at .*Yard\.SC2Map.*compile_map/);
  });
});

describe("capture_composite", () => {
  it("captures the doodads in a region of the saved map as a recipe in the Blueprint", async () => {
    const { root, client } = await compiled();
    const reply = await client.callTool({ name: "capture_composite", arguments: { mission: "yard", region: "Yard", id: "kerbs", kind: "detail", style: "built", scale: [0.9, 1.1] } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/^Captured 3 doodads as detail composite kerbs in .*blueprint\.json: Korhal_Curbs\n/);
    expect(reply.structuredContent).toEqual({ saved: true, composite: { id: "kerbs", kind: "detail", members: 3, types: ["Korhal_Curbs"] }, notes: [], issues: [] });
    const [composite] = (await blueprintOf(root)).composites;
    expect(composite).toMatchObject({ id: "kerbs", kind: "detail", style: "built", scale: [0.9, 1.1] });
    expect(composite.members).toHaveLength(3);
  });

  it("refuses a region the map doesn't have", async () => {
    const { client } = await compiled();
    const reply = await client.callTool({ name: "capture_composite", arguments: { mission: "yard", region: "Nowhere" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/No region named "Nowhere" in .*Yard\.SC2Map/);
  });
});

describe("freeze_set_piece", () => {
  it("writes a set piece's doodads into the Blueprint as anchors and removes the placement", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const reply = await client.callTool({ name: "freeze_set_piece", arguments: { mission: "yard", setPiece: "bench" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(text(reply)).toMatch(/^Froze bench into 3 doodad anchors in .*blueprint\.json\.\nNext \(Stage 1\)/);
    expect(reply.structuredContent).toEqual({ saved: true, frozen: 3, notes: [], issues: [] });
    const blueprint = await blueprintOf(root);
    expect(blueprint.placements).toEqual([]);
    expect(blueprint.anchors.map((anchor: { id: string }) => anchor.id)).toEqual(["start", "bench-1", "bench-2", "bench-3"]);
    const check = await client.callTool({ name: "get_blueprint", arguments: { mission: "yard" } });
    expect(check.structuredContent).toMatchObject({ issues: [] });
  });

  it("refuses a set piece the Blueprint doesn't have", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const reply = await client.callTool({ name: "freeze_set_piece", arguments: { mission: "yard", setPiece: "nope" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("No set piece nope");
  });
});

describe("compile_cutscene", () => {
  const shots = { origin: [20, 30, 0], shots: [{ name: "Wide", durationMs: 2000, from: { target: [16, 32, 1], distance: 20, pitch: 30, yaw: 180, fov: 40 } }] };

  it("writes a shot list into the Mission's compiled package, set to play from map start", async () => {
    const { root, client } = await compiled();
    await writeFile(path.join(root, "missions", "yard", "intro.json"), JSON.stringify(shots));
    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "yard", shotList: "missions/yard/intro.json", play: true } });
    expect(reply.isError, text(reply)).toBeFalsy();
    const file = path.join(mapOf(root), "Base.SC2Data", "Cutscenes", "intro.SC2Cutscene");
    expect(text(reply)).toMatch(/^1 shots written to .*intro\.SC2Cutscene\nPlays from map start at 20, 30\n/);
    expect(reply.structuredContent).toMatchObject({ file, shots: 1, playsFrom: [20, 30], automated: [] });
    // With no Host Adapter to run Test Document, the test run is handed to the author.
    const { steps } = reply.structuredContent as { steps: string[] };
    expect(steps[0]).toContain(`choose ${path.join(mapOf(root), "ComponentList.SC2Components")}`);
    expect(text(reply)).toContain("Over to the author:\n1. Open the Map Package");
    expect(await readFile(file, "utf8")).toContain("Wide");
    expect(await readFile(path.join(mapOf(root), "MapScript.galaxy"), "utf8")).toContain("ShotCutscene_Init");
    expect(await readFile(path.join(mapOf(root), "ComponentList.SC2Components"), "utf8")).toContain('Type="cuts"');
  });

  it("takes a name, and refuses a shot list outside the Workspace", async () => {
    const { root, client } = await compiled();
    await writeFile(path.join(root, "missions", "yard", "intro.json"), JSON.stringify(shots));
    const named = await client.callTool({ name: "compile_cutscene", arguments: { mission: "yard", shotList: "missions/yard/intro.json", name: "opening" } });
    expect(named.structuredContent).toEqual({ file: path.join(mapOf(root), "Base.SC2Data", "Cutscenes", "opening.SC2Cutscene"), shots: 1 });
    // A malformed shot list is refused with each problem's path before anything is written.
    await writeFile(path.join(root, "missions", "yard", "bad.json"), JSON.stringify({ shots: [{ name: "Wide", durationMs: 2000, from: { target: [1, 2] } }] }));
    const bad = await client.callTool({ name: "compile_cutscene", arguments: { mission: "yard", shotList: "missions/yard/bad.json" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("isn't a shot list: shots.0.from.target");
    expect(existsSync(path.join(mapOf(root), "Base.SC2Data", "Cutscenes", "bad.SC2Cutscene"))).toBe(false);
    const outside = await client.callTool({ name: "compile_cutscene", arguments: { mission: "yard", shotList: "../intro.json" } });
    expect(outside.isError).toBe(true);
    expect(text(outside)).toContain("must be inside the Workspace");
  });
});

describe("import_set", () => {
  /** A folder of Blizzard-kind cutscenes holding one set, a dock of three pieces with a camera on it. */
  async function dockSource(): Promise<string> {
    const dir = await tempFolder();
    const actor = (model: string, at: string) => `<CCutsceneNodeActor guid="${model}" name="${model}" position="${at}" modelLink="${model}"/>`;
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<CutsceneState cutsceneVersion="1.3"><CCutsceneNodeFolder name="Set"><CCutsceneNodeFolder name="Dock">',
      actor("DockCrane", "1,0,0") + actor("DockCrate", "0,1,0") + actor("DockPier", "0,0,0"),
      '</CCutsceneNodeFolder></CCutsceneNodeFolder>',
      '<CCutsceneNodeCamera guid="9" name="Pier Wide" position="0,0,1" fov="30" verticalFOV="1" distance="8" pitch="10" yaw="180"/>',
      "</CutsceneState>",
    ].join("\n");
    await mkdir(path.join(dir, "Cutscenes"));
    await writeFile(path.join(dir, "Cutscenes", "Dock.SC2Cutscene"), xml);
    return dir;
  }

  it("writes the set into the Mission's sets folder, by its catalog id", async () => {
    const root = await copyOf("dressed");
    const client = await connect(root);
    const dir = await dockSource();
    const reply = await client.callTool({ name: "import_set", arguments: { mission: "yard", set: "Dock", sources: [{ kind: "blizzard", dir }] } });
    expect(reply.isError, text(reply)).toBeFalsy();
    const file = path.join(root, "missions", "yard", "sets", "dock.json");
    expect(reply.structuredContent).toMatchObject({ file, pieces: 3, marks: 0, cameras: 1, lamps: 0, source: "blizzard:Cutscenes/Dock.SC2Cutscene" });
    expect(text(reply)).toContain(`Imported Dock (3 pieces, 0 marks, 1 camera, 0 lamps) from blizzard:Cutscenes/Dock.SC2Cutscene to ${file}`);
    const set = JSON.parse(await readFile(file, "utf8"));
    expect(set.cameras).toEqual([{ name: "Pier Wide", target: [0, 0, 1], distance: 8, pitch: 10, yaw: 180, fov: 30 }]);
  });

  it("asks for a Mission or a mod when given neither, and for one of them when given both", async () => {
    const client = await connect(await copyOf("dressed"));
    const sources = [{ kind: "blizzard", dir: await dockSource() }];
    const neither = await client.callTool({ name: "import_set", arguments: { set: "Dock", sources } });
    expect(neither.isError).toBe(true);
    expect(text(neither)).toContain("Give a mission or a mod to import the set into");
    expect(text(neither)).not.toContain("not both");
    const both = await client.callTool({ name: "import_set", arguments: { mission: "yard", mod: "yard-mod", set: "Dock", sources } });
    expect(both.isError).toBe(true);
    expect(text(both)).toContain("Give a mission or a mod to import the set into, not both");
  });

  it("refuses a source kind the Workspace doesn't know", async () => {
    const client = await connect(await copyOf("dressed"));
    const reply = await client.callTool({ name: "import_set", arguments: { mission: "yard", set: "Dock", sources: [{ kind: "studio", dir: await dockSource() }] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("No cutscene source kind studio; the Workspace knows blizzard");
  });
});

describe("compile_map after the author changed Compiled Content in the Editor", () => {
  it("stops, listing the change, then keeps or discards it as asked", async () => {
    const { root, client } = await compiled();
    const objects = path.join(mapOf(root), "Objects");
    const xml = await readFile(objects, "utf8");
    // The point given a flag sync doesn't bring back.
    const flagged = xml.replace(/(<ObjectPoint [^>]*?)\/>/, '$1>\n    <Flag Index="Disabled"/>\n  </ObjectPoint>');
    expect(flagged).not.toBe(xml);
    await writeFile(objects, flagged);

    const stopped = await client.callTool({ name: "compile_map", arguments: { mission: "yard" } });
    expect(stopped.isError).toBe(true);
    const entry = /(object:\d+) \(point, anchors\.\d+ start\): changed in the Editor/.exec(text(stopped))?.[1];
    expect(entry, text(stopped)).toBeDefined();
    expect(await readFile(objects, "utf8")).toBe(flagged);

    const discarded = await client.callTool({ name: "compile_map", arguments: { mission: "yard", discard: [entry] } });
    expect(discarded.isError, text(discarded)).toBeFalsy();
    expect(await readFile(objects, "utf8")).toBe(xml);

    await writeFile(objects, flagged);
    const kept = await client.callTool({ name: "compile_map", arguments: { mission: "yard", keepAll: true } });
    expect(kept.isError, text(kept)).toBeFalsy();
    expect(await readFile(objects, "utf8")).toBe(flagged);
    expect(text(kept)).toMatch(/anchors\.\d+ \(start\) is declared, but its object \d+ was kept/);
  });
});
