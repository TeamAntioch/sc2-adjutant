// The build: cues and times, a map from the stock example, and the checks that stop a build.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildTestbed, INIT_FUNC, parseCue, parseTime } from "../build.ts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLE = path.join(PACKAGE, "examples", "stock-units.json");

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A folder laid out as the example expects: a base map (the least a map folder needs here) beside tests/. */
async function mission(): Promise<{ root: string; spec: string; outMap: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "anim-testbed-"));
  folders.push(root);
  const map = path.join(root, "Ashfall-Relay.SC2Map");
  await mkdir(path.join(map, "Base.SC2Data", "GameData"), { recursive: true });
  await writeFile(path.join(map, "MapInfo"), "");
  await writeFile(path.join(map, "Base.SC2Data", "GameData", "UnitData.xml"), '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <CUnit id="Kept"/>\n</Catalog>\n');
  await mkdir(path.join(root, "tests"));
  const spec = path.join(root, "tests", "stock-units.json");
  await cp(EXAMPLE, spec);
  return { root, spec, outMap: path.join(root, "output", "StockUnits.SC2Map") };
}

/** Writes `edit(spec)` over the spec at `file`. */
async function editSpec(file: string, edit: (spec: Record<string, any>) => void): Promise<void> {
  const text = (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const spec = JSON.parse(text) as Record<string, any>;
  edit(spec);
  await writeFile(file, JSON.stringify(spec, null, 2));
}

describe("times and cues", () => {
  it("reads seconds, strike, land and offsets from them", () => {
    expect(parseTime("1.25", 0)).toEqual({ base: 0, at: 1.25 });
    expect(parseTime("1.25", 2)).toEqual({ base: 2, at: 1.25 });
    expect(parseTime("strike", 0)).toEqual({ base: 1, at: 0 });
    expect(parseTime("hit", 0)).toEqual({ base: 1, at: 0 });
    expect(parseTime("land-0.1", 0)).toEqual({ base: 2, at: -0.1 });
    expect(parseTime("strike + 0.2", 0)).toEqual({ base: 1, at: 0.2 });
    expect(parseTime("soon", 0)).toBeUndefined();
  });

  it("reads a sound with a start and a stop, and actor messages to the unit, a child and the target", () => {
    expect(parseCue("Marine_Stimpack@0.1~strike", 0).cue).toEqual({ kind: 0, text: "Marine_Stimpack", child: "", base: 0, at: 0.1, stopBase: 1, stop: 0 });
    expect(parseCue("actor Create TestBurst@0.1", 0).cue).toMatchObject({ kind: 1, text: "Create TestBurst", child: "", at: 0.1 });
    expect(parseCue("actor:TestBurst Destroy@2", 0).cue).toMatchObject({ kind: 1, text: "Destroy", child: "TestBurst", at: 2 });
    expect(parseCue("target AnimPlay Hit Hit NonLooping", 0).cue).toMatchObject({ kind: 2, text: "AnimPlay Hit Hit NonLooping", at: 0 });
    expect(parseCue("Two Words", 0).problem).toMatch(/neither a CSound id/);
    expect(parseCue("Marine_Yes@later", 0).problem).toMatch(/not a time/);
  });

  it("times an impact slot's plain numbers from the land", () => {
    expect(parseCue("Marine_AttackImpact@0.03", 2).cue).toMatchObject({ base: 2, at: 0.03 });
  });
});

describe("buildTestbed", () => {
  it("builds the stock example into the map's Triggers and MapScript.galaxy", async () => {
    const { spec, outMap } = await mission();
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    expect(result.built).toBe(true);
    expect(result.outMap).toBe(outMap);
    expect(result.counts).toMatchObject({ units: 3, slots: 4, variations: 22, cues: 27, files: 0 });
    const triggers = await readFile(path.join(outMap, "Triggers"), "utf8");
    expect(triggers).toContain(`<InitFunc>${INIT_FUNC}</InitFunc>`);
    const mapScript = await readFile(path.join(outMap, "MapScript.galaxy"), "utf8");
    expect(mapScript).toContain('Tb_U(0, "marine", "Marine"');
    expect(mapScript).toContain('Tb_Q(0, "Marine_Stimpack", "", 0, 0.0, 0, 0.6);');
    expect(mapScript).toContain("Tb_Init();");
    // The base map's own data is kept.
    expect(await readFile(path.join(outMap, "Base.SC2Data", "GameData", "UnitData.xml"), "utf8")).toContain('<CUnit id="Kept"/>');
    expect(existsSync(result.scriptPath)).toBe(true);
  });

  it("checks without writing the map", async () => {
    const { spec, outMap } = await mission();
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([]);
    expect(result.built).toBe(false);
    expect(existsSync(outMap)).toBe(false);
  });

  it("refuses a missing sound, an unknown unit, a bad time and a slot the spec doesn't define", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].variations.attack.push({ cues: ["Not_A_Sound", "Marine_Yes@later"] });
      s.units[1].unit = "NoSuchUnit";
      s.units[2].variations.dance = [{ cues: ["Marine_Yes"] }];
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.built).toBe(false);
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no CSound "Not_A_Sound"/),
        expect.stringMatching(/"later" .* is not a time/),
        expect.stringMatching(/no CUnit "NoSuchUnit"/),
        expect.stringMatching(/slot "dance", which the spec doesn't define/),
      ]),
    );
  });

  it("warns about a word that isn't one of SC2's animation words", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].clips.push({ name: "mega", play: "AnimPlay Attack Attack,Mega NonLooping", strike: 1 });
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/"Mega" .* is not one of SC2's animation words/)]));
  });

  it("routes the spec's own data to its catalogs, and checks the models its actors name", async () => {
    const { root, spec, outMap } = await mission();
    await writeFile(
      path.join(root, "tests", "fx.xml"),
      `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <!-- a comment the build drops -->
    <CModel id="TestBurst" parent="ImpactFX">
        <Model value="Assets\\Effects\\Other\\PhysicsImpactFleshMassive\\PhysicsImpactFleshMassive.m3"/>
    </CModel>
    <CActorModel id="TestBurst" parent="ModelAnimationStyleOneShotUNIT">
        <Model value="TestBurst"/>
        <HostSiteOps Ops="SOpAttachShield"/>
    </CActorModel>
    <CActorModel id="TestMissing" parent="ModelAddition">
        <Model value="NoSuchModel"/>
    </CActorModel>
</Catalog>
`,
    );
    await editSpec(spec, (s) => {
      s.data = ["fx.xml"];
      s.units[0].variations.death[0].cues.push("actor Create TestBurst@0.1");
    });
    const failed = await buildTestbed(spec, { workspace: null });
    expect(failed.report.errors).toEqual([expect.stringMatching(/actor model "NoSuchModel"/)]);
    await writeFile(path.join(root, "tests", "fx.xml"), (await readFile(path.join(root, "tests", "fx.xml"), "utf8")).replace(/ {4}<CActorModel id="TestMissing"[\s\S]*?<\/CActorModel>\n/, ""));
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    const models = await readFile(path.join(outMap, "Base.SC2Data", "GameData", "ModelData.xml"), "utf8");
    expect(models).toContain('<CModel id="TestBurst" parent="ImpactFX">');
    expect(models).not.toContain("a comment the build drops");
    const actors = await readFile(path.join(outMap, "Base.SC2Data", "GameData", "ActorData.xml"), "utf8");
    expect(actors).toMatch(/^<\?xml[\s\S]*<CActorModel id="TestBurst"[\s\S]*<\/Catalog>\n$/);
  });

  it("copies a spec's own sound files into the map with a CSound for them", async () => {
    const { root, spec, outMap } = await mission();
    await mkdir(path.join(root, "private", "nested"), { recursive: true });
    for (const file of ["grunt_01.wav", "grunt_02.wav", "other.wav"]) await writeFile(path.join(root, "private", "nested", file), "RIFF");
    await editSpec(spec, (s) => {
      s.roots = { mine: path.join(root, "private") };
      s.sounds = { Test_Grunt: { parent: "Combat", from: "mine:", files: ["GRUNT_0?.wav"] } };
      s.units[0].variations.voice.push({ cues: ["Test_Grunt"] });
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    expect(result.counts.files).toBe(2);
    const sounds = await readFile(path.join(outMap, "Base.SC2Data", "GameData", "SoundData.xml"), "utf8");
    expect(sounds).toContain('<CSound id="Test_Grunt" parent="Combat">');
    expect(sounds).toContain('<AssetArray File="Assets\\Sounds\\StockUnits\\grunt_01.wav"/>');
    expect(existsSync(path.join(outMap, "Assets", "Sounds", "StockUnits", "grunt_02.wav"))).toBe(true);
  });

  it("writes the map only inside an output/ folder", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.out = "../elsewhere/StockUnits.SC2Map";
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([expect.stringMatching(/not inside an output\/ folder/)]);
  });

  it("adds the tour only for a capture, each stop with its unit, clip, slot and variation", async () => {
    const { spec } = await mission();
    const plain = await buildTestbed(spec, { workspace: null, check: true });
    expect(plain.script).not.toMatch(/^\s+Tb_T\(/m);
    const toured = await buildTestbed(spec, { workspace: null, check: true, tour: true });
    expect(toured.report.errors).toEqual([]);
    expect(toured.script).toContain("Tb_T(0, 0, 0, 1, 0.5);");
    expect(toured.script).toContain("Tb_T(1, 0, 1, 0, 0.6);");
  });

  it("reports a spec that doesn't parse, with the path of each problem", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].unit = undefined;
      s.slots.attack.kind = "swing";
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^slots\.attack\.kind: /), expect.stringMatching(/^units\.0: Give a unit "unit"/)]));
  });
});
