// The site's sections and links: the five top tabs, each section's page tree, and the links out.
import core from "../../packages/core/package.json" with { type: "json" };

/** The version of core the site was built from, shown in every page's shell. */
export const CORE_VERSION: string = core.version;

export const REPO_URL = "https://github.com/TeamAntioch/sc2-adjutant";
export const PLUGIN_DOCS_URL = `${REPO_URL}/blob/main/docs/plugin-api.md`;
export const MAPPING_REFERENCE_URL = "https://screference.antioch.games";

export interface Page {
  title: string;
  href: string;
}

export interface Section {
  /** The tab's label, and the group's title in the page tree. */
  title: string;
  /** The section's first page, which its tab links to. */
  href: string;
  /** One line on what the section holds, on the home page. */
  blurb: string;
  pages: Page[];
}

/** The top tabs, in order, with their pages. Each holds a placeholder page until its ticket fills it. */
export const SECTIONS: Section[] = [
  {
    title: "Install",
    href: "/install/",
    blurb: "Add the Claude Code plugin and start a Workspace for your Campaign.",
    pages: [{ title: "Install", href: "/install/" }],
  },
  {
    title: "Tutorials",
    href: "/tutorials/",
    blurb: "Co-design a first Mission, find doodads, make a 1v1 melee map, stage cutscenes, build a Style Pack from your own maps.",
    pages: [{ title: "All tutorials", href: "/tutorials/" }],
  },
  {
    title: "Tools",
    href: "/tools/",
    blurb: "Every MCP tool: what it does, its inputs, and what it writes.",
    pages: [{ title: "All tools", href: "/tools/" }],
  },
  {
    title: "Skills",
    href: "/skills/",
    blurb: "The skills Claude reaches for, and the tools each one drives.",
    pages: [{ title: "All skills", href: "/skills/" }],
  },
  {
    title: "Commands",
    href: "/commands/",
    blurb: "The slash commands, and what to type after them.",
    pages: [{ title: "All commands", href: "/commands/" }],
  },
];

/** Links out, at the foot of the page tree and in the footer. The galleries stay on the mapping reference. */
export const ELSEWHERE: Page[] = [
  { title: "Mapping Reference", href: MAPPING_REFERENCE_URL },
  { title: "Plugin docs", href: PLUGIN_DOCS_URL },
  { title: "GitHub", href: REPO_URL },
];

/** `pathname` with the trailing slash every page's href has. */
function withSlash(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/** Whether `pathname` is the page at `href`. */
export function isPage(pathname: string, href: string): boolean {
  return withSlash(pathname) === href;
}

/** Whether `pathname` is in the section whose first page is `href`. */
export function inSection(pathname: string, href: string): boolean {
  return withSlash(pathname).startsWith(href);
}
