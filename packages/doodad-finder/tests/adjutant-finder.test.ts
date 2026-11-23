// sc2-adjutant's Finder as its CLI starts it: the public start function with adjutantOptions, on a
// copy of the `crossing` fixture Workspace. With an object named, the ranker gets its title, its
// ticks are kept in its search.json as they come, a Search Part's line can be edited there, and an
// unfinished Doodad Search can be reopened. A fake embeddings model and a fake ranker; no calls.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DoodadSearchFileSchema } from "@team-antioch/sc2-adjutant/dist/catalog/doodad-search-page.js";
import { writeDoodadSearchPage } from "@team-antioch/sc2-adjutant/dist/catalog/write-doodad-search-page.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adjutantOptions } from "../src/adjutant/options.ts";
import type { Grade, Ranker, RankRequest } from "@team-antioch/sc2-doodad-finder/ranker.js";
import { type RunningFinder, startFinder } from "@team-antioch/sc2-doodad-finder/start.js";
import { fakeEmbedder } from "./fake-embedder.ts";
import { sources } from "./fixtures.ts";

const CROSSING = fileURLToPath(new URL("../../core/tests/fixtures/workspaces/crossing/", import.meta.url));

let dir: string;
let root: string;
let running: RunningFinder | undefined;
const asked: RankRequest[] = [];
const copied: string[] = [];

/** Grades every card 2.2, keeping what it was asked. */
const ranker: Ranker = {
  name: "jev",
  async rank(request) {
    asked.push(request);
    const grades = new Map<string, Grade>(request.candidates.map((card) => [card.id, { level: 2.2 }]));
    return { ranker: "jev", model: "fake", grades, timings: { request: 1, total: 1 }, usage: { input: 1, output: 0 }, cost: 0.0001 };
  },
};

beforeEach(async () => {
  asked.length = 0;
  copied.length = 0;
  dir = await mkdtemp(path.join(tmpdir(), "doodad-finder-adjutant-"));
  root = path.join(dir, "workspace");
  await cp(CROSSING, root, { recursive: true });
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  await rm(dir, { recursive: true, force: true });
});

const start = async () => {
  const options = await adjutantOptions(root, { researchDir: path.join(dir, "research"), copy: async (text) => void copied.push(text), cacheDir: path.join(dir, "cache") });
  running = await startFinder({ ...options, cacheDir: path.join(dir, "cache"), embedder: fakeEmbedder(), ranker, port: 0 });
  return running;
};

const post = async (route: string, body: unknown = {}) => {
  const response = await fetch(new URL(route, running!.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

const state = async () => (await (await fetch(new URL("/state", running!.url))).json()) as Record<string, any>;

/** The first event of a kind after a request, read from the event stream. */
async function nextEvent(name: string, after: () => Promise<unknown>): Promise<any> {
  const controller = new AbortController();
  const response = await fetch(new URL("/events", running!.url), { signal: controller.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  await after();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The events ended");
      buffer += value;
      for (const block of buffer.split("\n\n").slice(0, -1)) if (new RegExp(`^event: ${name}$`, "m").test(block)) return JSON.parse(/^data: (.*)$/m.exec(block)![1]!);
    }
  } finally {
    controller.abort();
  }
}

const ranked = (text: string) => nextEvent("ranked", () => post("/ask", { text, mode: "enter" }));
const searchFile = (slug: string) => path.join(root, "missions", "ashen-crossing", "output", "doodad-search", slug, "search.json");
const readSearch = async (slug: string) => DoodadSearchFileSchema.parse(JSON.parse(await readFile(searchFile(slug), "utf8")));

describe("sc2-adjutant's Finder with an object", () => {
  it("gives the ranker the object's title as context", async () => {
    await start();
    expect((await post("/object", { title: "Crushing press" })).status).toBe(200);
    await ranked("supply crate");
    expect(asked.at(-1)).toMatchObject({ ask: "supply crate", object: "Crushing press" });
  });

  it("keeps each tick in the object's search.json for its Mission, and an edited line lands there", async () => {
    await start();
    await post("/choose", { choice: "ashen-crossing" });
    await post("/object", { title: "Crushing press" });
    const [first, second] = (await ranked("supply crate")).cards as { id: string }[];
    await post("/tick", { ask: "supply crate", id: first!.id, ticked: true });
    await post("/tick", { ask: "supply crate", id: second!.id, ticked: true });
    expect((await readSearch("crushing-press")).parts).toMatchObject([
      { name: "supply crate", readsAs: "supply crate", shortlist: [{ id: first!.id, level: 2, ranker: "jev" }, { id: second!.id, level: 2 }], asks: [{ text: "supply crate", ranker: "jev" }] },
    ]);

    const edited = await post("/line", { ask: "supply crate", line: "a crate stacked beside the press" });
    expect(edited.status).toBe(200);
    expect(edited.body.tray.asks).toEqual([{ ask: "supply crate", line: "a crate stacked beside the press" }]);
    const written = await readSearch("crushing-press");
    expect(written).toMatchObject({ title: "Crushing press", mission: "ashen-crossing" });
    expect(written.parts).toMatchObject([{ name: "supply crate", readsAs: "a crate stacked beside the press" }]);

    expect((await post("/line", { ask: "supply crate", line: "  " })).status).toBe(400);
    expect((await post("/line", { ask: "never asked", line: "anything" })).status).toBe(400);
  });

  it("reopens an unfinished Doodad Search: its ticks and lines in the tray, its title for the ranker, what the skill judged kept", async () => {
    await start();
    await post("/choose", { choice: "ashen-crossing" });
    // Ticked before the object was named: the tray's cards go into it, ranked for their level.
    const [first, second] = (await nextEvent("narrowed", () => post("/ask", { text: "supply crate", mode: "type" }))).cards as { id: string }[];
    await post("/tick", { ask: "supply crate", id: first!.id, ticked: true });
    await post("/object", { title: "Crushing press" });
    await post("/line", { ask: "supply crate", line: "a crate beside the press" });
    const away = await post("/put-away");
    expect(away.body.tray.items).toEqual([]);
    expect(away.body.objects).toMatchObject({ label: "Object", open: null, unfinished: [{ key: path.dirname(searchFile("crushing-press")), title: "Crushing press", choice: "ashen-crossing", ticked: 1 }] });

    // The skill judges a part meanwhile; reopening keeps it.
    const judged = JSON.parse(await readFile(searchFile("crushing-press"), "utf8"));
    judged.parts.push({ name: "press head", readsAs: "the press's head", queries: [], candidates: [{ id: second!.id, note: "the right shape", judgedFrom: "sheet" }], alsoConsidered: [], shortlist: [] });
    await writeFile(searchFile("crushing-press"), JSON.stringify(judged));

    const reopened = await post("/reopen", { key: away.body.objects.unfinished[0].key });
    expect(reopened).toMatchObject({ status: 200 });
    expect(reopened.body.objects.open).toEqual({ title: "Crushing press", choice: "ashen-crossing" });
    expect(reopened.body.badges.chosen).toBe("ashen-crossing");
    expect(reopened.body.tray.items).toMatchObject([{ id: first!.id, ask: "supply crate", level: 2 }]);
    expect(reopened.body.tray.asks).toEqual([{ ask: "supply crate", line: "a crate beside the press" }]);

    await ranked("supply crate");
    expect(asked.at(-1)).toMatchObject({ object: "Crushing press" });
    await post("/tick", { ask: "supply crate", id: second!.id, ticked: true });
    const written = await readSearch("crushing-press");
    expect(written.parts).toMatchObject([
      { name: "supply crate", readsAs: "a crate beside the press", shortlist: [{ id: first!.id }, { id: second!.id }] },
      { name: "press head", candidates: [{ id: second!.id }] },
    ]);
    // Only one object at a time, and its Mission stays while it is open.
    expect((await post("/object", { title: "Another" })).status).toBe(409);
    expect((await post("/choose", { choice: null })).status).toBe(409);
  });

  it("files a tick from any of a reopened part's asks under that part, keeping what the skill writes while it is open", async () => {
    await start();
    expect((await post("/put-away")).status).toBe(409);
    await post("/choose", { choice: "ashen-crossing" });
    await post("/object", { title: "Crushing press" });
    const [first, second, third] = (await ranked("supply crate")).cards as { id: string }[];
    await post("/tick", { ask: "supply crate", id: first!.id, ticked: true });
    await post("/put-away");

    // The skill gives the part a second ask, and judges another part.
    const edited = JSON.parse(await readFile(searchFile("crushing-press"), "utf8"));
    edited.parts[0].asks.push({ text: "crate", tags: [], ranker: "jev" });
    await writeFile(searchFile("crushing-press"), JSON.stringify(edited));
    const { key } = (await state()).objects.unfinished[0];
    expect((await post("/reopen", { key })).status).toBe(200);

    const judged = JSON.parse(await readFile(searchFile("crushing-press"), "utf8"));
    judged.parts.push({ name: "press head", readsAs: "the press's head", queries: [], candidates: [{ id: third!.id, note: "the right shape", judgedFrom: "sheet" }], alsoConsidered: [], shortlist: [] });
    await writeFile(searchFile("crushing-press"), JSON.stringify(judged));

    await ranked("supply crate");
    await post("/tick", { ask: "supply crate", id: second!.id, ticked: true });
    await ranked("crate");
    await post("/tick", { ask: "crate", id: third!.id, ticked: true });
    const written = await readSearch("crushing-press");
    expect(written.parts).toMatchObject([
      { name: "supply crate", shortlist: [{ id: first!.id }, { id: second!.id }, { id: third!.id }], asks: [{ text: "supply crate" }, { text: "crate" }] },
      { name: "press head", candidates: [{ id: third!.id }] },
    ]);
  });

  it("hands the object's search.json to the doodad-search skill on look closer, and puts it away", async () => {
    await start();
    await post("/object", { title: "Crates" });
    const [first] = (await ranked("supply crate")).cards as { id: string }[];
    await post("/tick", { ask: "supply crate", id: first!.id, ticked: true });
    const done = await post("/action", { index: 0, inputs: {} });
    expect(done.status).toBe(200);
    const file = path.join(dir, "research", "doodad-search", "crates", "search.json");
    expect(done.body.done).toMatchObject({ copied: true, putAway: true, text: copied[0] });
    expect(copied[0]).toContain(file);
    expect(done.body.objects).toMatchObject({ open: null, unfinished: [{ title: "Crates", ticked: 1 }] });
    expect(done.body.tray.items).toEqual([]);
    expect(DoodadSearchFileSchema.parse(JSON.parse(await readFile(file, "utf8")))).toMatchObject({ title: "Crates", parts: [{ shortlist: [{ id: first!.id }] }] });
    // The page waits for the skill to judge the shortlist.
    await expect(writeDoodadSearchPage(path.dirname(file), sources())).rejects.toThrow(/unjudged shortlist/);
  });

  it("refuses look closer with no object named", async () => {
    await start();
    const [first] = (await ranked("supply crate")).cards as { id: string }[];
    await post("/tick", { ask: "supply crate", id: first!.id, ticked: true });
    const refused = await post("/action", { index: 0, inputs: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Name the object first/);
  });
});
