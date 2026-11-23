// The doodad-search-page CLI's arguments (doodad-search-page.ts): a page by slug (and Mission) or
// by folder, or --sheets-for alone, which builds candidates' sheets by id with no search.json.

import { helpAsked, optionValue } from "./help-asked.js";

export const DOODAD_SEARCH_PAGE_USAGE = `Usage: doodad-search-page (<slug> [--mission <id>] | --folder <folder>) [--search <file.json>] [--build-sheets] [--json]
       doodad-search-page --sheets-for <id,...> [--json]
       doodad-search-page --help`;

export type DoodadSearchPageArgs =
  | { readonly help: true }
  | {
      readonly page: { readonly slug?: string; readonly mission?: string; readonly folder?: string; readonly searchFile?: string; readonly buildSheets: boolean };
      readonly json: boolean;
    }
  | { readonly sheetsFor: readonly string[]; readonly json: boolean };

const VALUED = new Set(["--mission", "--folder", "--search", "--sheets-for"]);

export function parseDoodadSearchPageArgs(args: readonly string[]): DoodadSearchPageArgs {
  if (helpAsked(args, VALUED)) return { help: true };
  const options = new Map<string, string>();
  const slugs: string[] = [];
  const sheetsFor: string[] = [];
  let asksSheets = false;
  let json = false;
  let buildSheets = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUED.has(arg)) {
      const value = optionValue(args, i++, arg);
      if (arg === "--sheets-for") {
        asksSheets = true;
        sheetsFor.push(...value.split(",").map((id) => id.trim()).filter(Boolean));
      } else options.set(arg, value);
    } else if (arg === "--json") json = true;
    else if (arg === "--build-sheets") buildSheets = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else slugs.push(arg);
  }
  if (asksSheets) {
    if (slugs.length || options.size || buildSheets) throw new Error("--sheets-for builds sheets alone: give it no slug, folder, Mission, search or --build-sheets");
    if (sheetsFor.length === 0) throw new Error("--sheets-for needs doodad ids, such as --sheets-for Crate,Barrel");
    return { sheetsFor: [...new Set(sheetsFor)], json };
  }
  if (slugs.length > 1) throw new Error(`One slug, not ${slugs.join(" ")}`);
  const page = {
    ...(slugs[0] !== undefined ? { slug: slugs[0] } : {}),
    ...(options.has("--mission") ? { mission: options.get("--mission")! } : {}),
    ...(options.has("--folder") ? { folder: options.get("--folder")! } : {}),
    ...(options.has("--search") ? { searchFile: options.get("--search")! } : {}),
    buildSheets,
  };
  return { page, json };
}
