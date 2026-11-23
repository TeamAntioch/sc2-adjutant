import { describe, expect, it } from "vitest";

import { formatCensus, standing, tagCensus, withoutComments } from "../../src/cutscene/tag-census.js";

const file = (name: string, body: string) => ({ name, xml: `<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState>\n${body}\n</CutsceneState>` });

describe("tag census", () => {
  const files = [
    file("a", `<CCutsceneNodeFolder Name="x"><CCutsceneNodeActor Model="m" Mood="happy" Zeal="1"/></CCutsceneNodeFolder>`),
    file("b", `<CCutsceneNodeActor Model="n"/><CCutsceneNodeFog Density="1"/><CCutsceneNodeLight Time="1"/>`),
    file("broken", `<CCutsceneNodeActor>`),
  ];
  const sources = [
    { name: "cutscene/write-shot-cutscene", text: `const a = "CCutsceneNodeActor"; const attrs = { Model: 1, Zeal: 2 };` },
    { name: "cutscene/import-set", text: `// "CCutsceneNodeFog" is only in a comment\nconst x = "CCutsceneNodeLight";` },
  ];
  const census = tagCensus(files, sources);

  it("counts files and occurrences, most common first, and lists an unparseable file", () => {
    expect(census.files).toBe(2);
    expect(census.unreadable).toEqual(["broken"]);
    expect(census.kinds.map((kind) => [kind.kind, kind.files, kind.total])).toEqual([
      ["CCutsceneNodeActor", 2, 2],
      ["CCutsceneNodeFog", 1, 1],
      ["CCutsceneNodeFolder", 1, 1],
      ["CCutsceneNodeLight", 1, 1],
    ]);
  });

  it("does not count the document's root element", () => {
    expect(census.kinds.some((kind) => /State$/.test(kind.kind))).toBe(false);
  });

  it("attributes each kind to the files that name it, and tells a writer from other code", () => {
    const by = (name: string) => census.kinds.find((kind) => kind.kind === name)!;
    expect(by("CCutsceneNodeActor")).toMatchObject({ namedIn: ["cutscene/write-shot-cutscene"], written: true });
    expect(standing(by("CCutsceneNodeActor"))).toBe("writes");
    expect(standing(by("CCutsceneNodeLight"))).toBe("other code only");
    expect(by("CCutsceneNodeLight").namedIn).toEqual(["cutscene/import-set"]);
    expect(standing(by("CCutsceneNodeFog"))).toBe("not named");
  });

  it("ignores a name that is only in a comment or inside a longer string", () => {
    expect(withoutComments(`a // "X"\n/* "Y" */ b`)).not.toMatch(/X|Y/);
    const longer = tagCensus([file("c", `<CCutsceneNodeActor/>`)], [{ name: "x", text: `"CCutsceneNodeActorGroup"; "bad CCutsceneNodeActor value"` }]);
    expect(longer.kinds[0]!.namedIn).toEqual([]);
  });

  it("lists attributes no code mentions, and sets common words aside instead of judging them", () => {
    const actor = census.kinds.find((kind) => kind.kind === "CCutsceneNodeActor")!;
    expect(actor.attributesNotNamed).toEqual(["Mood"]);
    const light = tagCensus([file("d", `<CCutsceneNodeLight Time="1" Glow="2"/>`)], [{ name: "x", text: `"CCutsceneNodeLight"; time` }]).kinds[0]!;
    expect(light.attributesAmbiguous).toEqual(["Time"]);
    expect(light.attributesNotNamed).toEqual(["Glow"]);
  });

  it("formats the counts and a table", () => {
    const text = formatCensus(census);
    expect(text).toContain("named in a writer file 1, named only in other code 1, not named 2");
    expect(text).toContain("| CCutsceneNodeActor | 2 | 2 | writes |  | Mood |");
  });
});
