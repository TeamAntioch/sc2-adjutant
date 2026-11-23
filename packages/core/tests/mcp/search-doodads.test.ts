// search_doodads through the MCP server: core's catalogs searched with the Workspace's doodad notes
// merged in, and for a Mission, the doodads its dependencies bring in first.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, fixture, text } from "./harness.js";

const VOID_CAMPAIGN = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";

type Result = { id: string; name: string; source: string; dependency?: string; provided?: boolean; uses: { use: string }[] };

describe("search_doodads", () => {
  it("finds the crusher and the compactor for `crusher press`, the crusher first, each labelled with its dependency", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher", "press"] } });
    expect(reply.isError).toBeFalsy();
    const results = (reply.structuredContent as { results: Result[] }).results;
    expect(results.map((result) => result.name.trim()).slice(0, 1)).toEqual(["Crusher Doodad"]);
    expect(results.map((result) => result.name)).toContain("Deadman's Port Grid Floor Compactor");
    expect(results.find((result) => result.id === "PortZionGridFloorCompactorDoodad")).toMatchObject({ source: "doodad", dependency: VOID_CAMPAIGN });
    expect(results.every((result) => result.provided === undefined)).toBe(true);
    expect(text(reply)).toMatch(/^PortZionCrusherDoodad "Crusher Doodad" \(doodad, mods\/liberty\.sc2mod, needs no dependency, 1 variation\)\n {2}dark metal crusher press/);
  });

  it("gives results that match its output schema, tilesets and a terrain object's description included", async () => {
    const client = await connect(fixture("crossing"));
    // The client checks structured content against a tool's output schema once it has listed the tools.
    await client.listTools();
    const reply = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher", "pit"], limit: 200 } });
    const results = (reply.structuredContent as { results: (Result & { tilesets?: string[]; description?: Record<string, unknown> })[] }).results;
    expect(results.some((result) => result.tilesets?.length)).toBe(true);
    expect(results.some((result) => result.source === "terrain-object" && result.description?.seen !== undefined)).toBe(true);
  });

  it("merges the Workspace's doodad notes and sorts for a Mission's dependencies", async () => {
    const root = await copyOf("crossing");
    await writeFile(path.join(root, "doodad-notes.json"), JSON.stringify({ doodads: { PortZionGridFloorCompactorDoodad: { uses: ["conveyor crusher frame"] } } }));
    const client = await connect(root);

    const noted = await client.callTool({ name: "search_doodads", arguments: { words: ["conveyor"], kind: "built" } });
    expect((noted.structuredContent as { results: Result[] }).results.find((result) => result.id === "PortZionGridFloorCompactorDoodad")?.uses).toEqual([{ use: "conveyor crusher frame" }]);

    // The fixture Mission declares no dependencies, so it has the default Void (Mod) alone: the
    // compactor, from the Liberty campaign, comes after every match the base mods provide (such as
    // the gym equipment) though it matches more. The crate matches press by core's Doodad Use for it
    // (data/doodad-uses/doodads/DOM_Crate.json).
    const before = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher", "press"], mission: "ashen-crossing" } });
    const order = (reply: typeof before) => (reply.structuredContent as { results: Result[] }).results.map(({ id, provided }) => [id, provided]);
    const compactor = order(before).findIndex(([id]) => id === "PortZionGridFloorCompactorDoodad");
    expect(order(before)[0]).toEqual(["PortZionCrusherDoodad", true]);
    expect(order(before)[compactor]).toEqual(["PortZionGridFloorCompactorDoodad", false]);
    expect(order(before).slice(0, compactor).every(([, provided]) => provided === true)).toBe(true);
    expect(order(before).slice(0, compactor).map(([id]) => id)).toContain("NewFolsomEquipment");
    expect(order(before).slice(0, compactor).map(([id]) => id)).toContain("DOM_Crate");
    expect(text(before)).toContain(`needs ${VOID_CAMPAIGN} (the Mission lacks it)`);

    const blueprintPath = path.join(root, "missions/ashen-crossing/blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, dependencies: ["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod", VOID_CAMPAIGN] }));
    const after = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher", "press"], mission: "ashen-crossing" } });
    expect(order(after).slice(0, 2)).toEqual([
      ["PortZionCrusherDoodad", true],
      ["PortZionGridFloorCompactorDoodad", true],
    ]);
  });

  it("takes several roles, and refuses one the catalog hasn't", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher"], role: ["prop", "structure"] } });
    expect(reply.isError).toBeFalsy();
    const roles = (reply.structuredContent as { results: { description?: { role?: string } }[] }).results.map((result) => result.description?.role);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((role) => role === "prop" || role === "structure")).toBe(true);
    const bad = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher"], role: ["boulder"] } });
    expect(bad.isError).toBe(true);
  });

  it("names the notes file when it isn't valid", async () => {
    const root = await copyOf("crossing");
    await writeFile(path.join(root, "doodad-notes.json"), JSON.stringify({ doodads: { PortZionCrusherDoodad: { uses: "crusher" } } }));
    const client = await connect(root);
    const reply = await client.callTool({ name: "search_doodads", arguments: { words: ["crusher"] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/doodad-notes\.json isn.t a valid doodad notes file: doodads\.PortZionCrusherDoodad\.uses/);
  });
});
