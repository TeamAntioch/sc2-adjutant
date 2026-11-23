// The public thumbnail renderer's ModelRenderer, drawn by the machine's Host Adapter's
// model.render. Thumbnails are rendered on the author's machine and never committed; the Host
// Adapter owns the renderer and its quirks, and the public renderThumbnails decides which model
// files to try and keeps the manifest.

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { montageSheet } from "@team-antioch/sc2-asset-catalog/catalog/catalog-sheets.js";
import { THUMBNAIL_ANGLES } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { type ModelRenderer, THUMBNAIL_SIZE } from "@team-antioch/sc2-asset-catalog/catalog/render-thumbnails.js";
import { requireCapability, type Host } from "../host/host.js";
import { isModelNotFound } from "../plugins/plugin-api.js";

export type HostModelRendererOptions = {
  /** Mod package folders in load order (campaignModPackages), read before the game: see model.render. */
  readonly packages?: readonly string[];
  /** What needs the renderer, for the error when the Host Adapter can't render. */
  readonly purpose?: string;
};

/**
 * A ModelRenderer backed by the Host Adapter's model.render. Its key names the Host Adapter, its
 * own renderer key (model.rendererKey: its build and recipe) and the packages, so a rebuilt
 * renderer, a changed recipe or other packages draw everything again. It names the packages'
 * folders, not where each model was found in them: a model file a package gains or loses leaves
 * its render current, so a caller rendering with packages passes `force` (as index-mod-doodads does).
 */
export function hostModelRenderer(host: Host, options: HostModelRendererOptions = {}): ModelRenderer {
  requireCapability(host, "model.render", options.purpose ?? "Rendering thumbnails");
  const packages = options.packages ?? [];
  return {
    render: (request) => host.run("model.render", { ...request, ...(packages.length > 0 ? { packages } : {}) }),
    key: async () => {
      const renderer = host.has("model.rendererKey") ? await host.run("model.rendererKey", { outputs: THUMBNAIL_ANGLES, size: THUMBNAIL_SIZE }) : "";
      return [`${host.adapter?.source}@${host.adapter?.version}`, renderer, ...packages].join("\n");
    },
    isNotFound: isModelNotFound,
  };
}

/** The public montageSheet into a folder made if need be, saying how to get ImageMagick when its montage isn't on the PATH. */
export async function buildSheet(renders: readonly string[], sheet: string): Promise<void> {
  await mkdir(path.dirname(sheet), { recursive: true });
  try {
    await montageSheet(renders, sheet);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Building a catalog sheet needs ImageMagick's montage on the PATH (brew install imagemagick)", { cause: error });
    throw error;
  }
}
