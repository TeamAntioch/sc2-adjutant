# @team-antioch/sc2-adjutant-style-antioch

The Antioch **Style Pack** for [sc2-adjutant](https://github.com/TeamAntioch/sc2-adjutant): a visual style for StarCraft II campaign missions, learned from maps and written down so an assistant can propose and critique a Mission's look the same way every time. The `exemplar-design` skill in the Claude Code plugin reads it, and core's dresser and texture painter apply its rules when it is the Workspace's Style Pack.

## What's in it

- **Design Lessons** (`exemplar-maps/LESSONS.md`): DL-01 to DL-19. Each one is a rule written as an instruction, with the measurements behind it, its weight, and the part of the Mission Blueprint it shapes.
- **Style rules** (`rules.ts`): eight of the lessons as code, filling the dresser's and the painter's slots. They cover cliff and shore piles, lip clumps and wear on broken runs, yaw and scale, texture changes at cliffs, blending by tone, variety patches so no zone wears one texture, and advice on repeated landmarks.
- **Exemplar Maps and Map Studies** (`exemplar-maps/`): 33 maps the pack's author made or edited, each with a Map Study (`study.json`: texturing, cliffs, doodads, lighting and composition, with their thresholds) and layer images of its textures, elevation, doodads and shading.
- **Mood mixtures** (`exemplar-maps/mixtures.md` and `mixtures.json`): the Exemplar Maps' dressed places grouped into moods, for dressing a new place from its mood rather than copying a layout.
- **Guides** (`knowledge/`): the step-by-step guide, plus textures, cliffs, dressing, interiors, lighting, sky, water and terrain objects.
- **Doodad Composites** (`composites.json`): multi-doodad recipes a set piece can stamp.
- **A prompt**, `add-exemplar-map`, which walks through adding a map to the pack and bringing each new or changed lesson to its author.

The documents are served by sc2-adjutant's MCP server as knowledge resources (`sc2-adjutant://plugins/style-antioch/knowledge/<id>`). Start with `guide`. The skills read the pack only through the server, so they work wherever the pack is installed.

## Install

In your Workspace:

```sh
npm install @team-antioch/sc2-adjutant-style-antioch
```

Then name it as the Workspace's Style Pack in `sc2-adjutant.workspace.json`:

```json
{ "stylePack": "bundled:style-antioch" }
```

It needs sc2-adjutant core (`@team-antioch/sc2-adjutant`) installed beside it, which is a peer dependency. `list_plugins` shows it loaded, with its roles and Contributions.

## What isn't included

**The source maps.** An Exemplar Map's entry in `exemplar-maps/exemplars.json` gives the map's path inside your Exemplar Map folder (`exemplarMaps` in the machine config). The pack works without the source maps: the lessons, studies, layer images and mixtures are all here. You need the source maps only to study a map again, or to add one.

**In-game screenshots.** The camera-tour frames the lessons were measured against aren't shipped. Each lesson states its rule, its numbers and the map and place that show it, so it stands without them. When a frame isn't available, the `exemplar-design` skill says so and works from the study. To make the frames yourself, you need the source maps, the Galaxy Editor and a Host Adapter with `editor.captureTour`. [`exemplar-maps/README.md`](https://github.com/TeamAntioch/sc2-adjutant/blob/main/packages/plugin-style-antioch/exemplar-maps/README.md) has the commands, which run from a clone of the sc2-adjutant repo.

## Making your own Style Pack

The sc2-adjutant Claude Code plugin's `style-pack-builder` skill builds one in your Workspace from maps you made, edited or admire: it scaffolds the pack, studies and captures the maps, and drafts Design Lessons and moods from what is distinctive about them, for you to ratify one at a time.

A Style Pack is a Plugin with the `style-pack` role. To make one by hand, copy this one's shape, with knowledge documents, Exemplar Maps, Composites and optional style rules, and read [the plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md#style-pack-kinds).

MIT licensed.
