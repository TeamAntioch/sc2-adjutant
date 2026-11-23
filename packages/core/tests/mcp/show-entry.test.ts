// show_entry through the MCP server: a stock unit from a folder laid out like SC2GameData, and a
// Mod entry read through Blizzard's parent. Read-only: nothing in the Workspace changes.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { connect, fixture, tempFolder, text } from "./harness.js";

afterEach(cleanupLantern);

const UNITS = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CUnit default="1"><Race value="Neut"/></CUnit>
    <CUnit id="DESTRUCTIBLE"><LifeMax value="500"/><Attributes index="Structure" value="1"/></CUnit>
    <CUnit id="Marine"><LifeMax value="45"/><WeaponArray Link="GuassRifle"/></CUnit>
    <CWeaponLegacy id="GuassRifle"><Range value="5"/></CWeaponLegacy>
</Catalog>
`;

/** A stock folder with one package, as SC2GameData lays it out. */
async function stockFolder(): Promise<string> {
  const folder = await tempFolder();
  const data = path.join(folder, "mods", "core.sc2mod", "base.sc2data", "gamedata");
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "UnitData.xml"), UNITS);
  return folder;
}

describe("show_entry", () => {
  it("shows a stock unit with its fields, its layer and who names it", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "show_entry", arguments: { id: "Marine", stockData: await stockFolder() } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({
      class: "CUnit",
      id: "Marine",
      layers: ["core.sc2mod"],
      classDefault: true,
      fields: [
        { name: "Race", elements: [`<Race value="Neut"/>`] },
        { name: "LifeMax", elements: [`<LifeMax value="45"/>`] },
        { name: "WeaponArray", elements: [`<WeaponArray Link="GuassRifle"/>`] },
      ],
      referrers: { total: 0 },
    });
    expect(text(reply)).toMatch(/^CUnit:Marine, defined in core.sc2mod/);
    const weapon = await client.callTool({ name: "show_entry", arguments: { id: "GuassRifle", stockData: await stockFolder() } });
    expect((weapon.structuredContent as { referrers: { items: unknown[] } }).referrers.items).toEqual([{ class: "CUnit", id: "Marine", via: "WeaponArray@Link", layers: ["core.sc2mod"] }]);
  });

  it("shows a Campaign Mod entry through the stock parent it names, Kept package and all", async () => {
    const { root } = await lanternWorkspace();
    const client = await connect(root);
    const reply = await client.callTool({ name: "show_entry", arguments: { id: "SignalBeacon", stockData: await stockFolder() } });
    expect(reply.isError).toBeFalsy();
    const report = reply.structuredContent as { layers: string[]; chain: { id: string }[]; fields: { name: string; elements: string[] }[] };
    expect(report.layers).toEqual(["mod lantern-story (package)"]);
    expect(report.chain.map((link) => link.id)).toEqual(["SignalBeacon", "DESTRUCTIBLE"]);
    expect(report.fields.find((field) => field.name === "LifeMax")?.elements).toEqual([`<LifeMax value="25"/>`]);
    expect(report.fields.find((field) => field.name === "Attributes")?.elements).toEqual([`<Attributes index="Structure" value="1"/>`]);
  });

  it("reads the mod alone when no stock data is given, and says the parent is missing", async () => {
    const { root } = await lanternWorkspace();
    const client = await connect(root);
    const reply = await client.callTool({ name: "show_entry", arguments: { id: "SignalBeacon" } });
    expect(reply.structuredContent).toMatchObject({ missingParent: "DESTRUCTIBLE" });
  });

  it("refuses an unknown id, naming the missing stock data, and a stock folder with no packages", async () => {
    const { root } = await lanternWorkspace();
    const client = await connect(root);
    const unknown = await client.callTool({ name: "show_entry", arguments: { id: "Marine" } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/No entry with the id Marine.*no stockData/);
    const empty = await client.callTool({ name: "show_entry", arguments: { id: "Marine", stockData: await tempFolder() } });
    expect(empty.isError).toBe(true);
    expect(text(empty)).toMatch(/holds none of Blizzard's data packages/);
  });

  it("has nothing to read in a Workspace with no Campaign Mod and no stock data", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "show_entry", arguments: { id: "Marine" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/no data to read/);
  });
});
