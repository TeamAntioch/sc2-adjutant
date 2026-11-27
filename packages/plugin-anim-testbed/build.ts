// Builds a test map from a spec: checks every id it uses, then copies the base map to its out
// folder with the runtime script and the spec's data and files (README.md).
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  catalogModelAnims,
  definedSounds,
  gameUnitIds,
  type M3Sequence,
  packageEntries,
  readM3Sequences,
  withCustomScript,
  withCustomScriptInMapScript,
  type Workspace,
  workspaceFor,
  workspaceRootFor,
  workspaceSounds,
  writeMapScript,
} from "@team-antioch/sc2-adjutant/plugin-sdk";

import { ELEMENT_KINDS, type Spec, type SpecElement, type SpecUnit, readSpec } from "./spec.ts";
import { type ElementKey, sectionNames, tuneBankName } from "./tune.ts";

/** The runtime the spec's data is put into. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_PATH = path.join(HERE, path.basename(HERE) === "dist" ? ".." : ".", "runtime", "testbed.galaxy");
export const SCRIPT_ID = "E7710200";
export const INIT_FUNC = "Tb_Init";

/**
 * A bank the map doesn't preload reads as empty at map init, so a tuning saved in one game never
 * came back in the next. The Editor preloads the banks its package's BankList.xml names, and writes
 * that list from the Preload Bank actions (Ntve's BankPreload, which compiles to no statement) when
 * it saves, Test Document's save too. So the map gets both: the list, and a Map Initialization
 * trigger that preloads each bank for player 1.
 */
export function withBankPreloads(triggers: string, banks: readonly string[]): string {
  const id = (n: number) => (0xe7710300 + n).toString(16).toUpperCase();
  const items: string[] = [];
  const elements = [`    <Element Type="Trigger" Id="${id(0)}">`, `        <Event Type="FunctionCall" Id="${id(1)}"/>`];
  banks.forEach((_, i) => elements.push(`        <Action Type="FunctionCall" Id="${id(10 + 3 * i)}"/>`));
  elements.push("    </Element>", `    <Element Type="FunctionCall" Id="${id(1)}">`, '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000120"/>', "    </Element>");
  banks.forEach((bank, i) => {
    const [call, name, player] = [id(10 + 3 * i), id(11 + 3 * i), id(12 + 3 * i)];
    elements.push(
      `    <Element Type="FunctionCall" Id="${call}">`,
      '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="7D278C76"/>',
      `        <Parameter Type="Param" Id="${name}"/>`,
      `        <Parameter Type="Param" Id="${player}"/>`,
      "    </Element>",
      `    <Element Type="Param" Id="${name}">`,
      '        <ParameterDef Type="ParamDef" Library="Ntve" Id="437A2BAF"/>',
      `        <Value>${bank}</Value>`,
      '        <ValueType Type="string"/>',
      "    </Element>",
      `    <Element Type="Param" Id="${player}">`,
      '        <ParameterDef Type="ParamDef" Library="Ntve" Id="6B3940B7"/>',
      "        <Value>1</Value>",
      '        <ValueType Type="int"/>',
      "    </Element>",
    );
  });
  items.push(`        <Item Type="Trigger" Id="${id(0)}"/>`);
  return triggers.replace("    </Root>", `${items.join("\n")}\n    </Root>`).replace("</TriggerData>", `${elements.join("\n")}\n</TriggerData>`);
}

/** The package's BankList.xml: the banks the game preloads for player 1. */
export function bankList(banks: readonly string[]): string {
  return ['<?xml version="1.0" encoding="utf-8"?>', "<BankList>", ...banks.map((b) => `    <Bank Name="${b}" Player="1"/>`), "</BankList>", ""].join("\n");
}
/** The bank a --capture build's tour announces its stops in. */
export const TOUR_BANK = "AnimTestbed";

const KIND_CODE = { anim: 0, sound: 1, effect: 2, actor: 3, kill: 4 } as const;
const ON_CODE = { unit: 0, target: 1, child: 2 } as const;
/** How many of a variation's elements the dialog shows a row for (TB_ROWS); the rest still play. */
export const DIALOG_ROWS = 15;
/** Said of a spelling kept for several units, abilities and actor events, which aren't built yet. */
const NOT_BUILT = "not built yet (#96)";

// AnimPlay flags, and SC2's own animation words beyond what a recorded clip name holds. A word that is
// neither and in no known clip name is likely invented: a clip named "Attack Mega" never played.
const ANIM_FLAGS = new Set(["nonlooping", "playforever", "fullmatch", "clamp", "timeabsolute", "sinusoidal", "randomstarttime", "blendout", "nofallback", "reversed", "evaluatescale", "syncpropertychange", "musthavematch", "noprotectedmatch"]);
const ANIM_WORDS = `stand walk attack spell death dead birth work morph cover ready fidget turn left right start end alternate superior slow fast hit stun portrait talk lookat
channel spin taunt victory ride build cheer dance fly burrow unburrow load unload decay landing liftoff lift land idle cast eat sit sleep wounded exhausted critical damage
small medium large huge single double triple quad one two three four five six seven eight nine ten forward back up down var variation default first second third fourth fifth sixth seventh`.split(/\s+/);

export type Report = { readonly errors: string[]; readonly warnings: string[]; readonly notes: string[] };

export type BuildOptions = {
  /** Validate only: write nothing but the generated script beside where the map would go. */
  readonly check?: boolean;
  /** Include the spec's tour, for a capture. */
  readonly tour?: boolean;
  /** The Workspace, if the caller has it loaded; found from the spec otherwise (none outside a Workspace). */
  readonly workspace?: Workspace | null;
};

export type BuildResult = {
  readonly report: Report;
  /** Where the map goes (written unless `check` or there were errors). */
  readonly outMap: string;
  /** The generated script, written beside the map as <name>.testbed.galaxy. */
  readonly scriptPath: string;
  readonly script?: string;
  readonly name: string;
  /** The bank the map saves its tunings in, for --apply. */
  readonly tuneBank: string;
  readonly built: boolean;
  readonly counts: { readonly units: number; readonly moments: number; readonly variations: number; readonly elements: number; readonly files: number };
};

// ---------------------------------------------------------------------------------------------------
// Elements

export type ElementKind = keyof typeof KIND_CODE;
/** An element as the map plays it: what, where, when. `stop` is -1 for none. */
export type Element = { kind: ElementKind; what: string; on: keyof typeof ON_CODE; child: string; at: number; stop: number; muted: boolean };

const ID_RE = /^[A-Za-z_][\w]*$/;

/**
 * An element of a timeline, or the problem with it: exactly one kind, a time in seconds, a stop only on
 * a sound or an animation and after its time, and `on` where the kind allows it. `unitKeys` are the
 * spec's units, whose keys are kept as `on` values for several units (#96).
 */
export function readElement(el: SpecElement, unitKeys: ReadonlySet<string> = new Set()): { element?: Element; problem?: string } {
  const kinds = ELEMENT_KINDS.filter((k) => el[k] !== undefined);
  if (kinds.includes("order")) return { problem: `"order" is kept for a unit's abilities, ${NOT_BUILT}` };
  if (kinds.length !== 1) return { problem: kinds.length ? `it is ${kinds.join(" and ")}: give one of ${ELEMENT_KINDS.slice(0, 5).join(", ")}` : `it says no kind: give one of ${ELEMENT_KINDS.slice(0, 5).join(", ")}` };
  const kind = kinds[0] as ElementKind;
  if (typeof el.at === "string") return { problem: /^\s*on\s/.test(el.at) ? `at "${el.at}" is kept for actor events, ${NOT_BUILT}` : `at "${el.at}" is not a time: give seconds from Play (strike and land are only shown now)` };
  const at = el.at;
  let stop = -1;
  if (el.stop !== undefined) {
    if (kind !== "sound" && kind !== "anim") return { problem: `a ${kind} has no stop: only a sound (its fade) or an animation (its clear) does` };
    if (el.stop <= at) return { problem: `its stop, ${el.stop}, is not after its time, ${at}` };
    stop = el.stop;
  }
  const on = el.on?.trim() ?? "unit";
  let where: Element["on"] = "unit";
  let child = "";
  if (on === "target") where = "target";
  else if (on !== "unit") {
    if (unitKeys.has(on)) return { problem: `on "${on}", a unit's key, is kept for several units, ${NOT_BUILT}` };
    if (kind !== "actor") return { problem: `on "${on}": only an actor message goes to a child actor` };
    if (!ID_RE.test(on)) return { problem: `on "${on}" is neither unit, target nor an actor id` };
    where = "child";
    child = on;
  }
  if (where === "target" && kind !== "sound" && kind !== "actor") return { problem: `a ${kind} can't go on the target: ${kind === "effect" ? "an effect always goes from the unit at the target" : "it is the unit's"}` };
  const what = kind === "kill" ? "" : String(el[kind]).trim();
  if ((kind === "sound" || kind === "effect") && !ID_RE.test(what)) return { problem: `"${what}" is not a ${kind === "sound" ? "CSound" : "CEffect"} id` };
  return { element: { kind, what, on: where, child, at, stop, muted: el.muted === true } };
}

/** What a variation holds, for its dropdown entry: `[anim + sound + visual]` or a part of it. */
export function variationTags(elements: readonly Element[]): string {
  const tags: string[] = [];
  if (elements.some((e) => e.kind === "anim")) tags.push("anim");
  if (elements.some((e) => e.kind === "sound")) tags.push("sound");
  if (elements.some((e) => e.kind === "effect" || e.kind === "actor" || e.kind === "kill")) tags.push("visual");
  return tags.length ? `[${tags.join(" + ")}]` : "";
}

/** The moments' names in dropdown order: the spec's list, else the order the units first name them. */
export function momentNames(spec: Pick<Spec, "moments" | "units">): { names: string[]; problems: string[] } {
  const named = [...new Set(spec.units.flatMap((u) => Object.keys(u.moments)))];
  if (!spec.moments) return { names: named, problems: [] };
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const name of spec.moments) {
    if (seen.has(name)) problems.push(`moments: "${name}" is listed twice`);
    seen.add(name);
  }
  for (const name of named) if (!seen.has(name)) problems.push(`moments: a unit has moment "${name}", which the list leaves out`);
  return { names: [...seen], problems };
}

// ---------------------------------------------------------------------------------------------------
// Ids the game and the Workspace have

type Family = "actor" | "effect" | "model" | "unit" | "sound";
const family = (cls: string): Family | undefined =>
  cls.startsWith("CActor") ? "actor" : cls.startsWith("CEffect") ? "effect" : ({ CModel: "model", CUnit: "unit", CSound: "sound" } as Record<string, Family>)[cls];

/** Ids of the data the build can read itself: the Workspace's mods, the base map and the spec's own. */
class OwnData {
  readonly ids: Record<Family, Set<string>> = { actor: new Set(), effect: new Set(), model: new Set(), unit: new Set(), sound: new Set() };
  /** CUnit id to the CModel its CActorUnit shows. */
  readonly unitModel = new Map<string, string>();

  add(fam: Family, id: string): void {
    this.ids[fam].add(id);
  }

  scanXml(text: string): void {
    for (const [, cls, id] of text.matchAll(/<(C[A-Za-z]+)\b[^>]*?\bid="([^"]+)"/g)) {
      const fam = family(cls!);
      if (fam) this.add(fam, id!);
    }
    for (const [, attrs, body] of text.matchAll(/<CActorUnit\b([^>]*)>([\s\S]*?)<\/CActorUnit>/g)) {
      const unit = /\bunitName="([^"]+)"/.exec(attrs!) ?? /\bid="([^"]+)"/.exec(attrs!);
      const model = /<Model value="([^"]+)"/.exec(body!);
      if (unit && model && !this.unitModel.has(unit[1]!)) this.unitModel.set(unit[1]!, model[1]!);
    }
  }

  scanEntries(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (!entry || typeof entry !== "object") continue;
      const { class: cls, id } = entry as { class?: unknown; id?: unknown };
      const fam = typeof cls === "string" ? family(cls) : undefined;
      if (fam && typeof id === "string") this.add(fam, id);
    }
  }

  /** The GameData XML of a package folder (.SC2Map, .SC2Mod), or a mod folder's packages and Generic Entries. */
  async scanFolder(folder: string): Promise<void> {
    if (!existsSync(folder)) return;
    for (const name of await readdir(folder, { recursive: true })) {
      const file = path.join(folder, name);
      const parts = name.split(/[\\/]/).map((part) => part.toLowerCase());
      const ext = path.extname(name).toLowerCase();
      if (ext === ".xml" && parts.includes("gamedata")) this.scanXml(await readFile(file, "utf8"));
      else if (ext === ".json" && parts.includes("entries") && (await stat(file)).isFile()) this.scanEntries(await readFile(file, "utf8"));
    }
  }
}

/** A clip set's clips that an AnimPlay's properties pick: each property a word of the clip's name (every word, with FullMatch). */
function animMatches(props: readonly string[], fullMatch: boolean, clips: readonly M3Sequence[]): M3Sequence[] {
  const want = props.map((p) => p.toLowerCase());
  return clips.filter((clip) => {
    const words = clip.name.toLowerCase().split(/\s+/);
    return want.every((w) => words.includes(w)) && (!fullMatch || [...words].sort().join(" ") === [...want].sort().join(" "));
  });
}

// ---------------------------------------------------------------------------------------------------
// Writing

/** A Galaxy string literal. A Galaxy string can't hold a line break, a tab or another control character: the build refuses them first (controlChars). */
const gstr = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Whether `s` holds a character a Galaxy string literal can't. */
const controlChars = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);
const gfix = (n: number): string => {
  const r = Math.round(n * 10000) / 10000;
  return Number.isInteger(r) ? `${r}.0` : String(r);
};
const xesc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CATALOGS: readonly (readonly [string, string])[] = [
  ["CActor", "ActorData.xml"],
  ["CModel", "ModelData.xml"],
  ["CUnit", "UnitData.xml"],
  ["CSoundtrack", "SoundtrackData.xml"],
  ["CSound", "SoundData.xml"],
  ["CEffect", "EffectData.xml"],
  ["CBehavior", "BehaviorData.xml"],
  ["CWeapon", "WeaponData.xml"],
  ["CAbil", "AbilData.xml"],
  ["CButton", "ButtonData.xml"],
  ["CMover", "MoverData.xml"],
  ["CValidator", "ValidatorData.xml"],
  ["CLight", "LightData.xml"],
  ["CTurret", "TurretData.xml"],
];
const catalogFor = (tag: string): string | undefined => CATALOGS.find(([prefix]) => tag.startsWith(prefix))?.[1];

/** A glob of `*`, `?` and `[...]` as a case-blind regex. */
const globRegex = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );

/** Top-level elements of an XML <Catalog> file, as text with their tag. Comments are dropped. */
function catalogElements(xml: string): { elements: { tag: string; text: string }[]; problem?: string } {
  const body = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^>]*\?>/, "");
  const inner = /<Catalog\b[^>]*>([\s\S]*)<\/Catalog>/.exec(body)?.[1] ?? "";
  const out: { tag: string; text: string }[] = [];
  const re = /<([A-Za-z]\w*)\b/g;
  let i = 0;
  while (i < inner.length) {
    re.lastIndex = i;
    const m = re.exec(inner);
    if (!m) break;
    const tag = m[1]!;
    // Find the matching close, counting nested same-tag elements; a self-closed element ends at its "/>".
    const openEnd = inner.indexOf(">", m.index);
    if (inner[openEnd - 1] === "/") {
      out.push({ tag, text: inner.slice(m.index, openEnd + 1) });
      i = openEnd + 1;
      continue;
    }
    let depth = 1;
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
    tagRe.lastIndex = openEnd + 1;
    let end = -1;
    for (let t = tagRe.exec(inner); t; t = tagRe.exec(inner)) {
      if (t[2] === "/") continue;
      depth += t[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    if (end < 0) return { elements: out, problem: `<${tag}> at "${inner.slice(m.index, m.index + 60).split("\n")[0]}" has no closing </${tag}>` };
    out.push({ tag, text: inner.slice(m.index, end) });
    i = end;
  }
  return { elements: out };
}

// ---------------------------------------------------------------------------------------------------
// The build

export async function buildTestbed(specPath: string, options: BuildOptions = {}): Promise<BuildResult> {
  const report: Report = { errors: [], warnings: [], notes: [] };
  const absSpec = path.resolve(specPath);
  const folder = path.dirname(absSpec);
  const read = readSpec(await readFile(absSpec, "utf8"));
  const name0 = path.basename(absSpec, path.extname(absSpec));
  const empty = { units: 0, moments: 0, variations: 0, elements: 0, files: 0 };
  if (!read.spec) {
    report.errors.push(...read.problems);
    return { report, outMap: "", scriptPath: "", name: name0, tuneBank: tuneBankName(name0), built: false, counts: empty };
  }
  const spec: Spec = read.spec;
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") {
      if (controlChars(value)) report.errors.push(`${at}: holds a line break, tab or other control character, which a Galaxy string can't`);
    } else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}.${i}`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k);
  };
  walk(spec, "");
  const roots = Object.fromEntries(Object.entries(spec.roots).map(([k, v]) => [k, v.replace(/^~(?=$|[\\/])/, os.homedir())]));
  /** A spec path: `<root>:path` with a root from `roots`, else relative to the spec. */
  const resolve = (p: string): string => {
    const m = /^([A-Za-z][\w-]*):(?![\\/])(.*)$/.exec(p);
    if (m && Object.hasOwn(roots, m[1]!)) return path.resolve(roots[m[1]!]!, m[2]!);
    return path.resolve(folder, p.replace(/^~(?=$|[\\/])/, os.homedir()));
  };
  const name = spec.name ?? name0;
  const tuneBank = tuneBankName(name);
  const base = resolve(spec.base);
  // By default beside the base map, in its folder's output/: a Mission's Map Package's, which a Workspace's .gitignore keeps out of commits.
  const outMap = spec.out !== undefined ? resolve(spec.out) : path.join(path.dirname(base), "output", `${name}.SC2Map`);
  const scriptPath = path.join(path.dirname(outMap), `${name}.testbed.galaxy`);
  const fail = (message: string): BuildResult => {
    report.errors.push(message);
    return { report, outMap, scriptPath, name, tuneBank, built: false, counts: empty };
  };
  if (!existsSync(path.join(base, "MapInfo"))) return fail(`${base} is not an Editor-saved map folder (no MapInfo)`);
  if (!outMap.split(path.sep).slice(0, -1).includes("output")) return fail(`${outMap} is not inside an output/ folder`);
  const inside = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (inside(base, outMap) || inside(outMap, base)) return fail("the out map can be neither the base map nor inside it, nor hold it");

  // ---- What the game and the Workspace have
  const workspace = options.workspace !== undefined ? options.workspace : workspaceRootFor(absSpec) ? await workspaceFor(absSpec) : null;
  const game = packageEntries();
  const gameUnits = new Set(gameUnitIds());
  const own = new OwnData();
  if (workspace) {
    for (const mod of workspace.mods) await own.scanFolder(path.join(workspace.root, "mods", mod));
    for (const sound of await workspaceSounds(workspace)) own.add("sound", sound);
  }
  await own.scanFolder(path.join(base, "Base.SC2Data"));
  for (const sound of await definedSounds(path.join(base, "Base.SC2Data")).catch(() => new Set<string>())) own.add("sound", sound);
  const anims = workspace ? await catalogModelAnims(workspace.catalog) : await catalogModelAnims({ modelAnimsLayers: [] });
  const vocab = new Set(ANIM_WORDS);
  for (const entry of Object.values(anims)) for (const clip of entry.anims) for (const w of clip.name.toLowerCase().split(/\s+/)) vocab.add(w);
  report.notes.push(
    `game data: ${game.sounds.size} sounds, ${game.models.size} models, ${gameUnits.size} units; own data: ${own.ids.sound.size} sounds, ${own.ids.actor.size} actors, ${own.ids.model.size} models, ${own.ids.unit.size} units; ${Object.keys(anims).length} models with recorded clips`,
  );
  const hasSound = (id: string) => game.sounds.has(id) || own.ids.sound.has(id);
  const hasModel = (id: string) => game.models.has(id) || own.ids.model.has(id);
  const hasUnit = (id: string) => gameUnits.has(id) || own.ids.unit.has(id);

  // ---- The spec's own data
  const frags = new Map<string, string[]>();
  const addFrag = (catalog: string, xml: string) => frags.set(catalog, [...(frags.get(catalog) ?? []), xml]);
  const copies: { from: string; to: string }[] = [];
  /** Actor ids the spec's own data defines: checked strictly, unlike a stock actor, which core can't list. */
  for (const df of spec.data) {
    const p = resolve(df);
    if (!existsSync(p)) {
      report.errors.push(`data file ${df} is missing (${p})`);
      continue;
    }
    const xml = await readFile(p, "utf8");
    if (!/<Catalog\b/.test(xml)) {
      report.errors.push(`data file ${df} has no <Catalog>`);
      continue;
    }
    const { elements, problem } = catalogElements(xml);
    if (problem) report.errors.push(`data file ${df}: ${problem}`);
    for (const el of elements) {
      const catalog = catalogFor(el.tag);
      if (!catalog) {
        report.errors.push(`${df}: no catalog for <${el.tag}>`);
        continue;
      }
      addFrag(catalog, `    ${el.text}\n`);
      own.scanXml(el.text);
    }
  }
  for (const asset of spec.assets) {
    const from = resolve(asset.from);
    if (!existsSync(from)) report.errors.push(`asset ${asset.from} is missing (${from})`);
    else copies.push({ from, to: asset.to.replace(/\\/g, "/") });
  }

  let soundXml = "";
  for (const [id, sound] of Object.entries(spec.sounds)) {
    const from = resolve(sound.from);
    const found = new Map<string, string>();
    if (existsSync(from)) {
      const clashes = new Set<string>();
      for (const rel of await readdir(from, { recursive: true })) {
        const key = path.basename(rel).toLowerCase();
        if (found.has(key)) clashes.add(key);
        else found.set(key, path.join(from, rel));
      }
      for (const key of clashes) if (sound.files.some((pattern) => globRegex(pattern).test(key))) report.errors.push(`sound ${id}: more than one file in ${from} is named ${key}; give "from" the folder that holds the one you mean`);
    } else report.errors.push(`sound ${id}: the folder ${from} is missing`);
    const picked: string[] = [];
    for (const pattern of sound.files) {
      const re = globRegex(pattern);
      const hits = [...found.keys()].filter((key) => re.test(key)).sort();
      if (hits.length === 0) report.errors.push(`sound ${id}: no file matches "${pattern}" in ${from}`);
      for (const hit of hits) if (!picked.includes(hit)) picked.push(hit);
    }
    soundXml += `    <CSound id="${xesc(id)}" parent="${xesc(sound.parent)}">\n`;
    for (const hit of picked) {
      const file = found.get(hit)!;
      // Each CSound's files in a folder of its own, so two CSounds' files of one name don't overwrite each other.
      const to = `Assets/Sounds/${name}/${id}/${path.basename(file)}`;
      copies.push({ from: file, to });
      soundXml += `        <AssetArray File="${xesc(to.replace(/\//g, "\\"))}"/>\n`;
    }
    for (const [field, value] of Object.entries(sound.fields)) soundXml += `        <${field} value="${xesc(String(value))}"/>\n`;
    soundXml += "    </CSound>\n";
    own.add("sound", id);
  }
  if (soundXml) addFrag("SoundData.xml", soundXml);

  // ---- Units: new ones get their files and data; each gets the clips it's checked against
  const clipsOf = new Map<number, M3Sequence[] | undefined>();
  const allTextureDirs = spec.units.flatMap((u) => (u.new ? u.new.textures.map(resolve) : []));
  const keys = new Set<string>();
  const newIds = new Set<string>();
  for (const unit of spec.units) {
    if (keys.has(unit.key)) report.errors.push(`units: the key "${unit.key}" is given twice`);
    keys.add(unit.key);
    if (!unit.new) continue;
    if (newIds.has(unit.new.id)) report.errors.push(`units: two new units have the id "${unit.new.id}"`);
    if (hasUnit(unit.new.id)) report.errors.push(`${unit.key}: the new unit's id "${unit.new.id}" is already a unit of the game or the Workspace; give it an id of its own`);
    newIds.add(unit.new.id);
  }
  for (const [ui, unit] of spec.units.entries()) {
    if (unit.new) {
      const nw = unit.new;
      const model = resolve(nw.model);
      const animFiles = nw.anims.map(resolve);
      const folderRel = `Assets/Models/${nw.id}`;
      const clips: M3Sequence[] = [];
      let readable = true;
      for (const file of [model, ...animFiles]) {
        if (!existsSync(file)) {
          report.errors.push(`${unit.key}: ${file} is missing`);
          readable = false;
          continue;
        }
        try {
          clips.push(...readM3Sequences(new Uint8Array(await readFile(file))));
        } catch (error) {
          report.warnings.push(`${unit.key}: could not read the clips of ${file} (${(error as Error).message}), so its animations are checked word by word`);
          readable = false;
        }
      }
      clipsOf.set(ui, readable ? clips : undefined);
      copies.push({ from: model, to: `${folderRel}/${path.basename(model)}` });
      let required = "";
      for (const file of animFiles) {
        copies.push({ from: file, to: `${folderRel}/${path.basename(file)}` });
        required += `        <RequiredAnims value="${xesc(`${folderRel}/${path.basename(file)}`.replace(/\//g, "\\"))}"/>\n`;
      }
      if (existsSync(model)) {
        const bytes = (await readFile(model)).toString("latin1");
        const named = [...new Set([...bytes.matchAll(/Assets\/Textures\/([\w.-]+\.dds)/gi)].map((m) => m[1]!))].sort();
        // Its own texture folders first, then any other new unit's: models built from the same sources share textures.
        const dirs = [...nw.textures.map(resolve), ...allTextureDirs];
        const missing: string[] = [];
        for (const texture of named) {
          const from = dirs.flatMap((dir) => [path.join(dir, texture), path.join(dir, texture.toLowerCase())]).find((p) => existsSync(p));
          if (from) copies.push({ from, to: `Assets/Textures/${texture}` });
          else missing.push(texture);
        }
        if (missing.length) report.warnings.push(`${unit.key}: ${missing.length} textures the model names are in none of the texture folders, so they must be the game's: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}`);
      }
      const s = nw.scale;
      addFrag(
        "ModelData.xml",
        `    <CModel id="${xesc(nw.id)}" parent="Unit">\n        <Model value="${xesc(`${folderRel}/${path.basename(model)}`.replace(/\//g, "\\"))}"/>\n${required}        <ScaleMin value="${s},${s},${s}"/>\n        <ScaleMax value="${s},${s},${s}"/>\n    </CModel>\n`,
      );
      addFrag(
        "UnitData.xml",
        `    <CUnit id="${xesc(nw.id)}">\n        <LifeStart value="10000"/>\n        <LifeMax value="10000"/>\n        <Speed value="1.75"/>\n        <Sight value="0"/>\n        <FlagArray index="NoPortrait" value="1"/>\n        <Collide index="Ground" value="0"/>\n    </CUnit>\n`,
      );
      addFrag(
        "ActorData.xml",
        `    <CActorUnit id="${xesc(nw.id)}" parent="GenericUnitStandard" unitName="${xesc(nw.id)}">\n        <Model value="${xesc(nw.id)}"/>\n        <BuildModel value="${xesc(nw.id)}"/>\n        <Aliases value="${xesc(nw.alias)}"/>\n    </CActorUnit>\n`,
      );
      for (const fam of ["unit", "actor", "model"] as const) own.add(fam, nw.id);
    } else {
      const id = unit.unit!;
      if (!hasUnit(id)) report.errors.push(`${unit.key}: no CUnit "${id}" in the game or the Workspace`);
      // A stock unit's CModel is usually its own id; a Workspace's actor names it otherwise.
      const modelId = own.unitModel.get(id) ?? id;
      const recorded = anims[modelId];
      clipsOf.set(ui, recorded ? [...recorded.anims] : undefined);
      if (!recorded) report.notes.push(`${unit.key}: ${id}'s clips are not recorded (model ${modelId}), so its animations are checked word by word`);
    }
  }
  const target = spec.target ?? undefined;
  if (target && !hasUnit(target.unit)) report.errors.push(`target: no CUnit "${target.unit}" in the game or the Workspace`);

  // The spec's own actors name site ops and models: check those it can.
  for (const xml of frags.get("ActorData.xml") ?? []) {
    for (const [, ops] of xml.matchAll(/<HostSiteOps\b[^>]*\bOps="([^"]+)"/g)) {
      for (const op of ops!.split(",")) if (op && !own.ids.actor.has(op)) report.warnings.push(`data: site op "${op}" is not one of the Workspace's actors; check it is the game's (core can't list the game's actors)`);
    }
    for (const [, model] of xml.matchAll(/<Model value="([^"]+)"/g)) if (!hasModel(model!)) report.errors.push(`data: actor model "${model}" is not a CModel the game or the spec has`);
  }

  /** Checks an AnimPlay message; returns the length of the first clip it picks, when the clips are known. */
  const checkAnim = (msg: string, where: string, clips: M3Sequence[] | undefined): number | undefined => {
    const w = msg.trim().split(/\s+/);
    if (w[0]?.toLowerCase() !== "animplay") return undefined;
    if (w.length < 3) {
      report.errors.push(`${where}: "${msg}" names no animation (AnimPlay <name> <properties> [flags])`);
      return undefined;
    }
    const props = ANIM_FLAGS.has(w[2]!.toLowerCase().split(",")[0]!) ? [] : w[2]!.split(",").filter(Boolean);
    const fullMatch = (w[3] ?? "").toLowerCase().split(",").includes("fullmatch");
    if (clips) {
      const hits = animMatches(props, fullMatch, clips);
      if (hits.length === 0) {
        report.errors.push(`${where}: "${msg}" matches none of the model's clips (${[...new Set(clips.map((c) => c.name))].sort().join(", ")})`);
        return undefined;
      }
      return hits[0]!.durationMs / 1000;
    }
    for (const p of props) {
      if (!/^[A-Za-z]$|^\d+$/.test(p) && !vocab.has(p.toLowerCase())) report.warnings.push(`${where}: "${p}" in "${msg}" is not one of SC2's animation words (the model's clips aren't known, so it is unchecked)`);
    }
    return undefined;
  };

  // ---- Moments, animations, variations, elements
  const listed = momentNames(spec);
  report.errors.push(...listed.problems);
  const moments = listed.names;
  const momentIndex = new Map(moments.map((name, i) => [name, i]));
  const data: string[] = [];
  for (const [i, name] of moments.entries()) {
    data.push(`    Tb_M(${i}, ${gstr(name)});`);
    if (!spec.units.some((u) => (u.moments[name]?.variations.length ?? 0) > 0)) report.warnings.push(`moment ${name}: no unit has a variation for it`);
  }
  let maxAnims = 1;
  let maxElements = 1;
  let nv = 0;
  let ne = 0;
  /** Each element's Tb_E line, waiting for its bank section, which needs every element's key. */
  const pending: { line: number; call: string; key: ElementKey }[] = [];
  for (const [ui, unit] of spec.units.entries()) {
    const clips = clipsOf.get(ui);
    if (unit.idle) checkAnim(unit.idle, `${unit.key} idle`, clips);
    const unitId = unit.new?.id ?? unit.unit!;
    data.push(`    Tb_U(${ui}, ${gstr(unit.key)}, ${gstr(unitId)}, ${gfix(unit.reach)}, ${gstr(unit.idle ?? "")}, ${gfix(unit.respawn)});`);
    const animNames = Object.keys(unit.animations);
    maxAnims = Math.max(maxAnims, animNames.length);
    for (const [ai, [name, anim]] of Object.entries(unit.animations).entries()) {
      const secs = checkAnim(anim.play, `${unit.key} animation "${name}"`, clips);
      const land = anim.land ?? anim.strike;
      const length = anim.length ?? secs ?? Math.max(land, 0) + 1;
      data.push(`    Tb_A(${ui}, ${ai}, ${gstr(name)}, ${gstr(anim.play)}, ${gfix(anim.strike)}, ${gfix(land)}, ${gfix(length)});`);
    }
    for (const [momentName, part] of Object.entries(unit.moments)) {
      const mi = momentIndex.get(momentName);
      if (mi === undefined) continue;
      if (part.variations.filter((v) => v.pick).length > 1) report.warnings.push(`${unit.key} ${momentName}: more than one variation is the pick; the dropdown starts on the last`);
      for (const [vi, variation] of part.variations.entries()) {
        const where = `${unit.key} ${momentName} ${vi + 1}`;
        if (variation.elements.length === 0) report.warnings.push(`${where}: no elements, so Play does nothing`);
        if (variation.elements.length > DIALOG_ROWS) report.warnings.push(`${where}: ${variation.elements.length} elements, and the dialog shows the first ${DIALOG_ROWS}; the rest play but can't be tuned in the game`);
        const elements: Element[] = [];
        for (const [ei, el] of variation.elements.entries()) {
          const at = `${where}, element ${ei + 1}`;
          const { element, problem } = readElement(el, keys);
          if (!element) {
            report.errors.push(`${at}: ${problem}`);
            continue;
          }
          if (element.kind === "anim" && !animNames.includes(element.what)) {
            report.errors.push(`${at}: ${unit.key} has no animation "${element.what}"${animNames.length ? ` (it has ${animNames.join(", ")})` : ""}`);
            continue;
          }
          if (element.kind === "sound" && !hasSound(element.what)) report.errors.push(`${at}: no CSound "${element.what}" in the game or the Workspace`);
          if (element.kind === "effect" && !own.ids.effect.has(element.what)) report.warnings.push(`${at}: "${element.what}" is not one of the spec's or the Workspace's effects; check it is the game's (core can't list the game's effects)`);
          if (element.on === "target" && !target) {
            if (element.kind === "actor") report.errors.push(`${at}: it goes on the target, but the spec has none`);
            else report.notes.push(`${at}: it goes on the target, but the spec has none, so it plays at the point in front of the unit`);
          }
          if (element.kind === "actor") {
            if (element.child && !own.ids.actor.has(element.child)) report.warnings.push(`${at}: the child actor "${element.child}" is not one of the spec's or the Workspace's actors; check it is the game's`);
            const words = element.what.split(/\s+/);
            if (words[0]?.toLowerCase() === "create" && words[1] && !own.ids.actor.has(words[1])) report.warnings.push(`${at}: "${words[1]}" is not one of the spec's or the Workspace's actors; check it is the game's`);
            if (element.on === "unit") checkAnim(element.what, at, clips);
          }
          elements.push(element);
        }
        if (elements.filter((e) => e.kind === "kill").length > 1) report.errors.push(`${where}: more than one kill`);
        const note = variation.note ?? "";
        const label = variation.label ?? (note ? (note.length > 40 ? `${note.slice(0, 40)}…` : note) : elements.map((e) => e.what || e.kind).join(" ").slice(0, 40));
        data.push(`    Tb_V(${ui}, ${mi}, ${gstr(label)}, ${gstr(note)}, ${variation.pick ? "true" : "false"});`);
        nv++;
        maxElements = Math.max(maxElements, elements.length);
        const seen = new Map<string, number>();
        for (const e of elements) {
          const ai = e.kind === "anim" ? animNames.indexOf(e.what) : -1;
          const occurrence = (seen.get(`${e.kind} ${e.what}`) ?? 0) + 1;
          seen.set(`${e.kind} ${e.what}`, occurrence);
          const call = `    Tb_E(${KIND_CODE[e.kind]}, ${gstr(e.what)}, ${ai}, ${ON_CODE[e.on]}, ${gstr(e.child)}, ${gfix(e.at)}, ${gfix(e.stop)}, ${e.muted ? "true" : "false"}, ${occurrence}, `;
          pending.push({ line: data.length, call, key: { unit: unit.key, moment: momentName, variation: vi + 1, kind: e.kind, id: e.what, occurrence } });
          data.push("");
        }
        ne += elements.length;
      }
    }
  }

  const sections = sectionNames(pending.map((p) => p.key));
  for (const [i, p] of pending.entries()) data[p.line] = `${p.call}${gstr(sections[i]!)});`;

  // ---- The tour
  let ntour = 0;
  if (options.tour) {
    if (spec.tour.length === 0) report.errors.push("the spec has no tour to capture");
    for (const [ti, stop] of spec.tour.entries()) {
      const ui = spec.units.findIndex((u) => u.key === stop.unit);
      const mi = momentIndex.get(stop.moment);
      if (ui < 0 || mi === undefined) {
        report.errors.push(`tour stop ${ti + 1}: ${ui < 0 ? `no unit "${stop.unit}"` : `no moment "${stop.moment}"`}`);
        continue;
      }
      const unit = spec.units[ui]!;
      const variations = unit.moments[stop.moment]?.variations ?? [];
      const vi = stop.variation !== undefined ? stop.variation - 1 : Math.max(0, variations.findLastIndex((v) => v.pick));
      if (stop.variation !== undefined && vi >= variations.length) report.errors.push(`tour stop ${ti + 1}: ${unit.key} has no ${stop.moment} variation ${stop.variation}`);
      data.push(`    Tb_T(${ui}, ${mi}, ${variations.length ? vi : -1}, ${gfix(stop.hold)});`);
      ntour++;
    }
  }

  // A file two units name (a shared texture) is copied once.
  const seenTo = new Set<string>();
  for (let i = copies.length - 1; i >= 0; i--) {
    const key = copies[i]!.to.toLowerCase();
    if (seenTo.has(key)) copies.splice(i, 1);
    else seenTo.add(key);
  }
  copies.reverse();
  for (const { from } of copies) if (!existsSync(from)) report.errors.push(`${from} is missing`);

  const stage = spec.stage;
  const consts = [
    `const int TB_NU = ${spec.units.length};`,
    `const int TB_NA = ${maxAnims};`,
    `const int TB_NM = ${Math.max(1, moments.length)};`,
    `const int TB_NV = ${Math.max(1, nv)};`,
    `const int TB_NE = ${Math.max(1, ne)};`,
    `const int TB_NEV = ${maxElements};`,
    `const int TB_NTOUR = ${Math.max(1, ntour)};`,
    `const string TB_TOUR_BANK = ${gstr(TOUR_BANK)};`,
    `const string TB_TUNE_BANK = ${gstr(tuneBank)};`,
    `const fixed TB_X = ${gfix(stage.at[0])};`,
    `const fixed TB_Y = ${gfix(stage.at[1])};`,
    `const fixed TB_GAP = ${gfix(stage.gap)};`,
    `const fixed TB_FACING = ${gfix(stage.facing)};`,
    `const bool TB_FOG = ${stage.fog ? "true" : "false"};`,
    `const fixed TB_CAM_DISTANCE = ${gfix(stage.cameraDistance)};`,
    `const fixed TB_CAM_SHIFT = ${gfix(stage.cameraShift)};`,
    `const int TB_PLAYER = ${stage.player};`,
    `const string TB_TARGET = ${gstr(target?.unit ?? "")};`,
    `const int TB_TARGET_PLAYER = ${target?.player ?? 1};`,
    `const string TB_TITLE = ${gstr(spec.title ?? name)};`,
  ].join("\n");
  const tbData = `void Tb_Data () {\n${data.join("\n")}\n}`;
  const runtime = await readFile(RUNTIME_PATH, "utf8");
  let n1 = 0;
  let n2 = 0;
  // The markers are whole lines; the header comment names them too, so only lines match.
  const script = runtime
    .replace(/^\/\/@@CONSTANTS$/m, () => {
      n1++;
      return `// The spec: ${path.basename(absSpec)}\n${consts}`;
    })
    .replace(/^\/\/@@DATA$/m, () => {
      n2++;
      return tbData;
    })
    .replace(/\n+$/, "");
  if (n1 !== 1 || n2 !== 1) throw new Error(`${RUNTIME_PATH} has lost its //@@CONSTANTS or //@@DATA line`);
  await mkdir(path.dirname(outMap), { recursive: true });
  await writeFile(scriptPath, `${script}\n`);

  // A message repeated (one site op on several actors) is said once.
  for (const list of [report.errors, report.warnings, report.notes]) list.splice(0, list.length, ...new Set(list));
  const counts = { units: spec.units.length, moments: moments.length, variations: nv, elements: ne, files: copies.length };
  if (report.errors.length || options.check) return { report, outMap, scriptPath, script, name, tuneBank, built: false, counts };

  // ---- Write the map
  await rm(outMap, { recursive: true, force: true });
  await cp(base, outMap, { recursive: true });
  await writeFile(path.join(outMap, "Triggers"), withBankPreloads(withCustomScript(undefined, SCRIPT_ID, script, INIT_FUNC), [tuneBank, TOUR_BANK]));
  await writeFile(path.join(outMap, "BankList.xml"), bankList([tuneBank, TOUR_BANK]));
  // Test Document runs MapScript.galaxy as it is, so the script goes there too, in an empty map script.
  const emptyScript = writeMapScript({ mapName: name, triggers: { variables: [], triggers: [] } });
  await writeFile(path.join(outMap, "MapScript.galaxy"), withCustomScriptInMapScript(emptyScript, SCRIPT_ID, script, INIT_FUNC));
  await rm(path.join(outMap, "Base.SC2Data", "TriggerLibs"), { recursive: true, force: true });
  for (const { from, to } of copies) {
    const dest = path.join(outMap, ...to.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(from, dest);
  }
  const gameData = path.join(outMap, "Base.SC2Data", "GameData");
  await mkdir(gameData, { recursive: true });
  for (const [catalog, parts] of frags) {
    const file = path.join(gameData, catalog);
    let xml = existsSync(file) ? await readFile(file, "utf8") : '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n</Catalog>\n';
    xml = xml.replace(/<Catalog\s*\/>/, "<Catalog>\n</Catalog>");
    const at = xml.lastIndexOf("</Catalog>");
    await writeFile(file, `${xml.slice(0, at)}${parts.join("")}${xml.slice(at)}`);
  }
  return { report, outMap, scriptPath, script, name, tuneBank, built: true, counts };
}

/** A build's report as lines for a terminal. */
export function reportLines(result: BuildResult): string[] {
  const { counts, report } = result;
  return [
    `${result.name}: ${counts.units} units, ${counts.moments} moments, ${counts.variations} variations, ${counts.elements} elements, ${counts.files} files to copy`,
    ...report.notes.map((n) => `  ${n}`),
    ...report.warnings.map((w) => `warning: ${w}`),
    ...report.errors.map((e) => `error: ${e}`),
  ];
}

/** The spec's types, for callers. */
export type { SpecElement, SpecUnit };
