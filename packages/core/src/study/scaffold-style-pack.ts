// Starting a Style Pack in a Workspace (#29): the scaffold_style_pack and add_exemplar_map tools.
//
// The pack is laid out as packages/plugin-style-antioch is (its manifest at the root, the guide in
// knowledge/, the Exemplar Maps list and lessons in exemplar-maps/), so the folder can later become
// a package unchanged. It starts with no Exemplar Maps, lessons or moods: those are the mapper's.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { CAPTURE_IGNORES } from "../capture/style-pack-captures.js";
import type { MachineConfig } from "../host/machine-config.js";
import { type ExemplarProvenance, PLUGIN_API_VERSION } from "../plugins/plugin-api.js";
import { isLocalPluginSource, localPluginFolder, MANIFEST_FILE } from "../plugins/plugin-sources.js";
import { EXEMPLAR_ID_PATTERN, PLUGIN_NAME_PATTERN } from "../plugins/registry.js";
import { exemplarSourceFolder, WORKSPACE_FILE, type Workspace } from "../plugins/workspace.js";
import { isInside } from "../util/inside.js";
import { replaceFile } from "../util/replace-file.js";

/** Where a new pack goes in the Workspace, by default. */
export const DEFAULT_STYLE_PACK_FOLDER = "style-pack";

/** What a pack's Exemplar Maps folder never commits: tours, their frames, cited frames and minimaps. */
export const STYLE_PACK_IGNORES = [...CAPTURE_IGNORES, "*/evidence/", "*/minimap.png"] as const;

export type ScaffoldStylePackOptions = {
  /** The pack's folder, relative to the Workspace root; `style-pack` by default. */
  readonly folder?: string;
  /** The Plugin's name; `style-<campaign id>` by default. */
  readonly name?: string;
  /** Replace the Style Pack the Workspace config already names. Refused without it when it names one. */
  readonly replace?: boolean;
};

export type ScaffoldedStylePack = {
  readonly name: string;
  /** Absolute. */
  readonly folder: string;
  /** As the Workspace config's stylePack now names it. */
  readonly source: string;
  /** The files written, relative to the pack's folder. */
  readonly files: readonly string[];
  /** The Style Pack the config named before, as it named it, when this replaced one. */
  readonly replaced?: string;
};

/** The Workspace config at `root`, as JSON, not validated: what a write keeps beside stylePack. */
async function readConfigJson(root: string): Promise<Record<string, unknown>> {
  const file = path.join(root, WORKSPACE_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Workspace config ${file}: ${(error as Error).message}`, { cause: error });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`Invalid Workspace config ${file}: not a JSON object`);
  return raw as Record<string, unknown>;
}

/** The Style Pack a config's stylePack names, for a refusal: its Plugin name too, when its manifest can be read. */
async function describePack(root: string, source: string): Promise<string> {
  if (!isLocalPluginSource(source)) return source;
  try {
    const manifest = JSON.parse(await readFile(path.join(localPluginFolder(root, source), MANIFEST_FILE), "utf8")) as { name?: unknown };
    return typeof manifest.name === "string" ? `${manifest.name} (${source})` : source;
  } catch {
    return source;
  }
}

/** `relative` written as a Workspace config's local source: with `./`, forward slashes. */
const asSource = (relative: string) => `./${relative.split(path.sep).join("/")}`;

/**
 * Makes a Style Pack Plugin in `folder` of the Workspace at `root`, and names it as the Workspace
 * config's stylePack: its manifest with the style-pack role and knowledge entries, an empty
 * Exemplar Maps list, LESSONS.md and candidate-lessons.md with their headings and the lesson
 * format, a GUIDE.md stub and the .gitignore for what captures write. Refused, before anything is
 * written, when the folder is outside the Workspace, exists and isn't empty, or when the config
 * names a Style Pack already and `replace` isn't set.
 */
export async function scaffoldStylePack(root: string, options: ScaffoldStylePackOptions = {}): Promise<ScaffoldedStylePack> {
  const config = await readConfigJson(root);
  const relative = path.normalize(options.folder ?? DEFAULT_STYLE_PACK_FOLDER).replace(/[\\/]+$/, "");
  const folder = path.resolve(root, relative);
  if (folder === path.resolve(root)) throw new Error(`The Style Pack's folder ${options.folder} is the Workspace's root: give a folder inside it, such as ${DEFAULT_STYLE_PACK_FOLDER}`);
  if (path.isAbsolute(relative) || !(await isInside(root, folder))) throw new Error(`The Style Pack's folder ${options.folder} is outside the Workspace ${root}: give a folder inside it, relative to its root`);
  const source = asSource(path.relative(root, folder));

  const campaign = config.campaign as { id?: unknown } | undefined;
  const name = options.name ?? `style-${typeof campaign?.id === "string" ? campaign.id : path.basename(folder)}`;
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    const given = options.name ? "" : " (made from the Campaign's id; give a name)";
    throw new Error(`The Style Pack's name ${name}${given} isn't a Plugin name: lowercase, like an npm package name (letters, digits, @, /, dots, hyphens or underscores)`);
  }

  const current = typeof config.stylePack === "string" ? config.stylePack : undefined;
  if (current !== undefined && !options.replace) {
    throw new Error(`The Workspace already names a Style Pack, ${await describePack(root, current)} (stylePack in ${path.join(root, WORKSPACE_FILE)}). Ask the mapper whether the new pack is to replace it, then pass replace: true; nothing was written`);
  }

  if (existsSync(folder)) {
    if (!(await stat(folder)).isDirectory()) throw new Error(`${folder} is a file, not a folder: give another folder for the Style Pack; nothing was written`);
    if ((await readdir(folder)).length) throw new Error(`${folder} already exists and isn't empty: give another folder for the Style Pack, or empty it; nothing was written`);
  }

  // Written beside the folder first, then moved into place, so a failure leaves no half-made pack.
  const files = packFiles(name);
  const staging = path.join(path.dirname(folder), `.${path.basename(folder)}-${randomUUID()}`);
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
      await writeFile(path.join(staging, file), content);
    }
    if (existsSync(folder)) await rmdir(folder);
    await rename(staging, folder);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await replaceFile(path.join(root, WORKSPACE_FILE), `${JSON.stringify({ ...config, stylePack: source }, null, 2)}\n`);
  return { name, folder, source, files: Object.keys(files), ...(current !== undefined ? { replaced: current } : {}) };
}

/** The new pack's files, by path in its folder. */
function packFiles(name: string): Record<string, string> {
  const manifest = {
    name,
    version: "0.1.0",
    pluginApi: PLUGIN_API_VERSION,
    roles: ["style-pack"],
    contributions: {
      knowledge: [
        {
          id: "guide",
          title: "This pack's look, step by step",
          description: "Start here: which Design Lessons govern each step of proposing or critiquing a Mission's look, and how much each weighs.",
          file: "knowledge/GUIDE.md",
        },
        {
          id: "lessons",
          title: "Design Lessons",
          description: "The ratified Design Lessons: each rule, the measured evidence and frames behind it, its weight and the Blueprint hook it shapes.",
          file: "exemplar-maps/LESSONS.md",
        },
        {
          id: "candidate-lessons",
          title: "Candidate Design Lessons",
          description: "Drafts not yet ratified, each with its rule, numbers, supporting maps and frames: none is a Design Lesson until the mapper keeps it.",
          file: "exemplar-maps/candidate-lessons.md",
        },
      ],
      exemplarMaps: "exemplar-maps/exemplars.json",
    },
  };
  return {
    [MANIFEST_FILE]: `${JSON.stringify(manifest, null, 2)}\n`,
    "exemplar-maps/exemplars.json": `${JSON.stringify({ exemplars: [] }, null, 2)}\n`,
    "exemplar-maps/LESSONS.md": LESSONS,
    "exemplar-maps/candidate-lessons.md": CANDIDATES,
    "exemplar-maps/.gitignore": `# In-game tours, their 1000px frames, the frames lessons cite and minimaps (capture_exemplar): never committed.\n${STYLE_PACK_IGNORES.join("\n")}\n`,
    "knowledge/GUIDE.md": guide(name),
  };
}

const LESSONS = `# Design Lessons

Ratified visual Design Lessons from this pack's Exemplar Maps. Each lesson is a rule to follow during Mission Blueprint co-design, with the evidence behind it. Drafts live in \`candidate-lessons.md\`; only lessons the mapper has ratified appear here, one at a time, in the order they were kept.

Each lesson gives:
- **Rule:** the instruction.
- **Evidence:** numbers from the Map Studies and the consistency report (\`exemplar_report\`), and what the in-game frames show, each named by its map, the lighting it was captured under and its stop in that tour, or, for a place-tour frame, the place's centre in cells. The frames themselves aren't part of the pack; each citation stands without its picture.
- **Weight:** how much to trust it. Evidence from a map the mapper made weighs most, then one they edited, then one they approved; agreement across independent maps counts most.
- **Blueprint hook:** the part of the Mission Blueprint it shapes, and the style-rule slot it could fill.
- **Ratified:** the date, and the mapper's own words.

The format:

\`\`\`markdown
## DL-01. <the lesson in one line>

**Rule.** <the instruction>

**Evidence.**
- <a number, with the maps it comes from>
- <map> under \`<lighting>\`, stop <n>: <what the frame shows>

**Weight.** <how much to trust it, and why>

**Blueprint hook.** <the Blueprint fields it shapes; the style-rule slot it could fill>

**Ratified.** <YYYY-MM-DD>, the mapper: "<their words>"
\`\`\`

No lessons are ratified yet.
`;

const CANDIDATES = `# Candidate Design Lessons

Drafts from the consistency report (\`exemplar_report\`) and the in-game frames. Nothing here is a Design Lesson until the mapper ratifies it; each is brought to them one at a time, and a kept one moves to \`LESSONS.md\`.

Each candidate gives:
- **Rule:** the instruction it would become.
- **Numbers:** the measure, the maps' spread and where it sits against Blizzard's campaign maps.
- **Supporting maps:** the Exemplar Maps that agree, with their provenance, and those that don't.
- **Frames:** two to four, each named by its map, its lighting and its stop, or its place's centre in cells; never by its file.
- **Blueprint hook:** the part of the Mission Blueprint it would shape.

The format:

\`\`\`markdown
## <the candidate in one line>

**Rule.** <the instruction>

**Numbers.** <measure>: <spread> across <maps>; Blizzard p10 <a>, median <b>, p90 <c>

**Supporting maps.** <id> (<provenance>), ...; outside it: <id> <value>

**Frames.**
- <map> under \`<lighting>\`, stop <n>: <what the frame shows>

**Blueprint hook.** <the Blueprint fields it would shape>
\`\`\`

No candidates yet.
`;

function guide(name: string): string {
  return `# This pack's look, step by step

How the \`exemplar-design\` method's steps apply with this Style Pack: which Design Lessons govern each step, and how much each weighs. The rules are the ratified Design Lessons in [\`LESSONS.md\`](../exemplar-maps/LESSONS.md); cite them by id ("DL-01").

Through the sc2-adjutant MCP server, each file this guide links is one of the pack's knowledge documents, at \`sc2-adjutant://plugins/${name}/knowledge/<id>\`: \`LESSONS.md\` is \`lessons\`, \`candidate-lessons.md\` is \`candidate-lessons\`, the Exemplar Maps list is \`exemplar-maps\`, and each map's \`study.json\` is \`study-<id>\`. The pack holds no screenshots: in-game frames aren't committed or served.

This guide is a stub: it is written once the pack has ratified lessons.

## Weights

## Leading words

## Propose a look
`;
}

export type AddExemplarMapOptions = {
  readonly id: string;
  /** The source map, inside the Workspace's Exemplar Map folder (or absolute). */
  readonly map: string;
  readonly provenance: ExemplarProvenance;
  readonly note?: string;
  readonly machine?: Pick<MachineConfig, "file" | "exemplarMaps">;
};

export type AddedExemplarMap = {
  readonly id: string;
  readonly map: string;
  readonly provenance: ExemplarProvenance;
  /** The Exemplar Maps list written, absolute. */
  readonly file: string;
  /** The source map found, absolute. */
  readonly source: string;
};

/**
 * Records an Exemplar Map in the active Style Pack's Exemplar Maps list: its id, its source map
 * and its provenance. Refused, before anything is written, when the Workspace's Style Pack isn't
 * a local folder, the id is taken, or the source map isn't there.
 */
export async function addExemplarMap(workspace: Workspace, { id, map, provenance, note, machine }: AddExemplarMapOptions): Promise<AddedExemplarMap> {
  const configPath = path.join(workspace.root, WORKSPACE_FILE);
  if (!workspace.stylePack) throw new Error(`The Workspace names no Style Pack (stylePack in ${configPath}): scaffold one with scaffold_style_pack first`);
  const plugin = workspace.registry.plugins.find((p) => p.name === workspace.stylePack);
  if (!plugin?.folder || !isLocalPluginSource(plugin.source)) {
    throw new Error(`The Workspace's Style Pack ${workspace.stylePack}${plugin ? ` is ${plugin.source},` : " is"} not a folder in the Workspace, so its Exemplar Maps can't be added to here`);
  }
  if (!EXEMPLAR_ID_PATTERN.test(id)) throw new Error(`The Exemplar Map id ${id} isn't valid: letters, digits, dots, hyphens or underscores, starting with a letter or digit`);

  // The list as the registry read and checked it when the Workspace loaded: its path stays inside the pack.
  const file = workspace.registry.contributions("knowledge").find((document) => document.plugin === plugin.name && document.id === "exemplar-maps")?.file;
  if (!file) throw new Error(`The Style Pack ${plugin.name} lists no Exemplar Maps (contributions.exemplarMaps in ${path.join(plugin.folder, MANIFEST_FILE)})`);
  const listed = workspace.registry.contributions("exemplarMaps").filter((exemplar) => exemplar.plugin === plugin.name);
  if (listed.some((exemplar) => exemplar.id === id)) {
    throw new Error(`The Style Pack already has an Exemplar Map ${id} (its Exemplar Maps: ${listed.map((exemplar) => exemplar.id).join(", ")}): give the new map another id; nothing was written`);
  }

  // An absolute map needs no exemplarMaps folder; a relative one is inside it.
  const sources = path.isAbsolute(map) ? undefined : await exemplarSourceFolder(workspace, machine);
  const source = path.resolve(sources ?? "", map);
  if (!existsSync(source)) {
    throw new Error(`No source map ${source} for Exemplar Map ${id}: put the map there${sources ? `, or give its path inside the exemplarMaps folder ${sources}` : ""}; nothing was written`);
  }

  let list: { exemplars: unknown[] };
  try {
    list = JSON.parse(await readFile(file, "utf8")) as { exemplars: unknown[] };
  } catch (error) {
    throw new Error(`Can't read the Style Pack's Exemplar Maps ${file}: ${(error as Error).message}`, { cause: error });
  }
  list.exemplars.push({ id, map, provenance, ...(note ? { note } : {}) });
  await replaceFile(file, `${JSON.stringify(list, null, 2)}\n`);
  return { id, map, provenance, file, source };
}
