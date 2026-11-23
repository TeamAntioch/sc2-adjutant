// A synthetic Campaign Mod for the mod tests: Harbour-Story, Editor-made, imported into a
// throwaway Workspace as harbour-story with everything in it Kept.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeDocumentHeader } from "../../src/map/write-document-header.js";
import { importMod } from "../../src/mods/import-mod.js";
import { loadWorkspace, WORKSPACE_FILE } from "../../src/plugins/workspace.js";

let root: string | undefined;
/** Removes the last setup's Workspace: give it to afterEach. */
export async function cleanupMods(): Promise<void> {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
}

export async function put(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

export const binary = (seed: number, length = 512) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed * 7) % 256);
/** An Editor-form DocumentHeader listing `dependencies`, as its DocumentInfo does (`check` compares the two). */
export const documentHeader = (dependencies: readonly string[] = [], documentId = 1) => writeDocumentHeader({ dependencies, documentId, attributes: { "DocInfo/Name": "Harbour" } });

export const UNIT_DATA = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  `    <!-- The harbour's own cranes -->`,
  `    <CUnit id="Crane" parent="Marine">`,
  `        <LifeMax value="120"/>`,
  `        <!--<Speed value="2"/>-->`,
  `    </CUnit>`,
  `    <CUnit id="Barge"   parent="Medivac" >`,
  `        <LifeMax value="400.000000"/>`,
  `        <Attributes index="Armored" value="1"/>`,
  `    </CUnit>`,
  `    <CUnit default="1" id="HarbourBase"/>`,
  `</Catalog>`,
  ``,
].join("\r\n");

export const GAME_STRINGS = "﻿Unit/Name/Crane=Crane\r\nUnit/Name/Barge=Barge\r\n";

export const TRIGGERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Library Id="Hbr1">`,
  `        <Root>`,
  `            <Item Type="Category" Library="Hbr1" Id="00000001"/>`,
  `        </Root>`,
  `        <Element Type="Category" Id="00000001">`,
  `            <Item Type="Trigger" Library="Hbr1" Id="0000000A"/>`,
  `        </Element>`,
  `        <Element Type="Trigger" Id="0000000A">`,
  `            <Action Type="FunctionCall" Library="Hbr1" Id="0000000B"/>`,
  `        </Element>`,
  `        <Element Type="FunctionCall" Id="0000000B">`,
  `            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000001"/>`,
  `        </Element>`,
  `    </Library>`,
  `</TriggerData>`,
  ``,
].join("\r\n");

export const COMPONENTS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Components>`,
  `    <Optimized/>`,
  `    <DataComponent Type="gada">GameData</DataComponent>`,
  `    <DataComponent Type="text" Locale="enUS">GameText</DataComponent>`,
  `    <DataComponent Type="info">DocumentInfo</DataComponent>`,
  `    <DataComponent Type="trig">Triggers</DataComponent>`,
  `</Components>`,
].join("\r\n");

export const DEPENDENCIES = ["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod", "file:Mods\\Harbour-Art.SC2Mod"];

/** A Workspace with the Editor-made mod Harbour-Story imported as harbour-story. */
export async function setup() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-compile-mod-"));
  const workspaceRoot = path.join(root, "workspace");
  await put(path.join(workspaceRoot, WORKSPACE_FILE), `${JSON.stringify({ campaign: { id: "harbour", name: "The Harbour" }, missions: "missions", plugins: [] }, null, 2)}\n`);
  await mkdir(path.join(workspaceRoot, "missions"));

  const source = path.join(root, "elsewhere", "Harbour-Story.SC2Mod");
  await put(path.join(source, "DocumentHeader"), documentHeader(DEPENDENCIES));
  await put(
    path.join(source, "DocumentInfo"),
    `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <Dependencies>\r\n${DEPENDENCIES.map((value) => `        <Value>${value}</Value>\r\n`).join("")}    </Dependencies>\r\n    <Preload>\r\n        <Value>Bank;Harbour</Value>\r\n    </Preload>\r\n</DocInfo>\r\n`,
  );
  await put(path.join(source, "ComponentList.SC2Components"), COMPONENTS);
  for (const component of ["GameData", "GameText", "DocumentInfo", "Triggers"]) await put(path.join(source, `${component}.version`), binary(2, 44));
  await put(path.join(source, "Base.SC2Data", "GameData", "UnitData.xml"), UNIT_DATA);
  await put(path.join(source, "Base.SC2Data", "scripts", "harbour.galaxy"), "void Harbour_Init () {\r\n}\r\n");
  await put(path.join(source, "Base.SC2Data", "Cutscenes", "Quay - Dawn.SC2Cutscene"), "<Cutscene/>\r\n");
  await put(path.join(source, "Base.SC2Data", "UI", "Layout", "Harbour.SC2Layout"), "<Desc/>\r\n");
  await put(path.join(source, "Triggers"), TRIGGERS);
  await put(path.join(source, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), GAME_STRINGS);
  await put(path.join(source, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "﻿Trigger/Name/lib_Hbr1_0000000A=Open Quay\r\n");
  await put(path.join(source, "Assets", "Textures", "quay.dds"), binary(3));

  const imported = await importMod(await loadWorkspace(workspaceRoot), source, "harbour-story");
  const modDir = path.dirname(imported.blueprintPath);
  return { workspaceRoot, modDir, blueprintPath: imported.blueprintPath, modPackage: imported.modPackage };
}

export type Mod = Awaited<ReturnType<typeof setup>>;

/** Adds `fields` to the mod's Blueprint and writes each source file in the mod's folder. */
export async function declare(mod: Mod, fields: Record<string, unknown>, sources: Record<string, string> = {}): Promise<void> {
  for (const [file, content] of Object.entries(sources)) await put(path.join(mod.modDir, file), content);
  const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
  await writeFile(mod.blueprintPath, `${JSON.stringify({ ...blueprint, ...fields }, null, 2)}\n`);
}

export const inPackage = (mod: Mod, file: string) => readFile(path.join(mod.modPackage, ...file.split("/")), "utf8");
export const UNIT_FILE = "Base.SC2Data/GameData/UnitData.xml";

export async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

/** A catalog source holding `entries`. */
export const catalog = (...entries: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n${entries.map((entry) => `    ${entry}\n`).join("")}</Catalog>\n`;

