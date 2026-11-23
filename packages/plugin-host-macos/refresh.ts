// What the Editor's window titles say about one Map Package, for editor.refresh (#739). Pure, so it
// is tested without the Editor. A document window's title reads `<Module> - [<path>] - StarCraft II
// Editor`, and the author saw (2026-11-21, Data module) a `*` before the closing bracket while the
// document has unsaved changes: `... /Name.SC2Map/*] - StarCraft II Editor`. Not yet confirmed
// for every module or for a long path: needs an Editor check.

// macOS paths, read the same wherever the tests run.
import { posix as path } from "node:path";

/**
 * What the Editor's windows show of one map.
 * - `none`: no window names it.
 * - `clean`: a window names it (its whole path, or a shortened one whose tail ends it), none shows `*`.
 * - `dirty`: a window shows `*`, so the document has unsaved changes.
 * - `unclear`: a window shows only a shortened path that is nothing but this map's name, so it may
 *   be this package or another worktree's copy of it, and nothing can be said of its changes.
 */
export type WindowState =
  | { readonly state: "none" }
  | { readonly state: "clean"; readonly titles: readonly string[] }
  | { readonly state: "dirty"; readonly title: string }
  | { readonly state: "unclear"; readonly title: string };

/** The text between a title's `[` and the `]` that ends it, or undefined for a title without one. */
function bracketed(title: string): string | undefined {
  const open = title.indexOf("[");
  const close = title.lastIndexOf("]");
  return open >= 0 && close > open ? title.slice(open + 1, close) : undefined;
}

/** Whether a title's bracketed path ends in `*`, the Editor's mark for unsaved changes. */
export const showsUnsaved = (title: string): boolean => bracketed(title)?.endsWith("*") ?? false;

/** What a title's bracketed path says of a map: its whole path, a shortened path whose tail ends it, or only its name, or nothing of it. */
function reading(title: string, full: string): "whole" | "tail" | "name" | "other" {
  const shown = bracketed(title)?.replace(/\/\*$/, "").replace(/\/$/, "");
  if (shown === undefined) return "other";
  if (shown.includes(full)) return "whole";
  const elided = /^\/?\.\.\.\/(.+)$/.exec(shown);
  if (elided === null) return "other";
  const tail = elided[1]!;
  if (!full.endsWith(`/${tail}`)) return "other";
  return tail.includes("/") ? "tail" : "name";
}

/**
 * Reads `titles` (every Editor window's title) for the Map Package at `mapPath`. The Editor shortens
 * a long path to `/.../<tail>` (seen 2026-11-21: `/.../repos/my-campaign/missions/m/output/Name.SC2Map/*`),
 * so a title belongs to the map when it holds the whole resolved path, or a shortened one whose tail,
 * with at least a folder beside the name, ends the resolved path. Another worktree's copy shows a
 * different tail, so it is not taken for this one; a tail that happens to be shared by two copies
 * can't be told apart (needs an Editor check: how often that happens). A shortened title that is only
 * the map's name (`/.../Name.SC2Map`) is `unclear`. A `*` in another map's title is not this map's,
 * and any unsaved mark among this map's windows beats a clean one.
 */
export function windowState(titles: readonly string[], mapPath: string): WindowState {
  const full = path.resolve(mapPath);
  const read = titles.map((title) => ({ title, kind: reading(title, full) }));
  const ours = read.filter((entry) => entry.kind === "whole" || entry.kind === "tail").map((entry) => entry.title);
  const unsaved = ours.find(showsUnsaved);
  if (unsaved !== undefined) return { state: "dirty", title: unsaved };
  const nameOnly = read.find((entry) => entry.kind === "name");
  if (nameOnly !== undefined) return { state: "unclear", title: nameOnly.title };
  return ours.length > 0 ? { state: "clean", titles: ours } : { state: "none" };
}

/** The sentence refusing a refresh, or undefined when the document may be closed (or isn't open). */
export function refusalFor(result: WindowState, mapPath: string): string | undefined {
  const name = path.basename(mapPath);
  if (result.state === "dirty") return `the Editor shows unsaved changes in ${name} (its title ends in *): not closed, so nothing of yours is lost; save or discard them in the Editor, then ask again`;
  if (result.state === "unclear") return `the Editor has a window whose shortened title ("${result.title}") may be ${name}, but it can't be told from another copy: not closed; close it in the Editor yourself`;
  return undefined;
}

/**
 * The text of a title that finds its window again: the shortened tail when the Editor shortened the
 * path (the whole path is not in that title), else the whole resolved path. Every window of the map
 * holds it, since the tail ends the resolved path.
 */
export function fragmentFor(title: string, mapPath: string): string {
  const full = path.resolve(mapPath);
  const shown = bracketed(title)?.replace(/\/\*$/, "").replace(/\/$/, "");
  const elided = shown === undefined ? null : /^\/?\.\.\.\/(.+)$/.exec(shown);
  return elided !== null && !shown!.includes(full) ? elided[1]! : full;
}
