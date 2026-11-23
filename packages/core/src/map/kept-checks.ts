// Checks over Kept Content (ADR-0010). A broken link in it fails the check wherever it is: a
// conversation line a Kept cutscene or trigger plays that the Screenplay or the package no longer
// has. Craft findings on it are warnings, and each says it's on Kept Content.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { estimateLineMs, type Severity } from "../cutscene/cinematic.js";
import { type CinematicTiming, timingProblems } from "../cutscene/cinematic-checks.js";
import type { CompileRecord } from "../domain/compile-record.js";
import type { Script } from "../script/name-script.js";
import { MAPINFO_MAGIC, mapInfoIntegrityHash } from "../terrain/write-map-info.js";
import { sameList } from "../util/same-list.js";
import {
  CONVERSATION_DATA,
  conversationPartIds,
  CUTSCENES_DIR,
  type CutsceneLineElement,
  cutsceneLineElements,
  gameDataEntries,
  type PackageConversations,
  packageFiles,
  packageFilesBelow,
  readConversations,
  readPackageText as read,
  triggerStringNames,
} from "./kept-package.js";
import { readDependencies } from "./read-dependencies.js";
import { readDocumentHeaderDependencies } from "./read-document-header.js";
import { type MapInfoHashedFields, readMapInfoHashedFields } from "./read-map-info-fields.js";
import { xmlElements } from "./xml-elements.js";

/** One problem in a package's Kept Content: an error when `severity` is absent. `file` is absolute. */
export type KeptContentProblem = { readonly file: string; readonly message: string; readonly severity?: Severity };

export type KeptContentCheck = {
  /** The Mission's own Map Package. */
  readonly mapDir: string;
  readonly record: CompileRecord;
  /** The Mission's Screenplay, named for the map, when it has one. */
  readonly script?: Script;
  /**
   * Its dependencies (`file:Mods\\…` mods), which may hold what Kept Content uses: with a local one
   * not read (missing or packed), sounds and cutscene files aren't judged gone; with the game's,
   * a cutscene file in no folder of the Mission's own may be the game's.
   */
  readonly dependencies?: LocalDependencies;
  /**
   * When the Screenplay's conversation is converted from the package's (map/mission-conversation.ts):
   * the Sound each of its lines plays of its own, by line id, which a Kept cutscene's element for it
   * must link, or it plays the Kept recording of the words the line had.
   */
  readonly ownSounds?: ReadonlyMap<string, string>;
};

/** A conversation line played by Kept Content, what plays it ("The Kept cutscene "Arrival""), and the sounds its elements name themselves. */
type PlayedLine = { readonly conversation: string; readonly line: string; readonly by: string; readonly file: string; readonly soundLinks?: readonly string[] };

/**
 * Why a played line is broken, or undefined when it isn't. The Screenplay is the conversation's
 * source when it's that conversation; otherwise the package's own conversation data is.
 */
function brokenLine({ conversation, line }: PlayedLine, { conversations, script, scriptLines }: Context): { readonly why: string; readonly fix: string } | undefined {
  if (script?.conversationId === conversation) {
    return scriptLines.has(`${conversation}/${line}`) ? undefined : { why: "which the Screenplay no longer has", fix: "put the line back, or take it out of" };
  }
  const lines = conversations.get(conversation);
  if (!lines) return { why: `but the package has no conversation ${conversation}`, fix: "point it at a conversation the package has, or take it out of" };
  return lines.has(line) ? undefined : { why: `but the package's conversation ${conversation} has no line ${line}`, fix: "point it at a line the conversation has, or take it out of" };
}

/**
 * A Kept cutscene's timeline, read from its file. The lines are those it plays, each as long as
 * the actor's lip-sync entry for it, else as the estimate from its text. Each Active Camera cut
 * starts a shot, which runs to the next cut, the last to the fade to black (with no cuts, one shot
 * from the start). The fade in is a fade at
 * 0, and the fade to black the last fade when it fades out. It ends at its End Scene marker; with
 * none, it never ends (F1), so it's measured to where its content ends (its last line or cut), not
 * to the Editor's timeline, which its actors' elements span whatever the scene's length.
 */
export function keptCutsceneTiming(xml: string, lines: readonly CutsceneLineElement[], lengthOf: (line: CutsceneLineElement) => number | undefined, textOf: (line: CutsceneLineElement) => string): { readonly timing: CinematicTiming; readonly estimated: number } {
  const num = (value: string | undefined): number => Number(value ?? 0);
  let estimated = 0;
  const timed = lines.map((line) => {
    const known = lengthOf(line);
    if (known === undefined) estimated += 1;
    return { soundId: `${line.conversation}/${line.line}`, startMs: line.start, durationMs: known ?? estimateLineMs(textOf(line)) };
  });
  const cuts = xmlElements(xml, "CCutsceneElementActiveCamera")
    .map(({ attrs }) => num(attrs.start))
    .sort((a, b) => a - b);
  const endScenes = xmlElements(xml, "CCutsceneElementEndScene").map(({ attrs }) => num(attrs.start));
  const endSceneMs = endScenes.length ? Math.min(...endScenes) : undefined;
  const endMs = endSceneMs ?? Math.max(0, ...cuts, ...timed.map((line) => line.startMs + line.durationMs));
  const fades = xmlElements(xml, "CCutsceneElementFade")
    .map(({ attrs }) => ({ start: num(attrs.start), duration: num(attrs.duration), fadeIn: attrs.fadeIn === "1" }))
    .sort((a, b) => a.start - b.start);
  const first = fades[0];
  const last = fades.at(-1);
  const fadeInMs = first?.fadeIn && first.start === 0 ? first.duration : 0;
  const fadeOutMs = last && !last.fadeIn ? last.start : endMs;
  // With no cuts, the camera it starts with holds the whole scene: one shot.
  const shots = (cuts.length ? cuts : [0]).map((startMs, at, all) => ({ startMs, durationMs: (all[at + 1] ?? (fadeOutMs > startMs ? fadeOutMs : endMs)) - startMs }));
  return { timing: { shots, lines: timed, fadeInMs, fadeOutMs, ...(endSceneMs !== undefined ? { endSceneMs } : {}) }, estimated };
}

/** What the checks read once per package. */
type Context = {
  readonly mapDir: string;
  readonly conversations: PackageConversations;
  readonly script: Script | undefined;
  /** The Screenplay's lines' text, by `<conversation>/<line>`. */
  readonly scriptLines: ReadonlyMap<string, string>;
  /** The package's folder and its local dependencies' (Mods on disk), in that order. */
  readonly sources: readonly string[];
  /** Every id each of the package's conversations gives its parts (lines, groups, choices …). */
  readonly partIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether the Mission depends on a mod of the game's (`bnet:`, or one of its own by name), whose files can't be listed. */
  readonly gameMods: boolean;
  /** The sounds the package, its local dependencies and the Screenplay have; undefined when a local dependency can't be read, so a sound can't be judged gone. */
  readonly sounds: ReadonlySet<string> | undefined;
  /** Whether every local dependency was read, so a cutscene file none of the sources has may be gone. */
  readonly allSources: boolean;
  readonly finder: Finder;
  readonly ownSounds: ReadonlyMap<string, string> | undefined;
};

/** A broken played line's problem, with the fix for where it is (`the cutscene in the Cutscene Editor`). */
function lineProblem(played: PlayedLine, context: Context, where: string): KeptContentProblem[] {
  const what = `${played.by} plays ${played.conversation}/${played.line}`;
  const broken = brokenLine(played, context);
  if (broken) return [{ file: played.file, message: `${what}, ${broken.why}: ${broken.fix} ${where}` }];
  // Its sound: the package's line names one, and an actor's entry may too.
  const known = context.sounds;
  if (!known) return [];
  const sounds = new Set([context.conversations.get(played.conversation)?.get(played.line)?.sound, ...(played.soundLinks ?? [])].filter((sound): sound is string => sound !== undefined));
  return [...sounds]
    .filter((sound) => !known.has(sound))
    .map((sound) => ({ file: played.file, message: `${what}, whose sound ${sound} neither the package nor its dependencies have: put the sound back, or point the line at one in the Data Editor` }));
}

/** A Kept cutscene's broken links (errors) and its craft (warnings). */
async function cutsceneProblems(file: string, context: Context): Promise<KeptContentProblem[]> {
  const xml = await read(file);
  const { driven, onActors } = cutsceneLineElements(xml);
  const cutscene = path.basename(file).replace(/\.SC2Cutscene$/i, "");
  const by = `The Kept cutscene "${cutscene}"`;
  const key = (line: CutsceneLineElement): string => `${line.conversation}/${line.line}`;
  // Each line once, whether the driver plays it or an actor's entry does (with no driver, or one
  // the driver doesn't hold): an actor's entry plays its line, so its link is a link too.
  const lines = new Map<string, { conversation: string; line: string; soundLinks: string[] }>();
  for (const element of [...driven, ...onActors]) {
    const entry = lines.get(key(element)) ?? lines.set(key(element), { conversation: element.conversation, line: element.line, soundLinks: [] }).get(key(element))!;
    if (element.soundLink) entry.soundLinks.push(element.soundLink);
  }
  const problems = [...lines.values()].flatMap((line) => lineProblem({ ...line, by, file }, context, "the cutscene in the Cutscene Editor"));
  // A converted line it links by another Sound: the old recording, of the words the line had.
  for (const element of onActors) {
    const own = element.conversation === context.script?.conversationId ? context.ownSounds?.get(element.line) : undefined;
    if (own === undefined || element.soundLink === undefined || element.soundLink === own) continue;
    problems.push({ file, message: `${by} plays ${element.conversation}/${element.line} with the sound ${element.soundLink}, but the line's words changed and it plays ${own} now: compile the Mission, which relinks it` });
  }
  // Its craft, as the cinematic checks see a Cinematic's: warnings, since it predates the rules.
  const played = driven.length ? driven : onActors;
  const lipSync = new Map(onActors.flatMap((line) => (line.durationMs !== undefined ? [[key(line), line.durationMs] as const] : [])));
  // The Screenplay's text for its own conversation, which the next pull or compile follows; the package's otherwise.
  const textOf = (line: CutsceneLineElement): string => context.scriptLines.get(key(line)) ?? context.conversations.get(line.conversation)?.get(line.line)?.text ?? "";
  const { timing, estimated } = keptCutsceneTiming(xml, played, (line) => lipSync.get(key(line)), textOf);
  for (const found of timingProblems(timing, "story", { count: estimated, of: played.length })) {
    problems.push({ file, message: `On Kept Content, the cutscene "${cutscene}": ${found.message}`, severity: found.severity ?? "warning" });
  }
  return problems;
}

const RULE = "//--------------------------------------------------------------------------------------------------";

/** MapScript.galaxy's sections, by the Editor's rule–title–rule headers: each title, and where it starts and ends (the next header). */
function scriptSections(script: string): { readonly title: string; readonly start: number; readonly end: number }[] {
  const headers = [...script.matchAll(new RegExp(`^${RULE}\\r?\\n// ([^\\r\\n]+)\\r?\\n${RULE}\\r?$`, "gm"))];
  return headers.map((header, at) => ({ title: header[1]!, start: header.index!, end: headers[at + 1]?.index ?? script.length }));
}

/**
 * The broken links in Kept Galaxy: all of MapScript.galaxy but the Compiled triggers' sections (by
 * name or by the Galaxy block on the record), which the compile writes. It's read for the
 * conversation lines it plays ("<conversation>|<line>" strings), the whole conversations it runs
 * (ConversationData…("<conversation>", …)) and the cutscene files it plays. What it finds is put to
 * the trigger whose section it's in, else to the section (functions, a Custom Script, …).
 */
async function triggerProblems(context: Context, compiled: { readonly names: ReadonlySet<string>; readonly scriptNames: ReadonlySet<string> }): Promise<KeptContentProblem[]> {
  const file = path.join(context.mapDir, "MapScript.galaxy");
  const script = await read(file);
  const problems: KeptContentProblem[] = [];
  const sections = scriptSections(script);
  // Before the first header is Kept too: the file's own header comment, and whatever the Editor wrote there.
  const parts = [{ title: undefined as string | undefined, start: 0, end: sections[0]?.start ?? script.length }, ...sections];
  const knownConversation = (conversation: string): boolean => context.conversations.has(conversation) || context.script?.conversationId === conversation;
  for (const part of parts) {
    const body = script.slice(part.start, part.end);
    const trigger = part.title?.startsWith("Trigger: ") ? part.title.slice("Trigger: ".length) : undefined;
    if (trigger !== undefined) {
      const scriptName = /\bbool (gt_\w+)_Func\b/.exec(body)?.[1];
      if (compiled.names.has(trigger) || (scriptName !== undefined && compiled.scriptNames.has(scriptName))) continue;
    }
    const by = trigger !== undefined ? `The Kept trigger "${trigger}"` : `Kept Galaxy in MapScript.galaxy${part.title ? ` (its "${part.title}" section)` : ""}`;
    const where = trigger !== undefined ? "the trigger in the Trigger Editor" : "the script in the Trigger Editor";
    // A line: "<conversation>|Line…", or any other id when the conversation is known and none of its parts has it (a group's or a choice's is no line, but no broken link either).
    const lines = new Map<string, { conversation: string; line: string }>();
    for (const [, conversation, line] of body.matchAll(/"([\w.-]+)\|([\w.-]+)"/g)) {
      const isLine = /^Line/.test(line!);
      if (!isLine && !(knownConversation(conversation!) && !context.partIds.get(conversation!)?.has(line!) && !context.scriptLines.has(`${conversation}/${line}`))) continue;
      lines.set(`${conversation}/${line}`, { conversation: conversation!, line: line! });
    }
    for (const line of lines.values()) problems.push(...lineProblem({ ...line, by, file }, context, where));
    // A whole conversation, as the first argument of a ConversationData native.
    for (const conversation of new Set([...body.matchAll(/\bConversationData\w*\(\s*"([\w.-]+)"/g)].map((match) => match[1]!))) {
      if (knownConversation(conversation)) continue;
      problems.push({ file, message: `${by} plays the conversation ${conversation}, but the package has no conversation ${conversation}: point it at a conversation the package has, or take it out of ${where}` });
    }
    // Galaxy doubles each backslash, and a path may use / too; the game finds the file without regard to case.
    for (const cutscene of new Set([...body.matchAll(/"Cutscenes(?:\\\\|\/)([^"]+?\.SC2Cutscene)"/gi)].map((match) => match[1]!.split(/\\\\|\//).filter(Boolean).join("\\")))) {
      if (!context.allSources) continue;
      const found = await cutsceneFound(cutscene, context);
      if (found === "found") continue;
      const named = `${by} plays the cutscene Cutscenes\\${cutscene}, which neither the package nor its dependencies have`;
      if (found === "gone") problems.push({ file, message: `${named}: put it back, or take it out of ${where}` });
      else problems.push({ file, message: `${named}, so it may be one of the game's mods' (the Mission depends on some): if it isn't, put it back, or take it out of ${where}`, severity: "warning" });
    }
  }
  return problems;
}

/**
 * Whether a cutscene file a Kept trigger plays is there: found in a source; gone when it isn't and
 * would sit in a folder a source holds below Cutscenes\ (the author's own, as with assets), or the
 * Mission depends on none of the game's mods; else maybe the game's, whose archives can't be listed.
 */
async function cutsceneFound(cutscene: string, context: Context): Promise<"found" | "gone" | "maybe-game"> {
  const parts = [...CUTSCENES_DIR.split("/"), ...cutscene.split("\\")];
  for (const source of context.sources) if (await context.finder.find(source, parts)) return "found";
  if (!context.gameMods) return "gone";
  if (parts.length > 3) for (const source of context.sources) if (await context.finder.find(source, parts.slice(0, -1))) return "gone";
  return "maybe-game";
}

/** Finds files and folders under a package or mod without regard to case, as the game does, reading each folder once. */
class Finder {
  private readonly listings = new Map<string, Promise<ReadonlyMap<string, string> | undefined>>();

  private listing(dir: string): Promise<ReadonlyMap<string, string> | undefined> {
    let found = this.listings.get(dir);
    if (!found) {
      found = readdir(dir).then(
        (names) => new Map(names.map((name) => [name.toLowerCase(), name])),
        () => undefined,
      );
      this.listings.set(dir, found);
    }
    return found;
  }

  /** The path of `parts` under `root`, each part matched without case; undefined when one is missing. */
  async find(root: string, parts: readonly string[]): Promise<string | undefined> {
    let at = root;
    for (const part of parts) {
      const name = (await this.listing(at))?.get(part.toLowerCase());
      if (name === undefined) return undefined;
      at = path.join(at, name);
    }
    return at;
  }

  async names(dir: string): Promise<readonly string[]> {
    return [...((await this.listing(dir))?.values() ?? [])];
  }
}

/**
 * Whether an asset Kept data points to is gone. It's found when a source has it, or for a model,
 * its numbered variations (<name>_00.m3 …). One that isn't found is gone only when it would sit in
 * a folder a source holds below Assets\<kind>\, the author's own (Assets\Doodads\MyFlag):
 * the game's archives can't be listed, so an asset elsewhere is taken as the game's.
 */
async function assetGone(asset: string, sources: readonly string[], finder: Finder): Promise<boolean> {
  const parts = asset.split(/[\\/]+/).filter(Boolean);
  const folder = parts.slice(0, -1);
  const file = parts.at(-1)!;
  for (const source of sources) if (await finder.find(source, parts)) return false;
  const variations = /\.m3$/i.test(file) ? new RegExp(`^${file.slice(0, -3).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d+\\.m3$`, "i") : undefined;
  let owned = false;
  for (const source of sources) {
    const dir = await finder.find(source, folder);
    if (!dir) continue;
    if (variations && (await finder.names(dir)).some((name) => variations.test(name))) return false;
    if (folder.length >= 3) owned = true;
  }
  return owned;
}

/** The asset files Kept game data points to that are gone: each entry not on the record, in each GameData file the compile doesn't write. */
async function assetProblems(context: Context, record: CompileRecord): Promise<KeptContentProblem[]> {
  const gameData = path.join(context.mapDir, "Base.SC2Data", "GameData");
  const compiledEntries = new Set(record.entries.flatMap((entry) => (entry.kind === "catalog-entry" ? [`${entry.file}:${entry.id}`] : entry.kind === "file" ? [`${entry.path}:`] : [])));
  const { finder } = context;
  const problems: KeptContentProblem[] = [];
  for (const name of await packageFiles(gameData, ".xml")) {
    const where = `Base.SC2Data/GameData/${name}`;
    if (compiledEntries.has(`${where}:`)) continue;
    const file = path.join(gameData, name);
    const xml = await read(file);
    const entries = gameDataEntries(xml);
    for (const [at, entry] of entries.entries()) {
      if (compiledEntries.has(`${where}:${entry.id}`)) continue;
      const body = xml.slice(entry.index, entries[at + 1]?.index ?? xml.length);
      for (const asset of new Set([...body.matchAll(/"(Assets\\[^"]+\.\w+)"/gi)].map((match) => match[1]!))) {
        if (await assetGone(asset, context.sources, finder)) {
          problems.push({ file, message: `${entry.type} ${entry.id} points to ${asset}, which neither the package nor its dependencies have: import it again, or point the entry at another file in the Data Editor` });
        }
      }
    }
  }
  return problems;
}

/**
 * A Mission's dependencies as the checks can read them: the local mods' folders found on disk;
 * those not found (`missing`) and those found packed, as an MPQ file (`packed`), which can't be
 * read; and whether any is the game's (`game`), in its archives.
 */
export type LocalDependencies = { readonly dirs: readonly string[]; readonly missing: readonly string[]; readonly packed: readonly string[]; readonly game: boolean };

/** The game's own mods and campaigns, which a map may list by `file:` alone: they're in its archives, not on disk. */
const GAME_MODS = new Set(["core", "liberty", "swarm", "void", "libertymulti", "swarmmulti", "voidmulti", "novastoryassets", "war3data", "alliedcommanders", "challenges"]);
const isGameMod = (local: string): boolean => {
  const parts = local.split(/[\\/]+/).filter(Boolean);
  if (parts[0]?.toLowerCase() === "campaigns") return true;
  return parts.length === 2 && parts[0]!.toLowerCase() === "mods" && GAME_MODS.has(parts[1]!.toLowerCase().replace(/\.sc2mod$/, ""));
};

/**
 * The dependencies: each `file:` one (`file:Mods\\X.SC2Mod`) under the StarCraft II folder, and
 * theirs in turn, from each one's DocumentInfo. One paired with a `bnet:` name
 * (`bnet:…,file:Mods/NovaStoryAssets.SC2Mod`), or one of the game's own by name, is the game's
 * unless an unpacked copy is on disk. A local one not on disk (or with no StarCraft II folder to
 * look in) is `missing`; one that's a file, not a folder, is `packed`.
 */
export async function localDependencies(dependencies: readonly string[], sc2Path: string | undefined): Promise<LocalDependencies> {
  const finder = new Finder();
  const dirs: string[] = [];
  const missing: string[] = [];
  const packed: string[] = [];
  let game = false;
  const visit = async (list: readonly string[]): Promise<void> => {
    for (const dependency of list) {
      const value = dependency.trim();
      const local = /(?:^|,)file:(.+)$/.exec(value)?.[1];
      const blizzard = value.startsWith("bnet:") || (local !== undefined && isGameMod(local));
      if (!local) {
        if (blizzard) game = true;
        continue;
      }
      const found = sc2Path ? await finder.find(sc2Path, local.split(/[\\/]+/).filter(Boolean)) : undefined;
      if (found && existsSync(path.join(found, "DocumentInfo"))) {
        if (dirs.includes(found)) continue;
        dirs.push(found);
        await visit([...(await read(path.join(found, "DocumentInfo"))).matchAll(/<Value>([^<]*)<\/Value>/g)].map((match) => match[1]!).filter((dep) => /(?:^|,)file:|^bnet:/.test(dep)));
      } else if (blizzard) game = true;
      else if (found && (await stat(found)).isFile()) {
        if (!packed.includes(dependency)) packed.push(dependency);
      } else if (!missing.includes(dependency)) missing.push(dependency);
    }
  };
  await visit(dependencies);
  return { dirs, missing, packed, game };
}

/** The CSound ids in a package's or mod's SoundData. */
const soundIds = async (source: string): Promise<string[]> =>
  gameDataEntries(await read(path.join(source, "Base.SC2Data", "GameData", "SoundData.xml"))).flatMap((entry) => (entry.type === "CSound" ? [entry.id] : []));

/** The problems in the Kept Content of the package at `mapDir`. */
export async function keptContentProblems({ mapDir, record, script, dependencies = { dirs: [], missing: [], packed: [], game: false }, ownSounds }: KeptContentCheck): Promise<KeptContentProblem[]> {
  const compiledFiles = new Set(record.entries.flatMap((entry) => (entry.kind === "file" ? [entry.path] : [])));
  const localized = path.join(mapDir, "enUS.SC2Data", "LocalizedData");
  const triggerNames = triggerStringNames(await read(path.join(localized, "TriggerStrings.txt")));
  // A Compiled trigger by its Galaxy block on the record, or by its name in TriggerStrings.
  const compiledTriggers = {
    names: new Set(record.entries.flatMap((entry) => (entry.kind === "trigger" && triggerNames.has(`Trigger:${entry.id}`) ? [triggerNames.get(`Trigger:${entry.id}`)!] : []))),
    scriptNames: new Set(record.entries.flatMap((entry) => (entry.kind === "galaxy-block" && entry.id.startsWith("trigger:") ? [entry.id.slice("trigger:".length)] : []))),
  };
  const dependencyDirs = dependencies.dirs;
  const allSources = dependencies.missing.length === 0 && dependencies.packed.length === 0;
  const conversationData = await read(path.join(mapDir, CONVERSATION_DATA));
  const context: Context = {
    mapDir,
    conversations: readConversations(conversationData, await read(path.join(localized, "ConversationStrings.txt"))),
    partIds: conversationPartIds(conversationData),
    gameMods: dependencies.game,
    script,
    scriptLines: new Map((script?.scenes ?? []).flatMap((scene) => scene.items.flatMap((item) => (item.kind === "line" ? [[`${script!.conversationId}/${item.lineId}`, item.text] as [string, string]] : [])))),
    sources: [mapDir, ...dependencyDirs],
    sounds: allSources
      ? new Set([...(await Promise.all([mapDir, ...dependencyDirs].map(soundIds))).flat(), ...(script?.scenes ?? []).flatMap((scene) => scene.items.flatMap((item) => (item.kind === "line" ? [item.soundId] : [])))])
      : undefined,
    allSources,
    finder: new Finder(),
    ownSounds,
  };
  const problems: KeptContentProblem[] = [];
  const cutscenes = path.join(mapDir, CUTSCENES_DIR);
  for (const name of await packageFilesBelow(cutscenes, ".SC2Cutscene")) {
    if (!compiledFiles.has(`${CUTSCENES_DIR}/${name}`)) problems.push(...(await cutsceneProblems(path.join(cutscenes, name), context)));
  }
  problems.push(...(await triggerProblems(context, compiledTriggers)), ...(await assetProblems(context, record)));
  return problems;
}

/** The fix for a DocumentHeader whose dependencies aren't DocumentInfo's. */
const HEADER_FIX = "resave it in the Editor, which rewrites the header's list from DocumentInfo, or make the header's list match (the count at byte 0x2C, then each dependency as a C string)";
const listed = (list: readonly string[]): string => (list.length ? list.join(", ") : "none");

/**
 * A package's DocumentHeader against its DocumentInfo (a map's or a mod's). The game resolves
 * dependencies from the header, the Editor from DocumentInfo, and an Editor save rewrites the
 * header from DocumentInfo, so a hand edit or an imported map can leave the two apart. A header
 * dependency DocumentInfo doesn't list and that isn't on disk fails: the game won't launch the map
 * ("mod or map dependencies which are no longer available"). Lists that merely differ warn. One
 * both list that isn't on disk is the dependency checks' (a warning: the mod may be on another
 * machine). A package with no DocumentHeader or no DocumentInfo has nothing to compare.
 */
export async function documentHeaderProblems(packageDir: string, sc2Path: string | undefined): Promise<KeptContentProblem[]> {
  const file = path.join(packageDir, "DocumentHeader");
  if (!existsSync(file) || !existsSync(path.join(packageDir, "DocumentInfo"))) return [];
  let header: string[];
  try {
    header = readDocumentHeaderDependencies(await readFile(file));
  } catch (error) {
    return [{ file, message: `${error instanceof Error ? error.message : String(error)}, so the game can't read the package's dependencies: resave it in the Editor` }];
  }
  const info = await readDependencies(packageDir);
  if (sameList(header, info)) return [];
  const lists = `DocumentHeader lists ${listed(header)}; DocumentInfo lists ${listed(info)}`;
  // The header's own dependencies, looked up together (one Finder); a missing one of theirs isn't this check's.
  const extra = header.filter((dependency) => !info.includes(dependency));
  const missing = sc2Path !== undefined && extra.length ? (await localDependencies(extra, sc2Path)).missing : [];
  const gone = extra.filter((dependency) => missing.includes(dependency));
  if (gone.length) {
    return [{ file, message: `DocumentHeader depends on ${gone.join(", ")}, which DocumentInfo doesn't list and isn't under the StarCraft II folder (${sc2Path}), so the game won't launch it ("dependencies which are no longer available"). ${lists}: ${HEADER_FIX}` }];
  }
  return [{ file, message: `DocumentHeader's dependencies aren't DocumentInfo's, and the game resolves them from the header. ${lists}: ${HEADER_FIX}`, severity: "warning" }];
}

/** The MapInfo version whose integrity hash `mapInfoIntegrityHash` is known to compute: every map read so far, Kept and compiled. */
const HASHED_MAPINFO_VERSION = 39;
const hex = (value: bigint): string => `0x${value.toString(16).toUpperCase()}`;

/**
 * A map's MapInfo whose stored integrity hash (the u64 at byte 8) isn't `mapInfoIntegrityHash` of
 * its own fields: the game refuses the map ("failed to open map"; the Editor logs "Unable to load
 * 'MapInfo'"). A hand edit to its size, description, camera bounds or game options flags (Hide
 * Errors During Test Document is one) changes the hash. Only version 39 is checked, the only
 * version the formula has been confirmed on; a package with no MapInfo has nothing to check.
 */
export async function mapInfoHashProblems(mapDir: string): Promise<KeptContentProblem[]> {
  const file = path.join(mapDir, "MapInfo");
  if (!existsSync(file)) return [];
  const buffer = await readFile(file);
  if (buffer.length < 8 || buffer.toString("ascii", 0, 4) !== MAPINFO_MAGIC) return [{ file, message: `MapInfo has no ${MAPINFO_MAGIC} magic, so the game can't open the map: resave the map in the Editor` }];
  if (buffer.readUInt32LE(4) !== HASHED_MAPINFO_VERSION) return [];
  let fields: MapInfoHashedFields;
  try {
    fields = readMapInfoHashedFields(buffer);
  } catch (error) {
    return [{ file, message: `MapInfo can't be read (${error instanceof Error ? error.message : String(error)}), so the game can't open the map: resave the map in the Editor` }];
  }
  const expected = BigInt.asUintN(64, mapInfoIntegrityHash({ width: fields.width, height: fields.height, descriptionLength: [...fields.description].length, bounds: fields.bounds, gameOptionsFlags: fields.gameOptions }));
  if (expected === fields.integrityHash) return [];
  return [
    {
      file,
      message:
        `MapInfo's integrity hash is ${hex(fields.integrityHash)}, but its fields give ${hex(expected)}, so the game won't open the map ("failed to open map"; the Editor logs "Unable to load 'MapInfo'"). ` +
        `A hand edit to its size, description, camera bounds or game options flags changes the hash: write ${hex(expected)} as the u64 at byte 8, or undo the edit`,
    },
  ];
}
