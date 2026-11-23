---
name: ally-design
description: AI-ally design for hero-centred SC2 campaign missions. Plans or critiques the AI-controlled units that fight beside the player's heroes (scripted ally squads, a named ally, and the partner hero the player isn't controlling), their positioning, jobs, autonomy, survival rules and cheats, and how to build them with SC2's campaign AI and triggers. Use when a Mission gives the player AI-controlled allies or an AI-driven partner hero, when designing or reviewing ally behaviour, or when asked why an ally feels useless, in the way or unfair.
---

Plan or review the AI-controlled units beside the player's heroes. An ally the player doesn't see doing something is wasted: that's the finding three studios reached on their own, and it shapes every rule below. Bosses' companions are covered by `boss-design` (BP-13 to BP-15); this skill covers allies everywhere else. The mission's structure is `hero-mission-design`; the encounter the allies fight in is `encounter-design`.

Where the inputs are. Read the Blueprint with the sc2-adjutant MCP server's `get_blueprint` tool: the Beats, the ally Anchors and Placements, the players and their alliances, and the encounters in `missions/<id>/encounters.md`. Read the active Campaign Pack's knowledge through the server (`list_plugins`, the knowledge resources) for the heroes' kits, whether the player switches between heroes, and the campaign's ally rules (escorts, ally commands, allied computer players, warps). **The pack's settings win over this skill's defaults.**

The rules are this skill's **Ally Principles** (AL-1 to AL-11, below) and its checks (end of this file). [`PRINCIPLES.md`](PRINCIPLES.md) gives the backing.

**Corrections go into the guidance.** When the author corrects an ally design, put the general lesson into this skill and anything campaign-specific into the Campaign Pack's knowledge, in the same change, and tell them where it went.

## Leading words

- **Ally**: an AI-controlled unit on the player's side. **Ally squad**: a small fixed group the script hands in. **Named ally**: a character with lines.
- **Partner hero**: the hero the player isn't controlling at the moment, when the player switches between two heroes. It follows the ally rules while it is AI-driven.
- **Active hero**: the hero under the player's control.
- **Leash**: the distance at which an ally is pulled back toward the active hero.
- **Job**: the visible task an ally group does in an encounter (hold a region, rearguard, follow, act when a Zone is cleared).
- **Objective point**: the spot in an encounter that allies orient on (`encounter-design` EN-1).
- **Danger threshold**: the condition under which allies drop their job to help the active hero.
- **Ambient ally**: an ally whose job is on another screen. It sets the scene; it doesn't count as help.

## Ally Principles

- **AL-1 Leash to the hero, position by state.** In combat, allies post up on the active hero's target, on its far side, within the player's view (about 3–4 s to come on screen). In traversal, they go ahead toward the objective point. In stealth, they stay close. They are never parked out of the way. When the player switches heroes, positioning follows the new active hero.
- **AL-2 A visible job tied to space the player clears.** A landing zone that enables a drop, a lane the hero opens, an exit the ally holds. A job on a different screen from the heroes is ambient, not help.
- **AL-3 Allies soften, heroes finish.** Ally damage never exceeds the hero's; ally attacks read from above (a visible link to the target) and carry a tint distinct from the player's units; an ally's signature move is on a long cooldown and never takes the kill that matters.
- **AL-4 Key autonomy off the hero.** Allies extend the hero's setups (act on a stunned, rooted or channelling target), act during the hero's long animations, never undo a hero effect, and rescue on the danger threshold: by default a hero below 40% life with 3 or more enemies attacking it within 4 cells; allies switch to those attackers for 5 s, then a 25 s cooldown. Tune these numbers.
- **AL-5 At most one ally command.** If the player gets one, it always executes, costs no more than a reload, has no modes, duplicates no hero ability, and launches from the ally with no range or vision check that can fail silently. Where the player switches between heroes in real time, the switch is the main control and an ally command is rarely needed.
- **AL-6 Allies are part of the level.** Reaction points and one-shot moments placed in the space, gated on the ally being out of combat. Never move the camera to show an ally.
- **AL-7 Cheat for the player, never against them.** Hide allies from enemies during the player's stealth; deny damage the player can't see; make every callout true and actionable. Warps only where the campaign allows them and the player can't see them, minimap included; by default avoid them.
- **AL-8 No mission fails because an autonomous ally died.** Named allies go down and revive, still react to danger with a visible hit reaction or pull-back, and keeping them alive is an optional bonus that feeds no hidden penalty.
- **AL-9 The player leads.** If the campaign has escorts at all, the escort advances only when the hero clears the way, moves at or above hero speed, and holds when enemies are near.
- **AL-10 Scripted squads over a computer player.** Prefer small fixed ally squads driven by script and waves over a full allied computer player with its own economy. Where allies hold their own front, keep it ambient and constrained, and coordinate by request rather than long script locks.
- **AL-11 Room to follow.** "Stand here" spaces beside hero routes, paths wide enough for heroes, squad and allies together, and no hero-only traversal (a blink, a cliff jump) that strands allies without a way round.

## Building allies in SC2

These are the known parts; the last item lists what still needs testing in the Editor.

- **Owner.** AI behaviour (waves, tactical thinks, `AICast`, kiting and flee flags) runs only for units owned by a Computer player. Give allies an allied Computer slot (shared vision, pushable both ways), started with `AICampaignStart` and no money. Pre-placed units need "AI – Disable script control" (the unit-group version) before the AI will use them. Blizzard's own AI-driven allied heroes are always owned by an allied Computer player.
- **Following.** A one-unit or small **escort wave** on the active hero (`AIWaveTargetEscort`, an offset behind it), plus a **leash trigger** on a 0.5–1 s AI-time period: when an ally is beyond the leash by pathing cost, or stuck, order it to a follow spot on the hero's side of any cliff, then release script control. The leash owns *where*; the think owns *what*; they never issue moves in the same tick. Swapping a wave's target region mid-encounter is the candidate for a clean fallback.
- **Thinking.** A short per-ally priority list registered with "Set Tactical AI Think": rescue (the active hero is down or in danger), survive (fall back behind the hero), the stealth rule (hold fire while the active hero is cloaked), assist (the active hero's target), fight (what threatens the pair), then follow.
- **Switching heroes.** On a switch, the partner hero changes owner to the ally Computer slot and the new active hero to the player, each keeping its colour; mirror upgrades between the two players. If changing owner misbehaves, keep both heroes on the player and drive the partner with a periodic trigger issuing ordinary orders instead.
- **Survival.** An incapacitation state with revive (see the campaign's failure model in `hero-mission-design` HM-17), never a mission fail on an autonomous ally's death.
- **Still to test in the Editor.**
  - What `AIWaveTargetEscort`, `AIWaveTargetEscortNL` and the `replaceType` argument do; they are undocumented.
  - Whether an escort wave keeps allies within a screen of the heroes through doors and ramps.
  - Whether swapping `AIWaveTargetRegion` mid-encounter gives a clean fallback.
  - What a 0.5–1 s periodic leash trigger costs.
  - Whether a camera-bounds test (distance from `CameraGetTarget`) hides warps well enough. The minimap shows allied dots, so a warp there is seen.
  - That "AI – Disable script control" must be applied as a unit group before the campaign AI uses pre-placed allies.
  - Which behaviours make allies unrevealable or untargetable while the heroes are cloaked.
  - Whether the campaign revive helpers (`libSwaC_gf_StartKerriganReviveCooldown3`, `libVCMI_gf_ReviveHeroInstantly`, `libNCMI_gf_NM_HeroRevive`) can be reused for named allies.
  - The path width at which heroes, squad and allies pass a choke without jamming.

## Plan the allies

1. **Read the Beat's cast.** Which heroes are controllable, whether one is AI-driven, which ally squads or named allies are present, and what the pack rules out. Done when you can list every AI-controlled unit and who owns it.
2. **Give each group a job** (AL-2) in each encounter that has allies, and an objective point (AL-1). Mark any job that falls on another screen as ambient.
3. **Write the positioning by state** (AL-1), the leash, and the space allies need (AL-11).
4. **Write the autonomy** (AL-4): the hero effects allies act on, the danger threshold, and what allies must never do. Decide the ally command, if any (AL-5).
5. **Write the survival and cheat rules** (AL-7, AL-8): downed and revive, stealth hiding, damage denial.
6. **Sketch the build** (above): owner, wave, leash, think, and the switch if heroes switch.
7. **Run the checks** below. Done when every ally group has a job, a positioning rule and a survival rule.

## Ally checks

Record each as passed, fixed, an issue, or intended (with the reason).

- **A1 Seen.** Every ally's help happens on the active hero's screen; anything else is labelled ambient. (AL-1, AL-2)
- **A2 Close.** No ally is ever parked away from the heroes; the leash brings it back within a few seconds. (AL-1)
- **A3 Follows the switch.** When the player switches heroes, ally positioning follows the new active hero. (AL-1)
- **A4 Second fiddle.** Ally damage stays below the hero's; no ally takes a kill that matters. (AL-3)
- **A5 Never undoes.** No ally breaks a hero's stun, root, channel, stealth or setup. (AL-4, AL-7)
- **A6 Rescue is bounded.** The danger threshold and its cooldown are written down. (AL-4)
- **A7 Commands always work,** if there are any. (AL-5)
- **A8 No camera.** No camera move exists to show an ally. (AL-6)
- **A9 No visible cheat.** No warp the player can see, on screen or on the minimap. (AL-7)
- **A10 No ally fail state.** Nothing fails the mission because an autonomous ally died. (AL-8)
- **A11 Escort waits,** if there is an escort. (AL-9)
- **A12 Room.** Every ally-accompanied route is wide enough for heroes and allies together; no hero-only traversal strands an ally. (AL-11)
