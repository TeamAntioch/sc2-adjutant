// The skills Contribution kind (ADR-0023): folders a Plugin's manifest names, each with a SKILL.md,
// and the copies of them in a Workspace's `.claude/skills/`, where Claude Code finds project
// skills. The Claude Code plugin's SessionStart hook and the `sync` tool both run
// `copyWorkspaceSkills`, so this is the one place a copy is made, refreshed or removed. It imports
// nothing of core's catalogs, so the hook stays fast.

import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { staysInside } from "../util/inside.js";
import type { PluginSkill } from "./plugin-api.js";
import { BUNDLED_PACKAGES, bundledPackageFolder, isLocalPluginSource, localPluginFolder, MANIFEST_FILE, pluginRequests, unloadableSource, WORKSPACE_FILE } from "./plugin-sources.js";

/** The file each skill folder holds, as Claude Code reads it. */
export const SKILL_FILE = "SKILL.md";

/** Where skill text names its Plugin's folder; filled in with the folder's absolute path on copy, so scripts run from the Plugin, not the copy. */
export const PLUGIN_FOLDER_PLACEHOLDER = "{{PLUGIN_FOLDER}}";

/** The file in each copied skill folder that marks it as a copy this module made; a folder without it is never touched. */
export const SKILL_MARKER = ".sc2-adjutant-skill.json";

/** A Workspace's skills folder, relative to its root. */
export const SKILLS_DIR = path.join(".claude", "skills");

/** A manifest's `contributions.skills`: skill folders, relative to the Plugin's folder. */
export const SkillsSchema = z.array(z.string().min(1)).default([]);

/** A skill's folder name in its Plugin: lowercase letters, digits and hyphens, as Claude Code names a project skill. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A Plugin's name as the start of a skill's name: without an npm scope's `@`, and with a hyphen for
 * each run of anything else a skill's name can't hold (`@scope/x.y` is `scope-x-y`).
 */
export function skillPrefix(plugin: string): string {
  return plugin
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The name a Plugin's skill is copied as (decided by the author on 2026-11-22): its folder's name
 * after its Plugin's, so skills of different Plugins don't meet, unless the folder's name already is
 * the Plugin's or starts with it (`portraits` from Plugin `portraits` stays `portraits`).
 */
export function copiedSkillName(plugin: string, folderName: string): string {
  const prefix = skillPrefix(plugin);
  return folderName === prefix || folderName.startsWith(`${prefix}-`) ? folderName : `${prefix}-${folderName}`;
}

/** Python's compiled bytecode (a `__pycache__` folder, a `.pyc` file), which running a skill's scripts writes beside them: never copied, and no part of a copy's fingerprint. */
const isBytecode = (name: string) => name === "__pycache__" || name.toLowerCase().endsWith(".pyc");

/** Files whose placeholder is filled in on copy; any other file is copied byte for byte. */
const TEXT_FILES = new Set([".md"]);

/** Claude Code's longest skill name. */
const SKILL_NAME_MAX = 64;

/** Bumped when a copy's layout changes, so every copy is made again. */
const COPY_FORMAT = 2;

/**
 * The skills a Plugin's manifest names, checked: each a folder inside the Plugin's folder (by real
 * path too, so a symlink can't lead out of it) holding a SKILL.md, named by its folder after its
 * Plugin (`copiedSkillName`), and no two of one name.
 */
export function pluginSkills(plugin: string, pluginFolder: string, entries: readonly string[], label: string): PluginSkill[] {
  const skills = entries.map((entry, index) => {
    const where = `${label}: contributions.skills.${index}`;
    const folder = path.resolve(pluginFolder, entry);
    const outside = (from: string, to: string) => !staysInside(path.relative(from, to));
    if (outside(pluginFolder, folder)) throw new Error(`${where} ${entry} must be a folder inside the Plugin's folder`);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${where} ${entry} must be a folder (${folder})`);
    if (outside(realpathSync(pluginFolder), realpathSync(folder))) throw new Error(`${where} ${entry} must be a folder inside the Plugin's folder`);
    const skillFile = path.join(folder, SKILL_FILE);
    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) throw new Error(`${where} ${entry} holds no ${SKILL_FILE}`);
    const folderName = path.basename(folder);
    if (!SKILL_NAME.test(folderName)) throw new Error(`${where} ${entry}: a skill's folder name is lowercase letters, digits and hyphens`);
    const name = copiedSkillName(plugin, folderName);
    if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) throw new Error(`${where} ${entry}: it would be copied as ${name}, and a skill's name is at most ${SKILL_NAME_MAX} lowercase letters, digits and hyphens, starting with a letter or digit`);
    return { plugin, name, folderName, folder, pluginFolder };
  });
  const names = skills.map((skill) => skill.name);
  const twice = skills.findIndex((skill, index) => names.indexOf(skill.name) !== index);
  if (twice !== -1) {
    const [first, again] = [skills[names.indexOf(names[twice]!)]!, skills[twice]!];
    throw new Error(first.folderName === again.folderName ? `${label}: its skills hold ${again.folderName} twice` : `${label}: its skills ${first.folderName} and ${again.folderName} are both copied as ${again.name}`);
  }
  return skills;
}

/**
 * Adds a Plugin's skills to those already loaded, refusing one copied under a name another Plugin's
 * is (Plugin `a`'s `b-c` and Plugin `a-b`'s `c` are both `a-b-c`): both would be one folder in
 * `.claude/skills/`.
 */
export function addSkills(loaded: Map<string, PluginSkill>, skills: readonly PluginSkill[], label: string): void {
  for (const skill of skills) {
    const clash = loaded.get(skill.name);
    if (clash) throw new Error(`${label} contributes the skill ${skill.folderName}, copied as ${skill.name}, which Plugin ${clash.plugin}'s skill ${clash.folderName} is copied as too`);
    loaded.set(skill.name, skill);
  }
}

/** The Plugin slots of a Workspace config, read leniently: the server validates the rest. */
const SlotsSchema = z.looseObject({
  campaignPack: z.string().min(1).optional(),
  stylePack: z.string().min(1).optional(),
  utilities: z.array(z.string().min(1)).optional(),
  plugins: z.array(z.string().min(1)).optional(),
});

/** A manifest, as far as its skills go. */
const SkillManifestSchema = z.looseObject({ name: z.string().min(1), contributions: z.looseObject({ skills: SkillsSchema }).optional() });

/**
 * The skills of the Plugins the Workspace at `root` names, found as the registry finds them but
 * from their manifests alone, with no Plugin code imported. A Plugin built into core contributes
 * none.
 */
export async function workspaceSkills(root: string): Promise<PluginSkill[]> {
  const configPath = path.join(root, WORKSPACE_FILE);
  const slots = SlotsSchema.safeParse(JSON.parse(await readFile(configPath, "utf8")));
  if (!slots.success) throw new Error(`Invalid Workspace config ${configPath}: ${slots.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const loaded = new Map<string, PluginSkill>();
  for (const { source } of pluginRequests(slots.data)) {
    const folder = sourceFolder(root, source);
    if (!folder) continue;
    const manifestPath = path.join(folder, MANIFEST_FILE);
    const manifest = SkillManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (!manifest.success) throw new Error(`Plugin ${source} has an invalid manifest ${manifestPath}`);
    const label = `Plugin ${manifest.data.name} (${source})`;
    addSkills(loaded, pluginSkills(manifest.data.name, folder, manifest.data.contributions?.skills ?? [], label), label);
  }
  return [...loaded.values()];
}

/** A source's folder, or undefined for a Plugin built into core. */
function sourceFolder(root: string, source: string): string | undefined {
  if (source.startsWith("bundled:")) {
    const name = source.slice("bundled:".length);
    return Object.hasOwn(BUNDLED_PACKAGES, name) ? bundledPackageFolder(source, BUNDLED_PACKAGES[name]!) : undefined;
  }
  if (!isLocalPluginSource(source)) throw new Error(unloadableSource(source));
  return localPluginFolder(root, source);
}

/** What a copy did: skill names copied (new or refreshed), left as they were, and removed, and those it left alone with why. */
export type SkillCopyReport = {
  readonly copied: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly plugin: string; readonly reason: string }[];
};

/** A copy's report as lines for a tool's reply: none when every copy was already as it should be. */
export function formatSkillCopy(report: SkillCopyReport): string[] {
  return [
    ...(report.copied.length ? [`Copied the Plugins' skills into .claude/skills: ${report.copied.join(", ")}`] : []),
    ...(report.removed.length ? [`Removed the copies of skills no listed Plugin contributes: ${report.removed.join(", ")}`] : []),
    ...report.skipped.map(({ name, plugin, reason }) => `Plugin ${plugin}'s skill ${name} wasn't copied: ${reason}`),
  ];
}

/** What a marker records. */
type Marker = { readonly plugin: string; readonly pluginFolder: string; readonly fingerprint: string };

/** Copies the skills of the Workspace's Plugins into its `.claude/skills/` (see `copySkills`). */
export async function copyWorkspaceSkills(root: string): Promise<SkillCopyReport> {
  return copySkills(root, await workspaceSkills(root));
}

/**
 * Makes `<root>/.claude/skills/` hold a copy of each skill, and no other copy: each copied folder
 * gets a marker, its text files' placeholder is filled in with the Plugin's folder, and a copy
 * whose source hasn't changed since is left as it is. A marked folder whose skill is no longer
 * contributed is removed. A folder or link without the marker is never touched, even one of a
 * skill's name, which is then skipped. Files are copied, never linked. The Workspace's
 * `.gitignore` lists the copies, in a block of its own.
 */
export async function copySkills(root: string, skills: readonly PluginSkill[]): Promise<SkillCopyReport> {
  const dir = path.join(root, SKILLS_DIR);
  const marked = await markedCopies(dir);
  const copied: string[] = [];
  const unchanged: string[] = [];
  const kept: string[] = [];
  const skipped: { name: string; plugin: string; reason: string }[] = [];
  for (const skill of skills) {
    const target = path.join(dir, skill.name);
    const marker = marked.get(skill.name);
    if (!marker && (await exists(target))) {
      skipped.push({ name: skill.name, plugin: skill.plugin, reason: `${path.posix.join(SKILLS_DIR.split(path.sep).join("/"), skill.name)} is already there and wasn't copied from a Plugin, so it is left as it is` });
      continue;
    }
    try {
      const files = await skillFiles(skill);
      const fingerprint = await fingerprintOf(skill, files);
      if (marker?.fingerprint === fingerprint) {
        unchanged.push(skill.name);
        continue;
      }
      await writeCopy(root, skill, files, { plugin: skill.plugin, pluginFolder: skill.pluginFolder, fingerprint }, target);
      copied.push(skill.name);
    } catch (error) {
      // One skill that can't be copied leaves the others, and keeps a copy it already has.
      if (marker) kept.push(skill.name);
      skipped.push({ name: skill.name, plugin: skill.plugin, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const wanted = new Set([...copied, ...unchanged, ...kept]);
  const removed: string[] = [];
  for (const name of marked.keys()) {
    if (wanted.has(name)) continue;
    await rm(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  await ignoreCopies(root, [...wanted].sort());
  return { copied, unchanged, removed, skipped };
}

/** The marked copies in the skills folder, by name: real folders (not links) holding a readable marker. */
async function markedCopies(dir: string): Promise<Map<string, Marker>> {
  const marked = new Map<string, Marker>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return marked;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const marker = JSON.parse(await readFile(path.join(dir, entry.name, SKILL_MARKER), "utf8")) as Partial<Marker>;
      marked.set(entry.name, { plugin: String(marker.plugin), pluginFolder: String(marker.pluginFolder), fingerprint: String(marker.fingerprint) });
    } catch {
      // No marker, or one that can't be read: not a copy this module made.
    }
  }
  return marked;
}

const exists = async (file: string) => {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
};

/** A file of a skill: where it is, by real path, and its path in the copy. */
type SkillFile = { readonly source: string; readonly relative: string };

/**
 * Every file in a skill folder, following links that stay inside the Plugin's folder. A link that
 * leads outside it, one that leads nowhere, and a folder link back into its own folder are refused.
 */
async function skillFiles(skill: PluginSkill): Promise<SkillFile[]> {
  const pluginReal = await realpath(skill.pluginFolder);
  const files: SkillFile[] = [];
  const refuse = (relative: string, why: string) => new Error(`its ${relative} is ${why}`);
  const walk = async (folder: string, relative: string, above: ReadonlySet<string>): Promise<void> => {
    for (const name of (await readdir(folder)).sort()) {
      if ((relative === "" && name === SKILL_MARKER) || isBytecode(name)) continue;
      const inCopy = path.join(relative, name);
      let real: string;
      try {
        real = await realpath(path.join(folder, name));
      } catch {
        throw refuse(inCopy, "a link that leads nowhere");
      }
      if (!staysInside(path.relative(pluginReal, real))) throw refuse(inCopy, "a link that leads outside the Plugin's folder");
      const info = await stat(real);
      if (info.isDirectory()) {
        if (above.has(real)) throw refuse(inCopy, "a link back into a folder that holds it");
        await walk(real, inCopy, new Set([...above, real]));
      } else if (info.isFile()) {
        files.push({ source: real, relative: inCopy });
      }
    }
  };
  const top = await realpath(skill.folder);
  await walk(top, "", new Set([top]));
  return files;
}

/** What a copy is made from: the name it's copied as and the Plugin's folder (both filled into its text), and each file's path and contents. */
async function fingerprintOf(skill: PluginSkill, files: readonly SkillFile[]): Promise<string> {
  const hash = createHash("sha256").update(`${COPY_FORMAT}\0${skill.plugin}\0${skill.name}\0${skill.pluginFolder}`);
  for (const file of files) hash.update(`\0${file.relative}\0`).update(await readFile(file.source));
  return hash.digest("hex");
}

/** The Plugin's folder as skill text names it: with forward slashes, which a shell, Python and Node all read on Windows too. */
const placeholderValue = (pluginFolder: string) => pluginFolder.split(path.sep).join("/");

/**
 * A SKILL.md with its frontmatter's `name:` set to the name it's copied as, so Claude Code names the
 * skill as its folder is named. A SKILL.md without frontmatter is left as it is: Claude Code then
 * names the skill by its folder.
 */
export function renamedSkillText(text: string, name: string): string {
  const frontmatter = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!frontmatter) return text;
  const [whole, open, body, close] = frontmatter as unknown as [string, string, string, string];
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((line) => /^name\s*:/.test(line));
  if (at === -1) {
    lines.unshift(`name: ${name}`);
  } else {
    // A value continued on indented lines (`name: >-` and the lines below it) goes with it.
    let next = at + 1;
    while (next < lines.length && /^\s+\S/.test(lines[next]!)) next++;
    lines.splice(at, next - at, `name: ${name}`);
  }
  return `${open}${lines.join(eol)}${close}${text.slice(whole.length)}`;
}

/** Writes a copy beside the skills folder, then moves it into place, so Claude Code never reads half of one. */
async function writeCopy(root: string, skill: PluginSkill, files: readonly SkillFile[], marker: Marker, target: string): Promise<void> {
  const staging = path.join(root, ".claude", `${STAGING_PREFIX}${skill.name}.partial`);
  await rm(staging, { recursive: true, force: true });
  for (const file of files) {
    const to = path.join(staging, file.relative);
    await mkdir(path.dirname(to), { recursive: true });
    if (TEXT_FILES.has(path.extname(file.relative).toLowerCase())) {
      const text = (await readFile(file.source, "utf8")).replaceAll(PLUGIN_FOLDER_PLACEHOLDER, placeholderValue(skill.pluginFolder));
      await writeFile(to, file.relative.toLowerCase() === SKILL_FILE.toLowerCase() ? renamedSkillText(text, skill.name) : text);
    } else {
      await copyFile(file.source, to);
    }
  }
  await mkdir(staging, { recursive: true });
  await writeFile(path.join(staging, SKILL_MARKER), `${JSON.stringify({ ...marker, note: "Copied from a Plugin by sc2-adjutant; it is replaced whenever the Plugin's skill changes, and removed when the Workspace no longer lists the Plugin. Edit the Plugin's skill, not this copy." }, null, 2)}\n`);
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
}

/** A copy is written here, beside the skills folder, then moved into it. */
const STAGING_PREFIX = ".sc2-adjutant-skill-";

const IGNORE_START = "# sc2-adjutant: skills copied from the Workspace's Plugins (rewritten each session; edit the Plugins instead)";
const IGNORE_END = "# sc2-adjutant: end of copied skills";

/** Lists the copies in the Workspace's `.gitignore`, in a block of its own that it rewrites; a `.gitignore` with no copies to list and no block is left alone. */
async function ignoreCopies(root: string, names: readonly string[]): Promise<void> {
  const file = path.join(root, ".gitignore");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    if (names.length === 0) return;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const start = lines.indexOf(IGNORE_START);
  if (start === -1 && names.length === 0) return;
  // The block's end: its end line, or, if that was deleted, the last of the lines the block writes after its start.
  let end = start === -1 ? -1 : lines.indexOf(IGNORE_END, start);
  if (start !== -1 && end === -1) for (end = start; lines[end + 1]?.startsWith("/.claude/"); end++);
  const skillsDir = SKILLS_DIR.split(path.sep).join("/");
  const block = names.length ? [IGNORE_START, ...names.map((name) => `/${skillsDir}/${name}/`), `/.claude/${STAGING_PREFIX}*.partial/`, IGNORE_END] : [];
  let next: string[];
  if (start !== -1) {
    next = [...lines.slice(0, start), ...block, ...lines.slice(end + 1)];
  } else {
    const body = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
    next = [...body, ...(body.length && body.at(-1) !== "" ? [""] : []), ...block, ""];
  }
  // A removed block leaves no blank line run behind it at the end of the file.
  while (next.length > 1 && next.at(-1) === "" && next.at(-2) === "") next.pop();
  const updated = next.join(eol);
  if (updated !== text) await writeFile(file, updated);
}
