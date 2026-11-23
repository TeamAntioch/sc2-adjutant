// The Kept package edit session: the head (the Mission's package, its compile record) and the tail
// (the Editor-closed guard, one all-or-none write), at the interface the three edit tools share.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { checkEditorClosed, openKeptSession, worded } from "../../src/map/kept-session.js";
import { WriteFailed } from "../../src/map/write-files-together.js";

let root: string;
let blueprint: string;
let pack: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-session-"));
  blueprint = path.join(root, "blueprint.json");
  pack = path.join(root, "Harbour.SC2Map");
  await mkdir(pack);
  await writeFile(path.join(pack, "MapInfo"), "info");
  await writeFile(path.join(pack, "Objects"), "old Objects");
  await writeFile(path.join(pack, "Regions"), "old Regions");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const withRecord = () => writeFile(path.join(root, "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
const contents = async () => Object.fromEntries(await Promise.all((await readdir(pack)).sort().map(async (file) => [file, await readFile(path.join(pack, file), "utf8")] as const)));

function editorHost(open: boolean): Host & { asked: string[] } {
  const asked: string[] = [];
  return {
    machine: emptyMachineConfig(),
    adapter: undefined,
    has: (name) => name === "editor.checkClosed",
    run: (async (_name: string, request: { mapPath: string }) => {
      asked.push(request.mapPath);
      if (open) throw new Error("The Editor has Harbour.SC2Map open: close it, then try again");
    }) as Host["run"],
    asked,
  };
}

describe("openKeptSession", () => {
  it("refuses a Mission with no compile record", async () => {
    await expect(openKeptSession(blueprint, { verb: "edited" })).rejects.toThrow(
      `${blueprint} has no compile record, so the next compile would write Harbour.SC2Map whole over any edit: compile the Mission in place first`,
    );
  });

  it("refuses a folder that isn't a Map Package yet, before it asks for the record, when the tool needs one", async () => {
    await rm(path.join(pack, "MapInfo"));
    await expect(openKeptSession(blueprint, { verb: "tuned", requirePackage: true })).rejects.toThrow(`${pack} isn't a Map Package yet: compile the Mission, or import a map for it, first`);
    await expect(openKeptSession(blueprint, { verb: "edited" })).rejects.toThrow(/has no compile record/);
  });

  it("serves the package and its record", async () => {
    await withRecord();
    const session = await openKeptSession(blueprint, { verb: "edited", requirePackage: true });
    expect(session.mapPackage).toBe(pack);
    expect(session.record.entries).toEqual([]);
  });
});

describe("a session's tail", () => {
  it("refuses while the Editor has the package open, in the tool's words, and writes nothing", async () => {
    await withRecord();
    const before = await contents();
    const host = editorHost(true);
    await expect((await openKeptSession(blueprint, { verb: "edited", host })).commit([["Objects", "new"]])).rejects.toThrow("Not edited: The Editor has Harbour.SC2Map open");
    await expect((await openKeptSession(blueprint, { verb: "tuned", host })).commit([["Objects", "new"]])).rejects.toThrow("Not tuned: The Editor has Harbour.SC2Map open");
    expect(host.asked).toEqual([pack, pack]);
    expect(await contents()).toEqual(before);
  });

  it("asks the Editor at each commit, and a pass covers only the next one", async () => {
    await withRecord();
    const host = editorHost(false);
    const session = await openKeptSession(blueprint, { verb: "edited", host });
    await session.checkClosed();
    await session.commit([["Objects", "new"]]);
    expect(host.asked).toEqual([pack]);
    await session.commit([["Regions", "new"]]);
    expect(host.asked).toEqual([pack, pack]);
  });

  it("asks again after a refusal, so a retry once the Editor is closed goes through", async () => {
    await withRecord();
    let open = true;
    const host: Host = {
      ...editorHost(false),
      run: (async () => {
        if (open) throw new Error("The Editor has Harbour.SC2Map open: close it, then try again");
      }) as Host["run"],
    };
    const session = await openKeptSession(blueprint, { verb: "edited", host });
    await expect(session.commit([["Objects", "new"]])).rejects.toThrow("Not edited: The Editor has");
    open = false;
    expect(await session.commit([["Objects", "new"]])).toEqual(["Objects"]);
    open = true;
    await expect(session.commit([["Regions", "new"]])).rejects.toThrow("Not edited: The Editor has");
    expect(await readFile(path.join(pack, "Regions"), "utf8")).toBe("old Regions");
  });

  it("words a failed rename in the tool's own way", async () => {
    await withRecord();
    // Regions can't be moved aside while its backup name is a folder with something in it.
    await mkdir(path.join(pack, "Regions.edit-backup"));
    await writeFile(path.join(pack, "Regions.edit-backup", "x"), "x");
    const files = [["Objects", "new Objects"], ["Regions", "new Regions"]] as const;
    await expect((await openKeptSession(blueprint, { verb: "edited" })).commit(files)).rejects.toThrow(/^Not edited: .*; every file was put back as it was$/);
    await expect((await openKeptSession(blueprint, { verb: "tuned" })).commit(files)).rejects.toThrow(/^Not tuned: writing .* failed \(.*\)\. The files already written were put back\.$/);
  });

  it("names the old copies of files it could not put back, for both verbs", () => {
    const failure = new WriteFailed("/pkg", "commit", "EBUSY", ["Triggers", "MapScript.galaxy"], true, undefined);
    expect(worded(failure, "edited")).toHaveProperty("message", "Not edited: EBUSY; Triggers, MapScript.galaxy could not be put back: Triggers.edit-backup, MapScript.galaxy.edit-backup are the old copy");
    expect(worded(failure, "tuned")).toHaveProperty(
      "message",
      "Not tuned: writing /pkg failed (EBUSY). Restoring Triggers, MapScript.galaxy failed too: put them back from version control (the old copies are Triggers.edit-backup, MapScript.galaxy.edit-backup).",
    );
  });

  it("lets the edit go ahead when the host can't tell", async () => {
    await withRecord();
    const session = await openKeptSession(blueprint, { verb: "edited", host: { ...editorHost(true), has: () => false } });
    expect(await session.commit([["Objects", "new"]])).toEqual(["Objects"]);
  });

  it("writes every file, removing one given no content, and leaves no pending or backup file", async () => {
    await withRecord();
    const session = await openKeptSession(blueprint, { verb: "edited" });
    expect(await session.commit([["Objects", "new Objects"], ["Regions", undefined]])).toEqual(["Objects", "Regions"]);
    expect(await contents()).toEqual({ MapInfo: "info", Objects: "new Objects" });
  });

  it("puts every file back when a later one fails, in the tool's words", async () => {
    await withRecord();
    const before = await contents();
    // A file under a folder that doesn't exist can't be staged: nothing is written.
    const session = await openKeptSession(blueprint, { verb: "tuned" });
    await expect(session.commit([["Objects", "new Objects"], [path.join("nowhere", "Strings.txt"), "new"]])).rejects.toThrow(/^Not tuned: writing .* failed \(.*\)\.$/);
    expect(await contents()).toEqual(before);
    const edited = await openKeptSession(blueprint, { verb: "edited" });
    await expect(edited.commit([["Objects", "new Objects"], [path.join("nowhere", "Strings.txt"), "new"]])).rejects.toThrow(/^Not edited: /);
    expect(await contents()).toEqual(before);
  });

  it("discards what it staged, leaving the package as it was", async () => {
    await withRecord();
    const before = await contents();
    const staged = await (await openKeptSession(blueprint, { verb: "edited" })).stage([["Objects", "new Objects"]]);
    await staged.discard();
    expect(await contents()).toEqual(before);
  });
});

describe("checkEditorClosed", () => {
  it("passes the host's own refusal on as it is", async () => {
    await expect(checkEditorClosed(editorHost(true), pack)).rejects.toThrow(/^The Editor has Harbour.SC2Map open/);
    await expect(checkEditorClosed(undefined, pack)).resolves.toBeUndefined();
  });
});
