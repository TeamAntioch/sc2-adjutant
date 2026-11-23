import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { readDocumentHeader, readDocumentHeaderDependencies, withDocumentHeaderDependencies } from "../../src/map/read-document-header.js";
import { writeDocumentHeader } from "../../src/map/write-document-header.js";

describe("writeDocumentHeader", () => {
  // Saved by the Editor with a local campaign mod as its dependency, renamed to Demo-Campaign in the
  // fixture (the same length, so the header is otherwise as the Editor wrote it).
  it("matches the DocumentHeader saved by Editor 5.0.17", async () => {
    const expected = await readFile(new URL("../fixtures/document-header/belshir-test-map.DocumentHeader", import.meta.url));
    const actual = writeDocumentHeader({
      dependencies: ["file:Mods\\Demo-Campaign.SC2Mod"],
      documentId: 0x49e6c59a,
      attributes: {
        "DocInfo/Name": "Just Another StarCraft II Map",
        "DocInfo/DescLong": "Completely devoid of any description whatsoever.",
        "MapInfo/Player00/Name": "Neutral",
        "MapInfo/Player02/Name": "Hostile",
        "DocInfo/DescShort": "Any",
        "MapInfo/Player01/Name": "Player 1",
      },
    });
    expect(actual.toString("hex")).toBe(expected.toString("hex"));
  });
});

describe("readDocumentHeaderDependencies", () => {
  it("reads the dependency the Editor saved, and the ones writeDocumentHeader writes, in order", async () => {
    const saved = await readFile(new URL("../fixtures/document-header/belshir-test-map.DocumentHeader", import.meta.url));
    expect(readDocumentHeaderDependencies(saved)).toEqual(["file:Mods\\Demo-Campaign.SC2Mod"]);
    const dependencies = ["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod", "file:Mods\\Demo-Campaign.SC2Mod"];
    expect(readDocumentHeaderDependencies(writeDocumentHeader({ dependencies, documentId: 1, attributes: { "DocInfo/Name": "Demo" } }))).toEqual(dependencies);
    expect(readDocumentHeaderDependencies(writeDocumentHeader({ documentId: 1, attributes: {} }))).toEqual([]);
  });

  it("refuses a file that isn't a header, and one cut short in its dependencies", () => {
    expect(() => readDocumentHeaderDependencies(Buffer.from("IpaM"))).toThrow("not a H2CS header");
    const header = writeDocumentHeader({ dependencies: ["file:Mods\\Demo-Campaign.SC2Mod"], documentId: 1, attributes: {} });
    expect(() => readDocumentHeaderDependencies(header.subarray(0, 60))).toThrow("runs past the end");
  });
});

describe("withDocumentHeaderDependencies", () => {
  it("replaces the dependency list and keeps the attributes after it", async () => {
    const header = await readFile(new URL("../fixtures/document-header/belshir-test-map.DocumentHeader", import.meta.url));
    const rewritten = withDocumentHeaderDependencies(header, ["file:Campaigns/VoidStory.SC2Campaign", "file:Mods\\Demo-Campaign.SC2Mod"]);
    expect(readDocumentHeaderDependencies(rewritten)).toEqual(["file:Campaigns/VoidStory.SC2Campaign", "file:Mods\\Demo-Campaign.SC2Mod"]);
    expect(rewritten.subarray(readDocumentHeader(rewritten).end)).toEqual(header.subarray(readDocumentHeader(header).end));
  });
});
