import { toDateOnly } from '../common/date-only.js';
import { contractFactsOf } from './contract-facts.js';

// The contract the Employees list's contract status is about (owner, 21 October 2026: "instead of the Emp code, add
// contract status"): the version in force, else the latest draft, never a pay change's draft for those who don't see pay.

type Row = Parameters<typeof contractFactsOf>[0][number];

const row = (status: string, over: Partial<Row> = {}): Row => ({
  status,
  form: 'fixed',
  startDate: toDateOnly('2026-01-01'),
  endDate: toDateOnly('2026-12-31'),
  approval: null,
  ...over,
});

describe('the contract the status is about', () => {
  it('is the newest signed version, before any draft', () => {
    const renewal = row('draft', { startDate: toDateOnly('2027-01-01'), endDate: toDateOnly('2027-12-31') });
    expect(contractFactsOf([renewal, row('active')], false)).toEqual({ status: 'active', form: 'fixed', startDate: '2026-01-01', endDate: '2026-12-31' });
  });

  it('is the newest draft without a signed one', () => {
    expect(contractFactsOf([row('draft', { form: 'open_ended', endDate: null })], false)).toEqual({ status: 'draft', form: 'open_ended', startDate: '2026-01-01', endDate: null });
  });

  it('keeps a pay change’s draft for those who see salaries', () => {
    const raise = row('draft', { approval: 'pending_ceo' });
    expect(contractFactsOf([raise], true)).toMatchObject({ status: 'draft' });
    expect(contractFactsOf([raise], false)).toBeNull();
    expect(contractFactsOf([raise, row('draft')], false)).toMatchObject({ status: 'draft' });
  });

  it('is null without a contract', () => {
    expect(contractFactsOf([], true)).toBeNull();
  });
});
