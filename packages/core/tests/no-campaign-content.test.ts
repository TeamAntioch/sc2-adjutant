// Core's tests and fixtures use no MofS content: no Decaying Moon, no MofS names or characters, and
// not the MofS Plugin. Tests that pin MofS behaviour live with the MofS Campaign Pack. Core's
// catalogs (data/**) hold only the game's own entries: MofS's tilesets, units and models are
// its Campaign Mod's, read from the Workspace (ADR-0011). Nor does anything else in the repo's
// tree name MofS: every package's src and data, the root docs, docs/ and the shipped skills.
import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AUTHOR_CAMPAIGN, AUTHOR_CAMPAIGN_ENTRIES } from "./support/campaign-content.js";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
/** The file's bytes, or undefined when it's gone. */
async function readFileIfThere(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Files that name the content to look for, rather than holding it. */
const SKIPPED = new Set(["support/campaign-content.ts", "no-campaign-content.test.ts"]);

describe("core's tests", () => {
  it("hold no MofS content, in any file's contents or in any file or folder name", async () => {
    const files = (await readdir(TESTS, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(TESTS, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const file of files) {
      const named = file.match(AUTHOR_CAMPAIGN);
      if (named) found.push(`${file}: named ${named[0]}`);
      if (SKIPPED.has(file)) continue;
      // Every file, binary ones too (map headers, audio), as bytes: as Latin-1 for ASCII and UTF-8
      // text, and as UTF-16 for the strings some binary formats hold.
      const bytes = await readFileIfThere(path.join(TESTS, file));
      // A test running beside this one (toast.test.ts's Workspace copies) removed the file after the
      // listing: it was never going to be published, so there's nothing to scan.
      if (!bytes) continue;
      const match = bytes.toString("latin1").match(AUTHOR_CAMPAIGN) ?? bytes.toString("utf16le").match(AUTHOR_CAMPAIGN);
      if (match) found.push(`${file}: ${match[0]}`);
      const entry = bytes.toString("latin1").match(AUTHOR_CAMPAIGN_ENTRIES) ?? bytes.toString("utf16le").match(AUTHOR_CAMPAIGN_ENTRIES);
      if (entry) found.push(`${file}: ${entry[0]}`);
    }
    expect(found).toEqual([]);
  });
});

describe("core's catalogs", () => {
  it("hold only the game's own entries: no MofS tileset, texture, Light, unit or model, which its Campaign Mod defines", async () => {
    const files = treeFiles()
      .filter((file) => file.startsWith("packages/core/data/") && file.endsWith(".json"))
      .map((file) => file.slice("packages/core/data/".length));
    expect(files).toEqual(expect.arrayContaining(["texture-extracted.json", "cliff-extracted.json", "tileset-lights.json", "tileset-sky.json", "tech-catalog.json", "model-anims.json"]));
    const found: string[] = [];
    for (const file of files) {
      const text = await readFile(path.join(DATA, file), "utf8");
      for (const marker of [AUTHOR_CAMPAIGN, AUTHOR_CAMPAIGN_ENTRIES]) {
        for (const match of text.matchAll(new RegExp(marker.source, `${marker.flags}g`))) found.push(`${file}: ${match[0]}`);
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });
});

/**
 * The Style Pack's Map Studies of its Exemplar Maps, the author's own tac-arcade maps: they hold
 * those maps' real ids (`MolochCave`, `HaleyPortrait`, `Antioch295`), which are allowed, as the
 * names of the maps the studies measure.
 */
const STUDIES = /^packages\/plugin-style-antioch\/exemplar-maps\/(?:[^/]+\/study\.json|mixtures\.json)$/;
const STYLE_PACK = "packages/plugin-style-antioch/";
/** Its evidence frames are named by those same map ids, and its lessons cite them by path, as `evidence/<frame>`. */
const evidenceFrames = (files: readonly string[]) =>
  files.filter((file) => file.startsWith(STYLE_PACK) && /\/evidence\/[^/]+$/.test(file)).map((file) => `evidence/${path.posix.basename(file)}`);
/** A Style Pack file's name or text, less the evidence frames it names. */
const lessEvidence = (file: string, text: string, frames: readonly string[]) => (file.startsWith(STYLE_PACK) ? frames.reduce((rest, frame) => rest.replaceAll(frame, ""), text) : text);
/** Media, whose bytes would match a short marker such as `mofs` by chance, in any case: only their names are read. */
const MEDIA = /\.(?:jpe?g|png|gif|webp|svg|tga|dds|wav|ogg|mp3|mov|mp4)$/i;

/** Files outside core's tests that name the content to look for, to test the scans that share the markers. */
const TREE_SKIPPED = new Set(["packages/claude-plugin/tests/skills.test.ts"]);

/** Every file in the repo's tree that git would publish: the tracked ones and the new ones it doesn't ignore. */
function treeFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((file) => file !== "");
}

describe("the repo's tree", () => {
  // Core's tests have their own scan above, of binary files too.
  it("names no MofS content in any file, file or folder name, or link, outside core's tests", async () => {
    const files = treeFiles().filter((file) => !file.startsWith("packages/core/tests/"));
    expect(files).toEqual(expect.arrayContaining(["README.md", "GLOSSARY.md", "packages/core/src/cli/compile-map.ts", "packages/claude-plugin/skills/level-design/SKILL.md"]));
    const frames = evidenceFrames(files);
    const found: string[] = [];
    for (const file of files) {
      const named = lessEvidence(file, file, frames).match(AUTHOR_CAMPAIGN);
      if (named) found.push(`${file}: named ${named[0]}`);
      if (STUDIES.test(file) || TREE_SKIPPED.has(file) || MEDIA.test(file)) continue;
      const full = path.join(REPO, file);
      const stats = await lstat(full).catch(() => undefined);
      // Gone from the working tree but still in the index, or a folder: a nested repo or a submodule.
      if (!stats || stats.isDirectory()) continue;
      // A link is read as its target, so a link into a removed MofS package is caught too. Other
      // files are read as core's tests are: as Latin-1 for ASCII and UTF-8, and as UTF-16.
      const bytes = stats.isSymbolicLink() ? Buffer.from(await readlink(full)) : await readFile(full);
      const match = [bytes.toString("latin1"), bytes.toString("utf16le")].map((text) => lessEvidence(file, text, frames).match(AUTHOR_CAMPAIGN)).find(Boolean);
      if (match) found.push(`${file}: ${match[0]}`);
    }
    expect(found).toEqual([]);
  });
});

describe("the MofS markers", () => {
  it("tell MofS content from the stock names and the Antioch Style Pack", () => {
    for (const text of ["Decaying Moon", "decaying_moon", "moons_of_shakuras", "MofS-Campaign.SC2Mod", "LibMofs", "Moloch Dies", "packages/plugin-campaign-moons", "Antioch02-02", "moons-script", "moons-campaign", "~/repos/moons-campaign", "hero_moloch", "CharMoloch", "HaleyLookAt", "HotZone", "MoonsOfShakuras"]) {
      expect(text).toMatch(AUTHOR_CAMPAIGN);
    }
    for (const text of ["ShakurasRockColumn", "Zeratul", "Antioch 1-1.SC2Map", "style-antioch", "moon", "Moons", /* the m3studio fork's branches, the author's public attribution */ "adrianbw-m3studio-fixes"]) {
      expect(text).not.toMatch(AUTHOR_CAMPAIGN);
    }
    for (const text of ["NewAntioch", "TornodHighlands", "AntiochPitchBlack", "MoonsTestLight", "HnM_Office2", "BeaconMoons", "MoonsLogo", "TheScylla"]) expect(text).toMatch(AUTHOR_CAMPAIGN_ENTRIES);
    for (const text of ["Shakuras", "AiurEx1Cliff1", "Beacon_Protoss", "Scylla", "umbra", "Moons", "Antioch 1-1.SC2Map", "NiflheimSnow"]) expect(text).not.toMatch(AUTHOR_CAMPAIGN_ENTRIES);
  });
});
