// The capture and cutscene tools: dressing captures, in-game Shots and Still Reviews of them (stills.ts), cutscenes and set imports, and placeholder voices.

import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { writePlaceholderVoices } from "../../host/placeholder-voices.js";
import { cinematicIdOf, compileCinematicCutscene, compileShotCutscene, readShotCutscene } from "../../cutscene/compile-cutscene.js";
import { importSetIntoMission, importSetIntoMod } from "../../cutscene/import-set.js";
import { captureMissionComposite, freezeMissionSetPiece } from "../../dressing/mission-dressing-edits.js";
import { missionBlueprintPath, parseMissionBlueprint, type Workspace } from "../../plugins/workspace.js";
import { type MissionVoiceScript, readMissionScript } from "../../script/name-script.js";
import { isInside, realPathOf } from "../../util/inside.js";
import { writeTarget } from "../../util/replace-file.js";
import { brokerSocketPath, editorBrokerStatus } from "../../capture/editor-broker-client.js";
import { type CaptureShotsResult, captureShots, ShotSchema } from "../../capture/shots.js";
import { formatRunLogReport, reportRunLogs, type RunLogReport } from "../../host/game-run-report.js";
import { hostContext } from "../../host/machine-config.js";
import { captureJobs, type JobState, placeOf, waitLength as waitLengthOf } from "../capture-jobs.js";
import { MissionSchema, IssueSchema, MapSchema } from "./schemas.js";
import { stageHint, insideWorkspace, existingMapPackage, oneAtATime, readingMapToEdit } from "./mission-files.js";
import { describeHandoff, editorHasOpen, TEST_BUDGET_SECONDS, TEST_MIN_SECONDS, testInGame } from "./editor-handoff.js";
import { type CallContext } from "../call-context.js";
import { registerStillTools } from "./stills.js";
import { ADDITIVE, DESTRUCTIVE, type RefusedWithout, toolGroup } from "./tool-group.js";

/** The Mission's Screenplay script and its voice folder, or an error when it has none. */
async function missionScript(workspace: Workspace, blueprintPath: string): Promise<MissionVoiceScript> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const found = await readMissionScript(blueprint, blueprintPath, workspace);
  if (!found) throw new Error(`${blueprint.title} has no Screenplay script (screenplay.script in ${blueprintPath}), so it has no voice lines`);
  // Voice files are written into it, so, as for a compile, it must be inside the Workspace.
  if (!(await isInside(workspace.root, found.audioDir))) {
    throw new Error(`${blueprintPath}'s screenplay.script.audioDir ${blueprint.screenplay.script!.audioDir} is outside the Workspace ${workspace.root}`);
  }
  return found;
}

/** The tools registerCaptureTools can register, the capture group: speak_placeholder_voices only on a Host that can run tts.speak. */
export const CAPTURE_TOOLS = ["speak_placeholder_voices", "capture_composite", "capture_shots", "freeze_set_piece", "compile_cutscene", "import_set", "shots_for_zones", "build_still_review", "record_still_feedback"] as const;

/** The group's tools listed on every machine but refused where the Host Adapter lacks these capabilities. */
export const CAPTURE_REFUSED_WITHOUT = { capture_shots: ["editor.captureTour"] } as const satisfies RefusedWithout<(typeof CAPTURE_TOOLS)[number]>;

export function registerCaptureTools(server: McpServer, ctx: CallContext, { captureWaitMs }: { captureWaitMs: number }): void {
  const tool = toolGroup(server, CAPTURE_TOOLS);
  // Bulk tools with no manual form are listed only when the Host Adapter can run them.
  if (ctx.host.has("tts.speak")) {
    tool(
      "speak_placeholder_voices",
      {
        title: "Speak placeholder voice lines",
        annotations: DESTRUCTIVE,
        description:
          "Speaks a placeholder voice file for every line of a Mission's Screenplay script with the Host Adapter's text-to-speech, in the Mission's voice format (screenplay.script.voiceFormat: .ogg, encoded with ffmpeg, unless it says wav), replacing silent placeholders and lines whose text changed. Voice files the author recorded, .ogg or .wav, are kept, and so are files an older version recorded without a hash, which can't be told from recordings, unless adoptUnhashed is set.",
        inputSchema: {
          mission: MissionSchema,
          adoptUnhashed: z
            .boolean()
            .optional()
            .describe("The author confirms every voice file an older version recorded without a hash is a placeholder, not a recording, so those whose line changed are spoken again"),
        },
        outputSchema: { audioDir: z.string(), spoken: z.array(z.string()), unhashed: z.array(z.string()) },
      },
      async ({ mission, adoptUnhashed }) => {
        const workspace = await ctx.workspace();
        const { script, audioDir, voiceFormat } = await missionScript(workspace, await missionBlueprintPath(workspace, mission));
        const { spoken, unhashed } = await writePlaceholderVoices(ctx.host, script, audioDir, "stale", { adoptUnhashed: adoptUnhashed ?? false, format: voiceFormat });
        const lines = [`Spoke ${spoken.length} placeholder voice line(s) in ${audioDir}; the others were up to date or are recordings.`];
        if (unhashed.length) {
          lines.push(
            `Kept ${unhashed.length} voice file(s) whose line changed, since an older version recorded no hash of them and each might be a recording: ${unhashed.join(", ")}. Ask the author whether they are all placeholders; if so, call again with adoptUnhashed.`,
          );
        }
        return ctx.reply(lines.join("\n"), { audioDir, spoken: [...spoken], unhashed: [...unhashed] });
      },
    );
  }

  tool(
    "capture_composite",
    {
      title: "Capture a Doodad Composite",
      annotations: DESTRUCTIVE,
      description:
        "Captures a Doodad Composite recipe (DL-07) from a Map Package saved in the Galaxy Editor: the author builds a shape from stock doodads, draws a region round it and saves; the doodads inside the region become the recipe's members, relative to their middle. The recipe joins the Blueprint's composites, replacing one with the same id, and set pieces stamp it with { \"composite\": id }. The doodads stay in the map.",
      inputSchema: {
        mission: MissionSchema,
        map: MapSchema,
        region: z.string().min(1).describe("The name of the region drawn round the shape in the Editor"),
        id: z.string().min(1).optional().describe("The recipe's id; by default the region name as a slug"),
        kind: z.enum(["landmark", "detail"]).optional().describe("landmark (the default): a shape the player steers by; detail: small dressing"),
        style: z.enum(["natural", "built"]).optional().describe("natural (the default) or built"),
        scale: z.tuple([z.number().positive(), z.number().positive()]).optional().describe("The [min, max] scale each stamped copy is drawn from; by default [1, 1]"),
      },
      outputSchema: {
        saved: z.boolean(),
        composite: z.object({ id: z.string(), kind: z.string(), members: z.number().int(), types: z.array(z.string()) }).optional(),
        notes: z.array(z.string()),
        issues: z.array(IssueSchema),
      },
    },
    async ({ mission, map, region, id, kind, style, scale }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPath = await existingMapPackage(workspace.root, blueprintPath, map);
      const { composite, edit } = await readingMapToEdit(mapPath, blueprintPath, () =>
        captureMissionComposite(workspace, blueprintPath, mapPath, region, { ...(id ? { id } : {}), ...(kind ? { kind } : {}), ...(style ? { style } : {}), ...(scale ? { scale } : {}) }),
      );
      const types = [...new Set(composite.members.map((member) => member.type))];
      const summary = { id: composite.id, kind: composite.kind, members: composite.members.length, types };
      if (!edit.saved) return ctx.refused(blueprintPath, edit.issues, { composite: summary });
      const lines = [
        `Captured ${composite.members.length} doodads as ${composite.kind} composite ${composite.id} in ${blueprintPath}: ${types.join(", ")}`,
        ...(composite.actors.length ? [`With the map's own doodads made from models: ${composite.actors.map((actor) => `${actor.id} (${actor.model})`).join(", ")}`] : []),
        ...edit.notes,
        await stageHint(blueprintPath),
      ];
      return ctx.reply(lines.join("\n"), { saved: true, composite: summary, notes: [...edit.notes], issues: [] });
    },
  );

  // Listed whatever the Host Adapter, unlike the other bulk tools, so a call on a machine that
  // can't capture is refused with the reason rather than finding no tool.
  const shotJobs = captureJobs<CaptureShotsResult & { readonly logs: RunLogReport }>();
  const waitLength = waitLengthOf(captureWaitMs);
  tool(
    "capture_shots",
    {
      title: "Capture Shots in game",
      annotations: ADDITIVE,
      description: `Takes in-game screenshots of parts of a map, one frame per Shot. A Shot is a rectangle of the map in cells, rect: [left, bottom, right, top], that its frame shows whole, with an optional pitch (degrees down from level: 75 by default, a high view; 56 is the player's camera) and yaw (degrees turned from the game camera's own, which looks north; 0 by default), and a label that names its frame. Use it to see how a map looks in the game itself (ground, cliffs, dressing, water, lighting, a layout's sight lines), not in a preview render or the Editor. Size each rectangle to what you want to judge: the camera moves back until the rectangle fits, so about 30-50 cells shows a Zone and more an overview; the 16:9 frame shows more than the rectangle on its long side. The camera comes no nearer than the player's own, which frames about 32 cells across, unless the Shot has close: true, which frames it as near as it needs: about 10-20 cells for ground detail. A rectangle too big for the farthest camera, or at the map's edge where the camera can't centre on it, is still captured and listed as partial (whole: false). A Shot whose frame the host took after the tour's camera had moved on (a loaded machine) has no frame and is listed as late (late: true), apart from missing ones: it would have shown another Shot's place, so retake those Shots. Send every Shot you need in one call: starting the game takes minutes, each Shot after that a few seconds. The game runs a capture copy of the map with none of the map's own triggers: the map as placed, revealed with no fog, no UI, no trigger-set lighting (pass lighting, a Light id, to set one), no trigger-spawned units and no trigger-made actor changes. Give mission for a Mission's own Map Package (frames in missions/<id>/output/shots/<name>/, git-ignored) or mapPath for any Map Package (frames in the machine's cacheDir, shots/<name>/); name is the folder, the time by default. Every capture on the machine goes through one Editor Broker, one at a time, so a call may wait behind others. It waits up to ${waitLength}; a job not done by then comes back as state waiting with a job id: call capture_shots({ job }) to wait again and collect the frames, or hear the job's place in the queue. capture_shots({ job, cancel: true }) cancels a job no longer wanted, waiting or running (a running one quits the game and closes its copy first), and stopping a call cancels the job it waits on. After the game quits it reads the game's logs and reports any crash, each distinct error with its count and which no known-error list (known-errors.json at the Workspace root, and the Mission's own beside its Blueprint) knows; propose a pattern for the author to add, never add one. Returns the frames' paths and shots.json, which gives each Shot's rectangle, camera and whether its frame shows it whole; look at the frames with your file-reading tool. Needs a Host Adapter with the editor.captureTour capability, and an awake screen; the Editor comes to the front while it runs, so check the author isn't mid-task in it.`,
      inputSchema: {
        mission: MissionSchema.optional(),
        mapPath: z.string().min(1).optional().describe("Any Map Package, instead of a Mission: an absolute path, or one relative to the Workspace's root"),
        shots: z.array(ShotSchema).min(1).optional().describe("The Shots, all of them in one call; at most 99"),
        lighting: z.string().min(1).optional().describe("A Light id to set, since the map's own lighting triggers don't run; the tileset's default lighting otherwise"),
        name: z.string().min(1).optional().describe("The frames' folder name: letters, digits, dots, dashes and underscores; the time by default"),
        job: z.string().min(1).optional().describe("A job id an earlier call returned: waits again, then collects its frames or says where it stands. Give it alone, or with cancel"),
        cancel: z.boolean().optional().describe("With job: cancels it, whether it waits in the queue or runs"),
      },
      outputSchema: {
        state: z.enum(["done", "waiting", "cancelled"]),
        job: z.string(),
        /** Waiting: running, starting, finishing, or its place in the queue. */
        place: z.string().optional(),
        outputDir: z.string().optional(),
        frames: z.array(z.string()).optional(),
        shotsJson: z.string().optional(),
        shots: z.array(z.object({ shot: z.number().int(), label: z.string().optional(), frame: z.string().nullable(), whole: z.boolean(), late: z.literal(true).optional() })).optional(),
        missing: z.array(z.string()).optional(),
        /** The Shots captured after the camera moved on, their frames dropped: retake them. */
        late: z.array(z.string()).optional(),
        partial: z.array(z.string()).optional(),
        end: z.string().optional(),
        /** The game's logs for this capture, read after it quit: crashes, each distinct error with its count, and which no known-error list knows (new). */
        gameLogs: z.unknown().optional(),
      },
    },
    async ({ mission, mapPath, shots, lighting, name, job, cancel }, extra: { readonly signal?: AbortSignal }) => {
      if (!ctx.host.has("editor.captureTour")) {
        const adapter = ctx.host.adapter ? ctx.host.adapter.name : "none";
        return ctx.fail(
          `capture_shots needs a Host Adapter that can run editor.captureTour, and this machine's (${adapter}) can't: set hostAdapter in the machine config ${ctx.host.machine.file} to a Host Adapter that has it (bundled:host-macos or bundled:host-windows), on a machine with the StarCraft II Editor. No Shots were captured.`,
        );
      }
      if (job !== undefined) {
        if (mission !== undefined || mapPath !== undefined || shots !== undefined || lighting !== undefined || name !== undefined) return ctx.fail("Give job alone, to collect it, or with cancel; a new capture takes a mission or a mapPath, and shots.");
        if (cancel) {
          if (!shotJobs.cancel(job)) return shotsReply(job, undefined);
          const state = await shotJobs.wait(job, captureWaitMs);
          // One that finished before the cancel reached it is collected as usual.
          if (state?.state === "failed") return ctx.reply(`Cancelled capture job ${job}: ${state.message}`, { state: "cancelled" as const, job });
          return shotsReply(job, state);
        }
        return shotsReply(job, await shotJobs.wait(job, captureWaitMs, extra.signal));
      }
      if (cancel) return ctx.fail("cancel goes with job: the id of the capture to cancel.");
      if ((mission === undefined) === (mapPath === undefined)) return ctx.fail("capture_shots takes a mission or a mapPath (one of them), and shots; or a job alone.");
      if (!shots) return ctx.fail("capture_shots needs shots: the rectangles to capture, all of them in one call.");
      const workspace = await ctx.workspace();
      const source = mission !== undefined ? { blueprintPath: await missionBlueprintPath(workspace, mission) } : { mapPath: path.resolve(workspace.root, mapPath!) };
      const id = shotJobs.start(async ({ onQueued, log, signal }) => {
        const began = new Date();
        const captured = await captureShots(source, shots, { host: ctx.host, onQueued, log, signal, ...(name ? { name } : {}), ...(lighting ? { lighting } : {}) });
        // The game has quit by now (the broker quits the games it started), so its logs are written.
        const logs = await reportRunLogs({
          host: ctx.host,
          workspaceRoot: workspace.root,
          ...("blueprintPath" in source ? { missionDir: path.dirname(source.blueprintPath) } : {}),
          selection: { after: new Date(captured.run.startedAt ?? began), parameters: [path.basename(captured.copy), "EditorTest.SC2Map"], pids: captured.run.games.map((game) => game.pid) },
        }).catch((error: unknown): RunLogReport => ({ folder: "", sessions: [], stale: [], note: `couldn't read the game's logs: ${(error as Error).message}` }));
        return { ...captured, logs };
      });
      return shotsReply(id, await shotJobs.wait(id, captureWaitMs, extra.signal));
    },
  );

  registerStillTools(tool, ctx);

  /** capture_shots's reply for a job where it stands. */
  async function shotsReply(job: string, state: JobState<CaptureShotsResult & { readonly logs: RunLogReport }> | undefined) {
    if (!state) return ctx.fail(`No capture job ${job} on this server: it never started here, or finished over an hour ago (its frames and shots.json stay in its folder), or the server restarted, which drops a job still waiting.`);
    if (state.state === "failed") return ctx.fail(`Capture job ${job} failed: ${state.message}`);
    if (state.state === "waiting") {
      const place = placeOf(await editorBrokerStatus(brokerSocketPath(hostContext(ctx.host.machine).requirePath("cacheDir"))), state.brokerId);
      const lines = [
        `Capture job ${job} is still going (${place}) after waiting ${waitLength}. Call capture_shots({ job: "${job}" }) to wait again and collect the frames.`,
        ...(state.lastLine ? [`Last: ${state.lastLine}`] : []),
      ];
      return ctx.reply(lines.join("\n"), { state: "waiting" as const, job, place });
    }
    const { result } = state;
    const shotsJson = path.join(result.outputDir, "shots.json");
    const shots = result.shots.map(({ shot, label, frame, whole, late }) => ({ shot, ...(label ? { label } : {}), frame: frame === null ? null : path.join(result.outputDir, frame), whole, ...(late ? { late } : {}) }));
    const logLines = formatRunLogReport(result.logs, "Game logs");
    return ctx.reply([result.summary, ...result.frames, `What each shows: ${shotsJson}`, ...logLines].join("\n"), { state: "done" as const, job, outputDir: result.outputDir, frames: [...result.frames], shotsJson, shots, missing: [...result.missing], late: [...result.late], partial: [...result.partial], end: result.end, gameLogs: result.logs });
  }

  tool(
    "freeze_set_piece",
    {
      title: "Freeze a set piece",
      annotations: DESTRUCTIVE,
      description:
        "Freezes a set piece: writes the doodads it expands to into the Blueprint as ordinary doodad Anchors (exact positions, yaw and variation), numbered <set piece>-1, -2 and so on, and removes the set-piece placement, so single doodads can be moved or swapped by hand or in the Editor. Other set pieces don't move.",
      inputSchema: { mission: MissionSchema, setPiece: z.string().min(1).describe("The set-piece placement's id") },
      outputSchema: { saved: z.boolean(), frozen: z.number().int(), notes: z.array(z.string()), issues: z.array(IssueSchema) },
    },
    async ({ mission, setPiece }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const { frozen, edit } = await oneAtATime(`edit:${await writeTarget(blueprintPath)}`, () => freezeMissionSetPiece(workspace, blueprintPath, setPiece));
      if (!edit.saved) return ctx.refused(blueprintPath, edit.issues, { frozen });
      const lines = [`Froze ${setPiece} into ${frozen} doodad anchors in ${blueprintPath}.`, ...edit.notes, await stageHint(blueprintPath)];
      return ctx.reply(lines.join("\n"), { saved: true, frozen, notes: [...edit.notes], issues: [] });
    },
  );

  tool(
    "compile_cutscene",
    {
      title: "Compile a cutscene",
      annotations: DESTRUCTIVE,
      description:
        "Writes a shot-list cutscene (a ShotCutscene JSON file: an origin and shots, each with a camera, a duration and any backdrop actors), or one of the Mission's Cinematics (its cinematics/<id>.json, with its sets and the scene's lines; a Cinematic plays in a full-screen dialog, and the reply warns about what it films (a Set imported from a story package's cutscene, a cast model or a Light) that the map's dependencies don't load, naming the dependency to add; one the Blueprint doesn't list is a test Cinematic, written silent under name, its id by default, and named after the Cinematic the mission start cue plays it takes that one's place; a shot list is refused the name of a Cinematic the map plays), into a Mission's Map Package, at Base.SC2Data/Cutscenes/<name>.SC2Cutscene, where the Cutscene Editor opens it and the game can play it over the map's own set. With play, it also plays in a loop from map start at the shot list's origin, each run pausing AI time and skippable with Escape (a Cinematic whose scene is cued at missionStart already plays from that cue, so it gets no loop), and the map is played in the game through the Editor's Test Document, or the reply gives the author the steps when the machine's Host Adapter can't. Ask the author to close the map in the Editor first. Run compile_map first: compiling the map again keeps a shot-list cutscene, which the compile record doesn't list, and drops its play-from-start test loop; the Cinematics the Blueprint lists are written by the compile itself.",
      inputSchema: {
        mission: MissionSchema,
        shotList: z.string().min(1).describe("The shot list's JSON file, inside the Workspace, relative to its root"),
        map: MapSchema,
        name: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "A cutscene name is letters, digits, spaces, _ . and -")
          .refine((value) => !value.includes(".."), "A cutscene name can't hold ..")
          .optional()
          .describe("The cutscene's file name, without .SC2Cutscene; by default the shot list's file name"),
        play: z.boolean().optional().describe("Also play it from map start, for a test run"),
      },
      outputSchema: {
        file: z.string(),
        shots: z.number().int(),
        playsFrom: z.tuple([z.number(), z.number()]).optional(),
        /** For a Cinematic: what it films that the map's dependencies don't load, with the dependency to add. */
        warnings: z.array(z.string()).optional(),
        /** With play: what the Host Adapter did for the test run, and what is left for the author. */
        automated: z.array(z.string()).optional(),
        steps: z.array(z.string()).optional(),
      },
    },
    async ({ mission, shotList, map, name, play }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const specPath = await insideWorkspace(workspace.root, shotList, "The shot list", "inside");
      const mapPath = await existingMapPackage(workspace.root, blueprintPath, map);
      // A Mission's Cinematic (its cinematics/<id>.json) is compiled with its sets and lines; any other file is a shot list.
      const cinematic = await cinematicIdOf(workspace, blueprintPath, specPath);
      const spec = cinematic ? undefined : await readShotCutscene(specPath);
      // Checked before writing into the package, which the Editor would crash on or save over.
      const open = await editorHasOpen(ctx.host, mapPath, "compile_cutscene", "Not written");
      if (open) return ctx.fail(open.text);
      const started = Date.now();
      const result = await oneAtATime(await realPathOf(mapPath), () =>
        spec
          ? compileShotCutscene(spec, mapPath, name ?? path.basename(specPath, ".json"), { play: play ?? false })
          : compileCinematicCutscene(workspace, blueprintPath, cinematic!.id, mapPath, { play: play ?? false, ...(name && !cinematic!.listed ? { name } : {}) }),
      );
      // With play, the test run it is for: Test Document by the Host Adapter, or the steps for the author.
      const handoff = play ? await testInGame(ctx.host, mapPath, Math.max(TEST_MIN_SECONDS, TEST_BUDGET_SECONDS - Math.ceil((Date.now() - started) / 1000))) : undefined;
      const lines = [
        `${result.shots} shots written to ${result.file}`,
        ...(cinematic?.listed && name ? [`A Cinematic is written under its id, ${cinematic.id}, not ${name}`] : []),
        ...(result.playsFrom ? [`Plays from map start at ${result.playsFrom.join(", ")}`] : []),
        ...(result.inDialog ? [`Plays from map start in a full-screen dialog${result.fromCue ? ", from its scene's missionStart cue" : ""}`] : []),
        ...(result.warnings ?? []).map((warning) => `Warning: ${warning}`),
        ...(handoff ? describeHandoff(handoff) : []),
        await stageHint(blueprintPath),
      ];
      return ctx.reply(lines.join("\n"), {
          file: result.file,
          shots: result.shots,
          ...(result.playsFrom ? { playsFrom: [...result.playsFrom] as [number, number] } : {}),
          ...(result.warnings ? { warnings: [...result.warnings] } : {}),
          ...(handoff ? { automated: handoff.automated, steps: handoff.steps } : {}),
        });
    },
  );

  tool(
    "import_set",
    {
      title: "Import a cinematic set",
      annotations: DESTRUCTIVE,
      description:
        "Imports a cinematic set into a Mission or a mod as data, at <its folder>/sets/<set id>.json (for a mod's Cinematics, mods/<id>/sets/), from the Cutscene Editor files where the set catalog (data/cinematic-sets) finds it: its pieces (model, transform, variation, tint), marks (each with its look-at at another mark), named cameras (orbit cameras, and target cameras converted to orbit values; a moving one at its first frame, marked moves), base Lights, lamps (one attached to a character attached to its mark) and its ambience (each Sound looping all through the file; other Sounds are listed as cues for a Cinematic's sounds), in the set's own frame, with the source file recorded. A Cinematic then compiles without the source files. It reads the set's richest occurrence among the sources, unless file names another. Importing again replaces the file.",
      inputSchema: {
        mission: MissionSchema.optional().describe("The Mission to import it into; give this or mod"),
        mod: z.string().min(1).optional().describe("The Workspace mod to import it into, for its Cinematics; give this or mission"),
        set: z.string().min(1).describe('The set\'s catalog name, such as "Interior (Command Center Arrival)", or its id'),
        sources: z
          .array(
            z.object({
              kind: z.string().min(1).describe("The source kind: blizzard for Blizzard's game data, or one a Workspace Plugin contributes for a Campaign's repo"),
              dir: z.string().min(1).describe("The folder of Cutscene Editor files, absolute or relative to the Workspace root"),
            }),
          )
          .min(1)
          .describe("The folders to read, as catalog-sets takes them"),
        file: z.string().min(1).optional().describe("The occurrence to read instead of the richest: its path in its source, or its file name"),
      },
      outputSchema: { file: z.string(), source: z.string(), pieces: z.number().int(), marks: z.number().int(), cameras: z.number().int(), lamps: z.number().int(), notes: z.array(z.string()) },
    },
    async ({ mission, mod, set, sources, file }) => {
      if (mission === undefined && mod === undefined) throw new Error("Give a mission or a mod to import the set into");
      if (mission !== undefined && mod !== undefined) throw new Error("Give a mission or a mod to import the set into, not both");
      const workspace = await ctx.workspace();
      const roots = sources.map(({ kind, dir }) => ({ origin: kind, root: path.resolve(workspace.root, dir) }));
      const options = file ? { file } : {};
      const imported = mod !== undefined ? await importSetIntoMod(workspace, mod, set, roots, options) : await importSetIntoMission(workspace, mission!, set, roots, options);
      const { provenance, pieces, marks, cameras, lamps } = imported.set;
      const source = `${provenance!.kind}:${provenance!.file}`;
      const counts = { pieces: pieces.length, marks: marks.length, cameras: cameras.length, lamps: lamps.length };
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const lines = [
        `Imported ${imported.set.name} (${plural(counts.pieces, "piece")}, ${plural(counts.marks, "mark")}, ${plural(counts.cameras, "camera")}, ${plural(counts.lamps, "lamp")}) from ${source} to ${imported.path}`,
        ...imported.notes,
      ];
      return ctx.reply(lines.join("\n"), { file: imported.path, source, ...counts, notes: [...imported.notes] });
    },
  );
}
