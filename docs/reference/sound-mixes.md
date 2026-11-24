# Sound mixes

A **sound mix** is several CSounds played as one sound, each from its own time after the mix starts: a blood
spray at 0.1 s, a death cry at 0.35 s, a metal thud at 0.67 s. Mixes like this are easy to audition from a
trigger script, with a `Wait` between each `SoundPlay`, but a unit's death, attack or hit plays its sounds from
data. `sound_mix` (MCP) and `npm run sound-mix` (CLI) make the actor data that plays one, from a list of
layers. The `sound-mix` skill covers designing one.

## Why a CActorSound's Layers

A CSound can't layer. Its `AssetArray` holds variations, and each play picks one of them. A `CActorSound`
can: besides its `Sound`, it holds `Layers`, each with its own CSound, played after its own `PlayDelay`.
Every layer is a whole CSound, so it keeps its own variations, volume and pitch. Blizzard's co-op mod uses
`Layers` this way in 188 sound actors (`DehakaGlevigBase_UnBurrow_AS`: a burrow sound now and a tunnel sound
500-750 ms later), `Void.SC2Mod` in 43 and the Void prologue in 5.

A layer's fields, as the Editor names them (`SActorSoundLayer`):

| Field | What it holds |
|---|---|
| `Sound` | The CSound |
| `PlayDelay` | When it starts after the actor's own sound, in milliseconds, as a range: `min,max` (`500,750` starts it somewhere between). A mix gives both ends the same |
| `PlayDelaySource` | `Actor` takes the layer's `PlayDelay`; `Sound` takes the CSound's own |
| `Volume`, `VolumeSource` | A dB range, and whether the layer's (`Actor`) or the CSound's (`Sound`) is used |
| `Pitch`, `PitchSource` | A semitone range, and the same choice |
| `Chance` | The percent chance the layer plays at all; Blizzard writes 100 |

A mix writes `PlayDelaySource Actor` and the `Sound` sources for volume and pitch, so each layer plays as its
CSound would played alone, which is how a trigger audition plays it. A CSound with its own `PlayDelay` loses it
in a mix: the layer's time replaces it.

The actor's own `Sound` plays at once. A mix plays its first layer at 0 as that sound. With no layer at 0, it
plays a silent one, as Blizzard's layered actors do: `Nova_SniperRifleTail_Dummy` in `Void.SC2Mod` (Chance 0,
-90 dB), which 15 of Blizzard's layered sound actors use. A mod that doesn't load `Void.SC2Mod` names its own
silent CSound in the mix's `silent`.

## Playing on after the unit dies

A sound played on a unit after it has died is dropped: `SoundPlayOnUnit` on a dead unit plays nothing. A
sound actor isn't the unit, though. The game plays every unit's death sound through `UnitDeathSound`, which is
hosted on its creator (`Host ::Creator`), takes its place once, and lets go of it on creation (`RefClear
::Host`, "we get props and bearings once, and then stop"). A mix's actors do the same, with
`SoundFlags UpdateVisibility 0` as `UnitDeathSound` has, so a mix created on a death keeps playing where the
unit was while its death animation plays and after its actor is gone.

The unit's actor creates the mix, on the event it's for:

```xml
<CActorUnit id="Golem" ...>
    <On Terms="UnitDeath" Send="Create GolemDeathMix"/>
    <On Terms="WeaponStart.*.AttackStart" Send="Create GolemSwingMix"/>
</CActorUnit>
```

A trigger can create one too: `ActorSend(ActorFromUnit(u), "Create GolemSwingMix")`.

## Stopping a layer

`Layers` all belong to one actor, so they end together, when the actor goes. A layer that stops early (a
charge-up cut off at the strike) is an actor of its own, `<mix>_<n>` for the mix's n-th layer, which the mix
creates with itself. It plays its layer after the same delay and stops itself with an actor timer
(`TimerSet <stop> Stop`, then `TimerExpired; TimerName Stop`):

- **Cut:** `Destroy` at the stop. *Untested: whether the game cuts the sound dead or fades it out briefly.*
- **Fade:** at the stop, `SoundSetVolume Logarithmic 0.000000@0.000000,-96.000000@<fade ms>` takes it from its
  volume to silence over the fade, and a second timer destroys it when the fade ends. The message's points are
  `<dB>@<ms after the message>` (`SoundSetVolume Logarithmic 0@0,0@1200` in Blizzard's data holds a sound
  steady for 1.2 s). *Untested: the fade's sound.* `SoundSetMuted 1 1` (muted, fading) is the other way the
  actor messages fade a sound; its fade's length is the CSound's `MuteFadeOut`, which a mix can't set for a
  stock CSound.

## The mix file

One mix or a list of them, as JSON:

```json
{
  "id": "GolemDeathMix",
  "layers": [
    { "sound": "Separatist_Death_Evis_BloodSpray", "at": 0.1 },
    { "sound": "Blood_Spurt", "at": 0.12 },
    { "sound": "Battlecruiser_YamatoAttackChargeUp", "at": 0.1, "stop": 2.67, "fade": 0.25 },
    { "sound": "Terran_CovertOps_Large_Metal_Impact", "at": 0.67 }
  ]
}
```

| Field | What it is |
|---|---|
| `id` | The mix's actor, created with `Create <id>` |
| `layers[].sound` | A CSound id |
| `layers[].at` | When it starts, in seconds after the mix is created |
| `layers[].stop` | When it stops, in seconds after the mix is created; it plays to its end without one |
| `layers[].fade` | How long it fades out over from its stop, in seconds; it's cut off at the stop without one |
| `silent` | The silent CSound to play when no layer starts at 0 (default `Nova_SniperRifleTail_Dummy`) |

## Checking the CSounds

A CSound id that's defined nowhere plays nothing, with no error in the game, so every id a mix plays is
checked before its data is made:

- **The game's**, by package: core's `data/package-entries.json` lists the CSound ids each of the game's
  packages defines (built from the game data mirror by `scripts/build-package-entries.mjs`). Each id is
  reported with its packages (`Blood_Spurt: Void.SC2Mod`), so a mod that doesn't load that package can tell.
- **The Workspace's own**: `sound_mix` reads the CSounds every Workspace mod defines, in its package and in its
  Blueprint's Generic Entries.
- **Any others**: `sounds` (MCP) or `--sounds` (CLI) names more: a `SoundData.xml`, a JSON file of Generic
  Entries, or a folder of them, such as a Mission's or a test map's `.SC2Map`.

An id found nowhere is refused, with a near match if one differs only in case.

## Making the data

```
npm run sound-mix -- <mix.json> [--xml] [--sounds <file or folder>]... [--out <file>]
```

The CLI prints Generic Entries (for a Mod Blueprint's entries: put them in an `ActorData` entries file the
Blueprint lists), or with `--xml` the elements to add to a map's `Base.SC2Data/GameData/ActorData.xml`. It lists
each CSound and where it's defined, and the line that creates the mix. `sound_mix` takes the mixes as its
`mixes` argument and returns the same.
