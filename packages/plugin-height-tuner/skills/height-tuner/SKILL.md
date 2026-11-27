---
name: height-tuner
description: Tunes a terrain texture's height map in game. Builds a small test map per texture with a strip per candidate normal map, each painted 0 to 100% over a base texture, captures the strips and publishes them as a Still Review. Use when a height-blended texture covers too much or too little, shows as solid clumps, or should let the ground under it grow through its gaps; when the author asks to tune, crush or invert a texture's height; or to compare normal-map variants of one or more textures.
---

A layer's height is the **red channel of its CTerrainTex Normalmap**. The `Heightmap` field does nothing on this build, and `HeightMapScale`/`HeightMapOffset` scale it. Only layers painted at a texel compete there. So a texture's look over another depends on its normal map's red channel. The command and its files: [README.md]({{PLUGIN_FOLDER}}/README.md). The engine facts and how each variant is made: [terrain-height-maps.md](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/reference/terrain-height-maps.md).

The Utility's command builds one texture's **test map**:

```sh
node {{PLUGIN_FOLDER}}/dist/tune.js <Mission blueprint.json> <texture> [--base <texture>] [--variants <list>]
```

It writes `missions/<id>/output/height-tuner/<texture>/`: the map, `shots.json` (one Shot a strip) and `tune.json` (what each strip is). The map uses the Mission's tileset and lighting. The base texture is held at 15/15 everywhere, and each strip raises the test texture from 0 at its left to 15/15 at its right.

## Leading words

- **Variant**: one candidate height, written `<kind>[:<% at 0>][*<HeightMapScale>][+<HeightMapOffset>]`. Each is a map-local CTerrainTex copy with its own normal map, made on this machine from the install and never committed.
  - `stock`: the texture as the game has it. It is always strip 1, the reference.
  - `crush:25`: the stones kept, with the lowest 25% of the tile at 0, so the base texture grows in the gaps. The author's pick for ShakurasCity2 over this grass was crush:25: "exactly what I'm looking for".
  - `inverted-crush:25`: the highest 25% (the stone tops) at 0, so the base sits on the tops and the stone reads as sunken, with deep crevices. The author: "a ton of depth to a texture". It is a look of its own, not a fix.
  - `flat` takes out the tile's broad bands only, `relevel` stretches the height to 0..1, and `*2` sets HeightMapScale 2.
  - The default list is `stock,crush:15,crush:25,crush:40,inverted-crush:15,inverted-crush:25,inverted-crush:40`. A map holds 7 strips.
- **Strip**: one variant on the test map, framed by one Shot labelled `<n>. <variant> (0 to 100% left to right)`.

## Steps

1. **Settle the run.** You need the textures to tune (CTerrainTex ids), the base (default `BelShirGrassLightEx2`, the Bel'Shir grass), the Mission whose output and lighting the maps use, and the variants. Use the default list unless the author names a look: gaps of base → crush, depth → inverted crush. Done when each texture has its base and its variant list.
2. **Check the extractor.** The command reads the stock catalogs and the normal map from the install through the CASC extractor named in `SC2_CASC_TOOL`. When it stops on that, give the author the install steps in [tools/README.md, "A CASC extractor"](https://github.com/TeamAntioch/sc2-adjutant/blob/main/tools/README.md#a-casc-extractor) and wait. Done when `echo $SC2_CASC_TOOL` names a file that exists.
3. **Get the go-ahead to capture.** Each texture's capture takes about 3 minutes, and the Editor comes to the front and runs the map. The screen must be left alone until every capture is done, since a click or a key press lands in the game. Done when the author has said go.
4. **Build and capture each texture.** With one texture, do it here. With several, start one subagent per texture, all in one message, each with its texture, base, Mission, variants and this step's brief. Each one:
   1. runs the command, and reads its report and warnings;
   2. calls `capture_shots` with `mapPath` the map, `shots` from its `shots.json`, `name` `<set>-r1` (the set is `height-<texture in lower case>`, which the command prints), and `lighting` the Mission's Light if its Blueprint sets one;
   3. opens every frame: the stock strip's right end shows the test texture solid, and the variants differ from it and from each other;
   4. calls `build_still_review` with `mission`, `set`, `round` `r1` and one version, `{ label: "strips", note: "<texture> over <base>, one strip per variant", captures: [<the capture folder>] }`;
   5. returns the round's folder, its problems, and one line per strip: its variant, its share at 0, and what the frame shows.
   The captures queue one at a time through the Editor Broker, so subagents running side by side wait their turn. Done when every texture has a round folder with every frame on its page, or its problems are reported.
5. **Publish and read back.** Follow the still-review skill's steps 5 and 6 for each round. Tell the author the page's "best version" pick has one version here, so the pick goes in each strip's tags and note and in the overall note. Done when the feedback is recorded and the author has confirmed your summary of it.
6. **Refine or settle.** A next round narrows around the pick: shares either side of it (`crush:20,crush:25,crush:30`), or the pick at another scale (`crush:25*0.5`, `crush:25*2`). Run it as a new set, `height-<texture>-2`, since its strips are new variants at the old strips' places. Once the author settles on a variant, tell them its word, its CTerrainTex entry and its normal map (both in `tune.json`). Done when the author has a pick for each texture, or has stopped.

A Mission Blueprint can't declare a texture's tuned height yet. Carrying a pick into a Mission means a hand-made map-local entry. When the author does that, offer the report-missing-feature skill once.
