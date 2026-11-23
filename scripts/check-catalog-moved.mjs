// Run by `npm run lint` and `npm test`: the doodad catalog, the Doodad Finder (ADR-0022, #679), the
// Set Finder (#796, #802) and the texture, decal and cliff catalogs (#827, #828, #829) now live in the public TeamAntioch/sc2-asset-catalog, and
// sc2-adjutant depends on its published packages, pinned. This fails when a module that moved there
// is back in core, packages/doodad-finder or packages/set-finder, or when a pin isn't an exact
// version or the packages' pins disagree.
// With --installed (CI), it also fails when node_modules holds anything but the pinned, published
// packages: a sibling checkout linked with `npm run link-catalog`, or another version.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The published packages sc2-adjutant depends on. */
export const CATALOG_PACKAGES = ["@team-antioch/sc2-asset-catalog", "@team-antioch/sc2-finder-kit", "@team-antioch/sc2-doodad-finder", "@team-antioch/sc2-set-finder"];

/** The modules that moved to sc2-asset-catalog, by their old paths from the repo's root. None may come back. */
export const MOVED_MODULES = [
  // To @team-antioch/sc2-asset-catalog.
  ...[
    "doodad-catalog",
    "doodads",
    "doodad-uses",
    "doodad-dependencies",
    "doodad-facings",
    "doodad-search",
    "doodad-notes",
    "doodad-card-html",
    "catalog-sheets",
    "catalog-sheet",
    "doodad-thumbnails",
    "render-thumbnails",
    "extract-doodads",
  ].map((name) => `packages/core/src/catalog/${name}.ts`),
  ...["extract-doodads", "build-doodad-catalog", "build-doodad-models", "build-catalog-sheets"].map((name) => `packages/core/scripts/${name}.mjs`),
  // The texture catalog (#827): its descriptions are the package's, its extracted fields core's data/texture-extracted.json.
  "packages/core/src/catalog/texture-pictures.ts",
  "packages/core/scripts/build-texture-catalog.mjs",
  "packages/core/data/texture-catalog.json",
  "packages/core/data/tileset-textures.json",
  // The decal catalog (#828): its descriptions are the package's, its extracted fields the user's cache.
  "packages/core/src/catalog/decal-catalog.ts",
  "packages/core/scripts/build-decal-sheets.mjs",
  "packages/core/data/decal-catalog.json",
  // The cliff catalog (#829): its descriptions are the package's, its extracted fields core's data/cliff-extracted.json.
  "packages/core/scripts/build-cliff-catalog.mjs",
  "packages/core/data/cliff-catalog.json",
  "packages/core/data/tileset-cliff-sets.json",
  // To @team-antioch/sc2-doodad-finder.
  ...[
    "start",
    "server",
    "page",
    "asker",
    "finder",
    "stock-sources",
    "cards",
    "card-html",
    "narrow",
    "tags",
    "tray",
    "settings",
    "spend-cap",
    "cache-dir",
    "embedder",
    "embedding-index",
    "credentials",
    "jev-ranker",
    "ranker",
    "wording",
    "payload-log",
    "cli/doodad-finder",
  ].map((name) => `packages/doodad-finder/src/${name}.ts`),
  // To @team-antioch/sc2-set-finder: the cards, narrowing, Jev ranker, page, server, finder and test asks.
  ...["cards", "narrow", "jev", "page", "server", "set-finder", "test-asks", "cli/test-set-finder"].map((name) => `packages/set-finder/src/${name}.ts`),
  ...["cards", "narrow", "jev", "server", "set-finder", "test-asks"].map((name) => `packages/set-finder/tests/${name}.test.ts`),
];

/** The package.json files that depend on the published packages. */
const DEPENDENTS = ["packages/core/package.json", "packages/doodad-finder/package.json", "packages/set-finder/package.json"];

/** What's wrong with the pins in some package.json texts (by file): each must be an exact version, the same in every file. */
export function pinProblems(manifests) {
  const problems = [];
  const pins = new Map();
  for (const [file, text] of Object.entries(manifests)) {
    const dependencies = JSON.parse(text).dependencies ?? {};
    for (const name of CATALOG_PACKAGES) {
      const version = dependencies[name];
      if (version === undefined) continue;
      if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${file}: ${name} is "${version}", not an exact version`);
      if (pins.has(name) && pins.get(name) !== version) problems.push(`${file}: ${name} is ${version}, but ${pins.get(name)} elsewhere`);
      pins.set(name, version);
    }
  }
  if (pins.size > 0 && new Set(pins.values()).size > 1) problems.push(`the packages are pinned at different versions (${[...pins].map(([name, version]) => `${name} ${version}`).join(", ")}): they're released together`);
  return { problems, pins };
}

/** What's wrong with the installed packages: a link, or a version other than the pin. */
function installedProblems(pins) {
  const problems = [];
  for (const [name, version] of pins) {
    const folder = path.join(ROOT, "node_modules", name);
    if (!existsSync(folder)) problems.push(`${name} isn't installed: run npm ci`);
    else if (lstatSync(folder).isSymbolicLink()) problems.push(`${name} is linked to a checkout (npm run link-catalog): run npm run unlink-catalog`);
    else {
      const installed = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).version;
      if (installed !== version) problems.push(`${name} ${installed} is installed, not the pinned ${version}: run npm ci`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = MOVED_MODULES.filter((file) => existsSync(path.join(ROOT, file))).map((file) => `${file} moved to sc2-asset-catalog: import it from the published package instead`);
  const { problems: pinned, pins } = pinProblems(Object.fromEntries(DEPENDENTS.map((file) => [file, readFileSync(path.join(ROOT, file), "utf8")])));
  problems.push(...pinned);
  if (process.argv.includes("--installed")) problems.push(...installedProblems(pins));
  if (problems.length > 0) {
    console.error(`The doodad, texture, decal and cliff catalogs, the Doodad Finder and the Set Finder are sc2-asset-catalog's (scripts/check-catalog-moved.mjs):\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exitCode = 1;
  }
}
