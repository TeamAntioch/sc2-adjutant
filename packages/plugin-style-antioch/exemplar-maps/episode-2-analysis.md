# Episode 2 against the Design Lessons (2026-10-27)

A pass over Episode 2's 11 Map Studies and 1,766 capture frames, checking each ratified lesson in `LESSONS.md` and drafting new candidates. Nothing here changes a lesson until the user ratifies it.

**Method.** `packages/core/scripts/exemplar-analysis/lessons.mjs` measures every exemplar (both episodes) against each lesson; `overlap.mjs` finds maps that share content. Episode 3 was re-measured with the same script, so the two episodes compare like for like. Most re-measured Episode 3 values match `LESSONS.md` (3-11: cliff lift 2.04 against 2.05, empty blocks 55% against 54%, corpse + banner lift 28x, natural props snapped 23.5% against 23%); DL-02's texture-change shares do not (3-0 pits 78% against 97-100%, 3-11 31% against 36%), because the original sampling is lost with its scripts. DL-02 comparisons below use the new numbers for both episodes. Water (DL-13) is not measured: the study's water count reads 0 on every map, including 3-11, which has lava, so the reader is wrong.

## Read this first: Episode 2 is mostly independent, except one Shakuras family

| Pair | Offset (cells) | Shared doodads | Terrain under the offset |
|---|---|---|---|
| 2-7 = 2-9 | (0, 0) | 1,508 = 79% of each | 100% same level, 99.9% same texture |
| 2-7/2-9 inside 3-0 | (+24, 0) | 1,168 = 61% | 88% same level, 86% same texture |
| 2-7/2-9 inside 3-1 | (+80, 0) | 978 = 51% of 2-7 | 88%, 86% |

**[inferred]** 2-7, 2-9, 3-0 and 3-1 are one Shakuras map reworked across two episodes; together they count once. No other Episode 2 pair shares content. 2-9.5 is not a campaign map (the user, 2026-10-27) and is reported but left out of tallies. That leaves **8 new independent campaign maps**: 2-0, 2-1, 2-2, 2-3, 2-4, 2-5, 2-6, 2-8. All are `edited`.

## Part 1: The ratified lessons

### DL-01. Backdrop levels one texture and bare; natural ground never one texture — holds

- **Bare backdrop [measured].** Visible-doodad density on the lowest level against its share of the map: 0.11-0.38x on 2-2 (0.17), 2-6, 2-7 and 2-8; 0.70x on 2-1. Exceptions where the lowest level is ground for play: 2-4 (2.27x; its main level is L3, the lowest is a lab floor) and 2-5 (1.68x).
- **One texture on backdrop [measured].** Top texture on the lowest level: 80-84% on 2-1, 2-7, 2-8; 47-53% on 2-5 and 2-6; 40% on 2-2.
- **Natural ground never one texture [measured].** Frame-sized areas (18x12) on the main level with a single texture: 0% on 2-1, 2-3, 2-5 and 2-7; 7-8% on 2-6 and 2-8; 70% on 2-4 and 83% on 2-0 (lab and prison-ship floors, the built allowance).
- **New: a built city is not single-texture [measured].** 2-2 is almost all built, yet only 1.2% of its areas are a single texture: paving, plaza tiles, grass courtyards and road meet inside nearly every frame (frames 016, 076). The built-floor allowance is permission, not a default.

### DL-02. Elevation reads from the cliff, best with a texture change — holds

- **[measured]** Main texture differs across a cliff (2 cells back): down into pits 29-85% (2-8 29%, 2-2 43%, 2-5 59%, 2-1 66%, 2-6 67%, 2-7 76%, 2-4 85%); up onto heights 23-78% (2-5 23%, 2-7 51%, 2-3 60%, 2-6 61%, 2-0 70%, 2-2 78%, 2-8 78%). Episode 3 on the same measure: pits 31-96%, heights 35-80%. Same spread; no map relies on texture alone.
- **[inferred, frames]** In 2-2, building tops are raised levels with dark rooftop texture, walled by city cliffs (`KorhalCityCliff0`); the wall, not the texture, reads as "building" (frames 076, 089, 162).

### DL-03. Blend at borders — holds, a little weaker

- **[measured]** Blended cells within 2 cells of a dominant-texture border: 84-100% on 7 of 8 campaign maps; 78% on 2-5. Episode 3: 81-100%. (2-9.5: 73%.)
- 2-5 (ice world) is the one map with noticeable scattered blending; its natural ground uses blend as texture.

### DL-04. Cliff set paired with its ground; one main family plus accents — holds, accents more common

- **[measured]** Real cliff cells (`f = 1`) by family: 2-4 and 2-6 use one family; 2-0 one at 99%; 2-1, 2-2, 2-3, 2-5 and 2-8 use 2-4 families, with the main family carrying 65-85%. Episode 2 mixes families on 5 of 8 maps, against 5 of 13 in Episode 3.
- **[measured]** 2-2: `KorhalCityCliff0` 85% for building walls, `TarsonisEx1Cliff0` 14%, `CompoundFacility` 1%. Where the Tarsonis cliffs sit, and whether they pair with natural ground, is not yet checked.
- 2-8 is the widest mix (`TyphonEx1Cliff0` 65%, `MeinhoffEx1Cliff1` 25%, `IceWorldCliff1` 10%).

### DL-05. Dress the cliffs first — holds on natural maps; not on cities

- **[measured]** Visible doodads within one cell of a cliff, against chance: 2-4 3.87, 2-0 2.62, 2-5 1.87, 2-7 1.83, 2-3 1.43, 2-6 1.29; none on 2-1 (1.00), 2-8 (1.00) and 2-2 (1.12).
- **[measured]** Models made for cliffs are rare in Episode 2: 0.4-5% of visible doodads on every map except 2-0 (17%), against 21-29% on 3-7, 3-8, 3-11 and 3-12. Episode 2 hugs cliffs with ordinary props.
- **[inferred]** 2-2 dresses its plazas and courtyards, not the building walls: on a city map the walls are the buildings, and dressing goes in the open spaces between them. This matches the lesson's existing carve-out for built ground.

### DL-06. Concentrate dressing into set pieces — holds strongly

- **[measured]** Empty 8x8 blocks against random expectation at the same density: every map leaves far more empty (2-2: 47% against 4.5%; 2-3: 25% against 0.8%; 2-5: 29% against 0.3%). The densest tenth of blocks holds 30-52% of the dressing.
- **[measured]** Density is high: 2-5 9.1 visible doodads per 100 cells, 2-7 7.7, 2-3 7.5, 2-1 5.1, 2-2 4.8, 2-6 4.8, against 3-11's 2.8. That supports the user's "denser than feels necessary".

### DL-07. Doodad Composites — holds, as a tool

- **[measured]** Raised doodads: 2-0 50%, 2-5 27%, 2-4 25%; tinted: 2-7 58% (inherited by 3-0), 2-4 26%, 2-8 19%; tilted 15-21% only on 2-0 and 2-4. 2-1, 2-3 and 2-5 do almost no manipulation.
- No new recipe was confirmed from raw `Objects` in this pass.

### DL-08. Story props as families — holds

- **[measured]** Every campaign map has families at 20x chance or more except 2-5 (top 4.5x) and 2-8 (7.7x): 2-0 `BraxisAlphaBarrels` + `JarbanMinor_Fence` 40x; 2-1 `ProtossFireMedium` + `UnbuildableBricks` 37x (a burning ruin); 2-2 `CompoundMansion_Bench` + `Elsecaro_Small_Props` 72x; 2-4 `GateControlCables` + `SpacePlatformSteamVent` 57x; 2-6 `TempleBricksLarge` + `TempleColumnSet` 20x.

### DL-09. One light for the mood; change it at Beats — first half holds, second half doesn't in Episode 2

- **[measured]** Every Episode 2 campaign map with lighting triggers sets exactly one light, once, at map start (`gt_Mapstart2_Func` or `gt_Start_Func`), with a map-local `CLight` of that name. 2-1 and 2-3 set none. Only 2-4 changes light at a Beat: a 3 s pulse to `PrisonShipEmergency` when the alarm is raised, and back.
- Episode 3: 12 of 13 maps switch, with 2-5 lights each.
- **[inferred]** Episode 2 supports "one light chosen for mood, retuned in data"; changing light at Beats is an Episode 3 habit. The lesson's weight already says "strong for lighting changing at Beats (12 of 13 maps)"; with Episode 2 it's 13 of 21 campaign maps, 1 of 8 in Episode 2.

### DL-10. Darken cliff feet — not checked in this pass.

### DL-11. Rotate natural props freely; snap built props and decals — holds

- **[measured]** On a 45° step: natural props 4-25% (2-0 25%, the rest 4-11%); built props 7-70% (2-2 70%, 2-4 66%, 2-0 69%; 2-5 and 2-8 under 7%); decals 79-100% where present.
- **[measured]** Natural-prop scale: varied around 1 on 6 of 8 maps (10th-90th percentile about 0.83-1.16); 2-0 keeps everything at 1; 2-2 has 52% at 1.

### DL-12. Point lights, one colour per family (optional) — holds; two maps use them heavily

- **[measured]** `LightOmni*` doodads: 2-3 1,583 (orange 682, green 640, purple 156), 2-7 204, 2-2 169 (blue, orange, red, green), 2-6 34, 2-0 16, 2-8 12; none on 2-1, 2-4 and 2-5.
- Not yet checked: whether 2-3's colours follow prop families.

### DL-13. Water — not measured (study reader bug, see Method).

### DL-14. Map-local tileset: one main planet plus accents — holds, with more accents

- **[measured]** Texture families covering 5% or more: 2 on 2-0, 2-4 and 2-7; 3 on 2-5 and 2-8; 4 on 2-1, 2-2 and 2-3; 5 on 2-6. 2-2 is Elsecaro 41%, Korhal 33%, Aiur temple jungle 15%, Castanar 6%: two city families as the main, a jungle for parks.

## Part 2: 2-2, the city

The user, 2026-10-27: "2-2 is one of my favorite maps because we made so many special little areas to make it feel like a city."

**Layout [measured, frames].** Streets on a 45° grid, with city blocks between them (doodads.png, minimap). Most blocks are raised building tops left nearly bare and dark; the dressing sits in the streets, plazas and in pockets cut into the blocks.

**Many small themed places [measured].** The study finds 82 Doodad Composites. Each pocket has its own prop family and story:

| Place | Frame | Members (top types) |
|---|---|---|
| Fountain plaza with café tables, storefronts and topiary | 016 | `KorhalTopiary` 34, `MarSaraGroundProps`, `Bush`, `StoreFrontCityProps` |
| Nightclub: dance floor with dancing civilians, tables, booths | 127 | `CompoundMansion_Furniture`, `_Bench`, `_Trims`, `PortCity_GroundLights` |
| Zoo: an ice enclosure with an Ursadon behind fence, a jungle enclosure, an aquarium tank | 089, 076 | `SnowDrifts`, `ChainLinkFenceDiagonal`, `IceBlock`; `ForceFieldWall`, `Fish`, `Eel`, `LightOmniBlue` 27 |
| Monorail station with a parked train and a neon sign | 162 | `TarsonisCharger`, `MonoCar`, `BillboardScrollingText`, `LightOmniRedLarge` |
| Storefront row with neon signs, benches and planters | 003 | `StoreFrontCityProps`, `KorhalStoreFront`, `CityBillboards`, `KorhalTopiary` |
| Landing pad with crates and cameras | 204 | `SpacePlatformWallLight`, `LandingLights`, `SpaceCamera`, crates |
| Prison cells | 212 | `SpacePrisonCell`, `SpacePlatformCliffDecal` |
| Stasis-tube lab | 130 | `CastanarStasisTube`, `CarbonMarineBlock`, `LightOmniPurple` |
| Car lots | 092, 106 | `CivilianCars`, `CargoTruck`, `ColonistVehicle`, `Streetlight` |
| Burning crash site | 037 | `BloodSplats`, `FireMedium`, `LandingLights` |
| Back alleys and rooftops | 005, 006, 019 | `CompoundSewers_Trashes`, `Dumpster`, `RooftopEntrance`, `PortZionGarbagePile` |
| Shanty of colonist huts | 096 | `ColonistHutDoodad` 10 |
| Ice-crystal grotto | 086 | `IceWorldAmbientCrystals`, `CrystalLarge`, `LightOmniCyanLarge` |

One composite of 961 doodads (streetlights, ground props, fences) is the street network itself.

**Population [measured].** 708 placed units across 11 players, among them marines, colonists, dancing civilians, civilians and cruiser bikes. 3-11 places none; the other Episode 2 maps place mostly resources and enemies.

## Part 3: New candidates

Each is for ratification, one at a time.

- **C-1. A city is many small themed places.** Ratified 2026-10-27 as DL-15. Give a city Zone a dozen or more small places, each with its own story and prop family (a nightclub, a zoo enclosure, a market, a car lot, an alley), set into pockets between buildings, with bare rooftops between them. Evidence: 2-2's 82 composites and the table above. Weight: one map, but the user named it as a favourite for exactly this reason. Blueprint hook: Zone set pieces, with a "district" Zone type listing its places.
- **C-2. Populate inhabited places.** Folded into DL-15 on 2026-10-27, as a question to ask the user. Place civilians, traffic and idle troops as dressing where people would be (dancing civilians in the club, colonists in the street, bikes and cars parked). Evidence: 2-2's 708 units. Blueprint hook: Zone dressing, a `population` list of unit types and counts.
- **C-3. Built maps still mix floors inside each view.** Ratified 2026-10-27 as a clarification in DL-01. On a city map, change the floor within every frame (paving, plaza tile, grass courtyard, road) rather than giving each block one floor. Evidence: 2-2 1.2% single-texture areas. This would narrow DL-01's built-floor allowance to interiors (labs, ships).
- **C-4. DL-09 weight.** Ratified 2026-10-27: Medium for changing light at Beats ("It really depends on the story beat"). Lower "change light at Beats" from strong to medium, or keep it strong as the Episode 3 direction the user chose to go in. A question for the user, not a measurement.

## What this pass did not do

- DL-10 (shadow bake), DL-12 colour-by-family on 2-3, DL-13 water (reader bug), and composite recipes from raw `Objects`.
- Frames were checked only for 2-2 (frames 003, 016, 076, 089, 127, 162). The other maps' tours are unread.
