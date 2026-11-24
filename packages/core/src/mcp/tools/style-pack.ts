// The Style Pack tools (#23): the active Style Pack's Map Studies and places, built from its
// Exemplar Maps' source maps, so a mapper with a package install can study maps of their own.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { brokerSocketPath, editorBrokerStatus } from "../../capture/editor-broker-client.js";
import { captureStylePack, type CaptureStylePackResult, planStylePackTours } from "../../capture/style-pack-captures.js";
import { hostContext } from "../../host/machine-config.js";
import { findStylePackPlaces, studyExemplars } from "../../study/study-exemplars.js";
import { type CallContext } from "../call-context.js";
import { captureJobs, type JobState, placeOf, waitLength } from "../capture-jobs.js";
import { DESTRUCTIVE, toolGroup } from "./tool-group.js";

const IdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .optional()
  .describe("The Exemplar Maps to work on, by their ids in the pack's exemplars.json; every one the pack lists when not given");

const SOURCES =
  "Source maps are read from the folder the machine config's exemplarMaps names, else the Workspace config's exemplarMaps (relative to the Workspace, for a folder that travels with it).";

/** The tools registerStylePackTools can register, the Style Pack group. */
export const STYLE_PACK_TOOLS = ["study_exemplar", "find_places", "capture_exemplar"] as const;

export function registerStylePackTools(server: McpServer, ctx: CallContext, { captureWaitMs }: { readonly captureWaitMs: number }): void {
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

  // Listed whatever the Host Adapter, as capture_shots is, so a machine that can't capture hears why.
  const tourJobs = captureJobs<CaptureStylePackResult>();
  const waited = waitLength(captureWaitMs);
  /** The job still going, if any: a new one waits for it. */
  let running: string | undefined;
  tool(
    "capture_exemplar",
    {
      title: "Capture Exemplar Map tours in game",
      annotations: DESTRUCTIVE,
      description: `Captures in-game camera tours of the active Style Pack's Exemplar Maps: place tours by default, one frame centred on each place in the pack's mixtures file (run find_places first), in the light the map's triggers set most outside cutscenes (or its exemplars.json placeLight, or placeZones by zone); or grid tours with tours: "grid", over the playable area once per lighting the map's study lists (run study_exemplar first), or its captureLights. Use grid tours for a map with little dressing. Frames go to the pack's exemplar-maps/<id>/captures/<tour>/ (git-ignored by the .gitignore it adds there), or under $SC2_RESEARCH_DIR/docs/research/exemplar-maps/ when that is set, with their 1000px copies in <id>/frames/<tour>/: every frame of every tour, place or grid. A tour that already has frames is skipped, so a rerun resumes; delete its captures folder to take it again. Each tour starts the game, which takes minutes. Every capture on the machine goes through one Editor Broker, one at a time; it waits up to ${waited}, and a job not done by then comes back as state waiting with a job id: call capture_exemplar({ job }) to wait again and collect it, or capture_exemplar({ job, cancel: true }) to cancel it; a new capture is refused while one is still going. ${SOURCES} Needs the macOS Host Adapter (editor.captureTour) and an awake screen; the Editor comes to the front while it runs, so check the author isn't mid-task in it.`,
      inputSchema: {
        ids: IdsSchema,
        tours: z.enum(["places", "grid"]).optional().describe("places (the default): a frame on each of the pack's places; grid: the playable area, once per lighting"),
        startOnInit: z.boolean().optional().describe("Start each tour at map init, for a map whose timed triggers never fire"),
        showErrors: z.boolean().optional().describe("Keep data errors on screen, to debug a tour that doesn't start"),
        job: z.string().min(1).optional().describe("A job id an earlier call returned: waits again, then collects its tours or says where it stands. Give it alone, or with cancel"),
        cancel: z.boolean().optional().describe("With job: cancels it, whether it waits in the queue or runs"),
      },
      outputSchema: {
        state: z.enum(["done", "waiting", "cancelled"]),
        job: z.string(),
        place: z.string().optional(),
        captureDir: z.string().optional(),
        tours: z.array(z.object({ id: z.string(), label: z.string(), outcome: z.string(), frames: z.number().int(), reason: z.string().optional() })).optional(),
        withoutPlaces: z.array(z.string()).optional(),
        frames: z.object({ made: z.number().int(), removed: z.number().int(), kept: z.number().int(), unreadable: z.array(z.string()) }).optional(),
      },
    },
    async ({ ids, tours, startOnInit, showErrors, job, cancel }, extra: { readonly signal?: AbortSignal }) => {
      if (!ctx.host.has("editor.captureTour")) {
        const adapter = ctx.host.adapter ? ctx.host.adapter.name : "none";
        return ctx.fail(
          `capture_exemplar needs a Host Adapter that can run editor.captureTour, and this machine's (${adapter}) can't: set hostAdapter in the machine config ${ctx.host.machine.file} to the macOS Host Adapter (bundled:host-macos), on a Mac with the StarCraft II Editor. No tours were captured; the studies and places work without them.`,
        );
      }
      if (job !== undefined) {
        if (ids !== undefined || tours !== undefined || startOnInit !== undefined || showErrors !== undefined) return ctx.fail("Give job alone, to collect it, or with cancel; a new capture takes ids, tours, startOnInit and showErrors.");
        if (cancel) {
          if (!tourJobs.cancel(job)) return toursReply(job, undefined);
          const state = await tourJobs.wait(job, captureWaitMs);
          if (state?.state === "failed") return ctx.reply(`Cancelled capture job ${job}: ${state.message}`, { state: "cancelled" as const, job });
          return toursReply(job, state);
        }
        return toursReply(job, await tourJobs.wait(job, captureWaitMs, extra.signal));
      }
      if (cancel) return ctx.fail("cancel goes with job: the id of the capture to cancel.");
      const workspace = await ctx.workspace();
      const options = { ...(ids ? { ids } : {}), tours: tours ?? "places", machine: ctx.host.machine, ...(startOnInit ? { startOnInit } : {}), ...(showErrors ? { showErrors } : {}) } as const;
      // Planned here first, so what can't be planned is refused at once rather than as a failed job.
      await planStylePackTours(workspace, options);
      // Tours go to fixed folders, so a second job would take the first one's tours again. Checked
      // with no await before the start, so two calls can't both pass.
      if (running !== undefined) {
        return ctx.fail(`Capture job ${running} is still going: call capture_exemplar({ job: "${running}" }) to wait for it and collect its tours, or cancel it, before starting another.`);
      }
      const id = tourJobs.start(({ onQueued, log, signal }) =>
        captureStylePack(workspace, ctx.host, { ...options, onQueued, log, signal }).finally(() => {
          if (running === id) running = undefined;
        }),
      );
      running = id;
      return toursReply(id, await tourJobs.wait(id, captureWaitMs, extra.signal));
    },
  );

  /** capture_exemplar's reply for a job where it stands. */
  async function toursReply(job: string, state: JobState<CaptureStylePackResult> | undefined) {
    if (!state) return ctx.fail(`No capture job ${job} on this server: it never started here, or finished over an hour ago (its frames stay in its folder), or the server restarted, which drops a job still waiting.`);
    if (state.state === "failed") return ctx.fail(`Capture job ${job} failed: ${state.message}`);
    if (state.state === "waiting") {
      const place = placeOf(await editorBrokerStatus(brokerSocketPath(hostContext(ctx.host.machine).requirePath("cacheDir"))), state.brokerId);
      const lines = [
        `Capture job ${job} is still going (${place}) after waiting ${waited}. Call capture_exemplar({ job: "${job}" }) to wait again and collect the tours.`,
        ...(state.lastLine ? [`Last: ${state.lastLine}`] : []),
      ];
      return ctx.reply(lines.join("\n"), { state: "waiting" as const, job, place });
    }
    const { captureDir, outcomes, withoutPlaces, frames } = state.result;
    const lines = [
      `Tours in ${captureDir}:`,
      ...outcomes.map((tour) => `${tour.id}/${tour.label}: ${tour.outcome}${tour.outcome === "failed" ? `: ${tour.reason}` : tour.outcome === "already captured" ? "" : `, ${tour.frames} frames`}`),
      ...(outcomes.length === 0 ? ["None to take."] : []),
      ...(withoutPlaces.length ? [`No places for ${withoutPlaces.join(", ")} in the mixtures file, so no place tour: run find_places, or capture grid tours.`] : []),
      `1000px frames in <id>/frames/: ${frames.made} made, ${frames.removed} removed, ${frames.kept} in all.`,
      ...(frames.unreadable.length ? [`Couldn't read ${frames.unreadable.length} capture(s), so they have no frame: ${frames.unreadable.join(", ")}`] : []),
      "Run find_places so each place lists the frames near it.",
    ];
    return ctx.reply(lines.join("\n"), {
      state: "done" as const,
      job,
      captureDir,
      tours: outcomes.map((tour) => ({ ...tour })),
      withoutPlaces: [...withoutPlaces],
      frames: { ...frames, unreadable: [...frames.unreadable] },
    });
  }
}
