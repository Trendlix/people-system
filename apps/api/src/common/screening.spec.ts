import {
  aboutKey,
  aboutLabel,
  applicationVerdicts,
  canEditComment,
  candidateVerdicts,
  editableUntil,
  EARLIER_NOTES_AUTHOR,
  filteredComments,
  latestVerdict,
  mentionNotice,
  newlyMentioned,
  readerRoleOf,
  recordComments,
  refusedMentions,
  SCREENING_EDIT_HOURS,
  SCREENING_VERDICT_LABELS,
  screeningCommentProblems,
  uniqueMentions,
  VERDICT_FILTER_LABELS,
  verdictMatches,
  type ScreeningAbout,
  type ScreeningCommentView,
  type ScreeningTarget,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { recruitmentCaller } from '../recruitment/recruitment-scope.js';
import { applicationReaders, authorRoleOf, commentWhere, generalReaders, type ApplicationReaders } from '../recruitment/screening-access.js';

// Screening comments' rules (owner, 24 October 2026: "is there a way to add screening comments?", "and i can add genearrl
// comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager & interviewers"; packages/shared
// screening.ts, apps/api/src/recruitment/screening-access.ts). Made-up records only.

const at = (iso: string) => new Date(iso);
const user = (roles: string[], id = 'u1'): SessionUser => ({ id, email: `${id}@example.test`, roles: roles as SessionUser['roles'] });

describe('the latest verdict', () => {
  it('is the newest comment with one: by when it was written, then by id; a comment without one leaves it', () => {
    expect(latestVerdict([])).toBeNull();
    expect(latestVerdict([{ id: 'a', verdict: null, createdAt: at('2026-10-20T09:00:00Z') }])).toBeNull();
    const rows = [
      { id: 'a', verdict: 'good_fit', createdAt: at('2026-10-20T09:00:00Z') },
      { id: 'b', verdict: 'not_a_fit', createdAt: at('2026-10-21T09:00:00Z') },
      // a text-only comment after it: the verdict stays the last one given
      { id: 'c', verdict: null, createdAt: at('2026-10-22T09:00:00Z') },
    ];
    expect(latestVerdict(rows)).toBe('not_a_fit');
    // the same moment: the higher id, always the same way
    expect(latestVerdict([{ id: 'b', verdict: 'maybe', createdAt: '2026-10-20T09:00:00Z' }, { id: 'a', verdict: 'good_fit', createdAt: '2026-10-20T09:00:00Z' }])).toBe('maybe');
    // an unknown value isn't a verdict
    expect(latestVerdict([{ id: 'a', verdict: 'great', createdAt: at('2026-10-23T09:00:00Z') }])).toBeNull();
  });

  it('per application from its own comments only (a general one doesn’t count); per candidate across them all', () => {
    const rows = [
      { id: '1', candidateId: 'c1', applicationId: 'app1', verdict: 'good_fit', createdAt: at('2026-10-20T09:00:00Z') },
      { id: '2', candidateId: 'c1', applicationId: null, verdict: 'not_a_fit', createdAt: at('2026-10-22T09:00:00Z') },
      { id: '3', candidateId: 'c1', applicationId: 'app2', verdict: 'maybe', createdAt: at('2026-10-21T09:00:00Z') },
      { id: '4', candidateId: 'c2', applicationId: 'app3', verdict: null, createdAt: at('2026-10-23T09:00:00Z') },
    ];
    expect(Object.fromEntries(applicationVerdicts(rows))).toEqual({ app1: 'good_fit', app2: 'maybe' });
    // the general comment is the newest of c1's: the candidate's latest
    expect(Object.fromEntries(candidateVerdicts(rows))).toEqual({ c1: 'not_a_fit' });
  });

  it('filters: a verdict, or none yet; no filter passes everything', () => {
    expect(verdictMatches(undefined, null)).toBe(true);
    expect(verdictMatches('good_fit', 'good_fit')).toBe(true);
    expect(verdictMatches('good_fit', 'maybe')).toBe(false);
    expect(verdictMatches('none', null)).toBe(true);
    expect(verdictMatches('none', 'maybe')).toBe(false);
    expect(SCREENING_VERDICT_LABELS).toEqual({ good_fit: 'Good fit', maybe: 'Maybe', not_a_fit: 'Not a fit' });
    expect(VERDICT_FILTER_LABELS.none).toBe('None yet');
  });
});

describe('who reads and writes', () => {
  const app = (extra: Partial<ApplicationReaders> = {}): ApplicationReaders => ({
    stage: 'shortlisted',
    rejectedFrom: null,
    filteredOut: false,
    vacancy: { hiringManagerId: 'emp-hm', grade: { confidential: false }, jobTitle: { minGrade: { confidential: false } } },
    interviews: [{ interviewers: [{ employeeId: 'emp-iv' }] }],
    ...extra,
  });
  const readers = [
    { id: 'hr1', roles: ['hr'] },
    { id: 'ceo1', roles: ['ceo'] },
    { id: 'sa1', roles: ['super_admin'] },
  ];
  const accounts = new Map([
    ['emp-hm', 'user-hm'],
    ['emp-iv', 'user-iv'],
  ]);

  it('HR, the CEO and a Super Admin: applications they see, general CVs and the candidates they see; the others only the applications they open', () => {
    const hr = JSON.stringify(commentWhere(recruitmentCaller(user(['hr']), null)));
    expect(hr).toContain('"generalCvId":{"not":null}');
    expect(hr).toContain('"applicationId":null,"generalCvId":null');
    // HR never a C-level vacancy's: the vacancies they see
    expect(hr).toContain('"confidential":true');
    // the CEO sees every vacancy
    expect(JSON.stringify(commentWhere(recruitmentCaller(user(['ceo']), null)))).not.toContain('"confidential":true');
    // a hiring manager or an interviewer: applications only, theirs (never a general one, never a general CV's)
    const hm = JSON.stringify(commentWhere(recruitmentCaller(user(['employee']), 'emp-hm')));
    expect(hm).toContain('"applicationId":{"not":null}');
    expect(hm).toContain('"hiringManagerId":"emp-hm"');
    expect(hm).toContain('"employeeId":"emp-hm"');
    expect(hm).not.toContain('generalCvId');
    // no employee profile and no recruitment role: nothing
    expect(commentWhere(recruitmentCaller(user(['employee']), null))).toEqual({ id: { in: [] } });
  });

  it('the author’s role at the time: the CEO, else a Super Admin, else HR; else the vacancy’s hiring manager or an interviewer', () => {
    expect(readerRoleOf(['hr', 'super_admin'])).toBe('super_admin');
    expect(readerRoleOf(['ceo', 'super_admin'])).toBe('ceo');
    expect(readerRoleOf(['hr'])).toBe('hr');
    expect(readerRoleOf(['employee'])).toBeNull();
    const a = { vacancy: { hiringManagerId: 'emp-hm' } };
    expect(authorRoleOf(recruitmentCaller(user(['hr']), 'emp-hm'), a)).toBe('hr');
    expect(authorRoleOf(recruitmentCaller(user(['employee']), 'emp-hm'), a)).toBe('hiring_manager');
    expect(authorRoleOf(recruitmentCaller(user(['employee']), 'emp-iv'), a)).toBe('interviewer');
  });

  it('who may be mentioned on an application: HR, the CEO, the Super Admins, its hiring manager while they see it, its interviewers', () => {
    expect([...applicationReaders(app(), readers, accounts)].sort()).toEqual(['ceo1', 'hr1', 'sa1', 'user-hm', 'user-iv']);
    // at Applied the hiring manager doesn't see it yet; nor one filtered out
    expect([...applicationReaders(app({ stage: 'applied' }), readers, accounts)]).not.toContain('user-hm');
    expect([...applicationReaders(app({ filteredOut: true }), readers, accounts)]).not.toContain('user-hm');
    // rejected from Interview: still theirs
    expect([...applicationReaders(app({ stage: 'rejected', rejectedFrom: 'interview' }), readers, accounts)]).toContain('user-hm');
    // a C-level vacancy: not HR
    const cLevel = app({ vacancy: { hiringManagerId: 'emp-hm', grade: { confidential: true }, jobTitle: { minGrade: null } } });
    expect([...applicationReaders(cLevel, readers, accounts)].sort()).toEqual(['ceo1', 'sa1', 'user-hm', 'user-iv']);
    // an employee without an active account: left out
    expect([...applicationReaders(app(), readers, new Map())].sort()).toEqual(['ceo1', 'hr1', 'sa1']);
  });

  it('who may be mentioned on a general comment or a general CV: the CEO and the Super Admins, HR when they see the candidate; never a hiring manager', () => {
    expect([...generalReaders(readers, true)].sort()).toEqual(['ceo1', 'hr1', 'sa1']);
    expect([...generalReaders(readers, false)].sort()).toEqual(['ceo1', 'sa1']);
  });
});

describe('mentions', () => {
  it('each once; refused when they may not read it; an edit tells only the newly mentioned', () => {
    expect(uniqueMentions(['a', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c']);
    expect(uniqueMentions(null)).toEqual([]);
    expect(refusedMentions(['a', 'x'], new Set(['a', 'b']))).toEqual(['x']);
    expect(refusedMentions(['a'], new Set(['a']))).toEqual([]);
    expect(newlyMentioned(['a'], ['a', 'b'])).toEqual(['b']);
    expect(newlyMentioned(['a', 'b'], ['b'])).toEqual([]);
  });

  it('their notification names the people and the record, never the comment', () => {
    const about: ScreeningAbout = { kind: 'application', id: 'app1', reference: 'APP-2026-0001', title: 'Video Editor' };
    expect(mentionNotice('Mona Example', 'Sara Example', about)).toEqual({ title: 'Mona Example mentioned you in a screening comment', body: 'Sara Example · APP-2026-0001 · Video Editor' });
    expect(mentionNotice('Mona Example', 'Sara Example', { kind: 'general', id: null, reference: null, title: null }).body).toBe('Sara Example');
  });
});

describe('editing', () => {
  const written = at('2026-10-24T08:00:00Z');

  it('its author only, for 24 hours after writing it; an earlier note (no author) never', () => {
    expect(SCREENING_EDIT_HOURS).toBe(24);
    expect(editableUntil(written).toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(canEditComment({ authorId: 'u1', createdAt: written }, 'u1', at('2026-10-25T07:59:59Z'))).toBe(true);
    expect(canEditComment({ authorId: 'u1', createdAt: written }, 'u1', at('2026-10-25T08:00:00Z'))).toBe(false);
    expect(canEditComment({ authorId: 'u1', createdAt: written }, 'u2', at('2026-10-24T09:00:00Z'))).toBe(false);
    expect(canEditComment({ authorId: null, createdAt: written }, 'u1', at('2026-10-24T09:00:00Z'))).toBe(false);
    expect(EARLIER_NOTES_AUTHOR).toBe('HR (earlier notes)');
  });

  it('a comment: some text, at most 2,000 characters; a verdict of the three or none; at most 20 mentions', () => {
    expect(screeningCommentProblems({ comment: 'Strong reel' })).toEqual([]);
    expect(screeningCommentProblems({ comment: '  ', verdict: 'good_fit' })).toEqual(['Write the comment.']);
    expect(screeningCommentProblems({ comment: 'x'.repeat(2001) })).toEqual(['Keep the comment to 2,000 characters or fewer.']);
    expect(screeningCommentProblems({ comment: 'ok', verdict: 'great' })).toEqual(['Choose Good fit, Maybe or Not a fit, or no verdict.']);
    expect(screeningCommentProblems({ comment: 'ok', verdict: null, mentions: Array.from({ length: 21 }, (_, i) => `u${i}`) })).toEqual(['Mention at most 20 people in one comment.']);
  });
});

describe('what a comment is about', () => {
  const general: ScreeningAbout = { kind: 'general', id: null, reference: null, title: null };
  const application: ScreeningAbout = { kind: 'application', id: 'app1', reference: 'APP-2026-0001', title: 'Video Editor' };
  const generalCv: ScreeningAbout = { kind: 'general_cv', id: 'gcv1', reference: 'APP-2026-0007', title: null };
  const comment = (id: string, about: ScreeningAbout): ScreeningCommentView => ({
    id,
    candidateId: 'c1',
    about,
    aboutLabel: aboutLabel(about),
    author: null,
    authorLabel: EARLIER_NOTES_AUTHOR,
    authorRole: null,
    comment: 'A made-up comment',
    verdict: null,
    mentions: [],
    createdAt: '2026-10-24T08:00:00.000Z',
    editedAt: null,
    mine: false,
    editableUntil: null,
    can: { edit: false, delete: false },
  });

  it('is labelled by its chip and keyed', () => {
    expect(aboutLabel(general)).toBe('General');
    expect(aboutLabel(application)).toBe('APP-2026-0001 · Video Editor');
    expect(aboutLabel(generalCv)).toBe('General CV APP-2026-0007');
    expect([aboutKey(general), aboutKey(application), aboutKey(generalCv)]).toEqual(['general', 'application:app1', 'general_cv:gcv1']);
  });

  it('a record’s page shows its own, the one holding the same CV’s and the general ones; the profile filters by record', () => {
    const all = [comment('1', general), comment('2', application), comment('3', generalCv), comment('4', { ...application, id: 'app2' })];
    expect(recordComments(all, ['application:app1']).map((c) => c.id)).toEqual(['1', '2']);
    expect(recordComments(all, ['application:app1', 'general_cv:gcv1']).map((c) => c.id)).toEqual(['1', '2', '3']);
    const targets = [{ key: 'application:app1', linkedKey: 'general_cv:gcv1' }] as ScreeningTarget[];
    expect(filteredComments(all, 'all', targets).map((c) => c.id)).toEqual(['1', '2', '3', '4']);
    expect(filteredComments(all, 'general', targets).map((c) => c.id)).toEqual(['1']);
    expect(filteredComments(all, 'application:app1', targets).map((c) => c.id)).toEqual(['2', '3']);
    expect(filteredComments(all, 'application:app2', targets).map((c) => c.id)).toEqual(['4']);
  });
});
