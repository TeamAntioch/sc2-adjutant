# Interiors

How to dress a built room: a factory, lab, prison, refinery, ship's deck or platform. It covers how dense, where things go, in what order, the kits that make a room read as working, and what never stands alone. The numbers come from Blizzard's campaign maps, measured from the game's own map files. The lessons behind them are DL-06 (dress the walls, keep the floor clear), DL-08 (no prop alone; kits), DL-11 (built pieces at scale 1), DL-12 (lights in dark places), DL-18 (painted routes) and DL-19 (use the vertical). [`DRESSING.md`](DRESSING.md) has the Blueprint fields; this guide says what to do with them indoors.

## Words

- **Floor**: a room's walkable cells.
- **Wall band**: the walls round the floor, which in SC2 are cliff cells and the wall pieces standing on them. A doodad there counts toward the room.
- **Edge**: floor within 2 cells of the wall band.
- **Open floor**: the rest.
- **Clear floor**: the share of floor 2 or more cells from any solid prop. It is the play space.
- **Kit**: the set of roles that make a place read as doing something (below). A kit is generated from its roles, not copied from offsets (DL-07).

## How dense

Per 100 floor cells, for a hero-mission interior (one or two heroes, the camera close; Scene 8's factory), from 146 rooms in seven Blizzard hero missions. "Total" is the median, with the middle half in brackets.

| Room | Total | Wall band | Edge | Open floor | of it decals | Lights (omni) | Effects | Solid props | Clear floor |
|---|---|---|---|---|---|---|---|---|---|
| Corridor | 20 (14-25) | 9 | 7 | 4 | 8 | 2 (0.7) | ≤0.5 | 7 | ≥75% |
| Storage, loading | 20 (13-27) | 7 | 7.5 | 5 | 6 | 2 (0.8) | ≤0.5 | 9.5 | ≥65% |
| Production floor | 16 (10-22) | 6 | 5 | 5 | 4 | 1-2 (≥0.3) | ~1 per room | 9 | ≥60% |
| Control room, office | 18 (11-23) | 9 | 6 | 3 | 5.5 | 2 (0.7) | ≤0.5 | 7 | ≥85% |
| Lab | 12.5 (10-13) | 6 | 4 | 2.5 | 2.5 | 2 (0.6) | ≤0.5 | 6 | ≥55% |
| Wrecked, a fight's end | 22 (14-31) | 9 | 9 | 4 | 8 | 1.6 (0.7) | 1-1.5 | 7 | ≥65% |
| Interior in an army mission | 10 (5-19) | 4 | 3 | 2.5 | 4 | 0.6 | ≤0.5 | 3.5 | ≥80% |

- **Under 12 per 100 is sparse** for a hero interior. That is below the middle half of Blizzard's rooms (12-23). Over 25 is Blizzard's densest, The Escape's research wing.
- **Hit the mix, not the total.** Eighteen per 100 made of decals alone, or of furniture alone, is wrong. The wall band carries the most; the open floor is mostly decals; solid props cover only 3-6% of the floor.
- **In counts**: a 24 × 18 room (432 floor cells) at 18 per 100 is about 80 doodads. That's ~34 on its walls, ~28 within 2 cells of them and ~17 out on the floor, ~9 of which are decals. Add ~8 lights (2-3 of them omni) and an effect or two.

## Where things go

Shares in Blizzard's hero-mission rooms:

- **On the walls**: wall panels, caps and trim; signs (93%); vents and fans; lights (53%); lab tanks; consoles and terminals (46%); pipe runs. Most of it (71%) stands at the wall's foot at floor height, against the cliff or pushed into it (debris 98%, storage 92%, lab tanks 93%, lights 74%, consoles 71%); 15% stands on the higher ground beyond.
- **In corners**: consoles first (12% of them), then stacks and debris.
- **Hung on the face** (14% of wall pieces): signs (84% of them hang), rails along a ledge (44%), effects (21%), cables and pipes (17%), screens over a console (DL-19). Debris and storage don't hang.
- **On lips and catwalk edges**: barriers and guardrails, and only there. Vents and pipes may run along them.
- **Out on the floor**: decals (54% of what's there), lane lines, cables, a stack, a machine on its bay or one centrepiece. Never a lone console, crate or bit of debris.

## Order

1. **Walls**: panels and caps; stock, pipes and lights standing at the foot, pushed into it; signs and screens hung on the face at +1.5-3.
2. **Corners**: a console bank, a stack or a floodlit post in each used corner.
3. **The centrepiece**, if the room has a job: a machine bay with its whole kit, and lane decals leading to it.
4. **Edges**: stock and storage along the walls; barriers on lips only.
5. **Floor**: lanes from door to door, bay marks round machines, grime and oil stains densest by the walls and machines.
6. **Lights** on the groups (DL-12), then **one or two effects** on their causes (DL-19).
7. **Check**: the bands and the clear floor against the table above, and that no solid prop stands alone.

## Kits

Each kit is a set of roles. Fill each role from the mission's tileset; the types listed are what Blizzard used, all in `mods/liberty.sc2mod` unless marked; the marked ones need the dependency `bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign`, which brings the Liberty and Swarm campaigns' doodads; the compile adds it, or only warns when the Blueprint depends on a custom mod. The source in brackets is the Blizzard map and Object Id to open in the Editor for a look.

- **Machine bay** (the general kit):
  - the machine against a wall or in a bay;
  - its supply: a hose, cable or pipe running to it;
  - its stock: crates or barrels beside it, inputs and outputs;
  - its light: a fixture on it and an omni light beside it;
  - its floor: bay lines, numbers, oil and grime where the work happens;
  - sometimes its fault: smoke, sparks, a broken panel.
- **Refuelling bay** (End Game, `nova09` #836668670): `BattleStation_RefuelingStation`, `BattleStation_RefuelingPiping` and `BattleStation_MissileStorage`, ringed by ten floor decals (`BattleStation_Line_Decals`, `_Number_Decals`, `_Text_Decals`). The decals turn the prop into a bay.
- **Assembly bay** (Engine of Destruction, `thorner03` #426; needs `Void (Campaign)`): `AircraftAssembly` on `TerrainObjectValhallaAircraftElevatorDoodad`, partitioned by `MetalWall` panels and a `SpacePlatformBarrier`, marked by two `SpacePlatformSignTowerLarge`, a `Floodlight` and `LandingLights`, with `ExhaustPipes` at one side and a row of three lane decals (`Decal` variation 21, 1.55 apart) leading out. A centrepiece: one per room.
- **Robot-arm bay** (The Escape, `nova01` #1260): `DOM_RoboArm_Large` in a wall corner, its stock beside it (`DOM_Crate` ×2, `MilitarySupplies`), `DOM_Groundlights` and a `LightOmniRedLarge`, debris splats and `DOM_Decals` where it works.
- **Scrap line** (Cutthroat, `thorner02` #697): `PortZionScrapConveyorBelt` with a `PortZionTower` at its head, barrels and tyres at its foot, a chain-link fence and floor lines in front. Blizzard blocks its ground with pathing blockers, not the model.
- **Exhaust and reactor** (Ghost of a Chance, `ttosh03b` #498): `SpacePlatformReactor` and `SpacePlatformExhaust` joined by a `SpacePlatformHose`, heavy `SpacePlatformCablesLarge` along the platform's edge, a sign, a barrier and a landing light.
- **Workstation** (Conviction, `zspace02` #723): `CastanarWorkstation` with two tinted `CastanarLightboard`s, a small console and conduit (`ElectricConduitPathMedium`) at its back edge over the drop behind it, smoke from a fault, debris and a blue omni light. Long dark `Decal` stripes (scale 0.45 × 2.6-5) serve as floor seams.
- **Floodlit post** (The Escape, `nova01` #2076): `DOM_LabFloodLight`, two `LightOmniYellow` (one at +1.4), `DOM_Groundlights`, a hose, a small console, a `Korhal_Curbs` flattened to 2 × 2 × 0.25 as a plinth, grime and splats, and a tinted haze (`Fog_Aiur_Thick`). The room's lit working corner.
- **Lit crate bay** (Back in the Saddle, `zlab02` #832): two `HavenDoodadsCrates` against a wall under a glass panel hung at +1.9, a wall console on the wall top behind, an `UmojanLabFloodLights` on them, a landing light and a row of three lane decals in front.
- **Yard storage** (Cutthroat, `thorner02` #1067): `PortZionStorage`, `PortZionBarrel` and `PortZionTires` at mixed sizes (0.82-1.1) and loose turns, a junk pile, a `PortZionCrane` and a fence. For a loading dock or yard: the one kit here whose pieces turn freely.
- **Burning breach** (Conviction, `zspace02` #746; needs `Void (Campaign)`): `FireMedium` on cracked floor (`MarSaraCrack`), a body, `KorhalBuildingDebris`, `BrokenPlating` and `SpacePlatformWallDebris` spilling over the edge of the drop behind it at floor height: a breach is a story reason for pieces over a drop (DL-18).
- **Sparking wreck** (Back in the Saddle, `zlab02` #1102; needs `Void (Campaign)`): `UmojanLabElectricalArcs` at 0.7 over building and wall debris, a small fire, cracks, a crash splat, a white omni light and a flashing light. Damage that still moves.

The shapes inside some kits are exact Doodad Composites in the pack's library (`blizzard-composites.json`, merged into `composites.json`):
- `console-bank`: a console with its monitors hung above;
- `supply-stack`: crates packed into two layers (a landmark: one per room);
- `pipe-manifold`: pipes on a one-cell grid;
- `steam-hatch`: a steam jet sunk under a hatch.

The author's `crusher-press` (`author-composites.json`) is a whole machine rather than a kit's shape: a conveyor belt under two gantries with a crate press head, alarm lights on the pillars and DO NOT ENTER at the ends, built and checked in the Editor. Use it for a crushing-press puzzle; the encounter's triggers drop the head and switch the lights.

Stamp these, and generate the kit round them. Each was cut whole from a Blizzard map and hasn't been looked at in the Editor yet: compile one alone and look before a set piece uses it ([`DRESSING.md`](DRESSING.md)).

How the kits make rooms:
- **Production line**: several machine bays joined by supply runs and lane marks, with stock between them.
- **Loading bay**: stacks and yard storage with lane marks, a crane or lifter, floodlit.
- **Control room**: console banks round the walls, facing a clear floor.
- **A fight's end**: the burning breach and sparking wreck, bodies and blood, and debris heaped at the walls' foot.

## Never one alone

1. Every solid prop has company within 2.5 cells. Aim for under 20% alone (Blizzard's hero missions 18%; the factory's first dressing 58%).
2. Every machine comes with its kit.
3. Every console, screen and terminal goes against a wall, in a corner by preference, with screens hung above it at 0.5 scale and +2-3.
4. Every crate is stacked: packed edge to edge, two layers, lit. Loose crates go only in a wreck.
5. Every light belongs to a group (DL-12). Lights don't run in rows; landing and ground lights line a bay or a lane.
6. Every effect sits on its cause (DL-19), about one per room.
7. Wall dressing stands at the wall's foot: most of it at floor height, against the cliff or pushed into it. Hang only signs, screens, rails and some cables.
8. Every bay is marked on the floor: lines, numbers, stencils, oil.
9. Every route is painted: lane decals 1.2-1.8 apart from door to door, cables across the floor about 1.5 apart (DL-18).
10. Every pipe belongs to a network: long, short and corner pieces on a one-cell grid, never one pipe.
11. Every sign hangs on a wall; none stand on the floor.
12. The open floor carries decals, not furniture.
13. Built pieces stay at scale 1 on the 45° grid (DL-11). Vary scale only on decals, plants, effects and lights.
14. Push pieces together with ignore placement: overlaps and stacks are normal (a quarter of Blizzard's storage touches a neighbour). Nothing solid dangles over a drop (DL-18).
15. Every number, letter and word labels something: a bay's number at its bay, the bay's name across its mouth, DO NOT ENTER or CAUTION at the hazard it warns of. Scattered, they read as noise. The same goes for hazard signs, bay badges and emblems.

## Which decal

The decal catalog (the published sc2-asset-catalog's decal descriptions; the MCP tool `decal_variations`) says what every variation of every decal doodad shows. It also says whether it carries a number, letter or words, its shape (a line, a corner or a patch), whether it tiles, and its use (`marking`, `ornament`, `label`, `sign` or `emblem`). Choose variations from it by number, never at random.

- **Lanes and seams**: plain stripes that tile, with their corners and curves. Ask for `glyphs: ["none"], use: ["marking"], shows: ["stripe"], tiles: true`. Good sources are `Decal` 0-3 and 21, `DOM_Decals` 0-8 and 10, all of `BattleStation_Line_Decals`, `DecalSpace` 0, 1 and 12, and `SpacePlatformGroundDecals` 11-15.
- **Turning a route**: arrows (`Decal` 17-20, `MoebiusLabDecals` 9, `BattleStation_Symbol_Decals` 0-1).
- **A bay**: a frame or bay end round it (`DOM_Decals` 9, `BattleStation_Symbol_Decals` 2, `BattleStation_Line_Decals` 8). Add one number per bay, numbered in order along the row, plus at most one word decal naming the room's job (`BattleStation_Text_Decals`, `DOM_Decals` 12) or one badge (`BattleStation_Symbol_Decals` 4-10).
- **A hazard**: hazard stripes along its edge, and one sign or warning word at it (`Decal` 14-16, 22, 24 and 27; `DecalSpace` 16 and 19-21).
- **Wear**: grime, oil and cracks come from splat and crack doodads, not decals. No decal here is a stain.
- **Never** use `DecalSpace` 22-23, the Warcraft faction crests. `Decal`'s numbers and words (4-13, 23-28) are faint grey in their pictures: look at them in the Editor before a bay depends on them, or use the bold `BattleStation_Number_Decals`.

The dresser already scatters only plain markings and ornament. Anything that labels has to be named: give the member `variations` (below).

## With today's Blueprint

The compiler doesn't yet have a wall line, lanes or a density check (TeamAntioch/sc2-adjutant#530). Until it does:

- **Which way a piece faces is measured, not assumed.** A model's front doesn't point along its rotation. At rotation 0 most wall pieces face south, `CompoundSewers_Tank` and its kin face west, and `DOM_LabWallScreens` faces north. Core's `doodad-facings.json` records each measured doodad's front and where it stands against a wall (`search_doodads` shows it), and [doodad-facings.md](../../../docs/reference/doodad-facings.md) explains it. Many doodads that aren't in it have a front read from their catalog sheet (`doodad-sheet-readings.json`, `source: "sheet"` in `search_doodads`). The dressing turns by a sure one and warns, but a sheet's placement is only a suggestion. A doodad in neither is unknown: measure it with `npm run facing-strip` before you rely on its turn.
- **Back wall pieces with `against: "wall"`.** A member with it stands at the nearest wall in the set piece's radius, front to the room. A floor piece stands about 2.6 cells out from the wall zone's edge, clear of the slope. A hung one goes on the face at about 1.9 cells out and 2.2 up. A composite stands out far enough for every piece in it. The compile warns about any doodad it couldn't turn by a measured front.
- **A kit is a set piece** centred a cell or two off the wall it backs onto, with `nestle: true`. Its machine goes in `anchor` with `against: "wall"`, or with a `yaw` for the way its front should face (degrees counterclockwise from east, so 270 is south; the compiler turns a measured doodad by its front), its stock and supply in `props`, and its decals and small pieces in `clutter`. Keep `radius` small (3-5) so the props stay against the machine and the wall.
- **Stamp a shape** with `{ "composite": "console-bank", "against": "wall" }`, or `"yaw": <degrees its front faces>`. A recipe faces by its `front`, or by the front its measured members agree on (`console-bank`'s consoles and screens agree on about 225° at yaw 0).
- **Hang a piece** with `against: "wall"` when its facing is measured as `wall-face`. Otherwise use a doodad anchor with `position.z` and the `HeightOffset` flag (z above the ground), or a set piece's `added` doodad with `heightOffset`.
- **Place a doodad anchor by hand** at the rotation that turns its front to the room: rotation = the facing less its measured front (a front-270 piece faces south at rotation 0 and east at rotation 90). Stand a floor piece's centre about 2.6 cells out from the wall zone's edge, not under 1.5: closer, it sits on the cliff slope and takes its height.
- **Lay a lane** as a row of decal anchors, or a set piece's `added` decals 1.2-1.8 apart.
- **Label a bay** with a decal anchor of the variation it needs, or a member that names it: `{ "type": "BattleStation_Number_Decals", "count": 1, "variations": [3] }`. A decal member without `variations` gets only plain markings and ornament.
- **Scale**: give every built doodad anchor `scale: 1`. Anchors default to a random 0.85-1.15.
