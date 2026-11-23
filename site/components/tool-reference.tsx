// Pieces of the generated reference pages: a tool's description text and its fields (#977), and
// the list of tools a skill or command drives (#978).
import Link from "next/link";

import { type Field, toolNamed, toolHref } from "@/lib/reference";

/** A word shaped like a tool name, such as get_blueprint. */
const TOOL_NAME = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";
/** Splits text into its `code` spans, its words shaped like tool names, and the text between. */
const PARTS = new RegExp(`(\`[^\`]+\`|\\b${TOOL_NAME}\\b)`);
const WHOLE_TOOL_NAME = new RegExp(`^${TOOL_NAME}$`);

/**
 * Text from a tool's schema, with `code` in backticks set as code, and a word that is another
 * tool's name linked to its page.
 */
export function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(PARTS).map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={index}>{part.slice(1, -1)}</code>;
        if (WHOLE_TOOL_NAME.test(part) && toolNamed(part)) {
          return (
            <Link key={index} href={toolHref(part)}>
              <code>{part}</code>
            </Link>
          );
        }
        return part;
      })}
    </>
  );
}

/** A tool's description: a paragraph to each block of text. */
export function Description({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, index) => (
          <p key={index}>
            <Prose text={paragraph.trim()} />
          </p>
        ))}
    </>
  );
}

/**
 * The tools a skill or command drives, each linked to its page beside its title, with a note
 * after those in `noted` (a command's allowed tools).
 */
export function ToolList({ names, noted = [], note }: { names: string[]; noted?: string[]; note?: string }) {
  return (
    // Weighted low in search: a page that drives a tool shouldn't rank beside the tool's own page.
    <dl data-pagefind-weight="0.5" className="my-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr]">
      {names.map((name) => (
        <div key={name} className="contents">
          <dt>
            <Link href={toolHref(name)}>
              <code>{name}</code>
            </Link>
          </dt>
          {/* A space, so search reads the name and the title as two words. */}{" "}
          <dd className="text-slate-400">
            {toolNamed(name)?.title}
            {note && noted.includes(name) && <span className="text-slate-500"> ({note})</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A tool's inputs or outputs: name, type, whether required, and description. */
export function Fields({ fields }: { fields: Field[] }) {
  // Core describes every input (the reference test checks it) but few outputs: leave out an empty column.
  const described = fields.some((field) => field.description);
  return (
    <div className="my-3 overflow-x-auto">
      <table className="fields">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Required</th>
            {described && <th>Description</th>}
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <td>
                <code>{field.name}</code>
              </td>
              <td className="font-mono text-xs text-slate-300">{field.type}</td>
              <td>{field.required ? "yes" : "no"}</td>
              {described && <td>{field.description ? <Prose text={field.description} /> : <span className="text-slate-500">—</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
