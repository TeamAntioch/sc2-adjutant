// A model's footprint, read from its .m3: the bounds its MODL record gives (the box the game culls
// it by, in the model's own frame, before a piece's scale and rotation) and what each of its
// materials draws as. `check` tells a flat piece and a see-through decal from them (set-checks.ts).
// Offsets are the MD34 layout the m3 Blender addon documents (structures.xml): they hold for every
// MODL version the game ships (23-29), whose later fields come after these. The mesh's own extent,
// read from its vertices, tells a model whose bounds don't cover it (readM3MeshExtent).

import { m3Index } from "./m3-sequences.js";

type Vec3 = readonly [number, number, number];

/** A standard material's blend mode, or another material type by name. */
export type M3Material = "opaque" | "blend" | "add" | "addAlpha" | "mod" | "mod2x" | "displacement" | "composite" | "terrain" | "volume" | "creep" | "volumeNoise" | "splatTerrainBake" | "lensFlare" | "other";

export type M3Footprint = {
  readonly min: Vec3;
  readonly max: Vec3;
  /** Each of its material references, in its order. */
  readonly materials: readonly M3Material[];
};

/** Where MODL keeps its vertex buffer (U8__) and mesh divisions (DIV_), its bounds (min, max, radius) and its MATM and MAT_ references. */
const MODL = { vertices: 100, divisions: 112, boundings: 136, materialReferences: 300, standardMaterials: 312, compositeMaterials: 336 };
/** A DIV_ record's size, and where it keeps its regions (REGN). */
const DIV_SIZE = 52;
const DIV_REGIONS = 12;
/** REGN record sizes by version. A region's first vertex and vertex count are uint16s at 4 and 6 at version 2, uint32s at 8 and 12 after. */
const REGN_SIZE: Record<number, number> = { 2: 28, 3: 36, 4: 40, 5: 48 };
/** MAT_ record sizes by version; its blend mode is at 20 in each. */
export const MAT_SIZE: Record<number, number> = { 15: 268, 16: 280, 17: 280, 18: 280, 19: 340, 20: 352 };
/** Where a MAT_'s first layer reference sits (12 bytes a layer from there): after three environment HDR floats from version 20. */
export const matFirstLayer = (version: number): number => (version >= 20 ? 64 : 52);
const BLEND_MODES: readonly M3Material[] = ["opaque", "blend", "add", "addAlpha", "mod", "mod2x"];
/** MATM material types past 1, a standard material. */
const MATERIAL_TYPES: Record<number, M3Material> = { 2: "displacement", 3: "composite", 4: "terrain", 5: "volume", 7: "creep", 8: "volumeNoise", 9: "splatTerrainBake", 11: "lensFlare" };

/** An MD34 .m3's MODL record, which its header references. */
export function modlRecord(data: Uint8Array) {
  const index = m3Index(data);
  const modl = index.entries[index.view.getUint32(16, true)];
  if (index.view.getUint32(12, true) !== 1 || modl?.tag !== "LDOM") throw new Error("no MODL record in the .m3");
  return { ...index, modl };
}

/** The bounds and materials of an MD34 .m3's model. */
export function readM3Footprint(data: Uint8Array): M3Footprint {
  const { view, entries, modl } = modlRecord(data);
  const float = (at: number): number => Math.round(view.getFloat32(at, true) * 1000) / 1000;
  const vec = (at: number): Vec3 => [float(at), float(at + 4), float(at + 8)];
  const reference = (at: number) => ({ count: view.getUint32(modl.offset + at, true), entry: entries[view.getUint32(modl.offset + at + 4, true)] });
  const matm = reference(MODL.materialReferences);
  const mat = reference(MODL.standardMaterials);
  const materials = Array.from({ length: matm.count && matm.entry ? matm.count : 0 }, (_, i): M3Material => {
    const type = view.getUint32(matm.entry!.offset + 8 * i, true);
    const index = view.getUint32(matm.entry!.offset + 8 * i + 4, true);
    if (type !== 1) return MATERIAL_TYPES[type] ?? "other";
    const size = mat.entry ? MAT_SIZE[mat.entry.version] : undefined;
    if (!mat.entry || size === undefined || index >= mat.count) return "other";
    return BLEND_MODES[view.getUint32(mat.entry.offset + size * index + 20, true)] ?? "other";
  });
  return { min: vec(modl.offset + MODL.boundings), max: vec(modl.offset + MODL.boundings + 12), materials };
}

/** A composite material (CMP_): the material references it draws, in order, each over the last by its weight. */
export type M3Composite = {
  /** Its own place in the model's material references. */
  readonly material: number;
  readonly sections: readonly { readonly material: number; readonly weight: number }[];
};

/** A CMP_ record (name, priority, sections) and a CMS_ section (material reference, then the weight's animation reference, whose initial value is at 12). */
const CMP_SIZE = 28;
const CMP_SECTIONS = 16;
const CMS_SIZE = 24;
const CMS_WEIGHT = 12;

/**
 * The model's composite materials, with their sections that are standard materials. The game draws such a
 * material as its sections in turn (a base, then details over it); a converter that knows only
 * layer stacks writes it with no texture at all (WhiteoutFlakes' glTF export), so a drawing of the
 * model rebuilds it from these.
 */
export function readM3Composites(data: Uint8Array): M3Composite[] {
  const { view, entries, modl } = modlRecord(data);
  const reference = (at: number) => ({ count: view.getUint32(at, true), entry: entries[view.getUint32(at + 4, true)] });
  const matm = reference(modl.offset + MODL.materialReferences);
  const composites = reference(modl.offset + MODL.compositeMaterials);
  if (!matm.entry || matm.count === 0 || !composites.entry || composites.entry.tag !== "_PMC") return [];
  const type = (index: number): number => view.getUint32(matm.entry!.offset + 8 * index, true);
  const found: M3Composite[] = [];
  for (let material = 0; material < matm.count; material++) {
    const index = view.getUint32(matm.entry.offset + 8 * material + 4, true);
    if (type(material) !== 3 || index >= composites.count) continue;
    const sections = reference(composites.entry.offset + CMP_SIZE * index + CMP_SECTIONS);
    if (!sections.entry || sections.count === 0) continue;
    const list = Array.from({ length: sections.count }, (_, i) => {
      const at = sections.entry!.offset + CMS_SIZE * i;
      return { material: view.getUint32(at, true), weight: Math.round(view.getFloat32(at + CMS_WEIGHT, true) * 1000) / 1000 };
    });
    // A section that isn't a standard material (a floor's mirror reflection) has nothing to draw from.
    const standard = list.filter((section) => section.material < matm.count && type(section.material) === 1);
    if (standard.length > 0) found.push({ material, sections: standard });
  }
  return found;
}

/** A standard material's specular map: the texture, as the model names it, and the material's specular multiplier. */
export type M3Specular = {
  /** The material's place in the model's material references. */
  readonly material: number;
  readonly texture: string;
  readonly multiplier: number;
};

/** Where a MAT_ keeps its specular multiplier, and its specular layer: the third, after the diffuse and the decal, in every version. A LAYR's image path is at 4. */
const MAT_SPECULAR_MULTIPLIER = 44;
const matSpecularLayer = (version: number): number => matFirstLayer(version) + 24;
const LAYR_IMAGE = 4;

/**
 * Each standard material's specular map. The game's metals are a dark diffuse under a bright
 * specular, so a drawing from the diffuse alone (all a glTF export carries: it has no specular
 * colour) shows them near black.
 */
export function readM3Speculars(data: Uint8Array): M3Specular[] {
  const { view, entries, modl } = modlRecord(data);
  const reference = (at: number) => ({ count: view.getUint32(at, true), entry: entries[view.getUint32(at + 4, true)] });
  const matm = reference(modl.offset + MODL.materialReferences);
  const mat = reference(modl.offset + MODL.standardMaterials);
  const size = mat.entry ? MAT_SIZE[mat.entry.version] : undefined;
  if (!matm.entry || !mat.entry || size === undefined) return [];
  const found: M3Specular[] = [];
  for (let material = 0; material < matm.count; material++) {
    const index = view.getUint32(matm.entry.offset + 8 * material + 4, true);
    if (view.getUint32(matm.entry.offset + 8 * material, true) !== 1 || index >= mat.count) continue;
    const at = mat.entry.offset + size * index;
    const layer = reference(at + matSpecularLayer(mat.entry.version));
    if (layer.count === 0 || layer.entry?.tag !== "RYAL") continue;
    const image = reference(layer.entry.offset + LAYR_IMAGE);
    if (image.count === 0 || image.entry?.tag !== "RAHC") continue;
    const texture = new TextDecoder().decode(data.subarray(image.entry.offset, image.entry.offset + image.count)).replace(/\0.*$/s, "");
    if (/\.(dds|tga|png)$/i.test(texture)) found.push({ material, texture, multiplier: Math.round(view.getFloat32(at + MAT_SPECULAR_MULTIPLIER, true) * 1000) / 1000 });
  }
  return found;
}

/**
 * The box the model's mesh fills, from its vertices' positions in the bind pose (each vertex opens
 * with its position, three floats; the stride is the buffer's size over the vertex count its mesh
 * regions reach); undefined for a model with no mesh. A box well outside the MODL bounds
 * (readM3Footprint) is a model the game culls while it is still on screen: m3studio writes the
 * bounds from the armature's `m3_bounds`, which a scripted export leaves at its 4 × 4 box.
 */
export function readM3MeshExtent(data: Uint8Array): { readonly min: Vec3; readonly max: Vec3 } | undefined {
  const { positions } = readM3Vertices(data);
  if (positions.length === 0) return undefined;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis]!, positions[i]!);
    max[axis] = Math.max(max[axis]!, positions[i]!);
  }
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return { min: [round(min[0]!), round(min[1]!), round(min[2]!)], max: [round(max[0]!), round(max[1]!), round(max[2]!)] };
}

/** A mesh region (REGN): its vertices and faces, in its division, and whether it's flagged hidden (version 4 on). */
export type M3Region = { readonly division: number; readonly firstVertex: number; readonly vertexCount: number; readonly firstFace: number; readonly faceCount: number; readonly hidden: boolean };

/** A region flagged hidden: REGN version 4 on, its flags after the root bone. */
const REGION_HIDDEN = 0x1;

function readRegion(view: DataView, at: number, version: number, division: number): M3Region {
  if (version === 2) return { division, firstVertex: view.getUint16(at + 4, true), vertexCount: view.getUint16(at + 6, true), firstFace: view.getUint32(at + 8, true), faceCount: view.getUint32(at + 12, true), hidden: false };
  const hidden = version >= 4 ? (view.getUint32(at + 36, true) & REGION_HIDDEN) !== 0 : false;
  return { division, firstVertex: view.getUint32(at + 8, true), vertexCount: view.getUint32(at + 12, true), firstFace: view.getUint32(at + 16, true), faceCount: view.getUint32(at + 20, true), hidden };
}

/**
 * An MD34 .m3's mesh regions, division by division, and its vertices' positions (x, y, z each, in
 * the model's frame); no positions for a model with no mesh. `divisions` and `reference` let a
 * reader go on to a division's faces and batches (m3-mesh.ts).
 */
export function readM3Vertices(data: Uint8Array) {
  const { view, entries, modl } = modlRecord(data);
  const reference = (at: number) => ({ count: view.getUint32(at, true), entry: entries[view.getUint32(at + 4, true)] });
  const vertices = reference(modl.offset + MODL.vertices);
  const divisions = reference(modl.offset + MODL.divisions);
  const regions: M3Region[] = [];
  for (let d = 0; divisions.entry && d < divisions.count; d++) {
    const list = reference(divisions.entry.offset + DIV_SIZE * d + DIV_REGIONS);
    const size = list.entry ? REGN_SIZE[list.entry.version] : undefined;
    if (!list.entry || size === undefined) continue;
    for (let r = 0; r < list.count; r++) regions.push(readRegion(view, list.entry.offset + size * r, list.entry.version, d));
  }
  let count = 0;
  for (const region of regions) count = Math.max(count, region.firstVertex + region.vertexCount);
  if (count === 0 || !vertices.entry || vertices.count === 0) return { view, entries, reference, divisions, regions, positions: new Float32Array() };
  const stride = vertices.count / count;
  if (!Number.isInteger(stride) || stride < 12 || vertices.entry.offset + vertices.count > data.length) throw new Error(`the .m3's vertex buffer (${vertices.count} bytes) doesn't hold its ${count} vertices`);
  const positions = new Float32Array(3 * count);
  for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) positions[3 * i + axis] = view.getFloat32(vertices.entry.offset + stride * i + 4 * axis, true);
  return { view, entries, reference, divisions, regions, positions };
}
