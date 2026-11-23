// The hash check between a Kept edit's read and its write (src/map/kept-session.ts): a file another
// writer changed since the session opened makes the whole edit refuse, writing nothing.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { openKeptSession } from "../../src/map/kept-session.js";

let root: string;
let blueprint: string;
let pack: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-hash-check-"));
  blueprint = path.join(root, "blueprint.json");
  pack = path.join(root, "Harbour.SC2Map");
  await mkdir(path.join(pack, "enUS.SC2Data"), { recursive: true });
  await writeFile(path.join(pack, "MapInfo"), "info");
  await writeFile(path.join(pack, "Objects"), "old Objects");
  await writeFile(path.join(pack, "Regions"), "old Regions");
  await writeFile(path.join(pack, "enUS.SC2Data", "Strings"), "old Strings");
  await writeFile(path.join(root, "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const read = (file: string) => readFile(path.join(pack, file), "utf8");
const leftovers = async () => (await readdir(pack)).filter((name) => /\.edit-(pending|backup)$/.test(name));

describe("a Kept session's hash check", () => {
  it("writes when nothing changed since the session opened", async () => {
    const session = await openKeptSession(blueprint, { verb: "edited" });
    await session.commit([["Objects", "new Objects"], ["enUS.SC2Data/Strings", "new Strings"]]);
    expect(await read("Objects")).toBe("new Objects");
    expect(await read("enUS.SC2Data/Strings")).toBe("new Strings");
  });

  it("refuses when a file it writes was changed by another writer, writing nothing", async () => {
    const session = await openKeptSession(blueprint, { verb: "edited" });
    await writeFile(path.join(pack, "Objects"), "the Editor's Objects");
    await expect(session.commit([["Regions", "new Regions"], ["Objects", "new Objects"]])).rejects.toThrow(
      "Not edited: Objects changed since it was read (another session or the Editor wrote it): nothing was written, run the edit again",
    );
    expect(await read("Objects")).toBe("the Editor's Objects");
    expect(await read("Regions")).toBe("old Regions");
    expect(await leftovers()).toEqual([]);
  });

  it("refuses a file another writer removed, or made where there was none", async () => {
    const session = await openKeptSession(blueprint, { verb: "edited" });
    await rm(path.join(pack, "Regions"));
    await expect(session.commit([["Regions", "new Regions"]])).rejects.toThrow(/Regions changed since it was read/);
    await writeFile(path.join(pack, "Extra"), "theirs");
    await expect(session.commit([["Extra", "mine"]])).rejects.toThrow(/Extra changed since it was read/);
    expect(await read("Extra")).toBe("theirs");
  });

  it("leaves files it doesn't write out of the check", async () => {
    const session = await openKeptSession(blueprint, { verb: "edited" });
    await writeFile(path.join(pack, "Regions"), "changed elsewhere");
    await session.commit([["Objects", "new Objects"]]);
    expect(await read("Objects")).toBe("new Objects");
  });

  it("words the refusal for the trigger tuner its own way", async () => {
    const session = await openKeptSession(blueprint, { verb: "tuned" });
    await writeFile(path.join(pack, "Objects"), "changed");
    await expect(session.commit([["Objects", "new"]])).rejects.toThrow(/^Not tuned: Objects changed since it was read/);
  });

  it("catches a change made after the Editor-closed check, just before the write", async () => {
    // The host's answer arrives after the read and before the write: the window the check closes.
    const host: Host = {
      machine: emptyMachineConfig(),
      adapter: undefined,
      has: (name) => name === "editor.checkClosed",
      run: (async () => writeFile(path.join(pack, "Objects"), "written meanwhile")) as Host["run"],
    };
    const session = await openKeptSession(blueprint, { verb: "edited", host });
    await expect(session.commit([["Objects", "new Objects"]])).rejects.toThrow(/Objects changed since it was read/);
    expect(await read("Objects")).toBe("written meanwhile");
  });

  it("catches a change made between staging and committing", async () => {
    const session = await openKeptSession(blueprint, { verb: "edited" });
    const staged = await session.stage([["Objects", "new Objects"]]);
    await writeFile(path.join(pack, "Objects"), "written meanwhile");
    await expect(staged.commit()).rejects.toThrow(/Objects changed since it was read/);
    expect(await read("Objects")).toBe("written meanwhile");
    expect(await leftovers()).toEqual([]);
  });
});
