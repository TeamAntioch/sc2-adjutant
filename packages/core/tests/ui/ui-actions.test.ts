// A Mission's uiActions (ADR-0019): Blueprint trigger actions of the UI Components, each run at its
// cue, compiled into a call to the component's function in the Campaign Mod's library. A Mission
// using a component its Campaign Mod hasn't turned on fails its compile and `check`. The bell
// Workspace is synthetic and the component a fake (test-panel.ts).
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { campaignLibraryOf } from "../../src/mods/library.js";
import { uiActionContext } from "../../src/triggers/build-mission-triggers.js";
import { readModBlueprint } from "../../src/mods/workspace-mods.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { TEST_PANEL } from "./test-panel.js";

const BELL = fileURLToPath(new URL("../fixtures/workspaces/bell/", import.meta.url));
const uiComponents = [TEST_PANEL];
const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

const UI_ACTIONS = [
  { id: "greet", cue: { type: "missionStart" }, action: "showTestPanel", params: { title: "The Bell" } },
  { id: "farewell", cue: { type: "missionStart" }, afterSeconds: 5, action: "hideTestPanel" },
];

/** A copy of the bell Workspace, beside it so its Plugin's imports resolve, its Campaign Mod's `ui` and bell-field's uiActions set. */
async function bell(
  ui: Record<string, unknown> | undefined,
  uiActions: readonly unknown[] = UI_ACTIONS,
  editMod?: (blueprint: Record<string, any>) => void,
  editMission?: (blueprint: Record<string, any>) => void,
) {
  const root = await mkdtemp(path.join(BELL, "..", ".bell-ui-"));
  cleanup.push(root);
  await cp(BELL, root, { recursive: true });
  const edit = async (file: string, change: (blueprint: Record<string, unknown>) => void) => {
    const blueprint = JSON.parse(await readFile(file, "utf8"));
    change(blueprint);
    await writeFile(file, JSON.stringify(blueprint, null, 2));
  };
  await edit(path.join(root, "mods", "bell-story", "blueprint.json"), (blueprint) => {
    if (ui) blueprint["ui"] = ui;
    editMod?.(blueprint);
  });
  const mission = path.join(root, "missions", "bell-field", "blueprint.json");
  await edit(mission, (blueprint) => {
    blueprint["uiActions"] = uiActions;
    editMission?.(blueprint);
  });
  return { root, mission };
}

async function compile(root: string, mission: string, components = uiComponents) {
  const out = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-ui-actions-"));
  cleanup.push(out);
  const map = path.join(out, "Field.SC2Map");
  await compileMission(await loadWorkspace(root), mission, map, { uiComponents: components });
  return {
    triggers: await readFile(path.join(map, "Triggers"), "utf8"),
    script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"),
    strings: await readFile(path.join(map, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8"),
  };
}

describe("a Mission's uiActions", () => {
  it("compile into calls to the component's functions in the Campaign Mod's library, each at its cue", async () => {
    const { root, mission } = await bell({ testPanel: {} });
    const { triggers, script } = await compile(root, mission);
    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Bel1" Id="EC7798FC"/>');
    expect(triggers).toContain('<ParameterDef Type="ParamDef" Library="Bel1" Id="E49F3270"/>');
    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Bel1" Id="73F7AAE3"/>');
    const galaxy = script.replace(/\r\n/g, "\n");
    expect(galaxy).toMatch(/libBel1_gf_ShowTestPanel\(StringExternal\("Param\/Value\/[0-9A-F]{8}"\)\);/);
    expect(galaxy).toMatch(/Wait\(5\.0, c_timeGame\);\n {4}libBel1_gf_HideTestPanel\(\);/);
  });

  it("compile into a trigger of their own each, run from their cue's trigger: their Galaxy as the golden has it", async () => {
    const { root, mission } = await bell({ testPanel: {} });
    const { script, strings } = await compile(root, mission);
    expect(strings).toContain("Param/Value/F409C4B3=The Bell");
    const galaxy = script.replace(/\r\n/g, "\n");
    const start = galaxy.indexOf("//--------------------------------------------------------------------------------------------------\n// Trigger: UI Greet\n");
    const end = galaxy.indexOf("//--------------------------------------------------------------------------------------------------\n// Trigger: ", galaxy.indexOf("// Trigger: UI Farewell\n"));
    expect(galaxy.slice(start, end)).toBe(await readFile(new URL("./golden/ui-actions.galaxy", import.meta.url), "utf8"));
    expect(galaxy).toMatch(/TriggerExecute\(gt_UIGreet, true, false\);\n {4}TriggerExecute\(gt_UIFarewell, true, false\);/);
  });

  it("run from the condition trigger of an anchor's death that nothing but a uiAction reacts to", async () => {
    const ringer = { id: "ringer", name: "Ringer", zoneId: "field", kind: "unit", position: { x: 32, y: 32, z: 8 }, rotation: 0 };
    const { root, mission } = await bell({ testPanel: {} }, [{ id: "mourn", cue: { type: "anchorDies", anchorId: "ringer" }, action: "hideTestPanel" }], undefined, (blueprint) => {
      blueprint["anchors"] = [ringer];
    });
    const galaxy = (await compile(root, mission)).script.replace(/\r\n/g, "\n");
    const named = [...galaxy.matchAll(/^\/\/ Trigger: (.*)$/gm)].map((match) => match[1]);
    const condition = named.find((name) => name !== "UI Mourn" && /Ringer/.test(name!));
    expect(condition).toBeDefined();
    const fn = `gt_${condition!.replace(/[^A-Za-z0-9]/g, "")}_Func`;
    const body = galaxy.slice(galaxy.indexOf(`bool ${fn}`), galaxy.indexOf("\n}\n", galaxy.indexOf(`bool ${fn}`)));
    expect(body).toContain("TriggerExecute(gt_UIMourn, true, false);");
  });

  it("fail the compile where the Campaign Mod hasn't turned the component on", async () => {
    const { root, mission } = await bell(undefined);
    await expect(compile(root, mission)).rejects.toThrow(/uiActions\.0 \(greet\): showTestPanel is an action of the UI Component testPanel, which the Campaign Mod Bell-Story hasn't turned on: add ui\.testPanel to its Mod Blueprint/);
  });

  it("fail `check` where the Campaign Mod hasn't turned the component on, and where an action's params are wrong", async () => {
    const off = await bell(undefined);
    const { problems } = await checkWorkspace(off.root, { uiComponents });
    expect(problems).toContainEqual(expect.objectContaining({ mission: "bell-field", path: "uiActions.0", message: expect.stringMatching(/hasn't turned on: add ui\.testPanel/) }));

    const wrong = await bell({ testPanel: {} }, [{ id: "greet", cue: { type: "missionStart" }, action: "showTestPanel", params: {} }]);
    const checked = await checkWorkspace(wrong.root, { uiComponents });
    expect(checked.problems).toContainEqual(expect.objectContaining({ mission: "bell-field", path: "uiActions.0", message: expect.stringMatching(/showTestPanel's params aren't valid: title/) }));
  });

  it("fail, saying why, where the Campaign Mod's ui won't compile, which leaves a Mission with none to compile", async () => {
    // The library's own Show Test Panel takes the Galaxy name the component's function would have.
    const clash = (blueprint: Record<string, any>) => {
      blueprint.library.functions.push({ id: "0000B0A1", name: "Show Test Panel", kind: "action", gui: "library/RingBell.json" });
    };
    const quiet = await bell({ testPanel: {} }, [], clash);
    await expect(compile(quiet.root, quiet.mission)).resolves.toBeDefined();

    const loud = await bell({ testPanel: {} }, UI_ACTIONS, clash);
    await expect(compile(loud.root, loud.mission)).rejects.toThrow(/uiActions\.0 \(greet\): showTestPanel can't be called, since the Campaign Mod Bell-Story's Mod Blueprint \(mods\/bell-story\/blueprint\.json\) won't compile: The library's function Show Test Panel has the Galaxy name/);
    const { problems } = await checkWorkspace(loud.root, { uiComponents });
    expect(problems).toContainEqual(expect.objectContaining({ mission: "bell-field", path: "uiActions.0", message: expect.stringMatching(/won't compile/) }));
  });

  it("fail `check` on the Campaign Mod's ui wherever its compile would refuse it, with no Mission calling it", async () => {
    const clash = await bell({ testPanel: {} }, [], (blueprint) => {
      blueprint.library.functions.push({ id: "0000B0A1", name: "Show Test Panel", kind: "action", gui: "library/RingBell.json" });
    });
    expect((await checkWorkspace(clash.root, { uiComponents })).problems).toContainEqual(
      expect.objectContaining({ mod: "bell-story", path: "ui", message: expect.stringMatching(/The library's function Show Test Panel has the Galaxy name/) }),
    );

    const twice = { ...TEST_PANEL, functions: () => [TEST_PANEL.functions({}, { galaxyName: (name) => name })[0]!, TEST_PANEL.functions({}, { galaxyName: (name) => name })[0]!] };
    const doubled = await bell({ testPanel: {} }, []);
    expect((await checkWorkspace(doubled.root, { uiComponents: [twice] })).problems).toContainEqual(
      expect.objectContaining({ mod: "bell-story", path: "ui", message: expect.stringMatching(/testPanel has two functions whose Galaxy name/) }),
    );

    const bare = await bell({ testPanel: {} }, [], (blueprint) => {
      delete blueprint.library;
    });
    expect((await checkWorkspace(bare.root, { uiComponents })).problems).toContainEqual(
      expect.objectContaining({ mod: "bell-story", path: "ui", message: expect.stringMatching(/ui turns on testPanel, whose functions go in the mod's library: declare the library/) }),
    );
  });

  /** A Mission with no Anchors, for a call made outside one's compile. */
  const mission = uiActionContext({ anchors: [], kept: [], waves: [] });

  it("are refused where an action's args aren't of its function's parameters' types", async () => {
    const { root } = await bell({ testPanel: {} });
    const mod = await readModBlueprint(path.join(root, "mods", "bell-story", "blueprint.json"));
    const numbered = { ...TEST_PANEL, actions: { ...TEST_PANEL.actions, showTestPanel: { ...TEST_PANEL.actions.showTestPanel!, args: () => ({ title: { kind: "int" as const, value: 3 } }) } } };
    const library = campaignLibraryOf(mod.library!, "The Campaign Mod Bell-Story", "mods/bell-story/blueprint.json", [], { field: mod.ui, registry: [numbered], mod: "the Campaign Mod Bell-Story" });
    expect(() => library.uiCall!("showTestPanel", { title: "The Bell" }, mission)).toThrow(/testPanel's call of ShowTestPanel gives title a value of kind int, where its parameter's type is text/);
    const fine = campaignLibraryOf(mod.library!, "The Campaign Mod Bell-Story", "mods/bell-story/blueprint.json", [], { field: mod.ui, registry: uiComponents, mod: "the Campaign Mod Bell-Story" });
    expect(fine.uiCall!("showTestPanel", { title: "The Bell" }, mission).args).toEqual({ title: { kind: "text", text: "The Bell" } });
  });

  it("leave the Campaign Mod's components unbuilt until the library is first used", async () => {
    const { root } = await bell({ testPanel: {} });
    const mod = await readModBlueprint(path.join(root, "mods", "bell-story", "blueprint.json"));
    let built = 0;
    const counted = { ...TEST_PANEL, functions: (...args: Parameters<typeof TEST_PANEL.functions>) => (built++, TEST_PANEL.functions(...args)) };
    const library = campaignLibraryOf(mod.library!, "The Campaign Mod Bell-Story", "mods/bell-story/blueprint.json", [], { field: mod.ui, registry: [counted], mod: "the Campaign Mod Bell-Story" });
    expect(built).toBe(0);
    library.uiCall!("showTestPanel", { title: "The Bell" }, mission);
    expect(Object.keys(library.functions)).toContain("ShowTestPanel");
    library.function("RingBell");
    expect(built).toBe(1);
  });

  describe("grantHeroPower, the hero moment's story grant", () => {
    const ringer = { id: "ringer", name: "Ringer", zoneId: "field", kind: "unit", position: { x: 32, y: 32, z: 8 }, rotation: 0 };
    const grant = { id: "grant", cue: { type: "missionStart" }, action: "grantHeroPower", params: { hero: "ringer", title: "The Peal", description: "The bell rings twice." } };
    const withRinger = (blueprint: Record<string, any>) => {
      blueprint["anchors"] = [ringer];
    };

    it("compiles into a call of Grant Hero Power, the header, prompt and icon left empty when left out", async () => {
      const { root, mission } = await bell({ heroMoment: {}, choicePicker: {} }, [grant], undefined, withRinger);
      const { script, strings } = await compile(root, mission, UI_COMPONENTS);
      const galaxy = script.replace(/\r\n/g, "\n");
      expect(galaxy).toMatch(/libBel1_gf_GrantHeroPower\(UnitFromId\(\d+\), StringToText\(""\), StringToText\(""\), "", StringExternal\("Param\/Value\/[0-9A-F]{8}"\), StringExternal\("Param\/Value\/[0-9A-F]{8}"\)\);/);
      expect(strings).toMatch(/=The Peal\r?\n/);
      expect(strings).toMatch(/=The bell rings twice\.\r?\n/);
    });

    it("fails where the Campaign Mod hasn't turned the choice picker on beside the moment, or the hero isn't a unit", async () => {
      const alone = await bell({ heroMoment: {} }, [grant], undefined, withRinger);
      await expect(compile(alone.root, alone.mission, UI_COMPONENTS)).rejects.toThrow(/uiActions\.0 \(grant\): grantHeroPower calls the UI Component choicePicker's functions too, which the Campaign Mod Bell-Story hasn't turned on: add ui\.choicePicker to its Mod Blueprint/);
      const { problems } = await checkWorkspace(alone.root, { uiComponents: UI_COMPONENTS });
      expect(problems).toContainEqual(expect.objectContaining({ mission: "bell-field", path: "uiActions.0", message: expect.stringMatching(/add ui\.choicePicker/) }));

      const nobody = await bell({ heroMoment: {}, choicePicker: {} }, [{ ...grant, params: { ...grant.params, hero: "bellman" } }], undefined, withRinger);
      await expect(compile(nobody.root, nobody.mission, UI_COMPONENTS)).rejects.toThrow(/hero bellman is neither a unit Anchor nor a Kept unit/);
    });
  });

  it("pass `check` where the Campaign Mod has the component on", async () => {
    const { root } = await bell({ testPanel: {} });
    const { problems } = await checkWorkspace(root, { uiComponents });
    expect(problems.filter((problem) => problem.path?.startsWith("uiActions"))).toEqual([]);
  });
});
