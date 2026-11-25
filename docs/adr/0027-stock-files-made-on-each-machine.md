# Stock Files Are Made on Each Machine, Never Committed

A mapper wanted a red copy of a purple stock effect (#104). A texture swap couldn't do it: a swap reaches only a standard material's layers (`texture-swaps.md`), and the effect's texture wasn't in one. Their workaround was to extract the `.m3` and its textures from the game with a CASC extractor, recolour the textures with ImageMagick, binary-patch the texture paths in a copy of the `.m3` to new names of the same length, and commit all three to the Asset Mod as Workspace files.

**The decision.** An Asset Mod's Blueprint can name a stock file as an Asset Source, `{ "game": <model>, "member"?: <a texture it names> }`. It is made on each machine from that machine's game, through the Host Adapter's `model.export`, and it is never committed, like a community asset. Two derived steps written in core build on it. `retexture` points an `.m3`'s layer image paths at other files, of any length. `recolour` shifts a `.dds` texture's hue or maps its greyscale onto a gradient, in the texture's own format, with its alpha kept.

## Considered Options

- **Export once and commit as Workspace files, with an origin.** Rejected. Blizzard's files would be in the Workspace's git history, and a game patch to the model would never reach the copy.
- **A CASC reader in core.** Rejected for now. The Host Adapters already read the game's storage through the model viewer, and `model.export` writes a model with its animations merged in and the textures it names, which is exactly what a recolour needs.
- **ImageMagick for the recolour, as ffmpeg is used for `wav-to-ogg`.** Rejected. It's another install, and its DXT output can change between versions. The codec in core (`catalog/dds.ts`) needs nothing installed, writes the same bytes on every machine, and CI tests it on Linux, macOS and Windows.

## Consequences

- Anyone who compiles the Asset Mod needs the game and a Host Adapter with `model.export`. On a machine without them the compile stops and says so. A `gameModel` doodad's swaps already needed the same.
- A file made from a game file is uncommitted: the compile record lists it as `{ "kind": "uncommitted", "path" }`, and the mod's `.gitignore` lists it.
- The recolour decodes and re-encodes only a block's colour half. DXT3 and DXT5 alpha is copied byte for byte, and DXT1's transparent texels stay transparent. A format it doesn't read (BC4/BC5, a DX10 header, a volume texture) is refused by name.
- A texture swap is still the cheaper choice where it works. A recoloured texture can also be a swap's `with`.
