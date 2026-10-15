// Scanning from the office's network scanners (owner's request: take a document "from the scanner directly, check it,
// then confirm it"). A browser cannot reach a scanner, so a small app on each HR computer, the TrendLIX Scan Helper
// (tools/scan-helper, for Mac and Windows), drives the scanners (eSCL/AirScan) and listens on this computer only. The page
// talks to it straight from the browser: nothing passes through the web server. It answers https://people.trendlix.com
// and http://localhost:3000 only. Its errors are JSON { error } with the sentence to show; when it cannot be reached at
// all, a plain sentence is shown instead.
//
// The pure parts (the file name from Content-Disposition, the error sentences, the default settings) are tested in
// scan-helper.test.ts. Nothing here touches the page, so it can be imported anywhere; it only runs in a browser.

/** Where the helper listens, on the HR computer itself. */
export const SCAN_HELPER_URL = 'http://127.0.0.1:47815';

/** What the helper calls itself in GET /v1/status: another program on the same port is not taken for it. */
export const SCAN_HELPER_APP = 'trendlix-scan-helper';

/** The helper's downloads (public/downloads, built in tools/scan-helper). */
export const SCAN_HELPER_DOWNLOADS = {
  mac: '/downloads/TrendLIX-Scan-Helper-mac.zip',
  windows: '/downloads/TrendLIX-Scan-Helper-windows.zip',
} as const;

/** Glass (eSCL "Platen") or document feeder. */
export type ScanSource = 'platen' | 'feeder';
export type ColorMode = 'color' | 'grayscale' | 'bw';

/** A scanner the helper found on the network, or that was added by its address, with what it can do. */
export interface Scanner {
  id: string;
  name: string;
  /** Its eSCL address, e.g. http://192.168.1.50/eSCL. */
  url: string;
  secure: boolean;
  sources: ScanSource[];
  /** Whether its feeder scans both sides of each page. */
  duplex: boolean;
  colorModes: ColorMode[];
  /** In dpi, smallest first. */
  resolutions: number[];
  formats: string[];
  /** Added by its address (Add by IP address) rather than found. */
  manual: boolean;
}

export interface HelperStatus {
  app: string;
  version: string;
}

/** How to scan, as chosen in the scan window. */
export interface ScanSettings {
  source: ScanSource;
  /** Both sides of each page; only with the feeder of a scanner that can. */
  duplex: boolean;
  colorMode: ColorMode;
  resolution: number;
}

export interface ScanOptions extends ScanSettings {
  scannerId: string;
}

/** What a scan gives: one PDF with every page, and how many pages it has when that is known. */
export interface ScanResult {
  file: File;
  pages: number | null;
  /** What the helper warns about the scan (X-Scan-Warning), e.g. that only part of what the scanner sent is in it. */
  warning: string | null;
}

/**
 * Why a call to the helper failed, in a sentence to show (`message`). `kind`: it could not be reached (not running, or
 * not installed), it took too long, it was cancelled (by the person, or by closing the window), or it answered with an
 * error (`status`: 409 busy, 422 feeder empty, 502 scanner error, 504 the scanner did not answer in time…).
 */
export class ScanHelperError extends Error {
  readonly kind: 'unreachable' | 'timeout' | 'cancelled' | 'refused';
  readonly status: number | undefined;

  constructor(message: string, kind: ScanHelperError['kind'], status?: number) {
    super(message);
    this.name = 'ScanHelperError';
    this.kind = kind;
    this.status = status;
  }
}

/** How long to wait, in milliseconds. A scan ends at the helper after 2 minutes (504): its answer is waited for. */
export const TIMEOUTS = {
  status: 1500,
  /** While the browser may be asking whether this site can reach devices on the local network (see localNetworkPermission). */
  statusAsking: 60_000,
  scanners: 30_000,
  add: 20_000,
  /** From the glass: one page. The helper itself gives up after 2 minutes without progress. */
  scan: 150_000,
  /** Through the document feeder: the helper's 2 minutes restart with each page, so a long batch may take longer. */
  scanFeeder: 600_000,
} as const;

export const UNREACHABLE = "The TrendLIX Scan Helper can't be reached. Make sure it is running on this computer, then try again.";
export const CANCELLED = 'Scanning was cancelled.';

/** What the helper means by a status when it gives no sentence of its own. */
const STATUS_MESSAGES: Record<number, string> = {
  400: "The scanner didn't accept these settings. Choose other settings, then scan again.",
  403: "The TrendLIX Scan Helper doesn't take requests from this site.",
  404: "That scanner wasn't found. Press Refresh, choose the scanner again, then scan.",
  409: 'The scanner is busy with another job. Wait until it has finished, then scan again.',
  422: 'The document feeder is empty. Put the pages in the feeder, then scan again.',
  502: 'The scanner reported a problem. Check it (paper jam, open cover, a message on its screen), then scan again.',
  504: "The scanner didn't answer in time. Check that it is on and awake, then scan again.",
};

/** The sentence to show for an error answer of the helper: its own `{ error }`, else one for the status. */
export function helperErrorMessage(status: number, body: string): string {
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  } catch {
    // not JSON: the status says it
  }
  return STATUS_MESSAGES[status] ?? `The TrendLIX Scan Helper couldn't do that (error ${status}). Try again.`;
}

/** The sentence to show for anything a call to the helper threw. */
export function scanErrorMessage(error: unknown): string {
  return error instanceof ScanHelperError ? error.message : 'Something went wrong while scanning. Try again.';
}

export const isCancelled = (error: unknown) => error instanceof ScanHelperError && error.kind === 'cancelled';
export const isUnreachable = (error: unknown) => error instanceof ScanHelperError && error.kind === 'unreachable';

/** The scan's name when the helper gives none: scan-2026-10-15-0932.pdf (local time). */
export function defaultScanName(at: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `scan-${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}.pdf`;
}

/**
 * The file name in a Content-Disposition header (`filename*=UTF-8''…` before `filename="…"`), made safe to use as one:
 * no folders, no control characters, ending in .pdf. `fallback` when there is none.
 */
export function filenameFrom(header: string | null | undefined, fallback: string): string {
  let name = '';
  if (header) {
    const extended = /(?:^|;)\s*filename\*\s*=\s*"?([^';"]*)'[^']*'([^;"]+)"?/i.exec(header);
    if (extended) {
      try {
        name = decodeURIComponent(extended[2].trim());
      } catch {
        name = ''; // badly encoded, or not UTF-8: the plain name instead
      }
    }
    if (!name) {
      const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i.exec(header);
      if (plain) name = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2];
    }
  }
  name = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || /^\.+$/.test(name)) return fallback;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** The page count in an X-Scan-Pages header, or null. */
export function pagesFrom(header: string | null | undefined): number | null {
  const text = (header ?? '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

/** Whether the bytes are a PDF: it starts with %PDF- (within its first kilobyte, as readers allow). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return latin1(bytes.subarray(0, 1024)).includes('%PDF-');
}

/**
 * How many pages a PDF has, counted from its page objects (/Type /Page), or null when they cannot be seen (e.g. kept in
 * compressed object streams). Good enough for a scan, which the scanner writes plainly.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  const pages = latin1(bytes).match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}

/** Bytes as text, one character each (enough to look for a PDF's words), in pieces small enough for any browser. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

/** 812 → "812 B", 245 760 → "240 KB", 1 258 291 → "1.2 MB" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- settings ----------

/** What a scan is of: a photo or an ID card is scanned in colour, a paper document in greyscale (smaller, and as readable). */
export type ScanPurpose = 'document' | 'photo';

export const DEFAULT_RESOLUTION = 300;

/** The colour modes to choose from, in the order they are preferred for each purpose. */
const COLOUR_ORDER: Record<ScanPurpose, ColorMode[]> = {
  photo: ['color', 'grayscale', 'bw'],
  document: ['grayscale', 'color', 'bw'],
};

export const SOURCE_LABELS: Record<ScanSource, string> = { platen: 'Glass', feeder: 'Document feeder' };
export const COLOUR_LABELS: Record<ColorMode, string> = { color: 'Colour', grayscale: 'Greyscale', bw: 'Black & white' };
export const SOURCES: readonly ScanSource[] = ['platen', 'feeder'];
export const COLOUR_MODES: readonly ColorMode[] = ['color', 'grayscale', 'bw'];

/** The offered resolution nearest to `wanted` (the lower one of two as near), or `wanted` when none is listed. */
export function nearestResolution(offered: readonly number[], wanted: number): number {
  if (!offered.length) return wanted;
  return offered.reduce((best, r) => {
    const d = Math.abs(r - wanted);
    const bestD = Math.abs(best - wanted);
    return d < bestD || (d === bestD && r < best) ? r : best;
  });
}

/** Whether "Two-sided" can be chosen: the feeder of a scanner whose feeder scans both sides. */
export function canDuplex(scanner: Pick<Scanner, 'duplex' | 'sources'>, source: ScanSource): boolean {
  return source === 'feeder' && scanner.duplex && scanner.sources.includes('feeder');
}

/**
 * The settings a scanner starts with: the glass when it has one, one side, the colour for the purpose that the scanner
 * offers (colour for photos and ID cards, greyscale for documents) and 300 dpi, or the nearest it offers.
 */
export function defaultSettings(scanner: Pick<Scanner, 'sources' | 'duplex' | 'colorModes' | 'resolutions'>, purpose: ScanPurpose = 'document'): ScanSettings {
  const source: ScanSource = scanner.sources.includes('platen') || !scanner.sources.length ? 'platen' : scanner.sources[0];
  const order = COLOUR_ORDER[purpose];
  const colorMode = order.find((m) => scanner.colorModes.includes(m)) ?? order[0];
  return { source, duplex: false, colorMode, resolution: nearestResolution(scanner.resolutions, DEFAULT_RESOLUTION) };
}

/**
 * What to say when a scan is larger than a form takes (`maxBytes`): how much it is, and what to scan again with to make
 * it smaller, from what the scanner offers: a lower resolution (200 or 150 dpi is enough to read), then greyscale (or
 * black & white for a greyscale document).
 */
export function tooLargeAdvice(size: number, maxBytes: number, settings: ScanSettings, scanner: Pick<Scanner, 'colorModes' | 'resolutions'>): string {
  const lower = scanner.resolutions.filter((r) => r < settings.resolution);
  const readable = lower.filter((r) => r <= 200 && r >= 150);
  const resolution = readable.length ? Math.max(...readable) : lower.length ? Math.max(...lower) : null;
  const tips: string[] = [];
  if (resolution) tips.push(`at ${resolution} dpi`);
  if (settings.colorMode === 'color' && scanner.colorModes.includes('grayscale')) tips.push('in greyscale');
  else if (settings.colorMode === 'grayscale' && scanner.colorModes.includes('bw')) tips.push('in black & white');
  const over = `This scan is ${formatSize(size)}, more than the ${formatSize(maxBytes)} a file can be.`;
  return tips.length
    ? `${over} Scan it again ${tips.join(' or ')}: the file will be smaller.`
    : `${over} Scan fewer pages at a time, and upload them as separate files.`;
}

// ---------- the helper's answers ----------

const isSource = (v: unknown): v is ScanSource => v === 'platen' || v === 'feeder';
const isColour = (v: unknown): v is ColorMode => v === 'color' || v === 'grayscale' || v === 'bw';
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A scanner as the helper describes it, with anything unknown left out; null when it has no id. */
export function toScanner(raw: unknown): Scanner | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : typeof r.id === 'number' ? String(r.id) : '';
  if (!id) return null;
  const url = typeof r.url === 'string' ? r.url : '';
  return {
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : url || 'Scanner',
    url,
    secure: r.secure === true,
    sources: SOURCES.filter((s) => list(r.sources).filter(isSource).includes(s)),
    duplex: r.duplex === true,
    colorModes: COLOUR_MODES.filter((m) => list(r.colorModes).filter(isColour).includes(m)),
    resolutions: [...new Set(list(r.resolutions).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0))].sort((a, b) => a - b),
    formats: list(r.formats).filter((f): f is string => typeof f === 'string'),
    manual: r.manual === true,
  };
}

/** The host of a scanner's address, to tell two of the same name apart: http://192.168.1.50/eSCL → 192.168.1.50. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

// ---------- calls ----------

interface CallOptions {
  /** Cancels the call (e.g. Cancel scan, or the window being closed). */
  signal?: AbortSignal;
  /** Milliseconds; each call has its own (TIMEOUTS). */
  timeout?: number;
}

/**
 * One call to the helper, read by `read` within the same time limit. Throws ScanHelperError: cancelled, timed out
 * (`slow`: what to say then), unreachable, or the helper's own error.
 */
async function call<T>(path: string, init: RequestInit, options: CallOptions & { timeout: number; slow: string }, read: (res: Response) => Promise<T>): Promise<T> {
  const { signal, timeout, slow } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  /** Why it stopped: cancelled or timed out come first, as an aborted fetch only says it was aborted. */
  const failure = (otherwise: ScanHelperError) =>
    signal?.aborted ? new ScanHelperError(CANCELLED, 'cancelled') : timedOut ? new ScanHelperError(slow, 'timeout') : otherwise;

  try {
    if (signal?.aborted) throw new ScanHelperError(CANCELLED, 'cancelled');
    let res: Response;
    try {
      res = await fetch(`${SCAN_HELPER_URL}${path}`, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    } catch {
      throw failure(new ScanHelperError(UNREACHABLE, 'unreachable'));
    }
    try {
      if (!res.ok) throw new ScanHelperError(helperErrorMessage(res.status, await res.text()), 'refused', res.status);
      return await read(res);
    } catch (e) {
      throw failure(e instanceof ScanHelperError ? e : new ScanHelperError('The TrendLIX Scan Helper sent an answer that could not be read. Try again.', 'refused'));
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Whether the helper is running on this computer: its version, or null when it is not (nothing answers, it is too slow
 * to answer, or another program answers). Only a cancel is thrown.
 */
export async function helperStatus(options: CallOptions = {}): Promise<HelperStatus | null> {
  try {
    const data = await call('/v1/status', { method: 'GET' }, { timeout: TIMEOUTS.status, slow: UNREACHABLE, ...options }, (res) => res.json() as Promise<unknown>);
    if (!data || typeof data !== 'object') return null;
    const { app, version } = data as Record<string, unknown>;
    return app === SCAN_HELPER_APP ? { app, version: typeof version === 'string' ? version : String(version ?? '') } : null;
  } catch (e) {
    if (isCancelled(e)) throw e;
    return null;
  }
}

/** The scanners the helper knows. `refresh`: it looks on the network again (a few seconds). */
export async function listScanners(refresh = false, options: CallOptions = {}): Promise<Scanner[]> {
  return call(
    `/v1/scanners${refresh ? '?refresh=1' : ''}`,
    { method: 'GET' },
    { timeout: TIMEOUTS.scanners, slow: 'Looking for scanners took too long. Press Refresh to try again.', ...options },
    async (res) => list(await res.json()).flatMap((s) => toScanner(s) ?? []),
  );
}

/** Adds a scanner by its address (an IP address, a host name or its eSCL address), and gives it back. */
export async function addScanner(url: string, options: CallOptions = {}): Promise<Scanner> {
  return call(
    '/v1/scanners',
    json({ url: url.trim() }),
    { timeout: TIMEOUTS.add, slow: "The scanner didn't answer in time. Check the address and that the scanner is on, then try again.", ...options },
    async (res) => {
      const scanner = toScanner(await res.json());
      if (!scanner) throw new ScanHelperError('The TrendLIX Scan Helper sent an answer that could not be read. Try again.', 'refused');
      return scanner;
    },
  );
}

/**
 * Scans: one PDF with every page (up to 2½ minutes from the glass, 10 through the feeder), as a file named as the helper names it, its page count (X-Scan-Pages,
 * else counted), and what the helper warns about it (X-Scan-Warning). The helper exposes those headers to the page
 * (Access-Control-Expose-Headers); without them the file is named scan-<date>-<time>.pdf.
 */
export async function scan(options: ScanOptions, callOptions: CallOptions = {}): Promise<ScanResult> {
  const { scannerId, source, duplex, colorMode, resolution } = options;
  return call(
    '/v1/scan',
    json({ scannerId, source, duplex, colorMode, resolution }),
    { timeout: source === 'feeder' ? TIMEOUTS.scanFeeder : TIMEOUTS.scan, slow: 'The scan took too long. Check the scanner, then scan again.', ...callOptions },
    async (res) => {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) throw new ScanHelperError('The scanner sent an empty file. Scan again.', 'refused');
      if (!looksLikePdf(bytes)) throw new ScanHelperError("The scanner didn't send a PDF. Scan again.", 'refused');
      const name = filenameFrom(res.headers.get('Content-Disposition'), defaultScanName());
      const pages = pagesFrom(res.headers.get('X-Scan-Pages')) ?? countPdfPages(bytes);
      const warning = res.headers.get('X-Scan-Warning')?.trim() || null;
      return { file: new File([bytes], name, { type: 'application/pdf', lastModified: Date.now() }), pages, warning };
    },
  );
}

// ---------- the browser's permission ----------

export type NetworkPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Whether this site may reach devices on the local network, the helper included (Chrome's Local Network Access: the first
 * time, Chrome asks). 'prompt': the first call to the helper will make the browser ask, and waits for the answer.
 * 'unknown': the browser does not say (Safari, Firefox, older Chrome). The permission's name has changed across Chrome
 * versions (one for this computer itself, 'loopback-network', and one for the network around it): each is tried.
 */
export async function localNetworkPermission(): Promise<NetworkPermission> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state;
    } catch {
      // not a permission this browser knows
    }
  }
  return 'unknown';
}
