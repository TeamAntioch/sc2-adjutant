// The doodad-search-page CLI's arguments (src/cli/doodad-search-page-args.ts): a page by slug or
// folder, sheets by id, and --help.
import { describe, expect, it } from "vitest";

import { DOODAD_SEARCH_PAGE_USAGE, parseDoodadSearchPageArgs } from "../../src/cli/doodad-search-page-args.js";

describe("the doodad-search-page CLI's arguments", () => {
  it("asks for the usage on --help or -h", () => {
    expect(parseDoodadSearchPageArgs(["--help"])).toEqual({ help: true });
    expect(parseDoodadSearchPageArgs(["press-rig", "-h"])).toEqual({ help: true });
    expect(DOODAD_SEARCH_PAGE_USAGE).toMatch(/^Usage: doodad-search-page /);
    expect(DOODAD_SEARCH_PAGE_USAGE).toContain("--sheets-for <id,...>");
  });

  it("builds a page by slug or folder", () => {
    expect(parseDoodadSearchPageArgs(["press-rig", "--mission", "ashen-crossing", "--build-sheets", "--json"])).toEqual({
      page: { slug: "press-rig", mission: "ashen-crossing", buildSheets: true },
      json: true,
    });
    expect(parseDoodadSearchPageArgs(["--folder", "out/x", "--search", "s.json"])).toEqual({ page: { folder: "out/x", searchFile: "s.json", buildSheets: false }, json: false });
    expect(() => parseDoodadSearchPageArgs(["a", "b"])).toThrow(/One slug, not a b/);
    expect(() => parseDoodadSearchPageArgs(["--colour"])).toThrow(/Unknown option --colour/);
    expect(() => parseDoodadSearchPageArgs(["--folder", "--json"])).toThrow(/--folder needs a value/);
    expect(parseDoodadSearchPageArgs(["--folder", "-h"])).toEqual({ page: { folder: "-h", buildSheets: false }, json: false });
  });

  it("builds sheets by id, comma-separated or repeated, with no page", () => {
    expect(parseDoodadSearchPageArgs(["--sheets-for", "Crate,Barrel", "--sheets-for", "Lamp"])).toEqual({ sheetsFor: ["Crate", "Barrel", "Lamp"], json: false });
    expect(() => parseDoodadSearchPageArgs(["--sheets-for", "Crate", "press-rig"])).toThrow(/--sheets-for builds sheets alone/);
    expect(() => parseDoodadSearchPageArgs(["--sheets-for", ","])).toThrow(/--sheets-for needs doodad ids/);
  });
});
