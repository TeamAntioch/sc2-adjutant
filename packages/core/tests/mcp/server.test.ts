// Seam 1 (#96): the MCP server, started in-process over the SDK's in-memory transport against
// small fixture Workspaces. Tests call tools as a client would and assert on the replies and the
// files the tools write.
import { cp, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CORE_VERSION } from "../../src/mcp/core-version.js";
import { connect, copyOf, fixture, tempFolder, text } from "./harness.js";

/** A `list_plugins` failure's text: its reason, then core's version, which it names even when the Workspace doesn't load. */
const withCore = (reason: string) => `${reason}\nsc2-adjutant core ${CORE_VERSION}`;

describe("list_plugins", () => {
  it("reports each Plugin's name, version, source, roles and Contributions", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({
      plugins: [
        {
          name: "example-pack",
          version: "2.3.0",
          source: "./plugins/example-pack",
          roles: ["campaign-pack", "style-pack"],
          contributions: {
            mechanics: [],
            naming: [],
            screenplaySource: [],
            knowledge: ["palette", "exemplar-maps", "study-ridge", "composites"],
            exemplarMaps: ["ridge", "dunes"],
            composites: ["cairn"],
            prompts: ["review-look"],
            styleRules: [],
            capabilities: [],
            cutsceneSources: [],
            lights: [],
            skills: ["example-pack-dressing-review"],
          },
        },
        {
          name: "hazard",
          version: "1.0.0",
          source: "bundled:hazard",
          roles: [],
          contributions: {
            mechanics: ["hazard"],
            naming: [],
            screenplaySource: [],
            knowledge: [],
            exemplarMaps: [],
            composites: [],
            prompts: [],
            styleRules: [],
            capabilities: [],
            cutsceneSources: [],
            lights: [],
            skills: [],
          },
        },
      ],
      core: { version: CORE_VERSION },
    });
    expect(text(reply)).toBe(
      [
        "example-pack 2.3.0 (./plugins/example-pack); roles: campaign-pack, style-pack; mechanics: none; naming: none; screenplaySource: none; knowledge: palette, exemplar-maps, study-ridge, composites; exemplarMaps: ridge, dunes; composites: cairn; prompts: review-look; styleRules: none; capabilities: none; cutsceneSources: none; lights: none; skills: example-pack-dressing-review",
        "hazard 1.0.0 (bundled:hazard); roles: none; mechanics: hazard; naming: none; screenplaySource: none; knowledge: none; exemplarMaps: none; composites: none; prompts: none; styleRules: none; capabilities: none; cutsceneSources: none; lights: none; skills: none",
        `sc2-adjutant core ${CORE_VERSION}`,
      ].join("\n"),
    );
  });

  it("names core's version when the Workspace fails to load", async () => {
    const root = await copyOf("field");
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), "{ not json");
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^.+\nsc2-adjutant core /);
    expect(text(reply).endsWith(withCore(""))).toBe(true);
  });

  it("lists a Campaign Pack's naming template", async () => {
    const root = await withCampaignPack(await copyOf("screenplay"));
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(text(reply)).toBe(`talk-pack 0.1.0 (./plugins/talk-pack); roles: campaign-pack; mechanics: none; naming: chapters; screenplaySource: none; knowledge: none; exemplarMaps: none; composites: none; prompts: none; styleRules: none; capabilities: none; cutsceneSources: none; lights: none; skills: none\nsc2-adjutant core ${CORE_VERSION}`);
  });

  it("loads the Utilities the Workspace lists, in order, with the utility role", async () => {
    const root = await withUtilities(["./utilities/sketcher", "./utilities/workshop"]);
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    const { plugins } = reply.structuredContent as { plugins: { name: string; source: string; roles: string[] }[] };
    expect(plugins.map(({ name, source, roles }) => ({ name, source, roles }))).toEqual([
      { name: "sketcher", source: "./utilities/sketcher", roles: ["utility"] },
      { name: "workshop", source: "./utilities/workshop", roles: ["utility"] },
    ]);
    expect(text(reply)).toMatch(/^sketcher 0\.1\.0 \(\.\/utilities\/sketcher\); roles: utility;/);
  });

  it("loads the Utilities after the packs and before the further plugins", async () => {
    const root = await withUtilities(["./utilities/workshop"]);
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, JSON.stringify({ ...config, plugins: ["bundled:hazard"], stylePack: "./utilities/plain" }));
    const manifestPath = path.join(root, "utilities", "plain", "sc2-adjutant-plugin.json");
    await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(await readFile(manifestPath, "utf8")), roles: ["style-pack"] }));
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect((reply.structuredContent as { plugins: { name: string }[] }).plugins.map(({ name }) => name)).toEqual(["plain", "workshop", "hazard"]);
  });

  it("doesn't load a Utility the Workspace doesn't list, though its folder is in the Workspace", async () => {
    const root = await withUtilities(["./utilities/sketcher"]);
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect((reply.structuredContent as { plugins: { name: string }[] }).plugins.map(({ name }) => name)).toEqual(["sketcher"]);
  });

  it("loads a Plugin declaring the utility role that is named in plugins, since no role requires its slot", async () => {
    const root = await withUtilities([]);
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, "utf8")), plugins: ["./utilities/sketcher"] }));
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();
    const { plugins } = reply.structuredContent as { plugins: { name: string; roles: string[] }[] };
    expect(plugins.map(({ name, roles }) => ({ name, roles }))).toEqual([{ name: "sketcher", roles: ["utility"] }]);
  });

  it("refuses a Plugin listed as a Utility whose manifest doesn't declare the utility role", async () => {
    const root = await withUtilities(["./utilities/sketcher", "./utilities/plain"]);
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(withCore("Plugin plain (./utilities/plain) is named as a Utility (in utilities) but its manifest doesn't declare that role"));
  });

  it("shows each skill by the name it's copied as, its Plugin's name first, so two Plugins' skills of one folder name both load", async () => {
    const root = await withUtilities(["./utilities/sketcher", "./utilities/workshop"]);
    for (const name of ["sketcher", "workshop"]) await withSkills(root, name, name, ["draw"]);
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();
    const { plugins } = reply.structuredContent as { plugins: { name: string; contributions: { skills: string[] } }[] };
    expect(plugins.map(({ name, contributions }) => ({ name, skills: contributions.skills }))).toEqual([
      { name: "sketcher", skills: ["sketcher-draw"] },
      { name: "workshop", skills: ["workshop-draw"] },
    ]);
    expect(text(reply)).toMatch(/^sketcher .*; skills: sketcher-draw$/m);
  });

  it("refuses two Plugins' skills copied as one name, one Plugin's too, and a skill folder without a SKILL.md", async () => {
    const root = await withUtilities(["./utilities/sketcher", "./utilities/workshop"]);
    await withSkills(root, "sketcher", "sketch", ["kit-draw"]);
    await withSkills(root, "workshop", "sketch-kit", ["draw"]);
    const client = await connect(root);
    const clash = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(clash.isError).toBe(true);
    expect(text(clash)).toBe(withCore("Plugin sketch-kit (./utilities/workshop) contributes the skill draw, copied as sketch-kit-draw, which Plugin sketch's skill kit-draw is copied as too"));

    await withSkills(root, "workshop", "workshop", ["draw", "workshop-draw"]);
    const own = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(text(own)).toBe(withCore("Plugin workshop (./utilities/workshop): its skills draw and workshop-draw are both copied as workshop-draw"));

    await withSkills(root, "workshop", "@_", ["draw"]);
    const nameless = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(text(nameless)).toBe(withCore("Plugin @_ (./utilities/workshop): contributions.skills.0 skills/draw: it would be copied as -draw, and a skill's name is at most 64 lowercase letters, digits and hyphens, starting with a letter or digit"));

    await withSkills(root, "workshop", "workshop", ["draw"]);
    await rm(path.join(root, "utilities", "workshop", "skills", "draw", "SKILL.md"));
    const empty = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(text(empty)).toBe(withCore("Plugin workshop (./utilities/workshop): contributions.skills.0 skills/draw holds no SKILL.md"));
  });

  it("refuses a Plugin built for an incompatible plugin API version, naming both versions", async () => {
    const root = await tempFolder();
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./future"] }));
    await mkdir(path.join(root, "future"));
    await writeFile(path.join(root, "future", "sc2-adjutant-plugin.json"), JSON.stringify({ name: "future", version: "9.0.0", pluginApi: 3 }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/Plugin future \(\.\/future .*\) is built for plugin API version 3, but this sc2-adjutant provides version 2/);
  });
});

describe("compile_map", () => {
  it("writes a Map Package for a Mission in the Workspace, beside its Blueprint, with its compile record", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } });
    const outputDir = path.join(root, "missions", "lava-field", "Lava-Field.SC2Map");
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ outputDir, warnings: [] });
    expect(text(reply)).toContain(`Compiled Lava Field to ${outputDir}`);
    expect(await readdir(outputDir)).toEqual(expect.arrayContaining(["ComponentList.SC2Components", "DocumentHeader", "MapInfo", "MapScript.galaxy", "Triggers"]));
    expect(await readFile(path.join(outputDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8")).toContain("Lava Field");
    // Committed with the Blueprint, as is the record of what the compile wrote.
    expect(await readFile(path.join(root, "missions", "lava-field", "compile-record.json"), "utf8")).toContain('"kind":"file","path":"MapInfo"');
  });

  it("compiles one Mission twice at once without the two interleaving", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const replies = await Promise.all([1, 2].map(() => client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } })));
    expect(replies.map((reply) => reply.isError ?? false)).toEqual([false, false]);
    expect(await readdir(path.join(root, "missions", "lava-field", "Lava-Field.SC2Map"))).toContain("MapScript.galaxy");
  });

  it("writes to the folder it's given, relative to the Workspace root", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", outputDir: "build/Lava.SC2Map" } });
    expect(reply.structuredContent).toMatchObject({ outputDir: path.join(root, "build", "Lava.SC2Map") });
    expect(await readdir(path.join(root, "build", "Lava.SC2Map"))).toContain("MapScript.galaxy");

    const dotted = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", outputDir: "..build/Lava.SC2Map" } });
    expect(dotted.isError).toBeFalsy();
    expect(await readdir(path.join(root, "..build", "Lava.SC2Map"))).toContain("MapScript.galaxy");
  });

  it("with copy, compiles into a copy of the committed package, keeping its Kept Content and leaving it and its record alone", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } });
    const mission = path.join(root, "missions", "lava-field");
    const objects = path.join(mission, "Lava-Field.SC2Map", "Objects");
    const kept = `    <ObjectDoodad Id="4444" Position="10,10,8" Rotation="0" Scale="1,1,1" Type="Rock"/>`;
    await writeFile(objects, (await readFile(objects, "utf8")).replace("</PlacedObjects>", `${kept}\n</PlacedObjects>`));
    const committed = [await readFile(objects, "utf8"), await readFile(path.join(mission, "compile-record.json"), "utf8")];

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", outputDir: "missions/lava-field/output/1/Lava-Field-a-b.SC2Map", copy: true } });
    const copy = path.join(mission, "output", "1", "Lava-Field-a-b.SC2Map");
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ outputDir: copy });
    expect(await readFile(path.join(copy, "Objects"), "utf8")).toContain(kept);
    expect((await readdir(path.join(mission, "output", "1"))).sort()).toEqual(["Lava-Field-a-b.SC2Map", "Lava-Field-a-b.compile-record.json", "Lava-Field-a-b.copy.json"].sort());
    expect([await readFile(objects, "utf8"), await readFile(path.join(mission, "compile-record.json"), "utf8")]).toEqual(committed);

    const bare = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", copy: true } });
    expect(bare.isError).toBe(true);
    expect(text(bare)).toMatch(/copy needs an outputDir/);
  });

  it("refuses an output folder outside the Workspace", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    await symlink(await tempFolder(), path.join(root, "elsewhere"));
    for (const outputDir of ["../Lava.SC2Map", path.join(tmpdir(), "Lava.SC2Map"), ".", "elsewhere/Lava.SC2Map"]) {
      const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", outputDir } });
      expect(reply.isError).toBe(true);
      expect(text(reply)).toBe(`The output folder ${outputDir} must be a folder inside the Workspace ${root}`);
    }
  });

  it("refuses a Mission name that is a path", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "../field/missions/lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^No Mission \.\.\/field\/missions\/lava-field in the Workspace's missions folder /);
  });

  it("names the Blueprint and the setting when the Blueprint is invalid", async () => {
    const root = await copyOf("field");
    const blueprintPath = path.join(root, "missions", "lava-field", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint.mechanics[0].params.warningSecs = 5;
    await writeFile(blueprintPath, JSON.stringify(blueprint));
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(`Invalid Mission Blueprint ${blueprintPath}: mechanics.0.params: Unrecognized key: "warningSecs"`);
  });

  it("names the Workspace's Missions when it's asked for one it doesn't have", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-feild" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(`No Mission lava-feild in the Workspace's missions folder ${path.join(fixture("field"), "missions")} (its Missions: lava-field)`);
  });
});

/** Names the Workspace's talk-pack Plugin as its Campaign Pack. */
async function withCampaignPack(root: string): Promise<string> {
  await writeFile(
    path.join(root, "sc2-adjutant.workspace.json"),
    JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./plugins/talk-pack", mods: ["talk-story"] }),
  );
  return root;
}

/**
 * A Workspace whose config lists `utilities`, holding three Plugin folders: the Utilities sketcher
 * and workshop, and plain, which declares no role.
 */
async function withUtilities(utilities: readonly string[]): Promise<string> {
  const root = await tempFolder();
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, utilities }));
  const plugins = [
    { name: "sketcher", roles: ["utility"] },
    { name: "workshop", roles: ["utility"] },
    { name: "plain", roles: [] },
  ];
  for (const { name, roles } of plugins) {
    await mkdir(path.join(root, "utilities", name), { recursive: true });
    await writeFile(path.join(root, "utilities", name, "sc2-adjutant-plugin.json"), JSON.stringify({ name, version: "0.1.0", pluginApi: 2, roles }));
  }
  return root;
}

/** Makes the Plugin folder `utilities/<folder>` a Utility named `name` contributing a skill folder of each of `skills`. */
async function withSkills(root: string, folder: string, name: string, skills: readonly string[]): Promise<void> {
  const plugin = path.join(root, "utilities", folder);
  for (const skill of skills) {
    await mkdir(path.join(plugin, "skills", skill), { recursive: true });
    await writeFile(path.join(plugin, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: Draws.\n---\n`);
  }
  await writeFile(path.join(plugin, "sc2-adjutant-plugin.json"), JSON.stringify({ name, version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills: skills.map((skill) => `skills/${skill}`) } }));
}

/** The compiled Outpost's dialogue data. */
async function dialogueOf(outputDir: string) {
  const read = (...parts: string[]) => readFile(path.join(outputDir, ...parts), "utf8");
  return {
    conversations: await read("Base.SC2Data", "GameData", "ConversationData.xml"),
    sounds: await read("Base.SC2Data", "GameData", "SoundData.xml"),
    strings: await read("enUS.SC2Data", "LocalizedData", "ConversationStrings.txt"),
    voices: await readdir(path.join(outputDir, "Assets", "Sounds", "Conversations")),
    galaxy: await read("MapScript.galaxy"),
  };
}

describe("compile_map on a Mission with a Screenplay", () => {
  const outputDir = (root: string) => path.join(root, "missions", "outpost", "Outpost.SC2Map");

  it("names the conversation, lines and sounds by mission id, scene and line without a naming template", async () => {
    const root = await copyOf("screenplay");
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "outpost" } });
    expect(text(reply)).toContain("Compiled Outpost");
    const { conversations, sounds, strings, voices, galaxy } = await dialogueOf(outputDir(root));
    expect(conversations).toContain('<CConversation id="outpost">');
    expect(conversations).toContain('<Id value="Line1-1"/>');
    expect(conversations).toContain('<Text value="Conversation/outpost/Line1-2"/>');
    expect(conversations).toContain('<SpeakerCharacter value="MattHorner"/>');
    expect(sounds).toContain('<CSound id="outpost-1-1" parent="Campaign2D" Subtitle="outpost" Speaker="Raynor" Actor="" Line="1-1">');
    expect(sounds).toContain('<File value="Assets\\Sounds\\Conversations\\outpost-1-2.wav"/>');
    expect(strings).toContain("Conversation/outpost/Line1-1=Hold here until the convoy comes.");
    expect(voices.sort()).toEqual(["outpost-1-1.wav", "outpost-1-2.wav"]);
    // No characters: each Transmission names its speaker and shows no source.
    expect(galaxy.match(/TransmissionSendForPlayerSelect\(PlayerGroupAll\(\), TransmissionSource\(\), /g)).toHaveLength(2);
    expect(galaxy).toContain('SoundLink("outpost-1-1", -1)');
  });

  it("names them with the Campaign Pack's naming template, and shows the Campaign Mod's characters", async () => {
    const root = await withCampaignPack(await copyOf("screenplay"));
    const audio = path.join(root, "missions", "outpost", "audio");
    for (const id of ["Ch3_outpost_S1_L1", "Ch3_outpost_S1_L2"]) await writeFile(path.join(audio, `${id}.wav`), `${id}\n`);
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "outpost" } });
    expect(text(reply)).toContain("Compiled Outpost");
    const { conversations, sounds, voices, galaxy } = await dialogueOf(outputDir(root));
    expect(conversations).toContain('<CConversation id="Ch3_outpost">');
    // The template gives no lineId, so core's default names the lines.
    expect(conversations).toContain('<Text value="Conversation/Ch3_outpost/Line1-1"/>');
    // The Screenplay writes "Matt Horner"; the character is "MATT HORNER".
    expect(conversations).toContain('<SpeakerCharacter value="StockHorner"/>');
    expect(sounds).toContain('<CSound id="Ch3_outpost_S1_L2" parent="Campaign2D" Subtitle="Ch3_outpost" Speaker="StockHorner" Actor="" Line="1-2">');
    expect(voices.sort()).toEqual(["Ch3_outpost_S1_L1.wav", "Ch3_outpost_S1_L2.wav"]);
    expect(galaxy).toContain('TransmissionSourceFromUnitType("Raynor", false)');
    expect(galaxy).toContain('TransmissionSourceFromModel("HornerPortrait")');
  });

  it("refuses a naming template from a Plugin that isn't the Campaign Pack", async () => {
    const root = await copyOf("screenplay");
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./plugins/talk-pack"] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "outpost" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(
      "Plugin talk-pack (./plugins/talk-pack) contributes a naming template, a Screenplay Source or a Campaign Mod name, which only the Workspace's Campaign Pack can: name it as the campaignPack",
    );
  });
});

describe("check_layout", () => {
  it("returns the layout checker's report on a Mission", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "check_layout", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    const { checks } = reply.structuredContent as { checks: { id: string; status: string; findings: string[] }[] };
    expect(checks.find((check) => check.id === "hazard-retreat")).toMatchObject({
      status: "warn",
      findings: ["Threat lava: no ground way to safe ground from Field."],
    });
    expect(text(reply)).toContain("Layout check: Lava Field\n");
    expect(text(reply)).toContain(
      "! hazard-retreat: Each Threat warns long enough to reach safe ground [warn; ADR 0004; ADR 0006; ARCHETYPES.md]\n    Threat lava: no ground way to safe ground from Field.",
    );
    expect(text(reply)).toContain("2 pass, 2 warn, 0 info, 16 not evaluated.");
  });

  it("reads a Plugin Mechanic's Threat like any other", async () => {
    const root = await copyOf("field");
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { plugins: string[] };
    await writeFile(configPath, JSON.stringify({ ...config, plugins: [...config.plugins, path.join(fixture("field"), "plugins", "searchlight")] }));
    const blueprintPath = path.join(root, "missions", "lava-field", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { mechanics: object[] };
    const hazardRetreat = async () => {
      const reply = await (await connect(root)).callTool({ name: "check_layout", arguments: { mission: "lava-field" } });
      const { checks } = reply.structuredContent as { checks: { id: string; findings: string[] }[] };
      return checks.find((check) => check.id === "hazard-retreat")!.findings;
    };
    expect(await hazardRetreat()).toEqual(["Threat lava: no ground way to safe ground from Field."]);

    const searchlight = { id: "beam", type: "searchlight", params: { sweepsZoneId: "cave", checkpointZoneId: "field", everySeconds: 30, warningSeconds: 6 } };
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, mechanics: [...blueprint.mechanics, searchlight] }));
    expect(await hazardRetreat()).toEqual(["Threat lava: no ground way to safe ground from Field.", "Threat beam: no ground way to safe ground from Cave."]);

    // A setback with no checkpoint at all strands every zone it sweeps.
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, mechanics: [{ ...searchlight, params: { sweepsZoneId: "field", everySeconds: 30, warningSeconds: 6 } }] }));
    expect(await hazardRetreat()).toEqual(["Threat beam: no ground way to safe ground from Field."]);
  });
});

describe("check_layout on Schedules and Connection changes", () => {
  type Check = { id: string; status: string; findings: string[] };

  /** The checks for a Mission of the tides Workspace, with its Mechanic's params changed when `params` is given. */
  async function checksOf(mission: string, params?: Record<string, unknown>): Promise<Check[]> {
    let root = fixture("tides");
    if (params) {
      root = await copyOf("tides");
      const blueprintPath = path.join(root, "missions", mission, "blueprint.json");
      const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { mechanics: { params: object }[] };
      const [entry] = blueprint.mechanics;
      await writeFile(blueprintPath, JSON.stringify({ ...blueprint, mechanics: [{ ...entry, params: { ...entry!.params, ...params } }] }));
    }
    const reply = await (await connect(root)).callTool({ name: "check_layout", arguments: { mission } });
    expect(reply.isError, text(reply)).toBeFalsy();
    return (reply.structuredContent as { checks: Check[] }).checks;
  }
  const check = (checks: Check[], id: string) => checks.find((candidate) => candidate.id === id)!;

  it("reports a trap when the tide floods the ford off low ground it threatens on the same Schedule", async () => {
    const checks = await checksOf("ford");
    expect(check(checks, "closing-traps")).toEqual(
      expect.objectContaining({
        status: "warn",
        findings: ["Mechanic tide closes Flats ↔ Bank on a cycle, while Threat tide can be active: Flats then has no ground way to safe ground (Bank)."],
      }),
    );
    // With the ford open, the retreat is in time.
    expect(check(checks, "hazard-retreat")).toMatchObject({
      status: "pass",
      findings: ["Threat tide: the worst retreat is about 10 s (32 cells) from Flats, against 15 s of warning (the water starts to rise)."],
    });
  });

  it("finds no trap when the low ground has another way to safety", async () => {
    expect(check(await checksOf("ford", { safeZoneIds: ["bank", "dunes"] }), "closing-traps")).toMatchObject({ status: "pass", findings: [] });
  });

  it("closes together what one Mechanic changes on one Schedule", async () => {
    const checks = await checksOf("ford", { safeZoneIds: ["bank", "dunes"], alsoFloods: [{ fromZoneId: "flats", toZoneId: "dunes" }] });
    expect(check(checks, "closing-traps").findings).toEqual([
      "Mechanic tide closes Flats ↔ Bank and closes Flats ↔ Dunes on a cycle, while Threat tide can be active: Flats then has no ground way to safe ground (Bank, Dunes).",
    ]);
  });

  it("doesn't count a way out that isn't open yet", async () => {
    const root = await copyOf("tides");
    const blueprintPath = path.join(root, "missions", "ford", "blueprint.json");
    type Zone = { id: string; connections: { toZoneId: string; opensAtBeat?: string }[] };
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { zones: Zone[]; beats: object[]; mechanics: { params: object }[] };
    // The dunes are safe too, but the way there opens only in the second Beat.
    const zones = blueprint.zones.map((zone) => ({
      ...zone,
      connections: zone.connections.map((connection) => (connection.toZoneId === "dunes" || zone.id === "dunes" ? { ...connection, opensAtBeat: "ebb" } : connection)),
    }));
    const [entry] = blueprint.mechanics;
    await writeFile(
      blueprintPath,
      JSON.stringify({
        ...blueprint,
        zones,
        beats: [...blueprint.beats, { id: "ebb", title: "Ebb", summary: "The tide goes out." }],
        mechanics: [{ ...entry, params: { ...entry!.params, safeZoneIds: ["bank", "dunes"] } }],
      }),
    );
    const reply = await (await connect(root)).callTool({ name: "check_layout", arguments: { mission: "ford" } });
    const { checks } = reply.structuredContent as { checks: Check[] };
    expect(check(checks, "closing-traps").findings).toEqual([
      "Mechanic tide closes Flats ↔ Bank on a cycle, while Threat tide can be active: Flats then has no ground way to safe ground (Bank, Dunes).",
    ]);
  });

  it("reads the change and the Threat on any Schedule, from a Beat or while a Mechanic's state holds", async () => {
    const trap = async (schedule: object) => check(await checksOf("ford", { schedule }), "closing-traps").findings;
    expect(await trap({ kind: "from-beat", beatId: "rising" })).toEqual([
      "Mechanic tide closes Flats ↔ Bank from \"Rising\", while Threat tide can be active: Flats then has no ground way to safe ground (Bank).",
    ]);
    // A while Schedule follows the Mechanic that gives it unless it names another.
    expect(await trap({ kind: "while", state: "high" })).toEqual([
      "Mechanic tide closes Flats ↔ Bank while tide is high, while Threat tide can be active: Flats then has no ground way to safe ground (Bank).",
    ]);
  });

  it("refuses a Schedule that names a Beat or a Mechanic the Blueprint doesn't have", async () => {
    const replyFor = async (schedule: object) => {
      const root = await copyOf("tides");
      const blueprintPath = path.join(root, "missions", "ford", "blueprint.json");
      const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { mechanics: { params: object }[] };
      const [entry] = blueprint.mechanics;
      await writeFile(blueprintPath, JSON.stringify({ ...blueprint, mechanics: [{ ...entry, params: { ...entry!.params, schedule } }] }));
      return (await connect(root)).callTool({ name: "check_layout", arguments: { mission: "ford" } });
    };
    expect(text(await replyFor({ kind: "while", mechanicId: "moon", state: "full" }))).toContain(
      "Mechanic mechanics.0 (tide, type tide from Plugin tide): its connectionChanges hook gave a bad change 0: unknown mechanic id moon",
    );
    expect(text(await replyFor({ kind: "cycle", firstSeconds: 0, steps: [{ fromBeatId: "ebb" }] }))).toContain("its connectionChanges hook gave a bad change 0: unknown beat id ebb");
    expect(text(await replyFor({ kind: "from-beat", beatId: "rising", untilBeatId: "rising" }))).toContain(
      "its connectionChanges hook gave a bad change 0: untilBeatId rising doesn't come after the Beat it starts from",
    );
    // A patrol walks a route, and the tide's footprint is Zones.
    expect(text(await replyFor({ kind: "patrol", speed: 2 }))).toContain(
      "its threats hook gave a bad Threat 0: schedule: A patrol Schedule walks a route: give the footprint a route and a radius",
    );
  });

  it("refuses a Connection change on a Connection the Blueprint doesn't declare", async () => {
    const root = await copyOf("tides");
    const blueprintPath = path.join(root, "missions", "ford", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { mechanics: { params: object }[] };
    const [entry] = blueprint.mechanics;
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, mechanics: [{ ...entry, params: { ...entry!.params, ford: { fromZoneId: "bank", toZoneId: "dunes" } } }] }));
    const reply = await (await connect(root)).callTool({ name: "check_layout", arguments: { mission: "ford" } });
    // The checks that read the changes report it as not evaluated; the others still run (#129).
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain(
      "Mechanic mechanics.0 (tide, type tide from Plugin tide): its connectionChanges hook gave a bad change 0: the Blueprint declares no connection from bank to dunes",
    );
  });

  it("gives a setback patrol on a route window-versus-crossing and checkpoint-spacing results", async () => {
    const checks = await checksOf("yard");
    // 28 cells there, less 8 of sight, at 2 cells/s: 10 s between passes at the middle of the route.
    expect(check(checks, "hazard-retreat")).toMatchObject({
      status: "pass",
      findings: [
        "Threat guard: crossing its 8-cell sight takes about 3 s, against about 10 s between passes. The setback band (1×) is a placeholder until a stealth mission's patrols are studied.",
      ],
    });
    expect(check(checks, "checkpoint-spacing")).toMatchObject({
      status: "info",
      findings: ["Threat guard: caught at worst in Yard, about 6 s (20 cells) from its checkpoint (Gate)."],
    });
  });

  it("warns when a patrol passes too often to slip across, or names no checkpoint", async () => {
    const fast = await checksOf("yard", { speed: 10 });
    expect(check(fast, "hazard-retreat")).toMatchObject({
      status: "warn",
      findings: [
        "Threat guard: crossing its 8-cell sight takes about 3 s, so the band is a window of at least 3 s; it leaves about 2 s between passes. The setback band (1×) is a placeholder until a stealth mission's patrols are studied.",
      ],
    });
    // A pause at each end of the route gives the player the time back.
    expect(check(await checksOf("yard", { speed: 10, pauseSeconds: 2 }), "hazard-retreat").status).toBe("pass");
    expect(check(await checksOf("yard", { checkpointZoneId: undefined }), "checkpoint-spacing")).toMatchObject({
      status: "warn",
      findings: ["Threat guard sends the player back to a checkpoint, but names none."],
    });
  });
});

describe("knowledge resources", () => {
  const uri = (id: string) => `sc2-adjutant://plugins/example-pack/knowledge/${id}`;

  it("lists the active Style Pack's knowledge, Exemplar Maps, Map Studies and Doodad Composites", async () => {
    const client = await connect(fixture("field"));
    const { resources } = await client.listResources();
    expect(resources.map(({ uri, name, title, mimeType }) => ({ uri, name, title, mimeType }))).toEqual([
      { uri: uri("palette"), name: "example-pack/palette", title: "Palette", mimeType: "text/markdown" },
      { uri: uri("exemplar-maps"), name: "example-pack/exemplar-maps", title: "Exemplar Maps", mimeType: "application/json" },
      { uri: uri("study-ridge"), name: "example-pack/study-ridge", title: "Map Study: ridge", mimeType: "application/json" },
      { uri: uri("composites"), name: "example-pack/composites", title: "Doodad Composites", mimeType: "application/json" },
    ]);
    expect(resources[0]!.description).toBe("Which textures the example pack likes.");
  });

  it("reads a knowledge document", async () => {
    const client = await connect(fixture("field"));
    const { contents } = await client.readResource({ uri: uri("palette") });
    expect(contents).toEqual([{ uri: uri("palette"), mimeType: "text/markdown", text: "# Palette\n\nSand on the plains, basalt on the heights.\n" }]);
  });

  it("reads an Exemplar Map's Map Study and the pack's list of Exemplar Maps", async () => {
    const client = await connect(fixture("field"));
    const study = await client.readResource({ uri: uri("study-ridge") });
    expect(JSON.parse((study.contents[0] as { text: string }).text)).toMatchObject({ exemplar: { id: "ridge", provenance: "made" } });
    const list = await client.readResource({ uri: uri("exemplar-maps") });
    expect(JSON.parse((list.contents[0] as { text: string }).text).exemplars.map((e: { id: string }) => e.id)).toEqual(["ridge", "dunes"]);
  });

  it("names the Plugin's documents when asked for one it doesn't have", async () => {
    const client = await connect(fixture("field"));
    await expect(client.readResource({ uri: uri("palete") })).rejects.toThrow(
      "Plugin example-pack has no knowledge document palete (its documents: palette, exemplar-maps, study-ridge, composites)",
    );
  });

  it("refuses a knowledge file outside its Plugin's folder", async () => {
    const root = await copyOf("field");
    const manifestPath = path.join(root, "plugins/example-pack/sc2-adjutant-plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.contributions.knowledge[0].file = "../../sc2-adjutant.workspace.json";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const client = await connect(root);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(
      withCore("Plugin example-pack (./plugins/example-pack): contributions.knowledge.0.file ../../sc2-adjutant.workspace.json must be a file inside the Plugin's folder"),
    );
  });

  it("refuses a knowledge file that is a symlink out of its Plugin's folder", async () => {
    const root = await copyOf("field");
    const palette = path.join(root, "plugins/example-pack/knowledge/palette.md");
    await rm(palette);
    await symlink(path.join(root, "sc2-adjutant.workspace.json"), palette);
    const client = await connect(root);
    await expect(client.listResources()).rejects.toThrow("contributions.knowledge.0.file knowledge/palette.md must be a file inside the Plugin's folder");
  });

  it("refuses a knowledge file that is a folder", async () => {
    const root = await copyOf("field");
    const palette = path.join(root, "plugins/example-pack/knowledge/palette.md");
    await rm(palette);
    await mkdir(palette);
    const client = await connect(root);
    await expect(client.listResources()).rejects.toThrow("contributions.knowledge.0.file knowledge/palette.md must be a file, not a folder");
  });

  it("refuses a Map Study that is a symlink out of its Plugin's folder", async () => {
    const root = await copyOf("field");
    const study = path.join(root, "plugins/example-pack/exemplars/ridge/study.json");
    await rm(study);
    await symlink(path.join(root, "sc2-adjutant.workspace.json"), study);
    const client = await connect(root);
    await expect(client.listResources()).rejects.toThrow("ridge/study.json must be a file inside the Plugin's folder");
  });
});

describe("Plugin prompts", () => {
  it("lists each Plugin's prompts with their arguments", async () => {
    const client = await connect(fixture("field"));
    const { prompts } = await client.listPrompts();
    expect(prompts).toEqual([
      {
        name: "review-look",
        title: "Review a Mission's look",
        description: "Critiques a Mission against the example pack's lessons. (From Plugin example-pack.)",
        arguments: [
          { name: "mission", description: "The Mission to review", required: true },
          { name: "focus", description: "One part of the look to review", required: false },
        ],
      },
    ]);
  });

  it("fills a prompt's text with its arguments", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.getPrompt({ name: "review-look", arguments: { mission: "lava-field", focus: "Look at the cliffs." } });
    expect(reply.messages).toEqual([
      { role: "user", content: { type: "text", text: "Review the look of Mission lava-field against the example pack's lessons. Look at the cliffs.\n" } },
    ]);
  });

  it("refuses a prompt without its required arguments, but takes an empty one", async () => {
    const client = await connect(fixture("field"));
    await expect(client.getPrompt({ name: "review-look", arguments: {} })).rejects.toThrow("Prompt review-look needs the argument mission");
    expect((await client.getPrompt({ name: "review-look", arguments: { mission: "" } })).messages).toHaveLength(1);
  });

  it("reloads the Plugins when the Workspace config changes, and not before", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual(["review-look"]);
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, JSON.stringify({ ...config, stylePack: undefined, campaignPack: undefined }));
    // A later mtime than the first load's, whatever the file system's resolution.
    await utimes(configPath, new Date(), new Date(Date.now() + 5000));
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it("refuses two Plugins contributing one prompt name", async () => {
    const root = await copyOf("field");
    await cp(path.join(root, "plugins/example-pack"), path.join(root, "plugins/twin"), { recursive: true });
    const manifestPath = path.join(root, "plugins/twin/sc2-adjutant-plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, name: "twin", roles: [], contributions: { prompts: manifest.contributions.prompts } }));
    const configPath = path.join(root, "sc2-adjutant.workspace.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, JSON.stringify({ ...config, plugins: [...config.plugins, "./plugins/twin"] }));
    const client = await connect(root);
    await expect(client.listPrompts()).rejects.toThrow("Plugin twin (./plugins/twin) contributes the prompt review-look, which Plugin example-pack already contributes");
  });
});
