// More pictures of one drawn cinematic set, for whoever is describing it (see capture/set-views.ts,
// shootSet). The set must have been drawn by render-set-views first.
//
//   npm run set-shots -- <set id> [--list] [--compass <height>[@x,y]] [--orbit <bearing>,<pitch>]...
//     [--plan] [--shot <name>=<ex>,<ey>,<ez>:<tx>,<ty>,<tz>[:<fov>]]... [--cut [z]] [--floor <z>]
//     [--only <regex>] [--without <regex>] [--blender <program>] [--views <dir>]
//
// --list measures the set and draws nothing: its models, bounds, floor height and cameras, of the
// pieces --only and --without leave. --compass looks north, east, south and west from a standing
// point this high over the floor. The floor is a guess from where the walkable surface lies; the
// result's "levels" lists the candidates, and --floor sets it. --orbit looks in from
// outside (bearing 0 is north, 90 east). --cut takes the roof off for --orbit and --plan: at the z
// that follows, else just under the ceiling over the floor (the result's "ceiling"; "ceilings"
// lists the candidates), else at the set's own height. The result's "cutZ" is where it cut.
// --only and --without choose pieces by model name.
// The pictures go in <views>/<set id>/shots; their paths are printed, and under "pictures" each with
// how it was drawn ("from"), which a set look records for a picture it chooses.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type SetShot, shootSet } from "../capture/set-views.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const id = args[0];
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const options = (name: string): string[] => args.flatMap((arg, at) => (arg === `--${name}` ? [args[at + 1] ?? ""] : []));
  if (!id || id.startsWith("--")) {
    console.error("Usage: set-shots <set id> [--list] [--compass <height>[@x,y]] [--orbit <bearing>,<pitch>]... [--plan] [--shot <name>=<eye>:<target>[:<fov>]]... [--cut [z]] [--floor <z>] [--only <regex>] [--without <regex>] [--blender <program>] [--views <dir>]");
    process.exitCode = 2;
    return;
  }
  const views = option("views") ?? path.join(hostContext(await loadMachineConfig()).requirePath("cacheDir"), "set-views");
  const setDir = path.join(views, id);
  if (!existsSync(path.join(setDir, "spec.json"))) throw new Error(`No drawn set at ${setDir}: draw it with render-set-views first`);
  const only = option("only");
  const without = option("without");
  const chosen = { ...(only ? { only: new RegExp(only, "i") } : {}), ...(without ? { without: new RegExp(without, "i") } : {}) };
  const blender = option("blender") ?? "blender";
  if (args.includes("--list")) {
    const spec = JSON.parse(await readFile(path.join(setDir, "spec.json"), "utf8")) as { cameras: { name: string; eye: number[]; target: number[]; fov: number }[] };
    const { files: _files, pictures: _pictures, ...measured } = await shootSet({ setDir, blender, shots: [], ...chosen });
    console.log(JSON.stringify({ ...measured, cameras: spec.cameras }, null, 1));
    return;
  }
  const numbers = (text: string): number[] => text.split(",").map(Number);
  const cutAt = args.indexOf("--cut");
  const cut = cutAt >= 0;
  const cutZ = cut && args[cutAt + 1] !== undefined && Number.isFinite(Number(args[cutAt + 1])) ? Number(args[cutAt + 1]) : undefined;
  const shots: SetShot[] = [];
  for (const compass of options("compass")) {
    const [height, at] = compass.split("@");
    shots.push({ name: `compass-${height}${at ? `-at-${at.replace(",", "-")}` : ""}`, compass: Number(height), ...(at ? { at: numbers(at) as [number, number] } : {}) });
  }
  for (const orbit of options("orbit")) shots.push({ name: `orbit-${orbit.replace(",", "-")}${cut ? "-cut" : ""}`, orbit: numbers(orbit) as [number, number], cut });
  if (args.includes("--plan")) shots.push({ name: cut ? "plan-cut" : "plan-roof", plan: true, cut });
  for (const shot of options("shot")) {
    const [name, rest = ""] = shot.split("=");
    const [eye = "", target = "", fov] = rest.split(":");
    shots.push({ name: name!, eye: numbers(eye) as [number, number, number], target: numbers(target) as [number, number, number], ...(fov ? { fov: Number(fov) } : {}) });
  }
  if (shots.length === 0) throw new Error("No shot asked for: give --compass, --orbit, --plan or --shot");
  const floor = option("floor");
  const drawn = await shootSet({ setDir, blender, shots, ...chosen, ...(cutZ !== undefined ? { cutZ } : {}), ...(floor !== undefined ? { floor: Number(floor) } : {}) });
  console.log(JSON.stringify(drawn, null, 1));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
