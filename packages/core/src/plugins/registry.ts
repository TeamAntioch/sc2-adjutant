// The Plugin registry (ADR-0005): loads the Plugins a Workspace config names, validates their
// manifests and indexes their Contributions by kind. No other module imports a Plugin directly.

import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { getStockLight } from "../catalog/light-catalog.js";
import { type Composite, CompositeSchema, MissionLightSchema } from "../domain/mission-blueprint.js";
import { gameTriggerLibraries, reachableFunction } from "../mods/library-galaxy.js";
import { CORE_PRIMITIVES, type FunctionDef, type PresetDef, primitiveKey, samePrimitive, type SubFunctionDef } from "../triggers/trigger-catalog.js";
import { staysInside } from "../util/inside.js";
import { packageBuild } from "./built-package.js";
import hazardManifest from "./hazard/sc2-adjutant-plugin.json" with { type: "json" };
import {
  type ContributionKind,
  type ContributionKinds,
  CORE_CUTSCENE_SOURCES,
  type CutsceneSourceKind,
  EXEMPLAR_PROVENANCES,
  type ExemplarMap,
  HOST_CAPABILITIES,
  type HostCapabilities,
  type HostCapabilityName,
  type KnowledgeDocument,
  type LoadedPlugin,
  type Mechanic,
  type NamingTemplate,
  PLUGIN_API_VERSION,
  PLUGIN_ROLES,
  type PluginCode,
  type PluginLight,
  runHook,
  type PluginPrompt,
  type PluginRegistry,
  type PluginSkill,
  type ScreenplaySource,
  type StyleRule,
  type StyleRuleSlot,
  type StyleRuleSlots,
} from "./plugin-api.js";
import { BUNDLED_PACKAGES, bundledPackageFolder, isLocalPluginSource, localPluginFolder, MANIFEST_FILE, type PluginRequest, unloadableSource } from "./plugin-sources.js";
import { addSkills, pluginSkills, SkillsSchema } from "./plugin-skills.js";

export { isLocalPluginSource, localPluginFolder, MANIFEST_FILE, MissingPluginPackageError, type PluginRequest } from "./plugin-sources.js";

/** Why a Plugin's characters are refused. */
const CHARACTERS_MOVED = "A Plugin no longer contributes characters: declare them in the characters of the Campaign Mod's Mod Blueprint (mods/<id>/blueprint.json, ADR-0011)";

const KnowledgeEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "A knowledge id is lowercase letters, digits, dots, hyphens or underscores"),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    /** Relative to the Plugin's folder. */
    file: z.string().min(1),
  })
  .strict();

const PromptEntrySchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "A prompt name is lowercase letters, digits, hyphens or underscores"),
    title: z.string().min(1).optional(),
    description: z.string().min(1),
    arguments: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "An argument name is letters, digits and underscores"),
            description: z.string().min(1).optional(),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    /** The prompt's text, relative to the Plugin's folder, with `{{argument}}` for each argument. */
    file: z.string().min(1),
  })
  .strict();

const ManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9@][a-z0-9@/._-]*$/, "A Plugin name is lowercase, like an npm package name"),
    version: z.string().min(1),
    /** The plugin API version the Plugin was built for. */
    pluginApi: z.number().int().positive(),
    roles: z.array(z.enum(PLUGIN_ROLES)).default([]),
    contributions: z
      .object({
        mechanics: z.array(z.string().min(1)).default([]),
        /** The naming template's name; a Plugin contributes at most one. */
        naming: z.array(z.string().min(1)).max(1).default([]),
        /** Refused: a Campaign's characters are declared in its Campaign Mod's Blueprint (ADR-0011). */
        characters: z.unknown().refine(() => false, CHARACTERS_MOVED).optional(),
        /** The Screenplay Source's name; a Plugin contributes at most one. */
        screenplaySource: z.array(z.string().min(1)).max(1).default([]),
        /** Knowledge documents: Markdown, JSON or text files in the Plugin's folder. */
        knowledge: z.array(KnowledgeEntrySchema).default([]),
        /** A JSON file listing the Exemplar Maps; each one's Map Study is `<id>/study.json` beside it. */
        exemplarMaps: z.string().min(1).optional(),
        /** A JSON file holding a shared library of Doodad Composite recipes. */
        composites: z.string().min(1).optional(),
        /** MCP prompts for the Plugin's own workflows. */
        prompts: z.array(PromptEntrySchema).default([]),
        /** Design Lessons as code (rule ids), for a Style Pack: its code contributes them. */
        styleRules: z.array(z.string().min(1)).default([]),
        /** Host Adapter capabilities; only a Plugin named as the machine's Host Adapter may contribute them. */
        capabilities: z.array(z.enum(HOST_CAPABILITIES)).default([]),
        /** Kinds of Cutscene Editor source the cinematic set catalog reads (ids); its code contributes them. */
        cutsceneSources: z.array(z.string().min(1)).default([]),
        /** A JSON file of Lights, `{ "lights": [...] }`, each a retuned copy of a stock Light (PluginLight). */
        lights: z.string().min(1).optional(),
        /** The name of the Campaign's Campaign Mod, its package name without `.SC2Mod` (ADR-0011); only a Campaign Pack names one. */
        campaignMod: z
          .string()
          .regex(/^[^\\/:*?"<>|]+$/, "A Campaign Mod name is a package name, without a folder or .SC2Mod")
          .refine((name) => !/\.sc2mod$/i.test(name), "A Campaign Mod name is without .SC2Mod")
          .optional(),
        /** Skill folders, each holding a SKILL.md, relative to the Plugin's folder (ADR-0023); open to every role. */
        skills: SkillsSchema,
      })
      .strict()
      .default({ mechanics: [], naming: [], screenplaySource: [], knowledge: [], prompts: [], styleRules: [], capabilities: [], cutsceneSources: [], skills: [] }),
    /** The code entry point, relative to the manifest; needed by any Plugin loaded from a folder that contributes code. Plugins built into core have none. */
    entry: z.string().min(1).optional(),
  })
  .strict();
type Manifest = z.infer<typeof ManifestSchema>;

const ExemplarListSchema = z.object({
  exemplars: z.array(
    z.looseObject({
      id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "An Exemplar Map id is letters, digits, dots, hyphens or underscores"),
      /** The source map, inside the Workspace's Exemplar Map folder (or absolute). */
      map: z.string().min(1),
      provenance: z.enum(EXEMPLAR_PROVENANCES),
      note: z.string().optional(),
    }),
  ),
});

const CompositeLibrarySchema = z.object({ composites: z.array(CompositeSchema) });

const LightLibrarySchema = z.object({ lights: z.array(MissionLightSchema) }).strict();

/** How each kind of knowledge file is served. */
const MIME_TYPES: Readonly<Record<string, string>> = { ".md": "text/markdown", ".json": "application/json", ".txt": "text/plain" };

/** Plugins that ship inside core, named `bundled:<name>` in a Workspace config. */
const BUNDLED: Readonly<Record<string, { readonly manifest: unknown; load(): Promise<{ default: PluginCode }> }>> = {
  hazard: { manifest: hazardManifest, load: () => import("./hazard/index.js") },
};

/** A Mechanic, as far as the registry can check one a Plugin's code exports. */
const hook = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function", "Expected a function");
const primitive = z.looseObject({ library: z.string().min(1), id: z.string().min(1) });
/** A Mechanic's own trigger primitives, as far as the registry can check them before a compile uses them. */
const PrimitivesSchema = z
  .object({
    functions: z
      .record(
        z.string(),
        primitive.extend({
          kind: z.enum(["event", "condition", "action", "function"]),
          params: z.record(z.string(), z.looseObject({ id: z.string().min(1) })),
          galaxy: hook.optional(),
        }),
      )
      .optional(),
    presets: z.record(z.string(), primitive.extend({ galaxy: z.string(), form: z.enum(["value", "element"]) })).optional(),
    subFunctions: z.record(z.string(), primitive).optional(),
  })
  .strict();
const MechanicCodeSchema = z.object({
  type: z.string().min(1),
  primitives: PrimitivesSchema.optional(),
  requires: z.array(z.string().min(1)).optional(),
  paramsSchema: z.custom<z.ZodType>((value) => value instanceof Object && typeof (value as { safeParse?: unknown }).safeParse === "function", "Expected a zod schema"),
  single: z.boolean().optional(),
  cues: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "A cue name is letters, digits, _ and -")).optional(),
  validate: hook.optional(),
  warnings: hook.optional(),
  buildTriggers: hook,
  buildGameData: hook.optional(),
  threats: hook.optional(),
});
/** Strict, so a misspelled hook is refused rather than left to core's default. */
const NamingCodeSchema = z
  .object({
    name: z.string().min(1),
    conversationId: hook.optional(),
    lineId: hook.optional(),
    soundId: hook.optional(),
    soundLine: hook.optional(),
    characterId: hook.optional(),
  })
  .strict();
const ScreenplaySourceCodeSchema = z
  .object({
    name: z.string().min(1),
    fetch: hook,
    edit: hook.optional(),
    refForConversation: hook.optional(),
  })
  .strict();
const ScaleRange = z.tuple([z.number().positive(), z.number().positive()]).refine(([min, max]) => min <= max, "A scale range is [min, max], with min no more than max");
/** A noise threshold: the value noise runs from 0 to 1. */
const threshold = z.number().min(0).max(1);
/** Each slot a style rule can fill, as far as the registry can check it. */
const STYLE_RULE_SLOTS = {
  yaw: hook,
  pileScale: z.object({ large: ScaleRange, small: ScaleRange, ground: ScaleRange, accent: ScaleRange }).strict(),
  lipScale: ScaleRange,
  cliffPile: hook,
  shorePile: hook,
  lipClumps: z.object({ period: z.number().positive(), edge: z.number().positive().max(1), reachPeriod: z.number().positive() }).strict(),
  breakWear: z.object({ capsPerEnd: z.number().int().nonnegative(), capScale: ScaleRange, maxDebris: z.number().int().positive(), debrisScale: ScaleRange }).strict(),
  compositeWarnings: hook,
  varietyPatches: z.object({ period: z.number().positive(), threshold, touchThreshold: threshold }).strict(),
  blendGroup: hook,
  cliffTextureWarnings: hook,
} satisfies Record<StyleRuleSlot, z.ZodType>;

/** What each hook slot must return, checked on every call, so a rule's mistake names the rule. */
const PieceResult = z.looseObject({ role: z.enum(["large", "small", "ground", "accent"]), member: z.unknown().refine((member) => member !== undefined, "Expected a pile member"), index: z.number().int().nonnegative() });
const STYLE_RULE_RESULTS: { readonly [Slot in StyleRuleSlot]?: z.ZodType } = {
  yaw: z.number().finite(),
  cliffPile: z.looseObject({
    snug: z.boolean(),
    pieces: z.array(PieceResult.extend({ along: z.number().finite().nonnegative(), outward: z.looseObject({ base: z.number().finite(), reach: z.number().finite().nonnegative() }) })),
  }),
  shorePile: z.looseObject({ pieces: z.array(PieceResult.extend({ reach: z.number().finite().nonnegative() })) }),
  compositeWarnings: z.array(z.string()),
  blendGroup: z.string(),
  cliffTextureWarnings: z.array(z.string()),
};
const StyleRuleCodeSchema = z
  .object({
    id: z.string().min(1),
    lesson: z.string().min(1).optional(),
    ...Object.fromEntries(Object.entries(STYLE_RULE_SLOTS).map(([slot, schema]) => [slot, schema.optional()])),
  })
  .strict();
const PluginCodeSchema = z.object({
  mechanics: z.array(MechanicCodeSchema).optional(),
  naming: NamingCodeSchema.optional(),
  characters: z.unknown().refine(() => false, CHARACTERS_MOVED).optional(),
  screenplaySource: ScreenplaySourceCodeSchema.optional(),
  styleRules: z.array(StyleRuleCodeSchema).optional(),
  capabilities: z.partialRecord(z.enum(HOST_CAPABILITIES), hook).optional(),
  cutsceneSources: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().min(1), markName: hook.optional() }).strict()).optional(),
});

/** Checks the shape of what a Plugin's code entry point exports. */
function checkCode(code: unknown, label: string): PluginCode {
  const parsed = PluginCodeSchema.safeParse(code);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(default export)"}: ${issue.message}`);
    throw new Error(`${label}: its code's default export isn't a Plugin: ${issues.join("; ")}`);
  }
  return code as PluginCode;
}

/** Loads each Plugin in order, relative to the Workspace root, and indexes its Contributions. */
export async function loadPlugins(root: string, requests: readonly PluginRequest[]): Promise<PluginRegistry> {
  const plugins: LoadedPlugin[] = [];
  const mechanics = new Map<string, { readonly mechanic: Mechanic; readonly plugin: string }>();
  // Every primitive a loaded Mechanic contributes, by primitiveKey, with who contributed it.
  const primitives = new Map<string, { readonly def: FunctionDef | PresetDef | SubFunctionDef; readonly by: string }>();
  let naming: NamingTemplate | undefined;
  let screenplaySource: ScreenplaySource | undefined;
  let campaignMod: string | undefined;
  const knowledge: KnowledgeDocument[] = [];
  const exemplarMaps: ExemplarMap[] = [];
  const composites = new Map<string, { readonly composite: Composite; readonly plugin: string }>();
  const prompts = new Map<string, PluginPrompt>();
  const styleRules: StyleRule[] = [];
  let style: StyleRuleSlots = {};
  const capabilities = new Map<HostCapabilityName, unknown>();
  const cutsceneSources = new Map<string, { readonly kind: CutsceneSourceKind; readonly plugin: string }>();
  const lights = new Map<string, { readonly light: PluginLight; readonly plugin: string }>();
  const skills = new Map<string, PluginSkill>();
  for (const request of requests) {
    const loaded = await loadPlugin(root, request.source);
    const { manifest, folder } = loaded;
    const label = `Plugin ${manifest.name} (${request.source})`;
    if (plugins.some((plugin) => plugin.name === manifest.name)) throw new Error(`${label} is named twice in the Workspace config`);
    for (const role of request.roles ?? []) {
      if (!manifest.roles.includes(role)) {
        const slot = role === "utility" ? "a Utility (in utilities)" : `the ${role}`;
        throw new Error(`${label} is named as ${slot} but its manifest doesn't declare that role`);
      }
    }
    const code = loaded.code === undefined ? undefined : checkCode(loaded.code, label);

    const contributed = code?.mechanics ?? [];
    const declared = manifest.contributions;
    checkDeclared(label, "Mechanics", declared.mechanics, contributed.map((mechanic) => mechanic.type));
    checkDeclared(label, "naming templates", declared.naming, code?.naming ? [code.naming.name] : []);
    checkDeclared(label, "Screenplay Sources", declared.screenplaySource, code?.screenplaySource ? [code.screenplaySource.name] : []);
    const campaignOnly = declared.naming.length + declared.screenplaySource.length > 0 || declared.campaignMod !== undefined;
    if (campaignOnly && !request.roles?.includes("campaign-pack")) {
      throw new Error(
        `${label} contributes a naming template, a Screenplay Source or a Campaign Mod name, which only the Workspace's Campaign Pack can: name it as the campaignPack`,
      );
    }
    campaignMod = declared.campaignMod ?? campaignMod;
    naming = code?.naming ?? naming;
    screenplaySource = code?.screenplaySource ?? screenplaySource;
    for (const mechanic of contributed) {
      const clash = mechanics.get(mechanic.type);
      if (clash) throw new Error(`${label} contributes the Mechanic type ${mechanic.type}, which Plugin ${clash.plugin} already contributes`);
      mechanics.set(mechanic.type, { mechanic, plugin: manifest.name });
      checkPrimitiveClashes(primitives, mechanic, `${label}'s Mechanic ${mechanic.type}`);
      checkPrimitiveGalaxy(mechanic, `${label}'s Mechanic ${mechanic.type}`);
    }

    const rules = code?.styleRules ?? [];
    const declaredRules = manifest.contributions.styleRules;
    checkDeclared(label, "style rules", declaredRules, rules.map((rule) => rule.id));
    if (rules.length > 0 && !manifest.roles.includes("style-pack")) throw new Error(`${label} contributes style rules, but its manifest doesn't declare the style-pack role`);
    // Only the Workspace's Style Pack shapes dressing and texturing, and only its rules are listed.
    if (request.roles?.includes("style-pack")) {
      styleRules.push(...rules);
      style = ruleSlots(rules, label);
    }

    const data = await loadData(manifest, folder, label);
    for (const composite of data.composites) {
      const clash = composites.get(composite.id);
      if (clash) throw new Error(`${label} contributes the Doodad Composite ${composite.id}, which Plugin ${clash.plugin} already contributes`);
      composites.set(composite.id, { composite, plugin: manifest.name });
    }
    for (const prompt of data.prompts) {
      const clash = prompts.get(prompt.name);
      if (clash) throw new Error(`${label} contributes the prompt ${prompt.name}, which Plugin ${clash.plugin} already contributes`);
      prompts.set(prompt.name, prompt);
    }
    for (const light of data.lights) {
      const clash = lights.get(light.id);
      if (clash) throw new Error(`${label} contributes the Light ${light.id}, which Plugin ${clash.plugin} already contributes`);
      lights.set(light.id, { light, plugin: manifest.name });
    }
    addSkills(skills, data.skills, label);
    knowledge.push(...data.knowledge);
    exemplarMaps.push(...data.exemplarMaps);

    const contributedCapabilities = Object.keys(code?.capabilities ?? {}) as HostCapabilityName[];
    checkDeclared(label, "capabilities", declared.capabilities, contributedCapabilities);
    if (declared.capabilities.length > 0 && !request.roles?.includes("host-adapter")) {
      throw new Error(`${label} contributes Host Adapter capabilities, so it can only be named as the machine's Host Adapter (hostAdapter in the machine config)`);
    }
    for (const name of contributedCapabilities) capabilities.set(name, code!.capabilities![name]);

    const sourceKinds = code?.cutsceneSources ?? [];
    checkDeclared(label, "cutscene sources", declared.cutsceneSources, sourceKinds.map((kind) => kind.id));
    for (const kind of sourceKinds) {
      if (CORE_CUTSCENE_SOURCES.some((core) => core.id === kind.id)) throw new Error(`${label} contributes the cutscene source ${kind.id}, which core already provides`);
      const clash = cutsceneSources.get(kind.id);
      if (clash) throw new Error(`${label} contributes the cutscene source ${kind.id}, which Plugin ${clash.plugin} already contributes`);
      cutsceneSources.set(kind.id, { kind, plugin: manifest.name });
    }

    plugins.push({
      name: manifest.name,
      version: manifest.version,
      source: request.source,
      ...(folder ? { folder } : {}),
      roles: manifest.roles,
      contributions: {
        mechanics: declared.mechanics,
        naming: declared.naming,
        screenplaySource: declared.screenplaySource,
        knowledge: data.knowledge.map((document) => document.id),
        exemplarMaps: data.exemplarMaps.map((exemplar) => exemplar.id),
        composites: data.composites.map((composite) => composite.id),
        prompts: data.prompts.map((prompt) => prompt.name),
        styleRules: declaredRules,
        capabilities: declared.capabilities,
        cutsceneSources: declared.cutsceneSources,
        lights: data.lights.map((light) => light.id),
        skills: data.skills.map((skill) => skill.name),
      },
    });
  }

  const byKind: { readonly [Kind in ContributionKind]: readonly ContributionKinds[Kind][] } = {
    mechanics: [...mechanics.values()].map((entry) => entry.mechanic),
    naming: naming ? [naming] : [],
    screenplaySource: screenplaySource ? [screenplaySource] : [],
    knowledge,
    exemplarMaps,
    composites: [...composites.values()].map((entry) => entry.composite),
    prompts: [...prompts.values()],
    styleRules,
    capabilities: [...capabilities.keys()],
    cutsceneSources: [...cutsceneSources.values()].map((entry) => entry.kind),
    lights: [...lights.values()].map((entry) => entry.light),
    skills: [...skills.values()],
  };
  return {
    plugins,
    contributions: (kind) => byKind[kind],
    mechanic: (type) => mechanics.get(type)?.mechanic,
    mechanicPlugin: (type) => mechanics.get(type)?.plugin,
    naming: () => naming,
    screenplaySource: () => screenplaySource,
    campaignMod: () => campaignMod,
    composite: (id) => composites.get(id)?.composite,
    light: (id) => lights.get(id),
    styleRules: () => style,
    capability: <Name extends HostCapabilityName>(name: Name) => capabilities.get(name) as HostCapabilities[Name] | undefined,
  };
}

/** Refuses a Plugin whose code contributes other ids of a kind than its manifest declares. */
function checkDeclared(label: string, kind: string, declared: readonly string[], contributed: readonly string[]): void {
  const sameSet =
    new Set(contributed).size === contributed.length &&
    new Set(declared).size === declared.length &&
    contributed.length === declared.length &&
    declared.every((id) => contributed.includes(id));
  if (!sameSet) throw new Error(`${label} declares the ${kind} [${declared.join(", ")}] but its code contributes [${contributed.join(", ")}]`);
}

/**
 * The slots a Style Pack's rules fill; two rules can't fill one slot. A hook is called on its rule
 * (so `this` is the rule), and an error it throws or a result of the wrong shape names the rule,
 * its Plugin and the slot.
 */
function ruleSlots(rules: readonly StyleRule[], label: string): StyleRuleSlots {
  const slots: Record<string, unknown> = {};
  const filledBy = new Map<string, string>();
  for (const rule of rules) {
    for (const slot of Object.keys(STYLE_RULE_SLOTS) as StyleRuleSlot[]) {
      const value = rule[slot];
      if (value === undefined) continue;
      const clash = filledBy.get(slot);
      if (clash) throw new Error(`${label}: its style rules ${clash} and ${rule.id} both fill the ${slot} slot`);
      filledBy.set(slot, rule.id);
      slots[slot] = typeof value === "function" ? checkedHook(rule, slot, value as (...args: unknown[]) => unknown, label) : value;
    }
  }
  return slots as StyleRuleSlots;
}

function checkedHook(rule: StyleRule, slot: StyleRuleSlot, hook: (...args: unknown[]) => unknown, label: string): (...args: unknown[]) => unknown {
  const name = `${label}: style rule ${rule.id}`;
  const result = STYLE_RULE_RESULTS[slot];
  return (...args) => {
    const value = runHook(name, `${slot} slot`, () => hook.apply(rule, args));
    if (!result) return value;
    const parsed = result.safeParse(value);
    if (!parsed.success) {
      throw new Error(`${name}: its ${slot} slot returned ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(result)"}: ${issue.message}`).join("; ")}`);
    }
    return value;
  };
}

type PluginData = {
  readonly knowledge: readonly KnowledgeDocument[];
  readonly exemplarMaps: readonly ExemplarMap[];
  readonly composites: readonly Composite[];
  readonly prompts: readonly PluginPrompt[];
  readonly lights: readonly PluginLight[];
  readonly skills: readonly PluginSkill[];
};

/**
 * A Plugin's data Contributions, from the files its manifest names. Its Exemplar Maps' list,
 * each studied map's Map Study and its Doodad Composites are served as knowledge documents too,
 * after the ones it declares. Document and prompt files are checked here and read when asked for.
 */
async function loadData(manifest: Manifest, folder: string | undefined, label: string): Promise<PluginData> {
  const { contributions } = manifest;
  const hasFiles = contributions.knowledge.length > 0 || contributions.prompts.length > 0 || contributions.exemplarMaps || contributions.composites || contributions.lights || contributions.skills.length > 0;
  if (!hasFiles) return { knowledge: [], exemplarMaps: [], composites: [], prompts: [], lights: [], skills: [] };
  if (!folder) throw new Error(`${label}: a bundled Plugin can't contribute files`);
  const file = (relative: string, where: string) => pluginFile(folder, relative, `${label}: contributions.${where}`);

  const knowledge: KnowledgeDocument[] = contributions.knowledge.map((entry, index) => {
    const where = `knowledge.${index}.file`;
    const absolute = file(entry.file, where);
    const mimeType = MIME_TYPES[path.extname(absolute).toLowerCase()];
    if (!mimeType) throw new Error(`${label}: contributions.${where} ${entry.file} must be a Markdown (.md), JSON (.json) or text (.txt) file`);
    return { plugin: manifest.name, id: entry.id, title: entry.title, ...(entry.description ? { description: entry.description } : {}), mimeType, file: absolute };
  });
  const derived = (id: string, title: string, description: string, absolute: string): KnowledgeDocument => ({
    plugin: manifest.name,
    id,
    title,
    description,
    mimeType: "application/json",
    file: absolute,
  });

  const exemplarMaps: ExemplarMap[] = [];
  if (contributions.exemplarMaps) {
    const listFile = file(contributions.exemplarMaps, "exemplarMaps");
    const { exemplars } = await readJson(listFile, ExemplarListSchema, `${label}: its Exemplar Maps ${contributions.exemplarMaps}`);
    knowledge.push(
      derived(
        "exemplar-maps",
        "Exemplar Maps",
        "The Exemplar Maps this Plugin's Design Lessons are drawn from, each with its provenance (made, edited or approved: evidence from a map its author made weighs most).",
        listFile,
      ),
    );
    for (const { id, map, provenance, note, ...settings } of exemplars) {
      if (exemplarMaps.some((exemplar) => exemplar.id === id)) throw new Error(`${label}: its Exemplar Maps list ${id} twice`);
      const studyDir = path.join(path.dirname(listFile), id);
      exemplarMaps.push({ plugin: manifest.name, id, provenance, map, ...(note ? { note } : {}), studyDir, settings });
      const study = path.join(studyDir, "study.json");
      if (existsSync(study)) {
        // Checked as the files the manifest names are, so a linked study can't serve a file from outside the Plugin.
        const served = file(path.relative(folder, study).split(path.sep).join("/"), `exemplarMaps (${id}/study.json)`);
        knowledge.push(
          derived(`study-${id}`, `Map Study: ${id}`, `The Map Study of Exemplar Map ${id} (${provenance}): measurements of its texturing, cliffs, doodads, lighting and composition.`, served),
        );
      }
    }
  }

  let composites: Composite[] = [];
  if (contributions.composites) {
    const libraryFile = file(contributions.composites, "composites");
    composites = (await readJson(libraryFile, CompositeLibrarySchema, `${label}: its Doodad Composites ${contributions.composites}`)).composites;
    const ids = composites.map((composite) => composite.id);
    const twice = ids.find((id, index) => ids.indexOf(id) !== index);
    if (twice) throw new Error(`${label}: its Doodad Composites hold ${twice} twice`);
    knowledge.push(
      derived("composites", "Doodad Composites", "This Plugin's shared library of Doodad Composite recipes: shapes no single asset provides, built from manipulated stock doodads.", libraryFile),
    );
  }

  let lights: PluginLight[] = [];
  if (contributions.lights) {
    lights = (await readJson(file(contributions.lights, "lights"), LightLibrarySchema, `${label}: its Lights ${contributions.lights}`)).lights;
    const lightIds = lights.map((light) => light.id);
    const twiceLight = lightIds.find((id, index) => lightIds.indexOf(id) !== index);
    if (twiceLight) throw new Error(`${label}: its Lights hold ${twiceLight} twice`);
    for (const light of lights) {
      if (getStockLight(light.id)) throw new Error(`${label}: its Light ${light.id} has a stock Light's id, which it would replace in every map`);
      if (!getStockLight(light.from)) throw new Error(`${label}: its Light ${light.id} copies ${light.from}, which isn't a stock Light (data/light-catalog.json)`);
    }
  }

  const ids = knowledge.map((document) => document.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice) throw new Error(`${label}: two of its knowledge documents have the id ${twice}`);

  const prompts: PluginPrompt[] = contributions.prompts.map((entry, index) => ({
    plugin: manifest.name,
    name: entry.name,
    ...(entry.title ? { title: entry.title } : {}),
    description: entry.description,
    arguments: entry.arguments.map(({ name, description, required }) => ({ name, required, ...(description ? { description } : {}) })),
    file: file(entry.file, `prompts.${index}.file`),
  }));
  return { knowledge, exemplarMaps, composites, prompts, lights, skills: pluginSkills(manifest.name, folder, contributions.skills, label) };
}

/**
 * A file a manifest names, resolved inside the Plugin's folder; refused if it lies outside it,
 * doesn't exist or isn't a file (a folder). Compared by real paths too, so a symlink in the Plugin
 * can't serve a file from elsewhere.
 */
function pluginFile(folder: string, relative: string, where: string): string {
  const outside = (from: string, to: string) => !staysInside(path.relative(from, to));
  const absolute = path.resolve(folder, relative);
  if (outside(folder, absolute)) throw new Error(`${where} ${relative} must be a file inside the Plugin's folder`);
  if (!existsSync(absolute)) throw new Error(`${where} ${relative} doesn't exist (${absolute})`);
  if (!statSync(absolute).isFile()) throw new Error(`${where} ${relative} must be a file, not a folder (${absolute})`);
  if (outside(realpathSync(folder), realpathSync(absolute))) throw new Error(`${where} ${relative} must be a file inside the Plugin's folder`);
  return absolute;
}

async function readJson<T>(file: string, schema: z.ZodType<T>, what: string): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${what} can't be read: ${(error as Error).message}`, { cause: error });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${what} is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

async function loadPlugin(root: string, source: string): Promise<{ manifest: Manifest; code: unknown; folder?: string }> {
  if (source.startsWith("bundled:")) {
    const name = source.slice("bundled:".length);
    const packageName = Object.hasOwn(BUNDLED_PACKAGES, name) ? BUNDLED_PACKAGES[name] : undefined;
    if (packageName) {
      return loadFolderPlugin(bundledPackageFolder(source, packageName), source, name);
    }
    const bundled = Object.hasOwn(BUNDLED, name) ? BUNDLED[name] : undefined;
    const known = [...Object.keys(BUNDLED), ...Object.keys(BUNDLED_PACKAGES)];
    if (!bundled) throw new Error(`No bundled Plugin ${source}; core bundles ${known.map((each) => `bundled:${each}`).join(", ")}`);
    const manifest = parseManifest(bundled.manifest, source);
    if (`bundled:${manifest.name}` !== source) throw new Error(`Bundled Plugin ${source}'s manifest is named ${manifest.name}`);
    if (manifest.entry) throw new Error(`Bundled Plugin ${source}'s manifest names an entry; core imports a built-in Plugin's code itself`);
    return { manifest, code: (await bundled.load()).default };
  }
  if (!isLocalPluginSource(source)) {
    throw new Error(unloadableSource(source));
  }

  return loadFolderPlugin(localPluginFolder(root, source), source);
}

/**
 * A Plugin from its folder: its manifest, and its code if the manifest names an entry. With
 * `expectedName` (a bundled Plugin package), a manifest by another name is refused before any of
 * its code is imported.
 */
async function loadFolderPlugin(folder: string, source: string, expectedName?: string): Promise<{ manifest: Manifest; code: unknown; folder: string }> {
  const manifestPath = path.join(folder, MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Plugin ${source}: can't read its manifest ${manifestPath}: ${(error as Error).message}`);
  }
  const manifest = parseManifest(raw, `${source} (${manifestPath})`);
  if (expectedName !== undefined && manifest.name !== expectedName) throw new Error(`Bundled Plugin ${source}'s manifest is named ${manifest.name}`);
  if (!manifest.entry) return { manifest, code: undefined, folder };
  const entry = path.resolve(folder, manifest.entry);
  const build = packageBuild(folder, entry);
  if (!build.built) throw new Error(`Plugin ${manifest.name} (${source}): ${build.reason}`);
  const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  if (!module.default) throw new Error(`Plugin ${manifest.name} (${source}): its entry point ${manifest.entry} has no default export`);
  return { manifest, code: module.default, folder };
}

/** The version is checked first, since a manifest for another API version may not fit this one's schema. */
const VersionSchema = z.object({ name: z.string().optional(), pluginApi: z.number() });

function parseManifest(raw: unknown, where: string): Manifest {
  const version = VersionSchema.safeParse(raw);
  if (version.success && version.data.pluginApi !== PLUGIN_API_VERSION) {
    throw new Error(
      `Plugin ${version.data.name ? `${version.data.name} (${where})` : where} is built for plugin API version ${version.data.pluginApi}, but this sc2-adjutant provides version ${PLUGIN_API_VERSION}`,
    );
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(manifest)"}: ${issue.message}`);
    throw new Error(`Plugin ${where} has an invalid manifest: ${issues.join("; ")}`);
  }
  return parsed.data;
}

/**
 * Refuses a Mechanic's trigger function whose Galaxy nothing could write as it means (ADR-0025): a
 * block with a `galaxy` of its own, which writes a call from its arguments and would drop the calls
 * its block holds; one with no `galaxy` that the game's library data doesn't define, or whose
 * parameter ids aren't the data's, which its template writes from.
 */
function checkPrimitiveGalaxy(mechanic: Mechanic, by: string): void {
  const libraries = gameTriggerLibraries();
  for (const def of Object.values(mechanic.primitives?.functions ?? {})) {
    const key = primitiveKey(def);
    if (def.galaxy) {
      if (def.block) throw new Error(`${by} contributes the trigger function ${key} as a block with a galaxy of its own, which can't write the calls its block holds: leave out the galaxy, so its template writes it`);
      continue;
    }
    const fn = reachableFunction({ libraries }, key);
    if (!fn) throw new Error(`${by} contributes the trigger function ${key} with no galaxy of its own, and the game's library data doesn't define it: give it a galaxy`);
    const ids = Object.values(def.params).map((param) => param.id);
    if (ids.length !== fn.params.length || new Set(ids).size !== ids.length || !ids.every((id) => fn.params.includes(id))) {
      const list = (of: readonly string[]): string => of.join(", ") || "none";
      throw new Error(`${by} contributes the trigger function ${key} with no galaxy of its own, whose parameter ids (${list(ids)}) aren't those the game's library data gives it (${list(fn.params)})`);
    }
  }
}

/**
 * Refuses a Mechanic's primitive that redefines one of core's, or one another loaded Mechanic
 * contributes differently under the same id: the Editor knows one primitive by each id.
 */
function checkPrimitiveClashes(
  seen: Map<string, { readonly def: FunctionDef | PresetDef | SubFunctionDef; readonly by: string }>,
  mechanic: Mechanic,
  by: string,
): void {
  const kinds = [
    ["functions", "trigger function", CORE_PRIMITIVES.functions],
    ["presets", "preset", CORE_PRIMITIVES.presets],
    ["subFunctions", "block sub-function", CORE_PRIMITIVES.subFunctions],
  ] as const;
  for (const [kind, what, core] of kinds) {
    for (const def of Object.values(mechanic.primitives?.[kind] ?? {}) as (FunctionDef | PresetDef | SubFunctionDef)[]) {
      const key = primitiveKey(def);
      // A Plugin built before core provided a primitive may still define it the same way.
      const own = core.get(key);
      if (own && samePrimitive(own, def)) continue;
      if (own) throw new Error(`${by} contributes the ${what} ${key}, which core provides differently`);
      const other = seen.get(key);
      if (other && !samePrimitive(other.def, def)) throw new Error(`${by} contributes the ${what} ${key}, which ${other.by} contributes differently`);
      if (!other) seen.set(key, { def, by });
    }
  }
}
