// sc2-adjutant's Set Finder page (#726, #802): the published @team-antioch/sc2-set-finder's page,
// with this machine's own sets laid over the published ones (sets.ts).
//
//   npm run set-finder -- [--port n] [--budget dollars] [--views <dir>] [--looks <file>] [--workspace <dir>] [--open]
//
// The published sets' pictures load from the sc2-mapping-reference gallery; the sets laid over
// them are the ones render-set-views drew (--views, the cache folder's set-views by default) that
// have a look in the Workspace's cinematic-sets/looks.json (--workspace, else the Workspace holding
// the folder npm was run from) or in core's data/cinematic-sets/looks.json (--looks), and the page
// serves their pictures from that folder. Asks are ranked by Jev with the finders' key
// (TYPESAFE_API_KEY, or the key file `npx @team-antioch/sc2-set-finder login` saves); with none the
// page shows the narrowing's order.

import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";

import { WORKSPACE_FILE, workspaceRootFor } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import { SET_FINDER_PORT, startSetFinder } from "@team-antioch/sc2-set-finder";

import { ownSets } from "./sets.ts";

const USAGE = "Usage: npm run set-finder -- [--port n] [--budget dollars] [--views <dir>] [--looks <file>] [--workspace <dir>] [--open]";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { port: { type: "string" }, budget: { type: "string" }, views: { type: "string" }, looks: { type: "string" }, workspace: { type: "string" }, open: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) return void console.log(USAGE);
  const port = values.port === undefined ? SET_FINDER_PORT : Number(values.port);
  if (values.port === "" || !Number.isInteger(port) || port < 0) throw new Error(`--port takes a port number\n${USAGE}`);
  const budget = values.budget === undefined ? undefined : Number(values.budget);
  if (budget !== undefined && (values.budget === "" || !(budget >= 0))) throw new Error(`--budget takes US dollars, 0 or more\n${USAGE}`);
  const started = performance.now();
  // npm runs scripts from the package root, so the folder it was started from is INIT_CWD.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const workspaceRoot = values.workspace ? path.resolve(cwd, values.workspace) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  const { layers, viewsDir, published } = await ownSets({ workspaceRoot, ...(values.views ? { viewsDir: values.views } : {}), ...(values.looks ? { looksFile: values.looks } : {}) });
  const running = await startSetFinder({ extra: layers, port, ...(budget !== undefined ? { budget } : {}), log: (line) => console.log(line) });
  const own = layers.reduce((sum, layer) => sum + Object.keys(layer.looks).length, 0);
  console.log(`Set Finder: ${running.cards} sets, ${published.size} published and ${own} of this machine's${viewsDir ? ` from ${viewsDir}` : ""}${workspaceRoot ? `, with the Workspace's at ${workspaceRoot}` : ", no Workspace"}${running.embeddedOnOpen ? `, ${running.embeddedOnOpen} newly embedded` : ""} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
  console.log(running.off ? `Not ranked by Jev: ${running.off}` : "Ranked by Jev");
  console.log(running.url);
  if (values.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    // A missing opener (no xdg-open) leaves the Set Finder running: the URL above is printed to open by hand.
    const child = spawn(opener, [running.url], { stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", (error) => console.error(`The page didn't open (${error.message}): open ${running.url} by hand.`));
    child.unref();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
