# Map Bounds: the Playable Area and Each Beat's Bounds

A Mission Blueprint now says where its map can be played and seen. There are two levels. The map's **playable area** is MapInfo's one rectangle. A Beat's **camera bounds** and **playable area** are set by triggers as it starts and hold until a later Beat sets others. Issue #529 holds the research behind this: a Kept hero stealth section, another Kept mission, and 51 of Blizzard's campaign maps.

**What MapInfo holds.** One rectangle, `[left, bottom, right, top]` in whole cells, after the tileset string. It feeds the integrity hash. The Editor calls it "Camera" in Map Properties > Bounds. The game uses it as three things at once: the area units may go, the camera's bounds at the start, and `RegionPlayableMap()`. Until now the compile always wrote the Editor's default inset, `[10, 8, w−10, h−20]` (`cameraBoundsFor`). It had no way to change a Kept map's rectangle.

## Decisions

1. **The map's playable area is `bounds.playable` on the Blueprint.** It takes a rectangle of whole cells, `"zones"` or `"editor"`.
   - `"zones"` is the default. It is the box round the Zones that aren't backdrop, widened by `bounds.margin` (3 cells by default), rounded out to whole cells and then kept inside the Editor's inset.
   - `"editor"` is the inset, the old behaviour.
   - `bounds.margin` goes only with `"zones"`. `"playable"` and `"entire"` are refused where a Zone or Kept region has that id.
   - Why the default stays inside the inset: the camera pitches north and shows ground past its bounds, roughly 8 cells past the bottom and 12–14 past the top (inferred, not measured in game). The inset is the apron that keeps the void beyond the map off screen. So a derived area only ever tightens the old one, and never shows the void.
   - A rectangle nearer the edge than the inset is taken as given, and the compile warns that the void may show.
   - The field is named `playableBounds` in core, where it was `cameraBounds`. `map/camera-bounds.ts` is replaced by `map/map-bounds.ts`.
2. **Beside Kept terrain, `bounds.playable` patches the package's MapInfo in place** (`map/patch-map-info.ts`). Only the 16 bytes of the rectangle and the 8 of the hash change. The hash formula is the one `check` already uses (confirmed on version 39, which every Kept map we have is). Without `bounds.playable`, the package keeps its own rectangle.
   - The Kept Minimap.tga is masked black outside the new rectangle. Where the new rectangle reaches past the old one, the minimap is black there, and the compile asks for an Editor save to redraw it.
   - The record lists the patch as `map-bounds`, with the rectangle written and the one there before. A compile whose Blueprint drops `bounds.playable` puts the original back. MapInfo stays Kept Content: there is no file entry for it.
   - A compile cut short between its two record saves leaves the old and new entries. A rectangle either wrote, or the original, then counts as the compile's own. With one entry, putting the original back in the Editor is an Editor change.
   - If the Editor moves the rectangle after a compile set it, that is an Editor change named `map-bounds:MapInfo`. It stops the compile like any other until the author decides: `--discard` writes the Blueprint's, and `--keep` leaves the Editor's this once. To keep it for good, the author sets `bounds.playable` to it, and then there is no change.
3. **Each Beat may set `camera` and `playable`.** They are compiled in `triggers/beat-bounds.ts`, beside `beat-reveals.ts`.
   - `playable` is Set Playable Map Area (`RegionPlayableMapSet`, Ntve `9AD8B4CA`). It takes an area, or `"entire"` for the whole map, as Blizzard's maps open it round a cutscene.
   - `camera.bounds` is Set Camera Bounds (`CameraSetBounds`). It takes an area, or `"playable"`. `camera.minimap` is on by default, as in NativeLib and in 0101.
   - An area is one of three things: a Zone's trigger region or a Kept region, by id, used as it is; a list of Zone ids, for the box round them; or a rectangle.
   - The trigger that starts the Beat sets the playable area first, then the camera bounds, before its explores. The first Beat's go at the top of "Mission Start".
   - A Beat that sets a playable area and no camera bounds ends any earlier Beat's camera bounds. The camera follows the new playable area, as the game moves it, with the minimap back to the whole area.
   - Bounds hold from the Beat that sets them. Every later Beat that starts in the map sets them again as it starts, so a Beat the mission skips leaves nothing stale. The playable area is never set to MapInfo's own: the game would round it to even cells.
4. **A transition is optional and opt-in.** `camera.transition` is `true` for the box round the last camera bounds and this Beat's (the playable area as it stands, when nothing narrower bounded the camera before), or a rectangle. The Beat sets it first, with the minimap left as it is. It sets its own bounds once its start scenes have handed back, behind the same guard as the reveals' pings. That is 0101's pattern for locked camera moves between areas.
5. **Areas given as Zones or rectangles are bounds regions.** They are written last, after the author's own regions, so adding or dropping one renumbers no other region. Each trigger value names its bounds region by its place among the bounds regions, and the compile resolves that from the regions it actually wrote, so no count of the regions before them can misname one. Sync leaves a bounds region alone while the Editor hasn't changed it since the compile (its record fingerprint), even if the Blueprint's Zones have moved since.
   - Each one's RegionSource is `{ kind: "bounds", beatId, role }`, and it is named "Bounds <Beat> Camera", "Playable" or "Transition".
   - When the author redraws one as a single rectangle, sync writes that rectangle back as the Beat's area. Other shapes are reported and dropped.
   - A Beat's playable area round Zones is rounded out to even cells, so the game has nothing to round. A rectangle or Zone region off the even cells is warned about, and the checks and the Waves' spawns read it drawn in to even cells, all the game is sure to keep whichever way it rounds a half.
6. **The checks are one module, `layout/bounds-checks.ts`.** It runs as the level-design checker's `bounds` check, and in the compile, which beside Kept terrain is the only place it runs. It checks four things:
   - Zones that aren't backdrop lie inside the playable area, judged on their ground inside the Editor's inset. Ground in the apron is expected.
   - Each Beat's Zones and Anchors lie inside the playable area it sets, and its camera bounds lie inside that playable area.
   - Each Beat's camera Anchors aim inside its camera bounds. Its other Anchors stand within 7.5 cells of them, the furthest 0101's route runs past its rectangles.
   - Each Wave forms inside the playable area of every Beat its stream sends into, from its start to its end, and a Zone-spawned Wave is placed inside all of them; and the cameras of trigger scenes cued on a Beat's start aim inside the bounds then (a transition's while it holds).

## Considered options

- **Keep the inset as the default and make bounds opt-in.** Rejected. The issue asks for a default fitted to the Zones, and the derived area only tightens the inset, so no existing map starts showing the void. The golden Mission moves one edge by one cell.
- **Derive the default without the inset, out to the map's edge.** Rejected. Every fixture whose Zones reach the map's edge would show the void at the top, where the camera sees furthest.
- **Patch MapInfo by sync, as a Blueprint field read back from the Editor.** Rejected for now. Sync doesn't run beside Kept terrain, and the compile record already has a way to undo a change to Kept Content (the `kept-hold` entry of ADR-0014).
- **Object forms for areas** (`{ zones }`, `{ rect }`, `{ region }`). Rejected for brevity. The three forms differ by type (a string, a list of strings, a list of numbers). `"playable"` and `"entire"` win over a Zone of that id.
- **Set bounds only on the Beat that declares them.** Rejected. A skipped Beat would leave the bounds before it, and changing the playable area moves the camera bounds with it, so the camera's must be set again.

## Consequences

- MapInfo and Minimap.tga change for generated Missions whose Zones don't fill the inset. The golden Mission's left edge moves from 10 to 11.
- The Ashfall Relay example's Lookout point moves from y 54 to 42. It stood outside the playable area the compile has always written.
- Not yet confirmed in game, and kept as open questions (#531):
  - whether `CameraApplyInfo` and `CameraPan` targets are held to the camera bounds (the checks assume not, and warn);
  - how ground past the bounds, and the void past the map, render;
  - what the minimap and fog do under `RegionPlayableMapSet`;
  - whether a transition's wider rectangle lets a locked pan run smoothly, as it does in 0101.
