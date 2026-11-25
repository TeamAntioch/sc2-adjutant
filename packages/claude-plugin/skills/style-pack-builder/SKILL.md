---
name: style-pack-builder
description: Builds a Style Pack of the mapper's own taste in their Workspace from maps they made, edited or admire. It studies and captures the maps, drafts candidate Design Lessons and moods from what is distinctive about them, and ratifies each with the mapper. Use when a mapper wants their own Style Pack or their own look in sessions, when adding an Exemplar Map to a pack in the Workspace, or when asked what is distinctive about their maps.
---

A **Style Pack** is one mapper's visual taste: their **Exemplar Maps**, the **Map Studies** and in-game **frames** taken from them, and the **Design Lessons** the mapper ratified from those. This skill takes a mapper from a handful of maps to a pack in their Workspace that the `exemplar-design` skill reads unchanged. Its value is finding what is **distinctive** about this mapper's maps: the habits their maps agree on that Blizzard's campaign maps don't share.

The tools are the sc2-adjutant MCP server's Style Pack group, and they work on the Workspace's active Style Pack. Read the pack's knowledge through the server's resources (`sc2-adjutant://plugins/<plugin>/knowledge/<id>`); write its files in its folder in the Workspace.

The evidence is this pack's own maps, set against Blizzard's campaign maps as `exemplar_report` gives them. Every candidate, mood, lesson and guide line comes from that evidence and the mapper's answers alone: never compare the pack with another Style Pack, and never suggest what another pack does.

## 1. Scaffold the pack

Run `list_plugins`. When it lists a Plugin in the `style-pack` role whose source is a folder in the Workspace (`./style-pack`), pick that pack up: read its `lessons` and `candidate-lessons` knowledge. In the later steps, study and capture only the new maps and bring only new or changed candidates, but run `find_places` and `exemplar_report` over every map (no `ids`): `find_places` rewrites the mixtures file for the maps it's given alone, and the report measures agreement across them all. Otherwise run `scaffold_style_pack` (its folder is `style-pack/` unless the mapper wants another). When it's refused because the Workspace already names a Style Pack, say which and ask the mapper whether the new pack replaces it; on a yes, call it again with `replace: true`.

**Done when** `list_plugins` shows a `style-pack` Plugin whose source is a folder in the Workspace, and the mapper knows its name and folder.

## 2. Add the maps

For each map, get from the mapper its path, a short id and its **provenance**: `made` (they made it), `edited` (they edited it) or `approved` (a map they admire). Ask for whatever they didn't give, provenance always: a `made` map weighs most as evidence, an `approved` one least, so the mapper's answer is the only source of it. A relative path is inside the folder the machine config's `exemplarMaps` names (or `SC2_ADJUTANT_EXEMPLAR_MAPS`), else the Workspace config's `exemplarMaps`; an absolute path works without either. Record each with `add_exemplar_map`, one call after another (each rewrites the pack's list), with a `note` for anything worth knowing (what the map reuses, who else worked on it). The report needs at least two maps with a value to place a measure, and agreement reads more clearly across three or more, so ask for more when the mapper has given fewer than three.

**Done when** every map the mapper named is in the pack with the provenance they gave.

## 3. Study the maps and find their places

Run `study_exemplar` once for each map, with that map's id alone in `ids`, so no call grows with the pack and outlasts the client's timeout. Then run `find_places` with no `ids`, so the mixtures file holds every map's places. Read each map's study through its `study-<id>` resource. Its layer images (`textures.png`, `elevation.png`, `doodads.png` and the rest, in `exemplar-maps/<id>/`) are what you look at when a map has no frames. Count each map's places from the mixtures file (`exemplar-maps/mixtures.json`, each place's `map`); the `find_places` reply gives only the total. The maps with few or no places are the maps to offer grid tours for.

**Done when** every map has a study, you have each map's count of places, and you have the list of thinly dressed maps.

## 4. Capture place tours

Captures matter most: lessons drawn from how the maps look in game beat lessons from their data alone. `capture_exemplar` needs:

- a Host Adapter with `editor.captureTour`, named as `hostAdapter` in the machine config (the macOS and Windows Host Adapters have it), and `editorPath` and `cacheDir` there;
- the StarCraft II Editor with Test Document set to Windowed, Accessibility and Screen Recording allowed for the app running the capture, and the screen unlocked and awake throughout. The Editor comes to the front while each tour runs, and each tour starts the game, which takes minutes.

Say all this, and ask the mapper to start when they're ready. Run `capture_exemplar` for place tours. Offer grid tours (`tours: "grid"`) for the thinly dressed maps from step 3. When a call comes back `waiting` with a job id, call `capture_exemplar({ job })` again until it's done. For a tour that failed, retry its map with `startOnInit: true` when its timed triggers never fire, or with `showErrors: true` to see why it doesn't start. A rerun skips tours that already have frames. Then run `find_places` again, so each place lists its frames. Every frame of every tour, grid tours too, gets its 1000px copy in `<id>/frames/<tour>/`, whether or not a place lists it.

When `capture_exemplar` is refused for want of `editor.captureTour`, tell the mapper what their machine lacks, and go on from the studies and layer images: the candidates then cite numbers and layer images instead of frames.

**Done when** every map's tours are done or failed with a reason the mapper has heard, and `find_places` has run since the last capture; or the mapper knows their machine can't capture and you've gone on without frames.

## 5. Analyse: draft candidates and moods

Run `exemplar_report`. It ranks each measure: **distinctive** (the maps agree, outside Blizzard's spread), **common practice** (they agree, as Blizzard's maps do), **questions** (they don't agree), then what it can't place. When its reply names campaign missions the baseline couldn't measure, tell the mapper once that Blizzard's spreads leave them out.

The frames are in the folder `capture_exemplar`'s reply named (`<id>/frames/<tour>/`); each place in the mixtures file lists its own, by path in that folder. Read them as images. For each candidate, choose two to four frames that show it, or that contradict it, and name each in words: its map, the lighting it was captured under, and its stop in the tour or, for a place-tour frame, the place's centre in cells. A frame is cited by what it shows, never by its file.

Draft into the pack's `exemplar-maps/candidate-lessons.md`, in the format its header gives (rule, numbers, supporting maps, frames, Blueprint hook):

- a **candidate** for each distinctive measure, the heaviest evidence first;
- a candidate for each question whose largest group holds the `made` maps, put as a question ("your made maps do X, your approved ones don't: is X yours?"), and a short line on any other question;
- candidates the frames show and the measures don't (a habit of composition, of lighting, of what stands at a place's centre), each saying it comes from frames alone;
- common practice only when a frame shows the mapper's own twist on it.

Then propose **moods**, under a `## Candidate moods` heading in the same file. Group the places by what they're made of (each place's `motifs` and `top` types in the mixtures file) and by how their frames look. For each mood, give a name in the mapper's terms, its rule as the mixtures file records moods, the number of places it takes, and two to four frames. A place takes the first mood whose rule it passes. A rule is `{ "name": "<mood>", "when": [[{ "motifs": ["<motif>", ...], "atLeast": <share> }, ...], ...] }`: the place has the mood when every condition in any one alternative holds, and a condition holds when its motifs' shares add up to at least `atLeast`. The last mood has no `when`, as the catch-all.

**Done when** every distinctive measure and every question has a candidate or a line saying why it has none, every candidate has its numbers and frames (or layer images, without captures), and every place falls under a proposed mood.

## 6. Ratify one at a time

This step uses no tool: it is a conversation, and edits of the pack's lesson files. Bring the candidates to the mapper one at a time, strongest first, then the moods. For each, give its rule, its numbers, its supporting maps and the paths of its frames so the mapper can open them, and describe what each frame shows. Ask them to keep it, reword it or drop it. Then wait for their answer before bringing the next.

- **Kept:** add it to `exemplar-maps/LESSONS.md` as the next `DL-NN`, in the format its header gives, with today's date and the mapper's words as they said them (drop the "No lessons are ratified yet." line with the first). Describe each frame in words that stand without the picture: the frames stay out of the pack. Copy the frames it cites into `exemplar-maps/<id>/evidence/` (git-ignored) for the mapper's later reference. Its **Blueprint hook** names the Blueprint fields it shapes and the style-rule slot it could fill later: `yaw`, `pileScale`, `lipScale`, `cliffPile`, `shorePile`, `lipClumps`, `breakWear`, `varietyPatches`, `blendGroup`, `compositeWarnings` or `cliffTextureWarnings`, or none.
- **Reworded:** keep it in the mapper's wording, and say back the rule as you'll write it.
- **Dropped:** take it out of `candidate-lessons.md`, with a line saying it was dropped and why, so a later run doesn't propose it again.
- **A mood:** the mapper confirms or renames it, and may move places between moods by changing its rule.

Take a kept lesson or mood out of `candidate-lessons.md` once it's written.

**Done when** every candidate and mood has the mapper's answer, and `LESSONS.md` holds exactly the kept lessons.

## 7. Package the pack

1. **Moods.** Write the kept moods' rules into the mixtures file's `moodRules` (`exemplar-maps/mixtures.json`), most specific first and the catch-all last, leaving its other keys as they are. Run `find_places`. Its reply counts the places by mood; show the mapper the counts, and adjust with them any mood that took far more or fewer places than they expect.
2. **Guide.** Write `knowledge/GUIDE.md` over its stub the first time; on a later run, when it already says more than the stub, update it: add what the new lessons and moods change, and keep the mapper's wording. Before you change or remove a line already there, show the mapper the line and the change, and ask. Under **Weights**, say how much the provenance and agreement behind each lesson count. Under **Leading words**, give the mapper's own words for their look. Under **Propose a look**, take each step of the `exemplar-design` method (tileset, texturing, dressing, lighting) and name the lesson ids that govern it and the moods to dress from. Add a **Blueprint hooks** section listing each lesson's hook.
3. **Manifest.** In the pack's manifest, the JSON file at its folder's root, keep the `guide`, `lessons` and `candidate-lessons` knowledge entries. Update the `lessons` description to name the ids it holds. When the manifest has no entry with the id `mixtures`, add one, with a `title` ("Mood mixtures (data)"), a `description` ("Every dressed place with its mood, and each mood's mixture.") and the `file` `exemplar-maps/mixtures.json`, so `exemplar-design` reads the moods. Add only the entries the manifest lacks: two entries with one id stop the Workspace loading.
4. **Check.** From the Workspace's folder, run `npm run check` (or the `check_workspace` tool), and fix whatever it names in the pack.
5. **Read it back** as `exemplar-design` will: `list_plugins` lists the pack's knowledge ids, and the `guide`, `lessons` and `mixtures` resources serve the new text.

**Done when** the check reports no errors, and the `guide` and `lessons` resources serve what the mapper ratified.
