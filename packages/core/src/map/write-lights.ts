// A mission's own lights (DL-09): each a full copy of a stock light, retuned by a few knobs, written
// to the map's LightData.xml. A full copy means the light doesn't depend on inheriting from a
// light the map may not load, and the exemplars' overrides mostly change only 1-3 fields anyway.

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { getStockLight, isKnownLight } from "../catalog/light-catalog.js";
import type { MissionBlueprint, MissionLight } from "../domain/mission-blueprint.js";
import { blueprintPlugins, boundPlugins } from "../plugins/plugin-api.js";

/** The map's lighting regions as fields over the Light that holds them (light-regions.ts lightRegionOverride). */
export type LightRegionOverride = { readonly light: string; readonly fields: Readonly<Record<string, string>> };

/** Elements whose next path segment is an index (`<Param index="HDRExposure" .../>`). */
const INDEXED = new Set(["ToDInfoArray", "Param", "DirectionalLight", "TimeEventArray", "LightRegions", "DiffuseColor", "DiffuseMultiplier"]);

export const formatColor = (rgb: readonly number[]): string => rgb.map((c) => c.toFixed(6)).join(",");
export const parseColor = (value: string | undefined): number[] => (value ?? "0,0,0").split(",").map(Number);

/** The knobs a Light, or a lighting region, turns on the fields it copies. */
export type LightKnobs = Pick<MissionLight, "ambient" | "key" | "fill" | "back" | "exposure">;

/** `fields`, a Light's flattened, with `knobs` turned on its first time of day. */
export function applyLightKnobs(source: Readonly<Record<string, string>>, knobs: LightKnobs): Record<string, string> {
  const fields = { ...source };
  const tod = "ToDInfoArray/0/";
  if (knobs.ambient?.color) fields[`${tod}AmbientColor`] = formatColor(knobs.ambient.color);
  if (knobs.ambient?.scale !== undefined) fields[`${tod}AmbientColor`] = formatColor(parseColor(fields[`${tod}AmbientColor`]).map((c) => c * knobs.ambient!.scale!));
  for (const [part, light] of [["Key", knobs.key], ["Fill", knobs.fill], ["Back", knobs.back]] as const) {
    if (!light) continue;
    const at = `${tod}DirectionalLight/${part}/`;
    if (light.color) fields[`${at}Color`] = formatColor(light.color);
    if (light.scale !== undefined) fields[`${at}ColorMultiplier`] = (Number(fields[`${at}ColorMultiplier`] ?? 1) * light.scale).toFixed(6);
    if (light.direction) {
      const [x, y, z] = light.direction;
      const length = Math.hypot(x, y, z);
      fields[`${at}Direction`] = formatColor([x / length, y / length, z / length]);
    }
  }
  if (knobs.exposure !== undefined) fields[`${tod}Param/HDRExposure`] = knobs.exposure.toFixed(6);
  return fields;
}

/** The light's fields: the stock light it copies, with the knobs applied. */
export function missionLightFields(light: MissionLight): Record<string, string> {
  const stock = getStockLight(light.from);
  if (!stock) throw new Error(`Light ${light.id}: no stock light ${light.from} (see data/light-catalog.json)`);
  return applyLightKnobs(stock.fields, light);
}

type Node = { value?: string; children: Map<string, Node> };

/** One CLight from flattened fields, every field as a child element (`<X value="v"/>`). */
export function lightXml(id: string, fields: Readonly<Record<string, string>>): string {
  const root: Node = { children: new Map() };
  for (const [key, value] of Object.entries(fields)) {
    const segments = key.split("/");
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      // An indexed element and its index make one step: "Param" + "HDRExposure".
      const step = INDEXED.has(segments[i]!) && i + 1 < segments.length ? `${segments[i]}\u0000${segments[++i]}` : segments[i]!;
      if (!node.children.has(step)) node.children.set(step, { children: new Map() });
      node = node.children.get(step)!;
    }
    node.value = value;
  }
  const lines: string[] = [];
  const write = (node: Node, indent: string): void => {
    for (const [step, child] of node.children) {
      const [tag, index] = step.split("\u0000");
      const indexAttr = index !== undefined ? ` index="${index}"` : "";
      const valueAttr = child.value !== undefined ? ` value="${child.value}"` : "";
      if (child.children.size === 0) {
        lines.push(`${indent}<${tag}${indexAttr}${valueAttr}/>`);
      } else {
        lines.push(`${indent}<${tag}${indexAttr}${valueAttr}>`);
        write(child, `${indent}    `);
        lines.push(`${indent}</${tag}>`);
      }
    }
  };
  write(root, "        ");
  return [`    <CLight id="${id}">`, ...lines, "    </CLight>"].join("\r\n");
}

/** The Light ids a Mission's Blueprint names, each with where: its `lighting` and its transitions'. */
function blueprintLightNames(blueprint: MissionBlueprint): [string, string][] {
  return [
    ...(blueprint.lighting ? [["lighting", blueprint.lighting] as [string, string]] : []),
    ...blueprint.transitions.flatMap((transition): [string, string][] =>
      transition.light
        ? [
            [`transition ${transition.id}`, transition.light.to],
            ...(transition.light.back?.to ? [[`transition ${transition.id}`, transition.light.back.to] as [string, string]] : []),
          ]
        : [],
    ),
  ];
}

/**
 * Notes for light ids the mission uses that are neither its own, a Plugin's, stock nor the
 * Campaign Mod's: another dependency may define them, but a typo shows as the default light.
 */
export function unknownLightWarnings(blueprint: MissionBlueprint): string[] {
  const own = new Set(blueprint.lights.map((light) => light.id));
  const plugins = boundPlugins(blueprint);
  const catalog = blueprintCatalog(blueprint);
  return blueprintLightNames(blueprint)
    .filter(([, id]) => !own.has(id) && !plugins.light(id) && !isKnownLight(catalog, id))
    .map(([where, id]) => `Light ${id} (${where}) is neither in lights, a Plugin's Lights, data/light-catalog.json nor the Campaign Mod; check a dependency defines it.`);
}

/**
 * The Lights a Mission's map holds: its own `lights`, then each Plugin Light it names, in its
 * Blueprint or in its Cinematics (`cinematicLights`, the ids they switch to), once each. A Plugin's
 * Light it doesn't name stays out of the map.
 */
export function mapLights(blueprint: MissionBlueprint, cinematicLights: readonly string[] = []): MissionLight[] {
  const own = new Set(blueprint.lights.map((light) => light.id));
  const plugins = blueprintPlugins(blueprint);
  const named = [...new Set([...blueprintLightNames(blueprint).map(([, id]) => id), ...cinematicLights])];
  const fromPlugins = named.flatMap((id) => {
    const contributed = own.has(id) ? undefined : plugins.light(id);
    return contributed ? [contributed.light] : [];
  });
  return [...blueprint.lights, ...fromPlugins];
}

/**
 * The fields a Light's CLight is written with: its own, with the map's lighting regions over them
 * when it is the Light that holds them (light-regions.ts).
 */
function writtenFields(light: MissionLight, regions: LightRegionOverride | undefined): Record<string, string> {
  const fields = missionLightFields(light);
  return regions?.light === light.id ? { ...fields, ...regions.fields } : fields;
}

/** The map's lighting regions, as the CLight a map-local override of the Light that isn't among `lights` (a stock one merges with it, as 3-10's AiurCity does). */
function regionOnlyXml(lights: readonly MissionLight[], regions: LightRegionOverride | undefined): string | undefined {
  return regions && !lights.some((light) => light.id === regions.light) ? lightXml(regions.light, regions.fields) : undefined;
}

/** LightData.xml for the mission's lights and its lighting regions, or undefined when it has neither. */
export function lightDataXml(lights: readonly MissionLight[], regions?: LightRegionOverride): string | undefined {
  const body = [...lights.map((light) => lightXml(light.id, writtenFields(light, regions))), ...[regionOnlyXml(lights, regions)].filter((xml) => xml !== undefined)];
  if (body.length === 0) return undefined;
  return ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...body, "</Catalog>", ""].join("\r\n");
}

/**
 * A map's LightData.xml (`existing`, undefined when it has none) holding each of `lights` as it is
 * now: one the map has is written over, so a retuned Light shows, and one it lacks is added at its
 * end. The map's other CLights are kept as they are. The one holding the map's lighting `regions` keeps them.
 */
export function withLights(existing: string | undefined, lights: readonly MissionLight[], regions?: LightRegionOverride): string | undefined {
  if (existing === undefined) return lightDataXml(lights, regions);
  let updated = existing;
  for (const light of lights) {
    const xml = lightXml(light.id, writtenFields(light, regions));
    const written = new RegExp(`[ \\t]*<CLight id="${light.id}"[ >][^]*?</CLight>`);
    if (written.test(updated)) {
      updated = updated.replace(written, () => xml);
      continue;
    }
    const end = updated.lastIndexOf("</Catalog>");
    if (end < 0) throw new Error("The map's LightData.xml has no </Catalog>");
    updated = `${updated.slice(0, end)}${xml}\r\n${updated.slice(end)}`;
  }
  return updated;
}
