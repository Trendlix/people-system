import { describe, expect, it } from 'vitest';
import { priorServiceFields, priorServiceFrom, priorServiceText } from './leave-facts';

// The service with earlier employers, towards the 30 days of 10 full years "لدى صاحب عمل أو أكثر" (Labour Law Art. 124;
// owner, 18 October 2026: "can you apply the leaves according to the law?").
describe('the service with earlier employers', () => {
  it('is said in years and months', () => {
    expect(priorServiceText(54)).toBe('4 years 6 months');
    expect(priorServiceText(12)).toBe('1 year');
    expect(priorServiceText(1)).toBe('1 month');
    expect(priorServiceText(0)).toBe('None recorded');
    expect(priorServiceText(null)).toBe('None recorded');
    expect(priorServiceFields(54)).toEqual({ years: '4', months: '6' });
    expect(priorServiceFields(24)).toEqual({ years: '2', months: '' });
    expect(priorServiceFields(null)).toEqual({ years: '', months: '' });
  });

  it('is typed as years and months, kept in months; both empty is none', () => {
    expect(priorServiceFrom('4', '6')).toEqual({ months: 54, error: null });
    expect(priorServiceFrom('', '8')).toEqual({ months: 8, error: null });
    expect(priorServiceFrom('٣', '')).toEqual({ months: 36, error: null });
    expect(priorServiceFrom('', '')).toEqual({ months: null, error: null });
    expect(priorServiceFrom('0', '0')).toEqual({ months: null, error: null });
    expect(priorServiceFrom('2', '12').error).toMatch(/^Enter the service with earlier employers/);
    expect(priorServiceFrom('51', '').error).not.toBeNull();
    expect(priorServiceFrom('two', '').error).not.toBeNull();
  });
});
