// Syncs what the author changed in the Editor back into the blueprint (ADR-0001): doodads moved,
// edited, added or deleted; units, points and cameras; regions (a zone's redrawn trigger area,
// or a region of the author's own); and ground raised or lowered and water drawn (sync-terrain.ts). Run it on a map compiled from this blueprint and saved in the
// Editor, before changing the blueprint again.
//
//   npm run sync -- missions/<id>/blueprint.json <map>.SC2Map
//
// A Mod Blueprint, with no map, brings its mod package's Set cutscenes back into their Sets (sync-mod.ts):
//
//   npm run sync -- mods/<id>/blueprint.json

import { readFile } from "node:fs/promises";
import path from "node:path";

import { formatModSync, syncMod } from "../mods/sync-mod.js";
import { formatIssue, workspaceFor } from "../plugins/workspace.js";
import { formatSyncReport, syncMission } from "../sync/sync-mission.js";

async function main(): Promise<void> {
  const [blueprintPath, mapPath] = process.argv.slice(2);
  if (blueprintPath && !mapPath && (await isModBlueprint(blueprintPath))) {
    const result = await syncMod(blueprintPath);
    for (const line of formatModSync(result, (file) => path.join(path.dirname(blueprintPath), file))) console.log(line);
    return;
  }
  if (!blueprintPath || !mapPath) {
    console.error("Usage: sync <blueprint.json> <map.SC2Map>, or sync <mods/<id>/blueprint.json> for a mod");
    process.exitCode = 2;
    return;
  }
  const result = await syncMission(await workspaceFor(blueprintPath), blueprintPath, mapPath);
  if (result.edit && !result.edit.saved) {
    // Refused as a whole, so every change found is listed as not saved, for the author to fix and sync again.
    console.error(`The synced blueprint doesn't validate, so ${blueprintPath} is unchanged. These changes were not saved:`);
    for (const line of formatSyncReport(result, mapPath)) console.error(line);
    throw new Error(`Why it doesn't validate: ${result.edit.issues.map(formatIssue).join("; ")}`);
  }
  for (const line of formatSyncReport(result, mapPath)) console.log(line);
}

/** Whether the Blueprint at `file` is a Mod Blueprint (a Campaign Mod's or an Asset Mod's), by its kind. */
async function isModBlueprint(file: string): Promise<boolean> {
  try {
    const kind = (JSON.parse(await readFile(file, "utf8")) as { kind?: unknown }).kind;
    return kind === "campaign" || kind === "asset";
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
