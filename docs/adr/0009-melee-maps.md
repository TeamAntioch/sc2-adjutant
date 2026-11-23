# Melee Maps: a Separate Blueprint, Half a Map, Ladder Features Only

Spec #212 adds the **Melee Map**: a 1v1 map the Galaxy Editor calls Melee, built through the `melee-design` skill and the `compile_melee_map` tool. The numbers behind these decisions were measured on 21 Blizzard ladder maps; [melee-maps.md](../reference/melee-maps.md) has what the Editor checks.

**A separate blueprint type, not a Mission mode.** The **Melee Map Blueprint** (`domain/melee-map-blueprint.ts`) reuses the Mission Blueprint's Zone, Connection and terrain schemas, but nothing of a Mission's story. It has no Beats, Screenplay, Waves, Mechanics, Anchors or tech, and it adds `category`, `spawns`, `symmetry` and `playableSize`. A `mode: "melee"` flag on the Mission Blueprint would have left every story field optional and every story check asking whether it applies. The compile path is separate as well (`map/compile-melee-map.ts`). It shares the terrain writer (`writeMapPackage`, `rasterizeTerrain`) through opt-in options, so Mission output doesn't change. It writes User players with any race and a random start, Void (Mod) as the only dependency, the stock "Melee Initialization" trigger, the four cosmetic catalogs, and Neutral for every unit.

**No Workspace.** A Melee Map belongs to no Campaign and has no Campaign Pack, so its blueprint and Map Package can sit in any folder. `compile_melee_map` accepts absolute paths, unlike every other tool, which keeps its output inside the Workspace. The MCP server still starts only in a Workspace, so outside one the skill runs the `compile-melee-map` CLI. The look comes from a stock tileset, or from an Exemplar Map when a Style Pack is installed.

**Half the map, turned 180°.** The blueprint draws one Half, and `map/rotate-half.ts` adds each object's Partner, `<id>-rot`, turned about the playable area's centre. Of the 19 two-player ladder maps, 17 use rot180 and 2 use a left-right mirror (melee §1). Rotation keeps every approach the same relative to the base under SC2's tilted camera, and a mirror doesn't. Where the compiler can't draw a thing twice and keep it symmetric (a ramp's fit, terrain noise), it draws it on the **source side** and turns it. A Zone across the centre must be symmetric on its own. A ramp between two centre Zones is refused, because no ramp is its own rotation. Bridges are refused until they are rotated. The playable height must be even, so that the centre lies on the 2-cell cliff grid.

**Diagonal base facings only.** The standard base is the commonest ladder start layout (melee §1). It is mirrored across the axes to face each diagonal. A quarter turn would put each 2×1 mineral field half a cell off the grid, so there are four facings, and a base's geysers can't swap sides: the first is always beside the town hall horizontally, the second vertically. A Start Base faces away from its main ramp, and every other base names its facing.

**The narrow diagonal main ramp, fixed.** Every main ramp on the 21 ladder maps is the Editor's narrowest diagonal ramp: 15 cells of slope in a 5×5 box, one level down from the main to the natural (melee §2). Standard wall-offs were tuned to it. The Editor's wider diagonal ramp is two cells wider to walk through, and the standard walls wouldn't close it. So the compiler shapes the main's ramp, and the author only says where it goes, with the ramp connection's `at`. It is the narrow stamp decoded from an Editor-saved ladder map, with an Unbuildable Plate 5-8 cells from its top. A main with no ramp, two ramps or a `ramps[]` entry fails.

**Errors stop the build; distances warn.** A broken rule throws a `MeleeRuleError` naming the rule and the object, and nothing is written: the map is staged and copied out only when clean. The rules are:

- the Editor's own non-melee reasons;
- a non-standard Start Base;
- a missing Partner;
- a main with a second unblocked ground entrance;
- a misshapen or missing main ramp;
- a feature TLMC forbids.

Distances outside the Standard bands are warnings, and so are a missing natural or second third, the base count, and an air distance below 60% of ground to an early base. Contest rules call the bands "not a hard restriction", and a mapmaker may choose a 39 s rush distance. The skill revises against the warnings up to three times and hands over the ones left, labelled. Distances are worker seconds at 3.9375 cells/s, the research's calibration against Liquipedia's rush distances. The Mission checker's 3.15 cells/s stays for Missions.

**Ladder features only.** Melee Maps get what ladder maps use: the 8 + 2 base, gold and rich-gas variants, and destructible rocks. No healing shrines, worker-only paths, inhibitor zones or TLMC's other freestyle features, and stock textures only (melee §7, Q7-Q8). **Rocks are a placement, not a Connection type.** A `rocks` Placement puts a ladder rock (6×6 or 4×4) at whole coordinates, turned with the Half. It blocks ground paths, and the report gives each distance with the rocks up and down. On a Mission, `rocks` and `collapsible` Connections are declared for the checker but draw nothing. On a Melee Map they would promise a rock that isn't there, so the schema refuses them. Collapsible rock towers, watchtowers and mineral walls can come later as Placements.

## Consequences

- Four-spawn maps, mirror symmetry and the Rush and Macro categories each widen a literal in the schema (`spawns: 2`, `symmetry: "rot180"`, `category: "standard"`), plus the checks behind it.
- The start-location list in MapInfo's variant block stays empty, as on every ladder map; the StartLoc points place the players.
- Choke widths, overlord spots and cliff exposure aren't measured. The skill's walk-through checklist asks the author to look at them in Test Document.
- Battle.net publishing and packing to MPQ are out of scope. A Melee Map is played locally.
