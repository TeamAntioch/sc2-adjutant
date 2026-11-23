// The Workspace's doodad notes (doodad-notes.ts) against core's catalogs and its Campaign Mod's
// doodads: adding a Doodad Use or a look (a mod doodad's into its doodad index entry), and contributing the game doodads' notes to
// sc2-asset-catalog by pull request (doodad-notes-contribute.ts), never naming the Workspace's
// Missions or story (story-names.ts). The MCP tools and the CLIs call these.

import path from "node:path";

import type { Workspace } from "../plugins/workspace.js";
import type { DoodadNote, DoodadNoteInput } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { type CommandRunner, contributeDoodadNotes, type ContributedNote, type DoodadNotesContribution } from "./doodad-notes-contribute.js";
import { coreDoodadSources } from "./stock-catalog.js";
import { type DoodadUse, formatUse } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";
import { addModOrGameDoodadNote, type ModKnownDoodads } from "./mod-doodad-notes.js";
import { workspaceStoryNames } from "./story-names.js";

const known = (workspace: Workspace): ModKnownDoodads => ({ ...coreDoodadSources(), mod: workspace.catalog });

export type AddedDoodadNote = {
  readonly id: string;
  readonly note?: DoodadNote;
  readonly dropped: readonly string[];
  /** The Campaign Mod's doodad index the note went into, relative to the Workspace's root, for a mod doodad. */
  readonly file?: string;
};

/** Adds a Doodad Use or a look for a game doodad or a terrain object to the Workspace's notes, or for a Campaign Mod doodad to its entry in the mod's doodad index. */
export async function addWorkspaceDoodadNote(workspace: Workspace, input: DoodadNoteInput): Promise<AddedDoodadNote> {
  const { note, dropped, file } = await addModOrGameDoodadNote(workspace.root, input, known(workspace));
  return { id: input.id, ...(note ? { note } : {}), dropped, ...(file !== undefined ? { file: path.relative(workspace.root, file).split(path.sep).join("/") } : {}) };
}

/**
 * Contributes the Workspace's game-doodad notes to sc2-asset-catalog in a pull request, from a branch
 * in the checkout given or a fresh clone, or on a dry run says what it would.
 */
export async function contributeWorkspaceDoodadNotes(
  workspace: Workspace,
  options: { readonly checkout?: string | undefined; readonly dryRun?: boolean | undefined; readonly run?: CommandRunner },
): Promise<DoodadNotesContribution> {
  return contributeDoodadNotes(workspace.root, { ...options, known: known(workspace), storyNames: await workspaceStoryNames(workspace) });
}

const noteLine = ({ uses, look }: { readonly uses?: readonly DoodadUse[] | undefined; readonly look?: string | undefined }): string =>
  [...(uses?.length ? [`uses ${uses.map(formatUse).join("; ")}`] : []), ...(look !== undefined ? [`look “${look}”`] : [])].join(", ");

const droppedLines = (dropped: readonly string[]): string[] => (dropped.length ? [`Dropped from the Workspace, as core already has them: ${dropped.join(", ")}`] : []);

export function formatAddedDoodadNote({ id, note, dropped, file }: AddedDoodadNote): string {
  const line = note ? `${id}: ${noteLine(note)}${file !== undefined ? ` (in the Campaign Mod's doodad index, ${file})` : ""}` : `${id}: core's catalog already has this; the Workspace keeps no note for it`;
  return [line, ...droppedLines(dropped)].join("\n");
}

const plural = (count: number) => `${count} note${count === 1 ? "" : "s"}`;
const contributedLine = (note: ContributedNote) => `  ${note.id}: ${noteLine(note)}`;

export function formatDoodadNotesContribution({ contributed, kept, dropped, branch, pullRequest, notOpened }: DoodadNotesContribution, dryRun = false): string {
  const head = notOpened
    ? `No pull request opened: ${notOpened}`
    : contributed.length === 0
      ? "Nothing to contribute."
      : dryRun
        ? `Would contribute ${plural(contributed.length)}:`
        : `Contributed ${plural(contributed.length)} on ${branch}${pullRequest ? `: ${pullRequest}` : ""}`;
  return [
    head,
    ...contributed.map(contributedLine),
    ...(kept.length ? ["Kept in the Workspace:", ...kept.map(({ id, reason }) => `  ${id}: ${reason}`)] : []),
    ...droppedLines(dropped),
  ].join("\n");
}
