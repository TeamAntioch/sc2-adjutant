// The render-to-texture channels a model shows: each material layer (LAYR) names the channel it
// draws, its `video_channel`, -1 for none. A cutscene's RTT channel node draws a camera's view into
// a channel, and every model showing that channel shows the picture (docs/reference/editor-and-engine.md,
// "Render to texture"). The layout is structures.xml's (m3addon): the channel follows the noise
// type, at 92, and from version 24 two noise floats (noise_amplitude, noise_frequency) come before
// it, putting it at 100. Version 23's new fields (the triplanar offset and scale) come after it.

import { m3Index } from "./m3-sequences.js";

/** A LAYR's size by version. */
const LAYR_SIZE: Readonly<Record<number, number>> = { 20: 356, 21: 356, 22: 356, 23: 428, 24: 436, 25: 468, 26: 464 };
const channelAt = (version: number): number => (version >= 24 ? 100 : 92);

/** The channels an MD34 .m3's layers show, each once, lowest first; none for a model that isn't a display. */
export function readM3DisplayChannels(data: Uint8Array): number[] {
  const { view, entries } = m3Index(data);
  const channels = new Set<number>();
  for (const entry of entries) {
    if (entry.tag !== "RYAL" || entry.count === 0) continue;
    const size = LAYR_SIZE[entry.version];
    if (size === undefined) throw new Error(`LAYR version ${entry.version} isn't one whose layout is known (${Object.keys(LAYR_SIZE).join(", ")})`);
    if (entry.offset + size * entry.count > data.length) throw new Error(`A LAYR block at ${entry.offset} runs past the end of the file`);
    for (let k = 0; k < entry.count; k++) {
      const channel = view.getInt32(entry.offset + size * k + channelAt(entry.version), true);
      if (channel >= 0) channels.add(channel);
    }
  }
  return [...channels].sort((a, b) => a - b);
}
