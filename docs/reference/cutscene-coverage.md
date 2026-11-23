# Cutscene Editor coverage

What a Cutscene Editor file can hold, set against what our compile writes, reads and checks (issue #750, part of #735). The ticket asked for this against Blizzard's Cutscene Editor manual. **The manual was not read**: it is not in the repo or on this machine, and its text can't be committed here. So the table below is built from the other evidence, the files themselves: a census of the node and element kinds in 298 Cutscene Editor files from Blizzard's campaigns (Liberty, Swarm, Swarm story and Void story data), against the kinds our own source names. A kind a file holds that our source never names is one the Editor can put in a cutscene and our tooling doesn't know. Where the manual is read later, add its list as a column here.

Also unchecked: that format knowledge from another project's Heroes of the Storm files holds in our Editor. Nothing here relies on it.

## How it was made

```
npm run cutscene-census -- <folder of .SC2Cutscene files> [--code <folder of our .ts>] [--json]
```

`packages/core/src/cutscene/tag-census.ts` reads every file with our own reader, counts each `CCutscene...` kind and the attribute names it carries, and looks for each kind in our source (`src/cutscene`, `src/triggers`, `src/script`, `src/map` and `src/mods` by default). The table below is the command's output as printed, run over the four Blizzard folders; no column was filled in by hand. What its columns mean, and how far to trust them:

- **Our code** is *writes* when `cutscene/write-shot-cutscene` (the file that writes a cutscene's nodes) names the kind, *other code only* when only other files do, and *not named* when none does. "Names" is a text match: the kind standing alone as a string literal, with comments dropped (approximately). It shows what the code knows of a kind, not that it handles it well or that what it writes loads in the Editor.
- **Attributes no code mentions** are looked for as bare words anywhere in the searched source, so a short word that happens to occur elsewhere hides a gap. Words too common to judge (`name`, `time`, `index`, `value`, `position` and the like, listed as `AMBIGUOUS_ATTRIBUTES` in the tool) are set aside in the last column instead of judged. Treat the list as a prompt for a look, not as a finding.

## Kinds in the files

298 files read. 45 kinds: named in a writer file 36, named only in other code 1, not named 8.

| Kind | Files | Occurrences | Our code | Other files that name it | Attributes no code mentions | Attributes too common to judge |
|---|---|---|---|---|---|---|
| CCutsceneElementAnim | 298 | 19184 | writes | cutscene/compare-cutscenes, cutscene/import-set | animId, endLinkAttachToPoint, endLinkDistance, endLinkGuid, fullMatchLegacy, linkAttachToPoint, linkGuid, playForever, playOnce, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, priority, start |
| CCutsceneElementObject | 298 | 40204 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, cutscene/import-set | endLinkAttachToPoint, endLinkDistance, endLinkGuid, referenceGuid, removedItems, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, start |
| CCutsceneNodeActor | 298 | 11600 | writes | cutscene/compare-cutscenes, cutscene/import-set, cutscene/set-catalog | CreatedByShotMan, actorAlias, cloaking, debugModelLink, enableModelEvents, finderTag, fogVisibility, followTerrainOffset, fromArchive, fxaOverride, halo, hdrMultiplierDiffuse, hdrMultiplierEmissive, hitTest, lensFlaresStartVisible, referenceFile, referenceGuid, rotationForward, rotationUp, sortIndex, speakerTag, unitLink, useAnimMovespeed | enabled, name, position, rotation, scale, visible |
| CCutsceneNodeAnimLayer | 298 | 8796 | writes | cutscene/import-set | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneNodeDirector | 297 | 308 | writes | cutscene/contact-sheet | CreatedByShotMan, autoDestroyOnEnd, interactive, referenceFile, referenceGuid, reverb, sortIndex, waitForResources | enabled, name |
| CCutsceneElementActiveCamera | 278 | 1554 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, map/kept-checks | startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, start |
| CCutsceneNodeActiveCamera | 278 | 282 | writes | cutscene/contact-sheet | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneElementActiveLight | 263 | 813 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, cutscene/set-catalog | referenceGuid, removedItems, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, start |
| CCutsceneNodeActiveLight | 263 | 366 | writes | cutscene/contact-sheet | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneNodeFolder | 255 | 5864 | writes | cutscene/contact-sheet, cutscene/set-catalog | CreatedByShotMan, referenceFile, referenceGuid, sortIndex | enabled, name |
| CCutsceneNodeBookmark | 242 | 282 | writes |  | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneElementBookmark | 240 | 3304 | writes |  | jumpToBookmarkWhenHit, pauseWhenHit, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, start |
| CCutsceneNodePropertyValue | 230 | 23370 | writes | cutscene/compare-cutscenes, cutscene/import-set | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneElementPropertyCurve | 217 | 104952 | writes |  | endLinkAttachToPoint, endLinkDistance, endLinkGuid, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start, time, value |
| CCutsceneNodeLight | 199 | 21730 | writes | cutscene/compare-cutscenes, cutscene/import-set, cutscene/set-catalog | ambientOcclusion, fogVisibility, lightOpaque, lightTransparent, sortIndex, specularColorB, specularColorG, specularColorR | enabled, name, position, rotation, scale, type, visible |
| CCutsceneNodeTargetCamera | 197 | 1246 | other code only | cutscene/import-set, cutscene/set-catalog | followTerrainOffset, fstop, maxcoc, sortIndex, targetPositionX, targetPositionY, targetPositionZ | enabled, name, position, rotation, scale |
| CCutsceneNodeSound | 154 | 3588 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, cutscene/import-set | CreatedByShotMan, fireAndForget, nonSeeking, pitchScale, randomOffsetMax, randomOffsetMin, sortIndex, soundIndex, speakerMixBackLeft, speakerMixBackRight, speakerMixCenter, speakerMixFrontLeft, speakerMixFrontRight, speakerMixLFE, speakerMixSideLeft, speakerMixSideRight | enabled, mode, name, position, rotation, scale |
| CCutsceneNodeEndScene | 152 | 152 | writes |  | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneElementEndScene | 142 | 204 | writes | map/kept-checks | startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, start |
| CCutsceneElementFade | 109 | 341 | writes | cutscene/contact-sheet, map/kept-checks | endLinkAttachToPoint, endLinkDistance, endLinkGuid, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start |
| CCutsceneNodeFade | 109 | 109 | writes |  | holdFade, sortIndex | enabled, name |
| CCutsceneNodeActiveShot | 101 | 32524 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, cutscene/import-set | sortIndex | enabled |
| CCutsceneElementConversation | 91 | 913 | writes | cutscene/compare-cutscenes, map/kept-package | CreatedByShotMan, durationOffset, fireAndForget, sortIndex, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, enabled, name, start |
| CCutsceneElementLookAt | 91 | 1871 | writes | cutscene/import-set | endLinkAttachToPoint, endLinkDistance, endLinkGuid, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start |
| CCutsceneNodeConversation | 91 | 347 | writes | cutscene/contact-sheet | CreatedByShotMan, sortIndex | enabled, name |
| CCutsceneNodeLookAt | 91 | 1216 | writes | cutscene/contact-sheet, cutscene/import-set | sortIndex | enabled, name |
| CCutsceneElementPropertyValue | 87 | 8716 | not named |  | (all) | duration, enabled, start, value |
| CCutsceneNodeConversationDriver | 82 | 82 | writes | map/kept-package | sortIndex | name |
| CCutsceneElementConversationDriver | 81 | 749 | writes | cutscene/compare-cutscenes, map/kept-package | alternateLineId, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start |
| CCutsceneNodeAttachment | 56 | 270 | writes | cutscene/contact-sheet, cutscene/import-set | sortIndex | enabled, name |
| CCutsceneNodePath | 53 | 422 | writes |  | sortIndex | enabled, name |
| CCutsceneElementAttachment | 52 | 413 | writes | cutscene/import-set | endLinkAttachToPoint, endLinkGuid, startLinkAttachToPoint, startLinkGuid | duration, start |
| CCutsceneNodePathMarker | 50 | 1246 | writes |  | fogVisibility, sortIndex, useSceneRotation | enabled, name, position, rotation, scale |
| CCutsceneElementFollowPath | 49 | 464 | writes |  | alwaysPointUp, endLinkAttachToPoint, endLinkDistance, endLinkGuid, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start |
| CCutsceneNodeFollowPath | 49 | 400 | writes | cutscene/contact-sheet, cutscene/import-set | sortIndex | enabled, name |
| CCutsceneNodeMasterSound | 49 | 49 | not named |  | (all) | enabled, mode, name |
| CCutsceneNodeCamera | 46 | 307 | writes | cutscene/compare-cutscenes, cutscene/contact-sheet, cutscene/set-catalog | fogVisibility, fstop, maxcoc, sortIndex | distance, enabled, name, position, rotation, scale, visible |
| CCutsceneNodeRTTChannel | 35 | 38 | writes |  | sortIndex | name |
| CCutsceneElementRTTChannel | 31 | 54 | writes | cutscene/set-catalog | endLinkAttachToPoint, endLinkDistance, endLinkGuid, startLinkAttachToPoint, startLinkDistance, startLinkGuid | duration, start |
| CCutsceneNodeFog | 31 | 412 | not named |  | (all) | enabled, name |
| CCutsceneNodeM3A | 12 | 403 | not named |  | (all) | enabled, name |
| CCutsceneNodeEnvironmentLight | 10 | 367 | not named |  | (all) | enabled, name |
| CCutsceneNodeModelMaterial | 5 | 9 | not named |  | (all) | name |
| CCutsceneNodeSoundGroup | 5 | 15 | not named |  | (all) | name, volume |
| CCutsceneNodeHaloController | 1 | 1 | not named |  | (all) | name |

## Reading it

- **Counts:** the writer file names 36 of the 45 kinds, other code alone names 1, and 8 are not named in our source at all. "Named in the writer file" is a weaker claim than "covered": a name can be in the file for one attribute or one case.
- **Named but not written:** `CCutsceneNodeTargetCamera` (a camera that looks at a target) is named only by set import and the catalogue and not written. Its role, a shot aimed at something, is what `CCutsceneNodeLookAt` does in our output; whether the two are interchangeable in the Editor is not checked.
- **Not named anywhere in our source** (so a set imported from a file holding them either carries them through untouched or drops them, which was not checked): `CCutsceneNodeFog` and `CCutsceneNodeEnvironmentLight` (per-scene fog and ambient light, 31 and 10 files), `CCutsceneNodeMasterSound` and `CCutsceneNodeSoundGroup` (sound mixing, 49 and 5 files), `CCutsceneNodeM3A` (an animation-file node, 12 files), `CCutsceneNodeModelMaterial` and `CCutsceneNodeHaloController` (a model's material and halo, 5 and 1 files), and `CCutsceneElementPropertyValue` (a keyed value; our compile uses property curves, `CCutsceneElementPropertyCurve`, instead).
- **Attributes of named kinds that no code mentions** are in the command's second-to-last column (a prompt for a look, per "How it was made"; the last column holds the common words it could not judge). The ones that map to something an author may want: depth of field on cameras (`fstop`, `maxcoc`), speaker mixing and pitch on sounds (`speakerMix*`, `pitchScale`), an actor's cloaking, halo and emissive and diffuse brightness multipliers, fog visibility on lights, and the `link*` attributes that tie one element's start or end to another's. Most of the rest (`sortIndex`, `CreatedByShotMan`, `referenceGuid`) are the Editor's own bookkeeping.

## What this is not

- Not a check that what we write loads in the Editor: that is what the compile's own Editor checks are for (`game-testing.md`, `terrain-checks.md` for the same kind of table).
- Not a list of what the manual says. **Needs a read of the manual** to say whether it describes a feature the files here never show.
- No gap is filed as a ticket: with the manual unread, the list of gaps would be a guess. The candidates are the rows above that no code writes; whether any is worth a ticket is the author's call.
