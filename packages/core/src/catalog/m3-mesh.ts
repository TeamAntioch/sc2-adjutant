// A model's solid triangles, read from its .m3: the faces of each mesh region a batch draws with
// an opaque standard material, in the model's own frame (bind pose, z up). Glows, decals and other
// see-through layers are left out, as units walk through them. The layout is the MD34 one the m3
// Blender addon documents (structures.xml): a MODL's divisions (DIV_) hold the face indices (U16_,
// relative to each region's first vertex), the regions (REGN) and the batches (BAT_, a region and a
// material reference each). Only the doodad ground outlines read it (doodad-outlines.ts).

import { readM3Footprint, readM3Vertices } from "./m3-footprint.js";

/** A DIV_ record: faces and batches references, 52 bytes. */
const DIV = { size: 52, faces: 0, batches: 24 };
/** A BAT_ record: its region at 4, its material reference at 10, 14 bytes. */
const BAT = { size: 14, region: 4, material: 10 };

export type M3Mesh = {
  /** x, y, z of each vertex, in the model's frame. */
  readonly positions: Float32Array;
  /** Three vertex indices a triangle, into `positions`. */
  readonly triangles: Uint32Array;
};

/**
 * The triangles an MD34 .m3 draws with an opaque standard material, and every vertex position;
 * empty for a model with no mesh (a light, a particle emitter). A region no batch draws, a hidden
 * one, or one drawn only with another material (blend, add, a terrain splat) isn't solid.
 */
export function readM3SolidMesh(data: Uint8Array): M3Mesh {
  const { view, reference, divisions, regions, positions } = readM3Vertices(data);
  if (positions.length === 0) return { positions, triangles: new Uint32Array() };
  const { materials } = readM3Footprint(data);
  const triangles: number[] = [];
  for (let d = 0; divisions.entry && d < divisions.count; d++) {
    const division = divisions.entry.offset + DIV.size * d;
    const faceRef = reference(division + DIV.faces);
    const batchRef = reference(division + DIV.batches);
    const own = regions.filter((region) => region.division === d);
    if (!faceRef.entry || own.length === 0) continue;
    const solid = new Set<number>();
    for (let b = 0; batchRef.entry && b < batchRef.count; b++) {
      const at = batchRef.entry.offset + BAT.size * b;
      if (materials[view.getUint16(at + BAT.material, true)] === "opaque") solid.add(view.getUint16(at + BAT.region, true));
    }
    own.forEach((region, index) => {
      if (!solid.has(index) || region.hidden) return;
      for (let f = 0; f + 2 < region.faceCount; f += 3) {
        for (let k = 0; k < 3; k++) triangles.push(region.firstVertex + view.getUint16(faceRef.entry!.offset + 2 * (region.firstFace + f + k), true));
      }
    });
  }
  return { positions, triangles: Uint32Array.from(triangles) };
}
