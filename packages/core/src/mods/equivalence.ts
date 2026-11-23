// The Equivalence Check (ADR-0011): when a mod compile converts a part from Kept to Compiled, the
// part it writes is compared with the Kept original it replaces, normalized for what the Editor
// ignores. A difference the Mod Blueprint names as an Accepted Difference, with its reason, is a
// decision; any other is a bug, and the compile stops before writing anything.
//
// Normalized, by what the part is:
//   XML (catalog entries, triggers and globals, XML files such as cutscenes and layouts): comments,
//     the declaration and whitespace between elements dropped, attributes in any order, numbers by
//     value (400.000000 is 400), and fields in any order, though an array's entries keep theirs; a
//     template's token declarations (<?token?>) are compared, in their order
//   a string: its text, whatever the line ending or trailing spaces
//   a text file (Galaxy, .txt): line endings and trailing spaces
//   any other file: byte for byte
//
// A part rebuilt rather than translated, such as a Cinematic written over a hand-built cutscene,
// is compared by aspect instead (byAspect): each aspect that differs is named on its own, as
// `<item>#<aspect>`, so a difference the Blueprint accepts in one aspect hides none in another.

import { isSplicedKind } from "../triggers/splice-triggers.js";
import { canonicalXml } from "../util/xml.js";

/** A difference the Mod Blueprint means to make: the entry it is in, and why. */
export type AcceptedDifference = { readonly item: string; readonly reason: string };

/** One part the compile converted from Kept: equivalent to the original, or different as the Blueprint accepts. */
export type Conversion = { readonly item: string; readonly accepted?: string };

/** How a part compared by aspect differs from its Kept original: each aspect that does, with where; throws when either can't be read. */
export type Aspects = (kept: string, compiled: string) => readonly { readonly aspect: string; readonly detail: string }[];

/** One part whose compiled output differs from its Kept original, with where. */
export type Mismatch = { readonly item: string; readonly detail: string };

const XML_FILE = /\.(xml|sc2cutscene|sc2layout|sc2style|sc2components)$|^(documentinfo|triggers|preload\.xml)$/i;
const TEXT_FILE = /\.(galaxy|txt)$/i;

/** The compile stopped, writing nothing, because these converted parts differ from their originals. */
export class EquivalenceError extends Error {
  constructor(
    readonly mismatches: readonly Mismatch[],
    /** What names the Accepted Differences: a mod's Mod Blueprint, or a Mission's Mission Blueprint. */
    blueprint = "Mod Blueprint",
  ) {
    super(
      [
        `${mismatches.length} converted part(s) differ from the Kept original${mismatches.length === 1 ? "" : "s"} they replace, so nothing is compiled:`,
        ...mismatches.map((mismatch) => `  ${mismatch.item}: ${mismatch.detail}`),
        `Fix the ${blueprint} so it writes what the original has, or name each intended difference in its acceptedDifferences as { item, reason }.`,
      ].join("\n"),
    );
    this.name = "EquivalenceError";
  }
}

const text = (content: string | Uint8Array): string => (typeof content === "string" ? content : Buffer.from(content).toString("utf8"));

/** How an entry is compared: by its kind, and a file's by its name. */
function formOf(item: string): "xml" | "string" | "text" | "bytes" {
  const kind = item.slice(0, item.indexOf(":"));
  if (kind === "catalog-entry" || isSplicedKind(kind)) return "xml";
  if (kind === "galaxy") return "text";
  if (kind === "string") return "string";
  const name = item.slice(item.lastIndexOf("/") + 1).replace(/^file:/, "");
  if (XML_FILE.test(name)) return "xml";
  if (TEXT_FILE.test(name)) return "text";
  return "bytes";
}

/** `content` normalized for `item`'s form, as lines; undefined for a binary file, compared byte for byte. */
export function normalized(item: string, content: string | Uint8Array): string[] | undefined {
  const form = formOf(item);
  if (form === "bytes") return undefined;
  const raw = text(content).replace(/^\uFEFF/, "");
  if (form === "string") return [raw.slice(raw.indexOf("=") + 1).replace(/\s+$/, "")];
  if (form === "xml") {
    try {
      return canonicalXml(raw).split("\n");
    } catch {
      // Not XML the reader takes: compared as text.
    }
  }
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
    .split("\n");
}

/** Where two normalized forms first part, for the author: `line 3: <LifeMax value="400"> is now <LifeMax value="450">`. */
function firstDifference(kept: readonly string[], compiled: readonly string[]): string {
  const length = Math.max(kept.length, compiled.length);
  for (let index = 0; index < length; index++) {
    const was = kept[index];
    const now = compiled[index];
    if (was === now) continue;
    if (was === undefined) return `the compile adds ${now!.trim()}`;
    if (now === undefined) return `the compile drops ${was.trim()}`;
    return `${was.trim()} is now ${now.trim()}`;
  }
  return "they differ";
}

/** Where `compiled` first differs from the Kept `kept` at `item`, normalized as the check compares them, or undefined when they're equivalent. */
export function difference(item: string, kept: string | Uint8Array, compiled: string | Uint8Array): string | undefined {
  const before = normalized(item, kept);
  const after = normalized(item, compiled);
  if (before && after) return before.join("\n") === after.join("\n") ? undefined : firstDifference(before, after);
  return Buffer.from(kept).equals(Buffer.from(compiled)) ? undefined : "the bytes differ";
}

/** Runs the check over one compile: give `replaceKept` to its PackageOutput, and call `assertPassed` before it writes. */
export class EquivalenceCheck {
  readonly conversions: Conversion[] = [];
  readonly mismatches: Mismatch[] = [];
  /** Accepted differences on a part that turned out equivalent anyway: no longer needed. */
  readonly unneeded: AcceptedDifference[] = [];
  private readonly accepted: ReadonlyMap<string, string>;
  /** What the author should know about a part when it differs, such as the line a placeholder voices, by entry name. */
  private readonly notes = new Map<string, string>();

  /** The parts compared by aspect, each with how its aspects are found. */
  private readonly aspects = new Map<string, { readonly differences: Aspects; readonly aspects: readonly string[] }>();

  constructor(
    accepted: readonly AcceptedDifference[],
    /** What names them, for the refusal: the Mod Blueprint by default. */
    private readonly blueprint = "Mod Blueprint",
  ) {
    this.accepted = new Map(accepted.map((difference) => [difference.item, difference.reason]));
  }

  /** Compares `item` by aspect with `differences`, in place of its normalized form; `aspects` are the ones it can name. */
  byAspect(item: string, differences: Aspects, aspects: readonly string[]): void {
    this.aspects.set(item, { differences, aspects });
  }

  /** The item an Accepted Difference's name is on: `<item>` for an aspect's (`<item>#<aspect>`) of an item compared by aspect, else the name. */
  itemOf(name: string): string {
    const at = name.lastIndexOf("#");
    return at > 0 && this.aspects.has(name.slice(0, at)) ? name.slice(0, at) : name;
  }

  /** Adds `note` to the mismatch at `item`, if there is one. */
  note(item: string, note: string): void {
    this.notes.set(item, note);
  }

  /** Whether `compiled` may replace the Kept `kept` at `item`, as above. */
  readonly replaceKept = (item: string, kept: string | Uint8Array, compiled: string | Uint8Array): boolean => {
    const byAspect = this.aspects.get(item);
    if (byAspect) {
      let differences: ReturnType<Aspects>;
      try {
        differences = byAspect.differences(text(kept), text(compiled));
      } catch (error) {
        this.mismatches.push({ item, detail: (error as Error).message });
        return false;
      }
      return this.replaceByAspect(item, differences, byAspect.aspects);
    }
    const before = normalized(item, kept);
    const after = normalized(item, compiled);
    const same = before && after ? before.join("\n") === after.join("\n") : Buffer.from(kept).equals(Buffer.from(compiled));
    const reason = this.accepted.get(item);
    if (same) {
      this.conversions.push({ item });
      if (reason !== undefined) this.unneeded.push({ item, reason });
      return true;
    }
    if (reason !== undefined) {
      this.conversions.push({ item, accepted: reason });
      return true;
    }
    const detail = before && after ? firstDifference(before, after) : "the bytes differ";
    const note = this.notes.get(item);
    this.mismatches.push({ item, detail: note ? `${detail}: ${note}` : detail });
    return false;
  };

  /** As replaceKept, for a part compared by aspect: each aspect that differs needs its own Accepted Difference. */
  private replaceByAspect(item: string, differences: ReturnType<Aspects>, aspects: readonly string[]): boolean {
    const named = (aspect: string): string => `${item}#${aspect}`;
    let passed = true;
    const refuse = (detail: string, at = item): void => {
      this.mismatches.push({ item: at, detail });
      passed = false;
    };
    if (this.accepted.has(item)) refuse(`it is compared aspect by aspect, so name each aspect that differs (${named("<aspect>")}), not the whole file`);
    const differing = new Set(differences.map((difference) => named(difference.aspect)));
    for (const [accepted, reason] of this.accepted) {
      if (!accepted.startsWith(`${item}#`)) continue;
      if (!aspects.includes(accepted.slice(item.length + 1))) refuse(`acceptedDifferences names ${accepted}, but ${accepted.slice(item.length + 1)} isn't an aspect it's compared by (${aspects.join(", ")})`, accepted);
      else if (!differing.has(accepted)) this.unneeded.push({ item: accepted, reason });
    }
    if (differences.length === 0) {
      if (passed) this.conversions.push({ item });
      return passed;
    }
    for (const { aspect, detail } of differences) {
      const reason = this.accepted.get(named(aspect));
      if (reason !== undefined) this.conversions.push({ item: named(aspect), accepted: reason });
      else {
        this.mismatches.push({ item: named(aspect), detail });
        passed = false;
      }
    }
    return passed;
  }

  /** Fails the check at `item`, an Accepted Removal (`reason`) that `by` writes back: the check expects it gone. */
  expectGone(item: string, reason: string, by: string): void {
    this.mismatches.push({ item, detail: `the Blueprint removes it (${reason}), but ${by} writes it` });
  }

  /** Throws EquivalenceError when any converted part differs without an Accepted Difference. */
  assertPassed(): void {
    if (this.mismatches.length > 0) throw new EquivalenceError(this.mismatches, this.blueprint);
  }
}
