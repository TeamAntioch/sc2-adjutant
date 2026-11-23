# The library interface

A Campaign Mod's GUI trigger library, such as a `Camp` library named Campaign Library, is declared in its Mod Blueprint (`mods/<id>/blueprint.json`, [ADR-0011](../adr/0011-mods-from-mod-blueprints.md)) as its **Library Interface**: the library's id and name, and each function's name, kind, parameters with their types, and the element ids found at Import. Two compiles read it:

- **The mod compile** (`compile-mod`) writes each function into the mod: its FunctionDef and the elements it owns into `Triggers`, its names into `TriggerStrings.txt`, and its Galaxy into `Base.SC2Data/Lib<id>.galaxy` and `Lib<id>_h.galaxy` as the Editor generates them on save. A function that was Kept is converted under the Equivalence Check, Galaxy included.
- **Mission compiles** call the library's functions as typed trigger primitives ([ADR-0002](../adr/0002-typed-gui-trigger-primitives.md)) read from the interface. A Campaign Pack's Mechanic gets them from `context.library.function("<identifier>")`, so no Plugin keeps a hand copy of the library's ids.

The code is `packages/core/src/domain/library-interface.ts` (the declaration and the GUI Body), `packages/core/src/mods/library-xml.ts` (the Editor's XML, read and written), `packages/core/src/mods/library-galaxy.ts` (the Galaxy) and `packages/core/src/mods/library.ts` (the compile's part, and the Campaign Library Mission compiles read).

## A declaration

```json
"library": {
  "id": "Camp",
  "name": "Campaign Library",
  "functions": [
    {
      "id": "B8B27D5C",
      "name": "Send Transmission (Talking)",
      "identifier": "SendTransmissionTalking",
      "kind": "action",
      "grammar": "Send (~conversationLine~) from (~unit~) using portrait (~portrait~), (~waitUntilDone~). …",
      "parameters": [
        { "id": "30598D6A", "name": "Conversation Line", "type": { "type": "convline" }, "preload": true },
        { "id": "D9698A59", "name": "WaitUntilDone", "type": { "type": "preset", "element": "Ntve/00000020" }, "default": { "id": "7A09F448", "preset": "Ntve/00000067" } }
      ],
      "gui": "library/SendTransmissionTalking.json"
    },
    {
      "id": "D879D70A",
      "name": "Capitalize",
      "kind": "function",
      "flags": ["native"],
      "returns": { "type": "string" },
      "parameters": [{ "id": "12277F5C", "name": "input", "type": { "type": "string" } }],
      "galaxy": { "path": "Base.SC2Data/scripts/StringSupport.galaxy", "source": "scripts/StringSupport.galaxy" }
    }
  ]
}
```

- A reference to another library's element is `<library>/<id>`, as the Editor writes `Library="Ntve" Id="00000067"`. The library's own elements are named by id alone.
- `kind` is the Editor's FlagAction, FlagCall (`function`), FlagCondition or FlagEvent. `flags` holds its other flags without the prefix: `native`, `createThread`, `hidden`, `inline`, `noScriptPrefix`, `subFunctions`, `allowBreak` (a block whose slots may stop its loop), `operator`, `restricted`.
- `section` is the Editor's Section (`"Shared"`, `"Armory"`), and `deprecated` its Deprecated. A deprecated function's Galaxy heads its statements `// Deprecated`; a Section changes none (`editor-trigger-rules.md`).
- `name`, `grammar`, `hint`, and each parameter's and variable's `name`, are the strings the Editor shows. `identifier` is the Galaxy name the Editor was given; without one the Galaxy name comes from the name.

## The body

**GUI is the default**, for any function an author would open in the Editor. `gui` names its **GUI Body**: a JSON file in the mod's folder holding the function's local variables and its actions, as typed calls stored as data.

```json
{
  "variables": [{ "id": "FE187E39", "name": "Sound Duration", "type": { "type": "fixed" }, "value": { "id": "93734C9E", "type": "fixed", "value": "0" } }],
  "actions": [
    {
      "id": "E3386143",
      "function": "Ntve/00000136",
      "params": [
        { "id": "762C6292", "def": "Ntve/00000219", "variable": "FE187E39" },
        { "id": "7662A9C8", "def": "Ntve/00000220", "call": { "id": "C607FAE6", "function": "Ntve/C0749AB9", "params": [ … ] } }
      ]
    },
    { "id": "D941CB7C", "comment": "" }
  ]
}
```

A call names its `function` and, inside a block such as If Then Else, its slot (`sub`). Its `params` each name the callee's parameter (`def`) and hold one value: a `preset`, a set of bits (its preset type, `presetElement`, and the values set, `bits`, either left out where the Editor leaves it out), a literal (`type` with its `value`, `valueId` (the Editor's `ValueId`: a difficulty's or a player color's number, an ability command's index, one more than a sound's variation), `typeInfo`, `gameType`, `context` and `valueParams`; `typeInfo` is the Editor's `ValueTypeInfo`, such as how an ability command targets), a `call`, a `variable` of the library (with the `member` it names, when it holds a structure), one of the function's own `parameter`s, a `trigger` of the library, or `customScript`, Galaxy text standing for a value, with its `customType`. A block's own calls are its `body`. Custom Script (`Ntve/00000123`) holds its own Galaxy as `script`.

```json
{ "id": "C973E611", "def": "Ntve/B4ACF12A", "variable": "663B6404", "member": { "id": "C87FE82C", "variable": "111A5B24" } }
{ "id": "378EE8F5", "def": "Ntve/00000176", "trigger": "5465C0CF" }
{ "id": "1AE8D236", "def": "Ntve/B68F0E3F", "customScript": "\"BlackoutFade/BlackoutFrame\"", "customType": "layoutframe" }
{ "id": "ADBD47B3", "function": "Ntve/00000123", "script": "libCamp_gv_cutscenePlaying_String = \"\";" }
```

A parameter limited to several presets lists them: `"preset": ["Ntve/C5797A54", "Ntve/ED11A5DE"]`.

**Galaxy is for code that's naturally text**: math, strings, physics, debug. A `native` function's body is the script file at `galaxy.path` in the package, written whole from `galaxy.source` in the mod's folder. The file must define the function's Galaxy name. Several functions may share one file.

## Categories and the other items

The interface also declares what the library files beside its functions, each with its names in `TriggerStrings.txt`:

```json
"library": {
  "id": "Camp",
  "name": "Campaign Library",
  "root": ["category:9C164C63", "category:F09BCE30"],
  "categories": [
    { "id": "F09BCE30", "name": "Scripts", "identifier": "Scripts", "label": "Ntve/00000016", "items": ["custom-script:44504F01", "function:28E797D0"] }
  ],
  "functions": [ … ],
  "presets": [
    { "id": "21F06425", "name": "Preset - Wait or Don't Wait", "baseType": "int", "custom": true, "constants": true,
      "values": [{ "id": "21F79A76", "name": "Wait", "value": "0" }, { "id": "89E06085", "name": "Not Wait", "value": "1" }] }
  ],
  "structures": [
    { "id": "62EEFC1A", "name": "Player Stats Record", "members": [{ "id": "111A5B24", "name": "Kills", "type": { "type": "int" }, "value": { "id": "F404CB12", "type": "int", "value": "0" } }] }
  ],
  "comments": [{ "id": "722C8A4B", "comment": "Point of this:\n…" }],
  "customScripts": [{ "id": "44504F01", "name": "campMain (This Runs 1st)", "identifier": "campMain", "script": "include \"scripts/camp-main\"", "initFunction": "campMain" }]
}
```

- **Categories** are the Editor's trigger folders. Each lists the items filed in it, in order, as `<kind>:<id>`: `category`, `function`, `trigger`, `variable` (a global), `preset`, `structure`, `comment` or `custom-script`. A category may file an item that's still Kept: its line is written, and its elements stay as the package has them. An item is filed once, in `root` or one category. A category can't be filed inside itself.
- **`root`** is the library's Root, in order. Convert-library sets it the first time it converts an item other than a function. An item of the interface that no category files goes at the end of Root.
- A **preset type** has its base type and values, each with its name and value. `custom` is PresetCustom, `constants` is PresetGenConstVar (Galaxy gets a constant for each value), `extends` names the preset type it extends, and `default` marks a value's DefinesDefault.
- A **structure**'s members are variables, written as a GUI Body's are.
- A **comment** filed among the items is its text.
- **Custom script** is its Galaxy as it stands, with its identifier, label and init function.
- An item with no name in TriggerStrings has none here, and gets no string.

The compile writes them into `Triggers` in the order the Editor saves them. It walks Root depth first, each item's elements and then a category's items. So once the interface and the Blueprint's `triggers` own every item, `Triggers` comes out byte for byte the Editor's. The compile doesn't write their Galaxy. It leaves the Editor's in `Lib<id>.galaxy` and its header. After changing a preset type, structure or custom script in the Blueprint, save the mod in the Editor so its Galaxy follows.

The compile refuses:

- a category or Root filing an item that neither the Blueprint nor the package has;
- a category the compile writes that no longer files a Kept item filed there, which would be lost;
- an item filed twice;
- an item whose id is another kind of element in the package.

## Triggers and globals

The library's triggers and globals are the Mod Blueprint's `triggers`. That's a Triggers file in the mod's folder, its items filed in its Root, with the name of each trigger, global and trigger's local variable by element id:

```json
"triggers": { "source": "library/triggers.xml", "names": { "86158D55": "Test", "92C1AAEF": "BQ" } }
```

`convert-triggers` (`convert_triggers`) writes Kept triggers and globals there, as the Editor wrote them, keeping their ids. The interface's categories file them where the Editor had them. The compile writes the names into `TriggerStrings.txt` and refuses a name for an element the file doesn't have. A disabled trigger stays disabled.

```sh
npm run convert-triggers -- mods/<id>/blueprint.json [--item <name or id>]...
```

## Stable ids

Ids found at Import are kept forever, since Missions call the library by them. The compile refuses an interface that would renumber what the package already has:

- a function or parameter of the same name under another id;
- a parameter the package has that the interface drops, whether renamed under a new id or gone;
- a function the last compile wrote that the interface drops;
- a new parameter whose id another element of the package already has;
- an element id two of the interface's functions share, or one function uses twice: their own, their parameters', defaults' and block slots', and every call, value and comment in their GUI bodies.

For example:

```text
The library interface would renumber imported ids:
  Ring Bell's parameter Times is 0000B0FF in the interface, but the package has it as 0000B002: imported ids are kept, so Missions calling it don't break; give it 0000B002
```

## Converting from Kept

`convert-library` (`convert_library`) writes Kept functions into the interface mechanically, keeping their ids, and the library's other items, as above. A GUI function's body goes in `library/<identifier>.json`. A native function's body is the one script file in the package that defines it, copied into the mod's folder (`scripts/…` for `Base.SC2Data/scripts/…`). The next `compile-mod` converts them under the Equivalence Check, by item:

| Item | What's compared |
|---|---|
| `function:<id>` | the FunctionDef and every element it owns, as XML |
| `category:<id>`, `preset:<id>`, `structure:<id>`, `comment:<id>`, `custom-script:<id>` | the item's element and those it owns (a preset type's values, a structure's members), as XML |
| `trigger:<id>`, `variable:<id>` | a trigger or global of the Blueprint's `triggers`, with every element it owns, as XML |
| `string:…TriggerStrings.txt:<key>` | each name, grammar and hint |
| `galaxy:Base.SC2Data/Lib<id>.galaxy:<name>` | the function's definition, by line |
| `galaxy:Base.SC2Data/Lib<id>_h.galaxy:<name>` | its declaration |
| `file:<path>` | a Galaxy body's script file |

A function stays Kept, with the reason, when:

- its XML holds a form the conversion doesn't write yet (a text value, or a type naming an element of another kind than its type's);
- its Galaxy can't be written as the Editor would: a call to a function the game's libraries don't define, an Editor template macro the rules below don't list, an `#INITAUTOVAR` of a constant or of a value of any type whose own type it can't tell, a block with no template but If Then Multiple, a literal type they don't list, a color that isn't opaque, a function that runs in its own thread and returns a value, custom script standing for a value over more than one line or a Custom Script call where a value is wanted, or an operator other than a comparison, an arithmetic or a conversion;
- its Galaxy would come out otherwise than the Editor's, with the first difference;
- no one script file defines a native function.

**A Campaign Mod (2026-11-01):** 52 of its 97 functions convert, and compile with no Accepted Difference. Kept library items went from 213 to 159. The other 45 stay Kept for the reasons above. The most common are value type info (6), functions with no GUI body of their own, such as inline ones (5), struct members (4) and custom script in a call (4). Breadth conversion widens the reader and the Galaxy writer one reason at a time. The Equivalence Check catches any rule they get wrong.

**The same mod (2026-11-02, #327):** with value type info, the `unitfilter`, `actormsg`, `color` and `gameoption` literals, the Arithmetic operators, `#PARAM` and `#AUTOVAR` templates, If Then Multiple and null initial values, 75 of the 97 functions convert, 21 more than the 54 of a fresh import before (the 52 above predates later fixes), and compile with no Accepted Difference. The library's `Lib<id>.galaxy`, its header and `TriggerStrings.txt` come out byte for byte the Editor's. The other 22 stay Kept for struct members, custom script, functions with no GUI body of their own and functions that run in their own thread. *Blackout Fade (Threaded)* was Kept for its value type info; it now waits on its own thread.

**The same mod (2026-11-02, #328):** with custom script (Custom Script calls and values), structure members, triggers as values, functions that run in their own thread, inline functions, a Switch typed by its value, and a parameter's several presets, **all 97 functions convert** and compile with no Accepted Difference of the library's. The library's `Lib<id>.galaxy`, its header and `TriggerStrings.txt` come out byte for byte the Editor's, and a recompile changes nothing. *playTalkingTransmission* and the cutscene functions keep their custom script as `script` in their GUI bodies, as the Editor has it, so their bodies stay GUI.

**The same mod (2026-11-02, #329):** `convert-library` also converts the library's 34 categories, 8 preset types, 4 structures, 4 comments and 4 custom scripts, and `convert-triggers` its 9 triggers and 17 globals. Nothing in `Triggers` is left Kept. `Triggers`, `TriggerStrings.txt`, `Lib<id>.galaxy` and its header come out byte for byte the Editor's, and a recompile changes nothing. `TriggerStrings.txt` keeps 5 lines no item owns: 3 SVN conflict lines and the names of 2 triggers the library no longer has (`dummy`, `dummy 2`). The author confirmed them as removals.

## The Galaxy

The compile writes each GUI function's Galaxy as the Editor generates it on save. Lib<id>.galaxy and its header are derived from Triggers, so an Editor save regenerates them, as it does a map's `MapScript.galaxy`. The compile therefore writes them whole, with the Editor's Galaxy for every Kept function left as it is. The Editor-changes check doesn't ask about them.

A function the author kept as the Editor changed it (`--keep function:<id>`) keeps its Galaxy as the Editor wrote it, with its XML. A function the last compile wrote that is now disabled, renamed or Galaxy-bodied loses its old definition and declaration, since the Editor writes none for it.

The rules, each checked against a Campaign Mod's Editor-saved `Lib<id>.galaxy`:

- A function is `lib<library>_gf_<identifier>`. A native one is its bare identifier. A parameter is `lp_`, a local `lv_` and a global `lib<library>_gv_`, each its identifier, or its name's started lower case.
- A call to a function the game's libraries define with a ScriptCode template (If Then Else, Set Variable, Or …) is written from the template, with its macros filled in:
  - `#PARAM(p)` is the value given for `p`. `#PARAM(p,"sep")` is each value given for a repeated `p`, joined by `sep`, so Combine Strings is `(a + b + c)`.
  - `#SUBFUNCS(slot)` is the slot's statements, and `#SUBFUNCS(slot,"sep")` its conditions joined. `#IFHAVESUBFUNCS(slot,x)` is `x` when the slot holds a statement.
  - `#IFSUBFUNC(notfirst,x)` is `x` when the call isn't the first in its parent's slot.
  - `#AUTOVAR(v)` and `#AUTOVAR(v, type)` are the call's own variable `auto<call id>_v`, an `int` when no type is given. `#AUTOVAR(v,parent)` and `#AUTOVAR(v,ancestor:<identifier>)` are the variable of the call's parent, or of its nearest enclosing call to that function, as Picked Unit names Pick Each Unit's.
  - `#INITAUTOVAR(v,p)` sets the call's own variable `v`, of `p`'s type, to `p`'s value: `auto<call id>_v = <value>;`.
- The call variables are declared under `// Automatic Variable Declarations`, followed by a blank line. Each call's come at its macros' first use, in the order the body holds the calls, not the order they're written. So an If Then Else whose Else the Editor stores first declares the Else's first.
- If Then Multiple has no template. It's its If Thens one after another, each after the first an `else if`.
- A Switch's `#INITAUTOVAR(val,value)` is of the type of the value it switches on: a parameter's, a variable's, a structure member's, a literal's or a call's return.
- Custom Script is its own text, line by line, indented where it stands. A value of custom script is its text.
- A structure's member is `<variable>.lv_<member>`, its identifier, or its name's, started lower case. A trigger of the library is `lib<library>_gt_<identifier>`, or its name's.
- An inline function has a definition of its own, as any function. A call to an inline function giving a value is that value, its single Return's. A call to an inline action is a call, as any other.
- A function that runs in its own thread (`createThread`) is written as three parts. First come the global `trigger auto_<function>_Trigger = null;` and one global `auto_<function>_lp_<parameter>` per parameter, then a blank line. Next, the function stores its parameters in those globals, creates the trigger once (`TriggerCreate("auto_<function>_TriggerFunc")`) and runs it with `TriggerExecute(…, false, false)`. Last, the trigger's function `bool auto_<function>_TriggerFunc (bool testConds, bool runActions)` takes each parameter back into its own `lp_` local, then holds the body as any function's and ends with `return true;`. A blank line follows the parameters in both, when there are any. Its header declaration is the function's alone.
- A native call is its identifier and arguments in definition order, and any other call is `lib<library>_gf_<identifier>(…)`. A comparison or an arithmetic is `(a op b)`, and a conversion is `(value)`. Comments and disabled calls aren't written.
- Literals: an ability command is `AbilityCommand("<ability>", 0)`, its type info left out. A unit filter is `UnitFilter(…)` from its `<required>;<excluded>` flags, as the Mission compile writes it. An opaque color (`255,r,g,b`) is `Color(…)` in percentages. An actor message, a game option and its value, and a file path are quoted strings.
- Of the blank lines a template leaves, one stays at its end and none inside it. A blank line is left where a macro is filled with nothing, and by a slot's own line break. So an If Then with no Else is followed by one blank line, at any depth, and so is an Action Group, whose template is its slot: one, even where its last action leaves its own. An If Then with an Else is followed by none. The statements in a slot keep their own blank lines.
- A local starting at Galaxy's zero (`int 0`, `fixed 0`, `bool false`) or at a `null` preset value gets no initialization; an empty string gets `""`.

The game's definitions are in `packages/core/data/trigger-libraries.json`, generated from the install's CASC storage. Ntve comes from `mods/core.sc2mod/base.sc2data/triggerlibs/nativelib.triggerlib` and Hots from `mods/swarm.sc2mod/base.sc2data/triggerlibs/swarmlib.sc2lib`. To refresh it after a patch, with a CASC extractor named in `SC2_CASC_TOOL` ([tools/README.md](../../tools/README.md)), run:

```sh
npm run build -w @team-antioch/sc2-adjutant && node packages/core/scripts/build-trigger-libraries.mjs "/Applications/StarCraft II"   # extracts both with SC2_CASC_TOOL (tools/README.md)
```

Given a folder that already holds the game's data extracted (one with its `mods` folder, in any case), such as a game-data mirror, the script reads it in place and needs no extractor.

The data also holds what the Editor's function list shows, for `search_trigger_functions`. Each function has its name, hint and category (its categories' names from the outermost, joined by ` > `, such as `Unit Group > Groups`), read from each mod's `TriggerStrings.txt` and the library's categories. Each parameter and preset type has its name, and each library its name (Ntve is Built-In, Hots is Swarm). `types` holds the Editor's name of each trigger type (`unitgroup` is Unit Group), from core's `EditorStrings.txt` (`EDSTR_TRIGGERTYPE_<type>`). A mod library in reach takes the same from its interface or its package's Triggers and strings.

For `write_blueprint_trigger` (#1033) it holds what a new call needs: each parameter's `default`, the value a new call gets in the Editor, read from its ParamDef's `<Default>` as a mod library's is (`readLibraryParameterDefault`, in the library's form: `{ "id": "522FCB51", "type": "fixed", "value": "5" }` for Periodic Event's Duration); each preset value's name and each preset type's `values`, in the Editor's order; and each block slot's name and what it holds, under `slots` (`"00000004": { "name": "Then", "holds": "action" }`). A mod library in reach takes them from its interface or its package.

Since #1061, `defaultTexts` holds the words of each text a parameter's default holds, by the Id of the value holding it, from the mod's `GameStrings.txt` (`Param/Value/lib_<library>_<id>`): `"682BA409": "Boss"` for Display Boss Bar's Title. A key the GameStrings lack is an empty text (`""`), as the Editor reads one, so a call that leaves such a parameter out writes `StringToText("")` or the words. A mod library in reach takes them from its interface's `strings` or its package's enUS GameStrings; without either, a call must give the text. Each global and structure member of a mod library in reach carries its `name`, from TriggerStrings or its interface, so a trigger can name it.

## Searching functions

`search_trigger_functions` searches the functions in reach of a Mission: the game's libraries and those of the Workspace mods its dependencies load (`librariesInReach`). Without a Mission it searches the game's. A query matches words of the name or identifier, words of the category, a kind (action, function, condition, event), the types of parameter a function takes and its return type. A type is matched by the Editor's name (Unit Group) or its own (`unitgroup`). A parameter of a preset type shows its preset's name, and a game link shows its catalog (`Game Link - Behavior`). Each hit gives its name, library, category, kind, parameters' names and types, return type and hint. Its Ids are given only when asked for. A library whose calls are all refused is named, with why.

The same lookup is core's `resolveFunction(libraries, name, { library })` (`packages/core/src/mods/function-search.ts`). It takes a name or identifier in any case, or a `<library>/<id>`, and finds the one function, its Ids with it. When two functions share the name, it reports them all as ambiguous until a library is given, by id or name. The authoring tool resolves its calls with it (`editor-trigger-rules.md`, "Writing a trigger in the Editor's terms").

## Mission compiles

The Campaign Pack names the Campaign Mod, and the Mission compile reads that mod's library interface. Each function there is a primitive, keyed by its Galaxy identifier. Its parameters are keyed by their identifier, started lower case, in definition order, and its Galaxy call is `lib<library>_gf_<identifier>(…)`. A map that calls it includes `Lib<library>` and calls `lib<library>_InitLib()`, after the game's libraries. It also includes the game's libraries that the mod's dependencies bring: SwarmLib with Swarm's mod (`Mods/Swarm.SC2Mod`), and SwarmLib and VoidCampaignMissionLib with Void Story's campaign (`Campaigns/VoidStory.SC2Campaign`). That is why a Mission on a Void Story mod includes both with the mod's library. Other game packages bring none that core knows. Block functions (an If Then), templates, inline functions and disabled functions aren't primitives. The Editor writes no Galaxy for a disabled function, so a call to one fails the compile, which says to enable it.

When the Campaign Mod's Blueprint can't be read, the Workspace hasn't imported the mod, or the mod is an Asset Mod or declares no library, a call to it fails and says which.

A Mechanic calls a function the interface doesn't declare, and the compile fails:

```text
The Campaign Mod Bell-Story's library Bel1 has no function RingGong (its interface, mods/bell-story/blueprint.json, declares RingBell)
```

## UI Components' functions

A UI Component the Mod Blueprint turns on in `ui` ([ADR-0019](../adr/0019-ui-components-from-sc2layout.md), `packages/core/src/ui/`) adds its functions to the library without the interface declaring them. Each one is a GUI function:

- Its id is derived from the component's id and the function's name, `ui/<component>/<function name>`, and so are its parameters' ids (`…/parameters/<name>`) and its body's (`…/body`). They're the same compile after compile and whatever the look, so Kept triggers, Editor triggers and Missions can call them by id. Renaming a component's function renumbers it.
- It's filed in the library's **UI** category (its id from `ui/category`, with the Editor's User Interface icon), which goes at the end of Root unless a category of the interface files it.
- It's an action, or, when the component gives it a return type, a function of kind `function` (`FlagCall`) with that `ReturnType`, so Kept and Editor triggers can use it as a value, such as a picker's chosen option (an `integer`) or whether a moment is playing (a `boolean`).
- Its body is one Custom Script action holding the component's Galaxy. Its parameters are `lp_` and their identifier started lower case, as for any GUI function, and its Galaxy goes in `Lib<id>.galaxy` and its header as the Editor writes them. A function with a return type returns its value from that Galaxy, on every path. A body may `Wait`, as any GUI function that isn't a condition may, holding up the trigger that calls it until it returns.

A component with state (the boss bar's unit and refresh loop, a toast queue) also has a **script**: Galaxy at the library's top level, holding its globals and the helpers its functions call. It's one Custom Script of the library, named for the component (`BossBar`, its layout's name, where it has a layout), its id from `ui/<component>/script`, filed first in the UI category. The compile writes its Galaxy into `Lib<id>.galaxy`'s Custom Script section, before the functions, as the Editor writes a Custom Script on save, replacing the one of that name a recompile finds, and ends the section with the library's `lib<id>_InitCustomScript`, which `InitLib` calls before `InitTriggers`, as the Editor does for any library with a Custom Script. A script the last compile wrote and this one doesn't (its component off, or left without one) leaves the Galaxy, and a renamed component's leaves under its old name; once no block is left, the section, its empty InitCustomScript and the call go too. An author's own Custom Scripts are never touched, and the compile and `check` refuse a component's script named as one of the library's Custom Scripts, the interface's or a Kept one, since each block is found by its name. Every name the script defines is `lib<id>_ui_<component>_<name>`, which no name the Editor gives can be. Its globals take no initial value but a constant; the game starts each at its zero.

The compile refuses a component's function whose Galaxy name one of the interface's own functions has, and `ui` in a mod that declares no library. Core refuses a component whose function both returns a value and runs in its own thread, which hands nothing back, and one whose Blueprint trigger action calls a function that returns a value, since an action can't take a value into a variable yet. Turning a component off drops its functions, which fails the compile as any dropped function does, since Missions may call them.

A Mission calls them from its `uiActions`: each entry names a component's action (`showBossBar`) and its `params`, at a cue, with an optional `afterSeconds`. It compiles into its own trigger, `UI <id>`, which the cue's trigger runs without waiting. A Mission whose action belongs to a component its Campaign Mod hasn't turned on fails its compile and `check`:

```text
uiActions.0 (greet): showTestPanel is an action of the UI Component testPanel, which the Campaign Mod Bell-Story hasn't turned on: add ui.testPanel to its Mod Blueprint (mods/bell-story/blueprint.json)
```

An action's params name a unit by its unit Anchor's or Kept unit's id; any other id fails the compile and `check`, naming the param: `uiActions.0 (boss): unit tide-king is neither a unit Anchor nor a Kept unit of the Mission`.

### The boss bar

`ui.bossBar` (`packages/core/src/ui/boss-bar.ts`) is a boss's name over its health, its shields when it has them, and up to four phase marks, at the top centre of `ConsoleUIContainer`. Its look follows LotV's boss frame: `border`, `fill`, `flash` and `backing` textures (LotV's `@UI/LotV_Shared_InGame_BossBar*` keys and `white.dds`), `titleStyle` (`Void_BossUnitFrameUnitName`), `shieldColor`, `greyColor`, `markColor` and `anchor` (top, 100 px down). The default textures and font style come from the Void and Swarm campaigns' data, so the mod must depend on Void Story (Campaign), or override them.

| Function | What it does |
|---|---|
| Show Boss Bar (Unit, Title, Colour, Mark 1-4) | Shows the bar for the unit, replacing any bar showing. A mark is a fraction of the bar (0.5 is halfway); 0 leaves it out. |
| Hide Boss Bar | Hides the bar and stops its refresh. |
| Flash Boss Bar | Flashes the border's highlight, as a hit does, unless the bar is greyed out. |

While the bar shows, a refresh loop runs every 0.25 s of game time. It sets both fills, flashes the bar when the unit's life and shields fall, greys the fills and desaturates the border while the unit is invulnerable, and hides the bar when the unit dies. When the mod turns on `ui.heroMoment` too, the bar hides while a hero moment plays and comes back at the loop's next pass after it; without the moment, its Galaxy doesn't name it.

```json
{ "id": "boss", "cue": { "type": "beatStarts", "beatId": "duel" }, "action": "showBossBar", "params": { "unit": "tide-lord", "title": "The Tide Lord", "color": [200, 0, 0], "phaseMarks": [0.66, 0.33] } }
```

`color` defaults to LotV's green and `phaseMarks` to none. `hideBossBar` takes no params.

### The toast

`ui.toast` (`packages/core/src/ui/toast.ts`) is a panel at the right edge of `ConsoleUIContainer`, in the upper third of the screen: an icon, a one-line title and text that wraps to two lines. It slides and fades in from the right, stays, and fades out, about 4 s in all. The fades are the script's (`DialogControlFadeTransparency`), not the layout's: in game, a layout Fade animation paused at its end left every later toast see-through. It only shows a toast: what counts as an achievement, and whether it's saved, is the campaign's.

Its look is core's own, so it works in any mod. Every default was checked at the pinned mirror `sc2-arcade-watcher/sc2-game-data` @ `7be8945`:

| Field | Default | Where it's from |
|---|---|---|
| `background` | `@UI/Glues_Battlenet_ToastBg`, nine-sliced | core.sc2mod `AssetsProduct.txt` l. 225, the battle.net toast's |
| `icon` | `Assets\Textures\UI_Glues_HelpMenu_AchievementIcon.dds` | core.sc2mod `Assets.txt` l. 563 |
| `titleStyle` | `StandardTooltipHeader_White` | core.sc2mod `FontStyles.SC2Style` l. 445 |
| `textStyle` | `StandardTooltip` | core.sc2mod `FontStyles.SC2Style` l. 435 |
| `sound` | `UI_Achievement` | liberty.sc2mod `SoundData.xml` l. 30927 |
| `anchor` | top right, 260 px down | It slides in from the right edge, so only `topRight`, `right` and `bottomRight` are taken. |

Core defines no sound but `EditorDefaultSound`, so the sound comes from Liberty (Mod), which every melee and campaign mod depends on.

| Function | What it does |
|---|---|
| Show Toast (Icon, Title, Text, Sound) | Queues a toast. An empty icon or sound is the look's. A toast shown while 8 are waiting is dropped. |

The queue is the toast's script. Its loop plays one toast at a time, with 0.25 s between them. Before each toast it waits while any player is in cinematic mode, and a toast's time counts only outside cinematic mode, so a toast fired during a cutscene shows once play resumes. When the mod turns on `ui.heroMoment` too, the queue also waits, and a toast's time stops, while a hero moment plays; without the moment, its Galaxy doesn't name it. Cinematic mode means NativeLib's: the Editor's Cinematic Mode action (`libNtve_gf_CinematicMode`), which every compiled Mission scene uses. A trigger calling the `CinematicMode` native directly, as the cutscene test-play scripts do, isn't seen.

```json
{ "id": "rung", "cue": { "type": "beatStarts", "beatId": "bell" }, "action": "showToast", "params": { "title": "Bell Ringer", "text": "You rang the harbour bell.", "icon": "Assets\\Textures\\btn-quay-bell.dds", "sound": "UI_ObjectiveComplete" } }
```

`title` and `text` are required. A title is one line, measured by its letters' widths rather than counted: at most 26.5 ordinary letters wide, where W and M count about 1.8, m and w 1.5, other capitals 1.2, and i, l and punctuation 0.5. That's about 24 ordinary letters ("Master of Western Waters" is 26.4) or 14 W's. A text is at most 60 characters, with no line breaks. The compile and `check` refuse longer ones. Both labels shrink their text rather than cut it off (`ScaleToPreventTruncation`, as the info panel's unit names do), but only so far: in game on 2026-11-11, "Master of Western Waters" shrank and fitted while 24 W's were still cut off. The text wraps: its label is 56 px high, two full lines, and 60 W's and m's shrank into three lines and fitted. At 44 px it didn't wrap. A GUI call of Show Toast isn't checked, so keep to them there too. Neither takes text markup (`<n/>`, `<c val=…>`): it would break lines, and the title's width counts the letters shown. `icon` is an image file's path (`Assets\Textures\x.dds`, not an asset key such as `@UI/…`, which the icon's image property doesn't take), and `sound` is a Sound's id (letters, digits and underscores). Both default to the look's, and the look's `icon` is held to the same rule.

### The choice picker

`ui.choicePicker` (`packages/core/src/ui/choice-picker.ts`) is a "pick one of up to 3" panel, such as a hero's level-up choice (spec #652). It sits in `FullscreenUpperContainer`, not `ConsoleUIContainer`, so hiding the console doesn't hide it. A dim covers the screen, LotV's hex glow shimmers in its four corners, and a header and a prompt stand over one set of cards per count:

- With 1 card, it stands in one of the 2-card set's slots, the left by default (`oneCardSlot`), so the hero stays in view as with 2. A single card is a story grant (Grant Hero Power, below), and the author chose the slot over the middle on 2026-11-12.
- With 2, the cards stand one each side, 480 px apart, so the camera can frame the hero between them.
- With 3, they stand in a row.

Each card is a button with LotV's screen frame, the Nerazim War Council emblem behind an icon, a title, a description and its hotkey (`[ 1 ]`). The War Council's selection glow shows on the chosen card. Its look and sounds were chosen in an in-game test.

The default look needs LotV's campaign data, as the boss bar's does, so the mod must depend on Void Story (Campaign), or override it. Every default was checked at the pinned mirror `sc2-arcade-watcher/sc2-game-data` @ `7be8945`:

| Fields | Defaults | Where they're from |
|---|---|---|
| `frameBackground`, `frameCornerTop`, `frameCornerBottom` | `@UI/LoTV_Shared_ScreenFrame_BG_Small`, `…_Corner_Top`, `…_Corner_Bottom` | void.sc2campaign `Assets.txt` l. 25-27 |
| `frameBackgroundColor`, `frameCornerColor` | `150,255,220`, `140,255,215` | the demo |
| `emblem`, `emblemHover` | `@UI/LotV_StoryMode_ArmyUpgrade_Faction_Nerazim_Normal`, `…_Hover` | void.sc2campaign `Assets.txt` l. 212, 211 |
| `selectionGlow` | `@UI/LotV_StoryMode_ArmyUpgrade_Faction_SelectionGlow` | void.sc2campaign `Assets.txt` l. 185 |
| `backdrop`, `backdropShimmer` | `@UI/LoTV_Shared_ScreenFrame_HexGlow`, `…_HexGlowShimmer` | void.sc2campaign `Assets.txt` l. 28-29 |
| `backdropColor` | `0,255,170` | the demo |
| `dimColor`, `dimAlpha` | `0,8,6`, 120 (of 255) | the demo |
| `headerStyle` | `TutorialVictoryPanelStageNumber` | swarm.sc2campaign `FontStyles.SC2Style` l. 612 |
| `promptStyle`, `titleStyle`, `descriptionStyle`, `hotkeyStyle` | `InfoPaneHeroWeapon`, `ExitGameTitle`, `InfoPaneUnitSubtitle`, `GameFrameLargeBottomButton` | core.sc2mod `FontStyles.SC2Style` l. 366, 489, 332, 810 |
| `headerColor`, `promptColor`, `titleColor`, `descriptionColor`, `hotkeyColor` | `180,255,240`, `132,210,255`, `255,255,255`, `200,230,224`, `0,255,170` | the demo |
| `openSound`, `selectSound` | `UI_ShipUpgrade_BG_YellowFlash`, `UI_ArmyRoom_ButtonClick_Confirm` | void.sc2campaign `SoundData.xml` l. 1446, 12615 |
| `hoverSound`, `closeSound` | `UI_Void_Roll_Over_3`, `UI_Void_Launch_Actuate_1` | void.sc2mod `SoundData.xml` l. 9688, 9596 |
| `twoCardGap` | 480 px | the demo |
| `oneCardSlot` | `left`: the 2-card set's slot the single card stands in, `left` or `right` | the author, 2026-11-12 |
| `anchor` | the centre, 75 px up | the demo's place for the labels and cards |

The `anchor` places the labels and cards; the dim and backdrop fill the screen. The font styles are stock ones with the demo's fonts, sizes and justification and no glow. None has the demo's colours, so the functions colour the text from the colour fields (`TextWithColor`).

| Function | What it does |
|---|---|
| Set Choice Option (Index, Icon, Title, Description) | Fills card Index (1-3) for the next Show. The icon is an image file's path, as the toast's is; an empty one shows none. |
| Show Choice Picker (Header, Prompt, Count) → integer | Shows Count cards (1-3), waits for a click or a key 1 to Count, and gives the pick, 1-based. It gives 0 if Hide Choice Picker closed the picker first. While a picker shows, another Show gives 0 at once, so show one at a time. |
| Hide Choice Picker | Hides the picker at once, as at a mission's end. |
| Choice Picker Is Open → boolean | Whether the picker shows, from its Show until it has faded out. |

Show Choice Picker runs the whole picker itself, all in real time:

1. It fades the panel in over 0.25 s, with the cards rising 60 px (their `CardIn` animation) and fading in 0.06 s apart.
2. It plays the hover sound once per card the mouse enters.
3. On a pick, it shows the chosen card's glow, raises it 18 px (`Chosen`), fades the others, and fades the panel out over 0.3 s.

It has no close: Escape does nothing. The sounds are played from code, not from the layout's `HoverSound` and `ClickSound`, so a key and a click sound alike. The script hooks up the frames and creates its triggers on the first Show: one for clicks and mouse-enter on the cards, and one for keys 1-3, which ignores keys while the picker is closed. The functions are for the mod's own triggers. There's no Blueprint trigger action: Show Choice Picker returns a value, which an action can't take into a variable yet.

### The hero moment

`ui.heroMoment` (`packages/core/src/ui/hero-moment.ts`) is a hero's level-up moment (spec #652): the world freezes but for the hero, the camera zooms in on the hero and sways, a glow plays, and play resumes when the mod's trigger ends it. In between, the mod's trigger shows the choice picker, once for each choice. It has no layout: it drives the units, the camera and the game's own UI, so it writes no layout file and adds nothing to the DescIndex. Its look and sounds were chosen in the same in-game test.

| Function | What it does |
|---|---|
| Begin Hero Moment (Hero) → boolean | Waits its turn, then gives false, doing nothing, if the hero is dead. Otherwise it plays the moment's start and gives true, about 1.5 s in, once the burst has played. |
| End Hero Moment | Returns the camera, waits the hand-back, unfreezes everything and shows the UI and the selection again. The glow fades after it returns. It does nothing when no moment plays. |
| Hero Moment Is Playing → boolean | Whether a moment plays: from Begin's turn until End returns. |
| Hold Hero Moments For Line | For an in-play line about to play: waits while a moment plays, every 0.25 s of game time, then holds moments off until Release Hero Moments After Line. Compiled Missions call it. |
| Release Hero Moments After Line | For an in-play line that has played: lets moments play again once every line holding them off has released them. Compiled Missions call it once for each hold. |
| Flash Hero (Hero) | The stat-level flash: the flash model on the hero, scaled, with the flash sound, in a thread of its own. It pauses nothing and waits for nothing, so during a moment it plays at once. |
| Grant Hero Power (Hero, Header, Prompt, Icon, Title, Description) | A story grant dressed as a level-up: Begin Hero Moment, a choice picker of one card (the power granted), then End Hero Moment, once the card is picked. It changes no level or experience and grants nothing itself, so the trigger that calls it gives the hero the power after it returns. It does nothing if Begin gives false. Only when the mod turns `ui.choicePicker` on too, since it calls the picker's functions. |

Begin Hero Moment, in order:

1. **It waits its turn**, every 0.25 s of game time:
   - while any player is in cinematic mode (NativeLib's flag, as the toast reads it);
   - while another moment plays, so two Begins play one after the other;
   - while an in-play line plays. The script's global `lib<library>_ui_heroMoment_linesPlaying` counts the lines holding moments off: Hold Hero Moments For Line adds one, and Release Hero Moments After Line takes one away. It's a count because two can hold at once: an in-play line waiting for its turn, and a trigger scene's lines after its handback. Compiled in-play lines call them (see "Missions on a mod with the moment" below).
2. **It plays the sting**: one sound, or two layered.
3. **It freezes everything but the hero.** Every live unit, missiles included, is paused with `libNtve_gf_PauseUnit` and sent `AnimSetPausedAll`. A re-sweep every 0.25 s of real time freezes units created during the moment. AI time and mission time pause. The hero is paused without an anim pause, so the hero keeps animating and the glow plays. In game, missiles froze in flight and carried on afterwards.
4. **It hides the game UI**: every sync frame type but BattleUI, remembering which showed, then fullscreen UI mode, with the messages cleared and drag-select off. It stores and clears the owner's selection (`libNtve_gf_StoreUnitSelection`).
5. **It moves the camera**, the hero's owner's: it saves it (`CameraSave`), locks it, and pans and zooms to the hero over the zoom time. It then sways in real time: the yaw goes either side of the zoomed yaw, and the height either side of the height offset, each leg eased into the next.
6. **It puts on the glow**: the burst model at the hero's feet, removed after 1.5 s; the aura model there, tinted; and the glaze actor.

End Hero Moment stops the sway and restores the camera (`CameraRestore`, over 1 s), then waits the hand-back time. It then unfreezes the units, the hero and AI and mission time, restores the UI and the selection, and returns. After it returns, the aura and glaze fade (`SetOpacity`) over the glow's fade and are removed, in a thread of their own. Everything but the wait for its turn runs in real time. End puts back what Begin changed, not what was so before: it unpauses every unit the freeze froze, even one the Mission had paused, and resumes AI and mission time, drag-select and the console UI mode. So pause a unit, or AI or mission time, after a moment rather than across one.

The look, all the demo's:

| Field | Default |
|---|---|
| `stingSounds` | `UI_AC_Zeratul_BladeOn` and `Protoss_PowerUpLarge` (liberty.sc2mod `SoundData.xml` l. 5017, 31913), layered; one or two Sounds' ids |
| `camera` | `distance` 13, `pitch` 22, `yawOffset` 15 (degrees from the player's yaw), `heightOffset` 1.2, `zoomSeconds` 0.8 |
| `sway` | `yaw` 5 (degrees either side), `height` 0.25, `yawSeconds` 4, `heightSeconds` 5 (each leg) |
| `handBackSeconds` | 0.4 |
| `glowFadeSeconds` | 2 |
| `burstModel` | `ShadowManifestationModel` (void.sc2campaign `ModelData.xml` l. 2515) |
| `auraModel` | none: the mod's own `CModel` |
| `auraTint`, `auraHdr` | `0,255,171` at 3: green-cyan |
| `glazeActor` | none: the mod's own `CActorModelMaterial` |
| `flashModel`, `flashScale` | `HeroicAuraImpact` (void.sc2campaign `ModelData.xml` l. 4578) at 2.25× |
| `flashSound` | `Protoss_PowerUpSmall` (liberty.sc2mod `SoundData.xml` l. 31920) |

The default models come from LotV's data, so the mod must depend on Void Story (Campaign), or override them. The sounds are Liberty (Mod)'s, which every campaign mod depends on. Every default was checked at the pinned mirror `sc2-arcade-watcher/sc2-game-data` @ `7be8945`.

**The aura and glaze are the mod's own data.** A component writes layouts and library functions, not game data, so these two look fields name entries the mod defines. With either left out, the moment plays without it, and its Galaxy is left out of the script:

- **`auraModel`** names a `CModel`. It may point at a model file of any campaign by path: in game, a co-op `.m3` loaded from a map's `CModel`. The moment attaches it to the hero at `Ref_Origin` with `libNtve_gf_AttachModelToUnit`, then tints it with `SetTintColor` (`auraTint`, `auraHdr`), which recolours an effect model.
- **`glazeActor`** names a `CActorModelMaterial` with `parent="GlazeParent"`. Its model is a glaze `CModel` (`parent="Glaze"`), and it holds `ActorCreation → ModelMaterialApplyTo ::Main`. The moment sends `Create <id>` to the hero and fetches the actor with `ActorFromScope(ActorScopeFromUnit(hero), id)`. To take it off, it sends `ModelMaterialRemoveFrom ::Main`, then `Destroy Immediate`. A glaze's colour must be set in its data: in game, `SetTintColor` sent to a glaze from a trigger did nothing, though `SetOpacity` faded it. So the look has no glaze tint.

```json
"ui": { "choicePicker": {}, "heroMoment": { "auraModel": "LevelUpAura", "glazeActor": "LevelUpGlaze" } }
```

The functions are for the mod's own triggers, as the picker's are, but for Grant Hero Power: a Mission calls it as the action `grantHeroPower`, at a cue, as a story beat that fires from the Mission's own trigger rather than from experience (an opening Mission's alley brawl grants the hero a warp blade so). Its params are `hero` (a unit Anchor's or Kept unit's id), `title` and `description` (the card), and optionally `icon` (an image file's path) and the picker's `header` and `prompt`, each empty when left out. A Mission whose Campaign Mod turns on `ui.heroMoment` but not `ui.choicePicker` fails its compile and `check` on it:

```json
{ "id": "peal", "cue": { "type": "beatStarts", "beatId": "duel" }, "action": "grantHeroPower", "params": { "hero": "ringer", "icon": "Assets\\Textures\\btn-quay-bell.dds", "title": "The Peal", "description": "The bell rings twice." } }
```

Begin Hero Moment itself has no action, since it returns a value. An action's `needs` names the other components its function calls, which the Campaign Mod must turn on too. The other components defer to a moment only when the mod turns it on too: the toast's queue waits, and the boss bar hides, while one plays.

#### Missions on a mod with the moment

When the Campaign Mod turns on `ui.heroMoment`, a Mission's compile makes what it plays and times wait for a moment (#656, spec #652 decision 6). It finds the moment's functions in the library by their ids. Without the moment, a Mission compiles exactly as before.

- **In-play lines.** Each compiled in-play line calls Hold Hero Moments For Line before it plays and Release Hero Moments After Line once it has played. That covers script lines and the lines of a Blueprint's own Screenplay scenes cued in play. So a moment begun during a line waits for its end, and a line due while a moment plays waits for End Hero Moment.
- **Lines a trigger scene may cut off** ([ADR-0013](../adr/0013-trigger-scenes-pre-empt-in-play-lines.md)). Such a line holds moments off from before it waits for its turn. It keeps holding them through its replays, until it has played uncut.
- **A trigger scene's lines.** The lines in its shots need nothing: they play in cinematic mode, which a moment waits out. Its lines after the handback play out of cinematic mode, so its Lines trigger holds moments off from before the first to after the last. The scene's flag `trigger_scene_<id>_moment_held` records that it holds them. When the scene plays again and its Setup stops those lines, the Setup releases the hold if the flag is set.
- **Clocks.** A Mission with clocks (goal timers, or timers a Mechanic declares) gets the trigger "Clocks Hero Moment". From map init, it runs "Clocks Hold" when Hero Moment Is Playing turns true and "Clocks Release" when it turns false, polling every 0.25 s of game time. So a clock may run up to 0.25 s into a moment. These are the triggers a run of scenes uses. With the moment on, they count their holders (`clocks_holders`), so a moment and a run of scenes that overlap pause the clocks at the first hold and let them go at the last release. The clocks are game-time timers, which the moment's mission-time pause doesn't stop (see `editor-and-engine.md`, "Game time, AI time and mission time").
- **Waves, and the delayed cues and encounter timers.** They wait on AI time ([ADR-0008](../adr/0008-compiling-waves-and-raids.md)), which Begin pauses and End resumes, so they need nothing more.
- **Not held:** transmissions sent by Kept triggers, whose Kept code is left alone; Wave warnings' transmissions; and the game-time waits of transitions and of `uiActions`' `afterSeconds`, as during a scene.

