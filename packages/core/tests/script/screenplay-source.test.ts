import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript } from "../../src/script/name-script.js";
import { refreshScreenplay } from "../../src/script/refresh-screenplay.js";
import { editScreenplay, pullScreenplay } from "../../src/script/screenplay-source.js";

const HAND_WRITTEN = "# Outpost\n\n## Scene 1: THE YARD\n\n**RAYNOR**: Hold here.\n";
/** The Source's gate, as an earlier pull left it. */
const GATE = "# The Gate\n\n- Chapter: 3\n\n## Scene 1: GATE\n\n> Dawn.\n\n**RAYNOR**: Pulled.\n\n**MATT HORNER**: Aye.\n";

/** A Source that keeps Screenplays in memory: `gate` is one, `broken` isn't a Screenplay, `missing` fails. */
const NOTES_PACK = `
const head = "# The Gate\\n\\n- Chapter: 3\\n\\n## Scene 1: GATE\\n\\n> Dawn.\\n\\n";
const screenplays = {
  gate: head + "**RAYNOR**: Pulled.\\n\\n**MATT HORNER**: Aye.\\n",
  "gate-cut": head + "**MATT HORNER**: Aye.\\n",
  "gate-inserted": head + "**MATT HORNER**: Wait.\\n\\n**RAYNOR**: Pulled.\\n\\n**MATT HORNER**: Aye.\\n",
  "gate-rewritten": head + "**RAYNOR**: Pulled out.\\n\\n**MATT HORNER**: Aye.\\n",
};
export default {
  screenplaySource: {
    name: "notes",
    fetch: async ({ missionId, ref }) => {
      if (ref === "broken") return "Not found\\n";
      if (ref === "nameless") return "# Nameless\\n\\n## Scene 1: GATE\\n\\n**RAYNOR**: Hi.\\n";
      if (!screenplays[ref]) throw new Error("no Screenplay " + ref + " for " + missionId);
      return screenplays[ref];
    },
    edit: async ({ missionId, ref, edits, dryRun }) => (dryRun ? "Dry run" : "Applied") + " " + JSON.stringify(edits) + " to " + ref + " of " + missionId + "\\n",
  },
  naming: {
    name: "chapters",
    conversationId: ({ fields }) => {
      if (!fields.Chapter) throw new Error("the Screenplay has no Chapter field");
      return "Ch" + fields.Chapter;
    },
  },
};
`;

describe("pullScreenplay", () => {
  it("writes what the Campaign Pack's Screenplay Source fetches over the Screenplay file", async () => {
    const { blueprintPath, root, screenplay } = await mission({ ref: "gate" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay, sourceName: "notes" });

    expect(await readFile(screenplay, "utf8")).toContain("**RAYNOR**: Pulled.");
    const named = await readMissionScript(blueprint, blueprintPath, workspace);
    expect(named?.script.conversationId).toBe("Ch3");
    expect(await readdir(path.dirname(screenplay))).toEqual(["blueprint.json", "outpost.md"]);
  });

  it("leaves the Screenplay file as it is in a Workspace with no Screenplay Source, which compiles from the file", async () => {
    const { blueprintPath, root, screenplay } = await mission({ ref: "gate", pack: false });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay });

    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
    const named = await readMissionScript(blueprint, blueprintPath, workspace);
    expect(named?.script.scenes[0]?.items).toMatchObject([{ kind: "line", speaker: "RAYNOR", text: "Hold here.", soundId: "outpost-1-1" }]);
  });

  it("pulls a Screenplay whose speakers the Campaign Mod doesn't declare: the script is the source of truth, and compiles ask for the characters", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate", campaignMod: "Notes-Story" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay, sourceName: "notes" });

    expect(await readFile(screenplay, "utf8")).toContain("**MATT HORNER**: Aye.");
    await expect(readMissionScript(blueprint, blueprintPath, workspace)).rejects.toThrow(/speakers RAYNOR .*, MATT HORNER .* have no character/);
  });

  it("refuses what isn't a Screenplay, leaving the file as it was", async () => {
    const { blueprintPath, root, screenplay } = await mission({ ref: "broken" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(`The Screenplay Source notes's broken isn't a Screenplay: it has no "# Title" heading`);
    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
  });

  it("refuses a Screenplay the Campaign Pack's naming template can't name", async () => {
    const { blueprintPath, root, screenplay } = await mission({ ref: "nameless" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(
      "The Screenplay Source notes's nameless can't be named: The Screenplay: the naming template chapters: its conversationId hook threw: the Screenplay has no Chapter field",
    );
    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
  });

  it("names the Source and the Screenplay when the fetch fails", async () => {
    const { blueprintPath, root } = await mission({ ref: "lost" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow("The Screenplay Source notes couldn't fetch lost: no Screenplay lost for outpost");
  });

  it("needs the Blueprint to say what the Source knows its Screenplay by", async () => {
    const { blueprintPath, root } = await mission({});
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(
      `${blueprintPath} has no screenplay.script.ref: name what the Screenplay Source notes knows this Screenplay by`,
    );
  });

  it("won't write a Screenplay outside the Workspace", async () => {
    const { blueprintPath, root } = await mission({ ref: "gate", source: "../../../outside.md" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow("screenplay.script.source ../../../outside.md is outside the Workspace");
  });

  it("refuses a Screenplay without a scene the Blueprint's cues play, leaving the file as it was", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate", cues: [{ scene: 2, cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow("The Screenplay Source notes's gate has no scene 2, which the Blueprint's screenplay.script.cues play");
    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
  });

  it("refuses a Screenplay whose scene lacks the stage direction a cue's part starts from, leaving the file as it was", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate", cues: [{ scene: 1, from: "S01>2", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow("The Screenplay Source notes's gate: screenplay.script.cues.0.from S01>2 names no stage direction of scene 1, which has 1");
    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
  });

  it("refuses a Screenplay whose scene lacks the line a cue plays, leaving the file as it was", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate", cues: [{ scene: 1, line: "gone-1-9", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(/The Screenplay Source notes's gate: screenplay\.script\.cues\.0\.line gone-1-9 is no line of scene 1, whose lines are \S+-1-1, \S+-1-2/);
    expect(await readFile(screenplay, "utf8")).toBe(HAND_WRITTEN);
  });

  it("refuses a Screenplay that moved another line onto the sound ID a cue plays, leaving the file as it was", async () => {
    // Pulled before as gate, whose first line (outpost-1-1) is cut at the Source: Aye moves onto its ID.
    const { blueprintPath, screenplay } = await mission({ ref: "gate-cut", existing: GATE, cues: [{ scene: 1, line: "outpost-1-1", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(
      'The Screenplay Source notes\'s gate-cut: screenplay.script.cues.0.line outpost-1-1 was RAYNOR\'s "Pulled.", which is gone; change the cues, or the Screenplay at its Source, then pull',
    );
    expect(await readFile(screenplay, "utf8")).toBe(GATE);
  });

  it("refuses a Screenplay that gave the line a cue plays another sound ID, and says to refresh", async () => {
    // A line inserted before Aye moves it from outpost-1-2 to outpost-1-3, and Pulled onto its old ID.
    const { blueprintPath } = await mission({ ref: "gate-inserted", existing: GATE, cues: [{ scene: 1, line: "outpost-1-2", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(pullScreenplay({ blueprint, workspace }, blueprintPath)).rejects.toThrow(
      'screenplay.script.cues.0.line outpost-1-2 (MATT HORNER\'s "Aye.") is outpost-1-3 now; refresh the Screenplay (refresh-screenplay) to move the cue with it',
    );
  });

  it("pulls a Screenplay that rewrote the line a cue plays in its place", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate-rewritten", existing: GATE, cues: [{ scene: 1, line: "outpost-1-1", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay, sourceName: "notes" });
  });

  it("pulls a Screenplay with the stage direction a cue's part starts from", async () => {
    const { blueprintPath, screenplay } = await mission({ ref: "gate", cues: [{ scene: 1, from: "S01>1", cue: { type: "missionStart" } }] });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay, sourceName: "notes" });
  });

  it("reads the old name act as ref", async () => {
    const { blueprintPath, screenplay } = await mission({ act: "gate" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(blueprint.screenplay.script?.ref).toBe("gate");
    expect(await pullScreenplay({ blueprint, workspace }, blueprintPath)).toEqual({ path: screenplay, sourceName: "notes" });
    await expect(readMissionBlueprint(await mission({ ref: "gate", act: "other" }).then((made) => made.blueprintPath))).rejects.toThrow("act is ref's old name, and it differs from ref (gate)");
  });
});

describe("refreshScreenplay", () => {
  it("moves a cue's line, and a scenePlayed cue's, with the line to its new sound ID", async () => {
    const { blueprintPath } = await mission({
      ref: "gate-inserted",
      existing: GATE,
      cues: [
        { scene: 1, line: "outpost-1-2", cue: { type: "missionStart" } },
        { scene: 1, cue: { type: "scenePlayed", scene: 1, line: "outpost-1-2" } },
      ],
    });
    const mission_ = await readMissionBlueprint(blueprintPath);

    const refreshed = await refreshScreenplay(mission_, blueprintPath);

    expect(refreshed.cueLines).toEqual([{ from: "outpost-1-2", to: "outpost-1-3" }]);
    const cues = JSON.parse(await readFile(blueprintPath, "utf8")).screenplay.script.cues;
    expect(cues[0].line).toBe("outpost-1-3");
    expect(cues[1].cue.line).toBe("outpost-1-3");
  });
});

describe("editScreenplay", () => {
  it("hands the edits to the Screenplay Source and returns its report", async () => {
    const { blueprintPath, root } = await mission({ ref: "gate" });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    expect(await editScreenplay({ blueprint, workspace }, blueprintPath, [{ cut: 1 }], true)).toBe('Dry run [{"cut":1}] to gate of outpost\n');
    expect(await editScreenplay({ blueprint, workspace }, blueprintPath, [{ cut: 1 }], false)).toBe('Applied [{"cut":1}] to gate of outpost\n');
  });

  it("points at the file itself in a Workspace with no Screenplay Source", async () => {
    const { blueprintPath, root, screenplay } = await mission({ ref: "gate", pack: false });
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);

    await expect(editScreenplay({ blueprint, workspace }, blueprintPath, [], true)).rejects.toThrow(
      `The Workspace's Campaign Pack has no Screenplay Source: edit the Screenplay file ${screenplay} itself`,
    );
  });
});

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A Workspace with the Mission `outpost`, whose Screenplay is the hand-written one, and the `notes` Campaign Pack unless `pack` is false. */
async function mission({ ref, act, cues, source = "outpost.md", pack = true, campaignMod, existing = HAND_WRITTEN }: { ref?: string; act?: string; cues?: unknown[]; source?: string; pack?: boolean; campaignMod?: string; existing?: string }) {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-screenplay-"));
  roots.push(root);
  await writeFile(
    path.join(root, "sc2-adjutant.workspace.json"),
    JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, ...(pack ? { campaignPack: "./notes" } : {}) }),
  );
  if (pack) {
    await mkdir(path.join(root, "notes"));
    await writeFile(
      path.join(root, "notes", "sc2-adjutant-plugin.json"),
      JSON.stringify({
        name: "notes",
        version: "0.1.0",
        pluginApi: 2,
        roles: ["campaign-pack"],
        contributions: { naming: ["chapters"], screenplaySource: ["notes"], ...(campaignMod ? { campaignMod } : {}) },
        entry: "./index.mjs",
      }),
    );
    await writeFile(path.join(root, "notes", "index.mjs"), NOTES_PACK);
  }
  const dir = path.join(root, "missions", "outpost");
  await mkdir(dir, { recursive: true });
  const blueprint = JSON.parse(await readFile(new URL("../fixtures/workspaces/screenplay/missions/outpost/blueprint.json", import.meta.url), "utf8"));
  blueprint.screenplay.script = { source, ...(ref ? { ref } : {}), ...(act ? { act } : {}), ...(cues ? { cues } : {}) };
  const blueprintPath = path.join(dir, "blueprint.json");
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  const screenplay = path.join(dir, "outpost.md");
  await writeFile(screenplay, existing);
  return { root, blueprintPath, screenplay };
}
