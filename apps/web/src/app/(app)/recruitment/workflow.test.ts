import { describe, expect, it } from 'vitest';
import { applicantHref, applicantsHref, listFromOf, readApplicantsQuery } from './recruitment';
import { applyLinksHint, careersTextHint, finalReviewWaiting, fromQuery, levelLabel, refineNav, siblingQueries, siblingsIn, workflowNav, WORKFLOW_STEPS } from './workflow';

// The hiring workflow apart from the filters (owner, 9 November 2026: "diffrenitate between the filteration and hiring
// workflow"), and a vacancy's long parts closed at first ("make them collapsable").

const base = '/recruitment/vacancies/v1';
const counts = { stages: { applied: 18, review_2: 8, screening: 0, interview: 0, offer: 0, hired: 0, rejected: 0 }, reviewRejected: 22, filteredOut: 0 };

describe('the hiring workflow', () => {
  it('lists the steps in their order, those out of it apart', () => {
    const nav = workflowNav(base, readApplicantsQuery({}), counts);
    expect(WORKFLOW_STEPS).toEqual(['applied', 'review_2', 'screening', 'interview', 'offer', 'hired']);
    expect(nav.steps.map((s) => [s.label, s.count])).toEqual([
      ['Applicants', 18],
      ['Final Review', 8],
      ['HR Screening', 0],
      ['Technical Interview', 0],
      ['Offer', 0],
      ['Hired', 0],
    ]);
    expect(nav.out.map((s) => [s.label, s.count])).toEqual([
      ['Rejected at review', 22],
      ['Rejected', 0],
      ['Filtered out', 0],
    ]);
    // All: everyone but those filtered out
    expect(nav.all).toMatchObject({ label: 'All', count: 48, current: true });
  });

  it('marks the step shown, and keeps the filters when another is picked', () => {
    const q = readApplicantsQuery({ stage: 'review_2', minMatch: '70', sort: 'cv' });
    const nav = workflowNav(base, q, counts);
    expect(nav.steps.find((s) => s.current)?.key).toBe('review_2');
    expect(nav.all.current).toBe(false);
    const applicants = new URL(nav.steps[0].href, 'https://x.test');
    expect(applicants.searchParams.get('stage')).toBe('applied');
    expect(applicants.searchParams.get('minMatch')).toBe('70');
    expect(applicants.searchParams.get('sort')).toBe('cv');
  });

  it('those out of the workflow: rejected at a review, rejected, filtered out', () => {
    expect(workflowNav(base, readApplicantsQuery({ reviewRejected: 'only' }), counts).out[0].current).toBe(true);
    expect(workflowNav(base, readApplicantsQuery({ stage: 'rejected' }), counts).out[1].current).toBe(true);
    const filtered = workflowNav(base, readApplicantsQuery({ filtered: 'only' }), counts);
    expect(filtered.out[2].current).toBe(true);
    expect(filtered.all.current).toBe(false);
  });

  it('without counts (All Applicants): the names alone', () => {
    const nav = workflowNav('/recruitment/applicants', readApplicantsQuery({}), null);
    expect(nav.all.count).toBeNull();
    expect(nav.steps.every((s) => s.count === null)).toBe(true);
  });
});

describe('the filters and the order', () => {
  const sources = [
    { source: 'careers' as const, label: 'Careers page (direct, no link)', count: 1 },
    { source: 'linkedin' as const, label: 'LinkedIn', count: 47 },
  ];

  it('toggles a filter on and off, the step kept', () => {
    const off = refineNav(base, readApplicantsQuery({ stage: 'applied' }), sources);
    expect(off.only.map((l) => [l.label, l.on])).toEqual([
      ['Match ≥ 70%', false],
      ['CV match ≥ 50%', false],
    ]);
    const on = new URL(off.only[0].href, 'https://x.test');
    expect(on.searchParams.get('minMatch')).toBe('70');
    expect(on.searchParams.get('stage')).toBe('applied');
    expect(off.clear).toBeNull();
    const back = refineNav(base, readApplicantsQuery({ stage: 'applied', minMatch: '70' }), sources);
    expect(back.only[0].on).toBe(true);
    expect(new URL(back.only[0].href, 'https://x.test').searchParams.get('minMatch')).toBeNull();
  });

  it('a source at a time, with its count', () => {
    const nav = refineNav(base, readApplicantsQuery({ source: 'linkedin' }), sources);
    expect(nav.sources.map((s) => [s.label, s.count, s.on])).toEqual([
      ['Careers page (direct, no link)', 1, false],
      ['LinkedIn', 47, true],
    ]);
    expect(new URL(nav.sources[1].href, 'https://x.test').searchParams.get('source')).toBeNull();
    expect(new URL(nav.sources[0].href, 'https://x.test').searchParams.get('source')).toBe('careers');
  });

  it('the order: best match unless another is picked; a column’s title said too', () => {
    expect(refineNav(base, readApplicantsQuery({}), []).sorts.filter((s) => s.on).map((s) => s.key)).toEqual(['best']);
    expect(refineNav(base, readApplicantsQuery({ sort: 'cv' }), []).sorts.filter((s) => s.on).map((s) => s.key)).toEqual(['cv']);
    const byName = refineNav(base, readApplicantsQuery({ sort: 'name' }), []);
    expect(byName.sorts.filter((s) => s.on).map((s) => s.label)).toEqual(['By applicant, A to Z']);
    expect(byName.clear).not.toBeNull();
  });

  it('Clear: no filter, the usual order, the step kept', () => {
    const nav = refineNav(base, readApplicantsQuery({ stage: 'review_2', minCvMatch: '50', source: 'linkedin', sort: 'years' }), sources);
    const clear = new URL(nav.clear ?? '', 'https://x.test');
    expect(clear.searchParams.get('stage')).toBe('review_2');
    expect([...clear.searchParams.keys()]).toEqual(['stage']);
  });
});

describe('a vacancy’s long parts, closed', () => {
  it('say what is inside', () => {
    expect(applyLinksHint(6, true)).toBe('6 links to copy, one for each channel · listed on the careers site');
    expect(applyLinksHint(1, false)).toBe('1 link to copy, one for each channel');
    expect(careersTextHint({ about: '<p>x</p>', responsibilities: null, requirements: '<p>y</p>' })).toBe('About the role · Requirements');
    expect(careersTextHint({ about: null, responsibilities: null, requirements: null })).toBe('No text yet');
  });
});

// Previous and Next through an applicant's step, and Back to the list where one was (owner, 9 November 2026)
describe('an applicant’s step', () => {
  const a = { vacancyId: 'v1', stage: 'review_2' as const, filteredOut: false };

  it('carries the list it was opened from, a recruitment list only', () => {
    const from = applicantsHref(base, readApplicantsQuery({ stage: 'review_2', sort: 'cv' }));
    const href = applicantHref('a1', from);
    expect(listFromOf(new URL(href, 'https://x.test').searchParams.get('from') ?? undefined)).toBe(from);
    expect(applicantHref('a1')).toBe('/recruitment/applicants/a1');
    expect(listFromOf('https://evil.test/recruitment/x')).toBeNull();
    expect(listFromOf('//evil.test/recruitment/x')).toBeNull();
    expect(listFromOf('/employees')).toBeNull();
    expect(listFromOf(undefined)).toBeNull();
  });

  it('goes through the step of the list it came from, its filters and order kept', () => {
    const from = applicantsHref(base, readApplicantsQuery({ stage: 'review_2', minMatch: '70', sort: 'cv' }));
    const [q] = siblingQueries(from, a);
    expect(q).toMatchObject({ vacancyId: 'v1', stage: 'review_2', minMatch: 70, sort: 'cv' });
    expect(levelLabel(q)).toBe('Final Review');
    expect(fromQuery(from).stage).toBe('review_2');
  });

  it('opened from All, or with no list: its own step', () => {
    expect(siblingQueries(applicantsHref(base, readApplicantsQuery({ minCvMatch: '50' })), a).map((q) => [q.stage, q.minCvMatch])).toEqual([['review_2', 50]]);
    expect(siblingQueries(null, a).map((q) => q.stage)).toEqual(['review_2']);
    expect(siblingQueries(null, { ...a, filteredOut: true }).map((q) => [q.stage, q.filtered])).toEqual([['', 'only']]);
    // a rejected one may have been rejected at a review
    expect(siblingQueries(null, { ...a, stage: 'rejected' }).map((q) => levelLabel(q))).toEqual(['Rejected', 'Rejected at review']);
  });

  it('moved since: the list it came from first, then its own step', () => {
    const from = applicantsHref(base, readApplicantsQuery({ stage: 'applied' }));
    expect(siblingQueries(from, a).map((q) => q.stage)).toEqual(['applied', 'review_2']);
  });

  it('the one before and after, and its place', () => {
    expect(siblingsIn(['a', 'b', 'c'], 'b')).toEqual({ prev: 'a', next: 'c', index: 2, total: 3 });
    expect(siblingsIn(['a', 'b', 'c'], 'a')).toEqual({ prev: null, next: 'b', index: 1, total: 3 });
    expect(siblingsIn(['a', 'b', 'c'], 'c')).toMatchObject({ next: null, index: 3 });
    expect(siblingsIn(['a'], 'z')).toBeNull();
  });
});

describe('the hiring manager’s Final Review on their vacancy (9 November 2026)', () => {
  it('says how many wait', () => {
    expect(finalReviewWaiting(1)).toBe('1 applicant waits for your Final Review: pass them on to HR Screening or reject them.');
    expect(finalReviewWaiting(8)).toBe('8 applicants wait for your Final Review: pass them on to HR Screening or reject them.');
  });
});
