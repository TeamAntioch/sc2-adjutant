// model-footprints' line for one model (model-footprints.ts): its size with the axes named, its
// materials and the file it was read from.

import type { ModelFootprint } from "../catalog/model-footprints.js";

/** Width × depth × height, which are the model's x × y × z, in game units; then its materials and file. */
export function describeFootprint({ file, min, max, materials }: ModelFootprint): string {
  const size = [0, 1, 2].map((axis) => (max[axis]! - min[axis]!).toFixed(2)).join(" × ");
  return `w × d × h (x × y × z) ${size}, ${materials.join(", ") || "no materials"}, from ${file}`;
}
