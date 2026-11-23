// The boss bar, core's UI Component `ui.bossBar` (spec #582 decision 8, ADR-0019): a hidden frame
// at the top centre of ConsoleUIContainer in LotV's boss-bar textures, with Show, Hide and Flash
// functions in the mod's library and a refresh loop in its script, and the showBossBar and
// hideBossBar actions Missions call. Harbour-Story and the bell Workspace are synthetic.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { DESC_INDEX } from "../../src/mods/mod-package-files.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { uiComponentsOn } from "../../src/ui/components.js";
import { componentUi, modFramePathWarnings } from "../../src/ui/frame-path-check.js";
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { cleanupMods, declare, hashTree, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");
const LAYOUT = "Base.SC2Data/UI/Layout/BossBar.SC2Layout";

const cleanup: string[] = [];
afterEach(async () => {
  await cleanupMods();
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Harbour-Story with its library's Ring Bell converted, and `ui`. */
async function harbour(ui: Record<string, unknown>) {
  const mod = await setup();
  await withHarbourLibrary(mod);
  await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
  await declare(mod, { ui });
  return mod;
}

describe("the boss bar's layout", () => {
  it("is core's, written from its default look in LotV's boss-bar textures, and loaded by the DescIndex", async () => {
    expect(UI_COMPONENTS.map((component) => component.id)).toContain("bossBar");
    const mod = await harbour({ bossBar: {} });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, LAYOUT)).toBe(await golden("BossBar-default.SC2Layout"));
    expect(await inPackage(mod, DESC_INDEX)).toContain(`<Include path="UI/Layout/BossBar.SC2Layout"/>`);
  });

  it("takes the look's overrides: its textures, title style, colours and anchor", async () => {
    const mod = await harbour({
      bossBar: { border: "Assets\\Textures\\ui_quay_frame.dds", fill: "@UI/QuayFill", titleStyle: "QuayTitle", shieldColor: [10, 20, 30], markColor: [1, 2, 3], anchor: { at: "topLeft", x: 40, y: 60 } },
    });
    await compileMod(mod.blueprintPath);
    const layout = await inPackage(mod, LAYOUT);
    expect(layout).toContain(`<Texture val="Assets\\Textures\\ui_quay_frame.dds"/>`);
    expect(layout.match(/<Texture val="@UI\/QuayFill"\/>/g)).toHaveLength(2);
    expect(layout).toContain(`<Style val="QuayTitle"/>`);
    expect(layout).toContain(`<Color val="10,20,30"/>`);
    expect(layout.match(/<Color val="1,2,3"\/>/g)).toHaveLength(4);
    expect(layout).toContain(`<Anchor side="Top" relative="$parent" pos="Min" offset="60"/>\r\n            <Anchor side="Left" relative="$parent" pos="Min" offset="40"/>`);
  });
});

describe("the boss bar's functions", () => {
  /** The generated part of the library's Galaxy: the boss bar's script, its functions and their declarations. */
  async function generated(mod: Awaited<ReturnType<typeof harbour>>): Promise<string> {
    const script = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
    const header = (await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).replace(/\r\n/g, "\n");
    const custom = script.slice(script.indexOf("// Custom Script\n"), script.indexOf("// Presets"));
    const functions = script.slice(script.indexOf("void libHbr1_gf_ShowBossBar"), script.indexOf("// Triggers"));
    return `${custom}${functions}${header.split(/(?<=\n)/).filter((line) => line.includes("BossBar")).join("")}`;
  }

  it("go in the mod's library: Show, Hide and Flash Boss Bar, and the script holding its state and refresh loop, as the golden has them", async () => {
    const mod = await harbour({ bossBar: {} });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod)).toBe(await golden("BossBar-Lib.galaxy"));
    const strings = await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    for (const name of ["Show Boss Bar", "Hide Boss Bar", "Flash Boss Bar", "Unit", "Title", "Colour", "Mark 1", "Mark 4"]) expect(strings).toMatch(new RegExp(`=${name}\\r\\n`));
  });

  it("change nothing on a recompile", async () => {
    const mod = await harbour({ bossBar: {} });
    await compileMod(mod.blueprintPath);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("hook up only frames its layout has, so the frame-path check passes them", async () => {
    const mod = await harbour({ bossBar: {} });
    await compileMod(mod.blueprintPath);
    const on = uiComponentsOn({ bossBar: {} }, UI_COMPONENTS);
    expect(await modFramePathWarnings(mod.modPackage, componentUi(on, mod.blueprintPath, "Hbr1"))).toEqual([]);
  });
});

describe("a Mission's showBossBar and hideBossBar", () => {
  const BELL = fileURLToPath(new URL("../fixtures/workspaces/bell/", import.meta.url));
  const BOSS = { id: "tide-lord", name: "Tide Lord", zoneId: "field", kind: "unit", position: { x: 32, y: 32, z: 0 }, rotation: 0, unitType: "Zeratul", player: 2 };

  /** A copy of the bell Workspace with ui.bossBar on, the Tide Lord placed in bell-field, and its uiActions. */
  async function bell(uiActions: readonly unknown[]) {
    const root = await mkdtemp(path.join(BELL, "..", ".bell-boss-"));
    cleanup.push(root);
    await cp(BELL, root, { recursive: true });
    const edit = async (file: string, change: (blueprint: Record<string, unknown>) => void) => {
      const blueprint = JSON.parse(await readFile(file, "utf8"));
      change(blueprint);
      await writeFile(file, JSON.stringify(blueprint, null, 2));
    };
    await edit(path.join(root, "mods", "bell-story", "blueprint.json"), (blueprint) => {
      blueprint["ui"] = { bossBar: {} };
    });
    const mission = path.join(root, "missions", "bell-field", "blueprint.json");
    await edit(mission, (blueprint) => {
      blueprint["anchors"] = [BOSS];
      blueprint["uiActions"] = uiActions;
    });
    return { root, mission };
  }

  async function script(root: string, mission: string): Promise<string> {
    const out = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-boss-bar-"));
    cleanup.push(out);
    const map = path.join(out, "Field.SC2Map");
    await compileMission(await loadWorkspace(root), mission, map);
    return (await readFile(path.join(map, "MapScript.galaxy"), "utf8")).replace(/\r\n/g, "\n");
  }

  it("call Show Boss Bar with the unit, title, colour and up to four phase marks, the rest 0, and Hide Boss Bar", async () => {
    const { root, mission } = await bell([
      { id: "boss", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-lord", title: "The Tide Lord", color: [200, 0, 0], phaseMarks: [0.75, 0.5] } },
      { id: "boss-gone", cue: { type: "missionStart" }, afterSeconds: 30, action: "hideBossBar" },
    ]);
    const galaxy = await script(root, mission);
    expect(galaxy).toMatch(/libBel1_gf_ShowBossBar\(UnitFromId\(\d+\), StringExternal\("Param\/Value\/[0-9A-F]{8}"\), Color\(78\.43, 0\.00, 0\.00\), 0\.75, 0\.5, 0\.0, 0\.0\);/);
    expect(galaxy).toMatch(/Wait\(30\.0, c_timeGame\);\n {4}libBel1_gf_HideBossBar\(\);/);
  });

  it("give the bar LotV's green when no colour is given", async () => {
    const { root, mission } = await bell([{ id: "boss", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-lord", title: "The Tide Lord" } }]);
    expect(await script(root, mission)).toMatch(/libBel1_gf_ShowBossBar\(UnitFromId\(\d+\), StringExternal\("Param\/Value\/[0-9A-F]{8}"\), Color\(16\.08, 81\.57, 0\.00\), 0\.0, 0\.0, 0\.0, 0\.0\);/);
  });

  it("fail `check` for a unit that isn't one of the Mission's, more than four marks, and a mark outside the bar", async () => {
    const { root } = await bell([
      { id: "nobody", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-king", title: "The Tide King" } },
      { id: "many", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-lord", title: "The Tide Lord", phaseMarks: [0.8, 0.6, 0.4, 0.3, 0.2] } },
      { id: "outside", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-lord", title: "The Tide Lord", phaseMarks: [1] } },
    ]);
    const { problems } = await checkWorkspace(root);
    const at = (index: number) => problems.find((problem) => problem.path === `uiActions.${index}`)?.message;
    expect(at(0)).toMatch(/^unit tide-king is neither a unit Anchor nor a Kept unit of the Mission/);
    expect(at(1)).toMatch(/showBossBar's params aren't valid: phaseMarks/);
    expect(at(2)).toMatch(/showBossBar's params aren't valid: phaseMarks\.0/);
  });

  it("fail the compile for a unit that isn't one of the Mission's, naming the action and its param", async () => {
    const { root, mission } = await bell([{ id: "nobody", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-king", title: "The Tide King" } }]);
    await expect(script(root, mission)).rejects.toThrow(/uiActions\.0 \(nobody\): unit tide-king is neither a unit Anchor nor a Kept unit of the Mission/);
  });

  it("fail the compile and `check` where the Campaign Mod's library has a Custom Script named BossBar, the boss bar's script's name", async () => {
    const { root, mission } = await bell([{ id: "boss", cue: { type: "missionStart" }, action: "showBossBar", params: { unit: "tide-lord", title: "The Tide Lord" } }]);
    const file = path.join(root, "mods", "bell-story", "blueprint.json");
    const blueprint = JSON.parse(await readFile(file, "utf8"));
    blueprint.library.customScripts = [...(blueprint.library.customScripts ?? []), { id: "0000D020", name: "BossBar", script: "int bellTolls;" }];
    await writeFile(file, JSON.stringify(blueprint, null, 2));
    await expect(compileMod(file)).rejects.toThrow(/The library's Custom Script BossBar has the name a UI Component's script is given/);
    await expect(script(root, mission)).rejects.toThrow(/The library's Custom Script BossBar has the name a UI Component's script is given/);
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message)).toContainEqual(expect.stringMatching(/The library's Custom Script BossBar has the name a UI Component's script is given/));
  });
});
