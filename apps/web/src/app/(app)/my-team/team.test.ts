import { describe, expect, it } from 'vitest';
import type { RaiseRequest } from '../../../lib/raise-types';
import { askedByText, latestRaise, probationOf, raiseNews } from './team';

const raise = (id: string, createdAt: string, status: RaiseRequest['status'], over: Partial<RaiseRequest> = {}): RaiseRequest => ({
  id,
  employee: { id: 'r1', employeeCode: 'TLX-0002', fullNameEn: 'Omar Sayed' },
  employmentId: 'e1',
  requester: 'self',
  requestedBy: { email: 'omar@trendlix.com' },
  reason: 'New duties',
  status,
  createdAt,
  updatedAt: createdAt,
  suggestedGross: null,
  raise: null,
  decision: null,
  doneAt: null,
  amountsHidden: true,
  ...over,
});

describe('probationOf', () => {
  const today = '2026-10-17';

  it('says when a probation ends and whether that is within 30 days', () => {
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-01' }, today)).toEqual({ end: '2026-11-01', days: 15, soon: true });
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-16' }, today)).toEqual({ end: '2026-11-16', days: 30, soon: true });
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-17' }, today)).toEqual({ end: '2026-11-17', days: 31, soon: false });
    // passed while still on probation: soon, to be looked at
    expect(probationOf({ status: 'probation', probationEnd: '2026-10-10' }, today)).toEqual({ end: '2026-10-10', days: -7, soon: true });
  });

  it('is nothing once off probation, without an end date, or without an employment', () => {
    expect(probationOf({ status: 'active', probationEnd: '2026-11-01' }, today)).toBeNull();
    expect(probationOf({ status: 'probation', probationEnd: null }, today)).toBeNull();
    // a trainee or an intern has no probation (19 October 2026), even with an older Probation
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-01', employmentType: 'trainee' }, today)).toBeNull();
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-01', employmentType: 'intern' }, today)).toBeNull();
    expect(probationOf({ status: 'probation', probationEnd: '2026-11-01', employmentType: 'full_time' }, today)).not.toBeNull();
    expect(probationOf(null, today)).toBeNull();
    expect(probationOf(undefined, today)).toBeNull();
  });
});

describe('raiseNews', () => {
  it('keeps the open requests, and those decided within 30 days, newest first', () => {
    const requests = [
      raise('open-old', '2026-01-10T08:00:00.000Z', 'with_hr'),
      raise('declined-lately', '2026-09-01T08:00:00.000Z', 'declined', { updatedAt: '2026-10-01T08:00:00.000Z' }),
      raise('done-long-ago', '2026-05-01T08:00:00.000Z', 'done', { updatedAt: '2026-06-01T08:00:00.000Z' }),
      raise('approved', '2026-10-05T08:00:00.000Z', 'approved'),
      raise('done-30-days', '2026-08-01T08:00:00.000Z', 'done', { updatedAt: '2026-09-17T08:00:00.000Z' }),
      raise('done-31-days', '2026-08-01T08:00:00.000Z', 'done', { updatedAt: '2026-09-16T08:00:00.000Z' }),
    ];
    expect(raiseNews(requests, '2026-10-17').map((r) => r.id)).toEqual(['approved', 'declined-lately', 'done-30-days', 'open-old']);
  });

  it('counts the day of a decision in Cairo', () => {
    // 22:30 UTC on 16 September is 17 September in Cairo: 30 days before 17 October
    const late = raise('late', '2026-08-01T08:00:00.000Z', 'declined', { updatedAt: '2026-09-16T22:30:00.000Z' });
    expect(raiseNews([late], '2026-10-17')).toHaveLength(1);
  });
});

describe('latestRaise', () => {
  it('is the newest request, whatever the order, or none', () => {
    const a = raise('a', '2026-03-01T08:00:00.000Z', 'done');
    const b = raise('b', '2026-10-01T08:00:00.000Z', 'with_hr');
    expect(latestRaise([a, b])?.id).toBe('b');
    expect(latestRaise([b, a])?.id).toBe('b');
    expect(latestRaise([])).toBeNull();
  });
});

describe('askedByText', () => {
  it('says who asked as the manager reads it', () => {
    const me = 'lead@trendlix.com';
    expect(askedByText({ requester: 'manager', requestedBy: { email: 'Lead@trendlix.com' } }, me)).toBe('you');
    expect(askedByText({ requester: 'manager', requestedBy: { email: 'old.lead@trendlix.com' } }, me)).toBe('their direct manager');
    expect(askedByText({ requester: 'manager', requestedBy: null }, me)).toBe('their direct manager');
    expect(askedByText({ requester: 'self', requestedBy: { email: 'omar@trendlix.com' } }, me)).toBe('the employee');
    expect(askedByText({ requester: 'hr', requestedBy: { email: 'hr@trendlix.com' } }, me)).toBe('HR');
  });
});
