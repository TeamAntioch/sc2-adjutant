import { Buffer } from "node:buffer";

export type WriteComponentVersionOptions = {
  /** Four-character component type from ComponentList, e.g. "plob" for Objects. */
  readonly type: string;
  readonly savedAt?: Date;
  readonly saveCount?: number;
};

// Values copied from a map saved by StarCraft II Editor 5.0.17 (build 98310).
const FORMAT_VERSION = 2;
const GAME_BUILD = 98310;
const EDITOR_FIELDS = [5, 0, 17] as const;

/**
 * Writes the 44-byte "<component>.version" file the Editor expects beside each
 * data component. Without it the Editor reports "Unable to load '<component>'"
 * and silently drops the component (e.g. every placed object).
 */
export function writeComponentVersion(options: WriteComponentVersionOptions): Buffer {
  const { type, savedAt = new Date(), saveCount = 1 } = options;
  if (type.length !== 4) {
    throw new Error(`Component type must be 4 characters: "${type}"`);
  }

  const buffer = Buffer.alloc(44);
  buffer.write("cdes", 0, "ascii");
  buffer.write([...type].reverse().join(""), 4, "ascii");
  buffer.writeUInt32LE(FORMAT_VERSION, 8);
  buffer.writeUInt32LE(GAME_BUILD, 12);
  buffer.writeUInt32LE(EDITOR_FIELDS[0], 16);
  buffer.writeUInt32LE(EDITOR_FIELDS[1], 20);
  buffer.writeUInt32LE(EDITOR_FIELDS[2], 24);
  buffer.writeUInt32LE(GAME_BUILD, 28);
  buffer.writeUInt32LE(saveCount, 32);
  buffer.writeUInt32LE(Math.floor(savedAt.getTime() / 1000), 36);
  buffer.writeUInt32LE(1, 40);
  return buffer;
}

/** "t3Terrain.xml" -> "t3Terrain.version", "Objects" -> "Objects.version". */
export function componentVersionFileName(componentPath: string): string {
  return `${componentPath.replace(/\.[^./]+$/, "")}.version`;
}
