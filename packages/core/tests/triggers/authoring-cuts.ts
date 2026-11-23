// Editor cuts (fixtures/editor-triggers) as the authoring tool and its outline read them: a cut's
// trigger files, the libraries in reach and the map's own elements, and its Kept triggers converted
// as convert_triggers reads them.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import type { BlueprintTrigger } from "../../src/domain/blueprint-trigger.js";
import { convertKeptTriggers, type KeptPackageFiles } from "../../src/map/convert-mission-triggers.js";
import { authoringMapReach } from "../../src/map/write-blueprint-trigger.js";
import { type GameLibrary, gameTriggerLibraries } from "../../src/mods/library-galaxy.js";
import { packageLibraries } from "../../src/mods/library-reach.js";
import type { MapReach } from "../../src/triggers/author-trigger.js";
import { libraryItems } from "../../src/triggers/splice-triggers.js";

export const CUTS = fileURLToPath(new URL("../fixtures/editor-triggers/", import.meta.url));
export const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";

export type Cut = { readonly files: KeptPackageFiles; readonly libraries: Readonly<Record<string, GameLibrary>>; readonly map: MapReach };

/** A cut's trigger files, the libraries in reach (the game's, and the cut's mod's), and the map's own elements in reach. */
export async function cut(dir: string, mod?: string): Promise<Cut> {
  const read = async (file: string): Promise<string> => readFile(path.join(CUTS, dir, file), "utf8").catch(() => "");
  const gameStrings = await read("GameStrings.txt");
  const files: KeptPackageFiles = { triggers: await read("Triggers"), triggerStrings: await read("TriggerStrings.txt"), script: await read("MapScript.galaxy"), gameStrings: new Map(gameStrings ? [[GAME_STRINGS, gameStrings]] : []) };
  const libraries = { ...gameTriggerLibraries(), ...(mod ? await packageLibraries(path.join(CUTS, dir, mod)) : {}) };
  const kept = [...libraryItems(files.triggers)].map(([, item]) => item);
  return { files, libraries, map: authoringMapReach({ ...files, gameStrings: [...files.gameStrings.values()] }, kept, { triggers: [], variables: [] }) };
}

/** The cut's Kept trigger `name`, converted as convert_triggers reads it. */
export function converted({ files, libraries }: Cut, name: string): BlueprintTrigger {
  const conversion = convertKeptTriggers(files, { triggers: [name], libraries });
  expect(conversion.refused).toEqual([]);
  return conversion.converted[0]!.trigger;
}
