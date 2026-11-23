// add_doodad_note and contribute_doodad_notes through the MCP server: a Doodad Use added to the
// Workspace's doodad-notes.json, and a dry run of contributing it to a synthetic sc2-asset-catalog
// checkout. No git or gh runs: a real contribution is tested with them faked (tests/catalog).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, tempFolder, text } from "./harness.js";

type Use = { use: string; variation?: number; scale?: number; from?: string };

describe("add_doodad_note", () => {
  it("adds a Doodad Use, with its variation, scale and source, to the Workspace's notes, which search_doodads then merges and shows", async () => {
    const root = await copyOf("crossing");
    const client = await connect(root);
    const use = { use: "press head over a conveyor", variation: 1, scale: 0.6, from: "a press search, 2026-11-09" };
    const reply = await client.callTool({ name: "add_doodad_note", arguments: { id: "PortZionCrusherDoodad", ...use } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ note: { uses: [use] } });
    expect(text(reply)).toContain("PortZionCrusherDoodad: uses press head over a conveyor (variation 01, scale 0.6)");
    expect(JSON.parse(await readFile(path.join(root, "doodad-notes.json"), "utf8"))).toEqual({ doodads: { PortZionCrusherDoodad: { uses: [use] } } });

    const found = await client.callTool({ name: "search_doodads", arguments: { words: ["conveyor"] } });
    expect((found.structuredContent as { results: { id: string; uses: Use[] }[] }).results.find((result) => result.id === "PortZionCrusherDoodad")?.uses).toEqual([use]);
    expect(text(found)).toContain("  uses: press head over a conveyor (variation 01, scale 0.6)");
  });

  it("refuses a doodad the game and the Campaign Mod don't have, and a variation without a use", async () => {
    const client = await connect(await copyOf("crossing"));
    const reply = await client.callTool({ name: "add_doodad_note", arguments: { id: "NoSuchDoodad", use: "anything" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/NoSuchDoodad isn't a game doodad/);
    const bare = await client.callTool({ name: "add_doodad_note", arguments: { id: "PortZionCrusherDoodad", look: "a press", variation: 2 } });
    expect(bare.isError).toBe(true);
    expect(text(bare)).toMatch(/goes with a use/);
  });
});

describe("contribute_doodad_notes", () => {
  /** A synthetic checkout of sc2-asset-catalog, describing the crusher. */
  async function catalogCheckout() {
    const checkout = await tempFolder();
    await mkdir(path.join(checkout, "packages/sc2-asset-catalog/data/doodad-uses/doodads"), { recursive: true });
    await writeFile(path.join(checkout, "packages/sc2-asset-catalog/package.json"), JSON.stringify({ name: "@team-antioch/sc2-asset-catalog" }));
    const descriptions = `${JSON.stringify({ PortZionCrusherDoodad: { look: "dark metal crusher press", kind: "built", size: "large", role: "prop", story: ["industry"], biome: ["urban"] } }, null, 2)}\n`;
    await writeFile(path.join(checkout, "packages/sc2-asset-catalog/data/doodad-descriptions.json"), descriptions);
    return { checkout, descriptions };
  }

  it("on a dry run, lists what would go to sc2-asset-catalog's uses files and changes nothing", async () => {
    const root = await copyOf("crossing");
    await writeFile(path.join(root, "doodad-notes.json"), JSON.stringify({ doodads: { PortZionCrusherDoodad: { uses: ["press head over a conveyor", { use: "piston block", scale: 2 }] } } }));
    const { checkout, descriptions } = await catalogCheckout();

    const client = await connect(root);
    const reply = await client.callTool({ name: "contribute_doodad_notes", arguments: { checkout, dryRun: true } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({
      contributed: [{ id: "PortZionCrusherDoodad", uses: [{ use: "press head over a conveyor" }, { use: "piston block", scale: 2 }] }],
      kept: [],
      dropped: [],
    });
    expect(text(reply)).toMatch(/^Would contribute 1 note:\n {2}PortZionCrusherDoodad: uses press head over a conveyor; piston block \(scale 2\)/);
    expect(await readFile(path.join(checkout, "packages/sc2-asset-catalog/data/doodad-descriptions.json"), "utf8")).toBe(descriptions);
  });

  it("keeps back a note that names one of the Workspace's Missions", async () => {
    const root = await copyOf("crossing");
    await writeFile(path.join(root, "doodad-notes.json"), JSON.stringify({ doodads: { PortZionCrusherDoodad: { uses: [{ use: "press head", from: "Ashen Crossing press search" }] } } }));
    const { checkout } = await catalogCheckout();
    const reply = await (await connect(root)).callTool({ name: "contribute_doodad_notes", arguments: { checkout, dryRun: true } });
    expect(reply.structuredContent).toMatchObject({ contributed: [], kept: [{ id: "PortZionCrusherDoodad", reason: expect.stringContaining("it names ashen-crossing, of the Workspace's Missions or story") }] });
  });
});
