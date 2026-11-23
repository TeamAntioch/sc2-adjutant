// A parent for derive-bounds.test.ts to SIGKILL mid-run: it runs, bounded, a command that ignores
// SIGTERM and records its pid in the file named by its first argument, then waits forever. Its
// second and third arguments, when given, are the run's timeout and grace in ms.
import { runBounded } from "../../../src/host/derive.js";

const [pidFile, timeoutMs = "600000", killGraceMs = "600000"] = process.argv.slice(2);
void runBounded("/bin/sh", ["-c", `trap "" TERM; echo $$ > "${pidFile}"; while :; do sleep 0.1; done`], { timeoutMs: Number(timeoutMs), killGraceMs: Number(killGraceMs), maxOutputBytes: 1024 * 1024 }).catch(() => undefined);
setInterval(() => {}, 1000);
