// The build: elements and times, a map from the stock example, and the checks that stop a build.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildTestbed, INIT_FUNC, momentNames, readElement } from "../build.ts";

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

describe("elements", () => {
  const keys = new Set(["zealot"]);
  const el = (e: Record<string, unknown>) => readElement({ at: 0, ...e } as never, keys);

  it("reads each kind at seconds from Play, with a stop, a place and muted", () => {
    expect(el({ anim: "attack" }).element).toEqual({ kind: "anim", what: "attack", on: "unit", child: "", at: 0, stop: -1, muted: false });
    expect(el({ sound: "Marine_Stimpack", at: 0.1, stop: 0.6, muted: true }).element).toEqual({ kind: "sound", what: "Marine_Stimpack", on: "unit", child: "", at: 0.1, stop: 0.6, muted: true });
    expect(el({ sound: "Marine_AttackImpact", at: 0.15, on: "target" }).element).toMatchObject({ on: "target" });
    expect(el({ actor: "Destroy", at: 2, on: "TestBurst" }).element).toMatchObject({ kind: "actor", what: "Destroy", on: "child", child: "TestBurst" });
    expect(el({ effect: "TestPunch", at: 0.2 }).element).toMatchObject({ kind: "effect", what: "TestPunch" });
    expect(el({ kill: true, at: 0.5 }).element).toMatchObject({ kind: "kill", what: "", at: 0.5 });
  });

  it("refuses no kind or two, a stop where none goes or before the time, and a place the kind can't take", () => {
    expect(el({}).problem).toMatch(/says no kind/);
    expect(el({ sound: "A", anim: "b" }).problem).toMatch(/it is anim and sound/);
    expect(el({ effect: "Boom", stop: 1 }).problem).toMatch(/a effect has no stop/);
    expect(el({ sound: "A", at: 1, stop: 0.5 }).problem).toMatch(/not after its time/);
    expect(el({ sound: "A", on: "Burst" }).problem).toMatch(/only an actor message goes to a child actor/);
    expect(el({ anim: "attack", on: "target" }).problem).toMatch(/a anim can't go on the target/);
    expect(el({ sound: "Two Words" }).problem).toMatch(/not a CSound id/);
    expect(el({ sound: "A", at: "strike" }).problem).toMatch(/is not a time: give seconds from Play/);
  });

  it("keeps order, a unit's key as a place and on <event> as a time, not built yet", () => {
    expect(el({ order: "Stimpack" }).problem).toMatch(/kept for a unit's abilities, not built yet/);
    expect(el({ actor: "Destroy", on: "zealot" }).problem).toMatch(/kept for several units, not built yet/);
    expect(el({ sound: "A", at: "on impact" }).problem).toMatch(/kept for actor events, not built yet/);
  });

  it("orders the moments by the spec's list, else as the units first name them", () => {
    const units = [{ moments: { attack: {}, death: {} } }, { moments: { voice: {}, attack: {} } }] as never;
    expect(momentNames({ units }).names).toEqual(["attack", "death", "voice"]);
    expect(momentNames({ units, moments: ["voice", "attack", "death"] }).names).toEqual(["voice", "attack", "death"]);
    expect(momentNames({ units, moments: ["attack", "attack"] }).problems).toEqual([expect.stringMatching(/"attack" is listed twice/), expect.stringMatching(/moment "death", which the list leaves out/), expect.stringMatching(/moment "voice"/)]);
  });
});

describe("buildTestbed", () => {
  it("builds the stock example into the map's Triggers and MapScript.galaxy", async () => {
    const { spec, outMap } = await mission();
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual([]);
    expect(result.built).toBe(true);
    expect(result.outMap).toBe(outMap);
    expect(result.counts).toMatchObject({ units: 3, moments: 4, variations: 22, elements: 43, files: 0 });
    const triggers = await readFile(path.join(outMap, "Triggers"), "utf8");
    expect(triggers).toContain(`<InitFunc>${INIT_FUNC}</InitFunc>`);
    const mapScript = await readFile(path.join(outMap, "MapScript.galaxy"), "utf8");
    expect(mapScript).toContain('Tb_U(0, "marine", "Marine"');
    // Moments are names; each variation is followed by its elements: kind, what, animation, place, child, at, stop, muted.
    expect(mapScript).toContain('Tb_M(0, "attack");');
    expect(mapScript).toContain('Tb_M(3, "voice");');
    expect(mapScript).toContain('Tb_A(0, 0, "attack", "AnimPlay Attack Attack NonLooping", 0.1, 0.15, 1.15);');
    expect(result.script).toMatch(/Tb_V\(0, 0, "the Marine's own rifle burst", "the Marine's own rifle burst", true\);\n {4}Tb_E\(0, "attack", 0, 0, "", 0\.0, -1\.0, false, 1, "e[0-9a-f]{8}"\);\n {4}Tb_E\(1, "Marine_AttackLaunch", -1, 0, "", 0\.1, -1\.0, false, 1, "e[0-9a-f]{8}"\);/);
    expect(mapScript).toContain('Tb_E(1, "Marine_Stimpack", -1, 0, "", 0.0, 0.6, false, 1, "e');
    expect(mapScript).toContain('Tb_E(1, "Marine_AttackImpact", -1, 1, "", 0.15, -1.0, false, 1, "e');
    expect(mapScript).toContain('Tb_E(4, "", -1, 0, "", 0.0, -1.0, false, 1, "e');
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

  it("refuses a missing sound, an unknown unit, a bad time, an animation the unit lacks and a moment the list leaves out", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].moments.attack.variations.push({ elements: [{ sound: "Not_A_Sound" }, { sound: "Marine_Yes", at: "later" }, { anim: "cower" }, { kill: true }, { kill: true, at: 1 }] });
      s.units[1].unit = "NoSuchUnit";
      s.units[2].moments.dance = { variations: [{ elements: [{ sound: "Marine_Yes" }] }] };
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.built).toBe(false);
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/marine attack 3, element 1: no CSound "Not_A_Sound"/),
        expect.stringMatching(/element 2: at "later" is not a time/),
        expect.stringMatching(/element 3: marine has no animation "cower" \(it has attack\)/),
        expect.stringMatching(/marine attack 3: more than one kill/),
        expect.stringMatching(/no CUnit "NoSuchUnit"/),
        expect.stringMatching(/moment "dance", which the list leaves out/),
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

  it("runs an effect, checked against the spec's own effects and warned about otherwise", async () => {
    const { root, spec } = await mission();
    await writeFile(path.join(root, "tests", "fx.xml"), '<Catalog>\n    <CEffectDamage id="TestPunch"/>\n</Catalog>\n');
    await editSpec(spec, (s) => {
      s.data = ["fx.xml"];
      s.units[2].moments.impact.variations.push({ elements: [{ effect: "TestPunch", at: 0.1 }, { effect: "Marauder_StockGuess" }] });
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([]);
    expect(result.report.warnings).toEqual([expect.stringMatching(/"Marauder_StockGuess" is not one of the spec's or the Workspace's effects/)]);
    expect(result.script).toContain('Tb_E(2, "TestPunch", -1, 0, "", 0.1, -1.0, false, 1, "e');
  });

  it("plays another of the unit's animations in a variation, cleared at its stop, and tags it", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].animations.flinch = { play: "AnimPlay Damage Damage NonLooping" };
      s.units[0].moments.attack.variations.push({ elements: [{ anim: "flinch", at: 0, stop: 0.4 }, { sound: "Marine_Yes", at: 0.1 }], note: "the flinch instead" });
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([]);
    expect(result.script).toContain('Tb_A(0, 1, "flinch", "AnimPlay Damage Damage NonLooping", 0.0, 0.0, 1.0);');
    expect(result.script).toContain('Tb_E(0, "flinch", 1, 0, "", 0.0, 0.4, false, 1, "e');
  });

  it("names the tuning bank, counts a repeated element's occurrence, gives each its own section and warns past the dialog's rows", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].moments.attack.variations.push({ elements: Array.from({ length: 11 }, (_, i) => ({ sound: "Marine_Yes", at: i / 10 })) });
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual([]);
    expect(result.tuneBank).toBe("AnimTuneStockUnits");
    expect(result.script).toContain('const string TB_TUNE_BANK = "AnimTuneStockUnits";');
    expect(result.script).toContain('Tb_E(1, "Marine_Yes", -1, 0, "", 0.1, -1.0, false, 2, "e');
    const sections = [...result.script!.matchAll(/Tb_E\(.*, "(e[0-9a-f]{8}(?:_\d+)?)"\);/g)].map((m) => m[1]);
    expect(sections.length).toBe(result.counts.elements);
    expect(new Set(sections).size).toBe(sections.length);
    expect(result.report.warnings).toContain("marine attack 3: 11 elements, and the dialog shows the first 10; the rest play but can't be tuned in the game");
  });

  it("refuses the old moment definitions and cues, saying where they went", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.moments = { attack: { do: "play" } };
      s.units[0].moments.attack.variations[0] = { cues: ["Marine_Yes"] };
      s.units[0].animations.attack.clear = 0.4;
    });
    const result = await buildTestbed(spec, { workspace: null, check: true });
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^moments: .*moments are names only now/),
        expect.stringMatching(/^units\.0\.moments\.attack\.variations\.0: Unrecognized key.*cues are now "elements"/),
        expect.stringMatching(/^units\.0\.animations\.attack: Unrecognized key.*clear is now the "stop"/),
      ]),
    );
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
      s.units[0].moments.death.variations[0].elements.push({ actor: "Create TestBurst", at: 0.1 });
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
      s.units[0].moments.voice.variations.push({ elements: [{ sound: "Test_Grunt" }] });
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

  it("refuses a control character, a repeated key, a new unit named as a stock one, an unclosed data element and a tour variation the unit lacks", async () => {
    const { root, spec } = await mission();
    await writeFile(path.join(root, "tests", "bad.xml"), '<Catalog>\n    <CModel id="Open">\n        <Model value="x"/>\n</Catalog>\n');
    await editSpec(spec, (s) => {
      s.units[0].moments.attack.variations[0].note = "two\nlines";
      s.units[2].key = "marine";
      s.units.push({ key: "custom", new: { id: "Zergling", model: "nothing.m3" } });
      s.data = ["bad.xml"];
      s.tour = [{ unit: "zealot", moment: "voice", variation: 5, hold: 0.5 }];
    });
    const result = await buildTestbed(spec, { workspace: null, check: true, tour: true });
    expect(result.report.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^units\.0\.moments\.attack\.variations\.0\.note: holds a line break/),
        expect.stringMatching(/the key "marine" is given twice/),
        expect.stringMatching(/"Zergling" is already a unit/),
        expect.stringMatching(/bad\.xml: <CModel> .* has no closing <\/CModel>/),
        expect.stringMatching(/tour stop 1: zealot has no voice variation 5/),
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

  it("adds the tour only for a capture, each stop with its unit, moment and variation", async () => {
    const { spec } = await mission();
    const plain = await buildTestbed(spec, { workspace: null, check: true });
    expect(plain.script).not.toMatch(/^\s+Tb_T\(/m);
    const toured = await buildTestbed(spec, { workspace: null, check: true, tour: true });
    expect(toured.report.errors).toEqual([]);
    expect(toured.script).toContain("Tb_T(0, 0, 1, 0.5);");
    expect(toured.script).toContain("Tb_T(1, 1, 0, 0.6);");
  });

  it("reports a spec that doesn't parse, with the path of each problem", async () => {
    const { spec } = await mission();
    await editSpec(spec, (s) => {
      s.units[0].unit = undefined;
      s.units[1].moments.attack.variations[0].elements[0].kind = "clip";
    });
    const result = await buildTestbed(spec, { workspace: null });
    expect(result.report.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^units\.1\.moments\.attack\.variations\.0\.elements\.0: Unrecognized key/), expect.stringMatching(/^units\.0: Give a unit "unit"/)]));
  });
});
