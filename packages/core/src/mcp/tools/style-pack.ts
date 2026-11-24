// The Style Pack tools (#23): the active Style Pack's Map Studies and places, built from its
// Exemplar Maps' source maps, so a mapper with a package install can study maps of their own.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { findStylePackPlaces, studyExemplars } from "../../study/study-exemplars.js";
import { type CallContext } from "../call-context.js";
import { DESTRUCTIVE, toolGroup } from "./tool-group.js";

const IdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .optional()
  .describe("The Exemplar Maps to work on, by their ids in the pack's exemplars.json; every one the pack lists when not given");

const SOURCES =
  "Source maps are read from the folder the machine config's exemplarMaps names, else the Workspace config's exemplarMaps (relative to the Workspace, for a folder that travels with it).";

/** The tools registerStylePackTools can register, the Style Pack group. */
export const STYLE_PACK_TOOLS = ["study_exemplar", "find_places"] as const;

export function registerStylePackTools(server: McpServer, ctx: CallContext): void {
  const tool = toolGroup(server, STYLE_PACK_TOOLS);

  tool(
    "study_exemplar",
    {
      title: "Study Exemplar Maps",
      annotations: DESTRUCTIVE,
      description: `Builds the Map Study of one or more of the active Style Pack's Exemplar Maps: study.json (measurements of its texturing, cliffs, doodads, lighting and composition) and its layer images, written into the pack's exemplar-maps/<id>/ over any study already there. ${SOURCES} Refused, before anything is written, for an id the pack doesn't list or a source map that isn't there.`,
      inputSchema: { ids: IdsSchema },
      outputSchema: { studied: z.array(z.object({ id: z.string(), studyDir: z.string(), images: z.array(z.string()) })) },
    },
    async ({ ids }) => {
      const workspace = await ctx.workspace();
      const studied = await studyExemplars(workspace, { ...(ids ? { ids } : {}), machine: ctx.host.machine });
      const lines = studied.map(({ id, studyDir, images, seconds }) => `${id}: study.json and ${images.join(", ")} in ${studyDir} (${seconds.toFixed(1)}s)`);
      return ctx.reply(lines.join("\n"), { studied: studied.map(({ id, studyDir, images }) => ({ id, studyDir, images: [...images] })) });
    },
  );

  tool(
    "find_places",
    {
      title: "Find an Exemplar Map's places",
      annotations: DESTRUCTIVE,
      description: `Finds the dressed places of the active Style Pack's Exemplar Maps (clusters of doodads within 2.5 cells, wide ones split into 16-cell tiles, places under 8 visible doodads dropped) and writes them, with what each is made of, to the pack's mixtures file (exemplar-maps/mixtures.json), replacing the places it held. Each place lists the frames near it when its map has tours (exemplar-maps/<id>/captures/ or frames/, or under $SC2_RESEARCH_DIR/docs/research/exemplar-maps/ when that is set). A place takes the first of the pack's moods it passes, as the mixtures file's moodRules record them (kept as they are), or no mood when the pack has none yet. ${SOURCES} Refused, before anything is written, for an id the pack doesn't list or a source map that isn't there.`,
      inputSchema: { ids: IdsSchema.describe("The Exemplar Maps whose places the mixtures file is to hold, by their ids in the pack's exemplars.json; every one the pack lists when not given. The file is rewritten for these maps alone") },
      outputSchema: { file: z.string(), maps: z.array(z.string()), places: z.number().int(), moods: z.record(z.string(), z.number().int()), withoutFrames: z.array(z.string()) },
    },
    async ({ ids }) => {
      const workspace = await ctx.workspace();
      const found = await findStylePackPlaces(workspace, { ...(ids ? { ids } : {}), machine: ctx.host.machine });
      const moods = Object.entries(found.moods);
      const lines = [
        `Wrote ${found.places} place(s) from ${found.maps.join(", ")} to ${found.file}.`,
        moods.length ? `By mood: ${moods.map(([mood, count]) => `${mood} ${count}`).join(", ")}.` : "The pack records no moods yet (moodRules in the mixtures file), so no place has one.",
        ...(found.withoutFrames.length ? [`No tours for ${found.withoutFrames.join(", ")}, so their places list no frames.`] : []),
      ];
      return ctx.reply(lines.join("\n"), { ...found, maps: [...found.maps], moods: { ...found.moods }, withoutFrames: [...found.withoutFrames] });
    },
  );
}
