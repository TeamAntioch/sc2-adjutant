# The game's data schema

Generic Entries in a Mod Blueprint (`{ catalog, class, id, parent, fields }`, `packages/core/src/mods/generic-entries.ts`) are checked against the game's **Data Schema** before `compile-mod` writes anything. The schema is `packages/core/data/catalog-schema.json`, generated from the install on this machine by `packages/core/scripts/build-catalog-schema.mjs`. Don't edit it by hand.

## Where it comes from

The game ships no machine-readable schema. Its catalog definitions (Blizzard's own `Unit.xml`, `Water.xml` and so on) stay in-house: the only trace in the install is the Galaxy headers generated from them. No XSD, field table or type list is in the CASC storage, the Editor bundle or `SC2Data` (checked on build 98310, 2026-11-01). The schema is therefore read from three things the install does ship, all inside its CASC storage:

| What | Read from | Gives |
|---|---|---|
| Classes per catalog | `mods/core.sc2mod/base.sc2data/triggerlibs/gamedata/<Catalog>.galaxy`, the headers "generated from `<Catalog>.xml` using GalaxyHeader.xtc" | The catalogs (107) and the classes in each (`EClassId…`: 642). A catalog that lists none (ActorSupport, Error) takes the classes found in its own `<catalog>data.xml` files. |
| Field names | `mods/core.sc2mod/enus.sc2data/localizeddata/editor/editorcatalogstrings.txt` | `EDSTR_FIELDNAME_<Class>_<Field>`: every field the Editor shows, used or not, under the class that declares it. `EDSTR_FIELDNAME_S<Struct>_<Field>` names the fields of nested structures. |
| Field shapes and value kinds | Every GameData catalog file in the storage (3,780 files: every mod, campaign and map, the Warcraft III mods included) | For each field, the attributes and nested fields Blizzard writes it with, and the kind of value each attribute holds. |

How they combine:

- **A class's fields** are its own, as Blizzard's entries write them, plus the Editor's fields for the class. It then takes every field of each class it extends, and theirs in turn. The real class hierarchy isn't in the install, so two rules stand in for it:
  - **Its name.** `CAbilEffectTarget` extends `CAbilEffect` and `CAbil`, and `CActorForceSphere` extends `CActorForce`, which Blizzard writes a `Model` in.
  - **What it writes.** A class that writes a field only one other class of its catalog declares extends that class. `CActorModel` writes `Host`, which only `CActorBearings` declares, and `CActorUnit` writes `CActorModel`'s `Model`, so `CActorUnit` has `CActorBearings`' `HostForProps`.

  Both rules over-reach in places. `CActorSiteOp…` takes `CActorSite`'s fields by its name, though it isn't a site actor. A class only ever gains fields this way, so a mistake makes the check laxer, never stricter.
- **A field's shape** is pooled over its catalog: one field name in one catalog is one structure, whichever class writes it. A nested field also takes the Editor's fields for its structure, found in one of three ways:
  - **Its name:** `Modification` takes `SModification`'s.
  - **Its members:** the structures naming most of the members Blizzard writes it with, when that's at least two of them and at least half. A tie counts only when the tied structures are one family, named alike for two words or more. `CmdButtonArray`'s `DefaultButtonFace`, `Requirements` and `State` are `SAbilCmdButton`'s, so it takes `AutoQueueId`. `ImpactLocation`'s `Effect` and `Value` are each `SEffectWhich…` structure's, so it takes `History`. The Effect catalog's `Weapon` is `SEffectModifyWeapon`, so it takes `CooldownAmount`.
  - **A short table in the builder** (`STRUCTURES`), for fields neither of those tells. Blizzard writes only a `Value` in a validator's `Target` and in `RequireCasterUnit`. Those values are location names (`TargetUnitOrPoint`, `CasterPoint` …) and unit names (`Caster` …), so they are `SEffectWhichLocation` and `SEffectWhichUnit`, with their `Effect`. `CGameUI`'s `SoundData` holds `SSoundCategoryDefaults`' fields as well as `SSoundData`'s, since Blizzard writes `Volume`, `MixerPriority`, `DupeFadeOut` and others of them there.
- **Value kinds**: `number`, `asset` (a file path such as `Assets\Units\…\X.m3`), `link:<Catalog>` (90% or more of at least three distinct values are entry ids of that catalog), `string` (enum names, vectors such as `0.1,0.2,0.3`, text), and `any` (seen only empty or as a token). A field the Editor names but no Blizzard entry writes is `{ "any": true }`: known, with its shape unchecked.

## What the check refuses

`schemaProblems` (`packages/core/src/mods/catalog-schema.ts`) names the entry and the field for each of these:

- a catalog that isn't one of the game's, or a class that isn't one the game has;
- a class in the wrong catalog (`CWater is a class of the Water catalog, not Unit`);
- an unknown field, at the top or nested (`CUnit has no field Wingspan`, `State has no field Depth`), with a case-insensitive "did you mean";
- a value of the wrong kind: a non-number in a number field, or a link that holds whitespace or a path;
- a value given where the field is a structure.

A comment inside an entry is checked to be text XML lets a comment hold: a string with no `--` in it and no `-` at its end. Any field element may carry `index` and `removed`, as array entries do. A structure's scalar may be written either as an attribute or as a field of its own (`<Height value="…"/>`), since Blizzard writes both. Tokens pass every kind: `##id##`, `$const`, `{…}` and empty values.

## Comments and class defaults

A Generic Entry keeps the comments inside it. Each one stands where it stood in the entry:

- **Among a structure's fields** (an entry's own fields included), a comment is a `"$comment"` key, and `"$comment2"`, `"$comment3"` … when that structure has more than one. It sits before the field it came before, or at the end.
- **Between an array's items**, a comment is an item holding only `"$comment"`.

```json
"fields": {
  "$comment": " lit at dusk ",
  "On": [{ "Terms": "ActorCreation", "Send": "Create" }, { "$comment": "On Terms=\"Dusk\" Send=\"AnimPlay Glow\"/" }, { "Terms": "Dawn", "Send": "Destroy" }],
  "Model": "Lamp"
}
```

Convert leaves an entry Kept, saying why, when its comments can't come back where they stood:

- A field written more than once is written as one run. When that would put a comment beside other fields than it stood between (an `On`, then `Model`, a comment, another `On`), the entry stays Kept.
- An element of a field written more than once that holds only a comment (`<On><!--x--></On>`) would read back as a comment between the items, not an item.
- A comment inside a field's text (`<Name>Lamp<!--x--></Name>`).
- A comment holding `--` or ending in `-`. XML doesn't allow either, so a Generic Entry's comment can't hold them, and convert doesn't rewrite a comment to fit.

A class's default (`<CDSPLowPassSimple default="1">`) has no id, and neither does its Generic Entry, which gives `"attributes": { "default": "1" }`. Any other entry needs an id, so a forgotten one isn't read as the class's default. Blizzard writes a few other entries with no id (`<CLight>`, `<CDSPLimiter>`); in a mod those stay Kept. A file holding one key twice leaves both Kept, since an entry is written once. A class default is keyed by its class alone (`CDSPLowPassSimple`), as the compile record and the Kept Report name it, and one file holds one per class.

A template entry declares the `##token##`s its children fill in with `<?token?>` processing instructions, before its fields: `<?token id="abil" type="CAbilLink"?>`, `<?token id="unitName" type="CUnitLink" value="Bogus"?>`. Its Generic Entry keeps them in order as `"tokens": [{ "id": "abil", "type": "CAbilLink" }]`, each with its `type` and default `value` when it has them, and the compile writes them back as the Editor does: first in the entry, attributes in the order id, type, value. A template that declares tokens is written `default="1"` first (`<CSound default="1" id="Dialogue" parent="Mission">`), as every one in Blizzard's catalogs is. The Equivalence Check compares the declarations, in their order, so a dropped or changed token is a difference. Convert leaves Kept an entry with a token after a field or comment or inside a field, tokens on an entry that isn't a template, a token declared twice, or a declaration with attributes other than id, type and value; a Blueprint's entry is refused the same. A line's CSound with tokens isn't one a sound set writes.

## Known gaps

On a full Campaign Mod (2026-11-01), all 2,811 catalog entries fit the schema and convert, and its compile passes the Equivalence Check with no Accepted Differences. No gap found there is left.

A field Blizzard never writes in a given place, and the Editor's strings don't name for that structure or class, still reads as unknown in another mod. To close one, extend the builder: find where the field is named (Editor strings, a Blizzard entry), then regenerate. Prefer a rule over the `STRUCTURES` table when one tells it. Don't hand-edit the JSON.

## Refreshing it

After a game patch, or to change the builder:

```sh
# 1. A CASC extractor, named in SC2_CASC_TOOL (tools/README.md)
# 2. The schema: the script extracts the storage's catalogs, headers, Editor strings and build id
#    (about 125 MB) into a scratch folder, then reads them; it needs core built, for its XML reader
npm run build -w @team-antioch/sc2-adjutant
node packages/core/scripts/build-catalog-schema.mjs "/Applications/StarCraft II"
```

The JSON records the build it was read from (`build`, `B98310` now). Commit the regenerated file with the patch's other data changes, then run the mod tests and a `convert-entries` pass over a Workspace mod to see what moved.
