// The tool reference, as scripts/reference.ts wrote it to site/.generated/reference.json, for the
// pages to read at build time. Read with fs rather than imported, so the type check doesn't need
// the generated file.
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Command, Reference, Skill, Tool, Tutorial, Writes } from "./reference-types";

export type { Command, Field, Group, HostAdapter, Needs, Objective, Reference, Skill, Tool, Tutorial, UsedBy, Writes } from "./reference-types";

const FILE = path.join(process.cwd(), ".generated", "reference.json");

let cached: Reference | undefined;

export function reference(): Reference {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(FILE, "utf8")) as Reference;
    } catch (error) {
      throw new Error(`No tool reference at ${FILE}: run \`pnpm --filter sc2-adjutant-site run reference\` (the site build runs it first)`, { cause: error });
    }
  }
  return cached;
}

export function toolNamed(name: string): Tool | undefined {
  return reference().tools.find((tool) => tool.name === name);
}

export function skillNamed(slug: string): Skill | undefined {
  return reference().skills.find((skill) => skill.slug === slug);
}

export function commandNamed(slug: string): Command | undefined {
  return reference().commands.find((command) => command.slug === slug);
}

export function tutorialNamed(slug: string): Tutorial | undefined {
  return reference().tutorials.find((tutorial) => tutorial.slug === slug);
}

export const toolHref = (name: string) => `/tools/${name}/`;
export const groupHref = (id: string) => `/tools/#${id}`;
export const skillHref = (slug: string) => `/skills/${slug}/`;
export const commandHref = (slug: string) => `/commands/${slug}/`;
export const tutorialHref = (slug: string) => `/tutorials/${slug}/`;

/** A tutorial's number as its briefing shows it: "01". */
export const briefingNumber = (tutorial: Tutorial) => String(tutorial.number).padStart(2, "0");

/** `text` ending with a full stop, as a command's description, written as a menu line, doesn't. */
export const asSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * A skill's description in its two parts: what it does, and when Claude reaches for it (from the
 * sentence that starts "Use"). `triggers` is empty when the description has no such sentence.
 */
export function describedSkill(description: string): { does: string; triggers: string } {
  const at = description.search(/(?<=[.!?]\s+)Use\b/);
  return at < 0 ? { does: description, triggers: "" } : { does: description.slice(0, at).trim(), triggers: description.slice(at).trim() };
}

/** What a tool writes, in a few words. */
export const WRITES: Record<Writes, string> = {
  none: "Reads only. It writes nothing to your Workspace.",
  adds: "Writes to your Workspace, but isn't destructive: it adds files, or updates its own records and output, rather than overwriting your work.",
  overwrites: "May overwrite your files: it can change or remove what your Workspace holds.",
};
