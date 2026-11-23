// The toast, core's UI Component `ui.toast` (spec #582 decision 9, ADR-0019): a hidden panel at the
// right edge in the upper third of ConsoleUIContainer, in core's own textures and font styles, with
// an icon, a one-line title and two lines of text, which slides in and fades out; Show Toast in the mod's
// library, which queues toasts and plays them one at a time, holding any back while cinematic mode
// is on; and the showToast action Missions call. Harbour-Story and the bell Workspace are synthetic.
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
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { TOAST_TEXT_MAX, TOAST_TITLE_WIDTH, titleWidth } from "../../src/ui/toast.js";
import { componentUi, modFramePathWarnings } from "../../src/ui/frame-path-check.js";
import { cleanupMods, declare, hashTree, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");
const LAYOUT = "Base.SC2Data/UI/Layout/Toast.SC2Layout";

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

describe("the toast's layout", () => {
  it("is core's, written from its default look in core's toast background and font styles, and loaded by the DescIndex", async () => {
    expect(UI_COMPONENTS.map((component) => component.id)).toContain("toast");
    const mod = await harbour({ toast: {} });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, LAYOUT)).toBe(await golden("Toast-default.SC2Layout"));
    expect(await inPackage(mod, DESC_INDEX)).toContain(`<Include path="UI/Layout/Toast.SC2Layout"/>`);
  });

  it("takes the look's overrides: its background, icon, font styles and anchor", async () => {
    const mod = await harbour({
      toast: { background: "@UI/QuayToast", icon: "Assets\\Textures\\btn-quay-bell.dds", titleStyle: "QuayTitle", textStyle: "QuayText", anchor: { at: "right", x: -20, y: -150 } },
    });
    await compileMod(mod.blueprintPath);
    const layout = await inPackage(mod, LAYOUT);
    expect(layout).toContain(`<Texture val="@UI/QuayToast"/>`);
    expect(layout).toContain(`<Texture val="Assets\\Textures\\btn-quay-bell.dds"/>`);
    expect(layout).toContain(`<Style val="QuayTitle"/>`);
    expect(layout).toContain(`<Style val="QuayText"/>`);
    expect(layout).toContain(
      [
        `<Anchor side="Top" relative="$parent" pos="Mid" offset="-150"/>`,
        `            <Anchor side="Bottom" relative="$parent" pos="Mid" offset="-150"/>`,
        `            <Anchor side="Right" relative="$parent" pos="Max" offset="-20"/>`,
      ].join("\r\n"),
    );
  });

  it("refuses an anchor off the right edge, which it can't slide in from, and an asset key for its icon", async () => {
    for (const toast of [{ anchor: { at: "topLeft" } }, { anchor: { at: "centre" } }, { icon: "@UI/QuayIcon" }]) {
      const mod = await harbour({ toast });
      await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/right edge|asset key/);
    }
  });

  it("refuses a look field it doesn't have", async () => {
    const mod = await harbour({ toast: { colour: [1, 2, 3] } });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/toast/);
  });
});

describe("the toast's function", () => {
  /** The generated part of the library's Galaxy: the toast's script, Show Toast and its declaration. */
  async function generated(mod: Awaited<ReturnType<typeof harbour>>): Promise<string> {
    const script = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
    const header = (await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).replace(/\r\n/g, "\n");
    const custom = script.slice(script.indexOf("// Custom Script\n"), script.indexOf("// Presets"));
    const functions = script.slice(script.indexOf("void libHbr1_gf_ShowToast"), script.indexOf("// Triggers"));
    return `${custom}${functions}${header.split(/(?<=\n)/).filter((line) => line.includes("Toast")).join("")}`;
  }

  it("goes in the mod's library: Show Toast, and the script holding its queue and the loop that plays it, as the golden has them", async () => {
    const mod = await harbour({ toast: {} });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod)).toBe(await golden("Toast-Lib.galaxy"));
    const strings = await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    for (const name of ["Show Toast", "Icon", "Title", "Text", "Sound"]) expect(strings).toMatch(new RegExp(`=${name}\\r\\n`));
  });

  it("takes the look's default icon and sound into the script, for a toast given none", async () => {
    const mod = await harbour({ toast: { icon: "Assets\\Textures\\btn-quay-bell.dds", sound: "Quay_Bell" } });
    await compileMod(mod.blueprintPath);
    const galaxy = await generated(mod);
    expect(galaxy).toContain(`"Assets\\\\Textures\\\\btn-quay-bell.dds"`);
    expect(galaxy).toContain(`"Quay_Bell"`);
  });

  it("change nothing on a recompile", async () => {
    const mod = await harbour({ toast: {} });
    await compileMod(mod.blueprintPath);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("hooks up only frames its layout has, so the frame-path check passes them", async () => {
    const mod = await harbour({ toast: {} });
    await compileMod(mod.blueprintPath);
    const on = uiComponentsOn({ toast: {} }, UI_COMPONENTS);
    expect(await modFramePathWarnings(mod.modPackage, componentUi(on, mod.blueprintPath, "Hbr1"))).toEqual([]);
  });

  it("sits beside the boss bar in one library, each with its own script", async () => {
    const mod = await harbour({ bossBar: {}, toast: {} });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).toContain("// Custom Script: BossBar");
    expect(galaxy).toContain("// Custom Script: Toast");
    expect(galaxy).toContain("void libHbr1_gf_ShowBossBar");
    expect(galaxy).toContain("void libHbr1_gf_ShowToast");
  });
});

describe("a toast title's width", () => {
  it("weighs wide letters, capitals and narrow ones against an ordinary letter, as seen in game", () => {
    expect(titleWidth("toast three")).toBe(11);
    expect(titleWidth("Master of Western Waters")).toBe(26.4);
    expect(titleWidth("Master of Western Waters")).toBeLessThanOrEqual(TOAST_TITLE_WIDTH);
    expect(titleWidth("W".repeat(24))).toBeGreaterThan(TOAST_TITLE_WIDTH);
    expect(titleWidth("ill.")).toBe(2);
  });
});

describe("a Mission's showToast", () => {
  const BELL = fileURLToPath(new URL("../fixtures/workspaces/bell/", import.meta.url));

  /** A copy of the bell Workspace with `ui` in its mod, and the Mission's uiActions. */
  async function bell(uiActions: readonly unknown[], ui: Record<string, unknown> = { toast: {} }) {
    const root = await mkdtemp(path.join(BELL, "..", ".bell-toast-"));
    cleanup.push(root);
    await cp(BELL, root, { recursive: true });
    const edit = async (file: string, change: (blueprint: Record<string, unknown>) => void) => {
      const blueprint = JSON.parse(await readFile(file, "utf8"));
      change(blueprint);
      await writeFile(file, JSON.stringify(blueprint, null, 2));
    };
    await edit(path.join(root, "mods", "bell-story", "blueprint.json"), (blueprint) => {
      blueprint["ui"] = ui;
    });
    const mission = path.join(root, "missions", "bell-field", "blueprint.json");
    await edit(mission, (blueprint) => {
      blueprint["uiActions"] = uiActions;
    });
    return { root, mission };
  }

  async function script(root: string, mission: string): Promise<string> {
    const out = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-toast-"));
    cleanup.push(out);
    const map = path.join(out, "Field.SC2Map");
    await compileMission(await loadWorkspace(root), mission, map);
    return (await readFile(path.join(map, "MapScript.galaxy"), "utf8")).replace(/\r\n/g, "\n");
  }

  it("calls Show Toast with the icon, title, text and sound", async () => {
    const { root, mission } = await bell([
      { id: "rung", cue: { type: "missionStart" }, afterSeconds: 5, action: "showToast", params: { icon: "Assets\\Textures\\btn-quay-bell.dds", title: "Bell Ringer", text: "You rang the harbour bell.", sound: "UI_ObjectiveComplete" } },
    ]);
    expect(await script(root, mission)).toMatch(
      /Wait\(5\.0, c_timeGame\);\n {4}libBel1_gf_ShowToast\("Assets\\\\Textures\\\\btn-quay-bell\.dds", StringExternal\("Param\/Value\/[0-9A-F]{8}"\), StringExternal\("Param\/Value\/[0-9A-F]{8}"\), "UI_ObjectiveComplete"\);/,
    );
  });

  it("leaves the icon and sound empty when none are given, so the toast plays the mod's defaults", async () => {
    const { root, mission } = await bell([{ id: "rung", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang the harbour bell." } }]);
    expect(await script(root, mission)).toMatch(/libBel1_gf_ShowToast\("", StringExternal\("Param\/Value\/[0-9A-F]{8}"\), StringExternal\("Param\/Value\/[0-9A-F]{8}"\), ""\);/);
  });

  it("fails `check` without a title, for a line break, for a title or text too long to show whole, and when the mod hasn't turned the toast on", async () => {
    const { root } = await bell([
      { id: "untitled", cue: { type: "missionStart" }, action: "showToast", params: { text: "You rang the harbour bell." } },
      { id: "broken", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang\nthe harbour bell." } },
      { id: "long-title", cue: { type: "missionStart" }, action: "showToast", params: { title: "W".repeat(15), text: "You rang the harbour bell." } },
      { id: "long-text", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "r".repeat(TOAST_TEXT_MAX + 1) } },
      { id: "markup", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang<n/>the harbour bell." } },
      { id: "title-markup", cue: { type: "missionStart" }, action: "showToast", params: { title: '<c val="ff0000">Bell</c>', text: "You rang the harbour bell." } },
      { id: "quoted-sound", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang the harbour bell.", sound: 'Bell"); Crash("' } },
      { id: "asset-key", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang the harbour bell.", icon: "@UI/QuayIcon" } },
      { id: "at-limits", cue: { type: "missionStart" }, action: "showToast", params: { title: "Master of Western Waters", text: "r".repeat(TOAST_TEXT_MAX) } },
    ]);
    const { problems } = await checkWorkspace(root);
    const at = (index: number) => problems.find((problem) => problem.path === `uiActions.${index}`)?.message;
    expect(at(0)).toMatch(/showToast's params aren't valid: title/);
    expect(at(1)).toMatch(/showToast's params aren't valid: text.*line breaks/);
    expect(at(2)).toMatch(new RegExp(`title.*27 ordinary letters wide, over the ${TOAST_TITLE_WIDTH}`));
    expect(at(3)).toMatch(new RegExp(`text.*${TOAST_TEXT_MAX} characters at most`));
    expect(at(4)).toMatch(/text.*No text markup/);
    expect(at(5)).toMatch(/title.*No text markup/);
    expect(at(6)).toMatch(/sound.*A Sound's id/);
    expect(at(7)).toMatch(/icon.*asset key/);
    expect(at(8)).toBeUndefined();

    const off = await bell([{ id: "rung", cue: { type: "missionStart" }, action: "showToast", params: { title: "Bell Ringer", text: "You rang the harbour bell." } }], { bossBar: {} });
    expect((await checkWorkspace(off.root)).problems.find((problem) => problem.path === "uiActions.0")?.message).toMatch(/hasn't turned on: add ui\.toast/);
  });
});
