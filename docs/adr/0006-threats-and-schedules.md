# Threats and Schedules

The layout checker's safety checks read one concept, the `Threat`, whatever its source: enemy groups, Waves, and every Mechanic, including third-party Plugin Mechanics, which contribute Threats through the Mechanic contract ([ADR-0005](./0005-code-plugins-with-typed-contributions.md)). A Threat has five facets:

- **Footprint:** the Zones it reaches, or a route plus a radius (a patrol's sight).
- **Schedule:** when it is active.
- **Telegraph:** how it warns the player.
- **Safety:** shelter Zones or checkpoints.
- **Consequence:** `damage`, `combat`, `setback` (sent back to a checkpoint) or `fail`.

Mechanics can also change `Connections` over time, on the same `Schedule` vocabulary. A Schedule takes effect from a Beat, on a cycle, during each pass of a patrol, or while a Mechanic's state holds. `opensAtBeat` and `closesAtBeat` remain the author's shorthand for the from-a-Beat case.

We unified these because the checker's existing hazard model (the sun, the flare, the generic `hazard`), its enemy-threat model, and the stealth section of a hero mission turned out to be the same question asked of different sources: is every window long enough to reach safety, and how much does one mistake cost? The alternative was a hook per Mechanic for the checker, and every Plugin would have needed checker code of its own.

## Consequences

- Checks generalize. "Warning ≥ 1.2× the worst retreat" becomes "each window ≥ k × the time to cross to safety", with `k` chosen by the consequence. Refuge spacing becomes checkpoint spacing.
- The consequence kinds are a closed set in the core. A Plugin can't add one until a check needs it.
- Stealth has no calibration yet, so `k` for `setback` is a placeholder until a stealth mission is studied the way Devil's Playground was for hazards.
- How Mechanics show the player's world growing (camera bounds, gates) is a trigger-building detail. To the checker it is a Connection that opens on a Schedule.
