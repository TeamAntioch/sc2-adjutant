// Made-up sets in a temporary views folder: a bar and a street that are public (one published, one
// described since), in core's files, and a ship's bridge and a pilot's den whose files are a
// made-up studio's, in a Workspace's cinematic-sets folder.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RenderedSet } from "@team-antioch/sc2-adjutant/dist/capture/set-views.js";
import type { SetLook as CatalogLook } from "@team-antioch/sc2-asset-catalog/catalog/set-looks.js";

const look = (kind: string, text: string, facets: string[], standsInFor: string[] = [], pictures = [{ file: "card/1.jpg", shows: "the whole place" }]) => ({ kind, look: text, facets, standsInFor, basis: "The overview.", confidence: "high", problems: [], pictures });

export const LOOKS = {
  "dive-bar": look("room", "A small grubby bar with a long counter down one side, stools and a row of bottles under dim red light.", ["interior", "terran", "bar", "small"], ["a tavern scene"]),
  "night-street": look("exterior", "A wet city street at night between tall towers, with neon signs and parked cars along the kerb.", ["exterior", "city", "street", "night"], ["a chase through a city"]),
  "ship-bridge": look("room", "A narrow starship bridge with two pilot seats facing a wide window and consoles along both walls.", ["interior", "terran", "bridge", "ship"], ["a ship's command deck"], [
    { file: "card/1.jpg", shows: "the whole place", game: { capture: "card-1.jpg", lighting: "closest" } } as never,
  ]),
  "pilot-den": look("room", "A cramped crew den behind the bridge with bunks along one wall and a card table in the middle.", ["interior", "terran", "crew", "small"], ["a crew quarters scene"]),
};

const set = (id: string, origins: string[]) => ({ id, name: id, kind: "story", models: [], occurrences: origins.map((origin, n) => ({ origin, file: `Cutscenes/${id}-${n}.SC2Cutscene` })) });
export const CATALOG = { sets: [set("dive-bar", ["blizzard"]), set("night-street", ["blizzard"]), set("ship-bridge", ["blizzard", "studio"]), set("pilot-den", ["studio"])] };

const record = (id: string, name: string, origins: string[]): RenderedSet => ({ id, name, size: [8.24, 12.61, 4.1], cameras: ["Wide", "Close"], missing: [], pieces: 6, files: 2, marks: ["Pilot"], origins, models: ["Console"] });
const RECORDS = [record("dive-bar", "Dive Bar", ["blizzard"]), record("night-street", "Night Street", ["blizzard"]), record("ship-bridge", "Ship Bridge", ["blizzard", "studio"]), record("pilot-den", "Pilot Den", ["studio"])];

/** The published sets: the bar alone, with a look that differs from this checkout's, so a test sees which one a card has. */
export const PUBLISHED = new Map<string, CatalogLook>([
  ["dive-bar", { ...(LOOKS["dive-bar"] as unknown as CatalogLook), name: "Dive Bar", look: "The published look of a small grubby bar with a long counter.", size: [8, 13, 4], cameras: 2, files: ["Cutscenes/dive-bar-0.SC2Cutscene"] }],
]);

/** A views folder, core's looks and catalog files, and a Workspace with its own, holding the sets above, every one drawn with its card picture, the bridge's filmed in game too. */
export async function drawnSets(): Promise<{ dir: string; viewsDir: string; looksFile: string; catalogFile: string; workspaceRoot: string; close(): Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "set-finder-"));
  const viewsDir = path.join(dir, "set-views");
  for (const entry of RECORDS) {
    const folder = path.join(viewsDir, entry.id);
    await mkdir(path.join(folder, "card"), { recursive: true });
    await writeFile(path.join(folder, "set.json"), JSON.stringify(entry));
    for (const file of ["card/1.jpg", "plan.jpg", "overview.jpg"]) await writeFile(path.join(folder, file), `${entry.id} ${file}`);
  }
  await writeFile(path.join(viewsDir, "ship-bridge", "card/1-game.jpg"), "ship-bridge in game");
  const ownIds = ["ship-bridge", "pilot-den"];
  const pick = (own: boolean) => Object.fromEntries(Object.entries(LOOKS).filter(([id]) => ownIds.includes(id) === own));
  const looksFile = path.join(dir, "looks.json");
  await writeFile(looksFile, JSON.stringify(pick(false)));
  const catalogFile = path.join(dir, "catalog.json");
  await writeFile(catalogFile, JSON.stringify({ sets: CATALOG.sets.filter((entry) => !ownIds.includes(entry.id)) }));
  const workspaceRoot = path.join(dir, "workspace");
  await mkdir(path.join(workspaceRoot, "cinematic-sets"), { recursive: true });
  // Described but never drawn: no card.
  await writeFile(path.join(workspaceRoot, "cinematic-sets", "looks.json"), JSON.stringify({ ...pick(true), "undrawn-hall": LOOKS["dive-bar"] }));
  await writeFile(path.join(workspaceRoot, "cinematic-sets", "catalog.json"), JSON.stringify({ sets: [...CATALOG.sets.filter((entry) => ownIds.includes(entry.id)), set("undrawn-hall", ["studio"])] }));
  return { dir, viewsDir, looksFile, catalogFile, workspaceRoot, close: () => rm(dir, { recursive: true, force: true }) };
}
