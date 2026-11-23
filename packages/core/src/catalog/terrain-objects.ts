import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built by scripts/build-terrain-object-catalog.mjs from Blizzard's TerrainObjectData.xml.
const CATALOG_PATH = path.resolve(__dirname, "../../data/terrain-object-catalog.json");

/** A stock terrain object (CCliffDoodad): a model plus the cliff levels it stamps under itself. */
export type TerrainObject = {
  readonly name?: string;
  readonly package: string;
  readonly model: string;
  readonly tileset: string;
  /** Stamp size in vertices, both odd: the stamp is centred on the object's vertex. */
  readonly size: { readonly across: number; readonly down: number };
  /** The cliff levels its stamp uses. */
  readonly levels: readonly number[];
  /** One row per vertex row, north first; A-D set cliff level 0-3, a space leaves the vertex alone. */
  readonly heightCodes: readonly string[];
};

let catalog: Record<string, TerrainObject> | null = null;
const load = (): Record<string, TerrainObject> =>
  (catalog ??= JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Record<string, TerrainObject>);

/** A stock terrain object, or undefined for an unknown id. */
export function getTerrainObject(id: string): TerrainObject | undefined {
  return load()[id];
}
