// Snapshots of the Banks folder around a test game (#54), on fixture folders: an unchanged run
// reports nothing, a changed key is reported, a rollback restores the snapshot, old snapshots go.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bankRuns, diffBankText, finishBankRun, KEPT_BANK_RUNS, parseBank, pendingBankRun, pruneBankRuns, resolveBanks, restoreBankRun, saveBanksAsFixture, snapshotBanks, unrestoredFixtureRun } from "../../src/capture/bank-snapshots.js";
import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { bankFixtureProblem, missionBankFixture } from "../../src/capture/bank-fixtures.js";
import { bankReport } from "../../src/mcp/tools/bank-report.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const bank = (keys: Record<string, string>, extra = "") =>
  `<?xml version="1.0" encoding="utf-8"?>\n<Bank version="1">\n  <Section name="Run">\n${Object.entries(keys)
    .map(([key, value]) => `    <Key name="${key}">\n      <Value ${value}/>\n    </Key>`)
    .join("\n")}\n  </Section>${extra}\n  <Signature value="abc"/>\n</Bank>\n`;

async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), "banks-"));
  folders.push(folder);
  const banksDir = path.join(folder, "Banks");
  await mkdir(path.join(banksDir, "sub"), { recursive: true });
  await writeFile(path.join(banksDir, "Score.SC2Bank"), bank({ level: 'int="3"', name: 'string="Ada"' }));
  await writeFile(path.join(banksDir, "Gone.SC2Bank"), bank({ a: 'int="1"' }));
  await writeFile(path.join(banksDir, "sub", "Other.SC2Bank"), bank({ a: 'int="1"' }));
  return { folder, banksDir, cacheDir: path.join(folder, "cache") };
}

describe("reading a bank", () => {
  it("lists each section's keys with their values, and skips the signature", () => {
    const keys = parseBank(bank({ level: 'int="3"', speed: 'fixed="1.5"' }));
    expect([...keys.get("Run")!]).toEqual([
      ["level", 'int="3"'],
      ["speed", 'fixed="1.5"'],
    ]);
    expect(keys.size).toBe(1);
  });

  it("diffs by section and key", () => {
    const before = bank({ level: 'int="3"', old: 'int="0"' }, '\n  <Section name="Gone"><Key name="x"><Value int="1"/></Key></Section>');
    const after = bank({ level: 'int="4"', fresh: 'flag="1"' }, '\n  <Section name="New"><Key name="y"><Value int="2"/></Key></Section>');
    expect(diffBankText(before, after)).toEqual([
      {
        section: "Run",
        status: "changed",
        keys: [
          { key: "level", status: "changed", before: 'int="3"', after: 'int="4"' },
          { key: "old", status: "removed", before: 'int="0"' },
          { key: "fresh", status: "added", after: 'flag="1"' },
        ],
      },
      { section: "Gone", status: "removed", keys: [{ key: "x", status: "removed", before: 'int="1"' }] },
      { section: "New", status: "added", keys: [{ key: "y", status: "added", after: 'int="2"' }] },
    ]);
  });
});

describe("a test run's snapshot", () => {
  it("reports nothing, and keeps nothing, when no bank changed", async () => {
    const t = await setup();
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map");
    expect((await finishBankRun(t.cacheDir, run)).changes).toEqual([]);
    expect(await bankRuns(t.cacheDir)).toEqual([]);
    expect(await pendingBankRun(t.cacheDir)).toBeUndefined();
  });

  it("reports an added, a changed and a removed bank, and a changed key", async () => {
    const t = await setup();
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map");
    await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: 'int="4"', name: 'string="Ada"' }));
    await rm(path.join(t.banksDir, "Gone.SC2Bank"));
    await writeFile(path.join(t.banksDir, "New.SC2Bank"), bank({ n: 'int="1"' }));
    const finished = await finishBankRun(t.cacheDir, run);
    expect(finished.changes.map((change) => [change.bank, change.status])).toEqual([
      ["Gone.SC2Bank", "removed"],
      ["New.SC2Bank", "added"],
      ["Score.SC2Bank", "changed"],
    ]);
    expect(finished.changes[2]!.sections).toEqual([{ section: "Run", status: "changed", keys: [{ key: "level", status: "changed", before: 'int="3"', after: 'int="4"' }] }]);
    expect((await pendingBankRun(t.cacheDir))?.id).toBe(run.id);
  });

  it("rolls back only the banks asked for, and keeps the rest", async () => {
    const t = await setup();
    const original = await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8");
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map");
    await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: 'int="9"' }));
    await rm(path.join(t.banksDir, "Gone.SC2Bank"));
    await writeFile(path.join(t.banksDir, "New.SC2Bank"), bank({ n: 'int="1"' }));
    await writeFile(path.join(t.banksDir, "sub", "Other.SC2Bank"), bank({ a: 'int="2"' }));
    const finished = await finishBankRun(t.cacheDir, run);
    await expect(resolveBanks(t.cacheDir, finished, { rollback: ["Nope.SC2Bank"] })).rejects.toThrow(/Not banks this run changed: Nope.SC2Bank/);

    const done = await resolveBanks(t.cacheDir, finished, { rollback: ["Score.SC2Bank", "Gone.SC2Bank", "New.SC2Bank"], keep: ["sub/Other.SC2Bank"] });
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toBe(original);
    expect(existsSync(path.join(t.banksDir, "Gone.SC2Bank"))).toBe(true);
    expect(existsSync(path.join(t.banksDir, "New.SC2Bank"))).toBe(false);
    expect(await readFile(path.join(t.banksDir, "sub", "Other.SC2Bank"), "utf8")).toContain('int="2"');
    expect(done.changes.map((change) => change.resolution)).toEqual(["rolled-back", "rolled-back", "rolled-back", "kept"]);
    expect(await pendingBankRun(t.cacheDir)).toBeUndefined();
  });

  it("prunes the oldest runs past the limit", async () => {
    const t = await setup();
    for (let i = 0; i < KEPT_BANK_RUNS + 3; i++) {
      const run = await snapshotBanks(t.cacheDir, t.banksDir, `/m/${i}.SC2Map`, new Date(2026, 0, 1, 0, i));
      await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: `int="${10 + i}"` }));
      await finishBankRun(t.cacheDir, run);
    }
    const runs = await bankRuns(t.cacheDir);
    expect(runs).toHaveLength(KEPT_BANK_RUNS);
    expect(runs.map((run) => path.basename(run.source))).toEqual(["3.SC2Map", "4.SC2Map", "5.SC2Map", "6.SC2Map", "7.SC2Map"]);
  });
});

describe("the bank report", () => {
  const hostOf = (cacheDir: string, running: () => boolean): Host =>
    ({
      machine: { ...emptyMachineConfig(path.join(path.dirname(cacheDir), "machine.json")), cacheDir },
      adapter: undefined,
      has: (name: string) => name === "game.running",
      run: (() => Promise.resolve(running())) as Host["run"],
    }) as Host;

  it("says nothing with no run, shows a running game's changes so far without applying a choice, then records them once it quits", async () => {
    const t = await setup();
    let playing = true;
    const host = hostOf(t.cacheDir, () => playing);
    expect((await bankReport(host)).lines).toEqual([]);
    await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map");
    await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: 'int="4"', name: 'string="Ada"' }));

    const during = await bankReport(host, { rollbackAll: true });
    expect(during.lines[0]).toMatch(/^Nothing kept or rolled back: the game is still running/);
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toContain('int="4"');

    playing = false;
    const after = await bankReport(host);
    expect(after.lines.join("\n")).toContain("changed 1 bank in");
    expect(after.lines.join("\n")).toContain('level: int="3" -> int="4"');

    const rolled = await bankReport(host, { rollbackAll: true });
    expect(rolled.lines.join("\n")).toContain("Score.SC2Bank: changed (rolled back)");
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toContain('int="3"');
    expect((await bankReport(host)).lines).toEqual([]);
  });

  it("on a host that can't tell whether the game quit, shows the changes so far and takes a choice as the author's word", async () => {
    const t = await setup();
    const host = { ...hostOf(t.cacheDir, () => true), has: () => false } as Host;
    await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map");
    await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: 'int="4"' }));
    expect((await bankReport(host)).lines.join("\n")).toContain("can't tell whether the game has quit");
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toContain('int="4"');
    await bankReport(host, { rollback: ["Score.SC2Bank"] });
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toContain('int="3"');
  });
});

describe("a run on a bank fixture", () => {
  /** A fixture folder: a new Score bank, a bank of its own, and a file that isn't a bank. */
  async function fixtureOf(t: Awaited<ReturnType<typeof setup>>) {
    const dir = path.join(t.folder, "fixture");
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(path.join(dir, "Score.SC2Bank"), bank({ level: 'int="7"', name: 'string="Fixture"' }));
    await writeFile(path.join(dir, "sub", "Research.SC2Bank"), bank({ x: 'int="1"' }));
    await writeFile(path.join(dir, "notes.txt"), "not a bank");
    return { name: "after-two", dir };
  }
  const files = async (dir: string) => ({ score: await readFile(path.join(dir, "Score.SC2Bank"), "utf8"), gone: existsSync(path.join(dir, "Gone.SC2Bank")), research: existsSync(path.join(dir, "sub", "Research.SC2Bank")), notes: existsSync(path.join(dir, "notes.txt")) });

  it("starts with the fixture's banks, and ends with the author's restored, the game's own changes recorded as rolled back", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), await fixtureOf(t));
    // The game starts on the fixture's banks; the author's other bank stays.
    expect(await files(t.banksDir)).toEqual({ score: bank({ level: 'int="7"', name: 'string="Fixture"' }), gone: true, research: true, notes: false });
    expect((await unrestoredFixtureRun(t.cacheDir))?.id).toBe(run.id);
    // The game saves a key while it runs.
    await writeFile(path.join(t.banksDir, "Score.SC2Bank"), bank({ level: 'int="8"', name: 'string="Fixture"' }));

    const finished = await finishBankRun(t.cacheDir, run);
    expect(await files(t.banksDir)).toEqual(original);
    expect(finished.changes.map((change) => [change.bank, change.status, change.resolution])).toEqual([["Score.SC2Bank", "changed", "rolled-back"]]);
    expect(finished.changes[0]!.sections[0]!.keys).toEqual([{ key: "level", status: "changed", before: 'int="7"', after: 'int="8"' }]);
    // Nothing waits for the author, and nothing is left to restore.
    expect(await pendingBankRun(t.cacheDir)).toBeUndefined();
    expect(await unrestoredFixtureRun(t.cacheDir)).toBeUndefined();
  });

  it("restores the author's banks when the game's run wrote, deleted or added banks too", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), await fixtureOf(t));
    await rm(path.join(t.banksDir, "Gone.SC2Bank"));
    await writeFile(path.join(t.banksDir, "Made.SC2Bank"), bank({ n: 'int="1"' }));
    await finishBankRun(t.cacheDir, run);
    expect(await files(t.banksDir)).toEqual(original);
    expect(existsSync(path.join(t.banksDir, "Made.SC2Bank"))).toBe(false);
  });

  it("restores the author's banks, and keeps nothing, for a run whose game never started", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    const run = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), await fixtureOf(t));
    expect((await files(t.banksDir)).research).toBe(true);
    await restoreBankRun(t.cacheDir, run);
    expect(await files(t.banksDir)).toEqual(original);
    expect(await bankRuns(t.cacheDir)).toEqual([]);
  });

  it("puts the author's banks back even when the fixture can't be copied in", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    await expect(snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), { name: "gone", dir: path.join(t.folder, "nope") })).rejects.toThrow(/holds no .SC2Bank files/);
    // A fixture folder that can't be read through: a file where a folder should be.
    const dir = path.join(t.folder, "bad");
    await mkdir(dir);
    await writeFile(path.join(dir, "Score.SC2Bank"), bank({ level: 'int="1"' }));
    await writeFile(path.join(t.banksDir, "sub2"), "a file in the way");
    await mkdir(path.join(dir, "sub2"));
    await writeFile(path.join(dir, "sub2", "X.SC2Bank"), bank({ a: 'int="1"' }));
    await expect(snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), { name: "bad", dir })).rejects.toThrow();
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toBe(original.score);
    expect(await unrestoredFixtureRun(t.cacheDir)).toBeUndefined();
  });

  it("is never pruned while the author's banks aren't back", async () => {
    const t = await setup();
    const fixture = await snapshotBanks(t.cacheDir, t.banksDir, "/m/Fixture.SC2Map", new Date(2026, 0, 1), await fixtureOf(t));
    for (let i = 0; i < KEPT_BANK_RUNS + 2; i++) await snapshotBanks(t.cacheDir, t.banksDir, `/m/${i}.SC2Map`, new Date(2026, 0, 2, 0, i));
    await pruneBankRuns(t.cacheDir);
    expect((await unrestoredFixtureRun(t.cacheDir))?.id).toBe(fixture.id);
  });

  it("on a host that can't tell whether the game quit, shows the fixture and restores on the author's word", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    const host = { machine: { ...emptyMachineConfig(path.join(t.folder, "machine.json")), cacheDir: t.cacheDir }, adapter: undefined, has: () => false, run: (() => Promise.resolve(true)) as Host["run"] } as Host;
    await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), await fixtureOf(t));
    const during = (await bankReport(host)).lines.join("\n");
    expect(during).toContain("plays on the bank fixture after-two");
    expect(during).toContain("call bank_changes with rollbackAll");
    expect((await files(t.banksDir)).research).toBe(true);

    const after = await bankReport(host, { rollbackAll: true });
    expect(after.lines).toEqual([]);
    expect(await files(t.banksDir)).toEqual(original);
  });

  it("restores on the next report once the host sees the game has quit, with a broker that never recorded it", async () => {
    const t = await setup();
    const original = await files(t.banksDir);
    let playing = true;
    const host = { machine: { ...emptyMachineConfig(path.join(t.folder, "machine.json")), cacheDir: t.cacheDir }, adapter: undefined, has: (name: string) => name === "game.running", run: (() => Promise.resolve(playing)) as Host["run"] } as Host;
    await snapshotBanks(t.cacheDir, t.banksDir, "/m/Mission.SC2Map", new Date(), await fixtureOf(t));
    await bankReport(host);
    expect((await files(t.banksDir)).research).toBe(true);
    playing = false;
    expect((await bankReport(host)).lines).toEqual([]);
    expect(await files(t.banksDir)).toEqual(original);
  });
});

describe("saving the banks as a fixture", () => {
  it("copies the .SC2Bank files into the destination folder and touches nothing else", async () => {
    const t = await setup();
    await writeFile(path.join(t.banksDir, "readme.txt"), "x");
    const dest = path.join(t.folder, "ws", "bank-fixtures", "after-two");
    const saved = await saveBanksAsFixture(t.banksDir, dest);
    expect(saved).toEqual(["Gone.SC2Bank", "Score.SC2Bank", "sub/Other.SC2Bank"]);
    expect(await readFile(path.join(dest, "sub", "Other.SC2Bank"), "utf8")).toContain('name="a"');
    expect(existsSync(path.join(dest, "readme.txt"))).toBe(false);
    expect(await readFile(path.join(t.banksDir, "Score.SC2Bank"), "utf8")).toContain('int="3"');
    expect(await readFile(path.join(t.banksDir, "readme.txt"), "utf8")).toBe("x");
    await expect(saveBanksAsFixture(path.join(t.folder, "empty"), path.join(t.folder, "dest"))).rejects.toThrow(/no .SC2Bank files/);
    expect(existsSync(path.join(t.folder, "dest"))).toBe(false);
  });
});

describe("naming a fixture", () => {
  it("resolves from the Blueprint's folder, and says why a missing, empty or outside folder can't be used", async () => {
    const t = await setup();
    const ws = path.join(t.folder, "ws");
    const blueprint = path.join(ws, "missions", "m1", "blueprint.json");
    await mkdir(path.join(ws, "bank-fixtures", "ok"), { recursive: true });
    await mkdir(path.join(ws, "bank-fixtures", "empty"), { recursive: true });
    await mkdir(path.dirname(blueprint), { recursive: true });
    await writeFile(path.join(ws, "bank-fixtures", "ok", "A.SC2Bank"), bank({ a: 'int="1"' }));
    expect(await missionBankFixture(ws, blueprint, undefined)).toBeUndefined();
    expect(await missionBankFixture(ws, blueprint, "../../bank-fixtures/ok")).toEqual({ name: "../../bank-fixtures/ok", dir: path.join(ws, "bank-fixtures", "ok") });
    expect(await bankFixtureProblem(ws, blueprint, "../../bank-fixtures/missing")).toContain("names a folder that doesn't exist");
    expect(await bankFixtureProblem(ws, blueprint, "../../bank-fixtures/empty")).toContain("holds no .SC2Bank files");
    expect(await bankFixtureProblem(ws, blueprint, "../../../elsewhere")).toContain("outside the Workspace");
    await expect(missionBankFixture(ws, blueprint, "../../bank-fixtures/missing")).rejects.toThrow(/doesn't exist/);
  });
});
