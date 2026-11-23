// A Kept map's playable area set in place (ADR-0015, #529): MapInfo's bounds and integrity hash,
// and what a compile does with them from one compile to the next.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mapInfoHashProblems } from "../../src/map/kept-checks.js";
import { MAP_BOUNDS_ENTRY_NAME, type MapBoundsEntry, mapInfoBounds, maskMinimap, patchMapInfoBounds, planKeptBounds } from "../../src/map/patch-map-info.js";
import { readTga } from "../../src/map/read-tga.js";
import { writeMinimapTga } from "../../src/map/write-minimap-tga.js";
import { readMapInfoFields, readMapInfoHashedFields } from "../../src/map/read-map-info-fields.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { tempFolder } from "../mcp/harness.js";

const mapInfo = writeMapInfo({ width: 256, height: 256, tilesetId: "KorhalCityEx2", fogType: "Black", playableBounds: [0, 0, 256, 256], players: [{ id: 0, controller: "Neutral" }, { id: 1, controller: "User" }] });

describe("patching MapInfo's playable area", () => {
  it("rewrites the bounds and the integrity hash, and nothing else", async () => {
    const patched = patchMapInfoBounds(mapInfo, [10, 8, 246, 236]);
    expect(patched.length).toBe(mapInfo.length);
    expect(mapInfoBounds(patched)).toEqual([10, 8, 246, 236]);
    const changed = [...patched].flatMap((byte, index) => (byte === mapInfo[index] ? [] : [index]));
    const { bounds: _bounds, integrityHash: _hash, ...rest } = readMapInfoFields(patched);
    const { bounds: _before, integrityHash: _hashBefore, ...restBefore } = readMapInfoFields(mapInfo);
    expect(rest).toEqual(restBefore);
    // Only the hash's 8 bytes and the bounds' 16 differ.
    const { boundsOffset } = readMapInfoHashedFields(mapInfo);
    expect(changed.every((index) => (index >= 8 && index < 16) || (index >= boundsOffset && index < boundsOffset + 16))).toBe(true);
    // The game would open it: its hash is its fields'.
    const dir = await tempFolder("patch-map-info-");
    await writeFile(path.join(dir, "MapInfo"), patched);
    expect(await mapInfoHashProblems(dir)).toEqual([]);
  });

  it("matches what the writer writes for the same bounds", () => {
    const written = writeMapInfo({ width: 256, height: 256, tilesetId: "KorhalCityEx2", fogType: "Black", playableBounds: [10, 8, 246, 236], players: [{ id: 0, controller: "Neutral" }, { id: 1, controller: "User" }] });
    expect(patchMapInfoBounds(mapInfo, [10, 8, 246, 236]).equals(written)).toBe(true);
  });

  it("refuses another MapInfo version, part cells and a rectangle off the map", () => {
    const old = Buffer.from(mapInfo);
    old.writeUInt32LE(38, 4);
    expect(() => patchMapInfoBounds(old, [10, 8, 246, 236])).toThrow(/version 38/);
    expect(() => patchMapInfoBounds(mapInfo, [10.5, 8, 246, 236])).toThrow(/whole cells/);
    expect(() => patchMapInfoBounds(mapInfo, [10, 8, 260, 236])).toThrow(/runs off the 256×256 map/);
  });
});

describe("masking a Kept minimap to new bounds", () => {
  const map = { width: 16, height: 16 };
  const minimap = writeMinimapTga({ width: 16, height: 16, dominantLayers: new Uint32Array(256), playableBounds: [2, 2, 14, 14] });
  const lit = (buffer: Buffer, x: number, y: number): boolean => {
    const { rgb } = readTga(buffer);
    const at = ((15 - y) * 16 + x) * 3;
    return rgb[at]! + rgb[at + 1]! + rgb[at + 2]! > 0;
  };

  it("blacks out the cells outside the new bounds, and leaves the rest", () => {
    const { content, warning } = maskMinimap(minimap, map, [2, 2, 14, 14], [4, 2, 14, 10]);
    expect(warning).toBeUndefined();
    expect(lit(content!, 3, 5)).toBe(false);
    expect(lit(content!, 5, 12)).toBe(false);
    expect(lit(content!, 5, 5)).toBe(true);
  });

  it("skips a colour map before the pixels", () => {
    // The same image with a 2-entry, 24-bit colour map between the header and the pixels.
    const header = Buffer.from(minimap.subarray(0, 18));
    header[1] = 1;
    header.writeUInt16LE(0, 3);
    header.writeUInt16LE(2, 5);
    header[7] = 24;
    const withMap = Buffer.concat([header, Buffer.from([9, 9, 9, 9, 9, 9]), minimap.subarray(18)]);
    const { content } = maskMinimap(withMap, map, [2, 2, 14, 14], [4, 2, 14, 10]);
    expect(content!.subarray(18, 24)).toEqual(Buffer.from([9, 9, 9, 9, 9, 9]));
    const pixels = Buffer.concat([content!.subarray(0, 18), content!.subarray(24)]);
    pixels[1] = 0;
    expect(lit(pixels, 3, 5)).toBe(false);
    expect(lit(pixels, 5, 5)).toBe(true);
  });

  it("asks for an Editor save where the new bounds reach past the old ones, which it can't draw", () => {
    const { warning } = maskMinimap(minimap, map, [2, 2, 14, 14], [0, 0, 16, 16]);
    expect(warning).toContain("Resave the map in the Editor so it redraws Minimap.tga");
    expect(maskMinimap(Buffer.from("not a tga at all, not at all"), map, [2, 2, 14, 14], [4, 4, 12, 12]).warning).toContain("isn't an uncompressed TGA");
  });
});

describe("a Kept playable area from compile to compile", () => {
  const full = [0, 0, 256, 256] as const;
  const area = [24, 16, 232, 236] as const;
  const recorded = (bounds: readonly number[], original: readonly number[] = full): MapBoundsEntry => ({ kind: "map-bounds", bounds: [...bounds] as never, original: [...original] as never });

  it("writes the Blueprint's, recording what was there before", () => {
    expect(planKeptBounds({ current: full, previous: [], wanted: area, decision: undefined })).toEqual({ write: area, entry: recorded(area) });
  });

  it("leaves a package that already has it alone, and records nothing to undo", () => {
    expect(planKeptBounds({ current: area, previous: [], wanted: area, decision: undefined })).toEqual({});
  });

  it("keeps the first original as the Blueprint's changes", () => {
    const next = [30, 16, 232, 236] as const;
    expect(planKeptBounds({ current: area, previous: [recorded(area)], wanted: next, decision: undefined })).toEqual({ write: next, entry: recorded(next) });
  });

  it("puts the original back once the Blueprint no longer asks", () => {
    expect(planKeptBounds({ current: area, previous: [recorded(area)], wanted: undefined, decision: undefined })).toEqual({ write: full });
    // And records nothing when the Blueprint asks for the original itself.
    expect(planKeptBounds({ current: area, previous: [recorded(area)], wanted: full, decision: undefined })).toEqual({ write: full });
  });

  it("stops on an Editor change to other than the Blueprint's, until the author decides", () => {
    const editor = [20, 16, 232, 236] as const;
    const stopped = planKeptBounds({ current: editor, previous: [recorded(area)], wanted: area, decision: undefined });
    expect(stopped.write).toBeUndefined();
    expect(stopped.change).toMatchObject({ name: MAP_BOUNDS_ENTRY_NAME, change: "changed in the Editor" });
    expect(stopped.change?.label).toContain("now [20, 16, 232, 236]; the Blueprint's bounds.playable is [24, 16, 232, 236]");
    // Discarded, the Blueprint's is written; kept, the Editor's stays this once.
    expect(planKeptBounds({ current: editor, previous: [recorded(area)], wanted: area, decision: "discard" })).toMatchObject({ write: area, entry: recorded(area) });
    const kept = planKeptBounds({ current: editor, previous: [recorded(area)], wanted: area, decision: "keep" });
    expect(kept).toMatchObject({ entry: recorded(editor) });
    expect(kept.write).toBeUndefined();
    expect(kept.warning).toContain("this once");
  });

  it("takes a compile cut short between its saves for its own, not an Editor change", () => {
    const next = [30, 16, 232, 236] as const;
    // The record lists the old entry and the new: MapInfo may hold either.
    const both = [recorded(area), recorded(next)];
    expect(planKeptBounds({ current: next, previous: both, wanted: next, decision: undefined })).toEqual({ entry: recorded(next) });
    expect(planKeptBounds({ current: area, previous: both, wanted: next, decision: undefined })).toEqual({ write: next, entry: recorded(next) });
    // Cut short, the package's original is the compile's own too.
    expect(planKeptBounds({ current: full, previous: both, wanted: next, decision: undefined })).toEqual({ write: next, entry: recorded(next) });
  });

  it("takes the package's original put back in the Editor, with one entry, for an Editor change", () => {
    const stopped = planKeptBounds({ current: full, previous: [recorded(area)], wanted: area, decision: undefined });
    expect(stopped.change).toMatchObject({ name: MAP_BOUNDS_ENTRY_NAME, change: "changed in the Editor" });
    expect(stopped.write).toBeUndefined();
  });

  it("takes an Editor change the Blueprint already says as no change, and leaves one it no longer asks for", () => {
    const editor = [20, 16, 232, 236] as const;
    expect(planKeptBounds({ current: editor, previous: [recorded(area)], wanted: editor, decision: undefined })).toEqual({ entry: recorded(editor) });
    expect(planKeptBounds({ current: editor, previous: [recorded(area)], wanted: undefined, decision: undefined })).toEqual({});
  });
});
