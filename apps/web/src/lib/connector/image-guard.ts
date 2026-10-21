import type { LookupFunction } from 'node:net';
import { PRODUCT_IMAGE_RULES, productImageProblem, type ProductImageType } from '@trendlix/shared';

// How the Claude connector fetches a product image (owner, 21 October 2026: "let the mcp connector fetch the product
// photo and add it / yes build it"): Claude gives the link to the maker's image, found with its web search, and this
// website fetches it, here on Vercel, never on the API's server, so a link can't reach the server's own network (the
// database, the OCR and PDF services). Every rule is checked again at each redirect:
// - https only, no user name or password in the link, the default port (443) only;
// - the host resolved here, and refused when ANY of its addresses is private, loopback, link-local (169.254.0.0/16, the
//   cloud metadata address), CGNAT, multicast, documentation, benchmarking or otherwise reserved, IPv4 or IPv6 (IPv6
//   only in 2000::/3, an IPv4-mapped or NAT64 address checked as its IPv4); the connection then goes to a checked
//   address only (the host is never looked up again, so the answer can't change in between);
// - at most 3 redirects; 10 seconds for everything; 5 MB at most, counted while it arrives (cut off past it);
// - the bytes a JPEG, PNG or WebP by their magic numbers (never by Content-Type; SVG refused by name), 100 to 8000
//   pixels a side (packages/shared product-images.ts, which the API checks again);
// - made smaller (1600 px, JPEG) and so re-encoded when the server can (`shrink`, sharp); else kept as fetched.
// Pure code (no "@/" imports): the lookups and the request are given (image-fetch.ts on the server; mocks in the tests).

/** An address a host resolves to. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** What the guard is given. */
export interface ImageFetchDeps {
  /** Every address the host resolves to (A and AAAA). */
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * One GET of `url`, connected to `address` only (the host is never looked up again), redirects not followed, ended
   * when `signal` aborts.
   */
  get: (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<Response>;
  /** The image made smaller and re-encoded; null when it can't be (the image is then kept as fetched). */
  shrink?: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ bytes: Uint8Array<ArrayBuffer>; type: ProductImageType; width: number; height: number } | null>;
}

/** The rules it fetches by (packages/shared PRODUCT_IMAGE_RULES; a shorter time in the tests). */
export interface ImageFetchRules {
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}

export interface FetchedImage {
  ok: true;
  bytes: Uint8Array<ArrayBuffer>;
  type: ProductImageType;
  width: number;
  height: number;
  /** Where it came from in the end, after any redirect. */
  finalUrl: string;
  /** Made smaller and re-encoded by the server; false: kept as fetched (`note` says why). */
  resized: boolean;
  note: string | null;
}

export interface ImageRefusal {
  ok: false;
  reason: string;
}

const refusal = (reason: string): ImageRefusal => ({ ok: false, reason });

// ---------- the addresses ----------

/** An IPv4 address's 4 bytes, or null. */
export function ipv4Bytes(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^(0|[1-9]\d{0,2})$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** An IPv6 address's 16 bytes (with an IPv4 tail, "::ffff:1.2.3.4"), or null; a zone ("%eth0") is no address here. */
export function ipv6Bytes(text: string): number[] | null {
  const raw = text.replace(/^\[|\]$/g, '');
  if (!raw.includes(':') || raw.includes('%')) return null;
  // an IPv4 tail ("::ffff:1.2.3.4") is the last two groups
  let body = raw;
  const tail: number[] = [];
  const lastColon = raw.lastIndexOf(':');
  const last = raw.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = ipv4Bytes(last);
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    const before = raw.slice(0, lastColon + 1);
    body = before.endsWith('::') ? before : raw.slice(0, lastColon);
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const word = (w: string) => (/^[0-9a-f]{1,4}$/i.test(w) ? parseInt(w, 16) : NaN);
  const left = groups(halves[0]).map(word);
  const right = halves.length === 2 ? groups(halves[1]).map(word) : [];
  if ([...left, ...right].some(Number.isNaN)) return null;
  const given = left.length + right.length + tail.length;
  // "::" stands for one group of zeros at least
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const zeros = halves.length === 2 ? new Array<number>(8 - given).fill(0) : [];
  return [...left, ...zeros, ...right, ...tail].flatMap((w) => [w >> 8, w & 0xff]);
}

/** Whether `bytes` start with the `bits` of `prefix`. */
function inRange(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const mask = 0x80 >> (i & 7);
    if ((bytes[byte] & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
}

/** IPv4 ranges never fetched from (RFC 6890 and the IANA special-purpose registry). */
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // shared address space (CGNAT)
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, the cloud metadata address 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation (TEST-NET-1)
  [[192, 31, 196, 0], 24], // AS112
  [[192, 52, 193, 0], 24], // AMT
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[192, 175, 48, 0], 24], // AS112 direct delegation
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation (TEST-NET-2)
  [[203, 0, 113, 0], 24], // documentation (TEST-NET-3)
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, and the broadcast address
];

/** IPv6 ranges never fetched from, inside 2000::/3 (everything outside it is refused too). */
const V6_BLOCKED: [number[], number][] = [
  [[0x20, 0x01, 0x00, 0x00], 23], // IETF protocol assignments: Teredo, benchmarking, ORCHID …
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0x20, 0x02], 16], // 6to4
  [[0x3f, 0xff], 20], // documentation (RFC 9637)
];

/** Whether an IPv4 address (its bytes) is public. */
function publicV4(b: number[]): boolean {
  return !V4_BLOCKED.some(([prefix, bits]) => inRange(b, prefix, bits));
}

/**
 * Whether an address may be fetched from: a public IPv4 address, or a global unicast IPv6 one (2000::/3 outside the
 * ranges above); an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) address as the IPv4 inside it. Anything
 * that isn't an address is refused.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) return publicV4(v4);
  const v6 = ipv6Bytes(address);
  if (!v6) return false;
  if (inRange(v6, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return publicV4(v6.slice(12));
  if (inRange(v6, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return publicV4(v6.slice(12));
  if (!inRange(v6, [0x20], 3)) return false; // loopback, unspecified, unique local, link-local, multicast, the rest
  return !V6_BLOCKED.some(([prefix, bits]) => inRange(v6, prefix, bits));
}

/**
 * A lookup for the connection that answers the address already checked, whatever it is asked: the host is never
 * resolved again, so an answer that changes in between (DNS rebinding) is never used.
 */
export function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options?.all) (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

// ---------- the link ----------

/** A host that is an address itself ("1.2.3.4", "[2001:db8::1]"), without brackets; null for a name. */
function hostAddress(hostname: string): ResolvedAddress | null {
  if (ipv4Bytes(hostname)) return { address: hostname, family: 4 };
  const bare = hostname.replace(/^\[|\]$/g, '');
  return ipv6Bytes(bare) ? { address: bare, family: 6 } : null;
}

/** Why a link isn't fetched (before its host is looked up), or null. */
export function linkRefusal(url: URL): string | null {
  if (url.protocol !== 'https:') return 'Only https:// links are fetched.';
  if (url.username || url.password) return 'A link with a user name or password isn’t fetched.';
  if (url.port !== '' && url.port !== '443') return 'Only links on the standard https port are fetched.';
  const host = url.hostname.toLowerCase();
  if (!host) return 'The link has no host.';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'The link points to this computer, which isn’t fetched.';
  const literal = hostAddress(host);
  if (literal && !isPublicAddress(literal.address)) return `The link points to a private or reserved address (${literal.address}), which isn’t fetched.`;
  return null;
}

// ---------- the fetch ----------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class Aborted extends Error {}

/** `promise`, or Aborted once `signal` aborts (a lookup or a read that never answers can't outlast the 10 seconds). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** The body, at most `max` bytes: null past it (the rest is never read). */
async function readAtMost(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > max) return null;
      chunks.push(value);
    }
  } finally {
    // past the limit, aborted or failed: the rest isn't wanted (a finished stream ignores it)
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The host's addresses, IPv4 first (a server without IPv6 still connects), each checked. */
async function addressesOf(url: URL, deps: ImageFetchDeps, signal: AbortSignal): Promise<ResolvedAddress[] | ImageRefusal> {
  const literal = hostAddress(url.hostname);
  let found: ResolvedAddress[];
  if (literal) found = [literal];
  else {
    try {
      found = await abortable(deps.lookup(url.hostname), signal);
    } catch (err) {
      if (err instanceof Aborted) throw err;
      return refusal(`The image’s host, ${url.hostname}, could not be found.`);
    }
  }
  if (!found.length) return refusal(`The image’s host, ${url.hostname}, could not be found.`);
  const blocked = found.find((a) => !isPublicAddress(a.address));
  if (blocked) return refusal(`${url.hostname} points to a private or reserved address (${blocked.address}), which isn’t fetched.`);
  return [...found.filter((a) => a.family === 4), ...found.filter((a) => a.family !== 4)];
}

/** One request to the first checked address that answers. */
async function getFrom(url: URL, addresses: ResolvedAddress[], deps: ImageFetchDeps, signal: AbortSignal): Promise<Response | ImageRefusal> {
  for (const address of addresses) {
    try {
      return await abortable(deps.get(url, address, signal), signal);
    } catch (err) {
      if (err instanceof Aborted || signal.aborted) throw new Aborted();
    }
  }
  return refusal(`${url.hostname} could not be reached.`);
}

// a Response has `ok` too (false for a 404), so a refusal is told by its reason
const isRefusal = (v: unknown): v is ImageRefusal =>
  !!v && typeof v === 'object' && !(v instanceof Response) && (v as { ok?: unknown }).ok === false && typeof (v as { reason?: unknown }).reason === 'string';

async function fetchWithin(raw: string, deps: ImageFetchDeps, rules: ImageFetchRules, signal: AbortSignal): Promise<FetchedImage | ImageRefusal> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refusal('The image link is not a link.');
  }
  for (let redirects = 0; ; redirects++) {
    const bad = linkRefusal(url);
    if (bad) return refusal(redirects ? `It redirected to ${url.href}: ${bad}` : bad);
    const addresses = await addressesOf(url, deps, signal);
    if (isRefusal(addresses)) return redirects ? refusal(`It redirected to ${url.href}: ${addresses.reason}`) : addresses;
    const res = await getFrom(url, addresses, deps, signal);
    if (isRefusal(res)) return res;

    if (REDIRECTS.has(res.status)) {
      void res.body?.cancel().catch(() => undefined);
      const location = res.headers.get('location');
      if (!location) return refusal(`The image link answered ${res.status} without saying where to.`);
      if (redirects >= rules.maxRedirects) return refusal(`The image link redirected more than ${rules.maxRedirects} times.`);
      try {
        url = new URL(location, url);
      } catch {
        return refusal('The image link redirected to something that isn’t a link.');
      }
      continue;
    }
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => undefined);
      return refusal(`The image link answered ${res.status}: find another link.`);
    }

    const said = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (said === 'image/svg+xml') {
      void res.body?.cancel().catch(() => undefined);
      return refusal('The image is an SVG, which isn’t accepted (it can carry scripts): find a JPEG, PNG or WebP.');
    }
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > rules.maxBytes) {
      void res.body?.cancel().catch(() => undefined);
      return refusal(`The image is larger than ${rules.maxBytes / 1024 / 1024} MB.`);
    }
    const bytes = await readAtMost(res.body, rules.maxBytes, signal);
    if (!bytes) return refusal(`The image is larger than ${rules.maxBytes / 1024 / 1024} MB.`);
    const checked = productImageProblem(bytes);
    if ('problem' in checked) return refusal(checked.problem);

    const image: FetchedImage = { ok: true, bytes, ...checked, finalUrl: url.href, resized: false, note: null };
    if (!deps.shrink) return { ...image, note: 'Kept as fetched: this server can’t make images smaller.' };
    try {
      const smaller = await abortable(deps.shrink(bytes), signal);
      if (!smaller) return { ...image, note: 'Kept as fetched: this server can’t make images smaller.' };
      const again = productImageProblem(smaller.bytes);
      if ('problem' in again) return { ...image, note: 'Kept as fetched: the smaller copy could not be checked.' };
      return { ...image, bytes: smaller.bytes, ...again, resized: true };
    } catch (err) {
      if (err instanceof Aborted) throw err;
      return { ...image, note: 'Kept as fetched: it could not be made smaller.' };
    }
  }
}

/**
 * Fetches the product image at `raw` by the rules above: the image (its bytes, kind and size) or why not, in words for
 * Claude to pass on. Never throws.
 */
export async function fetchProductImage(raw: string, deps: ImageFetchDeps, rules: ImageFetchRules = PRODUCT_IMAGE_RULES): Promise<FetchedImage | ImageRefusal> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rules.timeoutMs);
  try {
    return await fetchWithin(raw, deps, rules, controller.signal);
  } catch (err) {
    if (err instanceof Aborted || controller.signal.aborted) return refusal(`The image took longer than ${rules.timeoutMs / 1000} seconds to fetch.`);
    return refusal('The image could not be fetched.');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
