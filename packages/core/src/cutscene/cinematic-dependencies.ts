// Whether the map loads what a Cinematic films (#1019): its Sets, its cast's models, its Lights and
// the rig its feeds through set cameras film through (#1057),
// where they are one of the game's packages'. A Set imported from a Blizzard cutscene needs the
// package that cutscene is in (Nova Bridge's pieces are Liberty's CModels, but their files are
// NovaStoryAssets.SC2Mod's), and a piece, a cast member's model or a Light needs a package whose
// data defines it (data/package-entries.json). A map whose dependencies load none of them compiles,
// and the Set or the cast simply isn't there in the game, so compile_map, compile_cutscene and
// check warn, naming what needs it and the dependency to add.
//
// What the Workspace defines itself (the Campaign Mod's models and Lights, the Mission's own Lights
// and its Plugins') is the map's. A dependency the check can't follow (a mod outside the Workspace,
// or a game package whose chain isn't known) may load anything, so then nothing is warned about.

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { dependencyToAdd, filePackage, isGamePackage, packageEntries, type PackageEntries, packageName, packageReach, type PackageReach } from "../map/game-packages.js";
import { DEFAULT_DEPENDENCIES } from "../map/write-document-info-xml.js";
import { boundPlugins } from "../plugins/plugin-api.js";
import type { Workspace } from "../plugins/workspace.js";
import { feedOf } from "../domain/cinematic.js";
import { type CinematicProblem, cinematicLights, type LoadedCinematic, splitCamera } from "./cinematic.js";
import { FEED_RIG } from "./feeds.js";

/** The models and Lights the map has of its own, whatever its dependencies load. */
export type OwnEntries = { readonly models: ReadonlySet<string>; readonly lights: ReadonlySet<string> };

/** A Mission's own models and Lights: its Campaign Mod's, its own `lights` and its Plugins'. */
export function missionOwnEntries(blueprint: MissionBlueprint): OwnEntries {
  const catalog = blueprintCatalog(blueprint);
  const plugins = boundPlugins(blueprint).contributions("lights").map((light) => light.id);
  return { models: catalog.models, lights: new Set([...catalog.lights, ...blueprint.lights.map((light) => light.id), ...plugins]) };
}

/** What a Cinematic films that may need a package: each with the packages any of which would bring it in, and whether it names more than one thing. */
type Need = { readonly what: string; readonly packages: readonly string[]; readonly several?: true };

const MORE_THAN = 3;

/** Words listed as a sentence: "a, b and c". */
const listed = (words: readonly string[]): string => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]!);

/** What `loaded` films that the map doesn't load: the packages the data says hold each, none of them loaded. */
function unloadedNeeds(loaded: LoadedCinematic, reach: PackageReach, own: OwnEntries, data: PackageEntries): Need[] {
  const missing = (packages: readonly string[] | undefined): packages is readonly string[] => packages !== undefined && packages.length > 0 && !packages.some((pkg) => reach.loaded.has(pkg));
  const needs: Need[] = [];
  for (const placed of loaded.cinematic.sets) {
    const set = loaded.sets.get(placed.id);
    if (!set) continue;
    const source = set.provenance?.kind === "blizzard" ? filePackage(set.provenance.file) : undefined;
    // Only a package whose chain is known is judged: another may be brought in by one that is.
    if (source && isGamePackage(source) && missing([source])) needs.push({ what: `its Set ${placed.id} (imported from ${set.provenance!.file})`, packages: [source] });
    // Its pieces a package defines and the map doesn't load, by the packages that hold them.
    const byPackages = new Map<string, { packages: readonly string[]; models: string[] }>();
    for (const piece of set.pieces) {
      const packages = own.models.has(piece.model) || piece.modelPath ? undefined : data.models.get(piece.model);
      if (!missing(packages) || (source && packages.includes(source))) continue;
      const key = packages.join(" ");
      const entry = byPackages.get(key) ?? { packages, models: [] };
      if (!entry.models.includes(piece.model)) entry.models.push(piece.model);
      byPackages.set(key, entry);
    }
    for (const { packages, models } of byPackages.values()) {
      const shown = models.length > MORE_THAN ? [...models.slice(0, MORE_THAN), `${models.length - MORE_THAN} more`] : models;
      needs.push({ what: `its Set ${placed.id}'s piece${models.length > 1 ? "s" : ""} ${listed(shown)}`, packages, ...(models.length > 1 ? { several: true as const } : {}) });
    }
  }
  for (const member of loaded.cinematic.cast) {
    const packages = own.models.has(member.model) ? undefined : data.models.get(member.model);
    if (missing(packages)) needs.push({ what: `its cast member ${member.id}'s model ${member.model}`, packages });
  }
  // A feed through a set camera (`"<set>/<camera>"`) films through core's rig, the Nova bridge's main
  // screen, which stands in each shot it feeds; a feed through a cast member's own camera needs none.
  const fed = [...new Set(loaded.cinematic.shots.flatMap((shot, at) => (splitCamera(feedOf(shot.feed)?.camera ?? "") ? [shot.name ?? `shots.${at}`] : [])))];
  const rig = own.models.has(FEED_RIG.model) ? undefined : data.models.get(FEED_RIG.model);
  if (fed.length > 0 && missing(rig)) needs.push({ what: `the feed rig ${FEED_RIG.model} (for the feed${fed.length > 1 ? "s" : ""} of ${fed.join(", ")})`, packages: rig });
  for (const light of cinematicLights(loaded)) {
    const packages = own.lights.has(light) ? undefined : data.lights.get(light);
    if (missing(packages)) needs.push({ what: `its Light ${light}`, packages });
  }
  return needs;
}

/**
 * A warning for each dependency `loaded` needs and the map lacks: what needs it, the packages that
 * hold them, and the dependency to add. None when a dependency can't be followed.
 */
export function cinematicDependencyProblems(loaded: LoadedCinematic, reach: PackageReach, own: OwnEntries, data: PackageEntries = packageEntries()): CinematicProblem[] {
  if (reach.unresolved.length > 0) return [];
  const byDependency = new Map<string, Need[]>();
  for (const need of unloadedNeeds(loaded, reach, own, data)) {
    const dependency = dependencyToAdd(need.packages);
    byDependency.set(dependency, [...(byDependency.get(dependency) ?? []), need]);
  }
  return [...byDependency].map(([dependency, needs]) => {
    const holders = [...new Set(needs.map((need) => need.packages.map(packageName).join(" or ")))];
    const whats = needs.map((need) => need.what);
    const [verb, pronoun] = needs.length > 1 || needs[0]!.several ? ["are", "they"] : ["is", "it"];
    const what = listed(whats);
    return {
      file: loaded.file,
      message: `${what.charAt(0).toUpperCase()}${what.slice(1)} ${verb} ${listed(holders)}'s, which the map's dependencies don't load, so ${pronoun} won't be there in the game: add ${dependency} to the Blueprint's dependencies (or to a mod it depends on)`,
      severity: "warning" as const,
    };
  });
}

/** The warnings for a Mission's Cinematics `loaded`, against what its dependencies load through the Workspace's mods. */
export async function missionCinematicDependencyProblems(workspace: Pick<Workspace, "root" | "mods">, blueprint: MissionBlueprint, loaded: readonly LoadedCinematic[]): Promise<CinematicProblem[]> {
  if (loaded.length === 0) return [];
  const reach = await packageReach(workspace, blueprint.dependencies ?? DEFAULT_DEPENDENCIES);
  const own = missionOwnEntries(blueprint);
  return loaded.flatMap((entry) => cinematicDependencyProblems(entry, reach, own));
}
