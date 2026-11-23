// A Kept-terrain Mission whose Map Package has its own conversation: the Ashen Crossing fixture
// compiled elsewhere and imported as "harbour", so its conversation ashen_crossing, its CSounds
// (ashen_crossing-<scene>-<line>, each with its .ogg), its strings and a hand-made cutscene are all
// Kept. Its Blueprint then names a Screenplay for that conversation, edited since: one line's words
// changed (Line2-1), one added (Line2-3) and one dropped (Line3-2), with a delivery note on
// Line1-2 and a mood tag on Line1-1 that change no words. The Kept cutscene "Gate" plays Line2-1
// and Line3-2 by their Kept Sounds.
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

/** The Screenplay as it is now: Ashen Crossing's, with scene 2's first line rewritten, a line added after it, and scene 3's last line cut. */
export const HARBOUR_SCREENPLAY = `# Ashen Crossing

- Chapter: 2

## Scene 1: LANDFALL ON THE SCORCHED PLAIN

> A shuttle sets down at the edge of a cracked white plain.

**KARAX**: The star surges every few minutes. Out in the open, the heat will burn through any shield!

**ZERATUL** *(quietly)*: Then I will walk in the shadows it leaves.

**KARAX**: The Overhang and the Rock Arch will shelter you. After that, the temple gate.

**ARTANIS**: Go carefully, old friend. We need what lies in that temple.

## Scene 2: BETWEEN THE SURGES

**KARAX**: The next surge is close. Get under the arch.

**ZERATUL**: [Fear 20]I feel it.[/Fear]

**KARAX**: Hold there until it passes.

## Scene 3: THE TEMPLE GATE

**ZERATUL**: [Happy 30]I have reached the temple.[/Happy]
`;

/** A Kept cutscene playing the changed line and the dropped one, each by the Sound it was imported with. */
export const GATE_CUTSCENE = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<CutsceneState cutsceneVersion="1.300000">`,
  `    <CCutsceneNodeDirector guid="1" name="Director">`,
  `        <CCutsceneNodeActor guid="2" name="Karax">`,
  `            <CCutsceneNodeConversation guid="3" name="Conversation">`,
  `                <CCutsceneElementConversation guid="4" duration="1500" conversationLink="ashen_crossing" conversationLine="Line2-1" soundLink="ashen_crossing-2-1" assetDuration="1500"/>`,
  `                <CCutsceneElementConversation guid="5" start="2000" duration="1500" conversationLink="ashen_crossing" conversationLine="Line3-2" soundLink="ashen_crossing-3-2" assetDuration="1500"/>`,
  `            </CCutsceneNodeConversation>`,
  `        </CCutsceneNodeActor>`,
  `        <CCutsceneNodeEndScene guid="6" name="End Scene Markers">`,
  `            <CCutsceneElementEndScene guid="7" start="4000"/>`,
  `        </CCutsceneNodeEndScene>`,
  `    </CCutsceneNodeDirector>`,
  `</CutsceneState>`,
  ``,
].join("\r\n");

export const GATE_FILE = "Base.SC2Data/Cutscenes/Gate.SC2Cutscene";

export type KeptConversationFixture = { readonly root: string; readonly workspace: Workspace; readonly missionDir: string; readonly mapDir: string; readonly blueprintPath: string };

let template: Promise<string> | undefined;

/** A fresh copy of the fixture above. */
export async function keptConversation(): Promise<KeptConversationFixture> {
  template ??= buildTemplate();
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-conversation-"));
  await cp(await template, root, { recursive: true });
  const missionDir = path.join(root, "missions", "harbour");
  return { root, workspace: await loadWorkspace(root), missionDir, mapDir: path.join(missionDir, "Harbour.SC2Map"), blueprintPath: path.join(missionDir, "blueprint.json") };
}

export async function removeKeptConversation(fixture: KeptConversationFixture | undefined): Promise<void> {
  if (fixture) await rm(fixture.root, { recursive: true, force: true });
}

async function buildTemplate(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-conversation-template-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  await mkdir(path.join(source, "Base.SC2Data", "Cutscenes"), { recursive: true });
  await writeFile(path.join(source, ...GATE_FILE.split("/")), GATE_CUTSCENE);
  await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });
  const missionDir = path.join(workspaceRoot, "missions", "harbour");
  await writeFile(path.join(missionDir, "harbour.md"), HARBOUR_SCREENPLAY);
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { screenplay: Record<string, unknown> };
  blueprint.screenplay = { ...blueprint.screenplay, script: { source: "harbour.md", conversationId: "ashen_crossing" } };
  await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
  return workspaceRoot;
}
