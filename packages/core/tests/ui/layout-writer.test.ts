// The layout writer (ADR-0019): .SC2Layout XML as the Editor saves it, with CRLF line endings, so
// an Editor save of a generated layout doesn't read as an edit. The goldens are written by hand.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { descIndex, layoutWithCrlf, withCrlf, writeLayout } from "../../src/ui/layout-writer.js";

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");

describe("writeLayout", () => {
  it("writes frames nested and indented, attributes in order and escaped, with CRLF line endings", async () => {
    const layout = writeLayout([
      {
        tag: "Frame",
        attributes: { type: "Frame", name: "HarbourPanel" },
        children: [
          { tag: "Anchor", attributes: { side: "Top", relative: "$parent", pos: "Min", offset: "20" } },
          { tag: "Visible", attributes: { val: "false" } },
          { tag: "Frame", attributes: { type: "Label", name: "Title" }, children: [{ tag: "Text", attributes: { val: `Quay & <Dock> "North"` } }] },
        ],
      },
      { tag: "Frame", attributes: { type: "Image", name: "HarbourIcon" } },
    ]);
    expect(layout).toBe(await golden("layout.SC2Layout"));
  });

  it("writes an empty layout as an empty Desc", () => {
    expect(writeLayout([])).toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc/>\r\n`);
  });
});

describe("descIndex", () => {
  it("includes each layout by its path in Base.SC2Data, in the order given", async () => {
    expect(descIndex(["Base.SC2Data/UI/Layout/Quay.SC2Layout", "Base.SC2Data/UI/Layout/Harbour.SC2Layout", "Base.SC2Data/UI/Overrides.SC2Layout"])).toBe(await golden("DescIndex.SC2Layout"));
  });

  it("refuses a layout outside Base.SC2Data, which the index can't name", () => {
    expect(() => descIndex(["enUS.SC2Data/UI/Layout/Quay.SC2Layout"])).toThrow(/Base\.SC2Data/);
  });
});

describe("withCrlf", () => {
  it("gives every line a CRLF ending, whatever it had", () => {
    expect(withCrlf("<Desc>\n    <Frame/>\r\n</Desc>\n")).toBe("<Desc>\r\n    <Frame/>\r\n</Desc>\r\n");
  });
});

describe("layoutWithCrlf", () => {
  it("gives UTF-8 text CRLF endings, keeping a UTF-8 BOM", () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf]);
    const text = new TextEncoder().encode("<Desc>\n</Desc>\n");
    expect(Buffer.from(layoutWithCrlf(Buffer.concat([bom, text])))).toEqual(Buffer.concat([bom, Buffer.from("<Desc>\r\n</Desc>\r\n")]));
  });

  it("leaves UTF-16 and bytes that aren't UTF-8 as they are", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<Desc/>\n", "utf16le")]);
    expect(Buffer.from(layoutWithCrlf(utf16))).toEqual(utf16);
    const invalid = Buffer.from([0x3c, 0x44, 0xff, 0x0a]);
    expect(Buffer.from(layoutWithCrlf(invalid))).toEqual(invalid);
  });
});
