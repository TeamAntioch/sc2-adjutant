# Boss mechanics

A catalog to draw attacks, phases and companion jobs from. Each entry says what it is, where it comes from, which hero it suits (*close*: a melee hero; *range*: a ranged hero; *both*), and what the companion does. Every entry ports to SC2's top-down camera with click-to-move; the `boss-build` skill has the engine pieces. Examples marked WoW are World of Warcraft dungeon, raid or solo fights, kept only where they still work for one hero plus a companion.

## Archetypes

Starting points, not finished bosses (Barriga, GDC 2003):

- **Rusher**: charges at the hero; open after it hits a wall or the wrong thing. *Close.*
- **Jumper**: leaps at the hero; a shadow or marker shows the landing.
- **Spawner**: the pattern is what it spawns, where and when. The companion's natural fight.
- **Bomber**: flies over and drops hazards, sometimes ones the heroes can throw back.
- **Centerpiece**: static; open when its rotation and the hero line up.
- **Russian doll**: a smaller, harder boss climbs out of the big one.
- **Piecemeal**: destroyable parts, each removing an attack. Watch for a harmless last part that leaves dead time.
- **Rival**: an enemy hero with the player's own kit, real visibility checks, and a few authored blink points (Stone, *In the Enemy's Shadow*, `nova07`).

Non-boss climaxes, when a boss would be one too many: the **gauntlet** (waves with a spawn pattern), the **chase**, the **race**, and the **survival clock** (Archimonde, *Twilight of the Gods*; the boss is the timer).

## Ground telegraphs

- **Baited circle that leaves a puddle**: a circle under the hero fills, hits, and leaves a damaging pool; the hero drops it at the arena's edge. WoW: Earthshattering Spear (Priory of the Sacred Flame). *Range* (it rewards moving between shots). Companion: not targeted; walks round the pools.
- **Frontal cone at a target**: the boss turns and breathes, slams or sweeps a cone. WoW: Blazing Belch (Cinderbrew Meadery). *Close.* Companion: steps round the boss's flank.
- **Ring or donut**: safe inside or safe outside, telegraphed by the marker's shape. *Both.*
- **Line charge**: a rectangle from the boss along its facing, then the charge. Drag it into a wall or a hazard for an opening (rusher). *Both.*
- **Lane strike**: the boss hits the third of the arena with the most units (Zurvan, *Supreme*, `zzerus03`). Teaches the heroes to spread.
- **Chasing beam**: a slow beam follows one hero; whoever stays back is punished (the Xel'Naga Constructs' Chase Beam on hard, *The Infinite Cycle*, `pulnar02`). *Range* is punished; the companion may be the chased one on a set loop.
- **Storm with a safe eye**: the whole arena hits except a moving safe spot. WoW: Shadow Gale (Grim Batol). Companion follows the safe point.

## Range bands

- **One attack per band**: a slam on the closest hero within a short range, a blast at range, a chase beam for whoever hangs between (the Xel'Naga Constructs, `pulnar02`). Each hero has a job and standing still is punished. The best two-hero template for a melee and a ranged hero together.
- **Leash**: "stay close or the boss punishes everyone". A close hero holds it; the companion is told not to wander.

## Movement

- **Knockback** off a ledge or into a hazard; **pull-in then explode**, anchored by standing in a pool (WoW: Cosmic Singularity, Ara-Kara). *Both.*
- **Root, slow or stun** windows short enough for a click-to-move hero; cap any loss of control at about 2 s.
- **"Don't move" versus "move out"**: two casts with opposite answers, told apart by their markers (WoW: Torghast's Kosarus).

## Positioning

- **Line of sight behind a pillar**: the boss charges a blast; heroes hide behind cover. Needs a script check from boss to hero. WoW: Sindragosa's Frost Bomb.
- **Drag the boss onto a hazard**: the boss stacks a buff or takes damage on a marked area. WoW: Soul Harvest (Waycrest Manor). *Close* holds it; the companion keeps aggro off.
- **Kite a fixating add**: an add locks onto one hero and must be kited or killed. WoW: Grim Batol's Shadowflame spirits. Companion: kills what fixates the player.
- **Destroyable cover**: statues that block a line attack once. WoW: Darkflame Cleft.

## Interrupts and shields

- **Interrupt the big cast**: one long, interruptible cast at a time, aimed at a named hero ability (a snipe, a dash). Never a rotation. The companion is backup only.
- **Interrupt pickup**: the companion drops orbs that interrupt the boss when the hero walks through them (Velen's Holy Ward, WoW Mage Tower *The Highlord's Return*).
- **Break a shield to stop a channel**: the boss shields and channels; enough damage in time breaks it (WoW: Savage Mauling, Priory). A burn window the companion adds damage to.
- **Shields that strip one stack per hit**: many small hits beat it, which favours the faster hero (WoW: Torghast).
- **Stop attacking**: a window where attacking the boss is punished (a reflecting shield, adds spawning per hit). WoW: Capacitus's reflect shields; Torghast's Cellblock Sentinel. A test of the companion's hold-fire.

## Adds

- **Adds that heal or empower the boss if they reach it**: they walk in; kill them on the way (WoW: Brew Drops, Cinderbrew). The companion kills the nearest.
- **Hatching add**: an egg or cocoon hatches into something worse unless killed in time (Blightbringer's eggs, *Night Terrors*, `nova05`; WoW: Zekvir). The companion switches to it.
- **Find the real one**: the boss splits into clones with its life that deal no damage; the real one is hidden (the Hybrid Dominators' Psychic Clones, *Hand of Darkness*, `zhybrid02`). Give the companion's AI the cheat of knowing the real one.
- **Adds only while in combat**, on a timer, aimed at anyone in the arena (the Forgotten One, WC3 *The Forgotten Ones*).

## Phases and gates

- **Objective gate**: the boss is invulnerable until objectives are done (the Tal'darim Mothership's shield projectors, *Trouble in Paradise*, `nova04`; the Purifier, *Safe Haven*). The boss becomes the clock.
- **Story key**: the boss can't be beaten until the heroes hold something (Tichondrius and the Skull of Gul'dan, WC3). Punish early attempts readably: a full heal and a line naming the key.
- **Immune intermission**: the boss leaves or shields while an objective runs. *Both*: one hero holds a point, the other runs the objective.
- **Arena change at a cut**: a rig falls and electrifies a floor, creep spreads, lava rises, doors close.
- **Pocket arena**: a solo hero's fight in a sealed room: the rest of the map paused, the playable area clamped, the boss reset on death (*Night Terrors*, `nova05`). For when the story splits the heroes.

## Two heroes

The mechanics that give the companion a job the player can see. The companion must always be able to do its half.

- **One holds, one runs**: one hero holds the boss (a beam duel, a tug of war) while the other runs objectives that shift the struggle (Narud, *Phantoms of the Void*, `zhybrid03`).
- **Authored safe points per pattern**: the boss's pattern names its safe spot and the companion goes there (the Warhawk's missile barrages and Stone's matching safe points, *The Escape*, `nova01`). Rotate which points are safe.
- **Grabbed and freed**: one hero is grabbed, imprisoned or entombed; the other frees them. WoW: Kologarn's Stone Grip; Mchimba's sarcophagi (Kings' Rest), where the trapped one shakes their coffin and the free one finds it. Companion: either side.
- **Mind-controlled companion**: the boss dominates the companion, and the player beats it down to free it while the boss is open. WoW: Ingra Maloch and Droman (Mists of Tirna Scithe).
- **Tether**: a beam between the heroes that must be broken by distance, or kept by staying close. WoW: Mind Link (Mists of Tirna Scithe).
- **Polarity**: each hero carries a charge; opposite charges close together hurt both, like charges close together boost damage; a hero standing alone is unaffected. WoW: Mechano-Lord Capacitus (heroic).
- **One hero per damage type**: adds or shields that only one hero can hurt, colour-coded (StarCraft II co-op's Polarity mutator). Gives the companion its own targets.
- **Swap the attacker**: the boss alternates a shield that punishes ranged attacks and one that punishes close attacks; the right hero attacks in each.
- **Mark: move away from your ally**: a debuff that explodes on whoever is near the marked hero. WoW: Living Bomb (Molten Core).
- **Hot potato**: a debuff that jumps to the nearer hero when it expires. WoW: Chaotic Corruption (The Rookery).
- **Twin bosses**: one per hero, killed close together or kept apart.
- **The boss hits the companion too**: it alternates targets between the hero and the allies (the Archangel, *Back in the Saddle*, `zlab02`), and its blasts hurt its own troops, so it can be lured onto its adds.

## Stealth

When a hero cloaks, detection becomes a boss axis.

- **Revealing sweep**: a pulse or searchlight reveals cloaked units in its area; heroes hide outside it.
- **Detector add**: the boss brings in a detector that must die before cloak works.
- **Backstab window**: one hero holds the boss's attention while the cloaked one strikes from behind.
- **Cloak as the answer** to one wipe-level cast.
- **A boss that cloaks**: the heroes need detection, a reveal or the companion's call-out.
- **Passive until touched**: a boss that waits until attacked lets the stealthy hero choose when to start (the Ghostly Archmagi, WC3 *Dungeons of Dalaran*).
- **"Cloak won't work here"**: the boss has True Sight, and the player is told up front (Magtheridon, WC3 *Lord of Outland*).

## Don't port

- Soaks split across three or more players, healer checks, dispel-centric mechanics, and rotating assignments.
- Facing tests ("look away"), which click-to-move can't express.
- Loss of control longer than about 2 s.
- Escort-fail ("the ally must live") outside a mission that declares it.
