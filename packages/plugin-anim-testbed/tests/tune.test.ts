// Retiming in the game, back into the spec: the bank's name and sections, reading it, and --apply's
// edits, skips and what it leaves in the bank.
import { describe, expect, it } from "vitest";

import { applyTunings, readTuneBank, sectionNames, setNumber, type Tuning, tuneBankName, withoutApplied } from "../tune.ts";

const SPEC = `{
  // the spec's own comment
  "base": "../Map.SC2Map",
  "moments": { "attack": { "do": "play" } },
  "units": [
    { "key": "marine", "unit": "Marine",
      "animations": {
        "attack": { "play": "AnimPlay Attack Attack NonLooping", "strike": 0.1 }, // land follows the strike
        "flinch": {
          "play": "AnimPlay Damage Damage NonLooping", // a hit
          "strike": 0.05,
          "land": 0.05,
          "clear": 0.4
        }
      }
    }
  ]
}
`;

const tuning = (anim: string, now: [number, number, number], built: [number, number, number], unit = "marine"): Tuning => ({
  section: `${unit}_${anim}`,
  unit,
  anim,
  now: { strike: now[0], land: now[1], length: now[2] },
  built: { strike: built[0], land: built[1], length: built[2] },
});

const BANK = `<?xml version="1.0" encoding="utf-8"?>
<Bank version="1">
    <Section name="marine_attack">
        <Key name="anim">
            <Value string="attack"/>
        </Key>
        <Key name="land">
            <Value fixed="0.15"/>
        </Key>
        <Key name="landBuilt">
            <Value fixed="0.1"/>
        </Key>
        <Key name="length">
            <Value fixed="0.8"/>
        </Key>
        <Key name="lengthBuilt">
            <Value fixed="0.8"/>
        </Key>
        <Key name="strike">
            <Value fixed="0.15"/>
        </Key>
        <Key name="strikeBuilt">
            <Value fixed="0.0999"/>
        </Key>
        <Key name="unit">
            <Value string="marine"/>
        </Key>
    </Section>
    <Section name="half">
        <Key name="unit">
            <Value string="marine"/>
        </Key>
    </Section>
</Bank>
`;

describe("the tuning bank", () => {
  it("is named after the spec, and each animation has a section of plain characters", () => {
    expect(tuneBankName("stock-units")).toBe("AnimTuneStockUnits");
    expect(tuneBankName("my test 2")).toBe("AnimTuneMyTest2");
    expect(sectionNames([{ key: "marine", animations: { attack: {}, "a-b": {} } }, { key: "marine", animations: { attack: {} } }])).toEqual([["marine_attack", "marine_a_b"], ["marine_attack_2"]]);
  });

  it("reads a section with all its keys and leaves out one that isn't the map's", () => {
    expect(readTuneBank(BANK)).toEqual([tuning("attack", [0.15, 0.15, 0.8], [0.0999, 0.1, 0.8])]);
  });
});

describe("--apply", () => {
  it("writes a moved strike in place, keeping the comments, and a land that follows it stays out", () => {
    const result = applyTunings(SPEC, [tuning("attack", [0.15, 0.15, 0.8], [0.1, 0.1, 0.8])]);
    expect(result.text).toBe(SPEC.replace('"strike": 0.1 }', '"strike": 0.15 }'));
    expect(result.lines).toEqual(["marine / attack: strike 0.10 → 0.15"]);
    expect(result.done.get("marine_attack")).toEqual(["strike", "land", "length"]);
  });

  it("adds a land that was stepped on its own, on the object's line", () => {
    const result = applyTunings(SPEC, [tuning("attack", [0.1, 0.2, 0.8], [0.1, 0.1, 0.8])]);
    expect(result.text).toContain('{ "play": "AnimPlay Attack Attack NonLooping", "strike": 0.1, "land": 0.2 }, // land follows the strike');
    expect(result.lines).toEqual(["marine / attack: land 0.10 → 0.20"]);
  });

  it("adds a land when the strike moves under one that stayed (the link was broken)", () => {
    const result = applyTunings(SPEC, [tuning("attack", [0.05, 0.1, 0.8], [0.1, 0.1, 0.8])]);
    expect(result.text).toContain('"strike": 0.05, "land": 0.1 }');
  });

  it("adds a length to a multi-line object on a line of its own", () => {
    const result = applyTunings(SPEC, [tuning("flinch", [0.05, 0.05, 0.6], [0.05, 0.05, 0.5])]);
    expect(result.text).toContain('"clear": 0.4,\n          "length": 0.6\n        }');
    expect(result.lines).toEqual(["marine / flinch: length 0.50 → 0.60"]);
  });

  it("skips a value the spec has changed since the build, and keeps it in the bank", () => {
    const result = applyTunings(SPEC, [tuning("flinch", [0.1, 0.1, 0.5], [0.0, 0.0, 0.5])]);
    expect(result.text).toBe(SPEC);
    expect(result.lines).toEqual([
      "marine / flinch: strike skipped, the spec has 0.05 now; the game tuned 0.00 → 0.10",
      "marine / flinch: land skipped, the spec has 0.05 now; the game tuned 0.00 → 0.10",
    ]);
    expect(result.done.get("marine_flinch")).toEqual(["length"]);
  });

  it("skips an animation or unit the spec no longer has", () => {
    const result = applyTunings(SPEC, [tuning("cower", [0.2, 0.2, 1], [0.1, 0.1, 1]), tuning("attack", [0.2, 0.2, 1], [0.1, 0.1, 1], "zealot")]);
    expect(result.lines).toEqual(['marine / cower: skipped, the spec has no animation "cower" on marine now', 'zealot / attack: skipped, the spec has no unit "zealot" now']);
    expect(result.done.size).toBe(0);
  });

  it("keeps a value that was tuned and stepped back out of the spec", () => {
    const result = applyTunings(SPEC, [tuning("attack", [0.1, 0.1, 0.8], [0.1, 0.1, 0.8])]);
    expect(result.text).toBe(SPEC);
    expect(result.lines).toEqual([]);
  });

  it("takes applied sections and keys out of the bank, and says when none is left", () => {
    expect(withoutApplied(BANK, new Map([["marine_attack", ["strike", "land", "length"]]]))).not.toContain("marine_attack");
    const partial = withoutApplied(BANK, new Map([["marine_attack", ["length" as const]]]))!;
    expect(partial).toContain('<Key name="strikeBuilt">');
    expect(partial).not.toContain('<Key name="length">');
    expect(partial).not.toContain('<Key name="lengthBuilt">');
    const one = BANK.replace(/ {4}<Section name="half">[\s\S]*?<\/Section>\n/, "");
    expect(withoutApplied(one, new Map([["marine_attack", ["strike", "land", "length"]]]))).toBeUndefined();
  });

  it("sets a number where it is, or adds it to an empty object", () => {
    expect(setNumber('{ "a": { "b": 1 } }', ["a", "b"], 2)).toBe('{ "a": { "b": 2 } }');
    expect(setNumber('{ "a": {} }', ["a", "c"], 3)).toBe('{ "a": { "c": 3 } }');
  });
});
