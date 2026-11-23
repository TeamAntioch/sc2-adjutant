// The map's bounds against what plays inside them (ADR-0015): the Zones units walk inside the
// playable area, and what each Beat uses inside the bounds that hold then. The level-design checker
// runs these as its `bounds` check; the compile reports them too, since beside Kept terrain, where
// the checker doesn't run, they are the only look at a Kept map's bounds.

import { isPlaced, type MissionBlueprint } from "../domain/mission-blueprint.js";
import type { LoadedTriggerScene } from "../cutscene/trigger-scene.js";
import { boxOf, cellsText, distanceOutside, editorBounds, intersect, overhangs, type Rect, rectContains, rectText } from "../map/map-bounds.js";
import { type BeatBounds, beatsDuring, type BoundsPlan, boundsPlan } from "../triggers/beat-bounds.js";
import { beatStart } from "../triggers/beat-start.js";

/**
 * How far past the camera's bounds a unit or point a Beat uses may stand, in cells: the camera aims
 * inside its bounds and shows ground round its aim, and a Kept map's stealth route, which plays,
 * runs up to 7.5 cells past its areas' rectangles.
 */
export const NEAR_CAMERA_BOUNDS = 7.5;
/** How far a camera's aim may sit outside the bounds before it is worth a word: half a cell, for rounding. */
const AIM_SLACK = 0.5;


/** The rectangles that hold during a Beat, against the map's own playable area `map`. */
function activeRects(bounds: BeatBounds, map: Rect): { readonly playable: Rect | undefined; readonly camera: Rect | undefined } {
  const playable = bounds.setsPlayable ? bounds.playable.rect : map;
  return { playable, camera: bounds.camera.kind === "playable" ? playable : bounds.camera.rect };
}

/** Where a camera Anchor aims: its target, else where it stands. */
const aimOf = (anchor: MissionBlueprint["anchors"][number]): { x: number; y: number } | undefined => anchor.cameraTarget ?? anchor.position;

/**
 * What the bounds leave out, in words: Zones that aren't backdrop running past the map's playable
 * area `map`, or a Beat's Zones past the playable area it sets; a Beat's Anchors outside the
 * playable area then, its camera Anchors aiming outside its camera bounds, and its other Anchors
 * too far past them for the camera to show; Waves forming outside the playable area as they start;
 * and, given the loaded trigger scenes, cameras a scene cued on a Beat's start aims outside the
 * bounds then. A rectangle the Blueprint doesn't know (a Kept region's) isn't checked against.
 */
export function boundsFindings(blueprint: MissionBlueprint, map: Rect, triggerScenes: readonly LoadedTriggerScene[] = []): string[] {
  const findings: string[] = [];
  const plan = boundsPlan(blueprint);
  // Ground in the Editor's edge inset is the camera's apron, which a Zone may run into for the
  // camera to see, so a Zone is judged only on its ground inside the inset.
  const inset = editorBounds(blueprint.mapSize.width, blueprint.mapSize.height);
  const judged = (zone: MissionBlueprint["zones"][number]): Rect | undefined => intersect(boxOf([zone.polygon])!, inset);
  for (const zone of blueprint.zones) {
    const box = zone.backdrop ? undefined : judged(zone);
    const past = box ? overhangs(map, box) : [];
    if (past.length > 0) findings.push(`${zone.name} runs ${past.join(", ")} of the playable area ${rectText(map)}: units can't go there, and the edge is an invisible wall across its ground. Pull the Zone in, end it at a cliff or backdrop there, or widen bounds.playable`);
  }
  const anchorById = new Map(blueprint.anchors.map((anchor) => [anchor.id, anchor]));
  // Every placed unit stands inside the playable area the map starts with, Beat or none: one outside is made where it can't move.
  const startPlayable = plan.beats[0] ? (activeRects(plan.beats[0], map).playable ?? map) : map;
  const listed = new Set(blueprint.beats[0]?.anchorIds ?? []);
  for (const anchor of blueprint.anchors) {
    if (anchor.kind !== "unit" || !isPlaced(anchor) || listed.has(anchor.id)) continue;
    const outside = distanceOutside(startPlayable, anchor.position);
    if (outside > 0) findings.push(`${anchor.name} stands ${cellsText(outside)} outside the playable area ${rectText(startPlayable)} the map starts with: it can't move there, and the player can't reach it. Move it in, or widen the playable area`);
  }
  for (const bounds of plan.beats) {
    if (!bounds.starts) continue;
    const beat = blueprint.beats.find((candidate) => candidate.id === bounds.beatId)!;
    const { playable, camera } = activeRects(bounds, map);
    // A transition's wider rectangle too: the game can't bound the camera past the playable area.
    const transition = bounds.transition && "index" in bounds.transition ? bounds.transition.rect : undefined;
    if (transition && playable && !rectContains(playable, transition)) {
      findings.push(`Beat ${beat.id}'s camera transition ${rectText(transition)} reaches ${overhangs(playable, transition).join(", ")} of the playable area ${rectText(playable)} then, so the game holds its pan inside the playable area: open the playable area for the transition, or narrow it`);
    }
    if (beat.camera && camera && playable && !rectContains(playable, camera)) {
      findings.push(`Beat ${beat.id}'s camera bounds ${rectText(camera)} reach ${overhangs(playable, camera).join(", ")} of the playable area ${rectText(playable)} then, and the game keeps the camera inside the playable area: pull them in, or widen the playable area`);
    }
    if (bounds.setsPlayable && playable) {
      for (const zoneId of beat.zoneIds) {
        const zone = blueprint.zones.find((candidate) => candidate.id === zoneId);
        const box = zone && !zone.backdrop ? judged(zone) : undefined;
        const past = box ? overhangs(playable, box) : [];
        if (zone && past.length > 0) findings.push(`Beat ${beat.id} plays in ${zone.name}, which runs ${past.join(", ")} of the playable area ${rectText(playable)} then`);
      }
    }
    for (const anchorId of beat.anchorIds) {
      const anchor = anchorById.get(anchorId);
      if (!anchor || !isPlaced(anchor)) continue;
      const outside = playable ? distanceOutside(playable, anchor.position) : 0;
      if (outside > 0 && anchor.kind !== "camera") {
        const why = anchor.kind === "unit" ? "a unit there can't move, and one created there can't walk in" : "units can't go there";
        findings.push(`Beat ${beat.id} uses ${anchor.name}, ${cellsText(outside)} outside the playable area ${rectText(playable!)} then: ${why}`);
        continue;
      }
      if (!camera) continue;
      // Until a Beat bounds the camera, its bounds are the playable area, which the check above covers for units and points.
      if (anchor.kind === "camera") {
        const aim = aimOf(anchor)!;
        const off = distanceOutside(camera, aim);
        if (off > AIM_SLACK) findings.push(`Beat ${beat.id}'s camera ${anchor.name} aims ${cellsText(off)} outside the camera bounds ${rectText(camera)} then; whether the game holds a camera move to the bounds isn't yet checked in game, so pull the aim in or widen the bounds`);
      } else if (bounds.setsCamera) {
        const off = distanceOutside(camera, anchor.position);
        if (off > NEAR_CAMERA_BOUNDS) findings.push(`Beat ${beat.id} uses ${anchor.name}, ${cellsText(off)} past the camera bounds ${rectText(camera)} then, more than the ${NEAR_CAMERA_BOUNDS} the camera shows past them: the player may not see it`);
      }
    }
  }
  for (const wave of blueprint.waves) {
    const anchor = anchorById.get(wave.spawnAnchorId ?? "");
    if (!anchor || !isPlaced(anchor)) continue;
    // Each Beat the stream sends into, the first where the spawn falls outside its playable area.
    for (const [index, bounds] of beatsDuring(blueprint, wave.startsAtBeat, wave.endsAtBeat).entries()) {
      const { playable } = activeRects(bounds, map);
      const outside = playable ? distanceOutside(playable, anchor.position) : 0;
      if (outside <= 0) continue;
      const when = index === 0 ? "as it starts" : `from Beat ${bounds.beatId}, which it still sends into`;
      findings.push(`Wave ${wave.id} forms at ${anchor.name}, ${cellsText(outside)} outside the playable area ${rectText(playable!)} ${when}: its units are made where they can't walk`);
      break;
    }
  }
  findings.push(...sceneCameraFindings(blueprint, plan, anchorById, map, triggerScenes));
  return findings;
}

/** Cameras the trigger scenes cued on a Beat's start (or the mission's, for the first Beat) aim outside the camera bounds then. */
function sceneCameraFindings(
  blueprint: MissionBlueprint,
  plan: BoundsPlan,
  anchorById: ReadonlyMap<string, MissionBlueprint["anchors"][number]>,
  map: Rect,
  triggerScenes: readonly LoadedTriggerScene[],
): string[] {
  const script = blueprint.screenplay.script;
  if (!script || triggerScenes.length === 0) return [];
  const findings: string[] = [];
  // At mission start the first Beat's bounds hold if it starts with the mission; with no Beat, the map's own do.
  const first = blueprint.beats[0];
  const startBeatId = first && beatStart(blueprint, first.id) === "mission" ? first.id : undefined;
  for (const entry of script.cues) {
    const atStart = entry.cue.type === "missionStart";
    const beatId = entry.cue.type === "beatStarts" ? entry.cue.beatId : atStart ? startBeatId : undefined;
    const bounds = plan.beats.find((candidate) => candidate.beatId === beatId);
    const loaded = triggerScenes.find((candidate) => candidate.scene === entry.scene);
    if (!loaded || (!bounds && !atStart)) continue;
    // A transition holds the camera to the wider rectangle while the Beat's start scenes play.
    const active = bounds ? activeRects(bounds, map) : { playable: map, camera: map };
    const camera = bounds?.transition ? ("playable" in bounds.transition ? active.playable : bounds.transition.rect) : active.camera;
    if (!camera) continue;
    const { shots, handback } = loaded.triggerScene;
    const cameras = new Set([...shots.flatMap((shot) => [shot.camera, ...(shot.to !== undefined ? [shot.to] : [])]), ...(handback?.camera !== undefined ? [handback.camera] : [])]);
    for (const id of cameras) {
      const anchor = anchorById.get(id);
      const aim = anchor && aimOf(anchor);
      const off = aim ? distanceOutside(camera, aim) : 0;
      if (off > AIM_SLACK) {
        findings.push(`Trigger scene ${loaded.id}, cued ${bounds ? `as Beat ${bounds.beatId} starts` : "at mission start"}, aims its camera ${anchor!.name} ${cellsText(off)} outside the camera bounds ${rectText(camera)} then; whether the game holds a scene's camera to the bounds isn't yet checked in game, so pull the aim in, widen the bounds, or give the Beat a camera transition`);
      }
    }
  }
  return findings;
}
