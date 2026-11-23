// Strings keyed under another catalog's name that an entry still owns (#371): a unit's description,
// which the game keys Button/Tooltip/<unit> (Core's CUnit default), and a key one of its fields names
// that no entry of the key's own catalog can be given: Unit/Name/<id> named by an actor of that id
// with no unit of it, or Weapon/<name>, which has no id. convert-entries moves them with the entry
// and the compile writes them back byte for byte. The mod is synthetic.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { catalog, cleanupMods, inPackage, type Mod, put, setup, UNIT_FILE } from "./mod-fixture.js";

afterEach(cleanupMods);

const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";
const BUTTON_FILE = "Base.SC2Data/GameData/ButtonData.xml";
const ACTOR_FILE = "Base.SC2Data/GameData/ActorData.xml";
const ABIL_FILE = "Base.SC2Data/GameData/AbilData.xml";
const SOUND_FILE = "Base.SC2Data/GameData/SoundData.xml";

const at = (mod: Mod, file: string) => path.join(mod.modPackage, ...file.split("/"));
const strings = (...lines: string[]) => `﻿${lines.map((line) => `${line}\r\n`).join("")}`;
const readJson = async (mod: Mod, file: string) => JSON.parse(await readFile(path.join(mod.modDir, file), "utf8"));
const keptStrings = async (mod: Mod) => (await keptReport(mod.blueprintPath)).components.find((component) => component.component === "Strings")!.items.map((item) => item.item);

describe("a unit's description, Button/Tooltip/<unit>", () => {
  it("is the unit's when the mod has no button of its id, in whichever strings file has it, and compiles back byte for byte", async () => {
    const mod = await setup();
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Unit/Name/Barge=Barge", "Button/Tooltip/Crane=Lifts cargo.", "Button/Tooltip/Barge="));
    await put(at(mod, OBJECT_STRINGS), strings("Button/Tooltip/HarbourBase=A harbour unit."));
    const before = await Promise.all([GAME_STRINGS, OBJECT_STRINGS].map((file) => inPackage(mod, file)));

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(converted.strings).toEqual(
      expect.arrayContaining([`string:${GAME_STRINGS}:Button/Tooltip/Crane`, `string:${GAME_STRINGS}:Button/Tooltip/Barge`, `string:${OBJECT_STRINGS}:Button/Tooltip/HarbourBase`]),
    );
    const [crane, barge, base] = await readJson(mod, "entries/UnitData.json");
    expect(crane.strings[GAME_STRINGS]).toEqual({ "Unit/Name/Crane": "Crane", "Button/Tooltip/Crane": "Lifts cargo." });
    expect(barge.strings[GAME_STRINGS]).toEqual({ "Unit/Name/Barge": "Barge", "Button/Tooltip/Barge": "" });
    expect(base.strings).toEqual({ [OBJECT_STRINGS]: { "Button/Tooltip/HarbourBase": "A harbour unit." } });

    await compileMod(mod.blueprintPath);

    expect(await Promise.all([GAME_STRINGS, OBJECT_STRINGS].map((file) => inPackage(mod, file)))).toEqual(before);
    expect((await keptStrings(mod)).filter((item) => item.includes("Button/Tooltip"))).toEqual([]);
  });

  it("is the button's when the mod has a button of the unit's id: its tooltip, by its own catalog", async () => {
    const mod = await setup();
    await put(at(mod, BUTTON_FILE), catalog(`<CButton id="Crane"><Icon value="crane.dds"/></CButton>`));
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Button/Tooltip/Crane=Lifts cargo."));

    const units = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });
    const buttons = await convertEntries(mod.blueprintPath, { file: BUTTON_FILE });

    expect(units.strings).toEqual([`string:${GAME_STRINGS}:Unit/Name/Crane`]);
    expect(buttons.strings).toEqual([`string:${GAME_STRINGS}:Button/Tooltip/Crane`]);
  });

  it("isn't a unit's that sets its own Description: that names its key", async () => {
    const mod = await setup();
    await put(at(mod, UNIT_FILE), catalog(`<CUnit id="Crane"><Description value="Unit/Description/Crane"/></CUnit>`));
    await put(at(mod, GAME_STRINGS), strings("Unit/Description/Crane=Lifts cargo.", "Button/Tooltip/Crane=An old tooltip."));

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(converted.strings).toEqual([`string:${GAME_STRINGS}:Unit/Description/Crane`]);
  });
});

describe("a key a field names in another catalog's name", () => {
  it("is the entry's when the key's catalog has no entry of its id, as an actor's highlight tooltip naming its own unit's name", async () => {
    const mod = await setup();
    await put(
      at(mod, ACTOR_FILE),
      catalog(`<CActorUnit id="Buoy"><HighlightTooltip value="Unit/Name/Buoy"/></CActorUnit>`, `<CActorUnit id="CraneActor"><HighlightTooltip value="Unit/Name/Crane"/></CActorUnit>`),
    );
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Unit/Name/Barge=Barge", "Unit/Name/Buoy=Marker Buoy"));
    const before = await inPackage(mod, GAME_STRINGS);

    const actors = await convertEntries(mod.blueprintPath, { file: ACTOR_FILE });

    // Crane's name is the Crane unit's, though an actor names it.
    expect(actors.strings).toEqual([`string:${GAME_STRINGS}:Unit/Name/Buoy`]);
    const [buoy, craneActor] = await readJson(mod, "entries/ActorData.json");
    expect(buoy.strings).toEqual({ [GAME_STRINGS]: { "Unit/Name/Buoy": "Marker Buoy" } });
    expect(craneActor.strings).toBeUndefined();
    await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, GAME_STRINGS)).toBe(before);
    expect(await keptStrings(mod)).not.toContain(`string:${GAME_STRINGS}:Unit/Name/Buoy`);
  });

  it("is the unit's, not the actor's, when the mod has a unit of the actor's id", async () => {
    const mod = await setup();
    await put(at(mod, ACTOR_FILE), catalog(`<CActorUnit id="Crane"><HighlightTooltip value="Unit/Name/Crane"/></CActorUnit>`));

    const actors = await convertEntries(mod.blueprintPath, { file: ACTOR_FILE });
    const units = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(actors.strings).toEqual([]);
    expect(units.strings).toContain(`string:${GAME_STRINGS}:Unit/Name/Crane`);
  });

  it("is the entry's when the key has no id, as an ability's activity naming Weapon/<name>", async () => {
    const mod = await setup();
    await put(at(mod, ABIL_FILE), catalog(`<CAbilEffectTarget id="WinchOrder"><Activity value="Weapon/Winching"/></CAbilEffectTarget>`));
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Unit/Name/Barge=Barge", "Weapon/Winching=Winching"));

    const converted = await convertEntries(mod.blueprintPath, { file: ABIL_FILE });

    expect(converted.strings).toEqual([`string:${GAME_STRINGS}:Weapon/Winching`]);
    const before = await inPackage(mod, GAME_STRINGS);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, GAME_STRINGS)).toBe(before);
  });

  it("isn't the entry's when it names another entry's id: a sound's subtitle is its conversation's line", async () => {
    const mod = await setup();
    await put(at(mod, SOUND_FILE), catalog(`<CSound id="Quay-01"><AssetArray Subtitle="Conversation/Quay/Line00001"/></CSound>`));
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Unit/Name/Barge=Barge", "Conversation/Quay/Line00001=Mind the gap."));

    const converted = await convertEntries(mod.blueprintPath, { file: SOUND_FILE });

    expect(converted.strings).toEqual([]);
  });
});
