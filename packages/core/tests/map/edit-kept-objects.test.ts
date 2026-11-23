// Editing Kept objects and regions where they lie (ADR-0010): each edit rewrites only its own
// element of Objects or Regions, and every other byte stays as the Editor wrote it. The package is
// synthetic, written in the Editor's own form: CRLF lines, four-space indents, a doodad group.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_COMPILE_RECORD, writeCompileRecord } from "../../src/domain/compile-record.js";
import { bareHost } from "../../src/host/host.js";
import { editKeptObjects, type KeptEdit } from "../../src/map/edit-kept-objects.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { lockDefaults, lockFileFor } from "../../src/map/package-lock.js";
import { PackageOutput } from "../../src/map/package-output.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

const LAMP = `    <ObjectDoodad Id="101" Variation="2" Position="10,12,8" Rotation="0.7854" Scale="1,1,1" Type="StreetLamp">\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n    </ObjectDoodad>`;
const CRATE = `    <ObjectDoodad Id="102" Position="20,20,8" Rotation="0" Scale="1,1,1" Type="CargoCrate"/>`;
const BARREL = `    <ObjectDoodad Id="103" Variation="1" Position="30,30,8" Rotation="3.1416" Scale="0.9,0.9,0.9" Type="Barrel" TeamColor="12">\r\n        <Flag Index="ForcePlacement" Value="1"/>\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n    </ObjectDoodad>`;
const GUARD = `    <ObjectUnit Id="201" Position="40,40,0" Rotation="1.5708" Scale="1,1,1" UnitType="Marine" Player="2"/>`;
const POST = `    <ObjectPoint Id="301" Position="50,50,0" Scale="1,1,1" Type="Normal" Name="Guard Post" Color="0,0,0,0"/>`;
const OPENING = [
  `    <ObjectCamera Id="401" Position="60,60,0" Rotation="3.1416" Scale="1,1,1" Name="Opening" Color="0,0,0,0" CameraTarget="60,60">`,
  `        <CameraValue Index="Distance" Value="34"/>`,
  `        <CameraValue Index="Yaw" Value="180"/>`,
  `    </ObjectCamera>`,
].join("\r\n");
const GROUP = `    <Group Type="ObjectDoodad" Name="Doodad Group 001" Id="1">\r\n        <GroupObject Id="102"/>\r\n        <GroupObject Id="103"/>\r\n    </Group>`;
const OBJECTS = [`<?xml version="1.0" encoding="utf-8"?>`, `<PlacedObjects Version="27">`, LAMP, CRATE, BARREL, GUARD, POST, OPENING, GROUP, `</PlacedObjects>`, ``].join("\r\n");

const YARD = `    <region id="1">\r\n        <name value="Yard"/>\r\n        <color value="255,0,128,64"/>\r\n        <shape type="rect">\r\n            <quad value="10,10,20,30"/>\r\n        </shape>\r\n    </region>`;
const POND = `    <region id="2">\r\n        <name value="Pond"/>\r\n        <shape type="circle">\r\n            <center value="40,40"/>\r\n            <radius value="5"/>\r\n        </shape>\r\n    </region>`;
const REGIONS = [`<?xml version="1.0" encoding="utf-8"?>`, `<Regions>`, YARD, POND, `</Regions>`, ``].join("\r\n");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A Workspace with the Mission `yard`, imported: a Blueprint with no Zones and a package that is all Kept Content. */
async function setup() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-edit-kept-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const missionDir = path.join(workspaceRoot, "missions", "yard");
  const mapPackage = path.join(missionDir, "Yard.SC2Map");
  await mkdir(mapPackage, { recursive: true });
  await writeFile(path.join(mapPackage, "Objects"), OBJECTS);
  await writeFile(path.join(mapPackage, "Regions"), REGIONS);
  await writeFile(path.join(mapPackage, "MapInfo"), "map info");
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const blueprint = { id: "yard", campaignId: "fixtures", title: "Yard", setting: "Imported", mapSize: { width: 128, height: 128 }, tilesetId: "MonlythEx1", screenplay: { title: "Yard" } };
  await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));
  await writeFile(path.join(missionDir, "compile-record.json"), writeCompileRecord(EMPTY_COMPILE_RECORD));
  return { workspace: await loadWorkspace(workspaceRoot), blueprintPath, mapPackage };
}

async function edited(edits: readonly KeptEdit[]) {
  const { workspace, blueprintPath, mapPackage } = await setup();
  const result = await editKeptObjects(workspace, blueprintPath, edits);
  return { result, objects: await readFile(path.join(mapPackage, "Objects"), "utf8"), regions: await readFile(path.join(mapPackage, "Regions"), "utf8") };
}

describe("editKeptObjects on doodads", () => {
  it("moves one, keeping its height, and changes no other byte", async () => {
    const { objects, regions, result } = await edited([{ op: "move", object: 101, to: { x: 14, y: 16 } }]);
    expect(objects).toBe(OBJECTS.replace(LAMP, LAMP.replace('Position="10,12,8"', 'Position="14,16,8"')));
    expect(regions).toBe(REGIONS);
    expect(result.changed).toEqual(["doodad 101 (StreetLamp): moved to (14, 16, 8)"]);
  });

  it("says a doodad that kept its height on new ground may want a z", async () => {
    const { result, objects } = await edited([{ op: "move", object: 101, by: { x: 1, y: -2 } }]);
    expect(objects).toContain('Position="11,10,8"');
    expect(result.warnings).toEqual(["doodad 101 (StreetLamp) kept its height, 8 (HeightAbsolute): give z if the ground there is higher or lower"]);
    expect((await edited([{ op: "move", object: 101, to: { x: 1, y: 2, z: 9.5 } }])).result.warnings).toEqual([]);
  });

  it("rotates, tilts, scales, retints and swaps, each in its own attribute, added where the Editor puts it", async () => {
    const { objects } = await edited([
      { op: "rotate", object: 102, facing: 90 },
      { op: "tilt", object: 102, pitch: 10, roll: -5 },
      { op: "scale", object: 102, scale: [1.2, 1, 0.8] },
      { op: "tint", object: 102, tint: "255,128,0" },
      { op: "swap", object: 102, type: "CargoCrateLarge", variation: 3 },
    ]);
    expect(objects).toBe(
      OBJECTS.replace(CRATE, `    <ObjectDoodad Id="102" Variation="3" Position="20,20,8" Rotation="1.5708" Scale="1.2,1,0.8" Type="CargoCrateLarge" Pitch="0.1745" Roll="-0.0873" TintColor="255,128,0"/>`),
    );
    const cleared = await edited([{ op: "tint", object: 102, tint: null }, { op: "tilt", object: 103, pitch: 0 }]);
    expect(cleared.objects).toBe(OBJECTS);
  });

  it("adds a doodad after the last object, taking the height and flags of the one it's like, and removes one with its group line", async () => {
    const { objects, result } = await edited([
      { op: "add", type: "StreetLamp", at: { x: 70, y: 70 }, like: 101, facing: 180 },
      { op: "remove", object: 103 },
    ]);
    const added = /doodad (\d+) \(StreetLamp\): added at \(70, 70, 8\)/.exec(result.changed[0]!);
    expect(added).not.toBeNull();
    const lamp = `    <ObjectDoodad Id="${added![1]}" Position="70,70,8" Rotation="3.1416" Scale="1,1,1" Type="StreetLamp">\r\n        <Flag Index="HeightAbsolute" Value="1"/>\r\n    </ObjectDoodad>`;
    expect(objects).toBe(OBJECTS.replace(`${BARREL}\r\n`, "").replace(`${OPENING}\r\n`, `${OPENING}\r\n${lamp}\r\n`).replace(`        <GroupObject Id="103"/>\r\n`, ""));
    expect(result.changed[1]).toBe("doodad 103 (Barrel): removed");
  });

  it("needs a height for a doodad it adds", async () => {
    await expect(edited([{ op: "add", type: "StreetLamp", at: { x: 70, y: 70 } }])).rejects.toThrow("give at.z");
  });
});

describe("editKeptObjects on units, points and cameras", () => {
  it("moves and turns a unit, sets and clears its flags, leaving the rest", async () => {
    const { objects } = await edited([
      { op: "move", object: 201, to: { x: 41.5, y: 39 } },
      { op: "rotate", object: 201, facing: 0 },
      { op: "flags", object: 201, set: ["UnitHidden"] },
    ]);
    // A zero Rotation is left out, as the Editor writes it.
    const guard = `    <ObjectUnit Id="201" Position="41.5,39,0" Scale="1,1,1" UnitType="Marine" Player="2">\r\n        <Flag Index="UnitHidden" Value="1"/>\r\n    </ObjectUnit>`;
    expect(objects).toBe(OBJECTS.replace(GUARD, guard));
    const back = await edited([{ op: "flags", object: 103, clear: ["ForcePlacement", "HeightAbsolute"] }]);
    expect(back.objects).toBe(OBJECTS.replace(BARREL, `    <ObjectDoodad Id="103" Variation="1" Position="30,30,8" Rotation="3.1416" Scale="0.9,0.9,0.9" Type="Barrel" TeamColor="12"/>`));
  });

  it("renames and turns a point, adding the Rotation the Editor left out", async () => {
    const { objects } = await edited([{ op: "rename", object: 301, name: "Guard Post & Gate" }, { op: "rotate", object: 301, facing: 45 }]);
    expect(objects).toBe(OBJECTS.replace(POST, `    <ObjectPoint Id="301" Position="50,50,0" Rotation="0.7854" Scale="1,1,1" Type="Normal" Name="Guard Post &amp; Gate" Color="0,0,0,0"/>`));
  });

  it("moves a camera with its target, and turns its yaw with its rotation", async () => {
    const { objects } = await edited([{ op: "move", object: 401, by: { x: 2, y: 3 } }, { op: "rotate", object: 401, facing: 90 }]);
    expect(objects).toBe(
      OBJECTS.replace(OPENING, OPENING.replace('Position="60,60,0" Rotation="3.1416"', 'Position="62,63,0" Rotation="1.5708"').replace('CameraTarget="60,60"', 'CameraTarget="62,63"').replace('Index="Yaw" Value="180"', 'Index="Yaw" Value="90"')),
    );
  });

  it("writes a facing as the Editor's Rotation, in [0, 2π), and leaves a zero Variation out", async () => {
    const { objects } = await edited([{ op: "rotate", object: 401, facing: -90 }, { op: "rotate", object: 102, facing: 450 }, { op: "swap", object: 101, variation: 0 }]);
    expect(objects).toContain('<ObjectCamera Id="401" Position="60,60,0" Rotation="4.7124"');
    expect(objects).toContain('<CameraValue Index="Yaw" Value="270"/>');
    expect(objects).toContain('<ObjectDoodad Id="102" Position="20,20,8" Rotation="1.5708"');
    expect(objects).toContain('<ObjectDoodad Id="101" Position="10,12,8"');
  });

  it("refuses an Objects file cut short, writing nothing", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    const cut = OBJECTS.slice(0, OBJECTS.indexOf("</ObjectDoodad>"));
    await writeFile(path.join(mapPackage, "Objects"), cut);
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }])).rejects.toThrow("has no </ObjectDoodad>: the file looks cut short");
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(cut);
  });

  it("refuses an edit an object doesn't take: a unit has no name, a point no tint", async () => {
    await expect(edited([{ op: "rename", object: 201, name: "Guard" }])).rejects.toThrow("object 201 is a unit (a unit has no name in Objects");
    await expect(edited([{ op: "tint", object: 301, tint: "1,2,3" }])).rejects.toThrow("tint edits doodads, and object 301 is a point");
  });
});

describe("editKeptObjects on regions", () => {
  it("moves, resizes and redraws a region, each changing only its own lines", async () => {
    const moved = await edited([{ op: "move", region: 1, to: { x: 25, y: 25 } }]);
    expect(moved.regions).toBe(REGIONS.replace('<quad value="10,10,20,30"/>', '<quad value="20,15,30,35"/>'));
    expect(moved.objects).toBe(OBJECTS);
    expect(moved.result.changed).toEqual(["region 1 (Yard): moved by (10, 5), its centre now (25, 25)"]);

    const resized = await edited([{ op: "resize", region: 2, scale: 2 }, { op: "resize", region: 1, scale: { x: 2, y: 0.5 } }]);
    expect(resized.regions).toBe(REGIONS.replace('<radius value="5"/>', '<radius value="10"/>').replace('<quad value="10,10,20,30"/>', '<quad value="5,15,25,25"/>'));

    const redrawn = await edited([{ op: "redraw", region: 2, shapes: [{ type: "diamond", center: { x: 40, y: 40 }, width: 6, height: 4 }, { type: "rect", quad: [38, 38, 39, 39], negative: true }] }]);
    expect(redrawn.regions).toBe(
      REGIONS.replace(
        `        <shape type="circle">\r\n            <center value="40,40"/>\r\n            <radius value="5"/>\r\n        </shape>`,
        `        <shape type="diamond">\r\n            <center value="40,40"/>\r\n            <width value="6"/>\r\n            <height value="4"/>\r\n        </shape>\r\n        <shape type="rect">\r\n            <negative/>\r\n            <quad value="38,38,39,39"/>\r\n        </shape>`,
      ),
    );
  });
});

describe("two sessions writing one package", () => {
  /** Another live process (pid 1) holds the package's lock. */
  async function lockedByAnother(mapPackage: string) {
    const lock = await lockFileFor(mapPackage);
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: 1, startedAt: new Date().toISOString(), token: "other" }));
    return lock;
  }
  const original = { ...lockDefaults };
  afterEach(() => Object.assign(lockDefaults, original));

  it("refuses an edit while another process holds the package's lock, writing nothing", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    const lock = await lockedByAnother(mapPackage);
    Object.assign(lockDefaults, { waitMs: 50, pollMs: 10 });
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }])).rejects.toThrow(/Yard\.SC2Map is being written by process 1/);
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
    await rm(lock);
  });

  it("refuses a compile while another process holds the package's lock, writing nothing", async () => {
    const { mapPackage } = await setup();
    const lock = await lockedByAnother(mapPackage);
    Object.assign(lockDefaults, { waitMs: 50, pollMs: 10 });
    const output = new PackageOutput(mapPackage);
    output.write("Objects", "compiled");
    await expect(output.finish()).rejects.toThrow(/Yard\.SC2Map is being written by process 1/);
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
    await rm(lock);
    await output.finish();
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe("compiled");
  });

  it("frees the lock after an edit, so the next one runs", async () => {
    const { workspace, blueprintPath } = await setup();
    await editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }]);
    await editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }]);
  });
});

describe("editKeptObjects refusals", () => {
  it("names a Kept unit or region by its Kept Reference", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, kept: [{ id: "guard", kind: "unit", editorId: 201, name: "Guard" }, { id: "yard", kind: "region", editorId: 1, name: "Yard" }] }));
    await editKeptObjects(workspace, blueprintPath, [{ op: "move", object: "guard", by: { x: 1 } }, { op: "move", region: "yard", by: { y: 1 } }]);
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toContain('<ObjectUnit Id="201" Position="41,40,0"');
    expect(await readFile(path.join(mapPackage, "Regions"), "utf8")).toContain('<quad value="10,11,20,31"/>');
  });

  it("writes nothing when any edit is refused", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }, { op: "remove", object: 999 }])).rejects.toThrow(
      "Edit 2 (remove): the package has no object 999. Nothing was written",
    );
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
  });

  it("refuses while the Editor has the map open, writing nothing", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    const asked: string[] = [];
    const host = {
      ...bareHost(),
      has: (name: string) => name === "editor.checkClosed",
      run: (async (_name: string, request: { mapPath: string }) => {
        asked.push(request.mapPath);
        throw new Error("the Editor has Yard.SC2Map open; close it there without saving first");
      }) as unknown as ReturnType<typeof bareHost>["run"],
    };
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "move", object: 101, by: { x: 1 } }], { host })).rejects.toThrow(
      "Not edited: the Editor has Yard.SC2Map open; close it there without saving first",
    );
    expect(asked).toEqual([mapPackage]);
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
  });

  it("writes nothing, and isn't refused while the Editor has the map open, when the edits change nothing", async () => {
    const { workspace, blueprintPath, mapPackage } = await setup();
    const host = {
      ...bareHost(),
      has: (name: string) => name === "editor.checkClosed",
      run: (async () => {
        throw new Error("the Editor has Yard.SC2Map open; close it there without saving first");
      }) as unknown as ReturnType<typeof bareHost>["run"],
    };
    const result = await editKeptObjects(workspace, blueprintPath, [{ op: "tint", object: 102, tint: null }], { host });
    expect(result.files).toEqual([]);
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
  });

  it("refuses Compiled Content, naming the Blueprint field to change", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-edit-kept-"));
    const workspaceRoot = path.join(root, "workspace");
    await cp(CROSSING, workspaceRoot, { recursive: true });
    const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
    // A Beat's camera bounds, compiled as a bounds region.
    const raw = JSON.parse(await readFile(blueprintPath, "utf8"));
    raw.beats[0].camera = { bounds: ["landing_zone"] };
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    const workspace = await loadWorkspace(workspaceRoot);
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const objects = await readFile(path.join(outputDir, "Objects"), "utf8");
    const boundsRegion = Number(/<region id="(\d+)">\s*<name value="Bounds Landfall Camera"\/>/.exec(await readFile(path.join(outputDir, "Regions"), "utf8"))![1]);
    const crater = Number(/<ObjectDoodad Id="(\d+)" [^>]*Position="24,48,[^>]*Type="MeinhoffCraterLarge"/.exec(objects)![1]);
    const anchors = JSON.parse(await readFile(blueprintPath, "utf8")).anchors as { id: string }[];
    const index = anchors.findIndex((anchor) => anchor.id === "crater_1");

    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "move", object: crater, by: { x: 1 } }])).rejects.toThrow(
      `doodad ${crater} is Compiled Content (on the compile record): change anchors.${index} (crater_1)'s position in the Blueprint instead`,
    );
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "resize", region: 6, scale: 2 }])).rejects.toThrow(
      /region 6 is Compiled Content \(on the compile record\): change zones\.\d+ \([\w-]+\)'s region in the Blueprint instead/,
    );
    await expect(editKeptObjects(workspace, blueprintPath, [{ op: "resize", region: boundsRegion, scale: 2 }])).rejects.toThrow(
      `region ${boundsRegion} is Compiled Content (on the compile record): it is a bounds region of beats.0 (landfall): change its camera.bounds in the Blueprint instead`,
    );
    expect(await readFile(path.join(outputDir, "Objects"), "utf8")).toBe(objects);
  }, 30_000);
});

describe("the edit_kept_objects MCP tool", () => {
  it("edits the Mission's package and says what it changed", async () => {
    const { workspace, mapPackage } = await setup();
    const reply = await (await connect(workspace.root)).callTool({ name: "edit_kept_objects", arguments: { mission: "yard", edits: [{ op: "swap", object: 102, type: "CargoCrateLarge" }] } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ changed: ["doodad 102 (CargoCrate): now CargoCrateLarge"], warnings: [], files: ["Objects"] });
    expect(text(reply)).toContain("Wrote Objects in missions/yard/Yard.SC2Map");
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS.replace('Type="CargoCrate"', 'Type="CargoCrateLarge"'));
  });

  it("replies with the refusal, writing nothing", async () => {
    const { workspace, mapPackage } = await setup();
    const reply = await (await connect(workspace.root)).callTool({ name: "edit_kept_objects", arguments: { mission: "yard", edits: [{ op: "remove", object: 201 }] } });

    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("remove edits doodads, and object 201 is a unit");
    expect(await readFile(path.join(mapPackage, "Objects"), "utf8")).toBe(OBJECTS);
  });
});

