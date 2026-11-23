// Import (ADR-0010): makes a Mission from a Map Package built outside the Workspace. The package is
// copied byte for byte to missions/<id>/<Name>.SC2Map, and everything in it starts as Kept Content:
// the Mission gets a minimal Blueprint (no Zones, Beats or Kept References), read from the package,
// and an empty compile record. Only the Editor's default map name is changed, to the title. The
// `import-map` CLI and the MCP server's `import_map` tool both run it.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_COMPILE_RECORD } from "../domain/compile-record.js";
import { type MissionBlueprint, slugId } from "../domain/mission-blueprint.js";
import { unexploredAreasOf } from "../domain/unexplored-areas.js";
import { isNamedId, NAMED_ID_RULE } from "../domain/named-id.js";
import { missionCatalog } from "./mission-catalog.js";
import { BLUEPRINT_FILE, formatIssue, validateMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { pullScreenplay } from "../script/screenplay-source.js";
import { importPackage } from "./import-package.js";
import { packageNameFor, saveCompileRecord } from "./mission-package.js";
import { readDependencies } from "./read-dependencies.js";
import { readMapInfo } from "./read-map-info.js";
import { decodeXmlText } from "./xml-elements.js";

/** The name the Editor gives a new map, which Import replaces with the Mission's title. */
export const EDITOR_DEFAULT_MAP_NAME = "Just Another StarCraft II Map";

export type ImportMapOptions = {
  /** The Mission's title; by default the package's own name, or, while that is the Editor's default, the package's file name. */
  readonly title?: string;
  /** One line on where the Mission is set; by default it says where the package came from. */
  readonly setting?: string;
};

export type ImportedMap = {
  readonly blueprintPath: string;
  readonly mapPackage: string;
  /** What Import read and did, for the author. */
  readonly notes: readonly string[];
};

/** Imports the package at `source` as the Mission `missionId`, as above. The source is only read. */
export async function importMap(workspace: Workspace, source: string, missionId: string, options: ImportMapOptions = {}): Promise<ImportedMap> {
  const id = slugId.safeParse(missionId);
  if (!id.success) throw new Error(`${missionId} isn't a Mission id: ${id.error.issues[0]?.message}`);
  const sourceDir = path.resolve(source);
  if (!existsSync(path.join(sourceDir, "MapInfo"))) throw new Error(`${sourceDir} isn't a Map Package: it has no MapInfo (Import takes an unpacked .SC2Map folder)`);
  for (const [field, value] of [["title", options.title], ["setting", options.setting]] as const) {
    if (value !== undefined && (value.trim() === "" || /[\r\n]/.test(value))) throw new Error(`The ${field} is one line of text, not ${JSON.stringify(value)}`);
  }
  const missionDir = path.join(workspace.missionsDir, missionId);
  if (existsSync(missionDir)) throw new Error(`The Mission ${missionId} is already there (${missionDir}): import under another id, or remove it first`);

  const mapInfo = readMapInfo(await readFile(path.join(sourceDir, "MapInfo")));
  const dependencies = await readDependencies(sourceDir);
  const stringsFiles = await gameStringsFiles(sourceDir);
  const ownName = await mapName(sourceDir, stringsFiles);
  const title = options.title ?? (ownName && ownName !== EDITOR_DEFAULT_MAP_NAME ? ownName : path.basename(sourceDir, ".SC2Map"));
  const notes: string[] = [];
  const unexploredAreas = unexploredAreasOf(mapInfo.fogType);
  if (!unexploredAreas) notes.push(`The package's Unexplored Areas is ${JSON.stringify(mapInfo.fogType)}, which isn't one of the Editor's three, so the Blueprint doesn't set unexploredAreas`);

  // The Screenplay: the one the Campaign's Screenplay Source knows the package's conversation by.
  const screenplaySource = workspace.registry.screenplaySource();
  let ref: { conversationId: string; ref: string } | undefined;
  if (screenplaySource?.refForConversation) {
    for (const conversationId of await conversationIds(sourceDir)) {
      // A Blueprint can't name a conversation by an id the naming rules refuse: the map still imports, without the reference.
      if (!isNamedId(conversationId)) {
        notes.push(`The conversation ${conversationId} has an id a Blueprint can't name (${NAMED_ID_RULE}), so the Blueprint doesn't refer to its Screenplay`);
        continue;
      }
      let found: string | undefined;
      try {
        found = await screenplaySource.refForConversation(conversationId);
      } catch (error) {
        // As with a Screenplay that can't be pulled: the map still imports, without the reference.
        const reason = error instanceof Error ? error.message : String(error);
        notes.push(
          `The Screenplay Source ${screenplaySource.name} couldn't look up the conversation ${conversationId} (${reason}), so the Blueprint has no screenplay.script yet: add one by hand, or import again once the Source works`,
        );
        break;
      }
      if (found) {
        ref = { conversationId, ref: found };
        break;
      }
    }
  }
  const scriptFile = `${missionId}.md`;

  const blueprint = {
    id: missionId,
    campaignId: workspace.campaign.id,
    title,
    setting: options.setting ?? `Imported from ${path.basename(sourceDir)}`,
    mapSize: { width: mapInfo.width, height: mapInfo.height },
    tilesetId: mapInfo.tilesetId,
    // Map Options' Unexplored Areas, unless it's the default Black Mask: the package keeps its own while
    // its terrain is Kept, and the Blueprint says so for when it isn't. Changed in the Editor since,
    // the compile warns that the two disagree (keptMaskWarnings), as sync doesn't bring MapInfo back beside Kept terrain.
    ...(unexploredAreas && unexploredAreas !== "black" ? { unexploredAreas } : {}),
    ...(dependencies.length > 0 ? { dependencies } : {}),
    // Under the package's own conversation id, which its Kept cutscenes and triggers play, whatever the naming template would call it.
    screenplay: { title, ...(ref ? { script: { source: scriptFile, ref: ref.ref, conversationId: ref.conversationId } } : {}) },
  };
  // Against the package's own game data too, all of it Kept: a tileset the map defines for itself is the Mission's.
  const validated = validateMissionBlueprint(workspace, blueprint, await missionCatalog(workspace.catalog, sourceDir));
  if (!validated.success) throw new Error(`The Blueprint read from ${sourceDir} isn't valid: ${validated.issues.map(formatIssue).join("; ")}`);

  const mapPackage = path.join(missionDir, `${packageNameFor(missionId)}.SC2Map`);
  const blueprintPath = path.join(missionDir, BLUEPRINT_FILE);
  const alreadyThere = `The Mission ${missionId} is already there (${missionDir}): import under another id, or remove it first`;
  await importPackage(sourceDir, missionDir, mapPackage, alreadyThere, async () => {
    notes.push(`Copied ${sourceDir} to ${mapPackage}`);
    const renamed: string[] = [];
    for (const file of stringsFiles) if (await renameMap(path.join(mapPackage, file), title)) renamed.push(file);
    if (renamed.length > 0) notes.push(`Named the map ${title}, in place of the Editor's "${EDITOR_DEFAULT_MAP_NAME}", in ${renamed.join(", ")}`);
    await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    if (ref) notes.push(await pullImportedScreenplay(workspace, blueprintPath, blueprint, validated.blueprint, { ...ref, file: scriptFile, sourceName: screenplaySource!.name }));
  });
  return { blueprintPath, mapPackage, notes };
}

/**
 * Pulls the Screenplay Import found. One the Source can't give (a pull that fails, or a Screenplay
 * the naming template can't name) leaves the Blueprint without a reference, saying why, so the
 * Mission still imports and checks; the reference is added once the Source is fixed.
 */
async function pullImportedScreenplay(
  workspace: Workspace,
  blueprintPath: string,
  raw: { readonly screenplay: { readonly title: string } } & Record<string, unknown>,
  blueprint: MissionBlueprint,
  found: { readonly conversationId: string; readonly ref: string; readonly file: string; readonly sourceName: string },
): Promise<string> {
  const known = `The conversation ${found.conversationId} is ${found.ref} in the Screenplay Source ${found.sourceName}`;
  try {
    await pullScreenplay({ blueprint, workspace }, blueprintPath);
    return `${known}: pulled to ${found.file}`;
  } catch (error) {
    await writeFile(blueprintPath, `${JSON.stringify({ ...raw, screenplay: { title: raw.screenplay.title } }, null, 2)}\n`);
    const reason = error instanceof Error ? error.message : String(error);
    return `${known}, but it couldn't be pulled (${reason}), so the Blueprint has no screenplay.script yet: fix it at the Source, then add { "source": "${found.file}", "ref": "${found.ref}", "conversationId": "${found.conversationId}" } and pull`;
  }
}

/** Each locale's GameStrings.txt, relative to the package. */
async function gameStringsFiles(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".SC2Data") && entry.name !== "Base.SC2Data")
    .map((entry) => path.join(entry.name, "LocalizedData", "GameStrings.txt"))
    .filter((file) => existsSync(path.join(sourceDir, file)))
    .sort();
}

const NAME_LINE = /^(\uFEFF?DocInfo\/Name=)([^\r\n]*)/m;

/** The map's name, from the first locale that has one. */
async function mapName(sourceDir: string, stringsFiles: readonly string[]): Promise<string | undefined> {
  for (const file of stringsFiles) {
    const name = NAME_LINE.exec(await readFile(path.join(sourceDir, file), "utf8"))?.[2];
    if (name !== undefined) return name;
  }
  return undefined;
}

/** Replaces the Editor's default name with `title` in one strings file, leaving every other byte; says whether it did. */
async function renameMap(file: string, title: string): Promise<boolean> {
  const text = await readFile(file, "utf8");
  const match = NAME_LINE.exec(text);
  if (match?.[2] !== EDITOR_DEFAULT_MAP_NAME) return false;
  await writeFile(file, text.slice(0, match.index) + match[1] + title + text.slice(match.index + match[0].length));
  return true;
}

/** The conversations the package's own data defines. */
async function conversationIds(sourceDir: string): Promise<string[]> {
  const file = path.join(sourceDir, "Base.SC2Data", "GameData", "ConversationData.xml");
  if (!existsSync(file)) return [];
  return [...(await readFile(file, "utf8")).matchAll(/<CConversation\b[^>]*\bid="([^"]+)"/g)].map((match) => decodeXmlText(match[1]!));
}
