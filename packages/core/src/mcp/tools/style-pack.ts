// The Style Pack tools (#23): the active Style Pack's Map Studies and places, built from its
// Exemplar Maps' source maps, so a mapper with a package install can study maps of their own.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { brokerSocketPath, editorBrokerStatus } from "../../capture/editor-broker-client.js";
import { captureStylePack, type CaptureStylePackResult, planStylePackTours } from "../../capture/style-pack-captures.js";
import { hostContext } from "../../host/machine-config.js";
import { exemplarReport, type ReportMeasure, type Verdict, VERDICTS } from "../../study/exemplar-report.js";
import { EXEMPLAR_PROVENANCES } from "../../plugins/plugin-api.js";
import { addExemplarMap, DEFAULT_STYLE_PACK_FOLDER, scaffoldStylePack, STYLE_PACK_IGNORES } from "../../study/scaffold-style-pack.js";
import { findStylePackPlaces, studyExemplars } from "../../study/study-exemplars.js";
import { type CallContext } from "../call-context.js";
import { captureJobs, type JobState, placeOf, waitLength } from "../capture-jobs.js";
import { realPathOf } from "../../util/inside.js";
import { oneAtATime } from "./mission-files.js";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, type RefusedWithout, toolGroup } from "./tool-group.js";

const RequiredIdsSchema = z.array(z.string().min(1)).min(1);
const IdsSchema = RequiredIdsSchema.optional().describe("The Exemplar Maps to work on, by their ids in the pack's exemplars.json; every one the pack lists when not given");

const SOURCES =
  "Source maps are read from the folder the machine config's exemplarMaps names, else the Workspace config's exemplarMaps (relative to the Workspace, for a folder that travels with it).";

/** The tools registerStylePackTools can register, the Style Pack group. */
export const STYLE_PACK_TOOLS = ["scaffold_style_pack", "add_exemplar_map", "study_exemplar", "find_places", "capture_exemplar", "exemplar_report"] as const;

const MapValueSchema = z.object({ id: z.string(), value: z.number() });
const ReportMeasureSchema = z.object({
  id: z.string(),
  description: z.string(),
  verdict: z.enum(VERDICTS),
  side: z.enum(["above", "below", "within"]).optional(),
  spread: z.object({ min: z.number(), max: z.number(), median: z.number() }).nullable(),
  agreeing: z.array(z.string()),
  outliers: z.array(MapValueSchema),
  unmeasured: z.array(z.string()),
  evidence: z.number(),
  blizzard: z.object({ maps: z.number().int(), p10: z.number(), p25: z.number(), median: z.number(), p75: z.number(), p90: z.number() }).nullable(),
  percentile: z.number().nullable(),
});

/** One line of exemplar_report's text for a measure. */
function reportLine(measure: ReportMeasure): string {
  const { spread, blizzard } = measure;
  const range = spread ? (spread.min === spread.max ? `${spread.min}` : `${spread.min} to ${spread.max}`) : "no value";
  const against = blizzard ? `; Blizzard p10 ${blizzard.p10}, median ${blizzard.median}, p90 ${blizzard.p90} over ${blizzard.maps} maps${measure.percentile === null ? "" : `, the maps' median above ${Math.round(measure.percentile * 100)}% of them`}` : "; no Blizzard map has a value";
  const where = measure.verdict === "question" ? `from ${range}, the largest group ${measure.agreeing.join(", ")}` :measure.agreeing.length ? `${measure.agreeing.join(", ")} at ${range}${measure.side && measure.side !== "within" ? `, ${measure.side} Blizzard's spread` : ""}` : range;
  const outside = measure.outliers.length ? `; ${measure.verdict === "question" ? "outside the largest group" : "outside it"}: ${measure.outliers.map((o) => `${o.id} ${o.value}`).join(", ")}` : "";
  const unmeasured = measure.unmeasured.length ? `; nothing to measure in ${measure.unmeasured.join(", ")}` : "";
  return `- ${measure.id} (${measure.description}): ${where}${against}${outside}${unmeasured}`;
}

const VERDICT_HEADINGS: Readonly<Record<Verdict, string>> = {
  distinctive: "Distinctive: the maps agree, outside Blizzard's spread (p10 to p90)",
  "common practice": "Common practice: the maps agree, as Blizzard's maps do",
  question: "Questions for the mapper: the maps don't agree",
  "no baseline": "Agreed, with no Blizzard value to compare",
  "too few maps": "Too few maps with a value to tell",
};

/** The group's tools listed on every machine but refused where the Host Adapter lacks these capabilities. */
export const STYLE_PACK_REFUSED_WITHOUT = { capture_exemplar: ["editor.captureTour"] } as const satisfies RefusedWithout<(typeof STYLE_PACK_TOOLS)[number]>;

export function registerStylePackTools(server: McpServer, ctx: CallContext, { captureWaitMs }: { readonly captureWaitMs: number }): void {
  const tool = toolGroup(server, STYLE_PACK_TOOLS);

  tool(
    "scaffold_style_pack",
    {
      title: "Start a Style Pack in the Workspace",
      annotations: DESTRUCTIVE,
      description: `Makes a Style Pack Plugin in a folder of the Workspace (${DEFAULT_STYLE_PACK_FOLDER}/ by default), laid out as a Style Pack's npm package is, so the folder can later become one unchanged: sc2-adjutant-plugin.json at its root with the style-pack role and its knowledge entries, an empty exemplar-maps/exemplars.json, exemplar-maps/LESSONS.md and candidate-lessons.md with their headings and the lesson format, a knowledge/GUIDE.md stub, and exemplar-maps/.gitignore for ${STYLE_PACK_IGNORES.join(", ")}. Then names it as the Workspace config's stylePack. Refused, before anything is written, when the folder exists and isn't empty, or is outside the Workspace, and when the Workspace already names a Style Pack: ask the mapper whether to replace it, then call again with replace: true. Add its Exemplar Maps with add_exemplar_map.`,
      inputSchema: {
        folder: z.string().min(1).optional().describe(`The pack's folder, relative to the Workspace root; ${DEFAULT_STYLE_PACK_FOLDER} by default`),
        name: z.string().min(1).optional().describe("The Plugin's name, lowercase like an npm package name; style-<campaign id> by default"),
        replace: z.boolean().optional().describe("Replace the Style Pack the Workspace already names, once the mapper has agreed to"),
      },
      outputSchema: { name: z.string(), folder: z.string(), source: z.string(), files: z.array(z.string()), replaced: z.string().optional() },
    },
    async ({ folder, name, replace }) => {
      const made = await scaffoldStylePack(await ctx.root(), { ...(folder ? { folder } : {}), ...(name ? { name } : {}), ...(replace ? { replace } : {}) });
      const lines = [
        `Made the Style Pack ${made.name} in ${made.folder}: ${made.files.join(", ")}.`,
        `The Workspace's stylePack is now ${made.source}${made.replaced !== undefined ? `, in place of ${made.replaced}` : ""}.`,
        "Add its Exemplar Maps with add_exemplar_map.",
      ];
      return ctx.reply(lines.join("\n"), { ...made, files: [...made.files] });
    },
  );

  tool(
    "add_exemplar_map",
    {
      title: "Add an Exemplar Map to the Style Pack",
      annotations: ADDITIVE,
      description: `Records an Exemplar Map in the active Style Pack's exemplars.json: its id, its source map and its provenance (made, edited or approved: a map the mapper made weighs most as evidence, one they admire least). The pack must be a folder in the Workspace (scaffold_style_pack makes one). ${SOURCES} Refused, before anything is written, for an id the pack already lists or a source map that isn't there. Then study it with study_exemplar.`,
      inputSchema: {
        id: z.string().min(1).describe("A short id for the map, such as 1-1: letters, digits, dots, hyphens or underscores"),
        map: z.string().min(1).describe("The source map's path inside the exemplarMaps folder (or absolute), such as Maps/Harbour.SC2Map"),
        provenance: z.enum(EXEMPLAR_PROVENANCES).describe("made, edited or approved (a map the mapper admires)"),
        note: z.string().min(1).optional().describe("Anything worth knowing about the map, such as what it reuses"),
      },
      outputSchema: { id: z.string(), map: z.string(), provenance: z.enum(EXEMPLAR_PROVENANCES), file: z.string(), source: z.string() },
    },
    async ({ id, map, provenance, note }) => {
      // One add at a time per Workspace, each loading it afresh, so adds made at once all land and a repeated id is refused.
      const added = await oneAtATime(`exemplars:${await realPathOf(await ctx.root())}`, async () =>
        addExemplarMap(await ctx.workspace(), { id, map, provenance, ...(note ? { note } : {}), machine: ctx.host.machine }),
      );
      return ctx.reply(`Added Exemplar Map ${added.id} (${added.provenance}), from ${added.source}, to ${added.file}. Study it with study_exemplar.`, { ...added });
    },
  );

  tool(
    "study_exemplar",
    {
      title: "Study Exemplar Maps",
      annotations: DESTRUCTIVE,
      description: `Builds the Map Study of one or more of the active Style Pack's Exemplar Maps: study.json (measurements of its texturing, cliffs, doodads, lighting and composition) and its layer images, written into the pack's exemplar-maps/<id>/ over any study already there. Each map takes seconds, and a call that studied a whole pack could outlast the client's timeout, so study a few maps per call and call again for the rest. ${SOURCES} Refused, before anything is written, for an id the pack doesn't list or a source map that isn't there.`,
      inputSchema: { ids: RequiredIdsSchema.describe("The Exemplar Maps to study, by their ids in the pack's exemplars.json: at least one, a few at most") },
      outputSchema: { studied: z.array(z.object({ id: z.string(), studyDir: z.string(), images: z.array(z.string()) })) },
    },
    async ({ ids }) => {
      const workspace = await ctx.workspace();
      const studied = await studyExemplars(workspace, { ids, machine: ctx.host.machine });
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

  tool(
    "exemplar_report",
    {
      title: "Report which habits the Exemplar Maps share",
      annotations: READ_ONLY,
      description:
        "The consistency report of the active Style Pack's Exemplar Maps, from their Map Studies (run study_exemplar first; no source map needed): for each lesson-neutral measure, the maps' spread, the maps outside it, and where it sits against Blizzard's campaign maps (the Blizzard baseline core ships). The maps agree on a measure when the largest group of them, by provenance weight (made 3, edited 2, approved 1), whose values lie within Blizzard's middle half (p25 to p75) of each other holds at least two maps and two thirds of every map's weight, maps with nothing to measure counted too; the rest are its outliers. Where Blizzard's middle half is a single value, the band is its p10 to p90, else its whole range, else (every Blizzard map alike, or no Blizzard value) a tenth of the maps' largest value. Ranked: distinctive first (the maps agree, wholly outside Blizzard's p10 to p90), the mapper's own taste and where candidate Design Lessons come from; then common practice (they agree, as Blizzard's maps do); then questions for the mapper (they don't agree), with the maps outside the largest group; then what it can't place. Within each, the heavier evidence first. Refused, naming them, when an Exemplar Map has no study yet, or one from before its measures.",
      inputSchema: { ids: IdsSchema.describe("The Exemplar Maps to report on, by their ids in the pack's exemplars.json; every one the pack lists when not given") },
      outputSchema: {
        maps: z.array(z.object({ id: z.string(), provenance: z.string() })),
        baseline: z.object({ maps: z.number().int(), unavailable: z.array(z.string()) }),
        measures: z.array(ReportMeasureSchema),
      },
    },
    async ({ ids }) => {
      const report = await exemplarReport(await ctx.workspace(), ids ? { ids } : {});
      const { baseline } = report;
      const lines = [
        `Exemplar Maps: ${report.maps.map(({ id, provenance }) => `${id} (${provenance})`).join(", ")}.`,
        `Blizzard's spread is over ${baseline.maps} campaign maps${baseline.unavailable.length ? `; the baseline couldn't measure ${baseline.unavailable.join(", ")}, so its spreads leave them out` : ""}.`,
        ...VERDICTS.flatMap((verdict) => {
          const measures = report.measures.filter((m) => m.verdict === verdict);
          return measures.length ? ["", `${VERDICT_HEADINGS[verdict]}:`, ...measures.map(reportLine)] : [];
        }),
      ];
      return ctx.reply(lines.join("\n"), {
        maps: report.maps.map((m) => ({ ...m })),
        baseline: { maps: baseline.maps, unavailable: [...baseline.unavailable] },
        measures: report.measures.map((m) => ({ ...m, agreeing: [...m.agreeing], outliers: m.outliers.map((o) => ({ ...o })), unmeasured: [...m.unmeasured] })),
      });
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
      description: `Captures in-game camera tours of the active Style Pack's Exemplar Maps: place tours by default, one frame centred on each place in the pack's mixtures file (run find_places first), in the light the map's triggers set most outside cutscenes (or its exemplars.json placeLight, or placeZones by zone); or grid tours with tours: "grid", over the playable area once per lighting the map's study lists (run study_exemplar first), or its captureLights. Use grid tours for a map with little dressing. Frames go to the pack's exemplar-maps/<id>/captures/<tour>/ (git-ignored by the .gitignore it adds there), or under $SC2_RESEARCH_DIR/docs/research/exemplar-maps/ when that is set, with their 1000px copies in <id>/frames/<tour>/: every frame of every tour, place or grid. A tour that already has frames is skipped, so a rerun resumes; delete its captures folder to take it again. Each tour starts the game, which takes minutes. Every capture on the machine goes through one Editor Broker, one at a time; it waits up to ${waited}, and a job not done by then comes back as state waiting with a job id: call capture_exemplar({ job }) to wait again and collect it, or capture_exemplar({ job, cancel: true }) to cancel it; a new capture is refused while one is still going. ${SOURCES} Needs a Host Adapter with the editor.captureTour capability, and an awake screen; the Editor comes to the front while it runs, so check the author isn't mid-task in it.`,
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
          `capture_exemplar needs a Host Adapter that can run editor.captureTour, and this machine's (${adapter}) can't: set hostAdapter in the machine config ${ctx.host.machine.file} to a Host Adapter that has it (bundled:host-macos or bundled:host-windows), on a machine with the StarCraft II Editor. No tours were captured; the studies and places work without them.`,
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
