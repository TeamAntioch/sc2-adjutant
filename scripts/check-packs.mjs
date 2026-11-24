// Run by `npm run check-packs` and at the end of `npm test`: what each public package's tarball
// would hold, from `npm pack --dry-run`. A package fails when its tarball is over the size limit,
// when a file it needs to load is missing from it, or when it holds a path that must not ship. It
// packs the built packages, so build first (`npm run check-packs` does).
//
// A file a package needs: its package.json's main, bin and exports targets (other than patterns),
// and, for a Plugin, its manifest's entry and the files its contributions name (knowledge, prompts,
// Exemplar Maps with each one's Map Study, Composites, lights and each skill's SKILL.md), and the
// files its code reads by path, in RUNTIME_FILES.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_PACKAGES } from "./public-packages.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The largest tarball a package may pack to, in bytes. */
export const MAX_TARBALL_BYTES = 20 * 1024 * 1024;

/** Folder names that never ship, wherever they are in a package. */
const FORBIDDEN_FOLDERS = ["tests", "frames", "evidence", "captures"];
/** Folders that never ship, from the package's root. */
const FORBIDDEN_PREFIXES = ["data/thumbnails/", "data/catalog-sheets/", "data/cinematic-sets/plans/"];
/** File names that never ship, in any folder: the Editor's own minimap of a map, which a Map Study copies. */
const FORBIDDEN_NAMES = ["minimap.png"];

const MANIFEST = "sc2-adjutant-plugin.json";

/**
 * Files a package's code reads by a path relative to itself, which neither package.json nor a
 * manifest names. Core also needs every JSON file in its data/ and data/cinematic-sets/, each
 * with a row in data/README.md saying why it ships (see coreDataFiles).
 */
const RUNTIME_FILES = {
  core: ["blender/render-set.py", "dist/cli/editor-broker.js"],
  "plugin-host-windows": ["dist/helpers/capture.cs", "dist/helpers/editor.cs", "dist/helpers/speech.cs"],
  // Core loads the Finders' entries by path from the package it resolves (core's mcp/find-doodads.ts,
  // find-sets.ts), and open_doodad_finder starts the Finder's CLI by its path.
  "doodad-finder": ["dist/find-doodads.js", "dist/open-doodad-finder.js", "dist/adjutant/cli.js"],
  "set-finder": ["dist/find-sets.js"],
  // The skill runs the command by its path, and the build reads the runtime it fills in by its path.
  "plugin-anim-testbed": ["dist/testbed.js", "runtime/testbed.galaxy", "examples/stock-units.json"],
};

/** Core's data folders whose JSON files ship, relative to its root. */
const CORE_DATA_FOLDERS = ["data", "data/cinematic-sets"];
/** Where core records why each of its data files ships. */
const CORE_DATA_README = "data/README.md";

/**
 * Core's data files and the problems with data/README.md's record of them: `readme` is its text,
 * `dataFiles` each JSON file in CORE_DATA_FOLDERS (relative to core's root). Each file needs a row
 * whose first cell is its path relative to data/ in backticks and whose last cell says why it ships;
 * a row for a file that isn't there is a problem too. Gives `{ required, problems }`, `required` as
 * requiredFiles gives it, with each file's reason as its `why`.
 */
export function coreDataFiles(readme, dataFiles) {
  const reasons = new Map();
  for (const line of readme.split("\n")) {
    const row = /^\|\s*`([^`]+\.json)`\s*\|.*\|\s*([^|]*?)\s*\|\s*$/.exec(line);
    if (row) reasons.set(`data/${row[1]}`, row[2]);
  }
  const problems = [];
  const required = [];
  for (const file of dataFiles) {
    const why = reasons.get(file);
    if (why) required.push({ path: file, why: `read at run time: ${why}` });
    else problems.push(`${file} has no row in ${CORE_DATA_README} saying why it ships`);
  }
  for (const file of reasons.keys()) {
    if (!dataFiles.includes(file)) problems.push(`${CORE_DATA_README} has a row for ${file}, which isn't there`);
  }
  return { required, problems };
}

/** RUNTIME_FILES for the package in packages/`name`, and for core its data files as they are in the checkout. */
async function runtimeFiles(name, folder) {
  const required = (RUNTIME_FILES[name] ?? []).map((file) => ({ path: file, why: "read at run time" }));
  if (name !== "core") return { required, problems: [] };
  const dataFiles = [];
  for (const dataFolder of CORE_DATA_FOLDERS) {
    const names = (await readdir(path.join(folder, dataFolder))).filter((file) => file.endsWith(".json")).sort();
    dataFiles.push(...names.map((file) => `${dataFolder}/${file}`));
  }
  const data = coreDataFiles((await readFile(path.join(folder, CORE_DATA_README), "utf8").catch(() => "")), dataFiles);
  return { required: [...required, ...data.required], problems: data.problems };
}

/** `file` relative to a package's root, as npm lists it: no leading `./`, forward slashes. */
function packagePath(file) {
  return path.posix.normalize(file.split(path.sep).join("/")).replace(/^\.\//, "").replace(/\/$/, "");
}

/** Every file target in a package.json `exports` value, whatever its conditions. Patterns (`*`) are left out. */
function exportTargets(exports) {
  if (typeof exports === "string") return exports.includes("*") ? [] : [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (exports && typeof exports === "object") return Object.values(exports).flatMap(exportTargets);
  return [];
}

/**
 * What a package needs in its tarball, from its package.json and, for a Plugin, its manifest and the
 * Exemplar Map list it names: each as `{ path, why }`, `path` relative to the package's root.
 */
export function requiredFiles(packageJson, manifest, exemplarIds = []) {
  const required = [];
  const need = (file, why) => required.push({ path: packagePath(file), why });
  if (packageJson.main) need(packageJson.main, "main");
  if (typeof packageJson.bin === "string") need(packageJson.bin, "bin");
  else for (const [name, file] of Object.entries(packageJson.bin ?? {})) need(file, `bin ${name}`);
  for (const file of exportTargets(packageJson.exports)) need(file, "exports");
  if (!manifest) return required;
  need(MANIFEST, "the Plugin manifest");
  const contributions = manifest.contributions ?? {};
  if (manifest.entry) need(manifest.entry, "the manifest's entry");
  for (const document of contributions.knowledge ?? []) need(document.file, `knowledge ${document.id}`);
  for (const prompt of contributions.prompts ?? []) need(prompt.file, `prompt ${prompt.name}`);
  if (contributions.composites) need(contributions.composites, "composites");
  if (contributions.lights) need(contributions.lights, "lights");
  if (contributions.exemplarMaps) {
    need(contributions.exemplarMaps, "exemplarMaps");
    const folder = path.posix.dirname(packagePath(contributions.exemplarMaps));
    for (const id of exemplarIds) need(path.posix.join(folder, id, "study.json"), `Exemplar Map ${id}'s Map Study`);
  }
  for (const skill of contributions.skills ?? []) need(path.posix.join(packagePath(skill), "SKILL.md"), `skill ${skill}`);
  return required;
}

/** Why a path in a tarball must not ship, or undefined if it may. */
function forbidden(file) {
  const folder = file.split("/").slice(0, -1).find((part) => FORBIDDEN_FOLDERS.includes(part));
  if (folder) return `${folder}/ doesn't ship`;
  const name = FORBIDDEN_NAMES.find((forbiddenName) => path.posix.basename(file) === forbiddenName);
  if (name) return `${name} doesn't ship`;
  const prefix = FORBIDDEN_PREFIXES.find((start) => file.startsWith(start));
  return prefix ? `${prefix} doesn't ship` : undefined;
}

/**
 * The problems with one package's tarball: `pack` is what `npm pack --dry-run --json` lists for it
 * (`size`, the tarball's bytes, and `files`, each with its `path`), and `required` what
 * requiredFiles gives for it.
 */
export function packProblems(pack, required, maxBytes = MAX_TARBALL_BYTES) {
  const problems = [];
  const files = pack.files.map((file) => file.path);
  const present = new Set(files);
  if (pack.size > maxBytes) problems.push(`its tarball is ${megabytes(pack.size)}, over the ${megabytes(maxBytes)} limit`);
  for (const { path: file, why } of required) {
    if (!present.has(file)) problems.push(`${file} (${why}) is missing from its tarball`);
  }
  const blocked = new Map();
  for (const file of files) {
    const reason = forbidden(file);
    if (reason) blocked.set(reason, [...(blocked.get(reason) ?? []), file]);
  }
  for (const [reason, shipped] of blocked) problems.push(`${reason}, but its tarball has ${shipped.length} file${shipped.length === 1 ? "" : "s"} there (${shipped.slice(0, 3).join(", ")}${shipped.length > 3 ? ", …" : ""})`);
  return problems;
}

function megabytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The dry-run listing of the package in `folder`. npm 10 and 11 print an array, npm 12 an object keyed by package name. */
function dryRun(folder) {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: folder,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const listing = JSON.parse(output);
  const [pack] = Array.isArray(listing) ? listing : Object.values(listing);
  if (!pack?.files) throw new Error(`npm pack --dry-run printed no file list for ${folder}`);
  return pack;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function selfCheck() {
  const required = requiredFiles(
    { main: "./dist/main.js", bin: { tool: "dist/cli/tool.js" }, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, "./dist/*": "./dist/*" } },
    { entry: "./dist/rules.js", contributions: { knowledge: [{ id: "guide", file: "knowledge/GUIDE.md" }], exemplarMaps: "maps/exemplars.json", skills: ["skills/look"] } },
    ["1-1"],
  );
  const pack = {
    size: 30 * 1024 * 1024,
    files: ["package.json", MANIFEST, "dist/main.js", "dist/index.d.ts", "dist/index.js", "dist/rules.js", "knowledge/GUIDE.md", "maps/exemplars.json", "skills/look/SKILL.md", "tests/a.test.ts", "maps/1-1/frames/a.png", "maps/1-1/evidence/e.jpg", "maps/1-1/minimap.png", "data/thumbnails/b.png", "dist/capture/c.js"].map((file) => ({ path: file })),
  };
  const expected = [
    "its tarball is 30.0 MB, over the 20.0 MB limit",
    "dist/cli/tool.js (bin tool) is missing from its tarball",
    "maps/1-1/study.json (Exemplar Map 1-1's Map Study) is missing from its tarball",
    "tests/ doesn't ship, but its tarball has 1 file there (tests/a.test.ts)",
    "frames/ doesn't ship, but its tarball has 1 file there (maps/1-1/frames/a.png)",
    "evidence/ doesn't ship, but its tarball has 1 file there (maps/1-1/evidence/e.jpg)",
    "minimap.png doesn't ship, but its tarball has 1 file there (maps/1-1/minimap.png)",
    "data/thumbnails/ doesn't ship, but its tarball has 1 file there (data/thumbnails/b.png)",
  ];
  const found = packProblems(pack, required);
  if (JSON.stringify(found) !== JSON.stringify(expected)) throw new Error(`check-packs can't tell a good tarball from a bad one: found ${JSON.stringify(found)}`);
  const readme = ["| File | What | From | Why it ships |", "|---|---|---|---|", "| `a.json` | a | b | the compile reads it |", "| `sets/b.json` | a | b | |", "| `gone.json` | a | b | c |"].join("\n");
  const data = coreDataFiles(readme, ["data/a.json", "data/sets/b.json", "data/c.json"]);
  const expectedData = {
    required: [{ path: "data/a.json", why: "read at run time: the compile reads it" }],
    problems: [
      "data/sets/b.json has no row in data/README.md saying why it ships",
      "data/c.json has no row in data/README.md saying why it ships",
      "data/README.md has a row for data/gone.json, which isn't there",
    ],
  };
  if (JSON.stringify(data) !== JSON.stringify(expectedData)) throw new Error(`check-packs can't tell a recorded data file from an unrecorded one: found ${JSON.stringify(data)}`);
}

selfCheck();
const failures = [];
for (const name of PUBLIC_PACKAGES) {
  const folder = path.join(ROOT, "packages", name);
  const packageJson = await readJson(path.join(folder, "package.json"));
  if (!packageJson) {
    failures.push(`packages/${name}: no package.json`);
    continue;
  }
  if (!packageJson.files) failures.push(`packages/${name}: its package.json has no files list`);
  const manifest = await readJson(path.join(folder, MANIFEST));
  const exemplarList = manifest?.contributions?.exemplarMaps ? await readJson(path.join(folder, manifest.contributions.exemplarMaps)) : undefined;
  const pack = dryRun(folder);
  const runtime = await runtimeFiles(name, folder);
  const required = [...requiredFiles(packageJson, manifest, (exemplarList?.exemplars ?? []).map((exemplar) => exemplar.id)), ...runtime.required];
  const problems = [...runtime.problems, ...packProblems(pack, required)];
  for (const problem of problems) failures.push(`packages/${name}: ${problem}`);
  if (problems.length === 0) console.log(`packages/${name}: ${pack.files.length} files, ${megabytes(pack.size)}`);
}
if (failures.length > 0) {
  console.error(`A public package wouldn't pack as it should (built first? npm run check-packs builds):\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exitCode = 1;
}
