// A synthetic GUI library for the library structure tests: Harbour-Story's "Harbour Tools" (Hbr1),
// with every kind of item a library files beside its functions, laid out as the Editor saves it:
// each item's elements in the order it reaches them, walking Root depth first.
//
//   Root
//     Harbour (category)
//       Open Quay           a trigger (library-fixture.ts's)
//       Ring Bell           a GUI function, and Tide Height, a native one (library-fixture.ts's)
//       Close Quay          a disabled trigger with a local variable, Gate
//       Tide                a global with an initial value
//       Crate Record        a structure: Weight (fixed, 2.5) and Label (string)
//       a comment           of two lines
//       Harbour Script      custom script, with an identifier and an init function
//       Presets (category)  with an identifier and a label
//         Bell Tone         a preset type (int, constants): Low (the default, 0) and High (1)
//         Gull Sound        a preset type extending Ntve's: Squawk
import path from "node:path";

import { LIBRARY_FILES, LIBRARY_TRIGGERS, withHarbourLibrary } from "./library-fixture.js";
import { type Mod, put } from "./mod-fixture.js";

export const HARBOUR = "00000001";
export const PRESETS = "00000002";

/** library-fixture.ts's trigger and functions, as its Triggers has them. */
const LIBRARY_ELEMENTS = LIBRARY_TRIGGERS.slice(LIBRARY_TRIGGERS.indexOf(`        <Element Type="Trigger" Id="0000000A">`), LIBRARY_TRIGGERS.indexOf(`    </Library>`)).replace(/\r\n$/, "").split("\r\n");

export const STRUCTURE_TRIGGERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Library Id="Hbr1">`,
  `        <Root>`,
  `            <Item Type="Category" Library="Hbr1" Id="00000001"/>`,
  `        </Root>`,
  `        <Element Type="Category" Id="00000001">`,
  `            <Item Type="Trigger" Library="Hbr1" Id="0000000A"/>`,
  `            <Item Type="FunctionDef" Library="Hbr1" Id="0000B001"/>`,
  `            <Item Type="FunctionDef" Library="Hbr1" Id="0000C001"/>`,
  `            <Item Type="Trigger" Library="Hbr1" Id="0000000F"/>`,
  `            <Item Type="Variable" Library="Hbr1" Id="0000000D"/>`,
  `            <Item Type="Structure" Library="Hbr1" Id="0000D001"/>`,
  `            <Item Type="Comment" Library="Hbr1" Id="0000D010"/>`,
  `            <Item Type="CustomScript" Library="Hbr1" Id="0000D020"/>`,
  `            <Item Type="Category" Library="Hbr1" Id="00000002"/>`,
  `        </Element>`,
  ...LIBRARY_ELEMENTS,
  `        <Element Type="Trigger" Id="0000000F">`,
  `            <Disabled/>`,
  `            <Variable Type="Variable" Library="Hbr1" Id="00000010"/>`,
  `            <Action Type="FunctionCall" Library="Hbr1" Id="00000011"/>`,
  `        </Element>`,
  `        <Element Type="Variable" Id="00000010">`,
  `            <VariableType>`,
  `                <Type Value="bool"/>`,
  `            </VariableType>`,
  `        </Element>`,
  `        <Element Type="FunctionCall" Id="00000011">`,
  `            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000001"/>`,
  `        </Element>`,
  `        <Element Type="Variable" Id="0000000D">`,
  `            <VariableType>`,
  `                <Type Value="int"/>`,
  `            </VariableType>`,
  `            <Value Type="Param" Library="Hbr1" Id="0000000E"/>`,
  `        </Element>`,
  `        <Element Type="Param" Id="0000000E">`,
  `            <Value>3</Value>`,
  `            <ValueType Type="int"/>`,
  `        </Element>`,
  `        <Element Type="Structure" Id="0000D001">`,
  `            <Variable Type="Variable" Library="Hbr1" Id="0000D002"/>`,
  `            <Variable Type="Variable" Library="Hbr1" Id="0000D004"/>`,
  `        </Element>`,
  `        <Element Type="Variable" Id="0000D002">`,
  `            <VariableType>`,
  `                <Type Value="fixed"/>`,
  `            </VariableType>`,
  `            <Value Type="Param" Library="Hbr1" Id="0000D003"/>`,
  `        </Element>`,
  `        <Element Type="Param" Id="0000D003">`,
  `            <Value>2.5</Value>`,
  `            <ValueType Type="fixed"/>`,
  `        </Element>`,
  `        <Element Type="Variable" Id="0000D004">`,
  `            <VariableType>`,
  `                <Type Value="string"/>`,
  `            </VariableType>`,
  `        </Element>`,
  `        <Element Type="Comment" Id="0000D010">`,
  `            <Comment>`,
  `                Bells ring at dawn`,
  `                and at dusk`,
  `            </Comment>`,
  `        </Element>`,
  `        <Element Type="CustomScript" Id="0000D020">`,
  `            <Identifier>harbourMain</Identifier>`,
  `            <ScriptCode>`,
  `                include &quot;scripts/harbour&quot;`,
  `            </ScriptCode>`,
  `            <InitFunc>Harbour_Init</InitFunc>`,
  `        </Element>`,
  `        <Element Type="Category" Id="00000002">`,
  `            <Identifier>Presets</Identifier>`,
  `            <Label Type="Label" Library="Ntve" Id="00000016"/>`,
  `            <Item Type="Preset" Library="Hbr1" Id="0000D030"/>`,
  `            <Item Type="Preset" Library="Hbr1" Id="0000D040"/>`,
  `        </Element>`,
  `        <Element Type="Preset" Id="0000D030">`,
  `            <PresetCustom/>`,
  `            <BaseType Value="int"/>`,
  `            <PresetGenConstVar/>`,
  `            <Item Type="PresetValue" Library="Hbr1" Id="0000D031"/>`,
  `            <Item Type="PresetValue" Library="Hbr1" Id="0000D032"/>`,
  `        </Element>`,
  `        <Element Type="PresetValue" Id="0000D031">`,
  `            <DefinesDefault/>`,
  `            <Value>0</Value>`,
  `        </Element>`,
  `        <Element Type="PresetValue" Id="0000D032">`,
  `            <Value>1</Value>`,
  `        </Element>`,
  `        <Element Type="Preset" Id="0000D040">`,
  `            <PresetCustom/>`,
  `            <BaseType Value="string"/>`,
  `            <PresetExtends Type="Preset" Library="Ntve" Id="AA2346C8"/>`,
  `            <Item Type="PresetValue" Library="Hbr1" Id="0000D041"/>`,
  `        </Element>`,
  `        <Element Type="PresetValue" Id="0000D041">`,
  `            <Value>Squawk</Value>`,
  `        </Element>`,
  `    </Library>`,
  `</TriggerData>`,
  ``,
].join("\r\n");

export const STRUCTURE_STRINGS = [
  "﻿Category/Name/lib_Hbr1_00000001=Harbour",
  "Category/Name/lib_Hbr1_00000002=Presets",
  "CustomScript/Name/lib_Hbr1_0000D020=Harbour Script",
  "FunctionDef/Grammar/lib_Hbr1_0000B001=Ring the bell (~times~) times, (~wait~)",
  "FunctionDef/Hint/lib_Hbr1_0000B001=Rings the harbour bell.",
  "FunctionDef/Name/lib_Hbr1_0000B001=Ring Bell",
  "FunctionDef/Name/lib_Hbr1_0000C001=Tide Height",
  "Library/Name/Hbr1=Harbour Tools",
  "ParamDef/Name/lib_Hbr1_0000B002=Times",
  "ParamDef/Name/lib_Hbr1_0000B003=Wait",
  "ParamDef/Name/lib_Hbr1_0000C002=Hour",
  "Preset/Name/lib_Hbr1_0000D030=Bell Tone",
  "Preset/Name/lib_Hbr1_0000D040=Gull Sound",
  "PresetValue/Name/lib_Hbr1_0000D031=Low",
  "PresetValue/Name/lib_Hbr1_0000D032=High",
  "PresetValue/Name/lib_Hbr1_0000D041=Squawk",
  "Structure/Name/lib_Hbr1_0000D001=Crate Record",
  "Trigger/Name/lib_Hbr1_0000000A=Open Quay",
  "Trigger/Name/lib_Hbr1_0000000F=Close Quay",
  "Variable/Name/lib_Hbr1_0000000D=Tide",
  "Variable/Name/lib_Hbr1_00000010=Gate",
  "Variable/Name/lib_Hbr1_0000B005=Count",
  "Variable/Name/lib_Hbr1_0000B007=Label",
  "Variable/Name/lib_Hbr1_0000D002=Weight",
  "Variable/Name/lib_Hbr1_0000D004=Label",
  "",
].join("\r\n");

/** Gives the imported package the whole library, as if it had come with it. */
export async function withStructureLibrary(mod: Mod): Promise<void> {
  await withHarbourLibrary(mod);
  await put(path.join(mod.modPackage, "Triggers"), STRUCTURE_TRIGGERS);
  await put(path.join(mod.modPackage, ...Object.keys(LIBRARY_FILES)[1]!.split("/")), STRUCTURE_STRINGS);
}
