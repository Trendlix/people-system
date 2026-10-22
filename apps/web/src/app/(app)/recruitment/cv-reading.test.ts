import { describe, expect, it } from 'vitest';
import type { CvReadingView, CvUploadView } from '@trendlix/shared';
import { applicantCvTextApiPath, CV_CARD_NOTE, cvTextMissing, findParts, foundText, generalCvTextApiPath, linksFound, readingFacts, readingStatusText, shortLink, skillsCountText } from './cv-reading';
import { mergeReadings, rowOf } from './general';
import { applicantsApiPath, applicantsHref, readApplicantsQuery, vacancyForm } from './recruitment';

// The "From the CV" card, the CV match's filter and sort, the vacancy's key skills and the bulk rows filled in by the
// OCR service (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"). Every
// person here is invented.

const ID = '7d4c8f8e-2b6a-4f1e-9c3d-5a6b7c8d9e0f';

const reading = (over: Partial<CvReadingView> = {}): CvReadingView => ({
  status: 'read',
  method: 'pdf',
  readAt: '2026-10-22T10:00:00.000Z',
  experience: 'About 4 years (from the dates in the CV)',
  education: 'bachelor',
  languages: ['English', 'Arabic'],
  skills: { found: ['Premiere Pro'], missing: ['After Effects'] },
  cvMatchPercent: 50,
  ...over,
});

describe('the From the CV card', () => {
  it('says how the CV was read, or that it is being read', () => {
    expect(readingStatusText(reading())).toBe('Read 22/10/2026 · The PDF’s own text');
    expect(readingStatusText(reading({ method: 'ocr_ar' }))).toBe('Read 22/10/2026 · Read from the scan (Arabic)');
    expect(readingStatusText(reading({ status: 'pending', method: null, readAt: null }))).toMatch(/^Reading the CV… Refresh the page/);
    expect(readingStatusText(reading({ status: 'no_text', method: null }))).toBe('No text found in the CV');
    expect(readingStatusText(reading({ status: 'failed', method: null }))).toBe('The CV could not be read');
  });

  it('lists what the rules found, a dash for what they didn’t', () => {
    expect(readingFacts(reading())).toEqual([
      { label: 'Experience', value: 'About 4 years (from the dates in the CV)' },
      { label: 'Education', value: 'Bachelor' },
      { label: 'Languages', value: 'English, Arabic' },
    ]);
    expect(readingFacts(reading({ experience: null, education: null, languages: [] })).map((f) => f.value)).toEqual(['—', '—', '—']);
  });

  it('counts the key skills found, none for a general CV', () => {
    expect(skillsCountText(reading().skills)).toBe('1 of 2 key skills');
    expect(skillsCountText({ found: [], missing: ['Excel'] })).toBe('0 of 1 key skill');
    expect(skillsCountText(null)).toBeNull();
  });

  it('shows the links found, LinkedIn first and short', () => {
    expect(linksFound({ cvLinkedin: 'https://linkedin.com/in/mona', cvLinks: ['https://www.behance.net/mona/'] })).toEqual(['https://linkedin.com/in/mona', 'https://www.behance.net/mona/']);
    expect(linksFound({ cvLinkedin: null, cvLinks: [] })).toEqual([]);
    expect(shortLink('https://www.behance.net/mona/')).toBe('behance.net/mona');
  });

  it('says why the text isn’t shown: a developer, not read yet, or a failure', () => {
    expect(cvTextMissing({ kind: 'forbidden' })).toBe("The CV's text and the contacts in it aren't shown to your role.");
    expect(cvTextMissing({ kind: 'unavailable' })).toBe("The CV's text isn't available yet.");
    expect(cvTextMissing({ kind: 'failed', messages: ['Down.'] })).toBe("The CV's text could not be loaded. Down.");
    expect(CV_CARD_NOTE).toBe("Found by simple rules in the CV's text; check the CV itself.");
    expect(applicantCvTextApiPath(ID)).toBe(`/recruitment/applications/${ID}/cv-text`);
    expect(generalCvTextApiPath(ID)).toBe(`/recruitment/general-cvs/${ID}/cv-text`);
  });

  it('marks the words found in the text, any case, Arabic too', () => {
    expect(findParts('Premiere Pro and premiere', 'PREMIERE')).toEqual({
      parts: [
        { text: 'Premiere', hit: true },
        { text: ' Pro and ', hit: false },
        { text: 'premiere', hit: true },
      ],
      count: 2,
    });
    expect(findParts('مونتير أول، مونتير', 'مونتير').count).toBe(2);
    // spaces typed match any spacing; what a pattern would mean is taken as it is
    expect(findParts('After\n  Effects (a+b)', 'after effects').count).toBe(1);
    expect(findParts('a+b and a+b', 'a+b').count).toBe(2);
    // a single letter marks nothing
    expect(findParts('abc', 'a')).toEqual({ parts: [{ text: 'abc', hit: false }], count: 0 });
    expect(foundText(0)).toBe('Not found');
    expect(foundText(1)).toBe('Found once');
    expect(foundText(1200)).toBe('Found 1,200 times');
  });

  it('marks at most 1,000 times, counting them all', () => {
    const { parts, count } = findParts('ab '.repeat(1200), 'ab');
    expect(count).toBe(1200);
    expect(parts.filter((p) => p.hit)).toHaveLength(1000);
    expect(parts.map((p) => p.text).join('')).toBe('ab '.repeat(1200));
  });
});

describe('the CV match on the lists', () => {
  it('reads and sends the CV match filter and the sort', () => {
    expect(readApplicantsQuery({ minCvMatch: '50', sort: 'cv' })).toMatchObject({ minCvMatch: 50, sort: 'cv' });
    expect(readApplicantsQuery({ minCvMatch: '150', sort: 'name' })).toMatchObject({ minCvMatch: null, sort: '' });
    expect(applicantsApiPath({ minCvMatch: 50, sort: 'cv' })).toBe('/recruitment/applications?minCvMatch=50&sort=cv');
    expect(applicantsHref(`/recruitment/vacancies/${ID}`, { vacancyId: ID, minCvMatch: 50 })).toBe(`/recruitment/vacancies/${ID}?minCvMatch=50`);
  });
});

describe('the vacancy’s key skills', () => {
  const form = (keySkills: string) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ jobTitleId: ID, employmentType: 'full_time', keySkills })) fd.set(k, v);
    return fd;
  };

  it('are typed with commas, each once', () => {
    expect(vacancyForm(form('Premiere Pro, after effects,premiere pro, '), { withQuestions: false }).body?.keySkills).toEqual(['Premiere Pro', 'after effects']);
    expect(vacancyForm(form(''), { withQuestions: false }).body?.keySkills).toEqual([]);
  });

  it('at most 20', () => {
    const many = Array.from({ length: 21 }, (_, i) => `Skill ${i}`).join(', ');
    expect(vacancyForm(form(many), { withQuestions: false }).errors).toEqual(['List at most 20 key skills.']);
  });
});

describe('a scanned CV of a bulk upload', () => {
  const upload = (over: Partial<CvUploadView> = {}): CvUploadView => ({
    id: 'u1',
    fileName: 'scan_0012.pdf',
    sizeBytes: 1000,
    textFound: false,
    reading: true,
    guess: { fullName: 'Scan', email: null, mobile: null },
    duplicate: null,
    uploadedAt: '2026-10-22T10:00:00.000Z',
    ...over,
  });
  const read = upload({ textFound: true, reading: false, guess: { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567' } });

  it('is shown as being read, then filled in where HR left it as it was', () => {
    const row = rowOf(upload());
    expect(row.reading).toBe(true);
    expect(mergeReadings([row], [upload()])).toEqual([row]);
    const [filled] = mergeReadings([row], [read]);
    expect(filled).toMatchObject({ reading: false, textFound: true, fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567' });
    // what HR typed stays
    const [typed] = mergeReadings([{ ...row, fullName: 'Mona A. Hassan' }], [read]);
    expect(typed).toMatchObject({ fullName: 'Mona A. Hassan', email: 'mona@mail.test' });
  });

  it('stays as it is when gone from the batch, and an API from before the reading reads none', () => {
    const row = rowOf(upload());
    expect(mergeReadings([row], [])).toEqual([row]);
    const old: Partial<CvUploadView> = upload({ textFound: false });
    delete old.reading;
    expect(rowOf(old as CvUploadView).reading).toBe(false);
  });
});
