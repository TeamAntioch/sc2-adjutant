// What ties a shipped file to one author rather than to any, for the tests of what first-party
// packages ship to every author: the generic plugin's skills and commands (skills.test.ts) and a
// first-party Utility's skill and docs.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUTHOR_CAMPAIGN } from "../../core/tests/support/campaign-content.ts";

/**
 * An author's own words and machine: a ruling or quote of theirs, a review date, or a folder on
 * their machine. "The author" as whoever is co-designing is fine; a past author's verdict is not.
 * Their own Campaign is core's `AUTHOR_CAMPAIGN` marker, shared so the two scans can't drift: its
 * Campaign Pack lives in their Workspace, not the monorepo, so `packTerms` can't find it. Any other
 * pack's names and taste are caught by `packTerms`, from the packs themselves.
 */
export const AUTHOR_WORDS: readonly RegExp[] = [
  /\bauthor(?:'s)? (?:said|rejected|ruled|rulings|wants|wanted|prefers|preferred|asked|likes|hates|corrected)\b/gi,
  /\bauthor\b[^.\n]{0,40}"[^"\n]{8,}"/gi,
  /\b20\d\d-[01]\d-[0-3]\d\b/g,
  /\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\/g,
  /(?:^|[\s`(])~\/(?!\))/gm,
  new RegExp(AUTHOR_CAMPAIGN.source, "g"),
];

export type PackManifest = { readonly name: string; readonly roles?: readonly string[]; readonly contributions?: Record<string, unknown> };

export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (text: string) => new RegExp(`(?<![\\w-])${escape(text)}(?![\\w-])`, "gi");

/**
 * The words that name one Campaign Pack or Style Pack: its Plugin name and the distinctive part of
 * it (`campaign-<x>`, `style-<x>`), the title its package gives it ("The <title> Campaign Pack"),
 * its naming template, characters, sources and Campaign Mod, and its Mechanics, as code
 * (`` `<id>` ``) or as "the <id>". A Mechanic id is often a plain word, so it counts only in those forms.
 */
export function packTerms(manifest: PackManifest, description = ""): RegExp[] {
  const { name, contributions = {} } = manifest;
  const list = (kind: string) => (Array.isArray(contributions[kind]) ? (contributions[kind] as string[]) : []);
  const part = /^(?:campaign|style)-(.+)$/.exec(name)?.[1];
  const title = /^The (.+?) (?:Campaign|Style) Pack\b/.exec(description)?.[1];
  const campaignMod = typeof contributions.campaignMod === "string" ? contributions.campaignMod : undefined;
  const ids = ["naming", "characters", "screenplaySource", "cutsceneSources"].flatMap(list);
  const mechanics = list("mechanics").flatMap((id) => [new RegExp(`\`${escape(id)}\``, "g"), new RegExp(`\\bthe ${escape(id)}\\b`, "gi")]);
  return [...[name, part, title, campaignMod, ...ids].filter((term): term is string => !!term).map(word), ...mechanics];
}

/** The monorepo's packages folder. */
export const PACKAGES = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Every Campaign Pack and Style Pack package in the monorepo, with its package's description. */
export async function monorepoPacks(): Promise<{ readonly manifest: PackManifest; readonly description?: string }[]> {
  const packs: { readonly manifest: PackManifest; readonly description?: string }[] = [];
  for (const folder of await readdir(PACKAGES)) {
    const manifestFile = path.join(PACKAGES, folder, "sc2-adjutant-plugin.json");
    if (!existsSync(manifestFile)) continue;
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as PackManifest;
    if (!manifest.roles?.some((role) => role === "campaign-pack" || role === "style-pack")) continue;
    const { description } = JSON.parse(await readFile(path.join(PACKAGES, folder, "package.json"), "utf8")) as { description?: string };
    packs.push({ manifest, ...(description ? { description } : {}) });
  }
  return packs;
}

/** Each match of the patterns in the text. */
export const matches = (patterns: readonly RegExp[], text: string): string[] => patterns.flatMap((pattern) => [...text.matchAll(pattern)].map(([match]) => match.trim()));
