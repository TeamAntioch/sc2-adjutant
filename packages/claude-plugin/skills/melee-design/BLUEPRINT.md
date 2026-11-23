# The Melee Map Blueprint

One JSON file holds half a 1v1 map. The compiler validates it against core's `MeleeMapBlueprintSchema`. When a field here and the schema disagree, the schema's error message wins.

## Top-level fields

```json
{
  "id": "dusk-terrace", "title": "Dusk Terrace", "summary": "One line on the layout.",
  "category": "standard", "spawns": 2, "symmetry": "rot180",
  "mapSize": { "width": 160, "height": 160 }, "playableSize": { "width": 136, "height": 136 },
  "tilesetId": "BelShir",
  "zones": [], "placements": [], "starts": ["main-base"]
}
```

- `category`, `spawns` and `symmetry` take only those values for now.
- **The look:** `tilesetId` sets the stock textures, cliffs, sky and light. `lighting`, `textures` (up to 8 stock textures), `texturePalette`, `cliffPalette`, `raggedCliffs` (0-8) and `terrainSeed` (the text the cliffs' wobble is seeded from, the id by default; keep it at the old id when renaming a map) are optional and work as on a Mission Blueprint. Take tileset ids from the keys of `tilesets` in core's `data/texture-extracted.json`.
- The map size less the playable size must be even across, and the playable height must be even.
- `starts` lists one resource base, the half's start base. The rotation makes the other.

## Coordinates

Positions are map cells, `x` east and `y` north, from the map's bottom-left. The playable area is centred across. Vertically, a third of the spare rows go below and the rest above. For the 160×160 default:

```text
playable  x 12-148, y 8-144
centre    (80, 76)    a point (x, y) turns to (160 - x, 152 - y)
```

Draw the half on one side of the centre, usually a start in a corner or along one edge. A **partner** lands at `(2·cx − x, 2·cy − y)`. Check that every base's partner keeps clear of your other bases.

## Zones

A zone, complete:

```json
{ "id": "natural", "name": "Natural", "elevation": 2, "landform": "flat", "role": "base",
  "polygon": [{ "x": 14, "y": 40 }, { "x": 50, "y": 40 }, { "x": 50, "y": 70 }, { "x": 14, "y": 70 }],
  "connections": [{ "toZoneId": "middle", "type": "ramp", "at": { "x": 48, "y": 70 } }] }
```

`name`, `landform` and `role` are required. On a melee map use `"landform": "flat"`, with `"role": "base"` for a zone that holds a base and `"path"` for the rest. `elevation` is 0-3. A zone may run to the playable area's edge. Where zones overlap, the later one wins, so list the background first:

- **The middle:** a rectangle over the whole playable area at elevation 1, listed first. It lies across the centre, which is allowed because it's symmetric on its own.
- **The main:** elevation 3 (the top level), about 30×30 cells (ladder mains are 700-1,200 cells). It has exactly one connection: `{ "toZoneId": "natural", "type": "ramp", "at": {…} }`, with `at` on the main's edge where it meets the natural. The compiler cuts the narrow diagonal ladder ramp there and puts the unbuildable plate at its foot. Leave the main out of `ramps`: an entry there would set the shape.
- **The main's rim:** where the main meets the middle, a cliff would climb two levels at once, and the game draws that as black squares. So list a backdrop zone at elevation 2 just before the main: `{ "id": "main-rim", "name": "Main Rim", "elevation": 2, "landform": "flat", "role": "path", "backdrop": true, "polygon": […] }`. Draw it as a band about 4 cells wide round each side of the main the middle touches, running under the main's edge, and keep it off the natural. Listing it before the main lets the main keep its own edge. A compile that still has such a jump warns that `N neighbouring cell pairs are still two or more levels apart`. The same goes for any zone that touches ground two levels from it.
- **The natural:** elevation 2, touching the main where the ramp goes, with a `ramp` connection down to the middle. That ramp is the natural's choke.
- **Pods and high ground:** elevation 2 zones in the middle, each with a ramp connection down. A pod off the centre gets a partner. A zone across the centre must be symmetric on its own, and it can't have a ramp to the middle, since the middle lies across the centre too.
- Zones that touch at the same level are walkable between. Cliffs separate different levels, except where a ramp connection is declared, on the higher zone. A high-ground third shouldn't touch the natural on the same level, or it stops being a pocket of its own.
- The top-level `ramps` array places straight ramps by zone edge (`{ id, zoneId, edge, offset }`). Leave it empty: a `ramp` connection places each ramp, and the main's ramp is the compiler's.

Connection types: `ramp` and `open` work. `air-only` draws no ground path. `rocks` and `collapsible` are refused: use a `rocks` placement on the path instead. `bridge` is refused because it isn't rotated yet.

## Bases

```json
{ "id": "natural-base", "zoneId": "natural", "kind": "resource-base",
  "params": { "at": { "x": 26, "y": 54 }, "facing": "south-west" } }
```

- `at` is the town hall's spot. The compiler places the standard ladder base around it (8 minerals and 2 geysers, or the gold or rich-gas variant), and never the town hall itself.
- `facing` is the corner the mineral line wraps: `south-west`, `south-east`, `north-west` or `north-east`. Point it away from the base's entrance, toward the map edge or a cliff. Only diagonals exist: the geysers can't swap sides.
- **The start base has no `facing`.** It faces away from its main ramp. The game's town-hall rule must put its hall on `at`. The resources are laid around `at`, so the rule fails only where a cliff or the zone's edge cramps the base. Then the `[start-base]` error gives the spot to use. Put the hall about 10 cells in from every cliff on its mineral side.
- Every other base needs a `facing`.
- `minerals: "rich"` makes a gold base, and `gas: "rich"` or `"one-rich"` a rich-gas one, but never both on one base. Ladder maps have 0-4 of these, in exposed places.
- Keep a base's resources inside its zone and on flat ground. Keep town halls about 16 cells apart or more, partners included. A base that lands on its own partner is a `[symmetry]` error.

## Rocks

```json
{ "id": "shortcut-rocks", "zoneId": "middle", "kind": "rocks", "params": { "at": { "x": 70, "y": 40 }, "size": "6x6" } }
```

Rocks go at whole coordinates, `6x6` or `4x4`. They block the path until killed, and the report gives each distance with the rocks up and down. Rocks on a main's second exit make that exit legal.

## Refused

These fail the build:

- an id that is another id with `-rot` added, since that's the partner's name;
- a `ramps` entry on a main;
- a zone that turns off the map;
- a main below another zone;
- a main with no ramp, two ramps, or another ground way out;
- no room for the diagonal ramp where `at` points;
- a start hall off the town-hall rule's spot;
- anything the Editor would call non-Melee.

Each error says what broke and how to fix it.

## A worked draft

This half compiled cleanly on its second try. The first try was 10.5 s main to natural and 21 s to the third. Moving the main's hall 2 cells toward the ramp, the natural's hall 2 cells in, the natural's exit 4 cells east and both thirds about 4 cells closer brought every number into band.

```text
middle        elev 1   12,8 – 148,144 (the whole playable area)
pod           elev 2   56,82 – 70,96, ramp down at (70, 88): a high pod flanking the middle
natural       elev 2   14,40 – 50,70, ramp down at (48, 70): the choke faces north-east
main          elev 3   14,10 – 46,42, ramp down to the natural at (36, 42)
main-base     (30, 26)           start, no facing
natural-base  (26, 54) south-west
third-north   (26, 92) north-west   up the west edge
third-east    (60, 58) south-east   out toward the middle
fourth-south  (80, 20) south-east   along the bottom edge
fifth-south   (112, 22) south-east
corner-west   (22, 124) north-west
```

```text
Ramp to ramp 34.5 s · main to main 43.0 s (air 35.6) · natural to natural 31.7 s
Main to natural 9.1 s · main to third 19.1 s (third-east) · second third 21.1 s (third-north)
Air vs ground 83-89% · 14 bases · no warnings
```
