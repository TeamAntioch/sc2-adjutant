---
name: still-review
description: Runs a Still Review, the author judging versions of a map from the same in-game Shots on a published page, from places named in words to per-Shot feedback you can act on. Use when asked to show places of a map in game (show me the tunnel, the ruins and the exit), to compare versions of a change side by side, when judging a look in game, or when the author is done with a review page.
---

A **Still Review** captures the same **Shots** on several versions of a map, lays them side by side on a page published as an artifact, and brings back the author's verdict per Shot: which version is best, tags, and a note. A **set** fixes the Shots for one comparison. Each **round** of the set is one page: the versions built so far, with the last round's feedback shown beside each Shot. Steps 1 to 6 are one round; the next round starts at step 2 and reuses the set's Shots.

The tools are on the sc2-adjutant MCP server: `shots_for_zones`, `capture_shots`, `build_still_review` and `record_still_feedback`. Their descriptions are authoritative for inputs and file shapes. The page goes out with the Artifact tool, and its feedback comes back with the ArtifactData tool. In an sc2-adjutant checkout, `npm run shots-for-zones` and `npm run still-review` do the same as the first and third (each takes `--help`).

## 1. Shots

Turn each place the author names into a Zone of the Mission's Blueprint (`get_blueprint` lists them). One Shot frames one Zone, 30×17 cells by default (`size` changes it for the whole set), centred on the Zone's ground. Where a Zone is too big for one Shot, or the place is a single spot (a door, a statue), give it a hand-made Shot (below). Show the author the list, one line per Shot: its label and what it is meant to show. Then save the set with `shots_for_zones` (`mission`, `zones` in the order the page should show them, `set`, optional `size` and `pitch`). It writes `missions/<id>/output/stills/<set>/shots.json` and refuses to overwrite one, since every round of a set must frame the same places.

A Shot that isn't a whole Zone's: add it to the `shots` array of that `shots.json` by hand, before the first capture, as `{ "rect": [left, bottom, right, top], "pitch": <the set's pitch>, "label": "<name>" }`: the set's size in cells, centred on the spot (an Anchor's position, or a point of the Zone, from `get_blueprint`), and inside the Playable Area. After the first capture, the set's Shots are fixed. A new place means a new set.

On a later round, reuse the set's `shots.json` as it is.

Done when the author has OK'd the list and the set's `shots.json` holds every Shot.

## 2. Versions

A version is one state of the map, with a short `label` (`before`, `washes`) and a note of what changed. The Mission's committed Map Package is usually `before`. It needs no compile: capture it as it stands, with `capture_shots`' `mission`.

Keep each version's change on its own git branch, so versions don't mix and a rejected one is undone whole. The Workspace is a git repo. Before the first version, note the Workspace's branch (`git branch --show-current`). If `git status` shows changes, ask the author to commit them or set them aside first. Don't start while anything under `missions/<id>/` is uncommitted, or their work would ride into a version. The exception is the author's own uncommitted change when it is the change under review: it becomes the first version, since `git switch -c` takes it along to the version's branch, where you commit it. A change to review that is already committed on the Workspace's branch is in every branch made from it, and in no version alone. Ask the author before reviewing it that way, and branch from the commit before it instead. For each version:

1. Branch from the Workspace's branch, or from the branch of the earlier version this one builds on: `git switch -c still/<set>-<round>-<label> <from>`. The round in the name lets a later round revise a label.
2. Make the change (the Blueprint, and any file it adds, such as a custom doodad's model), then commit every file the version changed: `git add <files>`, then `git commit -m "Still Review <set> <round>: <label>"`.
3. Compile it (below), then switch back by name, `git switch <the Workspace's branch>`, before the next version's change.

A copy compile writes only under `output/`, which git ignores, and placeholder voice files into the Screenplay's `audioDir` for lines that have none. Leave those placeholders untracked. Keep every branch until the set is finished (step 6).

Compile every other version into a copy of the committed package under the Mission's git-ignored output: `compile_map` with `copy: true` and `outputDir` set to `missions/<id>/output/<round>/<Name>-<set>-<label>.SC2Map` (in a checkout, `npm run compile-map -- missions/<id>/blueprint.json <output-dir> --copy`). The copy starts from the committed package and its compile record, and the compile merges into it as it would in place. So the version keeps the author's Kept Content (their doodads, units, regions, strings, Kept triggers and Kept terrain) and differs from `before` by the change alone. It writes the copy's own record (`<Name>-<set>-<label>.compile-record.json`) and a `.copy.json` note beside it, and leaves the committed package and its record as they are. Compiling the same version again replaces its copy. Never compile a version in place, and never use an `outputDir` without `copy`. An in-place compile rewrites the committed Map Package, which is the author's, and the Editor may have it open. Without `copy`, the version is written whole from the Blueprint, without the Kept Content, and that compile is refused for a Mission with Kept terrain.

When the compile stops on Compiled Content the author changed in the Editor, those changes are in the committed package, and so in `before`. Ask the author to keep or discard each one, as `compile_map`'s description says, and recommend keep. A kept change stays in the copy as `before` has it. A discarded one makes the version differ from `before` by more than its change. Give every version of the set the same answers, and compile again with `copy`. The answers shape the copies only, not the committed package.

A Workspace whose core comes through a link to an sc2-adjutant checkout: a compile that fails because that checkout is mid-rebuild (missing `dist` files, a module not found) fails for a moment only. Wait a minute and compile again, keeping the link as it is.

Reuse every capture already on disk: a version captured in an earlier round keeps its folder, so only new versions are captured.

Done when every version is either captured already or compiled into its own copy, from its own committed branch.

## 3. Capture

Before the first capture, tell the author three things, and wait for their go-ahead:

- It takes about three minutes per version, plus a few seconds per Shot.
- The Editor comes to the front and runs the map.
- The screen must be left alone until it's done: a click or a key press lands in the game.

Ask which lighting to capture in. A capture runs a copy of the map with none of its triggers, so lighting the map sets by trigger doesn't show: pass the Light id it would set as `lighting` (`asset_catalog` lists the Lights). Use the same lighting for every version and every round of the set, or the versions differ by light, not by the change.

Capture each version with `capture_shots`: every Shot of the set's `shots.json`, in its order, in one call, with `mission` for the committed package or `mapPath` for a compiled version, and a `name` that says the set and version (`<set>-<label>`). A call that outlasts its wait returns a job id: call `capture_shots({ job })` to wait again.

**An old Editor Broker.** Every capture goes through one Editor Broker on the machine, started by whichever capture found none. One built from an older sc2-adjutant refuses every job, with "The Editor Broker running (pid N) speaks protocol M, not K: let it idle out, or stop it". It idles out ten minutes after its last client hangs up, and every capture tried meanwhile restarts that clock. Tell the author, then either wait the ten minutes without capturing and capture again, or, with the author's OK, stop it with `kill N` (the pid in the message) and capture again: the next capture starts a broker from the current build. Ask first, because another session may be using it.

Done when every version has a capture folder, and you have the `missing` and `late` lists of each.

## 4. Check

Look at the reference frames yourself first. The check compares every frame with the reference capture, the first version's first capture by default. A reference frame of the wrong place makes the right frames look wrong, so open each reference frame and confirm it shows its Shot's place before you trust the check. Where one is wrong, retake that Shot on the reference version, or pass a capture you have checked as `reference`.

Build the round with `build_still_review`: `mission` (or `folder` for a map that isn't a Mission's), `set`, `round` (`r1`, `r2`, …), `versions` in order (`{ label, note, captures: [first capture folder, ...retake folders] }`), `lighting`, and `previous`, the last round's folder, once its feedback is recorded. It returns `roundDir`, `page`, `problems`, `unconfirmed` and `retakes`, and writes `review.json`, `frames/` and `index.html` in `roundDir`.

State every problem plainly to the author, one line each, by version and Shot: missing (no frame), late (taken after the camera moved on), wrong (shows another Shot's place, named). The page leaves those frames off with the gap labelled. An unconfirmed frame stays on the page with a badge: nothing in the reference matches it well, as after a big repaint. Look at it before you trust it.

Offer a retake of exactly the Shots in `retakes[].shots`, per version, on that version's map (`retakes[].map`), in the set's lighting. Add the retake's folder after that version's other captures and build the round again: a retake fills only the Shots the earlier captures lack, matched by place. Rebuilding replaces the round until its feedback is recorded.

The frames are often dark on a dark tileset. The page has a "Lift shadows" toggle that brightens every frame for judging the ground: mention it.

Done when `problems` is empty, or the author has declined the retakes left.

## 5. Publish

Publish the page with the Artifact tool as a new artifact for each round:

- `file_path`: `<roundDir>/index.html`.
- `root`: `<roundDir>`, and `files`: every file in `<roundDir>/frames/`, each at `frames/<file>`.
- `capabilities`: `{ db: {}, user: {} }`. The page keeps the author's picks in the artifact's db.

Publish those files only. `review.json`, `feedback.json`, `feedback.md` and the tools' summary text name paths on this machine, so they stay local. Give the author the link, with a line on what to do: pick the best version per Shot (or no change), tag it, leave a note, and press "Done reviewing" at the end.

Done when the author has the link.

## 6. Read back

Read the feedback when the author says they're done, or when the db's `review/status` says `{ done: true }`.

1. Read the page's db with ArtifactData: `list` on the collection `shots`, then on `review`, with the `url` the publish gave, to the last page (pass each reply's `next_cursor` as `query.cursor`). Turn each document into a row `{ path: "<collection>/<id>", data }` from its collection and id: `shots/<n>` is `{ best, tags, note }`, `review/overall` is `{ note }`, `review/status` is `{ done }`.
2. Record every row with `record_still_feedback` (`round`: the `roundDir`, `rows`). It writes `feedback.json` and `feedback.md` in the round's folder, which the next round's `previous` reads.
3. Sum the round up for the author, one line per Shot that has feedback: which version won (or no change), the tags, and what is wrong and where, in their words. End with the overall note.

Act on the feedback only after the author confirms the summary. A change for a next round is a new version: back to step 2, the same set, the next round name, and this round as `previous`.

**A note on how much of a texture shows becomes a Paint Region** ("less of the dark stone", "a bit of rubble along the wall on the left"). Write it as the next version's change, on its branch (step 2), with `paint_region`:

1. **Where.** Turn the place the note names into an outline. A whole Shot's Zone: `zone`, so the region follows the Zone. A part of a frame: `frame`, `{ capture, shot, box }`, with `box` as `[left, top, right, bottom]` fractions of the frame from its top-left corner, and `capture` the reference version's capture (its name under the Mission's `output/shots`): every version frames the Shot through the same camera, so any version's frame gives the same ground. The page has no drawing tool, so read the place from the note's words and the frame, and before writing describe the box to the author in words (the left third, lower half), or take the box they marked on a copy of the full-size frame. A spot known in cells: `rect`, `[left, bottom, right, top]`. A box becomes cells on flat ground at the camera target's height, so on steep relief it drifts a little.
2. **How much.** A **blend weight** for a texture through every cell, an **area share** for patches over part of the region, as the `texture-sets` skill says. Ask the author when the note could mean either. On a height-blended LotV tileset a low weight shows as crevice patches, not a tint, and less of it than the weight says: say so before the author judges it.
3. **Judge it in the next round.** Compile the version into a copy and capture it, as for any version. The round shows its frames beside the note that asked for it. `texture_usage` reads the committed package, so it measures the region (each texture as painted beside what the mix asked) once its version is the kept one, compiled in place; until then the frames are the measure.

When the author says the set is finished, ask which version to keep. Different Shots may favour different versions. Then the author picks one, or asks for a version that combines them, which is a next round. "No change" keeps `before`. For a kept version, with the author's OK:

1. On the Workspace's branch, `git merge still/<set>-<round>-<label>`.
2. Compile in place (`compile_map` with no `outputDir`), so the committed package is that version.
3. Commit the package and its `compile-record.json`: `git add missions/<id>/<Name>.SC2Map missions/<id>/compile-record.json`, then `git commit -m "Compile <label> from Still Review <set>"`.

Then delete the set's branches: `git branch -D` each `still/<set>-…` branch. A branch holding the author's own change that wasn't kept goes only with their OK, since it is the last copy of that work.

Done when the feedback is recorded and the author has confirmed the summary, and, once the set is finished, the kept version is merged, compiled and committed and the set's branches are gone.
