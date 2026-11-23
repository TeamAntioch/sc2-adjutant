// The Scene Chain: the run of Screenplay scenes one cue plays back to back, as the Trigger Scenes and
// Cinematics among them share a skip and a cleanup (ADR 0012). One value says, for each scene, whether
// it hands on to the scene after it, hands back to the Mission, or takes over from a trigger scene
// before it, and which scenes are victory outros; the compile and the trigger-scene checks both ask it.

import { type Cue, type MissionBlueprint, type OutcomeCondition, playsAlone, type ScenePart } from "../domain/mission-blueprint.js";
import { conditionPath, cuePath } from "./cue-triggers.js";

/** A script cue entry, as a cue's run reads it. */
type RunCue = { readonly cue: Cue; readonly scene: number; readonly afterSeconds?: number | undefined; readonly after?: ScenePart | undefined };

/**
 * One entry of a cue's run: the scene it plays, and whether it plays behind another entry (`after`),
 * from a trigger of its own, so it ends the run before it: it hands on to nothing and isn't handed on to.
 */
export type RunEntry = { readonly scene: number; readonly behind: boolean };

/** A cue's run of scenes: the entries it plays at once (no afterSeconds), in cue order. */
export type CueRun = { readonly cue: Cue; readonly entries: readonly RunEntry[] };

/**
 * Each cue's run of scenes, keyed by its cuePath: the model of scenes played back to back on one
 * cue that the compile chains (a Cinematic or trigger scene handing on to the trigger scene straight
 * after it, ADR 0012) and the checks read. A delayed entry plays from a trigger of its own, so it's
 * in no run; one behind another is in it, apart from the entries beside it.
 */
export function cueRuns(cues: readonly RunCue[]): Map<string, CueRun> {
  const runs = new Map<string, { readonly cue: Cue; readonly entries: RunEntry[] }>();
  for (const { cue, scene, afterSeconds, after } of cues) {
    if (afterSeconds !== undefined) continue;
    const key = cuePath(cue);
    if (!runs.has(key)) runs.set(key, { cue, entries: [] });
    runs.get(key)!.entries.push({ scene, behind: after !== undefined });
  }
  return runs;
}

/** Whether a run plays its entries at `at - 1` and `at` back to back: neither plays behind another. */
const backToBack = (entries: readonly RunEntry[], at: number): boolean => at > 0 && at < entries.length && !entries[at - 1]!.behind && !entries[at]!.behind;

/** The scene a run plays straight before its entry at `at`, back to back with it: none for its first, or beside an entry behind another. */
export const sceneStraightBefore = (entries: readonly RunEntry[], at: number): number | undefined => (backToBack(entries, at) ? entries[at - 1]!.scene : undefined);

/** The scene a run plays straight after its entry at `at`, back to back with it: none for its last, or beside an entry behind another. */
export const sceneStraightAfter = (entries: readonly RunEntry[], at: number): number | undefined => (backToBack(entries, at + 1) ? entries[at + 1]!.scene : undefined);

export type AnchorCondition = Extract<OutcomeCondition, { anchorId: string }>;
export type ObjectivesCondition = Extract<OutcomeCondition, { type: "objectivesComplete" }>;

/** Cues that are also outcome conditions (on an anchor, or on Objectives completing), sharing their triggers. */
export const isConditionCue = (cue: Cue): cue is AnchorCondition | ObjectivesCondition =>
  cue.type === "anchorDies" || cue.type === "anchorEntersZone" || cue.type === "anchorCaptured" || cue.type === "objectivesComplete";

export const sameCondition = (a: OutcomeCondition | undefined, b: OutcomeCondition): boolean => a !== undefined && conditionPath(a) === conditionPath(b);

/**
 * The key a victory outro listed by its outcome (no Screenplay scene) has among the trigger scenes,
 * by scene number: no scene is numbered 0. It plays as the last entry of each victory condition's run.
 */
export const OUTCOME_OUTRO = 0;

/** What the chain reads of the Mission's timed trigger scenes: whether each is a victory outro. */
export type TimedScenes = ReadonlyMap<string, { readonly triggerScene: { readonly outro?: unknown } }>;

/** A trigger scene among the Mission's timed ones, by id: throws the helpful message when the caller didn't load it. */
function loaded(timedTriggerScenes: TimedScenes, id: string): { readonly triggerScene: { readonly outro?: unknown } } {
  const timed = timedTriggerScenes.get(id);
  if (!timed) throw new Error(`The trigger scene ${id} wasn't loaded; pass the Mission's timed trigger scenes to buildMissionTriggers`);
  return timed;
}

/** Throws unless every trigger scene the Screenplay lists is among the timed ones. */
export function requireLoaded(blueprint: Pick<MissionBlueprint, "screenplay">, timedTriggerScenes: TimedScenes): void {
  for (const { id } of blueprint.screenplay.script?.triggerScenes ?? []) loaded(timedTriggerScenes, id);
}

/** How a scene plays in its runs, as its playback takes them. */
export type SceneRole = { readonly handsOn: boolean; readonly handsBack: boolean; readonly takesOver: boolean };

export type SceneChain = {
  /** The trigger scenes by Screenplay scene number, with the victory outcome's outro (as `OUTCOME_OUTRO`) last. */
  readonly listed: readonly { readonly id: string; readonly scene: number }[];
  /** The trigger scene listed by the victory outcome, if any. */
  readonly byOutcome: { readonly id: string } | undefined;
  /** Some cue plays the scene straight before a trigger scene, which it hands on to (the outcome's outro included, last on a victory condition's cue). */
  readonly handsOn: (scene: number) => boolean;
  /** The three at once: `handsBack` when it plays last on a cue or alone, `takesOver` when some cue plays it straight after a trigger scene, whose camera save it may keep. */
  readonly role: (scene: number) => SceneRole;
  /** The Screenplay scenes that are victory outros, by the timed trigger scenes' say. */
  readonly outros: (timedTriggerScenes: TimedScenes) => ReadonlySet<number>;
  /**
   * Throws on a victory outro that can't end the game where its cue plays it: a second beside the
   * outcome's, or one whose cue is delayed, after another, off a victory condition, or not last.
   */
  readonly assertOutros: (timedTriggerScenes: TimedScenes) => void;
  /** Throws when the trigger scene listed by the victory outcome isn't a victory outro. */
  readonly assertOutcomeOutro: (timedTriggerScenes: TimedScenes) => void;
};

/**
 * The Scene Chain of a Mission's cues and trigger scenes. Its roles read the Screenplay alone, so the
 * checks ask it without the Mission's timed scenes; its legality rules (`assertOutros`,
 * `assertOutcomeOutro`) read them, and the compile runs each where its other checks need it.
 */
export function sceneChain(blueprint: Pick<MissionBlueprint, "outcomes" | "screenplay">): SceneChain {
  const reference = blueprint.screenplay.script;
  const cues = reference?.cues ?? [];
  const listedTriggerScenes = reference?.triggerScenes ?? [];
  // Chains: a Cinematic or trigger scene and a trigger scene straight after it on one cue share a skip (ADR 0012).
  // An entry after another plays apart, so it ends the run before it (cueRuns).
  const runs = new Map([...cueRuns(cues)].map(([key, { cue, entries }]) => [key, { cue, entries: [...entries] }]));
  // Most play a Screenplay scene, by its number; a victory outro may play the victory outcome instead.
  const byScene = listedTriggerScenes.flatMap(({ id, scene }) => (scene === undefined ? [] : [{ id, scene }]));
  const byOutcome = listedTriggerScenes.find(({ outcome }) => outcome !== undefined);
  const triggerSceneNumbers = new Set([...byScene.map(({ scene }) => scene), ...(byOutcome ? [OUTCOME_OUTRO] : [])]);
  const victoryCue = (cue: Cue): boolean => isConditionCue(cue) && blueprint.outcomes.victory.some((condition) => sameCondition(condition, cue));
  // The victory outcome's outro plays last on every victory condition, so it ends each victory
  // condition cue's run, and the scene before it there hands on to it.
  if (byOutcome) {
    for (const { cue, entries } of runs.values()) {
      if (victoryCue(cue) && entries[entries.length - 1]!.scene !== OUTCOME_OUTRO) entries.push({ scene: OUTCOME_OUTRO, behind: false });
    }
  }
  // Scenes some cue plays straight before a trigger scene hand on to it; the rest of their runs hand
  // back, as a delayed entry's or one after another's, which plays alone, does. Trigger scenes after a trigger scene take over.
  const handsOn = new Set<number>();
  const handsBack = new Set(cues.filter(playsAlone).map(({ scene }) => scene));
  const takesOver = new Set<number>();
  for (const { entries } of runs.values()) {
    entries.forEach(({ scene }, at) => {
      if (triggerSceneNumbers.has(sceneStraightAfter(entries, at) ?? -1)) handsOn.add(scene);
      else handsBack.add(scene);
      if (triggerSceneNumbers.has(scene) && triggerSceneNumbers.has(sceneStraightBefore(entries, at) ?? -1)) takesOver.add(scene);
    });
  }
  // A victory outro ends the game, so it plays only where the victory follows it: last on a victory condition's cue, with no delay.
  const outros = (timedTriggerScenes: TimedScenes): Set<number> => new Set(byScene.filter(({ id }) => loaded(timedTriggerScenes, id).triggerScene.outro !== undefined).map(({ scene }) => scene));
  const assertOutros = (timedTriggerScenes: TimedScenes): void => {
    const outroScenes = outros(timedTriggerScenes);
    // One listed by the victory outcome plays last on every victory condition, so no other outro can.
    if (byOutcome && outroScenes.size > 0) {
      const [scene] = outroScenes;
      const other = byScene.find((entry) => entry.scene === scene)!.id;
      throw new Error(`Trigger scene ${byOutcome.id} plays on the victory outcome, last on every victory condition, so scene ${scene}'s victory outro (${other}) can't end the game too: list one victory outro`);
    }
    for (const { cue, scene, afterSeconds, after } of cues.filter((entry) => outroScenes.has(entry.scene))) {
      const where = `Scene ${scene} is a victory outro, which ends the game`;
      if (afterSeconds !== undefined) throw new Error(`${where}, so its cue plays it with no delay: drop the afterSeconds on its ${cuePath(cue)} cue`);
      if (after !== undefined) throw new Error(`${where}, so its cue plays it at once: drop the after on its ${cuePath(cue)} cue`);
      if (!victoryCue(cue)) {
        const listed = byScene.find((entry) => entry.scene === scene)!.id;
        // The same event armed from a Beat is a condition of its own, which no cue names.
        const waiting = isConditionCue(cue) ? blueprint.outcomes.victory.find((condition) => condition.fromBeat !== undefined && sameCondition({ ...condition, fromBeat: undefined }, cue)) : undefined;
        const fix = waiting
          ? `the victory on it waits for Beat ${waiting.fromBeat} (fromBeat), which a cue can't, so list the outro by its outcome ({ "id": "${listed}", "outcome": "victory" }) in place of its scene`
          : "cue it on one of the Blueprint's victory outcomes";
        throw new Error(`${where}, so it plays on a victory condition, and its ${cuePath(cue)} cue isn't one: ${fix}`);
      }
      // An undelayed cue has its run (cueRuns); a delayed one was refused above.
      const last = runs.get(cuePath(cue))!.entries.at(-1)!.scene;
      if (last !== scene) throw new Error(`${where}, so it plays last on its ${cuePath(cue)} cue: scene ${last} plays after it`);
    }
  };
  const assertOutcomeOutro = (timedTriggerScenes: TimedScenes): void => {
    if (byOutcome && loaded(timedTriggerScenes, byOutcome.id).triggerScene.outro === undefined) {
      throw new Error(`Trigger scene ${byOutcome.id} plays on the victory outcome, so it is a victory outro: give it outro "victory"`);
    }
  };
  return {
    listed: [...byScene, ...(byOutcome ? [{ id: byOutcome.id, scene: OUTCOME_OUTRO }] : [])],
    byOutcome,
    handsOn: (scene) => handsOn.has(scene),
    role: (scene) => ({ handsOn: handsOn.has(scene), handsBack: handsBack.has(scene), takesOver: takesOver.has(scene) }),
    outros,
    assertOutros,
    assertOutcomeOutro,
  };
}
