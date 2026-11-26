// writeDeclaredRest (mission-declared.ts) leaves the Mission's Declared Content as it was, so a
// second compile with it (compile-mission's dry run after an Editor change) writes the same.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { type MissionDeclared, writeDeclaredRest } from "../../src/map/mission-declared.js";
import { PackageOutput } from "../../src/map/package-output.js";
import { StringsTable } from "../../src/mods/declared-parts.js";
import { EquivalenceCheck } from "../../src/mods/equivalence.js";

const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

it("adds the doodads' names to a copy of the Declared strings, and names each part it wrote", async () => {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-declared-rest-"));
  const declared: MissionDeclared = { catalogs: new Map(), catalogWriters: new Map(), strings: new StringsTable({}), files: [], setCutscenes: [], includes: undefined, removals: [], warnings: [] };
  const extraStrings = [{ by: "the Blueprint's doodad Ring", strings: { [OBJECT_STRINGS]: { "Model/Name/Ring": "Ring" } } }];
  const write = () => writeDeclaredRest(declared, new PackageOutput(root!), { pkg: root!, record: undefined, extraStrings, check: new EquivalenceCheck([], "Mission Blueprint") });

  const { items } = await write();

  expect(declared.strings.files).toEqual({});
  expect([...items]).toEqual([`string:${OBJECT_STRINGS}:Model/Name/Ring`]);
  expect([...(await write()).items]).toEqual([...items]);
});
