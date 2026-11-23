# Model Guides

A **Model Guide** is one model's curated description for casting it in a Cinematic. It records what each of the model's Animation Families and notable animations shows and when to use it, and which animations to avoid and why. `model-anims.json` already records each animation's name, length and move speed. Names mislead, though, and the guide records what they don't. A Campaign Mod's custom soldier model has 57 animations: `Stand Victory` is the soldier with her rifle raised, `Stand Victory B` is the soldier weaponless, and `Stand Ridebike` is never wanted.

An **Animation Family** is a model's animations that share their other words, numbered variants aside: `Stand Victory B`, `Talk Victory B 01` and `Walk Victory B` are the family `Victory B`, and `Stand`, `Talk 01` and `Walk` the plain family, `""`. A cast member stands, talks and walks in one family.

The code is `packages/core/src/catalog/model-guides.ts`.

## Where guides live

- **Core** keeps the game's models' guides in `packages/core/data/model-guide.json`.
- **A Workspace** keeps its Campaign Mod's in `mods/<id>/model-guide.json`, beside its `model-anims.json`. It's read into the Campaign Mod's catalog layer ([campaign-catalog.md](./campaign-catalog.md)).

A Workspace's entry for a model replaces core's whole entry for it, so a campaign can override a game model's guide. Guides are kept in a separate file from `model-anims.json` so that re-recording a model's animations never overwrites them.

## The format

A `model-guide.json` is a list of entries, one per model:

```json
[
  {
    "model": "ExampleSergeant",
    "character": "SERGEANT",
    "families": [
      { "name": "Victory B", "shows": "The Sergeant weaponless", "use": "Most of her cutscenes", "default": true, "source": "author" },
      { "name": "Victory", "shows": "The Sergeant with her rifle raised", "source": "author" }
    ],
    "avoid": [{ "anim": "Stand Ridebike", "why": "Never wanted in a cutscene" }]
  }
]
```

- `model`: the model id, as `model-anims.json` keys it. Each model has one entry per file.
- `character` (optional): the speaker the model plays, one the Campaign Mod's Blueprint declares ([characters.md](./characters.md)).
- `families` (optional): each `{ name, shows, use?, default?, source }`. `name` is the family's words, `""` for the plain family. At most one family is the `default`: the one the model stands and talks in when a cast member gives no `anim`. A member whose `anim` picks no family talks in it too.
- `anims` (optional): the notable single animations, each `{ anim, shows, use?, source }`.
- `avoid` (optional): the animations to avoid, each `{ anim, why }`.

An animation or family the guide doesn't list is unreviewed. A guide holds no lengths or move speeds, because `model-anims.json` records those.

### Provenance

Each family and single animation has a `source`:

- `author`: the author said or confirmed it.
- `viewed`: an agent watched the clip and described it, and the author hasn't confirmed it yet.

Don't describe an animation from its name alone: watch the clip.

## What's checked

`check_workspace` (`npm run check-workspace`) checks the Campaign Mod's guides against the recorded animations of their models (core's `model-anims.json` and the Workspace's, [ADR-0026](../adr/0026-workspace-recorded-model-animations.md)) and the mod's characters. Each of these fails the check, reported in `mods/<id>/model-guide.json`:

- A family with no recorded animation of its words.
- A single or avoided animation that isn't recorded. A model whose animations aren't recorded is left unchecked, as a Cinematic's anims are.
- A `character` that isn't one of the Campaign Mod's declared speakers.

A file that isn't a guide list (bad JSON, a missing `why`, two default families, a model given twice) fails the check too, saying where. The mod then has no guides, but the rest of its catalog layer is still read, since guides are advisory. Core's own guides are checked against core's recorded animations by core's tests.

Each Cinematic is checked against its cast models' guides too. Neither of these fails the check:

- **A warning** for a cast member's `anim`, or a shot's anim for a member, that the model's guide avoids.
- **A note** for each cast model that has recorded animations but no guide, at its first cast member.

`check_workspace` prints warnings and notes marked as such, and counts them apart from the errors.

## The default family

A guide's default family is the one its model stands and talks in when a cast member gives no `anim`, and talks in when its `anim` picks no family, in place of the family `castClips` ranks first (`packages/core/src/cutscene/cinematic.ts`): its plain Talks, else `Talk B`, else the family with the fewest words. With `"default": true` on `Victory B`, a Sergeant with no `anim` holds `Stand Victory B` and talks in `Talk Victory B`, where the ranking would give her rifle raised.

- The default takes effect only when the model has a Stand of the family: `Stand Victory B`, else its first numbered one (`Stand Victory B 01`), or for the plain family `Stand`. With none, the ranking picks, as with no guide.
- A family with a Stand but no Talks of its own stands in that Stand and talks in the ranked family's Talks.
- A member's own `anim` still decides what it stands in, and talks in its family when it's a Stand of a family with Talks: `"anim": "Stand Victory"` talks in `Talk Victory` whatever the default. An `anim` that picks no family, a one-off such as `Channel Interact` or a plain `Stand` on a model with no plain Talks, stands in that anim and talks in the default family, when the model has Talks of it. With no default, or none of its Talks, the ranking picks.
- A set mark's character in a Set cutscene (`setCutscene`, `packages/core/src/cutscene/set-cutscene.ts`) stands in its model's default family the same way, unless the mark gives its own `anim` (a pilot's `Ride`, which no Stand family can give).

The default is read from the merged guides, so a Workspace's entry for a model decides its default over core's. Marking a default changes what an existing Cinematic or Set cutscene compiles to: a member who stood in the ranked family now stands in the default, one whose `anim` picks no family now talks in it, and a cutscene that replaces a Kept one reports it as a difference to accept.
