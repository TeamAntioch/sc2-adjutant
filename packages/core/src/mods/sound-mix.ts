// Sound mixes: several CSounds played as one sound, each from its own time after the mix starts,
// as the actor data of one CActorSound (docs/reference/sound-mixes.md). A CSound's AssetArray plays
// one of its files a time, so it can't layer; a CActorSound's Layers can, each layer its own CSound
// (with its own variations) after its own PlayDelay. Blizzard's co-op data builds layered sounds
// this way (DehakaGlevigBase_UnBurrow_AS, SIMissileTurret_AttackLaunchSound).
//
// A mix is one actor, created with `Create <id>` from the actor of the unit it's for (on its
// death, an attack, a hit). It takes its place from that actor once and lets go of it
// (`RefClear ::Host`, as the game's UnitDeathSound does), so it plays on where the unit was after
// the unit dies. A layer with a stop time can't be one of its Layers, which all end together:
// each such layer is an actor of its own, created with the mix, that stops itself with a timer,
// fading out first if it has a fade.
//
// The main sound of a CActorSound plays at once, so it's the mix's first layer when that starts
// at 0 and has no stop. Otherwise it's a silent CSound, as Blizzard's layered sounds with nothing
// at 0 use Nova_SniperRifleTail_Dummy (Chance 0, -90 dB).

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { FieldStruct } from "../domain/catalog-fields.js";
import { packageEntries, packageName } from "../map/game-packages.js";
import type { Workspace } from "../plugins/workspace.js";
import { schemaProblems } from "./catalog-schema.js";
import { entryXml, type GenericEntry } from "./generic-entries.js";
import { modDir, readWorkspaceModWithBlueprint } from "./workspace-mods.js";

/** Blizzard's silent CSound for a layered actor sound with nothing at 0 (in void.sc2mod). */
export const SILENT_SOUND = "Nova_SniperRifleTail_Dummy";

const ID = /^[A-Za-z_][\w]*$/;
const seconds = z.number().finite().nonnegative();

export const SoundMixLayerSchema = z
  .object({
    /** The CSound this layer plays. */
    sound: z.string().regex(ID, "A CSound id is letters, digits and underscores"),
    /** When it starts, in seconds after the mix is created. */
    at: seconds,
    /** When it stops, in seconds after the mix is created; it plays to its end without one. */
    stop: seconds.optional(),
    /** How long it fades out over from its stop, in seconds; it cuts off without one. */
    fade: seconds.optional(),
  })
  .strict()
  .refine((layer) => layer.stop === undefined || layer.stop > layer.at, { message: "A layer stops after it starts", path: ["stop"] })
  .refine((layer) => layer.fade === undefined || layer.stop !== undefined, { message: "A fade is how a layer stops: give its stop too", path: ["fade"] });

export const SoundMixSchema = z
  .object({
    /** The mix's actor, created with `Create <id>`. A layer with a stop is the actor `<id>_<n>`, n its place in `layers` from 1. */
    id: z.string().regex(ID, "An actor id is letters, digits and underscores"),
    layers: z.array(SoundMixLayerSchema).min(1),
    /** The silent CSound the actor plays as its main sound when no layer can be; Blizzard's by default. */
    silent: z.string().regex(ID).optional(),
  })
  .strict();

export type SoundMixLayer = z.infer<typeof SoundMixLayerSchema>;
export type SoundMix = z.infer<typeof SoundMixSchema>;

/** One mix or a list of them, as a mix file holds them. */
export const SoundMixFileSchema = z.union([SoundMixSchema, z.array(SoundMixSchema).min(1)]).transform((read) => (Array.isArray(read) ? read : [read]));

/** Seconds as Blizzard's actor messages write them. */
const secs = (value: number): string => value.toFixed(6);
/** Seconds as a layer's PlayDelay range (milliseconds, min and max), the same both ends. */
const delay = (value: number): string => {
  const ms = Math.round(value * 1000);
  return `${ms},${ms}`;
};

/** A layer of a CActorSound: its CSound after its delay, at the CSound's own volume and pitch. */
function layerField(layer: SoundMixLayer): FieldStruct {
  return {
    Sound: { value: layer.sound },
    PitchSource: { value: "Sound" },
    PlayDelaySource: { value: "Actor" },
    VolumeSource: { value: "Sound" },
    Chance: { value: 100 },
    PlayDelay: { value: delay(layer.at) },
  };
}

/** A sound actor that takes its creator's place once and keeps it, as the game's UnitDeathSound does. */
function placedSound(id: string, main: string, layers: readonly SoundMixLayer[], on: readonly FieldStruct[]): GenericEntry {
  const fields: FieldStruct = {
    Sound: main,
    ...(layers.length > 0 ? { Layers: layers.map(layerField) } : {}),
    Host: { Subject: "::Creator" },
    SoundFlags: { index: "UpdateVisibility", value: 0 },
    On: [...on, { Terms: "ActorCreation", Send: "RefClear ::Host" }],
  };
  return { catalog: "Actor", class: "CActorSound", id, parent: "SoundOneShot", fields };
}

/** The actor entries that play `mix`: its actor, then one for each layer with a stop. */
export function soundMixEntries(mix: SoundMix): GenericEntry[] {
  const silent = mix.silent ?? SILENT_SOUND;
  const numbered = mix.layers.map((layer, index) => ({ layer, actor: `${mix.id}_${index + 1}` }));
  const stopped = numbered.filter(({ layer }) => layer.stop !== undefined);
  const free = numbered.filter(({ layer }) => layer.stop === undefined).map(({ layer }) => layer);
  // The first free layer at 0 plays as the actor's own sound; every other one is a Layer.
  const first = free.findIndex((layer) => layer.at === 0);
  const main = first === -1 ? silent : free[first]!.sound;
  const layers = free.filter((_, index) => index !== first);
  const out = [placedSound(mix.id, main, layers, stopped.map(({ actor }) => ({ Terms: "ActorCreation", Send: `Create ${actor}` })))];
  for (const { layer, actor } of stopped) {
    const atZero = layer.at === 0;
    const timers: FieldStruct[] = [{ Terms: "ActorCreation", Send: `TimerSet ${secs(layer.stop!)} Stop` }];
    if (layer.fade !== undefined && layer.fade > 0) {
      const ms = Math.round(layer.fade * 1000).toFixed(6);
      timers.push(
        { Terms: "TimerExpired; TimerName Stop", Send: `SoundSetVolume Logarithmic 0.000000@0.000000,-96.000000@${ms}` },
        { Terms: "TimerExpired; TimerName Stop", Send: `TimerSet ${secs(layer.fade)} End` },
        { Terms: "TimerExpired; TimerName End", Send: "Destroy" },
      );
    } else timers.push({ Terms: "TimerExpired; TimerName Stop", Send: "Destroy" });
    out.push(placedSound(actor, atZero ? layer.sound : silent, atZero ? [] : [layer], timers));
  }
  return out;
}

/** `entries` as the elements of an ActorData.xml, for a map's own data. */
export const soundMixXml = (entries: readonly GenericEntry[]): string => entries.map(entryXml).join("\n");

/** The CSound ids defined in a file or folder: a GameData XML file, a JSON file of Generic Entries, or every such file in a folder (a .SC2Map, a .SC2Mod, a Mod Blueprint's entries). */
export async function definedSounds(where: string): Promise<Set<string>> {
  const found = new Set<string>();
  const files = (await stat(where)).isDirectory() ? (await readdir(where, { recursive: true })).map((name) => path.join(where, name)) : [where];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".xml" && ext !== ".json") continue;
    if (!(await stat(file)).isFile()) continue;
    const text = await readFile(file, "utf8");
    if (ext === ".xml") for (const [, id] of text.matchAll(/<CSound\b[^>]*?\bid="([^"]+)"/g)) found.add(id!);
    else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      for (const entry of Array.isArray(parsed) ? parsed : []) {
        if (entry && typeof entry === "object" && (entry as GenericEntry).class === "CSound" && typeof (entry as GenericEntry).id === "string") found.add((entry as GenericEntry).id!);
      }
    }
  }
  return found;
}

/** The CSounds a Workspace's own mods define: in each mod's package, and in its Blueprint's Generic Entries. */
export async function workspaceSounds(workspace: Pick<Workspace, "root" | "mods">): Promise<Set<string>> {
  const found = new Set<string>();
  for (const id of workspace.mods) {
    let read: Awaited<ReturnType<typeof readWorkspaceModWithBlueprint>>;
    try {
      read = await readWorkspaceModWithBlueprint(workspace, id);
    } catch {
      continue;
    }
    const places = [read.mod.modPackage, ...read.blueprint.entries.map((entries) => path.resolve(modDir(workspace, id), entries.source))];
    for (const place of places) if (existsSync(place)) for (const sound of await definedSounds(place)) found.add(sound);
  }
  return found;
}

export type SoundCheck = {
  /** Each CSound the mixes play, and where it's defined: the game's packages that define it, or "own" for one of `own`. */
  readonly found: ReadonlyMap<string, readonly string[]>;
  /** The problems: a CSound defined nowhere (it would play nothing, silently), an entry the game's schema refuses. */
  readonly problems: readonly string[];
};

/**
 * Checks `mixes`: every CSound a layer plays (and the silent one where it's used) is the game's
 * (data/package-entries.json) or one of `own` (the map's or mod's own), and every entry they make
 * passes the game's data schema.
 */
export function checkSoundMixes(mixes: readonly SoundMix[], own: ReadonlySet<string>): SoundCheck {
  const stock = packageEntries().sounds;
  const lower = new Map([...stock.keys(), ...own].map((id) => [id.toLowerCase(), id]));
  const found = new Map<string, readonly string[]>();
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const mix of mixes) {
    if (ids.has(mix.id)) problems.push(`${mix.id}: two mixes have this id`);
    ids.add(mix.id);
    const entries = soundMixEntries(mix);
    const played = new Set(entries.map((entry) => String(entry.fields.Sound)));
    for (const layer of mix.layers) played.add(layer.sound);
    for (const sound of played) {
      if (found.has(sound)) continue;
      if (own.has(sound)) found.set(sound, ["own"]);
      else if (stock.has(sound)) found.set(sound, stock.get(sound)!.map(packageName));
      else {
        const near = lower.get(sound.toLowerCase());
        problems.push(`${mix.id}: no CSound ${sound} in the game's data or the own data given${near ? ` (did you mean ${near}?)` : ""}; it would play nothing`);
      }
    }
    for (const entry of entries) problems.push(...schemaProblems(entry));
  }
  return { found, problems };
}

/** The line to add to the actor of the unit a mix is for: it creates the mix on `terms` (an actor event such as UnitDeath). */
export const soundMixWiring = (mix: Pick<SoundMix, "id">, terms = "UnitDeath"): string => `<On Terms="${terms}" Send="Create ${mix.id}"/>`;
