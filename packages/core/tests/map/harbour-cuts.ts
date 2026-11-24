// The Harbour Mission imported from an Editor-made package, every trigger in it Kept, with an Editor
// cut (fixtures/editor-triggers) added to its Triggers, TriggerStrings and MapScript.galaxy as the
// Editor would hold it (editor-triggers/README.md). Each is made in a folder of its own, removed
// after each test.
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const CROSSING = path.join(FIXTURES, "workspaces", "crossing");
export const CUTS = path.join(FIXTURES, "editor-triggers");
export const savedAt = new Date("2026-01-01T00:00:00Z");
const TRIGGER_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
const GAME_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "GameStrings.txt");
const PACKAGE_FILES = ["Triggers", "MapScript.galaxy", TRIGGER_STRINGS, GAME_STRINGS];

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

export type Mission = { readonly workspace: Workspace; readonly workspaceRoot: string; readonly mapDir: string; readonly blueprintPath: string };

const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");

/**
 * `script` (the Editor's, CRLF) with a cut's Galaxy added as the Editor would hold it beside the
 * rest: its globals' declarations and initializations, its triggers' declarations, sections and
 * _Init calls, each at the end of its part, a constant among the globals; and each map function
 * the cut keeps both the declaration and the definition of, in a Global Function Declarations and
 * a Global Functions section, as the Editor writes them. A function the cut keeps only one of isn't
 * added: no test reads one.
 */
function withCutScript(script: string, cut: string): string {
  const lines = crlf(cut).split("\r\n");
  const globals = lines.filter((line) => /^\S.* gv_\w+( = [^;]*)?;$/.test(line));
  const initials = lines.filter((line) => /^ {4}gv_\w+ = .*;$/.test(line));
  const triggers = lines.flatMap((line) => /^trigger (gt_\w+);$/.exec(line)?.[1] ?? []);
  const sections = [...crlf(cut).matchAll(/^\/\/-+\r\n\/\/ Trigger: [\s\S]*?^void (gt_\w+)_Init \(\) \{\r\n[\s\S]*?^\}\r\n\r\n/gm)].map((match) => match[0]);
  const at = (text: string, pattern: RegExp, insert: string): string => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`no ${pattern}`);
    return text.slice(0, match.index + match[0].length) + insert + text.slice(match.index + match[0].length);
  };
  let out = script;
  out = at(out, /^\/\/ Global Variables\r\n\/\/-+\r\n(?:\S[^\r\n]* gv_\w+;\r\n)*/m, globals.map((line) => `${line}\r\n`).join(""));
  out = at(out, /^void InitGlobals \(\) \{\r\n(?: {4}[^\r\n]*\r\n)*/m, initials.map((line) => `${line}\r\n`).join(""));
  out = at(out, /^\/\/ Trigger Variables\r\n\/\/-+\r\n(?:trigger \w+;\r\n)*/m, triggers.map((name) => `trigger ${name};\r\n`).join(""));
  const init = /^\/\/-+\r\n\/\/ Trigger Initialization\r\n/m.exec(out)!;
  out = out.slice(0, init.index) + sections.join("") + out.slice(init.index);
  // A trigger the cut keeps only the declaration of has no _Init to call.
  const sectioned = triggers.filter((name) => sections.some((section) => section.includes(`void ${name}_Init () {`)));
  out = at(out, /^void InitTriggers \(\) \{\r\n(?: {4}\w+_Init\(\);\r\n)*/m, sectioned.map((name) => `    ${name}_Init();\r\n`).join(""));
  // A map function the cut keeps both the declaration and the definition of, in the sections the Editor writes them in.
  const functions = lines.flatMap((line) => {
    const name = /^\S[^(]* (gf_\w+) \([^)]*\);$/.exec(line)?.[1];
    const span = name && keptElementSpan(crlf(cut), name);
    return name && span ? [{ declaration: line, definition: crlf(cut).slice(span.start, span.end) }] : [];
  });
  // The cut's Global Structures, Global Preset Declarations, Global Presets and Custom Script sections, whole, where the Editor writes each.
  const section = (title: string): string | undefined => new RegExp(`^//-+\\r\\n// ${title}\\r\\n//-+\\r\\n[\\s\\S]*?(?=^//-+\\r\\n// (?!Custom Script: )|(?![\\s\\S]))`, "m").exec(crlf(cut))?.[0];
  const before = (titles: string, insert: string | undefined): void => {
    if (insert === undefined) return;
    const next = new RegExp(`^//-+\\r\\n// (${titles})`, "m").exec(out)!;
    out = out.slice(0, next.index) + insert + out.slice(next.index);
  };
  before("Global Preset Declarations\\r|Global Variables\\r|Global Function Declarations\\r|Trigger Variables\\r", section("Global Structures"));
  before("Global Variables\\r|Global Function Declarations\\r|Trigger Variables\\r", section("Global Preset Declarations"));
  before("Custom Script\\r|Global Functions\\r|Trigger: |Trigger Initialization\\r", section("Global Presets"));
  const customScript = section("Custom Script");
  before("Global Functions\\r|Trigger: |Trigger Initialization\\r", customScript);
  // InitMap calls InitCustomScript after InitGlobals, as the Editor writes it.
  if (customScript !== undefined) out = at(out, /^void InitMap \(\) \{\r\n {4}InitLibs\(\);\r\n(?: {4}InitGlobals\(\);\r\n)?/m, "    InitCustomScript();\r\n");
  if (functions.length > 0) {
    const rule = "//--------------------------------------------------------------------------------------------------";
    const variables = /^\/\/-+\r\n\/\/ Trigger Variables\r\n/m.exec(out)!;
    out = `${out.slice(0, variables.index)}${rule}\r\n// Global Function Declarations\r\n${rule}\r\n${functions.map(({ declaration }) => `${declaration}\r\n`).join("")}\r\n${out.slice(variables.index)}`;
    const first = /^\/\/-+\r\n\/\/ (Trigger: |Trigger Initialization\r\n)/m.exec(out)!;
    out = `${out.slice(0, first.index)}${rule}\r\n// Global Functions\r\n${rule}\r\n${functions.map(({ definition }) => definition).join("")}${out.slice(first.index)}`;
  }
  return out;
}

/**
 * The Harbour Mission imported, with the Editor cut `cut` (an editor-triggers folder) added to its package: its Root items at the end of Root, its elements at the end.
 * With `mod`, the cut's mod (its `mods/<id>/`) is in the Workspace and the map depends on it.
 */
export async function harbourWith(cut: string, { whole = false, folder, mod }: { readonly whole?: boolean; readonly folder?: string; readonly mod?: { readonly id: string; readonly name: string; readonly library: string } } = {}): Promise<Mission> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-harbour-cut-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const cutDir = path.join(CUTS, cut);
  if (mod) {
    // The cut's mod in the Workspace, and the map depending on it.
    await cp(path.join(cutDir, "mods", mod.id), path.join(workspaceRoot, "mods", mod.id), { recursive: true });
    const config = path.join(workspaceRoot, "sc2-adjutant.workspace.json");
    await writeFile(config, JSON.stringify({ ...JSON.parse(await readFile(config, "utf8")), mods: [mod.id] }, null, 2));
    const info = path.join(source, "DocumentInfo");
    await writeFile(info, (await readFile(info, "utf8")).replace(/<Dependencies>/, `<Dependencies>\r\n        <Value>file:Mods\\${mod.name}.SC2Mod</Value>`));
    // The Editor includes the mod's library in the map's script, and initializes it.
    const script = path.join(source, "MapScript.galaxy");
    await writeFile(script, (await readFile(script, "utf8")).replace('include "TriggerLibs/NativeLib"\r\n', `include "TriggerLibs/NativeLib"\r\ninclude "Lib${mod.library}"\r\n`).replace("    libNtve_InitLib();\r\n", `    libNtve_InitLib();\r\n    lib${mod.library}_InitLib();\r\n`));
  }
  if (whole) {
    // A whole map's trigger files, as the Editor saved them, in place of the package's.
    for (const [from, to] of [["Triggers", "Triggers"], ["MapScript.galaxy", "MapScript.galaxy"], ["TriggerStrings.txt", TRIGGER_STRINGS], ["GameStrings.txt", GAME_STRINGS]] as const) await cp(path.join(cutDir, from), path.join(source, to));
    return importHarbour(workspaceRoot, source);
  }
  const cutTriggers = crlf(await readFile(path.join(cutDir, "Triggers"), "utf8"));
  const rootItems = /<Root>\r\n([\s\S]*?) {4}<\/Root>\r\n/.exec(cutTriggers)![1]!;
  const cutElements = cutTriggers.slice(cutTriggers.indexOf("</Root>\r\n") + "</Root>\r\n".length, cutTriggers.indexOf("</TriggerData>"));
  const triggersFile = path.join(source, "Triggers");
  const triggers = await readFile(triggersFile, "utf8");
  // With `folder`, that trigger filed in a folder of the author's ("Fighters") instead of Root, as the Editor files one.
  const filed = folder === undefined ? rootItems : rootItems.replace(`        <Item Type="Trigger" Id="${folder}"/>\r\n`, '        <Item Type="Category" Id="5A5AF001"/>\r\n');
  const folderElement = folder === undefined ? "" : `    <Element Type="Category" Id="5A5AF001">\r\n        <Item Type="Trigger" Id="${folder}"/>\r\n    </Element>\r\n`;
  await writeFile(triggersFile, triggers.replace("    </Root>", `${filed}    </Root>`).replace("</TriggerData>", `${cutElements}${folderElement}</TriggerData>`));
  const stringsFile = path.join(source, TRIGGER_STRINGS);
  if (folder !== undefined) await writeFile(stringsFile, `${await readFile(stringsFile, "utf8")}Category/Name/5A5AF001=Fighters\r\n`);
  const names = crlf((await readFile(path.join(cutDir, "TriggerStrings.txt"), "utf8")).replace(/^﻿/, "")).replace(/(\r\n)?$/, "\r\n");
  await writeFile(stringsFile, `${await readFile(stringsFile, "utf8")}${names}`);
  if (existsSync(path.join(cutDir, "GameStrings.txt"))) {
    const gameStrings = path.join(source, GAME_STRINGS);
    const words = crlf((await readFile(path.join(cutDir, "GameStrings.txt"), "utf8")).replace(/^﻿/, "")).replace(/(\r\n)?$/, "\r\n");
    await writeFile(gameStrings, `${await readFile(gameStrings, "utf8")}${words}`);
  }
  const scriptFile = path.join(source, "MapScript.galaxy");
  await writeFile(scriptFile, withCutScript(await readFile(scriptFile, "utf8"), await readFile(path.join(cutDir, "MapScript.galaxy"), "utf8")));
  return importHarbour(workspaceRoot, source);
}

/** The package at `source` imported as the Harbour Mission. */
async function importHarbour(workspaceRoot: string, source: string): Promise<Mission> {
  const workspace = await loadWorkspace(workspaceRoot);
  await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  return { workspace: await loadWorkspace(workspaceRoot), workspaceRoot, mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath: path.join(missionDir, "blueprint.json") };
}

/** The package's trigger files: Triggers, MapScript.galaxy, the enUS TriggerStrings and GameStrings. */
export const readPackage = (mapDir: string): Promise<string[]> => Promise.all(PACKAGE_FILES.map((file) => readFile(path.join(mapDir, file), "utf8")));
