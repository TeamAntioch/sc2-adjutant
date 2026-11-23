// What marks a file as holding the author's own Campaign, Moons of Shakuras (MofS): its name and
// tools, its Plugin, its Missions and its characters. Core and the example Workspace hold none of
// it; its Campaign Pack, in the author's own Workspace, owns its content and its tests.

/** A pattern's letters in either case, for the parts of a case-sensitive marker that match in any case. */
const anyCase = (text: string) => text.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`);
/**
 * A name counts inside identifiers too (`hero_moloch`, `CharMoloch`, `HaleyLookAt`), in any case
 * after a non-letter and capitalised after a letter, but never as the start of a longer word:
 * `Harrison`, `Whaley` and `hotzones` aren't MofS.
 */
const inIdentifiers = (name: string) => `(?:(?<![A-Za-z])${anyCase(name)}|${name[0]!.toUpperCase()}${name.slice(1)})(?![a-z])`;
const NAMES = ["nazari", "declan", "haley", "moloch", "khrillian", "ivanova", "lorakis", "harris", "edrodar", "rajal", "laurioch", "jepok"];

/**
 * Case-sensitive, as `inIdentifiers` needs, with its other parts in any case: don't add an `i`
 * flag to it. Test it beside a pattern of your own rather than joining their sources.
 */
export const AUTHOR_CAMPAIGN = new RegExp(
  [
    anyCase("mofs"),
    `${anyCase("moons")}[ _-]?${anyCase("of")}[ _-]?${anyCase("shakuras")}`,
    `\\b${anyCase("moons")}-(?:${anyCase("script")}|${anyCase("campaign")}|\\d{4})\\b`,
    anyCase("campaign-moons"),
    `${anyCase("antioch")}\\d`,
    `${anyCase("decaying")}[ _-]?${anyCase("moon")}`,
    `(?:(?<![A-Za-z])${anyCase("hot")}|Hot)[ _-]?${anyCase("zone")}(?![a-z])`,
    ...NAMES.map(inIdentifiers),
  ].join("|"),
);

/**
 * The ids of MofS's own catalog entries, which its Campaign Mod defines: its tilesets, textures,
 * Lights, units, doodads and models (Antioch…, …Moons and Moons… ids among them). They're read from
 * the Campaign Mod (ADR-0011), so core's data files hold none of them, only the game's own entries.
 * Case matters: `Umbra` is MofS's tileset, `umbra` a word.
 */
export const AUTHOR_CAMPAIGN_ENTRIES =
  /\b(?:NewAntioch|Antioch[A-Z]\w*|TornodHighlands|Umbra|HnM_Office\d*|\w+Moons|Moons[A-Z]\w*|TheScylla|CalvinHarris|HamidNazari|MarissaDeclan|HaleyRourke|SM_Moloch)\b/;
