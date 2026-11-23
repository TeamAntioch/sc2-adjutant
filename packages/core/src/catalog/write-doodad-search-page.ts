// Writes a Doodad Search's page (doodad-search-page.ts) into its folder: search.json, when the
// agent gives it, and index.html built from it. A Mission's search goes in the Mission's
// git-ignored output folder, `missions/<id>/output/doodad-search/<slug>/`; one for no Mission in the
// research archive, `$SC2_RESEARCH_DIR/doodad-search/<slug>/`. The page reports the candidates whose
// renders are here but whose sheet isn't, and builds just those sheets when asked (catalog-sheets.ts),
// so the author sees each from four sides. The MCP tool and the CLI call it.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { researchArchiveDirIfSet } from "../capture/research-archive.js";
import { missionBlueprintPath, type Workspace } from "../plugins/workspace.js";
import { type BuildSheetsOptions, buildSheets } from "@team-antioch/sc2-asset-catalog/catalog/catalog-sheets.js";
import { readDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { buildDoodadSearchPage, DOODAD_SEARCH_FILE, DOODAD_SEARCH_PAGE, type DoodadSearchFile, parseDoodadSearch, searchedIds, type VariationPicture } from "./doodad-search-page.js";
import { type DoodadSearchSources, lookUpDoodads, type MissingSheet, missingSheets } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { coreDoodadSources } from "./stock-catalog.js";
import { thumbnailFileName, variationSheetFileName } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { missionDependencies, withCampaignMod } from "./workspace-doodad-search.js";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A search's default folder: in its Mission's output folder, else in the research archive ($SC2_RESEARCH_DIR). */
export function doodadSearchFolder(slug: string, where: { readonly missionDir?: string | undefined; readonly env?: NodeJS.ProcessEnv }): string {
  if (!SLUG.test(slug)) throw new Error(`A Doodad Search's slug is lower-case letters, digits and hyphens, such as press-rig, not ${JSON.stringify(slug)}`);
  if (where.missionDir) return path.join(where.missionDir, "output/doodad-search", slug);
  const archive = researchArchiveDirIfSet(where.env);
  if (!archive) throw new Error("A Doodad Search for no Mission goes in the research archive, and SC2_RESEARCH_DIR isn't set: give the search a Mission, or set SC2_RESEARCH_DIR to your archive's folder");
  return path.join(archive, "doodad-search", slug);
}

export type WriteDoodadSearchPageOptions = {
  /** search.json's contents, to check and write first; without it the folder's search.json is read. */
  readonly search?: unknown;
  /** Build the candidates' missing sheets before the page. */
  readonly buildSheets?: boolean;
  /** The Mission the folder is for: a search.json for another (or none) is refused. */
  readonly mission?: string | undefined;
  /** The map dependencies of the Mission search.json names, to mark the doodads they bring in. */
  readonly dependenciesOf?: (mission: string) => Promise<readonly string[]>;
  /** What builds one sheet; ImageMagick's montage by default. */
  readonly build?: BuildSheetsOptions["build"];
};

export type DoodadSearchPageWritten = {
  readonly folder: string;
  readonly search: string;
  readonly page: string;
  /** Sheets the candidates still lack though their renders are here. */
  readonly missingSheets: readonly MissingSheet[];
  readonly builtSheets: readonly string[];
};

async function readSearch(file: string): Promise<DoodadSearchFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") 
      throw new Error(`No ${DOODAD_SEARCH_FILE} in ${path.dirname(file)}: give the search to write it (a Mission's search is in its output folder, so give its Mission too)`, { cause: error });
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Can't read the doodad search ${file}: ${(error as Error).message}`, { cause: error });
  }
  return parseDoodadSearch(raw, file);
}

/** Writes search.json (when given) and index.html in `folder`, building the candidates' missing sheets first when asked. */
export async function writeDoodadSearchPage(folder: string, sources: DoodadSearchSources, options: WriteDoodadSearchPageOptions = {}): Promise<DoodadSearchPageWritten> {
  const searchFile = path.join(folder, DOODAD_SEARCH_FILE);
  const search = options.search !== undefined ? parseDoodadSearch(options.search, searchFile) : await readSearch(searchFile);
  if (options.mission !== undefined && search.mission !== options.mission)
    throw new Error(`${searchFile} is a search for ${search.mission ? `the Mission ${search.mission}` : "no Mission"}, not ${options.mission}`);
  // A shortlist has no notes from pictures, so it never reaches the author's page (ADR-0020).
  const unjudged = search.parts.filter((part) => part.shortlist?.length).map((part) => JSON.stringify(part.name));
  if (unjudged.length)
    throw new Error(
      `${searchFile} has an unjudged shortlist in Search Part${unjudged.length === 1 ? "" : "s"} ${unjudged.join(", ")}: judge each shortlisted id from its picture into a candidate or alsoConsidered, empty the shortlist, then build the page`,
    );
  // Its Mission is checked before search.json is written, so a search refused leaves the folder's as it was.
  const dependencies = search.mission && options.dependenciesOf ? await options.dependenciesOf(search.mission) : undefined;
  if (options.search !== undefined) {
    await mkdir(folder, { recursive: true });
    await writeFile(searchFile, `${JSON.stringify(search, null, 2)}\n`);
  }

  const cards = search.parts.flatMap((part) => part.candidates.map((candidate) => candidate.id));
  let missing = missingSheets(cards, sources);
  let builtSheets: string[] = [];
  if (options.buildSheets && missing.length > 0) {
    builtSheets = await buildSheets(missing, options.build ? { build: options.build } : {});
    missing = missingSheets(cards, sources);
  }

  const page = path.join(folder, DOODAD_SEARCH_PAGE);
  await writeFile(page, buildDoodadSearchPage(search, lookUpDoodads(searchedIds(search), sources, dependencies), searchRenders(folder)));
  return { folder, search: searchFile, page, missingSheets: missing, builtSheets };
}

/** The folder in a search's folder that its own renders go in (npm run thumbnails -- --out <folder>/renders). */
export const SEARCH_RENDERS = "renders";

/** A variation's picture among the search's own renders: its sheet (thumbnails --sheets), else its first angle. */
const searchRenders =
  (folder: string): VariationPicture =>
  (id, variation) =>
    [variationSheetFileName(id, variation), thumbnailFileName(id, variation, 0)].map((file) => path.join(folder, SEARCH_RENDERS, file)).find((file) => existsSync(file));

export type SheetsFor = {
  /** Sheets built now, each with the ids it pictures (terrain objects of one model share one). */
  readonly built: readonly { readonly ids: readonly string[]; readonly sheet: string }[];
  /** Sheets this machine had already. */
  readonly here: readonly { readonly ids: readonly string[]; readonly sheet: string }[];
  readonly unbuildable: readonly { readonly id: string; readonly reason: string }[];
};

/**
 * Builds the turntable sheets of the doodads and terrain objects named, by id, with no search.json:
 * for a shortlist of any length, before its candidates are judged. Says which sheets were here
 * already and why the rest can't be built.
 */
export async function buildSheetsFor(ids: Iterable<string>, sources: DoodadSearchSources, options: Pick<BuildSheetsOptions, "build"> = {}): Promise<SheetsFor> {
  const wanted = [...new Set(ids)];
  const found = lookUpDoodads(wanted, sources);
  const missing = missingSheets(wanted, sources);
  const builtFiles = new Set(await buildSheets(missing, options.build ? { build: options.build } : {}));
  const built = missing.filter((sheet) => builtFiles.has(sheet.sheet)).map(({ ids: pictured, sheet }) => ({ ids: pictured, sheet }));
  const buildable = new Set(missing.flatMap((sheet) => sheet.ids));
  const here = new Map<string, string[]>();
  const unbuildable: { id: string; reason: string }[] = [];
  for (const id of wanted) {
    if (buildable.has(id)) continue;
    const result = found.get(id);
    if (result?.picture.kind === "sheet") here.set(result.picture.path, [...(here.get(result.picture.path) ?? []), id]);
    else if (!result) unbuildable.push({ id, reason: "no catalog has it" });
    else if (result.source === "mod") unbuildable.push({ id, reason: "a Campaign Mod doodad has no catalog renders: render it into the search's renders folder" });
    else unbuildable.push({ id, reason: "its four renders aren't on this machine (npm run thumbnails)" });
  }
  return { built, here: [...here].map(([sheet, pictured]) => ({ ids: pictured, sheet })), unbuildable };
}

/** What buildSheetsFor built and why the rest weren't, for the tool's text and the CLI. */
export function formatSheetsFor({ built, here, unbuildable }: SheetsFor): string {
  const line = (sheets: SheetsFor["built"]) => sheets.map(({ ids, sheet }) => `  ${ids.join(", ")}: ${sheet}`);
  return [
    ...(built.length ? [`Built ${built.length} sheet${built.length === 1 ? "" : "s"}:`, ...line(built)] : []),
    ...(here.length ? [`Already here:`, ...line(here)] : []),
    ...(unbuildable.length ? [`Not built:`, ...unbuildable.map(({ id, reason }) => `  ${id}: ${reason}`)] : []),
  ].join("\n") || "No ids given.";
}

export type WorkspaceDoodadSearchPage = {
  /** search.json's contents, to check and write first; without it the folder's search.json is read. */
  readonly search?: unknown;
  /** Build the candidates' missing sheets before the page. */
  readonly buildSheets?: boolean | undefined;
  /** The search's folder name; with `mission`, or search.json's, it picks the default folder. */
  readonly slug?: string | undefined;
  /** The Mission it's for, by folder name, when search.json doesn't say. */
  readonly mission?: string | undefined;
  /** A folder of its own, instead of the default. */
  readonly folder?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
};

/**
 * Writes a Doodad Search's page with core's catalogs and, in a Workspace, its Campaign Mod's
 * doodads and Doodad Uses, marking the doodads its Mission's dependencies bring in. Without a
 * Workspace there is no Mission, and the default folder is the research archive's.
 */
export async function writeWorkspaceDoodadSearchPage(workspace: Workspace | undefined, request: WorkspaceDoodadSearchPage): Promise<DoodadSearchPageWritten> {
  const { slug, folder, env, ...options } = request;
  let search = options.search;
  const named = search && typeof search === "object" && "mission" in search ? (search as { mission?: unknown }).mission : undefined;
  if (request.mission !== undefined && named !== undefined && named !== request.mission) throw new Error(`The search is for the Mission ${String(named)}, not ${request.mission}`);
  const mission = request.mission ?? (typeof named === "string" ? named : undefined);
  if (mission !== undefined && !workspace) throw new Error(`A search for the Mission ${mission} needs its Workspace`);
  // The Mission given goes into the search.json written.
  if (search && typeof search === "object" && request.mission !== undefined) search = { ...search, mission: request.mission };

  let at = folder;
  if (at === undefined) {
    if (slug === undefined) throw new Error("Give the search's slug, or its folder");
    at = doodadSearchFolder(slug, { missionDir: mission !== undefined ? path.dirname(await missionBlueprintPath(workspace!, mission)) : undefined, ...(env ? { env } : {}) });
  }
  return writeDoodadSearchPage(at, await workspaceSources(workspace), {
    ...(search !== undefined ? { search } : {}),
    ...(options.buildSheets ? { buildSheets: true } : {}),
    ...(request.mission !== undefined ? { mission: request.mission } : {}),
    ...(workspace ? { dependenciesOf: (name: string) => missionDependencies(workspace, name) } : {}),
  });
}

/** Core's catalogs with, in a Workspace, its Campaign Mod's doodads and Doodad Uses. */
async function workspaceSources(workspace: Workspace | undefined): Promise<DoodadSearchSources> {
  return workspace ? withCampaignMod(coreDoodadSources(), workspace.catalog, await readDoodadNotes(workspace.root)) : coreDoodadSources();
}

/** buildSheetsFor over core's catalogs and, in a Workspace, its Campaign Mod's doodads. */
export async function buildWorkspaceSheetsFor(workspace: Workspace | undefined, ids: Iterable<string>): Promise<SheetsFor> {
  return buildSheetsFor(ids, await workspaceSources(workspace));
}

/** What was written and which sheets are missing or built, for the tool's text and the CLI. */
export function formatDoodadSearchPage({ page, search, missingSheets: missing, builtSheets }: DoodadSearchPageWritten): string {
  const lines = [`Wrote ${page} from ${search}.`, `Open it: open ${JSON.stringify(page)}`];
  if (builtSheets.length) lines.push(`Built ${builtSheets.length} sheet${builtSheets.length === 1 ? "" : "s"}: ${builtSheets.join(", ")}`);
  if (missing.length)
    lines.push(
      `${missing.length} candidate sheet${missing.length === 1 ? "" : "s"} could be built from the renders here, so the author sees them from four sides: ${missing.map((sheet) => sheet.ids.join(", ")).join("; ")}. Offer to build them (buildSheets: true, or --build-sheets), then judge them again from their sheets.`,
    );
  return lines.join("\n");
}
