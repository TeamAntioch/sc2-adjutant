// The MapScript drift test (ADR-0010): a spliced MapScript.galaxy compared with the one the Editor
// writes when it saves the same map. Splicing keeps the Editor's Galaxy for Kept triggers and adds
// the compile's own blocks where the Editor would put them; any difference here is where that
// guess and the Editor part ways, reported by the Editor's own sections.

const RULE = "//--------------------------------------------------------------------------------------------------";

/** One section of a script: its title ("Header", "Global Variables", "Trigger: Gate Opens") and its lines. */
export type ScriptSection = { readonly title: string; readonly lines: readonly string[] };

export type SectionDrift = {
  readonly section: string;
  readonly change: "changed" | "only in the spliced script" | "only in the Editor's";
  /** Lines one side has and the other doesn't, `-` the spliced script's and `+` the Editor's, at most `limit` of them. */
  readonly lines: readonly string[];
};

/**
 * The script's sections, split at the Editor's titled rules (a rule, `// <title>`, a rule). A
 * trigger's `_Init`, after a bare rule, stays in its trigger's section; what comes before the
 * first title is the "Header".
 */
export function scriptSections(script: string): ScriptSection[] {
  const lines = script.split(/\r?\n/);
  const sections: { title: string; lines: string[] }[] = [{ title: "Header", lines: [] }];
  for (let index = 0; index < lines.length; index++) {
    const title = lines[index] === RULE && lines[index + 2] === RULE ? /^\/\/ (.+)$/.exec(lines[index + 1] ?? "")?.[1] : undefined;
    if (title) {
      sections.push({ title, lines: [] });
      index += 2;
      continue;
    }
    sections.at(-1)!.lines.push(lines[index]!);
  }
  return sections;
}

/** The lines of `a` that `b` lacks, counting repeats: a line `a` has twice and `b` once is one of them. */
function linesMissing(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const line of b) left.set(line, (left.get(line) ?? 0) + 1);
  return a.filter((line) => {
    const count = left.get(line) ?? 0;
    if (count === 0) return true;
    left.set(line, count - 1);
    return false;
  });
}

/** Sections keyed by title, a repeated title by its turn ("Custom Script", "Custom Script#2"), so each is compared with its counterpart. */
function keyed(sections: readonly ScriptSection[]): { key: string; title: string; lines: readonly string[] }[] {
  const seen = new Map<string, number>();
  return sections.map(({ title, lines }) => {
    const turn = (seen.get(title) ?? 0) + 1;
    seen.set(title, turn);
    return { key: turn === 1 ? title : `${title}#${turn}`, title, lines };
  });
}

/** Each section that differs between the spliced script and the Editor's save, in the Editor's order then the spliced script's leftovers. */
export function mapScriptDrift(spliced: string, saved: string, limit = 12): SectionDrift[] {
  const ours = new Map(keyed(scriptSections(spliced)).map((section) => [section.key, section]));
  const theirs = keyed(scriptSections(saved));
  const out: SectionDrift[] = [];
  for (const { key, title, lines } of theirs) {
    const mine = ours.get(key)?.lines;
    if (!mine) {
      out.push({ section: title, change: "only in the Editor's", lines: lines.slice(0, limit).map((line) => `+${line}`) });
      continue;
    }
    if (mine.join("\n") === lines.join("\n")) continue;
    const differing = [...linesMissing(mine, lines).map((line) => `-${line}`), ...linesMissing(lines, mine).map((line) => `+${line}`)];
    // Same lines in another order still drift.
    out.push({ section: title, change: "changed", lines: (differing.length ? differing : ["(the same lines, in another order)"]).slice(0, limit) });
  }
  const savedKeys = new Set(theirs.map((section) => section.key));
  for (const [key, { title, lines }] of ours) {
    if (!savedKeys.has(key)) out.push({ section: title, change: "only in the spliced script", lines: lines.slice(0, limit).map((line) => `-${line}`) });
  }
  return out;
}

/** The drift as a report for the author: "no drift", or each section with its lines. */
export function formatMapScriptDrift(drift: readonly SectionDrift[]): string {
  if (drift.length === 0) return "No drift: the Editor's save of MapScript.galaxy matches the spliced one, section for section.";
  return [
    `${drift.length} section(s) of MapScript.galaxy differ between the spliced script (-) and the Editor's save (+):`,
    ...drift.flatMap((item) => [`- ${item.section}: ${item.change}`, ...item.lines.map((line) => `    ${line}`)]),
  ].join("\n");
}
