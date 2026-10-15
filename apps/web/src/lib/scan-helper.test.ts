import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addScanner,
  canDuplex,
  countPdfPages,
  defaultScanName,
  defaultSettings,
  filenameFrom,
  formatSize,
  helperErrorMessage,
  helperStatus,
  hostOf,
  listScanners,
  nearestResolution,
  pagesFrom,
  scan,
  SCAN_HELPER_URL,
  ScanHelperError,
  tooLargeAdvice,
  toScanner,
  UNREACHABLE,
  type Scanner,
} from './scan-helper';

const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Type/Page /Parent 2 0 R >> endobj\n%%EOF';

const scanner = (over: Partial<Scanner> = {}): Scanner => ({
  id: 'hp',
  name: 'HP LaserJet MFP',
  url: 'http://192.168.1.50/eSCL',
  secure: false,
  sources: ['platen', 'feeder'],
  duplex: true,
  colorModes: ['color', 'grayscale', 'bw'],
  resolutions: [75, 150, 200, 300, 600],
  formats: ['application/pdf'],
  manual: false,
  ...over,
});

describe('the file name from Content-Disposition', () => {
  const fallback = 'scan.pdf';

  it('reads a quoted, an unquoted and an encoded name', () => {
    expect(filenameFrom('attachment; filename="scan-2026-10-15.pdf"', fallback)).toBe('scan-2026-10-15.pdf');
    expect(filenameFrom('attachment; filename=contract.pdf', fallback)).toBe('contract.pdf');
    expect(filenameFrom("attachment; filename*=UTF-8''scan%20one.pdf", fallback)).toBe('scan one.pdf');
    expect(filenameFrom('inline;filename="a \\"quoted\\" name.pdf"', fallback)).toBe('a "quoted" name.pdf');
  });

  it('prefers the encoded name, and falls back to the plain one when it cannot be decoded', () => {
    expect(filenameFrom(`attachment; filename="plain.pdf"; filename*=UTF-8''%D8%B9%D9%82%D8%AF.pdf`, fallback)).toBe('عقد.pdf');
    expect(filenameFrom(`attachment; filename="plain.pdf"; filename*=UTF-8''%E9%ZZ.pdf`, fallback)).toBe('plain.pdf');
  });

  it('keeps no folders or control characters, and always ends in .pdf', () => {
    expect(filenameFrom('attachment; filename="../../etc/passwd"', fallback)).toBe('passwd.pdf');
    expect(filenameFrom('attachment; filename=C:\\scans\\page.PDF', fallback)).toBe('page.PDF');
    expect(filenameFrom('attachment; filename="sc\u0007an"', fallback)).toBe('scan.pdf');
  });

  it('uses the fallback when there is no name', () => {
    expect(filenameFrom(null, fallback)).toBe(fallback);
    expect(filenameFrom('', fallback)).toBe(fallback);
    expect(filenameFrom('attachment', fallback)).toBe(fallback);
    expect(filenameFrom('attachment; filename=""', fallback)).toBe(fallback);
    expect(filenameFrom('attachment; filename=".."', fallback)).toBe(fallback);
  });

  it('names a scan by when it was made when the helper gives no name', () => {
    expect(defaultScanName(new Date(2026, 9, 5, 9, 7))).toBe('scan-2026-10-05-0907.pdf');
  });
});

describe('pages and sizes', () => {
  it('reads X-Scan-Pages', () => {
    expect(pagesFrom('3')).toBe(3);
    expect(pagesFrom(' 12 ')).toBe(12);
    expect(pagesFrom('0')).toBeNull();
    expect(pagesFrom('2 pages')).toBeNull();
    expect(pagesFrom(null)).toBeNull();
  });

  it('counts the pages of a plainly written PDF', () => {
    expect(countPdfPages(bytes(PDF))).toBe(2);
    expect(countPdfPages(bytes('%PDF-1.7 compressed objects only'))).toBeNull();
  });

  it('says sizes as the file box does', () => {
    expect(formatSize(812)).toBe('812 B');
    expect(formatSize(245_760)).toBe('240 KB');
    expect(formatSize(1_258_291)).toBe('1.2 MB');
  });
});

describe('error sentences', () => {
  it("shows the helper's own sentence", () => {
    expect(helperErrorMessage(422, JSON.stringify({ error: 'Put the pages in the feeder.' }))).toBe('Put the pages in the feeder.');
    expect(helperErrorMessage(500, JSON.stringify({ error: '  Out of paper.  ' }))).toBe('Out of paper.');
  });

  it('says what the status means when the helper gives no sentence', () => {
    expect(helperErrorMessage(409, '')).toMatch(/busy/);
    expect(helperErrorMessage(422, 'not json')).toMatch(/feeder is empty/);
    expect(helperErrorMessage(504, JSON.stringify({ error: '' }))).toMatch(/didn't answer in time/);
    expect(helperErrorMessage(502, JSON.stringify({ message: 'x' }))).toMatch(/reported a problem/);
    expect(helperErrorMessage(418, '')).toBe("The TrendLIX Scan Helper couldn't do that (error 418). Try again.");
  });
});

describe('default settings from what the scanner can do', () => {
  it('starts on the glass, one side, at 300 dpi', () => {
    expect(defaultSettings(scanner())).toEqual({ source: 'platen', duplex: false, colorMode: 'grayscale', resolution: 300 });
  });

  it('scans photos and ID cards in colour, documents in greyscale', () => {
    expect(defaultSettings(scanner(), 'photo').colorMode).toBe('color');
    expect(defaultSettings(scanner(), 'document').colorMode).toBe('grayscale');
  });

  it('takes the nearest colour mode the scanner offers', () => {
    expect(defaultSettings(scanner({ colorModes: ['color', 'bw'] }), 'document').colorMode).toBe('color');
    expect(defaultSettings(scanner({ colorModes: ['grayscale'] }), 'photo').colorMode).toBe('grayscale');
    expect(defaultSettings(scanner({ colorModes: [] }), 'photo').colorMode).toBe('color');
  });

  it('uses the feeder of a scanner without glass', () => {
    expect(defaultSettings(scanner({ sources: ['feeder'] })).source).toBe('feeder');
    expect(defaultSettings(scanner({ sources: [] })).source).toBe('platen');
  });

  it('takes the resolution nearest to 300 dpi that is offered', () => {
    expect(defaultSettings(scanner({ resolutions: [100, 200, 600] })).resolution).toBe(200);
    expect(defaultSettings(scanner({ resolutions: [600, 1200] })).resolution).toBe(600);
    expect(defaultSettings(scanner({ resolutions: [] })).resolution).toBe(300);
    expect(nearestResolution([250, 350], 300)).toBe(250);
  });

  it('offers two-sided only with the feeder of a scanner that can', () => {
    expect(canDuplex(scanner(), 'feeder')).toBe(true);
    expect(canDuplex(scanner(), 'platen')).toBe(false);
    expect(canDuplex(scanner({ duplex: false }), 'feeder')).toBe(false);
    expect(canDuplex(scanner({ sources: ['platen'] }), 'feeder')).toBe(false);
  });
});

describe('a scan too large for the form', () => {
  const MB = 1024 * 1024;

  it('suggests a lower resolution and greyscale', () => {
    expect(tooLargeAdvice(5.3 * MB, 4 * MB, { source: 'platen', duplex: false, colorMode: 'color', resolution: 300 }, scanner())).toBe(
      'This scan is 5.3 MB, more than the 4.0 MB a file can be. Scan it again at 200 dpi or in greyscale: the file will be smaller.',
    );
  });

  it('suggests black & white for a greyscale scan at a low resolution', () => {
    expect(tooLargeAdvice(5 * MB, 4 * MB, { source: 'platen', duplex: false, colorMode: 'grayscale', resolution: 150 }, scanner())).toMatch(
      /Scan it again at 75 dpi or in black & white/,
    );
  });

  it('suggests fewer pages when nothing smaller is offered', () => {
    expect(tooLargeAdvice(5 * MB, 4 * MB, { source: 'feeder', duplex: false, colorMode: 'bw', resolution: 150 }, scanner({ resolutions: [150, 300] }))).toMatch(
      /Scan fewer pages at a time/,
    );
  });
});

describe("the helper's scanners", () => {
  it('keeps what is known, in order, and leaves the rest out', () => {
    expect(
      toScanner({
        id: 'x',
        name: '  Canon  ',
        url: 'https://10.0.0.9/eSCL',
        secure: true,
        sources: ['feeder', 'camera', 'platen'],
        duplex: true,
        colorModes: ['bw', 'color', 'sepia'],
        resolutions: [600, 300, 'high', 300, -1],
        formats: ['application/pdf', 3],
        manual: true,
      }),
    ).toEqual({
      id: 'x',
      name: 'Canon',
      url: 'https://10.0.0.9/eSCL',
      secure: true,
      sources: ['platen', 'feeder'],
      duplex: true,
      colorModes: ['color', 'bw'],
      resolutions: [300, 600],
      formats: ['application/pdf'],
      manual: true,
    });
    expect(toScanner({ name: 'no id' })).toBeNull();
    expect(toScanner(null)).toBeNull();
    expect(toScanner({ id: 'y', url: 'http://h/eSCL' })?.name).toBe('http://h/eSCL');
  });

  it('shows the host of its address', () => {
    expect(hostOf('http://192.168.1.50/eSCL')).toBe('192.168.1.50');
    expect(hostOf('https://scanner.local:443/eSCL')).toBe('scanner.local');
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('calls to the helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const answer = (body: BodyInit | null, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

  it('scans: the PDF as a file named by the helper, with its pages', async () => {
    const fetch = answer(bytes(PDF), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="scan-1.pdf"', 'X-Scan-Pages': '5' } });
    vi.stubGlobal('fetch', fetch);
    const result = await scan({ scannerId: 'hp', source: 'feeder', duplex: true, colorMode: 'grayscale', resolution: 300 });
    expect(result.file.name).toBe('scan-1.pdf');
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.size).toBe(bytes(PDF).length);
    expect(result.pages).toBe(5);
    expect(result.warning).toBeNull();
    expect(fetch).toHaveBeenCalledWith(`${SCAN_HELPER_URL}/v1/scan`, expect.objectContaining({ method: 'POST' }));
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toEqual({ scannerId: 'hp', source: 'feeder', duplex: true, colorMode: 'grayscale', resolution: 300 });
  });

  it('counts the pages, and names the file by the time, when the headers are not readable', async () => {
    vi.stubGlobal('fetch', answer(bytes(PDF), { headers: { 'Content-Type': 'application/pdf' } }));
    const result = await scan({ scannerId: 'hp', source: 'platen', duplex: false, colorMode: 'color', resolution: 300 });
    expect(result.file.name).toMatch(/^scan-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
    expect(result.pages).toBe(2);
  });

  it("passes on the helper's warning about a scan", async () => {
    vi.stubGlobal('fetch', answer(bytes(PDF), { headers: { 'X-Scan-Warning': 'The scanner sent 2 separate PDF files; only the first one is included.' } }));
    const result = await scan({ scannerId: 'hp', source: 'feeder', duplex: false, colorMode: 'color', resolution: 300 });
    expect(result.warning).toBe('The scanner sent 2 separate PDF files; only the first one is included.');
  });

  it("turns the helper's errors into its sentence", async () => {
    vi.stubGlobal('fetch', answer(JSON.stringify({ error: 'The scanner is busy.' }), { status: 409 }));
    const failed = scan({ scannerId: 'hp', source: 'platen', duplex: false, colorMode: 'color', resolution: 300 });
    await expect(failed).rejects.toBeInstanceOf(ScanHelperError);
    await expect(failed).rejects.toMatchObject({ kind: 'refused', status: 409, message: 'The scanner is busy.' });
  });

  it('refuses an answer that is not a PDF', async () => {
    vi.stubGlobal('fetch', answer('<html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(scan({ scannerId: 'hp', source: 'platen', duplex: false, colorMode: 'color', resolution: 300 })).rejects.toMatchObject({
      message: "The scanner didn't send a PDF. Scan again.",
    });
  });

  it('says plainly when the helper cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(listScanners()).rejects.toMatchObject({ kind: 'unreachable', message: UNREACHABLE });
    expect(await helperStatus()).toBeNull();
  });

  /** A fetch that waits until it is aborted, as a scanner that takes its time. */
  const hanging = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );

  it('cancels a scan', async () => {
    vi.stubGlobal('fetch', hanging());
    const stop = new AbortController();
    const scanning = scan({ scannerId: 'hp', source: 'platen', duplex: false, colorMode: 'color', resolution: 300 }, { signal: stop.signal });
    stop.abort();
    await expect(scanning).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('gives up after its time limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hanging());
    const listing = listScanners(true, { timeout: 1000 });
    const failed = expect(listing).rejects.toMatchObject({ kind: 'timeout', message: expect.stringMatching(/took too long/) });
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
  });

  it('takes the helper as running only when it says it is the helper', async () => {
    vi.stubGlobal('fetch', answer(JSON.stringify({ app: 'trendlix-scan-helper', version: '1.0.0' })));
    expect(await helperStatus()).toEqual({ app: 'trendlix-scan-helper', version: '1.0.0' });
    vi.stubGlobal('fetch', answer(JSON.stringify({ app: 'something-else' })));
    expect(await helperStatus()).toBeNull();
  });

  it('lists and adds scanners', async () => {
    const fetch = answer(JSON.stringify([scanner(), { name: 'no id' }]));
    vi.stubGlobal('fetch', fetch);
    expect(await listScanners(true)).toEqual([scanner()]);
    expect(fetch).toHaveBeenCalledWith(`${SCAN_HELPER_URL}/v1/scanners?refresh=1`, expect.anything());

    const add = answer(JSON.stringify(scanner({ id: 'm', manual: true })));
    vi.stubGlobal('fetch', add);
    expect((await addScanner(' 192.168.1.60 ')).manual).toBe(true);
    const init = add.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toEqual({ url: '192.168.1.60' });
  });
});
