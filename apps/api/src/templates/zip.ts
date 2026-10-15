import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// A minimal zip reader and writer, enough for Word files: a .docx is a zip of XML parts (15 October 2026, no new
// dependency). The reader takes only what Word writes: one disk, stored or deflated entries, no encryption, no zip64.
// Uploads come from outside, so it guards against zip bombs: the file's size, the number of entries and the size the
// entries expand to are capped, and an entry is never inflated past the size its header declares. Entries are inflated
// only when read, so checking a template inflates just its text parts. The writer can also copy an entry from another
// zip as it is stored, still compressed: filling a template in rewrites a few XML parts and copies the rest unchanged.

export interface ZipLimits {
  /** The zip file itself. */
  maxBytes: number;
  maxEntries: number;
  /** All entries together, once expanded, as their headers declare (and no entry is inflated past its own). */
  maxExpandedBytes: number;
}

export const ZIP_LIMITS: ZipLimits = { maxBytes: 10 * 1024 * 1024, maxEntries: 2000, maxExpandedBytes: 50 * 1024 * 1024 };

/** Why a zip was refused; the caller says it in words HR understand. */
export type ZipProblem =
  | 'not_zip'
  | 'encrypted'
  | 'zip64'
  | 'too_large'
  | 'too_many_entries'
  | 'expands_too_much'
  | 'unsupported_method'
  | 'damaged';

export class ZipError extends Error {
  constructor(
    readonly problem: ZipProblem,
    detail: string,
  ) {
    super(`Zip refused (${problem}): ${detail}`);
  }
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Where its local header starts. */
  offset: number;
}

export interface ZipArchive {
  entries: readonly ZipEntry[];
  has(name: string): boolean;
  /** The entry's content, inflated and checked against its CRC; null when there is no such entry. */
  read(name: string): Buffer | null;
  /** The entry as stored (not inflated, not checked), to copy into another zip unchanged; null when there is none. */
  raw(name: string): ZipRawEntry | null;
}

/** An entry's bytes as the zip stores them, with what a zip needs to say about them. */
export interface ZipRawEntry {
  /** 0 stored, 8 deflated. */
  method: number;
  /** Of the content. */
  crc: number;
  /** The content's size; `data.length` is the stored size. */
  size: number;
  /** As stored: deflated or not, according to `method`. */
  data: Buffer;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const AES = 99; // WinZip AES encryption, given as a method
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/** Reads a zip's central directory and checks it against the limits; entries are inflated by `read`. */
export function readZip(data: Buffer, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
  if (data.length > limits.maxBytes) throw new ZipError('too_large', `${data.length} bytes`);
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new ZipError('not_zip', 'no end of central directory');

  const disk = data.readUInt16LE(eocd + 4);
  const centralDisk = data.readUInt16LE(eocd + 6);
  const onDisk = data.readUInt16LE(eocd + 8);
  const count = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (count === MAX16 || centralSize === MAX32 || centralOffset === MAX32) throw new ZipError('zip64', 'end of central directory');
  if (eocd >= 20 && data.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) throw new ZipError('zip64', 'zip64 locator');
  if (disk !== 0 || centralDisk !== 0 || onDisk !== count) throw new ZipError('damaged', 'split over several disks');
  if (count > limits.maxEntries) throw new ZipError('too_many_entries', `${count} entries`);
  if (centralOffset + centralSize > eocd) throw new ZipError('damaged', 'central directory out of range');

  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  let expanded = 0;
  let at = centralOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || data.readUInt32LE(at) !== CENTRAL) throw new ZipError('damaged', `central directory entry ${i}`);
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const crc = data.readUInt32LE(at + 16);
    const compressedSize = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const offset = data.readUInt32LE(at + 42);
    const end = at + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw new ZipError('damaged', `central directory entry ${i}`);
    const name = data.toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION) || method === AES) throw new ZipError('encrypted', name);
    if (compressedSize === MAX32 || size === MAX32 || offset === MAX32) throw new ZipError('zip64', name);
    if (method !== STORED && method !== DEFLATED) throw new ZipError('unsupported_method', `${name}: method ${method}`);
    if (method === STORED && compressedSize !== size) throw new ZipError('damaged', `${name}: stored sizes differ`);
    if (byName.has(name)) throw new ZipError('damaged', `${name} twice`);
    expanded += size;
    if (expanded > limits.maxExpandedBytes) throw new ZipError('expands_too_much', `more than ${limits.maxExpandedBytes} bytes`);

    const entry: ZipEntry = { name, method, crc, compressedSize, size, offset };
    entries.push(entry);
    byName.set(name, entry);
    at = end;
  }

  return {
    entries,
    has: (name) => byName.has(name),
    read: (name) => {
      const entry = byName.get(name);
      return entry ? readEntry(data, entry) : null;
    },
    raw: (name) => {
      const entry = byName.get(name);
      return entry ? { method: entry.method, crc: entry.crc, size: entry.size, data: storedBytes(data, entry) } : null;
    },
  };
}

/** The end of central directory record: searched from the end, past a comment of up to 64 KB. */
function findEndOfCentralDirectory(data: Buffer): number {
  const last = data.length - 22;
  for (let at = last; at >= 0 && at >= last - MAX16; at--) {
    if (data.readUInt32LE(at) === EOCD && at + 22 + data.readUInt16LE(at + 20) <= data.length) return at;
  }
  return -1;
}

/** The entry's bytes as stored, after its local header. */
function storedBytes(data: Buffer, entry: ZipEntry): Buffer {
  const { name, offset } = entry;
  if (offset + 30 > data.length || data.readUInt32LE(offset) !== LOCAL) throw new ZipError('damaged', `${name}: local header`);
  const start = offset + 30 + data.readUInt16LE(offset + 26) + data.readUInt16LE(offset + 28);
  const end = start + entry.compressedSize;
  if (end > data.length) throw new ZipError('damaged', `${name}: data out of range`);
  return data.subarray(start, end);
}

function readEntry(data: Buffer, entry: ZipEntry): Buffer {
  const { name } = entry;
  const raw = storedBytes(data, entry);

  let content: Buffer;
  if (entry.method === STORED) {
    content = Buffer.from(raw);
  } else {
    try {
      // never past the declared size: a header that lies about it can't make this expand without end
      content = inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new ZipError('expands_too_much', `${name}: larger than declared`);
      throw new ZipError('damaged', `${name}: ${(err as Error).message}`);
    }
  }
  if (content.length !== entry.size) throw new ZipError('damaged', `${name}: size differs from its header`);
  if (crc32(content) !== entry.crc) throw new ZipError('damaged', `${name}: CRC differs`);
  return content;
}

export interface ZipFile {
  name: string;
  data: Buffer | string;
  /** Kept as is instead of deflated. */
  store?: boolean;
}

/** An entry copied from another zip as it is stored (ZipArchive.raw), so its bytes don't change. */
export interface ZipRawFile {
  name: string;
  raw: ZipRawEntry;
}

/**
 * A zip of these files, in this order (names in UTF-8; strings as UTF-8). Every entry is dated 1 January 1980, so the
 * same files always give the same bytes. For the tests' fixtures, and the filled-in documents.
 */
export function writeZip(files: readonly (ZipFile | ZipRawFile)[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    let method: number, body: Buffer, crc: number, size: number;
    if ('raw' in file) {
      ({ method, data: body, crc, size } = file.raw);
    } else {
      const content = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;
      method = file.store ? STORED : DEFLATED;
      body = file.store ? content : deflateRawSync(content);
      crc = crc32(content);
      size = content.length;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(0x21, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4); // made by: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
