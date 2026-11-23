// Search (#983): the Pagefind index the build writes to site/out/pagefind/ after `next build`
// (the test script builds first), queried the way the site's search box queries it. Pagefind's
// pagefind.js fetches its index over HTTP, so the test serves site/out/ for it.
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Reference } from "../lib/reference-types";
import { KINDS, type Kind, type Pagefind, type PagefindResult } from "../lib/search";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(SITE, "out");
const reference = JSON.parse(readFileSync(path.join(SITE, ".generated", "reference.json"), "utf8")) as Reference;

let server: Server;
let pagefind: Pagefind;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const file = path.join(OUT, decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname));
    const info = await stat(file).catch(() => undefined);
    if (!file.startsWith(OUT + path.sep) || !info?.isFile()) return void response.writeHead(404).end();
    response.writeHead(200).end(await readFile(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  pagefind = (await import(pathToFileURL(path.join(OUT, "pagefind", "pagefind.js")).href)) as Pagefind;
  await pagefind.options({ basePath: `http://127.0.0.1:${port}/pagefind/` });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** A hit's page, as the site links it: /tools/move_zone/. */
const pageOf = (url: string) => new URL(url).pathname;

/** The pages a query finds, best first, with their kinds. */
async function find(query: string | null, kind?: Kind) {
  const { results } = await pagefind.search(query, kind ? { filters: { kind } } : {});
  return Promise.all(results.map(async (result: PagefindResult) => {
    const data = await result.data();
    return { page: pageOf(data.url), kind: data.filters.kind?.[0], content: data.content };
  }));
}

describe("search", () => {
  it("has a Pagefind index in the static export", () => {
    expect(existsSync(path.join(OUT, "pagefind", "pagefind.js"))).toBe(true);
    expect(existsSync(path.join(OUT, "pagefind", "pagefind-entry.json"))).toBe(true);
  });

  it("finds a tool by what it does, without its name: \"move a Zone\" finds move_zone first", async () => {
    const [first] = await find("move a Zone");
    expect(first).toMatchObject({ page: "/tools/move_zone/", kind: "Tool" });
  });

  it("finds a tool by words from its description alone", async () => {
    const tool = reference.tools.find(({ name }) => name === "move_zone")!;
    expect(tool.title).not.toMatch(/editor region/i);
    expect(tool.description).toMatch(/Editor region/);
    const hits = await find("Editor region");
    expect(hits.map(({ page }) => page)).toContain("/tools/move_zone/");
  });

  it("indexes every tool, skill, command and tutorial page, each under its kind", async () => {
    const filters = await pagefind.filters();
    expect(filters.kind).toEqual({
      Tool: reference.tools.length,
      Skill: reference.skills.length,
      Command: reference.commands.length,
      Tutorial: reference.tutorials.length,
    });
    expect(Object.keys(filters.kind ?? {}).sort()).toEqual([...KINDS].sort());
  });

  it("finds each kind", async () => {
    const queries: Record<Kind, { query: string; page: string }> = {
      Tool: { query: "compile a Mission", page: "/tools/compile_map/" },
      Skill: { query: "level design", page: "/skills/level-design/" },
      Command: { query: "check every Mission", page: "/commands/check/" },
      Tutorial: { query: "melee map", page: "/tutorials/melee-map/" },
    };
    for (const kind of KINDS) {
      const hits = await find(queries[kind].query, kind);
      expect(hits.map(({ page }) => page), kind).toContain(queries[kind].page);
      for (const hit of hits) expect(hit.kind, hit.page).toBe(kind);
    }
  });

  it("indexes no other page: not the home page, the install page or the section lists", async () => {
    const pages = (await find(null)).map(({ page }) => page);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of ["/", "/install/", "/tutorials/", "/tools/", "/skills/", "/commands/"]) expect(pages).not.toContain(page);
  });

  it("leaves the shell, the page tree, on-this-page and the objectives rail out of every page's text", async () => {
    const hits = await find(null);
    expect(hits.length).toBeGreaterThan(0);
    // The rail lists each tutorial as its title then its minutes; prose may name another tutorial,
    // but not like that. Spaces go, since Pagefind may join the two spans without one.
    const squeezed = (text: string) => text.replace(/\s+/g, "");
    const railEntries = reference.tutorials.map(({ title, minutes }) => squeezed(`${title} ${minutes} min`));
    for (const hit of hits) {
      for (const chrome of ["Built from sc2-adjutant", "Search tools", "On this page", "Elsewhere", "Mapping Reference", "All tools"]) {
        expect(hit.content, `${hit.page} has "${chrome}"`).not.toContain(chrome);
      }
      if (hit.kind === "Tutorial") {
        for (const entry of railEntries) expect(squeezed(hit.content), `${hit.page} has the rail's "${entry}"`).not.toContain(entry);
        expect(hit.content, `${hit.page} has a tool call's "tool page" link`).not.toContain("tool page");
      }
    }
  });

  it("leaves a tutorial's tool-call arguments out: they are code, full of numbers", async () => {
    const hits = await find(null, "Tutorial");
    expect(hits).toHaveLength(reference.tutorials.length);
    for (const hit of hits) {
      const html = readFileSync(path.join(OUT, hit.page, "index.html"), "utf8");
      // A tool call's arguments as JSON (a patch), and its short ones on the tool's line.
      for (const args of html.matchAll(/<pre data-args[^>]*>([^<]+)</g)) {
        const firstKey = /&quot;([^&]+)&quot;:/.exec(args[1]!)?.[1];
        if (firstKey) expect(hit.content, hit.page).not.toContain(`"${firstKey}":`);
      }
      expect(hit.content, hit.page).not.toMatch(/\w+: "[^"]*" ·/);
    }
  });
});
