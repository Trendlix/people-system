import { describe, expect, it } from 'vitest';
import type { CandidateListItem, CandidateSummary, PossibleMatchView } from '@trendlix/shared';
import {
  candidateBadges,
  candidateHref,
  candidatesApiPath,
  codeTyped,
  latestText,
  matchesCountText,
  matchLine,
  mergeOrder,
  otherOf,
  readCandidatesQuery,
  timelineByDay,
} from './candidates';

// Candidate profiles on the site (owner, 22 October 2026: "how to make like a profile for each candidate to store history
// and prevent duplication?"; "HR decides from suggested match"). Every person here is made up.

const summary = (id: string, code: string): CandidateSummary => ({ id, code, fullName: `Person ${code}`, applications: 1, generalCvs: 0, lastAppliedAt: null });
const match = (a: CandidateSummary, b: CandidateSummary, extra: Partial<PossibleMatchView> = {}): PossibleMatchView => ({
  id: 'm1',
  kind: 'suggested',
  signals: ['same_linkedin', 'same_name'],
  why: 'Same LinkedIn · Same name',
  score: 95,
  weak: false,
  candidates: [a, b],
  updatedAt: '2026-10-22T10:00:00Z',
  ...extra,
});

describe('candidates on the site', () => {
  it('the addresses and the search', () => {
    expect(candidateHref('abc')).toBe('/recruitment/candidates/abc');
    expect(readCandidatesQuery({ q: '  mona  ' })).toEqual({ q: 'mona', minYears: null, verdict: '' });
    expect(readCandidatesQuery({ q: ['CAN-0001', 'x'] })).toEqual({ q: 'CAN-0001', minYears: null, verdict: '' });
    expect(readCandidatesQuery({})).toEqual({ q: '', minYears: null, verdict: '' });
    expect(candidatesApiPath({ q: '' })).toBe('/recruitment/candidates');
    expect(candidatesApiPath({ q: '+20 100' })).toBe('/recruitment/candidates?q=%2B20%20100');
  });

  it('an applicant’s badges: "2 applications" or "Applied before", and "Former employee"; none the first time', () => {
    expect(candidateBadges(null)).toEqual([]);
    expect(candidateBadges({ id: 'c', code: 'CAN-0001', applications: 1, generalCvs: 0, employee: null })).toEqual([]);
    expect(candidateBadges({ id: 'c', code: 'CAN-0001', applications: 2, generalCvs: 0, employee: 'former' })).toEqual(['2 applications', 'Former employee']);
    expect(candidateBadges({ id: 'c', code: 'CAN-0001', applications: 1, generalCvs: 1, employee: 'restricted' })).toEqual(['Applied before', 'Employee record']);
  });

  it('where the latest application stands', () => {
    const latest = (l: Partial<NonNullable<CandidateListItem['latest']>>): CandidateListItem['latest'] => ({
      kind: 'application',
      id: 'a',
      reference: 'APP-2026-0001',
      title: 'Video editor',
      stage: 'shortlisted',
      filteredOut: false,
      generalStatus: null,
      source: 'Careers page',
      at: '2026-10-22T10:00:00Z',
      ...l,
    });
    expect(latestText(latest({}))).toBe('Shortlisted');
    expect(latestText(latest({ filteredOut: true, stage: 'applied' }))).toBe('Filtered out');
    expect(latestText(latest({ kind: 'general_cv', stage: null, generalStatus: 'new' }))).toBe('General CV: New');
    expect(latestText(null)).toBe('—');
  });

  it('a match: the other candidate, the older one kept on a merge, and its line', () => {
    const a = summary('a', 'CAN-0042');
    const b = summary('b', 'CAN-0007');
    const m = match(a, b);
    expect(otherOf(m, 'a').id).toBe('b');
    expect(otherOf(m, 'b').id).toBe('a');
    expect(mergeOrder(a, b)).toEqual({ kept: b, merged: a });
    expect(mergeOrder(b, a)).toEqual({ kept: b, merged: a });
    expect(matchLine(m)).toBe('Suggested match · Same LinkedIn · Same name');
    expect(matchLine(match(a, b, { kind: 'duplicate', why: 'Same mobile' }))).toBe('Possible duplicate · Same mobile');
  });

  it('the tab’s count, the duplicates said apart', () => {
    expect(matchesCountText(0, 3)).toBe('3');
    expect(matchesCountText(1, 2)).toBe('3, 1 duplicate');
    expect(matchesCountText(2, 0)).toBe('2, 2 duplicates');
  });

  it('a code as typed for "Merge with…"', () => {
    expect(codeTyped(' CAN-0042 ')).toBe('CAN-0042');
    expect(codeTyped('can-42')).toBe('CAN-0042');
    expect(codeTyped('can 42')).toBe('CAN-0042');
    expect(codeTyped('42')).toBeNull();
    expect(codeTyped('APP-2026-0001')).toBeNull();
  });

  it('the timeline by the day in Cairo, the newest first', () => {
    const days = timelineByDay([
      { at: '2026-10-20T08:00:00Z', kind: 'application', text: 'Applied: Video editor (APP-2026-0001)', href: null },
      { at: '2026-10-22T21:30:00Z', kind: 'interview', text: 'Interview', href: null },
      { at: '2026-10-22T09:00:00Z', kind: 'offer', text: 'Job offer OFF-2026-0001 drafted', href: null },
    ]);
    // 21:30 UTC on 22 October is past midnight in Cairo: the 23rd
    expect(days.map((d) => [d.day, d.items.map((i) => i.kind)])).toEqual([
      ['2026-10-23', ['interview']],
      ['2026-10-22', ['offer']],
      ['2026-10-20', ['application']],
    ]);
  });
});
