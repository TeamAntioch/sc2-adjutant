# Encounter Principles: backing

Each principle's backing. Source tags: [dev] a developer on their own work, [data] game files, [wiki] fan wiki, [forum] player posts, [critic] press, [ld] level-design theory, [secondary] an explainer drawing on developers, [mine] our inference. Talk citations are YouTube auto-captions, linked at their timestamp. No Blizzard map file has been measured, so every size here is a starting point to check in the Editor. The props' backing is in [`PROPS.md`](PROPS.md).

## EN-1 Write the encounter down

**Derive each mission's one dominant mechanic from the heroes' fantasy, then author the mission as a chain of named encounters.**

- *Backing:* Every Blizzard hero mission has one dominant mechanic: detection in Breakout, Dominate in Ghost of a Chance, one ability per room in Back in the Saddle, pack-leader gauntlets in Supreme [wiki]. Huck, then lead level designer, lists the pattern first-hand: walls of fire, flash freezes, day/night zombies, then LotV's moving base [dev]. Blizzard picks the mechanic from the character.
- *Evidence:* Well-sourced for mechanic-first and for the encounter as the unit. Our inference for "6–10 encounters per mission".
- *Sources:* [Fandom: Breakout](https://starcraft.fandom.com/wiki/Breakout), [Fandom: Back in the Saddle](https://starcraft.fandom.com/wiki/Back_in_the_Saddle), [LotV panel 11:37](https://www.youtube.com/watch?v=sKp_7buQ-v8&t=697s), [Huck, BlizzCon 2016 interview 04:09](https://www.youtube.com/watch?v=lylVQAwZhqM&t=249s), [LotV panel 32:43](https://www.youtube.com/watch?v=sKp_7buQ-v8&t=1963s), [GoW level design talk 21:47](https://www.youtube.com/watch?v=eSB29qx6sWw&t=1307s), [Desperados III devcom 26:30](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1590s), [Taylor Part 2](https://gamedeveloper.com/design/ten-principles-of-good-level-design-part-2-), Engadget's 2011 interview with Jaime Griesemer ("Half-minute Halo")

## EN-2 Readable before triggered

**Let the player read each fight before triggering it, and keep ambushes rare and survivable through spacing, not visible hesitation.**

- *Backing:* Larian pre-positions enemies so the player can "take advantage of the battlefield" before combat [dev]. Wagner wants players "to not be surprised" and to deduce what is going on [dev]. Desperados III's bushes are ideal cover because players sit in them, watch and plan [dev].
- *Evidence:* Well-sourced in principle. The SC2 adaptation is our inference.
- *Sources:* [RPG Site, Holland](https://www.rpgsite.net/interview/9494-baldur-s-gate-iii-interview-discussing-combat-and-gameplay-with-larian-studios-designer-matt-holland), [Shadow Tactics GDC 05:18](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=318s), [Desperados III devcom 33:54](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=2034s), [Softpedia](https://www.softpedia.com/reviews/games/pc/Dawn-of-War-II-Review-105623.shtml), [Halo talk 41:04](https://www.youtube.com/watch?v=76kZtNaetx0&t=2464s), [42:07](https://www.youtube.com/watch?v=76kZtNaetx0&t=2527s)

## EN-3 A positioning tool, and a second exit

**Give every encounter space at least one hero positioning tool (high ground, choke or ramp, line-of-sight blocker, kiting loop), and give narrow spaces a second exit.**

- *Backing:* Holland: "if the level design is altered one way or another, the fight can play out to a very different degree" [dev]. Griesemer said destructible cover "ruins the encounters" [dev], and Halo pairs interconnected spaces with killing zones [dev]. Desperados III names verticality, entry points and cover as setup building blocks.
- *Evidence:* Well-sourced.
- *Sources:* [RPG Site](https://www.rpgsite.net/interview/9494-baldur-s-gate-iii-interview-discussing-combat-and-gameplay-with-larian-studios-designer-matt-holland), [PC Gamer](https://www.pcgamer.com/games/halo/one-original-halo-designer-blasts-the-new-remake-wonders-if-the-point-was-just-occupying-an-enormous-art-team-while-you-figure-out-what-to-do), [Halo talk 35:45](https://www.youtube.com/watch?v=76kZtNaetx0&t=2145s), [Desperados III devcom 28:38](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1718s), [32:49](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1969s), [GamesRadar retrospective p.2](https://www.gamesradar.com/how-dawn-of-war-ii-risked-it-all-to-push-a-genre-forward/2/), [Fandom](https://starcraft.fandom.com/wiki/Supreme)

## EN-4 Size it to the heroes, one screen

**Size each encounter space to the heroes' ranges and mobility, write the sizes down as building codes, and keep a setup within one screen at default zoom.**

- *Backing:* id sizes arenas to mobility: "Too big, you actually feel slow. Too small, you're frustrated" [dev]. Mimimi gives the screen bound first-hand: a setup "fits in one screen. Generally it's two screens but in the perfect world it would be one" [dev].
- *Evidence:* Well-sourced (first-party) for the principle and the one-screen bound. Our inference for all cell numbers.
- *Sources:* [Game Developer Q&A](https://gamedeveloper.com/design/q-a-evolving-the-combat-design-of-id-software-s-i-doom-eternal-i-), [Desperados III devcom 26:30](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1590s), [GoW level design talk 12:28](https://www.youtube.com/watch?v=eSB29qx6sWw&t=748s)

## EN-5 Threats stay local

**Keep each encounter's threats local, and seal encounter spaces from each other visually.**

- *Backing:* Wagner's "tactical horizon" is that players say they plan holistically but actually engage the nearest guard, get seen, reload, and add that guard to their picture. So Shadow Tactics has no long patrols "going many minutes around the map", guards stay close together, and areas are separated so "you cannot see from one area into the other" [dev]. Serr's node layout needs each challenge resolved "so that they don't bleed into other adjacent nodes" [ld].
- *Evidence:* Well-sourced.
- *Sources:* [Shadow Tactics GDC 22:04](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1324s), [23:06](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1386s), [Non-linear levels 10:21](https://www.youtube.com/watch?v=CTBor4rhnQs&t=621s), [AI and Games TLOU 12:32](https://www.youtube.com/watch?v=7MVzKuQ5SfY&t=752s)

## EN-6 Two authored states

**Give each enemy encounter two authored states: an aggressive territory and a smaller fallback, switched by casualties or hero position. Author places, not moves.**

- *Backing:* Each Halo encounter has an aggressive territory and retreat conditions (casualties, player position) that collapse it into a smaller defensive one, which produces ebb and flow. About 80% of encounters used just these two states [dev]. Designers place context-free points and code scores them. "The designers do not place hints or anything" [dev].
- *Evidence:* Well-sourced for the model (first-party). The Galaxy implementation is our inference.
- *Sources:* [Halo talk 36:49](https://www.youtube.com/watch?v=76kZtNaetx0&t=2209s), [47:18](https://www.youtube.com/watch?v=76kZtNaetx0&t=2838s), [04:12](https://www.youtube.com/watch?v=76kZtNaetx0&t=252s), [14:49](https://www.youtube.com/watch?v=76kZtNaetx0&t=889s)

## EN-7 Roles on two axes

**Give each enemy type one clear role on two opposed axes, and build encounters from 2–3 roles, including a mutually covering pair, rather than from more bodies.**

- *Backing:* Diablo III's goal was "less spam more depth", meaning fewer trivial enemies, each with an exploitable behaviour [dev]. Hugo Martin calls Doom's demons "chess pieces" [dev]. The Meaningful Choice talk explains why this works.
- *Evidence:* Well-sourced (ARPG, FPS and top-down tactics; not RTS).
- *Sources:* Engadget's report of the WWI 2008 Diablo III design-fundamentals panel, [Game Developer](https://www.gamedeveloper.com/design/the-aggressive-resource-management-of-i-doom-eternal-i-), [Meaningful Choice 33:19](https://www.youtube.com/watch?v=BEF4GVNzkUw&t=1999s), [37:28](https://www.youtube.com/watch?v=BEF4GVNzkUw&t=2248s), [51:57](https://www.youtube.com/watch?v=BEF4GVNzkUw&t=3117s), [Shadow Tactics GDC 28:16](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1696s), [Desperados III devcom 26:30](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1590s), [29:40](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1780s), [34:56](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=2096s), [Pillars retrospective 22:59](https://www.youtube.com/watch?v=F0RW3upLoJI&t=1379s), [41:56](https://www.youtube.com/watch?v=F0RW3upLoJI&t=2516s)

## EN-8 Telegraph through the world

**Telegraph threats through the environment, spawn enemies from visible sources, and announce reinforcements with an alarm. Vary scripted waves on retry, and make AI state changes loud.**

- *Backing:* Ghost of a Chance places a gold mineral cart below the sniper ridge before the pin-down [wiki]. Retribution's enemies emerge from rock walls, foliage and hangars [dev]. Serr: "using an invisible trigger to spawn enemies on the map is a lot worse than an alarm state in a stealth game", because the alarm gives information [ld].
- *Evidence:* Well-sourced.
- *Sources:* [Fandom](https://starcraft.fandom.com/wiki/Ghost_of_a_Chance), [Darwin Yuen](https://darwinyuen-designer.squarespace.com/dow-2-retribution), [Non-linear levels 15:32](https://www.youtube.com/watch?v=CTBor4rhnQs&t=932s), [Meaningful Choice 43:38](https://www.youtube.com/watch?v=BEF4GVNzkUw&t=2618s), [Non-linear levels 12:25](https://www.youtube.com/watch?v=CTBor4rhnQs&t=745s), [Halo talk 39:13](https://www.youtube.com/watch?v=76kZtNaetx0&t=2353s), [Dalaran](https://warcraft.wiki.gg/wiki/The_Dungeons_of_Dalaran), [The Forgotten Ones](https://warcraft.wiki.gg/wiki/The_Forgotten_Ones)

## EN-9 Build on the kit's shape

**Give each hero a kill, a "distraction" (a tool that rearranges enemies) and a signature. Make the heroes' tools combine without bespoke pair actions, and keep their micro load low enough that squad casters still get used.**

- *Backing:* Every Shadow Tactics character gets a melee kill, a defining special and a distraction. The distraction is "the most important" skill because it is how players break setups, while the kill is "very binary". Mimimi bans the "driver", a character who works only as a key [dev].
- *Evidence:* Well-sourced for the genre (first-party Mimimi, Obsidian). Moderate for SC2 (forum, critic and co-op evidence).
- *Sources:* [Shadow Tactics GDC 07:24](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=444s), [09:30](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=570s), [12:37](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=757s), [14:43](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=883s), [Shadow Tactics postmortem](https://www.gamedeveloper.com/business/postmortem-mimimi-s-i-shadow-tactics-blades-of-the-shogun-i-), [Pillars retrospective 24:02](https://www.youtube.com/watch?v=F0RW3upLoJI&t=1442s), [GamesRadar](https://www.gamesradar.com/warhammer-40000-dawn-of-war-ii-chaos-rising-review/), [TL HotS review](https://tl.net/forum/starcraft-2/402757-heart-of-the-swarm-an-overview-and-review-aa)

## EN-10 Built for one tool, needed the first time

**Build each encounter for one tool from either hero, and tune it so that tool is needed on a first playthrough. Raise enemy toughness rather than tool damage, and let skilled replays bypass it.**

- *Backing:* A TL author calls HotS's Infested promising but ruined, because "OP infestors and Kerrigan" meant "you don't even really need any of the virophages", and loves Piercing the Shroud because its fights are too strong without the pickups [forum]. Mimimi builds bottlenecks around the least mobile characters so that the others stay free [dev], and only one character can remove a key guard [dev]. Atreus "couldn't even... shine" while bandits died in three hits.
- *Evidence:* Moderate (one detailed poster plus first-party practice from two studios).
- *Where sources disagree:* This is in tension with the rule below that the heroes alone must be able to win. They reconcile if "needed" means needed for the intended approach on Normal, while a hero-only path stays possible but costly.
- *Sources:* [TL](https://tl.net/forum/single-player/507931-favourite-campaign-missions), [Shadow Tactics GDC 21:01](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1261s), [Desperados III devcom 29:40](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1780s), [Atreus talk 08:33](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=513s), [20:19](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1219s), [Desperados III devcom 37:04](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=2224s)

**Every mission must be winnable with the guaranteed minimum roster (the two heroes). Squad units and allies widen the options but are never required.**

- *Backing:* CoH3's designers build missions so "they can always be completed" with any company or perks [dev]. Myth's fixed armies could slide into unwinnable states [critic].
- *Evidence:* Well-sourced for "winnable with any loadout". Applying it to heroes alone is our inference.
- *Where sources disagree:* God of War makes the companion the vehicle for a level's mechanic: "press square and [he] fires the arrow for you" [dev]. That works because Atreus can't be lost.
- *Sources:* [PCGamesN](https://www.pcgamesn.com/company-of-heroes-3/dynamic-mission-design), [PC Gamer](https://pcgamer.com/games/strategy/i-wish-bungie-would-stop-designing-excellent-multiplayer-shooters-and-go-back-to-making-fantasy-strategy-games-where-you-blow-up-zombies-with-dwarf-bombs/), [GoW level design talk 21:47](https://www.youtube.com/watch?v=eSB29qx6sWw&t=1307s)

## EN-11 Bosses end through mechanics

**End bosses through mechanics (phases, arena changes, adds, ally and environment use), not by draining a large health bar. Prefer not to build pure boss gauntlets.**

- *Backing:* Supreme is the most-named hated hero mission: about 6 posters call it a "watered-down boss-to-boss fighter" and a "Diablo 3 clone" [forum]. DoW2's bosses were "wearisome slogs of attrition" [critic], "aggravating damage sponges" [critic], and "some of them way too much health". But "the best of them were those bosses that brought out other smaller squads to fight for them" [critic].
- *Evidence:* Well-sourced for the failure. Moderate for adds as the fix. No DoW2 developer statement on boss intent was found.
- *Where sources disagree:* Destructoid's favourite HotS mission was Supreme [critic]. Alteredgamer said DoW2's bosses "massively redeemed" it, while bit-tech found them "surprisingly shallow" [critic].
- *Sources:* [Battle.net 21592](https://us.forums.blizzard.com/en/sc2/raw/21592), [Battle.net 12739](https://us.forums.blizzard.com/en/sc2/raw/12739), [VideoGamer](https://www.videogamer.com/reviews/warhammer-40000-dawn-of-war-ii-retribution-review), [Softpedia](https://www.softpedia.com/reviews/games/pc/Dawn-of-War-II-Review-105623.shtml), [Shadow Tactics GDC 42:50](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=2570s), [Atreus talk 35:03](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=2103s), [Destructoid](https://destructoid.com/?p=146651), [Alteredgamer](https://www.alteredgamer.com/dawn-of-war-2/31596-dawn-of-war-ii-review-defeat-is-not-the-end), [bit-tech](https://bit-tech.net/reviews/gaming/pc/dawn-of-war-2-pc-review/6/)

## EN-12 Stealth is optional, readable and reactive

**If a mission uses stealth, make it optional, readable and reactive: detection visuals must match the real zone, rules must be uniform per enemy type, patrols deterministic, and guards must respond to events.**

- *Backing:* Huck, first-hand: detection circles "weren't interesting enough", "a very binary kind of gameplay", so NCO went "all in" on vision cones as "just a starting point" and explored "motion based or... audio based" stealth [dev]. Wagner: "The Viewcone is the single most important factor for designing enemy encounters", and readability needs "sharp edges and clearly defined areas" [dev]. Shadow Tactics rejected fog of war because the guard could see you while you couldn't see him [dev].
- *Evidence:* Well-sourced (now including the NCO designer first-hand).
- *Where sources disagree:* Mimimi wants deterministic patrols, while critics want reactive guards. Patrols can be fixed until an event (a body found, an alarm) triggers a fixed response.
- *Sources:* [Huck NCO interview 05:20](https://www.youtube.com/watch?v=S1_Gwk7F7k4&t=320s), [Game Developer](https://gamedeveloper.com/design/game-design-deep-dive-dynamic-detection-in-i-shadow-tactics-i-), [Shadow Tactics GDC 30:19](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1819s), [Game Developer](https://gamedeveloper.com/design/designing-the-real-time-stealth-and-combat-of-i-desperados-iii-i-), [Battle.net 15478](https://us.forums.blizzard.com/en/sc2/t/15478), [Softpedia](https://www.softpedia.com/reviews/games/pc/Dawn-of-War-II-Review-105623.shtml), [AI and Games TLOU 25:04](https://www.youtube.com/watch?v=7MVzKuQ5SfY&t=1504s), [TechRaptor](https://techraptor.net/gaming/reviews/starcraft-ii-nova-covert-ops-mission-pack-1-review-dulled-reflexes), [warcraft.wiki.gg](https://warcraft.wiki.gg/wiki/The_Dungeons_of_Dalaran), [Huck, BlizzCon 2016 interview 05:10](https://www.youtube.com/watch?v=lylVQAwZhqM&t=310s)

**On detection or ambush, slow the moment down rather than rescue the player. Never demand precise input from a panicking player, and never ship a safety net that sometimes fails.**

- *Backing:* Mimimi spent about a year on a "freeze and teleport" second chance on detection. It failed three ways. Agitated players clicked through it: "If someone is agitated [and] you force them to make a controlled input, that just doesn't work." Players got seen on purpose to teleport somewhere useful.
- *Evidence:* Thin (one first-party account, detailed).
- *Sources:* [Shadow Tactics GDC 35:33](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=2133s), [36:37](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=2197s), [37:40](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=2260s)

## EN-13 The camera never hides play

**Never let the camera or the decoration hide gameplay: grade heights from low on the camera side to tall on the far side, and check that decoration doesn't change pathing or sight-blocking.**

- *Backing:* "Our rule of thumb is we never want to force the player to turn the camera." Anything rotation could hide is not design space, and a late camera change "had to rework lots of setups" [dev]. Even a 2 m house hides a guard at the default tilt, so districts are horseshoes: about 3 m elements in front, 6 m houses in the middle, the tallest at the back [dev]. Every asset carries navigation and view-cone occluders, and the art pass must not block or open navigation, change occluder height or fragment occlusion areas [dev].
- *Evidence:* Well-sourced (first-party) for the principle. The SC2 orientation is our inference.
- *Sources:* [Desperados III devcom 31:47](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1907s), [08:26](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=506s), [09:32](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=572s), [22:11](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1331s), [23:17](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1397s), [GoW level design talk 47:49](https://www.youtube.com/watch?v=eSB29qx6sWw&t=2869s), [Pillars retrospective 11:35](https://www.youtube.com/watch?v=F0RW3upLoJI&t=695s)

## EN-14 Props are optional keys with a second way through

The props' backing (Blizzard's hero missions and the tactics games) is in [`PROPS.md`](PROPS.md), rule by rule.
