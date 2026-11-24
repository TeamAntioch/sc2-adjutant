// checkWorkspace validates every Mission in a Workspace at once (the `check-workspace` CLI and the
// `check_workspace` MCP tool): the `checked` fixture Workspace has one valid Mission with a
// Screenplay, and one whose Blueprint is broken.
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeDocumentHeader } from "../../src/map/write-document-header.js";
import { checkWorkspace, formatWorkspaceCheck } from "../../src/plugins/check-workspace.js";
import { connect, fixture, tempFolder, text } from "../mcp/harness.js";

const CHECKED = fixture("checked");

async function copyOfChecked(): Promise<string> {
  const root = await tempFolder();
  await cp(CHECKED, root, { recursive: true });
  return root;
}

describe("checkWorkspace", () => {
  it("reports each problem of the broken Mission with its file and path, and passes the valid one", async () => {
    const check = await checkWorkspace(CHECKED);
    expect(check.missions).toEqual(["broken-field", "radio-field"]);
    expect(check.problems).toEqual([
      { mission: "broken-field", file: "missions/broken-field/blueprint.json", path: "beats.0.zoneIds.0", message: "Unknown zone id: cave" },
      { mission: "broken-field", file: "missions/broken-field/blueprint.json", path: "mechanics.0.params.warningSeconds", message: "Too small: expected number to be >0" },
    ]);
    expect(formatWorkspaceCheck(check).split("\n")).toEqual([
      "broken-field: missions/broken-field/blueprint.json beats.0.zoneIds.0: Unknown zone id: cave",
      "broken-field: missions/broken-field/blueprint.json mechanics.0.params.warningSeconds: Too small: expected number to be >0",
      `2 problem(s) in 1 of 2 Mission(s), in ${path.resolve(CHECKED)}.`,
    ]);
  });

  it("validates the Workspace's and each Mission's known-errors list, and warns on a placeholder reason", async () => {
    const root = await copyOfChecked();
    await rm(path.join(root, "missions/broken-field"), { recursive: true });
    const good = { match: "Cannot load font", reason: "the Mac has no Courier", added: "2026-03-01" };
    await writeFile(path.join(root, "known-errors.json"), JSON.stringify({ patterns: [good] }));
    await writeFile(path.join(root, "missions/radio-field/known-errors.json"), JSON.stringify({ patterns: [good] }));
    expect((await checkWorkspace(root)).problems).toEqual([]);

    await writeFile(path.join(root, "known-errors.json"), JSON.stringify({ patterns: [{ match: "x", added: "2026-03-01" }] }));
    await writeFile(path.join(root, "missions/radio-field/known-errors.json"), JSON.stringify({ patterns: [{ ...good, reason: "TODO(author): why this is known" }] }));
    expect((await checkWorkspace(root)).problems).toEqual([
      { file: "known-errors.json", message: expect.stringContaining("known-errors.json isn't a known-errors list: patterns.0.reason") },
      { mission: "radio-field", file: "missions/radio-field/known-errors.json", path: "patterns.0.reason", message: expect.stringContaining("placeholder"), severity: "warning" },
    ]);
  });

  it("reads each valid Mission's Screenplay, and reports one it can't read against the Screenplay's file", async () => {
    const root = await copyOfChecked();
    await rm(path.join(root, "missions/broken-field"), { recursive: true });
    expect((await checkWorkspace(root)).problems).toEqual([]);
    expect(formatWorkspaceCheck(await checkWorkspace(root))).toBe(`1 Mission(s) in ${root} are valid.`);
    await rm(path.join(root, "missions/radio-field/radio-field.md"));
    const [problem, ...rest] = (await checkWorkspace(root)).problems;
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ mission: "radio-field", file: "missions/radio-field/radio-field.md", message: expect.stringContaining("ENOENT") });
  });

  it("warns on a mod package whose DocumentHeader lists dependencies its DocumentInfo doesn't", async () => {
    const root = await tempFolder();
    await cp(fixture("screenplay"), root, { recursive: true });
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, campaignPack: "./plugins/talk-pack", mods: ["talk-story"] }));
    const headerFile = path.join(root, "mods", "talk-story", "Talk-Story.SC2Mod", "DocumentHeader");
    await writeFile(headerFile, writeDocumentHeader({ documentId: 1, attributes: {} }));
    expect((await checkWorkspace(root, { sc2Path: undefined })).problems).toEqual([]);

    await writeFile(headerFile, writeDocumentHeader({ dependencies: ["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod"], documentId: 1, attributes: {} }));
    expect((await checkWorkspace(root, { sc2Path: undefined })).problems).toEqual([
      {
        mod: "talk-story",
        file: "mods/talk-story/Talk-Story.SC2Mod/DocumentHeader",
        message: expect.stringContaining("DocumentHeader's dependencies aren't DocumentInfo's, and the game resolves them from the header. DocumentHeader lists bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod; DocumentInfo lists none: resave it in the Editor"),
        severity: "warning",
      },
    ]);
  });

  it("fails a Screenplay speaker with no character once the Campaign has a Campaign Mod, and passes when it's declared", async () => {
    const root = await tempFolder();
    await cp(fixture("screenplay"), root, { recursive: true });
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, campaignPack: "./plugins/talk-pack", mods: ["talk-story"] }));
    expect((await checkWorkspace(root)).problems).toEqual([]);

    const blueprintPath = path.join(root, "mods", "talk-story", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, characters: blueprint.characters.filter((character: { speaker: string }) => character.speaker !== "MATT HORNER") }));
    expect((await checkWorkspace(root)).problems).toEqual([
      {
        mission: "outpost",
        file: "missions/outpost/outpost.md",
        message: "The Screenplay's speaker Matt Horner (first in scene 1, line 2) has no character: declare each in the characters of the Campaign Mod Talk-Story's Blueprint (mods/talk-story/blueprint.json)",
      },
    ]);
  });

  it("fails every speaker when the Campaign Pack names a Campaign Mod the Workspace hasn't imported", async () => {
    const root = await tempFolder();
    await cp(fixture("screenplay"), root, { recursive: true });
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, campaignPack: "./plugins/talk-pack" }));
    expect((await checkWorkspace(root)).problems).toEqual([
      expect.objectContaining({ mission: "outpost", message: expect.stringContaining("the Campaign Mod Talk-Story's Blueprint, which the Workspace doesn't have: import Talk-Story.SC2Mod with import-mod") }),
    ]);
  });

  it("says why a Campaign Mod's speakers have no characters: it isn't imported, its Blueprint doesn't read, or it is an Asset Mod", async () => {
    const speakers = async (change: (root: string, blueprintPath: string) => Promise<void>) => {
      const root = await tempFolder();
      await cp(fixture("screenplay"), root, { recursive: true });
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, campaignPack: "./plugins/talk-pack", mods: ["talk-story"] }));
      await change(root, path.join(root, "mods", "talk-story", "blueprint.json"));
      return (await checkWorkspace(root)).problems.filter((problem) => problem.mission === "outpost").map((problem) => problem.message);
    };

    // The Workspace has mods, but none of them is Talk-Story.
    const notImported = await speakers((root) => rename(path.join(root, "mods", "talk-story", "Talk-Story.SC2Mod"), path.join(root, "mods", "talk-story", "Other-Story.SC2Mod")));
    expect(notImported).toEqual([expect.stringContaining("the Campaign Mod Talk-Story's Blueprint, which the Workspace doesn't have: import Talk-Story.SC2Mod with import-mod")]);

    // Talk-Story is there, but its Blueprint doesn't read: the reason is the Blueprint's.
    const unreadable = await speakers((_root, blueprintPath) => writeFile(blueprintPath, "{ not json"));
    expect(unreadable).toEqual([expect.stringMatching(/the Campaign Mod Talk-Story's Blueprint \(mods\/talk-story\/blueprint\.json\), which can't be read: Can't read the Mod Blueprint .*blueprint\.json: /)]);

    // Talk-Story is an Asset Mod, which declares no characters.
    const asset = await speakers(async (_root, blueprintPath) => {
      const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
      await writeFile(blueprintPath, JSON.stringify({ ...blueprint, kind: "asset", characters: [] }));
    });
    expect(asset).toEqual([expect.stringContaining("a Campaign Mod's Blueprint, but Talk-Story (mods/talk-story/blueprint.json), named as the Campaign Mod, is an Asset Mod: make it a Campaign Mod")]);
  });

  it("reports a Workspace that won't load, rather than throwing", async () => {
    const root = await copyOfChecked();
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, plugins: ["bundled:nothing"] }));
    const check = await checkWorkspace(root);
    expect(check.missions).toEqual([]);
    expect(check.problems).toEqual([{ file: "sc2-adjutant.workspace.json", message: expect.stringContaining("No bundled Plugin bundled:nothing") }]);
    expect(formatWorkspaceCheck(check)).toMatch(/\n1 problem\(s\) in the Workspace /);
  });
});

describe("check_workspace", () => {
  it("replies with the same report, as an error when there are problems", async () => {
    const reply = await (await connect(CHECKED)).callTool({ name: "check_workspace", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toBe(formatWorkspaceCheck(await checkWorkspace(CHECKED)));
    expect(reply.structuredContent).toMatchObject({ missions: ["broken-field", "radio-field"], problems: [{ mission: "broken-field", path: "beats.0.zoneIds.0" }, { path: "mechanics.0.params.warningSeconds" }] });
  });

  it("isn't an error for a Workspace whose Missions are all valid", async () => {
    const root = await copyOfChecked();
    await rm(path.join(root, "missions/broken-field"), { recursive: true });
    const reply = await (await connect(root)).callTool({ name: "check_workspace", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ missions: ["radio-field"], problems: [] });
  });
});
