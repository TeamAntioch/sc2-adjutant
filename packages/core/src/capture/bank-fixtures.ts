// A Mission's bank fixture (#55): a folder of `.SC2Bank` files in the Workspace that a test game
// plays on instead of the author's own banks, so a Mission can be tested from a given campaign
// state (after mission 2, with research X). The Blueprint's `bankFixture` names it, as a path from
// the Blueprint's folder, like the Screenplay's source.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isInside } from "../util/inside.js";
import { fixtureBanks } from "./bank-snapshots.js";

/** Where a Workspace keeps fixtures `save_bank_fixture` makes, beside the Missions. */
export const BANK_FIXTURES_FOLDER = "bank-fixtures";

export type MissionBankFixture = { readonly name: string; readonly dir: string };

/**
 * Why the fixture `declared` (as a Blueprint names it) can't be used, if it can't: it is outside
 * the Workspace, isn't a folder, or holds no `.SC2Bank` file.
 */
export async function bankFixtureProblem(workspaceRoot: string, blueprintPath: string, declared: string): Promise<string | undefined> {
  const dir = path.resolve(path.dirname(blueprintPath), declared);
  if (!(await isInside(workspaceRoot, dir))) return `bankFixture ${declared} is outside the Workspace`;
  if (!existsSync(dir)) return `bankFixture ${declared} names a folder that doesn't exist (${dir}); save one with save_bank_fixture or fix the name`;
  if (!statSync(dir).isDirectory()) return `bankFixture ${declared} isn't a folder`;
  if ((await fixtureBanks(dir)).length === 0) return `bankFixture ${declared} holds no .SC2Bank files`;
  return undefined;
}

/** The fixture a Blueprint names, resolved; refused with the reason when it can't be used. Undefined when it names none. */
export async function missionBankFixture(workspaceRoot: string, blueprintPath: string, declared: string | undefined): Promise<MissionBankFixture | undefined> {
  if (declared === undefined) return undefined;
  const problem = await bankFixtureProblem(workspaceRoot, blueprintPath, declared);
  if (problem) throw new Error(problem);
  return { name: declared, dir: path.resolve(path.dirname(blueprintPath), declared) };
}
