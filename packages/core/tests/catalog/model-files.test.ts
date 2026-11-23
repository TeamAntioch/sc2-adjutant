import { describe, expect, it } from "vitest";

import { modelFile, readModelEntries } from "../../src/catalog/model-files.js";

const liberty = `<Catalog>
    <CModel id="SMX3_BridgeSoldierB" parent="SMCHARACTER">
        <Model value="Assets\\StoryModeCharacters\\Terran\\SMX3_BridgeSoldierB\\SMX3_BridgeSoldierB.m3"/>
    </CModel>
    <CModel id="SMX3_BGPeople_07" parent="SMX3_BridgeSoldierB">
        <Model value="Assets\\StoryModeSets\\Terran\\SMX3_BGPeople\\SMX3_BGPeople_07.m3"/>
    </CModel>
    <CModel id="SoldierB_Alt" parent="SMX3_BridgeSoldierB"/>
</Catalog>`;

describe("modelFile", () => {
  const entries = readModelEntries([liberty, `<Catalog><CModel id="SoldierB_Alt"><Model value="Assets\\Alt.m3"/></CModel></Catalog>`]);

  it("reads a model's own file", () => {
    expect(modelFile(entries, "SMX3_BGPeople_07")).toBe("Assets/StoryModeSets/Terran/SMX3_BGPeople/SMX3_BGPeople_07.m3");
  });

  it("lets a later catalog override a model, keeping its parent", () => {
    expect(modelFile(entries, "SoldierB_Alt")).toBe("Assets/Alt.m3");
    expect(entries.get("SoldierB_Alt")?.parent).toBe("SMX3_BridgeSoldierB");
  });

  it("inherits the file from the parent", () => {
    expect(modelFile(readModelEntries([liberty]), "SoldierB_Alt")).toBe("Assets/StoryModeCharacters/Terran/SMX3_BridgeSoldierB/SMX3_BridgeSoldierB.m3");
  });

  it("knows nothing of a model no catalog has", () => {
    expect(modelFile(entries, "Nobody")).toBeUndefined();
  });
});

// The game's ModelData templates fill a parent's path in for each model: ##id## is the model's own
// id, and any other ##token## the nearest value up its parents, an attribute on an entry (Race="...")
// or a template's <?token?> default.
const templates = `<Catalog>
    <CModel default="1" id="Unit">
        <?token id="Race" value="Neutral"?>
        <?token id="Prefix" value="Units\\"?>
        <Model value="Assets\\##Prefix####Race##\\##id##\\##id##.m3"/>
    </CModel>
    <CModel default="1" id="Doodad">
        <Model value="Assets\\Doodads\\##id##\\##id##.m3"/>
    </CModel>
    <CModel default="1" id="WalkerBase" parent="Unit">
        <?token id="Race" value="Terran"?>
    </CModel>
    <CModel id="Walker_Gold_Collection" parent="WalkerBase"/>
    <CModel id="Walker_Gold" parent="Walker_Gold_Collection"/>
    <CModel id="Hopper_Collection" parent="Unit" Race="Zerg"/>
    <CModel id="Hopper_Red" parent="Hopper_Collection"/>
    <CModel id="Hopper_Blue" parent="Hopper_Collection" Race="Protoss"/>
    <CModel id="Campfire_Small" parent="Doodad"/>
    <CModel id="Plain" parent="Unit"/>
</Catalog>`;

describe("modelFile through the game's templates", () => {
  const entries = readModelEntries([templates]);

  it("fills ##id## with the model's own id, not its parent's", () => {
    expect(modelFile(entries, "Campfire_Small")).toBe("Assets/Doodads/Campfire_Small/Campfire_Small.m3");
  });

  it("fills a token from the nearest <?token?> up the parents", () => {
    expect(modelFile(entries, "Walker_Gold")).toBe("Assets/Units/Terran/Walker_Gold/Walker_Gold.m3");
    expect(modelFile(entries, "Plain")).toBe("Assets/Units/Neutral/Plain/Plain.m3");
  });

  it("fills a token from an entry's attribute, the model's own before its parent's", () => {
    expect(modelFile(entries, "Hopper_Red")).toBe("Assets/Units/Zerg/Hopper_Red/Hopper_Red.m3");
    expect(modelFile(entries, "Hopper_Blue")).toBe("Assets/Units/Protoss/Hopper_Blue/Hopper_Blue.m3");
  });

  it("lets a later catalog set a model's token", () => {
    const later = readModelEntries([templates, `<Catalog><CModel id="Hopper_Red" Race="Terran"/></Catalog>`]);
    expect(modelFile(later, "Hopper_Red")).toBe("Assets/Units/Terran/Hopper_Red/Hopper_Red.m3");
  });
});
