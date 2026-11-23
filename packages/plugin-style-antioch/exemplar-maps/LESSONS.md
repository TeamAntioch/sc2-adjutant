# Design Lessons

Ratified visual Design Lessons from the Exemplar Maps. Each lesson is a rule to follow during Mission Blueprint co-design, with the evidence behind it. Drafts live in `candidate-lessons.md` and `data-analysis.md`; only lessons the user has ratified appear here.

Each lesson gives:
- **Rule:** the instruction.
- **Evidence:** numbers from the Map Studies, and what the in-game frames show, each named by its map, the lighting it was captured under and its stop in that tour, or, for a place-tour frame, the place's centre in cells. The frames themselves aren't part of the pack (the Exemplar Maps README says how to capture them); each citation stands without its picture.
- **Weight:** how much to trust it. Evidence from Blizzard's campaign maps counts at least as much as 3-11, which the user made (the author, 2026-11-08: "they're pros"); agreement between the two, and across independent maps, counts most. Blizzard evidence is measured from the game's own map files; it has no frames yet. 3-1 reuses about two-thirds of 3-0, and 3-8 contains 3-7, so those pairs count once.
- **Blueprint hook:** the part of the Mission Blueprint it shapes.

"Ground for play" means terrain units walk on. "Main level" is the cliff level with the most playable cells.

## DL-01. Backdrop levels get one texture and no floor clutter, but are never left empty; natural ground is never one texture

**Rule.** Give every level that isn't ground for play (pits, abyss floors, unreachable heights) one signature texture, and keep ground clutter (rubble, small rocks, plants, decals) off its floor; the fine dressing goes on ground for play and on the cliff lips that frame it. A small pit, a few cells across, can stay bare: its dark walls and shaded foot read as depth (DL-10). A larger backdrop is never left as a bare, visible floor:
- **Cover it** with lava or water (DL-13), open sky through a hidden lowest level (DL-14), or fog thick enough to drown it. Choose the cover from the mood: lava reads hot, fog and water read cold.
- **Dress it vertically:** rock or structure hung down the walls under the rims, a few large silhouettes standing up out of the cover (boulders, ruins, fallen towers), and some motion (falls, rising heat or wind, drifting rock).

On natural ground, no area is ever a single texture: add at least slight touches of other textures everywhere. Built or tiled interior floors (labs, ships, temple halls) can be a single texture. Outdoor built areas such as cities still mix floors inside every view: paving, plaza tile, courtyard grass, road.

**Evidence.**
- Backdrop levels are near-monochrome: the top texture covers 49-96% of L0 and 48-100% of the highest level, against 25-52% of L1 on 11 of 13 maps. 3-11 L3 is 99.5% `Slayn8`. Part of the gap is area: smaller levels collect fewer textures. (study.json `texturing.dominantByLevel`; `data-analysis.md`)
- Backdrop levels are bare: visible-doodad density on the lowest level is 0.02-0.37 times its share of the map on 10 of 12 maps with an L0 (3-11: 0.23x); unused heights likewise (3-4 L3 0.04x, 3-5 L3 0.10x). Exceptions: 3-4's and 3-5's small L0s (1.30x and 0.77x). On 3-11 the L3 arena holds 42% of trigger points but only 0.5% of doodads, so some play floors are kept bare too (`data-analysis.md` N2).
- Areas the size of one capture frame (18x12 cells) on the main level that contain only one texture, counting any touch of 0.5% or more: 0% on 3-0, 3-1, 3-7 and 3-8 (natural ground); 2-10% on 3-5, 3-6, 3-9 and 3-10; 16% on 3-4 and 25% on 3-2 (ship interiors); 43% on 3-11; 66% on 3-3 and 76% on 3-12 (built and tiled floors). Measured 2026-10-26.
- Single-texture areas are not made up for with decals: on every map they hold fewer doodads and decals than mixed areas (3-11: 5.5 doodads and 1.0 decals per area, against 10.0 and 3.7). Some may be backdrop that units cannot walk on; the measure can't tell.
- 3-11 under `Temple`, stop 19: a single bare lava pit beside a dressed plateau with two stone textures.
- 3-0 under `Shakuras`, stop 71: a bare pit of one dark stone, with varied sand and cracks and a few rocks around it.
- 3-7 under `InsideTemple`, stop 92: bricks, ice and blend mixed on the main level, beside a plain canyon floor.
- 3-11 under `Temple`, stop 118: the main level and the top level share one hex tile (a built floor with a single texture).
- Cities mix floors: on 2-2, a built city, only 1.2% of frame-sized areas on the main level are one texture. 2-2 under `BoraDalis`, stop 16: diamond paving, a square-tile walkway, a grass bed and a grass courtyard in one view. Added 2026-10-27 (`episode-2-analysis.md`).
- Every exemplar whose backdrop takes more than a fifth of the playable area covers it: 3-11 with lava over a hidden level (22%), 1-9, 2-0 and 3-2 with open sky (62-82%), 3-3 with water, 3-10 with fog at 0.70. Small pits stay bare (3-0, 2-1, 2-7, 2-8). Added 2026-10-31, from a study of every exemplar's backdrop.
- What backdrop dressing there is stands above the floor: on 11 maps most backdrop doodads are on the walls or are silhouettes (3-11: 36 of 46, its `Slayn_RockCliffTall` topped at the rim). Blizzard's platform maps add motion: Sky Shield's 168 `Reentry_Heat` and 13 re-entry clouds 18 below the platform; Phantoms of the Void's 66 rock spires and 21 `WindVertical`.
- Covered backdrops in frames: 3-11 under `Temple`, stop 42, the lava pit below the grey plateau (below); 2-0 under `Avernus`, the industrial place at (80.3, 138.4), a gantry deck over open space and a planet; 3-10, the built edge at (173.4, 84.4), a temple platform over pale fog with spires standing out of it; 3-3 under `ProtossTemple12`, the battlefield at (194.7, 103.6), a hex-paved causeway across dark water with lily pads and statues standing in it.

**Weight.** Strong for backdrop levels and natural ground (every independent map agrees), and for covering a large backdrop (every exemplar with one). Ratified by the author 2026-10-31, who chose fog over lava for a cold setting. The built-floor allowance rests mainly on 3-3, 3-12 and 3-11, and 2-2 limits it to interiors.

**Blueprint hook.** Mark each level band as play space or backdrop. Zone texturing: give backdrop one texture and no floor clutter, and cover a large backdrop (`water`, `sky.hideLowestLevel`, `sky` fog) with a few silhouettes and wall pieces (set pieces in the backdrop Zone); give natural Zones a base texture plus touches; let built interior Zones use single-texture floors; give outdoor built Zones (cities) mixed floors.

## DL-02. Elevation reads from the cliff, and best with a texture change too

**Rule.** Make every change of level readable from its cliff set and trim: the cliff is what tells the player the ground is higher or lower. Pair the change of level with a change of texture as well; that is the best version, even though the exemplars don't always do it. A pit's texture may run up over its edge where the story wants it.

**Evidence.**
- How often the main texture differs on the two sides of a cliff, sampled 2 cells back from the edge (measured 2026-10-26). Going down into pits: 97-100% on 3-0, 3-1 and 3-10; 66-82% on 3-4, 3-6, 3-7 and 3-8; 30-47% on 3-5, 3-9, 3-11 (36%) and 3-12. Going up onto heights: 40-88% on every map, 63% on 3-11.
- On 3-11 the pit texture `Slayn7` continues up onto the main level at 416 of 734 pit crossings; the pit still reads in play, which points to the cliff, glow and lighting rather than texture (inferred from frames).
- 3-11 under `Temple`, stop 42: the lava pit against the grey plateau, with cliff walls marking the drop.
- 3-11 under `Temple`, stop 118: L1 and L3 share one hex tile; only the cliff wall and its shadow mark the height.
- 3-4 under `Spaceship`, stop 81: L0, L1 and L3 all `SpearOfAdun1`; gold-trimmed cliff edges mark each level.
- 3-7 under `InsideTemple`, stop 82: the cliff and a texture change together, teal canyon floor below violet ice, with an ice-crystal cliff between.
- The user, 2026-10-26: "elevation change is _best_ when it has texture change, even if we didn't always do that."

**Weight.** Strong for the cliff: no map relies on texture alone, and 3-11 depends on the cliff most. The texture change is the user's stated preference, ahead of what the maps measure.

**Blueprint hook.** Cliff set and trim choice per Zone boundary; a different texture on each side of a cliff by default (the palette's `low` and `high`), the same only where the story wants it.

## DL-03. Blend at borders; choose the blend width per area

**Rule.** Put blending where two textures meet, never scattered evenly across a field. Choose the style per area:
- Built or tiled floors: broad fields meeting at thin, hard seams.
- Natural ground: a patchwork of small interlocking patches.
- One material that should look weathered: near-identical textures blended wide and soft.

Blend wide only between textures of the same tone; contrasting textures meet at seams or patches.

**Evidence.**
- 81-100% of blended cells (two or more textures each giving at least 10%) sit within 2 cells of a border between dominant textures, on every map (study.json `texturing.blendPlacement`).
- Maps sit on a continuum from large fields (3-2, 3-3, 3-4, 3-10, 3-12) to patchwork (3-0, 3-1, 3-7, 3-8), and the style changes by area within a map. The single-texture shares behind this depend on the 10% threshold (`data-analysis.md`).
- 3-4 under `Spaceship`, stop 69: a gold `SpearOfAdun` field and a grey woven-tile field meet along one straight, hard seam.
- 3-0 under `Shakuras`, stop 5: sand, cracked rock, dirt and rough rock interlocking in soft-edged patches.
- 3-11 under `Temple`, stop 52: the walkable courtyard on the north island; cracked stone and hex paving fade into each other over wide, soft zones (most island stops are 17-47% single-texture). That the textures are chosen for matching tone is inferred from the frame.

**Weight.** Strong for "blend at borders" (every map). The three styles rest on a few frames each; patchwork has one clear frame.

**Blueprint hook.** Zone texturing: record each Zone's blend style (seams, patchwork or weathered) alongside its textures.

## DL-04. Choose each area's cliff set together with the ground it borders

**Rule.** Pick the cliff set and the texture of the ground it borders as a pair, per area: a natural cliff with natural ground, a built cliff with paving. On a map with pits and high ground, use one variant for the pit rims and the other for the high walls. Keep one main cliff family and bring in others only as accents for specific areas.

**Evidence.**
- Counting only real cliff cells (`f = 1`): 5 of 13 maps (4 independent) use two or more cliff families, with one family carrying 54-94% of the cliffs; 5 maps, 3-11 among them, use both variants of one family (`Cliff0` and `Cliff1`, or Manmade and Organic); 3 use a single set (`data-analysis.md` §4).
- Each set has its own ground texture on 9 of the 10 maps that use more than one set (3-9 is the exception). On 3-11 `SlaynCliff1` has `Slayn8` paving on top 94.5% of the time and climbs L1 to L3 on 88.8% of its cells; `SlaynCliff0` rims the L0 pits (`data-analysis.md` N1). That `SlaynCliff0` is natural and `SlaynCliff1` built is confirmed by their gallery pictures (the cliff catalog's descriptions).
- 3-11 under `Temple`, stop 76: a jagged rock cliff (`SlaynCliff0`) drops into the lava; a straight trench wall (`SlaynCliff1`) edges the hex-paved corridor.
- 3-5 under `DesertWorld`, stop 31: a natural desert cliff in sand runs into the lab's metal walls.
- 3-5 under `BrokersOffice`, stop 128: office, jungle and desert each with their own cliff set in one view.
- 3-10, in its one lighting, stop 162: counterexample; one set throughout, beside clean plaza and creep alike.

**Weight.** Strong; 3-11 follows it exactly.

**Blueprint hook.** Per map: the `cliffPalette` (a `natural` set, a `built` set for cliffs under built zones, a `pit` set for cliffs dropping below the main level), from one main family; per group of Zones: `cliffSets` entries (`{ cliffSet, zones }`, `*` patterns allowed) where an area's ground calls for another family; per Zone: an accent `cliff` where the story wants one. Blizzard names `…Cliff0` sets Organic and `…Cliff1` Manmade, but the pictures (the cliff catalog's descriptions, 2026-10-26) show 10 lab, platform and city `Cliff0` sets are built and 4 `Cliff1` sets natural: judge by the picture.

## DL-05. On ground with cliffs, dress the cliffs first

**Rule.** Where the terrain has cliffs, line cliff lips and feet with models made for cliffs (rock towers, gap fillers, cliff rocks), place props against cliff feet, and keep open ground sparse. On flat or built ground, anchor dressing to set pieces instead (see DL-06). Along cliff feet, use small rock piles and rubble in the cliff's own colour, sitting upright, not large standalone cliff pieces. Never one doodad alone: a pile is a few rock variations at varying sizes, mixed types, heaped together, tinted to match each other. A natural pile sits right against the rock, its large pieces pushed into the cliff's slope (the Editor's "ignore placement"). A built cliff gets technical or organic clutter piled the same way: a wreck, debris, a shrunken building piece, smoke to take up space, a debris splat underneath.

**Evidence.**
- Visible doodads sit within one cell of a cliff 1.3-2.1 times as often as chance on 9 of 13 maps (7 independent); strongest on 3-11 at 2.05. 3-6 is marginal (1.16); 3-5, 3-9 and 3-10 show none (`data-analysis.md` §5).
- Models made for cliffs (names with `Cliff`, `GapFiller`, `RockTower`, `Glacier`) sit within a cell of a cliff 55-100% of the time on 10 maps and are 21-29% of visible doodads on 3-7, 3-8, 3-11 and 3-12. Without them the effect remains on 3-11 (1.61), 3-0 (1.71) and 3-7 (1.43).
- 3-11 under `Temple`, stop 25: a continuous band of tall rocks (`Slayn_RockCliffTall`, the map's most-used type) along the cliff lip above the lava; the open floor carries only pebble decals.
- 3-11 under `Temple`, stop 102: corpses and tar packed against both walls of a channel, its middle left clear.

- The user, 2026-10-26, on single rocks at cliff feet: "When you place doodads against cliffs, just one seems weird. If it's rocks, usually there should be at least a few variations of the rocks at varying sizes, often mixing rocks, and they should look piled." Their fix added smaller `AgriaDebris` with a custom tint to match the other rocks. On a manmade cliff: "a siege tank, a couple bits of debris, a shrunken bit of korhal buildings, and a bit of smoke to take up space, plus some shakuras debris splat."
- The user, 2026-10-26, reviewing generated cliff dressing (large `XelNaga_Cavern_Rock_Cliffs` on Mar Sara cliffs): "it's too large and often at weird angles. The color also doesn't go well with the cliffs themselves. Rather than these big cliff pieces, we should be going with smaller rockpiles and similar."
- The user, 2026-10-26, on generated natural piles standing off the wall: "They need to be closer to the walls--you probably noticed that I had ignore placement on some of them to get them really up in there." With the piles snug against the cliff: "those are a lot better."

**Weight.** Strong on cliffed maps, strongest on 3-11. Does not apply to flat or built maps (3-5, 3-9, 3-10, 3-12). The small-rock-pile refinement is the user's direction.

**Blueprint hook.** Zone dressing order: cliff lips and feet first, then set pieces, then sparse accents on open ground.

## DL-06. Concentrate dressing into set pieces; leave empty ground between them

**Rule.** On open terrain, put most props into a few dense set pieces and leave bare ground between them. Built rooms are the exception, and are dressed denser still: put the dressing on the walls and in the 2 cells beside them, and keep the floor between clear for play. Most of what dresses a wall stands at its foot, at floor height, against the cliff or pushed into it; only signs, screens, rails and some cables hang on its face (DL-19). A hero-mission interior carries about 18 doodads per 100 floor cells, most of them on its walls, with 60-90% of its floor clear of solid props; under 12 is sparse. Targets per room type, and the order to dress a room in, are in the pack's `knowledge/INTERIORS.md`. Dress denser and more complex than feels necessary: more members per set piece and pile, more kinds of doodad, mixed sizes.

**Evidence.**
- Every map leaves more 8x8 blocks empty than random placement at the same density would (3-11: 54% empty against 15% expected), and the densest tenth of blocks holds a third to all of the dressing (3-11: 57%). On 3-11, 47% of doodads sit in clusters of 10 or more and 23% stand alone (`data-analysis.md` §6). Cluster sizes depend on the linking radius and are not used.
- Densely furnished built and base maps (3-1, 3-5, 3-6, 3-9, 3-10) have fewer empty blocks (18-28%).
- 3-11 under `Temple`, stop 102: one dense set piece of corpses, tar and girders beside a bare hex plateau.
- 3-11 under `Temple`, stop 36: a tight heap of corpses against a pillar, open floor around it.
- 3-5 under `HybridLabInner`, stop 48: counterexample; planters, benches, holo-columns and lamps spread evenly on a grid across an interior plaza. A plaza is a hub; Blizzard's working rooms put their furniture on the walls (below).
- Blizzard's interiors (measured 2026-11-08): 146 rooms in seven hero missions (The Escape, Conviction, Back in the Saddle, In the Enemy's Shadow, Enemy Within, Ghost of a Chance, Breakout) carry 18.2 doodads per 100 floor cells, middle half 12-23. Of those, 7.8 stand on the walls round the floor, 6.4 within 2 cells of them and 3.9 out on the floor, over half of which are decals. Of the pieces on the walls, 71% stand at the wall's foot at floor height, 14% hang on its face and 15% stand on the higher ground beyond it. 71-98% of every prop family stands on the walls or within 2 cells of them, and the median room leaves 73% of its floor 2 or more cells from any solid prop. Army missions' interiors carry about half as much (9.7). The densest rooms are The Escape's research wing (28 per 100 across the map, up to 43 in a room).
- Some of 3-11's bare stretches may be high ground units can't reach rather than chosen breathing room (checker's note on the frames).

- The user, 2026-10-26, reviewing generated dressing: "I think what I'm realizing is that often your doodad density is lower than I'd like, and less complex."

**Weight.** Strong for open terrain, including 3-11. Strong for built interiors: 21 Blizzard maps agree. The density note is the user's direction.

**Blueprint hook.** Zone dressing: name the Zone's set pieces and where they sit. A built room is dressed wall first and measured against `knowledge/INTERIORS.md`'s targets for its function (the wall line, lanes and density check the compiler still needs are TeamAntioch/sc2-adjutant#530).

## DL-07. Build missing shapes as Doodad Composites, and keep them as recipes

**Rule.** When the asset list lacks a shape, build it from ordinary models: stack, roll, stretch, sink or tint them into a Doodad Composite. Save each composite as a named recipe (members with relative offsets, yaw, pitch, roll, scale, tint and height) and reuse it across maps. Exact recipes are for shapes only (a tower, a crowned column, a sunk stain, a console with its screens hung above it, crates packed into a stack), where being a few units off breaks the shape; places are generated from mood mixtures, never copied (DL-08, DL-15). A working place's kit (a machine with its supply line, stock, light and floor marks) is a place: generate it from the kit's roles in `knowledge/INTERIORS.md`, not from offsets. This is a tool, not a default style: the user's own map uses it least.

**Evidence.**
- Recipes confirmed against the raw `Objects` files (`data-analysis.md` §7 and N4):
  - Missile tower (3-4): `AntimatterMissileDoodad` at scale 2, 16 copies at heights 0.43, 1.13, 2.03 and 3.03, yaw 225 degrees.
  - Rolled crates (3-4): 117 `ProtossCratesDoodad` rolled 268 degrees onto their sides in rows, with `StarShipAdun_StasisPods` pitched 91 degrees and scaled 0.65 x 0.5 x 0.85.
  - Crowned column (3-7): `TempleColumn` at scale 0.4 raised 3.31-3.35 and turned 90 degrees apart, on a full-size `TempleColumn`, used in pairs either side of the shrine. `XelNagaColumn` laid flat (pitch 90 degrees, 0.5 x 0.6 x 2) is a separate ground beam.
  - Trim line (3-3): `StarshipHallTrim` stretched to 1 x 1.7 x 1 with `NoDoodadFootprint`. No frame yet.
  - Sunk tar (3-11, and identically on 3-3): `TarSludge` exactly 0.27 below ground, tinted 47,187,255.
- Blizzard shapes (2026-11-08), cut whole from the game's maps and kept in the pack's `blizzard-composites.json`:
  - Console bank (The Escape): a console on its base at +0.85, three monitors at scale 0.5 hung 2.6-3.0 above it on the wall, two floor monitors, two hoses into the room, a yellow light.
  - Supply stack (Conviction): about 40 `ColonistSupplyCrate` packed 0.65 apart on the diagonal in two layers 0.8 high, with supplies at its foot, a camera on top and two white lights.
  - Pipe manifold (Engine of Destruction): long, short and corner pipes on a one-cell grid, all at scale 1.
  - Steam hatch (Dark Whispers): a `SpaceSteamJet` sunk 1.6 under a `Korhal_Platform_Hatches`, with alarm and landing lights on its rim.
  Eleven more groups cut with them are working places (a refuelling bay, an assembly bay, a robot-arm bay and others) and became kits instead. None has been looked at in the Editor yet.
- Reuse across maps: 3-12 contains a 135-doodad set piece from 3-11, shifted with yaw and scale unchanged; the tar recipe repeats on 3-3.
- 3-11 lays 0.5% of visible doodads on their side, tilts 2.6% and stretches 0.8%; its manipulation is mostly `NoDoodadFootprint` (22%) and raising (17%). Heavy manipulation is on 3-4, 3-5 and 3-7/3-8.
- 3-4 under `Spaceship`, stop 42: the missile stack reads as one tall tower with a long shadow.
- 3-4 under `Spaceship`, stop 148: rolled crates form a closed ring machine (35 `ProtossCratesDoodad` rolled 268° round a 2.8-cell radius at 94.7, 97.2), crossed by `GenericSpacePipes`, with pods and `Aiur_CityBuilding_Floating_Temple` pieces at its quarters. An arc cut from it, stamped alone on open ground, read as loose worms (the author, 2026-10-27: "not sure about this dock thing"): capture a composite whole.
- Checked in the Editor, 2026-10-27 (a demo map built by a throwaway script): the missile tower, built from 3-4's Scout-missile doodad ("silo is good"); the whole conduit ring ("way better"); the crowned columns ("looks great"); the sunk tar ("A+"). Stretched trim strips scattered by a set piece "just looks random": trim lines an edge, so it needs a placement along one, not a recipe.
- 3-7 under `InsideTemple`, stop 41: the paired crowned columns flanking the shrine.
- 3-11 under `Temple`, stop 102: sunk tar reads as a stain, not a prop.

**Weight.** Medium: a technique of the edited maps and Blizzard's interiors, used sparingly on 3-11.

- Repetition within a map (2026-10-27): the missile tower stands once on 3-4; the crowned column three times on 3-7, all framing one shrine, identical but for each crown's turn; the tar 49 times on 3-11, sunk and tinted exactly but each copy its own size (0.2-1.13) and turn. Landmark shapes are rare and grouped on purpose; small details repeat with varied size and turn.
- The author, 2026-10-27: "I don't want my maps to just look like we're repeating ourselves." Agreed: each copy varies its turn, size and members' variants; landmarks warn past 3 copies or two in one screen across set pieces. "I'll be surprised if we reuse things particularly often", so recipes start in the mission and join the shared library only when worth it. Later, the author wants to "assemble novel shapes out of doodads" by description.
- Any model can be a doodad (2026-10-27): 3-4's `AntimatterMissileDoodad` is the map's own `CActorDoodad`, its `Model` the Scout's missile (`ScoutAirWeaponLeft`), scale 3, with the actor's two stock events removed. So a shape can use any unit, weapon or effect model in the game, not just the stock doodad list. The author: "any model in the game can be made into a doodad if we need it."

**Blueprint hook.** `composites` recipes (kind `landmark` or `detail`, `style`, `scale` range, members with offsets, height, yaw, pitch, roll, scale, tint, variation or `"any"`, `noFootprint`), stamped by a set piece member `{ "composite": id }`; the shared library is the pack's `composites.json` (rebuilt by `build-composites.mjs` from the Exemplar Maps, then Blizzard's recipes from `blizzard-composites.json`); `npm run capture-composite` from an Editor region. Scope agreed with the user 2026-10-27: "we wouldn't want to exactly reproduce a composite" applies to places; shapes keep exact recipes.

## DL-08. Place story props as families

**Rule.** Decide what happened in a spot (a battle, a collapse, an abandonment) and place that event's whole family of props together: corpses with tar stains and torn banners, temples with bricks and fragments, carcasses with blood splats. Never one solid prop alone: give every one company within 2.5 cells. A built place's family is its function's kit: the machine, what feeds it (a hose, cable or pipe), its stock, its light and the marks on the floor where it works, sometimes a fault (smoke, sparks); the kits are in `knowledge/INTERIORS.md`. Generate each family's arrangement from a mood mixture (which types, in what shares, how dense and how far apart), learned from how the exemplar authors dressed that mood; never copy an exemplar's layout.

**Evidence.**
- Pair lift against a permutation baseline (types shuffled among the same positions, 30 runs; `data-analysis.md` §8). On 3-11: `Protoss_Corpse` types with each other 13-21x chance, corpses with `Shakuras_Banner_Torn` 28x, `Slayn_Stone_Bricks` with `_Piece` 12.5x, `Slayn_CliffTemples` with bricks 6-17x, corpses with `TarSludge` 3.5-3.8x.
- Every map has families at 10x chance or more: 3-2 `BloodSplats` with `ZergCarcasses` 22x; 3-3 corpses with `TarSludge` 9x; 3-5 `MarSaraCactus`, `RockSmall` and `TarsonisFoliage` 23-44x; 3-10 `Aiur_City_Archway_Large_Abandoned` with `Aiur_City_Curb_Destroyed` 70x.
- Blizzard's interiors (measured 2026-11-08): in seven hero missions 18% of solid props have nothing within 2.5 cells, the median has 3 neighbours within 3 cells, 46% have a light within 4 and 32% a decal within 2. Pairs: `ColonistSupplyCrate` with `MilitarySupplies` 11.9x chance, `DOM_BaseMonitors` with `DOM_LabConsoles` 9.9x, `FireMedium` with `Korhal_Platform_Debris` 16x, `Korhal_Platform_Hatches` with `SpaceSteamJet` 33x, `CompoundMansion_Light` with `LightOmniYellow` 16x. End Game's refuelling station stands in a ring of ten bay-line, number and stencil decals with its piping and missile store; Engine of Destruction's assembly rig has its lift pad, wall panels, sign towers, floodlight and lane decals.
- Some strong pairs are helpers (placement markers, pathing blockers), not story props; the rule covers story props only. Raw co-occurrence counts in `study.json` favour abundant types; use lift.
- 3-11 under `Temple`, stop 102: the battlefield; corpses line both walls of a trench with tar pooled between them.
- 3-11 under `Temple`, stop 95: the ruin; a collapsed temple with brick slabs on its roof and broken pieces at its foot.
- 3-11 under `Temple`, stop 86: rubble, a crack and brick slabs gathered at a breach in a wall.
- 3-2 under `Starship`, stop 69: Zerg carcasses and blood splats piled in a doorway.

**Weight.** Strong: every map, strongest on 3-11, and Blizzard's interiors.

**Blueprint hook.** Set pieces: give each its story event and prop family; a built place's set piece holds its kit.

## DL-09. One light for the mission's mood; change it at Beats

**Rule.** Give the mission one light, chosen for its mood and retuned in the map-local catalog (a `CLight`); there is no default palette or brightness (the maps range from dark blue to warm to magenta, and 3-11 sits above stock brightness). Change the light by trigger at a Beat, in one of three ways:
- an instant cut when the player moves to a new place, goes through a blackout or enters a cutscene;
- a slow drift over minutes for time passing;
- a 1-3 s pulse for an event.

Change the music and any dressing that belongs with the new lighting in the same trigger step. Light a place differently in data (light regions) only where it is a different space, such as an interior or a lab; most maps don't, and those that do mostly paint small patches.

**Evidence.**
- 12 of 13 maps call `GameSetLighting`, each with 2-5 lights. Instant cuts (0 s) are the majority, on 11 of the 12; slow drifts on 3-6 (`Midday`/`Midnight` over 470 s on a timer) and 3-9 (`AntiochNighttime` over 540 s after objectives); pulses on 3-2 (`StarshipDark` 3 s then `Starship` 1.5 s in `gt_PeriodicBooms_Func`) and 3-4 (0.25 s camera-mode switches). Many calls belong to cutscenes rather than areas (`data-analysis.md` §9).
- 6 of 13 maps paint light regions, but only two widely: 3-5 (77% of the map) and 3-10 (34%, over two regions; the one map without lighting triggers). The rest are small patches (3-2 20%, 3-3 and 3-4 5%) or faint gradients (3-0, 3-1); 3-7, 3-8, 3-9, 3-11 and 3-12 have none, and 3-11 lights its places by trigger (`data-analysis.md` N7).
- Most maps override their stock light with their own version, usually darker and cooler (N9); overrides mostly change 1-3 fields.
- The user, 2026-10-26, on lighting per zone: "I feel like it's not super common, but am I wrong?" The numbers agreed, and the rule moved from a light per Zone to one mission light changed at Beats.
- Of 76 trigger functions that set lighting, 56 also start music and 19 (on 8 maps) also show or hide doodads or change fog, water, tint or terrain.
- 3-11, stop 37 under `Temple` and under `ProtossAbyss`: the same temple stop, warm low-contrast grey against harsh near-monochrome.
- 3-11 under `TheVoid2`, stop 143: the NT base room in cold blue-black (warm brown under `Temple`).
- 3-6, stop 120 under `Midday` and under `Midnight`: the same patch in olive daylight and teal-black night.

- Episode 2 (2026-10-27): every campaign map with lighting triggers sets one light, once, at map start; 2-1 and 2-3 set none. Only 2-4 changes light at a Beat, a 3 s pulse to `PrisonShipEmergency` when the alarm sounds. Across both episodes, 13 of 21 campaign maps change light (`episode-2-analysis.md`).
- The user, 2026-10-27: "It really depends on the story beat." Whether a Beat earns a lighting change is a story call, not a default.

**Weight.** Strong for one mood light retuned in data (both episodes). Medium for changing it at Beats: 12 of 13 Episode 3 maps, 1 of 8 in Episode 2, and it depends on the Beat; ask for each Beat whether its story calls for a change. "In data first" comes from the edited maps and the project rule, not from 3-11.

**Blueprint hook.** A lighting per Zone; for each Beat, its lighting change (cut, drift or pulse) and what changes with it.

## DL-10. Darken cliff feet; run the Editor's shadow bake last

**Rule.** Every cliff foot should read darker than the open ground around it. Prefer the Editor's bake, Data > Generate Static Shadows (Cmd-Shift-L), run as the last step after the final cliff edit, because any cliff edit wipes it. Where the bake isn't available, a dark texture blend at the cliff feet gives nearly the same look. Compiled maps either reproduce the bake in `t3VertCol` (the ground band on the low side of each cliff foot, darkest 1-2 cells out, gone by 5-6 cells, plus per-vertex values on every cliff and ramp model) or tell the user to run the bake.

**Evidence.**
- 8 of 13 maps, 3-11 among them, have cliff edges far darker than open ground in `t3VertCol` (3-0: 44% of edge cells against 5% of open ground at threshold 224); the contrast holds for thresholds 192-240, the percentages do not (`data-analysis.md` §10).
- The shading is a bake: rebuilt across 3-11 in one save with no geometry change (r = 0.986 with the earlier, wiped version); wiped map-wide by 9 of 9 saves that changed cliffs; the same cliff model carries the same per-vertex values across maps (r = 0.96); it follows geometry on the low side of cliffs in every facing; saving alone doesn't produce it (`data-analysis.md` Part 3). 3-1 and 3-9 lost theirs to later cliff edits.
- Bake test (2026-10-26) on a copy of 3-9, whose shading had been wiped: one run of Generate Static Shadows and a save took the ground layer from no shaded vertices to 17,465 of 33,153, falling off with distance from the cliff edge (below 224 on 47% of cells 1 cell out, 35% at 2, 20% at 3, 9% at 5, 6-9% beyond). It also filled every cliff and ramp model's bytes (all 255 before; mean 120 after). The Editor shows the darkening at once, before saving.
- 3-0 under `Shakuras`, stop 68: a soft blue-grey halo along the foot of two platforms and a dark rim round a pit.
- 3-0 under its cave Light, stop 61: a small sunken pit filled nearly black; the clearest case.
- 3-1 under `Shakuras`, stop 96: counterexample; the same layout without the bake reads almost as dark, from a dark texture blend and the cliff's own shadow.

**Weight.** Medium. The data is strong, but in play the effect is subtle and no 3-11 frame shows it clearly under its normal lighting.

**Blueprint hook.** Finishing steps: after the last cliff edit, the author runs the bake in the Editor. The compiler won't reproduce it (the user, 2026-10-26: "I have no interest of reproducing generate static shadows").

## DL-11. Rotate natural props freely; snap built props and decals to 45°

**Rule.** Give every rock, plant and tree its own yaw, with no grid to it. Snap architecture, ruins, built props and decals to a 45° step, so walls, trim and floor marks line up with each other and with the cliffs. Keep built pieces at scale 1: vary scale only on decals, plants, effects and lights, shrink a piece only to hang it (a monitor at 0.5 on a wall) and stretch a decal only into a seam or stain. Scale variation on natural props (about ±15%) is an option per map, off by default: the user's own map keeps natural props at scale 1.

**Evidence.**
- Pooled over all maps, 7.3% of natural props sit on a 45° step, close to the 2.7% random placement gives; built props 46.3%, decals 89.6% (`data-analysis.md` N3).
- Of types placed 5 or more times, 77-100% use 3 or more distinct yaws.
- Scale: the edited maps vary natural props around 1 (median 0.92-1.01, 10th-90th percentile about 0.53-1.20 on 7 of 10 maps). On 3-11, 73% of natural props are at exactly scale 1 (10th-90th percentile 0.98-1.00).
- Blizzard's interiors (measured 2026-11-08): 82-87% of storage, wall and vent pieces at exactly scale 1; scale varies on decals (41%, 10th-90th percentile 0.92-3.0), plants (72%), effects (64%) and lights (48%). On a 45° step: wall pieces 87%, decals 88%, signage 98%, vents and barriers 84%, controls 74%; storage 42%, debris 11%, plants 9%.
- Exceptions: 3-11 snaps 23% of its natural props, mostly `Slayn_RockCliffTall` lined along cliffs; 3-10 snaps 36%. Tall rocks that act as cliff walls can follow the cliff's facing.

**Weight.** Strong for rotation (every Exemplar Map and Blizzard's interiors). Strong for built pieces at scale 1 (Blizzard and the user's own map agree); low for jitter on natural props (an edited-map habit, not the user's).

**Blueprint hook.** Doodad placement: the placer randomises yaw for natural props and snaps built props and decals to 45°. Scale stays 1 for built pieces and lone props (doodad anchors still default to a random 0.85-1.15: set `scale: 1` until TeamAntioch/sc2-adjutant#530 changes it), but piles and clutter vary in size on purpose (the user's piles, 2026-10-26): a member's `scale` range in the blueprint, with pile defaults of 0.8-1.15 for large pieces and 0.45-0.9 for small ones.

## DL-12. Dark places need point lights; give each prop family one colour

**Rule.** Wherever the light is dark (a night map, an interior, a cave, the void), point lights are expected: without them the dark ground has nothing to catch the eye, so lights carry much of the colour and the focal points. Under a daylit sky they stay optional and off by default, because a point light barely shows in sunlight. Wherever an area uses them, pick one colour per prop family and place the lights with that family: for example cyan or green on vegetation, red on temple architecture, white floodlights on Terran bases. Each light stands beside a prop group or a fixture; don't scatter lights on their own or set them in rows. Indoors, aim for about one omni light per 170 floor cells, plus one or two glowing fixtures (floodlights, ground lights, alarm lights) per 100 floor cells.

**Evidence.**
- 11 of 13 maps place `LightOmni*` doodads, 30 or more on 9 (3-6: 617, 18% of its doodads; 3-0: 214; 3-1: 168) (`data-analysis.md` N5).
- Nearest prop within 3 cells, pooled: cyan lights 55% natural, green 56% natural, red 70% ruin or built. Cyan pairs with `Brambles` and `ShakurasFoliage` at 9-13× chance on 3-0, 3-1, 3-7 and 3-8; `LightOmniRedLarge` with `TempleBanner` at 26-40× on 3-0 and 3-1.
- Counterexample: 3-11 and 3-9 have no light doodads; 3-2 and 3-3 have 9 and 3.
- Blizzard's campaign maps (measured 2026-11-08): of the 100 with real dressing, 44 place no omni lights, nearly all daylit outdoor maps (Mar Sara, Char's surface, Zerus, Korhal Outskirts, Agria, Tarsonis, the ice worlds). The 18 that place 30 or more are all dark: interiors (The Escape 147, Piercing the Shroud's Castanar lab 125, Dark Whispers' Moebius lab 66), caves (Belly of the Beast 308), night or gloom (Shakuras City 177, Ulaan 140, Port City 84, Elsecaro 67) and Ulnar and the void (59-73). Brightly lit interiors (Breakout's yard, Sudden Strike) have none.
- In Blizzard's hero-mission interiors: 1.8 lights per 100 floor cells, 0.6 of them omni lights; 46% of solid props have a light within 4 cells; of 1,062 evenly spaced runs only 5 are lights.
- Night maps (added 2026-10-28 from Episode 1, `episode-1-analysis.md` C-3): on 1-8 (`AiurNight`), cyan pylon glows, 21 `Floodlight`s at the Terran bases and warm torch spots (`LightOmniOrange` in underbrush) give most of the colour and focal points (the military post at (71.8, 86.7) and the wild ground at (28.2, 70.3)).

**Weight.** Strong in dark places: Blizzard's maps and the edited maps agree, and 3-11's lack of lights no longer outweighs them. Optional under a daylit sky, where Blizzard rarely uses them.

**Blueprint hook.** Zone dressing: a `pointLights` setting naming one colour per prop family, on by default for a dark Zone (night, interior, cave, void) and off under a daylit sky; until it exists, lights are placed in set pieces and Composites beside their props (`knowledge/LIGHTING.md`).

## DL-13. Water or lava fills a pit, or a pool dug into play ground; raise it at a Beat

**Rule.** A pit or void floor (the backdrop of DL-01) can carry a water or lava surface in the area's palette. Water doesn't need a lower cliff level: a pool can be dug into a play level with the height tool, deep enough to hold the surface, then painted unpathable with the pathing tool so units walk round it. Borrow another planet's water type when it fits the palette better than the tileset's own. Each pool height needs its own `CWater` entry. A waterline is never the zone's exact polygon: the floor rises into banks that wander above and below the surface, dressed densely with rock piles, plants and sunken pieces in colours that sit on the ground around them. For a flood or eruption Beat, raise the surface with a water state change, and change its colour or make it damage in the same step if the story needs it.

**Evidence.**
- 11 of 13 maps have painted water areas, lying on L0 2-5 times more than L0's share of the map (3-11: 53% against 21%; 3-9: 70% against 19%) (`data-analysis.md` N8).
- Water types come from other planets: Avernus water on Shakuras, Xil water on the Umbra ice maps, Char lava on 3-11. 3-1 has five Avernus copies at heights 8.3-12.4.
- Beats: 3-3 `TaintedWater` rises 7.8 → 9.55 and then damages; 3-11 Char lava rises 4.8 → 8.4 and reddens over 15 s.
- 3-11 under `Temple`, stops 19 and 42: the lava pit reads as one glowing surface beside the stone plateau.
- Counterexamples: 3-4 and 3-12 have no water; 3-10 has one small area; on 3-2 and 3-3 the water doesn't favour L0.
- Pools dug into play ground (added 2026-10-28, from the author on 1-8): 1-8's 14 water areas (`Niflheim`, `BelShir`, `Helios`) all lie on its main level, cliff level 1. Every one of the 6,312 vertices below 9.1 (the `Niflheim` surface; the other two types use their stock heights) is on that level, dug down to a median 6.53 (10th-90th percentile 3.55-8.52) against the level's median of 9.95. The author made these pools unpathable with the pathing tool: the paint is `CellAttribute_Pnp` (decoded 2026-10-28 from a pit the author dug, filled and painted in the Editor), and it covers 5,424 of 1-8's 5,509 flooded cells.
- Verified 2026-10-27: an Editor-saved Agria area (`packages/core/tests/fixtures/editor-terrain/water`) is a rectangle in `t3Water` (a 40-byte CWater id, then x0, y0, x1, y1), its height in a map-local CWater state. The author paints it 4 cells wider than the pit so waves hit the cliff. A compiled pool, and a rise and drain by `WaterSetState`, worked in game.
- The author, 2026-10-27, on the first shore dressing: "we should also think about the terrain height. Waterlines are rarely fully static, so a bit of height variation at the edge is important." Then: "There's not enough stuff around the shoreline. Also, realsitically water areas should never be exact polygons. Finally, the choice of rock is the wrong color against the terrain." With banks that wander in height and reach, piles every 2.5 cells of shore, a fringe of plants, and mossy grey-green rocks on Agria ground: "Way better."
- Shore light (a throwaway study script, 2026-10-27): light doodads are no denser within 3 cells of water than elsewhere on 12 of 15 maps that have any. 3-6 strings large cyan omni lights 0.2 above its opaque Bel'Shir water, nearest neighbours a median 2.6 cells apart, on some stretches only (one per 24 shore cells); its frame under `Midnight` (stop 120) shows the bank rocks picked out pale blue. Lit shores sit under dark lightings (in-game frames' mean grey 36-64); frames above 100 have none, and the dark temples (3-7, 3-8) keep their water dark. Shore light colour follows the map's own lights (cyan and red on the Shakuras maps, green and orange on 2-3), not the water. Built shores (2-2's docks, 3-10's waterfront) use streetlights and landing lights. Glow at shores is mostly living: 2-6's pink-tipped Char tendrils, in the shallows too; Shakuras' blue pods. A brightness score from the light data didn't predict the frames (ProtossAbyss and Spaceship score dark but look bright), so whether a mission is dark is the designer's call from its mood.
- The author, 2026-10-27, on glow lights: "Blue isn't always right, and glow isn't always light. We need some heuristics around when to do it and when not to." Agreed: the skill decides from the mood; the nearest of the 8 stock omni colours ("we can always specialize later"); lights only on stretches near the player's routes. On the compiled demo (AgriaNight, large blue lights along the north shore, the hero's route passing it): "that is really subtle but quite nice."
- Exemplar shores carry plants and rocks at the waterline (and cyan lights), and sunken ruins, rocks and water plants under it; a median 40% of shore cells have a doodad within 2 cells (range 14-80%).

**Weight.** Medium.

**Blueprint hook.** `water` pools (zone, stock type, height, colour, `bank`, named states), each compiled to its own CWater; `dressing.shores` (pile, fringe, sunken, lights for a dark mood); a transition's `water` moves a pool to a state over some seconds. Damage in water is out of scope (the author, 2026-10-27: "water damage is rare and I don't think even appears in my campaign"). A pool's `dig` (`{ depth }`) puts it on its zone's own level instead: the compiler sinks the zone into a bowl with a wandering rim and writes `CellAttribute_Pnp` over the flooded cells.

## DL-14. Build a map-local tileset: one main planet plus accents

**Rule.** Pick one main planet for most of the ground, plus 0-3 accent texture families from other planets. Choose one or two cliff families paired with the ground they border (DL-04). Borrow the skybox, fog and water from whichever planet fits the mood. Put the whole set, with its lighting, in a map-local `CTerrain` rather than relying on a stock tileset.

**Evidence.**
- 10 of 13 maps cover at least 5% of their ground with each of 2-4 texture families (median 38% of the area outside the dominant family); 7 use 2-3 texture sets (`data-analysis.md` N10).
- Cliffs mix families on only 5 of 13 maps.
- Skyboxes and water come from other planets too (DL-13).
- 3-11: 83% Slayn with 10% Korhal; two Slayn cliff sets on a Starship tileset whose own cliff is never used (3-11 under `Temple`, stop 76: the rock cliff into the lava and the trench wall of the corridor, DL-04).
- Counterexamples: 3-0 and 3-1 are pure `ShakurasEx1`; 3-12 is 97% Shakuras. A single-planet map is allowed (0 accents).
- 9 of 13 maps set a skybox, mostly another planet's (Shakuras sky on 3-2, 3-3, 3-12; BelShir on 3-7, 3-8, 3-10; Void on 3-11). Fog colours are copied presets (`data-analysis.md`, Fog).
- 5 maps (3-2, 3-4, 3-7, 3-8, 3-11) hide the lowest level, so the sky shows under their platforms; from the gameplay camera that is the only place it shows. Checked in game on 2026-10-27: the Void sky reads black (3-11 and a test map), the Starship sky as an orange nebula with stars.

**Weight.** Medium.

**Blueprint hook.** Map setup, compiled to a map-local `CTerrain` override: `tilesetId`, `texturePalette` (accent families), `cliffPalette` and `cliffSets` (cliff families), `lighting` and `sky` (skybox, parallax layer, fog, hidden lowest level). Water is per pool (DL-13).

## DL-15. A city is many small themed places

**Rule.** Give a city Zone a dozen or more small places, each with its own story and prop family (DL-08): a nightclub, a zoo enclosure, a market, a car lot, an alley. Set them into pockets between buildings and along the streets, and leave the rooftops between them bare. Generate each place from a mood mixture (DL-08), not by copying 2-2's. Ask the user whether the places should be populated; if so, fill them with idle units that fit each place's story (dancing civilians in the club, colonists in the street, parked bikes and cars, off-duty marines).

**Evidence.**
- 2-2: 82 Doodad Composites on a 45° street grid, most of them themed places: fountain plaza, nightclub, zoo, monorail station, storefront row, landing pad, prison cells, stasis lab, car lots, crash site, alleys, a shanty of huts, a crystal grotto (`episode-2-analysis.md`, 2-2 table). Building tops are raised and nearly bare.
- 2-2 under `BoraDalis`, stop 16: a fountain plaza with café tables, topiary and storefronts.
- 2-2 under `BoraDalis`, stop 127: a nightclub; dance floor with dancing civilians, tables and booths.
- Population: 2-2 places 708 units across 11 players (marines, colonists, dancing civilians, civilians, cruiser bikes). 3-11 places none, and the other Episode 2 maps mostly place resources and enemies, so population is a choice to ask about, not a default.
- 2-2 under `BoraDalis`, stop 89: the zoo; an Ursadon in an ice enclosure beside a jungle pen.
- 2-2 under `BoraDalis`, stop 3: a storefront row with neon signs, planters and benches under bare rooftops.

**Weight.** Medium: one map, but the user named it a favourite for exactly this ("so many special little areas to make it feel like a city").

**Blueprint hook.** Zone set pieces: a "district" Zone type that lists its places, each with a story and prop family, and an optional `population` list of unit types and counts.

## DL-16. Forest goes in masses, and frames the map from outside

**Rule.** Plant trees as solid canopy, never scattered. Pack one tree type about 1 to 1.5 cells apart into blocks, with clear ground between the blocks for play. Put most of a forest map's trees outside the playable bounds, so dark forest frames the map on every side. Single scattered trees read as sparse, not as forest.

**Evidence.**
- 1-8: half of its 2,181 doodads are `AiurTree`. 774 of the 1,070 trees stand outside the playable bounds; the 296 inside are a median 1.32 cells apart, 72% of them in clumps (5 or more other trees within 4 cells) (`episode-1-analysis.md` C-4).
- 2-3, also forest: 1,752 trees, 514 outside; inside, 1.10 cells apart and 69% clumped.
- Counterexample: 1-7 scatters its 91 playable trees 4.24 cells apart with no clumps, and reads as sparse (0.8 doodads per 100 cells).
- 1-8 under `AiurNight`, the military post at (71.8, 86.7) and the wild ground at (28.2, 70.3): canopy blocks against open ground.

**Weight.** High: the author calls it important, and 1-8 is one of their Episode 1 favourites.

**Blueprint hook.** Zone dressing: a `forest` area type (polygon, tree type, spacing) for canopy blocks inside a Zone, and a forest frame for the band between the map edge and the playable bounds.

## DL-17. On a night map, tell ground types apart by brightness

**Rule.** Under a night light, colour fades and brightness is what tells areas apart. Check each ground type's brightness under the chosen light (in a test frame, not from the light data) and aim for distinct levels: for example dark canopy, mid-grey paving, and a bright enemy ground. When the light happens to make one ground stand out, keep it if it helps play, such as marking enemy territory.

**Evidence.**
- 1-8 under `AiurNight`: jungle canopy is darkest, `MonlythBricks` temple plazas mid-grey, and creep the brightest thing on the map, pale violet. Enemy ground stands out with no extra marking (1-8's place tour; `episode-1-analysis.md` C-2).
- The bright creep was a side effect of the light; the author kept it because they liked it (2026-10-28).
- A brightness score from the light data doesn't predict frames (DL-13's shore-light note), so the check has to be in game.

**Weight.** Medium: one map, an author favourite, confirmed by the author.

**Blueprint hook.** Lighting review: for a night mood, a test frame per ground type, with the brightness order noted beside the `lighting` choice.

## DL-18. Kerb built edges end to end; let natural lips grow wild

**Rule.** Line a built floor's edge with curbs or trim laid end to end, turned with the edge, on level ground, with the floor's texture reaching right under them. A broken run is wear: cover each cut end with wreckage shrunk until it reads as noise, and strew finer debris in the gap. Grow plants and small rocks along a cliff's lip in dense clumps, right on the crest, the plants leaning over it, with bare stretches between and each clump reaching a different distance in; rocks and other solid pieces stand wholly on the crest, never dangling off the edge unless the story calls for it. Keep even spacing for things that are planted or built, like a colonnade. Indoors, mark routes on the floor rather than with fences: lane decals laid end to end 1.2-1.8 cells apart from door to door, bay lines and numbers where work happens, cables across the floor in runs about 1.5 apart, pipes along the wall foot about 2 apart. Guardrails and barriers go only on lips and catwalk edges.

**Evidence.**
- Lines in the exemplars (a throwaway study script; same type and facing, linked within 3 cells, 4 or more long): 3-10's `XelNaga_Curb` runs 1.66 cells apart, turned about 90° to the run, variants 0-7 only; 3-3's `StarshipHallTrim` 1.5 apart, turned 90°; 3-9's `Aiur_City_Curb` lies on a texture seam 85% of the time. Lip lines: `TempleColumn` 79% on a lip, `AiurFoliage_Ex2` 90%, `CharTendrils` 92%, `DecalProtoss` 72%.
- Blizzard's interiors (measured 2026-11-08): of 1,062 runs of 4 or more on 21 maps, 658 are floor decals; `Decal` runs step 1.19 cells, 37% of them out in the room, `DecalSpace_Baked` 1.82, `BattleStation_Line_Decals` 2.41. `ElectricConduitPathMedium` cable runs step 1.46, a third out in the room; `GenericSpacePipes` step 1.99, all on the walls; `Korhal_Curbs` 2.4 along walkways. Engine of Destruction's assembly bay and Back in the Saddle's crate bay each lead out along a row of three lane decals.
- 3-10 pairs `Aiur_City_Curb_Destroyed` with its ruined arches (70x chance); 3-9 lays `Protoss_Base_GroundTrim_Destroyed` 140 times beside 49 intact pieces.
- The author's Editor reviews of the edge demo, 2026-10-28 (a demo map built by a throwaway script): evenly spaced lip plants "unless these were planted, they shouldn't be so uniform... cluster them up", at "at least 3x" the density and "closer to the lip"; "I often use ignore placement rules to get the look I want. Same guidance applies to all of the other natural edges"; "this is wild growth not a garden"; then "that nails it". Curbs "are better when the terrain under them is flat", and the built texture should be visible "all the way to the edge". Wreckage over a cut end at 0.25-0.45 looked like a crash: "shrunken way down... basically just to read as noise". The temple colonnade, evenly spaced, "looks nice" because it is built. Later, 2026-10-31: ignoring placement is fine, but no doodad should dangle off the edge of a cliff unless it's for a narrative reason; then, 2026-11-01, after rocks on a chasm's lips hung out over it: plants are OK to hang over, rocks are not.

**Weight.** High for the natural lips and the wear: the author's own rules, checked in the Editor. Medium for kerb spacing: two maps. Strong for painted routes indoors: 21 Blizzard maps.

**Blueprint hook.** `dressing.edges` (`built`, `lip`) and a zone's `edges`; see the pack's `knowledge/DRESSING.md`. Lanes and a wall line round built rooms are TeamAntioch/sc2-adjutant#530; until then, lay lane decals as a set piece's members or doodad anchors.

## DL-19. Use the vertical: hang, stack, sink and push together

**Rule.** Dress the walls from their foot: stand stock, debris, lab tanks, pipes and lights at floor height against the cliff or pushed into it, and hang only what belongs on a wall face (signs, screens over a console, rails along a ledge, some cables and lights), 1.5-3 above the floor. Stack crates in layers; sink what should only show its top (a steam jet under a hatch, a stain). Push solid pieces into each other with ignore placement so a group reads as one mass, but nothing solid dangles over a drop (DL-18). Every effect sits on its cause: steam at a hatch or vent, sparks on broken panels or debris, fire on a breach or wreck, smoke at a fault; about one effect per room, more only in a wreck.

**Evidence.**
- Blizzard's interiors (measured 2026-11-08):
  - A hand-set height (`HeightOffset`) on 58% of doodads in hero missions and 43% in army missions; ignore placement on 71% and 62%; `NoDoodadFootprint` on 15%. Tilting is rare (0-1%).
  - Heights read against the room's floor (the ground under a piece is mid-slope over a cliff face and far below beside a drop). Of 2,826 pieces on the walls round hero-mission rooms, 71% stand at the wall's foot at floor height (debris 98%, storage 92%, lab tanks 93%, lights 74%, consoles 71%, pipes 70%), 14% hang on its face (signs 84%, barriers 44%, effects 21%, pipes 17%, consoles 16%) and 15% stand on the higher ground beyond it. Debris and storage almost never hang (0-1%).
  - Storage overlaps a neighbour 24% of the time and stands on one 10%; plants 36% and 16%; controls 18% and 8%.
  - The Escape's monitors hang at 2.6-3.0 over their console; Dark Whispers' steam jet is sunk 1.6 under its hatch; Conviction's breach spills plating and wall debris over the edge of the drop behind it, at floor height.
- The author's look at a sample map of the Blizzard groups (2026-11-08): pieces rebuilt at the wrong heights hung over the walls' edges, which is how the first reading of "hung" (against the ground under a piece) was found to be wrong.
  - Effects: 0.3 per 100 floor cells in hero-mission rooms (under one per room), 1.3 in wrecked rooms. Steam is rare: `SpaceSteamJet` 7 times, all on one map, `SpacePlatformSteamVent` 10 times on two. Atmosphere comes from exhaust props, fire, smoke and sparks, each beside its cause.
- The Exemplar Maps: 3-11 raises 17% of its visible doodads and sinks its tar (DL-07); 3-4 stacks its missiles four high.

**Weight.** Strong for interiors (21 Blizzard maps), consistent with 3-11's raising and sinking.

**Blueprint hook.** Composite members, set-piece `added` doodads and `edits` take a `height` or `heightOffset`, and doodad anchors the `HeightOffset` flag; the Style Pack's Blizzard recipes hang and sink their members (`blizzard-composites.json`). Raised members on a wall line are TeamAntioch/sc2-adjutant#530.
