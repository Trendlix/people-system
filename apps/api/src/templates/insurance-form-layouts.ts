import type { PdfField, PdfPageSize } from '@trendlix/shared';

// The fields of the social insurance Forms 1 and 6 (starter-layouts.ts), measured on the owner's files (15 October
// 2026): the boxes from the PDF's own drawing, the dotted lines from a render at 8 px a point. A text field sits on its
// dotted line: its rect reaches 1.7 pt below the dots, so that the text, centred in it, stands just above them. Left
// blank on purpose: what the insurance office assigns (subscription and period codes, the district and governorate
// codes), disability, kinship with the employer, an address abroad, signatures and dates signed by hand. A building
// number and a personal email are optional: left blank when the profile has none.

/** Both forms: two legal pages, the form and its instructions with the declaration (إقرار). */
export const NOSI_FORM_PAGES: readonly PdfPageSize[] = [
  { width: 612.12, height: 1008.12 },
  { width: 612.12, height: 1008.12 },
];

/** A text field on a dotted line from x0 to x1 whose dots are at `dots` (from the page's top). */
const line = (id: string, tag: string, x0: number, x1: number, dots: number, extra: Partial<PdfField> = {}): PdfField => ({
  id,
  kind: 'text',
  tag,
  page: 1,
  x: x0,
  y: Math.round((dots - 13.3) * 10) / 10,
  width: Math.round((x1 - x0) * 10) / 10,
  height: 15,
  fontSize: 13,
  align: 'right',
  shrinkToFit: true,
  ...extra,
});

/** A wage's pounds (5 cells) or piastres (2 cells) in one of Form 1's wage tables. */
const money = (id: string, tag: string, part: 'pounds' | 'piasters', x: number, y: number, width: number, boxes: number): PdfField => ({
  id,
  kind: 'boxes',
  tag,
  page: 1,
  x,
  y,
  width,
  height: 14.7,
  fontSize: 9,
  boxes,
  boxAlign: 'right',
  amountPart: part,
});

const still = { dx: 0, dy: 0 };

/**
 * Every number on the forms in Arabic-Indic digits ٠-٩ (owner, 16 October 2026), but an email's: an address keeps its
 * own. In boxes a third larger (as high as 85% of the box), as Naskh draws ٠-٩ smaller than 0-9.
 */
const inArabicDigits = (fields: PdfField[]): PdfField[] =>
  fields.map((f) => {
    if (f.kind === 'check' || f.tag === 'personal_email') return f;
    if (f.kind !== 'boxes') return { ...f, arabicDigits: true };
    return { ...f, arabicDigits: true, fontSize: Math.min(Math.round(f.fontSize * 2.6) / 2, Math.floor(f.height * 0.85 * 2) / 2) };
  });

/** Form 1 (طلب اشتراك مؤمن عليه): joining. */
export const FORM_1_FIELDS: PdfField[] = inArabicDigits([
  // the category: employees of others (عاملين لدى الغير)
  { id: 'category', kind: 'check', tag: null, page: 1, x: 397.2, y: 108.2, width: 19.8, height: 19.8, fontSize: 14 },
  // the insurance office (مكتب) at the top, and the employer
  line('office', 'insurance_office', 442.1, 556.7, 49.2),
  { id: 'employer-no', kind: 'boxes', tag: 'insurance_employer_no', page: 1, x: 337.1, y: 166.2, width: 158, height: 19.8, fontSize: 12, boxes: 8, boxAlign: 'right' },
  { id: 'sector', kind: 'boxes', tag: 'insurance_sector_code', page: 1, x: 127.9, y: 165.7, width: 38.4, height: 19.9, fontSize: 12, boxes: 2, boxAlign: 'right' },
  line('company-name', 'company_name_ar', 326, 491, 205.5),
  // the tax number over the printed "……/……/……": each group between the slashes
  { id: 'tax-no', kind: 'boxes', tag: 'tax_reg_no', page: 1, x: 101.25, y: 195, width: 74.9, height: 13, fontSize: 10.5, boxes: 9, groups: [3, 3, 3], groupGap: 8.2 },
  // the insured person
  { id: 'insurance-no', kind: 'boxes', tag: 'insurance_no', page: 1, x: 311, y: 256.4, width: 178.8, height: 19.9, fontSize: 12, boxes: 9, boxAlign: 'right' },
  { id: 'national-id', kind: 'boxes', tag: 'national_id', page: 1, x: 211.3, y: 284, width: 277.8, height: 19.9, fontSize: 12, boxes: 14 },
  line('name', 'full_name_ar', 313.2, 492.9, 322.2),
  line('nationality', 'nationality', 105, 190.9, 322.2),
  line('qualification', 'qualification', 429.2, 529.1, 348.1),
  // the occupation (the job title's, from the social insurance table): its code, XXX / XXX, and its name after it
  { id: 'occupation-code', kind: 'boxes', tag: 'occupation_code', page: 1, x: 223, y: 331.3, width: 133.5, height: 19.8, fontSize: 12, boxes: 6, groups: [3, 3], groupGap: 14.7 },
  line('occupation-name', 'occupation_name', 64.5, 164.1, 348.1),
  // the subscription's start, YYYY / MM / DD left to right; the month's boxes sit 1.45 pt left of an even spread
  {
    id: 'start',
    kind: 'boxes',
    tag: 'join_date',
    page: 1,
    x: 289,
    y: 358.2,
    width: 160.1,
    height: 17,
    fontSize: 11,
    boxes: 8,
    groups: [4, 2, 2],
    groupGap: 12.15,
    dateOrder: 'YMD',
    nudges: [still, still, still, still, { dx: -1.45, dy: 0 }, { dx: -1.45, dy: 0 }],
  },
  // the wages, pounds and piastres: basic (for the yearly raise), insured, and comprehensive (gross and allowances)
  money('basic-pounds', 'basic_salary', 'pounds', 440.7, 448.2, 55.5, 5),
  money('basic-piastres', 'basic_salary', 'piasters', 496.2, 448.2, 28.9, 2),
  money('insured-pounds', 'insured_salary', 'pounds', 235.7, 448.1, 55.6, 5),
  money('insured-piastres', 'insured_salary', 'piasters', 291.3, 448.1, 28.8, 2),
  money('total-pounds', 'total_salary', 'pounds', 47.3, 448.1, 55.6, 5),
  money('total-piastres', 'total_salary', 'piasters', 102.9, 448.1, 28.8, 2),
  // residence (Form 1 has only code boxes for the district and governorate: the whole address goes on the street line),
  // phone, email
  { id: 'building-no', kind: 'boxes', tag: 'building_no', page: 1, x: 433.7, y: 592.6, width: 79.3, height: 19.9, fontSize: 12, boxes: 4, boxAlign: 'right', optional: true },
  line('address', 'address', 306, 512.9, 657.2),
  line('phone', 'phone', 375, 495.9, 731.5),
  line('email', 'personal_email', 374.6, 495.9, 755.5, { fontSize: 12, optional: true }),
  // written on: YYYY / MM / DD around the printed slashes
  { id: 'written-on', kind: 'boxes', tag: 'date', page: 1, x: 454, y: 771, width: 65, height: 13, fontSize: 10, boxes: 8, groups: [4, 2, 2], groupGap: 6.5, dateOrder: 'YMD' },
  // page 2, the declaration (إقرار): the company, its insurance number and address, the insured person's name
  line('p2-company-name', 'company_name_ar', 244.2, 489.6, 518.9, { page: 2 }),
  line('p2-employer-no', 'insurance_employer_no', 31.4, 160.2, 518.9, { page: 2 }),
  line('p2-company-address', 'company_address_ar', 31.1, 496, 544.6, { page: 2 }),
  line('p2-name', 'full_name_ar', 323.4, 527.6, 723.5, { page: 2 }),
]);

// Form 6's dotted lines run up to their labels: each text line ends 3 pt short of its dots (the office line more), so the
// text, aligned right, stays clear of the label.
/** Form 6 (إخطار بانتهاء اشتراك مؤمن عليه): leaving. */
export const FORM_6_FIELDS: PdfField[] = inArabicDigits([
  line('office', 'insurance_office', 453.1, 538, 53.2),
  { id: 'employer-no', kind: 'boxes', tag: 'insurance_employer_no', page: 1, x: 343.1, y: 120.7, width: 158.9, height: 19.9, fontSize: 12, boxes: 8, boxAlign: 'right' },
  line('company-name', 'company_name_ar', 84.7, 232.4, 135.6),
  // the tax number above the printed "----- / --- / ---" (dashes drawn mid-height): the first group moved left, clear of
  // the slash
  {
    id: 'tax-no',
    kind: 'boxes',
    tag: 'tax_reg_no',
    page: 1,
    x: 389.15,
    y: 141,
    width: 63.1,
    height: 11,
    fontSize: 9,
    boxes: 9,
    groups: [3, 3, 3],
    groupGap: 6.8,
    nudges: [{ dx: -7.05, dy: 0 }, { dx: -7.05, dy: 0 }, { dx: -7.05, dy: 0 }],
  },
  { id: 'insurance-no', kind: 'boxes', tag: 'insurance_no', page: 1, x: 340.8, y: 217.3, width: 158.9, height: 19.8, fontSize: 12, boxes: 8, boxAlign: 'right' },
  { id: 'national-id', kind: 'boxes', tag: 'national_id', page: 1, x: 223.1, y: 252.1, width: 277.8, height: 19.8, fontSize: 12, boxes: 14 },
  line('name', 'full_name_ar', 306.9, 515.1, 299.6),
  // the subscription's end, YYYY / MM / DD left to right; each printed slash takes a box's width
  { id: 'end', kind: 'boxes', tag: 'last_working_day', page: 1, x: 271.6, y: 324.5, width: 198.4, height: 21.2, fontSize: 12, boxes: 8, groups: [4, 2, 2], groupGap: 19.8, dateOrder: 'YMD' },
  // ending short of the dots' end, clear of the printed label
  line('reason', 'reason_ar', 78.4, 154, 335.6),
  // residence: the building number, the street, the district (the profile's city) and the governorate on their own lines
  { id: 'building-no', kind: 'boxes', tag: 'building_no', page: 1, x: 437.6, y: 411.8, width: 79.5, height: 19.9, fontSize: 12, boxes: 4, boxAlign: 'right', optional: true },
  line('address', 'address_line', 53.1, 371, 425.6),
  line('district', 'city', 250.5, 327.1, 461.6),
  line('governorate', 'governorate', 88, 158.1, 461.6),
  line('phone', 'phone', 138.5, 421.4, 479.6),
  line('email', 'personal_email', 210.7, 493.5, 497.6, { fontSize: 12, optional: true }),
  // page 2, the declaration (إقرار): the company, its insurance number and address, the insured person and theirs
  line('p2-company-name', 'company_name_ar', 294.2, 488, 453.5, { page: 2 }),
  { id: 'p2-employer-no', kind: 'boxes', tag: 'insurance_employer_no', page: 2, x: 15.6, y: 441.7, width: 178.8, height: 19.8, fontSize: 12, boxes: 9, boxAlign: 'right' },
  line('p2-company-address', 'company_address_ar', 62.1, 490.5, 478.5, { page: 2 }),
  line('p2-name', 'full_name_ar', 292.2, 453.9, 496.9, { page: 2 }),
  { id: 'p2-insurance-no', kind: 'boxes', tag: 'insurance_no', page: 2, x: 14.5, y: 484.7, width: 178.8, height: 19.9, fontSize: 12, boxes: 9, boxAlign: 'right' },
]);
