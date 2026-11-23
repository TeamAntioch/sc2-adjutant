# Characters

A Campaign's characters are declared once, in its Campaign Mod's Mod Blueprint (`mods/<id>/blueprint.json`, [ADR-0011](../adr/0011-mods-from-mod-blueprints.md)). Two compiles read the declaration:

- **The mod compile** (`compile-mod`) writes each character into the mod's CharacterData as a CCharacter, through a Generic Entry. It's checked against the game's Data Schema, and a CCharacter that was Kept is converted under the Equivalence Check.
- **Mission compiles** name each Screenplay speaker from its character: the CCharacter its conversation lines name, what an off-map Transmission from it shows, and the placeholder voice `tts` speaks its lines in.

The code is `packages/core/src/domain/character.ts` (the declaration) and `packages/core/src/mods/characters.ts` (what it compiles to, and the Workspace's Campaign Characters, which Mission compiles read).

## A declaration

```json
"characters": [
  { "speaker": "SERGEANT", "id": "ExampleSergeant", "unit": "Marine", "voice": "Moira" },
  { "speaker": "ADJUTANT", "id": "ExampleAdjutant", "model": "AdjutantPortrait", "voice": "Reed (English (UK))" },
  {
    "speaker": "FOREMAN", "id": "ExampleForeman", "unit": "SCV", "model": "SCVPortrait", "voice": "Daniel",
    "fields": { "Variations": { "Name": "Character/Name/ExampleForeman/Var1", "Actor": "SCVPortrait" } }
  }
]
```

| Field | What it is | In CharacterData |
|---|---|---|
| `speaker` | The speaker as Screenplays write it. Matched ignoring case and extra spaces, so `Matt  Horner` is `MATT HORNER`. | none |
| `id` | Its CCharacter. Keep an imported id as it is: conversations name it. | the entry's `id` |
| `name` | The name its Transmissions show. Defaults to the speaker title-cased without spaces (`VAN DER BERG` is `VanDerBerg`). | none |
| `unit` | The unit type an off-map Transmission shows. | `<Unit value>` |
| `model` | The portrait model an off-map Transmission shows when there's no `unit`. | `<Variations Model>`, beside the other `Variations` fields |
| `voice` | The macOS `say` voice for its placeholder lines. | none |
| `fields` | Its other CharacterData fields (`Race`, `Gender`, `Age`, the rest of `Variations` …), written as a Generic Entry's. | as given |
| `strings` | The localized strings keyed to its CCharacter, by strings file: `Character/Name/<id>`, `VoiceRef`, `Description`, `Dialect`, and those its fields name (a `Variations` `Name`). `convert-entries` on CharacterData moves them in ([mod-strings.md](./mod-strings.md)). | the strings files' keys |

A speaker is declared once, and so is an `id`. `fields` can't hold `Unit` or a `Variations` `Model`, because `unit` and `model` say them. A character whose `model` is given has one `Variations`. Only a Campaign Mod declares characters.

A CCharacter is written once. A character and a Generic Entry (from `convert-entries`) for the same CCharacter fail the compile, and `convert-entries` leaves a declared character's CCharacter alone, but gives it its strings.

## Which speakers need one

Once the Campaign Pack (`contributions.campaignMod`) or the Workspace config (`campaignMod`) names a Campaign Mod, every Screenplay speaker needs a character. A speaker with none fails the Mission compile, `tts` and `check-workspace`, naming each such speaker once. `pull-screenplay` and `refresh-screenplay` still pull it, since the script at its Screenplay Source is the source of truth; `refresh-screenplay` follows its lines and moves the shots, then stops at the voices until the character is declared. If the Workspace hasn't imported the Campaign Mod named, its Blueprint can't be read, or it is an Asset Mod, every speaker fails that way and the message says which, so a Mission never compiles without its portraits and voices without saying so.

A Campaign whose Campaign Pack names no Campaign Mod has no characters. Its speakers speak with their names title-cased, no portrait off the map, core's default voice, and the naming template's `characterId` (or core's default) for their CCharacter.

## Where a Transmission's portrait comes from

A speaker the Mission Blueprint's `speakerAnchors` puts on the map speaks from that unit. Otherwise its Transmission shows the character's `unit`, else its `model`, else nothing. The Transmission's unit can differ from the one the Editor gave the CCharacter, as a hero's playable unit can from the story unit the Editor gave its CCharacter. That's an Accepted Difference in the Mod Blueprint, named `catalog-entry:Base.SC2Data/GameData/CharacterData.xml:CCharacter:<id>` with its reason.

## Before characters were declared here

Until ADR-0011, a Campaign Pack contributed its characters as a `characters` Contribution. That Contribution is gone: a Plugin manifest or code that still has one is refused with a pointer here. To move a Campaign's characters, copy each one into the Campaign Mod's Blueprint with its CCharacter id (from the naming template's `characterId`, or the mod's CharacterData), add the CharacterData fields the Editor gave it, then run `compile-mod` and name any intended difference it reports.
