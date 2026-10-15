import { constants, inflateSync } from 'node:zlib';

// How many pages a PDF has, told from its page tree without rendering it: the document catalog (the trailer's /Root)
// names the root of the page tree, whose /Count is the number of pages. Objects are found by their headers
// ("12 0 obj"), in the file and inside compressed object streams, the later of two copies winning, as for a PDF saved
// again with its changes appended (an incremental update). When the tree cannot be followed (a damaged file, or one
// whose objects are encrypted), the answer is null: unknown, never a guess.

const MAX_PAGES = 100_000;
const OBJECT_MAX = 64 * 1024; // an object's text kept at most: a catalog or the root of a page tree is far smaller
const INFLATED_MAX = 64 * 1024 * 1024; // object streams decompressed at most, in all (a tiny file can unzip to gigabytes)
const HEADER = /(?<![\d.])\d+\s+\d+\s+obj\b/;

/** The number of pages of a PDF; null when it cannot be told. */
export function countPdfPages(data: Buffer): number | null {
  const { objects, root, complete } = scan(data);
  if (!complete) return null; // an object stream could not be opened: what it holds may change the answer
  const catalog = root ?? catalogOf(objects);
  if (catalog === null) return null;
  const tree = refIn(objects.get(catalog), 'Pages');
  if (tree === null) return null;
  const pages = intIn(objects.get(tree) ?? '', 'Count');
  return pages !== null && pages >= 1 && pages <= MAX_PAGES ? pages : null;
}

/**
 * Each object's text (its dictionary, for an object with a stream) by its number, the later copy winning; the
 * catalog named by the last trailer (a classic "trailer" dictionary, or a cross-reference stream's) that names one;
 * and whether every object stream could be opened. Stream data is skipped: nothing inside it is taken for an object
 * or a trailer. Every search goes forward only, so a damaged or hostile file takes no longer than a sound one.
 */
function scan(data: Buffer): { objects: Map<number, string>; root: number | null; complete: boolean } {
  const text = data.toString('latin1');
  const objects = new Map<number, string>();
  let root: number | null = null;
  let complete = true;
  let inflated = 0;
  const takeRoot = (dictionary: string) => {
    root = refIn(dictionary, 'Root') ?? root;
  };
  const endobj = finder(text, 'endobj');
  const startxref = finder(text, 'startxref');
  const endstream = finder(text, 'endstream');
  /** The text from `start` to `end`, at most OBJECT_MAX long, and cut at the next object's header (no "endobj"). */
  const bodyOf = (start: number, end: number) => {
    const body = text.slice(start, Math.min(end === -1 ? text.length : end, start + OBJECT_MAX));
    const next = body.search(HEADER);
    return next === -1 ? body : body.slice(0, next);
  };

  // objects and trailers, in the order they come in the file
  const token = /(?<![\d.])(\d+)\s+\d+\s+obj\b|\btrailer\b/g;
  const streamStart = />>\s*stream(?:\r\n|\n|\r)?/g;
  let stream: RegExpExecArray | null | undefined; // the next stream after the current object: found once, not per object
  for (let m = token.exec(text); m; m = token.exec(text)) {
    const start = m.index + m[0].length;
    if (m[1] === undefined) {
      // a classic trailer: its dictionary runs to "startxref"
      const end = startxref(start);
      takeRoot(text.slice(start, Math.min(end === -1 ? text.length : end, start + 1024)));
      continue;
    }
    if (stream === undefined || (stream && stream.index < start)) {
      streamStart.lastIndex = start;
      stream = streamStart.exec(text);
    }
    const body = bodyOf(start, endobj(start));
    if (!stream || start + body.length < stream.index) {
      objects.set(Number(m[1]), body);
      continue;
    }
    const dictionary = text.slice(start, stream.index + 2);
    objects.set(Number(m[1]), dictionary);
    const from = stream.index + stream[0].length;
    const to = endstream(from);
    if (to === -1) break;
    if (/\/Type\s*\/ObjStm\b/.test(dictionary)) {
      const found = objectStream(dictionary, data.subarray(from, to), INFLATED_MAX - inflated);
      if (found) {
        inflated += found.size;
        for (const [number, object] of found.objects) objects.set(number, object);
      } else {
        complete = false;
      }
    } else if (/\/Type\s*\/XRef\b/.test(dictionary)) {
      takeRoot(dictionary);
    }
    token.lastIndex = to;
  }
  return { objects, root, complete };
}

/** Where `word` next comes at or after a position. Positions asked only grow, so each is looked for once. */
function finder(text: string, word: string): (from: number) => number {
  let found = -2;
  return (from) => {
    if (found !== -1 && found < from) found = text.indexOf(word, from);
    return found;
  };
}

/**
 * The objects inside an object stream (PDF 1.5): a header of "number offset" pairs, then the objects; and how large
 * it was once decompressed. Null when it cannot be opened (encrypted, damaged, or larger than `budget`).
 */
function objectStream(dictionary: string, raw: Buffer, budget: number): { objects: [number, string][]; size: number } | null {
  const n = intIn(dictionary, 'N');
  const first = intIn(dictionary, 'First');
  if (n === null || first === null || budget < 1 || /\/DecodeParms/.test(dictionary)) return null;
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dictionary)?.[1].replace(/[[\]\s]/g, '');
  let content: Buffer;
  try {
    if (filter === '/FlateDecode') content = inflateSync(raw, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: budget });
    else if (filter === undefined && raw.length <= budget) content = raw;
    else return null;
  } catch {
    return null;
  }
  const text = content.toString('latin1');
  const pairs = text.slice(0, first).trim().split(/\s+/).map(Number);
  if (pairs.length < 2 * n || pairs.some((v) => !Number.isInteger(v))) return null;
  const objects: [number, string][] = [];
  for (let k = 0; k < n; k++) {
    const start = first + pairs[2 * k + 1];
    const end = k + 1 < n ? first + pairs[2 * k + 3] : text.length;
    objects.push([pairs[2 * k], text.slice(start, Math.min(end, start + OBJECT_MAX))]);
  }
  return { objects, size: content.length };
}

/** The object with /Type /Catalog, for a file whose trailer names none. */
function catalogOf(objects: Map<number, string>): number | null {
  let found: number | null = null;
  for (const [number, body] of objects) if (/\/Type\s*\/Catalog\b/.test(body)) found = number;
  return found;
}

/** The object number of a reference (/Key 12 0 R). */
function refIn(body: string | undefined, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body ?? '');
  return m ? Number(m[1]) : null;
}

/** A whole number given directly (/Key 12), not a reference to one (/Key 12 0 R). */
function intIn(body: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\b(?!\\s+\\d+\\s+R)`).exec(body);
  return m ? Number(m[1]) : null;
}
