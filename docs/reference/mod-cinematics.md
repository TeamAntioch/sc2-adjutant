# A Campaign Mod's Cinematics

A hub chat's or an interlude's scene is a **Cinematic**, as a Mission's is ([ADR-0009](../adr/0009-cinematics-from-shot-lists-and-sets-as-data.md), [ADR-0011](../adr/0011-mods-from-mod-blueprints.md)). It's a shot list on imported Sets, kept in the Campaign Mod's folder, and `compile-mod` writes it into the mod's `Cutscenes`, as the `.SC2Cutscene` file the scene's cue plays. Hand-built scenes and their Templates go away as their scenes convert.

The code is `packages/core/src/domain/mod-cinematic.ts` (the declaration, and a Set cutscene's), `packages/core/src/mods/mod-cinematics.ts` (reading, checking, timing and writing) and `packages/core/src/cutscene/compare-cutscenes.ts` (the comparison with a hand-built scene).

## A declaration

```json
"cinematics": [
  { "id": "sergeant-1", "conversation": "HubConversation-Sergeant", "scene": 1, "cutscene": "Conversation - Sergeant 1" }
]
```

| Field | What it is |
|---|---|
| `id` | Its shot list is `cinematics/<id>.json` in the mod's folder. |
| `conversation` | The Conversation whose lines it plays. One of the Blueprint's `screenplays` must compile it ([mod-screenplays.md](./mod-screenplays.md)). |
| `scene` | The scene, or group (`Group0000N`), whose lines it plays. |
| `cutscene` | The file's name in the package, without `.SC2Cutscene`. The compile writes `Base.SC2Data/Cutscenes/<cutscene>.SC2Cutscene`, the file the cue plays, so the cue needs no change. |

The shot list has the same format as a Mission's (`packages/core/src/domain/cinematic.ts`, and the `cinematography` skill's RECIPES.md). There are two differences:

- **Its lines are named by the Sound they play.** That is the Conversation's own Sound: the imported one, if the Screenplay's `importedSounds` keeps it. A shot cuts on `"line": "Hub-Conversation-Sergeant-01-002-Sergeant"`, the Sound the Editor shows, not the Screenplay Source's ID (`Hub-S-Sergeant-01-002-SERGEANT`).
- **Its Sets sit in the mod's folder** (`sets/<slug>.json`), like the mod's other sources. A Set outside the folder is refused.

## Its Sets

`import-set --mod <id>` brings a Set into `mods/<id>/sets/`. The richest source is usually the mod's own Kept cutscenes:

```text
npm run import-set -- --mod example --source campaign=mods/example "Ship Bridge" --file "Conversation - Sergeant 1"
```

Importing from the scene being rebuilt gives its cameras, its marks and its lamps, each lamp tied to the cameras it lit. It also gives the scene's ambience (each Sound looping all through the file), each character's look-at at another mark, and the lamps attached to a character, attached to their mark. A Sound that plays once, or for part of the scene, is listed as left out: it's a cue, for the shot list's `sounds`. Sergeant 1's Set brings in the bridge's two loops, the Adjutant's look-at at the Sergeant and her two approach fills on her overhead; its shot list plays `THanson02Briefing_Hyperion` and casts the Adjutant on her mark, starting at her path's start, so the look-at and the fills are hers. The MCP `import_set` tool takes `mod` in place of `mission`.

## Its cue

In one Campaign Mod, a hub chat's cue is a row of a cutscenes UserData (`Sergeant-SideConvo-1`). The row names the Conversation, the group and `Cutscenes\Conversation - Sergeant 1.SC2Cutscene`. `check-workspace` warns about a Cinematic whose file nothing in the mod's GameData, Triggers or Galaxy names, since it would never play.

## Timing

Lines run back to back from the end of the 1 s fade in, each as long as its voice file. The files are read from the Asset Mods the Campaign Mod depends on, as their packages hold them (a recording, or a placeholder). Ogg Vorbis and PCM WAV are both read. A line with no file yet is timed by the estimate, and both `compile-mod` and `check-workspace` report it, so compile the Asset Mod that voices a scene before the Campaign Mod. Recording a line moves the cuts with it.

## Replacing a hand-built scene

When a Kept cutscene of the same name is there, the compile converts it under the Equivalence Check. A rebuild never matches the Editor's file keyframe for keyframe (its guids, folders and curves differ), so it's compared by what plays, aspect by aspect. Each aspect that differs is a mismatch until the Blueprint names it as `file:<path>#<aspect>`:

| Aspect | Compared |
|---|---|
| `lines` | The conversation lines its ConversationDriver plays, in order |
| `speakers` | The model of the actor that says each line |
| `voices` | The Sound each line plays |
| `cameras` | The cameras it cuts to, in order, by name |
| `timing` | When each line starts and each cut lands, within 100 ms, and how long it runs |
| `actors` | Each actor's model, where it starts (to a thousandth of a cell) and its facing (to a hundredth of a degree) |
| `anims` | The animations each model plays |
| `lamps` | Each light's name and position (to a thousandth of a cell) |
| `light` | The base Lights it switches to |
| `sounds` | The sounds it plays besides the lines: each Sound, whether it loops and its volume |
| `nodes` | Which other kinds of track it has: a look-at, a follow path, an attachment, a fade |

Nodes the Editor switched off are left out, and so is an actor or light tied only to cameras the file doesn't have, which no shot shows. A thousandth of a cell is far above the rounding a position picks up through a Set's frame and far below the few hundredths that lift a z-fighting piece clear, so rounding doesn't show as a move and a real move does. Actors are compared where they start, and other tracks by their kind alone, so a look-at aimed elsewhere or a move later in the scene isn't seen. An Accepted Difference on the whole file is refused, since it would hide every aspect, and so is an aspect that isn't one of these. A Kept file that isn't a cutscene stops the compile, saying so. The check doesn't compare GUIDs, so the original's aren't kept. Nothing outside the file refers to them: the cue names the file.

## Set cutscenes

A Set cutscene is one of the mod's Sets written back as a cutscene with no shots, so the author can still open the room in the Cutscene Editor once its hand-built file is gone. The code is `packages/core/src/cutscene/set-cutscene.ts` (the writer) and `packages/core/src/mods/sync-mod.ts` (bringing an Editor change back).

```json
"setCutscenes": [
  { "cutscene": "Set - Ship Cantina", "set": "sets/ship-cantina.json", "lengthMs": 262233 }
]
```

| Field | What it is |
|---|---|
| `cutscene` | The file's name in the package, without `.SC2Cutscene`, as a Cinematic's is. A Cinematic and a Set cutscene can't write the same file. |
| `set` | The Set it shows: a Set file in the mod's folder. |
| `lengthMs` | How long its timeline runs in the Editor; a minute when left out. Give the hand-built file's length to convert it with no `timing` difference. |

It holds what the Set holds, where the Set's source file had it (the Set placed at its provenance origin):

- the pieces, in a folder named for the Set;
- the characters on its marks, in a `Characters` folder, each looking at its mark's look-at all through;
- its cameras, with no cut to any;
- its lamps, tied to the cameras they lit, and riding the character a lamp is attached to;
- its ambience, looping;
- its base Lights, each for an equal share of the timeline, in turn.

A mark seen through none of the Set's cameras isn't written, and neither is a piece or lamp tied only to cameras the Set doesn't have. `import-set` reads the file back as the same Set, except for what no cutscene holds: a piece's id, a camera's `moves`, and the Set's name and provenance.

**Replacing a hand-built Set file.** A Kept cutscene of the same name is converted under the Equivalence Check, aspect by aspect, as a Cinematic's is. A Set imported from the file it replaces comes out the same. A Set imported from a richer scene holds that scene's cast, lamps and ambience too, and each such aspect is an Accepted Difference.

**An Editor change.** A Set cutscene the Editor saved since the last compile stops the compile, which says to run sync. `npm run sync -- mods/<id>/blueprint.json` (the MCP `sync_mod` tool) imports each changed one again into its Set:

- in the Set's own frame, so the Cinematics that place it don't move;
- keeping piece ids (matched by model where the piece stood, else by model in order), cameras' `moves`, and the Set's name and provenance;
- then taking the saved file into the compile record, so the next compile writes the Set over it.

`--discard file:<path>` overwrites the change instead. Only the Set's room is read: something the author adds outside the Set's folders, or an effect or helper model, isn't a piece and doesn't come back.

**An example.** In one Campaign Mod, `Set - Ship Bridge`, `Cantina` and `Engineering` are Set cutscenes. Cantina's and Engineering's Sets are imported from their own files. The bridge's is the one Sergeant 1 is filmed on, imported from that scene. So the bridge's Set cutscene also holds Sergeant 1's cast, lamps, base Lights, ambience, the Adjutant's look-at and her attached fills, and its two planet backdrops in place of the hand-built file's starfield, each named as an Accepted Difference.

## Templates

A Template (`Template - Bridge`) is a hand-built starting point that the Editor's scenes were copied from. Nothing plays it. It stays Kept while any scene built from it is still hand-built. It's removed with the last of those scenes, once that scene is a Cinematic, as an Accepted Removal in the Mod Blueprint's `removals` (`file:Base.SC2Data/Cutscenes/Template - Bridge.SC2Cutscene`, with its reason). For the bridge, that means after the last five hub chats filmed on it.
