// Seam 1 (#96, #115): reading and editing a Mission Blueprint through the MCP server, and the
// preview image. Edits are checked by what the tools reply and what ends up in the file.
import { lstat, readFile, rename, symlink } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, fixture, text } from "./harness.js";

const blueprintFile = (root: string) => path.join(root, "missions", "lava-field", "blueprint.json");
const stored = async (root: string) => JSON.parse(await readFile(blueprintFile(root), "utf8"));

/** A copy of the field Workspace whose Mission has a unit Anchor in the Field. */
async function fieldWithAnchor() {
  const root = await copyOf("field");
  const client = await connect(root);
  const anchor = { id: "hero", name: "Hero", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10 } };
  const reply = await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "add", path: "/anchors", value: [anchor] }] } });
  expect(reply.isError).toBeFalsy();
  return { root, client };
}

describe("get_blueprint", () => {
  it("returns the Blueprint as stored, or the part a pointer names", async () => {
    const client = await connect(fixture("field"));
    const whole = await client.callTool({ name: "get_blueprint", arguments: { mission: "lava-field" } });
    expect(whole.isError).toBeFalsy();
    expect(whole.structuredContent).toEqual({ value: await stored(fixture("field")), issues: [] });
    // As stored: defaults such as `anchors: []` aren't filled in.
    expect(whole.structuredContent).not.toHaveProperty("value.anchors");

    const part = await client.callTool({ name: "get_blueprint", arguments: { mission: "lava-field", pointer: "/zones/1/name" } });
    expect(part.structuredContent).toEqual({ value: "Cave", issues: [] });
    expect(text(part)).toBe('"Cave"');

    const missing = await client.callTool({ name: "get_blueprint", arguments: { mission: "lava-field", pointer: "/zones/7" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe("At /zones/7: index 7 is past the end of an array of 2");
  });
});

describe("patch_blueprint", () => {
  it("applies a valid patch and saves it", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const reply = await client.callTool({
      name: "patch_blueprint",
      arguments: {
        mission: "lava-field",
        patch: [
          { op: "test", path: "/zones/1/name", value: "Cave" },
          { op: "replace", path: "/zones/1/name", value: "Grotto" },
          { op: "replace", path: "/mechanics/0/params/warningSeconds", value: 8 },
          { op: "add", path: "/beats/-", value: { id: "escape", title: "Escape", summary: "Run." } },
        ],
      },
    });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ saved: true, notes: ["Applied 4 operations."], issues: [] });
    expect(text(reply)).toContain(`Saved ${blueprintFile(root)}.`);
    const blueprint = await stored(root);
    expect(blueprint.zones[1].name).toBe("Grotto");
    expect(blueprint.mechanics[0].params.warningSeconds).toBe(8);
    expect(blueprint.beats.map((beat: { id: string }) => beat.id)).toEqual(["flood", "escape"]);
  });

  it("rejects bad Plugin Mechanic params with the path and reason, leaving the file unchanged", async () => {
    const root = await copyOf("field");
    const before = await readFile(blueprintFile(root), "utf8");
    const client = await connect(root);
    const reply = await client.callTool({
      name: "patch_blueprint",
      arguments: { mission: "lava-field", patch: [{ op: "add", path: "/mechanics/0/params/warningSecs", value: 5 }] },
    });
    expect(reply.isError).toBe(true);
    expect(reply.structuredContent).toEqual({ saved: false, notes: [], issues: [{ path: "mechanics.0.params", message: 'Unrecognized key: "warningSecs"' }] });
    expect(text(reply)).toBe(`Refused; ${blueprintFile(root)} is unchanged:\n- mechanics.0.params: Unrecognized key: "warningSecs"`);
    expect(await readFile(blueprintFile(root), "utf8")).toBe(before);
  });

  it("adds a Paint Region that get_blueprint returns as written, and refuses one whose texture its cells' set lacks", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const region = { id: "worn", zone: "cave", mix: [{ texture: "KorhalCityEx2_3", weight: 0.15 }, { texture: "KorhalCityEx2_2" }], falloff: 1 };
    const added = await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "add", path: "/paintRegions", value: [region] }] } });
    expect(added.isError).toBeFalsy();
    const read = await client.callTool({ name: "get_blueprint", arguments: { mission: "lava-field", pointer: "/paintRegions" } });
    expect(read.structuredContent).toEqual({ value: [region], issues: [] });

    const before = await readFile(blueprintFile(root), "utf8");
    const refused = await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "replace", path: "/paintRegions/0/mix/0/texture", value: "AiurRock" }] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("paintRegions.0.mix.0.texture: Paint Region worn paints cells on the map's textures (set 0), which don't hold AiurRock: KorhalCityEx2_1");
    expect(await readFile(blueprintFile(root), "utf8")).toBe(before);
  });

  it("rejects core schema errors, unknown Mechanic types and patches that can't apply", async () => {
    const root = await copyOf("field");
    const before = await readFile(blueprintFile(root), "utf8");
    const client = await connect(root);
    const cases = [
      [[{ op: "replace", path: "/zones/0/elevation", value: 16 }], "zones.0.elevation: Too big: expected number to be <=15"],
      [[{ op: "replace", path: "/mechanics/0/type", value: "lantern" }], "mechanics.0.type: Unknown Mechanic type lantern"],
      [[{ op: "replace", path: "/mechanics/0/params/safeZoneIds/0", value: "volcano" }], "mechanics.0.params.safeZoneIds.0"],
      [[{ op: "remove", path: "/zones/5" }], "patch.0: Operation 0 at /zones/5: index 5 is past the end of an array of 2"],
      [[{ op: "replace", path: "/title", value: "Lava" }, { op: "test", path: "/title", value: "Lava Field" }], "patch.1: Operation 1 at /title: the value isn't the one the test expects"],
      // A core issue doesn't hide a Plugin Mechanic's.
      [[{ op: "replace", path: "/zones/0/elevation", value: 16 }, { op: "add", path: "/mechanics/0/params/warningSecs", value: 5 }], 'mechanics.0.params: Unrecognized key: "warningSecs"'],
      [[{ op: "remove", path: "/zones/0/~2" }], 'patch.0: Operation 0 at /zones/0/~2: not a JSON Pointer; it must be empty or start with "/", and a "~" must begin "~0" or "~1"'],
      // 0 and -0 are one JSON number, so the test passes and the bad elevation is what's refused.
      [[{ op: "test", path: "/mechanics/0/params/firstSeconds", value: -0 }, { op: "replace", path: "/zones/0/elevation", value: 16 }], "zones.0.elevation"],
    ] as const;
    for (const [patch, reason] of cases) {
      const reply = await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch } });
      expect(reply.isError).toBe(true);
      expect(text(reply)).toContain(reason);
    }
    expect(await readFile(blueprintFile(root), "utf8")).toBe(before);
  });
});

describe("Zone and Anchor helpers", () => {
  it("reshapes a Zone, and refuses an outline off the map or crossing itself", async () => {
    const { root, client } = await fieldWithAnchor();
    const polygon = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 34, y: 32 },
      { x: 30, y: 64 },
      { x: 0, y: 64 },
    ];
    const reply = await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon } });
    expect(reply.isError).toBeFalsy();
    expect((await stored(root)).zones[0].polygon).toEqual(polygon);

    const off = await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 0, y: 10 }] } });
    expect(text(off)).toContain("- zones.0.polygon.1: (70, 0) is outside the map 64×64");
    const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const crossed = await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: bowtie } });
    expect(text(crossed)).toContain("- zones.0.polygon: The polygon crosses itself: edges 0 and 2 intersect");
    const unknown = await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "lava", polygon } });
    expect(text(unknown)).toContain("- zones: No zone lava (its zones: field, cave)");
    expect((await stored(root)).zones[0].polygon).toEqual(polygon);

    // An Anchor the new outline leaves behind is reported.
    const shrunk = await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: [{ x: 20, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 64 }, { x: 20, y: 64 }] } });
    expect(shrunk.structuredContent).toMatchObject({ saved: true, notes: ["Zone field now has 4 corners.", "Anchor hero now stands outside its zone."] });
  });

  it("moves an Anchor into the Zone that holds its new point", async () => {
    const { root, client } = await fieldWithAnchor();
    const reply = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "hero", position: { x: 40, y: 20 } } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ saved: true, notes: ["Moved anchor hero to (40, 20), from zone field to cave."] });
    expect((await stored(root)).anchors[0]).toMatchObject({ zoneId: "cave", position: { x: 40, y: 20 } });

    const off = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "hero", position: { x: 80, y: 20 } } });
    expect(text(off)).toContain("- anchors.0.position: (80, 20) is outside the map 64×64");
    const badZone = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "hero", position: { x: 5, y: 5 }, zone: "volcano" } });
    expect(badZone.isError).toBe(true);
    expect(text(badZone)).toContain("anchors.0.zoneId");
    expect((await stored(root)).anchors[0]).toMatchObject({ zoneId: "cave", position: { x: 40, y: 20 } });
  });

  it("moves a Zone with its Anchors", async () => {
    const { root, client } = await fieldWithAnchor();
    // Make room: shrink the field, then slide it right.
    await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 64 }, { x: 0, y: 64 }] } });
    const reply = await client.callTool({ name: "move_zone", arguments: { mission: "lava-field", zone: "field", dx: 4, dy: 0 } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ notes: ["Moved zone field by (4, 0) with 1 anchor and 0 placements."] });
    const blueprint = await stored(root);
    expect(blueprint.zones[0].polygon[0]).toEqual({ x: 4, y: 0 });
    expect(blueprint.anchors[0].position).toEqual({ x: 14, y: 10 });

    const off = await client.callTool({ name: "move_zone", arguments: { mission: "lava-field", zone: "field", dx: -10, dy: 0 } });
    expect(text(off)).toContain("- zones.0.polygon.0: (-6, 0) is outside the map 64×64");
  });

  it("writes Blueprints every tool and the compiler accept", async () => {
    const { client } = await fieldWithAnchor();
    await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "hero", position: { x: 50, y: 50 } } });
    await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "cave", polygon: [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 60 }, { x: 32, y: 64 }] } });
    const compiled = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } });
    expect(compiled.isError).toBeFalsy();
    const read = await client.callTool({ name: "get_blueprint", arguments: { mission: "lava-field" } });
    expect(read.structuredContent).toMatchObject({ issues: [] });
  });
});

describe("edge cases", () => {
  it("saves only what it validated: a __proto__ key is a plain key, so the zone without a name is refused", async () => {
    const root = await copyOf("field");
    const before = await readFile(blueprintFile(root), "utf8");
    const client = await connect(root);
    const reply = await client.callTool({
      name: "patch_blueprint",
      arguments: { mission: "lava-field", patch: [{ op: "remove", path: "/zones/0/name" }, { op: "add", path: "/zones/0/__proto__", value: { name: "X" } }] },
    });
    expect(reply.isError).toBe(true);
    expect(await readFile(blueprintFile(root), "utf8")).toBe(before);
  });

  it("writes through a symlinked Blueprint, keeping the link", async () => {
    const root = await copyOf("field");
    const real = path.join(root, "real-blueprint.json");
    await rename(blueprintFile(root), real);
    await symlink(real, blueprintFile(root));
    const client = await connect(root);
    const reply = await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "replace", path: "/title", value: "Linked" }] } });
    expect(reply.isError).toBeFalsy();
    expect((await lstat(blueprintFile(root))).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(real, "utf8")).title).toBe("Linked");
  });

  it("keeps an Anchor's height and a camera's framing when it moves", async () => {
    const { root, client } = await fieldWithAnchor();
    const camera = { id: "shot", name: "Shot", zoneId: "field", kind: "camera", position: { x: 10, y: 10, z: 2.5 }, cameraTarget: { x: 14, y: 12 } };
    await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "add", path: "/anchors/-", value: camera }] } });
    const reply = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "shot", position: { x: 20, y: 30 } } });
    expect(reply.isError).toBeFalsy();
    expect((await stored(root)).anchors[1]).toMatchObject({ position: { x: 20, y: 30, z: 2.5 }, cameraTarget: { x: 24, y: 32 } });
  });

  it("moves a Zone's Placements that stand at a point", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const placement = { id: "relay", zoneId: "field", kind: "objective-structure", params: { at: { x: 10, y: 20 } } };
    await client.callTool({
      name: "patch_blueprint",
      arguments: {
        mission: "lava-field",
        patch: [
          { op: "add", path: "/placements", value: [placement] },
          { op: "replace", path: "/zones/0/polygon", value: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 64 }, { x: 0, y: 64 }] },
        ],
      },
    });
    const reply = await client.callTool({ name: "move_zone", arguments: { mission: "lava-field", zone: "field", dx: 5, dy: 0 } });
    expect(reply.structuredContent).toMatchObject({ saved: true, notes: ["Moved zone field by (5, 0) with 0 anchors and 1 placement."] });
    expect((await stored(root)).placements[0].params.at).toEqual({ x: 15, y: 20 });
  });

  it("keeps an Anchor in its Zone while that still holds the point, clears its height on null, and keeps a camera's target on the map", async () => {
    const { root, client } = await fieldWithAnchor();
    // The Cave, listed last, overlaps the Field here; the Anchor stays in the Field.
    await client.callTool({
      name: "set_zone_polygon",
      arguments: { mission: "lava-field", zone: "cave", polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] },
    });
    const kept = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "hero", position: { x: 12, y: 12 } } });
    expect(kept.structuredContent).toMatchObject({ saved: true, notes: ["Moved anchor hero to (12, 12) in zone field."] });

    const camera = { id: "shot", name: "Shot", zoneId: "field", kind: "camera", position: { x: 10, y: 10, z: 2.5 }, cameraTarget: { x: 10, y: 1 } };
    await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "add", path: "/anchors/-", value: camera }] } });
    const off = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "shot", position: { x: 10, y: 5 } } });
    expect(off.isError).toBe(true);
    expect(text(off)).toContain("anchors.1.cameraTarget: Moving the camera's target with it puts it at (10, -4)");
    const cleared = await client.callTool({ name: "move_anchor", arguments: { mission: "lava-field", anchor: "shot", position: { x: 11, y: 10, z: null } } });
    expect(cleared.isError).toBeFalsy();
    expect((await stored(root)).anchors[1].position).toEqual({ x: 11, y: 10 });
  });

  it("names the terrain objects and Mechanic positions a moved Zone leaves behind", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const zone = (await stored(root)).zones[0];
    const inside = zone.polygon[0];
    const bridge = { id: "span", type: "TerrainObjectCastanarBridge6x10", at: { x: Math.round(inside.x + 1), y: Math.round(inside.y + 1) } };
    await client.callTool({ name: "patch_blueprint", arguments: { mission: "lava-field", patch: [{ op: "add", path: "/terrainObjects", value: [bridge] }] } });
    const reply = await client.callTool({ name: "move_zone", arguments: { mission: "lava-field", zone: "field", dx: 1, dy: 0 } });
    expect(reply.isError).toBeFalsy();
    expect((reply.structuredContent as { notes: string[] }).notes).toContain("Terrain objects that stood in it left where they were: span.");
  });

  it("refuses a doubled corner and an outline that doubles back", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const doubled = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(text(await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: doubled } }))).toContain(
      "- zones.0.polygon.2: Corners 1 and 2 are the same point",
    );
    const spike = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }];
    expect(text(await client.callTool({ name: "set_zone_polygon", arguments: { mission: "lava-field", zone: "field", polygon: spike } }))).toContain(
      "- zones.0.polygon.1: The outline doubles back on itself at corner 1",
    );
  });
});

describe("preview", () => {
  it("returns the sketch as a PNG image and writes the SVG beside the Blueprint", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const reply = await client.callTool({ name: "preview", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    const [image, caption] = reply.content as [{ type: string; mimeType: string; data: string }, { type: string; text: string }];
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    const png = Buffer.from(image.data, "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // The IHDR's size matches the SVG's.
    const svg = await readFile(path.join(root, "missions", "lava-field", "preview.svg"), "utf8");
    const [, width, height] = svg.match(/<svg[^>]* width="(\d+)" height="(\d+)"/)!;
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(width), Number(height)]);
    expect(caption.text).toContain("Preview of Lava Field, also written to");
  });
});
