import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { apiStatisticsPath, apiWorkbookPath, canSeeReports, costChart, excelHref, reportsHref, summaryTiles, withoutText, yearToDateTitle, type StatisticsView } from './reports';

// Reports (Statistics) under Payroll (owner, 17 October 2026). Today is 17 October 2026. Every figure is invented.

const TODAY = '2026-10-17';
const as = (...roles: Role[]) => ({ roles });

describe('who sees them', () => {
  it('is HR, Finance and the CEO, as salaries', () => {
    expect(canSeeReports(as('hr'))).toBe(true);
    expect(canSeeReports(as('finance'))).toBe(true);
    expect(canSeeReports(as('ceo'))).toBe(true);
    expect(canSeeReports(as('admin', 'super_admin'))).toBe(false);
  });
});

describe('the addresses', () => {
  it('keep the period: plain for this calendar year', () => {
    expect(reportsHref({ from: '2026-01', to: '2026-12' }, TODAY)).toBe('/payroll/reports');
    expect(reportsHref({ from: '2025-11', to: '2026-10' }, TODAY)).toBe('/payroll/reports?from=2025-11&to=2026-10');
    expect(excelHref({ from: '2026-01', to: '2026-12' })).toBe('/payroll/reports/excel?from=2026-01&to=2026-12');
    expect(apiStatisticsPath({ from: '2026-01', to: '2026-03' })).toBe('/payroll/statistics?from=2026-01&to=2026-03');
    expect(apiWorkbookPath({ from: '2026-01', to: '2026-03' })).toBe('/payroll/statistics/workbook?from=2026-01&to=2026-03');
  });
});

const figures = { gross: 0, net: 0, transfer: 0, salaryTax: 0, employeeInsurance: 0, companyInsurance: 0, martyrsFund: 0, companyCost: 0 };

describe('the tiles', () => {
  it('lead with the cost, then what was paid and to how many', () => {
    const s = {
      totals: { ...figures, companyCost: 1_000_000, gross: 900_000, net: 700_000, transfer: 690_000, months: 3, employees: 12, personMonths: 34, averageGross: 26470.59, medianGross: 25000 },
    } as unknown as StatisticsView;
    expect(summaryTiles(s).map((t) => [t.label, t.value, t.note])).toEqual([
      ['Company cost', 'EGP 1,000,000.00', '3 months approved'],
      ['Gross', 'EGP 900,000.00', 'Earned and allowances'],
      ['Net', 'EGP 700,000.00', 'EGP 690,000.00 transferred'],
      ['Employees paid', '12', '34 person-months'],
      ['Average gross', 'EGP 26,470.59', 'Median EGP 25,000.00'],
    ]);
  });

  it('say why a month isn’t counted, and the year to date’s span', () => {
    expect(withoutText(null)).toBe('No run yet');
    expect(withoutText('draft')).toBe('A draft');
    expect(withoutText('pending_ceo')).toBe('With the CEO');
    expect(yearToDateTitle({ yearToDate: { from: '2026-01', to: '2026-10' } } as StatisticsView)).toBe('January to October 2026');
    expect(yearToDateTitle({ yearToDate: { from: '2026-01', to: '2026-01' } } as StatisticsView)).toBe('January 2026');
  });
});

describe('the trend chart', () => {
  it('draws each month’s cost to scale from 0, a slot for every month, a gap where none was approved', () => {
    const c = costChart(
      [
        { month: '2026-01', companyCost: 400_000 },
        { month: '2026-03', companyCost: 200_000 },
      ],
      { from: '2026-01', to: '2026-04' },
    )!;
    expect(c.bars.map((b) => b.month)).toEqual(['2026-01', '2026-03']);
    // to scale: half the cost, half the height, both standing on the axis
    expect(c.bars[1].height).toBeCloseTo(c.bars[0].height / 2, 6);
    expect(c.bars[0].y + c.bars[0].height).toBeCloseTo(c.plot.bottom, 6);
    // the axis from 0, its top above the highest
    expect(c.yTicks[0]).toEqual({ y: c.plot.bottom, label: '0' });
    expect(c.yTicks.at(-1)!.label).toBe('500K');
    // four slots: the third bar is two slots right of the first
    const slot = (c.plot.right - c.plot.left) / 4;
    expect(c.bars[1].x - c.bars[0].x).toBeCloseTo(slot * 2, 6);
    expect(c.xTicks.map((t) => t.label)).toEqual(['Jan 26', 'Feb', 'Mar', 'Apr']);
    expect(c.bars[0].title).toBe('January 2026: EGP 400,000.00');
    expect(c.description).toBe('The company cost of 2 months from January 2026 to April 2026, the highest EGP 400,000.00 in January 2026.');
  });

  it('labels every few months over a long period, and is none without a month', () => {
    const months = Array.from({ length: 24 }, (_, i) => ({ month: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, companyCost: 1000 }));
    const c = costChart(months, { from: '2025-01', to: '2026-12' })!;
    expect(c.xTicks).toHaveLength(12);
    expect(c.bars).toHaveLength(24);
    expect(costChart([], { from: '2026-01', to: '2026-12' })).toBeNull();
  });
});
