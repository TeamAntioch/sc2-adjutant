// Seam 1 (#96, #116): Co-design Stage tracking through the MCP server. Stage state lives in the
// Workspace, beside each Mission's Blueprint, so it is checked through the tools and the file.
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fingerprint } from "../../src/domain/compile-record.js";
import { connect, copyOf, text } from "./harness.js";

const stageFile = (root: string, mission = "lava-field") => path.join(root, "missions", mission, "co-design.json");
const historyFile = (root: string, mission = "lava-field") => path.join(root, "missions", mission, "co-design-history.json");

const signOff = (client: Awaited<ReturnType<typeof connect>>, stage: number, note?: string) =>
  client.callTool({ name: "sign_off_stage", arguments: { mission: "lava-field", stage, ...(note ? { note } : {}) } });

describe("get_session_state", () => {
  it("starts a new Mission at Stage 1 with nothing signed off", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({
      missions: [{ mission: "lava-field", stage: 1, stageName: "Beats and Mechanics", signedOff: [], reopened: [], stale: [], staleCaptures: [] }],
      unreadable: [],
    });
    expect(text(reply)).toMatch(/^lava-field: Stage 1 \(Beats and Mechanics\), nothing signed off yet\.\nNext \(Stage 1\): .*sign_off_stage/);
  });

  it("reports every Mission in the Workspace when none is named", async () => {
    const root = await copyOf("field");
    await mkdir(path.join(root, "missions", "second"));
    await writeFile(path.join(root, "missions", "second", "blueprint.json"), await readFile(path.join(root, "missions", "lava-field", "blueprint.json")));
    const client = await connect(root);
    await signOff(client, 1);

    const reply = await client.callTool({ name: "get_session_state", arguments: {} });
    expect(reply.isError).toBeFalsy();
    const missions = (reply.structuredContent as { missions: { mission: string; stage: number }[] }).missions;
    expect(missions.map(({ mission, stage }) => [mission, stage])).toEqual([
      ["lava-field", 2],
      ["second", 1],
    ]);
  });

  it("refuses a Stage file that doesn't record the Stages in order", async () => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), JSON.stringify({ signedOff: [{ stage: 2, at: "2026-10-29T00:00:00.000Z" }] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(`Invalid Co-design Stage record ${stageFile(root)}: signedOff.0.stage: expected Stage 1, got Stage 2`);

    // Listing every Mission reports the bad record beside the others instead of failing.
    const all = await client.callTool({ name: "get_session_state", arguments: {} });
    expect(all.isError).toBeFalsy();
    expect(all.structuredContent).toEqual({ missions: [], unreadable: [{ mission: "lava-field", reason: expect.stringContaining("expected Stage 1, got Stage 2") }] });
  });

  it("refuses a sign-off time that isn't an ISO date and time", async () => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), JSON.stringify({ signedOff: [{ stage: 1, at: "yesterday" }] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("signedOff.0.at");
  });
});

describe("a Stage record that can't be read", () => {
  it("doesn't turn a saved edit into an error", async () => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), "not JSON");
    const client = await connect(root);

    const reply = await client.callTool({ name: "move_zone", arguments: { mission: "lava-field", zone: "field", dx: 1, dy: 0 } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toMatch(/^Next: unknown, since the Stage record can't be used\. Can't read the Co-design Stage record/m);
  });
});

describe("a Stage record that is a link", () => {
  it("stays a link when the first sign-off writes the file it points to", async () => {
    const root = await copyOf("field");
    const shared = path.join(root, "shared-co-design.json");
    await symlink(shared, stageFile(root));
    const client = await connect(root);

    expect((await signOff(client, 1)).isError).toBeFalsy();
    expect((await lstat(stageFile(root))).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(shared, "utf8")).signedOff).toHaveLength(1);
  });
});

describe("a Stage record behind two links", () => {
  it("follows every link to the file not there yet, relative to each link's own folder", async () => {
    const root = await copyOf("field");
    await mkdir(path.join(root, "shared"));
    // co-design.json -> ../../hop.json -> shared/co-design.json (missing): each link is relative to where it sits.
    await symlink("shared/co-design.json", path.join(root, "hop.json"));
    await symlink("../../hop.json", stageFile(root));
    const client = await connect(root);

    // The first sign-off creates the file at the end of the links; the second reads it back through them.
    expect((await signOff(client, 1)).isError).toBeFalsy();
    expect((await signOff(client, 2)).isError).toBeFalsy();
    expect((await lstat(stageFile(root))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(root, "hop.json"))).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, "shared", "co-design.json"), "utf8")).signedOff).toHaveLength(2);
  });
});

describe("sign_off_stage", () => {
  it("refuses a Stage number outside 1 to 4 before anything is read", async () => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), "not JSON");
    const client = await connect(root);
    const reply = await signOff(client, 9);
    expect(reply.isError).toBe(true);
    expect(text(reply)).not.toContain("Can't read the Co-design Stage record");
  });

  it("advances one Stage at a time and records each sign-off", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const first = await signOff(client, 1, "Beats agreed in chat");
    expect(first.isError).toBeFalsy();
    expect(text(first)).toMatch(/^Signed off Stage 1 \(Beats and Mechanics\) of lava-field\. Now at Stage 2 \(Geography sketch\)\.\nNext \(Stage 2\): .*preview/);
    expect(first.structuredContent).toMatchObject({ mission: "lava-field", stage: 2, signedOff: [{ stage: 1, note: "Beats agreed in chat" }] });

    for (const stage of [2, 3]) expect((await signOff(client, stage)).isError).toBeFalsy();
    const last = await signOff(client, 4);
    expect(last.structuredContent).toMatchObject({ mission: "lava-field", stage: null, stageName: null });
    expect(text(last)).toContain("Every Stage of lava-field is signed off.");

    const record = JSON.parse(await readFile(stageFile(root), "utf8"));
    expect(record.signedOff.map((entry: { stage: number }) => entry.stage)).toEqual([1, 2, 3, 4]);
    expect(record.signedOff[0]).toEqual({ stage: 1, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), note: "Beats agreed in chat", covers: [{ path: "blueprint.json", fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) }] });
  });

  it("refuses to skip a Stage, sign one off twice, or sign off past the last", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const skip = await signOff(client, 2);
    expect(skip.isError).toBe(true);
    expect(text(skip)).toBe("Refused: lava-field is at Stage 1 (Beats and Mechanics). Sign off Stage 1 before Stage 2; Stages can't be skipped.");
    await expect(readFile(stageFile(root))).rejects.toThrow(/ENOENT/);

    await signOff(client, 1);
    const twice = await signOff(client, 1);
    expect(twice.isError).toBe(true);
    expect(text(twice)).toBe("Refused: Stage 1 (Beats and Mechanics) of lava-field is already signed off. It is at Stage 2 (Geography sketch). To redo it, reopen it with reopen_stage, only if the author asks.");

    for (const stage of [2, 3, 4]) await signOff(client, stage);
    const past = await signOff(client, 4);
    expect(past.isError).toBe(true);
    expect(text(past)).toContain("already signed off");
    const outOfRange = await signOff(client, 5);
    expect(outOfRange.isError).toBe(true);
  });

  it("signs a Stage off once when two sign-offs arrive at once", async () => {
    const root = await copyOf("field");
    const client = await connect(root);

    const replies = await Promise.all([signOff(client, 1), signOff(client, 1)]);
    expect(replies.map((reply) => reply.isError ?? false).sort()).toEqual([false, true]);
    expect(JSON.parse(await readFile(stageFile(root), "utf8")).signedOff).toHaveLength(1);
  });

  it("keeps the Stage state across a server restart", async () => {
    const root = await copyOf("field");
    await signOff(await connect(root), 1);

    const restarted = await connect(root);
    const reply = await restarted.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.structuredContent).toMatchObject({ missions: [{ mission: "lava-field", stage: 2, signedOff: [{ stage: 1 }] }] });
  });
});

const reopen = (client: Awaited<ReturnType<typeof connect>>, stage: number, note = "Redesigned as a hero mission") =>
  client.callTool({ name: "reopen_stage", arguments: { mission: "lava-field", stage, note } });

describe("reopen_stage", () => {
  it("takes the Mission back to a signed-off Stage and keeps the sign-offs it supersedes", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    await signOff(client, 1, "Base-building Beats");
    await signOff(client, 2, "Two lanes");
    const before = JSON.parse(await readFile(stageFile(root), "utf8")).signedOff;

    const reply = await reopen(client, 1);
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toMatch(/^Reopened Stage 1 \(Beats and Mechanics\) of lava-field; superseded the sign-offs of Stage 1 of \d{4}-\d\d-\d\d, Stage 2 of \d{4}-\d\d-\d\d\.\nNext \(Stage 1\): /);
    expect(reply.structuredContent).toMatchObject({ mission: "lava-field", stage: 1, signedOff: [], reopened: [{ stage: 1, note: "Redesigned as a hero mission", superseded: before }] });

    // The Stage record keeps the shape a core from before reopening reads; the history is beside it.
    expect(JSON.parse(await readFile(stageFile(root), "utf8"))).toEqual({ signedOff: [] });
    expect(JSON.parse(await readFile(historyFile(root), "utf8"))).toEqual({
      reopened: [{ stage: 1, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), note: "Redesigned as a hero mission", superseded: before }],
    });

    // The only way forward is a fresh sign-off, one Stage at a time; the history stays.
    expect((await signOff(client, 2)).isError).toBe(true);
    expect((await signOff(client, 1, "Hero Beats")).isError).toBeFalsy();
    const state = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(state.structuredContent).toMatchObject({ missions: [{ stage: 2, signedOff: [{ stage: 1, note: "Hero Beats" }], reopened: [{ stage: 1, superseded: before }] }] });
    expect(text(state)).toMatch(/^lava-field: Stage 2 \(Geography sketch\); signed off Stage 1 on \S+ \(Hero Beats\)\. Reopened Stage 1 on \S+ \(Redesigned as a hero mission\), superseding Stage 1 of \S+, Stage 2 of \S+\.$/m);
  });

  it("reopens a later Stage, keeping the ones before it, and reopens again after every Stage is signed off", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    for (const stage of [1, 2, 3, 4]) await signOff(client, stage);

    const third = await reopen(client, 3, "New palette");
    expect(third.structuredContent).toMatchObject({ stage: 3, signedOff: [{ stage: 1 }, { stage: 2 }], reopened: [{ stage: 3, superseded: [{ stage: 3 }, { stage: 4 }] }] });
    const second = await reopen(client, 2, "  Zones moved ");
    expect(second.structuredContent).toMatchObject({ stage: 2, signedOff: [{ stage: 1 }], reopened: [{ stage: 3 }, { stage: 2, note: "Zones moved", superseded: [{ stage: 2 }] }] });

    // The text gives the latest reopening and counts the rest; the structured reply has them all.
    const state = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(text(state)).toMatch(/ Reopened Stage 2 on \S+ \(Zones moved\), superseding Stage 2 of \S+ \(1 earlier reopening in the record\)\.$/m);
    expect(text(state)).not.toContain("New palette");
  });

  it("refuses the Stage the Mission is at, a Stage not reached, a Stage out of range and an empty note", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    await signOff(client, 1);

    const current = await reopen(client, 2);
    expect(current.isError).toBe(true);
    expect(text(current)).toBe("Refused: lava-field is at Stage 2 (Geography sketch) already, and it isn't signed off. Only a signed-off Stage can be reopened.");
    const later = await reopen(client, 3);
    expect(text(later)).toBe("Refused: lava-field is at Stage 2 (Geography sketch) and hasn't reached Stage 3. Only a signed-off Stage can be reopened.");
    expect((await reopen(client, 5)).isError).toBe(true);
    const blank = await reopen(client, 1, "  ");
    expect(blank.isError).toBe(true);
    expect(text(blank)).toBe("Refused: say why the Stage is reopened, in the note.");
    expect(JSON.parse(await readFile(stageFile(root), "utf8"))).toEqual({ signedOff: [expect.objectContaining({ stage: 1 })] });
    await expect(readFile(historyFile(root))).rejects.toThrow(/ENOENT/);
  });

  const signed = (stage: number, day: number) => ({ stage, at: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z` });
  const reopening = (stage: number, at: string, superseded: object[], note = "redo") => ({ stage, at, note, superseded });

  it.each([
    ["a blank reason", [], [reopening(1, "2026-11-11T00:00:00.000Z", [signed(1, 30)], "  ")], "reopened.0.note"],
    // Two branches each reopened Stage 1 from the same sign-off, merged by hand.
    [
      "a sign-off superseded twice",
      [],
      [reopening(1, "2026-11-11T00:00:00.000Z", [signed(1, 30)]), reopening(1, "2026-11-12T00:00:00.000Z", [signed(1, 30)])],
      "reopened.1.superseded.0: the sign-off of Stage 1 at 2026-10-30T00:00:00.000Z is also reopened.0.superseded.0",
    ],
    ["a superseded sign-off still standing", [signed(1, 30)], [reopening(1, "2026-11-11T00:00:00.000Z", [signed(1, 30)])], "signedOff.0: the sign-off of Stage 1"],
    ["fewer Stages standing than the last reopening left", [signed(1, 1)], [reopening(3, "2026-11-11T00:00:00.000Z", [signed(3, 3)])], "signedOff: Stages 1 to 2 stood after Stage 3 was reopened, but only 1 stand now"],
  ])("refuses a history with %s", async (_, signedOff, reopened, issue) => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), JSON.stringify({ signedOff }));
    await writeFile(historyFile(root), JSON.stringify({ reopened }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(issue);
  });

  it("refuses a reopening with fewer Stages standing than the one before it left", async () => {
    const root = await copyOf("field");
    // After Stage 3 was reopened, Stages 1 and 2 stood; the next reopening, of Stage 1, saw only Stage 1.
    await writeFile(stageFile(root), JSON.stringify({ signedOff: [] }));
    await writeFile(historyFile(root), JSON.stringify({ reopened: [reopening(3, "2026-11-11T00:00:00.000Z", [signed(3, 3)]), reopening(1, "2026-11-12T00:00:00.000Z", [signed(1, 1)])] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("reopened.1: Stage 1 was reopened with Stages 1 to 1 signed off, fewer than the 2 that stood after the reopening before it");
  });

  it("reads a history whose times disagree, as two machines' clocks may", async () => {
    const root = await copyOf("field");
    // The sign-off came from a machine running fast: it is dated after the reopening that superseded it.
    await writeFile(stageFile(root), JSON.stringify({ signedOff: [signed(1, 1)] }));
    await writeFile(historyFile(root), JSON.stringify({ reopened: [reopening(2, "2026-10-05T00:00:00.000Z", [signed(2, 9)])] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    expect((await signOff(client, 2)).isError).toBeFalsy();
  });

  it("refuses a history whose superseded sign-offs aren't in order from the Stage reopened", async () => {
    const root = await copyOf("field");
    await writeFile(historyFile(root), JSON.stringify({ reopened: [reopening(2, "2026-11-11T00:00:00.000Z", [signed(3, 31)])] }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(`Invalid Co-design Stage history ${historyFile(root)}: reopened.0.superseded.0.stage: expected Stage 2, got Stage 3`);
  });
});

describe("next-step hints", () => {
  // One test per Stage, each on its own copied Workspace: compiles and previews are slow on Windows (#99).
  const signedOffTo = async (stage: number) => {
    const client = await connect(await copyOf("field"));
    for (let signed = 1; signed < stage; signed++) expect((await signOff(client, signed)).isError).toBeFalsy();
    return async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({ name, arguments: { mission: "lava-field", ...args } });
      expect(reply.isError).toBeFalsy();
      return text(reply).split("\n").find((line) => line.startsWith("Next ("));
    };
  };
  const move = { zone: "field", dx: 0, dy: 0 };

  it("point build tool replies at Beats at Stage 1", async () => {
    const nextLine = await signedOffTo(1);
    for (const name of ["compile_map", "check_layout", "preview"]) expect(await nextLine(name)).toMatch(/^Next \(Stage 1\): .*Beats/);
    expect(await nextLine("move_zone", move)).toMatch(/^Next \(Stage 1\)/);
  });

  it("point build tool replies at preview, check_layout and sign-off at Stage 2", async () => {
    const nextLine = await signedOffTo(2);
    expect(await nextLine("move_zone", move)).toMatch(/^Next \(Stage 2\): .*preview.*check_layout.*sign_off_stage/);
    expect(await nextLine("compile_map")).toMatch(/^Next \(Stage 2\): .*Terrain waits/);
  });

  it("point build tool replies at Anchors at Stage 3", async () => {
    const nextLine = await signedOffTo(3);
    expect(await nextLine("preview")).toMatch(/^Next \(Stage 3\): .*Anchors/);
  });

  it("point build tool replies at test_mission and the Test Document at Stage 4", async () => {
    const nextLine = await signedOffTo(4);
    expect(await nextLine("compile_map")).toMatch(/^Next \(Stage 4\): .*test_mission.*Test Document/);
    expect(await nextLine("test_mission")).toMatch(/^Next \(Stage 4\)/);
  });

  it("point build tool replies past the Stages once every Stage is signed off", async () => {
    const nextLine = await signedOffTo(5);
    expect(await nextLine("check_layout")).toMatch(/^Next \(every Stage signed off\)/);
  });
});

describe("stale sign-offs (#748)", () => {
  const state = async (client: Awaited<ReturnType<typeof connect>>) => {
    const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
    return { reply, stale: (reply.structuredContent as { missions: { stale: unknown[] }[] }).missions[0]!.stale };
  };
  const pack = (root: string) => path.join(root, "missions", "lava-field", "Lava-Field.SC2Map");

  it("records the Blueprint a Stage 1 sign-off covers, and reports it stale once the Blueprint changes", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    await signOff(client, 1);
    expect((await state(client)).stale).toEqual([]);

    const blueprint = path.join(root, "missions", "lava-field", "blueprint.json");
    await writeFile(blueprint, `${await readFile(blueprint, "utf8")}\n`);
    const { reply, stale } = await state(client);
    expect(stale).toEqual([{ stage: 1, changed: ["blueprint.json"], missing: [], added: [] }]);
    expect(text(reply)).toContain("Stale since signed off: Stage 1 (blueprint.json changed).");
    // Reporting changes nothing: the sign-off still stands.
    expect(reply.structuredContent).toMatchObject({ missions: [{ stage: 2, signedOff: [{ stage: 1 }] }] });
  });

  it("covers the Map Package from Stage 3, ignoring its Assets, minimap and the files an Editor save rewrites, and names changed, gone and added files", async () => {
    const root = await copyOf("field");
    await mkdir(path.join(pack(root), "Assets"), { recursive: true });
    await writeFile(path.join(pack(root), "Objects"), "<Objects/>");
    await writeFile(path.join(pack(root), "Regions"), "<Regions/>");
    await writeFile(path.join(pack(root), "Minimap.tga"), "a");
    await writeFile(path.join(pack(root), "ComponentList.SC2Components"), "<Components/>");
    await writeFile(path.join(pack(root), "DocumentHeader"), "a");
    await writeFile(path.join(pack(root), "Assets", "voice.ogg"), "a");
    const client = await connect(root);
    for (const stage of [1, 2, 3]) await signOff(client, stage);
    const record = JSON.parse(await readFile(stageFile(root), "utf8"));
    expect(record.signedOff[1].covers.map((file: { path: string }) => file.path)).toEqual(["blueprint.json"]);
    expect(record.signedOff[2].covers.map((file: { path: string }) => file.path)).toEqual(["Lava-Field.SC2Map/Objects", "Lava-Field.SC2Map/Regions", "blueprint.json"]);

    await writeFile(path.join(pack(root), "Minimap.tga"), "b");
    await writeFile(path.join(pack(root), "ComponentList.SC2Components"), "<Components><DataComponent/></Components>");
    await writeFile(path.join(pack(root), "DocumentHeader"), "b");
    await writeFile(path.join(pack(root), "Assets", "voice.ogg"), "b");
    expect((await state(client)).stale).toEqual([]);

    await writeFile(path.join(pack(root), "Objects"), "<Objects><Unit/></Objects>");
    await rm(path.join(pack(root), "Regions"));
    await writeFile(path.join(pack(root), "Triggers"), "<Triggers/>");
    const { reply, stale } = await state(client);
    expect(stale).toEqual([{ stage: 3, changed: ["Lava-Field.SC2Map/Objects"], missing: ["Lava-Field.SC2Map/Regions"], added: ["Lava-Field.SC2Map/Triggers"] }]);
    expect(text(reply)).toContain("Stage 3 (Lava-Field.SC2Map/Objects changed; Lava-Field.SC2Map/Regions gone; Lava-Field.SC2Map/Triggers added)");
  });

  it("lists a capture_shots folder as stale once a covered file changes, and says to take it again", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const dir = path.join(root, "missions", "lava-field", "output", "shots", "gate");
    await mkdir(dir, { recursive: true });
    const blueprint = path.join(root, "missions", "lava-field", "blueprint.json");
    const covers = [{ path: "blueprint.json", fingerprint: fingerprint(await readFile(blueprint)) }];
    await writeFile(path.join(dir, "shots.json"), JSON.stringify({ covers, shots: [] }));
    const captures = async () => {
      const reply = await client.callTool({ name: "get_session_state", arguments: { mission: "lava-field" } });
      return { reply, staleCaptures: (reply.structuredContent as { missions: { staleCaptures: unknown[] }[] }).missions[0]!.staleCaptures };
    };
    expect((await captures()).staleCaptures).toEqual([]);

    await writeFile(blueprint, `${await readFile(blueprint, "utf8")}\n`);
    const { reply, staleCaptures } = await captures();
    expect(staleCaptures).toEqual([{ name: "gate", changed: ["blueprint.json"], missing: [], added: [] }]);
    expect(text(reply)).toContain("Captures that no longer show the map (a covered file changed): gate; take them again");
  });

  it("never calls a sign-off from before records existed stale", async () => {
    const root = await copyOf("field");
    await writeFile(stageFile(root), JSON.stringify({ signedOff: [{ stage: 1, at: "2026-10-29T00:00:00.000Z" }] }));
    const client = await connect(root);
    await writeFile(path.join(root, "missions", "lava-field", "blueprint.json"), "{}");
    expect((await state(client)).stale).toEqual([]);
  });
});
