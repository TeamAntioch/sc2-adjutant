// The Still Review tools (#124), in the capture group: a set's Shots from Zones, a round's page
// from capture_shots folders, and the author's feedback from the page's db.

import path from "node:path";
import { z } from "zod";

import { buildStillReview, NO_CHANGE, recordStillFeedback, STILL_TAGS } from "../../capture/still-review.js";
import { shotsForZones, STILL_SHOT_SIZE } from "../../capture/zone-shots.js";
import { hostContext } from "../../host/machine-config.js";
import { missionBlueprintPath } from "../../plugins/workspace.js";
import { isInside } from "../../util/inside.js";
import type { CallContext } from "../call-context.js";
import { MissionSchema } from "./schemas.js";
import { ADDITIVE, DESTRUCTIVE, type GroupRegistrar } from "./tool-group.js";

const SetSchema = z.string().min(1).describe("The set's name: letters, digits, dots, dashes and underscores. A set is one comparison, its Shots fixed, reviewed over rounds");
const FolderSchema = z.string().min(1);

export function registerStillTools(tool: GroupRegistrar<"shots_for_zones" | "build_still_review" | "record_still_feedback">, ctx: CallContext): void {
  /** A folder the tools read or write: absolute, or relative to the Workspace's root; inside the Workspace or the machine's cacheDir. */
  const folderIn = async (folder: string, what: string): Promise<string> => {
    const root = await ctx.root();
    const resolved = path.resolve(root, folder);
    const { cacheDir } = hostContext(ctx.host.machine).machine;
    if ((await isInside(root, resolved, { orSame: true })) || (cacheDir && (await isInside(cacheDir, resolved, { orSame: true })))) return resolved;
    throw new Error(`${what} ${folder} must be inside the Workspace ${root}${cacheDir ? ` or the machine's cacheDir ${cacheDir}` : ""}`);
  };

  tool(
    "shots_for_zones",
    {
      title: "Pick Still Review Shots from Zones",
      annotations: ADDITIVE,
      description: `Picks a Still Review set's Shots: one per Zone of a Mission's Blueprint, labelled by the Zone's id, each a rect of ${STILL_SHOT_SIZE.join("×")} cells by default (size sets it) centred on the Zone's pole of inaccessibility (the point inside it farthest from its edge, so a concave Zone's Shot stays on its ground), moved in to the Playable Area and cut to it where it is bigger. Writes them to missions/<id>/output/stills/<set>/shots.json and never overwrites one, since every round of a set must frame the same places: pass them to capture_shots once per version of the map. Needs the Mission's compiled Map Package, for its Playable Area.`,
      inputSchema: {
        mission: MissionSchema,
        zones: z.array(z.string().min(1)).min(1).describe("The Zones' ids, in the order the Shots go"),
        set: SetSchema,
        size: z.tuple([z.number().positive(), z.number().positive()]).optional().describe(`[width, height] in cells; ${STILL_SHOT_SIZE.join(", ")} by default`),
        pitch: z.number().optional().describe("Degrees down from level for every Shot; capture_shots's 75 by default"),
      },
      outputSchema: { file: z.string(), shots: z.array(z.object({ rect: z.array(z.number()), pitch: z.number().optional(), label: z.string().optional() })) },
    },
    async ({ mission, zones, set, size, pitch }) => {
      const blueprintPath = await missionBlueprintPath(await ctx.workspace(), mission);
      const { file, shots } = await shotsForZones(blueprintPath, zones, { set, ...(size ? { size } : {}), ...(pitch !== undefined ? { pitch } : {}) });
      const plain = shots.map((shot) => ({ rect: [...shot.rect], ...(shot.pitch !== undefined ? { pitch: shot.pitch } : {}), ...(shot.label !== undefined ? { label: shot.label } : {}) }));
      return ctx.reply(`Wrote ${shots.length} Shot(s) for set ${set} to ${file}: ${shots.map((shot) => `${shot.label} [${shot.rect.join(", ")}]`).join("; ")}`, { file, shots: plain });
    },
  );

  tool(
    "build_still_review",
    {
      title: "Build a Still Review round",
      annotations: DESTRUCTIVE,
      description: `Builds one round of a Still Review: the same Shots captured on several versions of a map (capture_shots folders), checked and laid out side by side for the author to judge. Each version is { label, note, captures }: its first capture folder holds every Shot, and later ones (retakes) fill the Shots the earlier lack, matched by place, since a retake numbers its own Shots from 1. Every frame is checked against a reference capture (the first version's first by default): ok; missing (no frame); late (capture_shots dropped it); wrong (it matches another Shot's place clearly better than its own); unconfirmed (nothing matches it well, as after a big repaint of the ground). Missing, late and wrong frames are left off the page with the gap labelled, and the reply and review.json's retakes name exactly the Shots to retake per version, with that version's map: capture them, then build the round again with the retake folder after the version's first. Writes missions/<id>/output/stills/<set>/<round>/ for a Mission (or <folder>/<set>/<round>/): review.json, frames/ (the frames shown, at most 1600 px wide) and index.html, the page. Rebuilding a round replaces it, until its feedback is recorded. Publish index.html as an artifact with the capabilities { db: {}, user: {} }, with every file of frames/ beside it at frames/<file>. The page keeps the author's picks in the artifact's db: shots/<n> { best, tags, note } (best is a version's label or "${NO_CHANGE}"; tags from ${STILL_TAGS.join(", ")}), review/overall { note } and review/status { done }. Give previous, the last round's folder, once its feedback is recorded, and the page shows that feedback beside each Shot.`,
      inputSchema: {
        mission: MissionSchema.optional(),
        folder: FolderSchema.optional().describe("For a map that isn't a Mission's: the folder its sets go in, inside the Workspace or the machine's cacheDir"),
        set: SetSchema,
        round: z.string().min(1).describe("The round's name, such as r1: letters, digits, dots, dashes and underscores"),
        versions: z
          .array(
            z.object({
              label: z.string().min(1).describe("Short and unique, such as before or washes"),
              note: z.string().optional().describe("What changed in this version"),
              captures: z.array(FolderSchema).min(1).describe("capture_shots folders, absolute or relative to the Workspace: a full capture first, then any retakes"),
            }),
          )
          .min(1)
          .describe("In order: the first is usually the map before the change"),
        reference: FolderSchema.optional().describe("The capture the frames are checked against; by default the first version's first"),
        previous: FolderSchema.optional().describe("The previous round's folder, whose recorded feedback the page shows"),
        lighting: z.string().optional().describe("The lighting the frames were captured in, for the page's header"),
      },
      outputSchema: {
        roundDir: z.string(),
        page: z.string(),
        problems: z.array(z.object({ shot: z.number(), label: z.string().optional(), version: z.string(), status: z.string(), shows: z.number().optional() })),
        unconfirmed: z.array(z.object({ shot: z.number(), label: z.string().optional(), version: z.string() })),
        retakes: z.array(z.object({ version: z.string(), map: z.string(), shots: z.array(z.object({ rect: z.array(z.number()), pitch: z.number(), yaw: z.number(), label: z.string().optional() })) })),
      },
    },
    async ({ mission, folder, set, round, versions, reference, previous, lighting }) => {
      if ((mission === undefined) === (folder === undefined)) return ctx.fail("build_still_review takes a mission or a folder (one of them).");
      const target = mission !== undefined ? { blueprintPath: await missionBlueprintPath(await ctx.workspace(), mission) } : { folder: await folderIn(folder!, "The folder") };
      const resolved = [];
      for (const version of versions) {
        const captures = [];
        for (const capture of version.captures) captures.push(await folderIn(capture, "The capture folder"));
        resolved.push({ label: version.label, ...(version.note ? { note: version.note } : {}), captures });
      }
      const { roundDir, review, summary } = await buildStillReview({
        target,
        set,
        round,
        versions: resolved,
        ...(reference ? { reference: await folderIn(reference, "The reference capture") } : {}),
        ...(previous ? { previous: await folderIn(previous, "The previous round") } : {}),
        ...(lighting ? { lighting } : {}),
      });
      const plain = JSON.parse(JSON.stringify({ problems: review.problems, unconfirmed: review.unconfirmed, retakes: review.retakes }));
      return ctx.reply(summary, { roundDir, page: path.join(roundDir, "index.html"), ...plain });
    },
  );

  tool(
    "record_still_feedback",
    {
      title: "Record a Still Review round's feedback",
      annotations: DESTRUCTIVE,
      description:
        "Records the author's feedback on a Still Review round, from the rows you read from its page's artifact db (shots/<n>, review/overall, review/status), as feedback.json and feedback.md in the round's folder, replacing any from before. Pass every row as { path, data }: a Shot with no row has no feedback. The next round's build_still_review reads feedback.json when given this round as previous.",
      inputSchema: {
        round: FolderSchema.describe("The round's folder, as build_still_review gave it"),
        rows: z.array(z.object({ path: z.string().min(1).describe("The document's path, such as shots/3 or review/overall"), data: z.record(z.string(), z.unknown()) })).describe("Every document read from the page's db"),
      },
      outputSchema: { files: z.array(z.string()), done: z.boolean(), shots: z.number() },
    },
    async ({ round, rows }) => {
      const roundDir = await folderIn(round, "The round folder");
      const feedback = await recordStillFeedback(roundDir, rows);
      const lines = [`Recorded feedback on ${feedback.shots.length} Shot(s) of round ${feedback.round} in ${feedback.files.join(" and ")}; the author ${feedback.done ? "marked it done" : "hasn't marked it done"}.`];
      if (feedback.overall) lines.push(`Overall: ${feedback.overall}`);
      return ctx.reply(lines.join("\n"), { files: [...feedback.files], done: feedback.done, shots: feedback.shots.length });
    },
  );
}
