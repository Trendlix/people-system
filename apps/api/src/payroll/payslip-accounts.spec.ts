import { PDFDocument } from '@cantoo/pdf-lib';
import type { PayrollAllowance } from '@trendlix/shared';
import { shownGlyphs, shownLines } from '../../test/fixtures/pdf-form.js';
import { payslipSource } from '../../test/fixtures/payslip.js';
import { payslipContent } from './payslip-content.js';
import { payslipPdf } from './payslip-pdf.js';
import { accountsAllowanceOf, REGISTER_COLUMNS } from './register.js';

// The accounts allowance on the payslip and the register (owner, 25 October 2026: an allowance per client account, "By
// days"): its own row with the number of accounts, on the English payslip each account by name (never its code) with
// what it came to; in Arabic its Arabic name and count; its own column on the register. Every name and figure is
// invented.

const ACCOUNTS: PayrollAllowance = {
  name: 'Accounts allowance',
  amount: 1732.26,
  taxable: true,
  insured: false,
  accounts: [
    { accountId: 'a1', name: 'Acme Foods', from: '2026-10-01', to: '2026-10-31', days: 31, monthDays: 31, monthly: 1500, amount: 1500 },
    { accountId: 'a2', name: 'Beta Labs', from: '2026-10-24', to: '2026-10-31', days: 8, monthDays: 31, monthly: 900, amount: 232.26 },
  ],
};

const source = (accounts: PayrollAllowance = ACCOUNTS) =>
  payslipSource('monthly', {
    terms: {
      allowances: [{ name: 'Transportation allowance', amount: 1500, taxable: false, insured: false }, accounts],
      // the month's one part, the accounts allowance with it as the roster puts it
      segments: [
        {
          contractId: 'c1',
          number: 'CON-2026-0001',
          version: 1,
          from: '2026-10-01',
          to: '2026-10-31',
          days: 30,
          payBasis: 'monthly',
          gross: 24000,
          basicPercent: 80,
          hourlyRate: null,
          allowances: [{ name: 'Transportation allowance', amount: 1500, taxable: false, insured: false }, accounts],
        },
      ],
    },
    source: { allowancesAr: { 'Transportation allowance': 'بدل انتقال', 'Accounts allowance': 'بدل حسابات' } },
  });

describe('the accounts allowance on the payslip', () => {
  it('in English: its own row with the count, each account by name with its share, the amount as paid', () => {
    const s = source();
    // paid as it is: the Transportation for the whole month and the accounts' sum
    expect(s.line.result.allowances).toBe(3232.26);
    const c = payslipContent(s, 'en');
    const row = c.earnings!.rows.find((r) => r.label.startsWith('Accounts allowance'))!;
    expect(row).toEqual({ label: 'Accounts allowance (2 accounts)', amount: '1,732.26', value: 1732.26, note: 'Acme Foods 1,500.00 · Beta Labs 232.26 (8 of 31 days)' });
    // the rows still add up to the earnings
    expect(c.earnings!.total.value).toBeCloseTo(s.line.result.earned + s.line.result.allowances + (s.line.result.additionsUntaxed ?? 0), 2);
    const rows = c.earnings!.rows.reduce((sum, r) => sum + Math.round(r.value * 100), 0) / 100;
    expect(rows).toBeCloseTo(c.earnings!.total.value, 2);
  });

  it('in Arabic: its Arabic name and count, no breakdown', () => {
    const row = payslipContent(source(), 'ar').earnings!.rows.find((r) => r.label.startsWith('بدل حسابات'))!;
    expect(row.label).toBe('بدل حسابات (حسابان)');
    expect(row.note).toBeNull();
  });

  it('untaxed, it says so after the accounts', () => {
    const row = payslipContent(source({ ...ACCOUNTS, taxable: false }), 'en').earnings!.rows.find((r) => r.label.startsWith('Accounts allowance'))!;
    expect(row.note).toBe('Acme Foods 1,500.00 · Beta Labs 232.26 (8 of 31 days), not taxed');
  });

  it('fits on one page with many accounts, in both languages', async () => {
    const many: PayrollAllowance = {
      ...ACCOUNTS,
      accounts: Array.from({ length: 12 }, (_, i) => ({ accountId: `a${i}`, name: `Invented Account ${i + 1}`, from: '2026-10-01', to: '2026-10-31', days: 31, monthDays: 31, monthly: 500, amount: 500 })),
      amount: 6000,
    };
    for (const language of ['en', 'ar'] as const) {
      const pdf = await payslipPdf(payslipContent(source(many), language), null, { title: 'Payslip October 2026 · EMP-0142', author: 'TrendLIX' });
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
      if (language === 'en') expect(shownLines((await shownGlyphs(pdf)).filter((g) => g.text)).some((l) => l.includes('Accounts allowance (12 accounts)'))).toBe(true);
    }
  });
});

describe('the accounts allowance on the register', () => {
  it('has its own column before the allowances, empty without one', () => {
    const headers = REGISTER_COLUMNS.map((c) => c.header);
    expect(headers.slice(headers.indexOf('Accounts allowance'), headers.indexOf('Accounts allowance') + 2)).toEqual(['Accounts allowance', 'Allowances']);
    expect(accountsAllowanceOf(source().line.terms)).toBe(1732.26);
    expect(accountsAllowanceOf(payslipSource('monthly').line.terms)).toBeNull();
  });
});
