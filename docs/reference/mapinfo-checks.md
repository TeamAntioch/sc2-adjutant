# MapInfo player table and option bits

Our MapInfo writer's version-39 player table and game-option bits, checked for melee maps against the layout in [`sc2-arcade-watcher/sc2-file-format-docs`](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/mapinfo.md) (its `mapinfo.md`, the source of our layout) and against files on disk, read 2026-11-19. The idea of the check comes from another project's notes (see `related-repos.md`, issue #746, part of #735); none of that project's code or text was used, and the Editor was not run.

## Sources

- **The layout:** `mapinfo.md` in sc2-file-format-docs, reverse-engineered from the Windows client and Editor. Its field names for the dual-use fields (light scale, publish mode, default observed player) are from the Editor's code there, not seen in our Editor.
- **A Blizzard melee map and the rest of Blizzard's:** the 21 ladder maps (2019 Season 3 pool: Abyssal Reef to World of Sleepers) and nine Blizzard template maps (`Empty128`, `Flat32` to `Flat128`, `Simple64` to `Simple128`), unpacked. All 30 `MapInfo` files read as version 39 with no byte left over.
- **Our compiled melee map:** `packages/core/tests/fixtures/melee/two-spawns.json`, compiled by `compileMeleeMap`.
- **The Mac Editor's own saves:** `Drift_AutoBackup001.SC2Map` (an Editor autosave, 2026-11-18) and the author's save of a Kept Mission. They show what the Mac Editor writes for fields a ladder map and ours differ on.

## What was checked

The reader `readMapInfoLayout` (`packages/core/src/map/read-map-info-layout.ts`) reads the whole stream in the document's order and refuses a file with bytes missing or left over. Every Blizzard file, every Editor save and our compile pass it, so the stream order our writer uses, including the player entry's field order, the variant block and the lighting and camera block, is the one the Editor writes.

### The player table

Each entry is: slot (u8), control (i32), team (i32), AI name (C string), color (i32), start location (i32), resource flags (u32), AI personality (C string). The count before it is an i32, not a byte.

| Field | Ladder maps (21) | Our melee map | Match |
|---|---|---|---|
| Slots | 0, 1, 2 and 15 on 18 maps; 0, 1, 2 on BelShir Vestige (no Hostile slot); 0 to 4 and 15 on the two four-player maps | 0, 1 to N for N spawns, 15 | Yes |
| Control | Neutral slot 3, users 1, Hostile 4 | the same | Yes |
| Team | Neutral and Hostile 0, **users -1** | the same | Yes |
| AI name | empty (race Any) on every slot | empty | Yes |
| Color index | 0 on every slot | 0 | Yes |
| Start location | 0 (random) on every slot | 0 | Yes |
| Resource flags, personality | 0, empty | 0, empty | Yes |

A Computer player is `control` 2; the Mac Editor's save of that Mission has one as `2, team 0, color 1`, which is what the Mission path writes. Control 2 is a reason a map isn't Melee (`melee-maps.md`).

### The variant block

The start-location list holds the `StartLoc` objects' ids on the two four-player ladder maps (Cactus Valley and Honorgrounds, with an alliance bit set of 4 bits, 10 pairs). It is empty on the other 19, on the Blizzard templates with four users (`Flat48`, `Flat64`, `Flat96`, `Flat128`) and on every Editor save. The start location a user is on is the object's, not this list's; we write it empty and the `StartLoc` objects place the players (`melee-maps.md`). Team slots, teams and the enemy bit set are empty on all 30.

### The game-option bits

`mapinfo.md` names thirteen bits: twelve checkboxes on the Options tab and Wait For Key on the Loading tab. The Editor keeps the rest of the value as it reads it.

| Bit | Name | Ladder maps | Our melee map | Our Mission |
|---|---|---|---|---|
| 0x1 | Disable Replay Recording | clear | clear | clear |
| 0x2 | Wait For Key (Loading tab) | clear | clear | clear |
| 0x4 | Disable Trigger Preloading | clear | clear | clear |
| 0x10 | Use Horizontal Field Of View | clear | clear | clear |
| 0x20 | Hide Errors During Test Document | clear | clear | **set** |
| 0x40 | Disable Observers | clear | clear | clear |
| 0x200 | Stagger Periodic Trigger Events | clear | clear | clear |
| 0x1000 | Show errors online (inverted: set shows them) | clear | clear | clear |
| 0x2000 | Show Game Start Countdown | clear | clear | clear |
| 0x4000 | All Units Use Base Height | **set** | **set** | **set** |
| 0x8000 | Disable View Everyone | clear | clear | clear |
| 0x10000 | Disable Take Command | clear | clear | clear |
| 0x20000 | Disable Recover Game | clear | clear | clear |

All 21 ladder maps have exactly `0x4000`, and our melee map writes exactly that; a Mission writes `0x4020`, as the Mac Editor saves a new map (the Drift autosave and the Kept Mission both read `0x4020`). Only bits 0x1 and 0x10 are melee reasons. The hash counts the bits set (one less per bit), so a flag change that skips the hash is refused by the game: `mapInfoIntegrityHash` takes the flags. Bits 3, 7, 8, 10, 11 and 18 up have no label in the document and are never written.

### The other fields

| Field | Ladder maps (21) | Our melee map | Mac Editor saves |
|---|---|---|---|
| Locale mode | 1 | 1 | 1 |
| Preview type, minimap resolution | 1, 1 | 1, 1 | 1, 1 |
| Difficulty | 0 | 0 | 0 |
| Fog | `Dark` | `Dark` | `Black` on Missions |
| Loading screen type | 0 | 0 | 0 |
| Speed mode, publish mode | 0, 0 | 0, 0 | 1, 0 (speed mode 1 is the Editor's default) |
| Base height | 30720 on 13, 32768 on 7, 6144 on one | 30720 (7.5) | 30720 |
| Light scale (the sim max steps field) | 8192 on 19, 6144 on one, 4096 on one | 8192 | 8192 |
| Default observed player (the speed-below byte) | 16 (none) | 16 | 16 |
| Authors, loading music | none, empty | none, empty | none, empty |

Two of these are not the same as ours, and neither is a reason or a fault we could find:

- **Sim step size and the reserved field** (the two u32 after the light scale) hold large changing numbers on every ladder map (about 1.48 to 1.56 billion, which read as save times), 0 and 0 on the Blizzard templates and on every Mac Editor save and 0 and 0 in our files. They are not in the integrity hash.
- **The lighting and camera block** is 24 bytes (lighting type 0, camera type 0, a zero rectangle) in our files, in the Mac Editor's saves and in `Empty128`. The ladder maps have 32: lighting type 3 with a mode and a value, on 19 (mode 0 and value 2 on 18, mode 1 and value 4 on one), or type 1 with two parameters on Newkirk Precinct and Stasis. Each is a valid stream, and none of its fields is among the melee reasons. What lighting type 3 means in the Editor's UI is not in the document.

## Findings

- The player table and the game-option bits of our melee map are the ladder maps', field for field. Nothing in the writer changed.
- The sc2-file-format-docs layout matches the files: all 30 Blizzard maps, our compile and the Mac Editor's saves read to the last byte under it.
- `read-map-info-fields.ts` (the melee check's reader) stops after the start-location list. The new reader covers the rest.

## Needs an Editor check

- What the ladder maps' lighting type 3 (mode and value) is in the Map Properties UI, and whether setting it on a melee map changes anything in the Editor or the game. We write type 0, as the Mac Editor does for a new map.
- Whether the Editor's Map Status accepts a melee map with the start-location list filled, as on the two four-player ladder maps. Ours is empty and passes (`melee-maps.md`).
- The labels the document gives the dual-use fields (light scale, publish mode, default observed player). Our files and the ladder's agree on the values, but the Editor's menus weren't opened here.
- Whether the game honours the other game-option bits on a melee map (Disable Observers, Disable View Everyone and so on). Nothing writes them.

## Tests

`packages/core/tests/map/map-info-layout.test.ts` compiles the melee fixture and holds its player table and option bits to the ladder's; checks the bit names, the hash against the flags and the reader's refusals; and, with `SC2_LADDER_MAPS` set to a folder of unpacked maps, reads every one of them to the last byte with a hash that holds and the ladder's player table. Blizzard's files are not in the repo.
