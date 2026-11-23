// The search-doodads CLI's arguments (search-doodads.ts): words, the catalog's facets, --mission,
// --limit, --json, and --help. A bad value throws before anything is searched or printed.

import { DOODAD_KINDS, DOODAD_ROLES, DOODAD_SIZES, type DoodadDescription } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import type { WorkspaceDoodadQuery } from "../catalog/workspace-doodad-search.js";
import { helpAsked, optionValue } from "./help-asked.js";

const FACETS = { "--kind": DOODAD_KINDS, "--size": DOODAD_SIZES } as const;

export const SEARCH_DOODADS_USAGE = `Usage: search-doodads [word ...] ${Object.entries(FACETS)
  .map(([name, values]) => `[${name} ${values.join("|")}]`)
  .join(" ")} [--role ${DOODAD_ROLES.join("|")}[,...]] [--story a,b] [--biome a,b] [--package <package>] [--mission <id>] [--limit n] [--json] [--help]
A word matches a whole word and its plurals and inflections (crate finds crates, not crater; press finds presses and pressed); end it in * to match the start of words (hydra* finds hydraulic).`;

export type SearchDoodadsArgs = { readonly help: true } | { readonly query: WorkspaceDoodadQuery; readonly json: boolean };

const VALUED = new Set([...Object.keys(FACETS), "--role", "--story", "--biome", "--package", "--mission", "--limit"]);

export function parseSearchDoodadsArgs(args: readonly string[]): SearchDoodadsArgs {
  if (helpAsked(args, VALUED)) return { help: true };
  const options = new Map<string, string>();
  const words: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUED.has(arg)) options.set(arg, optionValue(args, i++, arg));
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else words.push(arg);
  }
  for (const [name, values] of Object.entries(FACETS)) {
    const value = options.get(name);
    if (value !== undefined && !(values as readonly string[]).includes(value)) throw new Error(`${name} is one of ${values.join(", ")}, not ${value}`);
  }
  const list = (name: string) => options.get(name)?.split(",").filter(Boolean);
  const role = list("--role");
  const badRole = role?.find((value) => !(DOODAD_ROLES as readonly string[]).includes(value));
  if (badRole !== undefined) throw new Error(`--role is one of ${DOODAD_ROLES.join(", ")}, not ${badRole}`);
  const limit = options.has("--limit") ? Number(options.get("--limit")) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error(`--limit must be a whole number above 0, not ${options.get("--limit")}`);
  const query: WorkspaceDoodadQuery = {
    words,
    ...(options.has("--kind") ? { kind: options.get("--kind") as DoodadDescription["kind"] } : {}),
    ...(options.has("--size") ? { size: options.get("--size") as DoodadDescription["size"] } : {}),
    ...(role?.length ? { role: role as DoodadDescription["role"][] } : {}),
    ...(list("--story")?.length ? { story: list("--story")! } : {}),
    ...(list("--biome")?.length ? { biome: list("--biome")! } : {}),
    ...(options.has("--package") ? { package: options.get("--package")! } : {}),
    ...(options.has("--mission") ? { mission: options.get("--mission")! } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
  return { query, json };
}
