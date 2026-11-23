// Doodad Search's page (src/catalog/doodad-search-page.ts): search.json's schema, the page built
// from it with the catalogs' facts, and the sheets its candidates could have. Synthetic catalogs.
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { withCampaignMod } from "../../src/catalog/workspace-doodad-search.js";
import { buildDoodadSearchPage, parseDoodadSearch } from "../../src/catalog/doodad-search-page.js";
import { type DoodadSearchSources, lookUpDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { buildSheetsFor, doodadSearchFolder, writeDoodadSearchPage } from "../../src/catalog/write-doodad-search-page.js";

const execFileAsync = promisify(execFile);
const hasMontage = (() => {
  try {
    execFileSync("montage", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const VOID_CAMPAIGN = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";

const DOODADS: DoodadSearchSources["doodads"] = {
  FoundryStamperHead: {
    name: "Foundry Stamper Head",
    package: "campaigns/swarm.sc2campaign",
    variations: 3,
    image: "Foundry_Stamper_Head.jpg",
    description: { look: "heavy steel press head on a piston", kind: "built", size: "medium", role: "prop", story: ["industry"], biome: ["urban"] },
  },
  MossyBoulder: {
    name: "Mossy Boulder",
    package: "mods/liberty.sc2mod",
    variations: 1,
    image: "Mossy Boulder.jpg",
    description: { look: "round boulder under moss", kind: "natural", size: "large", role: "prop", story: ["wild"], biome: ["jungle"] },
  },
  StoryPressTank: { name: "Story Press Tank", package: "campaigns/voidstory.sc2campaign", variations: 2 },
};

const TERRAIN_OBJECTS: DoodadSearchSources["terrainObjects"] = {
  FoundryPressPit0: {
    name: "Foundry Press Pit (Height 0)",
    package: "campaigns/liberty.sc2campaign",
    model: "Assets/TerrainObjects/FoundryPressPit/FoundryPressPit.m3",
    description: { look: "sunken pit under a press", kind: "built", use: "pit", story: ["industry"], biome: ["urban"] },
  },
};

/** Synthetic catalogs in a temporary core folder, with the stamper head's sheet built there. */
async function sources(): Promise<DoodadSearchSources> {
  // Real, as sheet paths are: the system's temporary folder may be a link (macOS's /var).
  root = await realpath(await mkdtemp(path.join(tmpdir(), "doodad-search-page-")));
  await mkdir(path.join(root, "catalog-sheets/doodads"), { recursive: true });
  await writeFile(path.join(root, "catalog-sheets/doodads/FoundryStamperHead.jpg"), "sheet");
  return { doodads: DOODADS, terrainObjects: TERRAIN_OBJECTS, root };
}

/** The text of the HTML, tags dropped and whitespace squeezed, to read the page as the author does. */
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A two-part search for a crushing press over a conveyor, as an agent writes search.json. */
const SEARCH = {
  title: "Crushing press over a conveyor",
  parts: [
    {
      name: "press head",
      readsAs: "a heavy flat block that drops onto the belt; looks like it could crush a Marine",
      queries: [{ words: ["press", "head"], kind: "built" }, { words: ["stamp"] }],
      candidates: [
        { id: "FoundryStamperHead", note: "Flat steel head on a piston: reads as a press from every side.", judgedFrom: "sheet", variationsChecked: [{ variation: 1, note: "Same head, rusted." }] },
        { id: "MossyBoulder", note: "Heavy, but round: a last resort.", judgedFrom: "image" },
      ],
      alsoConsidered: [{ id: "StoryPressTank", reason: "A tank, not a head." }],
    },
    {
      name: "frame",
      readsAs: "a gantry the head hangs from, spanning the belt",
      queries: [{ words: ["frame", "gantry"] }],
      candidates: [{ id: "FoundryPressPit0", note: "A pit, not a frame, but it could sit under the belt.", judgedFrom: "none" }],
    },
  ],
};

describe("parseDoodadSearch", () => {
  it("reads search.json's Search Parts, queries, ranked candidates and also-considered list, and names the file and field when one is wrong", () => {
    const search = parseDoodadSearch(SEARCH, "search.json");
    expect(search.parts.map((part) => part.name)).toEqual(["press head", "frame"]);
    expect(search.parts[1]!.alsoConsidered).toEqual([]);
    expect(search.parts[0]!.candidates[0]!.variationsChecked).toEqual([{ variation: 1, note: "Same head, rusted." }]);

    // A query's roles are a list, as search_doodads takes them; a search.json written with one role still reads.
    const roles = parseDoodadSearch({ ...SEARCH, parts: [{ ...SEARCH.parts[0]!, queries: [{ role: ["prop", "clutter"] }, { role: "structure" }] }] }, "search.json");
    expect(roles.parts[0]!.queries.map((query) => query.role)).toEqual([["prop", "clutter"], ["structure"]]);
    expect(() => parseDoodadSearch({ ...SEARCH, parts: [{ ...SEARCH.parts[0]!, candidates: [{ id: "FoundryStamperHead", variation: -1, note: "n", judgedFrom: "sheet" }] }] }, "search.json")).toThrow(
      /parts\.0\.candidates\.0\.variation: /,
    );

    const wrong = { ...SEARCH, parts: [{ ...SEARCH.parts[0]!, candidates: [{ id: "FoundryStamperHead", note: "", judgedFrom: "a hunch" }] }] };
    expect(() => parseDoodadSearch(wrong, "/x/search.json")).toThrow(/Invalid doodad search \/x\/search\.json: parts\.0\.candidates\.0\.note: .*; parts\.0\.candidates\.0\.judgedFrom: /);
    // A Search Part shows at most ten cards.
    const crowded = { ...SEARCH, parts: [{ ...SEARCH.parts[0]!, candidates: Array.from({ length: 11 }, (_, i) => ({ id: `D${i}`, note: "n", judgedFrom: "none" })) }] };
    expect(() => parseDoodadSearch(crowded, "search.json")).toThrow(/parts\.0\.candidates: /);
  });

  it("reads an old search.json unchanged: no shortlist or asks appear", () => {
    expect(parseDoodadSearch(SEARCH, "search.json")).toEqual({ ...SEARCH, parts: [SEARCH.parts[0], { ...SEARCH.parts[1], alsoConsidered: [] }] });
  });

  it("reads a Search Part the Doodad Finder started: a shortlist with each ranker's level, the asks that found it, and no candidates yet", () => {
    const early = {
      title: "Crushing press over a conveyor",
      mission: "ashen-crossing",
      parts: [
        {
          name: "press head",
          readsAs: "industrial press head",
          candidates: [],
          shortlist: [
            { id: "FoundryStamperHead", level: 3, ranker: "jev" },
            { id: "StoryPressTank", level: 1, ranker: "jev" },
          ],
          asks: [{ text: "industrial press head", tags: [{ facet: "story", value: "industry", pinned: true }, { facet: "kind", value: "built" }], ranker: "jev" }],
        },
      ],
    };
    const [part] = parseDoodadSearch(early, "search.json").parts;
    expect(part).toMatchObject({ candidates: [], shortlist: early.parts[0]!.shortlist, asks: early.parts[0]!.asks, queries: [], alsoConsidered: [] });

    const withPart = (changes: object) => ({ ...early, parts: [{ ...early.parts[0]!, ...changes }] });
    // A level is the ranker's Score, 0 to 3; the ranker is Jev (Haiku was removed, #678); every part still says what it reads as.
    expect(() => parseDoodadSearch(withPart({ shortlist: [{ id: "FoundryStamperHead", level: 4, ranker: "jev" }] }), "search.json")).toThrow(/parts\.0\.shortlist\.0\.level: /);
    expect(() => parseDoodadSearch(withPart({ shortlist: [{ id: "FoundryStamperHead", level: 2, ranker: "gpt" }] }), "search.json")).toThrow(/parts\.0\.shortlist\.0\.ranker: /);
    expect(() => parseDoodadSearch(withPart({ shortlist: [{ id: "FoundryStamperHead", level: 2, ranker: "haiku" }] }), "search.json")).toThrow(/parts\.0\.shortlist\.0\.ranker: /);
    expect(() => parseDoodadSearch(withPart({ asks: [{ text: "", tags: [], ranker: "jev" }] }), "search.json")).toThrow(/parts\.0\.asks\.0\.text: /);
    // An ask find_doodads only narrowed (rank false, or no ranker on) has no ranker.
    expect(parseDoodadSearch(withPart({ asks: [{ text: "press head", tags: [] }] }), "search.json").parts[0]!.asks).toEqual([{ text: "press head", tags: [] }]);
    expect(() => parseDoodadSearch(withPart({ asks: [{ text: "press head", tags: [], ranker: "gpt" }] }), "search.json")).toThrow(/parts\.0\.asks\.0\.ranker: /);
    const { readsAs: _readsAs, ...unread } = early.parts[0]!;
    expect(() => parseDoodadSearch({ ...early, parts: [unread] }, "search.json")).toThrow(/parts\.0\.readsAs: /);
  });
});

describe("buildDoodadSearchPage", () => {
  it("builds a page from a fixture search.json: a section per Search Part, a card per candidate with the catalogs' facts, the also-considered list folded, and a pointer to a Doodad Composite", async () => {
    const from = await sources();
    const search = parseDoodadSearch(SEARCH, "search.json");
    const ids = search.parts.flatMap((part) => [...part.candidates, ...part.alsoConsidered].map((candidate) => candidate.id));
    const html = buildDoodadSearchPage(search, lookUpDoodads(ids, from, [VOID_CAMPAIGN]));

    expect(html).toMatch(/^<!doctype html>/i);
    // Only the pictures sit on the sheets' mid-grey; the page itself is light.
    expect(html).toMatch(/\.picture \{[^}]*background: #808080/);
    expect(html).not.toMatch(/body \{[^}]*background: #808080/);
    // Clicking a picture opens it large in a dialog.
    expect(html).toContain('<dialog class="zoom">');
    expect(html).toMatch(/closest\("img\.picture"\)[\s\S]*showModal\(\)/);
    const sheet = pathToFileURL(path.join(from.root, "catalog-sheets/doodads/FoundryStamperHead.jpg")).href;
    // The sheet by its file URL, the gallery picture by its URL: neither is copied.
    expect(html).toContain(`<img src="${sheet}"`);
    expect(html).toContain('<img src="https://raw.githubusercontent.com/TeamAntioch/sc2-mapping-reference/main/public/doodads/Mossy%20Boulder.jpg"');

    const page = textOf(html);
    expect(page).toContain("Doodad Search: Crushing press over a conveyor");
    const [, pressHead, frame] = page.split(/(?=Search Part \d)/);
    expect(pressHead).toMatch(/^Search Part 1: press head Reads as: a heavy flat block that drops onto the belt; looks like it could crush a Marine Searched: press head \(kind built\); stamp /);
    expect(pressHead).toContain(
      "1. Foundry Stamper Head FoundryStamperHead medium · needs Void (Campaign), which the Mission has · 3 variations · variation 00 shown · judged from its sheet Flat steel head on a piston: reads as a press from every side. Variation 01 checked: Same head, rusted.",
    );
    expect(pressHead).toContain("2. Mossy Boulder MossyBoulder large · needs no dependency · 1 variation · judged from one angle (gallery picture) Heavy, but round: a last resort.");
    expect(pressHead).toMatch(/Also considered \(1\) Story Press Tank StoryPressTank ?: A tank, not a head\./);
    expect(html).toMatch(/<details>\s*<summary>Also considered \(1\)<\/summary>/);
    expect(frame).toContain("1. Foundry Press Pit (Height 0) FoundryPressPit0 pit · needs Void (Campaign), which the Mission has · 1 variation · unpictured A pit, not a frame");
    expect(frame).not.toContain("Also considered");
    expect(page).toMatch(/Next: .*Doodad Composite/);
  });

  it("escapes what the agent wrote, says which needs the Mission lacks, and keeps a card for an id no catalog has", async () => {
    const from = await sources();
    const search = parseDoodadSearch(
      {
        title: "Lamps <script>",
        mission: "ashen-crossing",
        parts: [
          {
            name: "lamp",
            readsAs: "a light & a post",
            candidates: [
              { id: "StoryPressTank", note: 'Not a lamp, "really".', judgedFrom: "render" },
              { id: "GoneDoodad", note: "Was here once.", judgedFrom: "none" },
            ],
          },
        ],
      },
      "search.json",
    );
    const html = buildDoodadSearchPage(search, lookUpDoodads(["StoryPressTank", "GoneDoodad"], from, []));
    // The only script is the page's own zoom script; the title's is escaped.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain("Lamps &lt;script&gt;");
    const page = textOf(html);
    expect(page).toContain("for the Mission ashen-crossing");
    expect(page).toContain("1. Story Press Tank StoryPressTank needs Void Story (Campaign), which the Mission lacks · 2 variations · judged from a render");
    expect(page).toContain("2. GoneDoodad not in the catalogs Was here once.");
  });
});

describe("a candidate's chosen variation", () => {
  const search = (candidates: unknown[]) => parseDoodadSearch({ title: "Press", parts: [{ name: "press head", readsAs: "a heavy block", candidates }] }, "search.json");

  it("shows the chosen variation's picture from the search's renders, and says which variation each card shows", async () => {
    const from = await sources();
    const parsed = search([
      { id: "FoundryStamperHead", variation: 2, note: "Use variation 02: the bare head.", judgedFrom: "render" },
      { id: "StoryPressTank", variation: 1, note: "Variation 01 is the clean one.", judgedFrom: "none" },
      { id: "MossyBoulder", note: "Round.", judgedFrom: "image" },
    ]);
    expect(parsed.parts[0]!.candidates[0]!.variation).toBe(2);
    const renders: Record<string, string> = { "FoundryStamperHead:2": "/s/renders/FoundryStamperHead_02.jpg" };
    const html = buildDoodadSearchPage(parsed, lookUpDoodads(["FoundryStamperHead", "StoryPressTank", "MossyBoulder"], from), (id, variation) => renders[`${id}:${variation}`]);
    expect(html).toContain(`<img src="${pathToFileURL("/s/renders/FoundryStamperHead_02.jpg").href}"`);
    const page = textOf(html);
    expect(page).toContain("3 variations · variation 02 shown · judged from a render Use variation 02");
    // No picture of the chosen variation here: the card says so.
    expect(page).toContain("2 variations · variation 01 chosen, not pictured here · unpictured Variation 01");
    // The gallery picture's variation isn't known, so the card names none.
    expect(page).toMatch(/1 variation · judged from one angle \(gallery picture\) Round\./);
  });

  it("falls back to the catalog's sheet of variation 00 when the chosen one isn't rendered, and shows a rendered Campaign Mod doodad", async () => {
    const from = withCampaignMod(await sources(), { ...EMPTY_CATALOG, doodads: new Map([["LanternRig", { variations: 1 }]]) });
    const parsed = search([
      { id: "FoundryStamperHead", variation: 1, note: "Rusted.", judgedFrom: "sheet" },
      { id: "LanternRig", note: "Rendered for the search.", judgedFrom: "render" },
    ]);
    const html = buildDoodadSearchPage(parsed, lookUpDoodads(["FoundryStamperHead", "LanternRig"], from), (id, variation) =>
      id === "LanternRig" && variation === 0 ? "/s/renders/LanternRig_00_a0.png" : undefined,
    );
    expect(html).toContain(`<img src="${pathToFileURL(path.join(from.root, "catalog-sheets/doodads/FoundryStamperHead.jpg")).href}"`);
    expect(html).toContain(`<img src="${pathToFileURL("/s/renders/LanternRig_00_a0.png").href}"`);
    const page = textOf(html);
    expect(page).toContain("3 variations · variation 01 chosen, not pictured here; variation 00 shown · judged from its sheet Rusted.");
    // A first-angle render is one angle, and the card says so.
    // The mod's doodad index hasn't described it yet, and the card says so.
    expect(page).toContain("1 variation · variation 00 shown, one angle · judged from a render · description pending Rendered");
    expect(html).toContain(`<img src="${pathToFileURL("/s/renders/LanternRig_00_a0.png").href}" alt="LanternRig" class="picture one-angle"`);
  });

  it("says when the chosen variation is one the doodad hasn't", async () => {
    const from = await sources();
    const html = buildDoodadSearchPage(search([{ id: "StoryPressTank", variation: 2, note: "n", judgedFrom: "none" }]), lookUpDoodads(["StoryPressTank"], from), () => "/s/x.jpg");
    expect(textOf(html)).toContain("2 variations · variation 02 chosen, but it has only 00 to 01 · unpictured");
  });

  it("finds a variation's sheet, else its first render, in the search folder's renders when writing the page", async () => {
    const from = await sources();
    const folder = path.join(from.root, "search/press");
    await mkdir(path.join(folder, "renders"), { recursive: true });
    await writeFile(path.join(folder, "renders/FoundryStamperHead_02.jpg"), "sheet");
    await writeFile(path.join(folder, "renders/StoryPressTank_01_a0.png"), "render");
    const written = await writeDoodadSearchPage(folder, from, {
      search: {
        title: "Press",
        parts: [
          {
            name: "press head",
            readsAs: "a heavy block",
            candidates: [
              { id: "FoundryStamperHead", variation: 2, note: "Bare.", judgedFrom: "render" },
              { id: "StoryPressTank", variation: 1, note: "Clean.", judgedFrom: "render" },
            ],
          },
        ],
      },
    });
    const html = await readFile(written.page, "utf8");
    expect(html).toContain(`<img src="${pathToFileURL(path.join(folder, "renders/FoundryStamperHead_02.jpg")).href}"`);
    expect(html).toContain(`<img src="${pathToFileURL(path.join(folder, "renders/StoryPressTank_01_a0.png")).href}"`);
  });
});

describe("buildSheetsFor", () => {
  it("builds the sheets of the doodads named, with no search.json, and says which are here already and which can't be built", async () => {
    const from = await sources();
    await mkdir(path.join(from.root, "thumbnails/doodads"), { recursive: true });
    for (const angle of [0, 1, 2, 3]) await writeFile(path.join(from.root, `thumbnails/doodads/MossyBoulder_00_a${angle}.png`), "render");
    const built: string[] = [];
    const build = async (_renders: readonly string[], sheet: string) => {
      built.push(sheet);
      await writeFile(sheet, "sheet");
    };
    const ids = ["MossyBoulder", "FoundryStamperHead", "StoryPressTank", "GoneDoodad", ...Array.from({ length: 12 }, () => "MossyBoulder")];
    const result = await buildSheetsFor(ids, from, { build });
    const boulder = path.join(from.root, "catalog-sheets/doodads/MossyBoulder.jpg");
    expect(built).toEqual([boulder]);
    expect(result).toEqual({
      built: [{ ids: ["MossyBoulder"], sheet: boulder }],
      here: [{ ids: ["FoundryStamperHead"], sheet: path.join(from.root, "catalog-sheets/doodads/FoundryStamperHead.jpg") }],
      unbuildable: [
        { id: "StoryPressTank", reason: "its four renders aren't on this machine (npm run thumbnails)" },
        { id: "GoneDoodad", reason: "no catalog has it" },
      ],
    });
  });
});

describe("doodadSearchFolder", () => {
  it("puts a Mission's search in its git-ignored output folder, and one for no Mission in the research archive", () => {
    expect(doodadSearchFolder("press-rig", { missionDir: "/w/missions/ashen-crossing" })).toBe(path.join("/w/missions/ashen-crossing", "output/doodad-search/press-rig"));
    expect(doodadSearchFolder("press-rig", { env: { SC2_RESEARCH_DIR: "/archive" } })).toBe(path.join("/archive", "doodad-search/press-rig"));
    expect(() => doodadSearchFolder("press-rig", { env: {} })).toThrow(/give the search a Mission, or set SC2_RESEARCH_DIR/);
    expect(() => doodadSearchFolder("../up", { env: {} })).toThrow(/slug/);
  });
});

describe("writeDoodadSearchPage", () => {
  it("writes search.json when given and index.html beside it, rebuilds from search.json alone, and reports the candidates' missing sheets until asked to build them", async () => {
    const from = await sources();
    // The boulder's four renders are here and its sheet isn't; the stamper head has its sheet.
    await mkdir(path.join(from.root, "thumbnails/doodads"), { recursive: true });
    for (const angle of [0, 1, 2, 3]) await writeFile(path.join(from.root, `thumbnails/doodads/MossyBoulder_00_a${angle}.png`), "render");
    const folder = path.join(from.root, "search/press-rig");
    const built: string[][] = [];
    const build = async (renders: readonly string[], sheet: string) => {
      built.push([...renders, sheet]);
      await writeFile(sheet, "sheet");
    };

    const first = await writeDoodadSearchPage(folder, from, { search: SEARCH, build });
    expect(first.page).toBe(path.join(folder, "index.html"));
    expect(JSON.parse(await readFile(path.join(folder, "search.json"), "utf8"))).toMatchObject({ title: SEARCH.title });
    expect(first.missingSheets.map((sheet) => sheet.ids)).toEqual([["MossyBoulder"]]);
    expect(first.builtSheets).toEqual([]);
    expect(await readFile(first.page, "utf8")).toContain("Mossy%20Boulder.jpg");

    const boulderSheet = path.join(from.root, "catalog-sheets/doodads/MossyBoulder.jpg");
    const second = await writeDoodadSearchPage(folder, from, { buildSheets: true, build });
    expect(built).toEqual([[...[0, 1, 2, 3].map((angle) => path.join(from.root, `thumbnails/doodads/MossyBoulder_00_a${angle}.png`)), boulderSheet]]);
    expect(second).toMatchObject({ missingSheets: [], builtSheets: [boulderSheet] });
    expect(await readFile(second.page, "utf8")).toContain(`<img src="${pathToFileURL(boulderSheet).href}"`);

    await expect(writeDoodadSearchPage(path.join(from.root, "search/none"), from)).rejects.toThrow(/No search\.json in .*search[\\/]none/);
    // A Mission's folder holds that Mission's search, and one refused leaves search.json as it was.
    await expect(writeDoodadSearchPage(folder, from, { mission: "ashen-crossing" })).rejects.toThrow(/search\.json is a search for no Mission, not ashen-crossing/);
    const kept = await readFile(path.join(folder, "search.json"), "utf8");
    await expect(writeDoodadSearchPage(folder, from, { mission: "ashen-crossing", search: { ...SEARCH, title: "Another" } })).rejects.toThrow(/is a search for no Mission/);
    const unknown = async () => {
      throw new Error("No Mission typo");
    };
    await expect(writeDoodadSearchPage(folder, from, { search: { ...SEARCH, mission: "typo" }, dependenciesOf: unknown })).rejects.toThrow(/No Mission typo/);
    expect(await readFile(path.join(folder, "search.json"), "utf8")).toBe(kept);
  });

  it("refuses to build while a Search Part's shortlist is unjudged, naming the parts, and builds once it is emptied", async () => {
    const from = await sources();
    const folder = path.join(from.root, "search/early");
    const shortlisted = [{ id: "FoundryStamperHead", level: 3, ranker: "jev" }];
    const asks = [{ text: "industrial press head", tags: [], ranker: "jev" }];
    const early = { ...SEARCH, parts: [{ ...SEARCH.parts[0]!, candidates: [], shortlist: shortlisted, asks }, { ...SEARCH.parts[1]!, shortlist: shortlisted }] };
    await expect(writeDoodadSearchPage(folder, from, { search: early })).rejects.toThrow(/unjudged shortlist.*"press head", "frame"/);
    // Refused, it writes nothing.
    await expect(readFile(path.join(folder, "search.json"), "utf8")).rejects.toThrow(/ENOENT/);

    // The Doodad Finder wrote search.json itself: rebuilding from it is refused too.
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "search.json"), JSON.stringify(early));
    await expect(writeDoodadSearchPage(folder, from)).rejects.toThrow(/unjudged shortlist.*"press head", "frame"/);

    // Judged: the shortlist emptied (or dropped), its asks kept.
    const judged = { ...SEARCH, parts: [{ ...SEARCH.parts[0]!, shortlist: [], asks }, SEARCH.parts[1]!] };
    const written = await writeDoodadSearchPage(folder, from, { search: judged });
    expect(textOf(await readFile(written.page, "utf8"))).toContain("1. Foundry Stamper Head FoundryStamperHead");
    expect(JSON.parse(await readFile(written.search, "utf8")).parts[0]).toMatchObject({ shortlist: [], asks });
  });

  it.skipIf(!hasMontage)("builds a sheet as the sheet builder does: a 512×512 JPEG of the four renders on mid-grey", async () => {
    const from = await sources();
    const renders = path.join(from.root, "thumbnails/doodads");
    await mkdir(renders, { recursive: true });
    for (const angle of [0, 1, 2, 3]) await execFileAsync("magick", ["-size", "256x256", "xc:#202020", path.join(renders, `MossyBoulder_00_a${angle}.png`)]);
    const folder = path.join(from.root, "search/boulder");
    const result = await writeDoodadSearchPage(folder, from, { search: SEARCH, buildSheets: true });
    expect(result.builtSheets).toEqual([path.join(from.root, "catalog-sheets/doodads/MossyBoulder.jpg")]);
    const { stdout } = await execFileAsync("magick", ["identify", "-format", "%m %wx%h", result.builtSheets[0]!]);
    expect(stdout).toBe("JPEG 512x512");
  });
});
