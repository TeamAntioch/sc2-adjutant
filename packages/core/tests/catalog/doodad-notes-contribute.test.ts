// Contributing the Workspace's doodad notes to sc2-asset-catalog (src/catalog/doodad-notes-contribute.ts):
// the game doodads' Doodad Uses go into the public repo's per-doodad uses files, and their look
// corrections into its descriptions file, on a branch, with a changeset, and a pull request is opened
// on TeamAntioch/sc2-asset-catalog, from a checkout of it or a fresh clone. Over a synthetic
// checkout, with git and gh faked: no command runs, nothing is pushed and no pull request is opened.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { type CommandRunner, contributeDoodadNotes, type ContributeOptions } from "../../src/catalog/doodad-notes-contribute.js";
import { readDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import type { ModKnownDoodads } from "../../src/catalog/mod-doodad-notes.js";

const STAMPER = { look: "heavy steel press head on a piston", kind: "built", size: "medium", role: "prop", story: ["industry"], biome: ["urban"] } as const;
const BELT = { look: "long grey conveyor belt on legs", kind: "built", size: "large", role: "prop", story: ["industry"], biome: ["any"] } as const;
const PIT = { look: "sunken pit under a press", kind: "built", story: ["industry"], biome: ["urban"] } as const;
const DATA = "packages/sc2-asset-catalog/data";
const DESCRIPTIONS = `${DATA}/doodad-descriptions.json`;
const USES = `${DATA}/doodad-uses`;
const STAMPER_USES = [{ use: "press head", scale: 0.6 }];
const REPO = "TeamAntioch/sc2-asset-catalog";

/** What the running core knows from the installed package: the stamper's uses, the frame (undescribed), and a Campaign Mod doodad. */
const KNOWN: ModKnownDoodads = {
  doodads: {
    FoundryPressFrame: { variations: 1 },
    FoundryStamperHead: { variations: 1, description: STAMPER, uses: STAMPER_USES },
    FoundryBeltLong: { variations: 1, description: BELT },
  },
  terrainObjects: { FoundryPressPit0: { package: "campaigns/liberty.sc2campaign", model: "Assets/TerrainObjects/FoundryPressPit/FoundryPressPit.m3", description: PIT } },
  mod: { ...EMPTY_CATALOG, doodads: new Map([["LanternPressRig", {}]]) },
};

/** The Workspace's story, in synthetic names: a Mission, its title and a character. */
const STORY_NAMES = ["tides-0101", "Lantern Run", "ORLA VANCE", "Glass Tides"];

const NOTES = {
  doodads: {
    FoundryStamperHead: { uses: ["Press Head", { use: "stamping die", variation: 2, from: "crushing-press search, 2026-11-09" }] },
    FoundryBeltLong: { uses: [{ use: "parts conveyor under a press", scale: 1.5 }], look: "long grey conveyor belt on steel legs" },
    FoundryPressFrame: { uses: ["gantry over a conveyor"] },
    FoundryPressPit0: { uses: ["crusher pit under a belt"] },
    LanternPressRig: { uses: ["hanging lamp rig"] },
  },
};

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
const temp = async (): Promise<string> => {
  const folder = await mkdtemp(path.join(tmpdir(), "doodad-notes-contribute-"));
  folders.push(folder);
  return folder;
};
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** A synthetic sc2-asset-catalog checkout: the package, its descriptions (the stamper's and the belt's) and the stamper's uses file. */
async function writeCatalogCheckout(checkout: string): Promise<void> {
  await mkdir(path.join(checkout, USES, "doodads"), { recursive: true });
  await mkdir(path.join(checkout, ".changeset"), { recursive: true });
  await writeFile(path.join(checkout, "packages/sc2-asset-catalog/package.json"), JSON.stringify({ name: "@team-antioch/sc2-asset-catalog" }));
  await writeFile(path.join(checkout, DESCRIPTIONS), json({ FoundryBeltLong: BELT, FoundryStamperHead: STAMPER }));
  await writeFile(path.join(checkout, USES, "doodads/FoundryStamperHead.json"), json(STAMPER_USES));
}

/** A Workspace with the notes, and a checkout of sc2-asset-catalog. */
async function setUp(notes: unknown = NOTES) {
  const workspace = await temp();
  await writeFile(path.join(workspace, "doodad-notes.json"), JSON.stringify(notes));
  const checkout = await temp();
  await writeCatalogCheckout(checkout);
  const read = (file: string) => readFile(path.join(checkout, file), "utf8").catch(() => undefined);
  return { workspace, checkout, read };
}

type Opened = { readonly repo: string; readonly title: string; readonly body: string; readonly files: Readonly<Record<string, string>> };

/**
 * A fake git and gh that record each command; `fail` names commands (by their first two or three words,
 * or whole) that fail. `gh repo clone` writes a synthetic checkout where it's told; `gh pr create`
 * records the pull request it would open, with the files the last `git add` staged as they then
 * were. `detached` puts the checkout on a detached HEAD at that commit; `onBranch` runs once the new
 * branch is switched to, as if origin/main's files came in. `openPulls` are the repo's open pull requests.
 */
function fakeCommands({
  fail = [],
  status = "",
  detached,
  onBranch,
  origin = "git@github.com:TeamAntioch/sc2-asset-catalog.git",
  openPulls = [],
}: { fail?: readonly string[]; status?: string; detached?: string; onBranch?: () => Promise<void>; origin?: string; openPulls?: readonly { headRefName: string; url: string }[] } = {}) {
  const ran: string[] = [];
  const opened: Opened[] = [];
  /** Every argument of every command, and every file a pull request carried: all that is sent. */
  const sent = () => [...ran, ...opened.flatMap(({ files }) => Object.entries(files).flat())].join("\n");
  let staged: { cwd: string; files: string[] } = { cwd: "", files: [] };
  const run: CommandRunner = async (command, args, cwd) => {
    const line = [command, ...args].join(" ");
    ran.push(line);
    if (fail.includes([command, args[0]].join(" ")) || fail.includes([command, ...args.slice(0, 2)].join(" ")) || fail.includes(line)) throw new Error(`${line} failed`);
    const value = (flag: string) => args[args.indexOf(flag) + 1]!;
    if (command === "gh" && args[0] === "repo" && args[1] === "clone") await writeCatalogCheckout(args[3]!);
    if (command === "git" && args[0] === "switch" && args[1] === "-c") await onBranch?.();
    if (command === "git" && args[0] === "status") return status;
    if (command === "git" && args[0] === "remote") return `${origin}\n`;
    if (command === "git" && args[0] === "rev-parse") return detached ? (args[1] === "--abbrev-ref" ? "HEAD\n" : `${detached}\n`) : "work\n";
    if (command === "git" && args[0] === "add") staged = { cwd, files: args.slice(1) };
    if (command === "gh" && args[0] === "pr" && args[1] === "list") return JSON.stringify(openPulls);
    if (command === "gh" && args[0] === "pr" && args[1] === "create") {
      const files = Object.fromEntries(await Promise.all(staged.files.map(async (file) => [file, await readFile(path.join(staged.cwd, file), "utf8")] as const)));
      opened.push({ repo: value("--repo"), title: value("--title"), body: value("--body"), files });
      return `Creating pull request for ${value("--head")} into main in ${REPO}\n\nhttps://github.com/${REPO}/pull/42\n`;
    }
    return "";
  };
  return { run, ran, opened, sent };
}

const NOW = new Date("2026-11-08T15:30:00Z");
const BRANCH = "doodad-uses/20261108-153000";
const options = (rest: Partial<ContributeOptions>): ContributeOptions => ({ known: KNOWN, storyNames: STORY_NAMES, now: NOW, ...rest });

describe("contributeDoodadNotes", () => {
  it("opens a pull request on sc2-asset-catalog from a branch off main in its checkout: the uses files, the look in the descriptions file, a changeset, and a body listing them", async () => {
    const { workspace, checkout, read } = await setUp();
    const descriptionsBefore = await read(DESCRIPTIONS);
    const { run, ran, opened } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));

    expect(ran.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
      "gh auth",
      "gh pr",
      "git remote",
      "git status",
      "git rev-parse",
      "git fetch",
      "git switch",
      "git add",
      "git commit",
      "git push",
      "gh pr",
      "git switch",
    ]);
    expect(ran).toContain(`git switch -c ${BRANCH} origin/main`);
    expect(ran).toContain(`git push -u origin ${BRANCH}`);
    // Back on the checkout's own branch.
    expect(ran.at(-1)).toBe("git switch work");
    expect(result).toMatchObject({ branch: BRANCH, pullRequest: `https://github.com/${REPO}/pull/42` });

    expect(opened).toEqual([
      {
        repo: REPO,
        title: "Add Doodad Uses for 2 doodads",
        body: [
          "Doodad Uses and a look correction for 2 doodads, each accepted in a doodad search, contributed with sc2-adjutant's `contribute_doodad_notes`. They are in general words, as CONTRIBUTING asks.",
          "",
          "- `FoundryBeltLong`",
          "  - use: parts conveyor under a press (scale 1.5)",
          "  - look: long grey conveyor belt on steel legs",
          "- `FoundryStamperHead`",
          "  - use: stamping die (variation 02)",
        ].join("\n"),
        files: {
          [`${USES}/doodads/FoundryBeltLong.json`]: json([{ use: "parts conveyor under a press", scale: 1.5 }]),
          [`${USES}/doodads/FoundryStamperHead.json`]: json([...STAMPER_USES, { use: "stamping die", variation: 2, from: "crushing-press search, 2026-11-09" }]),
          [DESCRIPTIONS]: json({ FoundryBeltLong: { ...BELT, look: "long grey conveyor belt on steel legs" }, FoundryStamperHead: STAMPER }),
          ".changeset/doodad-uses-20261108-153000.md": '---\n"@team-antioch/sc2-asset-catalog": patch\n---\n\nAdd Doodad Uses for 2 doodads: FoundryBeltLong, FoundryStamperHead.\n',
        },
      },
    ]);
    expect(Object.keys(opened[0]!.files)).toEqual([".changeset/doodad-uses-20261108-153000.md", DESCRIPTIONS, `${USES}/doodads/FoundryBeltLong.json`, `${USES}/doodads/FoundryStamperHead.json`]);
    // The descriptions file is changed in place: its order and layout are the repo's.
    expect(descriptionsBefore).toBe(json({ FoundryBeltLong: BELT, FoundryStamperHead: STAMPER }));

    expect(result.contributed).toEqual([
      { id: "FoundryBeltLong", uses: [{ use: "parts conveyor under a press", scale: 1.5 }], look: "long grey conveyor belt on steel legs" },
      { id: "FoundryStamperHead", uses: [{ use: "stamping die", variation: 2, from: "crushing-press search, 2026-11-09" }] },
    ]);
    // The undescribed frame, the terrain object and the mod doodad stay behind.
    expect(result.kept).toEqual([
      { id: "FoundryPressFrame", reason: "sc2-asset-catalog has no description of it, and takes Doodad Uses and looks only for described doodads" },
      { id: "FoundryPressPit0", reason: "a terrain object's notes stay in the Workspace: terrain objects are sc2-adjutant's own catalog" },
      { id: "LanternPressRig", reason: "a Campaign Mod doodad's notes stay in the Workspace" },
    ]);
    // The notes stay in the Workspace, laid over the package's, until a release holds them; the use the package had goes.
    expect((await readDoodadNotes(workspace)).FoundryStamperHead).toEqual({ uses: [{ use: "stamping die", variation: 2, from: "crushing-press search, 2026-11-09" }] });
    expect((await readDoodadNotes(workspace)).FoundryBeltLong).toBeDefined();
  });

  it("with no checkout, clones sc2-asset-catalog with gh into a folder of its own, opens the pull request from there and removes the clone", async () => {
    const { workspace } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die"] } } });
    const { run, ran, opened } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ run }));

    const clone = ran.find((line) => line.startsWith("gh repo clone"))!;
    expect(clone).toMatch(new RegExp(`^gh repo clone ${REPO} \\S+$`));
    const folder = clone.split(" ").at(-1)!;
    expect(ran.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["gh auth", "gh pr", "gh repo", "git switch", "git add", "git commit", "git push", "gh pr"]);
    expect(opened.map(({ repo, files }) => [repo, Object.keys(files)])).toEqual([[REPO, [".changeset/doodad-uses-20261108-153000.md", `${USES}/doodads/FoundryStamperHead.json`]]]);
    expect(result.pullRequest).toBe(`https://github.com/${REPO}/pull/42`);
    expect(existsSync(folder)).toBe(false);
  });

  it("doesn't contribute twice a note the installed package already holds, or one sc2-asset-catalog's main already has", async () => {
    const { workspace, checkout } = await setUp({ doodads: { FoundryStamperHead: { uses: ["press head", "stamping die"] }, FoundryBeltLong: { uses: ["Parts  Conveyor"] } } });
    // Main is ahead of the installed package: the belt's use is merged there, not yet released.
    await writeFile(path.join(checkout, USES, "doodads/FoundryBeltLong.json"), json([{ use: "parts conveyor" }]));
    const { run, opened } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));

    // The package's own use is dropped from the Workspace, and never sent.
    expect(result.dropped).toEqual(["FoundryStamperHead: use “press head”"]);
    expect(result.kept).toEqual([{ id: "FoundryBeltLong", reason: "sc2-asset-catalog already has it" }]);
    expect(result.contributed).toEqual([{ id: "FoundryStamperHead", uses: [{ use: "stamping die" }] }]);
    expect(opened[0]!.files[`${USES}/doodads/FoundryStamperHead.json`]).toBe(json([...STAMPER_USES, { use: "stamping die" }]));
    expect(Object.keys(opened[0]!.files)).not.toContain(`${USES}/doodads/FoundryBeltLong.json`);
    expect(opened[0]!.body).not.toMatch(/press head|conveyor/i);
  });

  it("opens nothing, and goes back, when main already holds every note", async () => {
    const { workspace, checkout } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die"] } } });
    await writeFile(path.join(checkout, USES, "doodads/FoundryStamperHead.json"), json([...STAMPER_USES, { use: "Stamping die " }]));
    const { run, ran, opened } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));
    expect(result.contributed).toEqual([]);
    expect(result.kept).toEqual([{ id: "FoundryStamperHead", reason: "sc2-asset-catalog already has it" }]);
    expect(opened).toEqual([]);
    expect(ran.slice(-2)).toEqual(["git switch work", `git branch -D ${BRANCH}`]);
  });

  it("drops the notes the package holds once a release carries them, and then has nothing to send", async () => {
    const { workspace, checkout } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die"] }, LanternPressRig: { uses: ["hanging lamp rig"] } } });
    const released: ModKnownDoodads = { ...KNOWN, doodads: { ...KNOWN.doodads, FoundryStamperHead: { variations: 1, description: STAMPER, uses: [...STAMPER_USES, { use: "stamping die" }] } } };
    const { run, ran } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run, known: released }));
    expect(result.dropped).toEqual(["FoundryStamperHead: use “stamping die”"]);
    expect(await readDoodadNotes(workspace)).toEqual({ LanternPressRig: { uses: [{ use: "hanging lamp rig" }] } });
    expect(ran).toEqual([]);
  });

  it("sends no Mission or story name: a note that names one stays in the Workspace, and the rest go", async () => {
    const { workspace, checkout } = await setUp({
      doodads: {
        FoundryStamperHead: { uses: [{ use: "press head where Orla Vance hides", variation: 1 }, "stamping die"] },
        FoundryBeltLong: { uses: [{ use: "parts conveyor", from: "chute search for TIDES-0101, 2026-11-09" }], look: "the Lantern Run belt" },
        FoundryPressFrame: { uses: ["gantry over a conveyor"] },
      },
    });
    const { run, opened, sent } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));

    expect(result.kept).toEqual([
      { id: "FoundryBeltLong", reason: "it names tides-0101 and Lantern Run, of the Workspace's Missions or story: reword it in doodad-notes.json in general words" },
      { id: "FoundryPressFrame", reason: "sc2-asset-catalog has no description of it, and takes Doodad Uses and looks only for described doodads" },
      { id: "FoundryStamperHead", reason: "it names ORLA VANCE, of the Workspace's Missions or story: reword it in doodad-notes.json in general words" },
    ]);
    expect(result.contributed).toEqual([]);
    expect(opened).toEqual([]);
    expect(sent()).not.toMatch(/orla|vance|tides|lantern/i);
    // They stay as they were, to reword.
    expect((await readDoodadNotes(workspace)).FoundryStamperHead?.uses).toHaveLength(2);
  });

  it("sends the notes that name nothing beside one that does", async () => {
    const { workspace, checkout } = await setUp({ doodads: { FoundryStamperHead: { uses: ["Glass Tides press"] }, FoundryBeltLong: { uses: ["parts conveyor"] } } });
    const { run, opened, sent } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));
    expect(result.contributed.map(({ id }) => id)).toEqual(["FoundryBeltLong"]);
    expect(opened).toHaveLength(1);
    expect(sent()).not.toMatch(/glass|tides/i);
  });

  it("refuses, as a last check, a pull request whose own words would name the story, and drops its branch with nothing written", async () => {
    const { workspace, checkout, read } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die"] } } });
    // A Mission named as the body's own words are: nothing in the notes names it.
    const { run, ran, opened } = fakeCommands();
    await expect(contributeDoodadNotes(workspace, options({ checkout, run, storyNames: ["Doodad Search"] }))).rejects.toThrow(
      /Refusing to send the pull request: it would name Doodad Search, of the Workspace's Missions or story/,
    );
    expect(opened).toEqual([]);
    expect(ran.filter((line) => /^git (add|commit|push)/.test(line))).toEqual([]);
    expect(ran.slice(-2)).toEqual(["git switch work", `git branch -D ${BRANCH}`]);
    expect(await read(`${USES}/doodads/FoundryStamperHead.json`)).toBe(json(STAMPER_USES));
  });

  it("from a fresh clone, says the branch is pushed when the pull request can't be opened", async () => {
    const { workspace } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die"] } } });
    const { run, ran } = fakeCommands({ fail: ["gh pr create"] });
    await expect(contributeDoodadNotes(workspace, options({ run }))).rejects.toThrow(
      `failed\n${BRANCH} is pushed to ${REPO}, so a pull request can still be opened from it (or the branch deleted); the Workspace keeps the notes.`,
    );
    expect(existsSync(ran.find((line) => line.startsWith("gh repo clone"))!.split(" ").at(-1)!)).toBe(false);
  });

  it("refuses to open a pull request while an earlier contribution's is still open, so its notes don't go twice", async () => {
    const { workspace, checkout } = await setUp();
    const { run, ran } = fakeCommands({ openPulls: [{ headRefName: "doodad-uses/20261101-090000", url: `https://github.com/${REPO}/pull/7` }, { headRefName: "fix-search", url: `https://github.com/${REPO}/pull/8` }] });
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));
    expect(result.notOpened).toBe(`an earlier contribution's pull request is still open, https://github.com/${REPO}/pull/7: once it merges, contribute again; the notes stay in the Workspace`);
    expect(ran).toEqual(["gh auth status", `gh pr list --repo ${REPO} --state open --author @me --json headRefName,url`]);
  });

  it("on a dry run with a checkout, says what it would contribute from the checkout as it stands, and runs and changes nothing", async () => {
    const { workspace, checkout, read } = await setUp();
    const before = [await read(DESCRIPTIONS), await read(`${USES}/doodads/FoundryStamperHead.json`)];
    const notes = await readDoodadNotes(workspace);
    const { run, ran } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ checkout, run, dryRun: true }));
    expect(result.contributed.map(({ id }) => id)).toEqual(["FoundryBeltLong", "FoundryStamperHead"]);
    expect(ran).toEqual([]);
    expect([await read(DESCRIPTIONS), await read(`${USES}/doodads/FoundryStamperHead.json`)]).toEqual(before);
    expect(await read(`${USES}/doodads/FoundryBeltLong.json`)).toBeUndefined();
    expect(await readDoodadNotes(workspace)).toEqual(notes);
  });

  it("on a dry run with no checkout, reads a fresh clone and removes it", async () => {
    const { workspace } = await setUp();
    const { run, ran } = fakeCommands();
    const result = await contributeDoodadNotes(workspace, options({ run, dryRun: true }));
    expect(result.contributed.map(({ id }) => id)).toEqual(["FoundryBeltLong", "FoundryStamperHead"]);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatch(new RegExp(`^gh repo clone ${REPO} `));
    expect(existsSync(ran[0]!.split(" ").at(-1)!)).toBe(false);
  });

  it("never offers a game doodad's notes when the Campaign Mod's doodad index covers it", async () => {
    const { workspace, checkout } = await setUp();
    const known = { ...KNOWN, mod: { ...KNOWN.mod, doodads: new Map([["LanternPressRig", {}], ["FoundryStamperHead", { model: "Assets/Doodads(Custom)/Stamper/Stamper.m3" }]]) } };
    const result = await contributeDoodadNotes(workspace, options({ checkout, known, run: fakeCommands().run, dryRun: true }));
    expect(result.contributed.map(({ id }) => id)).toEqual(["FoundryBeltLong"]);
    expect(result.kept).toContainEqual({ id: "FoundryStamperHead", reason: "a Campaign Mod doodad's notes stay in the Workspace" });
  });

  it("contributes a use the notes repeat, in any case or spacing, once, and fills a use the repo has with the variation a note adds", async () => {
    const { workspace, checkout } = await setUp({ doodads: { FoundryStamperHead: { uses: ["stamping die", "Stamping  Die", { use: "Press Head", variation: 4, from: "a later search" }] } } });
    const { run, opened } = fakeCommands();
    await contributeDoodadNotes(workspace, options({ checkout, run }));
    expect(opened[0]!.files[`${USES}/doodads/FoundryStamperHead.json`]).toBe(json([{ use: "press head", variation: 4, scale: 0.6, from: "a later search" }, { use: "stamping die" }]));
  });

  it("without gh or GitHub access, leaves the notes in the Workspace and the checkout untouched", async () => {
    const { workspace, checkout, read } = await setUp();
    const { run, ran } = fakeCommands({ fail: ["gh auth"] });
    const result = await contributeDoodadNotes(workspace, options({ checkout, run }));
    expect(result.notOpened).toMatch(/gh auth status failed; the notes stay in the Workspace/);
    expect(ran).toEqual(["gh auth status"]);
    expect(await read(`${USES}/doodads/FoundryBeltLong.json`)).toBeUndefined();
    expect((await readDoodadNotes(workspace)).FoundryBeltLong).toBeDefined();
  });

  it("says so when it can't clone or fetch, and leaves the checkout on its branch", async () => {
    const { workspace, checkout } = await setUp();
    const fetching = fakeCommands({ fail: ["git fetch"] });
    expect((await contributeDoodadNotes(workspace, options({ checkout, run: fetching.run }))).notOpened).toMatch(/git fetch origin main failed/);
    expect(fetching.ran.at(-1)).toBe("git fetch origin main");
    const cloning = fakeCommands({ fail: ["gh repo"] });
    expect((await contributeDoodadNotes(workspace, options({ run: cloning.run }))).notOpened).toMatch(/gh repo clone .* failed/);
  });

  it("refuses a folder that isn't an sc2-asset-catalog checkout, one whose origin is another repo, and one with uncommitted changes", async () => {
    const { workspace, checkout } = await setUp();
    const elsewhere = await temp();
    await expect(contributeDoodadNotes(workspace, options({ checkout: elsewhere, run: fakeCommands().run }))).rejects.toThrow(/isn't a checkout of sc2-asset-catalog/);
    await expect(contributeDoodadNotes(workspace, options({ checkout, run: fakeCommands({ origin: "git@github.com:someone/fork.git" }).run }))).rejects.toThrow(
      /its origin is git@github\.com:someone\/fork\.git, not TeamAntioch\/sc2-asset-catalog/,
    );
    const { run, ran } = fakeCommands({ status: ` M ${DESCRIPTIONS}\n` });
    await expect(contributeDoodadNotes(workspace, options({ checkout, run }))).rejects.toThrow(/uncommitted changes/);
    expect(ran.at(-1)).toBe("git status --porcelain");
  });

  it("tells a detached checkout to go back with --detach when the push fails", async () => {
    const { workspace, checkout } = await setUp();
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { run } = fakeCommands({ fail: ["git push"], detached: sha });
    await expect(contributeDoodadNotes(workspace, options({ checkout, run }))).rejects.toThrow(`Run \`git switch --detach ${sha}\` there to go back.`);
  });

  it("goes back and drops the branch when main's files can't be read", async () => {
    const { workspace, checkout } = await setUp();
    const { run, ran } = fakeCommands({ onBranch: () => writeFile(path.join(checkout, USES, "doodads/FoundryStamperHead.json"), "{ not json") });
    await expect(contributeDoodadNotes(workspace, options({ checkout, run }))).rejects.toThrow(/FoundryStamperHead\.json/);
    expect(ran.slice(-2)).toEqual(["git switch work", `git branch -D ${BRANCH}`]);
  });

  it("names the pull request it opened when it can't go back to the checkout's branch", async () => {
    const { workspace, checkout } = await setUp();
    const { run } = fakeCommands({ fail: ["git switch work"] });
    await expect(contributeDoodadNotes(workspace, options({ checkout, run }))).rejects.toThrow(
      new RegExp(`Opened https://github\\.com/${REPO}/pull/42, but the checkout .* is left on doodad-uses/20261108-153000: git switch work failed\\. Run \`git switch work\` there to go back\\.`),
    );
  });
});
