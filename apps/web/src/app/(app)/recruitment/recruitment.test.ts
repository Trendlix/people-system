import { describe, expect, it } from 'vitest';
import type { ApplicationView } from '@trendlix/shared';
import {
  applicantCvHref,
  applicantsApiPath,
  earlierCvHref,
  applicantsHref,
  APPLICANTS_PATH,
  approvesVacancies,
  careersJobHref,
  channelLinks,
  makeOfferHref,
  managesRecruitment,
  matchText,
  moved,
  newQuestion,
  nextQuestionKey,
  offerFromApplication,
  readApplicantsQuery,
  readsRecruitment,
  readVacancyFilter,
  vacanciesApiPath,
  vacanciesHref,
  vacancyForm,
  withKind,
} from './recruitment';

// Recruitment on the site (owner, 22 October 2026: "where will we include the ATS?"; "HR creates a vacancy and the CEO
// approves it").

const ID = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

describe('who does what', () => {
  it('lets HR and a Super Admin manage, the CEO and a Super Admin approve, the three read', () => {
    expect(managesRecruitment({ roles: ['hr'] })).toBe(true);
    expect(managesRecruitment({ roles: ['ceo'] })).toBe(false);
    expect(approvesVacancies({ roles: ['ceo'] })).toBe(true);
    expect(approvesVacancies({ roles: ['hr'] })).toBe(false);
    expect(readsRecruitment({ roles: ['super_admin'] })).toBe(true);
    expect(readsRecruitment({ roles: ['finance', 'admin'] })).toBe(false);
  });
});

describe('the lists', () => {
  it('read the vacancies filter, active unless chosen', () => {
    expect(readVacancyFilter({})).toEqual({ status: 'active', q: '' });
    expect(readVacancyFilter({ status: 'pending', q: ' producer ' })).toEqual({ status: 'pending', q: 'producer' });
    expect(readVacancyFilter({ status: 'nope' }).status).toBe('active');
    expect(vacanciesApiPath({ status: 'open', q: 'a b' })).toBe('/recruitment/vacancies?status=open&q=a%20b');
    expect(vacanciesHref({ status: 'active' })).toBe('/recruitment/vacancies');
    expect(vacanciesHref({ status: 'closed', q: 'x' })).toBe('/recruitment/vacancies?status=closed&q=x');
  });

  it('read the applicants filters, refusing what isn’t one', () => {
    expect(readApplicantsQuery({ stage: 'shortlisted', minMatch: '70', source: 'linkedin', filtered: 'only', vacancyId: ID })).toEqual({
      vacancyId: ID,
      stage: 'shortlisted',
      minMatch: 70,
      minYears: null,
      source: 'linkedin',
      filtered: 'only',
      q: '',
      minCvMatch: null,
      sort: '',
      skill: '',
      verdict: '',
    });
    expect(readApplicantsQuery({ stage: 'boss', minMatch: '170', source: 'x', filtered: 'x', vacancyId: '../x' })).toEqual({
      vacancyId: '',
      stage: '',
      minMatch: null,
      minYears: null,
      source: '',
      filtered: 'hide',
      q: '',
      minCvMatch: null,
      sort: '',
      skill: '',
      verdict: '',
    });
    expect(applicantsApiPath({ vacancyId: ID, stage: 'offer', minMatch: 70, filtered: 'hide' })).toBe(`/recruitment/applications?vacancyId=${ID}&stage=offer&minMatch=70`);
    expect(applicantsHref(APPLICANTS_PATH, { stage: 'hired', filtered: 'all' })).toBe('/recruitment/applicants?stage=hired&filtered=all');
    expect(applicantsHref(`/recruitment/vacancies/${ID}`, { vacancyId: ID, stage: 'hired' })).toBe(`/recruitment/vacancies/${ID}?stage=hired`);
  });

  it('show the match and link the CV and Make offer', () => {
    expect(matchText(90)).toBe('90%');
    expect(matchText(null)).toBe('—');
    expect(applicantCvHref(ID)).toBe(`/recruitment/applicants/${ID}/cv`);
    expect(applicantCvHref(ID, true)).toBe(`/recruitment/applicants/${ID}/cv?download=1`);
    // an earlier CV, kept when they applied again with a new one (25 October 2026: "Update their application")
    expect(earlierCvHref(ID, ID)).toBe(`/recruitment/applicants/${ID}/cv/earlier/${ID}`);
    expect(earlierCvHref(ID, ID, true)).toBe(`/recruitment/applicants/${ID}/cv/earlier/${ID}?download=1`);
    expect(makeOfferHref(ID)).toBe(`/offers/new?application=${ID}`);
  });
});

describe('the vacancy form', () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const good = {
    jobTitleId: ID,
    title: 'Video Producer',
    headcount: '2',
    employmentType: 'full_time',
    workArrangement: 'hybrid',
    durationMonths: '12',
    closingDate: '30/11/2026',
    salaryMin: '15,000',
    salaryMax: '25000',
    about: '<p>Produce</p>',
    questions: JSON.stringify([{ key: 'q1', kind: 'text', text: 'Hi', required: false, knockout: false }]),
  };

  it('reads what HR typed', () => {
    const { body, errors } = vacancyForm(form(good), { withQuestions: true });
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ jobTitleId: ID, headcount: 2, durationMonths: 12, closingDate: '2026-11-30', salaryMin: 15000, salaryMax: 25000, gradeId: null, about: '<p>Produce</p>', responsibilities: null });
    expect(body?.questions).toHaveLength(1);
    expect(vacancyForm(form(good), { withQuestions: false }).body).not.toHaveProperty('questions');
  });

  it('names what is wrong', () => {
    expect(vacancyForm(form({ ...good, jobTitleId: '', headcount: '1.5', closingDate: '31/02/2026', salaryMin: 'lots', questions: '{' }), { withQuestions: true }).errors).toEqual([
      'Choose the job title.',
      'The headcount is how many people to hire: a whole number from 1 to 50.',
      'Give the closing date as DD/MM/YYYY, or leave it empty.',
      'Give the least salary as an amount, e.g. 15000, or leave it empty.',
      'The questions could not be read. Reload the page and try again.',
    ]);
  });
});

describe('the questions editor', () => {
  it('gives each new question a key of its own and what its kind needs', () => {
    expect(nextQuestionKey([])).toBe('q1');
    expect(nextQuestionKey([{ key: 'q1' }, { key: 'q7' }, { key: 'qx' }])).toBe('q8');
    expect(newQuestion('yes_no', 'q2')).toEqual({ key: 'q2', kind: 'yes_no', text: '', required: true, knockout: false, wanted: 'yes', points: 0 });
    expect(newQuestion('choice', 'q3').options).toHaveLength(2);
    expect(newQuestion('text', 'q4').required).toBe(false);
    expect(withKind({ ...newQuestion('yes_no', 'q5'), text: 'Car?', knockout: true }, 'number')).toEqual({ key: 'q5', kind: 'number', text: 'Car?', required: true, knockout: false, atLeast: null, points: 0 });
  });

  it('moves a question up or down, not past the ends', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the channels and Make offer', () => {
  it('give each channel the same job page on the careers site with its source, never this site’s address', () => {
    const links = channelLinks('https://www.trendlix.com/en/careers', 'video-producer-vac-2026-0003');
    expect(links[0]).toEqual({ source: 'careers', href: 'https://www.trendlix.com/en/careers/video-producer-vac-2026-0003' });
    expect(links.find((l) => l.source === 'linkedin')?.href).toBe('https://www.trendlix.com/en/careers/video-producer-vac-2026-0003?src=linkedin');
    expect(links.find((l) => l.source === 'job_board')?.href).toBe('https://www.trendlix.com/en/careers/video-producer-vac-2026-0003?src=job_board');
    expect(links.map((l) => l.source)).toEqual(['careers', 'linkedin', 'facebook', 'job_board', 'referral', 'other']);
    expect(links.every((l) => !l.href.includes('people.trendlix.com'))).toBe(true);
    // another address set in Recruitment Settings: the links follow it
    expect(channelLinks('https://careers.example.test/jobs', 'video-producer-vac-2026-0003').find((l) => l.source === 'facebook')?.href).toBe(
      'https://careers.example.test/jobs/video-producer-vac-2026-0003?src=facebook',
    );
    expect(careersJobHref('https://www.trendlix.com/en/careers', 'video-producer-vac-2026-0003')).toBe('https://www.trendlix.com/en/careers/video-producer-vac-2026-0003');
  });

  it('fill a job offer from the applicant and their vacancy, the name in its own language', () => {
    const base = {
      fullNameEn: '',
      fullNameAr: '',
      email: '',
      mobile: '',
      employmentType: '',
      departmentId: '',
      jobTitleId: '',
      gradeId: '',
      managerId: '',
      shiftId: '',
      workArrangement: 'office',
      durationMonths: 12,
      note: '',
      grossSalary: null,
    };
    const a = {
      number: 'APP-2026-0004',
      fullName: 'Mona Adel',
      email: 'mona@mail.test',
      mobile: '+201001234567',
      position: { jobTitleId: 'j', departmentId: 'd', gradeId: null, hiringManagerId: 'm', shiftId: 's', employmentType: 'full_time', workArrangement: 'hybrid', durationMonths: null },
    } satisfies Pick<ApplicationView, 'number' | 'fullName' | 'email' | 'mobile' | 'position'>;
    expect(offerFromApplication(base, a)).toEqual({
      ...base,
      fullNameEn: 'Mona Adel',
      email: 'mona@mail.test',
      mobile: '+201001234567',
      employmentType: 'full_time',
      departmentId: 'd',
      jobTitleId: 'j',
      managerId: 'm',
      shiftId: 's',
      workArrangement: 'hybrid',
      note: 'From applicant APP-2026-0004',
    });
    expect(offerFromApplication(base, { ...a, fullName: 'منى عادل' })).toMatchObject({ fullNameEn: '', fullNameAr: 'منى عادل' });
  });
});
