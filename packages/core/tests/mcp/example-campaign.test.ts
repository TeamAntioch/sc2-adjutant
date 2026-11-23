// Seam 1 (#96): the public example Campaign Pack (examples/example-campaign), served as the
// Workspace it ships in. It is the template new authors copy, so it has to compile as it is and
// hold nothing from the author's own Campaign.
import { cp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CORE_VERSION } from "../../src/mcp/core-version.js";
import { AUTHOR_CAMPAIGN } from "../support/campaign-content.js";
import { connect, tempFolder, text } from "./harness.js";

const EXAMPLE = fileURLToPath(new URL("../../examples/example-campaign/", import.meta.url));

/** A copy of the example Workspace somewhere else, as an author who copied it would have it: for the tests that write. */
async function copyOfExample(): Promise<string> {
  const root = await tempFolder();
  await cp(EXAMPLE, root, { recursive: true, filter: (source) => !isGenerated(path.relative(EXAMPLE, source)) });
  return root;
}

/** What trying the example leaves in it: compiled maps and their compile records, and the Finder's .DS_Store. */
const isGenerated = (relative: string) =>
  relative.split(path.sep).some((part) => part === "output" || part === ".DS_Store" || part.endsWith(".SC2Map")) || /^missions[\\/][^\\/]+[\\/]compile-record\.json$/.test(relative);

/** The example's own files, recursively, relative to it. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .filter((file) => !isGenerated(file));
}

describe("the example Campaign Pack", () => {
  it("is the Workspace's only Campaign Pack, with its naming template and the hazard Mechanic", async () => {
    const client = await connect(EXAMPLE);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toBe(
      [
        "campaign-example 0.1.0 (./plugins/campaign-example); roles: campaign-pack; mechanics: none; naming: example; screenplaySource: none; knowledge: none; exemplarMaps: none; composites: none; prompts: none; styleRules: none; capabilities: none; cutsceneSources: none; lights: none; skills: none",
        "hazard 1.0.0 (bundled:hazard); roles: none; mechanics: hazard; naming: none; screenplaySource: none; knowledge: none; exemplarMaps: none; composites: none; prompts: none; styleRules: none; capabilities: none; cutsceneSources: none; lights: none; skills: none",
        `sc2-adjutant core ${CORE_VERSION}`,
      ].join("\n"),
    );
  });

  it("compiles its example Mission through the server, naming the Screenplay with its template", async () => {
    const root = await copyOfExample();
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "ashfall-relay" } });
    expect(text(reply)).toContain("Compiled Ashfall Relay");
    expect(reply.isError).toBeFalsy();

    const outputDir = path.join(root, "missions", "ashfall-relay", "Ashfall-Relay.SC2Map");
    const read = (...parts: string[]) => readFile(path.join(outputDir, ...parts), "utf8");
    const conversations = await read("Base.SC2Data", "GameData", "ConversationData.xml");
    const sounds = await read("Base.SC2Data", "GameData", "SoundData.xml");
    const galaxy = await read("MapScript.galaxy");

    // The template's conversation and sound ids; its lines fall back to core's default.
    expect(conversations).toContain('<CConversation id="Ch1_ashfall_relay">');
    expect(conversations).toContain('<Text value="Conversation/Ch1_ashfall_relay/Line1-1"/>');
    expect(conversations).toContain('<SpeakerCharacter value="ExampleAdjutant"/>');
    expect(sounds).toContain('<CSound id="Ch1_ashfall_relay_1_01"');
    const voices = await readdir(path.join(outputDir, "Assets", "Sounds", "Conversations"));
    expect(voices).toContain("Ch1_ashfall_relay_2_01.ogg");
    // Stock portraits: the Adjutant's model, and the Foreman's SCV off the map. The Sergeant
    // speaks from the Marine anchor.
    expect(galaxy).toContain('TransmissionSourceFromModel("AdjutantPortrait")');
    expect(galaxy).toContain('TransmissionSourceFromUnitType("SCV", false)');
    expect(galaxy).toContain("TransmissionSourceFromUnit(");
  });

  it("passes the layout checker, its hazard Mechanic included", async () => {
    const client = await connect(EXAMPLE);
    const reply = await client.callTool({ name: "check_layout", arguments: { mission: "ashfall-relay" } });
    expect(reply.isError).toBeFalsy();
    const { checks } = reply.structuredContent as { checks: { id: string; status: string; findings: string[] }[] };
    expect(checks.find((check) => check.id === "hazard-retreat")?.status).toBe("pass");
    expect(checks.filter((check) => check.status === "warn")).toEqual([]);
  });

  it("holds nothing from the author's own Campaign and points at nothing private", async () => {
    const files = await filesIn(EXAMPLE);
    expect(files).toContain("README.md");
    const banned = /(?<!@team-)\bantioch\b|\bshakuras\b|~\/repos|\/Users\//i;
    for (const file of files.filter((name) => !name.endsWith(".wav"))) {
      const contents = await readFile(path.join(EXAMPLE, file), "utf8");
      expect(`${file}: ${(contents.match(AUTHOR_CAMPAIGN) ?? contents.match(banned))?.[0] ?? "clean"}`).toBe(`${file}: clean`);
    }
  });
});
