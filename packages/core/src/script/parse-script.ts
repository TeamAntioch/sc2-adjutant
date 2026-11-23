// Parses a Markdown Screenplay, in the format docs/screenplay-format.md documents:
//
//   # 01-3: THE OUTPOST
//   - Chapter: 3
//   ## Scene 1: TITLE
//   > stage direction
//   **RAYNOR** `outpost-01`: [Serious 40]Hold here[/Serious] until …
//   **MATT HORNER**: Understood, sir.
//   **TYCHUS** `outpost-03` *(slowly)*: Sure thing.
//
// The `- Key: value` lines before the first `## ` heading are header fields; list items under a
// later heading, such as a Screenplay's `## Format` notes, aren't. A line may give its own id in
// backticks after the speaker, for a naming template to read. What the conversation, lines and
// sounds are called in the map is up to the Campaign Pack's naming template (see name-script.ts);
// core's default naming uses the Mission id, scene and line, not these ids. In a scene, a
// `**SPEAKER** `id`:` line is dialogue, and so is `**SPEAKER**:` when the speaker is written in
// capitals as Screenplays write them; other bold text, such as `**Note**:`, isn't. A line may
// give how it's delivered in italics before the colon, `*(slowly)*`; it isn't spoken.

export type Mood = "Angry" | "Sad" | "Happy" | "Serious" | "Surprise" | "Fear";

export type TextSpan = {
  readonly text: string;
  readonly mood?: Mood;
  /** 0-100. */
  readonly intensity?: number;
};

export type ParsedLine = {
  readonly kind: "line";
  /** Screenplay speaker, e.g. "RAYNOR". */
  readonly speaker: string;
  /** The line's place among its scene's lines, from 1. */
  readonly position: number;
  /** The id the Screenplay gives the line in backticks, e.g. "outpost-01". */
  readonly scriptId?: string;
  /** How it's delivered, from `*(slowly)*` before the colon: "slowly". Not spoken. */
  readonly delivery?: string;
  /** Text without emotion tags or emphasis marks: what is spoken, and what lines are matched by. */
  readonly text: string;
  /** The text as the game shows it: `*word*` emphasis as `<i>word</i>`, otherwise `text`. */
  readonly shown: string;
  readonly spans: readonly TextSpan[];
};

export type ScriptDirection = { readonly kind: "direction"; readonly text: string };

export type ParsedScene<Line = ParsedLine> = {
  readonly number: number;
  readonly title: string;
  readonly items: readonly (Line | ScriptDirection)[];
};

export type ParsedScript = {
  readonly title: string;
  /** The `- Key: value` header fields before the first scene. */
  readonly fields: Readonly<Record<string, string>>;
  readonly scenes: readonly ParsedScene[];
};

const MOODS = new Set<string>(["Angry", "Sad", "Happy", "Serious", "Surprise", "Fear"]);
const LINE = /^\*\*(.+?)\*\*(?:\s+`([^`]+)`)?(?:\s+\*\(([^)]*)\)\*)?:\s*(.*)$/;
/** The start of a line that can only be dialogue: a speaker, then its id. */
const DIALOGUE_START = /^\*\*[^*]+\*\*\s+`[^`]+`/;
/** A speaker as a Screenplay writes one: capitals, digits, spaces and name punctuation. */
const SPEAKER = /^[A-Z0-9][A-Z0-9 .'’-]*$/;

/** "RAYNOR" -> "Raynor", "VAN DER BERG" -> "VanDerBerg": a speaker's name when its character doesn't give one. */
export function characterName(speaker: string): string {
  return speaker
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** `*word*` emphasis in a line, written as Markdown italics; a lone `*` is left as it is. */
const EMPHASIS = /\*([^*\s](?:[^*]*[^*\s])?)\*/g;

/** A line's text without its emphasis marks, as it is spoken. */
export const unemphasized = (text: string): string => text.replace(EMPHASIS, "$1");

/** A line's text as the game shows it, its emphasis in the game's italic tags. */
export const shownText = (text: string): string => text.replace(EMPHASIS, "<i>$1</i>");

/** Splits `[Mood N]text[/Mood]` tags into spans; untagged text has no mood. */
export function parseSpans(raw: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const tag = /\[(\w+) (\d+)\]([\s\S]*?)\[\/\1\]/g;
  let last = 0;
  for (const match of raw.matchAll(tag)) {
    const [whole, mood, intensity, text] = match;
    if (!MOODS.has(mood!)) continue;
    if (match.index! > last) spans.push({ text: raw.slice(last, match.index) });
    spans.push({ text: text!, mood: mood as Mood, intensity: Number(intensity) });
    last = match.index! + whole.length;
  }
  if (last < raw.length) spans.push({ text: raw.slice(last) });
  return spans.filter((span) => span.text.length > 0);
}

export function parseScript(markdown: string): ParsedScript {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  // "# 02-2: FIRST LIGHT" is titled "FIRST LIGHT": a first word ending in a colon is a prefix.
  // Any other heading is the title whole.
  const heading = /^#\s+(.*)$/.exec(lines.find((line) => line.startsWith("# ")) ?? "")?.[1] ?? "";
  const title = (/^[^\s:]+:\s*(.+)$/.exec(heading)?.[1] ?? heading).trim();

  const fields: Record<string, string> = {};
  const scenes: { number: number; title: string; items: (ParsedLine | ScriptDirection)[]; lineCount: number }[] = [];
  let inHeader = true;
  for (const line of lines) {
    if (line.startsWith("## ")) inHeader = false;
    const scene = /^##\s+Scene\s+(\d+):\s*(.*)$/.exec(line);
    if (scene) {
      scenes.push({ number: Number(scene[1]), title: scene[2]!.trim(), items: [], lineCount: 0 });
      continue;
    }
    const current = scenes.at(-1);
    if (!current) {
      const field = inHeader ? /^-\s+([^:`]+):\s*(.+)$/.exec(line) : null;
      if (field) fields[field[1]!.trim()] ??= field[2]!.trim();
      continue;
    }
    if (line.startsWith(">")) {
      const text = line.replace(/^>\s?/, "").trim();
      if (text) current.items.push({ kind: "direction", text });
      continue;
    }
    const dialogue = LINE.exec(line);
    if (!dialogue) {
      // A line with a speaker and an id is dialogue in a shape this doesn't read; leaving it out would drop it from the map unseen.
      if (DIALOGUE_START.test(line)) {
        throw new Error(`Scene ${current.number}: can't read the dialogue line \`${line}\`: a line is **SPEAKER** \`id\` *(direction)*: text, with the id and the direction optional`);
      }
      continue;
    }
    const [, speaker, scriptId, delivery, raw] = dialogue;
    if (!scriptId && !SPEAKER.test(speaker!.trim())) continue;
    const spans = parseSpans(raw!.trim());
    current.items.push({
      kind: "line",
      speaker: speaker!.trim(),
      position: ++current.lineCount,
      ...(scriptId ? { scriptId } : {}),
      ...(delivery?.trim() ? { delivery: delivery.trim() } : {}),
      text: unemphasized(spans.map((span) => span.text).join("")),
      shown: shownText(spans.map((span) => span.text).join("")),
      spans: spans.map((span) => ({ ...span, text: unemphasized(span.text) })),
    });
  }

  return { title, fields, scenes: scenes.map(({ number, title: sceneTitle, items }) => ({ number, title: sceneTitle, items })) };
}
