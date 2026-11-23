// Exports the public cinematic sets (issue #796): the described sets whose every file is Blizzard's,
// see capture/export-sets.ts. Their looks go to a sc2-asset-catalog checkout and their pictures to a
// sc2-mapping-reference checkout, for pull requests there; the private sets are listed with why.
//
//   npm run export-sets -- --catalog <sc2-asset-catalog checkout> --site <sc2-mapping-reference checkout>
//     [--views <dir>] [--looks <file>]
//
// --views is render-set-views' folder (the machine's cache by default), after set-cards has made the
// card pictures and their in-game frames.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publicSets, SET_LOOKS_ABOUT, writeSetPictures } from "../capture/export-sets.js";
import type { RenderedSet } from "../capture/set-views.js";
import type { CinematicSet } from "../cutscene/set-catalog.js";
import { parseSetLooks } from "../cutscene/set-looks.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

/** Where each checkout keeps what it is given. */
export const CATALOG_SETS_FILE = "packages/sc2-asset-catalog/data/set-looks.json";
export const SITE_SETS_FOLDER = "public/sets";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const catalogDir = option("catalog");
  const siteDir = option("site");
  if (!catalogDir || !siteDir) throw new Error("Give --catalog <sc2-asset-catalog checkout> and --site <sc2-mapping-reference checkout>");
  for (const [dir, marker] of [
    [catalogDir, "packages/sc2-asset-catalog/package.json"],
    [siteDir, "public/doodads"],
  ] as const) {
    if (!existsSync(path.join(dir, marker))) throw new Error(`${dir} doesn't look like the checkout: it has no ${marker}`);
  }
  const cache = option("views") ? undefined : hostContext(await loadMachineConfig()).machine.cacheDir;
  const views = option("views") ?? (cache ? path.join(cache, "set-views") : undefined);
  if (!views) throw new Error("No cache folder is set on this machine: give --views <dir>");
  const data = fileURLToPath(new URL("../../data/cinematic-sets/", import.meta.url));
  const looks = parseSetLooks(JSON.parse(await readFile(option("looks") ?? path.join(data, "looks.json"), "utf8")));
  const catalog = (JSON.parse(await readFile(path.join(data, "catalog.json"), "utf8")) as { sets: CinematicSet[] }).sets;
  const records = new Map<string, RenderedSet>();
  for (const id of existsSync(views) ? await readdir(views) : []) {
    const file = path.join(views, id, "set.json");
    if (looks[id] && existsSync(file)) records.set(id, JSON.parse(await readFile(file, "utf8")) as RenderedSet);
  }

  const { sets, leftOut } = publicSets(looks, catalog, records, (id, file) => existsSync(path.join(views, id, file)));
  const json = `${JSON.stringify({ about: SET_LOOKS_ABOUT, sets }, null, 2)}\n`;
  const target = path.join(catalogDir, CATALOG_SETS_FILE);
  const same = existsSync(target) && (await readFile(target, "utf8")) === json;
  if (!same) await writeFile(target, json);
  console.log(`${Object.keys(sets).length} public sets ${same ? "already in" : "written to"} ${target}`);

  const pictures = await writeSetPictures(sets, views, path.join(siteDir, SITE_SETS_FOLDER));
  console.log(`Pictures: ${pictures.written.length} written, ${pictures.kept.length} unchanged, ${pictures.removed.length} removed`);
  for (const file of pictures.missing) console.log(`  not drawn: ${file}`);
  console.log(`${leftOut.length} sets left private:`);
  for (const { id, why } of leftOut) console.log(`  ${id}: ${why}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
