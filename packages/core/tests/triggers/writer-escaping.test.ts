// The trigger writers escape the values they write: a Galaxy string literal's quotes and
// backslashes, XML element text, and a strings file refuses a line break it can't hold. Values
// such as a uiAction's params reach them from the Blueprint.
import { describe, expect, it } from "vitest";

import { stableElementId } from "../../src/triggers/trigger-builders.js";
import type { FunctionDef } from "../../src/triggers/trigger-catalog.js";
import type { ParamValue, TriggerDocument } from "../../src/triggers/trigger-model.js";
import { galaxyString, writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeStringsFile } from "../../src/triggers/write-trigger-strings.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const SHOW: FunctionDef = {
  library: "Ntve",
  id: "0000E5C1",
  kind: "action",
  params: { link: { id: "0000E5C2" }, file: { id: "0000E5C3" }, sound: { id: "0000E5C4" }, anim: { id: "0000E5C5" } },
  galaxy: (args) => `Show(${args["link"]}, ${args["file"]}, ${args["sound"]}, ${args["anim"]})`,
};

/** A document of one trigger whose one action is SHOW with `values`. */
function doc(values: Readonly<Record<string, ParamValue>>): TriggerDocument {
  const params = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { id: stableElementId(`escape/${key}`), value }]));
  return {
    variables: [],
    triggers: [{ id: stableElementId("escape"), name: "Escape", events: [], actions: [{ id: stableElementId("escape/show"), def: SHOW, params }] }],
  };
}

const ODD: Readonly<Record<string, ParamValue>> = {
  link: { kind: "gamelink", gameType: "Unit", value: `Say"<&>` },
  file: { kind: "filepath", value: `Assets\\Textures\\a"b&.dds` },
  sound: { kind: "soundlink", sound: `Line"1<2>` },
  anim: { kind: "modelanim", value: `Talk"&` },
};
const odd = doc(ODD);

describe("the trigger writers", () => {
  it("write a Galaxy string literal with its quotes and backslashes escaped", () => {
    const script = writeMapScript({ mapName: "Escapes", triggers: odd });
    expect(script).toContain(`Show("Say\\"<&>", "Assets\\\\Textures\\\\a\\"b&.dds", SoundLink("Line\\"1<2>", -1), "Talk\\"&");`);
  });

  it("refuse a control character in a Galaxy string", () => {
    expect(galaxyString("plain")).toBe(`"plain"`);
    expect(() => galaxyString("two\nlines")).toThrow(/control character.*can't hold/);
    expect(() => writeMapScript({ mapName: "Escapes", triggers: doc({ ...ODD, link: { kind: "gamelink", gameType: "Unit", value: "a\tb" } }) })).toThrow(/control character/);
  });

  it("XML-escape the values they write as element text", () => {
    const xml = writeTriggersXml(odd);
    expect(xml).toContain(`<Value>Say"&lt;&amp;&gt;</Value>`);
    expect(xml).toContain(`<Value>Assets\\Textures\\a"b&amp;.dds</Value>`);
    expect(xml).toContain(`<Value>Line"1&lt;2&gt;</Value>`);
    expect(xml).toContain(`<Value>&quot;Talk&quot;&amp;&quot;</Value>`);
  });

  it("refuse a strings file entry with a line break, which its key=value line can't hold", () => {
    expect(writeStringsFile({ "Param/Value/1": "one line" })).toBe("﻿Param/Value/1=one line\r\n");
    expect(() => writeStringsFile({ "Param/Value/1": "two\nlines" })).toThrow(/Param\/Value\/1 has a line break in its value.*<n\/>/);
    expect(() => writeStringsFile({ "Param/Value/1": "two\rlines" })).toThrow(/line break/);
    expect(() => writeStringsFile({ "Param/\nValue": "x" })).toThrow(/key .* has a line break/);
  });
});
