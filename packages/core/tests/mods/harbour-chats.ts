// The Harbour's hub chats, a synthetic Campaign Mod Screenplay for the mod tests: Harbour-Story's
// Kept conversation and strings as the Editor made them, a Campaign Pack whose Screenplay Source
// keeps its Acts in screenplays.json at the Workspace root, and the Screenplay's declaration.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { pullModScreenplays } from "../../src/mods/conversations.js";
import { WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { declare, type Mod, put, setup } from "./mod-fixture.js";

export const CONVERSATION_FILE = "Base.SC2Data/GameData/ConversationData.xml";
export const STRINGS_FILE = "enUS.SC2Data/LocalizedData/ConversationStrings.txt";

/** One conversation line as the Editor saved the mod's. */
export const keptLine = (id: string, sound: string, character: string) => [
  `        <Lines>`,
  `            <Id value="${id}"/>`,
  `            <Text value="Conversation/HarbourChats/${id}"/>`,
  `            <FacialBlend value="100"/>`,
  `            <Sound value="${sound}"/>`,
  `            <OverlapPrevious value="500"/>`,
  `            <AnimProps value="Talk"/>`,
  `            <AnimBlendIn value="-1"/>`,
  `            <AnimBlendOut value="-1"/>`,
  `            <LookAtAttach value="Head"/>`,
  `            <SpeakerCharacter value="${character}"/>`,
  `            <Objects index="Speaker" value=""/>`,
  `            <Objects index="Listener" value=""/>`,
  `            <Objects index="Camera" value=""/>`,
  `            <Variations index="Speaker" value=""/>`,
  `            <Variations index="Listener" value=""/>`,
  `            <Variations index="Camera" value=""/>`,
  `        </Lines>`,
];

/** The harbour's chats as the Editor made them, groups first, with the old exporter's sound ids; and a ferry conversation no Screenplay writes. */
export const KEPT_CONVERSATIONS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  `    <CConversation id="HarbourChats">`,
  `        <EditorCategories value="ConversationType:Mission"/>`,
  `        <ProductionLevel value="2"/>`,
  `        <Groups Id="Group00001" Name="Conversation/HarbourChats/Group00001">`,
  `            <Children value="Line01001"/>`,
  `            <Children value="Line01002"/>`,
  `        </Groups>`,
  `        <Groups Id="Group00002" Name="Conversation/HarbourChats/Group00002">`,
  `            <Children value="Line02001"/>`,
  `        </Groups>`,
  `        <RootItems value="Group00001"/>`,
  `        <RootItems value="Group00002"/>`,
  ...keptLine("Line01001", "Harbour-Quay-01-001-Harbourmaster", "CharHarbourmaster"),
  ...keptLine("Line01002", "Harbour-Quay-01-002-Dockhand", "CharDockhand"),
  ...keptLine("Line02001", "Harbour-Quay-02-001-Dockhand", "CharDockhand"),
  `    </CConversation>`,
  `    <CConversation id="Ferry">`,
  `        <ProductionLevel value="2"/>`,
  `    </CConversation>`,
  `</Catalog>`,
  ``,
].join("\r\n");

export const KEPT_STRINGS = [
  "Conversation/Ferry/Line01001=All aboard.",
  "Conversation/HarbourChats/Group00001=THE QUAY",
  "Conversation/HarbourChats/Group00002=THE CRANE",
  "Conversation/HarbourChats/Line01001=Tie her off.",
  "Conversation/HarbourChats/Line01002=Aye, ma'am.",
  "Conversation/HarbourChats/Line02001=She's stuck again.",
  "",
].join("\n");

export const screenplay = (dockhand = "[Happy 30]Aye[/Happy], ma'am.") =>
  [
    "# HARBOUR CHATS",
    "",
    "- Act ID: act_harbour",
    "",
    "## Scene 1: THE QUAY",
    "",
    "> Fog over the water.",
    "",
    "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off.",
    "",
    `**DOCKHAND** \`H-01-002-DOCKHAND\`: ${dockhand}`,
    "",
    "## Scene 2: THE CRANE",
    "",
    "**DOCKHAND** `H-02-001-DOCKHAND` *(wearily)*: She's stuck again.",
    "",
  ].join("\n");

/**
 * The Harbour's Campaign Pack: a naming template that names a line by its sound id
 * (H-<scene>-<line>-<SPEAKER> is Line<scene><line>), and a Screenplay Source that keeps its Acts
 * in screenplays.json at the Workspace root, so a test changes a line there.
 */
export const HARBOUR_PACK = `
import { readFile, writeFile } from "node:fs/promises";
const acts = async () => JSON.parse(await readFile(new URL("../../screenplays.json", import.meta.url), "utf8"));
const parts = (scriptId) => /^H-(\\d+)-(\\d+)-/.exec(scriptId ?? "") ?? (() => { throw new Error("no sound id"); })();
export default {
  screenplaySource: {
    name: "harbour-notes",
    fetch: async ({ ref, modId }) => {
      const act = (await acts())[ref];
      if (!act) throw new Error("no act " + ref + " for " + modId);
      return act;
    },
    edit: async (request) => {
      await writeFile(new URL("../../edit-request.json", import.meta.url), JSON.stringify(request));
      return "edited " + request.ref + (request.dryRun ? " (dry run)" : "") + "\\n";
    },
    refForConversation: async (conversationId) => (conversationId === "HarbourChats" ? "act_harbour" : undefined),
  },
  naming: {
    name: "harbour",
    lineId: ({ scriptId }) => "Line" + parts(scriptId)[1] + parts(scriptId)[2],
    soundId: ({ scriptId }) => scriptId,
  },
};
`;

export const CHARACTERS = [
  { speaker: "HARBOURMASTER", id: "CharHarbourmaster" },
  { speaker: "DOCKHAND", id: "CharDockhand" },
];

export const DECLARED = {
  ref: "act_harbour",
  source: "screenplays/harbour-chats.md",
  conversation: "HarbourChats",
  overlapPrevious: 500,
  importedSounds: {
    Line01001: "Harbour-Quay-01-001-Harbourmaster",
    Line01002: "Harbour-Quay-01-002-Dockhand",
    Line02001: "Harbour-Quay-02-001-Dockhand",
  },
};

/** The Harbour mod with its chats Kept, in a Workspace whose Campaign Pack has the Source above, its Act as `act`. */
export async function harbour(act = screenplay()): Promise<Mod> {
  const mod = await setup();
  const config = JSON.parse(await readFile(path.join(mod.workspaceRoot, WORKSPACE_FILE), "utf8"));
  await writeFile(path.join(mod.workspaceRoot, WORKSPACE_FILE), JSON.stringify({ ...config, campaignPack: "./plugins/harbour-pack", mods: ["harbour-story"] }));
  const pack = path.join(mod.workspaceRoot, "plugins", "harbour-pack");
  await put(
    path.join(pack, "sc2-adjutant-plugin.json"),
    JSON.stringify({ name: "harbour-pack", version: "0.1.0", pluginApi: 2, roles: ["campaign-pack"], contributions: { campaignMod: "Harbour-Story", naming: ["harbour"], screenplaySource: ["harbour-notes"] }, entry: "./index.mjs" }),
  );
  await put(path.join(pack, "index.mjs"), HARBOUR_PACK);
  await setAct(mod, act);
  await put(path.join(mod.modPackage, ...CONVERSATION_FILE.split("/")), KEPT_CONVERSATIONS);
  await put(path.join(mod.modPackage, ...STRINGS_FILE.split("/")), `﻿${KEPT_STRINGS}`);
  return mod;
}

/** Changes the Act at the Source. */
export const setAct = (mod: Mod, act: string) => writeFile(path.join(mod.workspaceRoot, "screenplays.json"), JSON.stringify({ act_harbour: act }));

/** Declares the chats' Screenplay, pulled from the Source. */
export async function declareChats(mod: Mod, screenplays: unknown[] = [DECLARED], characters: unknown[] = CHARACTERS): Promise<void> {
  await declare(mod, { characters, screenplays });
  await pullModScreenplays(mod.blueprintPath);
}
