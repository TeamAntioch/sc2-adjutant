// Doodad notes (doodad-notes.ts) in a Workspace with a Campaign Mod: a note for a doodad the mod's
// doodad index covers (coveredByModIndex) goes into its entry in the index (ADR-0017), and a game
// doodad's or terrain object's into the Workspace's notes, as without a mod.

import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { Catalog } from "./catalog-layer.js";
import { type DoodadNoteAdded, type DoodadNoteInput, isGameDoodad, type KnownDoodads, type NoteParts, noteParts, withUse, writeDoodadNote } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { coveredByModIndex, formatModDoodadIndex, MOD_DOODAD_INDEX_FILE, readModDoodadIndex } from "./mod-doodad-index.js";

/** The doodads a Workspace's note can be for: core's game doodads and terrain objects (with their Doodad Uses), and its Campaign Mod's doodads. */
export type ModKnownDoodads = KnownDoodads & { readonly mod: Catalog };

/**
 * Adds a Doodad Use, a look, or both for a game doodad, a terrain object or a Campaign Mod doodad.
 * A game doodad's or terrain object's go in the Workspace's notes, which then drop what core
 * already holds (`withoutHeldNotes`). A doodad the mod's index covers (coveredByModIndex) has them
 * written into its index entry's description instead (addModDoodadNote).
 */
export async function addModOrGameDoodadNote(workspaceRoot: string, input: DoodadNoteInput, known: ModKnownDoodads): Promise<DoodadNoteAdded> {
  const { id } = input;
  if (!isGameDoodad(id, known) && !known.mod.doodads.has(id)) throw new Error(`${id} isn't a game doodad, a terrain object or a Campaign Mod doodad`);
  const parts = noteParts(input);
  if (coveredByModIndex(known.mod, id)) return addModDoodadNote(known.mod, id, parts);
  return writeDoodadNote(workspaceRoot, id, parts, known);
}

/**
 * Writes a Doodad Use and a look into a Campaign Mod doodad's entry in the mod's doodad index, read
 * fresh from its file: the use after the description's own, the look in place of its look. Refuses
 * a doodad the index has no description of yet, which index-mod-doodads and describing it give. A
 * pending entry described for an earlier model takes them: its words are kept until rewritten.
 */
async function addModDoodadNote(mod: Catalog, id: string, { use, look }: NoteParts): Promise<DoodadNoteAdded> {
  if (mod.modDir === undefined) throw new Error(`${id} is a Campaign Mod doodad, but the Workspace's Campaign Mod has no folder to keep its doodad index in`);
  const file = path.join(mod.modDir, MOD_DOODAD_INDEX_FILE);
  const index = await readModDoodadIndex(mod.modDir);
  const entry = index[id];
  if (!entry?.description) throw new Error(`${id} is a Campaign Mod doodad its doodad index (mods/${path.basename(mod.modDir)}/${MOD_DOODAD_INDEX_FILE}) doesn't describe yet: run index-mod-doodads, then describe it, before adding a note`);
  const uses = withUse(entry.description.uses ?? [], use);
  const description = { ...entry.description, ...(look !== undefined ? { look } : {}), ...(uses.length ? { uses } : {}) };
  await writeFile(file, formatModDoodadIndex({ ...index, [id]: { ...entry, description } }));
  return { note: { ...(uses.length ? { uses } : {}), look: description.look }, dropped: [], file };
}
