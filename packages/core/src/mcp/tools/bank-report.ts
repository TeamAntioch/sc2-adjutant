// What a test game changed in the game's Banks folder (#54): the report test_mission and bank_changes give, and the author's keep or roll-back choices.

import { type BankRun, describeBankRun, finishBankRun, pendingBankRun, resolveBanks } from "../../capture/bank-snapshots.js";
import { type Host } from "../../host/host.js";
import { hostContext } from "../../host/machine-config.js";

export type BankChoices = {
  readonly keep?: readonly string[] | undefined;
  readonly rollback?: readonly string[] | undefined;
  readonly keepAll?: boolean | undefined;
  readonly rollbackAll?: boolean | undefined;
};

/**
 * The newest test game's bank changes still waiting for the author, as lines (none when nothing
 * waits), after applying `choices` to them. A run whose game hasn't been seen to quit is recorded
 * first when the Host Adapter says the game is gone; while it runs, the changes so far are shown and no choice is applied; when the host can't tell, they are shown
 * until the author makes a choice, which is taken as their word that the game has quit.
 */
export async function bankReport(host: Host, choices: BankChoices = {}): Promise<{ readonly lines: string[]; readonly run?: BankRun; readonly refused?: boolean }> {
  let cacheDir: string;
  try {
    cacheDir = hostContext(host.machine).requirePath("cacheDir");
  } catch {
    return { lines: [] };
  }
  let run = await pendingBankRun(cacheDir);
  if (!run) return { lines: [] };
  const asked = Boolean(choices.keep?.length || choices.rollback?.length || choices.keepAll || choices.rollbackAll);
  if (run.state === "running") {
    const canTell = host.has("game.running");
    // A host that can't tell takes the author's keep or rollback as their word that the game has quit.
    const playing = canTell ? await host.run("game.running", {}).catch(() => true) : !asked;
    if (playing) {
      const soFar = await finishBankRun(cacheDir, run, false);
      const why = canTell ? "the game is still running" : "this machine's Host Adapter can't tell whether the game has quit, so keep or rollback is taken as the author's word that it has";
      const lines = [`Banks, so far (${why}):`, ...(soFar.changes.length > 0 ? describeBankRun({ ...soFar, state: "running" }) : ["  no bank has changed yet."])];
      return { lines: asked ? [`Nothing kept or rolled back: ${why}. Quit the game, then ask again.`, ...lines] : lines, run: soFar, refused: asked };
    }
    run = await finishBankRun(cacheDir, run);
    if (run.changes.length === 0) return { lines: [] };
  }
  if (asked) {
    const open = run.changes.filter((change) => !change.resolution).map((change) => change.bank);
    const rollback = new Set([...(choices.rollback ?? []), ...(choices.rollbackAll ? open : [])]);
    const keep = new Set([...(choices.keep ?? []), ...(choices.keepAll ? open : [])]);
    // A bank named on its own side stays there when the other side asked for all.
    for (const name of choices.keep ?? []) rollback.delete(name);
    for (const name of choices.rollback ?? []) keep.delete(name);
    run = await resolveBanks(cacheDir, run, { keep: [...keep], rollback: [...rollback] });
  }
  return { lines: describeBankRun(run), run };
}
