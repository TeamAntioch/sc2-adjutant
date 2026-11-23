import { describe, expect, it } from "vitest";

import { ProbeReplyError, parseGameSnapshot, probeGame, snapshotChanges, summariseProbe } from "../../src/host/game-probe.js";

const reply = (displayTime: number, ...results: string[]) => ({
  isReplay: false,
  displayTime,
  players: results.map((result, i) => ({ id: i + 1, name: `P${i + 1}`, type: i ? "computer" : "user", race: "Terr", result })),
});

/** A scripted endpoint and a fake clock that moves a second per poll. */
function scripted(replies: (unknown | Error)[]) {
  let clock = 0;
  let call = 0;
  return {
    fetchJson: async () => {
      const next = replies[Math.min(call++, replies.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => clock,
    sleep: async (ms: number) => void (clock += ms),
  };
}

describe("game probe", () => {
  it("refuses a reply that is not the shape seen on the Mac", () => {
    expect(() => parseGameSnapshot(null)).toThrow(/object/);
    expect(() => parseGameSnapshot({ players: [] })).toThrow(/displayTime/);
    expect(() => parseGameSnapshot({ displayTime: 1 })).toThrow(/players/);
  });

  it("names a result change and a player joining, and nothing for a rising clock", () => {
    const a = parseGameSnapshot(reply(5, "Undecided", "Undecided"));
    expect(snapshotChanges(a, parseGameSnapshot(reply(9, "Undecided", "Undecided")))).toBeUndefined();
    expect(snapshotChanges(a, parseGameSnapshot(reply(9, "Victory", "Defeat")))?.changes).toEqual(["player 1 P1: Undecided -> Victory", "player 2 P2: Undecided -> Defeat"]);
    expect(snapshotChanges(undefined, a)?.kind).toBe("players");
  });

  it("records the first reply, the result change and the end, and answers the open question", async () => {
    const events = await probeGame({ durationMs: 10_000, ...scripted([reply(0), reply(3, "Undecided"), reply(6, "Undecided"), reply(9, "Victory")]), stopWhenDecided: true });
    expect(events.map((event) => event.kind)).toEqual(["first", "players", "result", "stopped"]);
    expect(summariseProbe(events)).toContain("Undecided -> Victory");
  });

  it("says liveness only when no result moves, and says so when nothing answered", async () => {
    const live = await probeGame({ durationMs: 3000, ...scripted([reply(1, "Undecided"), reply(2, "Undecided")]) });
    expect(summariseProbe(live)).toContain("liveness only");
    const dead = await probeGame({ durationMs: 3000, ...scripted([new Error("ECONNREFUSED")]) });
    expect(dead.map((event) => event.kind)).toEqual(["stopped"]);
    expect(summariseProbe(dead)).toContain("never answered");
  });

  it("notes the game closing after it had answered", async () => {
    const events = await probeGame({ durationMs: 4000, ...scripted([reply(1, "Undecided"), new Error("down")]) });
    expect(events.map((event) => event.kind)).toContain("unreachable");
  });

  it("records a reply of the wrong shape with its body and carries on", async () => {
    const events = await probeGame({ durationMs: 5000, ...scripted([{ nope: true }, { nope: true }, reply(2, "Undecided"), reply(3, "Victory")]) });
    expect(events.map((event) => event.kind)).toEqual(["unparseable", "first", "result", "stopped"]);
    expect(events[0]!.raw).toBe('{"nope":true}');
  });

  it("recovers: a first answer, a bad reply, then answers again", async () => {
    const events = await probeGame({ durationMs: 5000, ...scripted([reply(1, "Undecided"), "garbage", reply(3, "Undecided"), reply(4, "Defeat")]) });
    expect(events.map((event) => event.kind)).toEqual(["first", "unparseable", "result", "stopped"]);
  });

  it("records a non-OK status once while it lasts, and a body that is not JSON as unreadable", async () => {
    const status = new ProbeReplyError("status", "HTTP 503", "busy");
    const events = await probeGame({ durationMs: 4000, ...scripted([status, status, status, reply(5, "Undecided")]) });
    expect(events.map((event) => event.kind)).toEqual(["status", "first", "stopped"]);
    expect(events[0]).toMatchObject({ changes: ["HTTP 503"], raw: "busy" });
    const unreadable = await probeGame({ durationMs: 2000, ...scripted([new ProbeReplyError("unreadable", "the body is not JSON", "<html>")]) });
    expect(unreadable[0]!.kind).toBe("unreadable");
    expect(summariseProbe(unreadable)).toContain("never with a usable");
  });
});
