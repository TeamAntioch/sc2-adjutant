// The names a Workspace's story is told in: its Campaign's id and name, its mods' ids and names, its
// Campaign Mod's, its characters' (as their Mod Blueprints declare them), and each Mission's folder,
// id, title and the speakers its Screenplay gives. Nothing sent to the public sc2-asset-catalog may
// hold one (its CONTRIBUTING's one rule), so contribute_doodad_notes keeps back a note that does
// (doodad-notes-contribute.ts). Blueprints are read as raw JSON, so one that won't validate still
// gives its names, and one that won't read gives its folder's.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { campaignModName, MODS_DIR, type Workspace } from "../plugins/workspace.js";

/** A name shorter than this, once its punctuation is gone, is too short to tell from general words. */
const SHORTEST = 3;

/** Lower case, with every run of anything but letters and digits one space, and a space at each end. */
const words = (text: string): string => ` ${text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The names `text` holds, as whole words, in any case, spacing or punctuation; a name spelt several ways, once, as first spelt. */
export function namedIn(text: string, names: readonly string[]): string[] {
  const said = words(text);
  const found = new Map<string, string>();
  for (const name of names) {
    const key = words(name);
    if (key.trim().length >= SHORTEST && said.includes(key) && !found.has(key)) found.set(key, name);
  }
  return [...found.values()];
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The strings under `keys` anywhere in `value`. */
function stringsUnder(value: unknown, keys: ReadonlySet<string>, into: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) stringsUnder(item, keys, into);
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string") into.push(item);
      else stringsUnder(item, keys, into);
    }
  }
  return into;
}

const top = (value: unknown, keys: readonly string[]): string[] => (isRecord(value) ? keys.map((key) => value[key]).filter((item): item is string => typeof item === "string") : []);

/** A Mod Blueprint's id and name, and its characters' speakers and names. */
const modNames = (blueprint: unknown): string[] => [
  ...top(blueprint, ["id", "name"]),
  ...(isRecord(blueprint) && Array.isArray(blueprint.characters) ? blueprint.characters.flatMap((character) => top(character, ["speaker", "name"])) : []),
];

/** A Mission Blueprint's id, Campaign id and title, its Screenplay's title and its speakers. */
const missionNames = (blueprint: unknown): string[] => [
  ...top(blueprint, ["id", "campaignId", "title"]),
  ...(isRecord(blueprint) ? top(blueprint.screenplay, ["title"]) : []),
  ...stringsUnder(blueprint, new Set(["speaker"])),
];

/** Every name the Workspace's story is told in, each once. */
export async function workspaceStoryNames(
  workspace: Pick<Workspace, "root" | "campaign" | "missionsDir" | "mods" | "campaignMod"> & { readonly registry: Pick<Workspace["registry"], "campaignMod"> },
): Promise<string[]> {
  const mod = campaignModName(workspace);
  const names = [workspace.campaign.id, workspace.campaign.name, ...(mod ? [mod] : [])];
  for (const mod of workspace.mods) names.push(mod, ...modNames(await readJson(path.join(workspace.root, MODS_DIR, mod, "blueprint.json"))));
  const missions = existsSync(workspace.missionsDir) ? await readdir(workspace.missionsDir, { withFileTypes: true }) : [];
  for (const mission of missions.filter((entry) => entry.isDirectory())) {
    names.push(mission.name, ...missionNames(await readJson(path.join(workspace.missionsDir, mission.name, "blueprint.json"))));
  }
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}
