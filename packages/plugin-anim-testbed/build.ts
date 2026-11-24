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

import { type SlotKind, type Spec, type SpecUnit, readSpec } from "./spec.ts";

/** The runtime the spec's data is put into. */
export const RUNTIME_PATH = fileURLToPath(new URL(import.meta.url.includes("/dist/") ? "../runtime/testbed.galaxy" : "./runtime/testbed.galaxy", import.meta.url));
export const SCRIPT_ID = "E7710200";
export const INIT_FUNC = "Tb_Init";
/** The bank a --capture build's tour announces its stops in. */
export const TOUR_BANK = "AnimTestbed";

const KIND_CODE: Record<SlotKind, number> = { clip: 0, impact: 1, hit: 2, death: 3, cues: 4 };
const BASE = { start: 0, strike: 1, land: 2 } as const;
const CUE_SOUND = 0;
const CUE_ACTOR = 1;
const CUE_TARGET = 2;

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
  readonly built: boolean;
  readonly counts: { readonly units: number; readonly slots: number; readonly variations: number; readonly cues: number; readonly files: number };
};

// ---------------------------------------------------------------------------------------------------
// Cues and times

type Cue = { kind: number; text: string; child: string; base: number; at: number; stopBase: number; stop: number };

/** '1.2' gives the default base and 1.2; 'strike' (or 'hit') the strike and 0; 'land-0.1' the land and -0.1. */
export function parseTime(text: string, defaultBase: number): { base: number; at: number } | undefined {
  const t = text.replace(/\s+/g, "");
  if (/^-?\d*\.?\d+$/.test(t)) return { base: defaultBase, at: Number(t) };
  const m = /^(start|strike|hit|land)([+-]\d*\.?\d+)?$/.exec(t);
  if (!m) return undefined;
  const name = m[1] === "hit" ? "strike" : (m[1] as keyof typeof BASE);
  return { base: BASE[name], at: Number(m[2] ?? 0) };
}

/** A cue string `<what>[@<when>][~<stop>]`, or a problem with it. */
export function parseCue(cue: string, defaultBase: number): { cue?: Cue; problem?: string } {
  const m = /^(.*?)(?:@([^@~]*))?(?:~([^@~]*))?$/.exec(cue)!;
  const what = m[1]!.trim();
  const at = parseTime(m[2] ?? "0", defaultBase);
  if (!at) return { problem: `"${m[2]}" in "${cue}" is not a time (seconds, strike, land, or strike+0.2)` };
  let stopBase = -1;
  let stop = 0;
  if (m[3] !== undefined) {
    const s = parseTime(m[3], defaultBase);
    if (!s) return { problem: `"${m[3]}" in "${cue}" is not a time (seconds, strike, land, or strike+0.2)` };
    stopBase = s.base;
    stop = s.at;
  }
  const actor = /^(actor|target)(?::(\S+))?\s+(.+)$/.exec(what);
  if (actor) return { cue: { kind: actor[1] === "actor" ? CUE_ACTOR : CUE_TARGET, text: actor[3]!.trim(), child: actor[2] ?? "", base: at.base, at: at.at, stopBase, stop } };
  if (!/^[A-Za-z_][\w]*$/.test(what)) return { problem: `"${cue}" is neither a CSound id nor "actor <message>"` };
  return { cue: { kind: CUE_SOUND, text: what, child: "", base: at.base, at: at.at, stopBase, stop } };
}

// ---------------------------------------------------------------------------------------------------
// Ids the game and the Workspace have

type Family = "actor" | "model" | "unit" | "sound";
const family = (cls: string): Family | undefined => (cls.startsWith("CActor") ? "actor" : ({ CModel: "model", CUnit: "unit", CSound: "sound" } as Record<string, Family>)[cls]);

/** Ids of the data the build can read itself: the Workspace's mods, the base map and the spec's own. */
class OwnData {
  readonly ids: Record<Family, Set<string>> = { actor: new Set(), model: new Set(), unit: new Set(), sound: new Set() };
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

const gstr = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const gfix = (n: number): string => {
  const r = Math.round(n * 10000) / 10000;
  return Number.isInteger(r) ? `${r}.0` : String(r);
};
const xesc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CATALOGS: readonly (readonly [string, string])[] = [
  ["CActor", "ActorData.xml"],
  ["CModel", "ModelData.xml"],
  ["CUnit", "UnitData.xml"],
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
function catalogElements(xml: string): { tag: string; text: string }[] {
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
    if (end < 0) break;
    out.push({ tag, text: inner.slice(m.index, end) });
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The build

export async function buildTestbed(specPath: string, options: BuildOptions = {}): Promise<BuildResult> {
  const report: Report = { errors: [], warnings: [], notes: [] };
  const absSpec = path.resolve(specPath);
  const folder = path.dirname(absSpec);
  const read = readSpec(await readFile(absSpec, "utf8"));
  const name0 = path.basename(absSpec, path.extname(absSpec));
  const empty = { units: 0, slots: 0, variations: 0, cues: 0, files: 0 };
  if (!read.spec) {
    report.errors.push(...read.problems);
    return { report, outMap: "", scriptPath: "", name: name0, built: false, counts: empty };
  }
  const spec: Spec = read.spec;
  const roots = Object.fromEntries(Object.entries(spec.roots).map(([k, v]) => [k, v.replace(/^~(?=$|[\\/])/, os.homedir())]));
  /** A spec path: `<root>:path` with a root from `roots`, else relative to the spec. */
  const resolve = (p: string): string => {
    const m = /^([A-Za-z][\w-]*):(?![\\/])(.*)$/.exec(p);
    if (m && Object.hasOwn(roots, m[1]!)) return path.resolve(roots[m[1]!]!, m[2]!);
    return path.resolve(folder, p.replace(/^~(?=$|[\\/])/, os.homedir()));
  };
  const name = spec.name ?? name0;
  const base = resolve(spec.base);
  const outMap = resolve(spec.out ?? `output/${name}.SC2Map`);
  const scriptPath = path.join(path.dirname(outMap), `${name}.testbed.galaxy`);
  const fail = (message: string): BuildResult => {
    report.errors.push(message);
    return { report, outMap, scriptPath, name, built: false, counts: empty };
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
    for (const el of catalogElements(xml)) {
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
      for (const rel of await readdir(from, { recursive: true })) {
        const key = path.basename(rel).toLowerCase();
        if (!found.has(key)) found.set(key, path.join(from, rel));
      }
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
      const to = `Assets/Sounds/${name}/${path.basename(file)}`;
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

  // ---- Slots, clips, variations, cues
  const slots = Object.entries(spec.slots);
  const slotIndex = new Map(slots.map(([slot, def], i) => [slot, { index: i, kind: def.kind }]));
  const data: string[] = slots.map(([slot, def], i) => `    Tb_S(${i}, ${gstr(slot)}, ${KIND_CODE[def.kind]});`);
  let maxClips = 1;
  let maxCuesVar = 1;
  let nv = 0;
  let nq = 0;
  for (const [ui, unit] of spec.units.entries()) {
    const clips = clipsOf.get(ui);
    for (const field of ["idle", "hit"] as const) if (unit[field]) checkAnim(unit[field]!, `${unit.key} ${field}`, clips);
    const unitId = unit.new?.id ?? unit.unit!;
    data.push(`    Tb_U(${ui}, ${gstr(unit.key)}, ${gstr(unitId)}, ${gfix(unit.reach)}, ${gstr(unit.idle ?? "")}, ${gstr(unit.hit ?? "")}, ${gfix(unit.hitClear)}, ${gfix(unit.respawn)});`);
    maxClips = Math.max(maxClips, unit.clips.length);
    for (const [ci, clip] of unit.clips.entries()) {
      const secs = checkAnim(clip.play, `${unit.key} clip "${clip.name}"`, clips);
      const land = clip.land ?? clip.strike;
      const length = clip.length ?? secs ?? land + 1;
      data.push(`    Tb_C(${ui}, ${ci}, ${gstr(clip.name)}, ${gstr(clip.play)}, ${gfix(clip.strike)}, ${gfix(land)}, ${gfix(length)});`);
    }
    for (const [slot, variations] of Object.entries(unit.variations)) {
      const info = slotIndex.get(slot);
      if (!info) {
        report.errors.push(`${unit.key}: variations for slot "${slot}", which the spec doesn't define`);
        continue;
      }
      const usesClip = info.kind === "clip" || info.kind === "impact";
      if (usesClip && unit.clips.length === 0) report.errors.push(`${unit.key}: slot ${slot} plays the selected clip, but ${unit.key} has no clips`);
      const defaultBase = info.kind === "impact" ? BASE.land : BASE.start;
      if (variations.filter((v) => v.pick).length > 1) report.warnings.push(`${unit.key} ${slot}: more than one variation is the pick; the dropdown starts on the last`);
      for (const [vi, variation] of variations.entries()) {
        const where = `${unit.key} ${slot} ${vi + 1}`;
        const note = variation.note ?? "";
        const label = variation.label ?? (note ? (note.length > 44 ? `${note.slice(0, 44)}…` : note) : variation.cues.join(" ").slice(0, 44));
        data.push(`    Tb_V(${ui}, ${info.index}, ${gstr(label)}, ${gstr(note)}, ${variation.pick ? "true" : "false"});`);
        nv++;
        maxCuesVar = Math.max(maxCuesVar, variation.cues.length);
        for (const text of variation.cues) {
          const { cue, problem } = parseCue(text, defaultBase);
          if (!cue) {
            report.errors.push(`${where}: ${problem}`);
            continue;
          }
          if (!usesClip && (cue.base !== BASE.start || cue.stopBase > BASE.start)) report.warnings.push(`${where}: "${text}" is timed from the clip, but slot ${slot} plays no clip (the selected clip's times are used)`);
          if (cue.kind === CUE_SOUND) {
            if (!hasSound(cue.text)) report.errors.push(`${where}: no CSound "${cue.text}" in the game or the Workspace`);
          } else {
            if (cue.kind === CUE_TARGET && !target) report.errors.push(`${where}: "${text}" goes to the target, but the spec has none`);
            if (cue.child && !own.ids.actor.has(cue.child)) report.warnings.push(`${where}: the child actor "${cue.child}" is not one of the spec's or the Workspace's actors; check it is the game's`);
            const words = cue.text.split(/\s+/);
            if (words[0]?.toLowerCase() === "create" && words[1] && !own.ids.actor.has(words[1])) report.warnings.push(`${where}: "${words[1]}" is not one of the spec's or the Workspace's actors; check it is the game's`);
            if (cue.kind === CUE_ACTOR && !cue.child) checkAnim(cue.text, where, clips);
          }
          data.push(`    Tb_Q(${cue.kind}, ${gstr(cue.text)}, ${gstr(cue.child)}, ${cue.base}, ${gfix(cue.at)}, ${cue.stopBase}, ${gfix(cue.stop)});`);
          nq++;
        }
      }
    }
    if (unit.variations && Object.keys(unit.variations).some((slot) => slotIndex.get(slot)?.kind === "hit") && !unit.hit) report.notes.push(`${unit.key}: it has no hit reaction ("hit"), so its hit slot plays the sounds alone`);
  }

  // ---- The tour
  let ntour = 0;
  if (options.tour) {
    if (spec.tour.length === 0) report.errors.push("the spec has no tour to capture");
    for (const [ti, stop] of spec.tour.entries()) {
      const ui = spec.units.findIndex((u) => u.key === stop.unit);
      const info = slotIndex.get(stop.slot);
      if (ui < 0 || !info) {
        report.errors.push(`tour stop ${ti + 1}: ${ui < 0 ? `no unit "${stop.unit}"` : `no slot "${stop.slot}"`}`);
        continue;
      }
      const unit = spec.units[ui]!;
      const ci = stop.clip === undefined ? 0 : typeof stop.clip === "number" ? stop.clip - 1 : unit.clips.findIndex((c) => c.name === stop.clip);
      if (ci < 0 || (unit.clips.length > 0 && ci >= unit.clips.length)) report.errors.push(`tour stop ${ti + 1}: ${unit.key} has no clip ${String(stop.clip)}`);
      const variations = unit.variations[stop.slot] ?? [];
      const vi = stop.variation !== undefined ? stop.variation - 1 : Math.max(0, variations.findLastIndex((v) => v.pick));
      if (stop.variation !== undefined && vi >= variations.length) report.errors.push(`tour stop ${ti + 1}: ${unit.key} has no ${stop.slot} variation ${stop.variation}`);
      data.push(`    Tb_T(${ui}, ${Math.max(0, ci)}, ${info.index}, ${variations.length ? vi : -1}, ${gfix(stop.hold)});`);
      ntour++;
    }
  }

  for (const { from } of copies) if (!existsSync(from)) report.errors.push(`${from} is missing`);

  const stage = spec.stage;
  const consts = [
    `const int TB_NU = ${spec.units.length};`,
    `const int TB_NC = ${maxClips};`,
    `const int TB_NS = ${Math.max(1, slots.length)};`,
    `const int TB_NV = ${Math.max(1, nv)};`,
    `const int TB_NQ = ${Math.max(1, nq)};`,
    `const int TB_NT = ${maxCuesVar};`,
    `const int TB_NTOUR = ${Math.max(1, ntour)};`,
    `const string TB_TOUR_BANK = ${gstr(TOUR_BANK)};`,
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

  const counts = { units: spec.units.length, slots: slots.length, variations: nv, cues: nq, files: copies.length };
  if (report.errors.length || options.check) return { report, outMap, scriptPath, script, name, built: false, counts };

  // ---- Write the map
  await rm(outMap, { recursive: true, force: true });
  await cp(base, outMap, { recursive: true });
  await writeFile(path.join(outMap, "Triggers"), withCustomScript(undefined, SCRIPT_ID, script, INIT_FUNC));
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
  return { report, outMap, scriptPath, script, name, built: true, counts };
}

/** A build's report as lines for a terminal. */
export function reportLines(result: BuildResult): string[] {
  const { counts, report } = result;
  return [
    `${result.name}: ${counts.units} units, ${counts.slots} slots, ${counts.variations} variations, ${counts.cues} cues, ${counts.files} files to copy`,
    ...report.notes.map((n) => `  ${n}`),
    ...report.warnings.map((w) => `warning: ${w}`),
    ...report.errors.map((e) => `error: ${e}`),
  ];
}

/** The SlotKind type, for callers. */
export type { SlotKind, SpecUnit };
