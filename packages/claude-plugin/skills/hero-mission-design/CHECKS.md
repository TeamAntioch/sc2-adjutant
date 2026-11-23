# Hero-mission checks

Apply every check to the mission plan or the built mission. Record each as passed, fixed, an issue, or intended (with the reason). The principles are in `SKILL.md`; their backing is in [`PRINCIPLES.md`](PRINCIPLES.md). Where the Campaign Pack sets a number (mission length, forks, reward ratio), check against the pack's number.

## Structure (S)

- **S1 One dominant mechanic,** drawn from the heroes' fantasy, named in one phrase a player would use afterwards ("the decoy mission"). (HM-1)
- **S2 Encounters named.** Every fight space is an encounter with a one-line problem; there are about 6–10. (HM-1)
- **S3 Shape.** The mission is a small hub with spokes, or a chain with visible forks; no long hallway of corridor fights; fight spaces inside a spoke connect to each other. At most one open-layout zone in the act. (HM-2)
- **S4 Forks are visible and tested.** Each fork can be seen from where the choice is made, and the number of forks is one the team will playtest. (HM-2)
- **S5 Teaching order.** Each new ability, enemy role or prop is met alone before it's combined, and the mission's capstone combines only what was taught. (HM-3)
- **S6 Breathers.** No two encounters back to back without a stated reason. (HM-4)
- **S7 Mode shift.** At most one, in the second half, and its decision is written down. (HM-5)
- **S8 No bare countdown.** Every timer is extended by progress or serves a rescue the player cares about. (HM-6)
- **S9 Length.** The estimated golden path is within the target, and optional content is within its own budget. (HM-7)
- **S10 Campaign sheet.** Neither the setting nor the objective type repeats the previous mission's; the mission adds at most one high-impact feature. (HM-9)

## Power (P)

- **P1 No solo-the-map.** Name the encounter the heroes would most easily brute-force, and what stops it (enemy toughness, a role that needs a particular tool, terrain). (HM-10)
- **P2 Mobility costs.** Every blink, jump or dash that skips terrain has a cooldown or cost, and no encounter falls to it alone. (HM-10)
- **P2b No bare caps.** Every limit on what the heroes can hold (a count of captured units, charges, pickups) comes from a rule of play: what holding more costs or risks. Losing what was held sets the player back without stranding them. (HM-10)
- **P3 Heroes alone win.** On every difficulty, the mission is winnable with the guaranteed heroes alone; every squad unit, ally and prop is optional. (HM-14)
- **P4 Squad rules,** only when there is a squad: granted by script, capped by type, topped up before set-pieces. (HM-12)

## Recovery and failure (R)

- **R1 Recovery placed.** Recovery sits between encounters in spaces that stay safe; the next recovery point is visible from the current one. (HM-15)
- **R2 Pickups decide something.** Each placed pickup asks the player to leave safety or spend it now or later. (HM-16)
- **R3 Failure model written.** Downed and revive (with two controllable heroes), defeat condition, checkpoints after major encounters. (HM-17)
- **R4 No flaky net, no soft-lock.** Nothing rescues the player only sometimes; easier difficulties have a relief valve; no state leaves the mission unwinnable. (HM-18)
- **R5 Difficulty by composition.** Each difficulty's changes are unit swaps and behaviour, not hit points alone. (HM-19)

## Choice and optional content (C)

- **C1 Approach fork.** At least one, named in the fiction and the briefing. (HM-20)
- **C2 No information gate.** No progress depends on a line, a pickup or a reveal the player could miss. (HM-20)
- **C3 Side spaces.** Each is visible from the golden path, pays in power, and is capped. (HM-21)

## Readability (V)

- **V1 Landmarks.** One per Zone, and an eye-catcher at each next goal. (HM-23)
- **V2 Dialogue placement.** Banter in breathers, never during a hard encounter; Transmissions, not camera pans. (HM-24)
- **V3 No repeated structure.** The mission's shape and objective sequence differ from every other mission's. (HM-25)
- **V4 Bounds fit each space.** Each encounter space's Beat bounds the play to it, so heroes, spawns and the cameras of its scenes lie inside. The camera's bounds frame what the encounter is about, and the route stays within about 7 cells of them. `check_layout`'s `bounds` check, or the compile's warnings beside Kept terrain, list what falls outside. (HM-23; ADR-0015)
