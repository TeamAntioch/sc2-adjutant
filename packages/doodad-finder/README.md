# Doodad Finder

The Doodad Finder is a local page for asking for doodads in plain words and seeing ranked cards at once. It narrows each ask with the catalog's keyword search and a local embeddings model, then Jev grades the candidates from their text. Ticked cards collect in a tray, whose ids and dependencies you copy into the Editor. In sc2-adjutant, "look closer" hands the tray to the `doodad-search` skill as a Doodad Search, for judging from pictures. Why it works this way: [ADR-0020](../../docs/adr/0020-doodad-finder-narrows-locally-and-ranks.md), and for the public release, [ADR-0022](../../docs/adr/0022-open-source-doodad-finder-as-sc2-asset-catalog.md). Terms: [GLOSSARY.md](../../GLOSSARY.md) (Doodad Finder, Doodad Search, Search Part).

## Two repos

The Finder is the public [sc2-asset-catalog](https://github.com/TeamAntioch/sc2-asset-catalog)'s, published as `@team-antioch/sc2-doodad-finder` (with the catalog it searches, `@team-antioch/sc2-asset-catalog`). This package is sc2-adjutant's own Finder over it, a thin wrapper that depends on both at a pinned version:

- `src/adjutant/` calls the published `startFinder` with the author's options (below): core's committed catalog, the Workspace's Campaign Mod doodads and notes, Mission badges, Doodad Searches as the tray's objects, look closer, and a tick log per Mission.
- `src/find-doodads.ts` and `src/open-doodad-finder.ts` are core's `find_doodads` and `open_doodad_finder` MCP tools, and `src/cli/test-doodad-finder.ts` the test command over past Doodad Searches.

The page, the narrowing, the ranker, the spend cap and the cache folder are the package's, and so is their documentation, in its README. A change to them is made in sc2-asset-catalog and adopted here by bumping the pin. [docs/agents/asset-catalog.md](../../docs/agents/asset-catalog.md) says how, and how to run against a sibling checkout with `npm run link-catalog`.

## Starting it

From an sc2-adjutant checkout:

```sh
npm run doodad-finder -- --workspace ../my-workspace --open    # sc2-adjutant's
npx @team-antioch/sc2-doodad-finder --open                         # the public one, from any folder
```

sc2-adjutant's Finder builds the cards and opens the page at `http://127.0.0.1:4634/`. Ctrl-C stops it. The process listens on 127.0.0.1 only. It takes:

- `--workspace <folder>`: the Workspace whose Missions and Campaign Mod doodads it uses. Without it, the Workspace above where the command was typed, else core's catalogs alone. `--no-workspace` uses core's alone.
- `--port <n>`: another port.
- `--budget <dollars>`: the session's spend cap on Jev, $1.00 by default (see below).
- `--open`: opens the page in the browser.

The public one searches the catalog it extracts into the cache folder on its first start, with no Workspace, and takes `--tick-log <folder>` instead of the Mission tick logs. sc2-adjutant's searches core's committed catalog (`packages/core/data/`, through core's `src/catalog/stock-catalog.ts`), so it needs no extract.

The first start downloads the embeddings model (gte-small, about 34 MB) and embeds every card. Later starts embed only cards whose text changed. While it runs, it watches core's catalogs and Doodad Uses, the Workspace's notes and the mod's doodad index, and embeds changed cards again within a second.

### The cache folder

The model's weights, the card vectors, Jev's payload logs and the page's settings go in the platform's cache folder, in `sc2-asset-catalog/`:

| Platform | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\sc2-asset-catalog\` |
| macOS | `~/Library/Caches/sc2-asset-catalog/` |
| Linux and others | `$XDG_CACHE_HOME/sc2-asset-catalog/`, else `~/.cache/sc2-asset-catalog/` |

`SC2_ASSET_CATALOG_CACHE` moves the whole folder, and `SC2_ASSET_CATALOG_MODEL_CACHE` (or `SC2_ADJUTANT_MODEL_CACHE`) the model's weights alone. Everything in the folder is a copy, safe to delete: the next start downloads or embeds it again.

### Pictures

Each card shows the doodad's sheet (its four turntable angles, built on this machine) if there is one, else its gallery picture from sc2-mapping-reference, which has a Marine for scale. sc2-adjutant's sheets are core's, in `packages/core/data/catalog-sheets/`. They and the renders they come from are git-ignored, so a linked worktree has none of its own: core looks for them in the main checkout too. Build the missing ones there with `npm run catalog-sheets` (from renders made by `npm run thumbnails`).

### Starting it from Claude

Ask Claude to open the Doodad Finder. Core's MCP server has an `open_doodad_finder` tool for this, served only when this package is installed, like `find_doodads` below. It starts sc2-adjutant's Finder.

- Before a start it checks, and says plainly: core is built (and not older than its src), the Workspace, the embeddings model is cached, whether the Finder will have Jev's key, and whether from `TYPESAFE_API_KEY` or the key file `login` saved (never the key itself), and how many catalog entries have no picture here. None of these stops a start. A missing one says what will be off and what fixes it.
- It reuses a Finder already answering for this Workspace, and then only opens the page. Each Finder says at `/status` that it is the Doodad Finder, its pid and its ranker, and sc2-adjutant's says its Workspace. The tool asks the port in its pid file first, then 4634, which also finds a Finder started by hand. A Finder that doesn't say its Workspace makes the tool start its own beside it.
- Else it starts one detached, so it outlives the Claude session, and waits up to 120 s for its page. Its pid and port go in the Workspace's `output/doodad-finder/finder.json`, and its output in `finder.log` beside it. That folder ignores itself. With no Workspace, they go in the cache folder's `doodad-finder/process/`. When 4634 has another Workspace's Finder, or anything else, it uses another free port.
- It opens the page in the default browser, with `open` on macOS, `explorer` on Windows and `xdg-open` on Linux. `window: "app"` opens a Chrome app window instead, on macOS when Chrome is installed; elsewhere it opens the default browser and says so. `window: "none"` gives only the URL.
- `stop: true` stops the Finder the tool started, by its pid file. It never stops one it didn't start.

The Finder it starts inherits the MCP server's environment, so a `TYPESAFE_API_KEY` counts only where Claude Code is started. A key saved with `login` works from anywhere.

## Jev and its key

Jev (TypeSafe AI's System One model) is the only ranker. Only the process holds the key; the page never sees it.

- **The key** comes from `TYPESAFE_API_KEY` in the environment, else the key file that `npx @team-antioch/sc2-doodad-finder login` saves in the per-user config folder (`~/.config/sc2-asset-catalog/` on macOS and Linux, `%APPDATA%\sc2-asset-catalog\` on Windows, readable only by you). The variable wins. `logout` deletes the file. There's no Keychain or credential-manager lookup. The package's README has the details.
- **Without a key**, the Finder narrows only: the cards come in the narrowing's order, and the page says Jev is off and why.
- **What each ask sends:** the ask, the tags and the narrowed cards' text (name, id words, look, facets and Doodad Uses). No pictures and no files. Every call's exact payload is logged to the cache folder's `ranker-payloads/`.
- **What it costs:** Jev charges for input tokens only. An ask's 200-odd cards come to a few tens of thousands of tokens, estimated at about a tenth of a cent at the list price. The page shows the estimated spend this session.
- **The spend cap:** once the session's estimated spend reaches `--budget` ($1.00 by default), the Finder stops calling Jev, shows the narrowing's order, and says so on the page. A call already sent may take the spend a little past the cap. Start the Finder again with a higher `--budget` to rank more.

## Using it

1. Type an ask. Cards come from the narrowing as you type. On Enter, or after the pause set on the page, Jev orders them.
2. Tick a card to put it in the tray. The facets of the tray's cards become tags: pin one to keep only cards that have it, or drop it. Each card in the tray has **Copy**, for its id and the package it needs (`FoundryStamperHead (needs Void (Campaign))`), and the tray has **Copy all**, for every id, one a line, then each package the map needs once. The page copies with the browser's clipboard during the click. Where the browser won't, it shows the text selected to copy by hand.
3. **The tick log** (public Finder): with `--tick-log <folder>`, every tick appends the ask, its tags and the ids ticked from it to `<folder>/ticks.jsonl`. Without it, nothing is logged. The test command reads it with `--tick-log`.

### In sc2-adjutant

- **Missions:** with a Workspace, the page offers its Missions. With one chosen, the cards its dependencies provide say "in this Mission" and come first. Others say the package they need.
- **Objects:** name the object in the tray (**Object**, then **Start**) and the tray is kept as its Doodad Search, for the chosen Mission: `missions/<id>/output/doodad-search/<slug>/search.json` (git-ignored), or the research archive's `doodad-search/<slug>/` for no Mission, which needs `SC2_RESEARCH_DIR`. The cards already in the tray go into it. While it is open, Jev gets its title as context for each ask, and its Mission stays chosen. Each ask cards were ticked from is a Search Part, its ticked ids the shortlist, best first, with Jev's level (a card ticked before its ask was ranked is ranked then, so an object needs Jev). Its line starts as the ask and can be edited in the tray, for each ask with a card ticked. search.json is written on every tick, untick and edit, keeping what the `doodad-search` skill has judged since. **Clear** unticks its cards too, and **Put away** closes it. With none open, the tray lists every Doodad Search with a shortlist left, to **Reopen**.
- **Look closer** hands the open object to Claude. It copies a prompt naming its search.json with the system's clipboard command (since a copy from the page after the process answers may not count as your click): `pbcopy` on macOS, `clip` on Windows, and the first of `wl-copy`, `xclip` and `xsel` that copies on Linux. Without one, the page tries the browser's clipboard, else shows the prompt selected. Paste the prompt into Claude: the `doodad-search` skill judges each shortlisted card from its picture and builds the Doodad Search's page. The object is then put away.
- **Tick logs:** every tick is logged to the chosen Mission's git-ignored `output/doodad-finder/ticks.jsonl` (for none, `doodad-finder/ticks.jsonl` in the research archive, else in the cache folder). The test command uses them as more cases.

### The start function's options

`startFinder(options)`, the published package's, takes the public defaults when given nothing. Its options beyond `port`, `budget`, `tickLog` (a folder) and `cacheDir` are for sc2-adjutant and may change, so a pin bump checks them (`tests/adjutant-finder.test.ts`). Each is a value passed in; nothing is discovered or loaded by name. `src/adjutant/options.ts` builds sc2-adjutant's.

- `sources`: what the cards are made from, as `{ load, watch }`. By default, the catalog extracted into the cache folder (extracted on a first start). sc2-adjutant always passes core's.
- `badges`: a choice the page offers (`label`, `choices`, the `provided` badge text, `dependenciesOf(choice)`), whose dependencies badge the cards.
- `objects`: what the tray can be kept for (`label`, `placeholder`, `start(title, choice)`, `unfinished()`, `reopen(key)`, `save(object)`). An object has a `key`, a `title` (the ranker's context), the `choice` it is for, its `ticks` (each with its ask, tags and level), each ask's edited `lines`, and the `pinned` tags to pin when it opens. `save` is called on every tick, untick, clear and line edit. Without it, the tray is the session's and there are no lines.
- `trayActions`: buttons on the tray (`label`, `title`, `inputs`, `run(context)`), each run on the tray's cards with the badges' choice, the open object, its inputs and a way to get Jev's levels. A result can empty the tray (`clearTray`) or put the object away (`putAway`).
- `tickLog` as a function: the tick log's file for a badges choice.
- `ranker`: the ranker slot, for tests' fakes (`null` turns ranking off).
- `settingsFile` and `status`: where the page's settings go, and more for `/status` to say.

## For agents: `find_doodads`

Core's MCP server serves the Finder's narrowing and Jev ranking as the `find_doodads` tool, so the `doodad-search` skill can narrow each Search Part by meaning. It serves it only when this package is installed. Core lists it as an optional dependency, so an npm install of core has it unless optional dependencies are left out, and core imports nothing of it: its server (`packages/core/src/mcp/find-doodads.ts`) finds the package by its name, `@team-antioch/sc2-adjutant-doodad-finder`, and loads the built `dist/find-doodads.js` with a dynamic import. In a checkout the name resolves to this folder, through the workspace's link. That file imports core from core's `dist/`, the same files the server runs, and the Finder from the published package. Where the package isn't installed, or isn't built, the tool isn't served.

- It takes an `ask` (a Search Part's line), and optionally a `mission`, `tags`, a `count` (20 by default) and `rank` (true by default).
- It gives `search_doodads`' results with Jev's `level`, the narrowing's size, timings and the call's estimated spend.
- It ranks with Jev, with the same key as the page. With `rank: false`, with no key or when Jev fails, it gives the narrowing's order and says why. While there is no key, each call looks for it again, so a key set meanwhile needs no restart.
- The model, cards and vectors load on its first call and stay loaded for the server's life, with the same cache and watching as the page's process. Each call's exact payload goes to the cache folder's `ranker-payloads/mcp-<time>.jsonl`.

## Tests and the test command

- `npm test -w @team-antioch/sc2-adjutant-doodad-finder` runs the wrapper's tests against the installed packages: the pinned, published ones, or a linked checkout's. They use fakes for the embeddings model and the ranker, and make no live calls. CI runs them against the pin. The package's own tests are in sc2-asset-catalog.
- `npm run test-doodad-finder -- --workspace ../my-workspace` is the test command. It runs the narrowing on the Search Parts of past Doodad Searches and the tick logs (the Missions', the research archive's, and a public Finder's with `--tick-log <folder>`), with the real model, and reports the hit rates and timings. It fails on the speed targets in spec #630. With Jev's key (`TYPESAFE_API_KEY` or the saved key file), Jev grades every ask: these are live calls, made only when it's run by hand, and the command stops before its estimated spend passes `--budget` (0.50 US dollars by default). `--no-rank` makes no calls. `--help` lists the rest.
