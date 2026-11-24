// Reading the Mac's process table for the games a capture may quit.
import { describe, expect, it } from "vitest";

import { parseGames } from "../games.ts";

describe("reading the process table", () => {
  it("takes the game's processes with their start times, and nothing else", () => {
    const ps = [
      "  501 Tue Nov 24 10:00:00 2026 /Applications/StarCraft II/Versions/Base95841/SC2.app/Contents/MacOS/SC2 -run Test/EditorTest.SC2Map",
      "  777 Mon Nov  3 09:05:09 2026 /Applications/StarCraft II/Versions/Base95841/SC2.app/Contents/MacOS/SC2 -displaymode 0",
      "  900 Tue Nov 24 10:00:00 2026 /Applications/StarCraft II/Support/SC2Switcher.app/Contents/MacOS/SC2Switcher",
      "  910 Tue Nov 24 10:00:01 2026 /usr/bin/tail -f MacOS/SC2",
    ].join("\n");
    expect(parseGames(ps)).toEqual([
      { pid: 501, startedAt: "Tue Nov 24 10:00:00 2026" },
      { pid: 777, startedAt: "Mon Nov  3 09:05:09 2026" },
    ]);
  });
});

