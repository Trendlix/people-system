import { describe, expect, it } from 'vitest';
import type { PublicQuestion } from '@trendlix/shared';
import {
  answerField,
  apiForm,
  applyFormProblems,
  factsLine,
  fieldProblems,
  generalApiForm,
  generalFormProblems,
  generalTypedValues,
  jobHref,
  noticeFrom,
  OTHER_AREA,
  typedValues,
  YEARS_REQUIRED,
} from './careers';
import { CONTACT, CONTACT_HREF, departmentsOf, FOOTER_LINKS, HERO, jobsIn, MAIN_SITE, MENU_LINKS, ROLES_ID, SOCIAL_LINKS } from './site';

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

  it('links a job for a channel and lines up its facts', () => {
    expect(jobHref('video-producer-vac-2026-0003')).toBe('/careers/video-producer-vac-2026-0003');
    expect(jobHref('video-producer-vac-2026-0003', 'facebook')).toBe('/careers/video-producer-vac-2026-0003?src=facebook');
    expect(factsLine(['Production', null, 'Full-time'])).toBe('Production · Full-time');
  });
});

// "Send us your CV" (owner, 22 October 2026: "what came out of the posted jobs and what cam on randomly").
describe('the general CV form', () => {
  const AREA = '00000000-0000-4000-8000-000000000001';
  const person = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', consent: 'on' };

  it('takes an area or Other in words, and names what is missing', () => {
    expect(generalFormProblems(form({ ...person, area: AREA }))).toEqual([]);
    expect(generalFormProblems(form({ ...person, area: OTHER_AREA, areaOther: 'Photography' }))).toEqual([]);
    expect(generalFormProblems(form({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', area: OTHER_AREA }, null))).toEqual([
      'Choose the area you would like to work in, or Other and write it.',
      'Tick that we may keep your details and CV to consider you for jobs.',
      'Attach your CV, as a PDF or a Word file.',
    ]);
  });

  it('is passed on with the department or the words, where it came from and the CV', () => {
    const out = generalApiForm(form({ ...person, area: AREA, areaOther: 'ignored', linkedin: 'linkedin.com/in/mona', website: '' }), { ip: '10.0.0.1', userAgent: 'Phone' });
    expect(out.get('departmentId')).toBe(AREA);
    expect(out.get('areaOther')).toBeNull();
    expect(out.get('consent')).toBe('true');
    expect(out.get('linkedin')).toBe('linkedin.com/in/mona');
    expect(out.get('ip')).toBe('10.0.0.1');
    expect(out.get('website')).toBeNull();
    expect(out.get('cv')).toBeInstanceOf(Blob);
    const other = generalApiForm(form({ ...person, area: OTHER_AREA, areaOther: 'Photography' }), {});
    expect(other.get('departmentId')).toBeNull();
    expect(other.get('areaOther')).toBe('Photography');
  });

  it('sends the WhatsApp tick only when ticked, and keeps it after a refusal (24 October 2026)', () => {
    expect(generalApiForm(form({ ...person, area: AREA, whatsapp: 'on' }), {}).get('whatsapp')).toBe('true');
    expect(generalApiForm(form({ ...person, area: AREA }), {}).get('whatsapp')).toBeNull();
    expect(generalTypedValues(form({ ...person, area: AREA, whatsapp: 'on' })).whatsapp).toBe('on');
  });

  it('keeps what was typed to show again, never the CV', () => {
    const typed = generalTypedValues(form({ ...person, area: OTHER_AREA, areaOther: 'Photography' }));
    expect(typed).toMatchObject({ fullName: 'Mona Adel', area: OTHER_AREA, areaOther: 'Photography', consent: 'on' });
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
    const general = generalApiForm(form({ ...good, area: OTHER_AREA, areaOther: 'Sound', noticeNumber: '2', noticeUnit: 'months' }), {});
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
    expect(generalFormProblems(form({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '01001234567', area: OTHER_AREA, areaOther: 'Sound', consent: 'on' }))).toEqual([]);
  });
});

// Dressed as trendlix.com (owner, 22 October 2026: "i will put it in the main website, i need it to match the UI").
describe('the careers pages as trendlix.com', () => {
  const job = (department: string | null) => ({ department });

  it('offers a pill for each department with an open role, once, alphabetically', () => {
    expect(departmentsOf([job('Production'), job('Marketing'), job(' Production '), job(null), job('  ')])).toEqual(['Marketing', 'Production']);
    expect(departmentsOf([])).toEqual([]);
  });

  it('shows a department’s roles, or all of them', () => {
    const jobs = [job('Production'), job('Marketing'), job(' Production'), job(null)];
    expect(jobsIn(jobs, 'Production')).toEqual([job('Production'), job(' Production')]);
    expect(jobsIn(jobs, null)).toEqual(jobs);
    expect(jobsIn(jobs, 'Finance')).toEqual([]);
  });

  it('leads back to trendlix.com, its contact page and its social pages', () => {
    for (const l of [...MENU_LINKS, ...FOOTER_LINKS, ...SOCIAL_LINKS]) expect(l.href).toMatch(/^https:\/\//);
    expect(MENU_LINKS.map((l) => l.label)).toEqual(['Home', 'Contact us', 'Our services', 'Portfolio', 'Blogs', 'News']);
    expect(CONTACT_HREF).toBe(`${MAIN_SITE}/en/contact`);
    expect(CONTACT.phoneHref).toBe('tel:+201050079822');
    expect(SOCIAL_LINKS.map((l) => l.label)).toEqual(['Sortlist', 'Behance', 'Facebook', 'Instagram', 'LinkedIn']);
  });

  it('gives the hero its faded lines first and a bright line last, and an anchor to the roles', () => {
    expect(HERO.slogan.trim()).not.toBe('');
    expect(HERO.lines.length).toBeGreaterThan(0);
    expect(HERO.lines.every((l) => l.text.trim() !== '')).toBe(true);
    const firstBright = HERO.lines.findIndex((l) => !l.faded);
    expect(firstBright).toBeGreaterThanOrEqual(0);
    expect(HERO.lines.slice(firstBright).every((l) => !l.faded)).toBe(true);
    expect(new Set(HERO.lines.map((l) => l.text)).size).toBe(HERO.lines.length);
    expect(ROLES_ID).toMatch(/^[a-z][a-z-]*$/);
  });
});
