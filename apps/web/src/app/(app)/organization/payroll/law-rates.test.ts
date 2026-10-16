import { BUILT_IN_LAW_RATES, LAW_7_2024_TAX_TIERS, lawRatesProblems, normalLawRates, normalTaxTiers, taxTiersProblems, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addBand,
  addTier,
  bandLabels,
  changedText,
  changesLawRates,
  changeTier,
  deletable,
  deleteQuestion,
  formProblems,
  lawRatesBody,
  lawRatesOf,
  limitsText,
  nextYear,
  parsePercent,
  percentField,
  removeBand,
  removeTier,
  seesLawRates,
  taxTiersOf,
  tierLabels,
  tierRowsOf,
  tiersSummary,
  typedOf,
} from './law-rates';

const as = (...roles: Role[]) => ({ roles });
const [Y2025, Y2026] = BUILT_IN_LAW_RATES;

describe('who sees and changes the rates set by law', () => {
  it('is read by HR, Finance, the CEO and Admin, and changed by the Super Admin only', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) expect(seesLawRates(as(role))).toBe(true);
    for (const role of ['employee', 'manager'] as const) expect(seesLawRates(as(role))).toBe(false);
    expect(changesLawRates(as('super_admin'))).toBe(true);
    for (const role of ['hr', 'finance', 'ceo', 'admin'] as const) expect(changesLawRates(as(role))).toBe(false);
  });
});

describe('rates typed as percents', () => {
  it('shows a rate as its percent, to 4 decimals', () => {
    expect(percentField(0.11)).toBe('11');
    expect(percentField(0.1875)).toBe('18.75');
    expect(percentField(0.0005)).toBe('0.05');
    expect(percentField(0.275)).toBe('27.5');
    // 0.07 × 100 is 7.000000000000001 by floating point
    expect(percentField(0.07)).toBe('7');
    expect(percentField(0)).toBe('0');
    expect(percentField(1)).toBe('100');
  });

  it('reads a percent as the fraction typed, without floating point noise', () => {
    expect(parsePercent('11')).toBe(0.11);
    expect(parsePercent('18.75')).toBe(0.1875);
    expect(parsePercent('0.05')).toBe(0.0005);
    expect(parsePercent('27.5%')).toBe(0.275);
    // ÷ 100 would give 0.09050000000000001, 0.5670000000000001 and 0.0007000000000000001
    expect(parsePercent('9.05')).toBe(0.0905);
    expect(parsePercent('56.7')).toBe(0.567);
    expect(parsePercent('0.07')).toBe(0.0007);
    expect(parsePercent(' ٢٢٫٥ ')).toBe(0.225);
    expect(parsePercent('0.0001')).toBe(0.000001);
    expect(parsePercent('')).toBeNull();
    for (const wrong of ['1.23456', 'abc', '-5', '1,5', '1000', '.5']) expect(parsePercent(wrong)).toBeNaN();
  });

  it('reads back every built-in rate as it is shown', () => {
    for (const r of BUILT_IN_LAW_RATES) {
      for (const rate of [r.employeeInsuranceRate, r.employerInsuranceRate, r.martyrsRate, r.healthInsuranceRate])
        expect(parsePercent(percentField(rate))).toBe(rate);
      for (const t of r.taxTiers) for (const b of t.bands) expect(parsePercent(percentField(b.rate))).toBe(b.rate);
    }
  });
});

describe('the tier editor', () => {
  it('starts from a year’s tiers and gives them back', () => {
    const rows = tierRowsOf(LAW_7_2024_TAX_TIERS);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ key: 't1', upTo: '600000' });
    expect(rows[0].bands.map((b) => [b.upTo, b.rate])).toEqual([
      ['40000', '0'],
      ['55000', '10'],
      ['70000', '15'],
      ['200000', '20'],
      ['400000', '22.5'],
      ['', '25'],
    ]);
    expect(rows.at(-1)?.upTo).toBe('');
    expect(taxTiersOf(rows)).toEqual(normalTaxTiers(LAW_7_2024_TAX_TIERS));
  });

  it('gives the last tier and each last band no limit, whatever their fields hold', () => {
    const tiers = taxTiersOf([
      {
        key: 'a',
        upTo: '100,000',
        bands: [
          { key: 'a1', upTo: '50000', rate: '0' },
          { key: 'a2', upTo: '75000', rate: '10' },
        ],
      },
      { key: 'b', upTo: '999', bands: [{ key: 'b1', upTo: '1', rate: '20' }] },
    ]);
    expect(tiers).toEqual([
      {
        upTo: 100000,
        bands: [
          { upTo: 50000, rate: 0 },
          { upTo: null, rate: 0.1 },
        ],
      },
      { upTo: null, bands: [{ upTo: null, rate: 0.2 }] },
    ]);
    expect(taxTiersProblems(tiers)).toEqual([]);
  });

  it('leaves what is empty or wrong for the checks to name', () => {
    const tiers = taxTiersOf([
      {
        key: 'a',
        upTo: '',
        bands: [
          { key: 'a1', upTo: 'lots', rate: '0' },
          { key: 'a2', upTo: '', rate: '' },
        ],
      },
      { key: 'b', upTo: '', bands: [{ key: 'b1', upTo: '', rate: '150' }] },
    ]);
    expect(taxTiersProblems(tiers)).toEqual([
      'Tier 1: enter its income limit as an amount above 0, to the piaster.',
      'Tier 1, band 1: enter its upper limit as an amount above 0, to the piaster.',
      'Tier 1, band 2: enter its rate as a percent from 0 to 100, with up to 4 decimals.',
      'Tier 2, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.',
    ]);
  });

  it('adds a tier at the end with the bands of the one before, which then needs a limit', () => {
    const rows = addTier(tierRowsOf(LAW_7_2024_TAX_TIERS), 'n1');
    expect(rows).toHaveLength(7);
    expect(rows[6].key).toBe('n1');
    expect(rows[6].bands.map((b) => [b.key, b.upTo, b.rate])).toEqual([
      ['n1b1', '1200000', '25'],
      ['n1b2', '', '27.5'],
    ]);
    expect(taxTiersProblems(taxTiersOf(rows))).toEqual(['Tier 6: enter its income limit as an amount above 0, to the piaster.']);
    const filled = changeTier(rows, 5, { upTo: '2,000,000' });
    expect(taxTiersOf(filled)[5].upTo).toBe(2_000_000);
    expect(taxTiersProblems(taxTiersOf(filled))).toEqual([]);
    expect(addTier([], 'n2')).toEqual([{ key: 'n2', upTo: '', bands: [{ key: 'n2b1', upTo: '', rate: '' }] }]);
  });

  it('removes a tier, but never the only one', () => {
    const rows = tierRowsOf(LAW_7_2024_TAX_TIERS);
    const fewer = removeTier(rows, 5);
    expect(fewer).toHaveLength(5);
    // the tier before the removed last one becomes the last: no limit
    expect(taxTiersOf(fewer).at(-1)?.upTo).toBeNull();
    const one = tierRowsOf(LAW_7_2024_TAX_TIERS.slice(-1));
    expect(removeTier(one, 0)).toEqual(one);
  });

  it('adds a band with the rate of the one before, and removes one, never the only one', () => {
    const rows = tierRowsOf(LAW_7_2024_TAX_TIERS);
    const more = addBand(rows, 5, 'n3');
    expect(more[5].bands.map((b) => [b.key, b.upTo, b.rate])).toEqual([
      ['t6b1', '1200000', '25'],
      ['t6b2', '', '27.5'],
      ['n3', '', '27.5'],
    ]);
    expect(more.slice(0, 5)).toEqual(rows.slice(0, 5));
    expect(taxTiersProblems(taxTiersOf(more))).toEqual(['Tier 6, band 2: enter its upper limit as an amount above 0, to the piaster.']);
    const changed = changeTier(more, 5, { band: 1, upTo: '3000000', rate: '30' });
    expect(taxTiersOf(changed)[5].bands).toEqual([
      { upTo: 1_200_000, rate: 0.25 },
      { upTo: 3_000_000, rate: 0.3 },
      { upTo: null, rate: 0.275 },
    ]);
    expect(removeBand(more, 5, 2)).toEqual(rows);
    const single = tierRowsOf([{ upTo: null, bands: [{ upTo: null, rate: 0.1 }] }]);
    expect(removeBand(single, 0, 0)).toEqual(single);
  });
});

describe('the form', () => {
  it('starts from a year’s rates, and gives them back', () => {
    const t = typedOf(Y2026);
    expect(t).toMatchObject({
      year: '2026',
      employeeInsuranceRate: '11',
      employerInsuranceRate: '18.75',
      insurableWageMin: '2700',
      insurableWageMax: '16700',
      personalExemption: '20000',
      martyrsRate: '0.05',
      healthInsuranceRate: '0',
    });
    for (const r of BUILT_IN_LAW_RATES) expect(lawRatesOf(typedOf(r))).toEqual(normalLawRates(r));
    // a year added starts from the latest one's values
    expect(lawRatesOf(typedOf(Y2026, 2027))).toEqual({ ...normalLawRates(Y2026), year: 2027 });
  });

  it('reads what is typed: amounts with commas, Arabic digits, percents', () => {
    const r = lawRatesOf({
      ...typedOf(Y2026),
      year: '٢٠٢٧',
      employeeInsuranceRate: '11.5',
      insurableWageMin: '3,000',
      insurableWageMax: '18 000.50',
      personalExemption: '٢٥٠٠٠',
      martyrsRate: '0.1%',
      healthInsuranceRate: '1',
    });
    expect(r).toMatchObject({
      year: 2027,
      employeeInsuranceRate: 0.115,
      insurableWageMin: 3000,
      insurableWageMax: 18000.5,
      personalExemption: 25000,
      martyrsRate: 0.001,
      healthInsuranceRate: 0.01,
    });
    expect(lawRatesProblems(r)).toEqual([]);
  });

  it('names what is wrong, as the API does', () => {
    const t = { ...typedOf(Y2026), year: '27', employeeInsuranceRate: '', insurableWageMin: '5000', insurableWageMax: '4000', personalExemption: 'none' };
    expect(formProblems(t, null)).toEqual([
      'Enter the year from 2000 to 2100.',
      "The employee's social insurance share must be a percent from 0 to 100, with up to 4 decimals.",
      "The maximum insurable wage (4,000.00) can't be below the minimum (5,000.00).",
      'Enter the personal exemption as an amount of 0 or more, to the piaster.',
    ]);
    expect(formProblems(typedOf(Y2026), null)).toEqual([]);
  });

  it('refuses to add a year already kept, which would replace it', () => {
    expect(formProblems(typedOf(Y2026, 2026), { kept: [2025, 2026] })).toEqual([
      'There are rates for 2026 already: change them with its Change button instead.',
    ]);
    expect(formProblems(typedOf(Y2026, 2027), { kept: [2025, 2026] })).toEqual([]);
    // changing a year: its own year is kept, of course
    expect(formProblems(typedOf(Y2026), null)).toEqual([]);
  });

  it('sends every rate but the year, which is in the address', () => {
    expect(lawRatesBody({ ...Y2026, taxTiers: LAW_7_2024_TAX_TIERS })).toEqual({
      employeeInsuranceRate: 0.11,
      employerInsuranceRate: 0.1875,
      insurableWageMin: 2700,
      insurableWageMax: 16700,
      personalExemption: 20000,
      martyrsRate: 0.0005,
      healthInsuranceRate: 0,
      taxTiers: normalTaxTiers(LAW_7_2024_TAX_TIERS),
    });
  });
});

describe('the rates in words', () => {
  it('lists a tier’s bands with their rates', () => {
    expect(bandLabels(LAW_7_2024_TAX_TIERS[0].bands)).toEqual([
      'Up to 40,000.00: 0%',
      '40,000.00 to 55,000.00: 10%',
      '55,000.00 to 70,000.00: 15%',
      '70,000.00 to 200,000.00: 20%',
      '200,000.00 to 400,000.00: 22.5%',
      'Above 400,000.00: 25%',
    ]);
    expect(bandLabels([{ upTo: null, rate: 0.3 }])).toEqual(['Any amount: 30%']);
  });

  it('lists the tiers by the whole annual net income, each band taxed from 0', () => {
    const tiers = tierLabels(LAW_7_2024_TAX_TIERS);
    expect(tiers.map((t) => t.range)).toEqual([
      'Up to 600,000.00',
      '600,000.00 to 700,000.00',
      '700,000.00 to 800,000.00',
      '800,000.00 to 900,000.00',
      '900,000.00 to 1,200,000.00',
      'Above 1,200,000.00',
    ]);
    // above 600,000 the first band is lost: the income up to 55,000 is taxed at 10%
    expect(tiers[1].bands[0]).toBe('Up to 55,000.00: 10%');
    expect(tiers[5].bands).toEqual(['Up to 1,200,000.00: 25%', 'Above 1,200,000.00: 27.5%']);
    expect(tierLabels([{ upTo: null, bands: [{ upTo: null, rate: 0.1 }] }])).toEqual([{ range: 'Any amount', bands: ['Any amount: 10%'] }]);
  });

  it('sums the tax table up', () => {
    expect(tiersSummary(LAW_7_2024_TAX_TIERS)).toBe('6 tiers, 0% to 27.5%');
    expect(tiersSummary([{ upTo: null, bands: [{ upTo: null, rate: 0.1 }] }])).toBe('1 tier, 10%');
    expect(limitsText(Y2025)).toBe('2,300.00 to 14,500.00');
  });

  it('says who changed a year last, and when', () => {
    expect(changedText({ updatedAt: '2026-10-16T14:42:00Z', updatedBy: { id: 'u1', name: 'Sara Adel' } })).toEqual({
      who: 'Sara Adel',
      when: '16/10/2026, 5:42 PM',
    });
    expect(changedText({ updatedAt: '2026-10-16T14:42:00Z', updatedBy: null }).who).toBe('Built in');
  });

  it('starts a new year after the latest, and deletes any but the earliest', () => {
    expect(nextYear([2025, 2026], 2026)).toBe(2027);
    expect(nextYear([2100], 2026)).toBe(2100);
    expect(nextYear([], 2026)).toBe(2026);
    expect(deletable([2025, 2026, 2027], 2026)).toBe(true);
    expect(deletable([2025, 2026, 2027], 2025)).toBe(false);
    expect(deletable([2025], 2025)).toBe(false);
    expect(deleteQuestion([2025, 2026, 2028], 2028)).toBe(
      'Delete the rates set by law for 2028? 2028 then uses those of 2026, as does each later year without its own. Approved payroll runs keep the rates they were worked out with.',
    );
  });
});
