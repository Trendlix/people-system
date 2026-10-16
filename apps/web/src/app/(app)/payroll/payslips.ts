import type { PayrollStatus } from '@trendlix/shared';
import type { EmployeePayslip } from '../../../lib/types';
import { monthName } from './list';

// Payslips (owner's decisions, 16 October 2026): the system draws each employee's payslip from the approved run, as a
// protected PDF. The English one for everyone each month, issued when HR marks the run paid; the Arabic one made on
// request from the employee file, the first time it is opened. HR, Finance and the CEO open one, or download all of a
// run's as a ZIP, and they are kept on the employee file (the profile's Employment tab). The browser gets them under the
// web domain with the caller's session ([id]/payslips/route.ts, lines/[lineId]/payslip/[language]/route.ts). Pure code,
// tested; relative imports, as vitest doesn't know the @/ paths.

export const PAYSLIP_LANGUAGES = ['en', 'ar'] as const;
export type PayslipLanguage = (typeof PAYSLIP_LANGUAGES)[number];

export const isPayslipLanguage = (value: string): value is PayslipLanguage => (PAYSLIP_LANGUAGES as readonly string[]).includes(value);

export const LANGUAGE_LABELS: Record<PayslipLanguage, string> = { en: 'English', ar: 'Arabic' };

/** Payslips are issued once HR marks the run paid. */
export const payslipsIssued = (status: PayrollStatus) => status === 'paid';

/** Where the browser downloads all of a run's English payslips, as a ZIP (a plain link, never prefetched). */
export const payslipsZipHref = (runId: string) => `/payroll/${runId}/payslips`;

/** Where the browser opens a line's payslip, in English or Arabic (a plain link, never prefetched). */
export const payslipHref = (lineId: string, language: PayslipLanguage) => `/payroll/lines/${lineId}/payslip/${language}`;

/** The API's address for a run's ZIP: GET /payroll/runs/:id/payslips. */
export const apiPayslipsZipPath = (runId: string) => `/payroll/runs/${encodeURIComponent(runId)}/payslips`;

/** The API's address for a line's payslip: GET /payroll/lines/:lineId/payslip/:language (drawn the first time). */
export const apiPayslipPath = (lineId: string, language: PayslipLanguage) => `/payroll/lines/${encodeURIComponent(lineId)}/payslip/${language}`;

/** The names a file is given when the API names none. */
export const PAYSLIPS_ZIP_NAME = 'Payslips.zip';
export const PAYSLIP_PDF_NAME = 'Payslip.pdf';

export const ZIP = 'application/zip';

/**
 * The API's ZIP of payslips passed on to the browser, saved under the name the API sends (`fallbackName` when it sends
 * none), with nothing allowed to run in it. Null when the API sent anything else: the caller answers 502 in its words.
 */
export function passZipOn(res: Response, fallbackName: string): Response | null {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== ZIP && type !== 'application/x-zip-compressed' && type !== 'application/octet-stream') return null;
  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`;
  const headers = new Headers({
    'content-type': ZIP,
    'content-disposition': disposition.replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}

/** "12 payslips issued", "1 payslip issued" (the English ones stored for a run). */
export const payslipsIssuedLabel = (n: number) => `${n} ${n === 1 ? 'payslip' : 'payslips'} issued`;

// ---------- on the employee file ----------

/** One month on the employee file's list: its name ("October 2026") and what can be opened. */
export interface PayslipRow {
  lineId: string;
  runId: string;
  /** "October 2026". */
  title: string;
  paidOn: string | null;
  net: number;
  onHold: boolean;
  /** The languages to open, with a note on each not drawn yet; none for a month on hold. */
  links: { language: PayslipLanguage; label: string; note: string | null }[];
}

/** Said of a payslip not drawn yet: it is drawn the first time it is opened. */
export const NOT_DRAWN_YET = 'made when first opened';

/** The employee's payslips, newest month first, each with its links (none for a month on hold). */
export function payslipRows(list: readonly EmployeePayslip[]): PayslipRow[] {
  return [...list]
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
    .map((p) => ({
      lineId: p.lineId,
      runId: p.runId,
      title: monthName(p.month),
      paidOn: p.paidOn,
      net: p.net,
      onHold: p.onHold,
      links: p.onHold
        ? []
        : PAYSLIP_LANGUAGES.map((language) => ({
            language,
            label: LANGUAGE_LABELS[language],
            note: p.issued?.[language] ? null : NOT_DRAWN_YET,
          })),
    }));
}
