// A doodad Anchor's turn and scale when its Blueprint leaves them out, made from its id so they
// stay put across compiles, as the Editor's doodad brush varies them.

import { stableObjectId } from "./stable-object-id.js";

/** Deterministic 0..1 per anchor, so doodads keep their look across recompiles. */
function doodadRandom(anchorId: string, salt: number): number {
  return (stableObjectId(`${anchorId}#${salt}`) % 10000) / 10000;
}

/** A doodad anchor's yaw and scale when the blueprint leaves them out, like the Editor's brush. */
export function anchorDoodadDefaults(anchorId: string): { rotation: number; scale: number } {
  return { rotation: doodadRandom(anchorId, 1) * 2 * Math.PI, scale: 0.85 + doodadRandom(anchorId, 2) * 0.3 };
}
