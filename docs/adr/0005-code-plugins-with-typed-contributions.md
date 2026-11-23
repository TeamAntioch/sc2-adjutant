# Code Plugins With Typed Contributions

The mapper becomes a shareable MCP server, so everything specific to one Campaign, one author's taste or one machine moves out of the core and into `Plugins`: code packages (npm or a local folder) with a manifest and a pinned plugin API version. A Plugin makes typed `Contributions` (Mechanics, trigger primitives, Design Lessons, Exemplar Maps, knowledge documents, characters and voices, a Screenplay Source and naming templates, Host Adapter capabilities). `Campaign Pack`, `Style Pack` and `Host Adapter` are roles a Plugin fills, not separate plugin types, so one Plugin can ship a Campaign's characters together with the Mechanics only that Campaign uses. We chose code over data-only packs because Mechanics have to build triggers and game data, which means code; once code plugins exist, Style Packs can use them too, instead of being limited to parameters on rule kinds the core already ships.

## Considered Options

- **Data-only packs.** Style rules as parameters on a fixed set of core rule kinds. They would be safe to share, but every new kind of rule would need a core change, and Mechanics would still need code.
- **Three plugin types.** One each for Campaign Pack, Style Pack and Host Adapter. This breaks down on cross-cutting cases such as a Mechanic's layout Threats or a campaign-specific style rule.
- **Sandboxed plugins.** Rejected for now as too costly. Instead, Contribution hooks stay pure functions from context to typed data, with side effects only in Host Adapter capabilities and Screenplay Sources, so a sandbox can be added later without changing the contract.

## Consequences

- Plugins run in-process. They are trusted the way any npm dependency is: the server loads only the ones the Workspace config lists, and it reports each one's name, version and Contributions.
- A Mechanic's triggers must be built from the typed GUI trigger primitives ([ADR-0002](./0002-typed-gui-trigger-primitives.md)), never from raw XML or Galaxy. A Plugin can be wrong about gameplay, but it can't write a map the Editor rejects. New primitives are themselves Contributions, verified byte-exact against an Editor-saved map.
- Each Mechanic's params schema joins the Mission Blueprint's strict schema, so Blueprint edits are validated against every installed Mechanic.
- The core ships no campaign-specific behaviour. Even the generic `hazard` Mechanic comes from a bundled first-party Plugin, to prove the API.
