// Writes a Mission's SVG preview, by default beside its Blueprint (preview.svg, the Mission's map
// of record): what the `preview` CLI and the MCP server's `preview` tool both run.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { previewRamps } from "../terrain/rasterize.js";
import { renderPreviewSvg } from "./render-svg.js";

export async function writePreview(
  blueprint: MissionBlueprint,
  blueprintPath: string,
  outPath = path.join(path.dirname(blueprintPath), "preview.svg"),
): Promise<{ readonly svg: string; readonly svgPath: string; readonly unplaced: readonly string[] }> {
  const svg = renderPreviewSvg(blueprint);
  await writeFile(outPath, svg);
  return { svg, svgPath: outPath, unplaced: previewRamps(blueprint).unplaced };
}
