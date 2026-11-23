# Example Campaign

A complete, small **Workspace** to start your own Campaign from. `npx @team-antioch/sc2-adjutant init my-campaign` makes a copy of it, with sc2-adjutant installed. It holds:

- the example **Campaign Pack**, `plugins/campaign-example/`: a naming template, and the name of its Campaign Mod
- the example **Campaign Mod**, `mods/example/`: a Mod Blueprint declaring three stock Blizzard characters, and the mod package compiled from it
- one example **Mission**, `missions/ashfall-relay/`: a Blueprint, a plain Markdown **Screenplay** and its voice files
- the generic `hazard` **Mechanic**, which ships with sc2-adjutant as `bundled:hazard`

Everything here is original and free to copy. The characters are stock Blizzard units and portraits from the Void (Mod) dependency that every compiled map gets by default, so the example Mission doesn't load its Campaign Mod: the Mission compile reads only the characters' declarations from it.

```text
example-campaign/
├── sc2-adjutant.workspace.json        # the Campaign, the missions folder and the Plugins to load
├── .gitignore                       # keeps tts's audio/manifest.json and throwaway compiles out of commits
├── package.json                     # in a Workspace made by init: core and your Host Adapter, and core's commands as scripts
├── plugins/campaign-example/
│   ├── sc2-adjutant-plugin.json       # name, version, pluginApi, roles, and the ids it contributes
│   ├── package.json                 # "type": "module", so Node loads index.ts as ESM wherever it is copied
│   └── index.ts                     # the naming template
├── mods/example/
│   ├── blueprint.json               # the Mod Blueprint: the characters
│   ├── compile-record.json          # what compile-mod last wrote into the package
│   └── Example.SC2Mod/              # the Campaign Mod, compiled from the Blueprint
└── missions/ashfall-relay/
    ├── blueprint.json               # zones, a Marine, the magma hazard, an objective, scene cues
    ├── ashfall-relay.md             # the Screenplay, in core's format (docs/screenplay-format.md)
    ├── triggers/                    # the Mission's own triggers, one file each, written by write_blueprint_trigger
    └── audio/                       # one voice file per line, named by its sound id
```

## The example Mission

In *Ashfall Relay*, a Marine Sergeant lands on a volcanic plain and has to reach a silent relay to the east. The Ash Flats between them flood with magma every 34 seconds, for 22 seconds at a time. The 12-second dry spells are too short to cross the flats in one go, so the Sergeant waits out a surge on the Mesa, where the Lookout point stands. The Adjutant briefs the Sergeant at the start, the Foreman gives a warning, and the relay comes back on at the end.

The Campaign Pack's naming template names the conversation `Ch1_ashfall_relay`, from the Screenplay's `- Chapter: 1` field. It names each line's sound and voice file `Ch1_ashfall_relay_<scene>_<line>`, such as `Ch1_ashfall_relay_2_01.wav`. Each speaker's CCharacter is its character's id, such as `ExampleAdjutant`. The template leaves out the line ids, so core's default names them `Line1-1`, `Line1-2` and so on.

- The **Adjutant** shows the stock `AdjutantPortrait` model.
- The **Foreman** shows an SCV's portrait.
- The **Sergeant** speaks from the Marine on the map, because the Blueprint's `speakerAnchors` puts the `SERGEANT` there.

The files in `audio/` are silent placeholders, so the Mission compiles anywhere. On a Mac, `npm run tts -- missions/ashfall-relay/blueprint.json` replaces them with spoken placeholder lines in each character's `say` voice. Run it in your own Workspace, not on the example in the sc2-adjutant repo: it overwrites the committed voice files. It also writes `audio/manifest.json`, which the `.gitignore` keeps out of commits.

## A trigger of its own

No Blueprint concept shakes the camera, and core's trigger catalog has no primitive for it, so the Mission has two triggers of its own (ADR-0026 in sc2-adjutant). From the Crossing Beat on, the ground trembles every 11 seconds. A session wrote them with the MCP tools below, and you can do the same for any of the game's functions.

1. **Find the function.** `search_trigger_functions` with `{ "mission": "ashfall-relay", "text": "shake", "kind": "action" }` finds *Shake Camera*, *Shake Camera Using Preset* and *Stop Shaking Camera*, each with its parameters as the Editor shows them. *Shake Camera Using Preset* takes an amplitude and a frequency by preset name.
2. **Write the periodic trigger.** `write_blueprint_trigger` takes the trigger in the Editor's terms. Functions and parameters go by name, and a parameter you leave out gets the default the Editor gives a new call (here, no blend in or out):

   ```json
   { "mission": "ashfall-relay", "trigger": {
       "name": "Ash Tremors", "initiallyOff": true,
       "events": [{ "function": "Periodic Event", "params": { "Duration": 11 } }],
       "actions": [{ "function": "Shake Camera Using Preset", "params": { "Player": 1, "Amplitude": "Medium", "Frequency": "Tremor", "Duration": 2 } }] } }
   ```

   A wrong name is refused in the Editor's terms, with what would fit. Given `"Amplitude": "Strong"`, it lists `"Massive", "Heavy", "Medium", "Light"`. The tool writes `triggers/ash-tremors.json`, adds it to the Blueprint's `triggers`, and gives the trigger an element Id (`D4B9718B`).
3. **Write what turns it on.** A Beat can hold back only a trigger that starts on Map Initialization, and a periodic trigger doesn't. So a second trigger, *Start Ash Tremors*, turns the first one on at Map Initialization: `Turn Trigger On/Off` with `"Trigger": { "trigger": "Ash Tremors" }` and `"State": "On"`.
4. **Cue it from the Beat.** The Blueprint's `kept` names *Start Ash Tremors* by its element Id and holds it until the Crossing Beat starts:

   ```json
   "kept": [{ "id": "start-ash-tremors", "kind": "trigger", "editorId": "15E66F7A", "name": "Start Ash Tremors",
              "hold": { "until": { "type": "beatStarts", "beatId": "crossing" } } }]
   ```

   The compile switches off its Map Initialization event, and *Beat - Crossing* runs it.
5. **Read it back and compile.** `outline_trigger` with `{ "mission": "ashfall-relay", "trigger": "Ash Tremors" }` reads the trigger back in the form `write_blueprint_trigger` takes. Edit that and rewrite it to change the trigger. Calls you leave alone keep their Ids. `compile_map` then writes both triggers into the Map Package's `Triggers` and `MapScript.galaxy`, where the Editor shows them in the Trigger module like any other.

## Try it

In a Workspace made by `init`, open Claude Code in its folder and run `/sc2-adjutant:co-design ashfall-relay`. Or, from the Workspace's folder:

```sh
npm run check                                                # check every Mission against its Plugins
npm run check-layout -- missions/ashfall-relay/blueprint.json
npm run compile-map -- missions/ashfall-relay/blueprint.json # writes the Map Package beside the Blueprint
```

From an sc2-adjutant checkout's root, after `npm install`:

```sh
# Serve this Workspace over MCP; then call compile_map with { "mission": "ashfall-relay" }
node packages/core/dist/mcp/main.js packages/core/examples/example-campaign

# Or use the CLIs, which find the Workspace above the Blueprint
npm run check-layout -- packages/core/examples/example-campaign/missions/ashfall-relay/blueprint.json
npm run compile-map -- packages/core/examples/example-campaign/missions/ashfall-relay/blueprint.json
```

`compile_map` writes the map to `missions/ashfall-relay/Ashfall-Relay.SC2Map`, beside its Blueprint, with `compile-record.json` listing what it wrote. Open its `ComponentList.SC2Components` in the StarCraft II Editor. A Workspace commits both. In the sc2-adjutant repo, the example's own `.gitignore` keeps them out.

## Start your own Campaign Pack from it

1. **Make your copy** with `init`, which you've done if you're reading this in your own Workspace:

   ```sh
   npx @team-antioch/sc2-adjutant init ~/my-campaign
   ```

   Make it its own git repo with `git init` there. From an sc2-adjutant checkout, `cp -R examples/example-campaign ~/my-campaign` copies it without installing anything.

2. **Name your Campaign** in `sc2-adjutant.workspace.json`. Set `campaign.id`, a lowercase slug, and `campaign.name`. Set each Blueprint's `campaignId` to the same id. Nothing checks that yet, so change both.

3. **Name your Campaign Pack:**
   - Rename `plugins/campaign-example/` to your own name, such as `plugins/campaign-mine/`.
   - Change `campaignPack` in the Workspace config to that folder.
   - Set `name` and `version` in its `sc2-adjutant-plugin.json`. Keep `"pluginApi": 2` and `"roles": ["campaign-pack"]`.

4. **Choose your naming.** The `naming` object in `index.ts` holds the naming template. Every hook is optional, and core's default fills in any you leave out (the Mission id, scene and line).
   - `conversationId`, `lineId`, `soundId` and `soundLine` read the Mission id, the Screenplay's title and header fields, and each line's scene, place in its scene, speaker and backticked id.
   - `characterId` names the CCharacter of a speaker with no character. Here every speaker has one, which gives its own id, such as `ExampleAdjutant` (a prefix keeps the map's CCharacters clear of Blizzard's own ids).
   - Rename the template's `name`, and the id under `contributions.naming` in the manifest to match. To use core's default naming, delete `naming` from the code and the manifest.

5. **Cast your characters** in the Campaign Mod's Blueprint, `mods/example/blueprint.json`. Rename the folder, its `id`, its package (`Example.SC2Mod`), the Workspace config's `mods` and the manifest's `contributions.campaignMod` (the package's name without `.SC2Mod`) together. Each entry in `characters` gives a speaker as the Screenplay writes it, such as `"ADJUTANT"`, and its CCharacter `id`, such as `"ExampleAdjutant"`. It can also give:
   - `name`: the name its Transmissions show
   - `unit`, a unit type, or `model`, a portrait model: what an off-map Transmission shows
   - `voice`: a macOS `say` voice
   - `fields`: its other CharacterData fields, such as `{ "Gender": "Female", "Race": "Terran" }`

   Speakers match their characters ignoring case and extra spaces. Every speaker in a Screenplay needs a character, or the Mission doesn't compile. After changing the characters, run `npm run compile-mod -- mods/example/blueprint.json` from the Workspace's folder to write them into the mod's CharacterData (see `docs/reference/characters.md` in sc2-adjutant). If a character's unit or model isn't in the stock Void (Mod), add the mod that has it to the Mission Blueprint's `dependencies`.

6. **Write your Missions.** Make one folder per Mission under `missions/`, each with a `blueprint.json`. Rename or replace `ashfall-relay`. The folder name (`ashfall-relay`) is what `compile_map` takes. The Blueprint's `id` (`ashfall_relay`) is what the naming template reads, so it names the conversation, sounds and voice files. Change both when you rename a Mission. A Screenplay is a Markdown file in the format of `docs/screenplay-format.md`, named by the Blueprint's `screenplay.script.source`. The Blueprint's `screenplay.script.cues` say when each scene plays. Run `npm run tts -- <blueprint>` to generate voice files under the new names. Every line needs one before the Mission compiles.

7. **Add Mechanics** by listing more Plugins under `plugins` in the Workspace config: `bundled:<name>` for one that ships with sc2-adjutant, or `./path` for a local Plugin folder. A Mechanic type that no loaded Plugin provides fails the Blueprint.

8. **Keep Screenplays somewhere else, if you like.** A Campaign Pack can also contribute a Screenplay Source, whose `fetch` returns a Screenplay in core's format. With one, `npm run pull-screenplay -- <blueprint>` fetches it into the Mission folder. See "Where the file comes from" in `docs/screenplay-format.md`. Without one, as here, the Markdown files are the Screenplays.

`index.ts` is TypeScript, which Node 22.18 or later loads as it is. It imports only types, from `@team-antioch/sc2-adjutant/plugin-sdk`, so Node erases the import and the Plugin loads in your copy without sc2-adjutant installed. To type-check your copy, `@team-antioch/sc2-adjutant/plugin-sdk` has to resolve to a built sc2-adjutant, such as the one a Workspace made by `init` installs. In the sc2-adjutant repo, `npm run lint` checks it.
