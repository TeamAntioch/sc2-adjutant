// A Set cutscene: one of a Campaign Mod's Sets written back as a Cutscene Editor file with no shots
// (domain/mod-cinematic.ts), so the author can open the room in the Editor as before it was
// imported. It holds what the Set holds, where the Set's source file had it (at the Set's
// provenance origin): its pieces in a folder named for the Set, the characters on its marks in a
// Characters folder (each looking at its mark's look-at, all through), its cameras with no cut to
// any, its lamps (tied to the cameras they lit, riding the character a lamp is attached to), its
// ambience looping and its base Lights in turn. import-set reads it back as the same Set, but for
// what no cutscene holds (a piece's id, a camera that moves), which is how sync brings an Editor
// change to it back.

import { defaultFamily } from "../catalog/model-guides.js";
import type { SetData } from "../domain/cinematic-set.js";
import { type CastModels, castClips, DEFAULT_LOOK, pieceAnim, shotCamera } from "./cinematic.js";
import { type CutsceneSound, shotCutscene, type StandingActor, type StandingLamp } from "./write-shot-cutscene.js";

type Vec3 = readonly [number, number, number];

/** The folder a Set cutscene keeps its characters in: one import-set reads as a mark's, by its name. */
export const CHARACTERS_FOLDER = "Characters";

/**
 * The .SC2Cutscene of `set`, running `lengthMs`, its models' anims at their recorded lengths, each
 * mark's character standing in its model's Model Guide's default family (castClips).
 */
export function setCutscene(set: SetData, { lengthMs, models: { anims: modelAnims, guides } }: { readonly lengthMs: number; readonly models: CastModels }): string {
  const origin = (set.provenance?.origin ?? [0, 0, 0]) as Vec3;
  const plus = (at: readonly number[]): Vec3 => [at[0]! + origin[0], at[1]! + origin[1], at[2]! + origin[2]];
  const cameraAt = new Map(set.cameras.map((camera, index) => [camera.name, index]));
  /** The views a piece, mark or lamp is tied to; {} when untied, null when tied only to cameras the Set hasn't. */
  const tied = (names: readonly string[] | undefined): { shots?: number[] } | null => {
    if (names === undefined) return {};
    const shots = [...new Set(names.flatMap((name) => (cameraAt.has(name) ? [cameraAt.get(name)!] : [])))];
    return shots.length ? { shots } : null;
  };

  const standing: StandingActor[] = [];
  for (const piece of set.pieces) {
    const shots = tied(piece.shots);
    if (!shots) continue;
    standing.push({
      model: piece.model,
      ...(piece.modelPath ? { modelPath: piece.modelPath } : {}),
      at: plus(piece.at),
      folder: set.name,
      ...(piece.rotation !== undefined ? { rotation: piece.rotation } : {}),
      ...(piece.scale !== undefined ? { scale: piece.scale } : {}),
      ...(piece.variation ? { variation: piece.variation } : {}),
      ...(piece.tint ? { tint: piece.tint } : {}),
      ...(piece.teamColor ? { teamColor: piece.teamColor } : {}),
      ...(piece.opacity !== undefined ? { opacity: piece.opacity } : {}),
      ...pieceAnim(piece, modelAnims),
      ...(piece.animSpeed !== undefined ? { animSpeed: piece.animSpeed } : {}),
      ...(piece.hidden ? { hidden: true as const } : {}),
      ...shots,
    });
  }
  // A mark seen through none of the Set's cameras (empty shots) isn't seen, so it isn't written.
  const markAt = new Map<string, number>();
  for (const mark of set.marks) {
    const shots = mark.shots?.length === 0 ? null : tied(mark.shots);
    if (!shots) continue;
    const stand = mark.anim !== undefined ? pieceAnim({ model: mark.model, at: mark.at, anim: mark.anim }, modelAnims).anim : castClips(modelAnims[mark.model]?.anims ?? [], undefined, defaultFamily(guides[mark.model])).stand;
    markAt.set(mark.name, standing.length);
    standing.push({ model: mark.model, name: mark.name, at: plus(mark.at), rotation: mark.facing, folder: CHARACTERS_FOLDER, ...(stand ? { anim: stand } : {}), ...shots });
  }
  for (const mark of set.marks) {
    const [index, target] = [markAt.get(mark.name), mark.lookAt && markAt.get(mark.lookAt.mark)];
    if (index === undefined || target === undefined || !mark.lookAt) continue;
    standing[index] = { ...standing[index]!, looks: [{ startMs: 0, at: target, type: mark.lookAt.type ?? DEFAULT_LOOK.type, point: mark.lookAt.point ?? DEFAULT_LOOK.point }] };
  }

  const lamps: StandingLamp[] = [];
  for (const lamp of set.lamps) {
    const shots = tied(lamp.shots);
    if (!shots) continue;
    const { shots: _names, at, attach, ...rest } = lamp;
    const actor = attach && markAt.get(attach.mark);
    lamps.push({ ...rest, at: plus(at), ...shots, ...(attach && actor !== undefined ? { attach: { actor, point: attach.point, offset: attach.offset, rotation: attach.rotation } } : {}) });
  }
  const sounds: CutsceneSound[] = (set.sounds ?? []).map(({ sound, volume }) => ({ sound, startMs: 0, volume, loop: true }));

  return shotCutscene({
    shots: [],
    views: set.cameras.map((camera) => ({ ...shotCamera(camera, origin), name: camera.name })),
    lengthMs,
    lightsInTurn: set.lights,
    standing,
    lamps,
    ...(sounds.length ? { sounds } : {}),
  });
}
