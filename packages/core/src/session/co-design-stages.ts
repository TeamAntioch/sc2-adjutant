// Co-design Stage tracking (#116): which of the four Stages each Mission is at, and the author's
// sign-offs so far. The record is `co-design.json` in the Mission's folder, beside its Blueprint,
// so it is part of the Workspace and survives a restart. A Mission without one is at Stage 1 with
// nothing signed off. The current Stage is always the one after the last sign-off, and signing
// off is the only way to advance, one Stage at a time. Reopening (#673) takes a Mission back to an
// earlier Stage: the sign-offs of that Stage and every later one leave `signedOff` and are kept,
// superseded, in `co-design-history.json` beside it, with when and why. The history has its own
// file so `co-design.json` keeps the shape a core from before reopening reads.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { formatIssues } from "../util/format-issues.js";
import { type CoveredFile, CoveredFileSchema, coverageOf, isStale, type Staleness, stalenessOf } from "./evidence-coverage.js";
import { replaceFile } from "../util/replace-file.js";

/** The four Co-design Stages, in order, by name. Stage `n` is at index `n - 1`. */
export const CO_DESIGN_STAGES = ["Beats and Mechanics", "Geography sketch", "Palette and placement", "Dialogue and compilation"] as const;

export const STAGE_FILE = "co-design.json";
/** The reopenings and the sign-offs they superseded, beside the Stage record. */
export const HISTORY_FILE = "co-design-history.json";

/** A Stage's number, from 1 to the number of Stages. */
export const StageNumberSchema = z.number().int().min(1).max(CO_DESIGN_STAGES.length);

/**
 * One sign-off as recorded: the Stage, when, what the author agreed, and the files it covers with
 * their fingerprints at the time (#748). A sign-off from before `covers` has none and is never
 * reported stale.
 */
export const SignOffSchema = z
  .object({
    stage: StageNumberSchema,
    at: z.iso.datetime(),
    note: z.string().optional(),
    covers: z.array(CoveredFileSchema).optional(),
  })
  .strict();
export type SignOff = { readonly stage: number; readonly at: string; readonly note?: string | undefined; readonly covers?: readonly CoveredFile[] | undefined };

/** A standing sign-off whose covered files have changed since, with what differs. */
export type StaleSignOff = { readonly stage: number } & Staleness;

/** The standing sign-offs of the Mission at `blueprintPath` that are stale now. Reads only; nothing is rewritten. */
export async function staleSignOffs(blueprintPath: string, signedOff: readonly SignOff[]): Promise<StaleSignOff[]> {
  const stale: StaleSignOff[] = [];
  for (const signOff of signedOff) {
    if (!signOff.covers) continue;
    const staleness = await stalenessOf(blueprintPath, signOff.stage, signOff.covers);
    if (isStale(staleness)) stale.push({ stage: signOff.stage, ...staleness });
  }
  return stale;
}

/** One reopening as recorded: the Stage reopened, when, why, and the sign-offs it superseded. */
export const ReopeningSchema = z
  .object({
    stage: StageNumberSchema,
    at: z.iso.datetime(),
    note: z.string().refine((note) => note.trim().length > 0, "say why the Stage was reopened"),
    superseded: z.array(SignOffSchema).min(1),
  })
  .strict()
  .superRefine(({ stage, superseded }, context) => {
    superseded.forEach((signOff, index) => {
      if (signOff.stage !== stage + index) {
        context.addIssue({ code: "custom", path: ["superseded", index, "stage"], message: `expected Stage ${stage + index}, got Stage ${signOff.stage}` });
      }
    });
  });
export type Reopening = { readonly stage: number; readonly at: string; readonly note: string; readonly superseded: readonly SignOff[] };

export type StageState = {
  /** The Stage being worked on, from 1, or null once every Stage is signed off. */
  readonly stage: number | null;
  /** The sign-offs that stand, Stage 1 onwards. */
  readonly signedOff: readonly SignOff[];
  /** Every reopening, oldest first, each with the sign-offs it superseded. */
  readonly reopened: readonly Reopening[];
};

const StageRecordSchema = z
  .object({
    signedOff: z.array(SignOffSchema),
  })
  .strict()
  .superRefine(({ signedOff }, context) => {
    signedOff.forEach((signOff, index) => {
      if (signOff.stage !== index + 1) {
        context.addIssue({ code: "custom", path: ["signedOff", index, "stage"], message: `expected Stage ${index + 1}, got Stage ${signOff.stage}` });
      }
    });
  });

/** The reopenings, in their own file so that a core from before them still reads `co-design.json`. */
const HistorySchema = z.object({ reopened: z.array(ReopeningSchema) }).strict();

/**
 * What's wrong with a history against the sign-offs that stand, replayed from the record alone and
 * never from the times in it, which clocks on two machines needn't agree on. A sign-off is
 * superseded at most once and never stands after it is; and since sign-offs only add Stages
 * between reopenings, each reopening's Stage is at most one past what stood after the reopening
 * before it, and what stands now reaches at least to before the last one's Stage. A record merged
 * by hand from two branches, or a write cut short between the two files, fails these.
 */
function historyIssues(signedOff: readonly SignOff[], reopened: readonly Reopening[]): string[] {
  const issues: string[] = [];
  const seen = new Map<string, string>();
  const note = (signOff: SignOff, where: string) => {
    const key = `${signOff.stage}@${signOff.at}`;
    const first = seen.get(key);
    if (first) issues.push(`${where}: the sign-off of Stage ${signOff.stage} at ${signOff.at} is also ${first}; a sign-off is superseded once at most, and doesn't stand after it is`);
    else seen.set(key, where);
  };
  reopened.forEach((reopening, index) => {
    reopening.superseded.forEach((signOff, inner) => note(signOff, `reopened.${index}.superseded.${inner}`));
    const before = reopened[index - 1];
    // What stood when this Stage was reopened: its Stage less one, plus what it superseded.
    const stood = reopening.stage - 1 + reopening.superseded.length;
    if (before && stood < before.stage - 1) {
      issues.push(`reopened.${index}: Stage ${reopening.stage} was reopened with Stages 1 to ${stood} signed off, fewer than the ${before.stage - 1} that stood after the reopening before it`);
    }
  });
  signedOff.forEach((signOff, index) => note(signOff, `signedOff.${index}`));
  const last = reopened.at(-1);
  if (last && signedOff.length < last.stage - 1) {
    issues.push(`signedOff: Stages 1 to ${last.stage - 1} stood after Stage ${last.stage} was reopened, but only ${signedOff.length} stand now`);
  }
  return issues;
}

/** "Stage 2 (Geography sketch)". */
export const stageLabel = (stage: number): string => `Stage ${stage} (${CO_DESIGN_STAGES[stage - 1]})`;

/** The Stage record of the Mission whose Blueprint is at `blueprintPath`. */
export const stageFilePath = (blueprintPath: string): string => path.join(path.dirname(blueprintPath), STAGE_FILE);

/** The history of the Mission whose Blueprint is at `blueprintPath`, beside its Stage record. */
export const historyFilePath = (blueprintPath: string): string => path.join(path.dirname(blueprintPath), HISTORY_FILE);

/** One of the two files parsed with `schema`, or undefined when it isn't there. */
async function readJson<T>(file: string, schema: z.ZodType<T>, what: string): Promise<T | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Can't read the Co-design ${what} ${file}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid Co-design ${what} ${file}: ${formatIssues(parsed.error, "(record)")}`);
  return parsed.data;
}

/** Reads a Mission's Stage state; a Mission with no record yet is at Stage 1 with nothing signed off. */
export async function readStageState(blueprintPath: string): Promise<StageState> {
  const record = await readJson(stageFilePath(blueprintPath), StageRecordSchema, "Stage record");
  const history = await readJson(historyFilePath(blueprintPath), HistorySchema, "Stage history");
  const signedOff = record?.signedOff ?? [];
  const reopened = history?.reopened ?? [];
  const issues = historyIssues(signedOff, reopened);
  if (issues.length) {
    throw new Error(`The Co-design Stage history ${historyFilePath(blueprintPath)} doesn't agree with the Stage record ${stageFilePath(blueprintPath)}: ${issues.join("; ")}`);
  }
  return stateOf(signedOff, reopened);
}

const stateOf = (signedOff: readonly SignOff[], reopened: readonly Reopening[]): StageState => ({
  stage: signedOff.length < CO_DESIGN_STAGES.length ? signedOff.length + 1 : null,
  signedOff,
  reopened,
});

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Checks `next` as a read would, so the tools never write what the server would refuse, then saves
 * it: the history first, then the record, so a write cut short between them is caught on the next
 * read (the superseded sign-offs still standing) rather than losing them.
 */
async function writeState(blueprintPath: string, next: Pick<StageState, "signedOff" | "reopened">, { history }: { readonly history: boolean }): Promise<StageState> {
  const issues = historyIssues(next.signedOff, next.reopened);
  if (issues.length) throw new Error(`Not saved, since the Co-design Stage record would be refused: ${issues.join("; ")}`);
  if (history) await replaceFile(historyFilePath(blueprintPath), json({ reopened: next.reopened }));
  await replaceFile(stageFilePath(blueprintPath), json({ signedOff: next.signedOff }));
  return stateOf(next.signedOff, next.reopened);
}

/**
 * The Mission's Stage state for a change to `stage`, or the refusal of a Stage number out of
 * range. The number is checked before the record is read, so a bad number is refused as such.
 */
async function readForChange(blueprintPath: string, stage: number): Promise<{ readonly state: StageState; readonly refusal?: string }> {
  const noSuchStage = !StageNumberSchema.safeParse(stage).success;
  const state = await readStageState(blueprintPath);
  return noSuchStage ? { state, refusal: `there is no Stage ${stage}; the Stages are 1 to ${CO_DESIGN_STAGES.length}.` } : { state };
}

export type SignOffResult = { readonly signed: true; readonly state: StageState } | { readonly signed: false; readonly reason: string; readonly state: StageState };

/**
 * Signs off `stage` of the Mission at `blueprintPath` and saves the record. Refused unless `stage`
 * is the Stage the Mission is at: Stages can't be skipped or signed off twice. The caller makes
 * sure two sign-offs of one Mission don't run at once.
 */
export async function signOffStage(
  mission: string,
  blueprintPath: string,
  stage: number,
  { note, at = new Date() }: { readonly note?: string | undefined; readonly at?: Date } = {},
): Promise<SignOffResult> {
  const { state, refusal: outOfRange } = await readForChange(blueprintPath, stage);
  const refuse = (reason: string): SignOffResult => ({ signed: false, reason: `Refused: ${reason}`, state });
  if (outOfRange) return refuse(outOfRange);
  if (state.stage === null || stage < state.stage) {
    const now = state.stage === null ? "Every Stage is signed off." : `It is at ${stageLabel(state.stage)}.`;
    return refuse(`${stageLabel(stage)} of ${mission} is already signed off. ${now} To redo it, reopen it with reopen_stage, only if the author asks.`);
  }
  if (stage > state.stage) {
    return refuse(`${mission} is at ${stageLabel(state.stage)}. Sign off Stage ${state.stage} before Stage ${stage}; Stages can't be skipped.`);
  }
  const covers = await coverageOf(blueprintPath, stage);
  const signedOff = [...state.signedOff, { stage, at: at.toISOString(), ...(note ? { note } : {}), covers }];
  return { signed: true, state: await writeState(blueprintPath, { signedOff, reopened: state.reopened }, { history: false }) };
}

export type ReopenResult = { readonly reopened: true; readonly state: StageState } | { readonly reopened: false; readonly reason: string; readonly state: StageState };

/**
 * Reopens `stage` of the Mission at `blueprintPath`, an earlier Stage that is signed off, and saves
 * the record: its sign-off and every later one are superseded, kept in the history with `note`, and
 * the Mission is at `stage` again. Refused for the Stage the Mission is at and for a Stage it hasn't
 * reached. The caller makes sure two changes to one Mission's record don't run at once.
 */
export async function reopenStage(
  mission: string,
  blueprintPath: string,
  stage: number,
  { note, at = new Date() }: { readonly note: string; readonly at?: Date },
): Promise<ReopenResult> {
  const { state, refusal: outOfRange } = await readForChange(blueprintPath, stage);
  const refuse = (reason: string): ReopenResult => ({ reopened: false, reason: `Refused: ${reason}`, state });
  if (outOfRange) return refuse(outOfRange);
  const why = note.trim();
  if (!why) return refuse("say why the Stage is reopened, in the note.");
  if (state.stage !== null && stage >= state.stage) {
    const where = stage === state.stage ? `${mission} is at ${stageLabel(stage)} already, and it isn't signed off` : `${mission} is at ${stageLabel(state.stage)} and hasn't reached Stage ${stage}`;
    return refuse(`${where}. Only a signed-off Stage can be reopened.`);
  }
  const reopening: Reopening = { stage, at: at.toISOString(), note: why, superseded: state.signedOff.slice(stage - 1) };
  const next = { signedOff: state.signedOff.slice(0, stage - 1), reopened: [...state.reopened, reopening] };
  return { reopened: true, state: await writeState(blueprintPath, next, { history: true }) };
}

/** What to do next at a Mission's Stage, as one line for a tool reply. */
export function nextStepHint({ stage }: Pick<StageState, "stage">): string {
  switch (stage) {
    case 1:
      return "Next (Stage 1): agree the Beats, Objectives and Mechanics with the author and write them with patch_blueprint, then sign_off_stage 1 once the author agrees.";
    case 2:
      return "Next (Stage 2): shape the Zones and Connections (set_zone_polygon, move_zone, patch_blueprint), share them with preview and critique them with check_layout, then sign_off_stage 2 once the author agrees the sketch. Terrain waits for that sign-off.";
    case 3:
      return "Next (Stage 3): choose the tileset, textures, lighting and doodads, place the Anchors and Placements (patch_blueprint, move_anchor), and compile_map for the author to look at in the Editor, then sign_off_stage 3 once the author agrees.";
    case 4:
      return "Next (Stage 4): wire the dialogue and cutscenes, then play the Mission with test_mission (it runs Test Document, or hands it to the author when the Host Adapter can't), then sign_off_stage 4 once the Mission plays as agreed.";
    default:
      return "Next (every Stage signed off): take any change back to the Stage it belongs to with the author; reopen_stage that Stage only if the author asks.";
  }
}
