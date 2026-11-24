---
name: exemplar-design
description: Visual design for SC2 campaign missions, from the active Style Pack's Exemplar Maps and Design Lessons. Proposes or critiques a Mission Blueprint's look (tileset, texture palette, cliffs, doodad dressing, water, lighting). Use for Stage 3 palette and placement work, when choosing textures, when dressing or lighting a Zone, when reviewing how a mission looks, or when adding an Exemplar Map.
---

Shape how a Mission looks so it matches the taste of the Workspace's active **Style Pack**: its Design Lessons, drawn from its Exemplar Maps. This skill is the method; the taste is the pack's. The layout itself (Zones, Connections, pacing) belongs to the `level-design` skill; this skill starts from an agreed sketch.

## Read the active Style Pack first

The Workspace names its Style Pack, and the sc2-adjutant MCP server serves its knowledge. Read it before proposing anything:

- The `list_plugins` tool names the Plugin in the `style-pack` role, with the ids of everything it contributes.
- The server's resources hold each Plugin's knowledge, at `sc2-adjutant://plugins/<plugin>/knowledge/<id>`, each with a title and a description saying what it covers. Read the Style Pack's through them, never from the pack's folder or package: the server serves the pack the Workspace loads, wherever it is installed.
- The server's prompts include the Plugins' own workflows, such as adding an Exemplar Map.

Read the pack's guide (often a `guide` document) and its Design Lessons whole; the guide says which lessons govern each step below and how much each weighs. Cite lessons by the pack's ids. Its Exemplar Maps (with their provenance), Map Studies and Doodad Composites are knowledge too: open them for numbers and examples, not as layouts to copy.

With no Style Pack active, say so, and work from the Asset Catalog and the author's answers alone.

## Propose a look

1. **Read the agreed sketch**: Zones, their `role`, `landform` and elevation, the Beats, and the screenplay's setting. Done when you can mark every Zone or level band as backdrop (ground units never walk on) or ground for play, and name each Zone's mood.
2. **Build the tileset**: the main ground family, any accent textures, cliff families paired with the ground they border (`cliffPalette`, and `cliffSets` for an area's own), water and lava (`water`), and the skybox and fog (`sky`). Check names against the Asset Catalog: the game's entries in sc2-adjutant core's `data/` (`texture-extracted.json` and `cliff-extracted.json` for textures and cliff sets, `*-catalog.json` for the rest), and the Workspace Campaign Mod's own tilesets, textures, cliff sets, Lights and doodads from the server's `asset_catalog` tool. A Campaign Mod's entry is used as a game one is.
3. **Texture each Zone** through the blueprint's `texturePalette`. Ask the author first whether they have a tileset or textures in mind, then fill the open slots from the pack's guidance. Choose textures from their pictures (`texture_sheet`), not their names. Beside Kept ground, a part of the map that needs its own look gets a texture set of its own: the `texture-sets` skill.
4. **Dress each Zone** through the blueprint's `dressing` and `set-piece` placements: cliff piles, edge lines, then set pieces, each from the mood its place calls for, following the pack's lessons. Name a Doodad Composite only for a shape no asset provides. To find the doodads that could make one object (a machine, a checkpoint), run a Doodad Search with the `doodad-search` skill.
5. **Light the mission** through the blueprint's `lights`, `lighting`, `lightRegions` (a light painted onto Zones) and `transitions` from its mood, and for each Beat ask whether its story calls for a lighting change.
6. **Finishing steps**: the author runs the Editor's Generate Static Shadows (Data menu, Cmd-Shift-L) after the last cliff edit and saves; any later cliff edit wipes it. The compiler doesn't reproduce it.
7. **Present it** per Zone: tileset choices, texturing, dressing, lighting, each with the lesson ids it follows. For anything the author may not picture, describe what the lesson's evidence shows, from its words and the Map Study's numbers. A Style Pack may ship no screenshots: show a frame only when the pack's guide says where one is on this machine and it's there, and otherwise say the frame isn't available. Done when every Zone has texture, dressing and lighting decisions and every lesson has been applied or set aside with a reason.

## Critique a look

Work through every lesson in the active pack against the blueprint and, once the map is compiled, what the author sees in the Editor or Test Document. Once the map is compiled, look at it yourself with `capture_shots`: one Shot per Zone, and 10-20-cell Shots of the dressing, in a single call (pass `lighting` to see a Zone under its Light); a Shot is a rectangle of cells (`rect: [left, bottom, right, top]`) and `lighting` takes a Light id. The frames are saved as images you read. It needs the macOS Host Adapter; on another machine, ask the author for screenshots. For each break, report the lesson id, where it breaks, and a concrete fix. A break the author chose on purpose is recorded, not argued. Done when every lesson is marked kept, broken (with a fix) or not applicable.

## Blueprint hooks

Each lesson names a Blueprint hook. Where the hook names a field the Blueprint schema doesn't have yet (`get_blueprint` and `patch_blueprint` report what validates), write the decision into the report under "Not yet in the schema" and leave the blueprint unchanged.

## Changing the pack

New taste from the author (a remark about what a kind of place always or never has) belongs in the Style Pack, not in this skill: record it in the pack's lessons with the date and the author's words, if the pack is one the author owns and edits. Building a Style Pack of the author's own, or adding an Exemplar Map to a pack in the Workspace, follows the `style-pack-builder` skill. A pack installed as a package follows its own instructions for that (its prompts, listed by the MCP server). For any pack, the `study_exemplar` tool builds Map Studies for the active pack's Exemplar Maps, reading their source maps from the folder the machine config's `exemplarMaps` (or `SC2_ADJUTANT_EXEMPLAR_MAPS`) names. Bring each new or changed lesson to the author one at a time before editing the pack.
