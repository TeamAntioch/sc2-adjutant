import { describe, expect, it } from "vitest";

import { ANCHOR_FIELD_PATTERNS, COLLECTION_LISTS, type Collection, anchorReferences, idEntries, idsOf, namedAnchorIds, unknownIdIssue } from "../../src/domain/reference-graph.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";

const namesAnchor = (blueprint: unknown, anchorId: string): boolean => namedAnchorIds(blueprint).has(anchorId);

/** What sync's `referenced` was: a quoted search of the whole raw JSON, the Anchor's own entry left out. */
function searchedBefore(out: Record<string, unknown>, anchorId: string): boolean {
  const anchors = (out["anchors"] as { id: string }[] | undefined) ?? [];
  return JSON.stringify({ ...out, anchors: anchors.filter((a) => a.id !== anchorId) }).includes(`"${anchorId}"`);
}

/** Every place the schema lets a Blueprint name an Anchor, one distinct Anchor id in each. */
function blueprintNamingAnchorsEverywhere(): Record<string, unknown> {
  return {
    zones: [{ id: "field" }, { id: "mesa" }],
    anchors: ["a-beat", "a-reveal", "a-start", "a-complete", "a-victory", "a-defeat", "a-enc-start", "a-behavior", "a-attacker", "a-spawn", "a-unit", "a-speaker", "a-line", "a-cue", "a-target", "a-trans", "a-ui", "a-scene-cue", "a-hold", "a-placement", "a-mechanic", "a-uiparams", "a-key", "a-pathing", "a-orphan"].map((id) => ({ id })),
    beats: [{ id: "b1", anchorIds: ["a-beat"], reveals: ["field", { zoneId: "mesa", at: "a-reveal" }], startsWhen: [{ type: "anchorDies", anchorId: "a-start" }] }],
    objectives: [{ id: "o1", completeWhen: { type: "anchorDies", anchorId: "a-complete" } }],
    outcomes: { victory: [{ type: "anchorDies", anchorId: "a-victory" }], defeat: [{ type: "anchorCaptured", anchorId: "a-defeat" }] },
    encounters: [{ id: "e1", startsWhen: { type: "anchorDies", anchorId: "a-enc-start" }, behavior: { anchorId: "a-behavior", behavior: "Stim" }, attackerAnchorIds: ["a-attacker"] }],
    waves: [{ id: "w1", spawnAnchorId: "a-spawn", units: [{ anchorId: "a-unit" }] }],
    screenplay: {
      script: {
        speakerAnchors: { NARRATOR: "a-speaker" },
        cues: [{ scene: 1, cue: { type: "anchorNears", anchorId: "a-cue", targetId: "a-target" } }],
      },
      scenes: [{ id: "s1", cue: { type: "anchorDies", anchorId: "a-scene-cue" }, lines: [{ id: "l1", speakerAnchorId: "a-line" }] }],
    },
    transitions: [{ id: "t1", cue: { type: "effectStarts", anchorId: "a-trans", effectId: "X" } }],
    uiActions: [{ id: "u1", cue: { type: "anchorDies", anchorId: "a-ui" }, params: { target: "a-uiparams" } }],
    pathingPaint: [{ doodad: "a-pathing", block: [[0, 0, 1, 1]] }],
    kept: [{ id: "k1", kind: "trigger", hold: { until: { type: "anchorDies", anchorId: "a-hold" } } }],
    placements: [{ id: "p1", params: { guards: ["a-placement"] } }],
    mechanics: [{ id: "m1", params: { byAnchor: { "a-key": { n: 1 }, nested: [{ deeper: "a-mechanic" }] } } }],
  };
}

describe("a collection's ids", () => {
  it("lists them in order with the path of each id", () => {
    const blueprint = { zones: [{ id: "field" }, { id: "mesa" }], screenplay: { scenes: [{ id: "s1" }] } };
    expect(idsOf(blueprint, "zones")).toEqual(["field", "mesa"]);
    expect(idEntries(blueprint, "scenes")).toEqual([{ id: "s1", path: ["screenplay", "scenes", 0, "id"] }]);
  });

  it("is empty for a list the Blueprint lacks", () => {
    expect(idsOf({}, "beats")).toEqual([]);
    expect(idsOf({ screenplay: {} }, "scenes")).toEqual([]);
  });

  it("words an unknown id by what the collection is called", () => {
    expect(unknownIdIssue("zones", "x", ["a", 1])).toEqual({ code: "custom", message: "Unknown zone id: x", path: ["a", 1] });
    expect(unknownIdIssue("beats", "x", []).message).toBe("Unknown beat id: x");
    expect(unknownIdIssue("anchors", "x", []).message).toBe("Unknown anchor id: x");
    expect(unknownIdIssue("encounters", "x", []).message).toBe("Unknown encounter id: x");
    expect(unknownIdIssue("mechanics", "x", []).message).toBe("Unknown mechanic id: x");
  });
});

describe("the Anchors a Blueprint names", () => {
  const blueprint = blueprintNamingAnchorsEverywhere();

  it("finds one in every field that can name it", () => {
    const declared = (blueprint["anchors"] as { id: string }[]).map((a) => a.id);
    const named = new Set(anchorReferences(blueprint).map((reference) => reference.id));
    expect(declared.filter((id) => !named.has(id))).toEqual(["a-orphan"]);
  });

  it("says where it found one", () => {
    expect(anchorReferences(blueprint)).toContainEqual({ id: "a-reveal", path: ["beats", 0, "reveals", 1, "at"] });
    expect(anchorReferences(blueprint)).toContainEqual({ id: "a-speaker", path: ["screenplay", "script", "speakerAnchors", "NARRATOR"] });
  });

  it("agrees with the quoted search sync used, for every Anchor", () => {
    for (const anchor of blueprint["anchors"] as { id: string }[]) {
      expect(namesAnchor(blueprint, anchor.id), anchor.id).toBe(searchedBefore(blueprint, anchor.id));
    }
    expect(namesAnchor(blueprint, "a-orphan")).toBe(false);
  });

  it("does not count the Anchor's own entry, nor a zone reveal that is just a string", () => {
    expect(namesAnchor({ anchors: [{ id: "x" }], beats: [{ anchorIds: [], reveals: ["x"] }] }, "x")).toBe(false);
    expect(searchedBefore({ anchors: [{ id: "x" }], beats: [{ anchorIds: [], reveals: ["x"] }] }, "x")).toBe(true);
  });

  it("never names more than the quoted search found, for any string of the Blueprint taken as an id", () => {
    const strings = new Set<string>();
    const collect = (node: unknown): void => {
      if (typeof node === "string") strings.add(node);
      else if (Array.isArray(node)) node.forEach(collect);
      else if (typeof node === "object" && node !== null) for (const [key, child] of Object.entries(node)) (strings.add(key), collect(child));
    };
    collect(blueprint);
    const anchorIds = new Set((blueprint["anchors"] as { id: string }[]).map((a) => a.id));
    for (const id of strings) {
      if (namesAnchor(blueprint, id)) expect(searchedBefore(blueprint, id), id).toBe(true);
      // They differ only on strings that are no Anchor's id: a Zone's or Beat's own id, a key such as NARRATOR.
      else if (searchedBefore(blueprint, id)) expect(anchorIds.has(id) && id !== "a-orphan", id).toBe(false);
    }
  });
});

describe("where the quoted search and the table differ", () => {
  it("counts an id held in a free-form blob, as a value or as a key, at any depth", () => {
    const blueprint = { anchors: [{ id: "beacon" }], mechanics: [{ id: "m", params: { deep: [{ x: { beacon: 1 } }] } }] };
    expect(namesAnchor(blueprint, "beacon")).toBe(true);
    expect(searchedBefore(blueprint, "beacon")).toBe(true);
  });

  it("does not count an id that only appears as prose, a name or a key outside the fields", () => {
    const blueprint = {
      title: "beacon",
      anchors: [{ id: "beacon" }, { id: "other", name: "beacon" }],
      beats: [{ id: "b1", name: "beacon", anchorIds: [] }],
      terrainEdits: { heights: { beacon: 1 } },
    };
    expect(searchedBefore(blueprint, "beacon")).toBe(true);
    expect(namesAnchor(blueprint, "beacon")).toBe(false);
  });

  it("does not count an id inside a longer string, as the quoted search did not", () => {
    const blueprint = { anchors: [{ id: "beacon" }], beats: [{ id: "b", description: 'say "beacon" now', anchorIds: ["beacon-2"] }] };
    expect(searchedBefore(blueprint, "beacon")).toBe(false);
    expect(namesAnchor(blueprint, "beacon")).toBe(false);
  });

  it("does not read a value off an array where a field expects an object", () => {
    expect(namesAnchor({ encounters: [{ behavior: ["beacon"] }], waves: "beacon", beats: null }, "beacon")).toBe(false);
  });
});

describe("the table against the Blueprint schema", () => {
  type Reached = { text: boolean; objects: boolean };
  const nothing: Reached = { text: false, objects: false };
  type Def = Record<string, any>;
  const defOf = (schema: unknown): Def | undefined => (schema as { _zod?: { def?: Def } } | undefined)?._zod?.def;

  /** What the schema holds at `path` (a `*` is a list's element or a record's value): a string, an object, or neither. */
  function reach(schema: unknown, path: readonly string[]): Reached {
    const def = defOf(schema);
    if (!def) return nothing;
    if (def["innerType"]) return reach(def["innerType"], path);
    switch (def["type"]) {
      case "union": return def["options"].map((option: unknown) => reach(option, path)).reduce((a: Reached, b: Reached) => ({ text: a.text || b.text, objects: a.objects || b.objects }), nothing);
      case "pipe": { const first = reach(def["in"], path); return first.text || first.objects ? first : reach(def["out"], path); }
      case "lazy": return reach(def["getter"](), path);
    }
    if (path.length === 0) return { text: def["type"] === "string", objects: def["type"] === "object" };
    const [head, ...rest] = path as [string, ...string[]];
    switch (def["type"]) {
      case "object": return head !== "*" && def["shape"][head] !== undefined ? reach(def["shape"][head], rest) : nothing;
      case "array": return head === "*" ? reach(def["element"], rest) : nothing;
      case "record": return head === "*" ? reach(def["valueType"], rest) : nothing;
      default: return nothing;
    }
  }

  /** Every string field of the schema, as a `.`-joined path with `*` for a list's element or a record's value. */
  function stringFields(schema: unknown, path: readonly string[], out: Set<string>, depth = 0): void {
    const def = defOf(schema);
    if (!def || depth > 14) return;
    switch (def["type"]) {
      case "string": out.add(path.join(".")); return;
      case "object": for (const [key, child] of Object.entries(def["shape"])) stringFields(child, [...path, key], out, depth + 1); return;
      case "array": stringFields(def["element"], [...path, "*"], out, depth + 1); return;
      case "record": stringFields(def["valueType"], [...path, "*"], out, depth + 1); return;
      case "union": for (const option of def["options"]) stringFields(option, path, out, depth + 1); return;
      case "tuple": for (const item of def["items"]) stringFields(item, [...path, "#"], out, depth + 1); return;
      case "pipe": stringFields(def["in"], path, out, depth + 1); stringFields(def["out"], path, out, depth + 1); return;
      case "lazy": stringFields(def["getter"](), path, out, depth + 1); return;
      case "intersection": stringFields(def["left"], path, out, depth + 1); stringFields(def["right"], path, out, depth + 1); return;
      default: if (def["innerType"]) stringFields(def["innerType"], path, out, depth + 1);
    }
  }

  it("lists every collection where the schema has a list of objects with an id", () => {
    for (const [collection, list] of Object.entries(COLLECTION_LISTS)) {
      expect(reach(MissionBlueprintSchema, [...list, "*"]).objects, collection).toBe(true);
      expect(reach(MissionBlueprintSchema, [...list, "*", "id"]).text, `${collection}.id`).toBe(true);
    }
  });

  it("finds ids in every collection of a populated Blueprint, so a wrong path can't read as empty", () => {
    const blueprint = { ...blueprintNamingAnchorsEverywhere(), regions: [{ id: "r1" }], composites: [{ id: "c1" }], ramps: [{ id: "rp1" }], terrainObjects: [{ id: "t1" }] };
    for (const collection of Object.keys(COLLECTION_LISTS) as Collection[]) {
      expect(idsOf(blueprint, collection).length, collection).toBeGreaterThan(0);
    }
  });

  it("has every Anchor field of the table in the schema", () => {
    for (const pattern of ANCHOR_FIELD_PATTERNS) expect(reach(MissionBlueprintSchema, pattern).text, pattern.join(".")).toBe(true);
  });

  it("covers every schema field that can hold an Anchor's id", () => {
    const fields = new Set<string>();
    stringFields(MissionBlueprintSchema, [], fields);
    // A field says it holds an Anchor in its name; the few that say it another way are listed by hand.
    const unnamed = new Set(["beats.*.reveals.*.at", "pathingPaint.*.doodad"]);
    const canHold = [...fields].filter((field) => !field.startsWith("anchors.") && (/anchor/i.test(field) || /(^|\.)targetId$/.test(field) || unnamed.has(field)));
    expect(canHold.length).toBeGreaterThan(20);
    const covered = new Set(ANCHOR_FIELD_PATTERNS.map((pattern) => pattern.join(".")));
    expect(canHold.filter((field) => !covered.has(field))).toEqual([]);
  });
});
