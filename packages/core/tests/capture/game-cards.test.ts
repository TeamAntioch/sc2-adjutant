import { describe, expect, it } from "vitest";

import { adoptGameCards } from "../../src/capture/game-cards.js";
import { parseSetLooks } from "../../src/cutscene/set-looks.js";

const room = (pictures: unknown[]) => ({ kind: "room", look: "A small round room about 6 cells across with a console in the middle.", facets: ["interior", "round", "small"], standsInFor: [], basis: "Its pictures.", confidence: "high", problems: [], pictures });
const looks = parseSetLooks({
  "control-room": room([
    { file: "card/1.jpg", shows: "the room", from: { view: "plan" } },
    { file: "card/2.jpg", shows: "the console", from: { eye: [0, 0, 2], target: [1, 0, 2] } },
    { file: "card/3.jpg", shows: "the door", from: { eye: [0, 0, 2], target: [-1, 0, 2] }, game: { capture: "card-3.jpg", lighting: "old" } },
  ]),
  "dark-hall": room([{ file: "card/1.jpg", shows: "the hall", from: { eye: [0, 0, 2], target: [1, 0, 2] } }]),
});
const frame = (set: string, n: number, lighting = "closest shot") => ({ lighting, file: `${set}/card-${n}.jpg` });

describe("adoptGameCards", () => {
  it("gives each picture its kept frame, but those left out by set or by card, and loses a left-out one's old frame", () => {
    const result = adoptGameCards(looks, {
      sets: {
        "control-room": { "card/2.jpg": frame("control-room", 2), "card/3.jpg": frame("control-room", 3), "card/9.jpg": frame("control-room", 9) },
        "dark-hall": { "card/1.jpg": frame("dark-hall", 1) },
        gone: { "card/1.jpg": frame("gone", 1) },
      },
    }, ["dark-hall", "control-room/3"]);
    expect(result.adopted).toEqual(["control-room/card/2.jpg"]);
    expect(result.leftOut).toEqual(["control-room/card/3.jpg", "dark-hall/card/1.jpg"]);
    expect(result.unmatched).toEqual(["control-room/card/9.jpg", "gone/card/1.jpg"]);
    const pictures = result.looks["control-room"]!.pictures!;
    expect(pictures.map((picture) => picture.game)).toEqual([undefined, { capture: "card-2.jpg", lighting: "closest shot" }, undefined]);
    expect(looks["control-room"]!.pictures![2]!.game).toBeDefined();
    expect(() => parseSetLooks(result.looks)).not.toThrow();
  });
});
