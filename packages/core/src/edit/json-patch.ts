// JSON Patch (RFC 6902) over plain JSON values. A patch applies to a copy, all or nothing: the
// first operation that can't apply stops it with the operation's index, path and reason.

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

const PointerSchema = z.string().describe('A JSON Pointer (RFC 6901), such as "/zones/0/polygon/2" or "/anchors/-" to append; "~1" stands for "/" and "~0" for "~"');

export const JsonPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: PointerSchema }).strict(),
  z.object({ op: z.literal("replace"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("move"), from: PointerSchema, path: PointerSchema }).strict(),
  z.object({ op: z.literal("copy"), from: PointerSchema, path: PointerSchema }).strict(),
  z.object({ op: z.literal("test"), path: PointerSchema, value: z.unknown() }).strict(),
]);
export type JsonPatchOperation = z.infer<typeof JsonPatchOperationSchema>;

/** Why a patch couldn't apply: which operation, at which path. */
export class JsonPatchError extends Error {
  constructor(
    readonly index: number,
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${index >= 0 ? `Operation ${index} at` : "At"} ${path || "(root)"}: ${reason}`);
  }
}

/**
 * `document` with `patch` applied, leaving `document` itself unchanged, unless `inPlace` (for a
 * caller holding its own copy), when `document` may be changed, even by a patch that fails.
 */
export function applyJsonPatch(document: unknown, patch: readonly JsonPatchOperation[], { inPlace = false }: { readonly inPlace?: boolean } = {}): unknown {
  let result = inPlace ? document : structuredClone(document);
  patch.forEach((operation, index) => {
    const fail = (reason: string, at = operation.path): never => {
      throw new JsonPatchError(index, at, reason);
    };
    const tokens = (pointer: string): string[] => parsePointer(pointer) ?? fail(`not a JSON Pointer; it must be empty or start with "/", and a "~" must begin "~0" or "~1"`, pointer);
    const needsValue = (): unknown => ("value" in operation && operation.value !== undefined ? operation.value : fail(`a ${operation.op} needs a value`));
    switch (operation.op) {
      case "add":
        result = add(result, tokens(operation.path), structuredClone(needsValue()), fail);
        break;
      case "remove":
        result = remove(result, tokens(operation.path), fail);
        break;
      case "replace": {
        const value = structuredClone(needsValue());
        const path = tokens(operation.path);
        result = path.length === 0 ? value : add(remove(result, path, fail), path, value, fail);
        break;
      }
      case "move": {
        const from = tokens(operation.from);
        const to = tokens(operation.path);
        if (to.length > from.length && from.every((token, i) => token === to[i])) fail(`can't move a value into its own child ${operation.from}`);
        const value = get(result, from, (reason) => fail(reason, operation.from));
        result = add(remove(result, from, (reason) => fail(reason, operation.from)), to, value, fail);
        break;
      }
      case "copy": {
        const value = get(result, tokens(operation.from), (reason) => fail(reason, operation.from));
        result = add(result, tokens(operation.path), structuredClone(value), fail);
        break;
      }
      case "test":
        if (!jsonEqual(get(result, tokens(operation.path), fail), needsValue())) fail("the value isn't the one the test expects");
        break;
    }
  });
  return result;
}

/** The value `pointer` names in `document`; throws a `JsonPatchError` (index -1) when there is none. */
export function readPointer(document: unknown, pointer: string): unknown {
  const fail = (reason: string): never => {
    throw new JsonPatchError(-1, pointer, reason);
  };
  return get(document, parsePointer(pointer) ?? fail(`not a JSON Pointer; it must be empty or start with "/", and a "~" must begin "~0" or "~1"`), fail);
}

/** A pointer's reference tokens, or undefined when it isn't a pointer (or has a `~` not followed by 0 or 1). */
function parsePointer(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** JSON equality (RFC 6902 §4.6): numbers compare by value, so 0 equals -0; objects ignore key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  if (isContainer(a) && isContainer(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return isDeepStrictEqual(a, b);
}

type Fail = (reason: string) => never;
type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container => typeof value === "object" && value !== null;

/** The container holding the last token, and that token. */
function parent(document: unknown, tokens: readonly string[], fail: Fail): { container: Container; key: string } {
  const container = get(document, tokens.slice(0, -1), fail);
  if (!isContainer(container)) fail("its parent is neither an object nor an array");
  return { container: container as Container, key: tokens.at(-1)! };
}

/** An array index token: digits without a leading zero. */
function arrayIndex(key: string, length: number, fail: Fail): number {
  if (!/^(0|[1-9]\d*)$/.test(key)) fail(`${key} isn't an array index`);
  const index = Number(key);
  if (index >= length) fail(`index ${index} is past the end of an array of ${length}`);
  return index;
}

function get(document: unknown, tokens: readonly string[], fail: Fail): unknown {
  let value = document;
  for (const token of tokens) {
    if (Array.isArray(value)) value = value[arrayIndex(token, value.length, fail)];
    else if (isContainer(value) && Object.hasOwn(value, token)) value = (value as Record<string, unknown>)[token];
    else fail(`there is no ${token} here`);
  }
  return value;
}

function add(document: unknown, tokens: readonly string[], value: unknown, fail: Fail): unknown {
  if (tokens.length === 0) return value;
  const { container, key } = parent(document, tokens, fail);
  if (Array.isArray(container)) container.splice(key === "-" ? container.length : arrayIndex(key, container.length + 1, fail), 0, value);
  // Defined, not assigned, so a "__proto__" key is an own key, as JSON.parse makes it, not the prototype.
  else Object.defineProperty(container, key, { value, enumerable: true, writable: true, configurable: true });
  return document;
}

function remove(document: unknown, tokens: readonly string[], fail: Fail): unknown {
  if (tokens.length === 0) fail("can't remove the whole document");
  const { container, key } = parent(document, tokens, fail);
  if (Array.isArray(container)) container.splice(arrayIndex(key, container.length, fail), 1);
  else if (Object.hasOwn(container, key)) delete container[key];
  else fail(`there is no ${key} here`);
  return document;
}
