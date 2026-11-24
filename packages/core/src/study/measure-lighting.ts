import { xmlElement, xmlElements } from "../map/xml-elements.js";
import type { LoadedMapPackage } from "./load-map-package.js";

function value(body: string, tag: string): string | undefined {
  return xmlElement(body, tag)?.attrs.value;
}

/** Each GameSetLighting call in MapScript.galaxy with the function that makes it. */
export function lightingCalls(script: string) {
  const calls: { light: string; blendSeconds: number | string; inFunction: string }[] = [];
  let fn = "";
  for (const line of script.split("\n")) {
    const header = /^(?:bool|void|int|trigger|fixed|string)\s+(\w+)\s*\(/.exec(line);
    if (header) fn = header[1]!;
    const call = /GameSetLighting\(([^,]+),\s*([^)]+)\)/.exec(line);
    if (call) {
      const light = call[1]!.trim().replace(/^"|"$/g, "");
      const blend = Number(call[2]);
      calls.push({ light, blendSeconds: Number.isFinite(blend) ? blend : call[2]!.trim(), inFunction: fn });
    }
  }
  return calls;
}

function directional(body: string, index: string) {
  const el = xmlElements(body, "DirectionalLight").find((d) => d.attrs.index === index);
  if (!el) return undefined;
  return {
    color: el.attrs.Color ?? value(el.body, "Color"),
    multiplier: Number(el.attrs.ColorMultiplier ?? value(el.body, "ColorMultiplier") ?? NaN),
    direction: el.attrs.Direction ?? value(el.body, "Direction"),
  };
}

export function measureLighting(map: LoadedMapPackage) {
  const localTerrains = xmlElements(map.terrainData, "CTerrain").map(({ attrs, body }) => ({
    id: attrs.id,
    ...(attrs.parent ? { parent: attrs.parent } : {}),
    lighting: value(body, "Lighting"),
    blendTextures: xmlElements(body, "BlendTextures").map((t) => t.attrs.value),
    cliffSets: xmlElements(body, "CliffSets").map((t) => t.attrs.value),
    skybox: value(body, "FixedSkyboxModel"),
    fog: {
      enabled: value(body, "FogEnabled"),
      color: value(body, "FogColor"),
      density: value(body, "FogDensity"),
      falloff: value(body, "FogFalloff"),
    },
  }));

  const localLights = xmlElements(map.lightData, "CLight").map(({ attrs, body }) => {
    const tod = xmlElements(body, "ToDInfoArray")[0]?.body ?? body;
    const param = (index: string) => xmlElements(tod, "Param").find((p) => p.attrs.index === index)?.attrs.value;
    return {
      id: attrs.id,
      ...(attrs.parent ? { parent: attrs.parent } : {}),
      ambientColor: value(tod, "AmbientColor"),
      colorize: value(tod, "Colorize"),
      hdrExposure: param("HDRExposure"),
      colorization: {
        hue: param("ColorizationHue"),
        saturation: param("ColorizationSaturation"),
        brightness: param("ColorizationBrightness"),
        blend: param("ColorizationBlend"),
      },
      key: directional(tod, "Key"),
      fill: directional(tod, "Fill"),
      back: directional(tod, "Back"),
    };
  });

  const calls = lightingCalls(map.mapScript);
  return {
    note: "Lighting is switched by triggers per area or story beat; 'calls' lists every GameSetLighting and the function making it.",
    lightsUsed: [...new Set(calls.map((c) => c.light))],
    calls,
    localLights,
    localTerrains,
    fogType: map.mapInfo.fogType,
    waterBodies: map.waterBodies,
  };
}
