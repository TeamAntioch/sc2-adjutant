// A compile asks before overwriting Compiled Content the author changed in the Editor (ADR-0010):
// each compile record entry's fingerprint is compared with the package. What sync brings back is
// left to sync; anything else stops the compile, writing nothing, until the author keeps it (it
// leaves the record, Kept Content) or discards it (overwritten). Synthetic: the Ashen Crossing
// fixture compiled in place, then edited as the Editor would.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { editorChanges } from "../../src/map/editor-changes.js";
import { spliceMapScript } from "../../src/triggers/splice-map-script.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { readMapInfoFields } from "../../src/map/read-map-info-fields.js";
import { withFog } from "../support/map-info-fog.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const ROCK = stableObjectId("overhang_rock_w");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Mission = { readonly workspace: Workspace; readonly missionDir: string; readonly mapDir: string; readonly blueprintPath: string };

/** The Ashen Crossing Mission compiled once in place, so its package has a compile record. */
async function compiled(): Promise<Mission> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-editor-changes-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  const missionDir = path.join(workspaceRoot, "missions", "ashen-crossing");
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
  return { workspace, missionDir, mapDir: outputDir, blueprintPath };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
  }
  return out;
}

/** Edits `file` in the package as the Editor would save it. */
async function edit(mapDir: string, file: string, change: (text: string) => string): Promise<void> {
  const full = path.join(mapDir, file);
  const before = await readFile(full, "utf8");
  const after = change(before);
  expect(after).not.toBe(before);
  await writeFile(full, after);
}

/** The Objects element of `id`, from its opening tag to its end. */
const objectElement = (objects: string, id: number): string => new RegExp(`<Object\\w+ Id="${id}"[^>]*?(?:/>|>[\\s\\S]*?</Object\\w+>)`).exec(objects)![0];

/** The rock given a team colour: a change sync can't bring back into the Blueprint. */
const recolour = (mapDir: string) => edit(mapDir, "Objects", (objects) => objects.replace(new RegExp(`(<ObjectDoodad Id="${ROCK}"[^>]*?)(/?>)`), `$1 TeamColor="2"$2`));

async function record(missionDir: string) {
  return parseCompileRecord(await readFile(path.join(missionDir, "compile-record.json"), "utf8"));
}

describe("a Compiled object changed in the Editor", () => {
  it("stops the compile, listing it, and nothing is written", async () => {
    const mission = await compiled();
    await recolour(mission.mapDir);
    const before = await tree(mission.missionDir);

    const error = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt }).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toMatch(new RegExp(`object:${ROCK} \\(doodad, anchors\\.\\d+ overhang_rock_w\\): changed in the Editor`));
    expect(error?.message).toMatch(/--keep <entry> or --discard <entry>/);
    expect(error?.message).not.toMatch(/sync/);
    expect(await tree(mission.missionDir)).toEqual(before);
  }, 60_000);

  it("is left as changed when kept, and drops off the record; the next compile doesn't ask again", async () => {
    const mission = await compiled();
    await recolour(mission.mapDir);
    const changed = objectElement(await readFile(path.join(mission.mapDir, "Objects"), "utf8"), ROCK);

    const { warnings } = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: [`object:${ROCK}`] } });

    expect(objectElement(await readFile(path.join(mission.mapDir, "Objects"), "utf8"), ROCK)).toBe(changed);
    const kept = await record(mission.missionDir);
    expect(kept.entries.some((entry) => entry.kind === "object" && entry.id === ROCK)).toBe(false);
    expect(kept.kept).toEqual([{ kind: "object", id: ROCK }]);
    expect(warnings).toContainEqual(expect.stringMatching(/anchors\.\d+ \(overhang_rock_w\) is declared, but its object .* was kept/));

    const once = await tree(mission.missionDir);
    const again = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await tree(mission.missionDir)).toEqual(once);
    expect(again.warnings).toContainEqual(expect.stringMatching(/overhang_rock_w\) is declared, but its object/));
  }, 90_000);

  it("is restored to what the Blueprint says when discarded", async () => {
    const mission = await compiled();
    const original = await tree(mission.missionDir);
    await recolour(mission.mapDir);

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { discard: [`object:${ROCK}`] } });

    expect(await tree(mission.missionDir)).toEqual(original);
  }, 60_000);

  it("is overwritten with --discard-all, and kept with --keep-all", async () => {
    const mission = await compiled();
    const original = await tree(mission.missionDir);
    await recolour(mission.mapDir);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { discard: "all" } });
    expect(await tree(mission.missionDir)).toEqual(original);

    await recolour(mission.mapDir);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: "all" } });
    expect((await record(mission.missionDir)).kept).toEqual([{ kind: "object", id: ROCK }]);
  }, 90_000);
});

describe("a change sync can bring back", () => {
  it("is reported as needing sync, not as a keep-or-discard choice", async () => {
    const mission = await compiled();
    // The rock moved in the Editor, and sync not run since.
    await edit(mission.mapDir, "Objects", (objects) => objects.replace(new RegExp(`(<ObjectDoodad Id="${ROCK}"[^>]*? Position=")41,24,`), "$144,26,"));
    const before = await tree(mission.missionDir);

    const error = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt }).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toMatch(/Run sync first/);
    expect(error?.message).toMatch(new RegExp(`sync brings back: object:${ROCK} \\(doodad, anchors\\.\\d+ overhang_rock_w\\)`));
    expect(error?.message).not.toMatch(/--keep <entry>/);
    expect(await tree(mission.missionDir)).toEqual(before);

    // Once synced, the compile goes ahead.
    await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  }, 90_000);
});

/**
 * The Objects file as an Editor save rewrites every doodad, changing nothing it says (seen on an
 * Editor-saved map, 2026-11-10): attributes in its own order, `Variation="0"` and `Rotation="0"` left
 * out, a scale's last digit dropped, a `HeightAbsolute` flag added and the flags reordered, all
 * indented its own way.
 */
function editorResave(objects: string): string {
  return objects.replace(/<ObjectDoodad\s([^>]*?)(?:\/>|>([\s\S]*?)<\/ObjectDoodad>)/g, (_, source: string, body: string | undefined) => {
    const attrs = Object.fromEntries([...source.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
    if (attrs.Variation === "0") delete attrs.Variation;
    if (attrs.Rotation === "0") delete attrs.Rotation;
    if (attrs.Scale) attrs.Scale = attrs.Scale.split(",").map((part) => (/\.\d{4}$/.test(part) ? part.slice(0, -1) : part)).join(",");
    const order = ["Id", "Variation", "Position", "Rotation", "Scale", "Type"];
    const names = [...order.filter((name) => name in attrs), ...Object.keys(attrs).filter((name) => !order.includes(name))];
    const flags = [...(body ?? "").matchAll(/<Flag Index="(\w+)" Value="1"\/>/g)].map((match) => match[1]!);
    const saved = [...new Set(["HeightAbsolute", ...flags.reverse()])];
    return [`<ObjectDoodad ${names.map((name) => `${name}="${attrs[name]}"`).join(" ")}>`, ...saved.map((flag) => `        <Flag Index="${flag}" Value="1"/>`), "    </ObjectDoodad>"].join("\n");
  });
}

describe("an Editor save that changes nothing an object says", () => {
  it("isn't a change: the compile goes ahead", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, "Objects", editorResave);

    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  }, 60_000);

  it("still shows the one doodad the author moved, and only it", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, "Objects", (objects) => editorResave(objects).replace(new RegExp(`(<ObjectDoodad Id="${ROCK}"[^>]*? Position=")41,24,`), "$144,26,"));

    const error = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt }).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toMatch(new RegExp(`sync brings back: object:${ROCK} \\(doodad, anchors\\.\\d+ overhang_rock_w\\)$`, "m"));
    expect(error?.message.match(/object:\d+/g)).toEqual([`object:${ROCK}`]);
  }, 60_000);

  it("still shows a doodad turned, retyped or flagged", async () => {
    const mission = await compiled();
    const rock = (change: (element: string) => string) => (objects: string) => objects.replace(objectElement(objects, ROCK), change);
    for (const change of [
      (element: string) => element.replace(/ Rotation="[^"]*"/, ' Rotation="1.2"'),
      (element: string) => element.replace(/ Type="[^"]*"/, ' Type="SomethingElse"'),
      (element: string) => element.replace("</ObjectDoodad>", '<Flag Index="NoDoodadFootprint" Value="1"/>\n    </ObjectDoodad>'),
    ]) {
      await edit(mission.mapDir, "Objects", (objects) => rock(change)(editorResave(objects)));
      await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow(new RegExp(`object:${ROCK}`));
      await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { discard: "all" } });
    }
  }, 120_000);
});

describe("a Compiled trigger changed in the Editor", () => {
  it("is asked about, and when kept stays in Triggers and MapScript.galaxy as the Editor left it", async () => {
    const mission = await compiled();
    const { entries } = await record(mission.missionDir);
    const trigger = entries.find((entry) => entry.kind === "trigger")!;
    if (trigger.kind !== "trigger") throw new Error("no trigger");
    // Turned off in the Trigger Editor.
    const disabled = new RegExp(`<Element Type="Trigger" Id="${trigger.id}">\\r?\\n        <Disabled/>\\r?\\n`);
    await edit(mission.mapDir, "Triggers", (triggers) => triggers.replace(new RegExp(`(<Element Type="Trigger" Id="${trigger.id}">)(\\r?\\n)`), "$1$2        <Disabled/>$2"));

    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow(new RegExp(`trigger:${trigger.id} \\(.*\\): changed in the Editor`));

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: [`trigger:${trigger.id}`] } });
    const triggers = await readFile(path.join(mission.mapDir, "Triggers"), "utf8");
    expect(triggers).toMatch(disabled);
    expect(triggers.split(`<Element Type="Trigger" Id="${trigger.id}">`).length).toBe(2);
    const after = await record(mission.missionDir);
    expect(after.kept).toEqual([{ kind: "trigger", id: trigger.id }]);
    expect(after.entries.some((entry) => entry.kind === "trigger" && entry.id === trigger.id)).toBe(false);

    const once = await tree(mission.missionDir);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await tree(mission.missionDir)).toEqual(once);

    // Discarded by name, it is the Blueprint's again: written as the first compile wrote it.
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { discard: [`trigger:${trigger.id}`] } });
    expect(await readFile(path.join(mission.mapDir, "Triggers"), "utf8")).not.toMatch(disabled);
    expect((await record(mission.missionDir)).kept).toBeUndefined();
    expect((await record(mission.missionDir)).entries.some((entry) => entry.kind === "trigger" && entry.id === trigger.id)).toBe(true);
  }, 90_000);
});

describe("sync in a Mission's own package", () => {
  const PLACED = 987654321;

  it("adopts a doodad the author placed on ground the compile writes, as an Anchor at its own Editor Id", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, "Objects", (objects) =>
      objects.replace("</PlacedObjects>", `    <ObjectDoodad Id="${PLACED}" Position="30,30,8" Rotation="0" Scale="1,1,1" Type="RockGiant"/>\n</PlacedObjects>`),
    );

    const result = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    const adopted = result.changes.find((change) => change.label.includes("adopted as Anchors"));
    expect(adopted?.ids).toHaveLength(1);
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8")) as { anchors: { id: string; editorId?: number; doodadType?: string }[] };
    expect(blueprint.anchors.find((anchor) => anchor.id === adopted!.ids[0])).toMatchObject({ editorId: PLACED, doodadType: "RockGiant" });

    // The compile takes the object over where it stands: one object at that Id, now on the record.
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const objects = await readFile(path.join(mission.mapDir, "Objects"), "utf8");
    expect(objects.match(new RegExp(`Id="${PLACED}"`, "g"))).toHaveLength(1);
    expect((await record(mission.missionDir)).entries).toContainEqual(expect.objectContaining({ kind: "object", id: PLACED }));
    expect((await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir)).changes).toEqual([]);
  }, 90_000);

  it("brings back a doodad Anchor's Editor flags, so the compile writes them", async () => {
    const mission = await compiled();
    // Raised in the Editor: a HeightOffset flag, and the HeightAbsolute every save adds.
    const raised = (element: string) =>
      element.endsWith("/>")
        ? element.replace(/\s*\/>$/, '>\n        <Flag Index="HeightOffset" Value="1"/>\n        <Flag Index="HeightAbsolute" Value="1"/>\n    </ObjectDoodad>')
        : element.replace("</ObjectDoodad>", '    <Flag Index="HeightOffset" Value="1"/>\n</ObjectDoodad>');
    await edit(mission.mapDir, "Objects", (objects) => objects.replace(objectElement(objects, ROCK), raised));

    const result = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    expect(result.changes).toContainEqual({ label: "Doodad anchors changed", ids: ["overhang_rock_w"] });
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8")) as { anchors: { id: string; flags?: string[] }[] };
    expect(blueprint.anchors.find((anchor) => anchor.id === "overhang_rock_w")!.flags).toEqual(["HeightOffset"]);
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  }, 90_000);

  it("brings a compiled doodad the Blueprint no longer makes back at its own Id, so the compile doesn't write it twice", async () => {
    const mission = await compiled();
    const raw = await readFile(mission.blueprintPath, "utf8");
    const blueprint = JSON.parse(raw) as { anchors: { id: string; kind: string }[] };
    // A doodad Anchor nothing else names, dropped from the Blueprint while the Editor still has it.
    const dropped = blueprint.anchors.find((anchor) => anchor.kind === "doodad" && raw.split(`"${anchor.id}"`).length === 2)!;
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, anchors: blueprint.anchors.filter((anchor) => anchor !== dropped) }, null, 2));
    const id = stableObjectId(dropped.id);

    const result = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    const added = result.changes.find((change) => change.label === "Doodad anchors added")!.ids;
    const synced = JSON.parse(await readFile(mission.blueprintPath, "utf8")) as { anchors: { id: string; editorId?: number }[] };
    expect(synced.anchors.find((anchor) => anchor.id === added[0])!.editorId).toBe(id);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect((await readFile(path.join(mission.mapDir, "Objects"), "utf8")).match(new RegExp(`Id="${id}"`, "g"))).toHaveLength(1);
  }, 90_000);

  it("leaves a unit the author placed in the Editor Kept: it may be a Kept trigger's", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, "Objects", (objects) =>
      objects.replace("</PlacedObjects>", `    <ObjectUnit Id="${PLACED}" Position="30,30,0" Rotation="0" Scale="1,1,1" UnitType="Marine" Player="1"/>\n</PlacedObjects>`),
    );
    const blueprint = await readFile(mission.blueprintPath, "utf8");

    const result = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    expect(result.changes).toEqual([]);
    expect(await readFile(mission.blueprintPath, "utf8")).toBe(blueprint);
  }, 60_000);
});

describe("Unexplored Areas set in the Editor", () => {
  it("comes back to the Blueprint with sync, so the next compile writes it", async () => {
    const mission = await compiled();
    const mapInfo = path.join(mission.mapDir, "MapInfo");
    // Map > Map Options > Unexplored Areas: Black Mask (Reduced Radius).
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "BlackNoUnhide"));

    const synced = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    expect(synced.changes).toEqual([{ label: "Unexplored Areas changed", ids: ["Black Mask → Black Mask (Reduced Radius) (black-reduced-radius)"] }]);
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8")).unexploredAreas).toBe("black-reduced-radius");
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(readMapInfoFields(await readFile(mapInfo)).fog).toBe("BlackNoUnhide");
    expect((await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir)).changes).toEqual([]);

    // Set back to the default Black Mask, the Blueprint leaves the field out again.
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "Black"));
    await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8"))).not.toHaveProperty("unexploredAreas");
  }, 90_000);

  it("leaves a fog string the Editor doesn't have alone, saying so until the next compile replaces it", async () => {
    const mission = await compiled();
    const mapInfo = path.join(mission.mapDir, "MapInfo");
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "Murky"));
    const blueprint = await readFile(mission.blueprintPath, "utf8");

    const synced = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);

    expect(synced.changes).toEqual([]);
    expect(synced.notes).toEqual([{ label: "Map Options not synced", items: [`Unexplored Areas "Murky" isn't one of the Editor's three, so the Blueprint keeps Black Mask, which the next compile writes`] }]);
    expect(await readFile(mission.blueprintPath, "utf8")).toBe(blueprint);

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(readMapInfoFields(await readFile(mapInfo)).fog).toBe("Black");
    expect((await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir)).notes).toEqual([]);
  }, 60_000);
});

describe("from review", () => {
  it("stops on a rotation the author changed, however small, past what sync rounds away", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, "Objects", (objects) => objects.replace(new RegExp(`(<ObjectDoodad Id="${ROCK}"[^>]*? Rotation=")4\\.7821`), "$14.8221"));
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow(new RegExp(`object:${ROCK}`));
  }, 60_000);

  it("refuses a decision that names no change and nothing kept", async () => {
    const mission = await compiled();
    await recolour(mission.mapDir);
    const before = await tree(mission.missionDir);
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: ["objct:1"], discard: "all" } })).rejects.toThrow(
      /objct:1 is neither a change the Editor made nor kept/,
    );
    expect(await tree(mission.missionDir)).toEqual(before);
  }, 60_000);

  it("keeps a region at its number, and sync still matches the regions after it", async () => {
    const mission = await compiled();
    // The author redraws region 1 and keeps it.
    await edit(mission.mapDir, "Regions", (regions) => regions.replace(/(<region id="1">[\s\S]*?<quad value=")[^"]*/, "$11,1,3,3"));
    const regions = await readFile(path.join(mission.mapDir, "Regions"), "utf8");
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: ["region:1"] } });
    expect(await readFile(path.join(mission.mapDir, "Regions"), "utf8")).toBe(regions);

    const once = await tree(mission.missionDir);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await tree(mission.missionDir)).toEqual(once);
    expect((await record(mission.missionDir)).kept).toEqual([{ kind: "region", id: 1 }]);
    const synced = await syncMission(mission.workspace, mission.blueprintPath, mission.mapDir);
    expect(synced.changes).toEqual([]);
  }, 90_000);

  it("leaves out the Galaxy of a kept trigger the author deleted in the Editor", async () => {
    const mission = await compiled();
    const { entries } = await record(mission.missionDir);
    const trigger = entries.find((entry) => entry.kind === "trigger")!;
    if (trigger.kind !== "trigger") throw new Error("no trigger");
    const strings = path.join(mission.mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
    const name = new RegExp(`^Trigger/Name/${trigger.id}=([^\\r\\n]*)`, "m").exec(await readFile(strings, "utf8"))![1]!;
    const script = `gt_${name.replace(/[^A-Za-z0-9_]/g, "")}`;
    // Deleted in the Trigger Editor and saved: its XML, its name and its Galaxy go.
    await edit(mission.mapDir, "Triggers", (triggers) =>
      triggers
        .replace(new RegExp(`^[ \\t]*<Item Type="Trigger" Id="${trigger.id}"/>\\r?\\n`, "m"), "")
        .replace(new RegExp(`^[ \\t]*<Element Type="Trigger" Id="${trigger.id}">[\\s\\S]*?</Element>\\r?\\n`, "m"), ""),
    );
    await edit(mission.mapDir, "enUS.SC2Data/LocalizedData/TriggerStrings.txt", (text) => text.replace(new RegExp(`^Trigger/Name/${trigger.id}=[^\\n]*\\n`, "m"), ""));
    const blocks = entries.flatMap((entry) => (entry.kind === "galaxy-block" && entry.id.endsWith(`:${script}`) ? [entry.id] : []));
    expect(blocks.length).toBeGreaterThan(0);
    await edit(mission.mapDir, "MapScript.galaxy", (text) => spliceMapScript(text, undefined, blocks).content);

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: "all" } });

    expect(await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8")).not.toContain(script);
  }, 90_000);

  it("doesn't ask about a file the compile leaves to the package", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-editor-changes-"));
    await writeFile(path.join(root, "t3Terrain.xml"), "hand-made");
    const record = { version: 1 as const, entries: [{ kind: "file" as const, path: "t3Terrain.xml", fingerprint: "0".repeat(16) }] };
    expect(await editorChanges(root, record, () => undefined, new Set(["t3Terrain.xml"]))).toEqual([]);
    expect((await editorChanges(root, record, () => undefined)).map((change) => change.name)).toEqual(["file:t3Terrain.xml"]);
  });
});

describe("MapScript.galaxy changed in the Editor", () => {
  const script = "MapScript.galaxy";
  /** A function the author typed into the script in the Editor's Galaxy view. */
  const handWritten = (text: string) => `${text.trimEnd()}\n\nvoid gf_AuthorsOwn () {\n    UIDisplayMessage(PlayerGroupAll(), c_messageAreaDebug, StringToText("hand written"));\n}\n`;

  it("is on the compile record, and an edit to it stops the compile, writing nothing", async () => {
    const mission = await compiled();
    expect((await record(mission.missionDir)).entries.some((entry) => entry.kind === "file" && entry.path === script)).toBe(true);
    await edit(mission.mapDir, script, handWritten);
    const before = await tree(mission.missionDir);
    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow(/file:MapScript\.galaxy: changed in the Editor/);
    expect(await tree(mission.missionDir)).toEqual(before);
  }, 90_000);

  it("is left as changed when kept, and the next compile doesn't ask again", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, script, handWritten);
    const edited = await readFile(path.join(mission.mapDir, script), "utf8");
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { keep: ["file:MapScript.galaxy"] } });
    expect(await readFile(path.join(mission.mapDir, script), "utf8")).toBe(edited);
    expect((await record(mission.missionDir)).kept).toEqual([{ kind: "file", path: script }]);
    const once = await tree(mission.missionDir);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await tree(mission.missionDir)).toEqual(once);
  }, 90_000);

  it("is written again as the Blueprint says when discarded", async () => {
    const mission = await compiled();
    const compiledScript = await readFile(path.join(mission.mapDir, script), "utf8");
    await edit(mission.mapDir, script, handWritten);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, decisions: { discard: ["file:MapScript.galaxy"] } });
    expect(await readFile(path.join(mission.mapDir, script), "utf8")).toBe(compiledScript);
  }, 90_000);

  it("isn't asked about when only its line endings, blank lines or comments differ", async () => {
    const mission = await compiled();
    await edit(mission.mapDir, script, (text) => `// saved by the Editor\r\n${text.replace(/\r?\n/g, "\r\n\r\n")}`);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
  }, 90_000);

  it("is left to the trigger's own question when the Triggers changed with it", async () => {
    const mission = await compiled();
    const trigger = (await record(mission.missionDir)).entries.find((entry) => entry.kind === "trigger")!;
    if (trigger.kind !== "trigger") throw new Error("no trigger");
    await edit(mission.mapDir, "Triggers", (triggers) => triggers.replace(new RegExp(`(<Element Type="Trigger" Id="${trigger.id}">)(\\r?\\n)`), "$1$2        <Disabled/>$2"));
    await edit(mission.mapDir, script, handWritten);
    const error = await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt }).catch((caught: unknown) => caught as Error);
    expect(String(error)).toMatch(new RegExp(`trigger:${trigger.id}`));
    expect(String(error)).not.toMatch(/file:MapScript\.galaxy/);
  }, 90_000);

  it("doesn't stop a compile from a record that has no entry for it (written before it was fingerprinted)", async () => {
    const mission = await compiled();
    const recordFile = path.join(mission.missionDir, "compile-record.json");
    const old = JSON.parse(await readFile(recordFile, "utf8")) as { entries: { kind: string; path?: string }[] };
    old.entries = old.entries.filter((entry) => !(entry.kind === "file" && entry.path === script));
    await writeFile(recordFile, JSON.stringify(old));
    await edit(mission.mapDir, script, handWritten);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    // The compile writes it whole again and records it, so the record has the entry from here on.
    expect((await record(mission.missionDir)).entries.some((entry) => entry.kind === "file" && entry.path === script)).toBe(true);
  }, 90_000);
});
