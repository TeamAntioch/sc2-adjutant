// Compiled Content that builds on Kept Content (ADR-0010): Kept References, a Compiled trigger that
// starts when a Kept one has run, and Triggers and MapScript.galaxy spliced so the Editor's own
// XML and Galaxy for Kept triggers stay byte for byte. The package is synthetic: the Ashen
// Crossing fixture compiled elsewhere and imported, so every trigger in it is Kept.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { generateTerrain } from "../../src/map/generate-terrain.js";
import { importMap } from "../../src/map/import-map.js";
import { runDriftTest } from "../../src/map/drift-test.js";
import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { formatMapScriptDrift, mapScriptDrift } from "../../src/triggers/map-script-drift.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Imported = { readonly workspace: Workspace; readonly workspaceRoot: string; readonly missionDir: string; readonly mapDir: string; readonly blueprintPath: string };

/** A Workspace with the Harbour Mission imported from an Editor-made package: every part of it Kept. */
async function imported(): Promise<Imported> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-refs-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  return { workspace, workspaceRoot, missionDir, mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath: path.join(missionDir, "blueprint.json") };
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

/** A Kept trigger's element Id, found by its name in TriggerStrings. */
async function keptTriggerId(mapDir: string, name: string): Promise<string> {
  const strings = await readFile(path.join(mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
  const id = new RegExp(`^Trigger/Name/([0-9A-F]{8})=${name}\\r?$`, "m").exec(strings)?.[1];
  if (!id) throw new Error(`no trigger ${name}`);
  return id;
}

/** The Kept trigger's own Galaxy, from its section rule to the end of its _Init. */
function triggerSection(script: string, name: string): string {
  const start = script.indexOf(`// Trigger: ${name}\r\n`);
  const end = script.indexOf("}\r\n", script.indexOf(`_Init () {`, start)) + 3;
  return script.slice(start, end);
}

async function editBlueprint(blueprintPath: string, change: (blueprint: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  await writeFile(blueprintPath, `${JSON.stringify(change(JSON.parse(await readFile(blueprintPath, "utf8"))), null, 2)}\n`);
}

/** The Kept "Mission Start" trigger, Zeratul and the temple gate's region, and a scene played after the trigger has run. */
async function withAfterMissionStart({ mapDir, blueprintPath }: Imported): Promise<string> {
  const triggerId = await keptTriggerId(mapDir, "Mission Start");
  await editBlueprint(blueprintPath, (blueprint) => ({
    ...blueprint,
    kept: [
      { id: "mission-start", kind: "trigger", editorId: triggerId, name: "Mission Start" },
      { id: "zeratul", kind: "unit", editorId: stableObjectId("hero_zeratul"), name: "Zeratul" },
    ],
    screenplay: {
      ...(blueprint.screenplay as object),
      scenes: [
        {
          id: "after-start",
          cue: { type: "keptTriggerRuns", triggerId: "mission-start" },
          lines: [{ id: "arrive", speaker: "Zeratul", speakerAnchorId: "zeratul", text: "The gate stands open." }],
        },
      ],
    },
  }));
  return triggerId;
}

describe("a Compiled trigger beside Kept ones", () => {
  it("goes into Triggers and MapScript.galaxy, and leaves the Kept trigger's XML and Galaxy as they were", async () => {
    const harbour = await imported();
    const before = await tree(harbour.mapDir);
    const keptId = await withAfterMissionStart(harbour);

    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    const after = await tree(harbour.mapDir);
    const triggers = after["Triggers"]!;
    // Every line the Editor wrote is still there, in order: the Compiled trigger only adds lines.
    const keptLines = before["Triggers"]!.split("\r\n");
    const lines = triggers.split("\r\n");
    let at = 0;
    for (const line of keptLines) {
      at = lines.indexOf(line, at);
      expect(at, line).toBeGreaterThanOrEqual(0);
      at += 1;
    }
    // The Compiled trigger in the compile's folders, after the Kept items.
    expect(triggers).toMatch(/<Item Type="Category" Id="[0-9A-F]{8}"\/>\r\n    <\/Root>/);
    expect(triggers).toContain(`<ValueElement Type="Trigger" Id="${keptId}"/>`);

    const script = after["MapScript.galaxy"]!;
    expect(triggerSection(script, "Mission Start")).toBe(triggerSection(before["MapScript.galaxy"]!, "Mission Start"));
    expect(script).toContain("trigger gt_AfterMissionStart;\r\n");
    expect(script).toContain("    TriggerWaitForTrigger(gt_MissionStart, true);\r\n");
    expect(script).toContain(`TransmissionSourceFromUnit(UnitFromId(${stableObjectId("hero_zeratul")}), true, false, "Talk")`);
    expect(script).toContain("    gt_AfterMissionStart_Init();\r\n}");
    // The Kept script with the Compiled blocks taken out is the Editor's, byte for byte.
    const record = parseCompileRecord(await readFile(path.join(harbour.missionDir, "compile-record.json"), "utf8"));
    expect(record.entries.filter((entry) => entry.kind === "galaxy-block").map((entry) => entry.id)).toEqual([
      "trigger-variable:gt_AfterMissionStart",
      "trigger:gt_AfterMissionStart",
      "trigger-init:gt_AfterMissionStart",
    ]);
    expect(record.entries.filter((entry) => entry.kind === "trigger").length).toBe(1);
    expect(record.entries.some((entry) => entry.kind === "file" && (entry.path === "Triggers" || entry.path === "MapScript.galaxy"))).toBe(false);
    // Nothing else in the package changed but the strings the Compiled trigger names and says.
    const changed = Object.keys(after).filter((file) => after[file] !== before[file]).sort();
    expect(changed).toEqual(["MapScript.galaxy", "Triggers", "enUS.SC2Data/LocalizedData/GameStrings.txt", "enUS.SC2Data/LocalizedData/TriggerStrings.txt"]);
  }, 60_000);

  it("compiles the same package again when the Blueprint is unchanged", async () => {
    const harbour = await imported();
    await withAfterMissionStart(harbour);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    const first = await tree(harbour.missionDir);

    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    expect(await tree(harbour.missionDir)).toEqual(first);
  }, 60_000);

  it("goes, XML and Galaxy and strings, when the Blueprint drops it", async () => {
    const harbour = await imported();
    const before = await tree(harbour.missionDir);
    await withAfterMissionStart(harbour);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    await editBlueprint(harbour.blueprintPath, ({ kept: _kept, screenplay, ...blueprint }) => ({ ...blueprint, screenplay: { title: (screenplay as { title: string }).title } }));
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    expect(await tree(harbour.missionDir)).toEqual(before);
  }, 60_000);

  it("takes a Kept region where a cue names a Zone, and calls a Kept unit by its Editor Id", async () => {
    const harbour = await imported();
    const arch = await withSceneAtRegion(harbour, "Rock Arch");

    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    const script = await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain(`TriggerAddEventUnitRegion(gt_ZeratulReachesRockArch, UnitRefFromUnit(UnitFromId(${stableObjectId("hero_zeratul")})), RegionFromId(${arch}), true);`);
  }, 60_000);

  it("splices into a Triggers file whose Root the author has emptied", async () => {
    const harbour = await imported();
    const arch = await withSceneAtRegion(harbour, "Rock Arch");
    const file = path.join(harbour.mapDir, "Triggers");
    await writeFile(file, (await readFile(file, "utf8")).replace(/<Root>[\s\S]*?<\/Root>/, "<Root>\r\n    </Root>"));

    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    expect(await readFile(file, "utf8")).toMatch(/<Root>\r\n(        <Item Type="Category" Id="[0-9A-F]{8}"\/>\r\n)+    <\/Root>/);
    expect(await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8")).toContain(`RegionFromId(${arch})`);
  }, 60_000);

  it("refuses a Compiled trigger whose script name a Kept trigger has, writing nothing", async () => {
    const harbour = await imported();
    // The package's own "Zeratul Reaches Temple Gate" is Kept.
    await withSceneAtRegion(harbour, "Temple Gate");
    const before = await tree(harbour.missionDir);

    await expect(compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt })).rejects.toThrow(
      /"Zeratul Reaches Temple Gate" would have the script name gt_ZeratulReachesTempleGate, which Kept trigger [0-9A-F]{8} has/,
    );
    expect(await tree(harbour.missionDir)).toEqual(before);
  }, 60_000);
});

describe("a held Kept trigger (ADR-0014)", () => {
  /** The Kept "Mission Start" held, by its own Map Initialization event, until the Kept "Zeratul Dies" has run. */
  async function withHeldMissionStart({ mapDir, blueprintPath }: Imported): Promise<string> {
    const triggerId = await keptTriggerId(mapDir, "Mission Start");
    const diesId = await keptTriggerId(mapDir, "Zeratul Dies");
    await editBlueprint(blueprintPath, (blueprint) => ({
      ...blueprint,
      kept: [
        { id: "mission-start", kind: "trigger", editorId: triggerId, name: "Mission Start", hold: { until: { type: "keptTriggerRuns", triggerId: "zeratul-dies" } } },
        { id: "zeratul-dies", kind: "trigger", editorId: diesId, name: "Zeratul Dies" },
      ],
    }));
    return triggerId;
  }

  it("has its start switched off in the package, as the Editor does, and runs on its cue", async () => {
    const harbour = await imported();
    const before = await tree(harbour.mapDir);
    await withHeldMissionStart(harbour);

    const { warnings } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    const after = await tree(harbour.mapDir);
    const record = parseCompileRecord(await readFile(path.join(harbour.missionDir, "compile-record.json"), "utf8"));
    const hold = record.entries.find((entry) => entry.kind === "kept-hold");
    expect(hold).toMatchObject({ kind: "kept-hold", script: "gt_MissionStart", line: "    TriggerAddEventMapInit(gt_MissionStart);" });
    expect(after["Triggers"]).toContain(`    <Element Type="FunctionCall" Id="${hold!.id}">\r\n        <Disabled/>\r\n`);
    const kept = triggerSection(after["MapScript.galaxy"]!, "Mission Start");
    expect(kept).toBe(triggerSection(before["MapScript.galaxy"]!, "Mission Start").replace("    TriggerAddEventMapInit(gt_MissionStart);\r\n", ""));
    expect(after["MapScript.galaxy"]).toContain("    TriggerWaitForTrigger(gt_ZeratulDies, true);\r\n    TriggerExecute(gt_MissionStart, true, false);\r\n");
    expect(warnings.some((warning) => warning.startsWith("Held Mission Start: switched off its Map Initialization event"))).toBe(true);
  }, 60_000);

  it("changes nothing more on the next compile, and is switched back on, byte for byte, when the hold goes", async () => {
    const harbour = await imported();
    const before = await tree(harbour.missionDir);
    await withHeldMissionStart(harbour);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    const first = await tree(harbour.missionDir);

    const { warnings } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(await tree(harbour.missionDir)).toEqual(first);
    // The compile's own trigger that runs it isn't a Kept one the hold leaves.
    expect(warnings.filter((warning) => warning.includes("is also run by"))).toEqual([]);

    await editBlueprint(harbour.blueprintPath, ({ kept: _kept, ...blueprint }) => blueprint);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(await tree(harbour.missionDir)).toEqual(before);
  }, 60_000);
});

describe("Kept References outside the Mission's own Map Package", () => {
  /** The Ashen Crossing Mission (with Zones) in its own Workspace, with a Kept unit as a scene's speaker. */
  async function crossingWithKeptUnit(): Promise<{ workspace: Workspace; blueprintPath: string }> {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-refs-"));
    const workspaceRoot = path.join(root, "workspace");
    await cp(CROSSING, workspaceRoot, { recursive: true });
    const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
    await editBlueprint(blueprintPath, (blueprint) => ({
      ...blueprint,
      kept: [{ id: "dock-master", kind: "unit", editorId: 1234567, name: "Dock Master" }],
      screenplay: {
        ...(blueprint.screenplay as object),
        scenes: [{ id: "dock", cue: { type: "anchorDies", anchorId: "dock-master" }, lines: [{ id: "l", speaker: "Dock Master", speakerAnchorId: "dock-master", text: "Tie her up." }] }],
      },
    }));
    return { workspace: await loadWorkspace(workspaceRoot), blueprintPath };
  }

  it("don't stop a compile that writes no triggers, such as the terrain alone", async () => {
    const { workspace, blueprintPath } = await crossingWithKeptUnit();
    await expect(generateTerrain(workspace, blueprintPath, path.join(root!, "terrain", "Ashen.SC2Map"))).resolves.toBeDefined();
  }, 60_000);

  it("refuse a compile into another folder, or into a package with no compile record, whose triggers would lose them", async () => {
    const { workspace, blueprintPath } = await crossingWithKeptUnit();
    const refused = /has Kept References, but .* has no compile record/;
    await expect(compileMission(workspace, blueprintPath, path.join(root!, "out", "Ashen.SC2Map"), { savedAt })).rejects.toThrow(refused);
    await expect(compileMission(workspace, blueprintPath, undefined, { savedAt })).rejects.toThrow(refused);
  }, 60_000);
});

/** Kept Zeratul and the Kept region named `name`, and a scene cued when he enters it; returns the region's id. */
async function withSceneAtRegion({ mapDir, blueprintPath }: Imported, name: string): Promise<number> {
  const regions = await readFile(path.join(mapDir, "Regions"), "utf8");
  const id = Number(new RegExp(`<region id="(\\d+)">\\s*<name value="${name}"/>`).exec(regions)?.[1]);
  expect(id).toBeGreaterThan(0);
  await editBlueprint(blueprintPath, (blueprint) => ({
    ...blueprint,
    kept: [
      { id: "zeratul", kind: "unit", editorId: stableObjectId("hero_zeratul"), name: "Zeratul" },
      { id: "place", kind: "region", editorId: id, name },
    ],
    screenplay: {
      ...(blueprint.screenplay as object),
      scenes: [{ id: "at-place", cue: { type: "anchorEntersZone", anchorId: "zeratul", zoneId: "place" }, lines: [{ id: "look", speaker: "Zeratul", speakerAnchorId: "zeratul", text: "Here." }] }],
    },
  }));
  return id;
}

describe("Kept References in the check", () => {
  it("fails when the package no longer has the Editor Id, and warns when the Editor's name differs", async () => {
    const harbour = await imported();
    const triggerId = await keptTriggerId(harbour.mapDir, "Mission Start");
    await editBlueprint(harbour.blueprintPath, (blueprint) => ({
      ...blueprint,
      kept: [
        { id: "mission-start", kind: "trigger", editorId: triggerId, name: "Start of the Mission" },
        { id: "zeratul", kind: "unit", editorId: stableObjectId("hero_zeratul"), name: "Zeratul" },
        { id: "gone", kind: "unit", editorId: 12345, name: "Tassadar" },
        { id: "nowhere", kind: "region", editorId: 999, name: "Nowhere" },
        { id: "no-trigger", kind: "trigger", editorId: "0BADF00D", name: "Gate Opens" },
      ],
    }));

    const { problems } = await checkWorkspace(harbour.workspaceRoot);

    const at = (index: number) => problems.filter((problem) => problem.path === `kept.${index}`);
    expect(at(0)).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining('the Editor calls it "Mission Start"') })]);
    expect(at(1)).toEqual([]);
    expect(at(2)).toEqual([expect.objectContaining({ message: expect.stringContaining("has no unit 12345") })]);
    expect(at(2)[0]!.severity).toBeUndefined();
    expect(at(3)).toEqual([expect.objectContaining({ message: expect.stringContaining("has no region 999") })]);
    expect(at(4)).toEqual([expect.objectContaining({ message: expect.stringContaining("has no trigger 0BADF00D") })]);
  }, 60_000);

  it("stops the compile when a Kept trigger it hooks onto is gone, writing nothing", async () => {
    const harbour = await imported();
    await withAfterMissionStart(harbour);
    await editBlueprint(harbour.blueprintPath, (blueprint) => ({
      ...blueprint,
      kept: (blueprint.kept as { kind: string }[]).map((reference) => (reference.kind === "trigger" ? { ...reference, editorId: "0BADF00D" } : reference)),
    }));
    const before = await tree(harbour.missionDir);

    await expect(compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt })).rejects.toThrow(/has no trigger 0BADF00D/);
    expect(await tree(harbour.missionDir)).toEqual(before);
  }, 60_000);
});

/** A Host whose editor.save rewrites the copy's MapScript.galaxy with `save`, as the Editor would. */
function savingHost(cacheDir: string, save: (script: string) => string, saved: string[]): Host {
  return {
    machine: { ...emptyMachineConfig(), cacheDir },
    adapter: undefined,
    has: (name) => name === "editor.save",
    run: (async (name: string, request: { mapPath: string }) => {
      if (name !== "editor.save") throw new Error(`no ${name}`);
      saved.push(request.mapPath);
      const file = path.join(request.mapPath, "MapScript.galaxy");
      await writeFile(file, save(await readFile(file, "utf8")));
    }) as Host["run"],
  };
}

describe("the MapScript drift test", () => {
  it("compiles, has the Editor save a copy, and finds no drift when the save writes the spliced script", async () => {
    const harbour = await imported();
    await withAfterMissionStart(harbour);
    const saved: string[] = [];
    const cacheDir = path.join(root!, "cache");

    const result = await runDriftTest(harbour.workspace, harbour.blueprintPath, savingHost(cacheDir, (script) => script, saved), { savedAt });

    expect(saved).toEqual([path.join(cacheDir, "drift", "Harbour.SC2Map")]);
    expect(result.savedCopy).toBe(saved[0]);
    expect(result.drift).toEqual([]);
    expect(formatMapScriptDrift(result.drift)).toMatch(/^No drift/);
    // The Mission's own package has the compile, and the Editor never touched it.
    expect(await readFile(path.join(harbour.mapDir, "MapScript.galaxy"), "utf8")).toContain("gt_AfterMissionStart");
  }, 60_000);

  it("reports a difference by the section it is in", async () => {
    const harbour = await imported();
    await withAfterMissionStart(harbour);
    // The Editor puts the Compiled trigger first, and writes its wait another way.
    const save = (script: string) =>
      script
        .replace("trigger gt_AfterMissionStart;\r\n", "")
        .replace("trigger gt_MissionStart;\r\n", "trigger gt_AfterMissionStart;\r\ntrigger gt_MissionStart;\r\n")
        .replace("TriggerWaitForTrigger(gt_MissionStart, true);", "TriggerWaitForTrigger(gt_MissionStart, (true));");

    const { drift } = await runDriftTest(harbour.workspace, harbour.blueprintPath, savingHost(path.join(root!, "cache"), save, []), { savedAt });

    expect(drift.map((item) => [item.section, item.change])).toEqual([
      ["Trigger Variables", "changed"],
      ["Trigger: After Mission Start", "changed"],
    ]);
    expect(drift[0]!.lines).toEqual(["(the same lines, in another order)"]);
    expect(drift[1]!.lines).toEqual(["-    TriggerWaitForTrigger(gt_MissionStart, true);", "+    TriggerWaitForTrigger(gt_MissionStart, (true));"]);
    expect(formatMapScriptDrift(drift)).toContain("- Trigger: After Mission Start: changed");
  }, 60_000);

  it("checks the Editor has neither the Mission nor its copy open before it compiles", async () => {
    const harbour = await imported();
    await withAfterMissionStart(harbour);
    const before = await tree(harbour.missionDir);
    const saving = savingHost(path.join(root!, "cache"), (script) => script, []);
    const checked: string[] = [];
    const host: Host = {
      ...saving,
      has: (name) => name === "editor.save" || name === "editor.checkClosed",
      run: (async (name: string, request: { mapPath: string }) => {
        if (name !== "editor.checkClosed") return saving.run(name as "editor.save", request as never);
        checked.push(request.mapPath);
        throw new Error("the Editor has it open");
      }) as Host["run"],
    };

    await expect(runDriftTest(harbour.workspace, harbour.blueprintPath, host, { savedAt })).rejects.toThrow(/the Editor has it open/);
    expect(checked).toEqual([harbour.mapDir]);
    expect(await tree(harbour.missionDir)).toEqual(before);
  }, 60_000);

  it("counts a repeated line, and compares sections of the same title in turn", () => {
    const rule = "//" + "-".repeat(98);
    const section = (title: string, body: string) => [rule, `// ${title}`, rule, body, ""].join("\r\n");
    const spliced = section("Trigger: A", "x();") + section("Custom Script", "a();") + section("Custom Script", "b();");
    const saved = section("Trigger: A", "x();\r\n") + section("Custom Script", "a();") + section("Custom Script", "c();");
    expect(mapScriptDrift(spliced, saved)).toEqual([
      { section: "Trigger: A", change: "changed", lines: ["+"] },
      { section: "Custom Script", change: "changed", lines: ["-b();", "+c();"] },
    ]);
  });

  it("names a section only one side has", () => {
    const rule = "//" + "-".repeat(98);
    const section = (title: string, body: string) => [rule, `// ${title}`, rule, body, ""].join("\r\n");
    const spliced = section("Trigger Variables", "trigger gt_A;") + section("Trigger: A", "bool gt_A_Func () {}");
    const saved = section("Trigger Variables", "trigger gt_A;") + section("Global Variables", "int gv_b;");
    expect(mapScriptDrift(spliced, saved).map((item) => [item.section, item.change])).toEqual([
      ["Global Variables", "only in the Editor's"],
      ["Trigger: A", "only in the spliced script"],
    ]);
  });
});
