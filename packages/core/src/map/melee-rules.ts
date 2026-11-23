// The melee rules by id, and the error that stops a build for breaking them (#216, spec #212
// "Checks"): each finding names its rule and the object that breaks it. The checks themselves are
// in melee-checks.ts (the drawn map), melee-mains.ts (the mains as drawn up) and melee-status.ts
// (the written package).

/** The rules, by id: the errors first, then the warnings. */
export const MELEE_RULES = {
  "melee-status": "the Editor's melee checklist (research §4)",
  "start-base": "a standard start base: 4 large and 4 small patches and 2 geysers, against the town hall",
  symmetry: "every object's partner within 1 cell under the rotation, and nothing on top of another",
  "main-entrance": "a main's only ground entrance is its ramp, unless rocks block the other",
  "main-ramp": "the standard main ramp: the ladder's narrow diagonal ramp, one level down to the natural",
  "forbidden-feature": "no feature TLMC forbids (research §1a)",
  "ramp-to-ramp": "ramp to ramp 33-38 s, the Standard band",
  "main-to-natural": "main to natural 6-10 s",
  "main-to-third": "main to third 10-20 s",
  "second-third": "a second third within about 4 s of the first",
  "base-count": "14-16 bases on a two-spawn map",
  "air-vs-ground": "air at least 60% of ground to an early base",
} as const;
export type MeleeRule = keyof typeof MELEE_RULES;

/** One broken rule: which, and the object that breaks it. */
export type MeleeFinding = { readonly rule: MeleeRule; readonly object: string; readonly message: string };

export const formatFinding = (finding: MeleeFinding): string => `[${finding.rule}] ${finding.object}: ${finding.message}`;

/** A build stopped by melee rules: every error found, each with its rule and object. */
export class MeleeRuleError extends Error {
  readonly findings: readonly MeleeFinding[];

  constructor(findings: readonly MeleeFinding[]) {
    super(
      findings.length === 1
        ? `Melee rule broken: ${formatFinding(findings[0]!)}`
        : `${findings.length} melee rules broken:\n${findings.map((finding) => `  ${formatFinding(finding)}`).join("\n")}`,
    );
    this.name = "MeleeRuleError";
    this.findings = findings;
  }
}

/** Throws a one-finding MeleeRuleError. */
export function meleeError(rule: MeleeRule, object: string, message: string): never {
  throw new MeleeRuleError([{ rule, object, message }]);
}
