// Snapshots of the game's shared Banks folder around a test game (#54). A Test Document runs the
// Mission's real triggers, which may save banks, so the Editor Broker copies the folder into the
// machine's cache before the game starts and, once it quits, records which banks the run added,
// changed or removed (and for an SC2Bank, which sections and keys). Nothing is rolled back unless
// the author asks, bank by bank, through the bank_changes tool.
//
// Layout, under `<cacheDir>/banks/<run id>/`: `run.json` (the run's record) and `files/` (the
// folder as it was). A run that changed nothing is deleted at once; older runs are pruned.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** The runs kept in the cache, newest first, once pruned. */
export const KEPT_BANK_RUNS = 5;

export type BankKeyChange = {
  readonly key: string;
  readonly status: "added" | "changed" | "removed";
  /** The key's value before the run, as `int="5"`; absent for an added key. */
  readonly before?: string;
  /** The key's value after the run; absent for a removed key. */
  readonly after?: string;
};

export type BankSectionChange = {
  readonly section: string;
  readonly status: "added" | "changed" | "removed";
  readonly keys: BankKeyChange[];
};

export type BankChange = {
  /** The file's path inside the Banks folder, with forward slashes. */
  readonly bank: string;
  readonly status: "added" | "changed" | "removed";
  /** What changed inside an SC2Bank; empty for another file, or when only formatting or the signature differ. */
  readonly sections: BankSectionChange[];
  /** What the author chose; absent while it waits for them. */
  resolution?: "kept" | "rolled-back";
};

export type BankRun = {
  readonly id: string;
  readonly createdAt: string;
  readonly banksDir: string;
  /** The Map Package the test game ran. */
  readonly source: string;
  /** `running` until the game's quit is seen and the changes are recorded. */
  state: "running" | "finished";
  changes: BankChange[];
};

const banksCache = (cacheDir: string): string => path.join(cacheDir, "banks");
const runFolder = (cacheDir: string, id: string): string => path.join(banksCache(cacheDir), id);
const recordFile = (cacheDir: string, id: string): string => path.join(runFolder(cacheDir, id), "run.json");

/** The files under `root`, as paths relative to it with forward slashes. */
async function listFiles(root: string, relative = ""): Promise<string[]> {
  if (!existsSync(path.join(root, relative))) return [];
  const found: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listFiles(root, child)));
    else if (entry.isFile()) found.push(child);
  }
  return found.sort();
}

/**
 * An SC2Bank's keys by section and key name, each value as the attributes of its `<Value>` (`int="5"`),
 * so a change shows as a before and an after. The Signature, which changes with any save, isn't read.
 */
export function parseBank(xml: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  for (const section of xml.matchAll(/<Section\s+name="([^"]*)"\s*>([\s\S]*?)<\/Section>/g)) {
    const keys = sections.get(section[1]!) ?? new Map<string, string>();
    for (const key of section[2]!.matchAll(/<Key\s+name="([^"]*)"\s*>([\s\S]*?)<\/Key>/g)) {
      const values = [...key[2]!.matchAll(/<Value\s+([^>]*?)\s*\/?>/g)].map((value) => value[1]!.replace(/\s+/g, " "));
      keys.set(key[1]!, values.join(" | "));
    }
    sections.set(section[1]!, keys);
  }
  return sections;
}

/** What changed between two versions of a bank, section by section, key by key. */
export function diffBankText(before: string, after: string): BankSectionChange[] {
  const [was, now] = [parseBank(before), parseBank(after)];
  const changes: BankSectionChange[] = [];
  for (const name of [...new Set([...was.keys(), ...now.keys()])]) {
    const [oldKeys, newKeys] = [was.get(name), now.get(name)];
    const keys: BankKeyChange[] = [];
    for (const key of [...new Set([...(oldKeys?.keys() ?? []), ...(newKeys?.keys() ?? [])])]) {
      const [old, current] = [oldKeys?.get(key), newKeys?.get(key)];
      if (old === current) continue;
      keys.push(old === undefined ? { key, status: "added", after: current! } : current === undefined ? { key, status: "removed", before: old } : { key, status: "changed", before: old, after: current });
    }
    if (!oldKeys) changes.push({ section: name, status: "added", keys });
    else if (!newKeys) changes.push({ section: name, status: "removed", keys });
    else if (keys.length > 0) changes.push({ section: name, status: "changed", keys });
  }
  return changes;
}

/** Compares `banksDir` with a snapshot's files: each bank added, changed or removed since. */
export async function diffBanks(snapshot: string, banksDir: string): Promise<BankChange[]> {
  const files = [...new Set([...(await listFiles(snapshot)), ...(await listFiles(banksDir))])].sort();
  const changes: BankChange[] = [];
  for (const bank of files) {
    const [was, now] = [path.join(snapshot, bank), path.join(banksDir, bank)];
    const [hadBefore, hasNow] = [existsSync(was), existsSync(now)];
    if (hadBefore && hasNow) {
      const [oldBytes, newBytes] = [await readFile(was), await readFile(now)];
      if (oldBytes.equals(newBytes)) continue;
      changes.push({ bank, status: "changed", sections: bank.toLowerCase().endsWith(".sc2bank") ? diffBankText(oldBytes.toString("utf8"), newBytes.toString("utf8")) : [] });
    } else {
      const text = bank.toLowerCase().endsWith(".sc2bank") ? (await readFile(hasNow ? now : was)).toString("utf8") : "";
      const sections = diffBankText(hasNow ? "" : text, hasNow ? text : "");
      changes.push({ bank, status: hasNow ? "added" : "removed", sections });
    }
  }
  return changes;
}

async function save(cacheDir: string, run: BankRun): Promise<void> {
  await writeFile(recordFile(cacheDir, run.id), `${JSON.stringify(run, null, 2)}\n`);
}

/** Every recorded run, oldest first. */
export async function bankRuns(cacheDir: string): Promise<BankRun[]> {
  const root = banksCache(cacheDir);
  if (!existsSync(root)) return [];
  const runs: BankRun[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(recordFile(cacheDir, entry.name))) continue;
    try {
      runs.push(JSON.parse(await readFile(recordFile(cacheDir, entry.name), "utf8")) as BankRun);
    } catch {
      // A record cut short by a crash: left for pruning.
    }
  }
  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Deletes all but the newest `keep` runs. */
export async function pruneBankRuns(cacheDir: string, keep = KEPT_BANK_RUNS): Promise<void> {
  const runs = await bankRuns(cacheDir);
  for (const run of runs.slice(0, Math.max(0, runs.length - keep))) await rm(runFolder(cacheDir, run.id), { recursive: true, force: true });
}

/** Copies `banksDir` into the cache as a new running run, and prunes the old ones. */
export async function snapshotBanks(cacheDir: string, banksDir: string, source: string, now = new Date()): Promise<BankRun> {
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const files = path.join(runFolder(cacheDir, id), "files");
  await mkdir(files, { recursive: true });
  if (existsSync(banksDir)) await cp(banksDir, files, { recursive: true });
  const run: BankRun = { id, createdAt: now.toISOString(), banksDir, source, state: "running", changes: [] };
  await save(cacheDir, run);
  await pruneBankRuns(cacheDir);
  return run;
}

/** Forgets a run: a test game that never started. */
export const discardBankRun = (cacheDir: string, id: string): Promise<void> => rm(runFolder(cacheDir, id), { recursive: true, force: true });

/**
 * Records what the run changed, once its game has quit. A run that changed nothing is deleted.
 * `record: false` only computes the changes (a game that may still run).
 */
export async function finishBankRun(cacheDir: string, run: BankRun, record = true): Promise<BankRun> {
  const changes = await diffBanks(path.join(runFolder(cacheDir, run.id), "files"), run.banksDir);
  if (!record) return { ...run, changes };
  if (changes.length === 0) {
    await discardBankRun(cacheDir, run.id);
    return { ...run, state: "finished", changes };
  }
  const finished: BankRun = { ...run, state: "finished", changes };
  await save(cacheDir, finished);
  return finished;
}

/** The newest run with something the author hasn't answered: a game still running, or changes with no choice. */
export async function pendingBankRun(cacheDir: string): Promise<BankRun | undefined> {
  const runs = await bankRuns(cacheDir);
  return runs.reverse().find((run) => run.state === "running" || run.changes.some((change) => !change.resolution));
}

/**
 * Applies the author's choices to a finished run's changes: `keep` leaves a bank as the game left
 * it; `rollback` puts back the snapshot's version (deleting a bank the run added). A name that
 * isn't one of the run's changed banks is an error, and nothing is applied.
 */
export async function resolveBanks(cacheDir: string, run: BankRun, choices: { readonly keep?: readonly string[]; readonly rollback?: readonly string[] }): Promise<BankRun> {
  const known = new Set(run.changes.map((change) => change.bank));
  const unknown = [...(choices.keep ?? []), ...(choices.rollback ?? [])].filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`Not banks this run changed: ${unknown.join(", ")}. It changed: ${[...known].join(", ")}`);
  const both = (choices.keep ?? []).filter((name) => (choices.rollback ?? []).includes(name));
  if (both.length > 0) throw new Error(`Asked to both keep and roll back: ${both.join(", ")}`);
  const files = path.join(runFolder(cacheDir, run.id), "files");
  for (const change of run.changes) {
    if (choices.keep?.includes(change.bank)) change.resolution = "kept";
    else if (choices.rollback?.includes(change.bank)) {
      const target = path.join(run.banksDir, change.bank);
      if (change.status === "added") await rm(target, { force: true });
      else {
        await mkdir(path.dirname(target), { recursive: true });
        await cp(path.join(files, change.bank), target);
      }
      change.resolution = "rolled-back";
    }
  }
  // Every change answered: the snapshot isn't needed.
  if (run.changes.every((change) => change.resolution)) await rm(files, { recursive: true, force: true });
  await save(cacheDir, run);
  return run;
}

/** A run's changes as lines for the author, each unanswered bank with its sections and keys. */
export function describeBankRun(run: BankRun): string[] {
  const open = run.changes.filter((change) => !change.resolution);
  const lines: string[] = [];
  const source = path.basename(run.source);
  if (run.state === "running") lines.push(`The test game of ${source} (started ${run.createdAt}) hasn't been seen to quit, so what it changes in the Banks folder isn't recorded yet.`);
  for (const change of run.changes) {
    lines.push(`  ${change.bank}: ${change.status}${change.resolution ? ` (${change.resolution === "kept" ? "kept" : "rolled back"})` : ""}`);
    if (change.resolution) continue;
    if (change.status === "changed" && change.sections.length === 0) lines.push("    the signature or formatting only");
    for (const section of change.sections) {
      lines.push(`    [${section.section}]${section.status === "changed" ? "" : ` ${section.status}`}`);
      for (const key of section.keys) lines.push(`      ${key.key}: ${key.status === "added" ? `added ${key.after}` : key.status === "removed" ? `removed (was ${key.before})` : `${key.before} -> ${key.after}`}`);
    }
  }
  if (open.length > 0) lines.unshift(`The test game of ${source} changed ${open.length} bank${open.length === 1 ? "" : "s"} in ${run.banksDir}. Nothing is rolled back unless the author says so: ask which to keep and which to roll back, then call bank_changes with keep and rollback.`);
  return lines;
}
