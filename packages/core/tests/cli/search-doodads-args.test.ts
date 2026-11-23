// The search-doodads CLI's arguments (src/cli/search-doodads-args.ts): words, facets, --help, and
// errors that name the bad value.
import { describe, expect, it } from "vitest";

import { parseSearchDoodadsArgs, SEARCH_DOODADS_USAGE } from "../../src/cli/search-doodads-args.js";

describe("the search-doodads CLI's arguments", () => {
  it("asks for the usage on --help or -h", () => {
    expect(parseSearchDoodadsArgs(["--help"])).toEqual({ help: true });
    expect(parseSearchDoodadsArgs(["crate", "-h"])).toEqual({ help: true });
    expect(SEARCH_DOODADS_USAGE).toMatch(/^Usage: search-doodads /);
  });

  it("takes several roles, stories and biomes, comma-separated", () => {
    expect(parseSearchDoodadsArgs(["crate", "--role", "prop,clutter", "--story", "industry,terran", "--json"])).toEqual({
      query: { words: ["crate"], role: ["prop", "clutter"], story: ["industry", "terran"] },
      json: true,
    });
  });

  it("refuses a bad facet value, an unknown option and a bad limit, naming the value", () => {
    expect(() => parseSearchDoodadsArgs(["--role", "prop,boulder", "--json"])).toThrow(/--role is one of cliff, structure, .*, not boulder/);
    expect(() => parseSearchDoodadsArgs(["--kind", "metal"])).toThrow(/--kind is one of natural, built, creature, not metal/);
    expect(() => parseSearchDoodadsArgs(["--colour", "red"])).toThrow(/Unknown option --colour/);
    expect(() => parseSearchDoodadsArgs(["--limit", "0"])).toThrow(/--limit must be a whole number above 0, not 0/);
    expect(() => parseSearchDoodadsArgs(["--story"])).toThrow(/--story needs a value/);
    expect(() => parseSearchDoodadsArgs(["--story", "--json"])).toThrow(/--story needs a value/);
  });

  it("takes -h as a value where one is due", () => {
    expect(parseSearchDoodadsArgs(["--package", "-h"])).toEqual({ query: { words: [], package: "-h" }, json: false });
  });
});
