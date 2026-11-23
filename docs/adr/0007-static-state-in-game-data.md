# Static State in Game Data, Triggers Only for Change

Whatever a map can set either in game data or by a trigger, we set in data: map-local catalogs (`Base.SC2Data/GameData/*.xml` overrides such as TerrainData, LightData, WaterData, ActorData), MapInfo or Objects. Triggers carry only what changes over time: flares, transmissions, timers, encounters, transitions. The author reads and polishes missions in the Galaxy Editor ([ADR-0001](./0001-round-trip-unpacked-map-packages.md)), and the Editor draws data but never runs triggers, so state set by a map-init trigger makes the Editor show a different map from the game. A mission's light set by `GameSetLighting` at 0 s, for example, left the Editor showing the tileset's own light; the blueprint's `lighting` now writes a partial `CTerrain` override instead.

## Consequences

- Before adding a map-init trigger for static state (lighting, unit properties, starting resources, fog), find the catalog field or map file that sets it and write that instead.
- A change over time starts from the data's state and returns to it: a flare restores the mission's light, a transition's `back` names where it ends.
- This pairs with [ADR-0002](./0002-typed-gui-trigger-primitives.md): what does belong in triggers is built from typed GUI primitives, with custom Galaxy only for natives the GUI can't reach.
