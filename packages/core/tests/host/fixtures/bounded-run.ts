// Runs one small command bounded, for derive-bounds.test.ts to start under a lower file-size
// limit than runBounded asks for: runs its argument as a shell script (else one that writes
// nothing), and exits 0 when the run succeeds, else 1 with its error.
import { runBounded } from "../../../src/host/derive.js";

runBounded("/bin/sh", ["-c", process.argv[2] ?? "echo ok > /dev/null"], { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 * 1024 }).then(
  () => process.exit(0),
  (error: Error) => {
    console.error(error.message);
    process.exit(1);
  },
);
