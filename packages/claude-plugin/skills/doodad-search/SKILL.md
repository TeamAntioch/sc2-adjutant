---
name: doodad-search
description: Finds the doodads that could make one object (a press over a conveyor, a checkpoint, a shrine) by breaking it into Search Parts, judging each candidate from its pictures and showing a page of ranked cards. Use when the author needs doodads for an object or set piece, asks what could make X or to see a kind of doodad ("show me industrial presses"), or accepts picks from a Doodad Search page.
---

A **Doodad Search** looks through the Asset Catalog (the game's doodads, its terrain objects and the Workspace's Campaign Mod's doodads) for the doodads that could make one object, and shows them to the author as a page of candidates. It is for one Mission or for none. It stops at the page. Drafting a Doodad Composite from the picks, or placing test copies, is `exemplar-design`'s work (`encounter-design`'s for a puzzle prop).

The tools are on the sc2-adjutant MCP server: `find_doodads` (served when the Doodad Finder package, an optional dependency of core, is installed), `search_doodads`, `decal_variations`, `build_doodad_sheets`, `build_doodad_search_page`, `add_doodad_note` and `contribute_doodad_notes`. Each is also a CLI in an sc2-adjutant checkout (`npm run search-doodads`, `doodad-search-page` with `--sheets-for` for sheets, `add-doodad-note`, `contribute-doodad-notes`), which works outside a Workspace too, and each takes `--help`. Renders come from `npm run thumbnails` on a machine with a Host Adapter that can render models.

## 1. Search Parts

Ask what the object is, and which Mission it's for, if any. Then break it into **Search Parts**. Each part is one thing to find, with a line saying what it has to read as to the player from the game camera, sized against a Marine: "press head: a heavy flat block that drops onto the belt; looks like it could crush a Marine". Every candidate is judged against that line, so make it concrete: shape, size, what it does, and what makes it read.

Suggest the parts the author missed:

- **Kits.** A machine never stands alone. It comes with its supply (hoses, cables, pipes), its stock, its light, its floor markings and sometimes a fault (smoke, sparks). Read the active Style Pack's knowledge through the server (`list_plugins`, then the knowledge resources) for its kits and recipes for the kind of place, often an interiors or dressing document. Blizzard's interiors use recipes like these: a machine with its hoses, light, stock and floor markings; a console with screens hung above it; crates packed edge to edge in two layers under a light.
- **Play.** A hazard or puzzle prop needs a telegraph the player can time it by (a warning light, a sound source, a moving part) and a mark for its danger zone (floor paint).

A one-part search ("show me industrial presses") is fine. Done when the author has OK'd the list of parts and their lines.

The **Doodad Finder** is the fast way through steps 1 and 2 on the author's own machine: they type asks into a local page, see ranked cards at once and tick the ones worth a closer look. Ticked cards collect in its tray, kept for the object the author names there: each ask they tick from is a Search Part, and its ticks its shortlist. Offer it for browsing many asks in a row. Like `find_doodads`, it comes with the Doodad Finder package. When the author asks to open it, call `open_doodad_finder`: it checks what the Finder needs, starts it or reuses the running one, and opens the page. Pass its checks on to the author, such as a ranker that is off and the command that fixes it. Where the tool isn't served, the package isn't installed (or, in an sc2-adjutant checkout, isn't built). In a checkout the author can also start it with `npm run doodad-finder -- --workspace <folder> --open`; the Doodad Finder's README there covers its credentials.

## 2. Narrow

A Doodad Search the Doodad Finder started skips this step: its parts come with shortlists (step 3). Otherwise, for each part:

1. **By meaning first.** Call `find_doodads` with the part's line as the `ask`, and `mission` for a Mission. It finds doodads that share no word with the ask, and Jev grades each from its text, best first, with a `level` from 0 (doesn't fit) to 3 (reads as exactly this). Give `tags` (`{ facet, value, pinned? }`) for facets the part should have; a pinned tag keeps only the doodads that match it. The level orders the shortlist; the picture still judges (step 3). An unranked answer says why, and its narrowing's order still holds.
2. **Keywords for what it misses.** Run `search_doodads` for lights and other doodads with no description, which only their id words find, and for ids or packages you already know. With no `find_doodads` on the server, run `search_doodads` for the whole part: several queries, each with a few words and the facets that fit. For a Mission, give `mission`, so the doodads its dependencies already provide sort first.
3. **Record every call** in the part: each `find_doodads` call in `asks` (`{ text, tags, ranker }`, with the answer's `ranker`, left out when it was unranked), each `search_doodads` query in `queries`. They go in `search.json`.

`search_doodads`' words and facets:

- Words match whole words and their plurals and inflections ("crate" finds crates, not crater; "press" finds presses and pressed). End a word in `*` to match the start of words ("stamp*" finds stamper). `role`, `story` and `biome` each take several values.
- Try the part's function, its shape and its trade ("press, crusher, piston, compactor"; "gantry, frame, arch, crane"). Facets (`kind`, `role`, `story`, `biome`) cut the noise from other races and biomes.
- Lights and some other doodads have no catalog description. Only their id words find them ("alarm", "landing", "blink"), and any facet drops them. Search for them once with no facets.
- Campaign Mod doodads are searched like the game's, from the mod's doodad index (`mods/<id>/doodad-catalog.json`): their description, Doodad Uses and sheet. One whose description wasn't written for its current model comes back `pending`. One with no description at all matches by its name and id alone, and any facet drops it.

From the looks and levels, shortlist up to ten candidates per part, more than will survive. Done when each part has a shortlist and every call is recorded.

## 3. Pictures

Judge every candidate from a picture you have looked at. Its look and name only shortlist it. Each result gives its picture: its turntable **sheet** (variation 00 from four sides) when this machine has one, else its gallery picture (one angle), else none.

**A search the Doodad Finder started** begins here. Its look-closer button copies a prompt that names the search's `search.json` by its full path, which the author pastes to you, or they give you the file. The file's folder is the search's folder: give `build_doodad_search_page` that folder in step 5, and put the search's renders there. Each Search Part has a `shortlist`: the ids the author ticked, best first, each with the ranker's `level` (0 doesn't fit to 3 reads as exactly this). Its `asks` are what the author typed, with the tags they ran with. Read the file and take each part's shortlist as the shortlist for that part. Its `readsAs` began as the ask the cards were ticked from, and the author may have edited it: confirm each part's line with them before judging. Skip section 2 (Narrow), unless a part's shortlist is thin. The ranker's level only orders the shortlist. It doesn't stand in for a picture, so look at every shortlisted candidate's picture as below.

1. **Sheets first.** When results say their renders are here but no sheet is, offer to build them. Call `build_doodad_sheets` with the shortlist's ids (or `npm run doodad-search-page -- --sheets-for <id,...>`). It builds those candidates' sheets only, for a shortlist of any length, with no `search.json`, and gives each sheet's path.
2. **Look at every candidate's picture** with the Read tool: the sheet's path, or the gallery picture. The result gives a gallery picture's URL in the sc2-mapping-reference repo's `public/doodads/`. Read it from a local clone of that repo, or download it into the search's folder first.
   - A sheet frames each model to fill its tile, so it shows no scale. Gallery pictures usually have a Marine beside the model: use them for size.
   - A model framed tiny or a broken render (stretched polygons) says little. Judge from the gallery picture instead, and say so.
   - For a decal, call `decal_variations` with its id: it says what every variation shows, whether it carries a number, letter or words, and gives the path of the doodad's labelled sheet of every variation when this machine has one. Otherwise use the gallery picture, which also shows every variation from above. Don't use a decal's turntable sheet: it shows variation 00 alone, if the model rendered at all. Recommend a variation by number, and a number or words only where they label something.
3. **A pending Campaign Mod doodad**, or one with no sheet on this machine: when it looks promising, bring the mod's doodad index up to date with `index_mod_doodads` (or `npm run index-mod-doodads`), giving the promising ids as `only`. It renders them, builds their sheets and writes their entries. Describe each new or pending entry from its sheet, in core's words, as the tool's description says, then search again: the doodad now matches on its words and comes back with its sheet. One marked `unpictured` has nothing to draw, so judge it from its name and data.

Done when you have looked at a picture of every shortlisted candidate, or noted that it has none.

## 4. Judge

Judge each candidate against its part's line. Its note says what it is, how it fits or falls short, and what it would take: its colour and race, its scale against a Marine, whether it belongs to a set with another part's pick, and how to place it. Set `judgedFrom` to what you judged from. The page then says "judged from one angle" for a gallery picture. Rank 6–10 candidates per part, best first. A part may truly have fewer. Put the rest in `alsoConsidered`, each with the reason it was ruled out.

- **Variations.** For the top 2–3 candidates of a part with more than one variation, render and judge the others too, when this machine can render: `npm run thumbnails -- <ids> --all-variations --out <search folder>/renders --sheets`, then read each `<id>_<variation>.jpg`. Record each in `variationsChecked`. When a later variation is the better pick, set the candidate's `variation` to it and say so first in the note ("use variation 03: the bare arch"). The card then shows that variation's sheet from the search's `renders/` and says which variation it shows.
- **Size.** A sheet shows no scale. For a candidate's size in game units, run `npm run model-footprints -- --print [--variation <n>] <doodad id>...`. It takes doodad ids and prints each model's w × d × h (its x × y × z extents). Always pass `--print`: without it the command records into core's tracked `data/model-footprints.json`.
- **Nothing good.** When the game has nothing that reads right for a part, say so and offer the `community-assets` skill, which searches community-made assets.
- **A wrong look.** When a picture shows the catalog's look is wrong or too thin, tell the author and offer a corrected look (`add_doodad_note` with `look`), to contribute like a Doodad Use (step 6).

In a search the Doodad Finder started, every id in a part's `shortlist` becomes a candidate or goes in `alsoConsidered`. Then empty the shortlist (`"shortlist": []`) and keep the `asks`, and add any `search_doodads` queries you ran. `build_doodad_search_page` refuses to build while any part's shortlist has ids in it, and names those parts.

Done when every shortlisted candidate is a ranked card or in `alsoConsidered`, every Doodad Finder shortlist is empty, and every card's note was written from a picture you looked at.

## 5. Show

Write `search.json` and build the page with `build_doodad_search_page`, giving the `slug` (such as `crushing-press`), the `mission` and the `search`. The tool's description gives the file's shape and the folder it goes in: the Mission's git-ignored output folder, or for no Mission a folder you name with `folder`. Put the search's renders in that folder too (`<folder>/renders`). Rendered game assets stay out of every repo.

Give the author the page's path to open, with one line per part naming its top pick. The page ends by pointing to the next step, drafting a Doodad Composite. Done when the author has the page. The search stops here until they accept picks.

## 6. On acceptance

When the author accepts picks from the page:

1. **Draft a Doodad Use** for each pick and show it before adding it with `add_doodad_note`. A Doodad Use is a short, general phrase for what the doodad was accepted as ("press head over a conveyor", "gantry frame"). Keep it general: no Mission, character or story names, so it helps any later search. Give any variation or scale that made it work as `variation` (the Editor's number, 3 for 03) and `scale`, not in the phrase, and `from` as the search and today's date ("crushing-press search, <date>"). The search shows them with each use.
2. **Record the Mission's decision** in the Mission's design notes. A Workspace keeps a Mission's notes as Markdown files in its folder, beside its Blueprint (`missions/<id>/`). Add to the note that covers the place or object, or start `missions/<id>/doodads.md`. Record the object, each part's pick (id, variation, scale), the dependency it needs, and the search's folder. A search for no Mission has no decision to record.
3. **Offer to contribute:** "Would you like to contribute this to the public doodad catalog, sc2-asset-catalog?" On a yes, run `contribute_doodad_notes` with `dryRun` first and show what it would send, then run it for real. It needs `gh` and GitHub access, and opens a pull request on TeamAntioch/sc2-asset-catalog, from a clean checkout of it if you name one (`checkout`), else from a fresh clone. It keeps back, with why, any note that names a Mission, the Campaign, a mod or a character: offer the author a general rewording, then run it again. A Campaign Mod doodad's Doodad Use goes into its own entry in the mod's doodad index, and is never offered. Without GitHub, or while an earlier contribution's pull request is still open, all the notes stay there and nothing is lost.

Done when each pick's Doodad Use is added or declined, the Mission's decision is recorded, and the offer to contribute is answered.
