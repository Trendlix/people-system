import { describe, expect, it } from 'vitest';
import { FILE_PRINT_HINT, PRINT_FAILED, printProblem, printWay, SHARE_PRINT_HINT } from './print-pdf';

// The Print button of a filled document (owner's request, 20 October 2026: "add Print Button"): how each browser prints
// the protected PDF, and what the page says when it can't be loaded.

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  iPadOld: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
};

describe('printing a protected PDF', () => {
  it('from a hidden frame in Chrome, Edge, Opera and Firefox on a computer', () => {
    for (const userAgent of [UA.chromeMac, UA.chromeWindows, UA.edge, UA.opera, UA.firefoxMac]) {
      expect(printWay({ userAgent, maxTouchPoints: 0 }), userAgent).toEqual({ kind: 'frame' });
    }
    // a touch screen on Windows is no iPad
    expect(printWay({ userAgent: UA.chromeWindows, maxTouchPoints: 10 })).toEqual({ kind: 'frame' });
    expect(printWay({ userAgent: UA.chromeMac })).toEqual({ kind: 'frame' });
  });

  it('in a new tab with Share → Print on an iPhone, an iPad (which says it is a Mac) and Android, whatever the browser', () => {
    for (const userAgent of [UA.iPhone, UA.chromeIPhone, UA.iPadOld, UA.android, UA.firefoxAndroid]) {
      expect(printWay({ userAgent, maxTouchPoints: 5 }), userAgent).toEqual({ kind: 'tab', hint: SHARE_PRINT_HINT });
    }
    // iPadOS 13 and later: Safari's and Chrome's desktop pages, told apart from a Mac by the touch screen
    expect(printWay({ userAgent: UA.safariMac, maxTouchPoints: 5 })).toEqual({ kind: 'tab', hint: 'Use Share → Print.' });
    expect(printWay({ userAgent: UA.chromeMac, maxTouchPoints: 5 })).toEqual({ kind: 'tab', hint: 'Use Share → Print.' });
  });

  it("in a new tab with File → Print in Safari on a Mac, which can't print a PDF inside a frame", () => {
    expect(printWay({ userAgent: UA.safariMac, maxTouchPoints: 0 })).toEqual({ kind: 'tab', hint: FILE_PRINT_HINT });
    expect(FILE_PRINT_HINT).toBe('Use File → Print (⌘P).');
  });
});

describe('what the page says when the PDF cannot be printed', () => {
  const answer = (body: string, status: number, type: string) => new Response(body, { status, headers: { 'content-type': type } });

  it('nothing for the PDF', async () => {
    expect(await printProblem(answer('%PDF', 200, 'application/pdf'))).toBeNull();
    expect(await printProblem(answer('%PDF', 200, 'Application/PDF; charset=binary'))).toBeNull();
  });

  it("the route's reason in words, as Preview shows it", async () => {
    expect(await printProblem(answer("The PDF converter isn't set up on the server yet.", 409, 'text/plain; charset=utf-8'))).toBe(
      "The PDF converter isn't set up on the server yet.",
    );
    expect(await printProblem(answer('Fill in the missing details first.\n\nMissing: Job title.', 422, 'text/plain'))).toBe('Fill in the missing details first.\n\nMissing: Job title.');
    // kept short under the button
    expect(await printProblem(answer('x'.repeat(600), 503, 'text/plain'))).toBe(`${'x'.repeat(500)}…`);
  });

  it('a general message for anything else: a page (the sign-in page after the session ended), an empty reason', async () => {
    expect(await printProblem(answer('<html>Sign in</html>', 200, 'text/html'))).toBe(PRINT_FAILED);
    expect(await printProblem(answer('<html>Error</html>', 502, 'text/html'))).toBe(PRINT_FAILED);
    expect(await printProblem(answer('  ', 404, 'text/plain'))).toBe(PRINT_FAILED);
    expect(await printProblem(new Response(null, { status: 500 }))).toBe(PRINT_FAILED);
    expect(PRINT_FAILED).toBe('The document could not be loaded for printing. Please try again.');
  });
});
