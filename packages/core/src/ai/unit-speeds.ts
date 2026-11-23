// Ground units' movement speeds, in cells per second at Faster game speed (Legacy of the Void,
// without upgrades or creep), for a Wave's warning radius (docs/adr/0008). Units not listed fall
// back to the checker's marine speed.

export const UNIT_SPEEDS: Readonly<Record<string, number>> = {
  // Protoss
  Probe: 3.94,
  Zealot: 3.15,
  Sentry: 3.15,
  Stalker: 4.13,
  Adept: 3.5,
  HighTemplar: 2.62,
  DarkTemplar: 3.94,
  Archon: 3.94,
  Immortal: 3.15,
  Colossus: 3.15,
  Disruptor: 3.15,
  // Terran
  SCV: 3.94,
  Marine: 3.15,
  Marauder: 3.15,
  Reaper: 5.25,
  Ghost: 3.94,
  Hellion: 5.95,
  SiegeTank: 3.15,
  Cyclone: 4.13,
  WidowMine: 3.94,
  Thor: 2.62,
  // Zerg
  Drone: 3.94,
  Zergling: 4.13,
  Baneling: 3.5,
  Roach: 3.15,
  Ravager: 3.85,
  Hydralisk: 3.15,
  Lurker: 4.13,
  Infestor: 3.15,
  SwarmHostMP: 3.15,
  Ultralisk: 4.13,
  Queen: 1.31,
};
