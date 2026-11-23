#!/usr/bin/env node
// Regenerates the Antioch Style Pack's composites.json: its shared library of Doodad Composite recipes (DL-07),
// captured from the Exemplar Maps' Objects the way `npm run capture-composite` captures one from a
// region, with a circle round each shape and only its own types: four of the five recipes DL-07
// confirmed. 3-3's stretched trim is left out: one strip is no shape, and scattered it read as
// random (the author, 2026-10-27); trim needs a placement along an edge, not a recipe.
// 3-4's missile tower brings 3-4's own AntimatterMissileDoodad actor (the Scout's missile model as a
// doodad), read from the map's ActorData.
//
// Blizzard's recipes (DL-07, DL-19) come from blizzard-composites.json beside the library and are appended as they are,
// then the author's own (author-composites.json), built in the Editor.
//
// Usage, from the Workspace root: npm run build && node packages/core/scripts/build-composites.mjs

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { captureComposite } from "../dist/dressing/capture-composite.js";
import { readDoodadActors } from "../dist/map/read-doodad-actors.js";
import { exemplarMapSources, loadWorkspace, stylePackFiles } from "../dist/plugins/workspace.js";
import { loadMapPackage } from "../dist/study/load-map-package.js";
import { terrainHeightAt } from "../dist/study/terrain-grid.js";
import { workspaceRoot } from "./workspace-root.mjs";

// The active Style Pack's Exemplar Maps, with source maps from the machine config's exemplarMaps folder.
const workspace = await loadWorkspace(workspaceRoot());
const exemplars = await exemplarMapSources(workspace);
// Written over the active Style Pack's library, as its manifest names it.
const { compositesFile } = stylePackFiles(workspace);
if (!compositesFile) throw new Error("The Workspace's Style Pack names no Doodad Composites file (contributions.composites)");

const RECIPES = [
  {
    map: "3-4",
    at: { x: 51.83, y: 202.55 },
    radius: 1.6,
    types: ["AntimatterMissileDoodad"],
    id: "missile-tower",
    kind: "landmark",
    style: "built",
    description: "A tall tower of stacked missiles: the Scout's missile model as a doodad, four columns four high (3-4).",
  },

  {
    map: "3-4",
    at: { x: 94.68, y: 97.19 },
    radius: 3.8,
    types: ["ProtossCratesDoodad", "GenericSpacePipes", "StarShipAdun_StasisPods", "Aiur_CityBuilding_Floating_Temple"],
    anyVariation: ["ProtossCratesDoodad"],
    id: "conduit-ring",
    kind: "landmark",
    style: "built",
    description: "A ring machine: 35 crates rolled onto their sides in a closed circle, blue pipes crossing it, pods and temple pieces at its quarters (3-4, Spaceship-148).",
  },
  {
    map: "3-7",
    at: { x: 120, y: 160 },
    radius: 1.2,
    types: ["TempleColumn"],
    id: "crowned-column",
    kind: "landmark",
    style: "built",
    description: "A temple column crowned with four small columns raised 3.3 above it, facing out; used in pairs either side of a shrine (3-7).",
  },

  {
    map: "3-11",
    types: ["TarSludge"],
    anyVariation: ["TarSludge"],
    id: "sunk-tar",
    kind: "detail",
    style: "natural",
    scale: [0.2, 1.1],
    description: "Tar sludge sunk 0.27 below the ground and tinted blue-black, so it reads as a stain, not an object (3-11, 3-3).",
  },
];

const composites = [];
for (const recipe of RECIPES) {
  const entry = exemplars.find((e) => e.id === recipe.map);
  const dir = entry.source;
  const map = loadMapPackage(dir);
  const actorData = path.join(dir, "Base.SC2Data/GameData/ActorData.xml");
  const actors = existsSync(actorData) ? readDoodadActors(readFileSync(actorData, "utf8")) : new Map();
  // Without a spot, the first doodad of the type, alone.
  const first = map.objects.doodads.find((d) => recipe.types.includes(d.type));
  const at = recipe.at ?? first.position;
  const radius = recipe.radius ?? 0.1;
  const { map: _map, at: _at, radius: _radius, anyVariation: _any, ...options } = recipe;
  const composite = captureComposite(map.objects.doodads, [{ type: "circle", center: at, radius }], (x, y) => terrainHeightAt(map, x, y), { ...options, actors });
  // A one-piece recipe's size comes from its range, so its member is at scale 1 and yaw 0.
  if (composite.members.length === 1) composite.members = composite.members.map((m) => ({ ...m, yaw: 0, scale: typeof m.scale === "number" ? 1 : m.scale }));
  // Members whose variant isn't part of the shape pick their own in each copy (DL-07, against repetition).
  composite.members = composite.members.map((m) => (recipe.anyVariation?.includes(m.type) ? { ...m, variation: "any" } : m));
  composites.push(composite);
  console.log(`${recipe.id}: ${composite.members.length} members from ${recipe.map}`);
}
// Then the recipes cut whole from Blizzard's campaign maps, kept in their own file
// beside the library because their source maps aren't Exemplar Maps.
const blizzardFile = path.join(path.dirname(compositesFile), "blizzard-composites.json");
if (existsSync(blizzardFile)) {
  for (const composite of JSON.parse(readFileSync(blizzardFile, "utf8")).composites) {
    composites.push(composite);
    console.log(`${composite.id}: ${composite.members.length} members from blizzard-composites.json`);
  }
}
// Then the author's own recipes, built and checked in the Editor, in their own file beside the library.
const authorFile = path.join(path.dirname(compositesFile), "author-composites.json");
if (existsSync(authorFile)) {
  for (const composite of JSON.parse(readFileSync(authorFile, "utf8")).composites) {
    composites.push(composite);
    console.log(`${composite.id}: ${composite.members.length} members from author-composites.json`);
  }
}
await writeFile(
  compositesFile,
  `${JSON.stringify({ source: "Doodad Composite recipes (DL-07), captured from the Exemplar Maps' Objects by scripts/build-composites.mjs, then Blizzard's from blizzard-composites.json, then the author's from author-composites.json", composites }, null, 2)}\n`,
);
