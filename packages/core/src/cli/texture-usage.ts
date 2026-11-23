// What each texture slot of a Mission's Map Package paints, by Zone, and what a proposed texture
// set would reuse, need and free, and each stretch of boundary between texture sets that needs cover
// (src/map/texture-usage.ts, ADR-0016). Reads the package; --render writes the stretches' render,
// one file to each cluster of stretches (numbered when there are several).
//
//   npm run texture-usage -- <blueprint.json> [--set <textureSets id>] [--textures a,b,...] [--zones x,y,...] [--render <file.png>]
//
// Paths are relative to where the command was typed; the Workspace is the one above the Blueprint.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { areaLine, legendLine, missionTextureUsage } from "../map/texture-usage.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";
import { writePng } from "../preview/write-png.js";

const USAGE = "Usage: texture-usage <blueprint.json> [--set <textureSets id>] [--textures a,b,...] [--zones x,y,...] [--render <file.png>]";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valued = new Set(["--set", "--textures", "--zones", "--render"]);
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (valued.has(arg) && args[i + 1] !== undefined) options.set(arg, args[++i]!);
    else if (arg.startsWith("--")) {
      console.error(USAGE);
      process.exitCode = 2;
      return;
    } else positional.push(arg);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (positional.length !== 1) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(cwd, positional[0]!);
  const root = workspaceRootFor(blueprintPath);
  if (!root) {
    console.error(`${blueprintPath} isn't in a Workspace`);
    process.exitCode = 2;
    return;
  }
  const list = (name: string) => options.get(name)?.split(",").filter(Boolean);
  const proposing = options.has("--set") || options.has("--textures") || options.has("--zones");
  const renderTo = options.get("--render");
  const result = await missionTextureUsage(await loadWorkspace(root), blueprintPath, {
    ...(proposing ? { proposal: { set: options.get("--set"), textures: list("--textures"), zones: list("--zones") } } : {}),
    render: renderTo !== undefined,
  });
  console.log(result.text);
  if (renderTo === undefined) return;
  if (!result.render) {
    console.log("No boundary stretch to render.");
    return;
  }
  // One file a view: the name given for one, numbered (name-1.png, name-2.png, ...) for several.
  const { views } = result.render;
  const base = path.resolve(cwd, renderTo);
  const ext = path.extname(base);
  console.log(`Render (${legendLine(result.render)}):`);
  for (const [i, view] of views.entries()) {
    const file = views.length === 1 ? base : `${base.slice(0, base.length - ext.length)}-${i + 1}${ext}`;
    await writeFile(file, writePng(view.image));
    console.log(`  ${file}: ${areaLine(view.area)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
