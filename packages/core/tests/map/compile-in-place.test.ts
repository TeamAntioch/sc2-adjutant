// Compiling into a Map Package that already holds Kept Content (ADR-0010): the compile record
// lists what the compile wrote, and the next compile replaces exactly that.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type CompileRecord, EMPTY_COMPILE_RECORD } from "../../src/domain/compile-record.js";
import { compileShotCutscene } from "../../src/cutscene/compile-cutscene.js";
import { triggerTreeScriptNames } from "../../src/map/kept-references.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";

const raw = withoutScript(crossingRaw);
const blueprint = CrossingBlueprintSchema.parse(raw);
const savedAt = new Date("2026-01-01T00:00:00Z");

function withoutScript(source: Record<string, unknown>): Record<string, unknown> {
  const { script: _script, ...screenplay } = source.screenplay as Record<string, unknown>;
  return { ...source, screenplay };
}

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function packageDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-"));
  dirs.push(dir);
  return dir;
}

function compile(outputDir: string, previousRecord?: CompileRecord, source = blueprint) {
  return writeMapPackage({ blueprint: source, outputDir, includeObjects: true, includeRegions: true, includeTriggers: true, savedAt, ...(previousRecord ? { previousRecord } : {}) });
}

/** Every file in the package, by its path with forward slashes, as bytes. */
async function readTree(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries.filter((item) => item.isFile()).sort((a, b) => (path.join(a.parentPath, a.name) < path.join(b.parentPath, b.name) ? -1 : 1))) {
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(root, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
  }
  return files;
}

const STRING_FILES = ["enUS.SC2Data/LocalizedData/GameStrings.txt", "enUS.SC2Data/LocalizedData/TriggerStrings.txt"];

describe("the compile record", () => {
  it("lists every object, region, string key and file the compile wrote", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const tree = await readTree(dir);

    const objectIds = [...tree["Objects"]!.matchAll(/<Object\w+ Id="(\d+)"/g)].map((match) => Number(match[1]));
    expect(objectIds.length).toBeGreaterThan(0);
    expect(record.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : []))).toEqual(objectIds);

    const regionIds = [...tree["Regions"]!.matchAll(/<region id="(\d+)">/g)].map((match) => Number(match[1]));
    expect(regionIds.length).toBeGreaterThan(0);
    expect(record.entries.flatMap((entry) => (entry.kind === "region" ? [entry.id] : []))).toEqual(regionIds);

    for (const file of STRING_FILES) {
      const keys = tree[file]!.replace(/^ï»¿/, "").split("\r\n").filter(Boolean).map((line) => line.slice(0, line.indexOf("=")));
      expect(keys.length).toBeGreaterThan(0);
      expect(record.entries.flatMap((entry) => (entry.kind === "string" && entry.file === file ? [entry.key] : []))).toEqual(keys);
    }

    const triggerIds = [...tree["Triggers"]!.matchAll(/<Item Type="Trigger" Id="([^"]+)"\/>/g)].map((match) => match[1]);
    expect(triggerIds.length).toBeGreaterThan(0);
    expect(record.entries.flatMap((entry) => (entry.kind === "trigger" ? [entry.id] : []))).toEqual(triggerIds);

    // Every other file is written whole.
    const whole = Object.keys(tree).filter((file) => file !== "Objects" && file !== "Regions" && !STRING_FILES.includes(file)).sort();
    expect(record.entries.flatMap((entry) => (entry.kind === "file" ? [entry.path] : [])).sort()).toEqual(whole);
  }, 30_000);

  it("is enough for a second compile with no Blueprint change to leave the package byte-identical", async () => {
    const dir = await packageDir();
    const first = await compile(dir);
    const before = await readTree(dir);
    const second = await compile(dir, first.record);
    expect(await readTree(dir)).toEqual(before);
    expect(second.record).toEqual(first.record);
  }, 30_000);
});

// Content the author made in the Editor, written as the Editor writes it (four-space indent).
const KEPT_DOODAD = `    <ObjectDoodad Id="1111" Position="40.5,40.5,8" Rotation="1.2" Scale="1,1,1" Type="ShakurasRockColumn" Variation="2"/>`;
const KEPT_UNIT = `    <ObjectUnit Id="2222" Position="44,41,0" Rotation="0.5" Scale="1,1,1" UnitType="Zealot" Player="1">\n        <Flag Index="HeroUnit" Value="1"/>\n    </ObjectUnit>`;
const KEPT_REGION = `    <region id="900">\n        <name value="Author's Lookout"/>\n        <shape type="rect">\n            <quad value="10,10,20,20"/>\n        </shape>\n    </region>`;
const KEPT_STRING = "Kept/Author/Note=Written in the Editor\r\n";
const KEPT_FILE = "Base.SC2Data/Cutscenes/Author.SC2Cutscene";

/** Adds the Kept content after each file's first compiled line, as the Editor might place it. */
async function addKeptContent(dir: string): Promise<void> {
  const objects = path.join(dir, "Objects");
  await writeFile(objects, (await readFile(objects, "utf8")).replace(/(<PlacedObjects[^>]*>)/, `$1\n${KEPT_DOODAD}\n${KEPT_UNIT}`));
  const regions = path.join(dir, "Regions");
  await writeFile(regions, (await readFile(regions, "utf8")).replace("<Regions>", `<Regions>\n${KEPT_REGION}`));
  const strings = path.join(dir, STRING_FILES[0]!);
  const text = await readFile(strings, "utf8");
  const at = text.indexOf("\r\n") + 2;
  await writeFile(strings, text.slice(0, at) + KEPT_STRING + text.slice(at));
  await mkdir(path.dirname(path.join(dir, KEPT_FILE)), { recursive: true });
  await writeFile(path.join(dir, KEPT_FILE), "<Cutscene/>\n");
}

/** The package with the Kept content taken out again. */
function withoutKept(tree: Record<string, string>): Record<string, string> {
  const out = { ...tree };
  delete out[KEPT_FILE];
  out["Objects"] = out["Objects"]!.replace(`\n${KEPT_DOODAD}`, "").replace(`\n${KEPT_UNIT}`, "");
  out["Regions"] = out["Regions"]!.replace(`\n${KEPT_REGION}`, "");
  out[STRING_FILES[0]!] = out[STRING_FILES[0]!]!.replace(KEPT_STRING, "");
  return out;
}

/** The Blueprint with its hero moved, so the compile changes something. */
function withHeroMoved(): typeof blueprint {
  const anchors = (raw.anchors as { id: string; position: { x: number; y: number } }[]).map((anchor) =>
    anchor.id === "hero_zeratul" ? { ...anchor, position: { ...anchor.position, x: anchor.position.x + 2 } } : anchor,
  );
  return CrossingBlueprintSchema.parse({ ...raw, anchors });
}

describe("compiling into a package with Kept Content", () => {
  it("leaves every Kept byte as it was, and writes the compiled parts as a fresh compile would", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    await addKeptContent(dir);
    const kept = await readTree(dir);

    await compile(dir, record, withHeroMoved());
    const after = await readTree(dir);
    expect(after[KEPT_FILE]).toBe(kept[KEPT_FILE]);
    for (const snippet of [KEPT_DOODAD, KEPT_UNIT]) expect(after["Objects"]).toContain(snippet);
    expect(after["Regions"]).toContain(KEPT_REGION);
    expect(after[STRING_FILES[0]!]).toContain(KEPT_STRING);

    const fresh = await packageDir();
    await compile(fresh, undefined, withHeroMoved());
    expect(withoutKept(after)).toEqual(await readTree(fresh));
    expect(after["Objects"]).not.toEqual(kept["Objects"]);
  }, 30_000);

  it("removes an Anchor's object once the Blueprint drops it, and keeps a Kept object of the same type beside it", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const crater = /<ObjectDoodad Id="(\d+)" [^>]*Position="24,48,[^>]*Type="MeinhoffCraterLarge"/.exec(await readFile(path.join(dir, "Objects"), "utf8"));
    expect(crater).not.toBeNull();
    const craterId = Number(crater![1]);
    // The author's own crater, a step away from the Blueprint's.
    const keptCrater = `    <ObjectDoodad Id="3333" Position="25,48,8" Rotation="0" Scale="1,1,1" Type="MeinhoffCraterLarge"/>`;
    const objects = path.join(dir, "Objects");
    await writeFile(objects, (await readFile(objects, "utf8")).replace("</PlacedObjects>", `${keptCrater}\n</PlacedObjects>`));

    const anchors = (raw.anchors as { id: string }[]).filter((anchor) => anchor.id !== "crater_1");
    const { record: next } = await compile(dir, record, CrossingBlueprintSchema.parse({ ...raw, anchors }));

    const after = await readFile(objects, "utf8");
    expect(after).not.toContain(`Id="${craterId}"`);
    expect(after).toContain(keptCrater);
    expect(next.entries.some((entry) => entry.kind === "object" && entry.id === craterId)).toBe(false);
    expect(record.entries.some((entry) => entry.kind === "object" && entry.id === craterId)).toBe(true);
  }, 30_000);

  it("merges into an imported package, whose record is empty, leaving its Kept objects, regions and strings in place", async () => {
    const dir = await packageDir();
    await writeFile(path.join(dir, "Objects"), `<?xml version="1.0" encoding="utf-8"?>\n<PlacedObjects Version="27">\n${KEPT_DOODAD}\n${KEPT_UNIT}\n</PlacedObjects>\n`);
    await writeFile(path.join(dir, "Regions"), `<?xml version="1.0" encoding="utf-8"?>\n<Regions>\n${KEPT_REGION}\n</Regions>\n`);
    await mkdir(path.join(dir, "enUS.SC2Data", "LocalizedData"), { recursive: true });
    await writeFile(path.join(dir, STRING_FILES[0]!), `\ufeff${KEPT_STRING}`);
    const { record } = await compile(dir, EMPTY_COMPILE_RECORD);

    const after = await readTree(dir);
    expect(after["Objects"]).toMatch(new RegExp(`^<\\?xml[^\\n]*\\n<PlacedObjects Version="27">\\n${escape(KEPT_DOODAD)}\\n${escape(KEPT_UNIT)}\\n`));
    expect(after["Regions"]).toContain(KEPT_REGION);
    expect(after[STRING_FILES[0]!]).toContain(KEPT_STRING);
    expect(record.entries.some((entry) => entry.kind === "object" && (entry.id === 1111 || entry.id === 2222))).toBe(false);
    expect(record.entries.some((entry) => entry.kind === "region" && entry.id === 900)).toBe(false);
    expect(record.entries.some((entry) => entry.kind === "string" && entry.key === "Kept/Author/Note")).toBe(false);
    // The compiled ones are there too.
    expect(record.entries.filter((entry) => entry.kind === "object").length).toBeGreaterThan(0);
  }, 30_000);
});

describe("a package with Kept triggers", () => {
  it("gets the compiled triggers spliced in beside them, the Kept one left as the Editor wrote it", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    // A trigger the author made in the Editor, listed in Root beside the compiled ones.
    const triggers = path.join(dir, "Triggers");
    const keptTrigger = `    <Element Type="Trigger" Id="0A0B0C0D">\r\n    </Element>\r\n`;
    await writeFile(triggers, (await readFile(triggers, "utf8")).replace("<Root>", `<Root>\r\n        <Item Type="Trigger" Id="0A0B0C0D"/>`).replace("</TriggerData>", `${keptTrigger}</TriggerData>`));

    const { record: next } = await compile(dir, record, withHeroMoved());

    const after = await readFile(triggers, "utf8");
    expect(after).toContain(`<Root>\r\n        <Item Type="Trigger" Id="0A0B0C0D"/>\r\n`);
    expect(after).toContain(keptTrigger);
    const fresh = await packageDir();
    await compile(fresh, undefined, withHeroMoved());
    // The compiled triggers are the fresh compile's, after the Kept one.
    expect(after.replace(`        <Item Type="Trigger" Id="0A0B0C0D"/>\r\n`, "").replace(keptTrigger, "")).toBe(await readFile(path.join(fresh, "Triggers"), "utf8"));
    expect(next.entries.some((entry) => entry.kind === "file" && entry.path === "Triggers")).toBe(false);
    expect(next.entries.filter((entry) => entry.kind === "trigger").length).toBe(record.entries.filter((entry) => entry.kind === "trigger").length);
  }, 30_000);
});

describe("a Kept trigger the author files in a Compiled folder", () => {
  it("keeps its place in MapScript.galaxy's tree order, named from the locale the Editor wrote it in", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const triggers = path.join(dir, "Triggers");
    const script = path.join(dir, "MapScript.galaxy");
    const titles = async (): Promise<string[]> => [...(await readFile(script, "utf8")).matchAll(/^\/\/ Trigger: (.*?)\r?$/gm)].map((match) => match[1]!);
    const compiled = await titles();
    // The Editor's save: the author's trigger filed just before the last Compiled trigger, its name
    // in deDE only, and its section first among the triggers, where the compile used to leave it.
    const before = await readFile(triggers, "utf8");
    const strings = await readFile(path.join(dir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8");
    const lastId = strings.split(/\r?\n/).find((line) => /^Trigger\/Name\/[0-9A-F]{8}=/.test(line) && line.slice(line.indexOf("=") + 1) === compiled.at(-1))!.slice(13, 21);
    const last = `        <Item Type="Trigger" Id="${lastId}"/>\r\n`;
    expect(before.split(last).length).toBe(2);
    const keptTrigger = `    <Element Type="Trigger" Id="0A0B0C0D">\r\n    </Element>\r\n`;
    await writeFile(triggers, before.replace(last, `        <Item Type="Trigger" Id="0A0B0C0D"/>\r\n${last}`).replace("</TriggerData>", `${keptTrigger}</TriggerData>`));
    await mkdir(path.join(dir, "deDE.SC2Data", "LocalizedData"), { recursive: true });
    await writeFile(path.join(dir, "deDE.SC2Data", "LocalizedData", "TriggerStrings.txt"), "\uFEFFTrigger/Name/0A0B0C0D=Folder Check\r\n");
    const rule = "//" + "-".repeat(98);
    const section = [rule, "// Trigger: Folder Check", rule, "bool gt_FolderCheck_Func (bool testConds, bool runActions) {", "    return true;", "}", "", rule, "void gt_FolderCheck_Init () {", '    gt_FolderCheck = TriggerCreate("gt_FolderCheck_Func");', "}", "", ""].join("\r\n");
    const saved = (await readFile(script, "utf8"))
      .replace(/^(\/\/-+\r\n\/\/ Trigger: )/m, `${section}$1`)
      .replace(/^(trigger gt_\w+;\r\n)/m, "trigger gt_FolderCheck;\r\n$1")
      .replace(/^(void InitTriggers \(\) \{\r\n)/m, "$1    gt_FolderCheck_Init();\r\n");
    await writeFile(script, saved);
    expect((await titles())[0]).toBe("Folder Check");

    await compile(dir, record);

    // Where the Editor's next save puts each section: in the spliced Triggers' tree order.
    const after = await readFile(script, "utf8");
    const sections = [...after.matchAll(/^bool (gt_\w+)_Func \(/gm)].map((match) => match[1]!);
    const locales = [await readFile(path.join(dir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8"), await readFile(path.join(dir, "deDE.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8")];
    const tree = triggerTreeScriptNames(await readFile(triggers, "utf8"), locales).flatMap((names) => names.filter((name) => name.startsWith("gt_")));
    expect(sections).toEqual(tree.filter((name) => sections.includes(name)));
    expect(sections.length).toBe(compiled.length + 1);
    expect(sections.indexOf("gt_FolderCheck")).toBe(compiled.length - 1);
    expect([...after.matchAll(/^trigger (gt_\w+);/gm)].map((match) => match[1])).toEqual(sections);
    expect([...after.matchAll(/^    (gt_\w+)_Init\(\);/gm)].map((match) => match[1])).toEqual(sections);
  }, 30_000);
});

describe("Triggers the last compile wrote whole", () => {
  it("keeps a Kept trigger the Editor added since, when this compile writes no triggers", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const triggers = path.join(dir, "Triggers");
    const keptTrigger = `    <Element Type="Trigger" Id="0A0B0C0D">\r\n    </Element>\r\n`;
    await writeFile(triggers, (await readFile(triggers, "utf8")).replace("<Root>", `<Root>\r\n        <Item Type="Trigger" Id="0A0B0C0D"/>`).replace("</TriggerData>", `${keptTrigger}</TriggerData>`));

    await writeMapPackage({ blueprint, outputDir: dir, includeObjects: true, includeRegions: true, savedAt, previousRecord: record });

    expect(await readFile(triggers, "utf8")).toBe(`<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData>\r\n    <Root>\r\n        <Item Type="Trigger" Id="0A0B0C0D"/>\r\n    </Root>\r\n${keptTrigger}</TriggerData>`);
  }, 30_000);
});

describe("a Kept file the compile would write", () => {
  it("is refused when it differs, and left as it was", async () => {
    const dir = await packageDir();
    await writeFile(path.join(dir, "MapInfo"), "the author's own");
    await expect(compile(dir, EMPTY_COMPILE_RECORD)).rejects.toThrow(/MapInfo, which is Kept Content/);
    expect(await readTree(dir)).toEqual({ MapInfo: "the author's own" });
  }, 30_000);
});

describe("merging into files the Editor saved", () => {
  it("keeps CRLF lines whole when an object goes and another comes", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const objects = path.join(dir, "Objects");
    // Saved by the Editor: CRLF, with the author's doodad first.
    await writeFile(objects, (await readFile(objects, "utf8")).replace(/(<PlacedObjects[^>]*>)/, `$1\n${KEPT_DOODAD}`).replace(/\r?\n/g, "\r\n"));

    const anchors = (raw.anchors as { id: string }[]).filter((anchor) => anchor.id !== "crater_1");
    anchors.push({ ...(raw.anchors as { id: string }[]).find((anchor) => anchor.id === "crater_2")!, id: "crater_new" });
    await compile(dir, record, CrossingBlueprintSchema.parse({ ...raw, anchors }));

    const after = await readFile(objects, "utf8");
    expect(after).not.toContain("\r\r");
    expect(after).toContain(`${KEPT_DOODAD}\r\n`);
    expect(after.split("\r\n").every((line) => !line.startsWith("\n"))).toBe(true);
  }, 30_000);

  it("opens a list the Editor saved empty, to put the compiled objects back in it", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    await writeFile(path.join(dir, "Objects"), `<?xml version="1.0" encoding="utf-8"?>\n<PlacedObjects Version="27"/>\n`);
    // Every Compiled object deleted in the Editor is a change the compile asks about (#242): discarded, so they come back.
    await expect(compile(dir, record)).rejects.toThrow(/removed in the Editor/);
    await writeMapPackage({ blueprint, outputDir: dir, includeObjects: true, includeRegions: true, includeTriggers: true, savedAt, previousRecord: record, decisions: { discard: "all" } });
    const after = await readFile(path.join(dir, "Objects"), "utf8");
    expect(after).toMatch(/^<\?xml[^\n]*\n<PlacedObjects Version="27">\n  <Object/);
    expect(after).toMatch(/\n<\/PlacedObjects>\n$/);
  }, 30_000);
});

describe("a compile cut short", () => {
  it("has saved a record listing both compiles' entries before it writes any file", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const anchors = (raw.anchors as { id: string }[]).filter((anchor) => anchor.id !== "crater_1");
    const saved: CompileRecord[] = [];
    const objects = await readFile(path.join(dir, "Objects"), "utf8");
    let objectsWhenFirstSaved: string | undefined;
    await writeMapPackage({
      blueprint: CrossingBlueprintSchema.parse({ ...raw, anchors }),
      outputDir: dir,
      includeObjects: true,
      includeRegions: true,
      includeTriggers: true,
      savedAt,
      previousRecord: record,
      saveRecord: async (next) => {
        objectsWhenFirstSaved ??= await readFile(path.join(dir, "Objects"), "utf8");
        saved.push(next);
      },
    });
    expect(saved).toHaveLength(2);
    expect(objectsWhenFirstSaved).toBe(objects);
    const removed = record.entries.filter((entry) => !saved[1]!.entries.some((other) => JSON.stringify(other) === JSON.stringify(entry)));
    expect(removed.length).toBeGreaterThan(0);
    for (const entry of removed) expect(saved[0]!.entries).toContainEqual(entry);
  }, 30_000);
});

describe("a cutscene compile_cutscene wrote", () => {
  it("stays through the next compile, listed in ComponentList, and its play-from-start loop goes", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const spec = { origin: [20, 30, 0] as [number, number, number], shots: [{ name: "Wide", durationMs: 2000, from: { target: [16, 32, 1] as [number, number, number], distance: 20, pitch: 30, yaw: 180, fov: 40 } }] };
    await compileShotCutscene(spec, dir, "Intro", { play: true });
    expect(await readFile(path.join(dir, "Triggers"), "utf8")).toContain("CustomScript");

    await compile(dir, record);
    expect(await readFile(path.join(dir, "ComponentList.SC2Components"), "utf8")).toContain('<DataComponent Type="cuts">Cutscenes/Index</DataComponent>');
    expect(await readdir(path.join(dir, "Base.SC2Data", "Cutscenes"))).toContain("Intro.SC2Cutscene");
    expect(await readFile(path.join(dir, "Triggers"), "utf8")).not.toContain("CustomScript");
  }, 30_000);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("a Kept region holding a Compiled region's number", () => {
  it("renumbers the Compiled region past it, and the triggers that use it follow", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const regionsFile = path.join(dir, "Regions");
    const before = await readFile(regionsFile, "utf8");
    const count = [...before.matchAll(/<region id="(\d+)">/g)].length;
    const script = await readFile(path.join(dir, "MapScript.galaxy"), "utf8");
    // The Temple Gate zone's region, which a trigger watches.
    const gate = 6;
    expect(script).toContain(`RegionFromId(${gate})`);
    // The author redrew it in the Editor and kept the change (#242): it is Kept now, off the record, holding its number.
    const keptOne = `  <region id="${gate}">\n    <name value="Author's Gate"/>\n    <shape type="rect">\n      <quad value="1,1,4,4"/>\n    </shape>\n  </region>`;
    await writeFile(regionsFile, before.replace(new RegExp(` {2}<region id="${gate}">[\\s\\S]*?</region>`), keptOne));
    const keptRecord = { ...record, entries: record.entries.filter((entry) => !(entry.kind === "region" && entry.id === gate)) };

    const { record: next } = await compile(dir, keptRecord);

    const after = await readFile(regionsFile, "utf8");
    expect(after).toContain(keptOne);
    const fresh = count + 1;
    expect(after).toContain(`<region id="${fresh}">`);
    expect(next.entries.flatMap((entry) => (entry.kind === "region" ? [entry.id] : [])).sort((a, b) => a - b)).toEqual([...Array.from({ length: count }, (_, index) => index + 1).filter((id) => id !== gate), fresh]);
    const nextScript = await readFile(path.join(dir, "MapScript.galaxy"), "utf8");
    expect(nextScript).not.toContain(`RegionFromId(${gate})`);
    expect(nextScript).toBe(script.replaceAll(`RegionFromId(${gate})`, `RegionFromId(${fresh})`));
    expect(await readFile(path.join(dir, "Triggers"), "utf8")).toContain(`<ValueId Id="${fresh}"/>`);

    // Stable: the next compile writes the same bytes.
    const settled = await readTree(dir);
    await compile(dir, next);
    expect(await readTree(dir)).toEqual(settled);
  }, 30_000);

  it("leaves an Editor region added past the Compiled ones alone when the Blueprint gains one", async () => {
    const dir = await packageDir();
    const { record } = await compile(dir);
    const regionsFile = path.join(dir, "Regions");
    const count = [...(await readFile(regionsFile, "utf8")).matchAll(/<region id="(\d+)">/g)].length;
    // Drawn in the Editor, taking the next number: the one the Blueprint's new region would get.
    const editors = `  <region id="${count + 1}">\n    <name value="Author's Lookout"/>\n    <shape type="rect">\n      <quad value="10,10,20,20"/>\n    </shape>\n  </region>`;
    await writeFile(regionsFile, (await readFile(regionsFile, "utf8")).replace("</Regions>", `${editors}\n</Regions>`));
    const regions = [...((raw.regions as unknown[] | undefined) ?? []), { id: "quay", name: "Quay", shapes: [{ type: "rect", quad: [30, 30, 40, 40] }] }];

    const { record: next } = await compile(dir, record, CrossingBlueprintSchema.parse({ ...raw, regions }));

    const after = await readFile(regionsFile, "utf8");
    expect(after).toContain(editors);
    expect(after).toMatch(new RegExp(`<region id="${count + 2}">\\n {4}<name value="Quay"/>`));
    expect(next.entries.some((entry) => entry.kind === "region" && entry.id === count + 1)).toBe(false);
  }, 30_000);
});
