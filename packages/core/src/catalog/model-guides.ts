// Model Guides (docs/reference/model-guides.md): one model's curated description for casting it in
// a Cinematic, what its Animation Families and notable animations show and when to use them, and
// which animations to avoid. Core keeps the game's models' guides in data/model-guide.json; a
// Workspace's Campaign Mod keeps its own in mods/<id>/model-guide.json, beside its
// model-anims.json, read into the catalog layer. A Workspace's entry for a model replaces core's
// whole entry. A guide holds no lengths or move speeds: model-anims.json records those.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { speakerKey } from "../domain/character.js";
import type { Catalog } from "./catalog-layer.js";
import type { ModelAnims } from "./model-anims.js";

/** Who wrote a description: the author said or confirmed it, or an agent watched the clip and the author hasn't confirmed it yet. */
const SourceSchema = z.enum(["author", "viewed"]);

const FamilySchema = z
  .object({
    /** The family's words: "Victory B" for Stand Victory B, Talk Victory B …; "" for the plain family (Stand, Talk 01 …). */
    name: z.string(),
    shows: z.string().min(1),
    use: z.string().min(1).optional(),
    /** The family the model stands and talks in when a cast member gives no anim; a member whose anim picks no family talks in it too. */
    default: z.boolean().optional(),
    source: SourceSchema,
  })
  .strict();

const AnimSchema = z.object({ anim: z.string().min(1), shows: z.string().min(1), use: z.string().min(1).optional(), source: SourceSchema }).strict();

const AvoidSchema = z.object({ anim: z.string().min(1), why: z.string().min(1) }).strict();

/** One model's guide, `{ model, character?, families?, anims?, avoid? }`, at most one of its families the default. */
export const ModelGuideSchema = z
  .object({
    model: z.string().min(1),
    /** The Character (speaker) the model plays, one the Campaign Mod's Blueprint declares. */
    character: z.string().min(1).optional(),
    families: z.array(FamilySchema).optional(),
    anims: z.array(AnimSchema).optional(),
    avoid: z.array(AvoidSchema).optional(),
  })
  .strict()
  .superRefine((guide, context) => {
    const defaults = (guide.families ?? []).flatMap((family, index) => (family.default ? [{ family, index }] : []));
    for (const { family, index } of defaults.slice(1)) {
      context.addIssue({ code: "custom", path: ["families", index, "default"], message: `A Model Guide has at most one default family: ${family.name || "the plain family"} is the second` });
    }
  });

/** One model's curated description for casting it. */
export type ModelGuide = z.infer<typeof ModelGuideSchema>;

/** A model-guide.json: a list of guides, each model once. */
export const ModelGuidesSchema = z.array(ModelGuideSchema).superRefine((guides, context) => {
  const seen = new Map<string, number>();
  guides.forEach((guide, index) => {
    const first = seen.get(guide.model);
    if (first !== undefined) context.addIssue({ code: "custom", path: [index, "model"], message: `${guide.model} has a Model Guide already, entry ${first}` });
    else seen.set(guide.model, index);
  });
});

/** Guides by model. */
export type ModelGuides = Readonly<Record<string, ModelGuide>>;

/** The file a Model Guide is kept in: core's data/model-guide.json, and mods/<id>/model-guide.json beside a Mod Blueprint. */
export const MODEL_GUIDE_FILE = "model-guide.json";

/** Where core keeps the game's models' guides. */
export const MODEL_GUIDE_PATH = fileURLToPath(new URL(`../../data/${MODEL_GUIDE_FILE}`, import.meta.url));

/** The guides of a model-guide.json's text, `file` naming it in the error when they don't read. */
export function parseModelGuides(text: string, file: string): readonly ModelGuide[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't JSON: ${(error as Error).message}`);
  }
  const parsed = ModelGuidesSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} isn't a Model Guide list: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

const byModel = (guides: readonly ModelGuide[]): ModelGuides => Object.fromEntries(guides.map((guide) => [guide.model, guide]));

let bundled: Promise<ModelGuides> | undefined;
/** Core's guides, data/model-guide.json, read once: the game's models only. */
export function bundledModelGuides(): Promise<ModelGuides> {
  bundled ??= readFile(MODEL_GUIDE_PATH, "utf8").then((text) => byModel(parseModelGuides(text, "data/model-guide.json")));
  return bundled;
}

/** The guides of the game's models and the catalog's Campaign Mod's, a mod's entry replacing core's whole entry for its model. */
export async function catalogModelGuides(catalog: Pick<Catalog, "modelGuides">, base?: ModelGuides): Promise<ModelGuides> {
  return { ...(base ?? (await bundledModelGuides())), ...byModel(catalog.modelGuides) };
}

/** The guide's default family's name, when it marks one: the family a cast member with no anim stands and talks in, and the one a member whose anim picks no family talks in. */
export function defaultFamily(guide: ModelGuide | undefined): string | undefined {
  return guide?.families?.find((family) => family.default)?.name;
}

/** An animation's Animation Family: its words after the first, numbered variants aside ("Talk Victory B 02" is Victory B, "Talk 01" the plain family ""). */
export function animFamily(anim: string): string {
  return /^\S+((?: (?!\d+$)\S+)*)(?: \d+)?$/.exec(anim)?.[1]?.trim() ?? "";
}

/**
 * What's wrong with guides against the recorded animations of their models: a family with no
 * recorded animation of its words, a single or avoided animation that isn't recorded (an unrecorded
 * model's left unchecked, as a Cinematic's anims are), and, given the Campaign Mod's `speakers`, a
 * character that isn't one of them. Each problem's path is into the guide list.
 */
export function modelGuideProblems(guides: readonly ModelGuide[], modelAnims: ModelAnims, speakers?: readonly string[]): { readonly path: string; readonly message: string }[] {
  const problems: { path: string; message: string }[] = [];
  const where = "(data/model-anims.json or the Workspace's model-anims.json)";
  const declared = speakers === undefined ? undefined : new Set(speakers.map(speakerKey));
  guides.forEach((guide, at) => {
    if (guide.character !== undefined && declared && !declared.has(speakerKey(guide.character))) {
      problems.push({ path: `${at}.character`, message: `${guide.character} isn't one of the Campaign Mod's characters (${speakers!.join(", ") || "none"})` });
    }
    const recorded = modelAnims[guide.model]?.anims;
    if (!recorded) return;
    const names = new Set(recorded.map((anim) => anim.name));
    const families = new Set(recorded.map((anim) => animFamily(anim.name)));
    (guide.families ?? []).forEach((family, index) => {
      if (!families.has(family.name)) problems.push({ path: `${at}.families.${index}.name`, message: `${guide.model} has no animation in the family ${family.name || "(the plain family)"} ${where}` });
    });
    for (const key of ["anims", "avoid"] as const) {
      (guide[key] ?? []).forEach((entry, index) => {
        if (!names.has(entry.anim)) problems.push({ path: `${at}.${key}.${index}.anim`, message: `${guide.model} has no animation ${entry.anim} ${where}` });
      });
    }
  });
  return problems;
}
