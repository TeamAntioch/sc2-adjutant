// Adds or edits a Paint Region in a Mission's Blueprint (src/edit/paint-region-edit.ts, ADR-0028), as
// the MCP server's paint_region does: its outline from a Zone, a rectangle of cells or a box on a
// Still Review frame, its mix checked before anything is saved.
//
//   npm run paint-region -- <blueprint.json> <id> [--zone <id> | --rect l,b,r,t | --capture <name> --shot <n|label> --box l,t,r,b]
//                           [--mix <JSON array>] [--falloff <cells>|default] [--levels 1,2|all]
//
// --mix is the mix as JSON: '[{"texture":"MarSaraRocky","weight":0.15},{"texture":"MarSaraDirt"}]'.
// Paths are relative to where the command was typed; the Workspace is the one above the Blueprint.

import path from "node:path";

import { missionPaintRegion, type PaintRegionRequest } from "../edit/paint-region-edit.js";
import { formatIssue, loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";

const USAGE =
  "Usage: paint-region <blueprint.json> <id> [--zone <id> | --rect l,b,r,t | --capture <name> --shot <n|label> --box l,t,r,b] [--mix <JSON array>] [--falloff <cells>|default] [--levels 1,2|all]";
const VALUED = new Set(["--zone", "--rect", "--capture", "--shot", "--box", "--mix", "--falloff", "--levels"]);

const numbers = (text: string, count?: number): number[] => {
  const values = text.split(",").map(Number);
  const wanted = count === 1 ? "a number" : `${count ?? "a list of"} numbers, comma-separated`;
  if (values.some((value) => !Number.isFinite(value)) || (count !== undefined && values.length !== count)) throw new Error(`${text} isn't ${wanted}`);
  return values;
};
/** A rectangle or a box: four numbers. */
const corners = (text: string) => numbers(text, 4) as [number, number, number, number];

/** The request the arguments make, or a usage error. */
function paintRegionArgs(args: readonly string[]): PaintRegionRequest & { readonly blueprint: string } {
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUED.has(arg) && args[i + 1] !== undefined) options.set(arg, args[++i]!);
    else if (arg.startsWith("--")) throw new Error(USAGE);
    else positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const framed = ["--capture", "--shot", "--box"].filter((name) => options.has(name));
  if (framed.length > 0 && framed.length < 3) throw new Error("A frame box needs --capture, --shot and --box");
  const shot = options.get("--shot");
  const falloff = options.get("--falloff");
  const levels = options.get("--levels");
  const mix = options.get("--mix");
  return {
    blueprint: positional[0]!,
    id: positional[1]!,
    zone: options.get("--zone"),
    rect: options.has("--rect") ? corners(options.get("--rect")!) : undefined,
    frame: framed.length ? { capture: options.get("--capture")!, shot: /^\d+$/.test(shot!) ? Number(shot) : shot!, box: corners(options.get("--box")!) } : undefined,
    mix: mix === undefined ? undefined : (JSON.parse(mix) as PaintRegionRequest["mix"]),
    falloff: falloff === undefined ? undefined : falloff === "default" ? null : numbers(falloff, 1)[0]!,
    levels: levels === undefined ? undefined : levels === "all" ? null : numbers(levels),
  };
}

async function main(): Promise<void> {
  let request: ReturnType<typeof paintRegionArgs>;
  try {
    request = paintRegionArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const blueprintPath = path.resolve(cwd, request.blueprint);
  const root = workspaceRootFor(blueprintPath);
  if (!root) {
    console.error(`${blueprintPath} isn't in a Workspace`);
    process.exitCode = 2;
    return;
  }
  const { blueprint: _blueprint, ...edit } = request;
  const result = await missionPaintRegion(await loadWorkspace(root), blueprintPath, edit);
  if (!result.saved) {
    console.error(`Nothing saved to ${blueprintPath}:`);
    for (const issue of result.issues) console.error(`- ${formatIssue(issue)}`);
    process.exitCode = 1;
    return;
  }
  console.log([`Saved ${blueprintPath}.`, ...result.notes].join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
