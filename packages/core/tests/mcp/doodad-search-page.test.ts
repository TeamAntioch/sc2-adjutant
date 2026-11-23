// build_doodad_search_page through the MCP server: a Mission's search written into its output
// folder, with the doodads its dependencies bring in marked, and rebuilt from search.json.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, text } from "./harness.js";

const SEARCH = {
  title: "Crushing press",
  parts: [
    {
      name: "press head",
      readsAs: "a heavy block that could crush a Marine",
      queries: [{ words: ["crusher", "press"] }],
      candidates: [
        { id: "PortZionCrusherDoodad", note: "A crusher already.", judgedFrom: "image" },
        { id: "PortZionGridFloorCompactorDoodad", note: "A floor compactor: the head could sit above it.", judgedFrom: "image" },
      ],
      alsoConsidered: [{ id: "NewFolsomEquipment", reason: "Gym equipment." }],
    },
  ],
};

describe("build_doodad_search_page", () => {
  it("writes a Mission's search.json and index.html in its output folder, marks what its dependencies bring in, and rebuilds from search.json", async () => {
    const root = await copyOf("crossing");
    const client = await connect(root);
    const reply = await client.callTool({ name: "build_doodad_search_page", arguments: { slug: "crushing-press", mission: "ashen-crossing", search: SEARCH } });
    expect(reply.isError).toBeFalsy();
    const folder = path.join(root, "missions/ashen-crossing/output/doodad-search/crushing-press");
    expect(reply.structuredContent).toMatchObject({ folder, page: path.join(folder, "index.html"), search: path.join(folder, "search.json"), builtSheets: [] });
    expect(text(reply)).toContain(`Wrote ${path.join(folder, "index.html")}`);
    expect(JSON.parse(await readFile(path.join(folder, "search.json"), "utf8"))).toMatchObject({ title: "Crushing press", mission: "ashen-crossing" });
    const page = await readFile(path.join(folder, "index.html"), "utf8");
    expect(page).toContain("for the Mission ashen-crossing");
    expect(page).toContain("needs Void (Campaign), which the Mission lacks");
    expect(page).toContain("Gym equipment.");

    const again = await client.callTool({ name: "build_doodad_search_page", arguments: { folder } });
    expect(again.isError).toBeFalsy();
    expect(await readFile(path.join(folder, "index.html"), "utf8")).toBe(page);
    const bySlug = await client.callTool({ name: "build_doodad_search_page", arguments: { slug: "crushing-press", mission: "ashen-crossing" } });
    expect(bySlug.structuredContent).toMatchObject({ page: path.join(folder, "index.html") });
    // A folder with no search.json (as the research archive's is, for a Mission's slug alone) says the Mission may be missing.
    const lost = await client.callTool({ name: "build_doodad_search_page", arguments: { folder: path.join(root, "elsewhere") } });
    expect(text(lost)).toMatch(/No search\.json in .*elsewhere: .*give its Mission too/);
  });

  it("builds sheets by doodad id with build_doodad_sheets, needing no search.json, and says why one can't be built", async () => {
    const client = await connect(await copyOf("crossing"));
    // An id no catalog has, so the test builds nothing in core's own sheets folder.
    const reply = await client.callTool({ name: "build_doodad_sheets", arguments: { ids: ["NoSuchDoodadAnywhere"] } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ built: [], here: [], unbuildable: [{ id: "NoSuchDoodadAnywhere", reason: "no catalog has it" }] });
    expect(text(reply)).toBe("Not built:\n  NoSuchDoodadAnywhere: no catalog has it");
  });

  it("names a search.json field that is wrong, and asks for a slug or folder", async () => {
    const client = await connect(await copyOf("crossing"));
    const wrong = await client.callTool({ name: "build_doodad_search_page", arguments: { slug: "x", mission: "ashen-crossing", search: { ...SEARCH, parts: [] } } });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toMatch(/Invalid doodad search .*search\.json: parts: /);
    const nowhere = await client.callTool({ name: "build_doodad_search_page", arguments: { search: SEARCH } });
    expect(nowhere.isError).toBe(true);
    expect(text(nowhere)).toMatch(/slug, or its folder/);
  });
});
