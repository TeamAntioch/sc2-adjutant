// The session's tools: what the Workspace loads and whether it checks, and each Mission's Co-design Stage.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PLUGIN_ROLES } from "../../plugins/plugin-api.js";
import { checkWorkspace, formatWorkspaceCheck, isError } from "../../plugins/check-workspace.js";
import { missionBlueprintPath, missionIds } from "../../plugins/workspace.js";
import { CO_DESIGN_STAGES, nextStepHint, readStageState, type Reopening, reopenStage, ReopeningSchema, SignOffSchema, signOffStage, StageNumberSchema, staleSignOffs, type StaleSignOff, type StageState, stageFilePath, stageLabel } from "../../session/co-design-stages.js";
import { staleShotCaptures } from "../../session/evidence-coverage.js";
import { writeTarget } from "../../util/replace-file.js";
import { MissionSchema } from "./schemas.js";
import { oneAtATime } from "./mission-files.js";
import { type CallContext } from "../call-context.js";
import { ADDITIVE, READ_ONLY, toolGroup } from "./tool-group.js";
import { CORE_VERSION } from "../core-version.js";

const PluginSummarySchema = z.object({
  name: z.string(),
  version: z.string(),
  source: z.string(),
  roles: z.array(z.enum(PLUGIN_ROLES)),
  /** Each kind's Contribution ids. */
  contributions: z.record(z.string(), z.array(z.string())),
});

const MissionStageSchema = z.object({
  mission: z.string(),
  /** The Stage being worked on, or null once every Stage is signed off. */
  stage: z.number().int().nullable(),
  stageName: z.string().nullable(),
  signedOff: z.array(SignOffSchema),
  /** Every reopening, oldest first, each with the sign-offs it superseded. */
  reopened: z.array(ReopeningSchema),
  /** Standing sign-offs whose covered files have changed since (#748), with what differs. A sign-off from before records existed isn't listed. */
  stale: z.array(z.object({ stage: z.number().int(), changed: z.array(z.string()), missing: z.array(z.string()), added: z.array(z.string()) })),
  /** The Mission's capture_shots folders (output/shots/<name>/) whose frames no longer show the map, since a covered file changed (#748), with what differs. A capture from before records existed isn't listed. */
  staleCaptures: z.array(z.object({ name: z.string(), changed: z.array(z.string()), missing: z.array(z.string()), added: z.array(z.string()) })),
});

/** A Mission's Stage state as the tools report it, MissionStageSchema's shape with the record's arrays as read. */
type MissionStage = StageState & { readonly mission: string; readonly stageName: string | null; readonly stale: readonly StaleSignOff[]; readonly staleCaptures: Awaited<ReturnType<typeof staleShotCaptures>> };

const missionStage = async (mission: string, blueprintPath: string, state: StageState): Promise<MissionStage> => ({
  mission,
  ...state,
  stale: await staleSignOffs(blueprintPath, state.signedOff),
  staleCaptures: await staleShotCaptures(blueprintPath),
  stageName: state.stage === null ? null : CO_DESIGN_STAGES[state.stage - 1]!,
});

/** The author's own day of a recorded time, "2026-11-11", in the server's time zone (the author's machine), not UTC's. */
const dayOf = (at: string): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** "Stage 1 of 2026-10-29, Stage 2 of 2026-10-31": the sign-offs a reopening superseded. */
const describeSuperseded = ({ superseded }: Pick<Reopening, "superseded">): string => superseded.map((signOff) => `Stage ${signOff.stage} of ${dayOf(signOff.at)}`).join(", ");

/** "Stage 3 (blueprint.json changed; 2 files added)": what a stale sign-off covered that differs now. */
function describeStale({ stage, changed, missing, added }: StaleSignOff): string {
  const part = (files: readonly string[], what: string) => (files.length ? [files.length <= 3 ? `${files.join(", ")} ${what}` : `${files.length} files ${what}`] : []);
  return `Stage ${stage} (${[...part(changed, "changed"), ...part(missing, "gone"), ...part(added, "added")].join("; ")})`;
}

/**
 * "lava-field: Stage 2 (Geography sketch); signed off Stage 1 on 2026-10-29.", with
 * " Reopened Stage 1 on 2026-11-11 (why), superseding Stage 1 of 2026-10-29." for the latest
 * reopening only, and a count of any earlier ones; the full history is in the structured reply.
 */
function describeStage({ mission, stage, signedOff, reopened, stale, staleCaptures }: MissionStage): string {
  const at = stage === null ? "every Stage signed off" : stageLabel(stage);
  const signed = signedOff.map((signOff) => `Stage ${signOff.stage} on ${dayOf(signOff.at)}${signOff.note ? ` (${signOff.note})` : ""}`);
  const now = signedOff.length ? `${mission}: ${at}; signed off ${signed.join(", ")}.` : `${mission}: ${at}, nothing signed off yet.`;
  const latest = reopened.at(-1);
  const captureNote = staleCaptures.length ? ` Captures that no longer show the map (a covered file changed): ${staleCaptures.map(({ name }) => name).join(", ")}; take them again before judging by them.` : "";
  const staleNote = captureNote + (stale.length ? ` Stale since signed off: ${stale.map(describeStale).join("; ")}. A stale sign-off still stands until the author says otherwise; ask whether it does.` : "");
  if (!latest) return now + staleNote;
  const earlier = reopened.length - 1;
  const more = earlier ? ` (${earlier} earlier reopening${earlier === 1 ? "" : "s"} in the record)` : "";
  return `${now} Reopened Stage ${latest.stage} on ${dayOf(latest.at)} (${latest.note}), superseding ${describeSuperseded(latest)}${more}.${staleNote}`;
}

/** The tools registerSessionTools can register, the session group. */
export const SESSION_TOOLS = ["list_plugins", "check_workspace", "get_session_state", "sign_off_stage", "reopen_stage"] as const;

export function registerSessionTools(server: McpServer, ctx: CallContext): void {
  const tool = toolGroup(server, SESSION_TOOLS);
  tool(
    "list_plugins",
    {
      title: "List Plugins",
      annotations: READ_ONLY,
      description:
        "Lists the Plugins the Workspace loads, in load order, with each one's name, version, source, roles and Contributions, then the machine's Host Adapter if it has one, then the version of the sc2-adjutant core this server runs.",
      outputSchema: { plugins: z.array(PluginSummarySchema), core: z.object({ version: z.string() }) },
    },
    async () => {
      // A Workspace that doesn't load still names core's version, for a Missing-Feature Report's Environment.
      let workspace;
      try {
        workspace = await ctx.workspace();
      } catch (error) {
        return ctx.fail(`${error instanceof Error ? error.message : String(error)}\nsc2-adjutant core ${CORE_VERSION}`);
      }
      const { registry } = workspace;
      const loaded = [...registry.plugins, ...(ctx.host.adapter ? [ctx.host.adapter] : [])];
      const plugins = loaded.map(({ name, version, source, roles, contributions }) => ({ name, version, source, roles, contributions }));
      const lines = plugins.map((plugin) =>
        [
          `${plugin.name} ${plugin.version} (${plugin.source})`,
          `roles: ${plugin.roles.join(", ") || "none"}`,
          ...Object.entries(plugin.contributions).map(([kind, ids]) => `${kind}: ${ids.join(", ") || "none"}`),
        ].join("; "),
      );
      return ctx.reply([...(lines.length ? lines : ["The Workspace loads no Plugins."]), `sc2-adjutant core ${CORE_VERSION}`].join("\n"), { plugins, core: { version: CORE_VERSION } });
    },
  );

  tool(
    "check_workspace",
    {
      title: "Check every Mission and mod in the Workspace",
      annotations: READ_ONLY,
      description:
        "Loads the Workspace and its Plugins and validates every Mission's Blueprint and Screenplay against them, as `npm run check-workspace` does. Reports each problem with its Mission, its file and where in the Blueprint, and each Cinematic's cinematography checks (F1, F3, C4, T4, lines with no shot, shots held past their lines), and what the game reads to open each Map Package (a DocumentHeader dependency DocumentInfo doesn't list and that isn't on disk fails, lists that otherwise differ warn; a version-39 MapInfo whose integrity hash its fields don't give fails). Each mod the config's mods names is checked too (its folder, Mod Blueprint, one mod package and compile record, and its DocumentHeader's dependencies against its DocumentInfo's), and that the Campaign Pack's Campaign Mod is one of them; such a problem names its mod. isError is set when there is any error; a warning, review item or note (severity) doesn't set it.",
      inputSchema: {},
      outputSchema: {
        missions: z.array(z.string()),
        mods: z.array(z.string()).optional(),
        problems: z.array(z.object({ mission: z.string().optional(), mod: z.string().optional(), file: z.string(), path: z.string().optional(), message: z.string(), severity: z.enum(["warning", "review", "note"]).optional() })),
      },
    },
    async () => {
      const check = await checkWorkspace(await ctx.root());
      return {
        content: [{ type: "text", text: formatWorkspaceCheck(check) }],
        structuredContent: { missions: [...check.missions], ...(check.mods ? { mods: [...check.mods] } : {}), problems: check.problems.map((problem) => ({ ...problem })) },
        ...(check.problems.some(isError) ? { isError: true } : {}),
      };
    },
  );

  tool(
    "get_session_state",
    {
      title: "Get the Co-design Stages",
      annotations: READ_ONLY,
      description: `Reports the Co-design Stage a Mission is at, the Stages the author has signed off and any Stage reopened since (with the sign-offs it superseded), or every Mission's when none is named, with the next step. The Stages are ${CO_DESIGN_STAGES.map((name, index) => `${index + 1}. ${name}`).join(", ")}. A new Mission starts at Stage 1.`,
      inputSchema: { mission: MissionSchema.optional() },
      outputSchema: { missions: z.array(MissionStageSchema), unreadable: z.array(z.object({ mission: z.string(), reason: z.string() })) },
    },
    async ({ mission }) => {
      const workspace = await ctx.workspace();
      // One Mission named or every Mission, a bad Stage record is reported the same way: under
      // `unreadable`, beside the others rather than instead of them. Naming a Mission that doesn't
      // exist is still an error.
      const ids = mission ? [mission] : await missionIds(workspace);
      const paths = await Promise.all(ids.map((id) => missionBlueprintPath(workspace, id)));
      const results = await Promise.all(
        ids.map(async (id, index) => {
          try {
            return { state: await missionStage(id, paths[index]!, await readStageState(paths[index]!)) };
          } catch (error) {
            return { unreadable: { mission: id, reason: (error as Error).message } };
          }
        }),
      );
      const states = results.flatMap((result) => (result.state ? [result.state] : []));
      const unreadable = results.flatMap((result) => (result.unreadable ? [result.unreadable] : []));
      const lines = [...states.flatMap((state) => [describeStage(state), nextStepHint(state)]), ...unreadable.map(({ mission: id, reason }) => `${id}: ${reason}`)];
      return {
        ...(mission && unreadable.length ? { isError: true } : {}),
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "The Workspace has no Missions yet." }],
        structuredContent: { missions: states, unreadable },
      };
    },
  );

  tool(
    "sign_off_stage",
    {
      title: "Sign off a Co-design Stage",
      annotations: ADDITIVE,
      description:
        "Records the author's sign-off of the Co-design Stage a Mission is at, and moves it to the next Stage. This is the only way to advance. Call it only when the author has explicitly agreed the Stage's result. Refused for any other Stage: Stages can't be skipped or signed off twice.",
      inputSchema: {
        mission: MissionSchema,
        stage: StageNumberSchema.describe("The Stage being signed off: the one the Mission is at"),
        note: z.string().min(1).optional().describe("What the author agreed, in a few words, kept with the sign-off"),
      },
      outputSchema: MissionStageSchema.shape,
    },
    async ({ mission, stage, note }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const result = await oneAtATime(`stages:${await writeTarget(stageFilePath(blueprintPath))}`, () => signOffStage(mission, blueprintPath, stage, { note }));
      const state = await missionStage(mission, blueprintPath, result.state);
      if (!result.signed) return ctx.fail(result.reason, state);
      const now = state.stage === null ? `Every Stage of ${mission} is signed off.` : `Now at ${stageLabel(state.stage)}.`;
      return ctx.reply([`Signed off ${stageLabel(stage)} of ${mission}. ${now}`, nextStepHint(state)].join("\n"), state);
    },
  );

  tool(
    "reopen_stage",
    {
      title: "Reopen a Co-design Stage",
      annotations: ADDITIVE,
      description:
        "Takes a Mission back to an earlier Co-design Stage that is signed off, as when its design is redone. That Stage and every later one must be signed off again with sign_off_stage, the only way forward. Their old sign-offs are kept in the record, superseded, with when and why the Stage was reopened. Call it only when the author has asked to reopen that Stage. Refused for the Stage the Mission is at and for a Stage it hasn't reached.",
      inputSchema: {
        mission: MissionSchema,
        stage: StageNumberSchema.describe("The Stage to go back to: one already signed off"),
        note: z.string().describe("Why the author is reopening it, in a few words, kept with the reopening"),
      },
      outputSchema: MissionStageSchema.shape,
    },
    async ({ mission, stage, note }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const result = await oneAtATime(`stages:${await writeTarget(stageFilePath(blueprintPath))}`, () => reopenStage(mission, blueprintPath, stage, { note }));
      const state = await missionStage(mission, blueprintPath, result.state);
      if (!result.reopened) return ctx.fail(result.reason, state);
      return ctx.reply([`Reopened ${stageLabel(stage)} of ${mission}; superseded the sign-offs of ${describeSuperseded(state.reopened.at(-1)!)}.`, nextStepHint(state)].join("\n"), state);
    },
  );
}
