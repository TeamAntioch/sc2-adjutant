// Harbour-Art, the Harbour's synthetic Asset Mod, for the sound set and Asset Source tests: the
// Editor's voice file for each of the Harbour's chat lines, all Kept, beside Harbour-Story with its
// chats compiled and its SoundData as the Editor made it.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileMod } from "../../src/mods/compile-mod.js";
import { importMod } from "../../src/mods/import-mod.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { CHARACTERS, declareChats, harbour } from "./harbour-chats.js";
import { binary, documentHeader, declare, type Mod, put } from "./mod-fixture.js";

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export const VOICE_FOLDER = "Base.SC2Assets/Assets/Sounds/Conversations";
export const SOUNDS = ["Harbour-Quay-01-001-Harbourmaster", "Harbour-Quay-01-002-Dockhand", "Harbour-Quay-02-001-Dockhand"];
export const VOICE = (sound: string) => `${VOICE_FOLDER}/${sound}.ogg`;
/** Each line's recording, as the Editor-made Asset Mod holds it. */
export const RECORDING = (sound: string) => binary(SOUNDS.indexOf(sound) + 10, 800);
export const SOUND_DATA = "Base.SC2Data/GameData/SoundData.xml";

/** The Harbour's SoundData as the Editor made it: its dialogue parent, and a CSound for each line on it. */
export const KEPT_SOUND_DATA = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  `    <CSound default="1" id="Dialogue_Harbour" parent="Mission">`,
  `        <?token id="Template"?>`,
  `        <?token id="Speaker"?>`,
  `        <?token id="Subtitle"?>`,
  `        <?token id="Line"?>`,
  `        <AssetArrayTemplate File="Assets\\Sounds\\^TemplateParam1^.ogg" FacialAnim="^TemplateParam2^" FacialGroup="Default"/>`,
  `        <AssetArray>`,
  `            <TemplateParam value="##Template##"/>`,
  `            <Speaker value="ConversationState/Characters/##Speaker##"/>`,
  `            <Subtitle value="Conversation/##Subtitle##/Line##Line##"/>`,
  `        </AssetArray>`,
  `    </CSound>`,
  `    <CSound id="Harbour-Quay-01-001-Harbourmaster" parent="Dialogue_Harbour" Subtitle="HarbourChats" Template="Conversations\\##id##;##id##" Speaker="CharHarbourmaster" Line="01001"/>`,
  `    <CSound id="Harbour-Quay-01-002-Dockhand" parent="Dialogue_Harbour" Subtitle="HarbourChats" Template="Conversations\\##id##;Dockhand_Grumble" Speaker="CharDockhand" Line="01002"/>`,
  `    <CSound id="Harbour-Quay-02-001-Dockhand" parent="Dialogue_Harbour" Subtitle="HarbourChats" Template="Conversations\\##id##;##id##" Speaker="CharDockhand" Line="02001"/>`,
  `</Catalog>`,
  ``,
].join("\r\n");

export const SOUND_SET = { conversation: "HarbourChats", parent: "Dialogue_Harbour", template: "Assets\\Sounds\\^TemplateParam1^.ogg", facialAnims: { Line01002: "Dockhand_Grumble" } };
export const SOUND_ENTRY = (sound: string) => `catalog-entry:${SOUND_DATA}:CSound:${sound}`;

/** Each line's voice in the Harbour's characters: the Dockhand's is Fiona. */
export const VOICED = CHARACTERS.map((character) => ({ ...character, voice: character.speaker === "DOCKHAND" ? "Fiona" : "Daniel" }));

/** The Harbour, its chats compiled, with its Asset Mod Harbour-Art imported beside it: the Editor's voice files, all Kept. */
export async function harbourWithArt(soundData = KEPT_SOUND_DATA): Promise<{ story: Mod; art: Mod }> {
  const story = await harbour();
  await declareChats(story, undefined, VOICED);
  await put(path.join(story.modPackage, ...SOUND_DATA.split("/")), soundData);
  await compileMod(story.blueprintPath);

  const source = path.join(path.dirname(story.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
  await put(path.join(source, "DocumentHeader"), documentHeader([], 6));
  await put(path.join(source, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <ModType>\r\n        <Value>Interface</Value>\r\n    </ModType>\r\n</DocInfo>\r\n`);
  for (const sound of SOUNDS) await put(path.join(source, ...VOICE(sound).split("/")), RECORDING(sound));
  await put(path.join(source, "Base.SC2Assets", "Assets", "Textures", "gull.dds"), binary(4));
  const imported = await importMod(await loadWorkspace(story.workspaceRoot), source, "harbour-art", { kind: "asset" });
  const art = { workspaceRoot: story.workspaceRoot, modDir: path.dirname(imported.blueprintPath), blueprintPath: imported.blueprintPath, modPackage: imported.modPackage };
  return { story, art };
}

/** Puts each line's recording in the Asset Mod's folder, under voices/, and declares them as Workspace files. */
export async function declareRecordings(art: Mod, sounds = SOUNDS, extra: Record<string, unknown> = {}): Promise<void> {
  const recordings: Record<string, unknown> = {};
  for (const sound of sounds) {
    await put(path.join(art.modDir, "voices", `${sound}.ogg`), RECORDING(sound));
    recordings[sound] = { file: `voices/${sound}.ogg`, sha256: sha256(RECORDING(sound)) };
  }
  await declare(art, { voices: [{ conversation: "HarbourChats", folder: VOICE_FOLDER, recordings }], ...extra });
}

export const inArt = (art: Mod, file: string) => readFile(path.join(art.modPackage, ...file.split("/")));
