---
name: texture-sets
description: Builds a custom terrain texture set for part of a Mission, beside Kept terrain or on a fully generated map: picks up to 8 stock textures from any tileset to fit a theme, judged from their pictures, reuses what the map has, declares the set in the Blueprint and paints its Zones with it. Use when a part of a map should look different from the rest (an interior, a different district), when the map's 8 textures don't fit a new area, when choosing textures for a theme, or when asked which textures a map uses and what could be freed.
---

A map holds up to 8 **texture sets** of 8 textures, and each 8×8-cell block draws on one of them. The Editor allows 16 different textures across the sets. A texture set of the Mission's own gives part of a map its own look without touching the rest. It is declared in the Blueprint's `textureSets`, and the compile writes it into the Map Package (ADR-0016 in sc2-adjutant's `docs/adr/`). The format and the Editor's behaviour are in `docs/reference/terrain-file-formats.md`, under "Texture sets" and "Custom texture sets".

This skill works on a Mission with Kept terrain and generating Zones (Zones with `"terrain": "generate"`), and on a fully generated Mission, where every Zone generates. On a generated map, set 0 is the Mission's own 8 textures (`textures` or `texturePalette`, the `exemplar-design` skill), and a set adds 8 more for some of its Zones. Set 0's textures count towards the 16 even where every Zone is in a set, so make one look the Mission's own palette and the others sets. There is no Kept ground there, so skip the shared textures and required layers of step 4, and the `texture_usage` proposal, which checks them (it takes generating Zones beside Kept ground only). Read the active Style Pack's texture lessons first, as that skill says: they still govern what goes where.

**On a generated map, line the set's Zones up with the 8-cell blocks.** A block draws on one set. Where Zones of two sets share a block, the compile snaps the block to the set whose Zones cover most of its cells. A Zone in no set counts for set 0, and a tie goes to set 0, then to the set listed first. The other Zones' cells there are painted from the winning set, with the texture most of the block wears, and the compile warns, listing each snapped block. Move a Zone's edge onto a multiple of 8 to keep its own look up to it.

## 1. Read what the map has

Run `texture_usage` for the Mission. It lists each set's slots, each with the cells it is the dominant texture of, by Zone, and the cells with any weight of it. It also lists which slots are empty or painted nowhere, and how many more different textures fit under 16. Note:

- **Room.** 16 less the different textures the map holds. A texture painted nowhere can be emptied to make room with `edit_kept_terrain` and `{ "brush": { "op": "clear-slot", "slot": <slot or texture name> } }`, with no area (see "Freed slots" in step 4).
- **What the area's Zones use now**, and whether any of the map's textures already fit the theme. Those can go in the new set at no cost, since a copy in another set counts once.
- **The area.** The set covers every block holding a cell of its Zones, so ask which generating Zones it paints. Usually that's every Zone of the area, doors and walls included.

## 2. From a theme to roles

Get the theme in a sentence from the author. For example: _an industrial interior, with grime, metal plating, grates and oil-stained concrete_. Then split it into the roles a set fills. Not every set needs all of them:

| Role | What it is | Catalog `suits` |
|---|---|---|
| Base | The ground most of the area wears | `base` |
| Variant | A second base, close in tone, to break up large floors or mark rooms | `base`, `variety` |
| Trim or edge | Framed or banded panels for borders, around machinery, along walls | `accent`, `path` |
| Path or walkway | Where people walk: catwalks, corridors, landings | `path` |
| Grate or mesh | Open metal over a void: vents, gantries, the edge of a drop | `accent`, `path` |
| Accent | Small doses: wreckage, rubble, stains, a hole in the floor | `accent`, `variety` |
| Shared | Textures the Kept ground in the set's blocks shows, at their layers (step 4) | — |

Keep to one or two tones, with one contrast (a darker walkway, a warmer trim). Eight textures that all shout make noise, not a place.

## 3. Choose by sight

Never choose a texture from its name. Names say where a texture came from, not what it looks like.

1. **Search** the catalog with `texture_sheet` and a `search`: words for the role ("grat", "mesh", "plates", "stain"), the `kind` (`built` or `natural`), `tones`, `suits`, and `without` for families that don't fit (Protoss gold, alien growth, glowing seams). The matches come back as text with each texture's catalog look, and the first ones on a sheet of pictures.
2. **Shortlist** two to four candidates for each role, and show them on one sheet (`texture_sheet` with `textures`).
3. **Check the details** that matter at game zoom. Details a catalog look mentions, such as "hazard stripes" or "stencilled markings", are often thin trim that disappears at game zoom. Bold markings come from doodads and decals, not textures.
4. **Pick the set** and show it on one sheet, each texture labelled with its slot and role (`{ "id": "...", "label": "9 base floor" }`). Check the textures sit together: one light source and one palette, with nothing that reads as another planet. Show the author this sheet before going on.

A texture with no gallery picture shows as a grey tile: judge it from its look, or in game.

The Editor's own texture thumbnails (Map Properties > Textures, the texture brush) can be wrong: `PortCityB7`'s is tan, but in game it is grey stained concrete, as its gallery picture shows. When a thumbnail and the sheet disagree, look at the texture in game (Test Document) before changing the pick.

## 4. Check the set against the map

Run `texture_usage` again with a `proposal`: the chosen textures and the Zones. It reports:

- **Reused and new** textures, and whether the map stays within 16.
- **Required layers.** A Zone's cells are 2×2-aligned and a block is 8×8, so the set's edge blocks usually hold some Kept ground. Its texels keep their weights and are read in the new set, layer for layer. Each texture the Kept ground shows there must sit at the same layer in the new set, or the compile refuses. The report says which, and gives a slot order that works. Prefer the other fix: an apron Zone (a generating Zone of the set) over the rest of those blocks, up to the 8-cell grid, so no Kept ground is left inside the set. A shared texture costs nothing towards the 16, but it meets itself at the boundary, which glitches.
- **Freed slots.** Slots of the old set that only these Zones use. Once the Zones move, those textures are painted nowhere. After the compile, empty each with `edit_kept_terrain` and `{ "brush": { "op": "clear-slot", "slot": <slot> } }` (no area, no confirm) to make room. It writes the slot's name as `""`, as the Editor does for an empty slot, and changes no cell's look. It is refused, naming the cells, while any cell of the slot's set still has weight on its layer or has it as its sync texture, counting for a set-0 slot the Kept cells of a Blueprint set's edge blocks where that set holds the same texture on the same layer, since a compile sends those blocks back to set 0 once no Zone of the set holds a cell there: paint those over first. It is refused, naming the Zones, while a generating Zone outside the Blueprint's sets with cells on the slot's set names its texture: give the Zone another texture first. A slot of one of the Blueprint's own sets is Compiled Content and is refused too, for a swap as well: leave that position of the set's `textures` empty (`""`) in the Blueprint instead.
- **Boundary risks.** Textures in the set that the blocks next to it hold too.

A boundary between sets is never clean. The same texture touching itself across it renders an artifact in the Editor, whatever slot it has. Different textures meet in a hard, straight cut along the block edges. So plan the boundary before painting, and put it under something that hides it: a wall, a cliff edge or a line of doodads. The block grid is axis-aligned, so a diagonal edge becomes a staircase of 8-cell steps, which needs cover along its whole length. Lay the area out with that in mind: let its outer walls or cliffs follow the block grid, or give it an apron of the set's own texture out to the grid, under a doodad line.

If there's no room, drop a texture or reuse one of the map's. If two textures need one layer, move the Zones off the edge blocks.

## 5. Declare and compile

Add the set to the Blueprint with `patch_blueprint`, and give each of its Zones a `texture` from the set:

```json
"textureSets": [
  { "id": "interior", "textures": ["<shared>", "<base>", "<variant>", "<stained>", "<trim>", "<walkway>", "<grate>", "<accent>"], "zones": ["interior-*"] }
]
```

- The order is the slot order. The first is layer 0. Use the order `texture_usage` gave.
- `zones` takes ids or patterns with `*`: `"interior-*"` covers every generating Zone whose id starts so. A pattern follows a relayout, where Zones come and go, without editing the set. Name an area's Zones with a shared prefix to make that work.
- `name` (optional) is the set's tileset, shown in the Editor's Texture Set menu. By default it is the tileset listing most of the set's textures. The compile writes a map-local override of that tileset listing the set's textures, since the Editor otherwise swaps any texture its tileset doesn't list for one of the tileset's own. So it can't be a tileset the map overrides already in its own data: the compile refuses one.
- `levels` (optional) takes every generating Zone at those cliff levels too: `"levels": [1, 2]`. A Zone any set's `zones` names keeps that set, so lists win over levels. A level is in one set at most. Use it where a look follows depth, not area, such as a cave whose rock bands span the map.
- A Zone with no `texture` takes the texture its neighbours show, if the set has it, else the set's first. On a generated map it wears the set's first, unless the set has a `palette`.
- `palette` (generated map only) paints the set's Zones as `texturePalette` paints the rest: `main`, up to 3 `variety`, `low` and `high` bands and `built`, all from the set's textures. Bands count from the set's main level, `mainLevel`, else the level most of its Zones' cells are on: give `mainLevel` so a relayout can't move it. Natural Zones get variety patches (DL-01), backdrop Zones their band's texture alone, and the compile warns, naming the set, where a cliff inside the set doesn't change texture (DL-02). Choose the set's 8 as a palette: a base, variety close to it in tone, a texture for each band.
- Beside Kept ground, a Zone outside the set whose cells fall in its blocks must use a texture the set holds: the compile refuses one that doesn't. On a generated map such blocks snap instead, with a warning (above).

Then `compile_map`. Ask the author to close the map in the Editor first. The compile warns with each stretch of the set's boundary that needs cover (below). The compile writes the set's name and slots, the blocks' sets, and the sync file. Every Kept texel stays as it was. Compile it again: nothing should change. The compile record lists the set as `texture-set:<id>`. If the author changes it in the Editor (Map Textures, or the Texture Set brush on its blocks), the next compile asks to keep or discard it. Removing the set from the Blueprint puts its blocks back on set 0, as long as their ground reads the same there.

## 6. Cover the boundary

Run `texture_usage` with `render: true`. Below the slots it lists each stretch of boundary between sets that needs cover, one line each:

- **Hard cut along x = 136, y 48-63 (16 cells): A (set 0, cells at x 135) | B (set 1, cells at x 136).** Different textures meet in a straight line along the block edge.
- **Artifact along …, A meeting itself.** The same texture lies on both sides, whatever slot it has in each set.

The line is a cell edge (`x = 136` runs between cell columns 135 and 136), and the cells either side are named. Stretches under a cliff are left out, only counted. The render shows the stretches over the ground round them: hard cuts red, artifacts magenta, cliff cells darkened. Stretches near each other share a view, and each cluster far from the rest gets its own, with the cells it shows.

Cover every stretch: a wall, a cliff edge or a doodad line along it, in the Blueprint's dressing or in the Editor. Artifacts along edge blocks that still hold Kept ground come from the texture the set shares to keep that ground's look (step 4). An apron Zone of the set over the rest of those blocks lets the set drop the shared texture, and the artifact becomes a hard cut, which still needs cover but no longer glitches. Then run `texture_usage` again: a stretch the author covers with a cliff drops off the list, but one under doodads stays listed, so check those in game.

## 7. Present it

Give the author:

- The set's sheet, labelled by slot and role, and what each Zone is painted with.
- The `texture_usage` summary: what is used where, how many textures the map holds now and how many fit, and what could be freed.
- The boundary render, and what covers each stretch.
- In-game frames, when the host can capture: after compiling, call `capture_shots` with a Shot over each stretch of the boundary and one over each Zone the set paints, in a single call, and read the frames before you present (a Shot is a rectangle of cells, `rect: [left, bottom, right, top]`; it needs a Host Adapter with `editor.captureTour`, the macOS or the Windows one, so where it's refused ask the author for screenshots); pass `lighting` (a Light id) to see the set under the map's Light.
- What to look at in game: the set's boundary (every stretch of it covered, by a wall, a cliff or doodads), the details a picture hides (trim, scale), and how it reads under the map's lighting. Lighting changes a texture's tone more than its picture suggests.

For the author to judge the set in game against the map before it, or two candidate sets against each other, run a Still Review with the `still-review` skill.

Changes the author asks for (a different base, a warmer trim) go back to step 3 for that role alone. A note about how much of a texture shows in part of the map ("a hint of stone along the wall") is a Paint Region (below).

## Paint Regions: how much of a texture, where

A palette or a set names textures with no amounts. To say how much of a texture shows in part of the map, write a **Paint Region** with `paint_region` (ADR-0028): an outline (a Zone, a `rect` of cells, or a box on a Still Review frame) and a mix that overrides the Zones' palette inside it, feathered over `falloff` cells (2 by default). Each mix entry is one of:

- **Blend weight**, `{ texture, weight }`: that fraction of the texture's layer in every cell. Use it for a texture *through* the ground, everywhere in the region: a hint of grime over the floor, the grass a little greyer.
- **Area share**, `{ texture, share }`: patches of the texture over about that fraction of the region, the variety painter's washes with full-strength cores. Use it for *some places* being the texture: rubble over a fifth of the ground, a few patches of sand.
- `{ texture }`: takes what the others leave, at most one. Without it, the ground the Zone's palette paints fills the rest.

Weights and shares together are at most 1. A note like "15% stone" can mean either: ask the author whether they mean a hint in every cell or patches over 15% of the ground. Each texture must be in the texture set of every cell the region paints, and `paint_region` refuses one that isn't, naming the set and its textures.

**On height-blended textures a low weight shows as crevice patches, not a tint.** On a LotV tileset that turns height blending on (BelShirEx2, CharEx2, MarSaraEx2, Slayn and others), the game multiplies each layer's weight by its texture's height map and cuts any layer well below the strongest. A stone at weight 0.15 then shows in the other textures' crevices, in patches, and covers less than 15%. Over a texture with no height map (every Liberty and Swarm texture) it can vanish, and above about half weight the stronger texture takes nearly every texel. So on such ground a low weight gives "peeking through the cracks", and an even tint comes from a base texture closer in tone. On a tileset with it off (`KorhalCityEx2`, the default) a weight blends evenly, as a tint. Which tilesets and textures do it, a proposed list still awaiting the author's confirmation, is in sc2-adjutant's `docs/reference/height-blending.md`: check the map's tileset there before saying how a weight will look.

After a compile, `texture_usage` lists each region's textures as painted beside what its mix asked: a weight or a share as the mean layer weight past the falloff, and the cells each texture is dominant in. These are the weights in the masks, before height blending, so on a height-blended texture less can show in game than it reports. Judge the look in game with a Still Review (the `still-review` skill), which also turns a review note into a region.
