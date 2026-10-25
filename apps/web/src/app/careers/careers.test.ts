import { describe, expect, it } from 'vitest';
import { HIDDEN_PORTFOLIO, OTHER_POSITION, portfolioLinkField, type PortfolioAsk, type PublicQuestion } from '@trendlix/shared';
import {
  answerField,
  apiForm,
  applyFormProblems,
  factsLine,
  fieldProblems,
  generalApiForm,
  generalFormProblems,
  generalPortfolioAsk,
  generalTypedValues,
  noticeFrom,
  OTHER_AREA,
  portfolioLinksOf,
  portfolioProblems,
  typedValues,
  YEARS_REQUIRED,
} from './careers';

// The careers page's application form (owner, 22 October 2026: "where will we include the ATS?").

const QUESTIONS: PublicQuestion[] = [
  { key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, options: null },
  { key: 'q2', kind: 'choice', text: 'Editor?', required: true, options: ['Premiere Pro', 'Other'] },
  { key: 'q3', kind: 'number', text: 'Years editing', required: false, options: null },
];

function form(fields: Record<string, string>, cv: Blob | null = new Blob(['%PDF-1.4'], { type: 'application/pdf' })) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (cv) fd.set('cv', cv, 'My CV.pdf');
  return fd;
}

const good = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', yearsExperience: '3', [answerField('q1')]: 'yes', [answerField('q2')]: 'Other', consent: 'on' };

describe('the application form', () => {
  it('passes a good one and names what is wrong with another', () => {
    expect(applyFormProblems(form(good), QUESTIONS)).toEqual([]);
    const withoutConsent = Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'consent'));
    expect(applyFormProblems(form({ ...withoutConsent, [answerField('q2')]: 'Final Cut' }, null), QUESTIONS)).toEqual([
      'Choose one of the options: Editor?',
      'Tick that we may keep your application and CV to consider you for this job.',
      'Attach your CV, as a PDF or a Word file.',
    ]);
  });

  it('keeps what was typed to show again, never the CV', () => {
    const typed = typedValues(form(good), QUESTIONS);
    expect(typed).toMatchObject({ fullName: 'Mona Adel', [answerField('q1')]: 'yes', consent: 'on' });
    expect(typed).not.toHaveProperty('cv');
  });

  it('is passed on with the answers as JSON, the channel, where it came from and the CV', () => {
    const out = apiForm(form({ ...good, website: '' }), QUESTIONS, { source: 'linkedin', ip: '10.0.0.1', userAgent: 'Phone' });
    expect(out.get('fullName')).toBe('Mona Adel');
    expect(JSON.parse(out.get('answers') as string)).toEqual({ q1: 'yes', q2: 'Other', q3: '' });
    expect(out.get('consent')).toBe('true');
    expect(out.get('source')).toBe('linkedin');
    expect(out.get('ip')).toBe('10.0.0.1');
    expect(out.get('website')).toBeNull();
    expect(out.get('cv')).toBeInstanceOf(Blob);
    // a robot's honeypot goes on, for the API to refuse; an unknown channel is Other
    const robot = apiForm(form({ ...good, website: 'http://spam' }), QUESTIONS, { source: 'tiktok' });
    expect(robot.get('website')).toBe('http://spam');
    expect(robot.get('source')).toBe('other');
  });

  // the WhatsApp tick (owner, 24 October 2026: "how to make whatsapp notifications?"; candidates who tick it)
  it('sends the WhatsApp tick only when ticked, with the page’s language, and keeps it after a refusal', () => {
    const ticked = apiForm(form({ ...good, whatsapp: 'on' }), QUESTIONS, { source: null });
    expect(ticked.get('whatsapp')).toBe('true');
    expect(ticked.get('whatsappLanguage')).toBe('en');
    const unticked = apiForm(form(good), QUESTIONS, { source: null });
    expect(unticked.get('whatsapp')).toBeNull();
    expect(unticked.get('whatsappLanguage')).toBeNull();
    expect(typedValues(form({ ...good, whatsapp: 'on' }), QUESTIONS).whatsapp).toBe('on');
    expect(typedValues(form(good), QUESTIONS)).not.toHaveProperty('whatsapp');
  });

  it('lines up a job’s facts', () => {
    expect(factsLine(['Production', null, 'Full-time'])).toBe('Production · Full-time');
  });
});

// "Send us your CV" (owner, 22 October 2026: "what came out of the posted jobs and what cam on randomly"); the position
// they would like since 25 October 2026 ("should it be the positions?"; asked, "Position, grouped by team").
describe('the general CV form', () => {
  const AREA = '00000000-0000-4000-8000-000000000001';
  const POSITION = `${AREA}:video editor`;
  const person = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', consent: 'on' };

  it('takes a position or Other in words, and names what is missing', () => {
    expect(generalFormProblems(form({ ...person, position: POSITION }))).toEqual([]);
    expect(generalFormProblems(form({ ...person, position: OTHER_POSITION, positionOther: 'Photographer' }))).toEqual([]);
    expect(generalFormProblems(form({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', position: OTHER_POSITION }, null))).toEqual([
      'Choose the position you would like, or Other and write it.',
      'Tick that we may keep your details and CV to consider you for jobs.',
      'Attach your CV, as a PDF or a Word file.',
    ]);
    // none chosen: the position is asked, never an old page's area
    expect(generalFormProblems(form({ ...person, position: '', area: AREA }))).toEqual(['Choose the position you would like, or Other and write it.']);
    expect(generalFormProblems(form({ ...person, position: OTHER_POSITION, positionOther: 'x'.repeat(81) }))).toEqual(['Keep the position to 80 characters or fewer.']);
  });

  it('is passed on with the position’s key or the words, where it came from and the CV', () => {
    const out = generalApiForm(form({ ...person, position: POSITION, positionOther: 'ignored', linkedin: 'linkedin.com/in/mona', website: '' }), { ip: '10.0.0.1', userAgent: 'Phone' });
    expect(out.get('positionKey')).toBe(POSITION);
    expect(out.get('positionOther')).toBeNull();
    expect(out.get('departmentId')).toBeNull();
    expect(out.get('areaOther')).toBeNull();
    expect(out.get('consent')).toBe('true');
    expect(out.get('linkedin')).toBe('linkedin.com/in/mona');
    expect(out.get('ip')).toBe('10.0.0.1');
    expect(out.get('website')).toBeNull();
    expect(out.get('cv')).toBeInstanceOf(Blob);
    const other = generalApiForm(form({ ...person, position: OTHER_POSITION, positionOther: ' Photographer ' }), {});
    expect(other.get('positionKey')).toBeNull();
    expect(other.get('positionOther')).toBe('Photographer');
  });

  // a page still open from before the positions sends its area (one release): passed on as it was, for its team
  it('still takes an older page’s area, a team or Other in words', () => {
    expect(generalFormProblems(form({ ...person, area: AREA }))).toEqual([]);
    const team = generalApiForm(form({ ...person, area: AREA, areaOther: 'ignored' }), {});
    expect(team.get('departmentId')).toBe(AREA);
    expect(team.get('areaOther')).toBeNull();
    expect(team.get('positionKey')).toBeNull();
    const other = generalApiForm(form({ ...person, area: OTHER_AREA, areaOther: 'Photography' }), {});
    expect(other.get('departmentId')).toBeNull();
    expect(other.get('areaOther')).toBe('Photography');
    expect(generalFormProblems(form({ ...person, area: OTHER_AREA }))).toEqual(['Choose the position you would like, or Other and write it.']);
  });

  it('sends the WhatsApp tick only when ticked, and keeps it after a refusal (24 October 2026)', () => {
    expect(generalApiForm(form({ ...person, position: POSITION, whatsapp: 'on' }), {}).get('whatsapp')).toBe('true');
    expect(generalApiForm(form({ ...person, position: POSITION }), {}).get('whatsapp')).toBeNull();
    expect(generalTypedValues(form({ ...person, position: POSITION, whatsapp: 'on' })).whatsapp).toBe('on');
  });

  it('keeps what was typed to show again, never the CV', () => {
    const typed = generalTypedValues(form({ ...person, position: OTHER_POSITION, positionOther: 'Photographer' }));
    expect(typed).toMatchObject({ fullName: 'Mona Adel', position: OTHER_POSITION, positionOther: 'Photographer', consent: 'on' });
    expect(typed).not.toHaveProperty('cv');
  });
});

// The email, mobile, years and notice period (owner, 22 October 2026, trying the form on an iPhone: "make the years of
// experience field only numbers, and you add years."; "Motice period Field in Days" … "and a selectoor to make it
// months"; "the mobile number format to be like the one applied in the system, country code and no extra zero";
// "validate email field").
describe('the email, mobile, years and notice period', () => {
  it('sends the notice period as one, "30 days" or "1 month", and the mobile as kept', () => {
    const out = apiForm(form({ ...good, noticeNumber: '30', noticeUnit: 'days' }), QUESTIONS, { source: null });
    expect(out.get('noticePeriod')).toBe('30 days');
    expect(out.get('noticeNumber')).toBeNull();
    expect(out.get('noticeUnit')).toBeNull();
    expect(out.get('mobile')).toBe('+201001234567');
    expect(out.get('yearsExperience')).toBe('3');
    expect(apiForm(form({ ...good, noticeNumber: '1', noticeUnit: 'months' }), QUESTIONS, { source: null }).get('noticePeriod')).toBe('1 month');
    expect(apiForm(form({ ...good, noticeNumber: '', noticeUnit: 'months' }), QUESTIONS, { source: null }).get('noticePeriod')).toBeNull();
    const general = generalApiForm(form({ ...good, position: OTHER_POSITION, positionOther: 'Sound engineer', noticeNumber: '2', noticeUnit: 'months' }), {});
    expect(general.get('noticePeriod')).toBe('2 months');
    expect(noticeFrom(form({ noticeNumber: '0' }))).toBe('0 days');
    expect(noticeFrom(form({ noticeNumber: '1', noticeUnit: 'days' }))).toBe('1 day');
    expect(noticeFrom(form({}))).toBeNull();
  });

  it('keeps the notice period’s number and unit to show again', () => {
    expect(typedValues(form({ ...good, noticeNumber: '2', noticeUnit: 'months' }), QUESTIONS)).toMatchObject({ noticeNumber: '2', noticeUnit: 'months', mobile: '+201001234567' });
    expect(generalTypedValues(form({ ...good, noticeNumber: '45', noticeUnit: 'days' }))).toMatchObject({ noticeNumber: '45', noticeUnit: 'days' });
  });

  it('says what is wrong under each field, in the form’s order', () => {
    expect(fieldProblems(form(good), { yearsRequired: true })).toEqual([]);
    expect(fieldProblems(form({ ...good, email: ' Mona@Mail.test ', noticeNumber: '12', noticeUnit: 'months' }), { yearsRequired: true })).toEqual([]);
    expect(
      fieldProblems(form({ ...good, email: 'mona@mail', mobile: '+2010012', yearsExperience: '3.3', noticeNumber: '13', noticeUnit: 'months' }), { yearsRequired: true }),
    ).toEqual([
      { field: 'email', message: 'Write a full email address, e.g. name@example.com.' },
      { field: 'mobile', message: 'Write the mobile number without the 0 in front, after choosing the country code.' },
      { field: 'yearsExperience', message: 'Write your years of experience as a number from 0 to 60, e.g. 3 or 2.5.' },
      { field: 'noticePeriod', message: 'Keep the notice period to 365 days or 12 months at most.' },
    ]);
    // the years are asked on a job's form, not on the general one
    const noYears = form({ ...good, yearsExperience: '' });
    expect(fieldProblems(noYears, { yearsRequired: true })).toEqual([{ field: 'yearsExperience', message: YEARS_REQUIRED }]);
    expect(fieldProblems(noYears, { yearsRequired: false })).toEqual([]);
    expect(fieldProblems(form({ ...good, mobile: '' }), { yearsRequired: false }).map((p) => p.field)).toEqual(['mobile']);
    expect(fieldProblems(form({ ...good, noticeNumber: '400' }), { yearsRequired: false })).toEqual([{ field: 'noticePeriod', message: 'Keep the notice period to 365 days or 12 months at most.' }]);
  });

  it('wants the years on a job’s form before sending, not on the general one', () => {
    expect(applyFormProblems(form({ ...good, yearsExperience: '' }), QUESTIONS)).toEqual([YEARS_REQUIRED]);
    expect(generalFormProblems(form({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '01001234567', position: OTHER_POSITION, positionOther: 'Sound engineer', consent: 'on' }))).toEqual([]);
  });
});

// A portfolio per position (owner, 25 October 2026: "for creatives, they need to add their portfolios. so based on the
// positions i have, what kind of portfolios i might need to ask them for?"; asked, "Portfolio per position") and "Fill in
// with LinkedIn" ("can i use linkedin to complete the data?"): the link boxes, the PDF case study and LinkedIn's ticket.
describe('the portfolio and LinkedIn’s ticket on the forms', () => {
  const SHOWREEL: PortfolioAsk = { mode: 'required', title: 'Your showreel', hint: 'A showreel on Vimeo or YouTube', kinds: ['vimeo', 'youtube', 'behance'], maxLinks: 3 };
  const DESIGN: PortfolioAsk = { mode: 'optional', title: 'Your portfolio', hint: 'Behance or Dribbble, or a PDF portfolio', kinds: ['behance', 'dribbble', 'pdf', 'website'], maxLinks: 2 };
  const pdf = (bytes: number, name = 'Case study.pdf', type = 'application/pdf') => new File([new Uint8Array(bytes)], name, { type });
  const withFile = (fields: Record<string, string>, file: File) => {
    const fd = form(fields);
    fd.set('portfolioFile', file, file.name);
    return fd;
  };

  it('reads the link boxes in order, the empty ones left out', () => {
    expect(portfolioLinksOf(form({ [portfolioLinkField(0)]: ' vimeo.com/123456 ', [portfolioLinkField(1)]: '', [portfolioLinkField(2)]: 'youtu.be/abcdef12' }))).toEqual([
      'vimeo.com/123456',
      'youtu.be/abcdef12',
    ]);
    expect(portfolioLinksOf(form({}))).toEqual([]);
  });

  it('asks for a required portfolio before sending, and takes a Vimeo link', () => {
    expect(applyFormProblems(form(good), QUESTIONS, SHOWREEL)).toEqual(['Add your portfolio: a showreel on Vimeo or YouTube.']);
    expect(applyFormProblems(form({ ...good, [portfolioLinkField(0)]: 'vimeo.com/123456789' }), QUESTIONS, SHOWREEL)).toEqual([]);
    // a link of the wrong shape, or of a platform not asked for
    expect(portfolioProblems(form({ [portfolioLinkField(0)]: 'vimeo.com' }), SHOWREEL)).toHaveLength(1);
    expect(portfolioProblems(form({ [portfolioLinkField(0)]: 'github.com/mona' }), SHOWREEL)).toHaveLength(1);
    expect(portfolioProblems(form({ [portfolioLinkField(0)]: 'http://vimeo.com/123456' }), SHOWREEL)[0]).toMatch(/https:\/\//);
  });

  it('ignores the portfolio when the position asks for none', () => {
    expect(applyFormProblems(form({ ...good, [portfolioLinkField(0)]: 'not a link' }), QUESTIONS)).toEqual([]);
    expect(portfolioProblems(form({ [portfolioLinkField(0)]: 'not a link' }), HIDDEN_PORTFOLIO)).toEqual([]);
  });

  it('takes a PDF case study when the position does, at most 5 MB, and only a PDF', () => {
    expect(portfolioProblems(withFile({}, pdf(10)), DESIGN)).toEqual([]);
    expect(portfolioProblems(withFile({}, pdf(5 * 1024 * 1024 + 1)), DESIGN)).toEqual(['Your portfolio PDF must be 5 MB or smaller.']);
    expect(portfolioProblems(withFile({}, pdf(10, 'work.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), DESIGN)).toEqual([
      'Your portfolio file must be a PDF.',
    ]);
    // a required one is met by the PDF alone
    expect(portfolioProblems(withFile({}, pdf(10)), { ...DESIGN, mode: 'required' })).toEqual([]);
    // more links than allowed
    expect(portfolioProblems(form({ [portfolioLinkField(0)]: 'behance.net/mona', [portfolioLinkField(1)]: 'dribbble.com/mona', [portfolioLinkField(2)]: 'mona.design' }), DESIGN)).toEqual([
      'Add at most 2 portfolio links.',
    ]);
  });

  it('sends the links as a list, the PDF and LinkedIn’s ticket, never the old one-box portfolio', () => {
    const fields = { ...good, portfolio: 'behance.net/old', [portfolioLinkField(0)]: 'behance.net/mona', [portfolioLinkField(1)]: ' ', linkedinTicket: 'v1:sealed' };
    const out = apiForm(withFile(fields, pdf(10)), QUESTIONS, { source: null });
    expect(JSON.parse(out.get('portfolioLinks') as string)).toEqual(['behance.net/mona']);
    expect(out.get('portfolio')).toBeNull();
    expect(out.get('portfolioFile')).toBeInstanceOf(Blob);
    expect(out.get('linkedinTicket')).toBe('v1:sealed');
    const bare = apiForm(form(good), QUESTIONS, { source: null });
    expect(bare.get('portfolioLinks')).toBeNull();
    expect(bare.get('portfolioFile')).toBeNull();
    expect(bare.get('linkedinTicket')).toBeNull();
    // an empty file box sends no file
    const empty = form(good);
    empty.set('portfolioFile', new File([], ''));
    expect(apiForm(empty, QUESTIONS, { source: null }).get('portfolioFile')).toBeNull();
    const general = generalApiForm(form({ ...fields, position: OTHER_POSITION, positionOther: 'Designer' }), {});
    expect(JSON.parse(general.get('portfolioLinks') as string)).toEqual(['behance.net/mona']);
    expect(general.get('linkedinTicket')).toBe('v1:sealed');
  });

  it('keeps the boxes and the ticket to show again after a refusal, never the PDF', () => {
    const typed = typedValues(withFile({ ...good, [portfolioLinkField(0)]: 'vimeo.com/1234', linkedinTicket: 'v1:sealed' }, pdf(10)), QUESTIONS);
    expect(typed).toMatchObject({ [portfolioLinkField(0)]: 'vimeo.com/1234', linkedinTicket: 'v1:sealed' });
    expect(typed).not.toHaveProperty('portfolioFile');
    expect(generalTypedValues(form({ [portfolioLinkField(1)]: 'behance.net/mona' }))).toMatchObject({ [portfolioLinkField(1)]: 'behance.net/mona' });
  });

  it('asks on the general form what the chosen position asks, Other’s for Other, none before one is chosen', () => {
    const KEY = '00000000-0000-4000-8000-000000000001:video editor';
    const asks = { portfolios: { [KEY]: SHOWREEL }, otherPortfolio: DESIGN };
    expect(generalPortfolioAsk(KEY, asks)).toBe(SHOWREEL);
    expect(generalPortfolioAsk(OTHER_POSITION, asks)).toBe(DESIGN);
    expect(generalPortfolioAsk('', asks)).toBe(HIDDEN_PORTFOLIO);
    expect(generalPortfolioAsk('unknown:key', asks)).toBe(HIDDEN_PORTFOLIO);
    expect(generalPortfolioAsk(KEY, null)).toBe(HIDDEN_PORTFOLIO);
    const person = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '01001234567', consent: 'on' };
    expect(generalFormProblems(form({ ...person, position: KEY }), asks)).toEqual(['Add your portfolio: a showreel on Vimeo or YouTube.']);
    expect(generalFormProblems(form({ ...person, position: KEY, [portfolioLinkField(0)]: 'youtube.com/watch?v=abcdef123' }), asks)).toEqual([]);
    // without the asks (an API from before them) nothing is asked
    expect(generalFormProblems(form({ ...person, position: KEY }))).toEqual([]);
  });
});
