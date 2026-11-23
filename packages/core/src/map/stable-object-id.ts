// The Editor reads object Ids as signed 32-bit integers; an Id above 2^31 - 1
// makes it reject the entire Objects file.
const MAX_OBJECT_ID = 0x7fffffff;

export function stableObjectId(slug: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < slug.length; index++) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const id = hash & MAX_OBJECT_ID;
  return id === 0 ? 1 : id;
}

/** The Objects Id a placed Anchor is written at: an adopted doodad's own Editor Id, else one made from its id. */
export function anchorObjectId(anchor: { readonly id: string; readonly editorId?: number | undefined }): number {
  return anchor.editorId ?? stableObjectId(anchor.id);
}
