// The kinds of Cutscene Editor source the cinematic set catalog reads: Blizzard's game data, which
// core knows, and any a Workspace's Plugins contribute, such as a Campaign's own repo with its
// actor-name conventions.

import { CORE_CUTSCENE_SOURCES, type CutsceneSourceKind, type PluginRegistry } from "../plugins/plugin-api.js";

/** Each source kind by id. */
export type CutsceneSourceKinds = ReadonlyMap<string, CutsceneSourceKind>;

/** Core's source kinds alone. */
export const CORE_SOURCE_KINDS: CutsceneSourceKinds = new Map(CORE_CUTSCENE_SOURCES.map((kind) => [kind.id, kind]));

/** Core's source kinds and every one the Workspace's Plugins contribute. */
export function cutsceneSourceKinds(registry: PluginRegistry): CutsceneSourceKinds {
  return new Map([...CORE_CUTSCENE_SOURCES, ...registry.contributions("cutsceneSources")].map((kind) => [kind.id, kind]));
}

/** The kind a source names, or a plain one labelled with its id when nothing describes it. */
export function sourceKind(kinds: CutsceneSourceKinds, id: string): CutsceneSourceKind {
  return kinds.get(id) ?? { id, label: id, description: `${id}'s files` };
}

/**
 * The `--source <kind>=<dir>` options of a catalog command, in order. A kind must be one core or
 * the Workspace's Plugins know.
 */
export function sourceOptions(args: readonly string[], kinds: CutsceneSourceKinds): { readonly origin: string; readonly root: string }[] {
  const found: { origin: string; root: string }[] = [];
  args.forEach((arg, index) => {
    if (arg !== "--source") return;
    const value = args[index + 1] ?? "";
    const split = value.indexOf("=");
    const [origin, root] = split > 0 ? [value.slice(0, split), value.slice(split + 1)] : ["", ""];
    if (!origin || !root) throw new Error(`--source takes <kind>=<dir>, not "${value}"`);
    if (!kinds.has(origin)) throw new Error(`No cutscene source kind ${origin}; the Workspace knows ${[...kinds.keys()].join(", ")}`);
    found.push({ origin, root });
  });
  return found;
}
