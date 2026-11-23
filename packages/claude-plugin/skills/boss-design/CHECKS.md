# Boss checks

Apply every check to the boss's attack table and phases. Record each as passed, fixed, an issue or intended (with the reason). The principles they come from are in `SKILL.md`; the backing is in [`PRINCIPLES.md`](PRINCIPLES.md).

## Job and form (J)

- **J1 Job named.** The plan names the job (spectacle, story, exam), and its difficulty and length match it: a story boss on Normal is beatable by a player who has used each hero ability once. (BP-1)
- **J2 Needs to be a boss.** A named elite in a wave, a gauntlet, a chase, a race or a survival clock wouldn't do the Beat's job as well. (BP-2)
- **J3 One hook.** One mechanic a player will remember, rooted in the boss's fiction, with ground in the arena to act on. (BP-3)

## Reading (R)

- **R1 Every attack has a telegraph and an answer**, and the answer is a move, a named hero ability, or the companion. (BP-4)
- **R2 Two channels.** Each avoidable attack warns in data (wind-up, cast bar or delayed impact) and in script (ground marker, sound), and the first cast gets a voice line. (BP-5)
- **R3 Telegraph time.** Lethal attacks warn at least 2 s at Faster; chip damage at least 1.5 s. The hero can clear the marked area at its real speed within the warning, from the worst spot inside it. (BP-6)
- **R4 One vocabulary.** Each marker shape and colour means the same thing it means in the Mission's other bosses, and reads against the arena's ground textures and lighting. (BP-5)
- **R5 Danger from the body.** Cones, lines and charges come from the boss's model along its facing; markers far from the boss are rare and loud. Effects don't hide markers. (BP-5)
- **R6 Openings are signalled.** Each opening has an actor state and a sound; hits on an invulnerable boss visibly fail, in the boss's fiction where it has one (an evasive blink rather than a generic deflect), and the failure looks different from the boss's attacks; the player can tell a hit landed. (BP-8)
- **R7 Danger matches the look.** Big-looking attacks hit hard and small ones don't. (BP-7)

## Fairness and pacing (F)

- **F1 No unwarned one-shot.** The biggest Normal hit is at most about half a hero's life and shields; anything lethal has the longest, loudest telegraph. (BP-7)
- **F2 Safe ground moves.** No spot stays safe for the whole fight; about half the arena is threatened at a time; each safe area is bigger than both heroes together. (BP-9)
- **F3 Taught first.** Every mechanic appears earlier in the mission or at low stakes in phase 1; no new hero ability is introduced inside the fight; a newly granted ability works on the boss. (BP-10)
- **F4 Phases change rules.** Each phase adds or changes an attack, the arena, the adds or the opening; health cuts have floors. (BP-11)
- **F5 Peak and release.** The last phase isn't the longest or hardest; the final stretch drops the add spawns and plays the signature attack at a readable rhythm. (BP-11)
- **F6 Learnable rhythm.** Attack choice follows ranges, regions, timers and alternation the player can learn, not uniform randomness. (BP-16)
- **F7 Not a sponge.** The fight's length on Normal comes from phases and patterns, not from life alone; every phase needs the heroes' abilities, not just auto-attacks.
- **F8 No soft-lock.** The boss can't be walled, kited forever or stuck out of reach; the controller has a timeout or a fallback for each.

## Companion (C)

Skip the C checks when the hero fights alone, and record that.

- **C1 Visible job.** The companion has one or two jobs it always succeeds at, and the player can see it doing them. (BP-13)
- **C2 Player keeps the test.** Dodges, the decisive interrupt, soaks and kill order are the player's; the companion's help is backup. It never lands the killing blow. (BP-13)
- **C3 Survives by rule.** The boss publishes danger zones and safe points; the companion is moved to safe ground by script for each lethal attack, takes reduced area damage, and is downed, not killed. (BP-14)
- **C4 Never a fail.** In a normal mission the companion's fall never ends the fight; an escort-fail is declared to the player in advance. (BP-14)
- **C5 Present but not carrying.** The boss sometimes targets the companion, and the fight isn't trivial with the companion tanking: test it with the player hanging back. (BP-15)
- **C6 Doesn't break the script.** The companion doesn't enter the arena trigger first, attack during intros or invulnerable windows, or start a phase early. The boss's leash and reset checks count both heroes. (BP-16)
- **C7 Reads the fight aloud.** The companion calls out each attack the first time, then at most once a phase.

## Retry and finish (T)

- **T1 Cheap retry.** An autosave as the boss appears; a defeat costs the fight, not the walk to it; the intro plays once and is skippable. (BP-17)
- **T2 Progress shown.** On defeat or reset the player sees how far the attempt got (phase or percent). (BP-17)
- **T3 Honest bar.** A boss bar only for a single readable boss, with phase ticks, hidden while the boss can't be hurt. (BP-18)
- **T4 Clean finish.** Story bosses stop at low life for the kill scene; adds die with the boss; nothing hurts the heroes after the win. (BP-19)
- **T5 Clocks.** Mission timers and waves pause for the boss's scenes and the fight's intro, or are designed to run.

## Difficulty (D)

- **D1 Scaled by numbers.** Boss life, add counts and attack cadence differ by difficulty, sized from the heroes' damage over the planned fight length. (BP-20)
- **D2 Hard has one more idea.** Hard (and Brutal) add one whole attack or rule, not only life. (BP-20)
- **D3 Recurring boss.** A boss met again fights in a changed arena and keeps one phase back for its last meeting. (BP-20)

## Stealth (S)

Apply when a hero can cloak.

- **S1 Cloak has a rule here.** The plan says whether cloak works in this fight. Where the boss detects, the player is told before it matters (a detector add, a visible sweep, a line).
- **S2 Cloak is an answer, not an exploit.** If the boss's targeting checks visibility, cloak answers a named attack; it doesn't make the whole fight safe.
