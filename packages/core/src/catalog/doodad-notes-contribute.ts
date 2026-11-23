// Contributing a Workspace's doodad notes (doodad-notes.ts) to the public sc2-asset-catalog
// (ADR-0022): on a branch off main, in a checkout of it or a fresh clone, the game doodads' Doodad
// Uses go into their own files under packages/sc2-asset-catalog/data/doodad-uses/doodads/ (each use
// once whatever its case and spacing) and their look corrections into its doodad-descriptions.json,
// with a changeset; then a pull request is opened on TeamAntioch/sc2-asset-catalog with gh.
//
// What stays in the Workspace: a Campaign Mod doodad's notes; a terrain object's (terrain objects are
// sc2-adjutant's own catalog); a doodad's the repo hasn't described (its CONTRIBUTING takes uses only
// for described doodads); and any note that names one of the Workspace's Missions or its story
// (story-names.ts), which the repo's one rule forbids. So do the contributed ones, laid over the
// package's uses in every search, until a release of the package holds them: each run first drops
// the notes the installed package already has (`withoutHeldNotes`). While an earlier contribution's
// pull request is open, no new one is opened, so its notes don't go twice.
// Without gh or GitHub access the checkout is left as it is, and the notes simply stay.
//
// The data move is `planContribution` over the checkout's files; git and gh run through a
// CommandRunner, so tests fake them.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { type DoodadNote, isGameDoodad, readDoodadNotes, withoutHeldNotes, writeDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { DOODAD_DESCRIPTIONS_FILE, type DoodadDescription, parseDoodadDescriptions } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import { addUses, type DoodadUse, type DoodadUsesByCatalog, doodadUsesFile, formatDoodadUses, formatUse, mergeUses, readDoodadUses } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";
import { coveredByModIndex } from "./mod-doodad-index.js";
import type { ModKnownDoodads } from "./mod-doodad-notes.js";
import { namedIn } from "./story-names.js";

/** Runs a command in a folder and gives its stdout; throws when it fails or can't start. */
export type CommandRunner = (command: string, args: readonly string[], cwd: string) => Promise<string>;

const execFileAsync = promisify(execFile);
export const runCommand: CommandRunner = async (command, args, cwd) => (await execFileAsync(command, [...args], { cwd, encoding: "utf8" })).stdout;

/** The public repository contributions go to. */
export const CATALOG_REPO = "TeamAntioch/sc2-asset-catalog";
/** The library's package in it, and its data folder. */
const PACKAGE_NAME = "@team-antioch/sc2-asset-catalog";
const PACKAGE_DIR = "packages/sc2-asset-catalog";
const DATA_DIR = `${PACKAGE_DIR}/data`;
const DESCRIPTIONS_FILE = `${DATA_DIR}/${DOODAD_DESCRIPTIONS_FILE}`;
const USES_DIR = `${DATA_DIR}/doodad-uses`;

export type ContributedNote = { readonly id: string; readonly uses?: readonly DoodadUse[]; readonly look?: string };
export type KeptNote = { readonly id: string; readonly reason: string };

export type DoodadNotesContribution = {
  /** The notes added to sc2-asset-catalog (on a dry run, the ones that would be): new uses, and a look that differs. */
  readonly contributed: readonly ContributedNote[];
  /** The notes left in the Workspace, and why they don't go. */
  readonly kept: readonly KeptNote[];
  /** The notes dropped from the Workspace because the installed package already holds them (on a dry run, the ones that would be). */
  readonly dropped: readonly string[];
  readonly branch?: string;
  /** The pull request's URL. */
  readonly pullRequest?: string;
  /** Why no pull request was opened, when gh or GitHub wasn't there, or an earlier one is still open. */
  readonly notOpened?: string;
};

export type ContributeOptions = {
  /** A checkout of sc2-asset-catalog to branch in (its root); without one, a fresh clone in a temporary folder, removed afterwards. */
  readonly checkout?: string | undefined;
  /** What the running core knows: the installed package's doodads and uses, core's terrain objects and the Workspace's Campaign Mod's doodads. */
  readonly known: ModKnownDoodads;
  /** The names of the Workspace's Missions and story (workspaceStoryNames), none of which may be sent. */
  readonly storyNames: readonly string[];
  /** Say what would be contributed, from the checkout as it stands (or a fresh clone), and change nothing. */
  readonly dryRun?: boolean | undefined;
  readonly run?: CommandRunner;
  /** For the branch's and the changeset's names. */
  readonly now?: Date;
};

/** What the checkout holds: its descriptions file as it stands, and its Doodad Uses files. */
export type CheckoutCatalog = { readonly descriptions: Readonly<Record<string, DoodadDescription>>; readonly uses: DoodadUsesByCatalog };

/** The checkout's descriptions and uses; throws naming the file that won't read. */
async function readCheckoutCatalog(checkout: string): Promise<CheckoutCatalog> {
  const file = path.join(checkout, DESCRIPTIONS_FILE);
  let descriptions: Record<string, DoodadDescription>;
  try {
    descriptions = parseDoodadDescriptions(await readFile(file, "utf8"), file);
  } catch (error) {
    throw new Error(`Can't read the descriptions ${file}: ${(error as Error).message}`, { cause: error });
  }
  return { descriptions, uses: readDoodadUses(path.join(checkout, USES_DIR)) };
}

/** A contribution's files: each changed uses file and the descriptions file, by its path in the checkout, with its new contents. */
export type ContributionPlan = { readonly files: ReadonlyMap<string, string>; readonly contributed: readonly ContributedNote[]; readonly kept: readonly KeptNote[] };

const UNDESCRIBED = "sc2-asset-catalog has no description of it, and takes Doodad Uses and looks only for described doodads";

/**
 * The checkout's files with the notes added: a note's uses to its uses file, in a new file when it
 * has none (addUses: a new use after the file's own, a variation or scale filled into the same use,
 * case and spacing aside, one the file already says all of left out), and a differing look in place
 * of its description's, the descriptions file written in its own order and layout. A doodad the
 * checkout hasn't described, and a note the checkout already holds, are kept instead.
 */
export function planContribution(notes: Readonly<Record<string, DoodadNote>>, catalog: CheckoutCatalog): ContributionPlan {
  const descriptions: Record<string, DoodadDescription> = { ...catalog.descriptions };
  let lookChanged = false;
  const files = new Map<string, string>();
  const contributed: ContributedNote[] = [];
  const kept: KeptNote[] = [];
  for (const [id, note] of Object.entries(notes)) {
    const description = Object.hasOwn(descriptions, id) ? descriptions[id] : undefined;
    if (!description) {
      kept.push({ id, reason: UNDESCRIBED });
      continue;
    }
    const { uses: next, added: uses } = addUses(catalog.uses.doodad[id] ?? [], mergeUses(note.uses));
    const look = note.look !== undefined && note.look !== description.look ? note.look : undefined;
    if (!uses.length && look === undefined) {
      kept.push({ id, reason: "sc2-asset-catalog already has it" });
      continue;
    }
    if (uses.length) files.set(`${USES_DIR}/${doodadUsesFile("doodad", id)}`, formatDoodadUses(next));
    if (look !== undefined) {
      descriptions[id] = { ...description, look };
      lookChanged = true;
    }
    contributed.push({ id, ...(uses.length ? { uses } : {}), ...(look !== undefined ? { look } : {}) });
  }
  if (lookChanged) files.set(DESCRIPTIONS_FILE, `${JSON.stringify(descriptions, null, 2)}\n`);
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  return { files: new Map([...files].sort(([a], [b]) => a.localeCompare(b))), contributed: contributed.sort(byId), kept: kept.sort(byId) };
}

/** 2026-11-08T15:30:00Z → 20261108-153000. */
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const describeNote = ({ id, uses, look }: ContributedNote): string =>
  [`- \`${id}\``, ...(uses ?? []).map((use) => `  - use: ${formatUse(use)}`), ...(look !== undefined ? [`  - look: ${look}`] : [])].join("\n");

/** Every word of a note that would be sent: its uses, their sources and its look. */
const noteText = (note: { readonly uses?: readonly DoodadUse[] | undefined; readonly look?: string | undefined }): string => [...(note.uses ?? []).flatMap(({ use, from }) => [use, from ?? ""]), note.look ?? ""].join("\n");

/** A contribution's branch, by when it was made. */
const branchName = (now: Date) => `doodad-uses/${stamp(now)}`;

/** What the pull request sends: its title, body, commit message, branch and changeset. */
function pullRequestText(contributed: readonly ContributedNote[], now: Date) {
  const count = `${contributed.length} doodad${contributed.length === 1 ? "" : "s"}`;
  const title = `Add Doodad Uses for ${count}`;
  const looks = contributed.filter((note) => note.look !== undefined).length;
  const what = looks === 0 ? "Doodad Uses" : `Doodad Uses and ${looks === 1 ? "a look correction" : "look corrections"}`;
  const ids = contributed.map(({ id }) => id).join(", ");
  return {
    title,
    body: [`${what} for ${count}, each accepted in a doodad search, contributed with sc2-adjutant's \`contribute_doodad_notes\`. They are in general words, as CONTRIBUTING asks.`, "", ...contributed.map(describeNote)].join("\n"),
    commit: `${title}\n\n${ids}, accepted in doodad searches.`,
    branch: branchName(now),
    changeset: { file: `.changeset/doodad-uses-${stamp(now)}.md`, text: `---\n"${PACKAGE_NAME}": patch\n---\n\n${title}: ${ids}.\n` },
  };
}

/** Throws when anything to be sent names one of the Workspace's Missions or its story: a last check, after the notes that do were kept back. */
function refuseStoryNames(texts: readonly string[], storyNames: readonly string[]): void {
  const named = [...new Set(texts.flatMap((text) => namedIn(text, storyNames)))];
  if (named.length) throw new Error(`Refusing to send the pull request: it would name ${named.join(", ")}, of the Workspace's Missions or story`);
}

const isCatalogCheckout = async (checkout: string): Promise<boolean> =>
  existsSync(path.join(checkout, DESCRIPTIONS_FILE)) &&
  (await readFile(path.join(checkout, PACKAGE_DIR, "package.json"), "utf8").then((text) => (JSON.parse(text) as { name?: string }).name === PACKAGE_NAME, () => false));

/** An origin URL of the repository, by HTTPS or SSH. */
const isCatalogOrigin = (url: string): boolean => new RegExp(`(^|[/:])${CATALOG_REPO.replace("/", "\\/")}(\\.git)?/?$`, "i").test(url.trim());

/**
 * Moves the Workspace's game-doodad notes into sc2-asset-catalog on a new branch off main and opens
 * a pull request for them (see the top of this file). Throws for a folder that isn't a checkout of
 * sc2-asset-catalog, one whose origin is another repository, or one with uncommitted changes.
 */
export async function contributeDoodadNotes(workspaceRoot: string, options: ContributeOptions): Promise<DoodadNotesContribution> {
  const { checkout, known, storyNames, dryRun = false, run = runCommand, now = new Date() } = options;
  if (checkout !== undefined && !(await isCatalogCheckout(checkout))) {
    throw new Error(`${checkout} isn't a checkout of sc2-asset-catalog: it has no ${PACKAGE_DIR} with the catalog's ${DOODAD_DESCRIPTIONS_FILE}`);
  }

  // Dropped on every run but a dry one, whether or not a pull request opens: the package already has them.
  const { notes, dropped } = withoutHeldNotes(await readDoodadNotes(workspaceRoot), known);
  if (!dryRun && dropped.length) await writeDoodadNotes(workspaceRoot, notes);

  const candidates: Record<string, DoodadNote> = {};
  const kept: KeptNote[] = [];
  for (const [id, note] of Object.entries(notes)) {
    const named = namedIn(noteText(note), storyNames);
    if (!isGameDoodad(id, known) || coveredByModIndex(known.mod, id)) kept.push({ id, reason: "a Campaign Mod doodad's notes stay in the Workspace" });
    else if (!Object.hasOwn(known.doodads, id)) kept.push({ id, reason: "a terrain object's notes stay in the Workspace: terrain objects are sc2-adjutant's own catalog" });
    else if (named.length) kept.push({ id, reason: `it names ${named.join(" and ")}, of the Workspace's Missions or story: reword it in doodad-notes.json in general words` });
    else candidates[id] = note;
  }
  const result = (plan: { contributed?: readonly ContributedNote[]; kept?: readonly KeptNote[] }, rest: Partial<DoodadNotesContribution> = {}): DoodadNotesContribution => ({
    contributed: plan.contributed ?? [],
    kept: [...kept, ...(plan.kept ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    dropped,
    ...rest,
  });
  if (Object.keys(candidates).length === 0) return result({});

  const unopened = Object.keys(candidates).map((id) => ({ id, reason: "not contributed: no pull request was opened" }));
  const notOpened = (why: string) => result({ kept: unopened }, { notOpened: `${why.trim()}; the notes stay in the Workspace` });
  /** A fresh clone, in a temporary folder of its own; throws, leaving no folder, when it can't clone. */
  const clone = async (): Promise<string> => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-asset-catalog-"));
    try {
      await run("gh", ["repo", "clone", CATALOG_REPO, folder], tmpdir());
      return folder;
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  };

  if (dryRun) {
    if (checkout !== undefined) return result(planContribution(candidates, await readCheckoutCatalog(checkout)));
    let folder: string;
    try {
      folder = await clone();
    } catch (error) {
      return notOpened((error as Error).message);
    }
    try {
      return result(planContribution(candidates, await readCheckoutCatalog(folder)));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  try {
    await run("gh", ["auth", "status"], checkout ?? tmpdir());
    // The author's own: another contributor's open pull request holds other notes.
    const open = JSON.parse(await run("gh", ["pr", "list", "--repo", CATALOG_REPO, "--state", "open", "--author", "@me", "--json", "headRefName,url"], checkout ?? tmpdir())) as {
      headRefName: string;
      url: string;
    }[];
    const earlier = open.filter(({ headRefName }) => headRefName.startsWith("doodad-uses/"));
    if (earlier.length) return notOpened(`an earlier contribution's pull request is still open, ${earlier.map(({ url }) => url).join(", ")}: once it merges, contribute again`);
  } catch (error) {
    return notOpened((error as Error).message);
  }
  const branch = branchName(now);
  return checkout !== undefined ? fromCheckout(checkout) : fromClone();

  /** The pull request's words, refused (by throwing) when they would name the story. */
  function pullRequestFor(plan: ContributionPlan) {
    const text = pullRequestText(plan.contributed, now);
    refuseStoryNames([text.title, text.body, text.commit, text.branch, text.changeset.text, ...plan.contributed.map(noteText)], storyNames);
    return text;
  }

  /** Writes the plan's files and the changeset, commits, pushes (then calls `pushed`) and opens the pull request; gives its URL. */
  async function send(folder: string, plan: ContributionPlan, { title, body, commit, changeset }: ReturnType<typeof pullRequestText>, pushed: () => void): Promise<string | undefined> {
    const files = new Map<string, string>([...plan.files, [changeset.file, changeset.text] as const].sort(([a], [b]) => a.localeCompare(b)));
    for (const [file, text] of files) {
      await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
      await writeFile(path.join(folder, file), text);
    }
    await run("git", ["add", ...files.keys()], folder);
    await run("git", ["commit", "-m", commit], folder);
    await run("git", ["push", "-u", "origin", branch], folder);
    pushed();
    const created = await run("gh", ["pr", "create", "--repo", CATALOG_REPO, "--base", "main", "--head", branch, "--title", title, "--body", body], folder);
    return created.match(/https:\/\/\S+/g)?.at(-1);
  }

  async function fromClone(): Promise<DoodadNotesContribution> {
    let folder: string;
    try {
      folder = await clone();
    } catch (error) {
      return notOpened((error as Error).message);
    }
    try {
      await run("git", ["switch", "-c", branch, "origin/main"], folder);
      const plan = planContribution(candidates, await readCheckoutCatalog(folder));
      if (plan.contributed.length === 0) return result(plan);
      const text = pullRequestFor(plan);
      let pushed = false;
      let pullRequest: string | undefined;
      try {
        pullRequest = await send(folder, plan, text, () => (pushed = true));
      } catch (error) {
        if (!pushed) throw error;
        throw new Error(`${(error as Error).message.trim()}\n${branch} is pushed to ${CATALOG_REPO}, so a pull request can still be opened from it (or the branch deleted); the Workspace keeps the notes.`, { cause: error });
      }
      return result(plan, { branch, ...(pullRequest ? { pullRequest } : {}) });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  async function fromCheckout(checkout: string): Promise<DoodadNotesContribution> {
    const origin = (await run("git", ["remote", "get-url", "origin"], checkout)).trim();
    if (!isCatalogOrigin(origin)) throw new Error(`The checkout ${checkout} can't open the pull request: its origin is ${origin}, not ${CATALOG_REPO}`);
    if ((await run("git", ["status", "--porcelain"], checkout)).trim()) throw new Error(`The checkout ${checkout} has uncommitted changes; commit or set them aside first`);
    // The checkout's branch (a detached HEAD by its commit), to go back to.
    let original = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], checkout)).trim();
    if (original === "HEAD") original = (await run("git", ["rev-parse", "HEAD"], checkout)).trim();
    const backArgs = ["switch", ...(/^[0-9a-f]{40}$/.test(original) ? ["--detach"] : []), original];
    const back = () => run("git", backArgs, checkout);
    const goBack = `Run \`git ${backArgs.join(" ")}\` there to go back.`;
    try {
      await run("git", ["fetch", "origin", "main"], checkout);
    } catch (error) {
      return notOpened((error as Error).message);
    }
    await run("git", ["switch", "-c", branch, "origin/main"], checkout);
    const dropBranch = async () => {
      await back();
      await run("git", ["branch", "-D", branch], checkout);
    };

    let plan: ContributionPlan;
    let text: ReturnType<typeof pullRequestText> | undefined;
    try {
      plan = planContribution(candidates, await readCheckoutCatalog(checkout));
      if (plan.contributed.length) text = pullRequestFor(plan);
    } catch (error) {
      // Nothing is written yet: the branch goes, and the checkout is as it was.
      await dropBranch();
      throw error;
    }
    if (!text) {
      await dropBranch();
      return result(plan);
    }
    let pullRequest: string | undefined;
    let pushed = false;
    try {
      pullRequest = await send(checkout, plan, text, () => (pushed = true));
    } catch (error) {
      const remote = pushed ? " It is pushed to origin, so a pull request can still be opened from it (or the remote branch deleted)." : "";
      throw new Error(`${(error as Error).message.trim()}\nThe checkout ${checkout} is left on ${branch} with the notes written; the Workspace keeps them.${remote} ${goBack}`, { cause: error });
    }
    try {
      await back();
    } catch (error) {
      throw new Error(`Opened ${pullRequest ?? "the pull request"}, but the checkout ${checkout} is left on ${branch}: ${(error as Error).message.trim()}. ${goBack}`, { cause: error });
    }
    return result(plan, { branch, ...(pullRequest ? { pullRequest } : {}) });
  }
}
