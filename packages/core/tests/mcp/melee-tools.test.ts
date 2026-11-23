// The compile_melee_map tool (#213): a Melee Map Blueprint from any folder, compiled through the
// server. A melee map needs no Workspace of its own, so the tool takes paths, not a Mission.
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connect, fixture, tempFolder, text } from "./harness.js";

const MELEE_FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));

/** The melee fixture copied into a fresh folder outside any Workspace (by default one removed after the test). */
async function meleeBlueprint(folder?: string): Promise<string> {
  const blueprint = path.join(folder ?? (await tempFolder()), "two-spawns", "blueprint.json");
  await cp(MELEE_FIXTURE, blueprint);
  return blueprint;
}

describe("compile_melee_map", () => {
  // Compiling the fixture takes seconds, so the tests that only read the default compile share one,
  // in a folder of its own: the harness removes its temporary folders after each test.
  let shared: string;
  let blueprint: string;
  let reply: Awaited<ReturnType<Client["callTool"]>>;
  beforeAll(async () => {
    shared = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mcp-"));
    blueprint = await meleeBlueprint(shared);
    const client = await connect(fixture("dressed"));
    reply = await client.callTool({ name: "compile_melee_map", arguments: { blueprint } });
  });
  afterAll(() => rm(shared, { recursive: true, force: true }));

  it("compiles a Melee Map Blueprint beside it, to a git-ignored output folder by default", async () => {
    expect(reply.isError, text(reply)).toBeFalsy();
    const outputDir = path.join(path.dirname(blueprint), "output", "two-spawns.SC2Map");
    expect(reply.structuredContent).toMatchObject({ outputDir, warnings: [] });
    expect(text(reply)).toMatch(new RegExp(`^Compiled the melee map Two Spawns to ${outputDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n\nDistance report`));
    expect(await readFile(path.join(outputDir, "Triggers"), "utf8")).toContain('<Item Type="Trigger" Id="B1162226"/>');
    expect(await readFile(path.join(path.dirname(blueprint), "output", ".gitignore"), "utf8")).toMatch(/^\*$/m);
  });

  it("returns the distance report and its warnings, each naming its rule and object", () => {
    const { report } = reply.structuredContent as { report: { distances: { rampToRamp: { seconds: number } }; bases: number; warnings: { rule: string; object: string }[] } };
    expect(report.bases).toBe(6);
    expect(report.distances.rampToRamp.seconds).toBeGreaterThan(0);
    expect(report.warnings).toContainEqual(expect.objectContaining({ rule: "base-count", object: "the map" }));
    expect(text(reply)).toContain("  Ramp to ramp ");
    expect(text(reply)).toContain("[base-count] the map: 6 bases, outside 14-16");
  });

  it("writes to a given folder", async () => {
    const blueprint = await meleeBlueprint();
    const outputDir = path.join(await tempFolder(), "Two Spawns.SC2Map");
    const client = await connect(fixture("dressed"));
    const reply = await client.callTool({ name: "compile_melee_map", arguments: { blueprint, outputDir } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(existsSync(path.join(outputDir, "ComponentList.SC2Components"))).toBe(true);
  });

  it("refuses a Mission Blueprint, with the schema's reason", async () => {
    const client = await connect(fixture("dressed"));
    const reply = await client.callTool({ name: "compile_melee_map", arguments: { blueprint: path.join(fixture("dressed"), "missions", "yard", "blueprint.json") } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/Invalid Melee Map Blueprint .*beats/s);
  });
});
