// A cue on a bookmark of a Cinematic (cinematicBookmark): the `cinematic` fixture Workspace's Radio
// Field plays scene 1 as the Cinematic `radio`, whose shot list here declares a bookmark `flash`, and
// cues a scene 2 of Transmissions on it. The compiled map's MapScript.galaxy, Triggers and cutscene
// are read back, and the Workspace checked.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FLASH", "", "**NOVA** `D-01-01-02-001-NOVA`: There!", ""].join("\n");
const BOOKMARK = { name: "flash", atMs: 2000 };

type Edit = { readonly cue?: Record<string, unknown>; readonly bookmarks?: unknown[] };

async function workspace(edit: Edit = {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const cinematicFile = path.join(mission, "cinematics/radio.json");
  const cinematic = JSON.parse(await readFile(cinematicFile, "utf8"));
  cinematic.bookmarks = edit.bookmarks ?? [BOOKMARK];
  await writeFile(cinematicFile, JSON.stringify(cinematic));
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "cinematicBookmark", cinematicId: "radio", bookmark: "flash", ...edit.cue } });
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  return { root, blueprintPath };
}

async function compiled(edit: Edit = {}): Promise<{ script: string; triggers: string; cutscene: string }> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return {
    script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"),
    triggers: await readFile(path.join(map, "Triggers"), "utf8"),
    cutscene: await readFile(path.join(map, "Base.SC2Data/Cutscenes/radio.SC2Cutscene"), "utf8"),
  };
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const initOf = (script: string, name: string): string => script.slice(script.indexOf(`void gt_${name}_Init`), script.indexOf("}", script.indexOf(`void gt_${name}_Init`)));

describe("a cinematicBookmark cue", () => {
  it("writes the bookmark into the Cinematic's cutscene as <id>/<name>, at its time", async () => {
    const { cutscene } = await compiled();
    expect(cutscene).toMatch(/<CCutsceneNodeBookmark [^>]*name="Bookmarks"/);
    expect(cutscene).toMatch(/<CCutsceneElementBookmark [^>]*start="2000" bookmarkName="radio\/flash"\/>/);
  });

  it("plays its scene from a trigger that listens for the bookmark on any cutscene, once", async () => {
    const { script } = await compiled();
    const name = "CueRadioBookmarkflash";
    expect(initOf(script, name)).toContain('TriggerAddEventCutsceneBookmarkFired(gt_CueRadioBookmarkflash, c_cutsceneNone, "radio/flash");');
    const body = section(script, name);
    expect(body.indexOf("TriggerEnable(TriggerGetCurrent(), false);")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("TriggerEnable(TriggerGetCurrent(), false);")).toBeLessThan(body.indexOf('SoundLink("radio_field-2-1", -1)'));
  });

  it("is skipped by default: the Cinematic's cleanup doesn't run it", async () => {
    const { script } = await compiled();
    expect(section(script, "CinematicRadio")).not.toContain("gt_CueRadioBookmarkflash");
  });

  it("with onSkip fire, has the Cinematic's cleanup run it last, if it's still on", async () => {
    const { script } = await compiled({ cue: { onSkip: "fire" } });
    const cinematic = section(script, "CinematicRadio");
    const guard = ["if ((TriggerIsEnabled(gt_CueRadioBookmarkflashFiresOnSkip) == true)) {", "TriggerExecute(gt_CueRadioBookmarkflashFiresOnSkip, false, true);"];
    for (const piece of guard) expect(cinematic).toContain(piece);
    expect(cinematic.indexOf(guard[1]!)).toBeGreaterThan(cinematic.indexOf("CutsceneStop("));
    expect(cinematic.indexOf(guard[1]!)).toBeGreaterThan(cinematic.indexOf("libNtve_gf_CinematicMode(false"));
    // And it's still the bookmark's own trigger, so a watched run reaches it first.
    expect(initOf(script, "CueRadioBookmarkflashFiresOnSkip")).toContain('"radio/flash"');
  });

  it("is refused for a Cinematic the Blueprint doesn't list", async () => {
    const { root, blueprintPath } = await workspace({ cue: { cinematicId: "nowhere" } });
    await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "RadioField.SC2Map"))).rejects.toThrow(/nowhere, which screenplay\.script\.cinematics doesn't list/);
  });
});

describe("checking a cinematicBookmark cue", () => {
  const checked = async (edit: Edit = {}) => {
    const { root } = await workspace(edit);
    return (await checkWorkspace(root)).problems.filter((problem) => /bookmark/i.test(problem.message));
  };

  it("warns about every one, preferring a scenePlayed cue", async () => {
    const [warning] = await checked();
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toMatch(/never gets it/);
    expect(warning?.message).toMatch(/Prefer a scenePlayed cue/);
  });

  it("says a fire cue runs late for a player who skips", async () => {
    const [warning] = await checked({ cue: { onSkip: "fire" } });
    expect(warning?.message).toMatch(/as the Cinematic ends/);
  });

  it("is an error when the Cinematic declares no such bookmark", async () => {
    const found = await checked({ bookmarks: [{ name: "other", atMs: 1000 }] });
    const error = found.find((problem) => problem.severity === undefined);
    expect(error?.message).toMatch(/declares no bookmark flash \(it has other\)/);
  });
});
