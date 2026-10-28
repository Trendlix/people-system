import { describe, expect, it } from 'vitest';
import { DICTIONARY_SKILL_NAMES, type CvListFacts, type CvReadingView, type CvUploadView } from '@trendlix/shared';
import { candidatesApiPath, readCandidatesQuery } from './candidates';
import {
  applicantCvTextApiPath,
  CV_CARD_NOTE,
  cvTextMissing,
  educationText,
  experienceCell,
  findParts,
  foundText,
  FROM_CV_DATES,
  generalCvTextApiPath,
  latestRoleOf,
  latestRoleText,
  linksFound,
  moreFromCv,
  periodText,
  readingFacts,
  readingStatusText,
  shortLink,
  skillsCountText,
  workHistoryHeading,
} from './cv-reading';
import { filtering, generalApiPath, generalFiltering, generalHref, mergeReadings, readGeneralQuery, rowOf } from './general';
import { applicantsApiPath, applicantsHref, minYearsOptions, readApplicantsQuery, skillGroups, vacancyForm } from './recruitment';

// The "From the CV" card, the CV match's filter and sort, the vacancy's key skills and the bulk rows filled in by the
// OCR service (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"); since
// 24 October 2026 ("why isn't the experience pulled off the CV?"; "CV years in list + more rules"), the lists' Experience
// and Latest role, their Min. experience, Skill and sort, and the card's work history, education and more. Every person
// here is invented.

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
  latestTitle: 'Senior Video Editor',
  latestCompany: 'Bright Studio',
  workHistory: [
    { pastTitle: 'Senior Video Editor', pastCompany: 'Bright Studio', from: '2022-01', to: null, current: true },
    { pastTitle: 'Video Editor', pastCompany: 'Nile Media', from: '2019-03', to: '2021-12', current: false },
  ],
  educationDetails: [{ institution: 'Helwan University', degree: 'Bachelor of Fine Arts', graduationYear: 2018 }],
  cvSkills: ['Premiere Pro', 'Photoshop'],
  certifications: ['Color Grading Masterclass'],
  city: 'Cairo',
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
      { label: 'Latest role', value: 'Senior Video Editor · Bright Studio' },
      { label: 'Experience', value: 'About 4 years (from the dates in the CV)' },
      { label: 'City', value: 'Cairo' },
      { label: 'Education', value: 'Bachelor' },
      { label: 'Languages', value: 'English, Arabic' },
    ]);
    expect(readingFacts(reading({ experience: null, education: null, languages: [], latestTitle: null, latestCompany: null, city: null })).map((f) => f.value)).toEqual(['—', '—', '—', '—', '—']);
    // an API from before 24 October 2026: no latest role or city
    expect(readingFacts({ experience: null, education: 'master', languages: [] }).map((f) => f.value)).toEqual(['—', '—', '—', 'Master', '—']);
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
    expect(readApplicantsQuery({ minCvMatch: '150', sort: 'salary' })).toMatchObject({ minCvMatch: null, sort: '' });
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

describe('the lists’ Experience and Latest role (24 October 2026)', () => {
  const facts = (over: Partial<CvListFacts> = {}): CvListFacts => ({ status: 'read', experienceMonths: 50, latestTitle: 'Motion Designer', latestCompany: 'Pyramid Pixels', ...over });

  it('shows the years typed, else the CV’s estimate in whole years, else a dash or that the CV is being read', () => {
    expect(experienceCell(3, facts())).toEqual({ text: '3 y', fromCv: false, title: null });
    expect(experienceCell(2.5, null)).toEqual({ text: '2.5 y', fromCv: false, title: null });
    expect(experienceCell(0, facts()).text).toBe('0 y');
    expect(experienceCell(null, facts())).toEqual({ text: '≈ 4 y · CV', fromCv: true, title: FROM_CV_DATES });
    expect(experienceCell(null, facts({ experienceMonths: 30 })).text).toBe('≈ 3 y · CV');
    expect(experienceCell(null, facts({ experienceMonths: 12 })).text).toBe('≈ 1 y · CV');
    expect(experienceCell(null, facts({ experienceMonths: 7 })).text).toBe('< 1 y · CV');
    expect(experienceCell(null, facts({ experienceMonths: 0 })).text).toBe('< 1 y · CV');
    expect(experienceCell(null, facts({ status: 'pending', experienceMonths: null }))).toMatchObject({ text: 'Reading…', fromCv: true });
    expect(experienceCell(null, facts({ experienceMonths: null }))).toEqual({ text: '—', fromCv: false, title: null });
    expect(experienceCell(null, facts({ status: 'failed', experienceMonths: null })).text).toBe('—');
    // an API from before it: no fromCv
    expect(experienceCell(null, undefined).text).toBe('—');
    expect(FROM_CV_DATES).toBe('From the dates in the CV');
  });

  it('shows the latest role as title · company, one alone, or none', () => {
    expect(latestRoleOf(facts())).toBe('Motion Designer · Pyramid Pixels');
    expect(latestRoleOf(facts({ latestCompany: null }))).toBe('Motion Designer');
    expect(latestRoleOf(facts({ latestTitle: null }))).toBe('Pyramid Pixels');
    expect(latestRoleOf(facts({ latestTitle: null, latestCompany: null }))).toBeNull();
    expect(latestRoleOf(null)).toBeNull();
    expect(latestRoleText('مونتير أول', 'استوديو برايت')).toBe('مونتير أول · استوديو برايت');
    expect(latestRoleText('  ', null)).toBeNull();
    // a developer's, masked by the API, as it comes
    expect(latestRoleText('••••', '••••')).toBe('•••• · ••••');
  });

  it('reads and sends the Min. experience, the Skill and the experience sort, refusing what isn’t one', () => {
    expect(readApplicantsQuery({ minYears: '3', skill: 'Premiere Pro', sort: 'years' })).toMatchObject({ minYears: 3, skill: 'Premiere Pro', sort: 'years' });
    expect(readApplicantsQuery({ minYears: '61', skill: 'Juggling', sort: 'age' })).toMatchObject({ minYears: null, skill: '', sort: '' });
    expect(applicantsApiPath({ minYears: 5, skill: 'After Effects', sort: 'years' })).toBe('/recruitment/applications?minYears=5&sort=years&skill=After+Effects');
    expect(filtering(readApplicantsQuery({ skill: 'Figma' }))).toBe(true);
    expect(filtering(readApplicantsQuery({ minYears: '2' }))).toBe(true);
    // a sort narrows nothing
    expect(filtering(readApplicantsQuery({ sort: 'years' }))).toBe(false);

    const g = readGeneralQuery({ minYears: '8', skill: 'Canva', q: 'mona' });
    expect(g).toMatchObject({ minYears: 8, skill: 'Canva' });
    expect(generalApiPath(g)).toBe('/recruitment/general-cvs?q=mona&minYears=8&skill=Canva');
    expect(generalHref({ minYears: 1 })).toBe('/recruitment/applicants?minYears=1&tab=general');
    expect(generalFiltering(readGeneralQuery({}))).toBe(false);
    expect(generalFiltering(readGeneralQuery({ skill: 'Excel' }))).toBe(true);
    expect(readGeneralQuery({ skill: 'excel', minYears: '-1' })).toMatchObject({ skill: '', minYears: null });

    expect(readCandidatesQuery({ minYears: '10' })).toEqual({ q: '', minYears: 10, verdict: '' });
    expect(candidatesApiPath({ q: 'mona adel', minYears: 2 })).toBe('/recruitment/candidates?q=mona%20adel&minYears=2');
    expect(candidatesApiPath({ q: '', minYears: 2 })).toBe('/recruitment/candidates?minYears=2');
  });

  it('offers 1+ to 10+ years, and an old link’s other value too; the dictionary’s skills by group', () => {
    expect(minYearsOptions(null).map((o) => o.label)).toEqual(['1+ years', '2+ years', '3+ years', '5+ years', '8+ years', '10+ years']);
    expect(minYearsOptions(4).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '8', '10']);
    expect(minYearsOptions(3).map((o) => o.value)).toHaveLength(6);
    const groups = skillGroups();
    expect(groups.map((x) => x.label)).toEqual(['Video', 'Design', 'Marketing', 'Office', 'Content', 'Development', 'Finance']);
    expect(groups.flatMap((x) => x.skills)).toEqual([...DICTIONARY_SKILL_NAMES]);
    expect(groups[0].skills.slice(0, 2)).toEqual(['Premiere Pro', 'After Effects']);
  });
});

describe('the card’s work history, education and more (24 October 2026)', () => {
  it('says a job’s period in words', () => {
    expect(periodText({ from: '2019-03', to: '2021-12', current: false })).toBe('Mar 2019 – Dec 2021');
    expect(periodText({ from: '2022-01', to: null, current: true })).toBe('Jan 2022 – Present');
    expect(periodText({ from: '2018', to: '2020', current: false })).toBe('2018 – 2020');
    expect(periodText({ from: null, to: null, current: false })).toBeNull();
    expect(workHistoryHeading(1)).toBe('Work History (1 role)');
    expect(workHistoryHeading(3)).toBe('Work History (3 roles)');
  });

  it('says a school in a line: degree · institution · year, what was found', () => {
    expect(educationText({ institution: 'Helwan University', degree: 'Bachelor of Fine Arts', graduationYear: 2018 })).toBe('Bachelor of Fine Arts · Helwan University · 2018');
    expect(educationText({ institution: 'جامعة القاهرة', degree: null, graduationYear: null })).toBe('جامعة القاهرة');
    expect(educationText({ institution: null, degree: null, graduationYear: null })).toBeNull();
    // a developer's: the school masked, the degree and year none
    expect(educationText({ institution: '••••', degree: null, graduationYear: null })).toBe('••••');
  });

  it('gathers what else was found, nothing from an API before it', () => {
    expect(moreFromCv(reading())).toEqual({
      workHistory: reading().workHistory,
      education: ['Bachelor of Fine Arts · Helwan University · 2018'],
      skills: ['Premiere Pro', 'Photoshop'],
      certifications: ['Color Grading Masterclass'],
    });
    expect(moreFromCv({})).toEqual({ workHistory: [], education: [], skills: [], certifications: [] });
    expect(moreFromCv({ workHistory: [{ pastTitle: null, pastCompany: null, from: '2020', to: '2021', current: false }], certifications: [' '] })).toMatchObject({ workHistory: [], certifications: [] });
  });
});
