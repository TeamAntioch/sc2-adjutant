// Paint Regions (#137, ADR-0028) in the skills that choose and judge textures. texture-sets says
// when a texture gets a blend weight and when an area share, and what a low weight does on a
// height-blended texture; still-review turns a note into a region with paint_region (from a
// Zone, a rect or a box on a frame); exemplar-design sends both kinds of work to them.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const skill = (name: string) => readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

describe("Paint Regions in the skills", () => {
  it.each(["texture-sets", "exemplar-design", "still-review"])("%s names paint_region and both kinds of amount", async (name) => {
    const text = await skill(name);
    expect(text).toContain("`paint_region`");
    expect(text).toMatch(/blend weight/i);
    expect(text).toMatch(/area share/i);
  });

  it("texture-sets says a low weight on a height-blended texture shows as crevice patches, and names the reference note", async () => {
    const text = await skill("texture-sets");
    expect(text).toMatch(/height-blend/i);
    expect(text).toMatch(/crevice/i);
    expect(text).toContain("docs/reference/height-blending.md");
  });

  it("still-review turns a note into a region from a Zone, a rect or a box on a frame, and judges it in the next round", async () => {
    const text = await skill("still-review");
    for (const source of ["`zone`", "`rect`", "`frame`"]) expect(text).toContain(source);
    expect(text).toMatch(/crevice/i);
    expect(text).toContain("`texture_usage`");
  });
});
