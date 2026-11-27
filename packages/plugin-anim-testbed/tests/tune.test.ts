// Tuning in the game, back into the spec: the bank's name and sections, reading it, and --apply's
// edits, skips and what it leaves in the bank.
import { describe, expect, it } from "vitest";

import { applyTunings, type ElementKey, readTuneBank, removeKey, sectionNames, setValue, type Tuned, type Tuning, tuneBankName, withoutApplied } from "../tune.ts";

const SPEC = `{
  // the spec's own comment
  "base": "../Map.SC2Map",
  "units": [
    { "key": "marine", "unit": "Marine",
      "animations": { "attack": { "play": "AnimPlay Attack Attack NonLooping", "strike": 0.1 } },
      "moments": {
        "attack": { "variations": [
          { "note": "the burst", "elements": [
            { "anim": "attack" },
            { "sound": "Marine_AttackLaunch", "at": 0.1 }, // the shot
            { "sound": "Marine_AttackLaunch", "at": 0.3, "stop": 0.6 },
            { "sound": "Marine_Stimpack", "at": 0, "muted": true }
          ] }
        ] }
      }
    }
  ]
}
`;

const key = (kind: string, id: string, occurrence = 1, variation = 1): ElementKey => ({ unit: "marine", moment: "attack", variation, kind, id, occurrence });
const tuned = (at: number, stop = -1, muted = false): Tuned => ({ at, stop, muted });
const tuning = (k: ElementKey, now: Tuned, built: Tuned, section = "s"): Tuning => ({ section, key: k, now, built });

const BANK = `<?xml version="1.0" encoding="utf-8"?>\r
<Bank version="1">\r
    <Section name="e1a2b3c4d">\r
        <Key name="at">\r
            <Value fixed="0.1499"/>\r
        </Key>\r
        <Key name="atBuilt">\r
            <Value fixed="0.0999"/>\r
        </Key>\r
        <Key name="id">\r
            <Value string="Marine_AttackLaunch"/>\r
        </Key>\r
        <Key name="kind">\r
            <Value string="sound"/>\r
        </Key>\r
        <Key name="moment">\r
            <Value string="attack"/>\r
        </Key>\r
        <Key name="muted">\r
            <Value int="0"/>\r
        </Key>\r
        <Key name="mutedBuilt">\r
            <Value int="0"/>\r
        </Key>\r
        <Key name="occurrence">\r
            <Value int="1"/>\r
        </Key>\r
        <Key name="stop">\r
            <Value fixed="0.5"/>\r
        </Key>\r
        <Key name="stopBuilt">\r
            <Value fixed="-1"/>\r
        </Key>\r
        <Key name="unit">\r
            <Value string="marine"/>\r
        </Key>\r
        <Key name="variation">\r
            <Value int="1"/>\r
        </Key>\r
    </Section>\r
    <Section name="half">\r
        <Key name="unit">\r
            <Value string="marine"/>\r
        </Key>\r
    </Section>\r
</Bank>\r
`;

describe("the tuning bank", () => {
  it("is named after the spec", () => {
    expect(tuneBankName("stock-units")).toBe("AnimTuneStockUnits");
    expect(tuneBankName("my test 2")).toBe("AnimTuneMyTest2");
  });

  it("gives each element a short plain section, the same for the same key and different for another", () => {
    const [a, b, c, d] = sectionNames([key("sound", "X"), key("sound", "X", 2), key("anim", "attack"), key("sound", "X")]);
    expect(a).toMatch(/^e[0-9a-f]{8}$/);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(d).toBe(`${a}_2`);
    expect(sectionNames([key("sound", "X")])[0]).toBe(a);
  });

  it("reads a section with all its keys and leaves out one that isn't the map's", () => {
    expect(readTuneBank(BANK)).toEqual([tuning(key("sound", "Marine_AttackLaunch"), tuned(0.1499, 0.5), tuned(0.0999), "e1a2b3c4d")]);
  });
});

describe("applyTunings", () => {
  it("moves a start, adds a stop and writes nothing for a field the game left alone", () => {
    const r = applyTunings(SPEC, [tuning(key("sound", "Marine_AttackLaunch"), tuned(0.1499, 0.5), tuned(0.0999))]);
    expect(r.text).toContain('{ "sound": "Marine_AttackLaunch", "at": 0.15, "stop": 0.5 }, // the shot');
    expect(r.text).toContain("// the spec's own comment");
    expect(r.lines).toEqual(["marine attack 1, sound Marine_AttackLaunch: at 0.10 → 0.15", "marine attack 1, sound Marine_AttackLaunch: stop none → 0.50"]);
    expect(r.done.get("s")).toEqual(["at", "stop", "muted"]);
  });

  it("finds the second of two elements of one kind and id, takes a stop out and adds an at the spec left out", () => {
    const r = applyTunings(SPEC, [
      tuning(key("sound", "Marine_AttackLaunch", 2), tuned(0.35), tuned(0.3, 0.6), "a"),
      tuning(key("anim", "attack"), tuned(0.05), tuned(0), "b"),
    ]);
    expect(r.text).toContain('{ "sound": "Marine_AttackLaunch", "at": 0.35 },');
    expect(r.text).toContain('{ "anim": "attack", "at": 0.05 },');
  });

  it("unmutes by taking muted out, and mutes by adding it", () => {
    const r = applyTunings(SPEC, [tuning(key("sound", "Marine_Stimpack"), tuned(0), tuned(0, -1, true), "a"), tuning(key("anim", "attack"), tuned(0, -1, true), tuned(0), "b")]);
    expect(r.text).toContain('{ "sound": "Marine_Stimpack", "at": 0 }');
    expect(r.text).toContain('{ "anim": "attack", "muted": true },');
    expect(r.lines).toContain("marine attack 1, sound Marine_Stimpack: muted muted → playing");
  });

  it("skips a field the spec changed since the build, and an element it no longer has, keeping both in the bank", () => {
    const r = applyTunings(SPEC, [
      tuning(key("sound", "Marine_AttackLaunch"), tuned(0.2, 0.5), tuned(0.05), "a"),
      tuning(key("sound", "Marine_Death"), tuned(0.2), tuned(0.1), "b"),
      tuning(key("sound", "Marine_AttackLaunch", 1, 2), tuned(0.1), tuned(0.1), "c"),
    ]);
    expect(r.lines).toEqual([
      "marine attack 1, sound Marine_AttackLaunch: at skipped, the spec has 0.10 now; the game tuned 0.05 → 0.20",
      "marine attack 1, sound Marine_AttackLaunch: stop none → 0.50",
      "marine attack 1, sound Marine_Death: skipped, marine attack 1 has no sound Marine_Death now",
    ]);
    expect(r.done.get("a")).toEqual(["stop", "muted"]);
    expect(r.done.has("b")).toBe(false);
    expect(r.done.get("c")).toEqual(["at", "stop", "muted"]);
  });
});

describe("editing the spec's text", () => {
  it("adds a key on the line of an inline object, and on a line of its own in a multi-line one", () => {
    expect(setValue('{ "a": { "b": 1 } }', ["a", "c"], "2")).toBe('{ "a": { "b": 1, "c": 2 } }');
    expect(setValue('{\n  "a": 1 // one\n}\n', ["b"], "2")).toBe('{\n  "a": 1, // one\n  "b": 2\n}\n');
    expect(setValue('{ "a": 1 }', ["a"], "3")).toBe('{ "a": 3 }');
  });

  it("takes a key out with its comma, wherever it is", () => {
    expect(removeKey('{ "a": 1, "b": 2, "c": 3 }', ["b"])).toBe('{ "a": 1, "c": 3 }');
    expect(removeKey('{ "a": 1, "b": 2 }', ["b"])).toBe('{ "a": 1 }');
    expect(removeKey('{ "a": 1 }', ["a"])).toBe("{}");
    expect(removeKey('{ "a": 1 }', ["z"])).toBe('{ "a": 1 }');
  });
});

describe("withoutApplied", () => {
  it("takes out a section all applied, and the bank once none is left", () => {
    expect(withoutApplied(BANK, new Map([["e1a2b3c4d", ["at", "stop", "muted"] as const], ["half", ["at", "stop", "muted"] as const]]))).toBeUndefined();
    expect(withoutApplied(BANK, new Map([["e1a2b3c4d", ["at", "stop", "muted"] as const]]))).not.toContain("e1a2b3c4d");
  });

  it("keeps a section partly applied, its applied fields reading as unchanged", () => {
    const left = withoutApplied(BANK, new Map([["e1a2b3c4d", ["stop", "muted"] as const]]))!;
    const [t] = readTuneBank(left);
    expect(t!.now).toEqual(tuned(0.1499, 0.5));
    expect(t!.built).toEqual(tuned(0.0999, 0.5));
  });
});
