import { Buffer } from "node:buffer";

export type WriteDocumentHeaderOptions = {
  /** Dependency paths, as in DocumentInfo (e.g. "file:Mods\\My-Campaign.SC2Mod"). */
  readonly dependencies?: readonly string[] | undefined;
  /** Localized attributes such as "DocInfo/Name", written for enUS in the order given. */
  readonly attributes: Readonly<Record<string, string>>;
  /** 32-bit value the Editor writes twice; differs per document. */
  readonly documentId: number;
};

// Values copied from maps saved by StarCraft II Editor 5.0.17 (build 98310).
const HEADER_VERSION = 8;
const GAME_VERSION = [5, 0, 17] as const;
const GAME_BUILD = 98310;
const LOCALE = "enUS";

function reversed(fourcc: string): string {
  return [...fourcc].reverse().join("");
}

function sizedString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

/**
 * Writes the binary DocumentHeader. The Editor opens a map without it, but the
 * game client refuses to load one (Test Document fails), presumably because it
 * resolves dependencies from here rather than from DocumentInfo.
 */
export function writeDocumentHeader(options: WriteDocumentHeaderOptions): Buffer {
  const { dependencies = [], attributes, documentId } = options;

  const fixed = Buffer.alloc(48);
  fixed.write("H2CS", 0, "ascii");
  fixed.writeUInt32LE(HEADER_VERSION, 4);
  fixed.write("2S", 8, "ascii"); // "S2" stored reversed, zero-padded
  fixed.writeUInt8(1, 12);
  fixed.writeUInt8(GAME_VERSION[0], 13);
  fixed.writeUInt8(GAME_VERSION[1], 14);
  fixed.writeUInt8(GAME_VERSION[2], 15);
  fixed.writeUInt32LE(GAME_BUILD, 16);
  fixed.writeUInt32LE(GAME_BUILD, 20);
  fixed.writeUInt32LE(0, 24);
  fixed.writeUInt32LE(documentId >>> 0, 28);
  fixed.writeUInt32LE(documentId >>> 0, 32);
  fixed.writeUInt32LE(1, 36);
  fixed.writeUInt32LE(0, 40);
  fixed.writeUInt32LE(dependencies.length, 44);

  const parts: Buffer[] = [fixed];
  for (const dependency of dependencies) {
    parts.push(Buffer.from(`${dependency}\0`, "utf8"));
  }

  const entries = Object.entries(attributes);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(entries.length, 0);
  parts.push(count);
  for (const [key, value] of entries) {
    parts.push(sizedString(key), Buffer.from(reversed(LOCALE), "ascii"), sizedString(value));
  }
  return Buffer.concat(parts);
}
