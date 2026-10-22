import {
  answerProblems,
  applyProblems,
  canMoveVacancy,
  careersPath,
  isVacancySlug,
  offerable,
  publicQuestionOf,
  questionMaxPoints,
  restorable,
  scoreAnswers,
  sourceOf,
  stageMoveProblem,
  takesApplications,
  tidyAnswers,
  tidyQuestions,
  vacancyEditable,
  vacancyNumber,
  vacancyProblems,
  vacancyQuestionsProblems,
  vacancySlug,
  applicationNumber,
  type VacancyQuestion,
} from '@trendlix/shared';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, careersIpToken } from '@trendlix/shared';
import { signatureOf } from '../attendance/signed-ip.js';
import { applicantIp } from '../recruitment/public-careers.service.js';
import { cvFileName, cvProblem, cvTypeOf, DOCX, PDF } from '../recruitment/cv-file.js';

// Recruitment's rules (owner, 22 October 2026: "where will we include the ATS?"; "HR creates a vacancy and the CEO
// approves it"; "the match score uses rules from the screening questions"; packages/shared recruitment.ts).

const QUESTIONS: VacancyQuestion[] = [
  { key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, knockout: true, wanted: 'yes', points: 5 },
  { key: 'q2', kind: 'number', text: 'Years of video editing', required: true, knockout: false, atLeast: 3, points: 10 },
  {
    key: 'q3',
    kind: 'choice',
    text: 'Which editor do you use most?',
    required: true,
    knockout: true,
    options: [
      { label: 'Premiere Pro', points: 5, accepted: true },
      { label: 'DaVinci Resolve', points: 3, accepted: true },
      { label: 'None', points: 0, accepted: false },
    ],
  },
  { key: 'q4', kind: 'text', text: 'Anything to add?', required: false, knockout: false },
];

describe('vacancies', () => {
  it('moves as the CEO approves: HR sends a draft, the CEO approves or sends it back, HR holds, reopens and closes', () => {
    expect(canMoveVacancy('submit', 'draft')).toBe(true);
    expect(canMoveVacancy('approve', 'pending')).toBe(true);
    expect(canMoveVacancy('send_back', 'pending')).toBe(true);
    expect(canMoveVacancy('approve', 'draft')).toBe(false);
    expect(canMoveVacancy('hold', 'open')).toBe(true);
    expect(canMoveVacancy('reopen', 'on_hold')).toBe(true);
    expect(canMoveVacancy('close', 'on_hold')).toBe(true);
    expect(canMoveVacancy('close', 'filled')).toBe(false);
    expect(canMoveVacancy('reopen', 'closed')).toBe(false);
  });

  it('is changed fully while a draft, partly while published, not while waiting or closed', () => {
    expect(vacancyEditable('draft')).toBe('all');
    expect(vacancyEditable('open')).toBe('published');
    expect(vacancyEditable('on_hold')).toBe('published');
    expect(vacancyEditable('pending')).toBe('none');
    expect(vacancyEditable('closed')).toBe('none');
    expect(vacancyEditable('filled')).toBe('none');
  });

  it('takes applications while open and not past its closing date', () => {
    expect(takesApplications({ status: 'open', closingDate: null }, '2026-10-22')).toBe(true);
    expect(takesApplications({ status: 'open', closingDate: '2026-10-22' }, '2026-10-22')).toBe(true);
    expect(takesApplications({ status: 'open', closingDate: '2026-10-21' }, '2026-10-22')).toBe(false);
    expect(takesApplications({ status: 'on_hold', closingDate: null }, '2026-10-22')).toBe(false);
  });

  it('checks the terms in words', () => {
    expect(vacancyProblems({ title: 'Video Producer', headcount: 2, salaryMin: 15000, salaryMax: 25000, closingDate: '2026-11-30' }, '2026-10-22')).toEqual([]);
    expect(vacancyProblems({ title: ' ', headcount: 0 }, '2026-10-22')).toEqual([
      'Give the vacancy a title.',
      'The headcount is how many people to hire: a whole number from 1 to 50.',
    ]);
    expect(vacancyProblems({ salaryMin: 30000, salaryMax: 20000 }, '2026-10-22')).toEqual(['The least salary is more than the most: swap them.']);
    expect(vacancyProblems({ closingDate: '2026-10-01' }, '2026-10-22')).toEqual(['The closing date has passed: choose today or a later day.']);
    expect(vacancyProblems({ durationMonths: 0 }, '2026-10-22')).toEqual(['The contract length is in whole months, from 1 to 60.']);
  });

  it('numbers vacancies and applications by year, and gives each vacancy an address', () => {
    expect(vacancyNumber(2026, 3)).toBe('VAC-2026-0003');
    expect(applicationNumber('2026', 12)).toBe('APP-2026-0012');
    expect(vacancySlug('Video Producer', 'VAC-2026-0003')).toBe('video-producer-vac-2026-0003');
    expect(vacancySlug('Head of Sales & Marketing', 'VAC-2026-0004')).toBe('head-of-sales-and-marketing-vac-2026-0004');
    expect(vacancySlug('مونتير', 'VAC-2026-0005')).toBe('vac-2026-0005');
    expect(isVacancySlug('video-producer-vac-2026-0003')).toBe(true);
    expect(isVacancySlug('../etc')).toBe(false);
  });
});

describe('the channels', () => {
  it('reads ?src= as a channel, the careers page without one, Other for anything else', () => {
    expect(sourceOf('linkedin')).toBe('linkedin');
    expect(sourceOf(undefined)).toBe('careers');
    expect(sourceOf('')).toBe('careers');
    expect(sourceOf('tiktok')).toBe('other');
    expect(careersPath('video-producer-vac-2026-0003')).toBe('/careers/video-producer-vac-2026-0003');
    expect(careersPath('video-producer-vac-2026-0003', 'job_board')).toBe('/careers/video-producer-vac-2026-0003?src=job_board');
  });
});

describe('screening questions', () => {
  it('passes good questions and names what is wrong with others', () => {
    expect(vacancyQuestionsProblems(QUESTIONS)).toEqual([]);
    expect(vacancyQuestionsProblems('nope')).toEqual(['Send the questions as a list.']);
    expect(
      vacancyQuestionsProblems([
        { key: 'q1', kind: 'yes_no', text: 'Car?', required: true, knockout: true, points: 2 },
        { key: 'q1', kind: 'number', text: 'Years', required: true, knockout: false, points: 4 },
        { key: 'q3', kind: 'choice', text: 'Pick', required: true, knockout: true, options: [{ label: 'A', points: 1, accepted: false }] },
      ]),
    ).toEqual([
      'Question 1 (Car?): choose the answer wanted, Yes or No.',
      'Question 2 (Years): another question has its key. Reload the page and try again.',
      'Question 2 (Years): give the least number wanted.',
      'Question 3 (Pick): give from 2 to 8 options.',
      'Question 3 (Pick): a must-have choice needs at least one accepted option.',
    ]);
    expect(vacancyQuestionsProblems(Array.from({ length: 11 }, (_, i) => ({ key: `q${i}`, kind: 'text', text: 'Hi', required: false, knockout: false })))).toContain(
      'A vacancy takes at most 10 questions.',
    );
  });

  it('keeps a must-have required, and what each kind uses', () => {
    const [yes] = tidyQuestions([{ key: 'q1', kind: 'yes_no', text: '  Do you drive?  ', required: false, knockout: true, wanted: 'yes', points: 2, atLeast: 4 }]);
    expect(yes).toEqual({ key: 'q1', kind: 'yes_no', text: 'Do you drive?', required: true, knockout: true, wanted: 'yes', points: 2 });
    expect(questionMaxPoints(QUESTIONS[2])).toBe(5);
    expect(questionMaxPoints(QUESTIONS[3])).toBe(0);
  });

  it('shows the careers page no points, no must-have rules', () => {
    expect(publicQuestionOf(QUESTIONS[2])).toEqual({ key: 'q3', kind: 'choice', text: 'Which editor do you use most?', required: true, options: ['Premiere Pro', 'DaVinci Resolve', 'None'] });
    expect(publicQuestionOf(QUESTIONS[0])).toEqual({ key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, options: null });
  });
});

describe('the match', () => {
  it('adds up the points of the wanted answers, of the most possible', () => {
    const m = scoreAnswers(QUESTIONS, tidyAnswers(QUESTIONS, { q1: 'yes', q2: '4', q3: 'DaVinci Resolve', q4: 'Hello' }));
    expect([m.points, m.maxPoints, m.matchPercent, m.knockedOut]).toEqual([18, 20, 90, []]);
    expect(m.answers.map((a) => [a.key, a.points, a.passed])).toEqual([
      ['q1', 5, true],
      ['q2', 10, null],
      ['q3', 3, true],
      ['q4', 0, null],
    ]);
  });

  it('filters out one failing a must-have, whatever the points', () => {
    const m = scoreAnswers(QUESTIONS, tidyAnswers(QUESTIONS, { q1: 'no', q2: 10, q3: 'None' }));
    expect(m.knockedOut).toEqual(['q1', 'q3']);
    expect(m.matchPercent).toBe(50);
  });

  it('has no % when no question gives points', () => {
    expect(scoreAnswers([QUESTIONS[3]], { q4: 'x' }).matchPercent).toBeNull();
  });

  it('wants the required answers, each in its kind', () => {
    expect(answerProblems(QUESTIONS, tidyAnswers(QUESTIONS, { q1: 'maybe', q2: 'lots', q3: 'Final Cut' }))).toEqual([
      'Answer Yes or No: Do you live in Cairo?',
      'Give a number: Years of video editing',
      'Choose one of the options: Which editor do you use most?',
    ]);
    expect(answerProblems(QUESTIONS, tidyAnswers(QUESTIONS, {}))).toEqual([
      'Answer: Do you live in Cairo?',
      'Answer: Years of video editing',
      'Answer: Which editor do you use most?',
    ]);
    // unknown keys are dropped
    expect(tidyAnswers(QUESTIONS, { q9: 'x', q2: '1,5' })).toEqual({ q1: null, q2: 15, q3: null, q4: null });
  });
});

describe('applying', () => {
  const good = { fullName: 'Mona Adel', email: ' Mona@Example.com ', mobile: '+20 100 123 4567', answers: { q1: 'yes', q2: 3, q3: 'Premiere Pro' }, consent: true };

  it('passes a good application', () => {
    expect(applyProblems(good, QUESTIONS)).toEqual([]);
    expect(applyProblems({ ...good, linkedin: 'https://linkedin.com/in/mona', yearsExperience: 3.5, expectedSalary: 20000 }, QUESTIONS)).toEqual([]);
  });

  it('names every problem', () => {
    expect(applyProblems({ fullName: 'M', email: 'mona', mobile: '12', linkedin: 'linkedin', yearsExperience: 3.3, expectedSalary: -1, answers: {}, consent: false }, [])).toEqual([
      'Write your full name.',
      'Write your email address, e.g. name@example.com.',
      'Write your mobile number, e.g. +20 100 123 4567.',
      'Write your LinkedIn link in full, starting with https://, or leave it empty.',
      'Give your years of experience as a number from 0 to 60 (halves allowed).',
      'Give your expected salary in EGP a month, or leave it empty.',
      'Tick that we may keep your application and CV to consider you for this job.',
    ]);
  });
});

describe('applicants', () => {
  const free = { filteredOut: false, openOffer: false };

  it('moves by hand as the stages allow', () => {
    expect(stageMoveProblem('applied', 'shortlisted', free)).toBeNull();
    expect(stageMoveProblem('shortlisted', 'interview', free)).toBeNull();
    expect(stageMoveProblem('interview', 'shortlisted', free)).toBeNull();
    expect(stageMoveProblem('applied', 'interview', free)).toBe('Shortlist them first.');
    expect(stageMoveProblem('applied', 'shortlisted', { ...free, filteredOut: true })).toBe('They failed a must-have question and were filtered out: restore them first.');
    expect(stageMoveProblem('applied', 'rejected', { ...free, filteredOut: true })).toBeNull();
    expect(stageMoveProblem('offer', 'rejected', { ...free, openOffer: true })).toBe('A job offer to them is open: withdraw it first.');
    expect(stageMoveProblem('rejected', 'shortlisted', free)).toBe('They were rejected: restore them first.');
    expect(stageMoveProblem('hired', 'rejected', free)).toBe('They were hired: their application stays as it is.');
    expect(stageMoveProblem('shortlisted', 'shortlisted', free)).toBe('They are shortlisted already.');
  });

  it('restores one filtered out or rejected, and offers to one shortlisted or at interview', () => {
    expect(restorable({ stage: 'applied', filteredOut: true })).toBe(true);
    expect(restorable({ stage: 'rejected', filteredOut: false })).toBe(true);
    expect(restorable({ stage: 'shortlisted', filteredOut: false })).toBe(false);
    expect(offerable({ stage: 'shortlisted', filteredOut: false })).toBe(true);
    expect(offerable({ stage: 'interview', filteredOut: false })).toBe(true);
    expect(offerable({ stage: 'applied', filteredOut: false })).toBe(false);
    expect(offerable({ stage: 'shortlisted', filteredOut: true })).toBe(false);
  });
});

describe('the CV', () => {
  const pdf = Buffer.from('%PDF-1.7\n%…');
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....')]);
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....xl/workbook.xml....')]);

  it('is told by its first bytes: a PDF or a Word file, nothing else', () => {
    expect(cvTypeOf(pdf)).toBe(PDF);
    expect(cvTypeOf(docx)).toBe(DOCX);
    expect(cvTypeOf(zip)).toBeNull();
    expect(cvTypeOf(Buffer.from('<svg/>'))).toBeNull();
  });

  it('is refused in words: missing, too large, another kind', () => {
    expect(cvProblem(undefined)).toBe('Attach your CV, as a PDF or a Word file.');
    expect(cvProblem({ buffer: pdf, size: 6 * 1024 * 1024 })).toBe('Your CV must be 5 MB or smaller.');
    expect(cvProblem({ buffer: zip, size: zip.length })).toBe('Your CV must be a PDF or a Word file (.docx).');
    expect(cvProblem({ buffer: pdf, size: pdf.length })).toBeNull();
  });

  it('keeps a clean name with the right extension', () => {
    expect(cvFileName('C:\\Users\\mona\\My CV.pdf', PDF)).toBe('My CV.pdf');
    expect(cvFileName('cv.pdf', DOCX)).toBe('cv.docx');
    expect(cvFileName('a<b>c\u202e.docx', DOCX)).toBe('a_b_c.docx');
    expect(cvFileName('', PDF)).toBe('CV.pdf');
  });
});

// The address an application counts against (22 October 2026): only one the website signed for the job is trusted.
describe('the applicant\'s address for the hourly limit', () => {
  const KEY = 'k'.repeat(40);
  const AT = 1_800_000_000_000;
  const signed = (ip: string, slug: string, at = AT) => ({
    [CLIENT_IP_HEADER]: ip,
    [CLIENT_IP_AT_HEADER]: String(at),
    [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(KEY, ip, String(at), careersIpToken(slug)),
  });

  it('trusts the address the website signed for this job', () => {
    expect(applicantIp('editor', '10.0.0.9', { ip: '1.1.1.1', userAgent: null, headers: signed('41.33.1.2', 'editor') }, KEY, AT)).toBe('41.33.1.2');
  });

  it('ignores a named address that isn\'t signed, or signed for another job or too long ago: the connection\'s counts', () => {
    expect(applicantIp('editor', '10.0.0.9', { ip: '1.1.1.1', userAgent: null }, KEY, AT)).toBe('1.1.1.1');
    expect(applicantIp('editor', '10.0.0.9', { ip: '1.1.1.1', userAgent: null, headers: signed('41.33.1.2', 'producer') }, KEY, AT)).toBe('1.1.1.1');
    expect(applicantIp('editor', '10.0.0.9', { ip: '1.1.1.1', userAgent: null, headers: signed('41.33.1.2', 'editor', AT - 10 * 60_000) }, KEY, AT)).toBe('1.1.1.1');
  });

  it('takes the named address while the server has no key yet, as before', () => {
    expect(applicantIp('editor', '10.0.0.9', { ip: '1.1.1.1', userAgent: null }, undefined, AT)).toBe('10.0.0.9');
    expect(applicantIp('editor', null, { ip: '1.1.1.1', userAgent: null }, undefined, AT)).toBe('1.1.1.1');
  });
});
