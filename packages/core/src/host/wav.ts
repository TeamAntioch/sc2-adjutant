// Reading and writing RIFF WAVE files, the one chunk walk and one header every WAV reader and
// writer here shares: a voice file's length, a placeholder's silence and its trim, and the
// wav-to-ogg step's guard.

/** A WAV's fmt and data chunks' bodies, as far as the file holds them. */
export interface WavChunks {
  /** The first fmt chunk's body, before or after the data, or undefined when there is none. */
  readonly format: Buffer | undefined;
  /** The first data chunk's body, or undefined when there is none. */
  readonly data: Buffer | undefined;
}

/**
 * A WAV's fmt and data chunks; undefined when it isn't a RIFF WAVE file. A data chunk whose size is
 * more than the file holds (a streamed WAV's 0xFFFFFFFF) runs to the file's end, as does one whose
 * size is 0 with bytes after it that aren't another chunk: a writer that can't seek back leaves
 * its size unfilled. A size-0 data chunk at the end, or before another chunk, is empty.
 */
export function wavChunks(wav: Buffer): WavChunks | undefined {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return undefined;
  let format: Buffer | undefined;
  let data: Buffer | undefined;
  for (let at = 12; at + 8 <= wav.length && (format === undefined || data === undefined); ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const end = size === 0 && id === "data" && !endsOrChunk(wav, at + 8) ? wav.length : Math.min(at + 8 + size, wav.length);
    const body = wav.subarray(at + 8, end);
    if (id === "fmt " && format === undefined) format = body;
    if (id === "data" && data === undefined) data = body;
    at = end === wav.length ? wav.length : at + 8 + size + (size % 2);
  }
  return { format, data };
}

/** Whether `wav` ends at `at`, or has a chunk there: a printable id, and a size the file holds. */
function endsOrChunk(wav: Buffer, at: number): boolean {
  if (at >= wav.length) return true;
  if (at + 8 > wav.length) return false;
  for (let index = at; index < at + 4; index++) if (wav[index]! < 0x20 || wav[index]! > 0x7e) return false;
  return at + 8 + wav.readUInt32LE(at + 4) <= wav.length;
}

/** The fmt chunk's format tags of uncompressed sample frames: PCM, IEEE float, and extensible. */
const UNCOMPRESSED = new Set([0x0001, 0x0003, 0xfffe]);

/**
 * How long a WAV's samples last, in seconds: 0 when its data chunk holds less than one block,
 * undefined when it isn't a WAV this can read. Uncompressed samples are timed by their sample
 * rate and frame size, as ffmpeg plays them, not by the byte rate the header claims; compressed
 * ones (ADPCM, GSM), whose blocks hold many samples each, by that byte rate.
 */
export function wavSeconds(wav: Buffer): number | undefined {
  const { format, data } = wavChunks(wav) ?? {};
  if (!format || format.length < 16 || !data) return undefined;
  const rate = format.readUInt32LE(4);
  const byteRate = format.readUInt32LE(8);
  const frame = frameBytes(format);
  if (!frame) return undefined;
  if (data.length < frame) return 0;
  if (UNCOMPRESSED.has(format.readUInt16LE(0))) return rate ? data.length / frame / rate : undefined;
  return byteRate ? data.length / byteRate : undefined;
}

/**
 * How many bytes one block of a fmt chunk's samples takes. An uncompressed frame is each channel's
 * sample in whole bytes, as ffmpeg reads it, whatever the header's blockAlign says; a compressed
 * block is as big as blockAlign says.
 */
export function frameBytes(format: Buffer): number {
  if (UNCOMPRESSED.has(format.readUInt16LE(0))) return format.readUInt16LE(2) * Math.ceil(format.readUInt16LE(14) / 8);
  return format.readUInt16LE(12);
}

/** Whether a fmt chunk's samples are 8-bit PCM, which is unsigned: its silence is 0x80. */
export function unsigned8Bit(format: Buffer): boolean {
  if (format.length < 16 || format.readUInt16LE(14) !== 8) return false;
  const tag = format.readUInt16LE(0);
  // An extensible format's subformat GUID starts with the tag it stands for.
  return tag === 0x0001 || (tag === 0xfffe && format.length >= 26 && format.readUInt16LE(24) === 0x0001);
}

/** A plain WAV file: a fmt chunk with `format` as its body, then a data chunk of `data`. */
export function wavFile(format: Buffer, data: Buffer): Buffer {
  const pad = format.length % 2;
  const out = Buffer.alloc(12 + 8 + format.length + pad + 8 + data.length + (data.length % 2));
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(format.length, 16);
  format.copy(out, 20);
  const at = 20 + format.length + pad;
  out.write("data", at, "ascii");
  out.writeUInt32LE(data.length, at + 4);
  data.copy(out, at + 8);
  return out;
}

/** A 16-byte PCM fmt chunk body. */
export function pcmFormat(channels: number, rate: number, bitsPerSample: number): Buffer {
  const format = Buffer.alloc(16);
  const blockAlign = channels * Math.ceil(bitsPerSample / 8);
  format.writeUInt16LE(1, 0); // PCM
  format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(rate, 4);
  format.writeUInt32LE(rate * blockAlign, 8);
  format.writeUInt16LE(blockAlign, 12);
  format.writeUInt16LE(bitsPerSample, 14);
  return format;
}
