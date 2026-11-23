// sc2-adjutant's own sets (#802, #856), laid over the published Set Finder's
// (@team-antioch/sc2-set-finder). The published sets are the public ones, Blizzard's alone (core's
// capture/export-sets.ts, publicSets). The rest of the described sets are laid over them:
//
// - the Workspace's own: its cinematic-sets folder holds the looks (looks.json) and the catalog
//   (catalog.json, catalog-sets --private) of the sets a file of its Campaign's holds. A card names
//   such a set's sources by the labels the Workspace's Plugins give their cutscene sources;
// - core's public sets that a release doesn't carry yet: core's data/cinematic-sets has Blizzard's
//   sets alone, and the looks of those described so far.
//
// The machine's cache folder has their drawings (render-set-views' set-views/<id>/, with set.json
// and the card pictures). This makes them the package's layers, each set in the catalog's look shape
// with its pictures in that folder, which the page serves.
//
// A set the published package has keeps its published card: no copy here is laid over it, not even
// one that has since become private (a non-Blizzard file found to use it), so the page shows what
// the release carries. A machine with no cache folder set has the published sets alone.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { hostContext, loadMachineConfig } from "@team-antioch/sc2-adjutant/dist/host/machine-config.js";
import { loadWorkspace, WORKSPACE_FILE } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";
import { cutsceneSourceKinds } from "@team-antioch/sc2-adjutant/dist/cutscene/source-kinds.js";
import { catalogLook, publicSets } from "@team-antioch/sc2-adjutant/dist/capture/export-sets.js";
import type { RenderedSet } from "@team-antioch/sc2-adjutant/dist/capture/set-views.js";
import type { CinematicSet } from "@team-antioch/sc2-adjutant/dist/cutscene/set-catalog.js";
import { parseSetLooks, type SetLook as OwnLook } from "@team-antioch/sc2-adjutant/dist/cutscene/set-looks.js";

import { readSetLooks, type SetLook } from "@team-antioch/sc2-asset-catalog/catalog/set-looks.js";
import { PUBLISHED_SOURCE, type SetCard, setCards, type SetLayer } from "@team-antioch/sc2-set-finder";

/** Core's cinematic sets data: looks.json and catalog.json, Blizzard's sets alone. */
const coreSetsDir = (): string => path.join(path.dirname(createRequire(import.meta.url).resolve("@team-antioch/sc2-adjutant/package.json")), "data/cinematic-sets");

/** A Workspace's own sets: looks.json and catalog.json, in the same shapes as core's. */
export const WORKSPACE_SETS_FOLDER = "cinematic-sets";

/** Where render-set-views draws: the cache folder's set-views. */
export const defaultViewsDir = async (): Promise<string> => path.join(hostContext(await loadMachineConfig()).requirePath("cacheDir"), "set-views");

/** Each cutscene source kind's name, by its id, as the Workspace's Plugins label it. */
export type SourceNames = Readonly<Record<string, string>>;

/**
 * The names the Workspace's Plugins give their cutscene sources: none without a Workspace config at
 * `workspaceRoot`, and none, said on stderr, when the Workspace doesn't load.
 */
export async function workspaceSourceNames(workspaceRoot: string | undefined): Promise<SourceNames> {
  if (!workspaceRoot || !existsSync(path.join(workspaceRoot, WORKSPACE_FILE))) return {};
  try {
    const kinds = cutsceneSourceKinds((await loadWorkspace(workspaceRoot)).registry);
    return Object.fromEntries([...kinds.values()].map((kind) => [kind.id, kind.label]));
  } catch (error) {
    console.error(`Set Finder: sources named by their ids, since the Workspace at ${workspaceRoot} didn't load: ${(error as Error).message}`);
    return {};
  }
}

/** A source kind as a card names it: Blizzard's as the published sets do, another by its label, else its id. */
export const originName = (origin: string, names: SourceNames = {}): string => (origin === "blizzard" ? PUBLISHED_SOURCE : (names[origin] ?? origin));

export type OwnSetsOptions = {
  /** render-set-views' folder; the machine's cache folder's set-views by default. */
  readonly viewsDir?: string;
  /** Core's looks.json by default. */
  readonly looksFile?: string;
  /** Core's catalog.json by default: the files each set was found in, which say whose it is. */
  readonly catalogFile?: string;
  /** The Workspace whose own sets (its cinematic-sets folder) are laid over too; none without one, or where it has no such folder. */
  readonly workspaceRoot?: string | undefined;
  /** The published sets, by id: the package's by default. */
  readonly published?: ReadonlyMap<string, SetLook>;
  /** Each source's name on a card, by its id: the Workspace's Plugins' labels by default. */
  readonly sourceNames?: SourceNames;
};

export type OwnSets = {
  /** The layers to lay over the published sets: the private sets by source, then the public sets not yet published. */
  readonly layers: readonly SetLayer[];
  /** Undefined when no views folder was given and this machine has no cache folder set. */
  readonly viewsDir: string | undefined;
  /** Core's looks and the Workspace's, by id: what each drawn picture in the views folder shows. */
  readonly looks: Readonly<Record<string, OwnLook>>;
  /** The published sets they are laid over. */
  readonly published: ReadonlyMap<string, SetLook>;
};

/**
 * The described sets this machine has drawn that the published package doesn't carry, as layers
 * with their pictures in `viewsDir`. A set not drawn (no set.json) has no card, as before.
 */
export async function ownSets(options: OwnSetsOptions = {}): Promise<OwnSets> {
  const published = options.published ?? readSetLooks();
  const core = { looks: options.looksFile ?? path.join(coreSetsDir(), "looks.json"), catalog: options.catalogFile ?? path.join(coreSetsDir(), "catalog.json") };
  const workspace = options.workspaceRoot ? path.join(options.workspaceRoot, WORKSPACE_SETS_FOLDER) : undefined;
  const workspaceFiles = workspace && existsSync(path.join(workspace, "looks.json")) ? { looks: path.join(workspace, "looks.json"), catalog: path.join(workspace, "catalog.json") } : undefined;
  const readLooks = async (file: string): Promise<Record<string, OwnLook>> => parseSetLooks(JSON.parse(await readFile(file, "utf8")));
  const coreLooks = await readLooks(core.looks);
  const workspaceLooks = workspaceFiles ? await readLooks(workspaceFiles.looks) : {};
  for (const id of Object.keys(workspaceLooks)) if (coreLooks[id]) console.error(`Set Finder: ${id} is in core's sets and the Workspace's; the Workspace's is used`);
  const looks = { ...coreLooks, ...workspaceLooks };
  let viewsDir = options.viewsDir;
  if (viewsDir === undefined) {
    try {
      viewsDir = await defaultViewsDir();
    } catch (error) {
      console.error(`Set Finder: the published sets alone, none of this machine's: ${(error as Error).message}`);
      return { layers: [], viewsDir: undefined, looks, published };
    }
  }
  const dir = viewsDir;
  const names = options.sourceNames ?? (await workspaceSourceNames(options.workspaceRoot));
  const readCatalog = async (file: string): Promise<CinematicSet[]> => (JSON.parse(await readFile(file, "utf8")) as { sets: CinematicSet[] }).sets;
  const workspaceCatalog = workspaceFiles ? await readCatalog(workspaceFiles.catalog) : [];
  const workspaceIds = new Set(workspaceCatalog.map((set) => set.id));
  const catalog = [...(await readCatalog(core.catalog)).filter((set) => !workspaceIds.has(set.id)), ...workspaceCatalog];
  const records = new Map<string, RenderedSet>();
  for (const id of existsSync(dir) ? await readdir(dir) : []) {
    const file = path.join(dir, id, "set.json");
    if (looks[id] && existsSync(file)) records.set(id, JSON.parse(await readFile(file, "utf8")) as RenderedSet);
  }
  const has = (id: string, file: string): boolean => existsSync(path.join(dir, id, file));

  const { sets: publicOnes, leftOut } = publicSets(looks, catalog, records, has);
  const byId = new Map(catalog.map((set) => [set.id, set]));
  // The private sets, a layer per source, since a layer's cards all name one.
  const bySource = new Map<string, Record<string, SetLook>>();
  for (const { id } of leftOut) {
    const record = records.get(id);
    if (!record || published.has(id)) continue;
    const set = byId.get(id);
    const origins = [...new Set([...(record.origins ?? []), ...(set?.occurrences.map((occurrence) => occurrence.origin) ?? [])])].sort((a, b) => Number(b === "blizzard") - Number(a === "blizzard") || a.localeCompare(b));
    const source = origins.length ? origins.map((origin) => originName(origin, names)).join(", ") : "this checkout";
    bySource.set(source, { ...bySource.get(source), [id]: catalogLook(id, looks[id]!, record, set, has) });
  }
  const unpublished = Object.fromEntries(Object.entries(publicOnes).filter(([id]) => !published.has(id)));
  const pictures = { dir };
  const layers: SetLayer[] = [
    ...[...bySource].sort(([a], [b]) => a.localeCompare(b)).map(([source, layerLooks]) => ({ looks: layerLooks, pictures, source })),
    ...(Object.keys(unpublished).length ? [{ looks: unpublished, pictures, source: PUBLISHED_SOURCE }] : []),
  ];
  return { layers, viewsDir, looks, published };
}

/** The Set Finder's cards here: the published sets with this machine's own laid over them, by name. */
export async function adjutantSetCards(options: OwnSetsOptions = {}): Promise<{ readonly cards: SetCard[] } & OwnSets> {
  const own = await ownSets(options);
  return { ...own, cards: setCards(own.published, { extra: own.layers }) };
}
