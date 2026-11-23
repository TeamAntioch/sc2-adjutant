# A mod's localized strings

A mod's localized strings are generated, never authored ([ADR-0011](../adr/0011-mods-from-mod-blueprints.md)). Each one belongs to what it names: a catalog entry's strings to the entry, a Screenplay's lines and its Conversation's name to the Screenplay, a sound set's CSounds' names to the sound set, the library's names to the library, the triggers' text values to the triggers, a UI layout's text to the layout, and the mod's own name to the Mod Blueprint. The Blueprint's raw `strings` are for what nothing else owns yet.

## The strings files

The Editor writes a mod's strings, per locale, in `<locale>.SC2Data/LocalizedData/`:

| File | Holds |
|---|---|
| `GameStrings.txt` | Text the game shows: `Unit/Name/<id>`, `Button/Name/<id>`, `Button/Tooltip/<id>`, `Effect/Name/<id>`, UserData text, `DocInfo/Name` … |
| `ObjectStrings.txt` | Names only the Editor shows: `*/EditorPrefix/<id>`, `*/EditorSuffix/<id>`, `Sound/Name/<id>`, `Actor/Name/<id>`, `Model/Name/<id>`, `Validator/Name/<id>` … |
| `GameHotkeys.txt` | `Button/Hotkey/<id>` |
| `ConversationStrings.txt` | A Conversation's group titles and lines, and sometimes a character's strings |
| `TriggerStrings.txt` | The library's names (the library interface's, [library-interface.md](./library-interface.md)) |

Which file a string is in can't be told from its key. In one Campaign Mod, `Behavior/Name` is in GameStrings for 56 entries and in ObjectStrings for 47. Most `Character/Name` and `Character/VoiceRef` strings are in GameStrings, but five characters' are in ConversationStrings. So an entry records each string with its file.

## An entry's strings

A Generic Entry, or a declared character, holds the strings keyed to it, by file:

```json
{
  "catalog": "Button", "class": "CButton", "id": "Quay", "fields": {},
  "strings": {
    "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Button/Name/Quay": "Open Quay", "Button/Tooltip/Quay": "Opens the quay." },
    "enUS.SC2Data/LocalizedData/GameHotkeys.txt": { "Button/Hotkey/Quay": "Q" }
  }
}
```

A string is keyed to an entry in one of three ways:

- **By its catalog's convention:** `<Catalog>/<Field>/<id>`, where `<Catalog>` is the entry's catalog and `<id>` its id. Examples are `Unit/Name/Crane`, `Unit/LifeArmorName/Crane`, `Effect/EditorPrefix/Strike` and `Button/Hotkey/Quay`.
- **By a default of its class in another catalog's strings:** a CUnit's `Description` is `Button/Tooltip/<id>` (Core's CUnit default, `Button/Tooltip/##id##`), the unit's description the game shows, unless the unit sets its own `Description`. It's the only default in Core's catalogs keyed under another catalog's name. When the mod has a button of the unit's id, the key is that button's tooltip too, and it goes with the button.
- **By a field naming its key:** a key that one of the entry's fields holds as text, in the entry's own catalog's strings, in no catalog's, or in another catalog's that names no other entry's id (below). Examples:
  - a CUser's text, `<Text Text="UserData/DebugCommands/Help_Name">`;
  - a CConversationState's names, `<Indices Id="CharHal" Name="ConversationState/Characters/CharHal">`;
  - a character's variation, `<Variations Name="Character/Name/CharEnvoy/Var1">`;
  - a look-at type, `<Types Name="LookAtType/EnvoyLookAt">`;
  - a shared hotkey, `Button/Hotkey/AbilE`.

  A key in another catalog's strings is the entry's only when it names no other entry's id: it has no id (an ability's `Activity`, `Weapon/EnvoyWeaponCharging`), or its id is the entry's own (the `EnvoyBeaconTarget` actor's `HighlightTooltip`, `Unit/Name/EnvoyBeaconTarget`, when the mod has no unit of that id). A CSound's `Subtitle` names its conversation line's text, which is the Conversation's. Only the mod's own entries are looked at: a key naming a dependency's entry, such as a dependency's unit's name, would go to the entry that names it.

A key that the convention gives to an entry of the mod belongs to that entry, even when another entry names it. A button can share another button's tooltip, but the tooltip moves with its own button, and a unit's name goes with the unit, not with its actor of the same id. `convert-entries` makes that choice. The compile takes a key from any entry it's keyed to, and refuses two entries that write it differently. The compile refuses an entry's string that isn't keyed to it, or one in a file that isn't a localized strings file, and lists each with the entry's other problems. An entry's strings are checked against the Kept ones they replace, as raw strings are.

## Converting them

`convert-entries` moves the strings with the entries. Each entry it converts takes the strings keyed to it, from the package's Kept strings or from the Blueprint's raw `strings`, and they leave the raw ones. Each entry of the file that the Blueprint already writes takes its strings too, whether it's a Generic Entry or a declared character's CCharacter, compiled yet or not. So running it again over a file gives entries converted earlier the strings they didn't take then.

It leaves what another writer owns:

- TriggerStrings, which is the library's;
- a key the compile record lists that no raw string gives, which a Screenplay or the library wrote;
- a raw string in a file that isn't a localized strings file;
- a line with no `=`, which holds no string;
- the DocInfo strings. A character's strings go in its declaration in `blueprint.json`, and a Generic Entry's in its source.

Run it on a file's CConversations only once the Screenplays that own them are declared (#330). Otherwise each one converts as a Generic Entry.

## A sound set's names

A sound set owns the name of each line CSound it writes, `Sound/Name/<id>` in enUS `ObjectStrings.txt`. The name is the CSound's id, as the Editor names a sound it creates, so it's generated rather than stored ([asset-sources.md](asset-sources.md#sound-sets)). `convert-sound-set` takes a converted conversation's names out of the Kept strings, the raw `strings` and the CSounds it moves from the Generic Entries. A Kept name that isn't the id is a difference, for an Accepted Difference. The names of CSounds that aren't lines (`DialogueSoundBase`, `Envoy_Movement` …) are still Kept or a Generic Entry's.

## A Screenplay's name

A Screenplay owns its Conversation's name, `Conversation/Name/<conversation>` in enUS `ObjectStrings.txt`, the name the Editor lists it by (a cutscene's Conversation Driver is `Conversation Driver (<name>)`, and `(<id> (Unnamed))` without one). The name isn't the id, so the Screenplay's declaration records it as `name` ([mod-screenplays.md](./mod-screenplays.md#a-declaration)). The compile writes it as the CConversation's own string, under the Equivalence Check, and `convert-screenplay` takes the Kept one, or the raw string, which then leaves the raw `strings`.

In one Campaign Mod, the six hub chats' Kept names are `Side Conversations: <Name>`. The interludes had none: their names were Kept under bare keys, `<Prefix>Interlude1-01=Interlude 1-01`, which nothing reads. A stray `Conversation/Name/<Prefix>Interludes` named no Conversation. The author decided (#366, 2026-11-02) to fix the key: each interlude's declaration records `Interlude <e>-<m>`, written as `Conversation/Name/<Prefix>Interlude<e>-<m>`. The bare keys and `Conversation/Name/<Prefix>Interludes` are removals.

## The triggers' text values and a layout's strings

Three owners write strings by key, not by entry, each in the strings file the package has it in, under the Equivalence Check:

- **The Blueprint's triggers** own their text parameters' values. A `Param` element whose `ValueType` is `text` keeps its text in enUS GameStrings as `Param/Value/lib_<library>_<id>`, which the Editor shows in the trigger and its Galaxy reads with `StringExternal`. They go in `triggers.strings`, by file.
- **The library interface's functions** own theirs the same way (#945): a text value in a function's GUI body, a parameter's default or a local's initial value keeps its text under the same key. They go in `library.strings`, by file. An empty text's key holds nothing or is absent, and its Galaxy is `StringToText("")` ([editor-trigger-rules.md](editor-trigger-rules.md#text-values)). A text expression's words, with their `~<code>~` slots, are kept the same way under `Param/Expression/lib_<library>_<id>` (#946), the triggers' as the functions' ([editor-trigger-rules.md](editor-trigger-rules.md#expressions)).
- **A file in the Blueprint's `files`** owns the strings it names as `@<key>`, as a UI layout's `<Text val="@UI/CreditItemBase/Actor"/>` does. They go in the file's `strings`, by file. `convert-files` takes them for UI layouts (`.SC2Layout`) only.

The compile refuses a key that isn't one of those: a value of a parameter that isn't a text one of the triggers, or of the library's functions, or a string the file doesn't name. `convert-triggers`, `convert-library` (for the functions it converts) and `convert-files` take them from the Kept strings or the raw `strings`, which they leave. Each run gives triggers or files the Blueprint already has the strings they didn't take then. A key `removals` names stays removed. A key another owner holds (an entry, a character, the triggers or another file), or one the last compile wrote for another writer, stays that owner's. TriggerStrings and the `DocInfo/` strings are never taken.

## DocInfo

The Mod Blueprint's `name` and `description` (`short`, `long`) are the mod's `DocInfo/Name`, `DocInfo/DescShort` and `DocInfo/DescLong` in enUS GameStrings. The compile writes the ones given, and a raw string can't give them too. `convert-entries` leaves the Kept DocInfo strings to them.

## What's left to raw strings in a real Campaign Mod

On a throwaway copy of a real Campaign Mod, with every catalog file but ConversationData converted (2026-11-02), 3,016 of the 3,273 strings in GameStrings, ObjectStrings and GameHotkeys went into their entries. The 20 Character and ConversationState strings in ConversationStrings went into theirs, and DocInfo came from the Blueprint. The 254 strings no entry is keyed to are:

| Count | What | Belongs to |
|---:|---|---|
| 208 | Strings of entries the mod no longer has, or of another catalog's id (`Abil/Name/<Hero>WeaponChargeModeAbil12`, `Actor/Name/Footprint_FS`, which is a CSound) | an accepted removal (#326) |
| 18 | `Param/Value/lib_<Lib>_*` and `lib<Lib>_*_Init_Func/` | the library (#329) |
| 10 | `Sound/Name` of one character's sound-set CSounds | the sound sets (#331) |
| 7 | `Conversation/Name/<id>` | the Conversations (#330) |
| 9 | Keys of no catalog form (`CustomArms`, `DOCSTR_0000`, `<Prefix>Interlude1-01` …) | an accepted removal, or the Conversations |
| 2 | `UI/CreditItemBase/*` | the UI layout that names them |

Applied to the Workspace (2026-11-02), the author confirmed 144 of these as removals: strings of entries the mod doesn't have, old group names, `Line00001` keys, and the SVN lines and deleted triggers' names in TriggerStrings. 671 strings are still Kept, and none of them waits on the author:

| Count | What | Waits on |
|---:|---|---|
| 556 | `Sound/Name` of the line CSounds | tooling: a sound set doesn't own its CSounds' names (since #365 it does; see above) |
| 50 | Strings whose key names an entry the mod doesn't define under that key (`Button/Tooltip/<Hero>`, `LookAtType/*`, `lib<Lib>_*_Init_Func`) | 10 tooling (since #371 their entries own them; see below), 40 the author (below) |
| 14 | `Conversation/Name/<id>` and the `<Prefix>Interlude*` keys | tooling (since #366 the Screenplay owns the name; see above) |
| 52 | UserData text (`DebugCommands`, `<Ship>_Clickable`, `<Ship>Rooms` …), `Param/Value/lib_<Lib>_*`, `UI/CreditItemBase/*` | 16 tooling (since #370 the triggers and the layout own them; see above), 36 the author (below) |

Of those 52, 36 aren't waiting on tooling: they're Editor leftovers that nothing in the mod names, so no owner can write them (#370, 2026-11-02). They're proposed as removals on #370 and stay Kept until the author confirms them:

- 35 UserData strings whose instance, field or CUser is gone or renamed. Examples: `DebugCommands/Blizzard_*` (no such instance), `(Un)Pause Units_Message` (no Message field), `<HeroUser>/<Hero>NaniteInjector_Name` (now `<Hero>NaniteRoundInjector` and `<Hero>NaniteGrenade`) and `<Ship>Rooms/*` (the CUser is `<Ship>_Rooms` now, whose own strings its entry already writes).
- `Param/Value/lib_<Lib>_0B4F501E`: its parameter, in `playTalkingTransmission`, is a preset now.

The UserData entries already write every string their fields name. The 14 other `Param/Value` strings are the text parameters of the disabled trigger `TestFade`, and `UI/CreditItemBase/*` is named by the mod's templates layout (`<Prefix>Templates.SC2Layout`).

Of those 50, 10 are strings of entries the mod has, 9 of them text the game shows, and that entry now owns each: the descriptions of 8 units, `Button/Tooltip/<unit>` (the heroes' biographies, and that of the heroes' parent unit, which only the Editor shows), an actor's highlight tooltip and an ability's activity, `Weapon/<id>`. The other 40 are 8 Editor leftovers and 32 dead strings, proposed as removals and Kept until they are confirmed.
