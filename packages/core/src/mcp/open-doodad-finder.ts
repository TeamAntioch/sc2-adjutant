// open_doodad_finder (ADR-0020, #666): checks what the Doodad Finder needs, starts its process
// detached (or reuses one already answering for the Workspace) and opens its page. Like
// find_doodads (find-doodads.ts), it is the doodad-finder package's: the server loads the package's
// built dist/open-doodad-finder.js with a dynamic import and serves the tool only when that works.

import { DOODAD_FINDER_ENTRY, loadFinderEntry } from "./find-doodads.js";

/** The package's entry, beside find_doodads'; undefined where the package isn't installed. */
export const OPEN_DOODAD_FINDER_ENTRY = DOODAD_FINDER_ENTRY && new URL("open-doodad-finder.js", DOODAD_FINDER_ENTRY);

/** Where the page opens: the default browser, a Chrome app window, or nowhere (the URL alone). */
export type FinderWindow = "browser" | "app" | "none";

export type OpenDoodadFinderRequest = {
  /** The Workspace this call serves; a folder that isn't one gives core's catalogs alone. */
  readonly workspaceRoot: string;
  readonly window?: FinderWindow | undefined;
  /** Stops the Finder this tool started for the Workspace, by its pid file, instead of opening one. */
  readonly stop?: boolean | undefined;
};

/** A prerequisite and what was found. None stops a start: a missing one says what is off and how to fix it. */
export type FinderCheck = { readonly name: string; readonly ok: boolean; readonly note: string };

export type FinderRankers = { readonly on: readonly string[]; readonly off: readonly { readonly ranker: string; readonly reason: string }[] };

export type OpenedDoodadFinder = {
  /** started: this call started it; reused: one was answering already; stopped; notRunning: stop found none of this tool's. */
  readonly action: "started" | "reused" | "stopped" | "notRunning";
  readonly url?: string | undefined;
  /** Whether this tool started it (and so `stop` can stop it). */
  readonly ours?: boolean | undefined;
  readonly checks: readonly FinderCheck[];
  /** The running Finder's rankers, as it says them. */
  readonly rankers?: FinderRankers | undefined;
  /** Where the page was opened; app falls back to browser without Chrome. */
  readonly opened?: FinderWindow | undefined;
  /** Notes on what happened, such as a port taken by something else. */
  readonly notes: readonly string[];
  readonly pidFile: string;
  readonly logFile: string;
};

export type OpenDoodadFinderTool = {
  open(request: OpenDoodadFinderRequest): Promise<OpenedDoodadFinder>;
};

/** The Doodad Finder's open_doodad_finder, when its package is installed; else undefined. */
export const loadOpenDoodadFinder = (entry: URL | undefined = OPEN_DOODAD_FINDER_ENTRY): Promise<OpenDoodadFinderTool | undefined> =>
  loadFinderEntry<OpenDoodadFinderTool>(entry, "createOpenDoodadFinder", "open_doodad_finder");

/** Where the page opened, as the text says it; nothing when it wasn't opened. */
const openedIn = (opened: FinderWindow | undefined, before: string): string =>
  opened === "app" ? `${before} a Chrome app window` : opened === "browser" ? `${before} the browser` : "";

/** The tool's text: what happened and where, the rankers, then each check. */
export function formatOpenedDoodadFinder(opened: OpenedDoodadFinder): string {
  const lines: string[] = [];
  switch (opened.action) {
    case "started":
      lines.push(`Started the Doodad Finder at ${opened.url}${openedIn(opened.opened, ", opened in")}. It runs detached; stop it with stop: true.`);
      break;
    case "reused":
      lines.push(`The Doodad Finder was already running at ${opened.url}${openedIn(opened.opened, "; opened it in")}.${opened.ours ? "" : " This tool didn't start it, so stop: true won't stop it."}`);
      break;
    case "stopped":
      lines.push(`Stopped the Doodad Finder this tool started${opened.url ? ` at ${opened.url}` : ""}.`);
      break;
    case "notRunning":
      lines.push("No Doodad Finder this tool started is running for this Workspace.");
      break;
  }
  if (opened.rankers) {
    for (const name of opened.rankers.on) lines.push(`Ranker ${name} is on.`);
    for (const { ranker, reason } of opened.rankers.off) lines.push(`Ranker ${ranker} is off: ${reason}.`);
  }
  lines.push(...opened.notes);
  if (opened.checks.length) lines.push("Checked:", ...opened.checks.map(({ name, ok, note }) => `- ${name}: ${ok ? "" : "not yet: "}${note}`));
  lines.push(`Pid file ${opened.pidFile}; log ${opened.logFile}.`);
  return lines.join("\n");
}
