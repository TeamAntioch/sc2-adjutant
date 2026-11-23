// A trigger scene's world changes (cinematography CHECKS.md L2, L3; ADR 0012): its Light, its fog
// and the black mask with the fog of war, each changed under black in Setup and put back in the one
// Cleanup, under black before the handback, so a skip and the natural end leave the same world.

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { isKnownLight } from "../catalog/light-catalog.js";
import { missionLight } from "../catalog/tileset-lights.js";
import { fogColor, missionFog, type MissionFog } from "../catalog/tileset-sky.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import type { TriggerScene } from "../domain/trigger-scene.js";
import { boundPlugins } from "../plugins/plugin-api.js";
import { block, call, callValue, triggerVariable } from "./trigger-builders.js";
import { type FunctionDef, NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "./trigger-catalog.js";
import type { TriggerCall, TriggerParam, TriggerVariable } from "./trigger-model.js";

type Fog = NonNullable<TriggerScene["fog"]>;
type FogKnob = keyof Fog & Exclude<keyof MissionFog, "enabled">;
/** Each fog knob a scene can change: its Fog action, that action's parameter, and its name in a problem. */
const FOG_KNOBS: Readonly<Record<FogKnob, { readonly set: FunctionDef; readonly param: string; readonly word: string }>> = {
  color: { set: F.fogSetColor, param: "color", word: "colour" },
  density: { set: F.fogSetDensity, param: "density", word: "density" },
  falloff: { set: F.fogSetFallOff, param: "falloff", word: "falloff" },
  startingHeight: { set: F.fogSetStartHeight, param: "startHeight", word: "start height" },
};
const knobs = (fog: Fog): FogKnob[] => (Object.keys(FOG_KNOBS) as FogKnob[]).filter((knob) => fog[knob] !== undefined);

/** What a trigger scene's world changes add: its variables, Setup's calls and Cleanup's. */
export type TriggerSceneWorld = {
  readonly variables: readonly TriggerVariable[];
  /** Made under black, before the first cut. */
  readonly setup: (at: (step: string) => string) => TriggerCall[];
  /** Made under black, before the handback. */
  readonly cleanup: (at: (step: string) => string) => TriggerCall[];
};

/**
 * What's wrong with a trigger scene's world changes: a fog knob it changes whose mission value
 * neither the Blueprint's `sky.fog` nor a tileset sets, so the cleanup can't set it back; and a
 * Light that is neither the Mission's, a Plugin's, stock nor the Campaign Mod's (a warning: a
 * dependency may define it, but a typo plays as the default light).
 */
export function triggerSceneWorldProblems(triggerScene: TriggerScene, blueprint: MissionBlueprint): { readonly path: string; readonly message: string; readonly severity?: "warning" }[] {
  const { fog, light } = triggerScene;
  const catalog = blueprintCatalog(blueprint);
  const mission = fog ? missionFog(catalog, blueprint) : {};
  const tilesets = [...new Set([blueprint.sky?.fog?.from, blueprint.tilesetId ?? "KorhalCityEx2"].filter((id) => id !== undefined))].join(" or ");
  const unknownLight = light !== undefined && !blueprint.lights.some((own) => own.id === light) && !boundPlugins(blueprint).light(light) && !isKnownLight(catalog, light);
  return [
    ...(fog ? knobs(fog) : [])
      .filter((knob) => mission[knob] === undefined)
      .map((knob) => ({
        path: `fog.${knob}`,
        message: `The scene changes the fog's ${FOG_KNOBS[knob].word}, but the mission's isn't known (neither the Blueprint's sky.fog nor tileset ${tilesets} sets it), so the cleanup can't set it back; give the Blueprint's sky.fog.${knob}`,
      })),
    ...(unknownLight
      ? [{ path: "light", message: `Light ${light} is neither in the Mission's lights, a Plugin's Lights, data/light-catalog.json nor the Campaign Mod; check a dependency defines it`, severity: "warning" as const }]
      : []),
  ];
}

/** The world changes of the trigger scene at `path` (trigger-scenes/<id>), whose variables are named `trigger_scene_<name>_...`. */
export function triggerSceneWorld(triggerScene: TriggerScene, blueprint: MissionBlueprint, path: string, name: string): TriggerSceneWorld {
  const { light, fog, mask } = triggerScene;
  const catalog = blueprintCatalog(blueprint);
  const mission = fog ? missionFog(catalog, blueprint) : {};
  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const of = (held: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: held });
  const setLight = (where: string, id: string): TriggerCall => call(where, F.setLighting, { blendTime: { kind: "fixed", value: 0 }, light: { kind: "gamelink", gameType: "Light", value: id } });
  const ifTrue = (where: string, held: TriggerVariable, then: TriggerCall[]): TriggerCall =>
    block(where, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [call(`${where}/if`, F.comparison, { left: of(held), operator: preset(P.compareEqual), right: { kind: "bool", value: true } })] },
      { type: SUB_FUNCTIONS.then, calls: then },
    ]);

  // Each knob the scene changes: the scene's value in Setup, the mission's in Cleanup.
  const fogCalls = (at: (step: string) => string, step: "setup" | "cleanup"): TriggerCall[] =>
    (fog ? knobs(fog) : []).map((knob) => {
      const value = step === "setup" ? fog![knob]! : mission[knob];
      if (value === undefined) throw new Error(triggerSceneWorldProblems(triggerScene, blueprint).map((problem) => problem.message).join("; "));
      const param: TriggerParam["value"] = typeof value === "number" ? { kind: "fixed", value } : { kind: "color", value: typeof value === "string" ? value : fogColor(value) };
      return call(at(`${step}/fog/${knob}`), FOG_KNOBS[knob].set, { [FOG_KNOBS[knob].param]: param });
    });
  // A mission with its fog off would hide the scene's: on for the scene, off again after.
  const fogOff = fog !== undefined && mission.enabled === false;
  const fogEnabled = (where: string, on: boolean): TriggerCall => call(where, F.fogSetEnabled, { enable: { kind: "bool", value: on } });

  // The mask and the fog of war, each put back only if it was on when the scene started.
  const types = [
    { key: "mask", type: P.visTypeMask },
    { key: "fog_of_war", type: P.visTypeFog },
  ] as const;
  const wasOn = mask === "off" ? types.map(({ key }) => triggerVariable(`${path}/variables/${key}_was_on`, `trigger_scene_${name}_${key}_was_on`, "bool", { kind: "bool", value: false })) : [];
  const visEnable = (where: string, type: (typeof types)[number]["type"], on: boolean): TriggerCall => call(where, F.visEnable, { type: preset(type), enable: preset(on ? P.enable : P.disable) });

  return {
    variables: wasOn,
    setup: (at) => [
      ...(light !== undefined ? [setLight(at("setup/light"), light)] : []),
      ...(fogOff ? [fogEnabled(at("setup/fog/enabled"), true)] : []),
      ...fogCalls(at, "setup"),
      ...wasOn.flatMap((held, index) => [
        call(at(`setup/${types[index]!.key}/save`), F.setVariable, { variable: of(held), value: callValue(at(`setup/${types[index]!.key}/save/value`), F.visIsEnabled, { type: preset(types[index]!.type) }) }),
        visEnable(at(`setup/${types[index]!.key}/off`), types[index]!.type, false),
      ]),
    ],
    cleanup: (at) => [
      ...(light !== undefined ? [setLight(at("cleanup/light"), missionLight(catalog, blueprint))] : []),
      ...fogCalls(at, "cleanup"),
      ...(fogOff ? [fogEnabled(at("cleanup/fog/enabled"), false)] : []),
      ...wasOn.map((held, index) => ifTrue(at(`cleanup/${types[index]!.key}`), held, [visEnable(at(`cleanup/${types[index]!.key}/on`), types[index]!.type, true)])),
    ],
  };
}
