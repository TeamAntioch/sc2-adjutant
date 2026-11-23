// How a Cinematic compares with the hand-built cutscene it replaces (ADR-0011's Equivalence Check):
// a rebuild from a shot list never matches the Editor's file keyframe for keyframe (its guids, its
// curves, its folders), so the two are compared by what plays, aspect by aspect, and each aspect
// that differs is a difference the Mod Blueprint names (`file:<path>#<aspect>`) or a bug:
//
//   lines     the conversation lines the scene plays, in order
//   speakers  the model of the actor that says each line
//   voices    the Sound each line plays
//   cameras   the cameras it cuts to, in order, by name
//   timing    when each line starts and each cut lands (within 100 ms), and how long it runs
//   actors    each actor: its model, where it stands at the start (within a thousandth of a cell)
//             and its facing (within a hundredth of a degree); not an Invisible one, a voice
//   anims     the animations each model plays, an Invisible voice's aside
//   lamps     each light: its name and where it is (within a thousandth of a cell)
//   light     the base Lights it switches to, in order
//   sounds    the sounds it plays besides the lines: each Sound, whether it loops and its volume
//             (not when it plays or fades: a set's ambience is a copy a run of its shots)
//   nodes     any other kind of track (a look-at, a follow path, a fade …)
//
// A shot-first file's copies of one actor, one a shot (`s010 raynor`, `s020 raynor`, as Blizzard's
// story cutscenes and core's Cinematics lay them out), are one actor, compared where its first copy
// starts; a lamp's copies (`s010 Key`) are one lamp, and a sound's (`s020 Ambience_Bridge`) one sound.
//
// A node the Editor switched off (enabled="0") plays nothing, so it's left out, with all it holds;
// so is an actor or light tied only to cameras the file doesn't have (its active shots), which no
// shot shows. Actors are compared where they start, and other tracks by their kind alone, so a
// look-at aimed elsewhere or a move later in the scene isn't seen.

import { type CutsceneNode, readCutscene, vectorAttr } from "./read-cutscene.js";
import { LOOP_FOREVER } from "./write-shot-cutscene.js";

/** One aspect in which a cutscene plays differently from the one it replaces. */
export type CutsceneDifference = { readonly aspect: CutsceneAspect; readonly detail: string };

export const CUTSCENE_ASPECTS = ["lines", "speakers", "voices", "cameras", "timing", "actors", "anims", "lamps", "light", "sounds", "nodes"] as const;
export type CutsceneAspect = (typeof CUTSCENE_ASPECTS)[number];

/** The model an actor carrying a line off screen has, as Blizzard's do and a Cinematic's voices. */
const VOICE_MODEL = "Invisible";

/** How far apart two times may be and still be the same moment. */
const SAME_MOMENT_MS = 100;

/**
 * How far apart, on any axis, two positions may be and still be the same place: well above the
 * noise of a position carried through a Set's frame and written to six decimals (about a
 * millionth of a cell), and well below the smallest move that shows, the few hundredths of a cell
 * that lift a z-fighting piece clear (set-checks.ts's samePlaneCells).
 */
const SAME_PLACE_CELLS = 0.001;

/** How far apart two facings may be, in degrees, and still be the same. */
const SAME_FACING_DEGREES = 0.01;

/** Something placed in the scene: what it is, for the author, and where it is, compared within the tolerances above. */
type Placed = { readonly what: string; readonly at: readonly number[]; readonly facing?: number };

/** The tracks the other aspects cover, and the nodes that only hold or group them. */
const COVERED = new Set([
  "Director",
  "Folder",
  "Actor",
  "AnimLayer",
  "Camera",
  "ActiveCamera",
  "ActiveShot",
  "Bookmark",
  "Conversation",
  "ConversationDriver",
  "Light",
  "ActiveLight",
  "Sound",
]);

/** What a cutscene plays, as the aspects compare it. */
type Played = {
  readonly lines: readonly { readonly id: string; readonly startMs: number }[];
  readonly speakers: ReadonlyMap<string, string>;
  readonly voices: ReadonlyMap<string, string>;
  readonly cuts: readonly { readonly camera: string; readonly startMs: number }[];
  readonly lengthMs: number;
  readonly actors: readonly Placed[];
  readonly anims: ReadonlyMap<string, ReadonlySet<string>>;
  readonly lamps: readonly Placed[];
  readonly lights: readonly string[];
  readonly sounds: readonly string[];
  readonly nodes: ReadonlySet<string>;
};

const fixed = (value: number): string => (Math.round(value * 1000) / 1000 + 0).toFixed(3);
const degrees = (value: number): string => String(Math.round(value * 100) / 100 + 0);
const at = (node: CutsceneNode): readonly number[] => vectorAttr(node, "position") ?? [0, 0, 0];
/** `placed` for the author: what it is, where, and which way it faces. */
const shown = (placed: Placed): string => `${placed.what} at ${placed.at.map(fixed).join(",")}${placed.facing === undefined ? "" : ` facing ${degrees(placed.facing)}`}`;
/** Whether two facings, in degrees, are the same however many turns apart they're written. */
const sameFacing = (a: number | undefined, b: number | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  const apart = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return apart <= SAME_FACING_DEGREES;
};
const samePlace = (a: Placed, b: Placed): boolean => a.what === b.what && a.at.every((value, axis) => Math.abs(value - (b.at[axis] ?? 0)) <= SAME_PLACE_CELLS) && sameFacing(a.facing, b.facing);
const startOf = (node: CutsceneNode): number => Number(node.attrs.start ?? 0) || 0;
/** A shot copy's name without its shot's tag (`s010 `, `s010a `): the name its copies share. */
const untagged = (name: string): string => name.replace(/^s\d{3}[a-z]? /, "");
/** One of each copy: the entries of `list` that share a `key`, the earliest by `order` kept. */
const firstCopies = <T>(list: readonly T[], key: (entry: T) => string, order: (entry: T) => number): T[] => {
  const kept = new Map<string, T>();
  for (const entry of [...list].sort((a, b) => order(a) - order(b))) if (!kept.has(key(entry))) kept.set(key(entry), entry);
  return list.filter((entry) => kept.get(key(entry)) === entry);
};
const kind = (node: CutsceneNode): string => node.tag.replace(/^CCutscene(Node|Element)/, "");

/** A sound as it's heard: its Sound, whether it loops, and its volume when it isn't the Editor's 1 (to a hundredth). */
const heard = (node: CutsceneNode): string => {
  const read = Number(node.attrs.volumeScale ?? 1);
  // A volume that isn't a number is compared as written, so it can't pass for silence.
  const volume = Number.isFinite(read) ? Math.round(read * 100) / 100 : node.attrs.volumeScale;
  return `${node.attrs.soundLink ?? ""}${node.attrs.mode === LOOP_FOREVER ? " looped" : ""}${volume === 1 ? "" : ` at ${volume}`}`;
};

/** What `xml` plays: its enabled nodes, read as the aspects compare them. Throws, saying which, when `xml` isn't a cutscene. */
function played(xml: string, which: string): Played {
  let root: CutsceneNode;
  try {
    root = readCutscene(xml);
  } catch (error) {
    throw new Error(`${which} can't be read as a cutscene: ${(error as Error).message}`, { cause: error });
  }
  if (root.tag !== "CutsceneState") throw new Error(`${which} isn't a cutscene: its root is <${root.tag}>, not <CutsceneState>`);
  const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
  const cameraGuids = new Set(all(root).flatMap((node) => (node.tag === "CCutsceneNodeCamera" && node.attrs.guid ? [node.attrs.guid] : [])));
  /** Tied to cameras (active shots), none of them in the file: no shot shows it. */
  const unseen = (node: CutsceneNode): boolean => {
    const ties = node.children.filter((child) => child.tag === "CCutsceneNodeActiveShot");
    return ties.length > 0 && !ties.some((tie) => cameraGuids.has(tie.attrs.cameraGUID ?? ""));
  };
  const enabled: CutsceneNode[] = [];
  const parents = new Map<CutsceneNode, CutsceneNode>();
  const walk = (node: CutsceneNode): void => {
    if (node.attrs.enabled === "0" || ((node.tag === "CCutsceneNodeActor" || node.tag === "CCutsceneNodeLight") && unseen(node))) return;
    enabled.push(node);
    for (const child of node.children) {
      parents.set(child, node);
      walk(child);
    }
  };
  walk(root);
  const actorOf = (node: CutsceneNode): CutsceneNode | undefined => {
    for (let up = parents.get(node); up; up = parents.get(up)) if (up.tag === "CCutsceneNodeActor") return up;
    return undefined;
  };
  const modelOf = (actor: CutsceneNode): string => actor.attrs.modelLink ?? actor.attrs.modelPath?.split(/[\\/]/).pop()?.replace(/\.m3$/i, "") ?? "(no model)";

  const cameras = new Map(enabled.filter((node) => node.tag === "CCutsceneNodeCamera").map((node) => [node.attrs.guid ?? "", node.attrs.name ?? "(unnamed camera)"]));
  const cuts = enabled
    .filter((node) => node.tag === "CCutsceneElementActiveCamera")
    .map((node) => ({ camera: cameras.get(node.attrs.objectGuid ?? "") ?? "(no camera)", startMs: startOf(node) }))
    .sort((a, b) => a.startMs - b.startMs);
  const driven = enabled.filter((node) => node.tag === "CCutsceneElementConversationDriver");
  const conversationOf = (node: CutsceneNode): string => parents.get(node)?.attrs.conversationLink ?? "";
  const lines = driven.map((node) => ({ id: `${conversationOf(node)}/${node.attrs.lineId ?? ""}`, startMs: startOf(node) })).sort((a, b) => a.startMs - b.startMs);
  const speakers = new Map<string, string>();
  const voices = new Map<string, string>();
  for (const node of enabled.filter((found) => found.tag === "CCutsceneElementConversation")) {
    const id = `${node.attrs.conversationLink ?? ""}/${node.attrs.conversationLine ?? ""}`;
    const actor = actorOf(node);
    if (actor) speakers.set(id, modelOf(actor));
    voices.set(id, node.attrs.soundLink ?? "");
  }
  /** When it comes into being: its lifetime's start. */
  const bornAt = (node: CutsceneNode): number => startOf(node.children.find((child) => child.tag === "CCutsceneElementObject") ?? node);
  // An Invisible actor only carries a voice off screen: it stages no one, so its line's speaker is
  // compared and it isn't.
  const staged = (actor: CutsceneNode): boolean => modelOf(actor) !== VOICE_MODEL;
  const actors = firstCopies(
    enabled.filter((node) => node.tag === "CCutsceneNodeActor" && staged(node)),
    (actor) => `${modelOf(actor)}\n${untagged(actor.attrs.name ?? "")}`,
    bornAt,
  );
  const lamps = firstCopies(
    enabled.filter((node) => node.tag === "CCutsceneNodeLight"),
    (lamp) => `${untagged(lamp.attrs.name ?? "")}\n${at(lamp).map(fixed).join(",")}`,
    bornAt,
  );
  const anims = new Map<string, Set<string>>();
  for (const node of enabled.filter((found) => found.tag === "CCutsceneElementAnim")) {
    const actor = actorOf(node);
    if (!actor || !node.attrs.anim || !staged(actor)) continue;
    const model = modelOf(actor);
    anims.set(model, (anims.get(model) ?? new Set()).add(node.attrs.anim));
  }
  const lengthMs = Math.max(0, ...enabled.filter((node) => node.attrs.duration !== undefined).map((node) => startOf(node) + (Number(node.attrs.duration) || 0)));
  return {
    lines,
    speakers,
    voices,
    cuts,
    lengthMs,
    actors: actors.map((actor) => ({ what: modelOf(actor), at: at(actor), facing: vectorAttr(actor, "rotation")?.[2] ?? 0 })),
    anims,
    lamps: lamps.map((node) => ({ what: node.attrs.name ? untagged(node.attrs.name) : "(unnamed light)", at: at(node) })),
    lights: enabled.filter((node) => node.tag === "CCutsceneElementActiveLight").sort((a, b) => startOf(a) - startOf(b)).map((node) => node.attrs.lightID ?? ""),
    // A sound's copies, one a run of shots (`s020 Ambience_Bridge`), are one sound, and its volume
    // curve (a fade) is part of it; two cues of one Sound are two.
    sounds: firstCopies(
      enabled.filter((node) => node.tag === "CCutsceneNodeSound"),
      (sound) => (untagged(sound.attrs.name ?? "") === sound.attrs.name ? sound.attrs.guid ?? "" : `${heard(sound)}\n${untagged(sound.attrs.name ?? "")}`),
      bornAt,
    )
      .map(heard)
      .sort(),
    nodes: new Set(enabled.filter((node) => node.tag.startsWith("CCutsceneNode") && !COVERED.has(kind(node)) && !(node.tag === "CCutsceneNodePropertyValue" && parents.get(node)?.tag === "CCutsceneNodeSound")).map(kind)),
  };
}

/** What `compiled` has that `kept` hasn't, and the other way round, counting repeats, each matched as `same` matches them. */
function addsAndDrops<T>(kept: readonly T[], compiled: readonly T[], rebuilt: string, same: (a: T, b: T) => boolean = (a, b) => a === b, show: (entry: T) => string = String): string | undefined {
  const left = [...kept];
  const adds: T[] = [];
  for (const entry of compiled) {
    const found = left.findIndex((other) => same(other, entry));
    if (found >= 0) left.splice(found, 1);
    else adds.push(entry);
  }
  if (adds.length === 0 && left.length === 0) return undefined;
  return [adds.length ? `${rebuilt} adds ${adds.map(show).join(", ")}` : "", left.length ? `drops ${left.map(show).join(", ")}` : ""].filter(Boolean).join("; ");
}

/** The first few of `items`, and how many more. */
const some = (items: readonly string[], most = 4): string => (items.length > most ? `${items.slice(0, most).join("; ")}; and ${items.length - most} more` : items.join("; "));

/**
 * Each aspect in which `compiled` plays differently from `kept`, the cutscene it replaces; empty
 * when they play the same. `rebuilt` names `compiled` for the author: a Cinematic, or a Set
 * cutscene. Throws when either isn't a cutscene.
 */
export function cutsceneDifferences(kept: string, compiled: string, rebuilt = "the Cinematic"): CutsceneDifference[] {
  const was = played(kept, "The Kept scene");
  const now = played(compiled, rebuilt.replace(/^the/, "The"));
  const out: CutsceneDifference[] = [];
  const add = (aspect: CutsceneAspect, detail: string | undefined): void => void (detail && out.push({ aspect, detail }));
  const list = (items: readonly string[]): string => (items.length ? items.join(", ") : "nothing");

  const keptLines = was.lines.map((line) => line.id);
  const nowLines = now.lines.map((line) => line.id);
  add("lines", keptLines.join("\n") === nowLines.join("\n") ? undefined : `the Kept scene plays ${list(keptLines)}; ${rebuilt} ${list(nowLines)}`);
  const byLine = (aspect: "speakers" | "voices", what: string): void => {
    const ids = [...new Set([...was[aspect].keys(), ...now[aspect].keys()])];
    const changed = ids.filter((id) => was[aspect].get(id) !== now[aspect].get(id)).map((id) => `${id} ${what} ${was[aspect].get(id) ?? "nothing"} in the Kept scene, ${now[aspect].get(id) ?? "nothing"} in ${rebuilt}`);
    add(aspect, changed.length ? some(changed) : undefined);
  };
  byLine("speakers", "is said by");
  byLine("voices", "plays");
  const keptCuts = was.cuts.map((cut) => cut.camera);
  const nowCuts = now.cuts.map((cut) => cut.camera);
  add("cameras", keptCuts.join("\n") === nowCuts.join("\n") ? undefined : `the Kept scene cuts to ${list(keptCuts)}; ${rebuilt} to ${list(nowCuts)}`);

  const moved: string[] = [];
  const nowStart = new Map(now.lines.map((line) => [line.id, line.startMs]));
  for (const line of was.lines) {
    const start = nowStart.get(line.id);
    if (start !== undefined && Math.abs(start - line.startMs) > SAME_MOMENT_MS) moved.push(`${line.id} starts at ${line.startMs} ms in the Kept scene, ${start} ms in ${rebuilt}`);
  }
  if (keptCuts.join("\n") === nowCuts.join("\n")) {
    was.cuts.forEach((cut, index) => {
      const start = now.cuts[index]!.startMs;
      if (Math.abs(start - cut.startMs) > SAME_MOMENT_MS) moved.push(`cut ${index + 1} (${cut.camera}) lands at ${cut.startMs} ms in the Kept scene, ${start} ms in ${rebuilt}`);
    });
  }
  if (Math.abs(was.lengthMs - now.lengthMs) > SAME_MOMENT_MS) moved.push(`it runs ${now.lengthMs} ms, not ${was.lengthMs} ms`);
  add("timing", moved.length ? some(moved) : undefined);

  add("actors", addsAndDrops(was.actors, now.actors, rebuilt, samePlace, shown));
  const models = [...new Set([...was.anims.keys(), ...now.anims.keys()])].sort();
  const animsOf = (anims: ReadonlyMap<string, ReadonlySet<string>>, model: string): string => list([...(anims.get(model) ?? [])].sort());
  const animated = models.filter((model) => animsOf(was.anims, model) !== animsOf(now.anims, model)).map((model) => `${model} plays ${animsOf(was.anims, model)} in the Kept scene, ${animsOf(now.anims, model)} in ${rebuilt}`);
  add("anims", animated.length ? some(animated) : undefined);
  add("lamps", addsAndDrops(was.lamps, now.lamps, rebuilt, samePlace, shown));
  add("light", was.lights.join("\n") === now.lights.join("\n") ? undefined : `the Kept scene's base Lights are ${list(was.lights)}; ${rebuilt}'s ${list(now.lights)}`);
  add("sounds", addsAndDrops(was.sounds, now.sounds, rebuilt));
  add("nodes", addsAndDrops([...was.nodes].sort(), [...now.nodes].sort(), rebuilt));
  return out;
}
