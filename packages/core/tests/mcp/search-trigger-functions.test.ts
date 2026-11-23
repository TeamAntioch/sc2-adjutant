// search_trigger_functions (#1029): the trigger functions in reach of a Mission, found by name,
// category, kind and type, given in the Editor's terms.
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { connect, copyOf, fixture, text } from "./harness.js";

/** The mod-library-calls fixture's Workspace mod cmpn-story, whose library Cmpn is named Story Tools. */
const MOD = fileURLToPath(new URL("../fixtures/editor-triggers/mod-library-calls/mods/cmpn-story/", import.meta.url));

/** A copy of the crossing Workspace whose Mission depends on the Workspace mod cmpn-story. */
async function crossingWithMod() {
  const root = await copyOf("crossing");
  await cp(MOD, path.join(root, "mods", "cmpn-story"), { recursive: true });
  const workspaceFile = path.join(root, "sc2-adjutant.workspace.json");
  await writeFile(workspaceFile, JSON.stringify({ ...JSON.parse(await readFile(workspaceFile, "utf8")), mods: ["cmpn-story"] }));
  const blueprintFile = path.join(root, "missions", "ashen-crossing", "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintFile, "utf8"));
  await writeFile(blueprintFile, JSON.stringify({ ...blueprint, dependencies: ["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod", "file:Mods\\Cmpn-Story.SC2Mod"] }));
  return root;
}

describe("search_trigger_functions", () => {
  it("finds the game's functions that take a Unit Group and return a Point, in the Editor's terms and without Ids", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "search_trigger_functions", arguments: { takes: ["Unit Group"], returns: "Point" } });

    expect(reply.isError).toBeFalsy();
    const { hits, total } = reply.structuredContent as { hits: { name: string; id?: string }[]; total: number };
    expect(hits.map((hit) => hit.name).sort()).toEqual(["Center Of Unit Group", "Center Of Unit Group Old", "Get Best Target Point On Group"]);
    expect(total).toBe(3);
    expect(hits.every((hit) => hit.id === undefined)).toBe(true);
    expect(text(reply)).toContain("Center Of Unit Group (Built-In, Unit Group > Groups): function (Unit Group: Unit Group) returns Point");
    expect(text(reply)).not.toContain("F5D30562");
  });

  it("gives Ids when asked for", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "search_trigger_functions", arguments: { text: "Center Of Unit Group", limit: 1, ids: true } });

    expect(reply.structuredContent).toMatchObject({ hits: [{ name: "Center Of Unit Group", id: "Ntve/F5D30562" }] });
    expect(text(reply)).toContain("Ntve/F5D30562");
  });

  it("finds a dependency mod's function for a Mission that depends on it, and a name two libraries share from both", async () => {
    const root = await crossingWithMod();
    const client = await connect(root);

    const mod = await client.callTool({ name: "search_trigger_functions", arguments: { mission: "ashen-crossing", text: "SendTransmissionStory" } });
    expect(mod.isError).toBeFalsy();
    expect(mod.structuredContent).toMatchObject({ hits: [{ name: "Send Transmission (Story)", library: "Cmpn", libraryName: "Story Tools" }], total: 1 });

    const shared = await client.callTool({ name: "search_trigger_functions", arguments: { mission: "ashen-crossing", text: "If Then", kind: "action" } });
    const hits = (shared.structuredContent as { hits: { name: string; library: string }[] }).hits.filter((hit) => hit.name === "If Then");
    expect(hits.map((hit) => hit.library)).toEqual(["Ntve", "Cmpn"]);

    // Without the Mission, only the game's libraries are in reach.
    const game = await client.callTool({ name: "search_trigger_functions", arguments: { text: "SendTransmissionStory" } });
    expect(game.structuredContent).toMatchObject({ hits: [], total: 0 });
    expect(text(game)).toContain("No function in reach matches");
  });
});
