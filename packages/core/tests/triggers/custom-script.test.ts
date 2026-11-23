import { describe, expect, it } from "vitest";

import { withCustomScript, withCustomScriptInMapScript } from "../../src/triggers/custom-script.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

describe("withCustomScript", () => {
  const script = 'void Play_Init() {\n    Play("Cutscenes\\\\A & B.SC2Cutscene");\n}';

  it("adds the script to the root, escaped and indented for the Editor", () => {
    const xml = withCustomScript(undefined, "C5500002", script, "Play_Init");
    expect(xml).toContain('    <Root>\n        <Item Type="CustomScript" Id="C5500002"/>\n    </Root>');
    expect(xml).toContain("            Play(&quot;Cutscenes\\\\A &amp; B.SC2Cutscene&quot;);");
    expect(xml).toContain("<InitFunc>Play_Init</InitFunc>");
  });

  it("replaces its own earlier copy and keeps everything else", () => {
    const first = withCustomScript(undefined, "C5500001", "void Other() {}", "Other");
    const twice = withCustomScript(withCustomScript(first, "C5500002", script, "Play_Init"), "C5500002", "void Play_Init() {}", "Play_Init");
    expect(twice.match(/Id="C5500002"/g)).toHaveLength(2);
    expect(twice).toContain("void Other() {}");
    expect(twice).not.toContain("Cutscenes");
  });
});

describe("withCustomScriptInMapScript", () => {
  const generated = writeMapScript({ mapName: "Street", triggers: { variables: [], triggers: [] } });

  it("compiles the script in before map initialization and calls its init there", () => {
    const script = withCustomScriptInMapScript(generated, "C5500002", "void Play_Init() {\n}", "Play_Init");
    expect(script.indexOf("void Play_Init() {")).toBeLessThan(script.indexOf("void InitMap () {"));
    expect(script).toContain("void InitMap () {\r\n    InitLibs();\r\n    Play_Init(); // C5500002\r\n");
  });

  it("replaces its own earlier copy", () => {
    const once = withCustomScriptInMapScript(generated, "C5500002", "void Old_Init() {\n}", "Old_Init");
    const twice = withCustomScriptInMapScript(once, "C5500002", "void Play_Init() {\n}", "Play_Init");
    expect(twice).not.toContain("Old_Init");
    expect(twice.match(/Play_Init\(\); \/\/ C5500002/g)).toHaveLength(1);
  });
});
