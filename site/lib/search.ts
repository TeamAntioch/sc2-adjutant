// Search (#983): Pagefind indexes site/out/ after `next build` (the site's build script), and the
// search box loads its pagefind.js from /pagefind/ in the browser. Only a page that marks its
// content with indexed(kind) goes in the index, and only that content, so the shell, the page
// tree, on-this-page and a tutorial's rail stay out of it.

/** What a hit is, as its badge in the results shows it. */
export const KINDS = ["Tool", "Skill", "Command", "Tutorial"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * The attributes that put an element's content in the index, as a page of `kind`. A page has one.
 * Inside it, `data-pagefind-ignore` leaves out what isn't prose (a tool call's arguments).
 */
export function indexed(kind: Kind) {
  return { "data-pagefind-body": "", "data-pagefind-filter": `kind:${kind}` } as const;
}

/** Where the build writes the index, from the site's root. */
export const PAGEFIND_PATH = "/pagefind/pagefind.js";

/** The part of pagefind.js's API the site uses (Pagefind ships no types for it). */
export interface Pagefind {
  options(options: { basePath?: string }): Promise<void>;
  search(query: string | null, options?: { filters?: Record<string, string | string[]> }): Promise<{ results: PagefindResult[] }>;
  debouncedSearch(query: string, options?: { filters?: Record<string, string | string[]> }, timeout?: number): Promise<{ results: PagefindResult[] } | null>;
  filters(): Promise<Record<string, Record<string, number>>>;
}

export interface PagefindResult {
  data(): Promise<PagefindPage>;
}

export interface PagefindPage {
  url: string;
  /** The page's text as indexed. */
  content: string;
  /** A few words around the match, with the match in <mark>. */
  excerpt: string;
  meta: { title?: string };
  filters: Record<string, string[]>;
}
