# A Workspace Records Model Animations by Who Owns the Model

A Cinematic's speaking cast needs its model's animations recorded, with their lengths and move speeds, or the compile refuses the speaker. Core records the game's models in `packages/core/data/model-anims.json`, and a Campaign Mod could keep its own models' in `mods/<id>/model-anims.json`. A mapper who isn't the author can't change core, and a Workspace with no Campaign Mod had nowhere to put a stock model's animations, so the mapper couldn't cast any game model core hadn't recorded (#1020). Tutorial 4 hit this with `SMX3_Marine` and `SMX3_Tech`.

**Where they live.** A model's animations don't depend on the Mission that casts it, so each one is filed by the owner of the model, in the same shape as core's file:

| Owner | File | Read for |
|---|---|---|
| The game | `model-anims.json` at the Workspace root | every Mission and mod |
| The Campaign Mod | `mods/<id>/model-anims.json`, beside its Blueprint | every Mission and mod |
| A Mission (its Map Package's Kept `CModel`s) | `missions/<id>/model-anims.json`, beside its Blueprint | that Mission only |

**Which wins.** The more specific file wins, per model, and an entry replaces the whole entry beneath it: core, then the root, then the Campaign Mod, then the Mission. This is the order Model Guides already use. A Workspace's copy of a stock model can also be correct where core's isn't, for example when it's recorded with a mod loaded that changes the model's RequiredAnims.

## Considered Options

- **One Workspace file for every model.** Simpler, but it would lose who owns each model, so nothing could tell a stock model (worth adding to core) from a mod's own. The Campaign Mod's existing file would also have to move.
- **Per-Mission files only.** Rejected: the same stock model would be recorded again for every Mission that casts it.
- **Require a Campaign Mod.** Rejected: a Workspace doesn't need one, and the tutorials have none.
- **Core always wins for game models.** Rejected: that would override a mapper's deliberate re-recording, and it isn't the order guides use.

## Consequences

- The catalog keeps the files as `modelAnimsLayers`, lowest first. `catalogModelAnims` lays them over core's file. Messages name the file that recorded a model, or `data/model-anims.json` when core did.
- A file that doesn't parse records nothing, and `check` fails on it naming the file. The other files still apply, as with Model Guides.
- `check` warns about an entry in the wrong owner's file, and names the right one: a game model outside the root file, the Campaign Mod's own model outside its file, or a Mission's Kept model outside that Mission's file. A Mission whose Kept data can't be told, because of two packages or an unreadable compile record, isn't judged. It also notes each root entry that core records too. If the two are the same, the root entry can be dropped. If they differ, the Workspace's entry is used until it's dropped.
- Once core carries a stock model, the duplicate note tells the mapper to drop their copy. A root entry is a stock model by definition, which is why recording one offers a Missing-Feature Report to add it to core (#1024).
