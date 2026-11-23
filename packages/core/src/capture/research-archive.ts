// The research archive (README "Research archive"): a folder outside the repo for material git
// ignores but we keep, such as full-size captures. Its paths mirror this repo's. $SC2_RESEARCH_DIR
// names it; there is no default.

/** The archive's root, $SC2_RESEARCH_DIR, or undefined when it isn't set. */
export function researchArchiveDirIfSet(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SC2_RESEARCH_DIR || undefined;
}

/** The archive's root, $SC2_RESEARCH_DIR. Throws when it isn't set. */
export function researchArchiveDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = researchArchiveDirIfSet(env);
  if (!dir) throw new Error(RESEARCH_DIR_UNSET);
  return dir;
}

export const RESEARCH_DIR_UNSET = 'SC2_RESEARCH_DIR isn\'t set. Set it to the folder of your research archive (README "Research archive"), such as export SC2_RESEARCH_DIR=~/sc2-research.';
