// Records the game's ClientAPI (127.0.0.1:6119/game) while a Test Document run is going, to find out
// whether a player's result changes at victory or defeat (issue #741, docs/reference/game-testing.md).
// Start it, then start the test; end the game with a win or a loss on a throwaway map.
//
//   npm run probe-game -- [--seconds 300] [--interval 1000] [--out <file.jsonl>] [--stop-when-decided]

import { appendFileSync, writeFileSync } from "node:fs";

import { probeGame, summariseProbe } from "../host/game-probe.js";
import { helpAsked, optionValue } from "./help-asked.js";

const VALUED = new Set(["--seconds", "--interval", "--out", "--url"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (helpAsked(args, VALUED)) {
    console.log("Usage: probe-game [--seconds 300] [--interval 1000] [--out <file.jsonl>] [--url <game url>] [--stop-when-decided]");
    return;
  }
  let seconds = 300;
  let interval = 1000;
  let out: string | undefined;
  let url: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--seconds") seconds = Number(optionValue(args, i++, arg));
    else if (arg === "--interval") interval = Number(optionValue(args, i++, arg));
    else if (arg === "--out") out = optionValue(args, i++, arg);
    else if (arg === "--url") url = optionValue(args, i++, arg);
    else if (arg !== "--stop-when-decided") throw new Error(`Unknown option ${arg}`);
  }
  if (!(seconds > 0) || !(interval > 0)) throw new Error("--seconds and --interval must be positive numbers");
  // Each event is appended as it happens, so stopping the run early (Ctrl-C) keeps what it saw.
  if (out) writeFileSync(out, "");
  const events = await probeGame({
    durationMs: seconds * 1000,
    intervalMs: interval,
    stopWhenDecided: args.includes("--stop-when-decided"),
    ...(url ? { url } : {}),
    onEvent: (event) => {
      console.log(`${event.at}s ${event.kind}${event.changes.length ? ": " + event.changes.join("; ") : ""}`);
      if (out) appendFileSync(out, JSON.stringify(event) + "\n");
    },
  });
  console.log(summariseProbe(events));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
