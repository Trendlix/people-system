import { BUILT_IN_LAW_RATES, TEMPLATE_TAGS } from '@trendlix/shared';
import { MASK, previewValues } from './preview.js';
import { deductedTotal, printedDayCount, printedDeductions, type SettlementSource } from './settlement-values.js';
import { missingTags, resolveValues, rightFor, type ValueSources } from './values.js';

// The final settlement on the clearance and dues document (20 October 2026: the owner unsure, Claude recommended listing
// its deductions; {{deductions}} was always empty before): the advances and loans still owed on leaving, deducted
// ("taken from the final settlement, unless waived", the owner's words of 18 October 2026) or waived, the unused annual
// leave paid with it and the total deducted, each in words, one per line; restricted as pay is.

const SETTLEMENT: SettlementSource = {
  owed: [
    { kind: 'loan', reason: 'Laptop', outstanding: 3000, waived: false },
    { kind: 'advance', reason: 'Rent', outstanding: 1000, waived: true },
    { kind: 'advance', reason: ' Medical bill ', outstanding: 250.5, waived: false },
  ],
  unusedLeave: { days: 5, dayRate: 300, amount: 1500 },
};

const TAGS = ['deductions', 'deductions_ar', 'deductions_en', 'deductions_total'];

function sources(settlement: SettlementSource | null | undefined, language: ValueSources['language'] = 'ar'): ValueSources {
  return {
    language,
    employee: {
      employeeCode: 'TL-001',
      fullNameEn: 'Omar Khaled',
      fullNameAr: 'عمر خالد',
      displayName: null,
      nationality: null,
      gender: null,
      dateOfBirth: null,
      addressAr: null,
      city: null,
      governorate: null,
      buildingNo: null,
      mobile: null,
      workEmail: null,
      personalEmail: null,
      qualificationAr: null,
      insuranceNo: null,
      occupationCode: null,
      insuranceStartDate: null,
      insuranceBasicWage: null,
      insuranceComprehensiveWage: null,
    },
    identity: null,
    bank: null,
    employment: null,
    contract: null,
    ending: null,
    ...(settlement !== undefined && { settlement }),
    company: null,
    insuranceBasicDefault: 410,
    lawYears: BUILT_IN_LAW_RATES,
    documentDate: '2026-10-20',
    inputs: {},
  };
}

describe("the final settlement's deductions", () => {
  it('lists each advance or loan still owed, deducted or waived, the unused leave paid and the total deducted, one per line', () => {
    expect(printedDeductions(SETTLEMENT, 'en').split('\n')).toEqual([
      'Loan (Laptop): EGP 3,000 still owed, deducted',
      'Advance (Rent): EGP 1,000 still owed, waived',
      'Advance (Medical bill): EGP 250.50 still owed, deducted',
      'Unused leave: 5 days × EGP 300 = EGP 1,500',
      // what is waived isn't deducted
      'Total deducted: EGP 3,250.50',
    ]);
    expect(printedDeductions(SETTLEMENT, 'ar').split('\n')).toEqual([
      'قرض (Laptop): المتبقي 3,000 جنيه، مخصوم من المستحقات',
      'سلفة (Rent): المتبقي 1,000 جنيه، تم التنازل عنها',
      'سلفة (Medical bill): المتبقي 250.50 جنيه، مخصوم من المستحقات',
      'رصيد الإجازة السنوية غير المستنفد: 5 أيام × 300 جنيه = 1,500 جنيه',
      'إجمالي المخصوم: 3,250.50 جنيه',
    ]);
    expect(deductedTotal(SETTLEMENT)).toBe(3250.5);
  });

  it('says a waived loan in the masculine, and leaves out an empty reason', () => {
    const waived: SettlementSource = { owed: [{ kind: 'loan', reason: ' ', outstanding: 500, waived: true }], unusedLeave: null };
    expect(printedDeductions(waived, 'ar')).toBe('قرض: المتبقي 500 جنيه، تم التنازل عنه\nإجمالي المخصوم: 0 جنيه');
    expect(printedDeductions(waived, 'en')).toBe('Loan: EGP 500 still owed, waived\nTotal deducted: EGP 0');
    expect(deductedTotal(waived)).toBe(0);
  });

  it('only the unused leave: no total deducted; none at all: None, as none is a value too', () => {
    const leaveOnly: SettlementSource = { owed: [], unusedLeave: { days: 2.5, dayRate: 412.37, amount: 1030.93 } };
    expect(printedDeductions(leaveOnly, 'en')).toBe('Unused leave: 2.5 days × EGP 412.37 = EGP 1,030.93');
    expect(printedDeductions(leaveOnly, 'ar')).toBe('رصيد الإجازة السنوية غير المستنفد: 2.5 يوم × 412.37 جنيه = 1,030.93 جنيه');
    const nothing: SettlementSource = { owed: [], unusedLeave: null };
    expect([printedDeductions(nothing, 'en'), printedDeductions(nothing, 'ar')]).toEqual(['None', 'لا يوجد']);
    // no day's pay to work it out from (no signed contract): not printed
    expect(printedDeductions({ owed: [], unusedLeave: { days: 4, dayRate: 0, amount: 0 } }, 'en')).toBe('None');
    // without a settlement (no ending recorded) there is nothing to print: missing
    expect([printedDeductions(null, 'en'), printedDeductions(undefined, 'ar')]).toEqual(['', '']);
  });

  it('counts the days as Arabic counts them', () => {
    expect([1, 2, 3, 10, 11, 21, 1.5].map((n) => printedDayCount(n, 'ar'))).toEqual(['يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يومًا', '21 يومًا', '1.5 يوم']);
    expect([1, 2, 0.5].map((n) => printedDayCount(n, 'en'))).toEqual(['1 day', '2 days', '0.5 days']);
  });

  it("are the tags' values: in the template's language (a bilingual one's in Arabic), and the total as money is printed", () => {
    const en = resolveValues(sources(SETTLEMENT, 'en'), TAGS);
    expect(en.deductions).toBe(printedDeductions(SETTLEMENT, 'en'));
    expect(en.deductions_en).toBe(printedDeductions(SETTLEMENT, 'en'));
    expect(en.deductions_ar).toBe(printedDeductions(SETTLEMENT, 'ar'));
    expect(en.deductions_total).toBe('3,250.50');
    for (const language of ['ar', 'bilingual'] as const) expect(resolveValues(sources(SETTLEMENT, language), ['deductions']).deductions).toBe(printedDeductions(SETTLEMENT, 'ar'));
    expect(resolveValues(sources({ owed: [], unusedLeave: null }), TAGS)).toEqual({ deductions: 'لا يوجد', deductions_ar: 'لا يوجد', deductions_en: 'None', deductions_total: '0' });
  });

  it('are missing without an ending, to be recorded on the Employment tab', () => {
    for (const settlement of [null, undefined]) {
      const values = resolveValues(sources(settlement), TAGS);
      expect(Object.values(values)).toEqual(['', '', '', '']);
      expect(missingTags(values, TAGS).map((m) => [m.tag, m.label, m.where])).toEqual([
        ['deductions', 'Final settlement deductions', { tab: 'employment', key: 'ending' }],
        ['deductions_ar', 'Final settlement deductions (Arabic)', { tab: 'employment', key: 'ending' }],
        ['deductions_en', 'Final settlement deductions (English)', { tab: 'employment', key: 'ending' }],
        ['deductions_total', 'Final settlement deductions in total', { tab: 'employment', key: 'ending' }],
      ]);
    }
    expect(missingTags(resolveValues(sources(SETTLEMENT), TAGS), TAGS)).toEqual([]);
  });

  it('are restricted as pay: printed only for those who see salaries, masked in a preview for the others', () => {
    for (const tag of TAGS) {
      expect(rightFor(tag), tag).toBe('salary');
      expect(TEMPLATE_TAGS.find((t) => t.tag === tag), tag).toMatchObject({ group: 'ending', restricted: true });
    }
    // the ending's other tags are not
    for (const tag of ['resignation_date', 'request_date', 'last_working_day', 'reason_ar']) expect(rightFor(tag), tag).toBeNull();
    const values = resolveValues(sources(SETTLEMENT), [...TAGS, 'full_name_ar']);
    const hidden = previewValues(Object.keys(values), values, new Set(), undefined, { identity: true, salary: false, bank: true });
    expect(hidden.values).toEqual({ deductions: MASK, deductions_ar: MASK, deductions_en: MASK, deductions_total: MASK, full_name_ar: 'عمر خالد' });
    expect(hidden.shown).toEqual([]);
    const shown = previewValues(Object.keys(values), values, new Set(), undefined, { identity: false, salary: true, bank: false });
    expect(shown.values.deductions_total).toBe('3,250.50');
    expect(shown.shown).toEqual(TAGS);
  });
});
