// Doodad Search's page (GLOSSARY.md: Doodad Search, Search Part): what the agent found, kept as
// `search.json`, and the `index.html` built beside it for the author to pick from. The page can be
// rebuilt from search.json at any time, with the catalogs' facts as they stand then:
//
//   {
//     "title": "Crushing press over a conveyor",
//     "mission": "ashen-crossing",                      (the Mission it's for; left out for none)
//     "parts": [{
//       "name": "press head",
//       "readsAs": "a heavy flat block that drops onto the belt; looks like it could crush a Marine",
//       "queries": [{ "words": ["press", "head"], "kind": "built" }],   (as search_doodads ran them)
//       "candidates": [{                                (ranked, best first; at most ten)
//         "id": "FoundryStamperHead",
//         "note": "Flat steel head on a piston: reads as a press from every side.",
//         "judgedFrom": "sheet",                        (sheet | image | render | none)
//         "variation": 1,                               (the one recommended; 00 when left out)
//         "variationsChecked": [{ "variation": 1, "note": "Same head, rusted." }]
//       }],
//       "alsoConsidered": [{ "id": "StoryPressTank", "reason": "A tank, not a head." }],
//       "shortlist": [{ "id": "FoundryPressFrame", "level": 2, "ranker": "jev" }],   (optional)
//       "asks": [{ "text": "press head", "tags": [{ "facet": "story", "value": "industry", "pinned": true }], "ranker": "jev" }]   (optional; ranker absent when only narrowed)
//     }]
//   }
//
// A Doodad Search the Doodad Finder started (ADR-0020) has a shortlist in each Search Part: the
// ids the author ticked, best first, each with the ranker's level (0-3) and which ranker gave it,
// and maybe no candidates yet. The page isn't built until every shortlist is judged and emptied.
// The asks that found it stay.
//
// Pictures are referenced where they are on this machine (a sheet's file URL) or in the gallery
// (its URL), never copied: rendered game assets stay out of every repo. A candidate's chosen
// variation is shown from the search's own renders when they have it (VariationPicture).

import { z } from "zod";

import { DOODAD_KINDS, DOODAD_ROLES, DOODAD_SIZES } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import { dependencyName, DOODAD_PAGE_STYLE, escapeHtml, pictureHtml, ZOOM_SCRIPT } from "@team-antioch/sc2-asset-catalog/catalog/doodad-card-html.js";
import type { DoodadPicture, DoodadSearchResult } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";

export const DOODAD_SEARCH_FILE = "search.json";
export const DOODAD_SEARCH_PAGE = "index.html";

/** A Search Part shows at most this many cards. */
export const MAX_CANDIDATES = 10;

const Text = z.string().trim().min(1);
const Words = z.array(Text);

/** A search_doodads query, as it was run. */
const QuerySchema = z.object({
  words: Words.optional(),
  kind: z.enum(DOODAD_KINDS).optional(),
  size: z.enum(DOODAD_SIZES).optional(),
  // A list, as search_doodads takes it; one role, as an earlier search.json may give it, reads as a list of one.
  role: z.union([z.enum(DOODAD_ROLES).transform((role) => [role]), z.array(z.enum(DOODAD_ROLES))]).optional(),
  story: Words.optional(),
  biome: Words.optional(),
  package: Text.optional(),
  limit: z.number().int().min(1).optional(),
});

/** What the agent judged a candidate from: its turntable sheet, its gallery picture (one angle), a render made for the search, or nothing. */
export const JUDGED_FROM = ["sheet", "image", "render", "none"] as const;

const CandidateSchema = z.object({
  id: Text,
  /** Why it fits the Search Part's line, or how it falls short. */
  note: Text,
  judgedFrom: z.enum(JUDGED_FROM),
  /** The variation recommended; 00 when left out. The card shows its picture from the search's renders when they have it. */
  variation: z.number().int().min(0).optional(),
  /** The other variations rendered and judged, for the top few candidates. */
  variationsChecked: z.array(z.object({ variation: z.number().int().min(0), note: Text.optional() })).optional(),
});

/** The Doodad Finder's ranker (ADR-0020): Jev alone since Haiku was removed (#678). */
export const RANKERS = ["jev"] as const;

/** A ranker's Score: 0 doesn't fit, 1 related but wrong, 2 could work with dressing or scale, 3 reads as exactly this. */
const LevelSchema = z.number().int().min(0).max(3);

/** A doodad the author ticked in the Doodad Finder, not yet judged from its picture. */
const ShortlistedSchema = z.object({ id: Text, level: LevelSchema, ranker: z.enum(RANKERS) });

/** An ask made in the Doodad Finder or with find_doodads, with the tags it ran with (a pinned tag filters, the rest only raise) and its ranker, absent when it was only narrowed. */
const AskSchema = z.object({
  text: Text,
  tags: z.array(z.object({ facet: Text, value: Text, pinned: z.boolean().optional() })).default([]),
  ranker: z.enum(RANKERS).optional(),
});

const SearchPartSchema = z.object({
  name: Text,
  /** What it has to read as to the player: the line candidates are judged against. */
  readsAs: Text,
  queries: z.array(QuerySchema).default([]),
  candidates: z.array(CandidateSchema).max(MAX_CANDIDATES),
  alsoConsidered: z.array(z.object({ id: Text, reason: Text })).default([]),
  /** The Doodad Finder's ticked ids, best first, still to judge: each becomes a candidate or is also considered, and the page waits until none are left. */
  shortlist: z.array(ShortlistedSchema).optional(),
  /** The Doodad Finder's asks that found the shortlist, kept once it is judged. */
  asks: z.array(AskSchema).optional(),
});

export const DoodadSearchFileSchema = z.object({
  /** The object searched for. */
  title: Text,
  /** The Mission it's for, by folder name: its dependencies' doodads are marked. */
  mission: Text.optional(),
  parts: z.array(SearchPartSchema).min(1),
});

export type DoodadSearchFile = z.infer<typeof DoodadSearchFileSchema>;
export type DoodadSearchPart = DoodadSearchFile["parts"][number];
export type SearchCandidate = DoodadSearchPart["candidates"][number];
export type SearchQuery = DoodadSearchPart["queries"][number];

/** Every doodad id search.json names, candidates and also-considered, once each in order. */
export const searchedIds = (search: DoodadSearchFile): string[] => [...new Set(search.parts.flatMap((part) => [...part.candidates, ...part.alsoConsidered].map((candidate) => candidate.id)))];

const needs = ({ dependency, provided }: DoodadSearchResult): string =>
  dependency === undefined
    ? "needs no dependency"
    : `needs ${dependencyName(dependency)}${provided === undefined ? "" : provided ? ", which the Mission has" : ", which the Mission lacks"}`;

const JUDGED: Record<(typeof JUDGED_FROM)[number], string> = {
  sheet: "judged from its sheet",
  image: "judged from one angle (gallery picture)",
  render: "judged from a render",
  none: "unpictured",
};

const queryText = (query: SearchQuery): string => {
  const { words = [], limit: _limit, ...facets } = query;
  const facetText = Object.entries(facets)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name} ${Array.isArray(value) ? value.join(", ") : value}`);
  return [words.join(" "), facetText.length ? `(${facetText.join("; ")})` : ""].filter(Boolean).join(" ");
};

/** A variation's picture in the search's own renders, by absolute path, when they have one. */
export type VariationPicture = (id: string, variation: number) => string | undefined;

const two = (variation: number) => String(variation).padStart(2, "0");
const variationName = (variation: number) => `variation ${two(variation)}`;

/**
 * The card's picture and what it says of the variation shown: the chosen variation's own picture
 * from the search's renders when they have it (its sheet, or one angle), else the catalog's picture
 * (variation 00's sheet, a gallery picture of no known variation, or none); with no variation
 * chosen and no catalog picture, variation 00 from the search's renders. A variation the doodad
 * hasn't is said to be so.
 */
function cardPicture(candidate: SearchCandidate, found: DoodadSearchResult, variationPicture: VariationPicture | undefined): { picture: DoodadPicture; shown?: string; oneAngle?: boolean } {
  const chosen = candidate.variation;
  if (chosen !== undefined && chosen >= found.variations)
    return { picture: found.picture, shown: `${variationName(chosen)} chosen, but it has only 00${found.variations > 1 ? ` to ${two(found.variations - 1)}` : ""}` };
  const rendered = chosen !== undefined || found.picture.kind === "none" ? variationPicture?.(candidate.id, chosen ?? 0) : undefined;
  if (rendered) {
    // A sheet is a JPEG; anything else is one render, one angle.
    const oneAngle = !rendered.endsWith(".jpg");
    return { picture: { kind: "sheet", path: rendered }, shown: `${variationName(chosen ?? 0)} shown${oneAngle ? ", one angle" : ""}`, oneAngle };
  }
  const fromCatalog = found.picture.kind === "sheet" ? `${variationName(0)} shown` : undefined;
  if (chosen === undefined || (chosen === 0 && fromCatalog)) return { picture: found.picture, ...(fromCatalog ? { shown: fromCatalog } : {}) };
  return { picture: found.picture, shown: [`${variationName(chosen)} chosen, not pictured here`, fromCatalog].filter(Boolean).join("; ") };
}

function cardHtml(candidate: SearchCandidate, rank: number, found: DoodadSearchResult | undefined, variationPicture: VariationPicture | undefined): string {
  const name = found?.name ?? candidate.id;
  // One no catalog has, or a Campaign Mod doodad its index doesn't name, goes by its id alone.
  const header = `<header><span class="rank">${rank}.</span> <span class="name">${escapeHtml(name)}</span>${name === candidate.id ? "" : ` <code>${escapeHtml(candidate.id)}</code>`}</header>`;
  const checked = (candidate.variationsChecked ?? []).map(
    ({ variation, note }) => `<li>Variation ${two(variation)} checked${note ? `: ${escapeHtml(note)}` : "."}</li>`,
  );
  const note = `<p class="note">${escapeHtml(candidate.note)}</p>${checked.length ? `<ul class="variations">${checked.join("")}</ul>` : ""}`;
  if (!found) return `<li class="card missing">${header}<div class="picture none"></div><p class="facts">not in the catalogs</p>${note}</li>`;
  const size = found.description?.size ?? found.description?.use;
  const { picture, shown, oneAngle } = cardPicture(candidate, found, variationPicture);
  const facts = [size, needs(found), `${found.variations} variation${found.variations === 1 ? "" : "s"}`, shown, JUDGED[candidate.judgedFrom], found.pending ? "description pending" : undefined]
    .filter(Boolean)
    .map((fact) => escapeHtml(fact!));
  return `<li class="card">${header}${pictureHtml(picture, name, oneAngle ?? picture.kind === "image")}<p class="facts">${facts.join(" · ")}</p>${note}</li>`;
}

function partHtml(part: DoodadSearchPart, index: number, found: ReadonlyMap<string, DoodadSearchResult>, variationPicture: VariationPicture | undefined): string {
  const searched = part.queries.map(queryText).filter(Boolean);
  const cards = part.candidates.map((candidate, rank) => cardHtml(candidate, rank + 1, found.get(candidate.id), variationPicture));
  const also = part.alsoConsidered.map(({ id, reason }) => {
    const name = found.get(id)?.name;
    return `<li>${name ? `${escapeHtml(name)} ` : ""}<code>${escapeHtml(id)}</code>: ${escapeHtml(reason)}</li>`;
  });
  return [
    `<section>`,
    `<h2>Search Part ${index + 1}: ${escapeHtml(part.name)}</h2>`,
    `<p class="reads-as">Reads as: ${escapeHtml(part.readsAs)}</p>`,
    searched.length ? `<p class="searched">Searched: ${searched.map(escapeHtml).join("; ")}</p>` : "",
    cards.length ? `<ol class="cards">${cards.join("\n")}</ol>` : `<p>No candidates.</p>`,
    also.length ? `<details>\n<summary>Also considered (${also.length})</summary>\n<ul class="also">${also.join("\n")}</ul>\n</details>` : "",
    `</section>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The Doodad Search page for search.json, with the catalogs' facts for each id it names
 * (lookUpDoodads): a section per Search Part with its cards in rank order and its also-considered
 * list folded, then a pointer to the next step. Self-contained HTML; pictures are referenced where
 * they are, never copied. Each card says which variation its picture shows.
 */
export function buildDoodadSearchPage(search: DoodadSearchFile, found: ReadonlyMap<string, DoodadSearchResult>, variationPicture?: VariationPicture): string {
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>Doodad Search: ${escapeHtml(search.title)}</title>`,
    `<style>${DOODAD_PAGE_STYLE}</style>`,
    `</head>`,
    `<body>`,
    `<h1>Doodad Search: ${escapeHtml(search.title)}</h1>`,
    `<p class="for">${search.mission ? `for the Mission ${escapeHtml(search.mission)}` : "for no Mission"}</p>`,
    ...search.parts.map((part, index) => partHtml(part, index, found, variationPicture)),
    `<p class="next">Next: tell the agent which candidates you accept for each Search Part, then draft a Doodad Composite from them (the exemplar-design skill, or encounter-design for a puzzle prop).</p>`,
    `<dialog class="zoom"><img alt=""></dialog>`,
    `<script>${ZOOM_SCRIPT}</script>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

/** search.json's contents, checked; throws naming the file and each wrong field. */
export function parseDoodadSearch(raw: unknown, file: string): DoodadSearchFile {
  const parsed = DoodadSearchFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid doodad search ${file}: ${issues}`);
  }
  return parsed.data;
}
