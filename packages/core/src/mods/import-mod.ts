// Import a mod (ADR-0011, on ADR-0010): makes a Workspace mod from a mod built outside the
// Workspace. The package is copied byte for byte to mods/<id>/<Name>.SC2Mod, keeping its name, since
// Missions' dependencies refer to it by that name, and everything in it starts as Kept Content: the
// mod gets a minimal Mod Blueprint (id, kind, the dependencies its DocumentInfo lists and the
// catalog files its includes list names) and an empty compile record. The Workspace config names
// the new mod, and an Asset Mod's binaries are tracked by Git LFS through the Workspace's
// .gitattributes. The source is only read. The `import-mod` CLI and the MCP server's `import_mod`
// tool both run it.

import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_COMPILE_RECORD } from "../domain/compile-record.js";
import { type ModBlueprint, ModBlueprintSchema, type ModKind } from "../domain/mod-blueprint.js";
import { slugId } from "../domain/mission-blueprint.js";
import { importPackage, undoing } from "../map/import-package.js";
import { saveCompileRecord } from "../map/mission-package.js";
import { readDependencies } from "../map/read-dependencies.js";
import { BLUEPRINT_FILE, MODS_DIR, WORKSPACE_FILE, type Workspace } from "../plugins/workspace.js";
import { includesFile, packageFiles, readIncludes } from "./game-data-files.js";
import { isModPackageName, MOD_PACKAGE_EXTENSION, modDir, modFolderPackages, modPackageName, sameModName } from "./workspace-mods.js";

/**
 * The file types of an Asset Mod tracked by Git LFS: models and their animations, textures and
 * images, audio, video, fonts and FaceFX. Matched in any case, since mods hold `.DDS` beside `.dds`.
 */
export const LFS_EXTENSIONS = ["m3", "m3a", "m3h", "dds", "tga", "png", "jpg", "jpeg", "ogg", "wav", "mp3", "flac", "fxa", "ogv", "webm", "ttf", "otf"] as const;

const GITATTRIBUTES = ".gitattributes";
const LFS_ATTRIBUTES = "filter=lfs diff=lfs merge=lfs -text";

export type ImportModOptions = {
  /** The mod's kind; by default a package with game data, triggers, cutscenes or UI is a Campaign Mod, and one with only art and audio an Asset Mod. */
  readonly kind?: ModKind;
};

export type ImportedMod = {
  readonly blueprintPath: string;
  readonly modPackage: string;
  readonly kind: ModKind;
  /** What Import read and did, for the author. */
  readonly notes: readonly string[];
};

/** Imports the mod package at `source` as the Workspace mod `modId`, as above. The source is only read. */
export async function importMod(workspace: Workspace, source: string, modId: string, options: ImportModOptions = {}): Promise<ImportedMod> {
  const id = slugId.safeParse(modId);
  if (!id.success) throw new Error(`${modId} isn't a mod id: ${id.error.issues[0]?.message}`);
  const sourceDir = path.resolve(source);
  const fileName = path.basename(sourceDir);
  const isFolder = existsSync(sourceDir) && (await stat(sourceDir)).isDirectory();
  if (!isFolder || !isModPackageName(fileName) || !existsSync(path.join(sourceDir, "DocumentHeader"))) {
    throw new Error(`${sourceDir} isn't an unpacked ${MOD_PACKAGE_EXTENSION} folder with a DocumentHeader: Import takes a mod saved unpacked (a packed one can be saved unpacked from the Editor)`);
  }
  const name = modPackageName(fileName);
  const dir = modDir(workspace, modId);
  const alreadyThere = `The mod ${modId} is already there (${dir}): import under another id, or remove it first`;
  if (existsSync(dir) || workspace.mods.includes(modId)) throw new Error(alreadyThere);
  // Two mods of one name would be the same dependency, so a Mission couldn't say which it means.
  // Every mod folder counts, read or not, named in the config or not.
  for (const other of await modFolderPackages(workspace)) {
    if (sameModName(other.name, name)) throw new Error(`The Workspace already imports ${other.name}${MOD_PACKAGE_EXTENSION} as ${other.id}: a Workspace has one mod of each name`);
  }

  const notes: string[] = [];
  const kind = options.kind ?? (await kindOf(sourceDir));
  notes.push(
    options.kind
      ? `Imported as ${article(kind)} ${kindName(kind)}, as asked`
      : `Imported as ${article(kind)} ${kindName(kind)}: the package ${kind === "campaign" ? "has game data, triggers, cutscenes or UI" : "holds only art and audio, no game data, triggers, cutscenes or UI"} (pass the kind to say otherwise)`,
  );
  // Only what Import reads: the parts a Blueprint owns are added as they're converted.
  // The includes list, too: the Blueprint owns it from the start, as the order the game loads its catalog files in.
  const files = await packageFiles(sourceDir);
  // Each file once, as the game reads it: a file listed again in another case loads once.
  const listed = includesFile(files) ? await readIncludes(sourceDir, files) : undefined;
  const includes = listed?.filter((file, index) => listed.findIndex((other) => other.toLowerCase() === file.toLowerCase()) === index);
  if (listed && includes && includes.length < listed.length) notes.push(`Its includes list names ${listed.length - includes.length} file(s) twice: the Blueprint's includes name each once, so the first compile's Equivalence Check shows the difference`);
  const parsed: ModBlueprint = ModBlueprintSchema.parse({ id: modId, kind, dependencies: await readDependencies(sourceDir), ...(includes ? { includes } : {}) });
  const blueprint = { id: parsed.id, kind: parsed.kind, dependencies: parsed.dependencies, ...(parsed.includes ? { includes: parsed.includes } : {}) };

  const modPackage = path.join(dir, fileName);
  const blueprintPath = path.join(dir, BLUEPRINT_FILE);
  await importPackage(sourceDir, dir, modPackage, alreadyThere, async () => {
    notes.push(`Copied ${sourceDir} to ${modPackage}`);
    await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    if (blueprint.dependencies.length > 0) notes.push(`It depends on ${blueprint.dependencies.join("; ")}`);
    if (blueprint.includes) notes.push(`Its includes list loads ${blueprint.includes.length === 0 ? "no catalog file" : blueprint.includes.join(", ")}: the Blueprint's includes, which the compile writes the list from`);
    // The Workspace's own files, changed one import at a time, so two at once each keep the other's change.
    await oneAtATime(workspace.root, async () => {
      const tracked = kind === "asset" ? await trackInLfs(workspace.root, `${MODS_DIR}/${modId}`) : undefined;
      try {
        await nameInConfig(workspace.root, modId);
      } catch (error) {
        throw await undoing(error, ...(tracked?.undo ? [tracked.undo] : []));
      }
      if (tracked) notes.push(tracked.note);
    });
    notes.push(`Named ${modId} in the Workspace's mods (${WORKSPACE_FILE})`);
  });
  return { blueprintPath, modPackage, kind, notes };
}

/** The work queued on each Workspace root, so its config and .gitattributes are changed by one import at a time. */
const queues = new Map<string, Promise<unknown>>();

/** Runs `work` after every change already queued on the Workspace at `root`. */
async function oneAtATime<T>(root: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(root);
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(work, work);
  const settled = run.catch(() => undefined);
  queues.set(key, settled);
  try {
    return await run;
  } finally {
    if (queues.get(key) === settled) queues.delete(key);
  }
}

/** What only a Campaign Mod holds in its data: catalogs and other XML, Galaxy, cutscenes, layouts and font styles. */
const CAMPAIGN_FILE = /\.(xml|galaxy|sc2cutscene|sc2layout|sc2style)$/i;

/**
 * A Campaign Mod when the package has triggers (a Triggers file with something in it), or game data, cutscenes or UI in its Base.SC2Data;
 * otherwise an Asset Mod, even with its art in Base.SC2Data/Assets, as Editor-made asset mods often keep it.
 */
async function kindOf(sourceDir: string): Promise<ModKind> {
  if (await hasTriggers(sourceDir)) return "campaign";
  const data = path.join(sourceDir, "Base.SC2Data");
  if (!existsSync(data)) return "asset";
  const entries = await readdir(data, { recursive: true, withFileTypes: true });
  return entries.some((entry) => entry.isFile() && CAMPAIGN_FILE.test(entry.name)) ? "campaign" : "asset";
}

/**
 * Whether the package's Triggers file holds anything: an item or element in its trigger data. The
 * Editor can save a mod with no triggers as an empty TriggerData, or an empty Library.
 */
async function hasTriggers(sourceDir: string): Promise<boolean> {
  const file = path.join(sourceDir, "Triggers");
  if (!existsSync(file)) return false;
  return /<(Item|Element)\b/.test(await readFile(file, "utf8"));
}

const kindName = (kind: ModKind) => (kind === "campaign" ? "Campaign Mod" : "Asset Mod");
const article = (kind: ModKind) => (kind === "asset" ? "an" : "a");

/** `ext` as a pattern matching it in any case: `dds` is `[dD][dD][sS]`. */
const anyCase = (ext: string) => [...ext].map((char) => (/[a-z]/.test(char) ? `[${char}${char.toUpperCase()}]` : char)).join("");

/**
 * Adds the Git LFS patterns for the mod folder `folder` (relative to the Workspace root, forward
 * slashes) that .gitattributes lacks, and gives a way to take out again only the lines it added.
 */
async function trackInLfs(root: string, folder: string): Promise<{ readonly note: string; readonly undo?: () => Promise<void> }> {
  const file = path.join(root, GITATTRIBUTES);
  const existed = existsSync(file);
  const text = existed ? await readFile(file, "utf8") : "";
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]));
  const missing = LFS_EXTENSIONS.map((extension) => `${folder}/**/*.${anyCase(extension)}`).filter((pattern) => !present.has(pattern));
  if (missing.length === 0) return { note: `${GITATTRIBUTES} already tracks the mod's binaries in Git LFS` };
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  const added = missing.map((pattern) => `${pattern} ${LFS_ATTRIBUTES}`);
  await writeFile(file, `${text}${lead}${added.map((line) => `${line}\n`).join("")}`);
  return {
    note: `Tracked the mod's binaries (${LFS_EXTENSIONS.join(", ")}, in any case) in Git LFS in ${GITATTRIBUTES}: each machine needs git lfs installed (git lfs install) before committing them`,
    undo: async () => {
      const now = await readFile(file, "utf8");
      const lines = now.split("\n");
      for (const line of added) {
        const at = lines.indexOf(line);
        if (at >= 0) lines.splice(at, 1);
      }
      const left = lines.join("\n");
      if (!existed && left.trim() === "") await rm(file, { force: true });
      else await writeFile(file, left === `${text}${lead}` && lead !== "" ? text : left);
    },
  };
}

/**
 * Adds `modId` to the Workspace config's `mods`, changing only that in its text: the rest keeps its
 * formatting, such as an object written on one line.
 */
async function nameInConfig(root: string, modId: string): Promise<void> {
  const file = path.join(root, WORKSPACE_FILE);
  const text = await readFile(file, "utf8");
  const config = JSON.parse(text) as Record<string, unknown>;
  if (Array.isArray(config.mods) && config.mods.includes(modId)) return;
  await writeFile(file, withMod(text, modId));
}

/** The config's text with `modId` added at the end of its top-level `mods`, or with `mods` added as its last field. */
export function withMod(text: string, modId: string): string {
  const id = JSON.stringify(modId);
  const top = topLevel(text);
  const mods = top.fields.find((field) => field.key === "mods");
  if (mods && text[mods.valueStart] === "[") {
    const close = mods.valueEnd - 1;
    const inside = text.slice(mods.valueStart + 1, close);
    if (inside.trim() === "") return `${text.slice(0, mods.valueStart)}[${id}]${text.slice(mods.valueEnd)}`;
    const last = mods.valueStart + 1 + inside.trimEnd().length;
    const lineStart = text.lastIndexOf("\n", last - 1) + 1;
    const separator = inside.includes("\n") ? `,\n${/^[ \t]*/.exec(text.slice(lineStart))![0]}` : ", ";
    return `${text.slice(0, last)}${separator}${id}${text.slice(last)}`;
  }
  const lastField = top.fields.at(-1);
  if (!lastField) return `${text.slice(0, top.open + 1)}"mods": [${id}]${text.slice(top.close)}`;
  const lineStart = text.lastIndexOf("\n", lastField.keyStart - 1) + 1;
  const sameLine = lineStart <= top.open;
  const separator = sameLine ? ", " : `,\n${/^[ \t]*/.exec(text.slice(lineStart))![0]}`;
  return `${text.slice(0, lastField.valueEnd)}${separator}"mods": [${id}]${text.slice(lastField.valueEnd)}`;
}

type Field = { readonly key: string; readonly keyStart: number; readonly valueStart: number; readonly valueEnd: number };

/** The top-level object's braces and fields, each with where its key starts and its value's span, in a text that is valid JSON. */
function topLevel(text: string): { readonly open: number; readonly close: number; readonly fields: readonly Field[] } {
  let at = 0;
  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at]!)) at++;
  };
  const skipString = () => {
    for (at++; text[at] !== '"'; at++) if (text[at] === "\\") at++;
    at++;
  };
  const skipValue = () => {
    if (text[at] === '"') return skipString();
    if (text[at] !== "{" && text[at] !== "[") {
      while (at < text.length && !/[\s,}\]]/.test(text[at]!)) at++;
      return;
    }
    let depth = 0;
    do {
      if (text[at] === '"') {
        skipString();
        continue;
      }
      if (text[at] === "{" || text[at] === "[") depth++;
      else if (text[at] === "}" || text[at] === "]") depth--;
      at++;
    } while (depth > 0);
  };
  skipSpace();
  const open = at++;
  const fields: Field[] = [];
  for (;;) {
    skipSpace();
    if (text[at] === "}") break;
    if (text[at] === ",") {
      at++;
      continue;
    }
    const keyStart = at;
    skipString();
    const key = JSON.parse(text.slice(keyStart, at)) as string;
    skipSpace();
    at++; // the colon
    skipSpace();
    const valueStart = at;
    skipValue();
    fields.push({ key, keyStart, valueStart, valueEnd: at });
  }
  return { open, close: at, fields };
}
