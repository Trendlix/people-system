// A serial on every generated document (owner, 2 November 2026: "print like a serial number on each document generated
// (Contract - NDA - etc..) and when uploaded verify the document from the OCR and the Serial Printed"). Each document
// generated on the Employment tab gets one, DOC-2026-000123-4: the year, a running number and a check digit (Luhn), so
// a misread digit is caught rather than taken for another document's. It is printed on every page of the PDF the
// document leaves as (the one HR prints, and the one for e-signature). When the signed copy is uploaded, its scan is read
// (OCR) and the serials on it compared: this document's, it is verified at once; another document's, verifying is
// refused; none read, HR verifies by eye as before. Documents generated before then have none. Pure, tested.

const DIGITS = /^\d+$/;

/** The Luhn check digit of a string of digits. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** The serial of the `seq`th document of all, generated in `year`: DOC-2026-000123-4. */
export function documentSerial(year: number, seq: number): string {
  const y = String(year);
  const n = String(seq).padStart(6, '0');
  return `DOC-${y}-${n}-${luhnDigit(y + n)}`;
}

/** Whether a serial is well formed and its check digit right. */
export function validSerial(serial: string): boolean {
  const m = /^DOC-(\d{4})-(\d{6,})-(\d)$/.exec(serial);
  return !!m && DIGITS.test(m[1] + m[2]) && luhnDigit(m[1] + m[2]) === Number(m[3]);
}

/** What OCR reads for a digit's look-alikes, in the number parts of a serial. */
const AS_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8', G: '6' };
const digitsOf = (s: string) => s.toUpperCase().replace(/[OQDILZSBG|]/g, (c) => AS_DIGIT[c] ?? c);

const SEP = '[\\s\\-–—_.:·]*';
/** A serial as OCR may read it: DOC (D0C, OOC) then the three number parts, with any of the separators read. */
const READ = new RegExp(`[D0O][O0Q]C${SEP}([0-9OQDILZSBG|]{4})${SEP}([0-9OQDILZSBG|]{6})${SEP}([0-9OQDILZSBG|])`, 'gi');

/** The serials on a scan's text, each once, as printed; only those whose check digit is right. */
export function serialsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(READ)) {
    const serial = `DOC-${digitsOf(m[1])}-${digitsOf(m[2])}-${digitsOf(m[3])}`;
    if (validSerial(serial)) out.add(serial);
  }
  return [...out];
}

/** What the scan of a signed copy showed: this document's serial, another's, none read, or not read at all (no OCR). */
export const SERIAL_CHECKS = ['match', 'mismatch', 'not_found', 'unchecked'] as const;
export type SerialCheck = (typeof SERIAL_CHECKS)[number];

export const SERIAL_CHECK_LABELS: Record<SerialCheck, string> = {
  match: 'Serial matches',
  mismatch: 'Another document’s serial',
  not_found: 'Serial not found on the scan',
  unchecked: 'Serial not checked',
};

/** The check of a scan's serials against the document's. */
export function serialCheckOf(serial: string, found: readonly string[]): SerialCheck {
  if (found.includes(serial)) return 'match';
  return found.length ? 'mismatch' : 'not_found';
}

/** Verifying refused: the scan shows another document's serial. */
export const serialMismatchMessage = (serial: string, found: readonly string[]) =>
  `The scan shows ${found.join(', ')}, not this document’s ${serial}. Upload this document’s signed copy.`;

/** What is printed at the foot of each page. */
export const serialStampText = (serial: string, page: number, pages: number) => `${serial}   ·   ${page}/${pages}`;
