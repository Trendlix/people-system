// Printing a filled document's protected PDF from its page (owner's request, 20 October 2026: "add Print Button"): the
// PDF allows printing, so the page loads it in a hidden frame and asks the browser to print that frame, without opening
// it first. Safari, and the browsers of iPhones, iPads and Android phones, can't print a PDF inside a frame (they print
// the page around it, or a blank page), so there it is opened in a new tab instead, with a hint where Print is. What the
// Print button does (components/print-pdf.tsx), worked out here. No "@/" imports: it is unit tested.

/** What tells the browsers apart: navigator.userAgent, and navigator.maxTouchPoints (an iPad says it is a Mac). */
export interface BrowserTraits {
  userAgent: string;
  maxTouchPoints?: number;
}

/** How the PDF is printed: from a hidden frame in the page, or opened in a new tab with a hint. */
export type PrintWay = { kind: 'frame' } | { kind: 'tab'; hint: string };

/** The hint where printing is on a phone or tablet: its share sheet. */
export const SHARE_PRINT_HINT = 'Use Share → Print.';
/** The hint in Safari on a Mac: its File menu. */
export const FILE_PRINT_HINT = 'Use File → Print (⌘P).';

/** An iPhone, an iPad (which since iPadOS 13 says it is a Mac, but has a touch screen) or an iPod: WebKit, whatever the browser. */
const isAppleMobile = ({ userAgent, maxTouchPoints = 0 }: BrowserTraits) =>
  /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

/** Safari itself: "Safari/" with no other browser's name before it (Chrome, Edge, Opera, Firefox and others say Safari too). */
const isSafari = ({ userAgent }: BrowserTraits) =>
  /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\/|OPR\/|Firefox\/|SamsungBrowser\/|Android/.test(userAgent);

/** How this browser prints the PDF: Chrome, Edge, Firefox and Opera on a computer from a hidden frame; the others in a new tab. */
export function printWay(traits: BrowserTraits): PrintWay {
  if (isAppleMobile(traits) || /Android/.test(traits.userAgent)) return { kind: 'tab', hint: SHARE_PRINT_HINT };
  if (isSafari(traits)) return { kind: 'tab', hint: FILE_PRINT_HINT };
  return { kind: 'frame' };
}

/** What the page says when the PDF couldn't be loaded and the route didn't say why. */
export const PRINT_FAILED = 'The document could not be loaded for printing. Please try again.';

/**
 * Why the route's answer can't be printed, or null when it is the PDF: the route's own reason when it sent one in
 * words (e.g. the PDF converter isn't set up, a value is missing), else PRINT_FAILED (an error page, the sign-in page
 * after a session ended).
 */
export async function printProblem(res: Response): Promise<string | null> {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (res.ok && type === 'application/pdf') return null;
  if (!res.ok && type === 'text/plain') {
    const said = (await res.text().catch(() => '')).trim();
    if (said) return said.length > 500 ? `${said.slice(0, 500)}…` : said;
  }
  return PRINT_FAILED;
}
