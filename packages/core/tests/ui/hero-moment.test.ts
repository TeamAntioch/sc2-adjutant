// The hero moment, core's UI Component `ui.heroMoment` (spec #652 decisions 2, 5, 6, 7, 8, 9 and
// 11): no layout; Begin Hero Moment (which waits its turn and returns whether it played), End Hero
// Moment, Hero Moment Is Playing and Flash Hero in the mod's library; the script holding the
// freeze, the camera and its sway, the hidden game UI and the glow; and the toast's queue and the
// boss bar deferring to a moment when they're on beside it. Harbour-Story is synthetic.
import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { DESC_INDEX } from "../../src/mods/mod-package-files.js";
import { componentLibrary, uiComponentsOn } from "../../src/ui/components.js";
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { componentUi, modFramePathWarnings } from "../../src/ui/frame-path-check.js";
import { cleanupMods, declare, hashTree, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";

const golden = async (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");

afterEach(cleanupMods);

/** Harbour-Story with its library's Ring Bell converted, and `ui`. */
async function harbour(ui: Record<string, unknown>) {
  const mod = await setup();
  await withHarbourLibrary(mod);
  await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
  await declare(mod, { ui });
  return mod;
}

type Mod = Awaited<ReturnType<typeof harbour>>;

/** The generated part of the library's Galaxy: the components' scripts, their functions from `first` on, and the header's lines naming `keep`. */
async function generated(mod: Mod, first: string, keep: RegExp): Promise<string> {
  const script = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
  const header = (await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).replace(/\r\n/g, "\n");
  const custom = script.slice(script.indexOf("// Custom Script\n"), script.indexOf("// Presets"));
  const functions = script.slice(script.indexOf(first), script.indexOf("// Triggers"));
  return `${custom}${functions}${header.split(/(?<=\n)/).filter((line) => keep.test(line)).join("")}`;
}

describe("the hero moment", () => {
  it("is core's, and writes no layout and adds nothing to the DescIndex", async () => {
    expect(UI_COMPONENTS.map((component) => component.id)).toContain("heroMoment");
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    await expect(inPackage(mod, "Base.SC2Data/UI/Layout/HeroMoment.SC2Layout")).rejects.toThrow();
    expect(await inPackage(mod, DESC_INDEX).catch(() => "")).not.toContain("HeroMoment");
  });

  it("has Begin Hero Moment and Hero Moment Is Playing returning a value, and End Hero Moment, the line's hold and release and Flash Hero as actions", () => {
    const library = componentLibrary("Hbr1", uiComponentsOn({ heroMoment: {} }, UI_COMPONENTS));
    expect(library.functions.map((fn) => [fn.name, fn.kind, fn.returns?.type, fn.flags, fn.parameters.map((parameter) => parameter.name)])).toEqual([
      ["Begin Hero Moment", "function", "bool", [], ["Hero"]],
      ["End Hero Moment", "action", undefined, [], []],
      ["Hero Moment Is Playing", "function", "bool", [], []],
      ["Hold Hero Moments For Line", "action", undefined, [], []],
      ["Release Hero Moments After Line", "action", undefined, [], []],
      ["Flash Hero", "action", undefined, ["createThread"], ["Hero"]],
    ]);
  });

  it("goes in the mod's library with the script holding the freeze, the camera, the game UI and the glow, as the golden has them", async () => {
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod, "bool libHbr1_gf_BeginHeroMoment", /HeroMoment|FlashHero/)).toBe(await golden("HeroMoment-Lib.galaxy"));
    const strings = await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    for (const name of ["Begin Hero Moment", "End Hero Moment", "Hero Moment Is Playing", "Hold Hero Moments For Line", "Release Hero Moments After Line", "Flash Hero", "Hero"]) expect(strings).toMatch(new RegExp(`=${name}\\r\\n`));
  });

  it("puts on the mod's aura and glaze when the look names them, and fades them in a thread of their own, as the golden has them", async () => {
    const mod = await harbour({ heroMoment: { auraModel: "QuayAura", glazeActor: "QuayGlaze" } });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod, "bool libHbr1_gf_BeginHeroMoment", /HeroMoment|FlashHero/)).toBe(await golden("HeroMoment-Glow-Lib.galaxy"));
  });

  it("owns the count of in-play lines holding moments off, which Begin waits on beside cinematic mode and another moment", async () => {
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).toContain("int libHbr1_ui_heroMoment_linesPlaying;");
    expect(galaxy).toMatch(/while \(libHbr1_ui_heroMoment_InCinematic\(\) \|\| libHbr1_ui_heroMoment_playing \|\| \(libHbr1_ui_heroMoment_linesPlaying > 0\)\) \{/);
    // A line's hold waits out a moment playing, then counts the line in, and its release counts it out (#656).
    expect(galaxy).toMatch(/void libHbr1_gf_HoldHeroMomentsForLine \(\) \{[^}]*while \(libHbr1_ui_heroMoment_playing\) \{[^}]*\}\s*libHbr1_ui_heroMoment_linesPlaying \+= 1;/);
    expect(galaxy).toMatch(/void libHbr1_gf_ReleaseHeroMomentsAfterLine \(\) \{[^}]*if \(libHbr1_ui_heroMoment_linesPlaying > 0\) \{\s*libHbr1_ui_heroMoment_linesPlaying -= 1;/);
  });

  it("takes the look's sting, camera, sway, timings, models, tint and glaze into the script", async () => {
    const mod = await harbour({
      heroMoment: {
        stingSounds: ["Quay_Sting"],
        camera: { distance: 11, pitch: 30, yawOffset: -20, heightOffset: 1.5, zoomSeconds: 1.2 },
        sway: { yaw: 3, height: 0.5, yawSeconds: 6, heightSeconds: 7 },
        handBackSeconds: 0.6,
        glowFadeSeconds: 3,
        burstModel: "QuayBurst",
        auraModel: "QuayAura",
        auraTint: [10, 20, 30],
        auraHdr: 2,
        glazeActor: "QuayGlaze",
        flashModel: "QuayFlash",
        flashScale: 3,
        flashSound: "Quay_Flash",
      },
    });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    for (const line of [
      `SoundPlayForPlayer(SoundLink("Quay_Sting", -1), c_maxPlayers, PlayerGroupAll(), 100.0, 0.0);`,
      "CameraSetValue(libHbr1_ui_heroMoment_player, c_cameraValueDistance, 11.0, 1.2, -1.0, 10.0);",
      "CameraSetValue(libHbr1_ui_heroMoment_player, c_cameraValuePitch, 30.0, 1.2, -1.0, 10.0);",
      "libHbr1_ui_heroMoment_baseYaw = (CameraGetYaw(libHbr1_ui_heroMoment_player) + -20.0);",
      "CameraSetValue(libHbr1_ui_heroMoment_player, c_cameraValueHeightOffset, 1.5, 1.2, -1.0, 10.0);",
      "CameraSetValue(libHbr1_ui_heroMoment_player, c_cameraValueYaw, (libHbr1_ui_heroMoment_baseYaw + 3.0 * lv_yawWay), 6.0, -1.0, 10.0);",
      "CameraSetValue(libHbr1_ui_heroMoment_player, c_cameraValueHeightOffset, (1.5 + 0.5 * lv_heightWay), 7.0, -1.0, 10.0);",
      "Wait(0.6, c_timeReal);",
      "ActorSend(lv_aura, libNtve_gf_SetOpacity(0.0, 3.0));",
      "ActorSend(lv_glaze, libNtve_gf_SetOpacity(0.0, 3.0));",
      `libNtve_gf_AttachModelToUnit(libHbr1_ui_heroMoment_hero, "QuayBurst", "Ref_Origin");`,
      `libNtve_gf_AttachModelToUnit(libHbr1_ui_heroMoment_hero, "QuayAura", "Ref_Origin");`,
      "ActorSend(libHbr1_ui_heroMoment_aura, libNtve_gf_SetTintColor(Color(3.92, 7.84, 11.76), 2.0, 0.0));",
      `libNtve_gf_SendActorMessageToUnit(libHbr1_ui_heroMoment_hero, "Create QuayGlaze");`,
      `libHbr1_ui_heroMoment_glaze = ActorFromScope(ActorScopeFromUnit(libHbr1_ui_heroMoment_hero), "QuayGlaze");`,
      `libNtve_gf_AttachModelToUnit(lp_hero, "QuayFlash", "Ref_Center");`,
      "ActorSend(lv_flash, libNtve_gf_SetScale(3.0, 3.0, 3.0, 0.0));",
      `SoundPlayForPlayer(SoundLink("Quay_Flash", -1), c_maxPlayers, PlayerGroupAll(), 100.0, 0.0);`,
    ])
      expect(galaxy).toContain(line);
    expect(galaxy).not.toContain("UI_AC_Zeratul_BladeOn");
  });

  it("leaves out the aura and the glaze when the look names none, as by default", async () => {
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).not.toContain("libHbr1_ui_heroMoment_aura =");
    expect(galaxy).not.toContain("ActorFromScope");
  });

  it("refuses three sting sounds, a sound or model that isn't an id, a fade or a scale of 0, and a look field it doesn't have", async () => {
    for (const heroMoment of [
      { stingSounds: ["A", "B", "C"] },
      { stingSounds: [] },
      { flashSound: 'Pop"); Crash("' },
      { auraModel: "Quay Aura" },
      { glazeActor: 'Glaze"' },
      { glowFadeSeconds: 0 },
      { flashScale: 0 },
      { glazeTint: [1, 2, 3] },
    ]) {
      const mod = await harbour({ heroMoment });
      await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/heroMoment/);
    }
  });

  it("adds Grant Hero Power, an action, only beside the choice picker, whose functions it calls", () => {
    const alone = componentLibrary("Hbr1", uiComponentsOn({ heroMoment: {} }, UI_COMPONENTS));
    expect(alone.functions.map((fn) => fn.name)).not.toContain("Grant Hero Power");
    const beside = componentLibrary("Hbr1", uiComponentsOn({ heroMoment: {}, choicePicker: {} }, UI_COMPONENTS));
    const grant = beside.functions.find((fn) => fn.name === "Grant Hero Power");
    expect([grant?.kind, grant?.returns, grant?.parameters.map((parameter) => parameter.name)]).toEqual(["action", undefined, ["Hero", "Header", "Prompt", "Icon", "Title", "Description"]]);
  });

  it("grants a power through the whole moment and a one-card picker, changing no level, and doing nothing if Begin gives false", async () => {
    // Either order of `ui` makes the one function.
    for (const ui of [{ heroMoment: {}, choicePicker: {} }, { choicePicker: {}, heroMoment: {} }]) {
      const mod = await harbour(ui);
      await compileMod(mod.blueprintPath);
      const galaxy = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
      const start = galaxy.indexOf("void libHbr1_gf_GrantHeroPower (unit lp_hero, text lp_header, text lp_prompt, string lp_icon, text lp_title, text lp_description) {");
      expect(start).toBeGreaterThan(-1);
      const body = galaxy.slice(start, galaxy.indexOf("\n}\n", start));
      expect(body).toContain(
        [
          "    if (!libHbr1_gf_BeginHeroMoment(lp_hero)) {",
          "        return;",
          "    }",
          "    libHbr1_gf_SetChoiceOption(1, lp_icon, lp_title, lp_description);",
          "    libHbr1_gf_ShowChoicePicker(lp_header, lp_prompt, 1);",
          "    libHbr1_gf_EndHeroMoment();",
        ].join("\n"),
      );
      expect(body).not.toMatch(/Level|Experience|XP/);
      expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toContain("void libHbr1_gf_GrantHeroPower (unit lp_hero, text lp_header, text lp_prompt, string lp_icon, text lp_title, text lp_description);");
    }
  });

  it("changes nothing on a recompile", async () => {
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("hooks up no frames, so the frame-path check passes it", async () => {
    const mod = await harbour({ heroMoment: {} });
    await compileMod(mod.blueprintPath);
    const on = uiComponentsOn({ heroMoment: {} }, UI_COMPONENTS);
    expect(await modFramePathWarnings(mod.modPackage, componentUi(on, mod.blueprintPath, "Hbr1"))).toEqual([]);
  });
});

describe("the toast and the boss bar beside a hero moment", () => {
  const UI_FUNCTIONS = /BossBar|Toast|HeroMoment|FlashHero/;

  it("hold the toast's queue and hide the boss bar while a moment plays, as the golden has them", async () => {
    const mod = await harbour({ bossBar: {}, toast: {}, heroMoment: {} });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod, "void libHbr1_gf_ShowBossBar", UI_FUNCTIONS)).toBe(await golden("HeroMoment-BossBar-Toast-Lib.galaxy"));
  });

  it("defer the same whichever order `ui` turns them on in", async () => {
    const mod = await harbour({ heroMoment: {}, toast: {}, bossBar: {} });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).toContain("while ((libHbr1_ui_toast_InCinematic() || libHbr1_gf_HeroMomentIsPlaying())) {");
    expect(galaxy).toContain("DialogControlSetVisible(libHbr1_ui_bossBar_panel, PlayerGroupAll(), !libHbr1_gf_HeroMomentIsPlaying());");
  });

  it("are as they are alone without it", async () => {
    const mod = await harbour({ bossBar: {}, toast: {} });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).not.toContain("HeroMoment");
  });
});
