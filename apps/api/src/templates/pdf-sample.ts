import { TEMPLATE_TAGS, toArabicDigits, type PdfField } from '@trendlix/shared';

// A PDF template filled in with made-up values, for HR to check where the fields print while placing them (owner's
// decision, 15 October 2026): no one's data, so it is given unprotected. A text field prints its field's name (in
// Arabic on an Arabic or bilingual form, else in English); boxes print plausible digits (a national ID, a date, an
// amount …), so HR sees each box filled; every check box is ticked.

const TAGS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/** What the boxes of these tags print: values shaped like real ones. */
const SAMPLES: Readonly<Record<string, string>> = {
  national_id: '29001011234567',
  national_id_ar: toArabicDigits('29001011234567'),
  company_rep_national_id: '28001011234567',
  company_rep_national_id_ar: toArabicDigits('28001011234567'),
  id_printed_no: 'AB1234567',
  id_issue_date: '10/2026',
  insurance_no: '12345678',
  insurance_employer_no: '1234567',
  tax_reg_no: '123-456-789',
  commercial_reg_no: '123456',
  phone: '01012345678',
  employee_code: 'E-0001',
  contract_number: 'C-2026-0001',
  offer_number: 'OFF-2026-0001',
  account_no: '1234567890123',
  iban: 'EG380019000500000000263180002',
  bank_bic: 'NBEGEGCX',
  days_per_week: '5',
  hours_per_week: '40',
  basic_percent: '80%',
  pay_month: '10/2026',
};

const DATE = '15/10/2026';
const MONEY = '16,700.50';
/** Digits for boxes of any other tag. */
const DIGITS = '1234567890';

/** A sample value for the boxes of a tag. */
function boxesSample(tag: string): string {
  if (SAMPLES[tag]) return SAMPLES[tag];
  const t = TAGS.get(tag);
  if (t?.note?.startsWith('DD/MM/YYYY')) return DATE;
  // an amount of money: the pay tags but the words, the lists of allowances and the accounts allowance's line (25 October
  // 2026) and the minimum a month's (27 October 2026), and the final settlement's total deducted (20 October 2026: its
  // deductions are lines of words now)
  if ((t?.group === 'pay' && !/_words|^allowances(_ar|_en)?$|^accounts_allowance|^hourly_minimum_line/.test(tag)) || tag === 'deductions_total') return MONEY;
  return DIGITS;
}

/**
 * The fields and values to fill a sample in with: a tag's value is the plausible one when boxes print it (a text field
 * of the same tag then prints it too), else the tag's name; check boxes are made unconditional, so all are ticked.
 */
export function pdfSample(fields: readonly PdfField[], language: string): { fields: PdfField[]; values: Record<string, string> } {
  const values: Record<string, string> = {};
  const boxed = new Set(fields.filter((f) => f.kind === 'boxes' && f.tag).map((f) => f.tag!));
  for (const f of fields) {
    if ((f.kind !== 'text' && f.kind !== 'boxes') || !f.tag || values[f.tag] !== undefined) continue;
    const t = TAGS.get(f.tag);
    values[f.tag] = boxed.has(f.tag) ? boxesSample(f.tag) : language === 'en' ? (t?.labelEn ?? f.tag) : (t?.labelAr ?? f.tag);
  }
  return { fields: fields.map((f) => (f.kind === 'check' ? { ...f, tag: null } : f)), values };
}
