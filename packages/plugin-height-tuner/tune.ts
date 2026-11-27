// The tuner's command: one texture's height-map test map, its Shots and its report.
//
//   node <plugin>/dist/tune.js <Mission blueprint.json> <texture> [--base <texture>] [--variants <list>] [--pitch <degrees>] [--install <StarCraft II folder>]
//
// It writes missions/<id>/output/height-tuner/<texture>/: HeightTune<texture>.SC2Map, shots.json
// (two close Shots a strip, its low half then its high half, for capture_shots), tune.json (what each strip is) and blueprint.json (the
// generated Blueprint the map is compiled from). Stock files come from the install through the
// CASC extractor SC2_CASC_TOOL names; the install is the machine config's sc2Path unless --install.
import path from "node:path";
import { parseArgs } from "node:util";

import { hostContext, loadMachineConfig } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { buildTestMap, DEFAULT_BASE, reviewSet } from "./build.ts";
import { DEFAULT_VARIANTS, parseVariants } from "./variants.ts";

const USAGE = `Usage: node dist/tune.js <Mission blueprint.json> <texture> [--base <texture>] [--variants <list>] [--pitch <degrees>] [--install <StarCraft II folder>]
  --base      the texture under the strips (default ${DEFAULT_BASE})
  --variants  comma-separated, each <kind>[:<% at 0>][*<scale>][+<offset>], kinds stock, crush, inverted-crush, flat, relevel
              (default ${DEFAULT_VARIANTS}); stock is always the first strip, and a map holds 7`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string" }, variants: { type: "string" }, pitch: { type: "string" }, install: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help || positionals.length !== 2) {
    console.log(USAGE);
    if (!values.help) process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const [blueprint, texture] = positionals as [string, string];
  const variants = parseVariants(values.variants ?? DEFAULT_VARIANTS);
  const install = values.install ? path.resolve(cwd, values.install) : hostContext(await loadMachineConfig()).requirePath("sc2Path");
  const pitch = values.pitch !== undefined ? Number(values.pitch) : undefined;
  if (pitch !== undefined && !(pitch > 0 && pitch <= 90)) throw new Error(`--pitch is degrees down from level, up to 90, not ${values.pitch}`);
  const report = await buildTestMap({
    blueprintPath: path.resolve(cwd, blueprint),
    texture,
    ...(values.base ? { base: values.base } : {}),
    variants,
    install,
    ...(pitch !== undefined ? { pitch } : {}),
    log: (line) => console.log(line),
  });
  console.log(`\n${report.texture} over ${report.base}, on ${report.tileset}. Its red channel: ${report.red.kind} (mean ${Math.round(report.red.mean)}, sd ${Math.round(report.red.sd)}); heights from its ${report.heightSource}${report.integratedAgreement !== undefined ? ` (the integrated height agrees at ${report.integratedAgreement})` : ""}.`);
  for (const [index, strip] of report.strips.entries()) {
    console.log(`  ${index + 1}. ${strip.label}: ${strip.textureId}, mean height ${strip.heightMean}, ${Math.round(strip.zeroShare * 100)}% at 0${strip.heightMapScale ? `, scale ${strip.heightMapScale}` : ""}`);
  }
  console.log(`\nMap: ${report.mapPath}\nShots: ${report.shotsPath} (Still Review set ${reviewSet(report.texture)})`);
  for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
