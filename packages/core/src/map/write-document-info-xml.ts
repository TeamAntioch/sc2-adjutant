export type WriteDocumentInfoOptions = {
  readonly dependencies?: readonly string[];
};

/** The Void mod, the one dependency of every ladder map. */
export const VOID_MOD = "bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod";
/** Dependencies for a map that names none: the Void mod. */
export const DEFAULT_DEPENDENCIES: readonly string[] = [VOID_MOD];

export function writeDocumentInfoXml(options: WriteDocumentInfoOptions = {}): string {
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<DocInfo>",
    "    <ModType>",
    "        <Value>Interface</Value>",
    "    </ModType>",
    "    <Dependencies>",
  ];

  for (const dependency of dependencies) {
    lines.push(`        <Value>${dependency.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Value>`);
  }

  lines.push("    </Dependencies>", "</DocInfo>");
  return lines.join("\n") + "\n";
}
