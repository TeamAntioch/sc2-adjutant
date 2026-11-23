// The reference Campaign Pack: the fixture Campaign Pack core's golden compiles through. Its storm and
// relay Mechanics cover what a Campaign's own Mechanics compile to (triggers, a clock, cues, beat
// actions, game data, Threats and a Connection change). Its naming template gives every line its
// conversation, line and sound ids. Its Campaign Mod, Reference-Story, declares the speakers.
//
// The golden freezes this code with the Missions: change it only with an intended golden update.
import type { PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { naming } from "./naming.ts";
import { relay } from "./relay.ts";
import { storm } from "./storm.ts";

const plugin: PluginCode = { mechanics: [storm, relay], naming };
export default plugin;
