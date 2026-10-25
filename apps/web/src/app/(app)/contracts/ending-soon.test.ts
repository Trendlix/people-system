import { HIDDEN } from '@trendlix/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExpiringContract } from '../../../lib/types';
import { ContractPerson, Due, ExpiringRow } from './ending-soon';
import { byDate } from './list';

// The home page's Contracts Ending Soon card (and the Contracts page's Ending Soon), as a developer sees it (owner, 23
// October 2026: "in developer view use **** instead of IDs"): the person by their tag without the hidden code, never
// "Employee EMP-0023 · EMP-0023"; the end date the API hid reads "Ends Hidden", in muted text, and the card doesn't crash
// sorting it. HR sees the code and the date as before.

const ID = '0e0e0e0e-1111-4222-8333-444455556666';
const TODAY = '2026-10-23';

const contract = (over: Partial<ExpiringContract> = {}): ExpiringContract => ({
  id: 'c1',
  number: 'CON-2025-0023',
  employee: { id: ID, employeeCode: 'EMP-0023', fullNameEn: 'Omar Khaled' },
  employmentId: 'e1',
  endDate: '2026-12-31',
  nonRenewalNoticeBy: '2026-10-26',
  renewalDraft: false,
  becameOpenEnded: false,
  training: null,
  conversionDraft: false,
  ...over,
});

/** A developer's: the codes "••••", the name a tag, the dates null. */
const hidden = (over: Partial<ExpiringContract> = {}) =>
  contract({ number: HIDDEN, employee: { id: ID, employeeCode: HIDDEN, fullNameEn: 'Employee 7K3Q' }, endDate: null, nonRenewalNoticeBy: null, becameOpenEnded: true, ...over });

const row = (c: ExpiringContract) => renderToStaticMarkup(createElement('ul', null, createElement(ExpiringRow, { contract: c, today: TODAY })));
/** The markup's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('a contract ending soon, for a developer', () => {
  it('"Employee 7K3Q" without the hidden code; "Ends Hidden" in muted text; the law’s warning as a status', () => {
    const html = row(hidden());
    expect(text(html)).toContain('Employee 7K3Q');
    expect(text(html)).toContain('Ends Hidden');
    expect(html).toContain('<span class="text-muted">Hidden</span>');
    expect(html).not.toContain(HIDDEN);
    expect(text(html)).not.toContain('·');
    // the status words stay (23 October 2026: they are statuses)
    expect(text(html)).toContain('Became open-ended');
    // no non-renewal notice line without its date
    expect(text(html)).not.toContain('Non-renewal notice');
    // the link still opens their Employment tab, by their id
    expect(html).toContain(`href="/employees/${ID}?tab=employment"`);
  });

  it('an intern’s agreement: its way forward without the date', () => {
    expect(text(row(hidden({ becameOpenEnded: false, training: { agreement: 1, next: 'renew_or_convert' } })))).toContain('Renew it once, or convert to full-time.');
  });

  it('sorted without crashing: the dated ones first, the hidden ones after them', () => {
    const rows = [hidden({ id: 'h1' }), contract({ id: 'c2', endDate: '2026-12-31' }), hidden({ id: 'h2' }), contract({ id: 'c3', endDate: '2026-11-15' })];
    expect(byDate(rows, (c) => c.endDate).map((c) => c.id)).toEqual(['c3', 'c2', 'h1', 'h2']);
    expect(byDate(null, (c: ExpiringContract) => c.endDate)).toBeNull();
  });
});

describe('a contract ending soon, for HR', () => {
  it('the name with the code, the end date and the notice date, as before', () => {
    const t = text(row(contract()));
    expect(t).toContain('Omar Khaled · EMP-0023');
    expect(t).toContain('Ends 31/12/2026');
    expect(t).toContain('Non-renewal notice by 26/10/2026');
    // within a week: highlighted with a word
    expect(t).toContain('In 3 days');
  });
});

describe('a date due and a person', () => {
  it('a date, or Hidden for none', () => {
    expect(renderToStaticMarkup(createElement(Due, { date: null, today: TODAY }))).toBe('<span class="text-muted">Hidden</span>');
    expect(text(renderToStaticMarkup(createElement(Due, { date: '2026-10-20', today: TODAY })))).toBe('20/10/2026Passed');
  });

  it('the person: the code after the name, or the tag alone', () => {
    expect(text(renderToStaticMarkup(createElement(ContractPerson, { employee: { id: ID, employeeCode: 'EMP-0023', fullNameEn: 'Omar Khaled' } })))).toBe('Omar Khaled · EMP-0023');
    expect(text(renderToStaticMarkup(createElement(ContractPerson, { employee: { id: ID, employeeCode: HIDDEN, fullNameEn: 'Employee 7K3Q' } })))).toBe('Employee 7K3Q');
  });
});
