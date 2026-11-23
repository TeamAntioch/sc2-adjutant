// A test Host Adapter for the bulk jobs: it renders and exports models and captures camera tours,
// recording each request in host.log in the machine's cache folder. Its "game install" is the
// cache's game/ folder: a model exists when a file sits at its storage path there. A tour captures
// the stops listed one per line in the cache's tour-stops.txt (1 and 2 when there is none). A model file
// holding "garbled" exists but doesn't draw. A render's `packages` are read before the game, as
// findPackageFile reads them.
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { findPackageFile } from "../../../../src/catalog/package-files.js";
import { modelNotFound, type PluginCode } from "../../../../src/plugins/plugin-api.js";

const plugin: PluginCode = {
  capabilities: {
    "model.render": async ({ model, outputPaths, size, packages = [] }, context) => {
      const cache = context.requirePath("cacheDir");
      await mkdir(cache, { recursive: true });
      await appendFile(path.join(cache, "host.log"), `render ${model} ${outputPaths.length}x${size}${packages.length > 0 ? ` from ${packages.length} packages` : ""}\n`);
      const file = findPackageFile(packages, model)?.file ?? path.join(cache, "game", model);
      const source = await readFile(file, "utf8").catch(() => undefined);
      // A file holding "unopenable" is there but reported missing, as WhiteoutFlakes reports a model it fails to spawn.
      if (source === undefined || source === "unopenable") throw modelNotFound(model);
      if (source === "garbled") throw new Error(`garbled frames of ${model}`);
      for (const [angle, outputPath] of outputPaths.entries()) await writeFile(outputPath, `${model} angle ${angle}\n`);
    },
    "model.export": async ({ model, outputPath }, context) => {
      const cache = context.requirePath("cacheDir");
      await appendFile(path.join(cache, "host.log"), `export ${model}\n`);
      await copyFile(path.join(cache, "game", model), outputPath);
    },
    "editor.captureTour": async (request, context) => {
      const cache = context.requirePath("cacheDir");
      if (!request.attach && !request.mapPath.startsWith(path.join(cache, "capture", "maps") + path.sep)) throw new Error(`not a capture map: ${request.mapPath}`);
      const { log: _, signal: __, writeMap, ...logged } = request;
      await mkdir(cache, { recursive: true });
      await appendFile(path.join(cache, "host.log"), `tour ${JSON.stringify(logged)}\n`);
      // Like a real one, it writes the map only once no stale copy is open.
      if (!request.attach) await writeMap?.();
      const listed = await readFile(path.join(cache, "tour-stops.txt"), "utf8").catch(() => "1\n2\n");
      const stops = listed.split("\n").filter(Boolean).map(Number);
      await mkdir(request.outputDir, { recursive: true });
      for (const stop of stops) {
        await writeFile(path.join(request.outputDir, `${String(stop).padStart(request.frameDigits, "0")}.jpg`), `frame ${stop}\n`);
        if (request.recordKeys) await appendFile(path.join(request.outputDir, "stops.txt"), `${stop} ${request.recordKeys.map(() => "1.5").join(" ")}\n`);
        request.log?.(`stop ${stop}`);
      }
      return { frames: stops.length, end: "done" };
    },
  },
};
export default plugin;
