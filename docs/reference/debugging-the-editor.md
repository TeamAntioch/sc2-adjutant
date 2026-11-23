# Debugging the Editor

How to find why the Galaxy Editor misbehaves on a generated map (refuses a file, renders wrong, loses terrain): bisect against a map the Editor saved itself, rather than guessing one fix per round.

## Bisect against a reference map

1. **Get a reference map.** Ask the author to make a small map in the Editor that has the feature working, or reuse an Editor-saved reference map ([map-package-findings.md](./map-package-findings.md#map-packages) says what one should hold).
2. **Build single-variable copies** under the Mission's `missions/<id>/output/exp-*.SC2Map` in its Workspace, which ignores `output/`. Each copy swaps exactly one file group between our output and the reference map. Starting from the known-good reference and swapping our files in works best.
3. **Label each copy** with what it changes and what each outcome would mean.
4. **Ask the author to open each copy** (`open <map>.SC2Map/ComponentList.SC2Components`, [macos-host.md](../../packages/plugin-host-macos/docs/macos-host.md)) and report what they see, with screenshots and the Editor's console warnings.
5. **Delete the `exp-*` copies** once the cause is found.

Guessing one fix per round costs many rounds. Bisection found the `.version` file, cliff-cell and MapInfo tileset causes in a few rounds each, and the empty camera view came from diffing against an Editor-made camera ([editor-and-engine.md](./editor-and-engine.md#camera-objects)).

The Editor only rewrites the terrain components that were edited, so "open and Save As" doesn't validate generated terrain. Ask for an edit in the area instead.

## Test unit effects on a stock unit

When a gameplay or visual effect might be specific to a custom unit (a Campaign Mod's unit, say), test it on a stock unit with known behaviour first. Checking a Fire death on a Marine settled such a question in one round.
