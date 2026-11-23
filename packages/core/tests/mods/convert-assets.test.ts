// convert-assets (ADR-0011): an Asset Mod's Kept art and audio files become Workspace-file Asset
// Sources in bulk, each copied into the mod's folder with its SHA-256, and the compile converts
// them unchanged. Files whose names suggest another origin are listed for the author, and the
// origins the author gives are recorded on their sources. Harbour-Art is synthetic.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertAssets, matchesGlob } from "../../src/mods/convert-assets.js";
import { importMod } from "../../src/mods/import-mod.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";
import { binary, documentHeader, cleanupMods, hashTree, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const GULL = "Base.SC2Assets/Assets/Textures/gull.dds";
const CRANE = "Base.SC2Assets/Assets/Models/Crane/Crane.m3";
const PORTED = "Base.SC2Assets/Assets/Effects/storm_effect_splash/storm_effect_splash.m3";
const PORTED_TEXTURE = "Base.SC2Assets/Assets/Textures/storm_splash_diff.dds";
const BORROWED = "Base.SC2Assets/Assets/Models/Pier/Wavecrest_Pier.m3";
const FILES: Record<string, Uint8Array> = { [GULL]: binary(4), [CRANE]: binary(5), [PORTED]: binary(6), [PORTED_TEXTURE]: binary(7), [BORROWED]: binary(8) };

/** Harbour-Art, an Editor-made Asset Mod, imported beside Harbour-Story with all of it Kept. */
async function harbourArt(): Promise<Mod> {
  const story = await setup();
  const source = path.join(path.dirname(story.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
  await put(path.join(source, "DocumentHeader"), documentHeader([], 6));
  await put(path.join(source, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <ModType>\r\n        <Value>Interface</Value>\r\n    </ModType>\r\n</DocInfo>\r\n`);
  for (const [file, bytes] of Object.entries(FILES)) await put(path.join(source, ...file.split("/")), bytes);
  const imported = await importMod(await loadWorkspace(story.workspaceRoot), source, "harbour-art", { kind: "asset" });
  return { workspaceRoot: story.workspaceRoot, modDir: path.dirname(imported.blueprintPath), blueprintPath: imported.blueprintPath, modPackage: imported.modPackage };
}

const PORT = { kind: "port", of: "Heroes of the Storm", owner: "Blizzard Entertainment", by: "the Harbour team" } as const;
const WAVECREST = { kind: "community", credit: "Wavecrest", site: "SC2Mapster" } as const;

describe("convertAssets", () => {
  it("declares every Kept art and audio file a Workspace file with its hash, and the compile converts them all unchanged", async () => {
    const art = await harbourArt();
    const before = await hashTree(art.modPackage);

    const converted = await convertAssets(art.blueprintPath);

    expect(converted.converted).toEqual([CRANE, BORROWED, PORTED, GULL, PORTED_TEXTURE].sort());
    const blueprint = JSON.parse(await readFile(art.blueprintPath, "utf8"));
    expect(blueprint.assets).toContainEqual({ path: GULL, source: { file: `assets/${GULL}`, sha256: sha256(FILES[GULL]!) } });
    expect(await readFile(path.join(art.modDir, "assets", ...GULL.split("/")))).toEqual(Buffer.from(FILES[GULL]!));

    const compiled = await compileMod(art.blueprintPath);

    expect(compiled.conversions).toHaveLength(5);
    const after = await hashTree(art.modPackage);
    for (const file of Object.keys(FILES)) expect(after[file]).toBe(before[file]);
    expect((await keptReport(art.blueprintPath)).components.find((component) => component.component === "Files")!.count).toBe(0);
    expect((await checkWorkspace(art.workspaceRoot)).problems).toEqual([]);
  });

  it("lists the files whose names suggest another origin, Heroes of the Storm's storm_ prefix and the author's own patterns, until an origin is recorded", async () => {
    const art = await harbourArt();

    const converted = await convertAssets(art.blueprintPath, { suspects: ["Wavecrest_*"] });

    expect(converted.suspects).toEqual([
      { path: PORTED, why: expect.stringMatching(/Heroes of the Storm/) },
      { path: BORROWED, why: "its name matches Wavecrest_*" },
      { path: PORTED_TEXTURE, why: expect.stringMatching(/Heroes of the Storm/) },
    ]);
  });

  it("records the origins the author gives on the files they match, already converted or not, and lists only the rest", async () => {
    const art = await harbourArt();
    await convertAssets(art.blueprintPath);

    const converted = await convertAssets(art.blueprintPath, {
      suspects: ["Wavecrest_*"],
      origins: [
        { match: "Base.SC2Assets/Assets/Effects/**", origin: PORT },
        { match: "Wavecrest_*", origin: WAVECREST },
      ],
    });

    expect(converted.converted).toEqual([]);
    expect(converted.origins).toEqual([
      { path: PORTED, origin: PORT },
      { path: BORROWED, origin: WAVECREST },
    ]);
    expect(converted.suspects).toEqual([{ path: PORTED_TEXTURE, why: expect.stringMatching(/Heroes of the Storm/) }]);
    const blueprint = JSON.parse(await readFile(art.blueprintPath, "utf8"));
    expect(blueprint.assets).toContainEqual({ path: PORTED, source: { file: `assets/${PORTED}`, sha256: sha256(FILES[PORTED]!), origin: PORT } });
    // An origin is provenance only: the file still compiles from the Workspace, unchanged.
    await compileMod(art.blueprintPath);
    expect((await keptReport(art.blueprintPath)).total).toBe(0);
  });

  it("refuses an origin that matches no file, writing nothing, and a Campaign Mod", async () => {
    const art = await harbourArt();
    const blueprint = await readFile(art.blueprintPath, "utf8");

    await expect(convertAssets(art.blueprintPath, { origins: [{ match: "Nowhere_*", origin: WAVECREST }] })).rejects.toThrow(/Nowhere_\* matches none of the Asset Mod's files/);
    expect(await readFile(art.blueprintPath, "utf8")).toBe(blueprint);
    const story = path.join(art.workspaceRoot, "mods", "harbour-story", "blueprint.json");
    await expect(convertAssets(story)).rejects.toThrow(/harbour-story is a Campaign Mod: only an Asset Mod has Asset Sources/);
  });

  it("leaves a file that's a Git LFS pointer this machine hasn't pulled, saying so", async () => {
    const art = await harbourArt();
    await put(path.join(art.modPackage, ...GULL.split("/")), "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 512\n");

    const converted = await convertAssets(art.blueprintPath);

    expect(converted.converted).not.toContain(GULL);
    expect(converted.refused).toEqual([{ path: GULL, reason: expect.stringMatching(/Git LFS pointer/) }]);
  });
});

describe("matchesGlob", () => {
  it("matches ** over whole folders only, and a glob without a slash against the name", () => {
    expect(matchesGlob("Assets/**/storm_*", "Assets/Textures/storm_x.dds")).toBe(true);
    expect(matchesGlob("Assets/**/storm_*", "Assets/storm_x.dds")).toBe(true);
    expect(matchesGlob("Assets/**/storm_*", "Assets/Textures/notstorm_x.dds")).toBe(false);
    expect(matchesGlob("a/**/b.dds", "a/foob.dds")).toBe(false);
    expect(matchesGlob("Assets/Effects/**", "Assets/Effects/x/y.m3")).toBe(true);
    expect(matchesGlob("STORM_*", "Assets/Textures/storm_x.dds")).toBe(true);
    expect(matchesGlob("storm_?.dds", "Assets/storm_ab.dds")).toBe(false);
  });
});

describe("convertAssets beside files already in the mod's folder", () => {
  it("refuses a file whose Workspace copy is there with other bytes, leaving it, and takes one with the same", async () => {
    const art = await harbourArt();
    await put(path.join(art.modDir, "assets", ...GULL.split("/")), binary(99));
    await put(path.join(art.modDir, "assets", ...CRANE.split("/")), FILES[CRANE]!);

    const converted = await convertAssets(art.blueprintPath);

    expect(converted.converted).toContain(CRANE);
    expect(converted.refused).toEqual([{ path: GULL, reason: expect.stringMatching(/already has assets\/Base\.SC2Assets\/Assets\/Textures\/gull\.dds, with other bytes/) }]);
    expect(await readFile(path.join(art.modDir, "assets", ...GULL.split("/")))).toEqual(Buffer.from(binary(99)));
  });

  it("gives the files asked for in the package's order", async () => {
    const art = await harbourArt();

    expect((await convertAssets(art.blueprintPath, { paths: [GULL, CRANE] })).converted).toEqual([CRANE, GULL]);
  });
});

describe("the convert_assets tool", () => {
  it("converts a Workspace Asset Mod's files, recording the origins given and listing the files to check", async () => {
    const art = await harbourArt();
    const client = await connect(art.workspaceRoot);

    const reply = await client.callTool({ name: "convert_assets", arguments: { mod: "harbour-art", origins: [{ match: "Wavecrest_*", origin: WAVECREST }] } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ converted: expect.arrayContaining([GULL, BORROWED]), refused: [], origins: [{ path: BORROWED, origin: WAVECREST }], suspects: [{ path: PORTED }, { path: PORTED_TEXTURE }] });
    expect(text(reply)).toContain("compile_mod");
  });
});
