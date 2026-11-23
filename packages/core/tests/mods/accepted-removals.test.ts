// Accepted removals (ADR-0011): a Kept item the Mod Blueprint drops on purpose, named with its
// reason. The compile removes it, and the Equivalence Check expects it gone. The mod is synthetic:
// the Editor-made Harbour-Story, imported with everything Kept, its GameStrings carrying a string
// nothing names and an old merge conflict's lines.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { formatProposedRemovals, proposeRemovals } from "../../src/mods/removals.js";
import { connect, text } from "../mcp/harness.js";
import { cleanupMods, declare, hashTree, inPackage, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
const CUTSCENE = "Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene";
const KEPT_STRINGS = "﻿<<<<<<< .mine=\r\nUnit/Name/Crane=Crane\r\n=======\r\nUnit/Name/Dinghy=What's my line again?\r\n>>>>>>> .r381=\r\nUnit/Name/Barge=Barge\r\n";

const REMOVALS = [
  { item: `string:${STRINGS}:Unit/Name/Dinghy`, reason: "Editor placeholder string no unit uses" },
  { item: `string:${STRINGS}:<<<<<<< .mine`, reason: "Old merge conflict" },
  { item: `line:${STRINGS}:=======`, reason: "Old merge conflict" },
  { item: `file:${CUTSCENE}`, reason: "Editor capture rig nothing plays" },
];

async function withStrings(): Promise<Mod> {
  const mod = await setup();
  await writeFile(path.join(mod.modPackage, ...STRINGS.split("/")), KEPT_STRINGS);
  return mod;
}

const keptItems = async (mod: Mod) => (await keptReport(mod.blueprintPath)).components.flatMap((component) => component.items.map((item) => item.item));

describe("an accepted removal", () => {
  it("removes a Kept string, keyless line and file, leaving every other Kept byte, and a second compile changes nothing", async () => {
    const mod = await withStrings();
    await declare(mod, { removals: REMOVALS });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.removed).toEqual(REMOVALS);
    expect(await inPackage(mod, STRINGS)).toBe("﻿Unit/Name/Crane=Crane\r\n>>>>>>> .r381=\r\nUnit/Name/Barge=Barge\r\n");
    expect(existsSync(path.join(mod.modPackage, ...CUTSCENE.split("/")))).toBe(false);
    const kept = await keptItems(mod);
    expect(kept).toContain(`string:${STRINGS}:>>>>>>> .r381`);
    expect(kept).not.toContain(`string:${STRINGS}:Unit/Name/Dinghy`);
    expect(kept).not.toContain(`file:${CUTSCENE}`);

    const once = await hashTree(mod.modDir);
    const again = await compileMod(mod.blueprintPath);
    expect(again.removed).toEqual([]);
    expect(await hashTree(mod.modDir)).toEqual(once);
  });

  it("warns, each compile, while a Kept file still names a removed file, such as UserData pointing at a cutscene", async () => {
    const mod = await withStrings();
    await put(
      path.join(mod.modPackage, "Base.SC2Data", "GameData", "UserData.xml"),
      `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CUser id="Rooms">\r\n        <Instances Id="Quay">\r\n            <String String="Cutscenes\\quay - dawn.SC2Cutscene">\r\n                <Field Id="Cutscene"/>\r\n            </String>\r\n        </Instances>\r\n    </CUser>\r\n</Catalog>\r\n`,
    );
    await declare(mod, { removals: [REMOVALS[3]] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings).toEqual([
      `removals removes file:${CUTSCENE}, but Base.SC2Data/GameData/UserData.xml still names it (Cutscenes/Quay - Dawn.SC2Cutscene): change what names it, or the game finds no file there`,
    ]);
    expect((await compileMod(mod.blueprintPath)).warnings).toEqual(compiled.warnings);
  });

  it("passes a conversion that leaves the items out, which fails it when they aren't named", async () => {
    const mod = await withStrings();
    const before = await hashTree(mod.modPackage);
    await declare(mod, { files: [{ path: STRINGS, source: "GameStrings.txt" }] }, { "GameStrings.txt": "﻿Unit/Name/Crane=Crane\r\n>>>>>>> .r381=\r\nUnit/Name/Barge=Barge\r\n" });

    const failure = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EquivalenceError);
    expect((failure as EquivalenceError).mismatches.map((mismatch) => mismatch.item)).toEqual([`file:${STRINGS}`]);
    expect(await hashTree(mod.modPackage)).toEqual(before);

    await declare(mod, { removals: REMOVALS.slice(0, 3) });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual([{ item: `file:${STRINGS}` }]);
    expect(compiled.removed).toEqual(REMOVALS.slice(0, 3));
    expect(await inPackage(mod, STRINGS)).toBe("﻿Unit/Name/Crane=Crane\r\n>>>>>>> .r381=\r\nUnit/Name/Barge=Barge\r\n");
  });

  it("fails the compile, writing nothing, when the Blueprint still writes what it removes", async () => {
    const mod = await withStrings();
    const before = await hashTree(mod.modPackage);
    await declare(mod, { removals: REMOVALS, strings: { [STRINGS]: { "Unit/Name/Dinghy": "Dinghy" } }, files: [{ path: CUTSCENE, source: "quay.SC2Cutscene" }] }, { "quay.SC2Cutscene": "<Cutscene/>\r\n" });

    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;

    expect(failure).toBeInstanceOf(EquivalenceError);
    expect(failure.mismatches).toEqual([
      { item: `string:${STRINGS}:Unit/Name/Dinghy`, detail: `the Blueprint removes it (Editor placeholder string no unit uses), but strings["${STRINGS}"] writes it` },
      { item: `file:${CUTSCENE}`, detail: "the Blueprint removes it (Editor capture rig nothing plays), but files.0 writes it" },
    ]);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("fails a strings file written whole that keeps a removed key, even under an Accepted Difference on the file", async () => {
    const mod = await withStrings();
    await declare(
      mod,
      { removals: REMOVALS.slice(0, 1), files: [{ path: STRINGS, source: "GameStrings.txt" }], acceptedDifferences: [{ item: `file:${STRINGS}`, reason: "Crane renamed" }] },
      { "GameStrings.txt": "\uFEFFUnit/Name/Crane=Big Crane\r\nUnit/Name/Dinghy=What's my line again?\r\n" },
    );

    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;

    expect(failure).toBeInstanceOf(EquivalenceError);
    expect(failure.mismatches).toEqual([{ item: REMOVALS[0]!.item, detail: "the Blueprint removes it (Editor placeholder string no unit uses), but files.0 writes it" }]);
  });

  it("fails when the Blueprint writes a removed file in another spelling, which the game reads as the same file", async () => {
    const mod = await withStrings();
    const lower = "file:Base.SC2Data/Cutscenes/quay - dawn.SC2Cutscene";
    await declare(mod, { removals: [{ item: lower, reason: "gone" }], files: [{ path: CUTSCENE, source: "quay.SC2Cutscene" }] }, { "quay.SC2Cutscene": "<Cutscene/>\r\n" });

    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;

    expect(failure).toBeInstanceOf(EquivalenceError);
    expect(failure.mismatches).toEqual([{ item: lower, detail: "the Blueprint removes it (gone), but files.0 writes it" }]);
  });

  it("removes a merge conflict's line with no = by its text", async () => {
    const mod = await setup();
    await writeFile(path.join(mod.modPackage, ...STRINGS.split("/")), "\uFEFF<<<<<<< .mine\r\nUnit/Name/Crane=Crane\r\n");
    expect((await proposeRemovals(mod.blueprintPath)).proposals).toEqual([{ item: `line:${STRINGS}:<<<<<<< .mine`, reason: "An old merge conflict's line" }]);
    await declare(mod, { removals: [{ item: `line:${STRINGS}:<<<<<<< .mine`, reason: "Old merge conflict" }] });

    expect((await compileMod(mod.blueprintPath)).removed).toEqual([{ item: `line:${STRINGS}:<<<<<<< .mine`, reason: "Old merge conflict" }]);
    expect(await inPackage(mod, STRINGS)).toBe("\uFEFFUnit/Name/Crane=Crane\r\n");
  });

  it("is refused when it names no Kept item a removal can drop", async () => {
    const mod = await withStrings();
    for (const [item, message] of [
      ["catalog-entry:Base.SC2Data/GameData/UnitData.xml:CUnit:Barge", "string:<strings file>:<key>, line:<strings file>:<text> or file:<path>"],
      ["string:Base.SC2Data/GameData/UnitData.xml:Barge", "a strings file"],
      [`line:${STRINGS}:  `, "a line with text"],
      ["file:DocumentInfo", "the compile generates"],
    ] as const) {
      await declare(mod, { removals: [{ item, reason: "no" }] });
      await expect(compileMod(mod.blueprintPath)).rejects.toThrow(message);
    }
  });
});

describe("proposeRemovals", () => {
  const CONVERSATION_STRINGS = "enUS.SC2Data/LocalizedData/ConversationStrings.txt";
  const ASSETS = "Base.SC2Data/GameData/Assets.txt";

  async function withLeftovers(): Promise<Mod> {
    const mod = await withStrings();
    const inside = (file: string) => path.join(mod.modPackage, ...file.split("/"));
    await put(
      inside("Base.SC2Data/GameData/ConversationData.xml"),
      [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<Catalog>`,
        `    <CConversation id="HarbourChat-Quay">`,
        `        <Groups Id="Group00001" Name="Conversation/HarbourChat-Quay/Group00001">`,
        `            <Children value="Line01001"/>`,
        `        </Groups>`,
        `        <Lines>`,
        `            <Id value="Line01001"/>`,
        `            <Text value="Conversation/HarbourChat-Quay/Line01001"/>`,
        `        </Lines>`,
        `    </CConversation>`,
        `</Catalog>`,
        ``,
      ].join("\r\n"),
    );
    await put(
      inside(CONVERSATION_STRINGS),
      "\uFEFFCharacter/Name/CharCaptain=Captain\r\nConversation/HarbourChat-Quay/Group00001=QUAY\r\nConversation/HarbourChat-Quay/Line01001=Lines up!\r\nConversation/HarbourChat-Quay/Line01002=What's my line again?\r\nConversation/HarbourChat-Quay/Line01003=Ahoy!\r\nConversation/Harbourundefined/Group00801=THE QUAY\r\n",
    );
    await put(inside(ASSETS), "");
    // A layout names this one, though no conversation does.
    await put(inside("Base.SC2Data/UI/Layout/Harbour.SC2Layout"), `<Desc>\r\n    <Frame type="Label" name="Hail"><Text val="Conversation/HarbourChat-Quay/Line01003"/></Frame>\r\n</Desc>\r\n`);
    await put(inside("Base.SC2Data/GameData/Harbour/Assets.txt"), "UI/Quay=Assets/Textures/quay.dds\r\n");
    return mod;
  }

  it("lists conversation strings nothing names, old merge conflicts' lines and an empty asset table, applying none", async () => {
    const mod = await withLeftovers();
    const before = await hashTree(mod.modDir);

    const proposed = await proposeRemovals(mod.blueprintPath);

    expect(proposed.proposals).toEqual([
      { item: `file:${ASSETS}`, reason: "An empty asset-key table: the mod overrides no asset key" },
      { item: `string:${CONVERSATION_STRINGS}:Conversation/HarbourChat-Quay/Line01002`, reason: "A conversation string no line or group names", text: "What's my line again?" },
      { item: `string:${CONVERSATION_STRINGS}:Conversation/Harbourundefined/Group00801`, reason: "A conversation string no line or group names", text: "THE QUAY" },
      { item: `string:${STRINGS}:<<<<<<< .mine`, reason: "An old merge conflict's line" },
      { item: `line:${STRINGS}:=======`, reason: "An old merge conflict's line" },
      { item: `string:${STRINGS}:>>>>>>> .r381`, reason: "An old merge conflict's line" },
    ]);
    expect(formatProposedRemovals(proposed)).toContain(`string:${CONVERSATION_STRINGS}:Conversation/HarbourChat-Quay/Line01002 "What's my line again?": A conversation string no line or group names`);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });

  it("leaves out what the Blueprint already removes or owns", async () => {
    const mod = await withLeftovers();
    await declare(mod, {
      removals: [{ item: `file:${ASSETS}`, reason: "Overrides nothing" }],
      strings: { [CONVERSATION_STRINGS]: { "Conversation/Harbourundefined/Group00801": "THE QUAY" } },
    });
    await compileMod(mod.blueprintPath);

    const proposed = await proposeRemovals(mod.blueprintPath);

    expect(proposed.proposals.map((proposal) => proposal.item)).toEqual([
      `string:${CONVERSATION_STRINGS}:Conversation/HarbourChat-Quay/Line01002`,
      `string:${STRINGS}:<<<<<<< .mine`,
      `line:${STRINGS}:=======`,
      `string:${STRINGS}:>>>>>>> .r381`,
    ]);
  });

  it("is the propose_removals tool, and compile_mod lists what it removed", async () => {
    const mod = await withLeftovers();
    const client = await connect(mod.workspaceRoot);

    const proposed = await client.callTool({ name: "propose_removals", arguments: { mod: "harbour-story" } });
    expect(proposed.isError).toBeFalsy();
    expect(proposed.structuredContent).toMatchObject({ mod: "harbour-story", proposals: expect.arrayContaining([{ item: `file:${ASSETS}`, reason: "An empty asset-key table: the mod overrides no asset key" }]) });
    expect(text(proposed)).toContain("none is applied");

    await declare(mod, { removals: [{ item: `file:${ASSETS}`, reason: "Overrides nothing" }] });
    const compiled = await client.callTool({ name: "compile_mod", arguments: { mod: "harbour-story" } });
    expect(compiled.structuredContent).toMatchObject({ removed: [{ item: `file:${ASSETS}`, reason: "Overrides nothing" }] });
    expect(text(compiled)).toContain(`Removed file:${ASSETS} (Accepted Removal: Overrides nothing)`);
  });
});
