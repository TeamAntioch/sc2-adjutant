// The dependency list in a package's binary DocumentHeader, which the game resolves a map's
// dependencies from (DocumentInfo is the Editor's). The layout, as write-document-header.ts writes
// it and every Editor-saved version-8 header read so far has it: `H2CS`, then version, signature,
// game version and build fields to byte 44, the dependency count there (u32), that many C strings,
// then the localized attributes.
import { Buffer } from "node:buffer";

const MAGIC = "H2CS";
/** The byte the dependency count is at; the strings follow it. */
export const DEPENDENCY_COUNT = 0x2c;

/** DocumentHeader's dependency strings, in its order, and the byte after the last (where the attributes start); throws on a header that isn't one or is cut short. */
export function readDocumentHeader(header: Buffer): { readonly dependencies: string[]; readonly end: number } {
  if (header.length < DEPENDENCY_COUNT + 4 || header.toString("ascii", 0, 4) !== MAGIC) throw new Error(`DocumentHeader: not a ${MAGIC} header`);
  const count = header.readUInt32LE(DEPENDENCY_COUNT);
  const dependencies: string[] = [];
  let offset = DEPENDENCY_COUNT + 4;
  for (let index = 0; index < count; index++) {
    const end = header.indexOf(0, offset);
    if (end < 0) throw new Error(`DocumentHeader: its dependency ${index + 1} of ${count} runs past the end`);
    dependencies.push(header.toString("utf8", offset, end));
    offset = end + 1;
  }
  return { dependencies, end: offset };
}

/** DocumentHeader's dependency strings, in its order; throws as `readDocumentHeader` does. */
export const readDocumentHeaderDependencies = (header: Buffer): string[] => readDocumentHeader(header).dependencies;

/** The header with its dependency list replaced by `dependencies`, the rest kept byte for byte; throws as `readDocumentHeader` does. */
export function withDocumentHeaderDependencies(header: Buffer, dependencies: readonly string[]): Buffer {
  const { end } = readDocumentHeader(header);
  const fixed = Buffer.from(header.subarray(0, DEPENDENCY_COUNT + 4));
  fixed.writeUInt32LE(dependencies.length, DEPENDENCY_COUNT);
  return Buffer.concat([fixed, ...dependencies.map((value) => Buffer.from(`${value}\0`, "utf8")), header.subarray(end)]);
}
