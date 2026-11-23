# Ally Principles: backing

Each principle's backing. Source tags: [dev] a developer on their own work, [data] game files, [wiki] fan wiki, [forum] player posts, [critic] press, [secondary] an explainer drawing on developers, [mine] our inference. Talk citations are YouTube auto-captions, linked at their timestamp. The strongest sources are Naughty Dog's Ellie chapter (Game AI Pro 2), Santa Monica's Atreus talk and Irrational's Elizabeth talk, which reached the same rules independently.

## AL-1 Leash to the hero, position by state

**Leash allies to the heroes and position them by state: on the hero's target in combat, ahead toward the objective in traversal, close in stealth. Never hide them away.**

- *Backing:* Naughty Dog's first rule was "keep buddies really close", with follow positions in the same "room". Adult buddies acting independently "always felt like they were abandoning the player" [dev]. Irrational hit the same failure independently.
- *Evidence:* Well-sourced (three studios first-hand; the goal-side cone is [secondary]).
- *Sources:* [Dyckhoff](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter35_Ellie_Buddy_AI_in_The_Last_of_Us.pdf), [Elizabeth talk 34:48](https://www.youtube.com/watch?v=KKz45K4teqA&t=2088s), [Atreus talk 14:58](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=898s), [16:00](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=960s), [AI and Games Elizabeth 09:24](https://www.youtube.com/watch?v=Yht4Oojfuvs&t=564s), [Fandom](https://starcraft.fandom.com/wiki/Back_in_the_Saddle)

## AL-2 A visible job tied to space the player clears

**Give each ally group an authored, visible job tied to space the player clears: a landing zone that enables a drop, a lane the hero opens, an exit the ally holds.**

- *Backing:* Blizzard ties ally value to geography. Killing three Vikings clears Raynor's landing zone in Ghost of a Chance, destroying particle cannons lets Talis reinforce in Evil Awoken, and cleared Breakout outposts become allied bases [wiki]. Halo's designers own the minutes-long "strategic purpose such as 'securing the landing zone'", while code owns the moment [dev].
- *Evidence:* Well-sourced.
- *Sources:* [Fandom: Ghost of a Chance](https://starcraft.fandom.com/wiki/Ghost_of_a_Chance), [Fandom: Evil Awoken](https://starcraft.fandom.com/wiki/Evil_Awoken), [Fandom: Breakout](https://starcraft.fandom.com/wiki/Breakout), [Halo talk 04:12](https://www.youtube.com/watch?v=76kZtNaetx0&t=252s), [Game Developer](https://www.gamedeveloper.com/design/combat-evolved-the-encounter-design-of-halo-3), [Atreus talk 09:37](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=577s), [10:45](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=645s)

## AL-3 Allies soften, heroes finish

**Allies soften, heroes finish. Ally damage never exceeds the hero's, ally help must be visible, and an ally's signature moment goes on a long cooldown.**

- *Backing:* Ellie should "explicitly support the player rather than go off and do their own fighting", never "make the player feel useless", and her help must be seen or "it is wasted effort". Brick throws run on long cooldowns to stay "special and memorable" [dev]. Atreus's pillars are the same: support the player, never hinder, never make the player feel bad, and "you should not have to babysit him" [dev].
- *Evidence:* Well-sourced (three action-game studios; no RTS-specific study).
- *Sources:* [Dyckhoff](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter35_Ellie_Buddy_AI_in_The_Last_of_Us.pdf), [Atreus talk 03:17](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=197s), [55:09](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=3309s), [31:54](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1914s), [11:50](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=710s), [Halo talk 12:40](https://www.youtube.com/watch?v=76kZtNaetx0&t=760s), [Halo talk 33:36](https://www.youtube.com/watch?v=76kZtNaetx0&t=2016s)

## AL-4 Key autonomy off the hero

**Key ally autonomy off the hero: extend the hero's setups, act during the hero's long animations, never undo a hero effect, and rescue on a danger threshold.**

- *Backing:* Atreus acts on the player's target to extend its vulnerable state: he keeps a launched enemy juggled, a tripped enemy down, a wall-pinned enemy held [dev]. The best moment to help is during the player's long-recovery moves, because "that small beat... they can actually register what [he] is doing" [dev]. He must not knock away the target the player is aiming at, or replace a big stumble with a small hit reaction, so he reads the enemy's reaction state and "predict[s] the player's intent" [dev].
- *Evidence:* Moderate (one detailed first-party account, consistent with Ellie's danger-gated support).
- *Sources:* [Atreus talk 18:14](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1094s), [21:24](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1284s), [22:27](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1347s), [24:30](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1470s), [05:25](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=325s)

## AL-5 At most one ally command

**Give the player at most one ally command: it always executes, costs no more than a reload, has no modes, and duplicates no hero ability.**

- *Backing:* Atreus's "son button" rules are reliable (pressed, it always happens, so all his actions are interruptible), never disrupts, predictable, always helpful [dev]. Ice arrows were cut because they competed with Kratos's frost axe: "Figuring out what Kratos is going to do was first and foremost" [dev]. Offensive and defensive behaviour modes went unused: "In the heat of the battle people didn't even try it." A hidden double-press also went unused [dev].
- *Evidence:* Well-sourced (three studios).
- *Sources:* [Atreus talk 26:35](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1595s), [28:45](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1725s), [07:32](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=452s), [30:52](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1852s), [Elizabeth talk 37:59](https://www.youtube.com/watch?v=KKz45K4teqA&t=2279s), [Halo talk 03:10](https://www.youtube.com/watch?v=76kZtNaetx0&t=190s), [Atreus talk 35:03](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=2103s)

## AL-6 Allies are part of the level

**Make allies part of the level: place ally reaction points and one-shot "gold moments", route existing systems through allies, and never move the camera to show them.**

- *Backing:* A prototype mute Elizabeth who drew the player's eye physically was "very obtrusive", "hijacking my entire experience" [dev]. Designers place look-at points that she uses only when free, so they are "opportunities… not scripted moments" that "guide the player's eyes… without forcing them" [dev]. Special interactions are placed "maybe eight of them around a level", and once one fires "we'll erase the rest of them" [dev].
- *Evidence:* Moderate (one detailed first-party account plus two supporting ones).
- *Sources:* [Elizabeth talk 03:11](https://www.youtube.com/watch?v=KKz45K4teqA&t=191s), [27:27](https://www.youtube.com/watch?v=KKz45K4teqA&t=1647s), [30:35](https://www.youtube.com/watch?v=KKz45K4teqA&t=1835s), [33:44](https://www.youtube.com/watch?v=KKz45K4teqA&t=2024s), [40:17](https://www.youtube.com/watch?v=KKz45K4teqA&t=2417s), [GoW level design talk 26:00](https://www.youtube.com/watch?v=eSB29qx6sWw&t=1560s), [28:04](https://www.youtube.com/watch?v=eSB29qx6sWw&t=1684s), [Atreus talk 51:59](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=3119s)

## AL-7 Cheat for the player

**Cheat in the ally's favour where honest AI would betray the player: hide allies during stealth, warp them when unseen, deny damage the player can't see, and make callouts true and actionable.**

- *Backing:* Honest buddy stealth worked "about 90%–95% of the time", but being seen "even once" broke the bond, so Naughty Dog made buddies invisible while the player sneaks, and buddy shots the player won't see deal no damage [dev]. Yoshidome: "I am not above using warping." Off screen, Atreus teleports to the camera edge nearest his target, and no delay was added for realism, because an unreliable ally is one "you kind of don't want to use" [dev]. Irrational: "if we needed to teleport Elizabeth somewhere as long as a player wasn't aware of that that's a perfectly viable thing" [dev].
- *Evidence:* Well-sourced.
- *Where sources disagree:* Dyckhoff says Ellie was never routinely teleported. Santa Monica and Irrational teleport freely when unseen.
- *Sources:* [Dyckhoff](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter35_Ellie_Buddy_AI_in_The_Last_of_Us.pdf), [Atreus talk 17:09](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1029s), [49:53](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=2993s), [Elizabeth talk 17:49](https://www.youtube.com/watch?v=KKz45K4teqA&t=1069s), [Halo talk 21:07](https://www.youtube.com/watch?v=76kZtNaetx0&t=1267s), [Atreus talk 47:48](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=2868s), [Atreus talk 24:30](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=1470s), [Tremblay & Verbrugge](https://www.cs.mcgill.ca/~jtremb59/Papers/Adaptive%20Companions%20in%20FPS%20Games.pdf), [Halo talk 06:18](https://www.youtube.com/watch?v=76kZtNaetx0&t=378s)

## AL-8 No mission fails because an autonomous ally died

**No mission fails because an autonomous ally died. Named allies go down and revive, still react to danger, and keeping allies alive is an optional bonus that never feeds a hidden penalty.**

- *Backing:* The original Evacuation playtests found ally protection "stressful" [dev]. Stone's bike dying in The Escape doesn't fail the mission [wiki]. Players hate "Be fast or useless teammate dies" [forum].
- *Evidence:* Well-sourced.
- *Sources:* [Fandom](https://starcraft.fandom.com/wiki/The_Escape), [Battle.net 11624](https://us.forums.blizzard.com/en/sc2/raw/11624), [Battle.net 21592](https://us.forums.blizzard.com/en/sc2/raw/21592), [Dyckhoff](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter35_Ellie_Buddy_AI_in_The_Last_of_Us.pdf), [Atreus talk 37:10](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=2230s), [Elizabeth talk 35:51](https://www.youtube.com/watch?v=KKz45K4teqA&t=2151s), [GamesRadar](https://www.gamesradar.com/warhammer-40000-dawn-of-war-ii-chaos-rising-review/)

## AL-9 The player leads

**The player leads. Escorts advance only when the hero clears the way, move at or above hero speed, and hold when enemies are near.**

- *Backing:* Escorts fail when the player must match a fragile NPC's pace. Guild Wars 2 escorts advance only when it is safe [forum]. Players wanted Tychus in Engine of Destruction to "calm the f down" [forum].
- *Evidence:* Thin to moderate (design commentary, no player data).
- *Sources:* [Warmuth, Game Developer](https://www.gamedeveloper.com/design/protect-the-moron-), [Battle.net](https://us.forums.blizzard.com/en/sc2/raw/21592), [Atreus talk 03:17](https://www.youtube.com/watch?v=lbyGzzcKg9U&t=197s), [Time Extension](https://www.timeextension.com/news/2025/12/ive-never-seen-a-review-asking-for-more-escort-quests-fallouts-creator-comments-on-why-escort-missions-are-rarely-done-well)

## AL-10 Scripted squads over a computer player

**Prefer scripted ally squads with small fixed rosters over a full allied computer player. Where allies hold their own front, keep them ambient and constrained, and coordinate them by request, not by long script locks.**

- *Backing:* SC2's allied computer AI shows visible weaknesses, such as Stukov running "head first into enemies… A true hero" [forum]. Galaxy offers `AISetDefenseRadii`, region wave targets and script-control toggles [data]. SC2Mapster warns that pre-placed units need "AI – Disable script control" before the AI will use them [forum].
- *Evidence:* Moderate (anecdote and inference, plus Halo's first-party rule).
- *Where sources disagree:* Into the Void, with its full allied AIs, was one of the best-received missions, praised for "stuff always happening around the map" [forum]. Autonomous allies are fine when ambient (their own fronts, no fail condition tied to the player's attention) and risky when they share the hero's space.
- *Sources:* [Battle.net](https://us.forums.blizzard.com/en/sc2/t/into-the-void-mission-bugs/80), [TL](https://tl.net/forum/starcraft-2/498221-tlch-epilogue-1-into-the-void), [SC2Mapster wiki](https://sc2mapster.wiki.gg/wiki/Tutorials/Artificial_Intelligence), [Halo talk 31:27](https://www.youtube.com/watch?v=76kZtNaetx0&t=1887s)

## AL-11 Room to follow

**Build ally "stand here" spaces beside hero routes, keep paths wide enough for heroes, squad and allies, and never let hero-only traversal strand allies.**

- *Backing:* Ellie's follow positions use an extra ray check to stay on the player's side of doors [dev]. Halo's designers place firing points, about 600 for a full encounter in 30–45 minutes, "almost like sculpting", at the risk of being "very open to designer error" [dev]. The Last of Us's hunter search "struggles in larger combat spaces and areas with greater verticality" [secondary].
- *Evidence:* Well-sourced in principle. SC2 widths and the traversal rule are our inference.
- *Sources:* [Dyckhoff](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter35_Ellie_Buddy_AI_in_The_Last_of_Us.pdf), [Halo talk 47:18](https://www.youtube.com/watch?v=76kZtNaetx0&t=2838s), [56:44](https://www.youtube.com/watch?v=76kZtNaetx0&t=3404s), [AI and Games TLOU 16:40](https://www.youtube.com/watch?v=7MVzKuQ5SfY&t=1000s), [postmortem](https://www.gamedeveloper.com/design/postmortem-bungie-s-i-myth-the-fallen-lords-i-)
