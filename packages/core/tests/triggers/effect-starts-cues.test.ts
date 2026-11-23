// A cue on an Anchor's unit starting a data effect (effectStarts, #488): the `cinematic` fixture
// Workspace's Radio Field with a Zealot raider whose strike is a made-up effect, `RaidStrikeDamage`.
// The compiled map's MapScript.galaxy and Triggers are read back.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENES = ["", "## Scene 2: THE STRIKE", "", "**NOVA** `D-01-01-02-001-NOVA`: She's hit the depot.", "", "## Scene 3: LATER", "", "**NOVA** `D-01-01-03-001-NOVA`: Again.", ""].join("\n");

const unit = (id: string, x: number, unitType = "Marine", player = 1) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), zoneId: "near", kind: "unit", unitType, player, position: { x, y: 10, z: 0 }, rotation: 0 });
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const STRIKE = { type: "effectStarts", anchorId: "raider", effectId: "RaidStrikeDamage" };

async function workspace(edit: (blueprint: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.zones = [{ id: "near", name: "Near", elevation: 1, landform: "flat", role: "base", polygon: square(0, 0, 32) }];
  blueprint.anchors = [unit("nova", 10), unit("raider", 20, "Zealot", 2), { id: "spot", name: "Spot", zoneId: "near", kind: "point", position: { x: 5, y: 5 } }];
  edit(blueprint);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any) => void): Promise<{ script: string; triggers: string }> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return { script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"), triggers: await readFile(path.join(map, "Triggers"), "utf8") };
}

async function problems(edit: (blueprint: any) => void): Promise<string> {
  const { root } = await workspace(edit);
  return (await checkWorkspace(root)).problems.map((problem) => problem.message).join("\n");
}

const NAME = "CueRaiderStartsRaidStrikeDamage";
const KEPT = "gv_cue_unit_raider_starts_raidstrikedamage";
const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const init = (script: string, name: string): string => script.slice(script.indexOf(`void gt_${name}_Init`), script.indexOf("}", script.indexOf(`void gt_${name}_Init`)));
const SCENE = (number: number) => `SoundLink("radio_field-${number}-1", -1)`;
/** The name of the trigger that plays `needle` (a scene's sound). */
const triggerKeeping = (script: string, needle: string): string => /bool gt_(\w+)_Func/.exec(script.slice(script.lastIndexOf("bool gt_", script.indexOf(needle))))![1]!;

describe("a cue on an Anchor's unit starting a data effect", () => {
  it("fires once on the effect, for any player, when its caster is the Anchor's unit", async () => {
    const { script } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }));
    // Any player's, so a unit that has changed hands still fires it.
    expect(init(script, NAME)).toContain(`TriggerAddEventPlayerEffectUsed(gt_${NAME}, c_playerAny, "RaidStrikeDamage");`);
    const cue = section(script, NAME);
    expect(cue).toContain("(EventPlayerEffectUsedUnit(c_effectUnitCaster) != null)");
    expect(cue).toContain(`(EventPlayerEffectUsedUnit(c_effectUnitCaster) == UnitFromId(${stableObjectId("raider")}))`);
    const off = cue.indexOf("TriggerEnable(TriggerGetCurrent(), false);");
    expect(off).toBeGreaterThan(cue.indexOf("c_effectUnitCaster"));
    expect(cue.indexOf(SCENE(2))).toBeGreaterThan(off);
  });

  it("keeps the effect's target unit, or its caster for an effect on a point, before what it plays", async () => {
    const { script } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }));
    expect(script).toContain(`unit ${KEPT};`);
    const cue = section(script, NAME);
    const target = cue.indexOf(`${KEPT} = EventPlayerEffectUsedUnit(c_effectUnitTarget);`);
    const none = cue.indexOf(`if ((${KEPT} == null)) {`);
    const caster = cue.indexOf(`${KEPT} = EventPlayerEffectUsedUnit(c_effectUnitCaster);`);
    expect(target).toBeGreaterThan(-1);
    expect(none).toBeGreaterThan(target);
    expect(caster).toBeGreaterThan(none);
    expect(cue.indexOf(SCENE(2))).toBeGreaterThan(caster);
  });

  it("is one trigger for the same Anchor and effect, playing each scene cued on it", async () => {
    const { script } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }, { scene: 3, cue: STRIKE }));
    expect(script.match(new RegExp(`TriggerAddEventPlayerEffectUsed\\(gt_${NAME},`, "g"))).toHaveLength(1);
    const cue = section(script, NAME);
    expect(cue).toContain(SCENE(2));
    expect(cue).toContain(SCENE(3));
  });

  it.each([
    ["StrikeA", "strikea", "strikea"],
    ["Strike-Hit", "Strike_Hit", "strike_hit"],
  ])("keeps the units of two effects on one Anchor apart when their names would be one global: %s and %s", async (first, second, piece) => {
    const strike = (effectId: string) => ({ type: "effectStarts", anchorId: "raider", effectId });
    const { script } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: strike(first) }, { scene: 3, cue: strike(second) }));
    const kept = [...script.matchAll(/^unit (gv_cue_unit_raider_starts_\w+);/gm)].map((match) => match[1]!);
    expect(kept).toHaveLength(2);
    expect(new Set(kept).size).toBe(2);
    // Each takes its path's element id after the name both would give, and its cue's trigger keeps its own.
    for (const name of kept) expect(name).toMatch(new RegExp(`^gv_cue_unit_raider_starts_${piece}_[0-9a-f]{8}$`));
    expect(section(script, triggerKeeping(script, SCENE(2)))).toContain(`${kept[0]} = EventPlayerEffectUsedUnit(c_effectUnitTarget);`);
    expect(section(script, triggerKeeping(script, SCENE(3)))).toContain(`${kept[1]} = EventPlayerEffectUsedUnit(c_effectUnitTarget);`);
  });

  it("keeps the name its cue gives when no other cue gives it", async () => {
    const { script } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }, { scene: 3, cue: { type: "effectStarts", anchorId: "raider", effectId: "OtherStrike" } }));
    expect(script).toContain(`unit ${KEPT};`);
    expect(script).toContain("unit gv_cue_unit_raider_starts_otherstrike;");
  });

  it("compiles the event, the event's units and the effect's link as NativeLib's", async () => {
    const { triggers } = await compiled((blueprint) => blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }));
    for (const id of ["9FFA06A7", "BADA9C08"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    for (const id of ["090AE922", "6ABB7B54", "2999701E"]) expect(triggers).toContain(`Library="Ntve" Id="${id}"`);
  });

  it("warns of an effect no data the checks read defines, and not of the game's", async () => {
    const { root } = await workspace((blueprint) =>
      blueprint.screenplay.script.cues.push({ scene: 2, cue: STRIKE }, { scene: 3, cue: { type: "effectStarts", anchorId: "raider", effectId: "250mmStrikeCannonsDamage" } }),
    );
    const found = (await checkWorkspace(root)).problems.filter((problem) => problem.message.includes("isn't an effect"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", path: expect.stringMatching(/^screenplay\.script\.cues\.\d+\.cue\.effectId$/) });
    expect(found[0]!.message).toMatch(/^RaidStrikeDamage isn't an effect the Catalog has \(data\/tech-catalog\.json/);
  });

  it("is refused on an Anchor that isn't a unit, or with no effect", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push(
        { scene: 2, cue: { type: "effectStarts", anchorId: "zeratul", effectId: "RaidStrikeDamage" } },
        { scene: 2, cue: { type: "effectStarts", anchorId: "spot", effectId: "RaidStrikeDamage" } },
      );
    });
    expect(found).toContain("Unknown unit anchor id: zeratul");
    expect(found).toContain("Unknown unit anchor id: spot");
    const unnamed = await problems((blueprint) => blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "effectStarts", anchorId: "raider", effectId: "" } }));
    expect(unnamed).toMatch(/Too small: expected string to have >=1 characters/);
  });
});
