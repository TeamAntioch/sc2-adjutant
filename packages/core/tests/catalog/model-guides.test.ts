// Model Guides (#388): one model's curated description for casting it, kept beside its recorded
// animations and checked against them. Synthetic models only.
import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import type { ModelAnims } from "../../src/catalog/model-anims.js";
import { animFamily, bundledModelGuides, catalogModelGuides, modelGuideProblems, ModelGuidesSchema } from "../../src/catalog/model-guides.js";
import { bundledModelAnims } from "../../src/catalog/model-anims.js";

const clip = (name: string) => ({ name, durationMs: 1000, moveSpeed: 0, looping: true });
const ANIMS: ModelAnims = {
  Courier: { file: "Assets/Courier.m3", anims: ["Stand", "Talk 01", "Stand Satchel B", "Talk Satchel B 02", "Walk", "Spell Wave"].map(clip) },
};

describe("an Animation Family", () => {
  it("is an animation's other words, numbered variants aside", () => {
    expect(animFamily("Stand")).toBe("");
    expect(animFamily("Talk 01")).toBe("");
    expect(animFamily("Stand Satchel B")).toBe("Satchel B");
    expect(animFamily("Talk Satchel B 02")).toBe("Satchel B");
    expect(animFamily("Stand Cover Talk 01")).toBe("Cover Talk");
  });
});

describe("the Model Guide format", () => {
  it("reads an entry with its families, anims and avoided anims", () => {
    const guides = ModelGuidesSchema.parse([
      {
        model: "Courier",
        character: "COURIER",
        families: [
          { name: "Satchel B", shows: "Satchel on the shoulder", use: "Most scenes", default: true, source: "author" },
          { name: "", shows: "Hands empty", source: "viewed" },
        ],
        anims: [{ anim: "Spell Wave", shows: "A wave over the head", source: "viewed" }],
        avoid: [{ anim: "Walk", why: "Slides on the floor" }],
      },
    ]);
    expect(guides[0]!.families![0]!.default).toBe(true);
  });

  it("refuses a second default family, a model given twice, and an unknown source", () => {
    const families = [
      { name: "", shows: "a", default: true, source: "author" },
      { name: "Satchel B", shows: "b", default: true, source: "author" },
    ];
    expect(ModelGuidesSchema.safeParse([{ model: "Courier", families }]).error?.issues.map((issue) => issue.message)).toEqual(["A Model Guide has at most one default family: Satchel B is the second"]);
    expect(ModelGuidesSchema.safeParse([{ model: "Courier" }, { model: "Courier" }]).error?.issues.map((issue) => issue.message)).toEqual(["Courier has a Model Guide already, entry 0"]);
    expect(ModelGuidesSchema.safeParse([{ model: "Courier", anims: [{ anim: "Walk", shows: "a walk", source: "named" }] }]).success).toBe(false);
  });
});

describe("a Model Guide's check", () => {
  it("passes a guide whose families and anims the model has, and whose character is declared", () => {
    const guides = ModelGuidesSchema.parse([
      { model: "Courier", character: "courier", families: [{ name: "Satchel B", shows: "x", source: "author" }, { name: "", shows: "y", source: "author" }], anims: [{ anim: "Spell Wave", shows: "z", source: "viewed" }], avoid: [{ anim: "Walk", why: "w" }] },
    ]);
    expect(modelGuideProblems(guides, ANIMS, ["COURIER"])).toEqual([]);
  });

  it("fails an unrecorded family, an unrecorded single or avoided anim, and an undeclared character", () => {
    const guides = ModelGuidesSchema.parse([
      { model: "Courier", character: "STRANGER", families: [{ name: "Victory", shows: "x", source: "author" }], anims: [{ anim: "Spell Dance", shows: "z", source: "viewed" }], avoid: [{ anim: "Walk B", why: "w" }] },
    ]);
    expect(modelGuideProblems(guides, ANIMS, ["COURIER"])).toEqual([
      { path: "0.character", message: "STRANGER isn't one of the Campaign Mod's characters (COURIER)" },
      { path: "0.families.0.name", message: "Courier has no animation in the family Victory (data/model-anims.json or the Workspace's model-anims.json)" },
      { path: "0.anims.0.anim", message: "Courier has no animation Spell Dance (data/model-anims.json or the Workspace's model-anims.json)" },
      { path: "0.avoid.0.anim", message: "Courier has no animation Walk B (data/model-anims.json or the Workspace's model-anims.json)" },
    ]);
  });

  it("leaves an unrecorded model's anims unchecked", () => {
    const guides = ModelGuidesSchema.parse([{ model: "Nobody", families: [{ name: "Victory", shows: "x", source: "author" }], avoid: [{ anim: "Dance", why: "w" }] }]);
    expect(modelGuideProblems(guides, ANIMS, [])).toEqual([]);
  });
});

describe("core's and a Workspace's guides", () => {
  it("merge entry by entry, a Workspace's entry replacing core's whole entry for its model", async () => {
    const core = await bundledModelGuides();
    const catalog = { ...EMPTY_CATALOG, modelGuides: ModelGuidesSchema.parse([{ model: "Courier", avoid: [{ anim: "Walk", why: "w" }] }]) };
    const merged = await catalogModelGuides(catalog);
    expect(merged.Courier).toEqual({ model: "Courier", avoid: [{ anim: "Walk", why: "w" }] });
    expect(Object.keys(merged).sort()).toEqual([...new Set([...Object.keys(core), "Courier"])].sort());
  });

  it("replace core's entry for the same model", async () => {
    const base = { Courier: ModelGuidesSchema.parse([{ model: "Courier", families: [{ name: "", shows: "core's", source: "author" }] }])[0]! };
    const catalog = { ...EMPTY_CATALOG, modelGuides: ModelGuidesSchema.parse([{ model: "Courier", anims: [{ anim: "Spell Wave", shows: "the Workspace's", source: "viewed" }] }]) };
    expect((await catalogModelGuides(catalog, base)).Courier).toEqual({ model: "Courier", anims: [{ anim: "Spell Wave", shows: "the Workspace's", source: "viewed" }] });
  });

  it("core's own guide is the format, and passes against core's recorded animations", async () => {
    const core = Object.values(await bundledModelGuides());
    expect(modelGuideProblems(core, await bundledModelAnims())).toEqual([]);
  });
});
