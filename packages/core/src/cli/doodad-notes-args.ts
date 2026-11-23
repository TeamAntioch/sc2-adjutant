// The add-doodad-note and contribute-doodad-notes CLIs' arguments (add-doodad-note.ts,
// contribute-doodad-notes.ts), with --help and -h. A bad argument throws, naming it.

import { helpAsked, optionValue } from "./help-asked.js";

export const ADD_DOODAD_NOTE_USAGE =
  'Usage: add-doodad-note <doodad id> [--use "<Doodad Use>" [--variation <n>] [--scale <x>] [--from "<search or source, date>"]] [--look "<look>"] [--json] [--help]';

export const CONTRIBUTE_DOODAD_NOTES_USAGE = "Usage: contribute-doodad-notes [--checkout <sc2-asset-catalog checkout>] [--dry-run] [--json] [--help]";

export type Help = { readonly help: true };

const ADD_VALUED = new Set(["--use", "--variation", "--scale", "--from", "--look"]);
const CONTRIBUTE_VALUED = new Set(["--checkout"]);

export type AddDoodadNoteArgs = {
  readonly id: string;
  readonly use?: string;
  /** The use's variation, by the Editor's number: 01 and 1 are both 1. */
  readonly variation?: number;
  readonly scale?: number;
  readonly from?: string;
  readonly look?: string;
  readonly json: boolean;
};

const variationOf = (text: string): number => {
  if (!/^\d+$/.test(text.trim())) throw new Error(`--variation needs a whole number from 0, such as 1 or 01; got ${text}`);
  return Number(text);
};

const scaleOf = (text: string): number => {
  const scale = Number(text);
  if (!text.trim() || !Number.isFinite(scale) || scale <= 0) throw new Error(`--scale needs a number above 0, such as 3 or 0.6; got ${text}`);
  return scale;
};

export function parseAddDoodadNoteArgs(args: readonly string[]): AddDoodadNoteArgs | Help {
  if (helpAsked(args, ADD_VALUED)) return { help: true };
  const options = new Map<string, string>();
  const ids: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (ADD_VALUED.has(arg)) options.set(arg, optionValue(args, i++, arg));
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else ids.push(arg);
  }
  if (ids.length !== 1) throw new Error("Name one doodad id");
  if (!options.has("--use") && !options.has("--look")) throw new Error("Give a --use, a --look or both");
  if (!options.has("--use") && ["--variation", "--scale", "--from"].some((option) => options.has(option))) throw new Error("--variation, --scale and --from go with a --use");
  const value = (option: string) => options.get(option);
  return {
    id: ids[0]!,
    ...(options.has("--use") ? { use: value("--use")! } : {}),
    ...(options.has("--variation") ? { variation: variationOf(value("--variation")!) } : {}),
    ...(options.has("--scale") ? { scale: scaleOf(value("--scale")!) } : {}),
    ...(options.has("--from") ? { from: value("--from")! } : {}),
    ...(options.has("--look") ? { look: value("--look")! } : {}),
    json,
  };
}

/** Without a checkout, a fresh clone of sc2-asset-catalog. */
export type ContributeDoodadNotesArgs = { readonly checkout?: string; readonly dryRun: boolean; readonly json: boolean };

export function parseContributeDoodadNotesArgs(args: readonly string[]): ContributeDoodadNotesArgs | Help {
  if (helpAsked(args, CONTRIBUTE_VALUED)) return { help: true };
  let checkout: string | undefined;
  let dryRun = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--checkout") checkout = optionValue(args, i++, arg);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return { ...(checkout !== undefined ? { checkout } : {}), dryRun, json };
}
