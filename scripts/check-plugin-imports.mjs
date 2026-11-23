// Run by `npm run lint` and `npm test`: the Plugins' TypeScript reaches core only through `@team-antioch/sc2-adjutant/plugin-sdk`.
// A Plugin runs from its own folder, built to its dist/ (or as TypeScript with type stripping, for a
// local Plugin), and the SDK resolves to core's built `dist/` there (to its declarations for tsc, and
// to core's source under vitest). An import of core by path, even of types only, bypasses the SDK,
// and a value import would load core's TypeScript source at run time, which Node can't do from there. A Plugin's tests may reach core's
// internals (@team-antioch/sc2-adjutant/src under vitest), so tests and test config are not checked.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const CORE = path.join(ROOT, "packages/core");
const STATEMENTS = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gms;

/**
 * The import and re-export statements of `file`, a source file of the Plugin in `pluginFolder`,
 * that reach into core other than through `@team-antioch/sc2-adjutant/plugin-sdk`: any other
 * `@team-antioch/sc2-adjutant/…` specifier, any `sc2-adjutant/…` (core's name before it was
 * scoped), or a relative path that leaves the Plugin's folder for this repo's core. Other packages'
 * specifiers are left alone, whatever their names hold.
 */
export function coreImportsOutsideSdk(source, file, pluginFolder) {
  const problems = [];
  for (const match of source.matchAll(STATEMENTS)) {
    const specifier = match[1];
    const target = path.resolve(path.dirname(file), specifier);
    const intoCore = specifier.startsWith(".") && insideFolder(target, CORE) && !insideFolder(target, pluginFolder);
    if (intoCore || (specifier.startsWith("@team-antioch/sc2-adjutant/") && specifier !== "@team-antioch/sc2-adjutant/plugin-sdk") || specifier.startsWith("sc2-adjutant/")) problems.push(match[0].trim());
  }
  return problems;
}

function insideFolder(target, folder) {
  const relative = path.relative(folder, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The Plugin folders the repo ships: each Plugin package, and the example Workspace's Plugins. */
async function pluginFolders() {
  const packages = (await readdir(path.join(ROOT, "packages"))).filter((name) => name.startsWith("plugin-")).map((name) => `packages/${name}`);
  return [...packages, "packages/core/examples/example-campaign/plugins"];
}

const skipped = (file) => file.split(path.sep).some((part) => part === "tests" || part === "node_modules") || /^vitest\.config\.[cm]?ts$/.test(path.basename(file));

function selfCheck() {
  const plugin = path.join(ROOT, "packages/plugin-example");
  const found = coreImportsOutsideSdk(
    [
      'import type { A } from "../core/src/a.js";',
      'import { b } from "../core/src/b.js";',
      'export { c } from "../../packages/core/dist/c.js";',
      'import { d } from "@team-antioch/sc2-adjutant/dist/d.js";',
      'import type { o } from "sc2-adjutant/plugin-sdk";',
      'import { e } from "./src/e.js";',
      'import { f } from "@scope/core/f";',
      'import { g } from "other-lib/src/core/g.js";',
      'import { slugId } from "@team-antioch/sc2-adjutant/plugin-sdk";',
      'import type { PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";',
      'import { z } from "zod";',
    ].join("\n"),
    path.join(plugin, "index.ts"),
    plugin,
  );
  const expected = ['import type { A } from "../core/src/a.js"', 'import { b } from "../core/src/b.js"', 'export { c } from "../../packages/core/dist/c.js"', 'import { d } from "@team-antioch/sc2-adjutant/dist/d.js"', 'import type { o } from "sc2-adjutant/plugin-sdk"'];
  // A Plugin inside core's folder (the example Workspace's) may import its own files, not core's.
  const example = path.join(CORE, "examples/example-campaign/plugins");
  const fromExample = coreImportsOutsideSdk(['import { h } from "./h.js";', 'import { i } from "../../../../src/i.js";'].join("\n"), path.join(example, "campaign-example/index.ts"), example);
  if (JSON.stringify(found) !== JSON.stringify(expected) || JSON.stringify(fromExample) !== JSON.stringify(['import { i } from "../../../../src/i.js"'])) {
    throw new Error(`check-plugin-imports can't tell core imports apart: found ${JSON.stringify([...found, ...fromExample])}`);
  }
}

selfCheck();
const problems = [];
let checked = 0;
for (const folder of await pluginFolders()) {
  const files = (await readdir(path.join(ROOT, folder), { recursive: true })).filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts") && !skipped(file));
  for (const file of files) {
    for (const statement of coreImportsOutsideSdk(await readFile(path.join(ROOT, folder, file), "utf8"), path.join(ROOT, folder, file), path.join(ROOT, folder))) problems.push(`${folder}/${file}: ${statement}`);
    checked++;
  }
}
if (checked === 0) problems.push("no Plugin TypeScript found to check");
if (problems.length > 0) {
  console.error(`Plugins must import core only through @team-antioch/sc2-adjutant/plugin-sdk:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exitCode = 1;
}
