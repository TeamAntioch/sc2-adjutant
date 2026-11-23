# Backing for the Boss Principles

Where each principle in `SKILL.md` comes from. The Blizzard evidence is the campaign map scripts and data (StarCraft II 5.0.16 for Wings of Liberty, Heart of the Swarm, Legacy of the Void, the Epilogue and Nova Covert Ops; the original Warcraft III campaign scripts), cited by mission and map id. The design writing is cited by talk or article.

## What Blizzard's campaigns show

- **Bosses are rare.** About 14 dedicated encounters in 75 Wings of Liberty and Heart of the Swarm maps, 16 in the 34 Legacy of the Void, Epilogue and Nova Covert Ops missions (39 map files), and about a dozen true duels across Warcraft III. Most missions have none. (BP-2)
- **A boss is an ordinary unit run by a script.** A big-life heroic unit with a few hidden behaviours, and one controller trigger per boss that picks an attack, orders it, waits for it to finish and repeats, on AI time so cinematics pause it. *Supreme* (`zzerus03`) and *Back in the Saddle* (`zlab02`) work this way; Nova Covert Ops and Legacy of the Void bosses run bespoke loops ticking every 0.0625-1 s. The engine's tactical AI is mostly cleared for bosses; only the Hybrid Dominator and the Xanthos's last form get a think of their own. (BP-16)
- **Every attack is telegraphed twice.** A 2-4 s cast bar or delayed impact in data, plus a ground indicator, ping or transmission in script (*Supreme*, *Back in the Saddle*, the Nova Covert Ops bosses). Heroes of the Storm's Battlefield of Eternity Immortals, on the same engine, give both attacks a 2 s delay with ground warnings. (BP-5, BP-6)
- **Phases come from objectives as often as from health.** Warcraft III uses health thresholds to drive only 2 of 22 detailed fights and gates bosses on arenas, keys and guards instead. Legacy of the Void and Nova Covert Ops prefer shield projectors, unkillable turrets, crystal windows and zone presence. Heart of the Swarm cuts at 75/50/25 % life, polled by script, often only to change an attack's frequency. (BP-11, BP-12)
- **Health floors keep phases.** The Brood Mother (*Belly of the Beast*, `tvalerian02a`) resurfaces at a floor so burst damage can't skip a phase. (BP-11)
- **Invulnerability is always shown**: burrowing, flying, retreating or shielded, never silent. (BP-18)
- **Hero bosses get an intro, an autosave and no mid-fight cutscene.** *Supreme* has a skippable intro and an arena autosave for each boss (`zzerus03`); 9 of 16 Legacy of the Void and Nova Covert Ops bosses autosave at or just before the fight. (BP-17)
- **Story bosses aren't killed by the player.** Stone (*In the Enemy's Shadow*, `nova07`) is downed at 15 % life by a hidden monitor that makes him invulnerable and stunned; Narud is stopped the same way; Warcraft III swaps a 1-HP invulnerable stand-in in for the last lines, then kills the boss and its minions together (the Guardian, *Frostmourne*). Many Warcraft III "bosses" end in a scene or a survival clock. (BP-19)
- **Difficulty is numbers plus one idea.** Boss life rises about 40-80 % from Normal to Brutal; Hard and Brutal often unlock a whole extra attack (the Constructs' Chase Beam, extra eggs, an extra hybrid pair). Warcraft III swaps the boss's unit type, level, mana or items. (BP-20)
- **Allied AI heroes never decide the fight.** In Warcraft III, when the player has two to four heroes in a boss fight, the player controls them all; Computer-owned allied heroes are kept alive by blunt health resets (Tyrande is set back to 50-100 % whenever hit at 350 life or less). (BP-13, BP-14)
- **Blizzard has shipped a companion that dodges by lookup.** In *The Escape* (`nova01`), Stone rides as an untargetable ally on a Computer slot; when the Warhawk fires barrage pattern N, he drives to the authored safe point for pattern N and pauses his attacks. (BP-14)
- **Two-hero templates exist.** The Xel'Naga Constructs (*The Infinite Cycle*, `pulnar02`) punish the close hero and the far hero with different attacks; Narud's duel (*Phantoms of the Void*) has one hero hold the boss while the other runs temples. (BP-13)
- **The boss can notice the companion.** The Archangel alternates its missiles between Kerrigan and her allies (`zlab02`). (BP-15)
- **Soft-locks are guarded.** The Xanthos has an anti-wall timeout, the Eradicators an anti-camping rule, Archimonde an anti-kite rule that sends him on after 3 s without attacking. (CHECKS F8)

## What WoW's solo content shows

- **The companion does steady work and the player does the tests.** Delves' Brann does damage, switches to priority adds, heals and backs up interrupts on his own timing; guides tell players not to rely on him for decisive interrupts. Follower Dungeon NPCs call mechanics out; the player answers them. (BP-13)
- **Survival comes from rules, not smarter dodging.** Blizzard answered "Brann stands in every AoE" with a cut to his area damage, not better pathing; a downed Brann comes back near the player. (BP-14)
- **The best solo fights make the companion part of a mechanic.** Velen's orbs heal the player and interrupt the boss (*The Highlord's Return*); Brann switches to Zekvir's hatching cocoon. (BP-13)
- **Help must be reliable.** Players called Zekvir random when Brann's ability timing was unreliable. A companion that does less but always does it beats one that sometimes does more. (BP-14)
- **Watch combinations that let the companion carry.** Healer players with a tanking Brann trivialised Delves until Blizzard tuned it. (CHECKS C5)
- **Escort-fail is a declared challenge.** *The Highlord's Return* fails if Velen dies, and says so; that's for an optional hard mode, not a story mission. (BP-14)

## What design writing shows

- Mike Stout, "Boss Battle Design and Structure" (Game Developer, 2010) and his telegraphing article (2015): the beat structure of reveal, a teaching phase, escalation, a breather and the full kit; animation, sound and ground markers as one telegraph. (BP-4, BP-5, BP-11)
- Itay Keren, "Boss Up: Boss Battle Design Fundamentals" (GDC 2018): a boss rewards, dazzles, engages and challenges; don't test logic and skill at the same moment; each wave is a peak and a release. (BP-1, BP-11)
- Denny Yeh on God of War's bosses: *spectacle* bosses versus *exam* bosses, and a fair death as one where the player knows what they could have done differently. (BP-1, BP-7)
- Luis Barriga, "Behavior, Patterns, and Techniques in Boss Design" (GDC 2003): arena space as occupied, directly threatened and potentially threatened; matched lists of boss actions and player reactions; make the vulnerability clear; first phase easiest, later phases tuned for a tired, hurt player; environment changes as cheap escalation; replayed sections and unskippable cutscenes wipe what the player just learned; eight archetypes and non-boss climaxes. (BP-4, BP-8, BP-9, BP-10, BP-11, BP-17)
- Mark Brown, "How Cuphead's Bosses (Try to) Kill You" (Game Maker's Toolkit, 2017): attacks exist to make the player move; a safe spot learned in one phase becomes the firing line in the next; show progress on the death screen. (BP-9, BP-17)
- Ion Hazzikostas on raid design (Blizzard, 2014): failure should unravel over seconds rather than wipe the group at once; opt-in harder versions of the same fight beat hidden hard modes. (BP-7, BP-20)
- Jason Bentley on Diablo IV's world bosses (Blizzard, 2023): boss silhouettes and textures redone to read from a top-down camera; staggers that matter but are never mandatory. (BP-5)
- The Sackboy: A Big Adventure team on the Mamapede boss: give struggling players more chances inside one attempt; check every ability against the boss's parts; revive heroes away from the boss and clear hazards where they land; end the fight before a stray hazard can kill the winner. (BP-10, BP-17, BP-19)
- Path of Exile 2 and Hades II player complaints: ground effects that blend into the floor, and danger far from the boss or hidden under effects, are the commonest readability failures from above. (BP-5)
