# Mods from Mod Blueprints

A Campaign's mods are built the way its Missions are. Each **Campaign Mod** and **Asset Mod** keeps its package committed in the Workspace (`mods/<id>/`) beside a **Mod Blueprint**, which owns the mod's Compiled Content under [ADR-0010](./0010-compiled-and-kept-content.md)'s compile record. An existing mod is Imported with everything Kept and converted part by part. Kept Content may stay in a mod for good, but the first Campaign Mod converts to zero Kept, because that's how we prove the mod support covers everything a mod holds. The Campaign Mod is generated. The Asset Mod is assembled from declared **Asset Sources**, since the tooling can't author a model or record a voice.

Mod content lives in the Workspace, not in the Campaign Pack. The Campaign Pack names the Campaign Mod and keeps only behaviour (its Screenplay Source, naming and Mechanics). Characters, the library's interface, tilesets, Lights, units and models are read from the Mod Blueprint by Mission compiles, the checkers and the Asset Catalog. That replaces the hand copies in `characters.ts` and `primitives.ts`, and the Campaign's tilesets that were in core's data files.

## Considered Options

- **The Campaign Pack owns the mod.** Rejected: it would put one Campaign's content in a shared repo, and a second author would need a Plugin just to have a mod.
- **Rebuild beside the old mod and switch at parity.** Rejected: nothing is usable until the end, and parity can't be seen along the way.
- **Game data only as raw XML, or only as purpose-level shapes.** Raw XML moves the data without generating it. Shapes alone leave the long tail Kept until a shape exists for each pattern. We use two layers instead: a **generic typed entry** (catalog, class, id, parent, fields), checked against the game's data schema, covers everything, and **purpose-level shapes** (characters, conversations, sound sets, later heroes) compile down to generic entries where a pattern repeats.
- **All library code as Galaxy, or all as GUI.** All Galaxy loses the typed primitives and the Editor's readable functions. All GUI forces vector math and string handling into blocks. We declare the library's interface (names, parameters, stable IDs) and compile it into GUI functions. Bodies are GUI by default, for any function an author would open in the Editor, and Galaxy files for code that's naturally text. UI layouts and font styles are likewise source files the Blueprint owns.

## Consequences

- **A conversion is done when it's equivalent.** Its compiled output is compared with the imported original, normalized for what the Editor ignores. Intended changes are recorded in the Mod Blueprint as named accepted differences, so a mismatch is always either a bug or a decision. Each batch also opens in the Editor and plays through one Mission and one interlude.
- **Imported IDs are kept forever.** GUI function and parameter IDs, conversation line IDs, cutscene GUIDs and catalog IDs survive conversion, so Missions calling them never break. New items get deterministic IDs.
- **Interludes and hub chats are Screenplays** from the Screenplay Source, owned by the Campaign Mod's Blueprint. Their scenes are Cinematics on Sets, compiled into the mod. Hand-authoring Templates go away.
- **Generated, never authored:** localized strings, `DocumentInfo` dependencies and preloads, `ComponentList`, `DocumentHeader` and the version files.
- **Voice per Sound ID:** a recording wins over a generated placeholder, and the character's declaration chooses the placeholder voice.
- **Asset Mod binaries are in Git LFS.** Community assets are only declared and fetched, never committed, so their licences stay visible.
- **Mechanic data stays with its Plugin**, as ADR-0010 has it.
- **The Campaign Mod is a catalog layer** over core's catalogs of the game's entries, read from its package while Kept and from its Blueprint once owned ([docs/reference/campaign-catalog.md](../reference/campaign-catalog.md)). So that a Campaign needs no Plugin for it, the Workspace config can name its Campaign Mod (`campaignMod`) as well as the Campaign Pack; when both do, they name the same one.
