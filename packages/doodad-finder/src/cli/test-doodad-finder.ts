// The Doodad Finder's test command, narrowing part (ADR-0020): runs the narrowing on the Search
// Parts of past Doodad Searches (each part's name and its line as asks, its judged candidates as
// what it should find) and on the tick logs (each Mission's, the research archive's, and a public
// Finder's --tick-log folder), with the real embeddings model, and reports the hit rate and
// timings. Then, ranking part, Jev (with TYPESAFE_API_KEY or the saved key file) grades every ask's narrowed
// candidates, and it reports the top-10 hit rate, the timings and the estimated spend. It fails
// when the narrowing's p95 is over 50 ms, a warm start over 3 s, Jev's p50 over 300 ms or its p95
// over 800 ms, or a call fails.
//
//   npm run test-doodad-finder -- [--workspace <folder>] [--tick-log <folder>] [--runs n] [--model <name>] [--no-rank] [--budget dollars] [--json]
//
// Jev's are live calls, made only when this is run by hand, never by the test suite: each sends an
// ask (with its object and tags) and its candidates' cards. They stop before the estimated spend
// would pass --budget (0.50 US dollars by default); --no-rank makes none. Every call's exact
// payload goes to a file per run in the cache folder's ranker-payloads/.
//
// The Workspace is the one given, else the one above where the command was typed; without one it
// runs on core's catalogs and the research archive's searches alone. The past searches are read at
// run time from $SC2_RESEARCH_DIR/doodad-search/, when SC2_RESEARCH_DIR is set, and each Mission's
// output/doodad-search/. The model's weights download to the machine's cache the first time.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { researchArchiveDirIfSet } from "@team-antioch/sc2-adjutant/dist/capture/research-archive.js";
import { missionDependencies } from "@team-antioch/sc2-adjutant/dist/catalog/workspace-doodad-search.js";
import { WORKSPACE_FILE, workspaceRootFor } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import { catalogCacheDir } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";
import { openRanker } from "@team-antioch/sc2-doodad-finder/credentials.js";
import { FINDER_MODEL, localEmbedder } from "@team-antioch/sc2-doodad-finder/embedder.js";
import { type Finder, openFinder, vectorCacheFile } from "@team-antioch/sc2-doodad-finder/finder.js";
import type { Narrowed } from "@team-antioch/sc2-doodad-finder/narrow.js";
import { payloadLog, payloadLogFile } from "@team-antioch/sc2-doodad-finder/payload-log.js";
import { orderByFit, type Ranker, type RankerName } from "@team-antioch/sc2-doodad-finder/ranker.js";
import { finderSources, type WorkspaceSources } from "../adjutant/sources.ts";
import { addHits, ARCHIVE_TICK_LOG, formatHits, type Hits, hits, type NarrowingCase, pastSearchCases, pastSearchFiles, percentile, TICK_LOG_FILE, tickLogCases, tickLogFiles, topHits } from "../test-cases.ts";

const USAGE = "Usage: npm run test-doodad-finder -- [--workspace <folder>] [--tick-log <folder>] [--runs n] [--model <name>] [--no-rank] [--budget dollars] [--json]";

/** The speed targets the command fails on (spec #630). */
export const NARROWING_P95_MS = 50;
export const WARM_START_MS = 3000;
export const JEV_P50_MS = 300;
export const JEV_P95_MS = 800;
/** Reported only, until the page (#634) measures it: Enter to the final order with Jev. */
export const ENTER_P50_MS = 350;

/** How many of the ranked candidates the author sees first. */
const TOP_RANKED = 10;
/** A first call's cost, guessed before any ranker has answered: well above what a 200-card ask costs. */
const FIRST_CALL_GUESS = 0.01;

/** This run's payload log. */
const PAYLOAD_LOG = payloadLogFile();
const logPayload = payloadLog(PAYLOAD_LOG);

/** How many of a part's candidates count as its top-ranked ones. */
const TOP = 3;

type Opened = { readonly finder: Finder; readonly sources: WorkspaceSources; readonly embedded: number; readonly ms: number };

async function open(workspaceRoot: string | undefined, model: string): Promise<Opened> {
  const started = performance.now();
  const [embedder, sources] = await Promise.all([localEmbedder({ model }), finderSources(workspaceRoot)]);
  const finder = await openFinder({ load: sources.load, embedder, cacheFile: vectorCacheFile(model) });
  return { finder, sources, embedded: finder.embeddedOnOpen, ms: performance.now() - started };
}

/** A warm start, in a process of its own so nothing is loaded yet: Node starting, the model, the sources, the cards and the cache. */
function warmStart(workspaceRoot: string | undefined, model: string): number {
  const started = performance.now();
  const self = fileURLToPath(import.meta.url);
  const run = spawnSync(process.execPath, [self, "--start-only", "--model", model, ...(workspaceRoot ? ["--workspace", workspaceRoot] : [])], { encoding: "utf8" });
  const ms = performance.now() - started;
  if (run.status !== 0) throw new Error(`The warm start failed: ${run.stderr.trim()}`);
  return ms;
}

type CaseResult = {
  readonly case: NarrowingCase;
  readonly targets: Hits;
  readonly top: Hits;
  readonly accepted: Hits;
  readonly missed: readonly string[];
  readonly unknown: readonly string[];
  readonly merged: number;
  /** The narrowing's last candidates and its p50 time for this ask, for the rankers. */
  readonly narrowed: readonly Narrowed[];
  readonly narrowP50: number;
  /** The targets the catalogs know, best first. */
  readonly known: readonly string[];
};

type RankerResult = {
  readonly ranker: RankerName;
  /** Targets in the top 10, out of as many as fit there; and of each part's best three. */
  readonly top: Hits;
  readonly best: Hits;
  /** The same asks' targets in the top 10 of the narrowing's own order, to compare with. */
  readonly narrowingTop: Hits;
  readonly times: readonly number[];
  readonly enter: readonly number[];
  readonly asked: number;
  readonly cases: readonly { readonly from: string; readonly top: Hits; readonly ms: number }[];
  readonly errors: readonly string[];
  readonly stopped?: string;
};

type Spend = { total: number; readonly budget: number };

/** One ranker over every case, sequentially, after one untimed call to open its connection; stopping before the spend would pass the budget. */
async function rankCases(ranker: Ranker, results: readonly CaseResult[], spend: Spend, log: (line: string) => void): Promise<RankerResult> {
  const none = { found: 0, of: 0 };
  const out = { top: none, best: none, narrowingTop: none, times: [] as number[], enter: [] as number[], asked: 0, cases: [] as { from: string; top: Hits; ms: number }[], errors: [] as string[] };
  let lastCost = FIRST_CALL_GUESS;
  let stopped: string | undefined;
  const asks = results.filter((result) => result.narrowed.length);
  const rank = ({ case: testCase, narrowed }: CaseResult) => ranker.rank({ ask: testCase.ask, object: testCase.object, tags: testCase.tags, candidates: narrowed.map(({ card }) => card) });
  const affordable = () => spend.total + 1.5 * lastCost <= spend.budget;
  if (asks.length && affordable()) {
    // Untimed: opens the connection. Its failure is logged, not counted against an ask.
    try {
      const ranking = await rank(asks[0]!);
      spend.total += ranking.cost;
      lastCost = ranking.cost;
    } catch (error) {
      log(`${ranker.name} failed on its untimed first call: ${(error as Error).message}`);
    }
  }
  for (const result of asks) {
    if (!affordable()) {
      stopped = `stopped after ${out.asked} asks: the next call would take the spend past $${spend.budget.toFixed(2)}`;
      break;
    }
    const { case: testCase, narrowed } = result;
    try {
      const ranking = await rank(result);
      spend.total += ranking.cost;
      lastCost = ranking.cost;
      const ordering = performance.now();
      const ordered = orderByFit(narrowed, ranking.grades).map(({ id }) => id);
      const orderMs = performance.now() - ordering;
      out.asked++;
      out.times.push(ranking.timings.total);
      out.enter.push(result.narrowP50 + ranking.timings.total + orderMs);
      const top = topHits(ordered, result.known, TOP_RANKED);
      out.top = addHits(out.top, top);
      out.best = addHits(out.best, topHits(ordered, result.known.slice(0, TOP), TOP_RANKED));
      out.narrowingTop = addHits(out.narrowingTop, topHits(narrowed.map(({ id }) => id), result.known, TOP_RANKED));
      out.cases.push({ from: testCase.from, top, ms: ranking.timings.total });
    } catch (error) {
      out.errors.push(`${testCase.from}: ${(error as Error).message}`);
      log(`${ranker.name} failed on ${testCase.from}: ${(error as Error).message}`);
    }
  }
  if (!asks.length) stopped = "had no asks: no narrowing found any candidates";
  return { ranker: ranker.name, ...out, ...(stopped ? { stopped } : {}) };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { workspace: { type: "string" }, "tick-log": { type: "string" }, runs: { type: "string" }, model: { type: "string" }, "no-rank": { type: "boolean" }, budget: { type: "string" }, json: { type: "boolean" }, "start-only": { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) return void console.log(USAGE);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const workspaceRoot = values.workspace ? path.resolve(cwd, values.workspace) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  const model = values.model ?? FINDER_MODEL;
  if (values["start-only"]) {
    const { finder } = await open(workspaceRoot, model);
    await finder.narrow("warm start");
    finder.close();
    return;
  }
  const runs = Number(values.runs ?? 5);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs takes a whole number above 0\n${USAGE}`);
  const budget = Number(values.budget ?? 0.5);
  if (!(budget >= 0)) throw new Error(`--budget takes US dollars, 0 or more\n${USAGE}`);

  const log = values.json ? () => {} : (line: string) => console.log(line);
  log(workspaceRoot ? `Workspace ${workspaceRoot}` : "No Workspace: core's catalogs and the research archive's searches only");
  log(`Model ${model}`);
  const opened = await open(workspaceRoot, model);
  log(`Opened in ${Math.round(opened.ms)} ms (${opened.finder.cards.size} cards, ${opened.embedded} embedded now)`);
  const warm = warmStart(workspaceRoot, model);
  log(`Warm start in a new process: ${Math.round(warm)} ms`);

  const { sources } = opened;
  const missionsDir = sources.workspace?.missionsDir;
  const researchDir = researchArchiveDirIfSet();
  // Ticks for no Mission made while SC2_RESEARCH_DIR wasn't set are in the cache folder's log.
  const noMissionCacheLog = [path.join(catalogCacheDir(), ARCHIVE_TICK_LOG)];
  const past = await pastSearchCases(await pastSearchFiles(researchDir, missionsDir));
  const publicLog = values["tick-log"] !== undefined ? [path.join(path.resolve(cwd, values["tick-log"]), TICK_LOG_FILE)] : [];
  const ticks = await tickLogCases([...(await tickLogFiles(missionsDir, researchDir)), ...noMissionCacheLog, ...publicLog]);
  const cases = [...past.cases, ...ticks.cases];
  for (const { file, reason } of [...past.skipped, ...ticks.skipped]) log(`Skipped ${file}: ${reason}`);
  if (!cases.length) throw new Error("No test cases: no past Doodad Search's search.json and no tick log was found");

  const dependenciesOf = new Map<string, readonly string[]>();
  const results: CaseResult[] = [];
  const totals: number[] = [];
  const stages = { keyword: [] as number[], embed: [] as number[], nearest: [] as number[], merge: [] as number[] };
  const { finder } = opened;
  for (const testCase of cases) {
    let dependencies: readonly string[] | undefined;
    if (testCase.mission && sources.workspace) {
      if (!dependenciesOf.has(testCase.mission)) dependenciesOf.set(testCase.mission, await missionDependencies(sources.workspace, testCase.mission).catch(() => []));
      dependencies = dependenciesOf.get(testCase.mission);
    }
    let found: Set<string> | undefined;
    let narrowed: readonly Narrowed[] = [];
    const caseTotals: number[] = [];
    // The first run warms the case up and isn't timed.
    for (let run = 0; run <= runs; run++) {
      const narrowing = await finder.narrow(testCase.ask, { ...(testCase.tags ? { tags: testCase.tags } : {}), dependencies });
      narrowed = narrowing.candidates;
      found = new Set(narrowing.candidates.map(({ id }) => id));
      if (run === 0) continue;
      totals.push(narrowing.timings.total);
      caseTotals.push(narrowing.timings.total);
      for (const stage of Object.keys(stages) as (keyof typeof stages)[]) stages[stage].push(narrowing.timings[stage]);
    }
    const known = testCase.targets.filter((id) => finder.cards.has(id));
    const accepted = known.filter((id) => finder.cards.get(id)!.entry.uses.length > 0);
    results.push({
      case: testCase,
      targets: hits(known, found!),
      top: hits(known.slice(0, TOP), found!),
      accepted: hits(accepted, found!),
      missed: known.filter((id) => !found!.has(id)),
      unknown: testCase.targets.filter((id) => !finder.cards.has(id)),
      merged: found!.size,
      narrowed,
      narrowP50: percentile(caseTotals, 50),
      known,
    });
  }
  finder.close();

  // Jev over every case's narrowed candidates; the narrowing's own order for comparison.
  const jevOpened = values["no-rank"] ? { off: "--no-rank asked for none" } : openRanker({ log: logPayload });
  const off = jevOpened.off ? [{ ranker: "jev", reason: jevOpened.off }] : [];
  for (const { ranker, reason } of off) log(`Ranker ${ranker} is off: ${reason}`);
  const spend: Spend = { total: 0, budget };
  const ranked: RankerResult[] = [];
  if (jevOpened.ranker) ranked.push(await rankCases(jevOpened.ranker, results, spend, log));

  const sum = (pick: (result: CaseResult) => Hits, of = results) => of.map(pick).reduce(addHits, { found: 0, of: 0 });
  const byAsk = (kind: string) => results.filter((result) => result.case.from.endsWith(`(${kind})`));
  const p50 = percentile(totals, 50);
  const p95 = percentile(totals, 95);
  const stageP50 = Object.fromEntries(Object.entries(stages).map(([stage, times]) => [stage, percentile(times, 50)]));
  const jev = ranked.find(({ ranker }) => ranker === "jev");
  const jevP50 = jev ? percentile(jev.times, 50) : Number.NaN;
  const jevP95 = jev ? percentile(jev.times, 95) : Number.NaN;
  const failures = [
    ...(p95 > NARROWING_P95_MS ? [`narrowing p95 ${p95.toFixed(1)} ms is over ${NARROWING_P95_MS} ms`] : []),
    ...(warm > WARM_START_MS ? [`warm start ${Math.round(warm)} ms is over ${WARM_START_MS} ms`] : []),
    // Jev with a key but no timed ask can't pass its targets.
    ...(jev && !jev.times.length ? ["Jev timed no asks, so its speed targets weren't measured"] : []),
    ...(jevP50 > JEV_P50_MS ? [`Jev p50 ${Math.round(jevP50)} ms is over ${JEV_P50_MS} ms`] : []),
    ...(jevP95 > JEV_P95_MS ? [`Jev p95 ${Math.round(jevP95)} ms is over ${JEV_P95_MS} ms`] : []),
    ...ranked.filter(({ errors }) => errors.length).map(({ ranker, errors }) => `${ranker} failed on ${errors.length} asks`),
  ];
  const rankerSummary = (result: RankerResult) => ({
    ranker: result.ranker,
    asked: result.asked,
    top10: result.top,
    best3InTop10: result.best,
    narrowingOrderTop10: result.narrowingTop,
    p50: percentile(result.times, 50),
    p95: percentile(result.times, 95),
    enterP50: percentile(result.enter, 50),
    cases: result.cases,
    errors: result.errors,
    ...(result.stopped ? { stopped: result.stopped } : {}),
  });

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          cases: results.map(({ case: { from, ask }, narrowed: _narrowed, narrowP50: _narrowP50, known: _known, ...rest }) => ({ from, ask, ...rest })),
          hitRate: { targets: sum((r) => r.targets), top: sum((r) => r.top), accepted: sum((r) => r.accepted) },
          timings: { p50, p95, stageP50, narrowings: totals.length, warmStart: warm, open: opened.ms },
          ranking: { rankers: ranked.map(rankerSummary), off, spend: spend.total, payloads: PAYLOAD_LOG },
          failures,
        },
        null,
        2,
      ),
    );
  } else {
    log("");
    for (const result of results) {
      const missed = result.missed.length ? `; missed ${result.missed.join(", ")}` : "";
      const unknown = result.unknown.length ? `; not in the catalogs ${result.unknown.join(", ")}` : "";
      log(`${result.case.from}: ${formatHits(result.targets)} of its candidates among ${result.merged}, top ${TOP} ${formatHits(result.top)}${missed}${unknown}`);
    }
    log("");
    log(`Narrowing hit rate, candidates: ${formatHits(sum((r) => r.targets))} (asked by name ${formatHits(sum((r) => r.targets, byAsk("name")))}, by line ${formatHits(sum((r) => r.targets, byAsk("line")))})`);
    log(`Narrowing hit rate, top ${TOP} of each part: ${formatHits(sum((r) => r.top))}`);
    log(`Narrowing hit rate, accepted (with a Doodad Use): ${formatHits(sum((r) => r.accepted))}`);
    log(
      `Narrowing over ${totals.length} asks: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (p50 keyword ${stageP50.keyword!.toFixed(1)}, embed ${stageP50.embed!.toFixed(1)}, nearest ${stageP50.nearest!.toFixed(1)}, merge ${stageP50.merge!.toFixed(1)} ms)`,
    );
    log(`Warm start: ${Math.round(warm)} ms`);
    log("");
    for (const result of ranked) {
      const summary = rankerSummary(result);
      for (const { from, top, ms } of result.cases) log(`  ${result.ranker} ${from}: top ${TOP_RANKED} ${formatHits(top)} in ${Math.round(ms)} ms`);
      log(
        `${result.ranker} over ${result.asked} asks: top ${TOP_RANKED} ${formatHits(result.top)} (the narrowing's own order ${formatHits(result.narrowingTop)}), best ${TOP} of each part in the top ${TOP_RANKED} ${formatHits(result.best)}`,
      );
      log(`${result.ranker} timings: p50 ${Math.round(summary.p50)} ms, p95 ${Math.round(summary.p95)} ms; Enter to final order (narrowing + ranking + order) p50 ${Math.round(summary.enterP50)} ms${result.ranker === "jev" ? ` (target ${ENTER_P50_MS} ms, reported only)` : ""}`);
      if (result.stopped) log(`${result.ranker} ${result.stopped}`);
    }
    if (jevOpened.ranker) log(`Estimated spend this run: $${spend.total.toFixed(4)}; payloads in ${PAYLOAD_LOG}`);
    log(failures.length ? `FAILED: ${failures.join("; ")}` : "Passed the speed targets");
  }
  if (failures.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
