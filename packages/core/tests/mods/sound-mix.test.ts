// Sound mixes (src/mods/sound-mix.ts, docs/reference/sound-mixes.md): several CSounds played as one
// sound, each from its own time, as one CActorSound's Layers, with an actor of its own for each
// layer that stops; and the check that every CSound they play is defined somewhere.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { schemaProblems } from "../../src/mods/catalog-schema.js";
import { connect, text } from "../mcp/harness.js";
import { cleanupMods, declare, setup } from "./mod-fixture.js";
import { checkSoundMixes, definedSounds, SILENT_SOUND, type SoundMix, soundMixEntries, SoundMixFileSchema, soundMixWiring, soundMixXml } from "../../src/mods/sound-mix.js";

const layer = (sound: string, at: number) => ({ Sound: { value: sound }, PitchSource: { value: "Sound" }, PlayDelaySource: { value: "Actor" }, VolumeSource: { value: "Sound" }, Chance: { value: 100 }, PlayDelay: { value: `${Math.round(at * 1000)},${Math.round(at * 1000)}` } });
const PLACED = { Host: { Subject: "::Creator" }, SoundFlags: { index: "UpdateVisibility", value: 0 } };
const LET_GO = { Terms: "ActorCreation", Send: "RefClear ::Host" };

const death: SoundMix = {
  id: "GolemDeathMix",
  layers: [
    { sound: "Separatist_Death_Evis_BloodSpray", at: 0.1 },
    { sound: "Blood_Spurt", at: 0.12 },
    { sound: "Terran_CovertOps_Large_Metal_Impact", at: 0.67 },
  ],
};

describe("a sound mix's actors", () => {
  it("are one CActorSound, its layers each a Layer after its time, playing Blizzard's silent sound when none starts at 0", () => {
    expect(soundMixEntries(death)).toEqual([
      {
        catalog: "Actor",
        class: "CActorSound",
        id: "GolemDeathMix",
        parent: "SoundOneShot",
        fields: { Sound: SILENT_SOUND, Layers: [layer("Separatist_Death_Evis_BloodSpray", 0.1), layer("Blood_Spurt", 0.12), layer("Terran_CovertOps_Large_Metal_Impact", 0.67)], ...PLACED, On: [LET_GO] },
      },
    ]);
  });

  it("play the first layer at 0 as the actor's own sound", () => {
    const [actor] = soundMixEntries({ id: "Mix", layers: [{ sound: "B", at: 0.2 }, { sound: "A", at: 0 }, { sound: "C", at: 0 }] });
    expect(actor!.fields.Sound).toBe("A");
    expect(actor!.fields.Layers).toEqual([layer("B", 0.2), layer("C", 0)]);
  });

  it("play the silent sound the mix names, when it names one", () => {
    expect(soundMixEntries({ ...death, silent: "MySilence" })[0]!.fields.Sound).toBe("MySilence");
  });

  it("give a layer that stops an actor of its own, created with the mix, that fades out from its stop and then goes", () => {
    const entries = soundMixEntries({ id: "Punch", layers: [{ sound: "ChargeUp", at: 0.1, stop: 2.67, fade: 0.25 }, { sound: "Swing", at: 2.67 }] });
    expect(entries).toEqual([
      { catalog: "Actor", class: "CActorSound", id: "Punch", parent: "SoundOneShot", fields: { Sound: SILENT_SOUND, Layers: [layer("Swing", 2.67)], ...PLACED, On: [{ Terms: "ActorCreation", Send: "Create Punch_1" }, LET_GO] } },
      {
        catalog: "Actor",
        class: "CActorSound",
        id: "Punch_1",
        parent: "SoundOneShot",
        fields: {
          Sound: SILENT_SOUND,
          Layers: [layer("ChargeUp", 0.1)],
          ...PLACED,
          On: [
            { Terms: "ActorCreation", Send: "TimerSet 2.670000 Stop" },
            { Terms: "TimerExpired; TimerName Stop", Send: "SoundSetVolume Logarithmic 0.000000@0.000000,-96.000000@250.000000" },
            { Terms: "TimerExpired; TimerName Stop", Send: "TimerSet 0.250000 End" },
            { Terms: "TimerExpired; TimerName End", Send: "Destroy" },
            LET_GO,
          ],
        },
      },
    ]);
  });

  it("cut a layer off at its stop when it has no fade, and play one that stops from 0 as its actor's own sound", () => {
    const [, stopped] = soundMixEntries({ id: "Mix", layers: [{ sound: "Hum", at: 0, stop: 1.5 }] });
    expect(stopped!.fields).toEqual({ Sound: "Hum", ...PLACED, On: [{ Terms: "ActorCreation", Send: "TimerSet 1.500000 Stop" }, { Terms: "TimerExpired; TimerName Stop", Send: "Destroy" }, LET_GO] });
  });

  it("pass the game's data schema", () => {
    const entries = soundMixEntries({ ...death, layers: [...death.layers, { sound: "Battlecruiser_YamatoAttackChargeUp", at: 0, stop: 1, fade: 0.2 }] });
    expect(entries.flatMap((entry) => schemaProblems(entry))).toEqual([]);
  });

  it("write as ActorData elements, as Blizzard's layered sounds are written", () => {
    expect(soundMixXml(soundMixEntries({ id: "Mix", layers: [{ sound: "A", at: 0 }, { sound: "B", at: 0.5 }] }))).toBe(
      [
        '    <CActorSound id="Mix" parent="SoundOneShot">',
        '        <Sound value="A"/>',
        "        <Layers>",
        '            <Sound value="B"/>',
        '            <PitchSource value="Sound"/>',
        '            <PlayDelaySource value="Actor"/>',
        '            <VolumeSource value="Sound"/>',
        '            <Chance value="100"/>',
        '            <PlayDelay value="500,500"/>',
        "        </Layers>",
        '        <Host Subject="::Creator"/>',
        '        <SoundFlags index="UpdateVisibility" value="0"/>',
        '        <On Terms="ActorCreation" Send="RefClear ::Host"/>',
        "    </CActorSound>",
      ].join("\n"),
    );
  });

  it("are created by a line on the unit's actor", () => {
    expect(soundMixWiring(death)).toBe('<On Terms="UnitDeath" Send="Create GolemDeathMix"/>');
    expect(soundMixWiring(death, "WeaponStart.*.AttackStart")).toBe('<On Terms="WeaponStart.*.AttackStart" Send="Create GolemDeathMix"/>');
  });
});

describe("a sound mix file", () => {
  it("holds one mix or a list of them", () => {
    expect(SoundMixFileSchema.parse(death)).toEqual([death]);
    expect(SoundMixFileSchema.parse([death, death])).toHaveLength(2);
  });

  it("refuses a layer that stops before it starts, a fade without a stop, a time before 0 and an id that isn't a name", () => {
    const refused = (mix: unknown) => !SoundMixFileSchema.safeParse(mix).success;
    expect(refused({ id: "M", layers: [{ sound: "A", at: 1, stop: 0.5 }] })).toBe(true);
    expect(refused({ id: "M", layers: [{ sound: "A", at: 1, fade: 0.5 }] })).toBe(true);
    expect(refused({ id: "M", layers: [{ sound: "A", at: -1 }] })).toBe(true);
    expect(refused({ id: "M x", layers: [{ sound: "A", at: 0 }] })).toBe(true);
    expect(refused({ id: "M", layers: [] })).toBe(true);
    expect(refused({ id: "M", layers: [{ sound: "A", at: 0, volume: 2 }] })).toBe(true);
  });
});

describe("checking a sound mix's CSounds", () => {
  let folder: string | undefined;
  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it("finds each in the game's packages, the silent one included", () => {
    const { found, problems } = checkSoundMixes([death], new Set());
    expect(problems).toEqual([]);
    expect(found.get("Blood_Spurt")).toEqual(["Void.SC2Mod"]);
    expect(found.get("Terran_CovertOps_Large_Metal_Impact")).toContain("Liberty.SC2Mod");
    expect(found.get(SILENT_SOUND)).toEqual(["Void.SC2Mod"]);
  });

  it("finds the own data's, and names one defined nowhere, with the id it may have meant", () => {
    const mix = { id: "Mix", layers: [{ sound: "My_Roar", at: 0 }, { sound: "blood_spurt", at: 0.1 }, { sound: "Nowhere", at: 0.2 }] };
    const { found, problems } = checkSoundMixes([mix], new Set(["My_Roar"]));
    expect(found.get("My_Roar")).toEqual(["own"]);
    expect(problems).toEqual([
      "Mix: no CSound blood_spurt in the game's data or the own data given (did you mean Blood_Spurt?); it would play nothing",
      "Mix: no CSound Nowhere in the game's data or the own data given; it would play nothing",
    ]);
  });

  it("refuses two mixes of one id", () => {
    expect(checkSoundMixes([death, death], new Set()).problems).toEqual(["GolemDeathMix: two mixes have this id"]);
  });

  it("reads own CSounds from a map's GameData, a Mod Blueprint's Generic Entries, or a folder of either", async () => {
    folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sound-mix-"));
    await mkdir(path.join(folder, "Base.SC2Data", "GameData"), { recursive: true });
    const xml = path.join(folder, "Base.SC2Data", "GameData", "SoundData.xml");
    await writeFile(xml, '<Catalog>\n    <CSound id="My_Roar" parent="Combat"/>\n    <CSoundExclusivity id="NotASound"/>\n</Catalog>\n');
    const json = path.join(folder, "SoundData.json");
    await writeFile(json, JSON.stringify([{ catalog: "Sound", class: "CSound", id: "My_Hiss" }, { catalog: "Actor", class: "CActorSound", id: "My_Actor" }]));
    await writeFile(path.join(folder, "notes.json"), "not JSON");
    expect([...(await definedSounds(xml))]).toEqual(["My_Roar"]);
    expect([...(await definedSounds(json))]).toEqual(["My_Hiss"]);
    expect([...(await definedSounds(folder))].sort()).toEqual(["My_Hiss", "My_Roar"]);
  });
});

describe("the sound_mix tool", () => {
  afterEach(cleanupMods);

  it("finds the Workspace mods' own CSounds, in their packages and Blueprint entries, and gives the mix's actors", async () => {
    const mod = await setup();
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "SoundData.xml"), '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <CSound id="Harbour_Bell" parent="Combat"/>\n</Catalog>\n');
    await declare(mod, { entries: [{ source: "entries/SoundData.json" }] }, { "entries/SoundData.json": JSON.stringify([{ catalog: "Sound", class: "CSound", id: "Harbour_Gull", parent: "Combat" }]) });
    const client = await connect(mod.workspaceRoot);
    const mixes = [{ id: "BellMix", layers: [{ sound: "Harbour_Bell", at: 0 }, { sound: "Harbour_Gull", at: 0.4 }, { sound: "Blood_Spurt", at: 0.5 }] }];

    const reply = await client.callTool({ name: "sound_mix", arguments: { mixes, xml: true } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain('<CActorSound id="BellMix" parent="SoundOneShot">');
    expect(text(reply)).toContain("Harbour_Gull: own");
    expect(text(reply)).toContain("Blood_Spurt: Void.SC2Mod");
    expect(text(reply)).toContain('<On Terms="UnitDeath" Send="Create BellMix"/>');

    const refused = await client.callTool({ name: "sound_mix", arguments: { mixes: [{ id: "M", layers: [{ sound: "Harbour_Horn", at: 0 }] }] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("no CSound Harbour_Horn");
  });
});
