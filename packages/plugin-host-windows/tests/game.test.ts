// Polling the game's processes: a check whose helper failed once is unknown, not "no game", and only
// failures in a row give up.
import { describe, expect, it } from "vitest";

import { firstAnswer, tolerantCheck } from "../game.ts";

/** A check that gives these answers in turn, an Error being a failure. */
function answers(...results: (string[] | Error)[]): () => Promise<string[]> {
  return async () => {
    const next = results.shift();
    if (next === undefined) throw new Error("asked too often");
    if (next instanceof Error) throw next;
    return next;
  };
}

describe("a tolerant check", () => {
  it("reads an isolated failure as unknown, and counts failures only in a row", async () => {
    const check = tolerantCheck(answers(["7"], new Error("once"), new Error("twice"), [], new Error("again"), new Error("and again"), ["8"]), 3);
    expect(await check()).toEqual(["7"]);
    expect(await check()).toBeUndefined();
    expect(await check()).toBeUndefined();
    expect(await check()).toEqual([]);
    expect(await check()).toBeUndefined();
    expect(await check()).toBeUndefined();
    expect(await check()).toEqual(["8"]);
  });

  it("gives up with the last error after so many failures in a row", async () => {
    const check = tolerantCheck(answers(new Error("one"), new Error("two"), new Error("three")), 3);
    await check();
    await check();
    await expect(check()).rejects.toThrow("three");
  });

  it("waits out isolated failures for a first answer", async () => {
    expect(await firstAnswer(tolerantCheck(answers(new Error("one"), ["7"]), 3))).toEqual(["7"]);
    await expect(firstAnswer(tolerantCheck(answers(new Error("one"), new Error("two")), 2))).rejects.toThrow("two");
  });
});
