type Vec3 = readonly [number, number, number];

/** A material reference: a standard material's blend mode (0 opaque, 1 blend, 2 add, ...), or another material type by its MATM number (4 terrain). */
export type M3FixtureMaterial = { readonly blendMode: number } | { readonly type: number };

export type M3FixtureOptions = {
  readonly seqsVersion?: 1 | 2;
  /** The model's bounds, written into a MODL record the header points at, with its materials. */
  readonly bounds?: { readonly min: Vec3; readonly max: Vec3 };
  readonly materials?: readonly M3FixtureMaterial[];
  /** The composite materials (CMP_), one per `{ type: 3 }` material in order: each its sections' material references and weights. */
  readonly composites?: readonly (readonly { readonly material: number; readonly weight: number }[])[];
  /** Each standard material's specular map (a LAYR naming the texture, with a specular multiplier of 2), in the standard materials' order; undefined for none. */
  readonly specularMaps?: readonly (string | undefined)[];
  /** The mesh's vertex positions, written 32 bytes a vertex into the MODL's vertex buffer, in one region of one division. */
  readonly vertices?: readonly Vec3[];
  /** More CHAR blocks, as a material layer's image path is kept. */
  readonly strings?: readonly string[];
  /** The region's triangles, three vertex indices each, written as its faces (U16_). */
  readonly faces?: readonly number[];
  /** A batch per entry drawing the region with that material reference (BAT_). */
  readonly batches?: readonly number[];
  /** Each standard material's name and layers (a LAYR naming the texture, by its layer number in MAT_ at `matVersion`), in the standard materials' order. */
  readonly materialLayers?: readonly { readonly name?: string; readonly layers: Readonly<Record<number, string>> }[];
  /** The MAT_ version: 20 by default; 19 and before have no environment HDR floats, so their layers start 12 bytes sooner. */
  readonly matVersion?: 15 | 16 | 17 | 18 | 19 | 20;
};

/** MODL version 29's size, where its boundings and material references sit. */
const MODL = { size: 856, vertices: 100, divisions: 112, boundings: 136, materialReferences: 300, standardMaterials: 312 };
/** MAT_ version 20's size, and where its blend mode sits. */
const MAT = { size: 352, blendMode: 20 };
/** MAT_ sizes by version, and where its first layer reference sits. */
const MAT_SIZES: Record<number, number> = { 15: 268, 16: 280, 17: 280, 18: 280, 19: 340, 20: 352 };
const matFirstLayer = (version: number): number => (version >= 20 ? 64 : 52);

const padded = (size: number): number => Math.ceil(size / 16) * 16;

/**
 * A minimal MD34 model file: the names, a SEQS block of 96-byte records (92-byte at SEQS version 2,
 * the block padded to 16 bytes), and, given bounds, a MODL record with its MATM references and
 * standard materials (MAT_), then the tag index after them.
 */
export function m3(sequences: readonly { name: string; start: number; end: number; speed: number; flags: number }[], { seqsVersion = 1, bounds, materials = [], composites = [], specularMaps = [], vertices = [], strings = [], faces = [], batches = [], materialLayers = [], matVersion = 20 }: M3FixtureOptions = {}): Uint8Array {
  const RECORD = seqsVersion === 2 ? 92 : 96;
  const names = [...sequences.map((sequence) => sequence.name), ...strings].map((name) => new TextEncoder().encode(`${name}\0`));
  const nameOffsets: number[] = [];
  // After the header, whose model reference (bytes 12-19) a MODL record fills in.
  let at = 32;
  for (const name of names) {
    nameOffsets.push(at);
    at += padded(name.length);
  }
  const seqsOffset = at;
  at = seqsOffset + padded(RECORD * sequences.length);
  const entries = [...names.map((name, i) => ({ tag: "RAHC", offset: nameOffsets[i]!, count: name.length, version: 0 })), { tag: "SQES", offset: seqsOffset, count: sequences.length, version: seqsVersion }];
  const matSize = MAT_SIZES[matVersion]!;
  const standard = materials.flatMap((material) => ("blendMode" in material ? [material.blendMode] : []));
  let model: { modl: number; matm: number; mat: number; modlEntry: number; matmEntry: number; matEntry: number } | undefined;
  const speculars: { standard: number; text: Uint8Array; char: number; layr: number; charEntry: number }[] = [];
  const named: { standard: number; layer: number | undefined; text: Uint8Array; char: number; layr: number; charEntry: number }[] = [];
  let composite: { cmp: number; cmpEntry: number; sections: number[] } | undefined;
  let mesh: { vert: number; div: number; regn: number; vertEntry: number; divEntry: number; face: number; bat: number; faceEntry: number; batEntry: number } | undefined;
  if (bounds) {
    const modl = at;
    const matm = modl + padded(MODL.size);
    const mat = matm + padded(8 * materials.length);
    at = mat + padded(matSize * standard.length);
    model = { modl, matm, mat, modlEntry: entries.length, matmEntry: entries.length + 1, matEntry: entries.length + 2 };
    entries.push({ tag: "LDOM", offset: modl, count: 1, version: 29 }, { tag: "MTAM", offset: matm, count: materials.length, version: 0 }, { tag: "_TAM", offset: mat, count: standard.length, version: matVersion });
    if (composites.length > 0) {
      composite = { cmp: at, cmpEntry: entries.length, sections: [] };
      entries.push({ tag: "_PMC", offset: at, count: composites.length, version: 2 });
      at += padded(28 * composites.length);
      for (const sections of composites) {
        composite.sections.push(at);
        entries.push({ tag: "_SMC", offset: at, count: sections.length, version: 0 });
        at += padded(24 * sections.length);
      }
    }
    for (const [i, { name, layers }] of materialLayers.entries()) {
      for (const [text, layer] of [...(name === undefined ? [] : [[name, undefined] as const]), ...Object.entries(layers).map(([k, texture]) => [texture, Number(k)] as const)]) {
        const bytes = new TextEncoder().encode(`${text}\0`);
        const isLayer = layer !== undefined;
        named.push({ standard: i, layer, text: bytes, char: at, layr: at + padded(bytes.length), charEntry: entries.length });
        entries.push({ tag: "RAHC", offset: at, count: bytes.length, version: 0 });
        if (isLayer) entries.push({ tag: "RYAL", offset: at + padded(bytes.length), count: 1, version: 26 });
        at += padded(bytes.length) + (isLayer ? 16 : 0);
      }
    }
    specularMaps.forEach((texture, i) => {
      if (texture === undefined) return;
      const text = new TextEncoder().encode(`${texture}\0`);
      speculars.push({ standard: i, text, char: at, layr: at + padded(text.length), charEntry: entries.length });
      entries.push({ tag: "RAHC", offset: at, count: text.length, version: 0 }, { tag: "RYAL", offset: at + padded(text.length), count: 1, version: 26 });
      at += padded(text.length) + 16;
    });
    if (vertices.length > 0) {
      const vert = at;
      const div = vert + padded(32 * vertices.length);
      const regn = div + padded(52);
      const face = regn + padded(48);
      const bat = face + padded(2 * faces.length);
      at = bat + padded(14 * batches.length);
      mesh = { vert, div, regn, vertEntry: entries.length, divEntry: entries.length + 1, face, bat, faceEntry: entries.length + 3, batEntry: entries.length + 4 };
      entries.push(
        { tag: "__8U", offset: vert, count: 32 * vertices.length, version: 0 },
        { tag: "_VID", offset: div, count: 1, version: 2 },
        { tag: "NGER", offset: regn, count: 1, version: 5 },
        { tag: "_61U", offset: face, count: faces.length, version: 0 },
        { tag: "_TAB", offset: bat, count: batches.length, version: 1 },
      );
    }
  }
  const indexOffset = at;
  const data = new Uint8Array(indexOffset + 16 * entries.length);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("43DM"), 0);
  view.setUint32(4, indexOffset, true);
  view.setUint32(8, entries.length, true);
  names.forEach((name, i) => data.set(name, nameOffsets[i]!));
  sequences.forEach((sequence, i) => {
    const record = seqsOffset + RECORD * i;
    view.setInt32(record, -1, true);
    view.setInt32(record + 4, -1, true);
    view.setUint32(record + 8, names[i]!.length, true);
    view.setUint32(record + 12, i, true);
    view.setUint32(record + 20, sequence.start, true);
    view.setUint32(record + 24, sequence.end, true);
    view.setFloat32(record + 28, sequence.speed, true);
    view.setUint32(record + 32, sequence.flags, true);
  });
  if (bounds && model) {
    // The header's model reference: one MODL.
    view.setUint32(12, 1, true);
    view.setUint32(16, model.modlEntry, true);
    [...bounds.min, ...bounds.max].forEach((value, i) => view.setFloat32(model.modl + MODL.boundings + 4 * i, value, true));
    view.setUint32(model.modl + MODL.materialReferences, materials.length, true);
    view.setUint32(model.modl + MODL.materialReferences + 4, model.matmEntry, true);
    view.setUint32(model.modl + MODL.standardMaterials, standard.length, true);
    view.setUint32(model.modl + MODL.standardMaterials + 4, model.matEntry, true);
    let nextStandard = 0;
    let nextComposite = 0;
    materials.forEach((material, i) => {
      const type = "blendMode" in material ? 1 : material.type;
      view.setUint32(model.matm + 8 * i, type, true);
      view.setUint32(model.matm + 8 * i + 4, "blendMode" in material ? nextStandard++ : type === 3 ? nextComposite++ : 0, true);
    });
    // A MAT_'s specular multiplier (at 44) and specular layer reference (its third layer: at 88 at version 20, 76 before); the LAYR's image path reference (at 4).
    for (const specular of speculars) {
      const material = model.mat + matSize * specular.standard;
      const layer = material + matFirstLayer(matVersion) + 24;
      view.setFloat32(material + 44, 2, true);
      view.setUint32(layer, 1, true);
      view.setUint32(layer + 4, specular.charEntry + 1, true);
      data.set(specular.text, specular.char);
      view.setUint32(specular.layr + 4, specular.text.length, true);
      view.setUint32(specular.layr + 8, specular.charEntry, true);
    }
    // A named material's name reference (at 0), and each layer's reference (12 bytes a layer from the version's first) to a LAYR whose image path is at 4.
    for (const item of named) {
      const material = model.mat + matSize * item.standard;
      data.set(item.text, item.char);
      if (item.layer === undefined) {
        view.setUint32(material, item.text.length, true);
        view.setUint32(material + 4, item.charEntry, true);
        continue;
      }
      view.setUint32(material + matFirstLayer(matVersion) + 12 * item.layer, 1, true);
      view.setUint32(material + matFirstLayer(matVersion) + 12 * item.layer + 4, item.charEntry + 1, true);
      view.setUint32(item.layr + 4, item.text.length, true);
      view.setUint32(item.layr + 8, item.charEntry, true);
    }
    if (composite) {
      // MODL's composite materials reference (at 336), each CMP_'s sections reference (at 16), and each CMS_'s material and weight (at 0 and 12).
      view.setUint32(model.modl + 336, composites.length, true);
      view.setUint32(model.modl + 340, composite.cmpEntry, true);
      composites.forEach((sections, i) => {
        view.setUint32(composite!.cmp + 28 * i + 16, sections.length, true);
        view.setUint32(composite!.cmp + 28 * i + 20, composite!.cmpEntry + 1 + i, true);
        sections.forEach((section, k) => {
          view.setUint32(composite!.sections[i]! + 24 * k, section.material, true);
          view.setFloat32(composite!.sections[i]! + 24 * k + 12, section.weight, true);
        });
      });
    }
    standard.forEach((blendMode, i) => view.setUint32(model.mat + matSize * i + MAT.blendMode, blendMode, true));
    if (mesh) {
      view.setUint32(model.modl + MODL.vertices, 32 * vertices.length, true);
      view.setUint32(model.modl + MODL.vertices + 4, mesh.vertEntry, true);
      view.setUint32(model.modl + MODL.divisions, 1, true);
      view.setUint32(model.modl + MODL.divisions + 4, mesh.divEntry, true);
      vertices.forEach((vertex, i) => vertex.forEach((value, axis) => view.setFloat32(mesh!.vert + 32 * i + 4 * axis, value, true)));
      // The division's regions: one REGN (version 5), its first vertex 0 and its vertex count at 8 and 12.
      view.setUint32(mesh.div + 12, 1, true);
      view.setUint32(mesh.div + 16, mesh.divEntry + 1, true);
      view.setUint32(mesh.regn + 12, vertices.length, true);
      // Its faces (U16_, referenced at the division's start; the region's first face and count at 16 and 20), and the batches drawing it (at 24).
      view.setUint32(mesh.div, faces.length, true);
      view.setUint32(mesh.div + 4, mesh.faceEntry, true);
      view.setUint32(mesh.regn + 20, faces.length, true);
      faces.forEach((index, i) => view.setUint16(mesh!.face + 2 * i, index, true));
      view.setUint32(mesh.div + 24, batches.length, true);
      view.setUint32(mesh.div + 28, mesh.batEntry, true);
      batches.forEach((material, i) => view.setUint16(mesh!.bat + 14 * i + 10, material, true));
    }
  }
  entries.forEach((entry, i) => {
    data.set(new TextEncoder().encode(entry.tag), indexOffset + 16 * i);
    view.setUint32(indexOffset + 16 * i + 4, entry.offset, true);
    view.setUint32(indexOffset + 16 * i + 8, entry.count, true);
    view.setUint32(indexOffset + 16 * i + 12, entry.version, true);
  });
  return data;
}

/** LAYR sizes by version (structures.xml), and where the layer's video (RTT) channel sits: after two noise floats from version 24. */
const LAYR_SIZES: Record<number, number> = { 20: 356, 21: 356, 22: 356, 23: 428, 24: 436, 25: 468, 26: 464 };

/**
 * An MD34 model holding only LAYR blocks of full-size records, one block per entry at its version,
 * each layer's RTT channel set (-1 for none): enough for a reader of the layers' channels.
 */
export function m3Layers(blocks: readonly { readonly version: number; readonly channels: readonly number[] }[]): Uint8Array {
  let at = 32;
  const placed = blocks.map((block) => {
    const offset = at;
    at += padded(LAYR_SIZES[block.version]! * block.channels.length);
    return { ...block, offset };
  });
  const data = new Uint8Array(at + 16 * placed.length);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("43DM"), 0);
  view.setUint32(4, at, true);
  view.setUint32(8, placed.length, true);
  placed.forEach(({ version, channels, offset }, i) => {
    const size = LAYR_SIZES[version]!;
    channels.forEach((channel, k) => view.setInt32(offset + size * k + (version >= 24 ? 100 : 92), channel, true));
    data.set(new TextEncoder().encode("RYAL"), at + 16 * i);
    view.setUint32(at + 16 * i + 4, offset, true);
    view.setUint32(at + 16 * i + 8, channels.length, true);
    view.setUint32(at + 16 * i + 12, version, true);
  });
  return data;
}
