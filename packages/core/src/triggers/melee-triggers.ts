// The one trigger a melee map has: the Editor's default "Melee Initialization", as on every ladder
// map (melee research §4). Any other trigger, or this one changed, makes the Editor call the map
// Custom ("Trigger does not match default melee trigger").

import { NTVE_FUNCTIONS as F } from "./trigger-catalog.js";
import type { TriggerDocument } from "./trigger-model.js";

export function meleeInitializationTriggers(): TriggerDocument {
  return {
    variables: [],
    triggers: [
      {
        id: "B1162226",
        name: "Melee Initialization",
        events: [{ id: "989E936D", def: F.mapInit, params: {} }],
        actions: [
          { id: "6D07971E", def: F.meleeInitResources, params: {} },
          { id: "F39CCD6B", def: F.meleeInitUnits, params: {} },
          { id: "81663ED0", def: F.meleeInitAI, params: {} },
          { id: "82D647D6", def: F.meleeInitOptions, params: {} },
        ],
      },
    ],
  };
}
