// Reads one member out of a zip archive, as community asset packs ship (CurseForge downloads):
// each entry stored or deflated, found through the archive's central directory. Zip64 and
// encrypted archives aren't read.

import { inflateRawSync } from "node:zlib";

/** A zip's members, by name, each with how to read its bytes. */
export function zipMembers(archive: Buffer): Map<string, () => Buffer> {
  const end = endOfDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const out = new Map<string, () => Buffer>();
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error("The archive's central directory is damaged");
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const packedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    // Names are UTF-8 when flag bit 11 says so, else the DOS code page, read here as Latin-1.
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x0800 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    out.set(name, () => {
      if (flags & 0x0001) throw new Error(`${name} is encrypted in the archive`);
      if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name}'s entry in the archive is damaged`);
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const packed = archive.subarray(start, start + packedSize);
      const bytes = method === 0 ? Buffer.from(packed) : method === 8 ? inflateRawSync(packed) : undefined;
      if (!bytes) throw new Error(`${name} is compressed in a way this reader doesn't know (method ${method}): only stored and deflated members are read`);
      if (bytes.length !== size) throw new Error(`${name} came out ${bytes.length} bytes, not the ${size} the archive records`);
      return bytes;
    });
  }
  return out;
}

/** Where the end-of-central-directory record starts: searched from the end, past any comment. */
function endOfDirectory(archive: Buffer): number {
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at--) {
    if (archive.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error("It isn't a zip archive: it has no central directory");
}
