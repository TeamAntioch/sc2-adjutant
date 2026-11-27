// The catalog and doodad tools: what the Campaign Mod defines, Doodad Search and its notes, decals, textures and the mod doodad index.

import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { campaignCatalogEntries, modCatalogFiles } from "../../mods/campaign-catalog.js";
import { type DataLayer, effectiveEntry, formatEntryReport, stockLayers } from "../../mods/effective-entry.js";
import { campaignMod, readModBlueprint, readWorkspaceModWithBlueprint } from "../../mods/workspace-mods.js";
import { loadWorkspace, missionBlueprintPath } from "../../plugins/workspace.js";
import { writePng } from "../../preview/write-png.js";
import { indexModDoodads } from "../../catalog/index-mod-doodads.js";
import { campaignModelData } from "../../catalog/model-anims.js";
import { formatWorkspaceRecord, recordWorkspaceModelAnims, type WorkspaceRecord } from "../../catalog/record-workspace-model-anims.js";
import { hostContext } from "../../host/machine-config.js";
import { DoodadDescriptionSchema } from "../../catalog/mod-doodad-index.js";
import { DoodadUseSchema } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";
import { lookUpTextures, searchTextures, TEXTURE_KINDS, TEXTURE_SUITS, TEXTURE_TONES } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";
import { stockTextures } from "../../catalog/stock-catalog.js";
import { describeTexture, renderTextureSheet } from "../../catalog/texture-sheet.js";
import { areaLine, legendLine, missionTextureUsage } from "../../map/texture-usage.js";
import { checkSoundMixes, definedSounds, SoundMixSchema, soundMixEntries, soundMixWiring, soundMixXml, workspaceSounds } from "../../mods/sound-mix.js";
import { DOODAD_KINDS, DOODAD_ROLES, DOODAD_SIZES } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import { DECAL_GLYPHS, DECAL_SHAPES, DECAL_SHOWS, DECAL_USES, decalSheetPath, findDecalVariations, formatDecalVariations } from "@team-antioch/sc2-asset-catalog/catalog/decal-catalog.js";
import { DOODAD_PLACEMENTS } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { formatDoodadSearch, searchWorkspaceDoodads } from "../../catalog/workspace-doodad-search.js";
import { RANKERS } from "../../catalog/doodad-search-page.js";
import { buildWorkspaceSheetsFor, formatDoodadSearchPage, formatSheetsFor, writeWorkspaceDoodadSearchPage } from "../../catalog/write-doodad-search-page.js";
import { addWorkspaceDoodadNote, contributeWorkspaceDoodadNotes, formatAddedDoodadNote, formatDoodadNotesContribution } from "../../catalog/workspace-doodad-notes.js";
import { type DoodadFinderTool, formatFoundDoodads } from "../find-doodads.js";
import { formatFoundSets, type SetFinderTool } from "../find-sets.js";
import { formatOpenedDoodadFinder, type OpenDoodadFinderTool } from "../open-doodad-finder.js";
import { Ids, MissionSchema, plain } from "./schemas.js";
import { type CallContext } from "../call-context.js";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, toolGroup } from "./tool-group.js";

/** The tools registerCatalogTools can register, the catalog group: find_doodads, find_sets and open_doodad_finder only when their Finder package loaded. */
export const CATALOG_TOOLS = ["asset_catalog", "show_entry", "search_doodads", "find_doodads", "find_sets", "open_doodad_finder", "decal_variations", "build_doodad_search_page", "build_doodad_sheets", "add_doodad_note", "contribute_doodad_notes", "index_mod_doodads", "record_model_anims", "texture_sheet", "texture_usage", "sound_mix"] as const;

export function registerCatalogTools(server: McpServer, ctx: CallContext, { doodadFinder, openDoodadFinder, setFinder }: { doodadFinder?: DoodadFinderTool | undefined; openDoodadFinder?: OpenDoodadFinderTool | undefined; setFinder?: SetFinderTool | undefined }): void {
  const tool = toolGroup(server, CATALOG_TOOLS);
  tool(
    "asset_catalog",
    {
      title: "List the Campaign Mod's catalog entries",
      annotations: READ_ONLY,
      description:
        "Lists what the Workspace's Campaign Mod defines, as Mission compiles and the checkers read it: its tilesets (each with its blend textures, cliff sets, default Light and sky, resolved through its parents), terrain textures, cliff sets, Lights, units (whether each flies or is a structure), doodads (with their variation counts, their model files and, where the mod's doodad index (mods/<id>/doodad-catalog.json) covers them, their descriptions in core's words, who wrote each, their sheets' absolute paths when on this machine, why they have no picture, or that they're pending: index-mod-doodads renders them and an agent describes them) and models. Kept entries come from the mod's package, Blueprint-owned ones from its Mod Blueprint. The game's own entries are core's: its catalog files (packages/core/data/*-catalog.json and tileset-*.json) and the published sc2-asset-catalog's textures and cliff sets, with their extracted fields in packages/core/data/texture-extracted.json and cliff-extracted.json; a Mission uses either.",
      outputSchema: {
        source: z.string().optional(),
        tilesets: z.array(
          z.object({ id: z.string(), textures: Ids, cliffSets: Ids, light: z.string(), sky: z.record(z.string(), z.string()) }),
        ),
        textures: Ids,
        cliffSets: Ids,
        lights: Ids,
        units: z.array(z.object({ id: z.string(), flyer: z.literal(true).optional(), structure: z.literal(true).optional() })),
        doodads: z.array(
          z.object({
            id: z.string(),
            variations: z.number(),
            model: z.string().optional(),
            indexed: z
              .object({
                name: z.string().optional(),
                // Its uses as records, read from strings or records (the file schema's transform has no JSON Schema).
                description: DoodadDescriptionSchema.extend({ uses: z.array(DoodadUseSchema).optional() }).optional(),
                described: z.enum(["agent", "author"]).optional(),
                pending: z.literal(true).optional(),
                sheet: z.string().optional(),
                unpictured: z.string().optional(),
                renderError: z.string().optional(),
              })
              .optional(),
          }),
        ),
        models: Ids,
      },
    },
    async () => {
      const workspace = await ctx.workspace();
      const entries = campaignCatalogEntries(workspace);
      const { source, ...lists } = entries;
      const lines = Object.entries(lists)
        .filter(([, list]) => list.length > 0)
        .map(([kind, list]) => `${kind}: ${(list as readonly (string | { readonly id: string })[]).map((entry) => (typeof entry === "string" ? entry : entry.id)).join(", ")}`);
      const error = workspace.catalog.error;
      const from = source ? `${source[0]!.toUpperCase()}${source.slice(1)}` : undefined;
      let text: string;
      if (error) text = `${error}. check_workspace reports it with the Workspace's other problems.`;
      else if (!from) text = "The Workspace has no Campaign Mod (or hasn't imported it), so the game's entries are all there are: see core's catalog files in packages/core/data/.";
      else if (lines.length === 0) text = `${from} defines no tilesets, textures, cliff sets, Lights, units, doodads or models.`;
      else text = [`${from} defines:`, ...lines].join("\n");
      return ctx.reply(text, entries);
    },
  );

  tool(
    "show_entry",
    {
      title: "Show a catalog entry as the game sees it",
      annotations: READ_ONLY,
      description:
        "Read-only. Returns one catalog entry (a unit, ability, actor, weapon, behaviour, effect ...) as the game reads it: its definitions merged across Blizzard's data and then a mod's, in load order; the class default and parent chain it inherits; its ##token## values filled in (`##id##` is its own id); removed=\"1\" elements dropped (listed apart); each field with the layer or entry it came from; and the entries that name it (as parent, a token value, or a whole attribute or text value in a field). The mod is the Campaign Mod unless `mod` names another Workspace mod. Blizzard's data comes from a folder laid out like SC2Mapster's SC2GameData (mods/core.sc2mod, campaigns/liberty.sc2campaign ... each with base.sc2data/GameData): give it as `stockData` or set SC2_ADJUTANT_STOCK_DATA; without it only the mod's own entries are read. Not checked against the Editor yet: see docs/reference/effective-entry.md.",
      inputSchema: {
        id: z.string().min(1).describe("The entry's id, such as Marine"),
        class: z.string().min(1).optional().describe("Its class, such as CUnit; needed only when the id is used by more than one class"),
        mod: z.string().min(1).optional().describe("A Workspace mod's id; the Campaign Mod by default"),
        stockData: z.string().min(1).optional().describe("Absolute path of the folder holding Blizzard's data (an SC2GameData checkout); SC2_ADJUTANT_STOCK_DATA by default"),
        referrerLimit: z.number().int().min(0).max(500).optional().describe("How many referrers to list (50 by default); the total is always given"),
      },
      outputSchema: {
        class: z.string(),
        id: z.string(),
        layers: z.array(z.string()),
        chain: z.array(z.object({ class: z.string(), id: z.string(), layers: z.array(z.string()) })),
        missingParent: z.string().optional(),
        classDefault: z.boolean(),
        tokens: z.record(z.string(), z.string()),
        unresolvedTokens: z.array(z.string()),
        fields: z.array(z.object({ name: z.string(), from: z.array(z.string()), elements: z.array(z.string()) })),
        removed: z.array(z.object({ field: z.string(), index: z.string(), from: z.string() })),
        referrers: z.object({ total: z.number(), items: z.array(z.object({ class: z.string(), id: z.string(), via: z.string(), layers: z.array(z.string()) })) }),
        notes: z.array(z.string()),
      },
    },
    async ({ id, class: cls, mod: modId, stockData, referrerLimit }) => {
      const workspace = await ctx.workspace();
      const layers: DataLayer[] = [];
      const stockFolder = stockData ?? (process.env.SC2_ADJUTANT_STOCK_DATA || undefined);
      if (stockFolder !== undefined) {
        const stock = await stockLayers(stockFolder);
        if (stock.length === 0) return ctx.fail(`${stockFolder} holds none of Blizzard's data packages (mods/core.sc2mod, campaigns/liberty.sc2campaign ...): point stockData at an SC2GameData checkout`);
        layers.push(...stock);
      }
      try {
        const campaign = modId === undefined ? await campaignMod(workspace) : undefined;
        const found = modId !== undefined ? await readWorkspaceModWithBlueprint(workspace, modId) : campaign && { mod: campaign, blueprint: await readModBlueprint(campaign.blueprintPath) };
        if (found) {
          const { kept, owned } = await modCatalogFiles(found.mod, found.blueprint);
          layers.push({ label: `mod ${found.mod.id} (package)`, files: kept }, { label: `mod ${found.mod.id} (Blueprint)`, files: owned });
        }
      } catch (error) {
        return ctx.fail(`Can't read the mod's data: ${(error as Error).message}`);
      }
      if (layers.length === 0) return ctx.fail("There is no data to read: the Workspace has no Campaign Mod (name one with `mod`), and no stockData folder or SC2_ADJUTANT_STOCK_DATA is set");
      const report = effectiveEntry(layers, { id, ...(cls !== undefined ? { class: cls } : {}), ...(referrerLimit !== undefined ? { referrerLimit } : {}) });
      if ("refused" in report) return ctx.fail(`${report.refused}${stockFolder === undefined ? ". Blizzard's data isn't loaded (no stockData), so only the mod's entries were searched" : ""}`);
      return ctx.reply(formatEntryReport(report), plain(report));
    },
  );

  const Words = z.array(z.string().min(1));
  const Uses = z.array(DoodadUseSchema);
  /** A doodad as search_doodads gives it; find_doodads gives the same, less the score. */
  const DoodadResultSchema = z.object({
    id: z.string(),
    name: z.string(),
    source: z.enum(["doodad", "terrain-object", "mod"]),
    package: z.string().optional(),
    dependency: z.string().optional(),
    provided: z.boolean().optional(),
    description: z
      .object({
        look: z.string(),
        kind: z.string().optional(),
        size: z.string().optional(),
        role: z.string().optional(),
        use: z.string().optional(),
        story: Words.optional(),
        biome: Words.optional(),
        state: z.string().optional(),
        seen: z.string().optional(),
      })
      .optional(),
    uses: Uses,
    tilesets: Words.optional(),
    variations: z.number(),
    facing: z
      .object({
        front: z.number(),
        placement: z.enum(DOODAD_PLACEMENTS).optional(),
        standOff: z.number().optional(),
        height: z.number().optional(),
        runsAlong: z.literal(true).optional(),
        source: z.enum(["measured", "sheet"]),
        sure: z.boolean().optional(),
        diagonal: z.literal(true).optional(),
      })
      .optional(),
    picture: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sheet"), path: z.string() }),
      z.object({ kind: z.literal("image"), url: z.string() }),
      z.object({ kind: z.literal("none") }),
    ]),
    hasRenders: z.boolean(),
    pending: z.literal(true).optional(),
    unpictured: z.string().optional(),
    score: z.number(),
  });
  tool(
    "search_doodads",
    {
      title: "Search doodads",
      annotations: READ_ONLY,
      description:
        "Doodad Search's narrowing step: a keyword and facet search over the game's doodads (core's doodad catalog), its terrain objects and the Workspace's Campaign Mod's doodads, with the Workspace's Doodad Uses (doodad-notes.json beside its config) merged in. Words match whole words in a doodad's name, id (split at its camel case, so crusher finds PortZionCrusherDoodad), look or Doodad Uses, in any plural or inflected form (crate finds crates but not crater; press finds presses and pressed); a word ending in * matches the start of a word instead (stamp* finds stamper), and a word of several words matches them in a row; the most words matched rank first. Facets narrow by the catalog's description (a terrain object has no size or role; a doodad for any biome fits every biome). A Campaign Mod doodad matches on its entry in the mod's doodad index (mods/<id>/doodad-catalog.json: description, Doodad Uses and sheet) as a game doodad does on core's; one whose description wasn't written for its current model is marked pending (run index_mod_doodads, then describe it); one with no description at all matches by name and id alone and never passes a facet; and one with nothing to draw gives why as unpictured. A game doodad the mod gave a model of its own is the mod's. Each result gives its id, name, source, package, the map dependency it needs and, for a Mission, whether the Mission's dependencies already bring it in (those sort first), its description, Doodad Uses (the published sc2-asset-catalog package's, then the Workspace's: each a phrase with the variation, scale and source it was accepted with, when set), variation count, its facing when a game doodad has one (front: the degrees its face points at rotation 0, counterclockwise from east; placement: wall-foot, wall-face, wall-top or free, with its stand-off from a wall zone's edge and height; source: measured, the author's, which a set piece member's yaw and against: \"wall\" use, or sheet, read from its catalog renders, whose front they use only when sure and not diagonal and whose placement and stand-off are suggestions), and picture: its turntable sheet (variation 00 from four sides) when this machine has one, else its gallery picture (one angle: say so when judging from it), else none; and whether the renders a sheet is built from are here (then offer to build it: build_doodad_sheets builds sheets by id, and build_doodad_search_page with buildSheets builds a search's candidates'). Reads only.",
      inputSchema: {
        words: Words.optional().describe("Keywords, any of which must match; leave out to search by facets alone"),
        kind: z.enum(DOODAD_KINDS).optional().describe("Only doodads of this kind"),
        size: z.enum(DOODAD_SIZES).optional().describe("Only doodads of this size"),
        role: z.array(z.enum(DOODAD_ROLES)).optional().describe("Roles, any of which it must have, such as prop or clutter"),
        story: Words.optional().describe("Stories, any of which it must have, such as industry or terran"),
        biome: Words.optional().describe("Biomes, any of which it must have, such as urban or space"),
        package: z.string().min(1).optional().describe("The SC2GameData package that defines it, such as campaigns/void.sc2campaign"),
        mission: MissionSchema.optional().describe("The Mission to sort for: the doodads its dependencies already bring in first"),
        limit: z.number().int().min(1).max(500).optional().describe("At most this many results; 30 by default"),
      },
      outputSchema: {
        results: z.array(DoodadResultSchema),
        total: z.number(),
      },
    },
    async (query) => {
      const found = await searchWorkspaceDoodads(await ctx.workspace(), query);
      return ctx.reply(formatDoodadSearch(found), plain(found));
    },
  );

  if (doodadFinder) {
    tool(
      "find_doodads",
      {
        title: "Find doodads by meaning",
        annotations: READ_ONLY,
        description:
          "Doodad Search's narrowing step by meaning, from the Doodad Finder (served when the doodad-finder package, an optional dependency of core, is installed). Give a Search Part's line as the ask. It narrows the same doodads search_doodads searches, with the Workspace's Doodad Uses, to about 200 candidates by keywords and a local embeddings model, so it finds what shares no word with the ask (\"cover\" finds sandbags and crates). Then Jev grades each candidate's text card (name, id words, look, facets, Doodad Uses) on four levels: 0 doesn't fit, 1 related but wrong, 2 could work with dressing or scale, 3 reads as exactly this. Results come best first: fit first, then a doodad the Mission's dependencies provide over one no more than 0.25 above it. Each result is search_doodads' (picture, dependency, provided, hasRenders and the rest) with its level; the answer says the ranker, how many the narrowing gave it, timings and the call's estimated spend. The ranker judges text, never pictures: judge every candidate from its picture as usual. With rank false, or with no TypeSafe key, or when Jev fails, it gives the narrowing's order and says why. Lights and other doodads with no description have only their name and id words: search_doodads finds those better. The first call loads the model, cards and vectors, which then stay loaded. Each ranked call sends the ask, the tags and the candidates' cards to TypeSafe; no pictures or files. Reads only.",
        inputSchema: {
          ask: z.string().min(1).describe("A Search Part's line, such as \"press head: a heavy flat block that drops onto a belt\""),
          mission: MissionSchema.optional().describe("The Mission to mark for: the doodads its dependencies provide are kept and come first among equals"),
          tags: z
            .array(z.object({ facet: z.string().min(1), value: z.string().min(1), pinned: z.boolean().optional() }))
            .optional()
            .describe("Facet tags (kind, size, role, story, biome, tileset, source) such as { facet: story, value: industry }: each raises the candidates it matches, and a pinned one keeps only those"),
          count: z.number().int().min(1).max(200).optional().describe("At most this many results; 20 by default"),
          rank: z.boolean().optional().describe("False gives the narrowing alone, with no call to the ranker; true by default"),
        },
        outputSchema: {
          results: z.array(DoodadResultSchema.omit({ score: true }).extend({ level: z.number().optional() })),
          ranker: z.enum(["jev"]).optional(),
          rankerOff: z.string().optional(),
          narrowed: z.number(),
          timings: z.object({ narrow: z.number(), rank: z.number(), total: z.number() }),
          cost: z.number(),
          spend: z.number(),
        },
      },
      async ({ ask, mission, tags, count, rank }, { signal }) => {
        const request = { workspaceRoot: await ctx.root(), ask, ...(mission !== undefined ? { mission } : {}), ...(tags ? { tags } : {}), count: count ?? 20, rank: rank ?? true };
        const found = await doodadFinder.find(request, { signal });
        return ctx.reply(formatFoundDoodads(found), plain(found));
      },
    );
  }

  if (setFinder) {
    tool(
      "find_sets",
      {
        title: "Find cinematic sets by meaning",
        annotations: READ_ONLY,
        description:
          "Finds cinematic sets (the pre-built locations Cutscene Editor files film in) that could play a place, from the Set Finder (served when the set-finder package, an optional dependency of core, is installed). Give the place wanted as the ask, such as \"a cramped ship corridor with a cockpit at one end\". Its sets are the published Set Finder's (Blizzard's, from @team-antioch/sc2-set-finder) with the Workspace's own (its cinematic-sets folder) and any public ones described since the release laid over them, where this machine has drawn them. It narrows them by keywords and a local embeddings model, then Jev grades each set's written look on four levels: 0 doesn't fit, 1 related but wrong, 2 could work with staging, 3 reads as exactly this. Results come best first, each with its id (as import_set takes it), its look, facets, what it could stand in for, the model pattern for each place where one set holds several, its source, size in cells, camera count and its chosen pictures as files to read (with the same view filmed in game where there is one); a published set this machine hasn't drawn gives its pictures' gallery addresses instead. The ranker judges the written look, never pictures, and a look is written from neutral-light renders that miss glass, glows and the game's lighting: read a candidate's pictures before choosing it. With rank false, or with no TypeSafe key, or past the server's spend cap, or when Jev fails, it gives the narrowing's order and says why. The first call loads the model, cards and vectors, which then stay loaded. Each ranked call sends the ask and the narrowed sets' looks to TypeSafe; no pictures or files. Reads only.",
        inputSchema: {
          ask: z.string().min(1).describe("The place wanted, in plain words"),
          count: z.number().int().min(1).max(24).optional().describe("At most this many results; 8 by default"),
          rank: z.boolean().optional().describe("False gives the narrowing alone, with no call to the ranker; true by default"),
        },
        outputSchema: {
          results: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              kind: z.string(),
              look: z.string(),
              facets: z.array(z.string()),
              standsInFor: z.array(z.string()),
              rooms: z.array(z.string()).optional(),
              confidence: z.string(),
              source: z.string(),
              size: z.tuple([z.number(), z.number(), z.number()]),
              cameras: z.number(),
              pictures: z.array(z.object({ path: z.string(), shows: z.string(), inGame: z.string().optional() })),
              level: z.number().optional(),
            }),
          ),
          ranker: z.enum(["jev"]).optional(),
          rankerOff: z.string().optional(),
          narrowed: z.number(),
          timings: z.object({ narrow: z.number(), rank: z.number(), total: z.number() }),
          cost: z.number(),
          spend: z.number(),
        },
      },
      async ({ ask, count, rank }, { signal }) => {
        const found = await setFinder.find({ workspaceRoot: await ctx.root(), ask, count: count ?? 8, rank: rank ?? true }, { signal });
        return ctx.reply(formatFoundSets(found), plain(found));
      },
    );
  }

  if (openDoodadFinder) {
    tool(
      "open_doodad_finder",
      {
        title: "Open the Doodad Finder",
        annotations: ADDITIVE,
        description:
          "Opens the Doodad Finder's page for the author (served when the doodad-finder package, an optional dependency of core, is installed): use it when the author asks to open the Doodad Finder. Before a start it checks what the Finder needs and says each plainly: core built, the Workspace, the embeddings model cached (else the first start downloads about 34 MB and embeds every card, around 20 s), whether Jev has its key (TYPESAFE_API_KEY, or the key file `npx @team-antioch/sc2-doodad-finder login` saves; never the key itself), and how many catalog entries have no picture here. A missing one doesn't block: it says what is off and the command that fixes it. Pass those on to the author. Then it reuses a Finder already answering for this Workspace, or starts one detached, so it outlives the session, with its pid and port in the Workspace's git-ignored output/doodad-finder/finder.json and its output in finder.log there (the research archive's doodad-finder/process/ with no Workspace). It waits until the page answers, up to 120 s, and opens it: the default browser, a Chrome app window with window app (on macOS with Chrome; elsewhere the default browser, with a note), or nowhere with window none (the URL alone). A start that doesn't answer in time is an error; the Finder is left running, and a later call waits for it. stop true stops the Finder this tool started, by its pid file, and nothing else. The answer gives the URL, whether it was started or reused, the rankers on and off, and the checks (none on a reuse). If the page can't be opened, a note says so and gives the URL to open by hand.",
        inputSchema: {
          window: z.enum(["browser", "app", "none"]).optional().describe("Where the page opens: browser (the default browser, by default), app (a Chrome app window, on macOS when Chrome is installed; elsewhere the default browser) or none (give the URL alone)"),
          stop: z.boolean().optional().describe("True stops the Finder this tool started for the Workspace instead of opening one"),
        },
        outputSchema: {
          action: z.enum(["started", "reused", "stopped", "notRunning"]),
          url: z.string().optional(),
          ours: z.boolean().optional(),
          checks: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string() })),
          rankers: z.object({ on: z.array(z.string()), off: z.array(z.object({ ranker: z.string(), reason: z.string() })) }).optional(),
          opened: z.enum(["browser", "app", "none"]).optional(),
          notes: z.array(z.string()),
          pidFile: z.string(),
          logFile: z.string(),
        },
      },
      async ({ window, stop }) => {
        const opened = await openDoodadFinder.open({ workspaceRoot: await ctx.root(), window: window ?? "browser", stop: stop ?? false });
        return ctx.reply(formatOpenedDoodadFinder(opened), plain(opened));
      },
    );
  }

  tool(
    "decal_variations",
    {
      title: "Look up decal variations",
      annotations: READ_ONLY,
      description:
        "What every variation of every decal doodad (kind decal) shows, from the published sc2-asset-catalog's decal descriptions (described by eye from each variation's picture), filtered. Each match gives its doodad and variation number, look, what it shows, glyphs (none, number, letter, words, or script for Protoss and Xel'Naga inscriptions) with the text it reads, shape (line, corner or patch), whether copies tile end to end, use (marking or ornament, which can go anywhere; label, sign or emblem, which go only where they mean something), and, once the package's extract-decals has read this machine's install into its cache, its texture, its box in cells and its doodad's sheet of every variation. A painted number, letter or word promises it labels something, so dressing never scatters those: for plain floor markings ask for glyphs [none] and use [marking], and name a bay's number or a lane's words in a member's variations. Reads only.",
      inputSchema: {
        doodads: z.array(z.string().min(1)).optional().describe("Decal doodads, any of which it must belong to, such as Decal or DOM_Decals"),
        words: Words.optional().describe("Words, any of which its look, text or shows must contain, such as caution or arrow"),
        shows: z.array(z.enum(DECAL_SHOWS)).optional().describe("What it shows, any of which it must, such as stripe or arrow"),
        glyphs: z.array(z.enum(DECAL_GLYPHS)).optional().describe("Glyphs, any of which it must carry: [none] for no writing at all"),
        shape: z.array(z.enum(DECAL_SHAPES)).optional().describe("Shapes, any of which it must have: line, corner or patch"),
        tiles: z.boolean().optional().describe("Only decals whose copies tile end to end (true), or only those that don't (false)"),
        use: z.array(z.enum(DECAL_USES)).optional().describe("Uses, any of which it must have, such as marking or sign"),
        scatterable: z.boolean().optional().describe("Only what dressing may scatter at random (true), or only what it never does (false)"),
        limit: z.number().int().min(1).max(500).optional().describe("At most this many in the text; every match is in the structured result"),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            doodad: z.string(),
            variation: z.number(),
            look: z.string(),
            shows: z.array(z.string()),
            glyphs: z.enum(DECAL_GLYPHS),
            text: z.string().optional(),
            shape: z.enum(DECAL_SHAPES),
            tiles: z.boolean(),
            use: z.enum(DECAL_USES),
            size: z.array(z.number()).optional(),
            texture: z.string().optional(),
            drawn: z.literal("geometry").optional(),
          }),
        ),
        sheets: z.record(z.string(), z.string()),
      },
    },
    async ({ limit, ...query }) => {
      const matches = findDecalVariations(query);
      const sheets = Object.fromEntries([...new Set(matches.map((match) => match.doodad))].flatMap((doodad) => (decalSheetPath(doodad) ? [[doodad, decalSheetPath(doodad)!]] : [])));
      const sheetLines = Object.entries(sheets).map(([doodad, sheet]) => `${doodad} sheet: ${sheet}`);
      return ctx.reply([formatDecalVariations(matches, limit ?? 60), ...sheetLines].join("\n"), plain({ matches, sheets }));
    },
  );

  tool(
    "build_doodad_search_page",
    {
      title: "Build a Doodad Search page",
      annotations: ADDITIVE,
      description:
        `Doodad Search's showing step: writes search.json (when given) and builds index.html beside it, the page of candidates the author picks from. search.json is { title (the object), mission? (the Mission's folder name), parts: [{ name, readsAs (what the Search Part has to read as to the player), queries (the search_doodads queries run: words and facets), candidates (ranked, best first, at most ten: { id, note (why it fits or falls short), judgedFrom: sheet | image | render | none, variation? (the variation recommended, 00 when left out), variationsChecked?: [{ variation, note? }] }), alsoConsidered: [{ id, reason }], shortlist? (the Doodad Finder's ticked ids, best first, not yet judged: [{ id, level: 0-3 (the ranker's Score), ranker: ${RANKERS.join(" | ")} }]), asks? (the asks made in the Doodad Finder or with find_doodads: [{ text, tags: [{ facet, value, pinned? }], ranker? (absent when the ask was only narrowed) }]) }] }. candidates may be empty while a part has a shortlist. It refuses to build while any part's shortlist has ids in it, and names those parts: judge each shortlisted id from its picture into a candidate or alsoConsidered, empty the shortlist, and keep the asks. The page has a section per Search Part with a card per candidate (picture, name, id, size, the dependency it needs and whether the Mission has it, note, variation count, the variation its picture shows), the also-considered list folded, and a pointer to drafting a Doodad Composite. A candidate's chosen variation is pictured from the search folder's renders/ (its <id>_<variation>.jpg sheet, else its first render), else the card shows the catalog's picture and says the chosen one isn't pictured. Pictures are referenced where they are (a sheet's file URL, a gallery picture's URL), never copied. The folder is the one given, else from the slug: missions/<id>/output/doodad-search/<slug>/ for a Mission (git-ignored), or $SC2_RESEARCH_DIR/doodad-search/<slug>/ for none (an error when SC2_RESEARCH_DIR isn't set). Rebuild from search.json with the same slug and mission, or the folder. It reports the candidates whose four renders are on this machine but whose turntable sheet isn't: offer to build them, then call again with buildSheets (needs ImageMagick) and judge those candidates again from their sheets.`,
      inputSchema: {
        slug: z.string().min(1).optional().describe("The search's folder name, such as crushing-press: lower-case letters, digits and hyphens"),
        mission: MissionSchema.optional().describe("The Mission it's for, when search.json doesn't say"),
        folder: z.string().min(1).optional().describe("A folder of its own instead of the default: absolute, or relative to the Workspace's root"),
        search: z.record(z.string(), z.unknown()).optional().describe("search.json's contents, to check and write; leave out to rebuild from the folder's search.json"),
        buildSheets: z.boolean().optional().describe("Build the candidates' missing sheets from their renders first"),
      },
      outputSchema: {
        folder: z.string(),
        search: z.string(),
        page: z.string(),
        missingSheets: z.array(z.object({ ids: z.array(z.string()), renders: z.array(z.string()), sheet: z.string() })),
        builtSheets: z.array(z.string()),
      },
    },
    async ({ folder, ...request }) => {
      const root = await ctx.root();
      const written = await writeWorkspaceDoodadSearchPage(await loadWorkspace(root), { ...request, ...(folder !== undefined ? { folder: path.resolve(root, folder) } : {}) });
      return ctx.reply(formatDoodadSearchPage(written), plain(written));
    },
  );

  const SheetsList = z.array(z.object({ ids: z.array(z.string()), sheet: z.string() }));
  tool(
    "build_doodad_sheets",
    {
      title: "Build doodad sheets",
      annotations: ADDITIVE,
      description:
        "Builds the turntable sheets (variation 00 from four sides) of the game doodads and terrain objects named, by id, from their renders on this machine, with no search.json: for a Doodad Search shortlist of any length, before its candidates are judged and written up. Needs ImageMagick. Says which sheets it built, which were here already (each with its path, to read), and why the rest can't be built: no catalog has the id, its renders aren't on this machine (npm run thumbnails renders them), or it is a Campaign Mod doodad, which is rendered into the search's own renders folder instead.",
      inputSchema: { ids: z.array(z.string().min(1)).min(1).describe("Doodad or terrain-object ids, as search_doodads gives them") },
      outputSchema: { built: SheetsList, here: SheetsList, unbuildable: z.array(z.object({ id: z.string(), reason: z.string() })) },
    },
    async ({ ids }) => {
      const sheets = await buildWorkspaceSheetsFor(await ctx.workspace(), ids);
      return ctx.reply(formatSheetsFor(sheets), plain(sheets));
    },
  );

  tool(
    "add_doodad_note",
    {
      title: "Add a doodad note",
      annotations: DESTRUCTIVE,
      description:
        "Adds a Doodad Use (a short, general phrase for what the author accepted a doodad as in a Doodad Search, such as \"press head over a conveyor\"; never a Mission's or a story's name), with the variation and scale that made it work and where it came from, a corrected look, or both, for a game doodad or a terrain object to the Workspace's doodad notes (doodad-notes.json beside its config), which search_doodads merges, and for a Campaign Mod doodad to its own entry in the mod's doodad index (its description's uses and look; refused while its entry has no description: run index_mod_doodads and describe it first). A use the doodad has already, case and spacing aside, takes the new variation and scale (and the source, when it has none); one core already holds with them is dropped. Drops any note core already holds, as from a released contribution. Gives the doodad's note as it now stands.",
      inputSchema: {
        id: z.string().min(1).describe("The doodad's id, as search_doodads gives it"),
        use: z.string().min(1).optional().describe("A Doodad Use to add: the phrase alone, with its variation and scale given apart"),
        variation: DoodadUseSchema.shape.variation.describe("The variation the use is for, by the Editor's number (0 for 00); needs a use"),
        scale: DoodadUseSchema.shape.scale.describe("The uniform scale the use is at; needs a use"),
        from: z.string().min(1).optional().describe("Where the use came from, such as \"crushing-press search, 2026-11-09\"; needs a use"),
        look: z.string().min(1).optional().describe("A look to replace the catalog's, when it is wrong or too thin (or to give a Campaign Mod doodad one)"),
      },
      outputSchema: { id: z.string(), note: z.object({ uses: Uses.optional(), look: z.string().optional() }).optional(), dropped: z.array(z.string()), file: z.string().optional() },
    },
    async (input) => {
      const added = await addWorkspaceDoodadNote(await ctx.workspace(), input);
      return ctx.reply(formatAddedDoodadNote(added), plain(added));
    },
  );

  tool(
    "contribute_doodad_notes",
    {
      title: "Contribute doodad notes",
      annotations: DESTRUCTIVE,
      description:
        "Contributes the Workspace's game-doodad notes (doodad-notes.json) to the public sc2-asset-catalog by pull request: on a new branch off origin/main, in the sc2-asset-catalog checkout named or else a fresh clone with gh, adds each doodad's Doodad Uses to its own file under packages/sc2-asset-catalog/data/doodad-uses/doodads/<id>.json (after the file's own; a use the file has already, case and spacing aside, gets the variation and scale the note adds, and is left out when it has them) and a corrected look to packages/sc2-asset-catalog/data/doodad-descriptions.json in place of its description's look, adds a changeset, commits, pushes and opens a pull request on TeamAntioch/sc2-asset-catalog with gh. Ask the author first, and show them a dry run. Kept in the Workspace, with why: Campaign Mod doodads' notes (their Doodad Uses live in the mod's doodad index), terrain objects' (sc2-adjutant's own catalog), those of a doodad sc2-asset-catalog hasn't described, and any note that names one of the Workspace's Missions, its Campaign, its mods or its characters (reword it in general words first). Contributed notes stay in the Workspace, laid over the package's uses, until a release of the package holds them, when the next add_doodad_note or contribution drops them. While one of the author's earlier contribution pull requests is still open it opens none, so the same notes don't go twice. Without gh or GitHub access it leaves the checkout as it is, keeps the notes and says so. On success a checkout goes back to its own branch, and a clone is removed. Refuses a checkout with uncommitted changes, or whose origin isn't TeamAntioch/sc2-asset-catalog.",
      inputSchema: {
        checkout: z
          .string()
          .min(1)
          .optional()
          .describe("A checkout of sc2-asset-catalog to branch in (such as the one beside the sc2-adjutant checkout): absolute, or relative to the Workspace's root. Without one, a fresh clone in a temporary folder"),
        dryRun: z.boolean().optional().describe("Say what would be contributed, from the checkout as it stands (or a fresh clone), and change nothing"),
      },
      outputSchema: {
        contributed: z.array(z.object({ id: z.string(), uses: Uses.optional(), look: z.string().optional() })),
        kept: z.array(z.object({ id: z.string(), reason: z.string() })),
        dropped: z.array(z.string()),
        branch: z.string().optional(),
        pullRequest: z.string().optional(),
        notOpened: z.string().optional(),
      },
    },
    async ({ checkout, dryRun }) => {
      const root = await ctx.root();
      const contribution = await contributeWorkspaceDoodadNotes(await loadWorkspace(root), { checkout: checkout === undefined ? undefined : path.resolve(root, checkout), dryRun });
      return ctx.reply(formatDoodadNotesContribution(contribution, dryRun), plain(contribution));
    },
  );

  tool(
    "index_mod_doodads",
    {
      title: "Index the Campaign Mod's doodads",
      annotations: DESTRUCTIVE,
      description:
        "Brings the Workspace's Campaign Mod doodad index (mods/<id>/doodad-catalog.json, ADR-0017) up to date with the mod, so its doodads are searched and pictured like the game's: each of the mod's doodads (and a game doodad only when the mod changes its model) that is new, whose model changed, whose last render failed or whose sheet isn't on this machine is rendered through the Host Adapter with the Workspace's mod packages, gets a 2×2 turntable sheet (committed under catalog-sheets/doodads/ when its model is the Workspace's own, git-ignored under catalog-sheets/game-models/ when it is the game's) and an entry with its model, the model's hash and bounds. Entries for doodads the mod no longer has are dropped. Descriptions are yours to write next: read each pending doodad's sheet and write its description into its entry in core's words, with described: \"agent\" (docs/reference/mod-doodad-index.md); an unpictured one from its data (name, categories, model). An author-confirmed description (described: \"author\") is never changed. Returns what it rendered, what has no model to draw, what failed (tried again next run) and the pending entries.",
      inputSchema: {
        only: z.array(z.string().min(1)).optional().describe("Only these doodads; the others' entries stay as they are"),
        force: z.boolean().optional().describe("Render them again even when nothing changed, as after rebuilding the renderer"),
      },
      outputSchema: {
        indexFile: z.string(),
        rendered: z.array(z.string()),
        unpictured: z.array(z.string()),
        failed: z.array(z.object({ id: z.string(), error: z.string() })),
        dropped: z.array(z.string()),
        pending: z.array(z.string()),
      },
    },
    async ({ only, force }) => {
      const workspace = await ctx.workspace();
      const result = await indexModDoodads(workspace, ctx.host, { ...(only ? { ids: only } : {}), ...(force ? { force } : {}) });
      const text = [
        `${path.relative(workspace.root, result.indexFile)}: ${result.rendered.length} rendered, ${result.unpictured.length} unpictured, ${result.failed.length} failed, ${result.dropped.length} dropped.`,
        ...result.failed.map(({ id, error }) => `Failed ${id}: ${error} (tried again next run)`),
        result.pending.length > 0 ? `Pending, to describe from their sheets: ${result.pending.join(", ")}` : "Every entry is described.",
      ].join("\n");
      return ctx.reply(text, { ...result, rendered: [...result.rendered], unpictured: [...result.unpictured], failed: result.failed.map((f) => ({ ...f })), dropped: [...result.dropped], pending: [...result.pending] });
    },
  );

  tool(
    "record_model_anims",
    {
      title: "Record models' animations in the Workspace",
      annotations: DESTRUCTIVE,
      description:
        "Records models' animations, with each one's length and move speed, so a Cinematic can cast them: a speaking cast member's model must be recorded, or the compile refuses it. Each model goes in its owner's file (ADR-0026): a game model in model-anims.json at the Workspace root, the Campaign Mod's own model in mods/<id>/model-anims.json, and, with mission, that Mission's own model (a CModel in its Map Package's Kept data) in missions/<id>/model-anims.json. Entries already in a file are kept, and a model recorded again is replaced. A game model is exported through the Host Adapter's model.export, with the game's ModelData from the machine's cacheDir (downloaded once). A model from the Workspace's packages (its mods' and, with mission, that Mission's Map Package) is read from the package, needing neither. While the Campaign Mod's catalog or the Mission's compile record doesn't read, nothing is recorded, since which models are their own can't be told. Returns each file written with its models, each model that failed and why, and stock: the game models recorded that core's data/model-anims.json doesn't record. When stock isn't empty, offer the mapper a Missing-Feature Report (the report-missing-feature skill), once per session for all of them, so the author can add them to core for everyone.",
      inputSchema: {
        models: z.array(z.string().min(1)).min(1).describe("Model ids (CModel), such as SMX3_Marine"),
        mission: MissionSchema.optional().describe("The Mission whose own models (its Map Package's Kept CModels) may be among them"),
      },
      outputSchema: {
        written: z.array(z.object({ file: z.string(), models: z.array(z.string()) })),
        failed: z.array(z.object({ id: z.string(), reason: z.string() })),
        stock: z.array(z.string()),
      },
    },
    async ({ models, mission }) => {
      const workspace = await ctx.workspace();
      let record: WorkspaceRecord;
      try {
        record = await recordWorkspaceModelAnims(workspace, ctx.host, models, {
          ...(mission !== undefined ? { mission } : {}),
          gameModelData: () => campaignModelData(hostContext(ctx.host.machine).requirePath("cacheDir")),
        });
      } catch (error) {
        return ctx.fail((error as Error).message);
      }
      const written = record.written.map(({ file, models: recorded }) => ({ file, models: [...recorded] }));
      return ctx.reply(formatWorkspaceRecord(record) || "Nothing recorded.", { written, failed: record.failed.map((f) => ({ ...f })), stock: [...record.stock] });
    },
  );

  tool(
    "texture_sheet",
    {
      title: "Texture pictures",
      annotations: READ_ONLY,
      description:
        "Shows what the game's terrain textures look like, to choose them by sight rather than by name (ADR-0016, the texture-sets skill): a sheet of their pictures, each labelled with its id and its catalog look, from the sc2-mapping-reference gallery (fetched once into the machine's cache). Name the textures (CTerrainTex ids, with an optional label each, such as a role or slot), or search the catalog (the published sc2-asset-catalog's descriptions, with core's data/texture-extracted.json) by its descriptions: words any of which the look holds (\"grat\" finds grating), words to leave out, kind (built or natural), tones, roles the texture suits (base, path, variety, high, low, accent) and tilesets. A search returns the matches' ids and looks as text, and the first `limit` (default 24) on the sheet. A texture with no gallery picture shows as a grey tile: judge it from its look, or in the Editor.",
      inputSchema: {
        textures: z.array(z.union([z.string().min(1), z.object({ id: z.string().min(1), label: z.string().optional() }).strict()])).max(48).optional().describe("Textures to show, by CTerrainTex id, each optionally with a label"),
        search: z
          .object({
            words: z.array(z.string().min(1)).optional(),
            without: z.array(z.string().min(1)).optional(),
            kind: z.enum(TEXTURE_KINDS).optional(),
            tones: z.array(z.enum(TEXTURE_TONES)).optional(),
            suits: z.array(z.enum(TEXTURE_SUITS)).optional(),
            tilesets: z.array(z.string().min(1)).optional(),
          })
          .strict()
          .optional()
          .describe("A search of the catalog's descriptions, instead of textures"),
        limit: z.number().int().min(1).max(48).optional().describe("How many of a search's matches go on the sheet (default 24)"),
        columns: z.number().int().min(1).max(8).optional().describe("Pictures per row (default 4, or 6 for a search)"),
      },
    },
    async ({ textures, search, limit, columns }) => {
      if (!textures === !search) return ctx.fail("Give textures or a search, not both");
      const matches = search ? searchTextures(stockTextures(), search) : [];
      const picked = textures
        ? lookUpTextures(stockTextures(), textures.map((item) => (typeof item === "string" ? item : item.id))).map((texture, index) => ({ texture, label: typeof textures[index] === "string" ? undefined : (textures[index] as { label?: string }).label }))
        : matches.slice(0, limit ?? 24).map((texture) => ({ texture }));
      if (picked.length === 0) return ctx.reply("No texture in the catalog matches");
      const { png, missing } = await renderTextureSheet(picked, { cacheDir: ctx.host.machine.cacheDir, columns: columns ?? (search ? 6 : 4), size: 200 });
      const listed = (search ? matches : picked.map(({ texture }) => texture)).map(describeTexture);
      const text = [
        ...(search ? [`${matches.length} match${matches.length === 1 ? "" : "es"}${matches.length > picked.length ? `, the first ${picked.length} on the sheet` : ""}:`] : []),
        ...listed,
        ...(missing.length ? [`No picture: ${missing.join(", ")}`] : []),
      ].join("\n");
      return { content: [{ type: "text", text }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
    },
  );

  tool(
    "texture_usage",
    {
      title: "Texture usage",
      annotations: READ_ONLY,
      description:
        "Reports what each texture slot of a Mission's Map Package paints, read from the package (ADR-0016): for each texture set (one per 8×8-cell block) and each of its 8 slots, the texture, the cells it is the dominant texture of, by Zone (a generating Zone's own cells, else the Kept Zone whose polygon holds them, else \"(no Zone)\"), and the cells with any weight of it; which slots are empty or painted nowhere; and how many more different textures fit under the Editor's 16. With a proposal (textures and the generating Zones it would paint, or set: the id of one of the Blueprint's textureSets), also: which of its textures the map has already (they cost nothing towards the 16), which are new, whether it fits, which layers the Kept ground in its Zones' blocks uses (the set must hold those textures on those layers, or the compile refuses), a slot order that meets them, which slots only those Zones use (emptying them after the move frees room), and textures that would meet themselves across the set's boundary, whatever their slots. It also lists each stretch of boundary between texture sets that needs cover, as a run of cells along an 8-cell block edge with the set and texture on each side: a hard cut where different textures meet, an artifact where a texture meets itself (whatever slot it has in each set); stretches under a cliff are left out. With render: true, it shows them over the ground round them, as the paint brushes' renders do (hard cuts red, artifacts magenta, cliff cells darkened): one image to each cluster of stretches, so sets far apart each get a readable view, with the cells each image shows. For each of the Blueprint's Paint Regions (ADR-0028), it measures each texture of the region's mix as painted, beside what the mix asked (a blend weight, an area share or the rest): its mean blend weight over the region's texels past the falloff and over the whole region, and its area share, the fraction of the region's cells it is the dominant texture of. A region the package can't show (no cell painted, or a texture its cells' set lacks) is listed as not measured, with why: compile after changing a region. Reads only.",
      inputSchema: {
        mission: MissionSchema,
        proposal: z
          .object({
            textures: z.array(z.string().min(1)).min(1).max(8).optional().describe("The proposed set's textures, in slot order"),
            zones: z.array(z.string().min(1)).min(1).optional().describe("The generating Zones it would paint"),
            set: z.string().min(1).optional().describe("One of the Blueprint's textureSets, by id, for its textures and Zones"),
          })
          .strict()
          .optional()
          .describe("A texture set to try: textures and the generating Zones it would paint, or one of the Blueprint's textureSets"),
        render: z.boolean().optional().describe("Show the boundary stretches that need cover over the ground round them"),
      },
    },
    async ({ mission, proposal, render }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const result = await missionTextureUsage(workspace, blueprintPath, { ...(proposal ? { proposal } : {}), render });
      if (!result.render) return ctx.reply(render ? `${result.text}\nNo boundary stretch to render.` : result.text);
      const { views } = result.render;
      const where = views.map((view, i) => `${i + 1}. ${areaLine(view.area)}`).join("\n");
      return {
        content: [
          { type: "text", text: `${result.text}\nRender, ${views.length} view${views.length === 1 ? "" : "s"} (${legendLine(result.render)}):\n${where}` },
          ...views.map((view) => ({ type: "image" as const, data: writePng(view.image).toString("base64"), mimeType: "image/png" })),
        ],
      };
    },
  );

  tool(
    "sound_mix",
    {
      title: "Sound mix actors",
      annotations: READ_ONLY,
      description:
        "Makes the actor data that plays a sound mix: several CSounds played as one sound, each from its own time after the mix starts (docs/reference/sound-mixes.md, the sound-mix skill). Each mix is one CActorSound whose Layers play their CSounds after their PlayDelay, each with its own variations; a layer with a stop is an actor of its own that stops itself on a timer, fading out first if it has a fade. Created with `Create <id>` from the unit's actor on an event (its death, an attack), the mix takes its place once and keeps playing where the unit was, after the unit dies. Every CSound a layer plays is checked against the game's packages (core's data/package-entries.json), the Workspace mods' own (their packages and Blueprint entries) and the files or folders in sounds (a Mission's Map Package, say): one defined nowhere would play nothing, so it is refused, naming the id it may have meant. Returns the entries as Generic Entries JSON (for a Mod Blueprint's entries) or, with xml, as elements for a map's ActorData.xml, with where each CSound is defined and the line that creates a mix. Reads only: add the entries yourself.",
      inputSchema: {
        mixes: z.array(SoundMixSchema).min(1).describe("The mixes: each an actor id and its layers ({ sound, at, stop?, fade? }, seconds from the mix's start), and optionally the silent CSound to play when no layer starts at 0"),
        xml: z.boolean().optional().describe("Give ActorData.xml elements instead of Generic Entries"),
        sounds: z.array(z.string().min(1)).optional().describe("More own data to find CSounds in, as paths from the Workspace: a SoundData.xml, a JSON file of Generic Entries, or a folder such as a Mission's .SC2Map"),
      },
    },
    async ({ mixes, xml, sounds }) => {
      const workspace = await ctx.workspace();
      const own = await workspaceSounds(workspace);
      try {
        for (const source of sounds ?? []) for (const id of await definedSounds(path.resolve(workspace.root, source))) own.add(id);
      } catch (error) {
        return ctx.fail((error as Error).message);
      }
      const { found, problems } = checkSoundMixes(mixes, own);
      if (problems.length > 0) return ctx.fail(problems.join("\n"));
      const entries = mixes.flatMap(soundMixEntries);
      const where = [...found].map(([sound, at]) => `${sound}: ${at.join(", ")}`).join("\n");
      const data = xml ? soundMixXml(entries) : JSON.stringify(entries, null, 2);
      return ctx.reply(`${data}\n\nCSounds:\n${where}\n\nCreate each mix from the actor of the unit it's for, on the event it's for. On a death: ${soundMixWiring(mixes[0]!)}`);
    },
  );
}
