// A Screenplay's Conversation's name (ADR-0011): Conversation/Name/<id> in enUS ObjectStrings, the
// name the Editor lists the Conversation by. The Screenplay's declaration records it, since it
// isn't the id; the compile writes it under the Equivalence Check, and convert-screenplay takes it
// from the package. All synthetic.
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertScreenplay } from "../../src/mods/convert-screenplay.js";
import { readModBlueprint } from "../../src/mods/workspace-mods.js";
import { CHARACTERS, DECLARED, declareChats, harbour } from "./harbour-chats.js";
import { cleanupMods, declare, inPackage, put } from "./mod-fixture.js";

afterEach(cleanupMods);

const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";
const NAME_KEY = "Conversation/Name/HarbourChats";
const NAME = `string:${OBJECT_STRINGS}:${NAME_KEY}`;

/** The mod's ObjectStrings as the Editor saved them, with the chats' name `name` if given, between two other names. */
const objectStrings = (name?: string, extra: readonly string[] = []) =>
  `﻿${["Sound/Name/Gull_Cry=Gull_Cry", ...(name === undefined ? [] : [`${NAME_KEY}=${name}`]), ...extra, "Conversation/Name/Ferry=Ferry Talk", ""].join("\r\n")}`;

/** The Harbour with its chats' ObjectStrings `strings` in the package. */
async function harbourNamed(strings: string) {
  const mod = await harbour();
  await put(path.join(mod.modPackage, ...OBJECT_STRINGS.split("/")), strings);
  return mod;
}

describe("a Screenplay's Conversation's name", () => {
  it("is written as Conversation/Name/<id> in ObjectStrings, equivalent to the Kept one, leaving the file's other lines as they are", async () => {
    const kept = objectStrings("Harbour: Chats");
    const mod = await harbourNamed(kept);
    await declareChats(mod, [{ ...DECLARED, name: "Harbour: Chats" }]);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toContainEqual({ item: NAME });
    expect(await inPackage(mod, OBJECT_STRINGS)).toBe(kept);
  });

  it("is compared with the Kept one, so a name the Screenplay gives otherwise differs", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declareChats(mod, [{ ...DECLARED, name: "Quay Talk" }]);

    const error = await compileMod(mod.blueprintPath).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EquivalenceError);
    expect((error as Error).message).toContain(NAME_KEY);
  });

  it("is added where the Conversation had none, and a stray key the author removes goes, the rest of the file unchanged", async () => {
    const mod = await harbourNamed(objectStrings(undefined, ["HarbourChats=Harbour Chats"]));
    await declareChats(mod, [{ ...DECLARED, name: "Harbour Chats" }]);
    await declare(mod, { removals: [{ item: `string:${OBJECT_STRINGS}:HarbourChats`, reason: "the chats' name under the wrong key" }] });

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, OBJECT_STRINGS)).toBe(`﻿Sound/Name/Gull_Cry=Gull_Cry\r\nConversation/Name/Ferry=Ferry Talk\r\n${NAME_KEY}=Harbour Chats\r\n`);
  });

  it("is refused at the compile when removals names it too, since the Screenplay writes it back", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declareChats(mod, [{ ...DECLARED, name: "Harbour: Chats" }]);
    await declare(mod, { removals: [{ item: NAME, reason: "old" }] });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(NAME_KEY);
  });

  it("isn't written when the declaration gives none, so a Kept name stays Kept", async () => {
    const kept = objectStrings("Harbour: Chats");
    const mod = await harbourNamed(kept);
    await declareChats(mod);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).not.toContainEqual({ item: NAME });
    expect(await inPackage(mod, OBJECT_STRINGS)).toBe(kept);
  });
});

describe("convert-screenplay and the name", () => {
  it("records the Kept name in the declaration, and the compile writes it equivalent", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declare(mod, { characters: CHARACTERS });

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.name).toBe("Harbour: Chats");
    expect((await readModBlueprint(mod.blueprintPath)).screenplays[0]?.name).toBe("Harbour: Chats");
    expect((await compileMod(mod.blueprintPath)).conversions).toContainEqual({ item: NAME });
  });

  it("records none when the package has none", async () => {
    const mod = await harbourNamed(objectStrings());
    await declare(mod, { characters: CHARACTERS });

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.name).toBeUndefined();
    expect((await readModBlueprint(mod.blueprintPath)).screenplays[0]).not.toHaveProperty("name");
  });

  it("takes the name out of the Blueprint's raw strings, which give it", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declare(mod, { characters: CHARACTERS, strings: { [OBJECT_STRINGS]: { [NAME_KEY]: "Harbour: Chats", "Sound/Name/Gull_Cry": "Gull_Cry" } } });

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    const blueprint = await readModBlueprint(mod.blueprintPath);
    expect(converted.name).toBe("Harbour: Chats");
    expect(blueprint.screenplays[0]?.name).toBe("Harbour: Chats");
    expect(blueprint.strings).toEqual({ [OBJECT_STRINGS]: { "Sound/Name/Gull_Cry": "Gull_Cry" } });
    expect((await compileMod(mod.blueprintPath)).conversions).toContainEqual({ item: NAME });
  });

  it("lists a raw name that differs from the Kept one, which the compile will find different", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declare(mod, { characters: CHARACTERS, strings: { [OBJECT_STRINGS]: { [NAME_KEY]: "Quay Talk" } } });

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.name).toBe("Quay Talk");
    expect(converted.textDifferences).toContainEqual({ item: NAME, kept: "Harbour: Chats", script: "Quay Talk" });
  });

  it("refuses a name that removals names, since the Screenplay would write it back", async () => {
    const mod = await harbourNamed(objectStrings("Harbour: Chats"));
    await declare(mod, { characters: CHARACTERS, removals: [{ item: NAME, reason: "old" }] });

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/removals names .*Conversation\/Name\/HarbourChats/);
    expect((await readModBlueprint(mod.blueprintPath)).screenplays).toEqual([]);
  });
});
