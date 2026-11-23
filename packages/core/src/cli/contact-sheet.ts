// Builds the contact-sheet map: a copy of an Editor-saved base map (depending on the Campaign Mod)
// whose triggers play one generated cutscene per cinematic set and announce each shot for
// `npm run capture-sets` to screenshot. Writes the map and a manifest of its shots.
//
//   npm run contact-sheet -- --source <kind>=<Campaign repo> \
//     --source blizzard=$SC2_RESEARCH_DIR/docs/research/cutscene-cinematography/downloads \
//     --base missions/cutscene-tests/output/exp-cs-6-dialog-cinematic.SC2Map \
//     --out <dir> [--only <set id>,<set id>] [--limit 5] [--kind story] [--pause 30] [--originals]
//     [--cards [--looks <file>] [--views <dir>] [--blender <program>]
//       [--pick-light | --light-test <set id>,...]]
//
// --cards films each set's Set Finder card pictures (core's data/cinematic-sets/looks.json, or a
// Workspace's with --looks) from the cameras Blender drew them with, the ones the game can film
// (cutscene/card-cameras.ts), so capture-sets can lay each frame beside its card. Only sets with a look are taken. A compass card
// at the set's centre, or recorded without its floor, is measured in Blender (shootSet with no
// shots, about ten seconds a set), so the sets must have been drawn by render-set-views.
//
// --pick-light films each card camera under each of its lightings (cutscene/light-test.ts
// lightings: all its lamps, the lamps of the shots each lamp rule picks, or for an exterior higher
// exposures), and capture-sets keeps the frame whose brightness is nearest the target.
//
// --light-test films each named set's first card camera under a run of lighting variants instead
// (cutscene/light-test.ts): lit by the lamps of the shots of its file each lamp rule picks.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shootSet } from "../capture/set-views.js";
import { filterOf, type Measure, needsMeasure, planCardShots } from "../cutscene/card-cameras.js";
import { INDEX_VERSION } from "../cutscene/compile-cutscene.js";
import { hideErrorsDuringTest } from "../capture/capture-copy.js";
import { buildCardSheet, buildContactSheet, buildOriginalSheet, type CardSheetEntry, type ContactSheet, sheetDependencies, sourceKey } from "../cutscene/contact-sheet.js";
import { loadCatalogSources } from "../cutscene/load-sources.js";
import { buildSetCatalog, type CinematicSet } from "../cutscene/set-catalog.js";
import { parseSetLooks } from "../cutscene/set-looks.js";
import { lightings, lightVariants, type TestLight, testLightData } from "../cutscene/light-test.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";
import { readDocumentHeader, withDocumentHeaderDependencies } from "../map/read-document-header.js";
import { withCustomScript } from "../triggers/custom-script.js";

const MAP_NAME = "cinematic-set-sheet.SC2Map";

/** The card sheet for `sets`: each set's card cameras, one entry per choice of pieces, and the cards left out. */
async function cardEntries(sets: readonly CinematicSet[], looksFile: string, views: string, blender: string): Promise<CardSheetEntry[]> {
  const looks = parseSetLooks(JSON.parse(await readFile(looksFile, "utf8")));
  const entries: CardSheetEntry[] = [];
  for (const set of sets) {
    const pictures = looks[set.id]?.pictures ?? [];
    const setDir = path.join(views, set.id);
    // Blender's measure of the pieces each compass look keeps: render-set.py stands one with no
    // point at their bounds' centre, and measures from the floor it guesses where none is recorded.
    const measures = new Map<string, Measure>();
    for (const picture of pictures) {
      if (!picture.from || !needsMeasure(picture.from) || !existsSync(path.join(setDir, "spec.json"))) continue;
      const filter = filterOf(picture.from);
      const key = JSON.stringify(filter);
      if (measures.has(key)) continue;
      const scratch = path.join(setDir, "card", ".measure");
      try {
        const { min, max, floor } = await shootSet({ setDir, blender, shots: [], outDir: scratch, ...(filter.only ? { only: new RegExp(filter.only, "i") } : {}), ...(filter.without ? { without: new RegExp(filter.without, "i") } : {}) });
        measures.set(key, { centre: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2], floor });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
    const plan = planCardShots(pictures, (filter) => measures.get(JSON.stringify(filter)));
    for (const { card, why } of plan.skipped) console.log(`${set.id}/${card}: not filmed, ${why}`);
    entries.push(...plan.groups.map((group) => ({ set, ...group })));
  }
  return entries;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const [base, out] = ["base", "out"].map(option);
  if (!args.includes("--source") || !base || !out) {
    console.error(
      "Usage: contact-sheet --source <kind>=<dir> [--source <kind>=<dir> ...] [--workspace <dir>] --base <map.SC2Map> --out <dir> [--only ids] [--limit n] [--kind story|menu|all] [--pause seconds] [--originals | --cards [--looks file] [--views dir] [--blender program]]",
    );
    process.exitCode = 2;
    return;
  }
  const { kinds, sources } = await loadCatalogSources(args);
  const kind = option("kind") ?? "story";
  const only = option("only")?.split(",");
  let sets = buildSetCatalog(sources, kinds).filter((set) => (only ? only.includes(set.id) : kind === "all" || set.kind === kind));
  if (option("limit")) sets = sets.slice(0, Number(option("limit")));
  if (sets.length === 0) throw new Error("No sets selected");

  const pause = Number(option("pause") ?? 30);
  const byKey = new Map(sources.map((source) => [sourceKey(source.origin, source.path), source]));
  // --originals plays each set's own cutscene at its own cuts; otherwise a generated tour of its pieces.
  const originals = args.includes("--originals");
  const original = originals ? buildOriginalSheet(sets, byKey, pause) : undefined;
  let sheet: ContactSheet;
  let views: string | undefined;
  const testLights: TestLight[] = [];
  if (args.includes("--cards")) {
    views = path.resolve(option("views") ?? path.join(hostContext(await loadMachineConfig()).requirePath("cacheDir"), "set-views"));
    const looksFile = option("looks") ?? fileURLToPath(new URL("../../data/cinematic-sets/looks.json", import.meta.url));
    let entries = await cardEntries(sets, looksFile, views, option("blender") ?? "blender");
    if (entries.length === 0) throw new Error("None of the sets has a card picture the game can film");
    const lightTest = option("light-test");
    if (args.includes("--pick-light")) {
      const lit: typeof entries = [];
      let tests = 0;
      for (const group of entries) {
        const occurrence = group.set.occurrences[0]!;
        const source = byKey.get(sourceKey(occurrence.origin, occurrence.file));
        if (!source) throw new Error(`No source file for set ${group.set.id}`);
        for (const camera of group.cameras) {
          const ways = lightings(group.set, source, camera, `CsPickLight${++tests}`, { all: true });
          // A set with no lamps and no base Light has only the sheet's own lighting.
          if (ways.length === 0) lit.push({ ...group, cameras: [camera] });
          for (const way of ways) {
            lit.push({ ...group, cameras: [camera], lighting: way.name, lamps: way.lamps, ...(way.light ? { light: way.light } : {}) });
            testLights.push(...way.lights);
          }
        }
      }
      entries = lit;
    } else if (lightTest) {
      const tested: typeof entries = [];
      lightTest.split(",").forEach((id, index) => {
        const first = entries.find((entry) => entry.set.id === id);
        if (!first) throw new Error(`--light-test: ${id} has no card camera the game can film (is it in --only?)`);
        const filter = { ...(first.only ? { only: first.only } : {}), ...(first.without ? { without: first.without } : {}) };
        const occurrence = first.set.occurrences[0]!;
        const source = byKey.get(sourceKey(occurrence.origin, occurrence.file));
        if (!source) throw new Error(`No source file for set ${id}`);
        const variants = lightVariants(first.set, source, first.cameras[0]!, index + 1, "CsLightTest");
        tested.push(...variants.entries.map((entry) => ({ ...filter, ...entry })));
        testLights.push(...variants.lights);
      });
      entries = tested;
    }
    sheet = buildCardSheet(entries, byKey, pause);
  } else sheet = original ?? buildContactSheet(sets, byKey, pause);
  if (original?.skipped.length) console.log(`No usable cut in ${original.skipped.length} sets' files: ${original.skipped.join(", ")}`);
  const map = path.join(out, MAP_NAME);
  await rm(map, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(base, map, { recursive: true });
  await rm(path.join(map, "MapScript.galaxy"), { force: true });
  // Data errors would print over every frame; and the story campaigns hold Blizzard's set models.
  await writeFile(path.join(map, "MapInfo"), hideErrorsDuringTest(await readFile(path.join(map, "MapInfo"))));
  const header = await readFile(path.join(map, "DocumentHeader"));
  const dependencies = sheetDependencies(readDocumentHeader(header).dependencies);
  await writeFile(path.join(map, "DocumentHeader"), withDocumentHeaderDependencies(header, dependencies));
  const info = await readFile(path.join(map, "DocumentInfo"), "utf8");
  const listed = `<Dependencies>\n${dependencies.map((dependency) => `        <Value>${dependency}</Value>\n`).join("")}    </Dependencies>`;
  await writeFile(path.join(map, "DocumentInfo"), /<Dependencies>[\s\S]*?<\/Dependencies>/.test(info) ? info.replace(/<Dependencies>[\s\S]*?<\/Dependencies>/, listed) : info.replace("</DocInfo>", `    ${listed}\n</DocInfo>`));
  await writeFile(path.join(map, "Triggers"), withCustomScript(undefined, "C5500001", sheet.script, "Cs_Init"));
  const components = await readFile(path.join(map, "ComponentList.SC2Components"), "utf8");
  if (!components.includes('Type="cuts"')) {
    await writeFile(path.join(map, "ComponentList.SC2Components"), components.replace("</Components>", '    <DataComponent Type="cuts">Cutscenes/Index</DataComponent>\n</Components>'));
  }
  const lightData = testLightData(testLights);
  if (lightData) {
    await mkdir(path.join(map, "Base.SC2Data", "GameData"), { recursive: true });
    await writeFile(path.join(map, "Base.SC2Data", "GameData", "LightData.xml"), lightData);
  }
  const cutscenes = path.join(map, "Base.SC2Data", "Cutscenes");
  await mkdir(cutscenes, { recursive: true });
  await writeFile(path.join(cutscenes, "Index.version"), INDEX_VERSION);
  for (const cutscene of sheet.cutscenes) await writeFile(path.join(cutscenes, cutscene.file), cutscene.xml);
  await writeFile(path.join(out, "cinematic-set-sheet.manifest.json"), `${JSON.stringify({ map, shots: sheet.shots, ...(views ? { views } : {}) }, null, 1)}\n`);
  const minutes = Math.ceil((sheet.cutscenes.length * 3 + sheet.shots.length * (originals ? 2.5 : 4)) / 60);
  console.log(`${new Set(sheet.cutscenes.map((cutscene) => cutscene.setId)).size} sets, ${sheet.shots.length} shots (about ${minutes} min in game) written to ${map}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
