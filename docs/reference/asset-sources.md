# Asset Sources

An Asset Mod holds a Campaign's art and audio files and nothing else ([ADR-0011](../adr/0011-mods-from-mod-blueprints.md)). The tooling can't make a model or record a voice, so the mod is assembled: its Mod Blueprint names the **Asset Source** of each file, and `compile-mod` makes each file from it, in place in the committed package. A file the Blueprint doesn't name stays Kept, as Import left it.

## The four kinds

```jsonc
// mods/<asset mod>/blueprint.json
"assets": [
  // A Workspace file: in the mod's folder (so Git LFS tracks it, as import-mod set up), with its SHA-256.
  { "path": "Base.SC2Assets/Assets/Textures/Gull_Diffuse.dds", "source": { "file": "art/Gull_Diffuse.dds", "sha256": "…" } },
  // A community asset: where it's published, which version, its licence and its SHA-256.
  { "path": "Base.SC2Assets/Assets/Models/Crane/Crane.m3", "source": { "url": "https://…/Crane.m3", "version": "1.2", "licence": "CC-BY-4.0", "sha256": "…" } },
  // A community asset in a zip (as CurseForge packs download): the member is the file's path in the archive, the SHA-256 the archive's.
  { "path": "Base.SC2Assets/Assets/Textures/Crane_Diffuse.dds", "source": { "url": "https://…/crane-pack.zip", "version": "1.2", "licence": "CC-BY-4.0", "sha256": "…", "member": "Crane Pack/Assets/Textures/Crane_Diffuse.dds" } },
  // A generated placeholder: text-to-speech of a Sound ID's line, in its character's voice.
  { "path": "Base.SC2Assets/Assets/Sounds/Radio.wav", "source": { "generated": "tts", "sound": "H-01-003-DOCKHAND" } },
  // A derived file: another Asset Source, made by a named step.
  { "path": "Base.SC2Assets/Assets/Sounds/Gull.ogg", "source": { "derived": "wav-to-ogg", "from": { "file": "sounds/Gull.wav", "sha256": "…" } } }
]
```

| Kind | Made from | Committed |
|---|---|---|
| Workspace file | the file in the mod's folder, refused unless its SHA-256 is the recorded one (`check-workspace` reports it too) | yes |
| community asset | `<cacheDir>/community-assets/<sha256>/<name>` in the machine's cache, fetched there the first time; a download with another SHA-256 is refused and not cached | no |
| generated | `mods/<id>/placeholders/<Sound>.wav`, written by the machine's Host Adapter (`tts.speak`, the macOS one uses `say`) in the voice the speaker's [character](./characters.md) declares, or silence of the line's length on a machine that can't speak or when speaking a line fails (with a warning; a placeholder it spoke before is kept); a manifest there skips unchanged lines and makes a changed one again, as `npm run tts` does for a Mission | no |
| derived | its source, made by the step: `wav-to-ogg` encodes Vorbis with ffmpeg (libvorbis when ffmpeg has it, else its own encoder, in stereo), with no metadata, so the same input gives the same file; each output is cached by its input's SHA-256 in `<cacheDir>/derived/` (the system's temporary folder without a cacheDir), so it is encoded once, and a Mission's voice files are made by the same step ([screenplay-format.md](../screenplay-format.md#voice-files)). ffmpeg's own Vorbis encoder never finishes a WAV with no samples: it writes output, about 1.2 MB a second, until it is killed, and ignores SIGTERM, so the step gives it one silent sample frame instead. Every run is bounded, so a run that goes wrong some other way is stopped: a timeout of a minute plus twice the input's length, then SIGKILL; an output cap the kernel enforces (`ulimit -f`), well past what the input could make; and the run is killed when the process that started it ends, however it ends | as its source |

The SHA-256 is the hash Git LFS stores a file by, so a Workspace file and the same file in the package are one LFS object.

A community asset's archive is fetched once into the cache, whatever number of members the Blueprint takes from it. Its members are read stored or deflated, and a member the archive doesn't have fails the compile with the names it does have. A member's format is its own extension, so a `.wav` member for an ogg voices folder is refused like any `.wav` recording.

### Origins

A Workspace file can say where its content came from when it isn't the team's own work. An origin is provenance only: the file is still made from the Workspace, committed, and checked against its hash.

```jsonc
{ "file": "assets/…/storm_effect_slow.m3", "sha256": "…", "origin": { "kind": "port", "of": "Heroes of the Storm", "owner": "Blizzard Entertainment", "by": "the Campaign's team" } }
{ "file": "assets/…/NanaKey_BG_TerrainGroup01.m3", "sha256": "…", "origin": { "kind": "community", "credit": "NanaKey", "site": "SC2Mapster" } }
```

- **port:** another game's asset, brought into SC2 by someone. `of` is the game, `owner` its rights holder, `by` who ported it.
- **community:** a community asset whose file is kept in the Workspace, since there's nothing to fetch it from: `credit` is who made it, with `site` and `url` when they're known. A community asset you can fetch is its own Asset Source, with its address and licence, and isn't committed.

## Converting an Asset Mod in bulk

`convert-assets` (the `convert_assets` tool) declares an Asset Mod's Kept art and audio files (everything in its `.SC2Assets` folders) as Workspace files. Each is copied into the mod's folder as `assets/<path in the package>`, which is the same LFS object as the package's copy, and listed in `assets` with its SHA-256. The next `compile-mod` converts them under the Equivalence Check. A file that's a Git LFS pointer this machine hasn't pulled stays Kept, with the reason.

```sh
npm run convert-assets -- mods/<id>/blueprint.json [--path <file>]... [--suspect <glob>]... [--origins <origins.json>]
```

Which files came from somewhere else can't be told from their bytes. So the step lists, for the author's provenance and licence check, every Workspace file with no origin whose name suggests another: Heroes of the Storm's `storm_` prefix always, and each `--suspect` glob. The author's answers go in an origins file, a JSON array of `{ "match": <glob>, "origin": <origin> }`, and each is recorded on every Workspace file it matches, whether it's converted in this run or an earlier one. A later rule wins over an earlier one for the same file, and a rule that matches nothing is refused before anything is written. In a glob, `*` is any run of a name, `**` any run of folders and `?` one character, matched in any case; a glob without a slash matches a file's name alone.

Other whole files go through `convert-files` (the `convert_files` tool). By default it takes the Kept Galaxy scripts, UI layouts and font styles, but not `UI/Layout/DescIndex.SC2Layout`, which the compile generates from the layouts in `files` ([ADR-0019](../adr/0019-ui-components-from-sc2layout.md)); `--path` names any other file. Each is copied into the mod's folder at its path less `Base.SC2Data/` (`scripts/…`), the place `convert-library` copies a native function's script. It leaves the `Lib<id>.galaxy` the Editor generates for a library in Triggers, which the library interface owns. A later `convert-library` takes a native function's script out of `files`, keeping its source, so one writer writes it.

## Voices

A conversation's voice files are declared once, a line at a time:

```jsonc
"voices": [{
  "conversation": "ExampleConversation-Dockhand",          // a Screenplay of the Workspace's Campaign Mod compiles into it
  "groups": [1],                                           // its scenes (Group0000N) voiced here; all when left out
  "folder": "Base.SC2Assets/Assets/Sounds/Conversations",
  "format": "ogg",                                         // or wav
  "recordings": {
    "D-Conversation-Dockhand-01-002-Dockhand": { "file": "voices/D-Conversation-Dockhand-01-002-Dockhand.ogg", "sha256": "…" }
  }
}]
```

Each line gets `<folder>/<Sound>.<format>`, named for the Sound it plays: its imported Sound (the Campaign Mod Screenplay's `importedSounds`), else the naming template's. **A recording wins over a placeholder**: a line gets a generated placeholder (derived to `.ogg` for an ogg folder) only when the Blueprint records no recording for it. The compile lists each placeholder with its line (`Placeholder voice: …, for Line02001 (DOCKHAND), since it has no recording`), and while a placeholder replaces a Kept file, the Equivalence Check's mismatch names the line the same way. A recording for a Sound no line plays is refused, and so is one whose file isn't in the folder's format (a `.wav` recording for an ogg folder is given as `{ "derived": "wav-to-ogg", "from": … }`), by the compile and by `check-workspace`.

Whether a voice file is committed follows from the Blueprint, never from what this machine has. A line with a recording is committed, so a machine that doesn't have the recording's Workspace file (it isn't there, or it's a Git LFS pointer that hasn't been pulled) never writes a placeholder over it: the compile leaves the package's voice file and its compile record entry as they are, and warns, naming the line (`Line01002 (DOCKHAND)'s recording voices/… isn't there: … is left as the package has it until it's back`). `check-workspace` doesn't count it as a problem. Once the file is back, the next compile writes the recording (converting the Kept file, if it was one).

## Kept out of git

A file made from anything but Workspace files (a community asset, a placeholder, or one derived from them) is **uncommitted**: each machine makes its own, so it's on the compile record as `{ "kind": "uncommitted", "path" }`, without a fingerprint, and a fresh clone that doesn't have it gets it from the next compile without it counting as an Editor change. The compile writes `mods/<id>/.gitignore`, beginning `# Written by compile-mod`, listing `placeholders/` and each uncommitted package file (its `*`, `?`, `[` and `\` escaped, so each pattern matches that file alone), and removes it when there's nothing left to ignore. A `.gitignore` there that the author wrote is left alone, and a compile that would make uncommitted files beside it stops before writing anything. A compile that stops still leaves the placeholders it spoke in `placeholders/`, and the community assets it fetched in the cache.

A file git already tracks stays tracked, since `.gitignore` doesn't untrack one, such as a Kept file the Import committed that a placeholder now stands in for. The compile warns about each, with the `git rm --cached` that untracks it, since otherwise the next commit records this machine's file over the one git has.

## Sound sets

A Campaign Mod's **sound set** compiles the SoundData entries of a conversation's lines, one CSound per line, as Generic Entries, from the voice files the Asset Mods it depends on declare (its `dependencies` name them, `file:Mods\<Name>.SC2Mod`). Each CSound is in one of the two forms the Editor writes.

The **template form**, when the set gives a `template`, is a child of a dialogue parent that takes the line's tokens:

```jsonc
// mods/<campaign mod>/blueprint.json
"soundSets": [{
  "conversation": "ExampleConversation-Dockhand",
  "groups": [1],                                             // its scenes (Group0000N); all when left out
  "parent": "Dialogue_Campaign",                                // takes the Subtitle, Template, Speaker and Line tokens
  "template": "Assets\\Sounds\\^TemplateParam1^.ogg",        // the parent's AssetArrayTemplate File
  "facialAnim": "##id##",                                    // the default; a line's own in facialAnims
  "facialAnims": { "Line01002": "QahiraBase_Pissed00" }
}]
```

```xml
<CSound id="D-Conversation-Dockhand-01-002-Dockhand" parent="Dialogue_Campaign" Subtitle="ExampleConversation-Dockhand"
        Template="Conversations\##id##;QahiraBase_Pissed00" Speaker="CharDockhand" Line="01002"/>
```

The voice file's game path (the package path without `Base.SC2Assets/` or `Base.SC2Data/`) is fitted to the template, and the Sound's own id is written `##id##`, as the Editor does.

The **AssetArray form**, when the set gives no `template`, writes the file in full, on any parent. `attributes` and `fields` are what else each CSound has (they work in the template form too):

```jsonc
{
  "conversation": "ExampleConversation-Quartermaster",
  "parent": "Campaign",
  "attributes": { "Actor": "" },
  "fields": { "Category": "Dialogue", "Mode": "2D" }
}
```

```xml
<CSound id="D-Conversation-Quartermaster-01-001-Quartermaster" parent="Campaign" Subtitle="ExampleConversation-Quartermaster" Speaker="CharQuartermaster" Actor="" Line="01001">
    <AssetArray index="0">
        <File value="Assets\Sounds\Conversations\D-Conversation-Quartermaster-01-001-Quartermaster.ogg"/>
        <FacialAnim value=""/>               <!-- facialAnims, else facialAnim, else none -->
        <FacialGroup value=""/>
        <PortraitModel value=""/>
        <Speaker value="ConversationState/Characters/CharQuartermaster"/>
        <Subtitle value="Conversation/ExampleConversation-Quartermaster/Line01001"/>
    </AssetArray>
    <Category value="Dialogue"/>
    <Mode value="2D"/>
</CSound>
```

A line in another form than the set's has its own in `lines`, by line id: its `parent`, `template` (if any), `attributes` and `fields`, in place of the set's. One interlude's three lines for a hero are on `Dialogue_Campaign_2D` with `Portrait="HeroPortrait"`, while the rest of it gives the AssetArray in full:

```jsonc
"lines": { "Line02003": { "parent": "Dialogue_Campaign_2D", "template": "Assets\\Sounds\\^TemplateParam1^.ogg", "attributes": { "Portrait": "HeroPortrait" } } }
```

Each CSound's name, `Sound/Name/<id>` in enUS `ObjectStrings.txt`, is the sound set's, as an entry owns its strings ([mod-strings.md](mod-strings.md)). It's the CSound's id, as the Editor names a sound it creates (`Sound/Name/D-Conversation-Pilot-01-008-Pilot=D-Conversation-Pilot-01-008-Pilot`), so the sound set doesn't store it, and the Equivalence Check compares it with the Kept name.

A line whose Sound has no Asset Source in those Asset Mods fails the compile, naming it, and so does a voice file that doesn't fit its template. `convert-entries` leaves a CSound a sound set writes Kept, so the two convert in either order. It reads the Screenplays to tell which CSounds those are, so it stops, converting nothing, when it can't read them.

### convert-sound-set

`npm run convert-sound-set -- <campaign blueprint.json> <conversation>` (MCP `convert_sound_set`) writes a converted Screenplay's sound set, and its voices in the Asset Mod that holds its voice files, from each line's Kept CSound and voice file:

- A CSound with a `Template` is the template form, its template the parent's `AssetArrayTemplate` File (the parent, or a parent of its, in the same SoundData). One with its AssetArray in full is the AssetArray form. The most common form is the set's, and a line in another goes in `lines`.
- Each line's voice file becomes its recording. If the Asset Mod declares the file in `assets`, that declaration moves into `voices`. Otherwise the package's file is copied to `voices/<Sound>.<format>` in the Asset Mod's folder with its SHA-256, the same Git LFS object.
- A voice file that's a **Git LFS pointer** (not pulled on this machine) is recorded by the SHA-256 it points to, and the pointer is copied. The Asset Mod's compile then holds the line's file as the package has it until the recording is pulled, so a voice is never written over without its recording.
- A line with no voice file in the package gets a placeholder until it's recorded, and the tool lists it. A line with no words gets silence: a placeholder is never spoken for it.
- A line CSound that `convert-entries` wrote as a Generic Entry moves into the sound set.
- Each line CSound's name leaves the Kept strings for the sound set, and the tool lists them. A name in the Blueprint's raw `strings`, or in a moved CSound's strings, is taken out of them; any other string the moved CSound held stays the Blueprint's, as a raw string. A Kept name that isn't the CSound's id is listed as a difference. A name `removals` names refuses the conversation, since the sound set would write it back, and so does a moved CSound's string that the raw strings give with other text.
- What the compile will still find different from a Kept CSound, such as a `Line` the Kept CSound doesn't share with its renumbered line, is listed, for an Accepted Difference.
- A CSound no sound set can write refuses the conversation, and nothing is written. Examples: an AssetArray with a FacialGroup or PortraitModel, more than one AssetArray, a Template whose parent gives no file, or voice files in two folders or two Asset Mods. Each one is named.

Compile the Asset Mod first, then the Campaign Mod.

## A Campaign's conversations, converted

A Campaign's first hub chat (one conversation's Group00001) was the first conversion: a fixture Workspace declared its ten recordings in the Asset Mod, with the hashes of that mod's own files, and its sound set in the Campaign Mod. Moving the recordings into the Asset Mod's `voices/` and compiling both mods left the Asset Mod and SoundData byte-identical.

All 13 of that Campaign's conversations convert this way: 556 line CSounds and their voice files. 543 of the CSounds give their AssetArray in full, on the game's `Campaign` (hub chats) or `Campaign2D` (interludes). The other 13 use the template form: the first hub chat's ten on the Campaign's own dialogue parent, and an interlude's three lines for a hero on its 2D sibling with a portrait. Both packages come out byte-identical. The one line with no voice file had no words. The author cut it at the Source, so 555 CSounds are left, each with its recording.

On a copy of the Workspace (2026-11-02), `convert-assets` took all 2,171 files of the Asset Mod's `Base.SC2Assets`, and its recompile left the package byte-identical. The origins file below records the author's answers: the team ported the HotS effects (`storm_effect_*`, `storm_fx_*`) and a hero's D.Va sounds from Heroes of the Storm, and NanaKey made the `NanaKey_*` files, published on SC2Mapster, with no licence check needed:

```json
[
  { "match": "Base.SC2Assets/Assets/Effects/storm_effect_*/**", "origin": { "kind": "port", "of": "Heroes of the Storm", "owner": "Blizzard Entertainment", "by": "the Campaign's team" } },
  { "match": "Base.SC2Assets/Assets/Effects/storm_fx_*/**", "origin": { "kind": "port", "of": "Heroes of the Storm", "owner": "Blizzard Entertainment", "by": "the Campaign's team" } },
  { "match": "Base.SC2Assets/Assets/Sounds/Heroes/<hero>/dva_*.wav", "origin": { "kind": "port", "of": "Heroes of the Storm", "owner": "Blizzard Entertainment", "by": "the Campaign's team" } },
  { "match": "NanaKey_*", "origin": { "kind": "community", "credit": "NanaKey", "site": "SC2Mapster" } },
  { "match": "storm_*", "origin": { "kind": "port", "of": "Heroes of the Storm", "owner": "Blizzard Entertainment", "by": "the Campaign's team" } }
]
```

That records 173 origins. With `--suspect 'NanaKey_*' --suspect '*DVa*' --suspect '*Fenix*'`, 111 files are still listed. All but `Storm_CrystalR.dds` have the `storm_` prefix. They include HotS hero models and textures (Ana, Jaina, Zagara, D.Va, Zeratul and Nexus Hunter), the AoE cursors and their textures, the `storm_doodad_sczion*` thug models, and effect textures. The author confirmed they're all the team's port from Heroes of the Storm, so the last rule gives every `storm_` file that origin. A glob has no `[…]` classes, but matching ignores case, so `storm_*` also covers `Storm_CrystalR.dds`. With it, no file is listed, and the Asset Mod has one Kept file left, `PreloadAssetDB.txt` (see [data loading](data-loading-and-dependencies.md#does-the-game-need-preloadassetdbtxt)). Once applied to the Workspace, the Asset Mod also owns `TextureReduction/TextureReductionValues.txt` as a plain file.
