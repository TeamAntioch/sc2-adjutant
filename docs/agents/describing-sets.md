# Describing one cinematic set

This is the brief a describer agent follows to write one set's look (schema: `packages/core/src/cutscene/set-looks.ts`). A set of Blizzard's goes in core's `packages/core/data/cinematic-sets/looks.json`; a set a file of the Campaign's holds goes in the Workspace's `cinematic-sets/looks.json`, beside its catalog. Run one agent per set, each given this file, the set id and a file to write its JSON to; then merge each result into that `looks.json` under its id, without the `id` field, and run `npm run set-cards` to make the card pictures the looks name (with `--looks <file>` for the Workspace's). The sets must have been drawn first (`npm run render-set-views`, see `docs/reference/m3-models-in-blender.md`). A describer takes one to three minutes and about 75k tokens.

You are writing the "look" of one StarCraft II cinematic set: a searchable description that lets a
cutscene author find a location that fits a scene ("a cramped ship corridor with a cockpit at one
end"). Describe only what you see in pictures. Do not guess from the set's name or from lore.

## Pictures you have

Neutral-light renders (geometry and textures under even light, no game lighting), in
`~/Library/Caches/sc2-adjutant/set-views/<set id>/`:
- `overview.jpg` (from the south-east, roof cut off), `plan.jpg` (straight down, roof cut off)
- `cam-01.jpg` ... : the set's own cameras. Many are close-ups of a character who isn't drawn, so
  they may show a wall, a blur or nothing. Look at three or four at most, spread over the list.
- `set.json`: name, size in cells (x, y, height), camera names, who is staged there.

In-game captures, where they exist, in `~/Library/Caches/sc2-adjutant/set-shots/story/<set id>/`
(the folder may be missing: set ids changed since they were taken). They show the game's real
lighting and mood. A file under about 60 KB is a black frame: skip it.

## Asking for more pictures

Run from the sc2-adjutant checkout, after `npm run build -w @team-antioch/sc2-adjutant`:

    node packages/core/dist/cli/set-shots.js <set id> --blender <Blender 4.5 program> <what>

- `--list` : the models, bounds (min/max x, y, z), floor height and cameras of the pieces chosen
  (it honours `--only` / `--without`). Run this first. Draws nothing. `floor` is a guess; `levels`
  lists the heights holding the most walkable surface, so if the guess is the top of a roof or a
  lid, pick another level and pass `--floor <z>`. `ceiling` is the height of the ceiling over that
  floor (`ceilings` lists the candidates): a room's ceiling is often well under its walls' top.
- `--compass <height>[@x,y] [--floor <z>]` : four pictures looking north, east, south, west from a
  standing point that high above the floor (1.2 is about eye height; default point: the centre of
  the bounds). The centre may be inside a wall or a console, so try an `@x,y` taken from a camera's
  target if the first try shows nothing useful.
- `--orbit <bearing>,<pitch> --cut [z]` : from outside, bearing 0 north / 90 east, looking down at
  that pitch, with everything above z removed. With no z it cuts just under the measured ceiling,
  or at the set's own cut height where it finds no ceiling (an open set); the result's `cutZ` says
  where a cut is made.
- `--plan --cut [z]` : straight down with the roof off.
- `--shot <name>=<ex>,<ey>,<ez>:<tx>,<ty>,<tz>[:<fov>]` : a free camera.
- `--only <regex>` / `--without <regex>` : draw only some pieces, by model name. Use this when a
  set holds two rooms on top of each other, or one piece hides the rest.

The set's own `overview.jpg` and `plan.jpg` often leave the roof on, because they cut at a height
taken from where people stand. If a `--cut` picture still shows a lid, the floor guess is wrong
(pass `--floor`, and the cut follows it) or the ceiling is lower than the measured one: give a z
under it, a little above head height (floor + 2 to 3). A cut above the ceiling changes nothing.

It prints the picture files (in `<set folder>/shots/`), and under `pictures` each file with a `from`
record of how it was drawn. A later request with the same shot name overwrites the earlier picture. Each call takes about ten seconds. Read the
pictures with the Read tool. Use only the commands above; do not change any file in the repo.

## What to do

1. `--list`, then look at `overview.jpg`, `plan.jpg`, and any usable in-game captures.
2. Ask for more pictures until you can say what the place is, how big it is, what it is made of,
   and what a camera standing in it would see. Stop at about eight extra requests: if you still
   can't tell, say so in the look and set confidence low.
3. Choose the two to four pictures that best show the place to someone browsing a gallery: first
   the one that shows the whole room best, then ones that show what a camera inside would see.
   An in-game capture may be one of them, never a black one. Don't copy them anywhere: list each
   under `pictures` as `card/1.jpg`, `card/2.jpg`, ... with a `from` saying where it comes from,
   so the picture can be made again on another machine:
   - a picture from `set-shots`: the `from` printed beside its file, copied exactly;
   - the set's own plan or overview: `{ "view": "plan" }` or `{ "view": "overview" }`;
   - a frame from one of the set's cameras (`cam-NN.jpg`): `{ "camera": "<its name, from --list>", "frame": NN }`
     (the frame number matters where two cameras share a name);
   - an in-game capture: `{ "capture": "<its file name>" }`.
4. Write the result as JSON to the output file you were given, exactly this shape:

    {
      "id": "<set id>",
      "kind": "room" | "exterior" | "space" | "props" | "effects" | "unclear",
      "look": "<3 to 5 plain sentences: what the place is, its shape and size in cells, its main features and where they are, materials and colours, and its mood in the game if an in-game capture shows it>",
      "facets": ["<8 to 14 short lowercase search words: interior/exterior, faction (terran, protoss, zerg), type of place, shape, scale, notable features>"],
      "standsInFor": ["<2 to 4 kinds of scene this could be used for; empty if it is only props or effects>"],
      "rooms": ["<only if the set holds more than one distinct place: a line per place, naming the model-name pattern that selects it>"],
      "pictures": [{ "file": "card/1.jpg", "shows": "<a few words: what this picture is of and from where>", "from": { "orbit": [135, 40], "cut": 9.55 } }],
      "basis": "<which pictures the look rests on, and what was unusable>",
      "confidence": "high" | "medium" | "low",
      "problems": ["<anything wrong with the pictures: missing room, magenta screens, a sheet blocking the view, cameras inside walls>"]
    }

"props" means loose objects meant to sit on map terrain, with no room. "effects" means only
particles, holograms or light. Plain words; no lore names unless they are in the set's name.

Your final message should be one line: the confidence and the first sentence of the look.
