// Captures a Doodad Composite recipe (DL-07) from the Editor: build the shape from stock doodads,
// draw a region round it, save, then name the region here. The recipe joins the blueprint's
// `composites` (replacing one with the same id); set pieces stamp it with `{ "composite": id }`.
// The doodads stay in the map: delete them in the Editor, or let the next sync keep them as anchors.
//
//   npm run capture-composite -- missions/<id>/blueprint.json <map>.SC2Map "<region name>" \
//     [--id <id>] [--kind landmark|detail] [--style natural|built] [--scale <min>,<max>]

import { captureMissionComposite } from "../dressing/mission-dressing-edits.js";
import { formatIssue, workspaceFor } from "../plugins/workspace.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [blueprintPath, mapPath, regionName] = args;
  const kind = option(args, "kind") ?? "landmark";
  const style = option(args, "style") ?? "natural";
  if (!blueprintPath || !mapPath || !regionName || (kind !== "landmark" && kind !== "detail") || (style !== "natural" && style !== "built")) {
    console.error('Usage: capture-composite <blueprint.json> <map.SC2Map> "<region name>" [--id <id>] [--kind landmark|detail] [--style natural|built] [--scale <min>,<max>]');
    process.exitCode = 2;
    return;
  }
  const [low, high] = (option(args, "scale") ?? "1,1").split(",").map(Number);
  const id = option(args, "id");
  const { composite, edit } = await captureMissionComposite(await workspaceFor(blueprintPath), blueprintPath, mapPath, regionName, {
    ...(id ? { id } : {}),
    kind,
    style,
    scale: [low!, high ?? low!],
  });
  if (!edit.saved) throw new Error(`The blueprint with composite ${composite.id} doesn't validate, so ${blueprintPath} is unchanged: ${edit.issues.map(formatIssue).join("; ")}`);
  console.log(`Captured ${composite.members.length} doodads as ${kind} composite ${composite.id} in ${blueprintPath}: ${[...new Set(composite.members.map((m) => m.type))].join(", ")}`);
  if (composite.actors.length > 0) console.log(`With the map's own doodads made from models: ${composite.actors.map((a) => `${a.id} (${a.model})`).join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
