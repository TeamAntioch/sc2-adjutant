// Asset Catalog thumbnails (#112, #826): the public renderThumbnails picks the model files and keeps
// the manifest; the Host Adapter's model.render draws them. Run through the `studio` fixture Host Adapter.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { renderThumbnails as renderWith } from "@team-antioch/sc2-asset-catalog/catalog/render-thumbnails.js";
import type { ThumbnailJob } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";

import { buildSheet, hostModelRenderer } from "../../src/catalog/host-model-renderer.js";
import type { Host } from "../../src/host/host.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A machine whose Host Adapter is the studio fixture, with these game models installed. */
async function studioMachine(models: readonly string[], contents: Record<string, string> = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-thumbs-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  for (const model of models) {
    await mkdir(path.dirname(path.join(cacheDir, "game", model)), { recursive: true });
    await writeFile(path.join(cacheDir, "game", model), contents[model] ?? "m3");
  }
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: studio, cacheDir }));
  const host = await loadHost(await loadMachineConfig({ file, env: {} }));
  const log = async () => (await readFile(path.join(cacheDir, "host.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { host, out: path.join(folder, "thumbnails"), log };
}

const renderThumbnails = (host: Host, jobs: readonly ThumbnailJob[], out: string, options: { force?: boolean } = {}) => renderWith(hostModelRenderer(host), jobs, out, options);

const ROCK = { type: "RockArch", model: "Assets/Doodads/RockArch/RockArch.m3", variation: 0, variations: 1 };

describe("renderThumbnails with the Host Adapter's renderer", () => {
  it("renders four turntable angles per model and skips unchanged ones next time", async () => {
    const { host, out, log } = await studioMachine([ROCK.model]);
    expect(await renderThumbnails(host, [ROCK], out)).toEqual({ rendered: 1, failed: 0, unchanged: 0 });
    expect(await log()).toEqual(["render Assets/Doodads/RockArch/RockArch.m3 4x512"]);
    expect((await readdir(out)).sort()).toEqual(["RockArch_00_a0.png", "RockArch_00_a1.png", "RockArch_00_a2.png", "RockArch_00_a3.png", "manifest.json"]);
    expect(await readFile(path.join(out, "RockArch_00_a2.png"), "utf8")).toBe("Assets/Doodads/RockArch/RockArch.m3 angle 2\n");
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.RockArch_00).toMatchObject({ ok: true, model: ROCK.model });

    expect(await renderThumbnails(host, [ROCK], out)).toEqual({ rendered: 0, failed: 0, unchanged: 1 });
    expect(await renderThumbnails(host, [ROCK], out, { force: true })).toEqual({ rendered: 1, failed: 0, unchanged: 0 });
    expect(await log()).toHaveLength(2);
  });

  it("tries the numbered model file when the plain one doesn't exist", async () => {
    const { host, out, log } = await studioMachine(["Assets/Doodads/RockArch/RockArch_00.m3"]);
    expect(await renderThumbnails(host, [ROCK], out)).toMatchObject({ rendered: 1 });
    expect(await log()).toEqual(["render Assets/Doodads/RockArch/RockArch.m3 4x512", "render Assets/Doodads/RockArch/RockArch_00.m3 4x512"]);
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.RockArch_00.model).toBe("Assets/Doodads/RockArch/RockArch_00.m3");
  });

  it("records a failure with the Host Adapter's reason and drops thumbnails a run left before", async () => {
    const { host, out } = await studioMachine([]);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "RockArch_00_a0.png"), "old");
    expect(await renderThumbnails(host, [ROCK], out)).toEqual({ rendered: 0, failed: 1, unchanged: 0 });
    expect(await readdir(out)).toEqual(["manifest.json"]);
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.RockArch_00).toMatchObject({ ok: false, error: "model not found: Assets/Doodads/RockArch/RockArch_00.m3" });
    // A failure is tried again on the next run.
    expect(await renderThumbnails(host, [ROCK], out)).toMatchObject({ failed: 1, unchanged: 0 });
  });

  it("moves on to the other file when one exists but doesn't draw, as the thumbnails CLI always did", async () => {
    const numbered = "Assets/Doodads/RockArch/RockArch_00.m3";
    const { host, out, log } = await studioMachine([ROCK.model, numbered], { [ROCK.model]: "garbled" });
    expect(await renderThumbnails(host, [ROCK], out)).toMatchObject({ rendered: 1, failed: 0 });
    expect(await log()).toEqual([`render ${ROCK.model} 4x512`, `render ${numbered} 4x512`]);
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.RockArch_00).toMatchObject({ ok: true, model: numbered });
  });

  it("records why a model that exists didn't draw over a later file the game lacks", async () => {
    const { host, out } = await studioMachine([ROCK.model], { [ROCK.model]: "garbled" });
    expect(await renderThumbnails(host, [ROCK], out)).toMatchObject({ failed: 1 });
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.RockArch_00).toMatchObject({ ok: false, model: ROCK.model, error: `garbled frames of ${ROCK.model}` });
  });

  it("needs a Host Adapter that can render models", async () => {
    expect(() => hostModelRenderer(bareHost())).toThrow(
      "Rendering thumbnails needs the model.render capability, and the machine's Host Adapter (none) doesn't have it",
    );
  });
});

describe("buildSheet", () => {
  it("says how to get ImageMagick when montage isn't on the PATH", async () => {
    const path_ = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(buildSheet(["a.png"], "sheet.jpg")).rejects.toThrow("Building a catalog sheet needs ImageMagick's montage on the PATH (brew install imagemagick)");
    } finally {
      if (path_ === undefined) delete process.env.PATH;
      else process.env.PATH = path_;
    }
  });
});
