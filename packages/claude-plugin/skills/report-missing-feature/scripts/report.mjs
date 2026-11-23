#!/usr/bin/env node
// Builds a Missing-Feature Report from a JSON draft, so the encoding isn't left to Claude:
//
//   node report.mjs check <draft.json>               what the draft holds that a public report leaves out: exit 1 for finds, 2 for an error
//   node report.mjs preview <draft.json> [--comment] the exact title and body that will be filed, or with --comment the body a comment posts
//   node report.mjs route                            how a new report is filed: gh, or form when gh can't set its labels
//   node report.mjs file <draft.json>                files it with `gh issue create`, when route says gh
//   node report.mjs comment <issue> <draft.json>     adds it to an existing report with `gh issue comment`
//   node report.mjs url <draft.json>                 the prefilled form URL, as JSON { url, leftOut, clipboard? }
//   node report.mjs clipboard <draft.json>           the text for the fields the URL leaves out
//   node report.mjs environment [core version]       the plugin's and core's versions and the OS
//
// The draft is { title, missing, workaround, suggestion?, context?, environment? }.
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expanded, findCore, findWorkspace, pluginVersion, WORKSPACE_FILE } from "../../../server/resolve.mjs";

/** The public repo reports go to. There is no setting to change it. */
export const REPO = "TeamAntioch/sc2-adjutant";
/** The repo's issue form, whose field ids are the URL's parameters. */
export const TEMPLATE = "missing-feature.yml";
export const TITLE_PREFIX = "Missing: ";
export const LABELS = ["missing-feature", "needs-triage"];
/** The form's fields, in its order: each id, the label it shows (the Markdown heading), and whether it's required. */
export const FIELDS = [
  { id: "missing", heading: "What was missing", required: true },
  { id: "workaround", heading: "What was done instead", required: true },
  { id: "suggestion", heading: "What support could look like (optional)", required: false },
  { id: "context", heading: "Where it came up (Co-design Stage or tool)", required: false },
  { id: "environment", heading: "Environment (plugin and core versions, OS)", required: false },
];

/** A draft's keys: the title, then the form's fields. */
const DRAFT_KEYS = ["title", ...FIELDS.map(({ id }) => id)];
/** The longest issue title GitHub takes. */
const TITLE_LIMIT = 256;

const text = (value) => (typeof value === "string" ? value.trim() : "");
/** The title's capability: the title less the form's prefix, if the draft wrote it. */
const capability = (title) => text(title).replace(/^missing:\s*/i, "");

/**
 * The draft, checked: both required fields, each value a string, nothing the form has no field
 * for, and a title unless `withTitle` is false (a body alone, such as a comment's, needs none).
 */
function checked(draft, withTitle = true) {
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) throw new Error("The draft must be a JSON object.");
  const unknown = Object.keys(draft).filter((key) => !DRAFT_KEYS.includes(key));
  if (unknown.length) throw new Error(`The draft has keys the form has no field for: ${unknown.join(", ")}. Its keys are ${DRAFT_KEYS.join(", ")}.`);
  const notText = DRAFT_KEYS.filter((key) => draft[key] !== undefined && typeof draft[key] !== "string");
  if (notText.length) throw new Error(`The draft's ${notText.join(", ")} must be text, a JSON string.`);
  const needed = [...(withTitle ? ["title"] : []), ...FIELDS.filter(({ required }) => required).map(({ id }) => id)];
  const empty = needed.filter((key) => !(key === "title" ? capability(draft.title) : text(draft[key])));
  if (empty.length) throw new Error(`The draft needs ${empty.join(", ")}${empty.includes("title") ? " (a title is the capability after `Missing: `)" : ""}.`);
  return draft;
}

/** The issue's title: the capability after the form's prefix, which is added once. */
export function issueTitle(draft) {
  const title = `${TITLE_PREFIX}${capability(checked(draft).title)}`;
  if (title.length > TITLE_LIMIT) throw new Error(`The title is ${title.length} characters; GitHub takes ${TITLE_LIMIT} at most.`);
  return title;
}

/**
 * The body as the issue form would write it: each field under its label, `_No response_` for an
 * empty one. It's a comment's whole text, so it needs no title.
 */
export function markdownBody(draft) {
  checked(draft, false);
  return FIELDS.map(({ id, heading }) => `### ${heading}\n\n${text(draft[id]) || "_No response_"}\n`).join("\n");
}

/** The whole report as it reads: the title, a blank line, then the body. */
const fullText = (draft) => `${issueTitle(draft)}\n\n${markdownBody(draft)}`;

/**
 * The `gh` call that files the report: its arguments, and the Markdown body for its stdin (so no
 * command line has to hold it). The form can't be used here, so the arguments set both labels,
 * which GitHub keeps only from a user with push access (see `fileRoute`).
 */
export function ghCreate(draft) {
  return { args: ["issue", "create", "--repo", REPO, "--title", issueTitle(draft), "--body-file", "-", ...LABELS.flatMap((label) => ["--label", label])], input: markdownBody(draft) };
}

/**
 * The repo permissions whose holders' `--label`s GitHub keeps on a new issue: push access, so
 * write and above. GitHub's create-an-issue docs: "Only users with push access can set labels for
 * new issues. Labels are silently dropped otherwise." Triage isn't push access.
 */
const LABELLING_PERMISSIONS = ["WRITE", "MAINTAIN", "ADMIN"];

/** The `gh` call that reads the user's permission on the repo, as `viewerPermission`. */
export const GH_PERMISSION = ["repo", "view", REPO, "--json", "viewerPermission", "--jq", ".viewerPermission"];

/**
 * How a new report is filed, from the user's permission on the repo (`GH_PERMISSION`'s output, or
 * undefined when `gh` failed): `gh` when GitHub keeps the labels `ghCreate` sets, else `form`, the
 * prefilled form URL, whose labels apply for anyone. GitHub drops a `--label` from anyone else
 * without a word, and an unlabelled report never reaches triage.
 */
export function fileRoute(permission) {
  return LABELLING_PERMISSIONS.includes(String(permission ?? "").trim().toUpperCase()) ? "gh" : "form";
}

/** The `gh` call that adds this report to an existing one (`issue`, its number, with or without `#`) as a comment. */
export function ghComment(issue, draft) {
  const number = /^#?([1-9]\d*)$/.exec(String(issue).trim())?.[1];
  if (!number) throw new Error(`Not an issue number: ${issue}`);
  return { args: ["issue", "comment", number, "--repo", REPO, "--body-file", "-"], input: markdownBody(draft) };
}

/**
 * The longest form URL to open. GitHub refuses a URL much past 8 KB, and a browser or the OS's
 * opener may cut one sooner, so this stays under it.
 */
export const URL_LIMIT = 8000;

/** Percent-encodes a value, quotes and brackets too, so the URL passes unchanged through a shell's single or double quotes. */
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The URL of the issue form, prefilled: the title, then each filled field as its id. A URL over
 * `URL_LIMIT` first leaves out the optional suggestion; if it's still over, it leaves out every
 * field. `leftOut` names the fields the URL doesn't carry, and `clipboard` is the text to paste
 * for them: the suggestion alone, or the whole body (the form already has the title).
 */
export function formUrl(draft) {
  const base = `https://github.com/${REPO}/issues/new?template=${encode(TEMPLATE)}&title=${encode(issueTitle(draft))}`;
  const filled = FIELDS.filter(({ id }) => text(draft[id]));
  const withFields = (fields) => base + fields.map(({ id }) => `&${id}=${encode(text(draft[id]))}`).join("");
  const full = withFields(filled);
  if (full.length <= URL_LIMIT) return { url: full, leftOut: [] };
  const shortened = withFields(filled.filter(({ id }) => id !== "suggestion"));
  if (filled.some(({ id }) => id === "suggestion") && shortened.length <= URL_LIMIT) return { url: shortened, leftOut: ["suggestion"], clipboard: text(draft.suggestion) };
  return { url: base, leftOut: filled.map(({ id }) => id), clipboard: markdownBody(draft) };
}

/** Whether a word is a path from a machine's root, a home folder or a drive: never a placeholder's. */
const isRootedPath = (word) => /^(?:\/[^/\s]+\/|~[\\/]|[A-Za-z]:\\)/.test(word);
/** Whether a word is a relative path: folders down to a file, or two folders deep. */
const isRelativePath = (word) => /[\\/]/.test(word) && (/\.\w+$/.test(word) || /[\\/].*[\\/]/.test(word));
/** A Map Package's or Mod's own name. `ComponentList.SC2Components` and the like are files every map has. */
const isPackageName = (word) => /^[\p{L}\p{N}_.-]+\.SC2(?:Map|Mod)$/iu.test(word);
/** Whether a path segment is a file's name: something with an extension. */
const isFileName = (segment) => /^[^.].*\.\w+$/.test(segment);
/** A placeholder segment (`<id>`, `<Name>.SC2Map`) or a pattern (`*.json`): it names no one's file. */
const isPlaceholder = (segment) => /[<*]/.test(segment);
/** The files sc2-adjutant names in every Workspace, Mission, mod or Plugin, under any placeholder folder. */
const OWN_FILES = new Set(["sc2-adjutant.workspace.json", "sc2-adjutant-plugin.json", "blueprint.json", "compile-record.json", "co-design.json", "co-design-history.json", "SKILL.md"]);
/** A file name that is sc2-adjutant's or a package's own: one of `OWN_FILES`, or a package's data folder or component list (`Base.SC2Data`, `ComponentList.SC2Components`). */
const isOwnFile = (segment) => OWN_FILES.has(segment) || /\.SC2(?:Data|Components)$/i.test(segment);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a pattern that takes any run of whitespace between its words, as a sentence or a line break may hold it. */
const namePattern = (name) => new RegExp(`(?<![\\w-])${name.trim().split(/\s+/).map(escapeRegExp).join("\\s+")}(?![\\w-])`, "iu");

/**
 * The long quotes a public report may have to leave out, each a pattern whose first group is the
 * quoted text: double, curly double, single, curly single and backtick quotes. A single quote opens
 * only after something that isn't a letter or digit and closes only before one, so an apostrophe
 * (`can't`, `the players' units`) neither opens nor closes one, and one inside a quote (`won't`) is
 * kept.
 */
const QUOTES = [/"([^"\n]{20,})"/g, /“([^”\n]{20,})”/g, /(?<![\p{L}\p{N}])'((?:[^'\n]|'(?=[\p{L}\p{N}])){20,})'(?![\p{L}\p{N}])/gu, /(?<![\p{L}\p{N}])‘((?:[^‘’\n]|’(?=[\p{L}\p{N}])){20,})’(?![\p{L}\p{N}])/gu, /`([^`\n]{20,})`/g];

/**
 * What the draft holds that a public report may have to leave out: paths, a Map Package's or Mod's
 * own name, a long quote (Screenplay text, perhaps), and the Workspace's names (`names`). A URL, a
 * relative path's placeholder segments (`<id>`) and sc2-adjutant's own file names are fine; every
 * other segment of a path with a placeholder is still tested. A quote counts only when it holds
 * more than one word, so a path or an identifier in backticks doesn't. Each problem names its
 * field. Some are the game's or sc2-adjutant's own (a game data file's path), so the list is for
 * Claude to judge, not a verdict.
 */
export function draftProblems(draft, names = []) {
  checked(draft, false);
  const problems = [];
  for (const key of DRAFT_KEYS) {
    const value = text(draft[key]);
    for (const raw of value.split(/\s+/)) {
      // Surrounding punctuation and a possessive (`Glasstide.SC2Map's,`) off; a `file://` URL is its path.
      const trailing = /[`"'’”)\]},;:.!?]+$/;
      const word = raw.replace(/^[`"'‘“(\[{]+/, "").replace(trailing, "").replace(/['’]s$/, "").replace(trailing, "").replace(/^file:\/\/(?=\/)/i, "");
      if (!word || word.includes("://")) continue;
      if (isRootedPath(word) || (!isPlaceholder(word) && isRelativePath(word))) {
        problems.push(`${key}: a path, ${word}`);
        continue;
      }
      // The segments a placeholder or a single folder keeps from reading as a path: `Name.SC2Map/Triggers`, `missions/<id>/Name.SC2Map`, `missions/<id>/notes.txt`.
      const inPlaceholderPath = isPlaceholder(word) && /[\\/]/.test(word);
      for (const segment of word.split(/[\\/]/).filter((each) => each && !isPlaceholder(each))) {
        if (isPackageName(segment)) problems.push(`${key}: a map or mod name, ${segment}`);
        else if (inPlaceholderPath && isFileName(segment) && !isOwnFile(segment)) problems.push(`${key}: a file name in a path, ${segment}`);
      }
    }
    for (const pattern of QUOTES) for (const [quote, inside] of value.matchAll(pattern)) if (/\S\s+\S/.test(inside)) problems.push(`${key}: a quote, is it Screenplay text? ${quote}`);
    for (const name of names) if (namePattern(name).test(value)) problems.push(`${key}: the Workspace's name ${name}`);
  }
  return problems;
}

/** A Plugin's manifest file, in its folder. */
const MANIFEST_FILE = "sc2-adjutant-plugin.json";
/** The folder of mod folders, at the Workspace root. */
const MODS_DIR = "mods";

/** Each folder in `folder`, sorted, then the names of the packages in it less `.SC2Map` or `.SC2Mod`; none when it can't be read. */
async function foldersIn(folder) {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const { name } of entries.filter((entry) => entry.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    names.push(name);
    try {
      const inside = await readdir(path.join(folder, name));
      names.push(...inside.map((each) => /^(.+)\.SC2(?:Map|Mod)$/i.exec(each)?.[1]).filter(Boolean).sort());
    } catch {
      // A folder that can't be read gives only its own name.
    }
  }
  return names;
}

/** A Mission's Blueprint file, in its folder. */
const BLUEPRINT_FILE = "blueprint.json";

/** A JSON file's value, or undefined when it can't be read or parsed. */
async function jsonAt(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Whether a Plugin source is a local folder (`./`, `../` or absolute), as core's `isLocalPluginSource` reads it. */
const isLocalSource = (source) => typeof source === "string" && (source === "." || source === ".." || /^\.\.?[\\/]/.test(source) || path.isAbsolute(source));

/**
 * The manifest of each Plugin the config names by local folder (its Campaign Pack, Style Pack,
 * Utilities and further Plugins), with the slot it was named in. A bundled or installed Plugin
 * isn't read, nor is a manifest that can't be.
 */
async function localManifests(folder, config) {
  const sources = [
    { source: config.campaignPack, campaignPack: true },
    { source: config.stylePack },
    ...[config.utilities, config.plugins].flatMap((list) => (Array.isArray(list) ? list.map((source) => ({ source })) : [])),
  ];
  const manifests = [];
  for (const { source, campaignPack } of sources.filter(({ source }) => isLocalSource(source))) {
    const manifest = await jsonAt(path.join(path.resolve(folder, source), MANIFEST_FILE));
    if (manifest && typeof manifest === "object") manifests.push({ manifest, campaignPack: campaignPack === true });
  }
  return manifests;
}

/** The title in each Mission folder's Blueprint, in folder order; none for a Blueprint that can't be read. */
async function missionTitles(missionsDir) {
  let entries;
  try {
    entries = await readdir(missionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const titles = [];
  for (const { name } of entries.filter((entry) => entry.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) titles.push((await jsonAt(path.join(missionsDir, name, BLUEPRINT_FILE)))?.title);
  return titles;
}

/**
 * The names a Workspace gives its work: the Campaign's id and name, its Campaign Mod's (from its
 * config, else its Campaign Pack's manifest, which core's `campaignModName` falls back to), the
 * names of the Plugins it loads from local folders, its mods' ids, each Mission's folder name,
 * package name and Blueprint title, and each mod's folder and package name.
 */
export async function workspaceNames(folder) {
  const configFile = path.join(folder, WORKSPACE_FILE);
  let config;
  try {
    config = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    throw new Error(`The Workspace config ${configFile} can't be read, so its names can't be checked: ${error.message}. The draft isn't at fault: fix the config, or say the names weren't checked.`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error(`The Workspace config ${configFile} isn't a JSON object, so its names can't be checked. The draft isn't at fault.`);
  const manifests = await localManifests(folder, config);
  const packMod = manifests.find(({ campaignPack }) => campaignPack)?.manifest.contributions?.campaignMod;
  const names = [config.campaign?.id, config.campaign?.name, config.campaignMod || packMod, ...manifests.map(({ manifest }) => manifest.name)];
  if (Array.isArray(config.mods)) names.push(...config.mods);
  const missionsDir = path.resolve(folder, typeof config.missions === "string" ? config.missions : "missions");
  names.push(...(await foldersIn(missionsDir)), ...(await missionTitles(missionsDir)));
  names.push(...(await foldersIn(path.join(folder, MODS_DIR))));
  return [...new Set(names.filter((name) => typeof name === "string" && name.trim() !== ""))];
}

/** The OS as a report names it: its name and version, with no user or machine name. */
export function osName(platform, release, macVersion) {
  if (platform === "darwin") return macVersion ? `macOS ${macVersion}` : `macOS (Darwin ${release})`;
  if (platform === "win32") return `Windows ${release}`;
  if (platform === "linux") return `Linux ${release}`;
  return `${platform} ${release}`;
}

/** The Environment field: the plugin's and core's versions, and the OS. */
export function environmentLine({ plugin, core, os: system }) {
  return `plugin ${plugin ?? "version unknown"}, core ${core ?? "not found"}, ${system}`;
}

/**
 * This machine's Environment field: the plugin around this script, core's version, and the OS.
 * `coreVersion` is the running server's, as `list_plugins` names it. Without it, the core the
 * launcher would find from here stands in, which can be another core than the server's: the
 * plugin's `core_path` option reaches the server's environment, not Claude's shell.
 */
function environment(coreVersion) {
  const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const workspace = findWorkspace(process.cwd());
  const coreSetting = expanded(process.env.SC2_ADJUTANT_CORE) || expanded(process.env.CLAUDE_PLUGIN_OPTION_CORE_PATH);
  const core = expanded(coreVersion) ? { version: coreVersion } : findCore({ coreSetting, workspace, pluginRoot });
  let macVersion;
  if (process.platform === "darwin") {
    try {
      macVersion = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
    } catch {
      macVersion = undefined;
    }
  }
  return environmentLine({ plugin: pluginVersion(pluginRoot), core: core.version, os: osName(process.platform, os.release(), macVersion) });
}

const USAGE = "Usage: node report.mjs <check|preview|file|url|clipboard> <draft.json>, preview <draft.json> --comment, comment <issue> <draft.json>, route, or environment [core version]";

async function main([command, ...args]) {
  const draftAt = async (file) => {
    if (!file) throw new Error(USAGE);
    return JSON.parse(await readFile(file, "utf8"));
  };
  // The filing route from the user's permission on the repo; a `gh` that fails reads as no access.
  const route = () => {
    const result = spawnSync("gh", GH_PERMISSION, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return fileRoute(result.status === 0 ? result.stdout : undefined);
  };
  // Runs `gh` with the body on its stdin, passing on its output and its exit status.
  const gh = ({ args: ghArgs, input }) => {
    const result = spawnSync("gh", ghArgs, { input, stdio: ["pipe", "inherit", "inherit"] });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  switch (command) {
    case "check": {
      const workspace = findWorkspace(process.cwd());
      const problems = draftProblems(await draftAt(args[0]), workspace ? await workspaceNames(workspace) : []);
      process.stdout.write(problems.length ? `${problems.join("\n")}\n` : "Nothing to leave out found.\n");
      return problems.length ? 1 : 0;
    }
    case "preview":
      process.stdout.write(args[1] === "--comment" ? markdownBody(await draftAt(args[0])) : fullText(await draftAt(args[0])));
      return 0;
    case "route":
      process.stdout.write(`${route()}\n`);
      return 0;
    case "file": {
      const created = ghCreate(await draftAt(args[0]));
      if (route() !== "gh") {
        process.stderr.write("Nothing filed: GitHub would drop the report's labels, since your account has no push access to the repo. Use the form URL instead (url <draft.json>).\n");
        return 3;
      }
      return gh(created);
    }
    case "comment":
      return gh(ghComment(args[0], await draftAt(args[1])));
    case "url":
      process.stdout.write(`${JSON.stringify(formUrl(await draftAt(args[0])), null, 2)}\n`);
      return 0;
    case "clipboard":
      process.stdout.write(formUrl(await draftAt(args[0])).clipboard ?? "");
      return 0;
    case "environment":
      process.stdout.write(`${environment(args[0])}\n`);
      return 0;
    default:
      process.stderr.write(`${USAGE}\n`);
      return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      // 2 for every error (a bad draft or command line), apart from check's 1 for finds and file's 3.
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
    },
  );
}
