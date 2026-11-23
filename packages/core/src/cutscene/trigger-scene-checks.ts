// The cinematography skill's trigger-scene checks (CHECKS.md "Trigger scene") that a trigger scene's
// shots, its camera Anchors and its timed lines let us compute. `check-workspace` runs them on each
// trigger scene that compiles, timed by the voice files in the Screenplay's `audioDir`, else by the
// estimate. Each finding names the shot, the check and an edit; all are warnings or review items.

import { DEFAULT_CAMERA_VALUES } from "../map/write-objects-xml.js";
import { playsAlone, type MissionBlueprint } from "../domain/mission-blueprint.js";
import type { CinematicProblem } from "./cinematic.js";
import { sceneChain } from "../triggers/scene-chain.js";
import { openEaseMs } from "../domain/trigger-scene.js";
import { TRIGGER_SCENE_TIMES, type TimedTriggerScene } from "./trigger-scene.js";

/**
 * What the checks read of a Blueprint: its camera Anchors, its Zones' roles, its cues and its victory outcomes (the Scene Chain's). A camera
 * that isn't one of its Anchors is a Kept camera (triggerSceneProblems has found any other), whose
 * values and Zone aren't known, so the checks that need them pass it by.
 */
export type SceneBlueprint = Pick<MissionBlueprint, "anchors" | "zones" | "screenplay" | "outcomes">;

/** CHECKS.md's trigger-scene numbers. */
export const TRIGGER_SCENE_NORMS = {
  /** C1: a wide is gameplay-framed, or at a distance of about 25 or more. */
  wideDistance: 25,
  /** C3: every camera keeps its yaw within 45° of 180, and successive shots turn no more than 45° (past 90° is a deliberate choice). */
  yaw: { facing: 180, maxOffDeg: 45, maxTurnDeg: 45, deliberateTurnDeg: 90 },
  /** C8: the game camera's lens (the Editor writes 27.7995). */
  fov: { deg: 27.8, toleranceDeg: 0.05 },
  /** C9: no depth of field in a gameplay-framed shot (a wide pitched 40 or more, not a low angle), and at most about 0.1 in a closer one. */
  maxCloseDof: 0.1,
  gameplayMinPitch: 40,
  /** C4: moves last 1.5-15 s (Blizzard's median 5 s, n=510), or exactly the line they play under; the camera moves for about half the scene (median 57%). */
  move: { minMs: 1500, maxMs: 15_000 },
  moving: { minShare: 0.2, maxShare: 0.95 },
  /**
   * T4: an intro runs about 35 s (warn over 60), a mid-mission scene about 30 s (warn over 55), a
   * victory outro about 25 s (warn over 45), Blizzard's medians and 90th percentiles; anything over
   * 30 s is reviewed for what could go. A victory outro (`outro: "victory"`), cued or listed by its
   * outcome, plays to `outro`.
   */
  length: { reviewMs: 30_000, intro: { aboutMs: 35_000, warnMs: 60_000 }, midMission: { aboutMs: 30_000, warnMs: 55_000 }, outro: { aboutMs: 25_000, warnMs: 45_000 } },
} as const;

/** T3 and H2's timings, in ms: the fade out at the natural end and after a skip, and the handback (fade in, Cinematic Mode off and the camera's settle, together) after each. */
const HANDBACK_NORMS = { fadeOutMs: 2000, skippedFadeOutMs: 500, handbackMs: 1500, skippedHandbackMs: 1000 } as const;

const HANDBACK_NAMES: Record<keyof typeof HANDBACK_NORMS, string> = {
  fadeOutMs: "fade out at the natural end",
  skippedFadeOutMs: "fade out after a skip",
  handbackMs: "handback after the natural end",
  skippedHandbackMs: "handback after a skip",
};

/**
 * T3 (and H2, since the fade in, Cinematic Mode off and the camera's settle share one duration):
 * how a scene's fades and handback are timed. Every scene is timed by the compiler's template today
 * (TRIGGER_SCENE_TIMES), so these hold by construction; a scene that times its own handback (a
 * no-fade handback, an intended exception) passes its own timings here.
 */
export function handbackTimingChecks(file: string, times: Record<keyof typeof HANDBACK_NORMS, number>): CinematicProblem[] {
  return (Object.keys(HANDBACK_NORMS) as (keyof typeof HANDBACK_NORMS)[]).flatMap((key) =>
    times[key] === HANDBACK_NORMS[key] ? [] : [{ file, message: `T3: its ${HANDBACK_NAMES[key]} runs ${seconds(times[key])}, not T3's ${seconds(HANDBACK_NORMS[key])}: time it to ${seconds(HANDBACK_NORMS[key])}, or record why`, severity: "warning" as const }],
  );
}

/** The lengths of a scene's lines, and the sound IDs of those timed by the estimate (voiceLengthsMs). */
export type LineTiming = { readonly lengths: ReadonlyMap<string, number>; readonly estimated: readonly string[] };

type LengthKind = "intro" | "midMission" | "outro";

/**
 * Which of T4's budgets a scene plays to, and H3's camera: a victory outro's own, cued or listed by
 * its outcome (no `scene`, so no cue, and handsBack is false for it, as it never hands back); an
 * intro when every cue plays it at mission start with no delay; else mid-mission.
 */
function lengthKind(blueprint: SceneBlueprint, timed: TimedTriggerScene): LengthKind {
  if (timed.triggerScene.outro !== undefined) return "outro";
  const cues = (blueprint.screenplay.script?.cues ?? []).filter((cue) => cue.scene === timed.scene);
  return cues.length > 0 && cues.every((entry) => entry.cue.type === "missionStart" && !playsAlone(entry)) ? "intro" : "midMission";
}

/**
 * Whether a scene hands back to the player, as the compile plays it (the Scene Chain's say): the last
 * its cue plays, or one that plays alone (a delay, or after another), where the scene after it is no
 * trigger scene to hand on to. H3 applies to the scene that hands back. A victory outro listed by its
 * outcome has no scene, and never hands back.
 */
function handsBack(blueprint: SceneBlueprint, scene: number | undefined): boolean {
  return scene !== undefined && sceneChain(blueprint).role(scene).handsBack;
}

const KIND_NAMES: Record<LengthKind, string> = { intro: "an intro", midMission: "a mid-mission scene", outro: "a victory outro" };

/** A camera Anchor's values, the default game camera's where it leaves one out (as the compiler writes it). */
type View = { readonly id: string; readonly distance: number; readonly pitch: number; readonly yaw: number; readonly fov: number; readonly dof: number; readonly zoneId: string };

const DEFAULTS = new Map(DEFAULT_CAMERA_VALUES);

/** Each of the Blueprint's camera Anchors' views, by id. */
function viewsOf(blueprint: SceneBlueprint): ReadonlyMap<string, View> {
  return new Map(
    blueprint.anchors
      .filter((anchor) => anchor.kind === "camera")
      .map((anchor) => {
        const own = new Map((anchor.cameraValues ?? []).map(({ index, value }) => [index, value]));
        const value = (index: string): number => own.get(index) ?? DEFAULTS.get(index) ?? 0;
        return [anchor.id, { id: anchor.id, distance: value("Distance"), pitch: value("Pitch"), yaw: value("Yaw"), fov: value("FieldOfView"), dof: value("DepthOfField"), zoneId: anchor.zoneId }];
      }),
  );
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** How far apart two yaws are, 0-180°. */
const turn = (from: number, to: number): number => {
  const apart = (((to - from) % 360) + 360) % 360;
  return Math.min(apart, 360 - apart);
};

/** Every camera the scene uses, each with where it is named: each shot's camera and move, then the handback's. */
function camerasOf(timed: TimedTriggerScene): { readonly id: string; readonly path: string; readonly shot?: number }[] {
  const { shots, handback } = timed.triggerScene;
  return [
    ...shots.flatMap((shot, at) => [{ id: shot.camera, path: `shots.${at}.camera`, shot: at }, ...(shot.to === undefined ? [] : [{ id: shot.to, path: `shots.${at}.to`, shot: at }])]),
    ...(handback?.camera === undefined ? [] : [{ id: handback.camera, path: "handback.camera" }]),
  ];
}

const number = (value: number): string => String(Math.round(value * 10) / 10);

/** The checks' findings on a trigger scene that compiles, timed (timedTriggerScene) by `timing`. */
export function triggerSceneChecks(timed: TimedTriggerScene, blueprint: SceneBlueprint, timing: LineTiming): CinematicProblem[] {
  const { file, triggerScene } = timed;
  const found: CinematicProblem[] = [];
  const views = viewsOf(blueprint);
  const viewOf = (id: string): View | undefined => views.get(id);
  const first = viewOf(triggerScene.shots[0]!.camera);
  if (first && first.distance < TRIGGER_SCENE_NORMS.wideDistance) {
    found.push({ file, path: "shots.0.camera", message: `C1: shot 0 opens on ${first.id} at distance ${number(first.distance)}, closer than a wide (about ${TRIGGER_SCENE_NORMS.wideDistance} or more): open on a wide, or record that the scene is framed on its speakers`, severity: "review" });
  }
  // C3: each camera's yaw, once per Anchor, and the turn at each cut; with each camera's lens and depth of field.
  const { yaw, fov } = TRIGGER_SCENE_NORMS;
  const named = new Set<string>();
  for (const { id, path, shot } of camerasOf(timed)) {
    const view = viewOf(id);
    if (!view || named.has(id)) continue;
    named.add(id);
    const off = turn(view.yaw, yaw.facing);
    const where = shot === undefined ? "The handback camera" : `shot ${shot}'s camera`;
    if (off > yaw.maxOffDeg) found.push({ file, path, message: `C3: ${where} ${id} has a yaw of ${number(view.yaw)}, ${number(off)}° off ${yaw.facing}, past the ${yaw.maxOffDeg}° that keeps screen direction: turn ${id}'s Yaw toward ${yaw.facing}, or record why`, severity: "warning" });
    // C8: the lens stays the game camera's; closer is Distance.
    if (Math.abs(view.fov - fov.deg) > fov.toleranceDeg) found.push({ file, path, message: `C8: ${where} ${id} has a field of view of ${number(view.fov)}, not ${fov.deg}: set ${id}'s FieldOfView to ${fov.deg} and get closer with Distance`, severity: "warning" });
    // C9: depth of field off in gameplay framing, faint in a closer shot.
    if (view.dof > 0 && view.distance >= TRIGGER_SCENE_NORMS.wideDistance && view.pitch >= TRIGGER_SCENE_NORMS.gameplayMinPitch) {
      found.push({ file, path, message: `C9: ${where} ${id} is gameplay-framed (distance ${number(view.distance)}) with depth of field ${number(view.dof)}: set ${id}'s DepthOfField to 0, so the player reads the whole map`, severity: "warning" });
    } else if (view.dof > TRIGGER_SCENE_NORMS.maxCloseDof) {
      found.push({ file, path, message: `C9: ${where} ${id} has depth of field ${number(view.dof)}, over the ${TRIGGER_SCENE_NORMS.maxCloseDof} a closer shot keeps to: set ${id}'s DepthOfField to ${TRIGGER_SCENE_NORMS.maxCloseDof} or less`, severity: "warning" });
    }
  }
  triggerScene.shots.forEach((shot, at) => {
    if (at === 0) return;
    const before = triggerScene.shots[at - 1]!;
    const fromId = before.to ?? before.camera;
    if (fromId === shot.camera) return;
    const from = viewOf(fromId);
    const to = viewOf(shot.camera);
    if (!from || !to) return;
    const turned = turn(from.yaw, to.yaw);
    if (turned <= yaw.maxTurnDeg) return;
    const past = turned > yaw.deliberateTurnDeg ? `past ${yaw.deliberateTurnDeg}°, which is a deliberate choice` : `past the ${yaw.maxTurnDeg}° successive shots keep to`;
    found.push({ file, path: `shots.${at}.camera`, message: `C3: the cut to shot ${at} turns the camera ${number(turned)}°, from ${fromId}'s yaw ${number(from.yaw)} to ${shot.camera}'s ${number(to.yaw)}, ${past}: bring their yaws closer, or record why`, severity: "review" });
  });
  // C7: moves eased, unless a snap is intended.
  triggerScene.shots.forEach((shot, at) => {
    if (shot.move === "linear") found.push({ file, path: `shots.${at}.move`, message: `C7: shot ${at} moves linearly: leave out move to ease it (velocity −1, decelerate 10), or record why a snap is intended`, severity: "review" });
  });
  // C4: each move's length, unless it is exactly the one line it plays under, and the share of the scene the camera moves.
  const { move, moving } = TRIGGER_SCENE_NORMS;
  // Opening with no fade, the first shot's move starts once the ease has reached its camera.
  const ease = openEaseMs(triggerScene) ?? 0;
  const moveMs = (at: number): number => timed.shots[at]!.durationMs - (at === 0 ? ease : 0);
  triggerScene.shots.forEach((shot, at) => {
    if (shot.to === undefined) return;
    const { lines } = timed.shots[at]!;
    const durationMs = moveMs(at);
    if (lines.length === 1 && !shot.pauseAfterMs) return;
    if (durationMs > move.maxMs) found.push({ file, path: `shots.${at}`, message: `C4: shot ${at}'s move runs ${seconds(durationMs)}, over the ${move.maxMs / 1000} s a move keeps to: split it at a line, or hold part of it`, severity: "warning" });
    else if (durationMs < move.minMs) found.push({ file, path: `shots.${at}`, message: `C4: shot ${at}'s move runs ${seconds(durationMs)}, under the ${move.minMs / 1000} s a move keeps to: lengthen it with pauseAfterMs, or cut instead (leave out to)`, severity: "warning" });
  });
  const totalMs = timed.shots.reduce((sum, { durationMs }) => sum + durationMs, 0);
  // The ease is a camera move too.
  const movingMs = ease + timed.shots.reduce((sum, _shot, at) => sum + (triggerScene.shots[at]!.to === undefined ? 0 : moveMs(at)), 0);
  const share = totalMs > 0 ? movingMs / totalMs : 0;
  const percent = `${Math.round(share * 100)}%`;
  if (share < moving.minShare) found.push({ file, message: `C4: the camera moves for ${percent} of the scene, under the about ${moving.minShare * 100}% of a trigger scene: move under a line (give a shot a \`to\`), or record why it holds`, severity: "review" });
  else if (share > moving.maxShare) found.push({ file, message: `C4: the camera moves for ${percent} of the scene, over the about ${moving.maxShare * 100}% of a trigger scene: hold a shot (leave out its to), or record why it never settles`, severity: "review" });
  const kind = lengthKind(blueprint, timed);
  // H3: the handback lands where the player acts: the start at mission start, else their own camera.
  const handback = triggerScene.handback?.camera;
  const zonesOf = (role: string): string[] => blueprint.zones.filter((zone) => zone.role === role).map((zone) => zone.id);
  const inZone = (id: string, zones: readonly string[]): boolean => zones.includes(viewOf(id)?.zoneId ?? "");
  const bases = zonesOf("base");
  // When another scene plays after it on its cue, that one's handback is the player's.
  const lands = handback !== undefined && handsBack(blueprint, timed.scene);
  if (lands && kind === "midMission") {
    found.push({ file, path: "handback.camera", message: `H3: a mid-mission scene hands back on ${handback}, not the player's own camera: leave out handback.camera so the player lands where they were, or record why`, severity: "review" });
  } else if (lands && bases.length > 0 && viewOf(handback) && !inZone(handback, bases)) {
    found.push({ file, path: "handback.camera", message: `H3: the mission-start scene hands back on ${handback}, in ${viewOf(handback)?.zoneId}, not the start: hand back on a camera Anchor in a base Zone (${bases.join(", ")}), or leave out handback.camera for the map's start camera`, severity: "review" });
  }
  // O2: a mission-start scene shows the start (a shot, or the handback) and the goal (a shot), by
  // the Zones its camera Anchors are in. A half isn't judged when one of its cameras is a Kept
  // camera, whose Zone isn't known.
  if (kind === "intro") {
    const shots = camerasOf(timed).filter(({ shot }) => shot !== undefined).map(({ id }) => id);
    const known = (ids: readonly string[]): boolean => ids.every((id) => views.has(id));
    const goals = zonesOf("objective");
    if (bases.length > 0 && handback !== undefined && known([...shots, handback]) && ![...shots, handback].some((id) => inZone(id, bases))) {
      found.push({ file, message: `O2: the mission-start scene never shows the start: cut to a camera Anchor in a base Zone (${bases.join(", ")}), or hand back on one`, severity: "review" });
    }
    if (goals.length > 0 && known(shots) && !shots.some((id) => inZone(id, goals))) {
      found.push({ file, message: `O2: the mission-start scene never shows the goal: cut or move to a camera Anchor in an objective Zone (${goals.join(", ")})`, severity: "review" });
    }
  }
  // T4: its played length, the fade in to the end of the handback (an outro's fade out: it never
  // hands back), against its cue's budget.
  const norm = TRIGGER_SCENE_NORMS.length[kind];
  const lengthMs = totalMs + TRIGGER_SCENE_TIMES.fadeOutMs + (kind === "outro" ? 0 : TRIGGER_SCENE_TIMES.handbackMs);
  const lines = timed.shots.flatMap((shot) => shot.lines);
  const linesMs = lines.reduce((sum, line) => sum + (timing.lengths.get(line.soundId) ?? 0), 0);
  const by = timing.estimated.length ? ` (${timing.estimated.length} of ${lines.length} lines timed by the estimate)` : "";
  const walk = linesMs > norm.aboutMs ? `; its lines alone run ${seconds(linesMs)}, past the about ${norm.aboutMs / 1000} s: walk the author through each line (keep it, move it into play as a transmission or to a later cue, or cut it) and record each decision` : "";
  if (lengthMs > norm.warnMs) found.push({ file, message: `T4: it runs ${seconds(lengthMs)}, over the ${norm.warnMs / 1000} s warning for ${KIND_NAMES[kind]} (about ${norm.aboutMs / 1000} s): review what could go${by}${walk}`, severity: "warning" });
  else if (lengthMs > TRIGGER_SCENE_NORMS.length.reviewMs) found.push({ file, message: `T4: it runs ${seconds(lengthMs)}, over the ${TRIGGER_SCENE_NORMS.length.reviewMs / 1000} s worth reviewing (${KIND_NAMES[kind]} runs about ${norm.aboutMs / 1000} s): review what could go${by}${walk}`, severity: "review" });
  found.push(...handbackTimingChecks(file, TRIGGER_SCENE_TIMES));
  return found;
}
