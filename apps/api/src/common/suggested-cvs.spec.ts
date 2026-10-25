import {
  addedWithoutAnswers,
  APPLICATION_SOURCE_LABELS,
  cvSkillsMatcher,
  HIDDEN,
  INVITE_STANDARD,
  inviteLink,
  inviteMail,
  inviteWordsProblems,
  isListed,
  isOpenSuggestion,
  minYearsWanted,
  monthsBefore,
  monthsSince,
  personExclusion,
  reasonsLine,
  reasonText,
  recencyMonthsProblem,
  recordExclusion,
  scoreSuggestion,
  sourceOf,
  SUGGESTION_LIMITS,
  SUGGESTION_POINTS,
  SUGGESTION_STATUS_LABELS,
  suggestionsFor,
  suggestionsNotice,
  titleLikeness,
  titleWords,
  type SuggestionPerson,
  type SuggestionRecord,
  type SuggestionVacancy,
  type VacancyQuestion,
} from '@trendlix/shared';

// Suggested From Earlier CVs (owner, 24 October 2026: "does the system automatically add recomended general cv's to the
// opened posts?" and "is there a run to fetch previously updated CV's?"; asked, "Suggest; HR adds", "General CVs + past
// applicants", "Yes, HR presses 'Invite to apply'"; packages/shared suggested-cvs.ts): who is in the pool and every
// exclusion, the score and its reasons, the threshold, the top 50, the invitation's words. Made-up records only.

const NOW = new Date('2026-10-24T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const VACANCY: SuggestionVacancy = {
  id: 'v1',
  title: 'Video Editor',
  departmentId: 'team-video',
  topDepartmentId: 'dept-production',
  ofTeam: true,
  keySkills: ['Premiere Pro', 'After Effects', 'Color grading', 'DaVinci Resolve', 'Final Cut Pro', 'Storyboarding'],
  minYears: 2,
};

const PERSON: SuggestionPerson = { candidateId: 'c1', merged: false, employee: null, verdict: null, cLevelApplicant: false, inProcess: false };

const CV_TEXT = 'Mona Example\nVideo Editor at Studio X, 2022 - Present\nSkills: Premiere Pro, After Effects, DaVinci Resolve, colour, Storyboarding';
const matcher = cvSkillsMatcher(CV_TEXT);

/** A general CV in the video team, read: Video Editor before, about 3 years, 4 of the 6 key skills. */
const generalCv = (extra: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
  kind: 'general_cv',
  id: 'g1',
  candidateId: 'c1',
  at: daysAgo(40),
  status: 'new',
  verdict: null,
  departmentId: 'team-video',
  topDepartmentId: 'dept-production',
  yearsTyped: null,
  cvMonths: 34,
  cvLatestTitle: 'Video Editor',
  skillsFound: matcher,
  ...extra,
});

/** An application to another job in the same department (motion), not read. */
const application = (extra: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
  kind: 'application',
  id: 'a1',
  candidateId: 'c1',
  at: daysAgo(200),
  vacancyId: 'v-motion',
  vacancyTitle: 'Senior Video Editor',
  vacancyCLevel: false,
  stage: 'rejected',
  filteredOut: false,
  verdict: null,
  departmentId: 'team-motion',
  topDepartmentId: 'dept-production',
  yearsTyped: 3,
  cvMonths: null,
  cvLatestTitle: null,
  skillsFound: null,
  ...extra,
});

const nobody = { appliedHere: () => false, decided: () => false, now: NOW };

describe('the pool: who is never suggested', () => {
  it('a candidate merged, applied here, decided, C-level, a current employee, a former one not rehirable, "Not a fit", or in the running elsewhere', () => {
    const none = { applied: false, decided: false };
    expect(personExclusion(PERSON, none)).toBeNull();
    expect(personExclusion({ ...PERSON, merged: true }, none)).toBe('merged');
    expect(personExclusion(PERSON, { applied: true, decided: false })).toBe('applied_here');
    expect(personExclusion(PERSON, { applied: false, decided: true })).toBe('decided');
    expect(personExclusion({ ...PERSON, cLevelApplicant: true }, none)).toBe('c_level');
    expect(personExclusion({ ...PERSON, employee: { current: false, rehire: 'eligible', cLevel: true } }, none)).toBe('c_level');
    expect(personExclusion({ ...PERSON, employee: { current: true, rehire: null, cLevel: false } }, none)).toBe('employee');
    expect(personExclusion({ ...PERSON, employee: { current: false, rehire: 'not_eligible', cLevel: false } }, none)).toBe('not_rehirable');
    // a former employee who may be hired again (or not decided yet) is suggested
    expect(personExclusion({ ...PERSON, employee: { current: false, rehire: 'eligible', cLevel: false } }, none)).toBeNull();
    expect(personExclusion({ ...PERSON, employee: { current: false, rehire: null, cLevel: false } }, none)).toBeNull();
    expect(personExclusion({ ...PERSON, verdict: 'not_a_fit' }, none)).toBe('not_a_fit');
    expect(personExclusion({ ...PERSON, verdict: 'maybe' }, none)).toBeNull();
    expect(personExclusion({ ...PERSON, inProcess: true }, none)).toBe('in_process');
  });

  it('an earlier CV too old, "Not a fit", moved, archived; an application to this job, a C-level one, hired from or filtered out', () => {
    const since = monthsBefore(NOW, 12);
    expect(recordExclusion(generalCv(), 'v1', since)).toBeNull();
    expect(recordExclusion(generalCv({ status: 'reviewed' }), 'v1', since)).toBeNull();
    expect(recordExclusion(generalCv({ at: daysAgo(400) }), 'v1', since)).toBe('too_old');
    expect(recordExclusion(generalCv({ verdict: 'not_a_fit' }), 'v1', since)).toBe('not_a_fit');
    expect(recordExclusion(generalCv({ status: 'moved' }), 'v1', since)).toBe('moved');
    expect(recordExclusion(generalCv({ status: 'archived' }), 'v1', since)).toBe('archived');
    expect(recordExclusion(application(), 'v1', since)).toBeNull();
    expect(recordExclusion(application({ vacancyId: 'v1' }), 'v1', since)).toBe('this_vacancy');
    expect(recordExclusion(application({ vacancyCLevel: true }), 'v1', since)).toBe('c_level');
    expect(recordExclusion(application({ stage: 'hired' }), 'v1', since)).toBe('hired');
    expect(recordExclusion(application({ filteredOut: true }), 'v1', since)).toBe('filtered_out');
    expect(recordExclusion(application({ verdict: 'not_a_fit' }), 'v1', since)).toBe('not_a_fit');
    // rejected for another reason: still counts
    expect(recordExclusion(application({ stage: 'rejected', verdict: 'maybe' }), 'v1', since)).toBeNull();
    // the months back: 12 by default, as Recruitment Settings says
    expect(recordExclusion(generalCv({ at: daysAgo(200) }), 'v1', monthsBefore(NOW, 6))).toBe('too_old');
  });

  it('suggestionsFor leaves out every exclusion, keeps one row a candidate (their best CV), best first, the top 50', () => {
    const people = new Map<string, SuggestionPerson>([
      ['c1', PERSON],
      ['c2', { ...PERSON, candidateId: 'c2' }],
      ['c3', { ...PERSON, candidateId: 'c3', employee: { current: true, rehire: null, cLevel: false } }],
      ['c4', { ...PERSON, candidateId: 'c4', verdict: 'not_a_fit' }],
      ['c5', { ...PERSON, candidateId: 'c5' }],
    ]);
    const records = [
      generalCv(),
      application(),
      application({ id: 'a2', candidateId: 'c2', departmentId: 'team-sound', topDepartmentId: 'dept-sound', vacancyTitle: 'Sound Designer', yearsTyped: null }),
      generalCv({ id: 'g3', candidateId: 'c3' }),
      generalCv({ id: 'g4', candidateId: 'c4' }),
      generalCv({ id: 'g5', candidateId: 'c5', at: daysAgo(10), cvLatestTitle: 'Video Editor' }),
    ];
    const found = suggestionsFor(VACANCY, people, records, { ...nobody });
    // c2 neither matches the area nor reaches 30; c3 an employee; c4 "Not a fit"
    expect(found.map((f) => f.candidateId)).toEqual(['c5', 'c1']);
    // c1's general CV beats their application
    expect(found.find((f) => f.candidateId === 'c1')!.record).toEqual({ kind: 'general_cv', id: 'g1' });
    // applied here or decided: left out
    expect(suggestionsFor(VACANCY, people, records, { ...nobody, appliedHere: (c) => c === 'c5' }).map((f) => f.candidateId)).toEqual(['c1']);
    expect(suggestionsFor(VACANCY, people, records, { ...nobody, decided: (c, ids) => c === 'c1' || ids.includes('g5') })).toEqual([]);
    // the top 50 (or the limit given)
    const many = new Map<string, SuggestionPerson>(Array.from({ length: 60 }, (_, i) => [`m${i}`, { ...PERSON, candidateId: `m${i}` }]));
    const theirs = Array.from({ length: 60 }, (_, i) => generalCv({ id: `gm${i}`, candidateId: `m${i}`, at: daysAgo(i) }));
    expect(suggestionsFor(VACANCY, many, theirs, { ...nobody })).toHaveLength(SUGGESTION_LIMITS.shown);
    expect(suggestionsFor(VACANCY, many, theirs, { ...nobody, limit: 3 }).map((f) => f.candidateId)).toEqual(['m0', 'm1', 'm2']);
    // a candidate with no profile read (none in the people): never
    expect(suggestionsFor(VACANCY, new Map(), records, { ...nobody })).toEqual([]);
  });
});

describe('the score and its reasons', () => {
  it('the same team, 4 of 6 key skills, Video Editor before, ≈ 3 y, recent: 30 + 23 + 20 + 10 + 5', () => {
    const s = scoreSuggestion(VACANCY, generalCv(), NOW);
    expect(s.reasons.map((r) => r.kind)).toEqual(['area', 'skills', 'title', 'experience', 'recency']);
    expect(s.reasons[1]).toMatchObject({ kind: 'skills', found: ['Premiere Pro', 'After Effects', 'DaVinci Resolve', 'Storyboarding'], listed: 6, points: 23 });
    expect(s.score).toBe(30 + 23 + 20 + 10 + 5);
    expect(reasonsLine(s.reasons)).toBe('Same team · 4 of 6 key skills · Video Editor before · ≈ 3 y · Recent');
  });

  it('a past applicant of another team in the department: 15, the job applied for like this one, the years typed', () => {
    const s = scoreSuggestion(VACANCY, application(), NOW);
    expect(reasonsLine(s.reasons)).toBe('Same department · Applied for Senior Video Editor · 3 y');
    expect(s.score).toBe(SUGGESTION_POINTS.department + SUGGESTION_POINTS.title + SUGGESTION_POINTS.experience);
  });

  it('the area: the vacancy’s own department when it has no team reads "Same department", with the team’s points', () => {
    const atDepartment: SuggestionVacancy = { ...VACANCY, departmentId: 'dept-finance', topDepartmentId: 'dept-finance', ofTeam: false };
    const s = scoreSuggestion(atDepartment, generalCv({ departmentId: 'dept-finance', topDepartmentId: 'dept-finance', cvLatestTitle: null, skillsFound: null, cvMonths: null }), NOW);
    expect(s.reasons[0]).toEqual({ kind: 'area', exact: true, ofTeam: false, points: SUGGESTION_POINTS.team });
    expect(reasonText(s.reasons[0])).toBe('Same department');
    // another department: no area reason
    expect(scoreSuggestion(VACANCY, generalCv({ departmentId: 'dept-finance', topDepartmentId: 'dept-finance' }), NOW).reasons.some((r) => r.kind === 'area')).toBe(false);
    // a general CV with Other as its area (none)
    expect(scoreSuggestion(VACANCY, generalCv({ departmentId: null, topDepartmentId: null }), NOW).reasons.some((r) => r.kind === 'area')).toBe(false);
  });

  it('the key skills by share, none listed or the CV not read: no points', () => {
    expect(scoreSuggestion({ ...VACANCY, keySkills: [] }, generalCv(), NOW).reasons.some((r) => r.kind === 'skills')).toBe(false);
    expect(scoreSuggestion(VACANCY, generalCv({ skillsFound: null }), NOW).reasons.some((r) => r.kind === 'skills')).toBe(false);
    const all = scoreSuggestion({ ...VACANCY, keySkills: ['Premiere Pro'] }, generalCv(), NOW).reasons.find((r) => r.kind === 'skills');
    expect(all).toMatchObject({ points: SUGGESTION_POINTS.skills });
  });

  it('the title: from half the job’s words, the better of the CV’s latest and the job applied for', () => {
    expect(titleWords('Senior Video Editors & Colourists')).toEqual(['video', 'editor', 'colourist']);
    expect(titleLikeness('Video Editor', 'Senior Video Editor')).toBe(1);
    expect(titleLikeness('Video Editor', 'Video Producer')).toBe(0.5);
    expect(titleLikeness('Video Editor', 'Accountant')).toBe(0);
    expect(titleLikeness('', 'Video Editor')).toBe(0);
    const half = scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: 'Video Producer' }), NOW).reasons.find((r) => r.kind === 'title');
    expect(half).toEqual({ kind: 'title', from: 'cv', matchedTitle: 'Video Producer', points: 10 });
    expect(scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: 'Accountant' }), NOW).reasons.some((r) => r.kind === 'title')).toBe(false);
    // the CV's latest beats a weaker earlier job
    const best = scoreSuggestion(VACANCY, application({ cvLatestTitle: 'Video Editor', vacancyTitle: 'Video Producer' }), NOW).reasons.find((r) => r.kind === 'title');
    expect(best).toMatchObject({ from: 'cv', matchedTitle: 'Video Editor', points: 20 });
    // a developer's reason reads without the title (developer.ts hides matchedTitle)
    expect(reasonText({ kind: 'title', from: 'cv', matchedTitle: HIDDEN, points: 20 })).toBe('A similar job before');
    expect(reasonText({ kind: 'title', from: 'vacancy', matchedTitle: HIDDEN, points: 20 })).toBe('Applied for a similar job');
  });

  // owner, 25 October 2026: "Position, grouped by team": a general CV's chosen position counts as a title, beside its CV's
  it('the title: a general CV’s position counts as one, the better of it and the CV’s latest taken', () => {
    // a CV not read: its position alone
    const chosen = scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: null, positionTitle: 'Video Editor' }), NOW).reasons.find((r) => r.kind === 'title');
    expect(chosen).toEqual({ kind: 'title', from: 'position', matchedTitle: 'Video Editor', points: 20 });
    expect(reasonText(chosen!)).toBe('Position: Video Editor');
    // the position beats a weaker latest title, and the CV's latest wins a tie
    expect(scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: 'Video Producer', positionTitle: 'Video Editor' }), NOW).reasons.find((r) => r.kind === 'title')).toMatchObject({ from: 'position', points: 20 });
    expect(scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: 'Video Editor', positionTitle: 'Video Editor' }), NOW).reasons.find((r) => r.kind === 'title')).toMatchObject({ from: 'cv', points: 20 });
    // what they wrote for Other counts the same way; unlike the job, nothing
    expect(scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: null, positionTitle: 'Video producer' }), NOW).reasons.find((r) => r.kind === 'title')).toMatchObject({ from: 'position', points: 10 });
    expect(scoreSuggestion(VACANCY, generalCv({ cvLatestTitle: null, positionTitle: 'Accountant' }), NOW).reasons.some((r) => r.kind === 'title')).toBe(false);
    // an application's position is never read (only a general CV has one)
    expect(scoreSuggestion(VACANCY, application({ vacancyTitle: 'Accountant', positionTitle: 'Video Editor' }), NOW).reasons.some((r) => r.kind === 'title')).toBe(false);
    expect(reasonText({ kind: 'title', from: 'position', matchedTitle: HIDDEN, points: 20 })).toBe('A similar position chosen');
  });

  it('experience: counted only against the least the screening questions ask, shown either way', () => {
    const below = scoreSuggestion({ ...VACANCY, minYears: 5 }, generalCv(), NOW).reasons.find((r) => r.kind === 'experience')!;
    expect(below).toMatchObject({ met: false, points: 0 });
    expect(reasonText(below)).toBe('≈ 3 y (5+ wanted)');
    const none = scoreSuggestion({ ...VACANCY, minYears: null }, generalCv(), NOW).reasons.find((r) => r.kind === 'experience')!;
    expect(none).toMatchObject({ met: null, points: 0 });
    expect(reasonText({ kind: 'experience', years: 0, fromCv: true, minYears: null, met: null, points: 0 })).toBe('< 1 y');
    // no years at all: no reason
    expect(scoreSuggestion(VACANCY, generalCv({ cvMonths: null, yearsTyped: null }), NOW).reasons.some((r) => r.kind === 'experience')).toBe(false);
    const questions: VacancyQuestion[] = [
      { key: 'q1', kind: 'number', text: 'Years of experience in video editing', required: true, knockout: true, atLeast: 2, points: 5 },
      { key: 'q2', kind: 'number', text: 'How many reels can you send?', required: false, knockout: false, atLeast: 4, points: 2 },
      { key: 'q3', kind: 'number', text: 'سنوات الخبرة في المونتاج', required: false, knockout: false, atLeast: 3, points: 0 },
      { key: 'q4', kind: 'yes_no', text: 'Do you have 5 years of experience?', required: true, knockout: false, wanted: 'yes', points: 2 },
    ];
    expect(minYearsWanted(questions)).toBe(3);
    expect(minYearsWanted(questions.slice(1, 2))).toBeNull();
    expect(minYearsWanted([])).toBeNull();
  });

  it('recency: 5 within 3 months, 3 within 6, nothing older', () => {
    expect(scoreSuggestion(VACANCY, generalCv({ at: daysAgo(30) }), NOW).reasons.at(-1)).toEqual({ kind: 'recency', months: 0, points: 5 });
    expect(scoreSuggestion(VACANCY, generalCv({ at: daysAgo(150) }), NOW).reasons.at(-1)).toMatchObject({ kind: 'recency', points: 3 });
    expect(reasonText({ kind: 'recency', months: 4, points: 3 })).toBe('Within 6 months');
    expect(scoreSuggestion(VACANCY, generalCv({ at: daysAgo(250) }), NOW).reasons.some((r) => r.kind === 'recency')).toBe(false);
    expect(monthsSince(daysAgo(65), NOW)).toBe(2);
    expect(monthsSince(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(0);
  });

  it('the threshold: 30 or more, or the area matching', () => {
    expect(isListed({ score: 30, reasons: [] })).toBe(true);
    expect(isListed({ score: 29, reasons: [] })).toBe(false);
    expect(isListed({ score: 15, reasons: [{ kind: 'area', exact: false, ofTeam: true, points: 15 }] })).toBe(true);
    // a CV of another department naming 2 of 6 key skills and recent: 12 + 5, never listed
    const weak = scoreSuggestion(VACANCY, generalCv({ departmentId: null, topDepartmentId: null, cvLatestTitle: null, cvMonths: null, skillsFound: cvSkillsMatcher('Premiere Pro and After Effects') }), NOW);
    expect(weak.score).toBe(12 + 5);
    expect(isListed(weak)).toBe(false);
  });
});

describe('the statuses, sources and HR’s notice', () => {
  it('names each status; suggested and invited are still open', () => {
    expect(SUGGESTION_STATUS_LABELS).toEqual({ suggested: 'Suggested', invited: 'Invited', added: 'Added', applied: 'Applied', dismissed: 'Dismissed' });
    expect(['suggested', 'invited', 'added', 'applied', 'dismissed'].filter(isOpenSuggestion)).toEqual(['suggested', 'invited']);
    expect(recencyMonthsProblem(12)).toBeNull();
    expect(recencyMonthsProblem(0)).toContain('from 1 to 36');
    expect(recencyMonthsProblem(2.5)).toContain('whole number');
  });

  it('the new sources: added from the suggestions (no screening answers) and an invitation’s link', () => {
    expect(APPLICATION_SOURCE_LABELS.general_suggested).toBe('General CV (suggested)');
    expect(APPLICATION_SOURCE_LABELS.earlier_applicant).toBe('Earlier applicant (suggested)');
    expect(APPLICATION_SOURCE_LABELS.invite).toBe('Invited to apply');
    expect(sourceOf('invite')).toBe('invite');
    expect(sourceOf('general_suggested')).toBe('other');
    expect(addedWithoutAnswers('general_suggested')).toBe(true);
    expect(addedWithoutAnswers('earlier_applicant')).toBe(true);
    expect(addedWithoutAnswers('invite')).toBe(false);
    expect(addedWithoutAnswers('general')).toBe(false);
  });

  it('HR’s notice: how many and the job, never a name', () => {
    expect(suggestionsNotice(5, { title: 'Video Editor', number: 'VAC-2026-0003' })).toEqual({
      title: '5 earlier CVs match Video Editor',
      body: 'VAC-2026-0003: open Suggested From Earlier CVs on the vacancy to add them, invite them to apply or dismiss them.',
    });
    expect(suggestionsNotice(1, { title: 'Video Editor', number: 'VAC-2026-0003' }).title).toBe('1 earlier CV matches Video Editor');
  });
});

describe('the invitation to apply', () => {
  const vars = { name: 'Mona Example', job: 'Video Editor', company: 'Example Studio', link: 'https://people.example.test/careers/video-editor-vac-2026-0003?src=invite' };

  it('the standard words, English then Arabic, with the job and its link (?src=invite)', () => {
    expect(inviteLink('https://people.example.test/', 'video-editor-vac-2026-0003')).toBe(vars.link);
    const m = inviteMail({ subject: null, en: null, ar: null }, vars);
    expect(m.subject).toBe('An opening that may suit you: Video Editor · فرصة قد تناسبك: Video Editor');
    expect(m.text.startsWith('Dear Mona Example,')).toBe(true);
    expect(m.text).toContain(`please apply here: ${vars.link}`);
    expect(m.text).toContain(`يمكنك التقديم من هنا: ${vars.link}`);
    expect(m.text.indexOf('— — —')).toBeGreaterThan(m.text.indexOf('Example Studio HR'));
    expect(INVITE_STANDARD.en).toContain('{link}');
  });

  it('HR’s words, the link added when they leave it out; their limits', () => {
    const m = inviteMail({ subject: 'Join us as {job}', en: 'Hello {name}, we have {job} at {company}.', ar: null }, vars);
    expect(m.subject).toBe('Join us as Video Editor');
    expect(m.text.startsWith(`Hello Mona Example, we have Video Editor at Example Studio.\n\nApply here: ${vars.link}`)).toBe(true);
    expect(inviteWordsProblems({ subject: 'x'.repeat(151) })).toEqual(['Keep the invitation’s subject to 150 characters or fewer.']);
    expect(inviteWordsProblems({ en: 'x'.repeat(3001), ar: 'y'.repeat(3001) })).toHaveLength(2);
    expect(inviteWordsProblems({})).toEqual([]);
  });
});
