# A Campaign Mod's Screenplays

A Campaign's interludes and hub chats are Screenplays, kept where its Missions' are (its Screenplay Source, if its Campaign Pack contributes one) and compiled into its Campaign Mod's Conversations ([ADR-0011](../adr/0011-mods-from-mod-blueprints.md)). The Campaign Mod's Mod Blueprint (`mods/<id>/blueprint.json`) names each one in `screenplays`, and `compile-mod` writes it with the **conversation shape**: a Generic Entry in ConversationData, and strings in ConversationStrings.

The code is `packages/core/src/domain/mod-screenplay.ts` (the declaration), `packages/core/src/mods/conversations.ts` (the shape and the pull) and `packages/core/src/mods/convert-screenplay.ts` (the convert step).

## A declaration

```json
"screenplays": [
  {
    "ref": "act_rxw3fen1zh5kwx87",
    "source": "screenplays/HubConversation-Sergeant.md",
    "conversation": "HubConversation-Sergeant",
    "name": "Side Conversations: Sergeant",
    "overlapPrevious": 500,
    "importedSounds": { "Line01001": "Hub-Conversation-Sergeant-01-001-Adjutant" }
  }
]
```

| Field | What it is |
|---|---|
| `ref` | What the Screenplay Source knows it by, such as an interlude's act, or a character's side-conversations act, whose scenes are that character's hub chats. Left out when the Campaign has no Screenplay Source. |
| `source` | The Screenplay file in the mod's folder. With a Source, it's the pulled copy, which `pull-screenplay mods/<id>/blueprint.json` refreshes: edit at the Source, never here. Without one, it is the Screenplay. Each Screenplay has its own file (compared without case, as macOS and Windows compare names). |
| `conversation` | The CConversation it compiles into. One Screenplay writes each Conversation. |
| `name` | The name the Editor lists the Conversation by, such as in a cutscene's Conversation Driver: `Conversation/Name/<conversation>` in enUS `ObjectStrings.txt`. It isn't the id, so it's recorded here. `convert-screenplay` fills in the Kept one; a Conversation with none (an interlude whose name was Kept under a bare key, for one) gets one by hand. Left out, the compile writes no name, and a Kept one stays Kept. |
| `importedSounds` | The Sound each imported line already plays, by line id, where it isn't the one the naming template gives. `convert-screenplay` fills it in. |
| `importedGroupNames` | The name each imported group already has, by group id, where it isn't `Conversation/<conversation>/<group>`. The Editor keeps a group's first name when its Conversation is renamed (one Campaign Mod's hub chats' `Group00001` is `Conversation/<old conversation id>/Group00001`), and the name is the key of its title's string. `convert-screenplay` fills it in. |
| `importedFacialAnims` | The facial animation (`FacialAnim`) an imported line plays, by line id, where the Editor gave it one. A Screenplay has none, so `convert-screenplay` keeps the Editor's here. |
| `overlapPrevious` | `OverlapPrevious` on each line, in milliseconds; 200, as a Mission's, when not given. |

## What it compiles to

Each scene is a group, `Group<scene, 5 digits>`, named `Conversation/<conversation>/<group>` (or its imported name), with its lines as `Children` and a `RootItems`. A wordless scene, with stage directions and no lines (an interlude can open with one, such as a crash cutscene), is a group with no children, as the Editor makes it, so the scenes after it keep their groups. Each line is a `Lines` entry:

- its id from the Campaign Pack's naming template, as a Mission's line is (a sound id such as `Hub-S-Sergeant-01-001-ADJUTANT` gives `Line01001`);
- its Sound, the imported one if `importedSounds` keeps it, else the naming template's. Two lines of the mod's Screenplays can't play one Sound (compared without case), since a Sound is one CSound and one voice file: core's default naming template names a Campaign Mod's Sounds by the mod's id, so two Screenplays named by it would clash. `compile-mod`, `pull-screenplay` and `check-workspace` refuse it, naming both lines. A new line's Sound links to a CSound the shape doesn't write: `compile-mod` warns about each new line whose Sound no CSound in the mod gives yet (the package's, or one the Blueprint writes), since the line has no voice until one does;
- `SpeakerCharacter`, the speaker's character among the Blueprint's `characters` ([characters.md](./characters.md));
- the Editor's other fields as a new line has them (`FacialBlend 100`, `AnimProps Talk`, `LookAtAttach Head`, empty Objects and Variations).

The strings, in `enUS.SC2Data/LocalizedData/ConversationStrings.txt`, are each group's scene title (a wordless scene's too), under the group's name, and each line's text, with its emotion tags and direction left out. A Kept string no line has any more stays as the Editor left it. The declaration's `name` is the CConversation's own string, `Conversation/Name/<conversation>` in `ObjectStrings.txt`, checked against the Kept one as an entry's strings are ([mod-strings.md](./mod-strings.md#a-screenplays-name)).

Every speaker needs one of the Mod Blueprint's characters. A speaker with none fails `compile-mod`, `pull-screenplay` and `check-workspace` (`pnpm check` in a Workspace), naming the speaker and where it first speaks.

The Conversation is one catalog entry, so a Screenplay converts it whole: every scene of the Act, not one group at a time.

## Converting a Kept Conversation

`convert-screenplay <mods/<id>/blueprint.json> <CConversation id> [--ref <ref>] [--source <file>] [--accept <reason> [--renumber]]` (or the MCP `convert_screenplay` tool) declares the Screenplay a Kept Conversation comes from. It asks the Screenplay Source for its `ref` (`refForConversation`; a Source might know `HubConversation-<Name>` and `Interlude<e>-<m>`), pulls it into `screenplays/<conversation>.md` (or `--source`; without a Source, the Screenplay must already be there), and keeps the imported ids:

- The naming template's line ids must be the Conversation's, line for line. A Screenplay whose lines don't line up is refused, naming each line on either side. Mapping one to the other by guesswork could swap two lines' text without a trace.
- Each line keeps the Sound it was imported with, in `importedSounds`, and any facial animation, in `importedFacialAnims`; each group keeps a stale name, in `importedGroupNames`.
- The Conversation keeps its name, in `name`: the Blueprint's raw string, which it then leaves, else the Kept one. A raw name other than the Kept one is listed with the text differences. A name `removals` names refuses the conversion, since the Screenplay would write it back. A Screenplay declared before it recorded names gets its `name` by hand, since `convert-screenplay` declares a Conversation once.
- Compiled from the Screenplay, the CConversation must then read as the Editor has it.

Only the text can still differ. Each string whose Screenplay text differs from the Kept one is listed (trailing space aside, which the Equivalence Check ignores too). Name it in the Blueprint's `acceptedDifferences` (`string:enUS.SC2Data/LocalizedData/ConversationStrings.txt:Conversation/<conversation>/<line id>`) or change the line at the Source, then `compile-mod`.

Changing a line at the Source later, then pulling and compiling, changes that line's string and nothing else in the mod. Imported line ids stay kept after the conversion too: a Screenplay that no longer has a line `importedSounds` names (renumbered or cut at the Source) is refused by `pull-screenplay`, which then writes none of the mod's Screenplays, and fails `compile-mod` and `check-workspace`. Put it back at the Source, or, to let the line go, remove it from `importedSounds`.

`convert-entries` on ConversationData leaves a CConversation whose Screenplay the Source knows (or, with no Source, whose `screenplays/<conversation>.md` is in the mod's folder) Kept, with the reason, so it and `convert-screenplay` can run in either order. A Source that can't tell (it has no `refForConversation`, or doesn't know a conversation `convert-screenplay` takes with `--ref`) leaves that one to `convert-entries`, so run `convert-screenplay` on it first.

## A difference the author decides

Two options are only for a decision the author has made, and each records its reason in the Blueprint's `acceptedDifferences`:

- `--accept <reason>` lets the CConversation compile other than as the Editor has it, as its Accepted Difference (`catalog-entry:Base.SC2Data/GameData/ConversationData.xml:CConversation:<id>`). Its lines must still compile as the Editor's, each under its Kept id: Sound, speaker, facial animation and timing. An interlude whose empty `Group00001` the Editor wrote twice takes it.
- `--renumber`, with `--accept`, is for a Screenplay the author renumbered at the Source on purpose. Its lines pair with the Conversation's in order, one for one, each with its speaker (a pair whose speakers differ is refused, changing nothing), and keep their imported Sounds and facial animations under the new ids. A string key a new id now gives another line or scene is accepted under the same reason; any other text difference is still listed. The mod package's Kept references follow the new ids, each file listed with its count:
  - a conversation line value, `<conversation>|<line id>`, in `Triggers` or a Galaxy file (one interlude had six, in a library trigger);
  - in a `.SC2Cutscene`, a conversation element's `conversationLine` and its driver's `lineId`s, and, where every driver in it plays this conversation, the bookmarks named after its lines and groups.

  A file holding one of the references that the Blueprint writes (a `files` entry, or `Triggers` once it owns any of its items) is refused: renumber before converting it, or change its source. Missions' packages aren't searched, so a Mission naming one of the lines follows it by hand. Two interludes took it for their first line, the naming template's `Line01001` where the Editor wrote `Line00001`.

## Editing at the Source

`edit-screenplay` and `refresh-screenplay` take the Mod Blueprint as a Mission's CLIs take a Mission Blueprint's:

```
npm run edit-screenplay -- mods/<id>/blueprint.json <edits.json> --screenplay <name> --dry-run
npm run edit-screenplay -- mods/<id>/blueprint.json <edits.json> --screenplay <name>
npm run refresh-screenplay -- mods/<id>/blueprint.json
```

- `--screenplay` names the Screenplay by its `ref` (the Source's act), its `conversation` (`Interlude1-02`) or its `source` file (as written, or its name without the extension), the last two without case. A mod that declares one Screenplay doesn't need it; with several, leaving it out lists them. A name that fits none, or more than one, is refused.
- The edits file is in the Source's own format and addresses lines by their sound IDs in the pulled copy, with the dry run and revision check the Source gives a Mission's: see the Campaign Pack's own skill for its Source. Nothing is written in the Workspace.
- `refresh-screenplay` pulls each of the mod's Screenplays (`pull-screenplay` does the same, without the rest), lists the sound IDs that moved, changed or went in each, and checks the mod. A changed line that `importedSounds` still gives a Sound keeps playing the old recording: it is named, and left in `importedSounds` unless the author agrees to let it go. A mod has no Cinematics to follow and no placeholder voices of its own, and compiles with `compile-mod`, so it takes no `--map`.
