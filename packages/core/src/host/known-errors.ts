// Known-error lists: errors the author has judged harmless or already understood, so a report of a
// game's logs leaves them out of what's new. Two lists, both in the Workspace and both the
// author's: `known-errors.json` at the Workspace root applies to every Mission, and a Mission's
// own, beside its Blueprint, adds to it. Each pattern has a reason. A tool may propose a pattern
// (the report prints one for each new error); only the author adds one.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { formatIssues } from "../util/format-issues.js";

/** The file name of both lists. */
export const KNOWN_ERRORS_FILE = "known-errors.json";

const KnownPatternSchema = z
  .object({
    /** Text a message contains, or, with `regex`, a regular expression it matches. */
    match: z.string().min(1),
    regex: z.boolean().optional(),
    /** Why it's known: what makes it harmless, or the ticket that tracks it. */
    reason: z.string().trim().min(1, "a pattern needs a reason"),
    /** The day the author added it, `YYYY-MM-DD`: a pattern no run has matched since is flagged for removal. */
    added: z.string().regex(/^\d{4}-\d\d-\d\d$/, "added is a date, YYYY-MM-DD"),
  })
  .strict()
  .superRefine((pattern, context) => {
    if (!pattern.regex) return;
    try {
      new RegExp(pattern.match);
    } catch (error) {
      context.addIssue({ code: "custom", path: ["match"], message: `isn't a regular expression: ${(error as Error).message}` });
    }
  });

export const KnownErrorsSchema = z
  .object({ patterns: z.array(KnownPatternSchema) })
  .strict()
  .superRefine((list, context) => {
    list.patterns.forEach((pattern, index) => {
      if (list.patterns.findIndex((each) => each.match === pattern.match && !!each.regex === !!pattern.regex) < index) context.addIssue({ code: "custom", path: ["patterns", index, "match"], message: "is listed twice" });
    });
  });

export type KnownPattern = z.infer<typeof KnownPatternSchema>;

/** The patterns of a known-errors file's text, `file` naming it in the error when they don't read. */
export function parseKnownErrors(text: string, file: string): KnownPattern[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't JSON: ${(error as Error).message}`);
  }
  const parsed = KnownErrorsSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} isn't a known-errors list: ${formatIssues(parsed.error, "(file)")}`);
  return parsed.data.patterns;
}

/** The list at `absolute`: none when there's no file. `file` names it for the author. */
export async function readKnownErrors(absolute: string, file: string): Promise<KnownPattern[]> {
  if (!existsSync(absolute)) return [];
  return parseKnownErrors(await readFile(absolute, "utf8"), file);
}

/** A known pattern with the list it came from. */
export type ListedPattern = KnownPattern & { readonly level: "workspace" | "mission"; readonly list: string };

/** Whether this pattern's text is in the message. */
export function matches(pattern: KnownPattern, message: string): boolean {
  return pattern.regex ? new RegExp(pattern.match).test(message) : message.includes(pattern.match);
}

/** The first pattern that knows the message; the Mission's own come after the Workspace's, so the Workspace's reason shows when both match. */
export function knownBy(patterns: readonly ListedPattern[], message: string): ListedPattern | undefined {
  return patterns.find((pattern) => matches(pattern, message));
}

/** A pattern to propose for a new error: its message as the text to match, with the reason left to the author. */
export function proposePattern(message: string, today: string): KnownPattern {
  return { match: message, reason: "TODO(author): why this is known", added: today };
}
