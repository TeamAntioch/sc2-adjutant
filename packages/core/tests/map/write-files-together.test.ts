// All-or-nothing writes of a Map Package's files: a failed rename puts every file back.
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type FileOps, stageFiles, WriteFailed } from "../../src/map/write-files-together.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function folder(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-write-together-"));
  for (const file of ["t3HeightMap", "t3SyncHeightMap", "t3Terrain.xml"]) await writeFile(path.join(dir, file), `old ${file}`);
  return dir;
}
const contents = async (at: string) => Object.fromEntries(await Promise.all((await readdir(at)).sort().map(async (file) => [file, await readFile(path.join(at, file), "utf8")] as const)));
const OUT = [
  ["t3HeightMap", "new t3HeightMap"],
  ["t3SyncHeightMap", "new t3SyncHeightMap"],
  ["t3Terrain.xml", "new t3Terrain.xml"],
  ["Objects", "new Objects"],
] as const;

describe("stageFiles", () => {
  it("renames every file in and leaves no pending or backup file", async () => {
    const at = await folder();
    const staged = await stageFiles(at, OUT);
    expect(await staged.commit()).toEqual(["t3HeightMap", "t3SyncHeightMap", "t3Terrain.xml", "Objects"]);
    expect(await contents(at)).toEqual({ Objects: "new Objects", "t3HeightMap": "new t3HeightMap", "t3SyncHeightMap": "new t3SyncHeightMap", "t3Terrain.xml": "new t3Terrain.xml" });
  });

  it("puts every file back when a later rename fails, so the height maps never meet the old t3Terrain.xml", async () => {
    const at = await folder();
    const before = await contents(at);
    const ops: FileOps = {
      writeFile: (file, content) => writeFile(file, content),
      rename: async (from, to) => {
        if (from.endsWith("t3Terrain.xml.edit-pending")) throw new Error("EBUSY: t3Terrain.xml is in use");
        await rename(from, to);
      },
      rm: (file) => rm(file, { force: true }),
    };
    const staged = await stageFiles(at, OUT, ops);
    await expect(staged.commit()).rejects.toMatchObject({ name: "WriteFailed", phase: "commit", reason: "EBUSY: t3Terrain.xml is in use", unrestored: [], putBack: true });
    expect(await contents(at)).toEqual(before);
  });

  it("reports a failed write as a structured failure for the caller to word", async () => {
    const at = await folder();
    const failure = await stageFiles(path.join(at, "missing"), OUT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WriteFailed);
    expect(failure).toMatchObject({ phase: "stage", unrestored: [], putBack: false });
  });

  it("removes a new file it renamed in when it puts the others back", async () => {
    const at = await folder();
    const before = await contents(at);
    const ops: FileOps = {
      writeFile: (file, content) => writeFile(file, content),
      rename: async (from, to) => {
        if (from.endsWith("t3Terrain.xml.edit-pending")) throw new Error("EBUSY");
        await rename(from, to);
      },
      rm: (file) => rm(file, { force: true }),
    };
    const staged = await stageFiles(at, [["Objects", "new Objects"], ...OUT.slice(0, 3)], ops);
    await expect(staged.commit()).rejects.toMatchObject({ reason: "EBUSY" });
    expect(await contents(at)).toEqual(before);
  });

  it("removes a file given no content, and puts it back when a later rename fails", async () => {
    const at = await folder();
    const before = await contents(at);
    expect(await (await stageFiles(at, [["t3SyncHeightMap", undefined], ["Objects", "new Objects"]])).commit()).toEqual(["t3SyncHeightMap", "Objects"]);
    expect(Object.keys(await contents(at))).toEqual(["Objects", "t3HeightMap", "t3Terrain.xml"]);
    await rm(path.join(at, "Objects"));
    await writeFile(path.join(at, "t3SyncHeightMap"), "old t3SyncHeightMap");
    const ops: FileOps = {
      writeFile: (file, content) => writeFile(file, content),
      rename: async (from, to) => {
        if (from.endsWith("t3Terrain.xml.edit-pending")) throw new Error("EBUSY");
        await rename(from, to);
      },
      rm: (file) => rm(file, { force: true }),
    };
    await expect((await stageFiles(at, [["t3SyncHeightMap", undefined], ["t3Terrain.xml", "new t3Terrain.xml"]], ops)).commit()).rejects.toMatchObject({ reason: "EBUSY" });
    expect(await contents(at)).toEqual(before);
  });

  it("removes what it staged when a write fails, or when discarded", async () => {
    const at = await folder();
    const before = await contents(at);
    await mkdir(path.join(at, "t3Terrain.xml.edit-pending"));
    await expect(stageFiles(at, OUT)).rejects.toBeInstanceOf(WriteFailed);
    await rm(path.join(at, "t3Terrain.xml.edit-pending"), { recursive: true });
    expect(await contents(at)).toEqual(before);
    await (await stageFiles(at, OUT)).discard();
    expect(await contents(at)).toEqual(before);
  });
});
