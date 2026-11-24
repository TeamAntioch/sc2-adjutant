// The runtime with the example's data type-checks as Galaxy. plaxtony checks it against the game's
// natives.galaxy, which can't ship: the test runs where NATIVES names the folder holding it (core.sc2mod's
// TriggerLibs, extracted) and PLAXTONY plaxtony's package folder, and is skipped elsewhere.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildTestbed } from "../build.ts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const NATIVES = process.env.NATIVES;
const PLAXTONY = process.env.PLAXTONY;
const ready = NATIVES !== undefined && PLAXTONY !== undefined && existsSync(path.join(NATIVES, "natives.galaxy")) && existsSync(PLAXTONY);

describe.skipIf(!ready)("the generated Galaxy", () => {
  it.each([false, true])("type-checks with plaxtony (tour: %s)", async (tour) => {
    const root = await mkdtemp(path.join(tmpdir(), "anim-testbed-galaxy-"));
    try {
      await mkdir(path.join(root, "Ashfall-Relay.SC2Map"), { recursive: true });
      await writeFile(path.join(root, "Ashfall-Relay.SC2Map", "MapInfo"), "");
      await mkdir(path.join(root, "tests"));
      await cp(path.join(PACKAGE, "examples", "stock-units.json"), path.join(root, "tests", "stock-units.json"));
      const result = await buildTestbed(path.join(root, "tests", "stock-units.json"), { workspace: null, check: true, tour });
      expect(result.report.errors).toEqual([]);
      const out = execFileSync("node", [path.join(PACKAGE, "tools", "check-galaxy.cjs"), result.scriptPath], { encoding: "utf8" });
      expect(out.trim()).toBe("0 problems");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
