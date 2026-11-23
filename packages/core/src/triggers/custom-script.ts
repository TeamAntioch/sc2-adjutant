// A Galaxy script in a map's Triggers file, as the Editor's Custom Script element: the Editor
// compiles it into MapScript.galaxy and calls its init function at map initialization. This is how
// a map reaches natives the trigger catalog doesn't list, such as the cutscene natives.

const EMPTY = '<?xml version="1.0" encoding="utf-8"?>\n<TriggerData>\n    <Root>\n    </Root>\n</TriggerData>\n';

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * `triggers` (a Triggers file, or none for a new one) with the custom script `id` set to `script`,
 * replacing an earlier copy of it. The Editor strips 12 columns of indentation from ScriptCode, so
 * every line carries 12 more.
 */
export function withCustomScript(triggers: string | undefined, id: string, script: string, initFunc: string): string {
  const element = [
    `    <Element Type="CustomScript" Id="${id}">`,
    "        <ScriptCode>",
    script
      .split("\n")
      .map((line) => escape(`            ${line}`))
      .join("\n"),
    "        </ScriptCode>",
    `        <InitFunc>${initFunc}</InitFunc>`,
    "    </Element>",
  ].join("\n");
  const item = `        <Item Type="CustomScript" Id="${id}"/>`;
  const base = (triggers ?? EMPTY)
    .replace(new RegExp(`\\n?[ \\t]*<Element Type="CustomScript" Id="${id}">[\\s\\S]*?</Element>`), "")
    .replace(new RegExp(`\\n?[ \\t]*<Item Type="CustomScript" Id="${id}"/>`), "");
  return base.replace("    </Root>", `${item}\n    </Root>`).replace("</TriggerData>", `${element}\n</TriggerData>`);
}

/**
 * `mapScript` (a generated MapScript.galaxy) with the same custom script compiled in: its code
 * before the map initialization and its init function called there, replacing an earlier copy.
 * Test Document runs the map's MapScript.galaxy as it is; only saving in the Editor rebuilds it
 * from Triggers, and a map without one fails to load its script.
 */
export function withCustomScriptInMapScript(mapScript: string, id: string, script: string, initFunc: string): string {
  const eol = mapScript.includes("\r\n") ? "\r\n" : "\n";
  const begin = `// Custom Script ${id}`;
  const end = `// End Custom Script ${id}`;
  const call = `    ${initFunc}(); // ${id}`;
  const base = withoutCustomScriptInMapScript(mapScript, id);
  const block = [begin, ...script.split("\n"), end, "", ""].join(eol);
  const initialization = base.search(/\/\/-+\r?\n\/\/ Map Initialization/);
  if (initialization < 0) throw new Error("MapScript.galaxy has no Map Initialization section");
  const withCode = base.slice(0, initialization) + block + base.slice(initialization);
  const libs = /void InitMap \(\) \{\r?\n    InitLibs\(\);\r?\n/.exec(withCode);
  if (!libs) throw new Error("MapScript.galaxy's InitMap doesn't start with InitLibs()");
  const at = libs.index + libs[0].length;
  return withCode.slice(0, at) + call + eol + withCode.slice(at);
}

/** `mapScript` with the custom script `id` that withCustomScriptInMapScript compiled in taken out: its code and its init call. */
export function withoutCustomScriptInMapScript(mapScript: string, id: string): string {
  const eol = mapScript.includes("\r\n") ? "\r\n" : "\n";
  return mapScript
    .replace(new RegExp(`// Custom Script ${id}[\\s\\S]*?// End Custom Script ${id}${eol}${eol}`), "")
    .replace(new RegExp(`    \\w+\\(\\); // ${id}${eol}`), "");
}
