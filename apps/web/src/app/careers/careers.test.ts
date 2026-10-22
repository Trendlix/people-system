import { describe, expect, it } from 'vitest';
import type { PublicQuestion } from '@trendlix/shared';
import { answerField, apiForm, applyFormProblems, factsLine, generalApiForm, generalFormProblems, generalTypedValues, jobHref, OTHER_AREA, typedValues } from './careers';

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

const good = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', [answerField('q1')]: 'yes', [answerField('q2')]: 'Other', consent: 'on' };

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

  it('keeps what was typed to show again, never the CV', () => {
    const typed = generalTypedValues(form({ ...person, area: OTHER_AREA, areaOther: 'Photography' }));
    expect(typed).toMatchObject({ fullName: 'Mona Adel', area: OTHER_AREA, areaOther: 'Photography', consent: 'on' });
    expect(typed).not.toHaveProperty('cv');
  });
});
