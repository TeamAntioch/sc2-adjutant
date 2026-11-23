// Pulls and edits a Mission's Screenplay through the Campaign Pack's Screenplay Source. The
// Blueprint's `screenplay.script.source` file is then a pulled copy, refreshed by each pull; edits
// are made at the Source. A Workspace whose Campaign Pack has no Screenplay Source keeps its
// Screenplays as files: the file is the Screenplay, edited in place, and there is nothing to pull.

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { NO_CHARACTERS } from "../mods/characters.js";
import type { ScreenplayRequest, ScreenplaySource } from "../plugins/plugin-api.js";
import type { Workspace } from "../plugins/workspace.js";
import { isInside } from "../util/inside.js";
import { lineMoves, sceneMoves } from "./line-moves.js";
import { nameScript, readMissionScript, type Script, type ScriptLine, scriptLines } from "./name-script.js";
import { type ParsedScript, parseScript } from "./parse-script.js";
import { sceneLineProblems, scenePartProblems } from "./scene-parts.js";

/** A Blueprint and the Workspace it was validated in, as `readMissionBlueprint` returns them. */
export type MissionInWorkspace = { readonly blueprint: MissionBlueprint; readonly workspace: Workspace };

export type PullResult = {
  /** The Screenplay file, absolute. */
  readonly path: string;
  /** The name of the Screenplay Source it was pulled from; undefined when the Workspace has none, and the file was left as it is. */
  readonly sourceName?: string;
};

/** The Blueprint's Screenplay file, and its Source and what to ask the Source for, if the Workspace has one. */
type SourceRequest = { readonly file: string } & (
  | { readonly source: ScreenplaySource; readonly request: ScreenplayRequest }
  | { readonly source?: undefined; readonly request?: undefined }
);

function sourceRequest({ blueprint, workspace }: MissionInWorkspace, blueprintPath: string): SourceRequest {
  const reference = blueprint.screenplay.script;
  if (!reference) throw new Error(`${blueprintPath} has no screenplay.script, so it names no Screenplay file`);
  const file = path.resolve(path.dirname(blueprintPath), reference.source);
  const source = workspace.registry.screenplaySource();
  if (!source) return { file };
  if (!reference.ref) {
    throw new Error(`${blueprintPath} has no screenplay.script.ref: name what the Screenplay Source ${source.name} knows this Screenplay by`);
  }
  return { file, source, request: { missionId: blueprint.id, ref: reference.ref } };
}

export type PullOptions = {
  /**
   * The caller moves the Blueprint's line cues with their lines (refreshScreenplay does), so a cued
   * line under a new sound ID is pulled; otherwise it is refused, as the cue would play another line.
   */
  readonly followLines?: boolean;
};

/**
 * Fetches the Blueprint's Screenplay from the Campaign Pack's Screenplay Source and writes it over
 * `screenplay.script.source`, which must be inside the Workspace. What the Source returns must be
 * a Screenplay in core's format that the Campaign Pack's naming template can name and that has
 * every scene the Blueprint's cues play, or the file is left as it was. A line a cue plays is
 * followed from the copy the pull replaces: one gone, or (unless `followLines`) under another sound
 * ID, is refused. Without a Source, nothing is fetched or written.
 */
export async function pullScreenplay(mission: MissionInWorkspace, blueprintPath: string, options: PullOptions = {}): Promise<PullResult> {
  const { file, source, request } = sourceRequest(mission, blueprintPath);
  if (!source) return { path: file };
  const { workspace, blueprint } = mission;
  if (!(await isInside(workspace.root, file))) {
    throw new Error(`${blueprintPath}'s screenplay.script.source ${blueprint.screenplay.script!.source} is outside the Workspace ${workspace.root}`);
  }
  const markdown = await fetchFromSource(source, request);
  // The copy this pull replaces, to follow the cued lines from; none when it's missing or unreadable.
  const before = await readMissionScript(blueprint, blueprintPath, workspace, NO_CHARACTERS).catch(() => undefined);
  checkScreenplay(markdown, `The Screenplay Source ${source.name}'s ${request.ref}`, mission, before?.script, options.followLines ?? false);

  // Written beside the file and renamed over it, so a failed write never leaves half a Screenplay.
  // A crash between the two leaves the `.partial` file, which .gitignore keeps out of commits.
  const partial = `${file}.${randomUUID()}.partial`;
  try {
    await writeFile(partial, markdown);
    await rename(partial, file);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return { path: file, sourceName: source.name };
}

/**
 * Edits the Blueprint's Screenplay at the Campaign Pack's Screenplay Source, or with `dryRun` shows
 * what the edits would do; returns the Source's report. `edits` is in the Source's own format.
 * Nothing is written in the Workspace; pull afterwards to refresh the file.
 */
export async function editScreenplay(mission: MissionInWorkspace, blueprintPath: string, edits: unknown, dryRun: boolean): Promise<string> {
  const { file, source, request } = sourceRequest(mission, blueprintPath);
  if (!source) throw new Error(`The Workspace's Campaign Pack has no Screenplay Source: edit the Screenplay file ${file} itself`);
  if (!source.edit) throw new Error(`The Screenplay Source ${source.name} can't edit Screenplays: edit ${request.ref} where ${source.name} keeps it, then pull`);
  const report: unknown = await source.edit({ ...request, edits, dryRun });
  if (typeof report !== "string") throw new Error(`The Screenplay Source ${source.name} returned ${typeof report} from its edit, not a report`);
  return report;
}

/**
 * Refuses Markdown that isn't a Screenplay core can read, the Campaign Pack can name, and the
 * Blueprint's cues can play. Its speakers' characters aren't checked: the Screenplay Source is the
 * script's source of truth, so a new speaker is pulled, and the compile, tts and the Workspace
 * check ask the Campaign Mod to declare it.
 */
function checkScreenplay(markdown: string, where: string, { blueprint, workspace }: MissionInWorkspace, before: Script | undefined, followLines: boolean): void {
  const conversationId = blueprint.screenplay.script?.conversationId;
  const { parsed, script } = readScreenplay(markdown, where, (read) => nameScript(read, blueprint.id, workspace.registry, NO_CHARACTERS, conversationId === undefined ? {} : { conversationId }));
  const scenes = new Set(parsed.scenes.map((scene) => scene.number));
  const missing = [...new Set((blueprint.screenplay.script?.cues ?? []).map((cue) => cue.scene).filter((scene) => !scenes.has(scene)))];
  if (missing.length > 0) {
    throw new Error(
      `${where} has no scene ${missing.join(", ")}, which the Blueprint's screenplay.script.cues play; change the cues, or the Screenplay at its Source, then pull`,
    );
  }
  // A cue on part of a scene names a stage direction by its place in the scene: lines moved at the Source go
  // with the part they land in, and a part gone (or left empty) is refused. A stage direction added or cut
  // before it renumbers it, which the cue's `from` must follow.
  const cues = blueprint.screenplay.script?.cues ?? [];
  const problems = scenePartProblems(cues, parsed.scenes).map(({ index, message }) => `screenplay.script.cues.${index}.from ${message}`);
  // A cue on one line names it by its sound ID, as the Campaign Pack names it, and a default sound ID
  // counts the line's place in its scene: a cut or insert before it moves the line to another ID, and
  // another line onto its own. So the cued line is followed from the copy this pull replaces: gone,
  // it's refused; moved, it's refused unless the caller moves the cue with it. Without that copy (a
  // first pull), only a sound ID that's no line of its scene is caught.
  const lineCues = followedLineCues(cues, before, script, followLines);
  problems.push(...lineCues.problems.map(({ index, message }) => `screenplay.script.cues.${index}.line ${message}`));
  const reported = new Set(lineCues.problems.map(({ index }) => index));
  problems.push(
    ...sceneLineProblems(lineCues.cues, script.scenes)
      .filter(({ index }) => !reported.has(index))
      .map(({ index, message }) => `screenplay.script.cues.${index}.line ${message}`),
  );
  if (problems.length > 0) {
    throw new Error(`${where}: ${problems.join("; ")}; change the cues, or the Screenplay at its Source, then pull`);
  }
}

type LineCue = { readonly scene: number; readonly line?: string | undefined };

/**
 * The script cues as they stand after a pull from `before` to `after`, and what's wrong with their
 * lines: a cued line gone, or one under a new sound ID that the caller won't follow (`followLines`
 * false). Followed, a cue takes its line's new sound ID and scene number, as the refresh writes them.
 */
function followedLineCues(
  cues: readonly LineCue[],
  before: Script | undefined,
  after: Script,
  followLines: boolean,
): { readonly cues: readonly LineCue[]; readonly problems: readonly { readonly index: number; readonly message: string }[] } {
  if (!before || !cues.some((cue) => cue.line !== undefined)) return { cues, problems: [] };
  const moves = lineMoves(before, after);
  const newId = new Map([...moves.moved, ...moves.changed].map((move) => [move.from, move.to]));
  const gone = new Set(moves.gone);
  const newScene = new Map(sceneMoves(before, after, moves).moved.map((move) => [move.from, move.to]));
  const old = new Map(scriptLines(before).map((line) => [line.soundId, line]));
  const said = (line: ScriptLine): string => `${line.speaker}'s "${line.text}"`;
  const problems: { index: number; message: string }[] = [];
  const followed = cues.map((cue, index) => {
    const was = cue.line === undefined ? undefined : old.get(cue.line);
    if (cue.line === undefined || !was) return cue;
    if (gone.has(cue.line)) problems.push({ index, message: `${cue.line} was ${said(was)}, which is gone` });
    const to = newId.get(cue.line);
    if (to === undefined || to === cue.line) return cue;
    if (!followLines) problems.push({ index, message: `${cue.line} (${said(was)}) is ${to} now; refresh the Screenplay (refresh-screenplay) to move the cue with it` });
    return { ...cue, scene: newScene.get(cue.scene) ?? cue.scene, line: to };
  });
  return { cues: followed, problems };
}

/** What `source` fetches for `request`, which must be Markdown; its failure says which Source and Screenplay. */
export async function fetchFromSource(source: ScreenplaySource, request: ScreenplayRequest): Promise<string> {
  const label = `The Screenplay Source ${source.name}`;
  let markdown: unknown;
  try {
    markdown = await source.fetch(request);
  } catch (error) {
    throw new Error(`${label} couldn't fetch ${request.ref}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof markdown !== "string") throw new Error(`${label} returned ${typeof markdown} for ${request.ref}, not a Screenplay's Markdown`);
  return markdown;
}

/**
 * `markdown` parsed as a Screenplay and named by `name`; throws, saying `where`, when it isn't one
 * (no title, no scenes) or can't be named. A Mission's pull and a Campaign Mod's Screenplays read
 * theirs this way.
 */
export function readScreenplay(markdown: string, where: string, name: (parsed: ParsedScript) => Script): { readonly parsed: ParsedScript; readonly script: Script } {
  const parsed = parseScript(markdown);
  if (!parsed.title) throw new Error(`${where} isn't a Screenplay: it has no "# Title" heading`);
  if (parsed.scenes.length === 0) throw new Error(`${where} isn't a Screenplay: it has no "## Scene N: TITLE" headings`);
  try {
    return { parsed, script: name(parsed) };
  } catch (error) {
    throw new Error(`${where} can't be named: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
