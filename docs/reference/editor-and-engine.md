# Editor and Engine Facts

Behaviour of the Galaxy Editor, the Cutscene Editor and the game engine that generated maps and cutscenes depend on. Each entry says what was tested and how, and where the compiler applies it. Verified on Editor 5.0.16 and game 5.0.17 on macOS unless an entry says otherwise.

## Camera objects

**Write every CameraValue.** The Editor reads a CameraValue left out of an `ObjectCamera` as about zero, not as the game camera's default. A camera that wrote only Distance, Pitch, Yaw and FieldOfView got a FarClip of 0.0002 and showed nothing but the skybox through "View Selected Camera". Found by diffing it against a camera made in the Editor from the default game camera (rain emitters and the skybox were ruled out first). `packages/core/src/map/write-objects-xml.ts` writes the default game camera's full set (NearClip 0.0998, FarClip 600, ShadowClip 75, ...) with the Anchor's values on top.

**Rotation must equal Yaw, in radians.** The Editor keeps a camera's yaw twice: as the Yaw CameraValue and as the object's `Rotation` in radians, and it culls the view by `Rotation`. Rotation 0 under Yaw 180 dropped everything far up the view (the far end of a street went black). Found from an Editor-made camera, after FarClip, ShadowClip and camera bounds were ruled out. The compiler writes Rotation from Yaw, and sync doesn't read it back.

**Yaw 180 looks north** (+y), the gameplay view. Yaw 0 looks south.

When a camera view is empty or wrong, diff its CameraValues against a camera made in the Editor from the default game camera before guessing ([debugging-the-editor.md](./debugging-the-editor.md)).

## Camera tours of an edited area

`npm run capture-edit` (`packages/core/src/capture/edit-capture.ts`, #254) looks at edited Kept ground in game. It runs a capture tour whose stops each set their own camera. The planner (`area-tour.ts`) relies on the following, which isn't verified in engine yet (no capture had run when it was written):

- **Setting the camera.** At each stop, before `CameraPan`, the tour makes three calls, one each for `c_cameraValueDistance`, `c_cameraValuePitch` and `c_cameraValueYaw`, as `CameraSetValue(1, <value type>, <value>, 0.0, -1, 10.0)`. That's the form Blizzard's campaign scripts use. Pitch is degrees down from level: the default game camera's 56 is the player's view, and the high view's 75 is nearly top-down.
- **Yaw is relative.** The yaw is set as `CameraInfoGetValue(CameraInfoDefault(), c_cameraValueYaw)` plus an offset, so the tour never depends on which way the trigger yaw counts. The turned views go 45° each way and aim at the area's middle. Which side each one shows depends on the game's convention, and their frames are named `player-yaw-45` and `player-yaw+45` after the offset.
- **What a camera sees.** The planner takes the default game camera's FieldOfView (27.8°) as vertical, and the frame as 16:9, the shape `editor.captureTour` crops to. On flat ground, the player's view then covers about 26 cells across at the bottom, 36 at the top and 21 deep. Its target sits about 2 cells south of the middle of what it sees. Relief and cliffs aren't counted.
- **Camera bounds.** The game keeps the camera target inside the map's camera bounds, so the planner clamps each target to them. A view of an area at the map's edge may then show less than its part. The capture's summary and `views.json` (`whole: false`) name each view that does, as they do when an area is too big for the views.
- **The map's own triggers don't run.** The capture copy's Triggers are the tour's, as in every capture copy, so a lighting the Mission sets by trigger isn't set. Pass `--lighting <id>` to set one.

## Map size

A 96×140 map lost its terrain in the Editor; 96×144 worked. Map sides probably have to be multiples of 8. This is unconfirmed, and the compiler doesn't check it.

## A cliff climbs one level

The game draws a cliff one level high. Where two neighbouring cells, diagonals too, differ by two cliff levels or more, it draws a solid black square instead. Seen in game on a Kept map (2026-11-11): level-2 rock against level-7 rock, and floors against rock two levels up. A generated map's compile terraces the rock a level at a time (`packages/core/src/terrain/terraces.ts`, GLOSSARY "Terrace"), and warns where two floors meet two levels apart.

## Map bounds

**MapInfo holds one rectangle.** It is `[left, bottom, right, top]` in whole cells, four int32s straight after the tileset string, and it feeds the integrity hash (below). Map Properties > Bounds calls it "Camera". The game uses it as three things at once:
- the area units may go;
- the camera's bounds at the start;
- `RegionPlayableMap()`.

TLMC's listed playable sizes match it exactly. The rectangle in MapInfo's closing block is a preview or lighting camera, not a gameplay bound.

**The Editor's default is 10 / 8 / 10 / 20 cells in** from the left, bottom, right and top. Blizzard's campaign stage regions keep to it, (10, 8) to (W−10, H−20). The top is widest because the camera pitches north. About 8 cells past the bottom bound and 12–14 past the top show on screen. That is inferred from the camera's angle, not measured: TeamAntioch/sc2-adjutant#531.

**What the compile writes** (ADR-0015, `packages/core/src/map/map-bounds.ts`) depends on the Blueprint's `bounds.playable`:
- `"zones"`, the default: the box round the Zones that aren't backdrop, widened by `bounds.margin` (3 cells), in whole cells and kept inside the inset. A derived area never comes nearer the edge than the inset, so the camera never sees past the map.
- `"editor"`: the inset itself.
- A rectangle of whole cells: written as given. If it comes nearer the edge than the inset, the compile warns that the void past the map may show.

Of the four Kept maps checked, two use the full 256×256 rectangle and bound the camera by trigger alone, and two keep the inset.

**Beside Kept terrain** the package keeps its own rectangle, unless `bounds.playable` is given. Then the compile patches MapInfo in place (`packages/core/src/map/patch-map-info.ts`). Only the bounds and the hash change, which takes version 39, the only version the hash is confirmed on. The Kept Minimap.tga is masked black outside the new rectangle. Where the new one reaches past the old, the minimap is black there, and the compile asks for an Editor save to redraw it. The compile record lists the patch as `map-bounds`, with the rectangle before it. Dropping `bounds.playable` puts that rectangle back. Moving the rectangle in the Editor after a compile set it is an Editor change, `map-bounds:MapInfo`, decided as any other. To keep the Editor's for good, put it in `bounds.playable`.

**During play** two NativeLib actions change the bounds:
- **Set Playable Map Area** (`RegionPlayableMapSet`, Ntve `9AD8B4CA`) confines units to the region. Its hint says it rounds the region's edges to the nearest even cell, and moves the camera bounds to suit.
- **Set Camera Bounds** (`CameraSetBounds`, `F470860B`) bounds where the camera can go. It can't reach past the playable area. Its third parameter is the **Minimap** flag (Do or Do Not shrink the minimap to the bounds), not an edges flag.

How Blizzard and the Moons maps use them:
- In 44 of 51 Blizzard campaign maps, Set Playable Map Area stages the mission's areas, and 17 of them open `RegionEntireMap()` round a cutscene. Only 9 call Set Camera Bounds, mostly tutorials.
- One Kept map's stealth section (`gf_ChangeStealthArea`, Regions 4–9) bounds the camera instead, one rectangle per area, minimap on. While `CameraLockInput` pans from one area to the next, it sets the box round both, minimap off.
- Its rectangles bound where the camera aims, not where the hero walks: the route runs 0.5–7.5 cells past them.

**A Beat's bounds.** A Beat's `playable` and `camera` compile to those two actions (`packages/core/src/triggers/beat-bounds.ts`).
- **Order.** Its trigger sets them as it starts, playable area first, before its explores. The first Beat's are set at the top of "Mission Start".
- **How long they hold.** Until a later Beat sets others. A Beat that sets a playable area and no camera bounds ends the earlier camera bounds: the camera follows the new playable area. Each later Beat that starts sets them again, so a skipped Beat leaves nothing stale.
- **Areas.** An area is one of three things:
  - a Zone's trigger region or a Kept region, by id;
  - a list of Zone ids, for the box round them, a playable one rounded out to even cells (a rectangle or Zone region off the even cells is warned about, and the checks read it drawn in to them);
  - a rectangle.

  Lists and rectangles are written as bounds regions ("Bounds <Beat> Camera"), after every other region, so adding one renumbers nothing. A bounds region redrawn in the Editor as one rectangle syncs back as the Beat's area.
- **Transitions.** `camera.transition` (`true` for the box round the last bounds and these, or a rectangle) is 0101's pattern. The Beat sets the wider rectangle with the minimap left as it is, then its own bounds once its start scenes hand back.
- **Checks.** The level-design checker's `bounds` check, and the compile, check three things (`packages/core/src/layout/bounds-checks.ts`):
  - Zones lie inside the playable area. Ground in the inset's apron doesn't count.
  - A Beat's Anchors lie inside its playable area, and its cameras aim inside its camera bounds. Units and points may stand up to 7.5 cells past the camera bounds.
  - Waves keep inside the playable area of every Beat they send into, and trigger scenes cued on a Beat's start (or at mission start) keep inside the bounds then. `check_layout` reads the trigger scenes too.

**Not yet confirmed in game** (TeamAntioch/sc2-adjutant#531):
- whether `CameraApplyInfo` and `CameraPan` targets are held to the camera bounds;
- how ground past the bounds, and the void past the map, render;
- what the minimap and fog do under Set Playable Map Area;
- whether a transition lets a locked pan run smoothly.

## Unexplored areas

Map > Map Options > Unexplored Areas is MapInfo's fog string, the C string after the difficulty level (`packages/core/src/terrain/write-map-info.ts`, `readMapInfo`). `Dark` is **Grey Mask**: unexplored ground shows its terrain greyed. `Black` is **Black Mask**: unexplored ground is black until something explores it. `BlackNoUnhide` is **Black Mask (Reduced Radius)**: Black Mask without its Reveal Radius.

**When to use the reduced radius.** Black Mask's Reveal Radius of 4 un-blacks cells a few cells past what a unit can see, and ignores cliffs. In a cave or an interior, where a unit stands below high ground it can't see, the rock tops above it then show through the fog. Black Mask (Reduced Radius) has no reveal radius, so only what the unit sees is un-blacked. Blizzard uses it in Nova Covert Ops' interiors (*The Escape*, *In The Enemy's Shadow*). Use it for interiors and caves, and keep Black Mask for open ground.

**How we know.** The author set it in the Editor on a Kept map (2026-11-10). The only change to MapInfo was the fog string, `Black` to `BlackNoUnhide`, a null-terminated string at 0x2A, so everything after it moved 8 bytes on. The integrity hash at byte 8 stayed as it was: the fog isn't one of its inputs (`mapInfoIntegrityHash`).

How we know which is which (2026-11-04): core's EditorStrings name the setting's values `MASKSTYLEDARK` and `MASKSTYLEBLACK` ("Black fog used for unexplored areas"), and Map Status's melee reason "Unexplored Areas is not set to Grey Mask" clears only on `Dark`, which every ladder map carries ([melee-maps.md](./melee-maps.md)). Read with `readMapInfo`, three of the four calibration campaign maps carry `Black` (The Evacuation, Devil's Playground, Zero Hour) and Media Blitz carries `Dark`; all thirteen Antioch Exemplar Maps carry `Black`.

`compile-map` writes `Black` for a Mission, `Dark` when its Blueprint sets `unexploredAreas: "grey"` or `BlackNoUnhide` when it sets `"black-reduced-radius"`, and `Dark` for a Melee Map (`packages/core/src/domain/unexplored-areas.ts` maps one to the other). Because the compile writes MapInfo whole, a setting changed in the Editor is lost at the next compile unless it reaches the Blueprint: `sync` reads the package's fog string back into `unexploredAreas`, leaving the field out for the default Black Mask, and `import_map` sets it from the imported package. A Mission with Kept terrain keeps its package's own MapInfo, and so whatever the author set in the Editor, and sync doesn't bring it back there (beside Kept ground, sync brings back the Zones' hidden cells alone). Its compile goes by the package's fog string, not the Blueprint's: its Beats' reveals warn under Grey Mask, not under either Black Mask, and a Blueprint that sets `unexploredAreas` to other than the package's warns, naming the value that matches. That catches an imported setting the author has since changed in the Editor.

Under Black Mask a Mission shows the player only what the story points at, as Blizzard's do: The Evacuation's "Initial Reveal" explores the road when its objective is created, and Devil's Playground's "Find Tosh's Missing Miners" explores a circle around a placed point and pings it (`VisExploreArea(p1, RegionCircle(PointFromId(443), 8.0), true, false)`, then `MinimapPing` at the point). Each Beat's `reveals` compiles to the same pair (`packages/core/src/triggers/beat-reveals.ts`): NativeLib's **Explore/Unexplore Area** (Explored, Do Not check cliff level, as Blizzard calls it) over a circle (**Convert Circle To Region**), then **Ping Minimap** at the circle's centre for 5 s in green (`Color(0, 100, 0)`, the commonest ping in the calibration maps). A reveal names its Zone and, as a rule, a point Anchor in that Zone chosen in advance (`{ "zoneId", "at", "radius" }`); without a `radius` the circle reaches the nearest edge of the Zone's ground. A bare Zone id explores the widest circle inside the ground the Zone owns (its polygon, less any Zone drawn after it over it), so it never spills onto a neighbour; where no circle fits, as in a sliver of a Zone, it explores the Zone's whole region. Either way the compile warns, with the point and radius it chose, so the author can place an Anchor. `{ "zoneId", "region": true }` explores the Zone's whole trigger region instead, its polygon's bounding rectangle unless the author drew one. Exploring shows the terrain and doodads under fog, not the units, and leaves ground the player already sees as it is. A Beat's explores run as it starts, so a trigger scene, which plays on the map, shows the ground, and its pings once the scenes cued then have handed back. The first Beat's explores come straight after its objectives in "Mission Start", and its pings at the end, after the scenes cued at mission start (a Cinematic's cleanup, a trigger scene, Transmissions, all of which wait). A later Beat's run in its "Beat - <title>" trigger: explores, then the Mechanics' beat actions and the scenes cued on its start, then the pings. If anything before the pings waits, a later Beat may start meanwhile, so the pings run only while the next Beat's trigger is still on; the ground stays explored, but the player isn't pointed back. Under #411's decision B a trigger scene is to ping the Beat it hands back to in its own cleanup instead, and the Beat's trigger then leaves those pings out. A Cinematic plays in a full-screen dialog over the world, so the mask doesn't show in it; LotV's `libVoiC_gf_PlayCinematic` plays its mission cinematics the same way with no `VisEnable`.

## What the game reads to open a map: DocumentHeader and MapInfo's hash

Two binary files must agree with the rest of a package, or the game won't open the map, even though the Editor may. `check` reads both on every Mission's package, Kept or compiled, and DocumentHeader on every mod's (`documentHeaderProblems` and `mapInfoHashProblems` in `packages/core/src/map/kept-checks.ts`). Either one would have caught why a Kept map stopped launching on 2026-11-07.

**DocumentHeader's dependencies.**
- **The game resolves a map's dependencies from DocumentHeader, not from DocumentInfo.** The Editor reads DocumentInfo's `<Dependencies>`, and an Editor save rewrites the header's list from it. So a hand edit or an imported map can leave the two apart, and the Editor shows nothing wrong.
- **What happened.** A Kept map's header still listed `file:Mods\<old name>.SC2Mod`, a mod from the map it was copied from. No mod by that name exists. Its DocumentInfo listed the Campaign Mod's `file:Mods\<Campaign Mod>.SC2Mod`. The game refused it: "The launch of this game makes reference to mod or map dependencies which are no longer available."
- **The fix.** An Editor resave fixes it. So does swapping only the header's string.
- **A mod's compile repairs it.** `compile-mod` compares the header's own list with the Blueprint's dependencies, not DocumentInfo's. So it rewrites a stale header even when DocumentInfo is already right. A Mission's compile leaves a Kept map's header as it is.
- **The layout** (version 8, every Editor-saved header read so far, and what `writeDocumentHeader` writes):
  - `H2CS`;
  - the version, signature, game version and build fields;
  - the dependency count, a u32 at byte 0x2C;
  - that many null-terminated strings;
  - the localized attributes.

  `readDocumentHeaderDependencies` (`packages/core/src/map/read-document-header.ts`) reads it.
- **What `check` reports.**
  - **Error:** a header dependency that DocumentInfo doesn't list and that isn't under the StarCraft II folder. It's found as the Kept checks find dependencies (`localDependencies`), and a game mod counts as found.
  - **Warning:** lists that otherwise differ.
  - **Not reported here:** a dependency both files list that isn't on disk. The dependency checks already warn about it, since the mod may be on another machine.
  - **Can't tell:** with no `sc2Path` in the machine config, a difference is only a warning.

**MapInfo's integrity hash.**
- **The game recomputes it.** It's the u64 at byte 8. The game recomputes it from MapInfo's own fields and refuses the file on a mismatch: "failed to open map", and the Editor logs "Unable to load 'MapInfo'".
- **The formula** is `mapInfoIntegrityHash` in `packages/core/src/terrain/write-map-info.ts`. It counts:
  - the width and height;
  - the description's length (the description is where the Editor writes the tileset id);
  - the bounds (the playable area, see Map bounds);
  - how many game options flags are set.

  So each flag set takes one off the hash.
- **What happened.** On a Kept map, Hide Errors During Test Document (`0x20`) was set by hand at byte 117, and the hash was left at `0x409FB` instead of `0x409FA`.
- **What `check` reports.** A stored hash the fields don't give is an error, with the hash to write.
- **Only MapInfo version 39 is checked.** That's the only version the formula is confirmed on. On 2026-11-07 it held for all 133 MapInfos at hand, every one version 39:
  - three Kept maps as the Editor saved them;
  - 30 of Blizzard's maps: the 21 ladder maps of the 2019 Season 3 pool and nine template and API maps;
  - about 100 maps `compile-map` wrote.

  The Wings of Liberty calibration maps aren't kept on disk, so they weren't read. Another version is skipped until the formula is confirmed on it.

## Test Document and MapScript.galaxy

Test Document runs the map's `MapScript.galaxy` as it stands. Only an Editor save rebuilds it from `Triggers`. Deleting `MapScript.galaxy` to make the Editor regenerate it from the Triggers file's Custom Script made Test Document report "Script load failed: Core: a required object could not be found", and nothing ran.

So any tool that adds Galaxy to a map writes it into both: `Triggers` (as a `CustomScript` element) and `MapScript.galaxy`. `withCustomScript` and `withCustomScriptInMapScript` in `packages/core/src/triggers/custom-script.ts` do both. The "Too many CAbil..." warnings Test Document shows on the same screen are harmless dependency noise. Map Properties > Hide Errors During Test Document (bit `0x20` of MapInfo's game options flags, which the header's integrity hash counts) stops Test Document printing that error log over the game; `compile-map` turns it on for every Mission, and leaves it off on Melee Maps, as Blizzard's ladder maps have it.

The game never reads `Triggers` at all ([data-loading-and-dependencies.md](./data-loading-and-dependencies.md)).

So a compile beside Kept triggers (ADR-0010) splices `MapScript.galaxy` rather than regenerating it: it keeps the Editor's script and adds each Compiled trigger's declaration, section and `_Init` call where the Editor puts a trigger that comes last in Root (`packages/core/src/triggers/splice-map-script.ts`). Whether an Editor save writes exactly that is what `npm run drift-test` checks. A Compiled trigger that waits on a Kept one calls NativeLib's Wait For Trigger (`TriggerWaitForTrigger(gt_<name>, true)`, which Blizzard's own campaign maps call with `false`) from a map-initialization trigger, so the Kept trigger's own XML and Galaxy stay untouched. Not yet confirmed in Test Document: that it returns once the Kept trigger's actions, Waits included, have run.

A held Kept trigger ([ADR-0014](../adr/0014-holding-a-kept-trigger-back.md)) is switched off the same way, by the compile: the Run Trigger that starts it (or its Map Initialization event) gets the Editor's `<Disabled/>` flag, the first line of the call's element, and its line comes out of `MapScript.galaxy`, since an Editor save leaves out a disabled call (`packages/core/src/triggers/kept-holds.ts`). A Compiled trigger then runs it with Run Trigger. Turning the Kept trigger off instead is believed to stop only its events, not a Kept caller's Run Trigger of it (not yet checked in Test Document). That a save of a map with a held call writes the same script is what `npm run drift-test` checks.

A Kept trigger is tuned the same way, without an Editor save: `tune_kept_triggers` rewrites its XML and renders its section of `MapScript.galaxy` from that XML as the Editor would (`packages/core/src/triggers/kept-trigger-galaxy.ts`). What the Editor writes, read off a Kept map's saved pair (Editor 5.0.17): a trigger's locals come under `// Variable Declarations`, then the automatic ones, then `// Variable Initialization` (only values that aren't Galaxy's defaults) and a blank line; an action function has `// Implementation` where a trigger has its `if (!runActions)` guard; a comment writes nothing and a disabled call is left out; a Switch stores its value in `auto<call id>_val` (typed from its cases' values), tests each case with `if`/`else if`, and always ends with an empty `else { }`; a global is `gv_` and a local or struct member `lv_` with the name's identifier started lower case, a function's parameter `lp_`, a function `gf_` and a trigger `gt_` with it unchanged; an animation name (`modelanim`) is stored quoted in the XML and written as stored; an ability command's index is its `ValueId` (0 when absent), not its `ValueTypeInfo`; a colour `255,0,0,0` (alpha, red, green, blue) is `Color(0.00, 0.00, 0.00)`. A library's own variables (`libCamp_gv_heroUnit.lv_hero`) are named in the library, which the map doesn't hold, so the tool learns them from the Editor's Galaxy for the trigger before the edit, and refuses when that Galaxy isn't what the XML gives.

## Cutscene terrain origin

The Cutscene Editor's **Import Terrain Data** places the map so that map point (64, 64) sits at the cutscene's 0,0,0, whatever the map's size. It is not the map's centre or the playable area's centre. Heights are unchanged (ground at 8 stays at 8). Verified with corner markers on a 96×144 map. The import isn't saved in the `.SC2Cutscene`; the Editor redoes it each time.

So a cutscene built over a map (the set on the map, cameras, backdrops and sky in the cutscene) writes map coordinates minus (64, 64) (`origin` in `packages/core/src/cutscene/write-shot-cutscene.ts`), and plays in game with `CutsceneCreateNew(file, Point(64, 64), 0, players, true)`. HotS plays its story cutscenes at Point(64, 64) for the same reason.

## Where a cutscene camera's eye sits

A cutscene orbit camera's `position` is the point it looks at. Its eye is `distance` back from that point against the view direction, which at yaw θ is (sin θ, −cos θ) in x and y: yaw 0 looks south (−y), 90 east (+x), 180 north (+y), as map cameras do. The eye's height is the position's z plus `heightOffset` plus `distance` · sin(pitch): the game adds `heightOffset` (one Campaign's bridge cameras sit 10-20 above the floor with offsets of about −10 to −20). `cameraEye` in `packages/core/src/cutscene/import-set.ts` computes it.

The sides were first worked out from the geometry of a Campaign's two-character conversation cutscene: its over-the-shoulder camera (position (−11.83, 4.51, 0), yaw −108.9, pitch 13.8, distance 14.36) puts the eye at (1.36, 0.00), just behind the first speaker's mark at (0.81, 0.35) and looking at the second's; the opposite sign would put it 25 cells off the set. So the file's solo camera on the first speaker (yaw 94.6) has its eye at (−0.06, 0.16), between the second speaker's mark and the first, facing them from the front.

Checked in game on a Mission's opening Cinematic (playtest 2026-10-31, frame at cinematic 25.5 s): an unattached close-up camera (position (3.47, 3.88, 11.41), yaw 103.5, pitch 5.0, distance 7.07, `heightOffset` −6.49) shows the hero, 1.24 tall, centred at 3.7 cells with the lens 0.82 above her feet, where this formula puts it (0.80). Measured on the other side of the target, the lens would be ten cells from her.

**A camera tied to a rig films from its own position.** One Campaign's cutscenes tie most of their cameras with a `CCutsceneNodeAttachment` (attach point `Ref_Hardpoint 01`, an offset such as z −0.2) to an invisible `MarineXPR` actor called "<camera> Movement". None of those rigs move, and the camera's own `position` is what places it, not the rig's position or the attach offset. Worked out from one of its Kept maps' opening cutscene, which plays correctly in that Campaign, not A/B-tested in game:

- A shoulder camera's own position is (−52.8, −3.4, 8.0) while its rig stands on the bridge at (−0.5, 14.3, 13.9). From its own position the eye lands half a cell behind its character's mark at her shoulder height, looking past her. From the rig it would sit 55 cells off the ship.
- A second shoulder camera from its own position frames the pilot at the helm over another character's shoulder. From the rig plus its offset (x −0.5) the lens sits 0.7 behind that character's back. The first build of a Cinematic filmed on that set used the rig and showed that: a nearly black frame.
- A close-up from its own position centres its character 1.5 cells off. From the rig she was cut off at the frame's edge behind a console, as the first build showed.

Across that Campaign's maps, 72 cameras ride a rig (64 on a `MarineXPR`, 6 on the mod's `MovingCameraTargetDummy`, 2 on a Wraith; at `Ref_Head` 40, `Ref_Hardpoint 01` 29), most of the rigs looping a Stand, some a Walk or a Flail at a slowed timeScale, the author's handheld camera. 38 of the cameras sit within half a cell of their rig, the others up to 123 cells off, and 13 rigs are keyed to move. A camera that sits away from its rig yet frames correctly suggests the rig carries the camera by how its point moves, not to the point; that's unchecked. A Cinematic's riding camera (`cameraAttach`) keeps its own target as its position, so it frames the same either way when the target is at the carrier (cinematography skill's BUILT-SETS.md, "Riders and riding cameras").

So `import-set` reads a camera's own position and ignores still rigs. Where the Editor saved a camera at its rig's exact position, the two agree. How a rig with keys carries its camera hasn't been seen: import keeps such a camera at its own position and marks it `moves`, so a Cinematic films it held there.

**A character can be hidden from the shots filmed where they stand.** A profile shot in one Campaign's cutscene is filmed from a character's place, so its file ties that character's actor (`CCutsceneNodeActiveShot`) only to the other cameras. `import-set` keeps those ties on the set's marks (`shots`; empty for a mark seen only through cameras it doesn't import), and a Cinematic gives a cast member on such a mark no copy in the shots through that set's other cameras (a compiled Cinematic copies each member into each shot it shows in, cinematography skill's BUILT-SETS.md).

A camera move (`to` in a shot list) animates property curves on the camera: position, distance, pitch, yaw, lens and focal depth (`MOVED` in `packages/core/src/cutscene/write-shot-cutscene.ts`). Height offset, roll and the vertical-lens flag aren't animated, so a Cinematic's checker rejects a move between two set cameras that differ in them.

## Story Mode is for Blizzard's maps only

`StoryMode` and `CampaignMode` are natives that only Blizzard's maps may call. In ours they log `Trigger Error in '<trigger>': Calling StoryMode is not authorized` (or `Script: Calling CampaignMode is not authorized`) on screen. NativeLib's Story Mode action, `libNtve_gf_StoryMode`, hides the UI and sets the screen mode itself before it calls the native, so the UI still hides (the research test `exp-cs-3-storymode` saw that and called it working), but the error shows. Seen in a Mission's playtest on 2026-10-31 from the opening Cinematic's trigger, and from a Campaign Mod library's own Galaxy calling `CampaignMode`.

A Cinematic's trigger (`packages/core/src/triggers/cinematic-triggers.ts`) and the `--play` loop use Cinematic Mode, which hides the game UI, then `UISetMode(players, c_uiModeFullscreen, 0)` to drop its letterbox bars. Cinematic Mode off puts the console back. Both also pause the map's Music and Ambience soundtracks with a fade before the cutscene plays (`SoundtrackPause(PlayerGroupAll(), <category>, true, true)`, NativeLib's Pause/Unpause Soundtrack), as `libVoiC_gf_PlayCinematic` does, and the one cleanup unpauses them with a fade, skipped or not. A Mission's playtest on 2026-11-03 heard the mission's ambience under its opening Cinematic before this. To check in game: no map ambience or music under a Cinematic, and both back after it ends and after a skip. If the ambience still plays, it isn't the Ambience soundtrack (a doodad's or the tileset's spatial sound would be on the Ambient sound channel, which a Cinematic's own set ambience may share), and that needs another look.

## Cutscene depth of field on the Mac

Physical depth of field (`doftype="2"`, an `fstop`) doesn't render in the Mac client: tested in game with shaders and post-processing at Ultra, f-stops 2 and 0.3 looked identical to no depth of field. The blur-amount style of HotS and of a custom Campaign's cutscenes (`doftype="0"`, `depthOfField` 1.0, `focalDepth` 5.5, `falloffEnd` 2, `falloffStartNear` 2, `fstop` 32) blurred the background clearly in the same shot. That Campaign's cutscenes use amounts of 0.1-0.5.

The Cutscene Editor's Director Window shows neither correctly: it draws depth of field smeared and posterised, while the same cutscene looks right in game.

## Cutscene walk animations need their built-in move speed

An actor on a `CCutsceneNodeFollowPath` stands still unless its `CCutsceneElementAnim` carries the animation's own length and movement speed: `priority="5" originalDuration originalMoveSpeed movespeed`. The Cutscene Editor fills these in from the model when an animation is picked. They differ by model: the Nova crowd models `SMX3_BGPeople_01`-`05` run Walk A for 2566 ms and `_06`-`10` for 2567 ms, both at speed 38, and one custom Campaign's cutscenes show speeds from 28 to 540. One model's values copied to another are a guess.

**How fast it goes (measured).** An actor on a follow path travels **`movespeed` ÷ 100 cells a second**, in game and in the Director Window alike, whatever the element's `originalMoveSpeed` and whatever the actor's scale. It was measured on a test map, `TestPathSpeed` (2026-11-01), straight 40-cell lanes with markers every 10 cells, recorded in game and in the Editor:

| Lane | Setup | Cells a second |
|---|---|---|
| A | Phoenix_Purifier, Walk 300 of 300 | 3.0 |
| B | Walk 600 of 300 | 6.1 |
| C | Walk 150 of 300 | 1.5 |
| D | Phoenix, the actor's own `movespeed` 300 with `useAnimMovespeed="0"` | 3.0 |
| E | a custom ship model at scale 0.15, the actor's `movespeed` 300 | 2.9 (Editor) |
| F | the ship model, `Stand` with `movespeed` 300 and no `originalMoveSpeed` or `originalDuration` | steady the whole way |
| G | the ship model, `Stand` 200, then a second element at 4 s with 600 | 2, then 6 from 4 s, stopping at the last marker |
| H | Phoenix, Walk 200, then a second element at 4 s with 600 | 2.0, then 6.3 |

A first run at scale 0.5 also gave 2.9 for 300, and 6 for 600 of 600. So:

- **Scale doesn't change the pace.** The ship at 0.15 kept the path's timing exactly, though on screen it moved about four times as many pixels a cell as the Phoenixes beside it: its mesh sits well above its origin, nearer the camera.
- **A change of pace is a further `CCutsceneElementAnim` on the actor's anim layer**, starting at the change with the new `movespeed`. It takes effect on the spot. The actor stops at the path's last marker.
- **A model whose anim records no move speed doesn't move on a walk element.** The ship model's Walk records 0 (`data/model-anims.json`), and an element with `movespeed` and `originalMoveSpeed` set left it still. An element with `movespeed` alone (on `Stand`, or whatever anim it plays, at priority 3) moves it, as a Kept map's planet and Hyperion are written. The actor-level `movespeed` with `useAnimMovespeed="0"` moves it too, but at one speed all through.

Core writes a Cinematic's steps to points this way (`packages/core/src/cutscene/follow-path.ts`): each moving copy gets a path through where it stands and each step's `to`, and each leg's anim element the `movespeed` that covers the leg in its step's time, at `100 ×` the cells a second. An eased step is four elements whose paces ramp down as its keyed curve would. A model whose anim records a move speed gets `priority 5`, `originalDuration`, `originalMoveSpeed` (its own) and the leg's `movespeed`; one whose anim records none gets the `movespeed` alone. A split loop goes on where it was with `startOffset` (ms into the anim, as a custom Campaign's cutscenes write it). A speaker's Talk layer carries the same `movespeed` while on the path, as one Campaign's hero carries his walk's 120 on the Unpowered layer over it. Not yet checked in game: whether a `movespeed` of 0 holds an actor still between legs, and whether the game takes the pace from the top-priority anim or from any.

A walk element with `originalMoveSpeed` also plays its walk cycle faster as its `movespeed` rises past the anim's own: not measured, but likely, since the Editor pairs the two to keep a walker's feet on the ground. A ship flown at 5000 of its Walk's 300 may flap or pulse much faster than its own pace.

**Where it's facing.** Blizzard's data suggested the rules below, and `TestPathFacing` (below) confirmed them in game on 2026-11-01:

- The actor faces along its path. Blizzard leaves a follower's own `rotation` and keyed rotations alone while it's on the path: Shakuras01Debrief's shuttles, Korhal Arrival's missiles and Vikings share one actor `rotation` across paths that run every way, and none of Blizzard's 530 path followers keys a rotation curve during its follow.
- `pathRotationOffset` on the `CCutsceneElementFollowPath` turns it off the path, in its own frame. Blizzard writes it to fix a model whose nose isn't +x: `(0, 90, 0)` stands Moebius Arrival's rockets (modelled nose up) along their paths; `(0, 0, −90)` on every Nova Covert Ops marine (`SMX3_Marine`, also on a custom Campaign's marine) and on `SMHyperionExteriorLow` in that Campaign's ship cutscene; `(0, 0, 180)` on Karax in Aiur02Debrief; `(0, 0, ±90)` on Purifier01Debrief's circling probes. 57 of 602 follow elements have one.
- A path marker's `rotation` (301 of 1,635 markers) looks like an Editor leftover: it copies the transform of the actor the marker was placed from, scale and all (Korhal Arrival's missile markers carry a Viking's 0.05 scale), and its values don't fit the direction of travel either as a world facing or as a turn off the path (Taldarim03Debrief's zealots, AiurComplete's Artanis).
- `alwaysPointUp="1"` (5 elements, on drifting asteroids and an invisible Kerrigan) presumably keeps the model upright.
- **The path pitches it.** With no offset, the actor points its nose down the path, heading and pitch both, on one long path and on a two-marker path alike: a space-approach Cinematic (2026-11-02) flew a ship's whole dive on one path with no facing, and it went nose first and smooth. (An earlier version's ship looked level only because its bank offset had the wrong sign.)
- A marker's `rotation`, the actor's own `rotation`, and rotation curves keyed on it or on an animation layer during the follow, all do nothing (`TestPathFacing` lanes D and E; `TestPathBanking`, 2026-11-02). Only the offset turns it. A model's Walk Left and Walk Right anims, where it has them, are the way to look banked on a path.

So core writes a step's `facing` as the follow's `pathRotationOffset`: heading off the path about z, a bank about the nose as x. A follow element holds one offset, so where the facing changes from one leg to the next a new element starts on a path of its own from that leg's start marker, and the actor turns there at once.

In game, on a level path, the offset's x is a bank about the nose and z a heading off the path, but **x banks the other way from an actor's rotation**: a negative x banks right, a positive x left (`TestPathBanking`, a test map, 2026-11-02). Core writes an own-frame `roll` reversed. The actor takes the new offset on the frame its follow element starts, so a bank can't ease in on a path. It steps, once per follow element.

**On a climb or dive the offset can't bank.** The engine turns the actor by the offset in the path's level frame, before the path's pitch: final = heading · offset · pitch. So an x offset on a diving path rolls the ship about its level nose, and the path's pitch then swings that nose off the path. `TestBankOrder` (from `make-bank-order.py`, 2026-11-02) flew ships down a 40° dive beside one keyed to 40° down and banked 50°: the one with no offset pointed exactly where the keyed one did; the one with (50, 0, 0) turned its nose toward the camera and dived shallower, which is the "nose pulling up" of Space Approach 13. Adding z either way, and (±37, ±10, ±30), the triples that should bank about the pitched nose in that order, all swung the nose off too, live in the Editor. None matched. So a ship banks only on a level path; a dive flies its path with no bank (Space Approach 15), or is keyed when it must bank (a shot's `keyed`). Space Approach 10 and 11, which put the pitch in the offset as well, were worse, and `TestPathOffsets` (eleven Euler orders and frames) matched nothing for the same reason.

**Unevenly spaced markers swing back.** The engine's curve through markers spaced very unevenly overshoots the short leg: the Space Approach's warp-in, a 7.1-cell leg, then 0.65 cells, then 50, on one path, scooted backwards for a moment and then went on (approach 13). Each leg its own straight path fixed it (approach 14). The dive's legs, each up to 1.3 times the one before, flew clean on one path. Core starts a new path at a leg more than three times longer or shorter than the one before (`UNEVEN` in `follow-path.ts`); the threshold isn't measured in game. On a straight line a uniform Catmull-Rom curve runs backwards on a leg when the tangent at either end, half the two legs beside that marker, is over three times the leg, which takes a neighbour about five times longer; 0.65 cells before 50 is far past that, and 1.3 nowhere near. Dives cut into 75 ms legs, each its own path, also flipped out of pose for a single frame now and then (approaches 10 and 11); 333 ms legs on `TestPathBanking` didn't.

**The path's curve.** The Editor draws a follow path as a curve through its markers, and a few of Blizzard's markers set `curveInType`/`curveOutType` (2). Which curve the engine flies isn't recorded, but it isn't the straight lines: on `TestPathFacing`'s lane A, a Phoenix on one path through a bend turned its heading gradually through the second before the bend's marker. Core measures each leg along a curve through the markers that doesn't overshoot (a Hermite leg whose tangent at each marker runs from the marker before to the one after, as long as the leg): markers in a line, however spaced, give the straight line, and a bend comes out a little longer than its chord. The engine's own curve does swing past a short leg beside a long one, as a uniform Catmull-Rom curve would (see Unevenly spaced markers swing back, above), so core keeps such legs on paths of their own. If the engine flies the straight lines, an actor on a bend runs early by the difference, a few percent on a sharp one.

**`TestPathFacing`** (a test map compiled from a shot list, its lanes D and E edited by hand): five Phoenixes on 40-cell lanes under a camera 45 cells off at pitch 60, flying 1-9 s. A banks 45° about its nose on its second leg only (an offset on a follow of its own); B flies with a heading 90° off its path all the way; C climbs and dives 6 cells over its legs with no facing; D flies west on one path whose middle marker has `rotation` (45, 0, 0) and the others (0, 0, 0); E flies west with a `rotationX` curve 0 → 45 → 0 over 3-7 s. Recorded in game on 2026-11-01:
- A banked right on the frame its second leg started, and levelled on the frame it ended.
- B flew sideways the whole way.
- C's change of shape is too slight to tell a pitch from the change in its distance to the camera.
- D and E flew level and nose first, identical to each other throughout.

The recording ran about 0.3 s behind the cutscene clock: D and E left their marks at about 0.7 s on the recording.

`npm run model-anims -- <model id>...` (`packages/core/src/cli/model-anims.ts`) resolves each model's file through ModelData, has the Host Adapter's `model.export` save it with its RequiredAnims merged in, reads its SEQS records (`packages/core/src/catalog/m3-sequences.ts`), and records them in `packages/core/data/model-anims.json`. Generators look clips up there by model and name, and fail when a model lacks the animation.

Many CModels name no file of their own: they inherit a template's, which the game fills in for each model. Core's `Unit` default has `<Model value="Assets\##Prefix####Race##\##id##\##id##.m3"/>` with `<?token id="Race" value="Neutral"?>` and `<?token id="Prefix" value="Units\"?>`; `Doodad`'s is `Assets\Doodads\##id##\##id##.m3`. `##id##` is the model's own id, not the template's or its parent's. Any other token takes the nearest value up the parents: an attribute on an entry (`<CModel id="Zealot_Purifier_Collection" parent="Unit" Race="Protoss">`) or a `<?token?>` on a template (`SentryBase` sets Race to Protoss). So `Sentry_Purifier` → `Sentry_Purifier_Collection` → `SentryBase` → `Unit` is `Assets/Units/Protoss/Sentry_Purifier/Sentry_Purifier.m3`. `modelFile` (`packages/core/src/catalog/model-files.ts`) fills them in this way. A model with a `VariationCount` above 1 has no file at that path: its variations are numbered beside it, `<name>_00.m3`, `<name>_01.m3` and on (`Purifier_Containers` has three). `model-anims` records the first, and a single-variation model is tried at both names.

The game data `model-anims` reads is what a Mission on Void Story with the Nova Covert Ops assets loads, in load order: the race mods (core, liberty, swarm, void .sc2mod) and `novastoryassets.sc2mod`, then the campaign mods Void Story builds on, each on the one before (`liberty`, `swarm`, `void` .sc2campaign), then the story mods (`swarmstory`, `voidstory`). The campaign mods hold each campaign's own models, such as the star map's planet icons (`PlanetIconTyphon` is in `liberty.sc2campaign`, a child of core's `PlanetIcons` template), and their own variants of melee models, which win over the race mods' (`Adept` is the Purifier Adept from `void.sc2campaign`). `libertystory.sc2campaign` isn't one of them.

Blizzard's cutscenes time an actor's life, look and lights on the same nodes core writes (a Kept map's warp-in cutscene, 2026-11-01). An actor exists only within its `CCutsceneElementObject`'s `start` and `duration` (no `lockedToEnd` when it ends early). A `CCutsceneNodePropertyValue` under it keys `opacity` (with the actor's `opacity` attribute as its value before the first key), `scaleX`, `scaleY` and `scaleZ` (absolute, so a stretch is non-uniform), and under a light `colorMultiplier` with `specularColorMultiplier` beside it. Their `CCutsceneElementPropertyCurve` keys are those of position curves: absolute `time` and `start` in ms, Bezier handles (`curveInValue`, `curveOutValue`) a third of the way to the neighbouring keys, curve type 3; some of Blizzard's scale keys use type 7. A camera's `shadowClip` is its shadow distance: 75 on 2,059 of Blizzard's cameras, 50 on 75, and 10, 5, 100 or 120 on a few. No actor attribute in Blizzard's 336 cutscenes switches its shadow casting: `shadowBox` (0 on about 15,000 actors, 1 on 12) isn't one, and ModelData has no such flag.

A Set's piece in a Cinematic loops its Stand (or its `anim`) with `originalDuration` from this catalog, as a cast member's does. Without the length an animated model (a unit, a fire, a shield dome) stands frozen in its first frame.

The crowd models are Nova's `SMX3_BGPeople_01`-`10`, defined in the Liberty mod. Blizzard's "Civilian01/02" are actor names, not models.

A mod's own models aren't in the game's ModelData, and their files aren't in the game's storage. `model-anims --mod <SC2Mod folder>` reads the mod's CModels (from every GameData catalog, since heroes keep theirs in files like `Heroes/<Hero>Data.xml`) and reads a model the mod holds straight from its `Base.SC2Assets`, merging the SEQS of its RequiredAnims `.m3a` files the mod holds; any it doesn't hold are left out, even ones in the game. A model the mod doesn't hold goes through `model.export` as before, with the RequiredAnims the viewer finds for it in the game's own data, not the mod's. A file in neither is missing in game too: one Campaign Mod's custom character names a facial-animation `.m3a` that neither has, so its plain `Talk`s, seen in that Campaign's older cutscenes, aren't there; its model has only `Talk Victory` ones.

SEQS records are 96 bytes at version 1 and 92 at version 2, and a block is padded to 16 bytes, so the size can't be told from where the next block starts: a Campaign Mod's custom character model (v2, 7 records) read as garbage that way.

## What an Editor save rewrites in Objects

A save rewrites every placed object, even the ones the author didn't touch. Seen on a Kept map (2026-11-10), where only 7 of its 571 compiled objects came back byte for byte:

- **Layout.** Attributes come back in the Editor's own order (`Pitch` and `Roll` after `Type`, for instance). Flags are reordered and children re-indented.
- **Defaults are dropped.** `Variation="0"` and `Rotation="0"` are left out.
- **Every doodad gets `<Flag Index="HeightAbsolute" Value="1"/>`.** Its z doesn't change: a compiled doodad's z is already absolute.
- **Numbers are re-rounded.** A scale or angle loses its last digit (`1.0581` → `1.058`, `0.6109` → `0.6108`), and z moves by up to 0.0002.

So a compiled object is checked by what it says, not by its text. `normalObject` in `packages/core/src/map/read-objects-xml.ts` is the normal form, and `sameObject` in `editor-changes.ts` compares two of them within sync's tolerances.

## Model footprints from m3 bounds

`npm run model-footprints -- [--mod <SC2Mod folder>]... <model id>...` (`packages/core/src/cli/model-footprints.ts`) finds and exports each model as `model-anims` does and records its bounds and materials in `packages/core/data/model-footprints.json` (`packages/core/src/catalog/m3-footprint.ts`). `--print [--variation <n>]` only reads and prints, leaving that file as it is, and takes a doodad id too, whose model `data/doodad-models.json` gives; each line's size is w × d × h, the bounds' x × y × z extents. The MD34 header's model reference (offset 12) points at the MODL record. In every MODL version the game ships (23-29) its bounds sit at offset 136 (min x, y, z, max x, y, z, radius, as floats), its MATM material references at 300 and its standard materials (MAT_) at 312; each MATM is a type (1 standard, 2 displacement, 3 composite, 4 terrain, 5 volume, 7 creep, 8 volume noise, 9 splat terrain bake, 11 lens flare) and an index into that type's array. A MAT_'s blend mode is at offset 20 (0 opaque, 1 blend, 2 add, 3 alpha add, 4 mod, 5 mod 2x); its record is 268 bytes at version 15, 280 at 16-18, 340 at 19 and 352 at 20.

What a desert temple set's models read as (2026-11-01): ground plates (`Shakuras_Temple_PlatesGiant`, 10.2 x 13.5 x 1.0, opaque with a splat terrain bake), `Purifier_Tarmac` (5.0 x 5.7 x 0.02), curbs and trims are opaque and flat; the sand drifts (`PurificationDesert_SandDrift`, `Shakuras_SandDriftsLarge`, 6.8 x 5.5 x 1.0) have one blending material; `Fog_Hazy` blends but is a 15-cell cube; `GroundCracks` has only a terrain material; particle-only models (`SmokeEmbersMedium`) have zero bounds, and a backdrop card (`SMX2_Aiur1_Debrief_MountainFog`) none in y. How `check` reads flat pieces and see-through decals from these is in `packages/core/src/cutscene/set-checks.ts`.

## Which doodad footprints block ground

A doodad blocks ground where its CFootprint's Place layer has a cell that is GroundNoSpawn and not BoostCliff. The extractor in `@team-antioch/sc2-asset-catalog` (`catalog/extract-doodads.js`; `npm run extract-catalog` writes core's copy) reads that rule from SC2GameData into `blocksGround` in `data/doodads.json`. The facts below come from the game's data (2026-11-12). The in-game checks are listed in the PR that closes #690.

- **Default set:** the default CFootprint's one set, set 0, is character `x`, and it makes the cell GroundNoSpawn and NoBuild. A footprint changes it by `<Sets index="0">` or `<Sets Character="x">`, and adds other characters with their own sets. Fences, debris and the Unbuildable plates set GroundNoSpawn 0 on `x`, so they don't block.
- **Walkable decks:** BoostCliff raises the ground to a doodad's deck, so a BoostCliff cell is walkable even when it stays GroundNoSpawn. Every catwalk, platform and bridge sets it on set 0, for example the Umojan lab catwalks, IceBridge, MarSaraBridge and ZerusLogBridge.
- **No collision:** the `NoCollision` footprints (`Footprint2x2NoCollision`, `Footprint3x3NoCollision`) remove only their Check layer's set, so they can overlap other things when placed. Their Place layer still blocks.
- **Patches by later packages:** a later package patches an earlier package's footprint by index. `<Rows index="n">` replaces one row and `<Sets index="n">` changes one set; whatever the later package leaves out stays.
  - swarm.sc2campaign patches liberty.sc2campaign's footprints by row this way. It also gives `ShrubFootprint1x1`/`2x2` (curtains) and `FootprintDoodad1x1BlockLOS` (most trees) GroundNoSpawn on their `o` set.
  - So curtains and those trees block ground in a map that loads the Swarm campaign, as the Void campaign does, but not in one that loads only the base mods.
  - `data/doodads.json` takes every package in load order, so it gives the campaign verdict.

## Hide the map behind a Cinematic

A cutscene in a full-screen dialog is drawn above the world, but a set's windows and open sides show what the map renders behind it: in a Mission's playtest (2026-11-01) the mission's terrain showed through a ship bridge's viewports. NativeLib's **Show/Hide Environment** action (`EnvironmentShow(type, show)`, preset `c_environmentAll`: terrain, water, doodads and the backgrounds) turns that off. It is global state that outlasts the cutscene, so whatever hides it shows it again afterwards. One Campaign Mod's library start-cutscene function does exactly this when its `HideEnvironment` flag is set (most of its story cutscenes), and its end-cutscene function shows it again. Units aren't part of the environment, and they show through too: in a Mission's fortress test (2026-11-01) the map's placed hero floated in a built set's sky. That library's start-cutscene function, with its `HideandPauseUnits` flag, goes through every unit on the map: one not paused already (`libNtve_gf_UnitIsPaused`) goes into a "paused" unit group and is paused (`libNtve_gf_PauseUnit`), and one not hidden already (`libNtve_gf_UnitIsHidden`) into a "hidden" group and is hidden (`libNtve_gf_ShowHideUnit`). Its end-cutscene function unpauses and shows just those two groups, so a unit the mission had hidden stays hidden. Blizzard's LotV mission inserts (`libVoiC_gf_CampaignPlayCutscene2` in `paiur05`, `pulnar02`) do neither: they fade the screen and play sets that fill the frame. A cued Cinematic's trigger ("Cinematic <Id>") hides the environment and pauses and hides the units that library's way before the cutscene plays (NativeLib's Pick Each Unit In Unit Group over Units In Region Matching Conditions, entire map, any player, excluding dead), and its one cleanup shows the environment and puts back the units it changed. A unit created while it plays (a spawn, a wave, a mission trigger's unit) would show through too: That Campaign turns on its "Unit Spawned During Cutscene" triggers (NativeLib's **Unit Is Created** event, any creator) for the length of a cutscene, and the cue's "Cinematic <Id> Spawns" trigger, on from the opening sweep to the cleanup, pauses and hides each created unit the same way, into the same groups. A trained or built unit needs no trigger of its own here, since its producer is paused. No event reports a unit being hidden or paused, so the cleanup can't tell a hide or pause of the mission's from one of its own: a mission trigger that hides or pauses a unit during playback takes it out of the Cinematic's group (`CinematicPlayback.leave`), and the cleanup then leaves it as the mission set it. Not yet checked in game whether Unit Is Created fires for `UnitCreate` before the creating trigger's next action; Blizzard's ZLab cinematics and that Campaign rely on it firing for trigger-made units. A Cinematic's `--play` loop hides the environment and pauses and hides the units once for the session. A Blueprint's Cinematic entry with `"environment": "shown"` leaves the environment showing in both, for a Cinematic filmed on the map's own ground, as Kept cutscenes played with `HideAllEnvironment` false were. Such a Cinematic plays in the world, with `CutsceneCreateNew(file, Point(64, 64), 0, players, false)`, not in a dialog: a Kept city map's street scene in a dialog with the environment shown (2026-11-07) drew the set over the ground where the mission's stealth section starts, not over the street its Kept coordinates put it on. Not yet checked in game: that the world path lines it up with the street. Played in the world, a cutscene's closing Fade elements leave the screen black after `CutsceneStop`, on the cutscene's own fade layer, which a later `CinematicFade` doesn't lift: that map's stealth opening faded in over a world that stayed black (alley 4, 2026-11-07). So the in-world cleanup puts up an instant `CinematicFade` black, clears the cutscene's layer with `CutsceneFade(true, 0, black, 100, players, false)` (a Campaign library fades it at 100), and fades back in over 1 s. A Kept trigger held until the Cinematic's scene (ADR-0014) starts as the Kept map started it, so the cleanup instead leaves the screen black and Cinematic Mode on for it, as a run handing on to a trigger scene does. Not yet checked in game: that `CutsceneFade` clears the leftover black.

## Speaking actors in a cutscene

Blizzard's story scenes and a custom Campaign's conversation scenes play each line twice over: on the Director's `CCutsceneNodeConversationDriver` (`lineId`), and on the speaking actor as a `CCutsceneElementConversation` in a `CCutsceneNodeConversation` (`conversationLink`, `conversationLine`, `soundLink`, `facialGroup`, `facialAnim`, `duration` and `assetDuration` the sound's length). In the 99 Blizzard files with both, 1,009 of 1,023 actor elements repeat a driver line. Blizzard's `facialGroup` and `facialAnim` are the sound's FaceFX animation, named like the sound in 1,011 of them; The custom Campaign's are mostly empty, as its sounds have none. A Cinematic writes both, with the facial fields left empty as its CSounds' are.

**The driver alone plays no sound.** A line with only its driver entry is silent in game: a Mission's opening lost the five of its 16 lines whose speaker had no actor in the shot (a voice-over on the temple shots, and two speakers on the bridge's display; playtest 2026-11-02). All 1,846 conversation elements in the 407 Blizzard and custom-Campaign cutscene files sit on an actor, and a voice off screen sits on one whose `modelLink` is `Invisible`, named for the speaker (62 of them, such as Reigel's in `SMX3_Cutscene_MP01_040`). So a Cinematic says such a line on an `Invisible` actor of its own in the shot where it starts, at the shot camera's target, and the Equivalence Check leaves those voice actors out of its `actors` and `anims`.

The body animation is separate from the line. 548 of 629 `Talk` clips on Blizzard's speaking actors sit on an animation layer of their own over a full-length `Stand` on another layer, at priority 4 over Stand's 3, with `blendTime`/`blendOutTime` mostly 300-500 ms; when a Talk ends, the Stand under it shows again. A custom Campaign's conversation cutscene alternates `Stand B` and `Talk B 0n` on one layer instead. Story models name their Talks in families: plain (`Talk`, `Talk 01`), `B` (the Redux hero models have only `Talk B 01`-`03` and `Stand B`), `Angry`, `Victory`. Not yet checked in game for a Cinematic.

A line's subtitle is labelled from its CSound, not from the actor or its model. Each sound asset's `Speaker` field is a string key: Blizzard's Wings of Liberty `Campaign` template writes `ConversationState/Characters/<character>`, its later `VO` template `Character/Name/<character>` (core `SoundData.xml`). A custom Campaign's conversation sounds use the first, and its `ConversationStrings.txt` gives those keys first names (`CharPilot=Ana`, say). A playtest showed the actor element's subtitles as those first names, not the model's or actor's full name, so the label is that string. A map's own string for the key replaces a dependency's, so the compiler writes `ConversationState/Characters/<characterId>` in the map's ConversationStrings as the speaker's Transmission name: subtitles then say what Transmissions say. Not yet checked whether the Editor keeps those strings when it saves a map with no `Characters` conversation state.

## How a cutscene's Sound node stops and fades

A `CCutsceneNodeSound` plays while its one `CCutsceneElementObject` lives, from `start` for `duration`: in Blizzard's 336 story and mod cutscene files (Wings of Liberty, Heart of the Swarm and Legacy of the Void campaigns and mods, Nova), each of the 3,658 sound nodes has exactly one, and no other element kind. A looping sound (`mode="4294967295"`) stops when its lifetime does, so a sound's end is its lifetime's end; 467 lifetimes are shorter than the sound's `assetDuration`.

A fade is a volume curve on the node: a `CCutsceneNodePropertyValue` named `Property - Volume`, `propertyName="volumeScale"`, keyed at absolute cutscene times like a camera's curves. 299 nodes carry one, 291 of them with Linear tangents (type 3), and 83 end at 0, a fade out. Those fades mostly take 0.2 to 7 s (median 1.9 s) from the key before the zero, and the zero key sits at or before the lifetime's end in 77 of the 83; the typical shape is a key at the volume where the sound starts, one where the fade begins, and 0 at its end (`zScripted_ZAdjutantIntro`: 0.7 at 59.7 s, 0.7 at 66.5 s, 0 at 69.9 s, the lifetime's end). The curve's values look like the volume itself rather than a factor on the node's `volumeScale` attribute: 36 nodes have `volumeScale="0"` and a curve that rises above 0, which would be silent otherwise. A Cinematic writes a cue's end and fade, and its sets' ambience runs, this way (cinematography skill, BUILT-SETS.md, "Sounds, look-ats and attached lamps"). Not yet heard in game.

## A cutscene's events: bookmarks and the End Scene marker

A running cutscene tells triggers when it reaches a **bookmark** or its **End Scene marker**. Both are Galaxy trigger events (`natives.galaxy`, Blizzard's core mod), and Blizzard uses them: Nova 05 spawns a bonus-objective unit on a `SpawnBlightbringer` bookmark, Nova's story hub drives TV screens and timestamps with about 25 (`ShowTimeStamp`, `TVOff`, `EchoOn`), HotS uses `Stop Scene` and `Fade Start`, and Starcoop's UI cutscenes use `2DBirth` and `2DDeath`.

```
TriggerAddEventCutsceneBookmarkFired(trigger, cutscene, "name")   // EventCutsceneBookmark() reads the name
TriggerAddEventCutsceneEndSceneFired(trigger, cutscene)
TriggerAddEventCutsceneConversationLine(trigger, cutscene, line)   // not tested here
```

`cutscene` is one `CutsceneCreateNew` handle, or `c_cutsceneNone` for any cutscene; `EventCutsceneId()` says which one fired. A bookmark is a `CCutsceneElementBookmark` (`start` in ms, `bookmarkName`, optionally `jumpToBookmarkWhenHit` to loop) under a `CCutsceneNodeBookmark` on the Director. The End Scene marker is a `CCutsceneElementEndScene` under the Director's `CCutsceneNodeEndScene`, the one `WaitForCutsceneToEnd` waits on, and the one `shotCutscene` writes with `bookends`. The shot-list writer writes bookmarks from a shot list's `bookmarks` (`{ name, atMs }`, refused when the name is empty or the time is outside the timeline), and the trigger catalog has the two events (`cutsceneBookmarkFired`, `cutsceneEndSceneFired`) with their responses (`eventCutsceneId`, `eventCutsceneBookmark`) and the `anyCutscene` preset, ids from `NativeLib.TriggerLib`. The conversation-line event has no GUI function, so it's Galaxy only. A named string parameter (a bookmark's name) is written as the Editor saves one, with its `Value`. A Cinematic's shot list declares `bookmarks` (`{ name, line | atMs }`), written as `<Cinematic id>/<name>`, and a Mission cues a scene on one with a `cinematicBookmark` cue (`{ cinematicId, bookmark, onSkip }`). **Prefer a `scenePlayed` cue, which fires however the Cinematic ends, and keep triggers out of cutscenes where you can:** a bookmark isn't heard on a skip, so by default (`onSkip: "skip"`) a player who skips never gets what the cue plays, and a Kept hold waiting on one would stall the Mission. `onSkip: "fire"` has the Cinematic's cleanup run the cue, last, if the skip passed over it; it then runs late, and missed cues run in the order their cues are listed. `check` warns about every such cue, and refuses one on a bookmark its Cinematic doesn't declare. A bookmark cue is untested in game; the engine behaviour above is tested.

Tested in game 2026-11-14 (5.0.17, Test Document; map `Exp-Cs-Bookmarks-Runs2` in the Workspace's `trigger-test/output/`, a 12 s cutscene with bookmarks `BM1` 1.5 s, `BM2` 4.5 s, `BM3` 7.5 s and End Scene at 12 s; triggers on `c_cutsceneNone`; times are real seconds after the run's start):

| Case | What fired |
|---|---|
| `CutsceneCreateNew(..., autoPlay true)`, left to end | `BM1` 1.5, `BM2` 4.4, `BM3` 7.4, End Scene 11.8, once each, in order |
| `autoPlay false`, then `CutscenePlay` 3 s later | nothing before the play; then `BM1` 4.5, `BM2` 7.4, `BM3` 10.3, End Scene 14.8. A trigger registered for that handle only (after the create) also fired for `BM2` |
| `CutsceneStop` at 3.0 s (after `BM1`) | **End Scene fired at once (3.1 s)**; `BM2` and `BM3` never fired in the 10 s after |
| `CutsceneSetTime(8000)` at 1.0 s (past all three) | no bookmark fired for the jump, and no End Scene |
| then `CutsceneGoToBookmark("BM2")` at 3.1 s | `BM2` did **not** fire on the jump to it; `BM3` fired 2.9 s later and End Scene at 10.4 s |
| the Escape skip (`TriggerSkippableBegin` then `WaitForCutsceneToEnd`, then `CutsceneStop`), Escape at about 4 s | the wait returned at 4.2 s, then End Scene fired at 4.2 s with the stop |
| a trigger registered with an empty bookmark name | never fired: `""` is not a wildcard |

So a trigger that hangs off **End Scene** runs on a natural end, a `CutsceneStop` and a skip alike, which suits cleanup. A trigger that hangs off a **bookmark** runs only when playback passes it: a stop, a skip, a time jump or a jump to that bookmark won't run it, so whatever it does must not be needed afterwards (or the skip's cleanup must do it).

Not tested: whether a registration for one handle ignores other cutscenes' bookmarks of the same name, whether two bookmarks may share a name, the conversation-line event, how the Cutscene Editor presents bookmarks to the author, and what fires after the Escape skip in the 14 s that followed (the recording ended first).

## Render to texture

A cutscene puts live pictures on a screen by render-to-texture (RTT): a camera's view is drawn into a numbered channel, and any model whose material reads that channel shows it. Read from the corpus (51 of the 407 Blizzard and custom-Campaign cutscene files use it, 108 elements) and from the models' m3 files, 2026-11-02, and the catalog's displays from their m3s, 2026-11-23.

**The nodes.** A `CCutsceneNodeRTTChannel` (`RTTChannel`: 0 in 46 nodes, 6 in 23, 1 and 2 once each) holds `CCutsceneElementRTTChannel`s: `start`, `duration`, `objectGUID`, `cameraIndex` (0 in 97, 1 in 9, 2 in 2), and in 17 an `aspectRatio` (1.13 to 1.77, on portrait and Nova screen feeds). The node has no lifetime of its own. Blizzard often links an element's ends to other elements (`startLinkGuid`, `endLinkGuid`); A custom Campaign's cutscenes write plain times.

**What it films.** Every element's `objectGUID` is an actor, never a `CCutsceneNodeCamera`: the channel shows the camera inside that actor's model, its m3 CAM_ record at `cameraIndex`, wherever the actor stands. The Editor's menus speak of "Add RTT Camera" and "Change RTT Camera" (EditorStrings), but no file points an element at a camera node. The camera-carrying models, read from their m3s (a camera's bone holds its place in the model's frame; turned 90° about x, it looks level along the model's +y):

| Model | Camera (index) | Eye in the model's frame | Lens | Far clip |
|---|---|---|---|---|
| `SMX2_Shakuras01Debrief_Communicator` | `SMC2_Bridge_Communicator_Camera` (0) | (0, −1.952, −28.731) | 43.6° | 20 |
| `SMX2_Bridge_Communicator` | the same (0) | (0, −1.952, −28.731) | 43.6° | 10 |
| `SMX3_Nova_Ship_Bridge_MainScreen` | `SC2CameraRTT` (0) | (0.032, −5.542, 5.388) | 50° | 200 |
| `SMX1_KorhalInvasionMonitor` | `Camera_Basic` (0) | (0, −0.012, 1.55) | 39.6° | 40 |
| `MohandarPortrait` | `CameraPortrait` (0), `CameraAvatatr` (1) | turned, framing the head | 38.5°, 24.3° | 6.05 |

The view direction was checked against Blizzard's own framings: the communicator's eye is 0.96 cells behind Vorazun and 0.72 above her origin, looking at her (`Convo_Communicator_Shakuras`), as it is behind Raynor (`Convo_Communicator_Korhal`), and a custom Campaign's communicator camera, 29 cells above its character, films him from about 2 cells off, half a cell above his origin. The Nova main screen placed as `..._RTT_Valerian` in `SMX3_Cutscene_MP02_040` has its eye 0.56 cells behind Valerian, whose look-at turns him back toward it. A communicator's far clip of 10 to 20 cells suits a close-up and nothing further; the main screen's 200 is the longest found. Whether the engine keeps to a model camera's far clip in an RTT view isn't checked.

**Which models show a channel.** An m3 material layer (LAYR) names the channel it reads, its `video_channel` (m3addon's structures.xml): an int32 at offset 92 up to LAYR version 23, and at 100 from version 24, which adds two noise floats before it; −1 for none. Core reads it (`readM3DisplayChannels`, `packages/core/src/catalog/m3-display-channels.ts`) and records every model in the set catalog in `packages/core/data/display-channels.json` (`npm run display-channels -- --catalog-sets`). `SMHyperionBridgeBriefingCenter`, the Hyperion's briefing holo, has three layers reading channels 0, 1 and 2, each with `video_static.ogv` as its texture. `SMHyperionBridgeBriefing`, the table under it, reads none. The communicators read 0, and the Nova main screen and `SMX3_MP03_020_Screens_RTT` read 6.

**Switching and no feed.** What a channel shows changes with a new element pointing at another actor: a Kept map's opening cutscene feeds channel 0 from one character's communicator (0-4.4 s, 5.9-58.1 s), then another's and the bridge's in turn from 190 s. Between elements the channel isn't fed, and the layer shows its own texture: on the holo, static. It also plays the holo's Death at 88.9 s (it goes dark) and its Birth at 182.4 s (it comes back on) on the screen actors themselves.

**It works in a custom map.** A custom Campaign's opening Cinematic, compiled into a Mission's Map Package that depends only on its Campaign Mod, played shot feeds in game on 2026-11-02 and 2026-11-03: portrait feeds on the Hyperion briefing holo (a call set of the speaker's own) played on time, and set feeds through the rig showed once their sets had bright lamps tied to the fed cameras, but made lines start late on High graphics (the cinematography skill's BUILT-SETS.md, "A display's live picture"). The cutscene's RTT channel is the only way onto a model's surface: Galaxy's `c_triggerRenderTypeRTT` (natives.galaxy) is a render type for dialog controls and portraits, drawn in the UI, not on a model.

**Blizzard films the far side beside the display.** In LotV's `Cutscene_KorhalArrival` the Spear of Adun's communicator (`SMX2_Bridge_Communicator`, at the origin in `SCENE B/SET/BRIDGE`) is both the display and the camera: its own screen reads channel 0, and channel 0's one element films through its own camera (index 0, all through the file), whose eye sits 28.7 cells below it. There, in `SCENE B/RAYNOR_SCREEN`, stand Raynor (`SMRaynorMarine`, at (0, −1.52, −29.48)), a miniature Hyperion bridge behind him (`SMHyperionBridgeStage1Set`) and `SMX2_KorhalArrival_SkyShieldScreen`, inside the communicator camera's 10-cell far clip. So the set catalog's `raynor-screen` is the filmed side, a studio with no display: none of its three models reads a channel. `SMX3_Cutscene_MP01_040` (the catalog's `monitors`) does the other thing: channel 6 is fed in turn from five models that carry a camera and nothing to watch (`..._Room_ScreenDOMLogo`, `..._ScreenUIElements_00` to `_02`, `..._ScreenHologram`, cameras 0 and 1), and shows on five display boards, `SMX3_Cutscene_MP01_040_Room11` to `Room15`, all reading 6, so one feed lights all five.

**The displays in the catalog's sets**, read from the m3s of every model in the set catalog (`display-channels.json`: 696 of its 738 CModels; the rest have no ModelData entry or the viewer couldn't open them) (exported with WhiteoutFlakes `--save-m3`, 2026-11-23; LAYR versions 22, 25 and 26). The SMX1 models' (version 25) show none: the Korhal invasion monitor only carries a camera.

| Channel | Display model | Sets |
|---|---|---|
| 0, 1, 2 | `SMHyperionBridgeBriefingCenter` (`SM_HyperionBridgeBriefing_01.m3`) | `zbriefingspace01-set` |
| 0 | `SMX2_Bridge_Communicator`, `SMX2_Shakuras01Debrief_Communicator`, `SMX2_Bridge02` | `bridge-cutscene-aiur06briefing` |
| 0 | `SMHyperionBridgeStage1CenterConsoleHS` (`SM_HyperionBridgeCommConsole.m3`) | `bridge-mainmenuhorner` |
| 0 | `SMX3MarSaraBarTV` | `mainmenu-marsarabar-set` |
| 0 | `SMX3_PsionMeter_Impact` | `shot-16`, `shot-17-planetview`, `shot-18-hole` |
| 0 | `SMX3_Cutscene_MP01_30_NewsTV` | `e-valerian-bridge` |
| 6 | `SMX3_Nova_Ship_Bridge_MainScreen` | `nova-bridge`, `d-nova-bridge`, `bridge-smx3-cutscene-mp02-020`, `viking-interior` |
| 6 | `SMX3_Cutscene_MP01_040_Room11` to `Room15` | `monitors` |
| 6 | `SMX3_MP03_020_Screens_RTT` | `courtyard-smx3-cutscene-mp03-020` |
| 6 | `SMX3_Cutscene_MP01_010_WranglerRoom00` | `wrangerset` |
| 6 | `SMX3_MainMenuHorner_HyperionBridgeBriefing_01` | `bridge-mainmenuhorner` |

A feed with no channel of its own takes the lowest one the screens on its shot's set show, and 0 where none is known (`packages/core/src/cutscene/feed-channels.ts`), and the compile and `check` warn of a feed that no screen known there shows.

So a Cinematic's shot `feed` (`packages/core/src/cutscene/cinematic.ts`) writes an element a fed shot on its channel, from the cut to the shot's end, at the actor whose camera films it in that shot: a cast member's copy (a portrait's own camera), or for a set camera a rig, the Nova main screen, placed so its camera sits on the set camera's line of sight, level, and dollied so the target fills its 50° lens as it fills the set camera's (`packages/core/src/cutscene/feeds.ts`). The main screen's own mesh lies more than 30° below its camera's line of sight, out of its picture. To check in game: that the holo's front shows channel 0 and the right way up; whether a far backdrop beyond 200 cells shows; whether a feed with no `aspectRatio` is stretched; and whether the m3 lens is vertical, as a cutscene camera's is.

## Blizzard's cutscene files are plain XML

The `sc2-arcade-watcher/sc2-game-data` mirror ([related-repos.md](./related-repos.md)) includes Blizzard's 336 shipped `.SC2Cutscene` files, about 90 MB of plain XML with a `CutsceneState` root, under `campaigns/{swarm,swarmstory,voidstory}.sc2campaign/base.sc2data/Cutscenes/` and `mods/{liberty,novastoryassets,voidprologue,...}`. No CASC extractor is needed: fetch a file with `gh api repos/sc2-arcade-watcher/sc2-game-data/contents/<path> -H 'Accept: application/vnd.github.raw'`, or use a sparse clone.

These files are true cinematics (the *cinematic* tier). Trigger-driven in-mission scenes that fade to black (such as THanson01) are a different thing; keep evidence from the two apart.

## Any model can be a doodad

The stock doodad list isn't the limit: unit, weapon and effect models are building material too. A map-local `CActorDoodad` in the map's ActorData turns any model into a doodad. LotV 3-4 defines `AntimatterMissileDoodad` this way: `Model value="ScoutAirWeaponLeft"`, `Scale 3`, `RandomScaleRange 1,1`, with `On` index 0 and 1 removed.

Such a doodad can play any of its model's animations: with `On` index 0 and 1 removed, `<On Terms="ActorCreation" Send="AnimPlay Preview Walk,Left PlayForever"/>` loops a custom ship model's Walk Left (seen in the Editor, 2026-11-02; [m3-models-in-blender.md](./m3-models-in-blender.md#previewing-in-the-editor)).

A Composite recipe gets one through an `actors` entry (`id`, CModel `model`, `scale`, `animate`, `animation`). The compiler writes it to ActorData.xml (`animation: "Unpowered"` adds `<On Terms="ActorCreation" Send="AnimPlay Unpowered Stand,Unpowered PlayForever"/>` and, like a still prop, removes the stock Stand loop; it excludes `animate`; checked in game on a custom ship doodad), and `capture-composite` brings a map's own actors along with the members that use them.

## A custom model is a doodad only with a CActorDoodad

A doodad type is a `CActorDoodad` id. Facts from the game's data (sc2-game-data `7be8945`) and the Editor:

- **The actor names its model by id.** `CActorModel`'s default `Model` is `##id##`, so a `CActorDoodad` with no `Model` draws the `CModel` of its own id. A custom doodad is a `CModel` (parent `Doodad`, whose template names `Assets\Doodads\##id##\##id##.m3`, so give the file's `Model`) and a `CActorDoodad` of the same id.
- **A `CModel` alone is a placeholder.** On a Kept map's ring test (2026-11-10) each ring had a `CModel` and an `ObjectDoodad` of that type but no actor. The Editor logged `Warning: Invalid placed doodad 'StabilizerRingWork2' at (62,165,10). A placeholder model will be used.` for each, and the palette didn't list them. With a `CActorDoodad` added, they loaded at the right height (author, in the Editor). A compile beside Kept terrain warns about such a type (`unknownPlacedDoodads` in `packages/core/src/catalog/stock-catalog.ts`, over the package's own in `@team-antioch/sc2-asset-catalog`).
- **The palette lists every doodad by default.** `CActorDoodad`'s default `EditorCategories` is `DoodadType:Props`. The game's doodads use `Environment` (758 in liberty.sc2mod), `Structures` (309), `CliffRamps`, `Blocker`, `TerrainObject`, `Track` and `Debris`. `TexSets`, one element per tileset, limits which tileset's lists show it.
- **Its defaults.** `SuppressSaveLoad` 1, `RandomScaleRange` 0.8-1.2, `On` index 0 `Create SoundEmitter Doodad_##id##` and `On` index 1 `$Stand PlayForever,RandomStartOffset`. None of liberty's 2,346 doodads removes either event: they're Blizzard's own, with sounds and Stands. LotV 3-4's `AntimatterMissileDoodad` and the custom doodads of a Kept map (its tram background, the ring test) remove both, and the `doodads` shape does too, keeping the Stand only with `animate`, and sets `RandomScaleRange` 1,1 so copies keep their placed size. The ring test that worked set `SuppressSaveLoad` 0; the shape leaves Blizzard's default, which all but 47 of liberty's doodads keep. That difference hasn't been opened in the Editor.
- **A model with no animations is a valid doodad.** The rings have no sequences at all and load. The tram background `UmojanLabTramBackground(Static).m3` has `Stand` and `Dead`.
- **Preloads aren't needed.** `Preload.xml` and DocumentInfo's preloads are streaming hints ([data-loading-and-dependencies.md](./data-loading-and-dependencies.md)). The ring test added an `<Actor id>` to `Preload.xml`, but nothing shows it was needed, and a compile writes none.
- **A placed doodad's z.** `ObjectDoodad`'s `Position` z is absolute with the `HeightAbsolute` flag, and a height above the ground with only `HeightOffset` ([terrain-file-formats.md](./terrain-file-formats.md)). A Blueprint's doodad Anchors are written at the absolute ground height.

## Tech-tree restrictions

Not tested in game: these come from the Editor's own hints for the actions (`mods/core.sc2mod/enus.sc2data/LocalizedData/TriggerStrings.txt` in SC2GameData) and from how Blizzard's campaign libraries call them.

- **Restrictions are off until a trigger turns them on.** "Allow/Disallow Unit For Player" is "only useful if tech restrictions have been enabled using 'Enable/Disable Tech Tree Restrictions'" (`TechTreeRestrictionsEnable(player, true)`). Every campaign library turns them on at mission start, then allows what the mission has.
- **Restricted and Suppressed commands.** With restrictions on, commands flagged Restricted or Suppressed in data leave the command card. A Restricted command's unit, upgrade or ability must be allowed directly; a Suppressed one comes back when something that needs it is allowed ("allowing the Banshee will also allow the Factory and Starport").
- **Allowing doesn't skip requirements.** "If the unit has a tech requirement, the requirement must still be met."

A blueprint's `tech` compiles to these calls (`packages/core/src/triggers/build-mission-triggers.ts`, "Tech"). To check in Test Document: whether a disallow does anything while restrictions are off, and which stock commands the data our maps mount flags Restricted.

## A cutscene Light's "alert" twin may hold no colour

A base Light switched on a cut (`light` on a Cinematic's shot) changes only what the Light itself holds: ambient, directional lights, exposure and colourization. Blizzard's NCO pair `SMX3_Cutscene_MP01_010_MainRoom` and `..._MainRoom_Redlight` differ only in colourization (hue −0.436 → −0.496, saturation 0.246 → 0.074, blend 0.256 → 0.381) and bloom threshold, with the same ambient (0.13, 0.07, 0.04) and their directional lights off. So the "red light" turns nothing red: MP01's alert red comes from its cutscene's own lamps. In a Mission's playtest (2026-10-31) the switch reached the lab shot after it, and the lab looked as warm as before (mean frame colour (73, 59, 47) before, (67, 56, 46) after), its 24 lamps, many of them orange, unchanged. For an alert, give the shot red `lights` of its own; the Light switch alone only shifts the grade.

## The mission Light after a dialog Cinematic

Pending in game. After one in-world cutscene played under `CinematicFade` (`exp-cs-4`), the map stayed in a pale light, apparently the cutscene's Active Light left in place. Two later in-world runs (`exp-cs-6`, `exp-cs-7`) didn't do it, so the cause is unconfirmed. Nothing has been tested yet for a cutscene played in a full-screen dialog control, as a Cinematic plays: the dialog draws its own frame above the world, and its Active Light might or might not reach the game's lighting.

So a Cinematic's one cleanup (`packages/core/src/triggers/cinematic-triggers.ts`) sets the mission Light back with `GameSetLighting(<mission light>, 0)` after every run, skipped or not. To answer it in Test Document on a Mission whose Cinematic's Light differs from the mission's (for example, an opening lit by `SMX2Cutscene_Aiur02Debrief` in a mission lit by `Monlyth`), compare the map's light just after the Cinematic with its light at map start: they should match. To see whether the call is needed at all, disable the `Set Lighting` action in "Cinematic <Id>" in the Trigger Editor, save (Test Document runs the saved MapScript.galaxy), run again, and look for the pale or bridge-coloured light on the terrain and units. Record the result here: needed, or not needed in the dialog path (then the call is harmless and stays as a guard).

## UI frame paths

A frame's path is its layout file's name (the `.SC2Layout` file's stem, wherever it sits under `UI/Layout/`) and its frame names from the file's top: `HarbourUI/Dock/Title`. A frame declared with `file="X"` belongs to file X, nested (`<Frame name="GameUI" file="GameUI">…`) or flat (`name="GameUI/UIContainer/ConsoleUIContainer" file="GameUI"`). A frame made from a template has the template's frames below it too. A template is named by the same path (`StandardTemplates/StandardGlueButton`), and `/` and `\` both separate. Blizzard's files show each form: HotS's `HotS_GameUI.SC2Layout` overrides stock frames by the flat form, and LotV's `VoidCampaignUILib.galaxy` uses both separators.

How each native reads its path:

- `DialogControlHookupStandard(type, path)`: from GameUI's top frame, so `UIContainer/FullscreenUpperContainer` is the frame `GameUI/GameUI/UIContainer/FullscreenUpperContainer`.
- `DialogControlCreateFromTemplate` and `DialogControlCreateInPanelFromTemplate`: a template, by its file and path.
- `DialogControlHookup(panel, type, path)`: relative to `panel`.

A path no layout has should make the call fail, and whatever it drives do nothing; that isn't confirmed in game yet (a blackout fade made from a template no file defines is the check to do). `check` warns about each literal path a mod passes that is in neither its own layouts (with its UI Components' generated ones) nor Blizzard's (`packages/core/src/ui/frame-path-check.ts`, ADR-0019). It can't follow the panel a relative hookup is given, so it passes one that some frame's path ends in. Blizzard's frames are `packages/core/data/ui-frame-paths.json`, built by `packages/core/scripts/build-ui-frame-paths.mjs` from every layout in the mods and campaigns (not maps) of the pinned game-data mirror `sc2-arcade-watcher/sc2-game-data` @ `7be8945`; rerun it after moving the pin. The snapshot keeps each frame's template rather than copying the template's frames out, since Blizzard's templates of templates would copy out to over 300,000 paths.

## Game time, AI time and mission time

A trigger's `Wait`, a timer and a periodic event each run on one of three clocks (`c_timeGame`, `c_timeReal`, `c_timeAI`; natives.galaxy l. 3530-3545 at sc2-arcade-watcher/sc2-game-data @ `7be8945`). Mission time is a fourth clock. No wait or timer can run on it.

- **AI time** is game time that triggers can pause on its own (`AITimePause`). NativeLib's cinematic mode pauses it, and so does a hero moment (`packages/core/src/ui/hero-moment.ts`). Compiled Waves, raids, delayed script cues and encounter timers all wait on AI time ([ADR-0008](../adr/0008-compiling-waves-and-raids.md)), so pausing it holds them.
- **Mission time** (`GameSetMissionTimePaused`, `GameGetMissionTime`; natives.galaxy l. 1860-1862) is the clock NativeLib's "Game Play Time" reads (`libNtve_gf_GamePlayTime`, NativeLib.galaxy l. 3406), for the victory screen's mission time. Cinematic mode pauses it along with AI time (NativeLib.galaxy l. 2140-2166), yet a cutscene's game-time waits run on. So pausing mission time doesn't hold game time.
- **Game time** keeps running while both are paused. A compiled Mission's goal timers (`TimerStart(…, c_timeGame)`) and timers a Mechanic declares run on it. So scenes hold them explicitly ("Clocks Hold", [ADR-0012](../adr/0012-trigger-scenes-and-chained-skips.md)), and so does a hero moment ("Clocks Hero Moment", `library-interface.md`).

**Still to check in game** (#656). The following is read from the natives and NativeLib, not yet seen in game:

- that `GameSetMissionTimePaused` alone doesn't hold a game-time timer;
- that a goal timer's countdown stops during a hero moment, held by "Clocks Hero Moment", and picks up where it stopped;
- that a Wave's schedule doesn't advance during a moment;
- in the `ui-test` Mission, that a moment begun during an in-play line waits for the line's end.
