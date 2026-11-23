import type { MDXComponents } from "mdx/types";
import { isValidElement, type ReactNode } from "react";

import { Claude, ToolCall, You } from "@/components/briefing";
import { slugOf } from "@/lib/slug";

/** The text in a heading, through any inline markup (`code`, emphasis, links). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A heading's id from its text, so "on this page" and #links can find it. */
const slug = (children: ReactNode) => slugOf(textOf(children));

const components: MDXComponents = {
  h2: ({ children }) => <h2 id={slug(children)}>{children}</h2>,
  h3: ({ children }) => <h3 id={slug(children)}>{children}</h3>,
  // Code blocks are searchable but weighted low: a tutorial's tables and reports are full of numbers.
  pre: (props) => <pre {...props} data-pagefind-weight="0.2" />,
  // A tutorial's turns (#980). Its page gives each <Objective> the tutorial it's in.
  You,
  Claude,
  ToolCall,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
