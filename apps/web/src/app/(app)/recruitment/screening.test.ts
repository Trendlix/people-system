import { describe, expect, it } from 'vitest';
import type { ScreeningCommentView, ScreeningComments, ScreeningCv, ScreeningPerson, ScreeningTarget } from '@trendlix/shared';
import { candidatesApiPath, candidatesFiltering, readCandidatesQuery } from './candidates';
import { generalApiPath, generalFiltering, readGeneralQuery, filtering } from './general';
import { applicantsApiPath, readApplicantsQuery } from './recruitment';
import {
  asScreeningCvs,
  authorName,
  chipOf,
  commentFilters,
  commentForm,
  commentsOfCv,
  commentsOfRecord,
  cvBelongsTo,
  cvFileHref,
  cvIndexOf,
  cvPositionText,
  cvPreviewHref,
  defaultTargetKey,
  idOfKey,
  insertMention,
  keptMentions,
  mentionParts,
  mentionQueryAt,
  mentionSuggestions,
  ownCv,
  readCvParam,
  stepCv,
  targetBody,
  verdictBadge,
  verdictOf,
  VERDICT_STYLE,
  withCvParam,
} from './screening';

// CVs in a pop-up window and screening comments (owner, 24 October 2026: "when opening a CV, open it in a popup window",
// "is there a way to add screening comments?", "and i can add genearrl comments"; the verdict "Yes: Good fit / Maybe /
// Not a fit"; who, "HR + hiring manager & interviewers"). Made-up people only.

const APP = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const APP2 = '1c9f1d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f';
const GCV = '2d0a2e3a-4f5c-4d7e-8f1a-2b3c4d5e6f70';
const CAN = '3e1b3f4b-5a6d-4e8f-9a2b-3c4d5e6f7081';

const cv = (over: Partial<ScreeningCv> & Pick<ScreeningCv, 'kind' | 'id'>): ScreeningCv => ({
  reference: 'APP-2026-0001',
  title: 'Video Editor',
  cvFileName: 'cv.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  sentAt: '2026-10-20T08:00:00.000Z',
  key: `${over.kind}:${over.id}`,
  linkedKey: null,
  ...over,
});

const target = (key: string, over: Partial<ScreeningTarget> = {}): ScreeningTarget => ({
  key,
  about: key === 'general' ? { kind: 'general', id: null, reference: null, title: null } : { kind: key.startsWith('application') ? 'application' : 'general_cv', id: idOfKey(key), reference: 'APP-2026-0001', title: null },
  label: key === 'general' ? 'General' : key,
  linkedKey: null,
  count: 0,
  verdict: null,
  mentionable: [],
  ...over,
});

const comment = (id: string, about: ScreeningCommentView['about'], over: Partial<ScreeningCommentView> = {}): ScreeningCommentView => ({
  id,
  candidateId: CAN,
  about,
  aboutLabel: about.kind === 'general' ? 'General' : `${about.reference ?? ''}`,
  author: { email: 'sara.example@mail.test', name: 'Sara Example' },
  authorLabel: null,
  authorRole: 'hr',
  comment: 'Strong reel',
  verdict: null,
  mentions: [],
  createdAt: '2026-10-24T09:00:00.000Z',
  editedAt: null,
  mine: false,
  editableUntil: null,
  can: { edit: false, delete: false },
  ...over,
});

const GENERAL = { kind: 'general' as const, id: null, reference: null, title: null };
const ON_APP = { kind: 'application' as const, id: APP, reference: 'APP-2026-0001', title: 'Video Editor' };
const ON_GCV = { kind: 'general_cv' as const, id: GCV, reference: 'APP-2026-0002', title: null };
const ON_APP2 = { kind: 'application' as const, id: APP2, reference: 'APP-2026-0003', title: 'Designer' };

const people: ScreeningPerson[] = [
  { id: 'u-hr', name: 'Sara Example', email: 'sara.example@mail.test', role: 'hr' },
  { id: 'u-ceo', name: 'Omar Sample', email: 'omar.sample@mail.test', role: 'ceo' },
  { id: 'u-hm', name: 'Mona Placeholder', email: 'mona.placeholder@mail.test', role: 'hiring_manager' },
  { id: 'u-sara2', name: 'Sara Another', email: 'sara.another@mail.test', role: 'interviewer' },
];

describe('the verdict', () => {
  it('is a badge: Good fit green, Maybe amber, Not a fit red; nothing for none yet', () => {
    expect(VERDICT_STYLE).toEqual({ good_fit: 'bg-ok-soft text-ok', maybe: 'bg-warn-soft text-warn', not_a_fit: 'bg-danger-soft text-danger' });
    expect(verdictBadge('good_fit')).toEqual({ label: 'Good fit', className: 'bg-ok-soft text-ok' });
    expect(verdictBadge('not_a_fit')?.label).toBe('Not a fit');
    expect(verdictBadge(null)).toBeNull();
    expect(verdictBadge(undefined)).toBeNull();
  });

  it('filters the lists: a verdict or none yet, carried in the address; anything else is any', () => {
    expect(verdictOf('maybe')).toBe('maybe');
    expect(verdictOf(['none', 'x'])).toBe('none');
    expect(verdictOf('great')).toBe('');
    expect(verdictOf(undefined)).toBe('');
    expect(readApplicantsQuery({ verdict: 'good_fit' }).verdict).toBe('good_fit');
    expect(applicantsApiPath({ verdict: 'none', filtered: 'hide' })).toBe('/recruitment/applications?verdict=none');
    expect(filtering(readApplicantsQuery({ verdict: 'maybe' }))).toBe(true);
    expect(readGeneralQuery({ verdict: 'not_a_fit' }).verdict).toBe('not_a_fit');
    expect(generalApiPath({ verdict: 'good_fit' })).toBe('/recruitment/general-cvs?verdict=good_fit');
    expect(generalFiltering(readGeneralQuery({ verdict: 'none' }))).toBe(true);
    expect(generalFiltering(readGeneralQuery({ verdict: 'bad' }))).toBe(false);
    expect(readCandidatesQuery({ verdict: 'maybe' })).toEqual({ q: '', minYears: null, verdict: 'maybe' });
    expect(candidatesApiPath({ q: '', verdict: 'maybe' })).toBe('/recruitment/candidates?verdict=maybe');
    expect(candidatesFiltering(readCandidatesQuery({}))).toBe(false);
    expect(candidatesFiltering(readCandidatesQuery({ verdict: 'none' }))).toBe(true);
  });
});

describe('the CV window', () => {
  const cvs = [cv({ kind: 'application', id: APP }), cv({ kind: 'general_cv', id: GCV, reference: 'APP-2026-0002', title: 'General CV', linkedKey: `application:${APP2}` }), cv({ kind: 'application', id: APP2 })];

  it('has each CV’s addresses: shown, saved, and as a PDF', () => {
    expect(cvFileHref({ kind: 'application', id: APP })).toBe(`/recruitment/applicants/${APP}/cv`);
    expect(cvFileHref({ kind: 'general_cv', id: GCV }, true)).toBe(`/recruitment/general-cvs/${GCV}/cv?download=1`);
    expect(cvPreviewHref({ kind: 'application', id: APP })).toBe(`/recruitment/applicants/${APP}/cv/preview`);
    expect(cvPreviewHref({ kind: 'general_cv', id: GCV })).toBe(`/recruitment/general-cvs/${GCV}/cv/preview`);
  });

  it('says what the CV belongs to, without a hidden reference', () => {
    expect(cvBelongsTo({ kind: 'application', reference: 'APP-2026-0001', title: 'Video Editor' })).toBe('Application APP-2026-0001 for Video Editor');
    expect(cvBelongsTo({ kind: 'general_cv', reference: 'APP-2026-0002', title: 'General CV' })).toBe('General CV APP-2026-0002');
    expect(cvBelongsTo({ kind: 'application', reference: '••••', title: 'Video Editor' })).toBe('Application for Video Editor');
    expect(cvBelongsTo({ kind: 'general_cv', reference: '••••', title: 'General CV' })).toBe('General CV');
  });

  it('finds the CV a record’s id opens: its own, or the one holding the same CV', () => {
    expect(cvIndexOf(cvs, APP)).toBe(0);
    expect(cvIndexOf(cvs, GCV)).toBe(1);
    expect(cvIndexOf(cvs, APP2)).toBe(2);
    // a record listed only through the one holding its CV (an application made from a general CV)
    expect(cvIndexOf(cvs.slice(0, 2), APP2)).toBe(1);
    expect(cvIndexOf(cvs, 'nope')).toBe(-1);
    expect(cvIndexOf(cvs, null)).toBe(-1);
    expect(idOfKey(`general_cv:${GCV}`)).toBe(GCV);
    expect(idOfKey('general')).toBeNull();
  });

  it('goes to the previous and the next CV, round from the last to the first', () => {
    expect(stepCv(3, 0, 1)).toBe(1);
    expect(stepCv(3, 2, 1)).toBe(0);
    expect(stepCv(3, 0, -1)).toBe(2);
    expect(stepCv(1, 0, 1)).toBe(0);
    expect(stepCv(0, 0, 1)).toBe(-1);
    expect(cvPositionText(1, 3)).toBe('2 of 3');
  });

  it('is opened by ?cv=, the other parameters kept', () => {
    expect(readCvParam(`?cv=${APP}`)).toBe(APP);
    expect(readCvParam(new URLSearchParams(`tab=general&cv=${GCV}`))).toBe(GCV);
    expect(readCvParam('?cv=')).toBeNull();
    expect(readCvParam('')).toBeNull();
    expect(withCvParam('?tab=general', APP)).toBe(`?tab=general&cv=${APP}`);
    expect(withCvParam(`?cv=${APP}`, APP2)).toBe(`?cv=${APP2}`);
    expect(withCvParam(`?tab=general&cv=${APP}`, null)).toBe('?tab=general');
    expect(withCvParam(`?cv=${APP}`, null)).toBe('');
  });

  it('has the page’s own CV when the candidate’s couldn’t be loaded', () => {
    expect(ownCv('application', { id: APP, reference: 'APP-2026-0001', title: 'Video Editor', sentAt: '2026-10-20T08:00:00.000Z' }, { fileName: 'cv.docx', mimeType: 'x', sizeBytes: 10 })).toEqual([
      { kind: 'application', id: APP, reference: 'APP-2026-0001', title: 'Video Editor', cvFileName: 'cv.docx', mimeType: 'x', sizeBytes: 10, sentAt: '2026-10-20T08:00:00.000Z', key: `application:${APP}`, linkedKey: null },
    ]);
    expect(ownCv('general_cv', { id: GCV, reference: 'APP-2026-0002', title: 'General CV', sentAt: '2026-10-20T08:00:00.000Z' }, null)).toEqual([]);
    const { key, linkedKey, ...plain } = cvs[0];
    expect(asScreeningCvs([plain])).toEqual([{ ...plain, key, linkedKey }]);
  });

  it('puts a new comment on the page’s record when the CV is its, else on the CV’s record', () => {
    const targets = [target('general'), target(`application:${APP}`), target(`general_cv:${GCV}`, { linkedKey: `application:${APP2}` }), target(`application:${APP2}`, { linkedKey: `general_cv:${GCV}` })];
    // the profile: General, but in the CV window the CV's record
    expect(defaultTargetKey(targets, 'general')).toBe('general');
    expect(defaultTargetKey(targets, 'general', cvs[0])).toBe(`application:${APP}`);
    // the applicant page of the application made from the general CV: the application, the CV being the general CV's
    expect(defaultTargetKey(targets, `application:${APP2}`, cvs[1])).toBe(`application:${APP2}`);
    // another CV than the page's
    expect(defaultTargetKey(targets, `application:${APP}`, cvs[1])).toBe(`general_cv:${GCV}`);
    // a hiring manager: their application only
    expect(defaultTargetKey([target(`application:${APP}`)], `application:${APP}`)).toBe(`application:${APP}`);
    expect(defaultTargetKey([], 'general')).toBe('');
  });
});

describe('the comments shown', () => {
  const data: Pick<ScreeningComments, 'comments' | 'targets'> = {
    comments: [comment('c1', GENERAL, { verdict: 'good_fit' }), comment('c2', ON_APP), comment('c3', ON_GCV), comment('c4', ON_APP2)],
    targets: [target('general'), target(`application:${APP}`, { label: 'APP-2026-0001 · Video Editor' }), target(`general_cv:${GCV}`, { label: 'General CV APP-2026-0002', linkedKey: `application:${APP2}` }), target(`application:${APP2}`, { label: 'APP-2026-0003 · Designer', linkedKey: `general_cv:${GCV}` })],
  };

  it('on a record’s page: its own, the one holding the same CV’s, and the general ones', () => {
    expect(commentsOfRecord(data, `application:${APP}`).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(commentsOfRecord(data, `application:${APP2}`).map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
    expect(commentsOfCv(data, { key: `general_cv:${GCV}`, linkedKey: `application:${APP2}` }).map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
  });

  it('on the profile: the filters All, General and each record, with their counts', () => {
    expect(commentFilters(data)).toEqual([
      { key: 'all', label: 'All', count: 4 },
      { key: 'general', label: 'General', count: 1 },
      { key: `application:${APP}`, label: 'APP-2026-0001 · Video Editor', count: 1 },
      { key: `general_cv:${GCV}`, label: 'General CV APP-2026-0002', count: 2 },
      { key: `application:${APP2}`, label: 'APP-2026-0003 · Designer', count: 2 },
    ]);
  });

  it('names who wrote it, HR’s earlier notes by their label, and marks the general ones', () => {
    expect(authorName(comment('a', GENERAL))).toBe('Sara Example');
    expect(authorName(comment('b', GENERAL, { author: { email: 'omar.sample@mail.test', name: null } }))).toBe('omar.sample@mail.test');
    expect(authorName(comment('c', ON_APP, { author: null, authorLabel: 'HR (earlier notes)', authorRole: null }))).toBe('HR (earlier notes)');
    expect(authorName(comment('d', ON_APP, { author: null, authorLabel: null }))).toBe('A former user');
    expect(chipOf(comment('e', GENERAL))).toBe('General');
    expect(chipOf(comment('f', ON_GCV, { aboutLabel: 'General CV APP-2026-0002' }))).toBe('General CV APP-2026-0002');
  });
});

describe('@mentions', () => {
  it('finds the @… being typed at the caret, one line, after a space', () => {
    expect(mentionQueryAt('Ask @Sa', 7)).toEqual({ start: 4, query: 'Sa' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('Ask @Sara Ex', 12)).toEqual({ start: 4, query: 'Sara Ex' });
    expect(mentionQueryAt('mail me at sara@x', 17)).toBeNull();
    expect(mentionQueryAt('Ask @Sara\nthen', 14)).toBeNull();
    expect(mentionQueryAt('No mention here', 15)).toBeNull();
    expect(mentionQueryAt('Ask @ Sara', 10)).toBeNull();
  });

  it('offers only those who may read a comment on the target, by every word typed, not chosen already', () => {
    const general = ['u-hr', 'u-ceo'];
    const onApplication = ['u-hr', 'u-ceo', 'u-hm', 'u-sara2'];
    expect(mentionSuggestions(people, general, '').map((p) => p.id)).toEqual(['u-ceo', 'u-hr']);
    // the hiring manager isn't offered on a general comment
    expect(mentionSuggestions(people, general, 'mo')).toEqual([]);
    expect(mentionSuggestions(people, onApplication, 'mo').map((p) => p.id)).toEqual(['u-hm']);
    expect(mentionSuggestions(people, onApplication, 'sara').map((p) => p.id)).toEqual(['u-sara2', 'u-hr']);
    expect(mentionSuggestions(people, onApplication, 'sara ex').map((p) => p.id)).toEqual(['u-hr']);
    expect(mentionSuggestions(people, onApplication, 'sara', ['u-hr']).map((p) => p.id)).toEqual(['u-sara2']);
    expect(mentionSuggestions(people, onApplication, 'omar.sample').map((p) => p.id)).toEqual([]);
    expect(mentionSuggestions(people, onApplication, 'sample').map((p) => p.id)).toEqual(['u-ceo']);
    expect(mentionSuggestions(people, onApplication, '', [], 2)).toHaveLength(2);
  });

  it('puts "@Name " in place of what was typed', () => {
    expect(insertMention('Ask @Sa about it', 4, 7, 'Sara Example')).toEqual({ text: 'Ask @Sara Example about it', caret: 18 });
    expect(insertMention('@', 0, 1, 'Omar Sample')).toEqual({ text: '@Omar Sample ', caret: 13 });
  });

  it('keeps a mention only while its @Name is in the text', () => {
    expect(keptMentions('Ask @Sara Example and @Omar Sample', ['u-hr', 'u-ceo', 'u-hr'], people)).toEqual(['u-hr', 'u-ceo']);
    expect(keptMentions('Ask Sara Example', ['u-hr'], people)).toEqual([]);
    expect(keptMentions('Ask @Someone', ['u-unknown'], people)).toEqual([]);
  });

  it('marks the @Name of each one mentioned in a comment, the longest first', () => {
    expect(mentionParts('Ask @Sara Example, then @Omar.', ['Sara Example', 'Omar'])).toEqual([
      { text: 'Ask ', mention: false },
      { text: '@Sara Example', mention: true },
      { text: ', then ', mention: false },
      { text: '@Omar', mention: true },
      { text: '.', mention: false },
    ]);
    expect(mentionParts('@Sara Example', ['Sara', 'Sara Example'])).toEqual([{ text: '@Sara Example', mention: true }]);
    expect(mentionParts('No one', [])).toEqual([{ text: 'No one', mention: false }]);
    expect(mentionParts('A (1+1) name', ['(1+1)'])).toEqual([{ text: 'A (1+1) name', mention: false }]);
    expect(mentionParts('', ['Sara'])).toEqual([]);
  });
});

describe('the comment form', () => {
  const fd = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };

  it('is read: the text, a verdict or none, the mentions once each', () => {
    expect(commentForm(fd([['comment', '  Strong reel  '], ['verdict', 'good_fit'], ['mentions', 'u-hr'], ['mentions', 'u-hr'], ['mentions', 'u-ceo']]))).toEqual({
      body: { comment: 'Strong reel', verdict: 'good_fit', mentions: ['u-hr', 'u-ceo'] },
      errors: [],
    });
    expect(commentForm(fd([['comment', 'Text only'], ['verdict', '']])).body).toEqual({ comment: 'Text only', verdict: null, mentions: [] });
  });

  it('says what is wrong', () => {
    expect(commentForm(fd([['comment', '  ']])).errors).toEqual(['Write the comment.']);
    expect(commentForm(fd([['comment', 'x'.repeat(2001)]])).errors).toEqual(['Keep the comment to 2,000 characters or fewer.']);
    expect(commentForm(fd([['comment', 'Fine'], ['verdict', 'great']])).errors).toEqual(['Choose Good fit, Maybe or Not a fit, or no verdict.']);
  });

  it('sends where it goes: an application, a general CV, or the candidate for a general one', () => {
    expect(targetBody(`application:${APP}`, CAN)).toEqual({ applicationId: APP });
    expect(targetBody(`general_cv:${GCV}`, CAN)).toEqual({ generalCvId: GCV });
    expect(targetBody('general', CAN)).toEqual({ candidateId: CAN });
    expect(targetBody('general', null)).toBeNull();
    expect(targetBody('', CAN)).toBeNull();
    expect(targetBody('application:', CAN)).toBeNull();
  });
});
