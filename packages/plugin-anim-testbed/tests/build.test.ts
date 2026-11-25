// The build: cues and times, a map from the stock example, and the checks that stop a build.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildTestbed, INIT_FUNC, parseCue, parseTime, readMoment } from "../build.ts";

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
    expect(parseCue("effect Marauder_PunisherGrenadesLM@strike", 0).cue).toMatchObject({ kind: 3, text: "Marauder_PunisherGrenadesLM", base: 1 });
    expect(parseCue("effect Two Words", 0).problem).toMatch(/not "effect <CEffect id>"/);
    expect(parseCue("effect Boom~1", 0).problem).toMatch(/only a sound can have/);
    expect(parseCue("Marine_Yes@later", 0).problem).toMatch(/not a time/);
    expect(parseCue("actor Create TestBurst@0.1~1", 0).problem).toMatch(/only a sound can have/);
  });

  it("times a moment's plain numbers from its from", () => {
    expect(parseCue("Marine_AttackImpact@0.03", 2).cue).toMatchObject({ base: 2, at: 0.03 });
  });

  it("keeps a unit's key as a cue's target and on <event> as a time, not built yet", () => {
    const keys = new Set(["zealot"]);
    expect(parseCue("zealot:Blade Destroy@1", 0, keys).problem).toMatch(/kept for several units, not built yet/);
    expect(parseCue("zealot AnimPlay Hit Hit", 0, keys).problem).toMatch(/kept for several units/);
    expect(parseCue("Marine_AttackImpact@on impact", 0).problem).toMatch(/kept for actor events, not built yet/);
  });
});

describe("moments", () => {
  const keys = new Set(["marine"]);
  const moment = (def: Record<string, string>) => readMoment("m", { at: "unit", from: "start", ...def }, keys);

  it("reads do, at and from, with none as the cues alone", () => {
    expect(moment({}).moment).toEqual({ do: "none", at: "unit", from: "start" });
    expect(moment({ do: "play", at: "target", from: "land" }).moment).toEqual({ do: "play", at: "target", from: "land" });
    expect(moment({ do: "kill" }).moment).toEqual({ do: "kill", at: "unit", from: "start" });
  });

  it("refuses an animation's time on a moment that plays none, do hit, and spellings it doesn't know", () => {
    expect(moment({ do: "kill", from: "strike" }).problems).toEqual([expect.stringMatching(/needs do "play"/)]);
    expect(moment({ from: "land" }).problems).toEqual([expect.stringMatching(/needs do "play"/)]);
    expect(moment({ do: "hit" }).problems).toEqual([expect.stringMatching(/do "hit" is gone: give the unit a hit animation with "clear"/)]);
    expect(moment({ do: "dance" }).problems).toEqual([expect.stringMatching(/do "dance" is not one of play, kill/)]);
    expect(moment({ at: "corpse" }).problems).toEqual([expect.stringMatching(/at "corpse" is not one of unit, target/)]);
  });

  it("keeps order <ability>, a unit's key and on <event>, not built yet", () => {
    expect(moment({ do: "order Stimpack" }).problems).toEqual([expect.stringMatching(/kept for a unit's abilities, not built yet/)]);
    expect(moment({ at: "marine" }).problems).toEqual([expect.stringMatching(/kept for several units, not built yet/)]);
    expect(moment({ do: "play", from: "on strike" }).problems).toEqual([expect.stringMatching(/kept for actor events, not built yet/)]);
  });
});

describe("buildTestbed", () => {
  it("builds the stock example into the map's Triggers and MapScript.galaxy", async () => {
    const { spec, outMap } = await mission();
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    expect(result.built).toBe(true);
    expect(result.outMap).toBe(outMap);
    expect(result.counts).toMatchObject({ units: 3, moments: 4, variations: 22, cues: 27, files: 0 });
    const triggers = await readFile(path.join(outMap, "Triggers"), "utf8");
    expect(triggers).toContain(`<InitFunc>${INIT_FUNC}</InitFunc>`);
    const mapScript = await readFile(path.join(outMap, "MapScript.galaxy"), "utf8");
    expect(mapScript).toContain('Tb_U(0, "marine", "Marine"');
    expect(mapScript).toContain('Tb_Q(0, "Marine_Stimpack", "", 0, 0.0, 0, 0.6);');
    // Each moment's do, at and from: attack plays at the unit from the start; impact plays at the target from the land; death kills; voice is the cues alone.
    expect(mapScript).toContain('Tb_M(0, "attack", 1, 0, 0);');
    expect(mapScript).toContain('Tb_M(1, "impact", 1, 1, 2);');
    expect(mapScript).toContain('Tb_M(2, "death", 2, 0, 0);');
    expect(mapScript).toContain('Tb_M(3, "voice", 0, 0, 0);');
    // Each unit's animations, its animation for each moment, and each variation tagged by what it holds.
    expect(mapScript).toContain('Tb_A(0, 0, "attack", "AnimPlay Attack Attack NonLooping", 0.1, 0.15, 1.15, 0.0, false, "marine_attack");');
    expect(mapScript).toContain('const string TB_TUNE_BANK = "AnimTuneStockUnits";');
    expect(mapScript).toContain("Tb_UM(0, 1, 0);");
    expect(mapScript).toContain('Tb_V(0, 0, "the Marine\'s own rifle burst  [sound]", "the Marine\'s own rifle burst", true, -1);');
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

  it("refuses a missing sound, an unknown unit, a bad time and a moment the spec doesn't define", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].moments.attack.variations.push({ cues: ["Not_A_Sound", "Marine_Yes@later"] });
      s.units[1].unit = "NoSuchUnit";
      s.units[2].moments.dance = { variations: [{ cues: ["Marine_Yes"] }] };
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.built).toBe(false);
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no CSound "Not_A_Sound"/),
        expect.stringMatching(/"later" .* is not a time/),
        expect.stringMatching(/no CUnit "NoSuchUnit"/),
        expect.stringMatching(/moment "dance", which the spec doesn't define/),
      ]),
    );
  });

  it("warns about a word that isn't one of SC2's animation words", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].animations.mega = { play: "AnimPlay Attack Attack,Mega NonLooping", strike: 1 };
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/"Mega" .* is not one of SC2's animation words/)]));
  });

  it("runs an effect cue, checked against the spec's own effects and warned about otherwise", async () => {
    const { root, spec } = await mission();
    await writeFile(path.join(root, "tests", "fx.xml"), '<Catalog>\n    <CEffectDamage id="TestPunch"/>\n</Catalog>\n');
    await editSpec(spec, (s) => {
      s.data = ["fx.xml"];
      s.units[2].moments.impact.variations.push({ cues: ["effect TestPunch@0.1", "effect Marauder_StockGuess"] });
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([]);
    expect(result.report.warnings).toEqual([expect.stringMatching(/"Marauder_StockGuess" is not one of the spec's or the Workspace's effects/)]);
    expect(result.script).toContain('Tb_Q(3, "TestPunch", "", 2, 0.1, -1, 0.0);');
  });

  it("refuses a moment's problems as build errors", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.moments.attack = { do: "swing" };
      s.moments.impact.at = "zealot";
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([expect.stringMatching(/moment attack: do "swing"/), expect.stringMatching(/moment impact: at "zealot", a unit's key, is kept for several units/)]);
  });

  it("lets a moment and a variation choose the unit's animation, and refuses one it doesn't have", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].animations.flinch = { play: "AnimPlay Damage Damage NonLooping", clear: 0.4 };
      s.moments.hit = { do: "play" };
      s.units[0].moments.hit = { anim: "flinch", variations: [{ cues: ["Marine_Yes"] }] };
      s.units[0].moments.attack.variations.push({ cues: [], anim: "flinch", note: "the flinch instead" });
    });
    const good = await buildTestbed(spec, { workspace: null, check: true });
    expect(good.report.errors).toEqual([]);
    expect(good.script).toContain('Tb_A(0, 1, "flinch", "AnimPlay Damage Damage NonLooping", 0.0, 0.0, 1.4, 0.4, true, "marine_flinch");');
    expect(good.script).toContain("Tb_UM(0, 4, 1);");
    expect(good.script).toContain('Tb_V(0, 0, "the flinch instead  [anim]", "the flinch instead", false, 1);');
    await editSpec(spec, (s) => {
      s.units[0].moments.hit.anim = "cower";
      s.units[0].moments.death.variations[0].anim = "flinch";
    });
    const bad = await buildTestbed(spec, { workspace: null, check: true });
    expect(bad.report.errors).toEqual([expect.stringMatching(/marine death 1: an "anim", but moment death plays none/), expect.stringMatching(/marine hit: marine has no animation "cower" \(it has attack, flinch\)/)]);
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
      s.units[0].moments.death.variations[0].cues.push("actor Create TestBurst@0.1");
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
      s.units[0].moments.voice.variations.push({ cues: ["Test_Grunt"] });
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    expect(result.counts.files).toBe(2);
    const sounds = await readFile(path.join(outMap, "Base.SC2Data", "GameData", "SoundData.xml"), "utf8");
    expect(sounds).toContain('<CSound id="Test_Grunt" parent="Combat">');
    expect(sounds).toContain('<AssetArray File="Assets\\Sounds\\StockUnits\\Test_Grunt\\grunt_01.wav"/>');
    expect(existsSync(path.join(outMap, "Assets", "Sounds", "StockUnits", "Test_Grunt", "grunt_02.wav"))).toBe(true);
  });

  it("refuses a sound file name found in two of the folder's subfolders", async () => {
    const { root, spec } = await mission();
    for (const sub of ["a", "b"]) {
      await mkdir(path.join(root, "private", sub), { recursive: true });
      await writeFile(path.join(root, "private", sub, "grunt_01.wav"), "RIFF");
    }
    await editSpec(spec, (s) => {
      s.sounds = { Test_Grunt: { from: path.join(root, "private"), files: ["grunt_01.wav"] } };
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([expect.stringMatching(/more than one file .* is named grunt_01\.wav/)]);
  });

  it("refuses a control character, a repeated key, a new unit named as a stock one, an unclosed data element and a tour animation the unit lacks", async () => {
    const { root, spec } = await mission();
    await writeFile(path.join(root, "tests", "bad.xml"), '<Catalog>\n    <CModel id="Open">\n        <Model value="x"/>\n</Catalog>\n');
    await editSpec(spec, (s) => {
      s.units[0].moments.attack.variations[0].note = "two\nlines";
      s.units[2].key = "marine";
      s.units.push({ key: "custom", new: { id: "Zergling", model: "nothing.m3" } });
      s.data = ["bad.xml"];
      s.tour = [{ unit: "zealot", moment: "voice", anim: "lunge", hold: 0.5 }];
    });
    const result = await buildTestbed(spec, { workspace: null, check: true, tour: true });
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^units\.0\.moments\.attack\.variations\.0\.note: holds a line break/),
        expect.stringMatching(/the key "marine" is given twice/),
        expect.stringMatching(/"Zergling" is already a unit/),
        expect.stringMatching(/bad\.xml: <CModel> .* has no closing <\/CModel>/),
        expect.stringMatching(/tour stop 1: zealot has no animation "lunge"/),
      ]),
    );
  });

  it("writes the map beside the base map, in its output/, when the spec gives no out", async () => {
    const { root, spec } = await mission();
    await editSpec(spec, (s) => {
      delete s.out;
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.outMap).toBe(path.join(root, "output", "StockUnits.SC2Map"));
  });

  it("writes the map only inside an output/ folder", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.out = "../elsewhere/StockUnits.SC2Map";
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([expect.stringMatching(/not inside an output\/ folder/)]);
  });

  it("adds the tour only for a capture, each stop with its unit, moment, animation and variation", async () => {
    const { spec } = await mission();
    const plain = await buildTestbed(spec, { workspace: null, check: true });
    expect(plain.script).not.toMatch(/^\s+Tb_T\(/m);
    const toured = await buildTestbed(spec, { workspace: null, check: true, tour: true });
    expect(toured.report.errors).toEqual([]);
    expect(toured.script).toContain("Tb_T(0, 0, -1, 1, 0.5);");
    expect(toured.script).toContain("Tb_T(1, 1, -1, 0, 0.6);");
  });

  it("reports a spec that doesn't parse, with the path of each problem", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].unit = undefined;
      s.moments.attack = { kind: "clip" };
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^moments\.attack: Unrecognized key/), expect.stringMatching(/^units\.0: Give a unit "unit"/)]));
  });
});
