// Records models' animations in the Workspace (ADR-0026), each in its owner's file
// (src/catalog/record-workspace-model-anims.ts), from the Workspace's folder:
//
//   npm run model-anims -- [--mission <id>] <model id>...
//
// A Workspace's own script, which init writes: in the sc2-adjutant checkout, `npm run model-anims`
// is src/cli/model-anims.ts, which records into core's data/model-anims.json. A game model is
// exported through this machine's Host Adapter's model.export; the game's ModelData is downloaded
// once into the machine config's `cacheDir`.

import path from "node:path";

import { campaignModelData } from "../catalog/model-anims.js";
import { formatWorkspaceRecord, recordWorkspaceModelAnims } from "../catalog/record-workspace-model-anims.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import { RECORD_MODEL_ANIMS_USAGE, recordModelAnimsArgs, type RecordModelAnimsArgs } from "./record-model-anims-args.js";

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  let args: RecordModelAnimsArgs;
  try {
    args = recordModelAnimsArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n${RECORD_MODEL_ANIMS_USAGE}`);
    process.exitCode = 2;
    return;
  }
  if ("help" in args) {
    console.log(RECORD_MODEL_ANIMS_USAGE);
    return;
  }
  // npm says where the mapper ran it in INIT_CWD: that folder or one above it is the Workspace's.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) {
    console.error(`${cwd} isn't in a Workspace (no ${WORKSPACE_FILE} in any folder above it)`);
    process.exitCode = 2;
    return;
  }
  const workspace = await loadWorkspace(root);
  const machine = await loadMachineConfig();
  const host = await loadHost(machine);
  const record = await recordWorkspaceModelAnims(workspace, host, args.ids, {
    ...(args.mission !== undefined ? { mission: args.mission } : {}),
    gameModelData: () => campaignModelData(hostContext(machine).requirePath("cacheDir")),
  });
  console.log(formatWorkspaceRecord(record));
  if (record.failed.length > 0) process.exitCode = 1;
}
