// sc2-adjutant's look closer (ADR-0020, #634, #678): a tray action that hands the open object's
// Doodad Search to the doodad-search skill. Its search.json is kept as the tray changes
// (doodad-searches.ts); look closer copies a prompt naming it with the system clipboard (clipboard.ts) for pasting into Claude,
// and puts the object away.

import { existsSync } from "node:fs";
import path from "node:path";

import { DOODAD_SEARCH_FILE } from "@team-antioch/sc2-adjutant/dist/catalog/doodad-search-page.js";

import type { Copy } from "../clipboard.ts";
import type { TrayAction } from "@team-antioch/sc2-doodad-finder/server.js";

/** The prompt look closer copies, for pasting into Claude: it names the search.json to carry on from. */
export const lookCloserPrompt = (file: string): string =>
  `Carry on the Doodad Search in ${file} with the doodad-search skill. The Doodad Finder started it: judge each Search Part's shortlist from the pictures, then build the page.`;

/** The tray action: the open object's Doodad Search, handed to the doodad-search skill. */
export function lookCloser({ copy }: { readonly copy?: Copy | undefined } = {}): TrayAction {
  return {
    label: "Look closer",
    title: "Hands the object's Doodad Search to Claude: copies a prompt naming its search.json, and puts the object away",
    async run({ object }) {
      if (!object) throw new Error("Name the object first (Object, above the tray): look closer hands its Doodad Search over");
      const file = path.join(object.key, DOODAD_SEARCH_FILE);
      if (!existsSync(file)) throw new Error(`${object.title} has no search.json yet: tick a card for it first`);
      const prompt = lookCloserPrompt(file);
      const copied = copy ? await copy(prompt).then(() => true, () => false) : false;
      return {
        message: `${copied ? "Copied to the clipboard. Paste it into Claude" : "Copy this and paste it into Claude"}: the doodad-search skill judges the ticked cards from their pictures and builds the page.`,
        text: prompt,
        copied,
        putAway: true,
      };
    },
  };
}
