import { describe, expect, it } from 'vitest';
import { CV_FIT_VERSION, HIDDEN, type CvFit, type CvFitPart, type ScreeningCv } from '@trendlix/shared';
import {
  fitRows,
  fitSummary,
  fitTitle,
  jobTitleName,
  matchCell,
  NO_KEY_SKILLS_NOTE,
  NOT_ASKED_TITLE,
  openingKeySkills,
  openPositionTitle,
  recordFor,
  recordOfCv,
  suggestedFrom,
  suggestedText,
  suggestKeySkillsHref,
  typedKeySkills,
  wantsSuggestion,
  withSuggested,
} from './cv-fit';
import { generalApiPath, generalHref, readGeneralQuery } from './general';
import { reasonChips } from './suggestions';

// The CV fit on the site (owner, 25 October 2026: "aren't you supposed to match the candidate to the job based on the CV
// and ATS?"; "Full CV fit score"; "and if it recomended to another position based on the CV"): the breakdown's words, the
// Match cell's fallback for those never asked the screening questions, the CV Fit section's rows, Other Open Positions'
// CV, the General CVs' sort, and the key skills suggested on the vacancy's form. Every person and CV here is invented.

const part = (over: Partial<CvFitPart> & Pick<CvFitPart, 'key'>): CvFitPart => ({ label: over.key, score: 100, weight: 20, detail: '', ...over });

const FIT: CvFit = {
  percent: 72,
  version: CV_FIT_VERSION,
  parts: [
    part({ key: 'skills', label: 'Key skills', score: 67, weight: 35, found: ['Meta Ads', 'SEO', 'HubSpot', 'Canva'], missing: ['Google Ads', 'Figma'], listed: 6, detail: '4 of 6: Meta Ads, SEO, HubSpot, Canva; missing Google Ads, Figma' }),
    part({ key: 'title', label: 'Title', score: 100, weight: 25, matchedTitle: 'Digital Marketing Manager', titleFrom: 'latest', likeness: 1, sameTitle: false, detail: 'Close to the job’s title: the latest job' }),
    part({ key: 'experience', label: 'Experience', score: 100, weight: 20, years: 8, fromCv: false, wanted: { min: 5, max: 8, from: 'requirements' }, detail: '8 years; the job asks 5–8 years' }),
    part({ key: 'requirements', label: 'Requirements', score: 60, weight: 15, found: Array.from({ length: 12 }, (_, i) => `t${i}`), missing: Array.from({ length: 8 }, (_, i) => `m${i}`), listed: 20, detail: '12 of 20 terms' }),
    part({ key: 'education', label: 'Education', score: 100, weight: 5, detail: 'Bachelor; the job asks a bachelor’s degree' }),
  ],
};

describe('the CV fit’s words', () => {
  it('the breakdown on hover, a developer’s masked title left out', () => {
    expect(fitTitle(FIT)).toBe('Key skills 4 of 6 · Title close (Digital Marketing Manager) · 8 y vs 5–8 · Requirements 12 of 20 terms · Education ✓');
    const masked = { ...FIT, parts: FIT.parts.map((p) => (p.key === 'title' ? { ...p, matchedTitle: HIDDEN } : p)) };
    expect(fitTitle(masked)).toBe('Key skills 4 of 6 · Title close · 8 y vs 5–8 · Requirements 12 of 20 terms · Education ✓');
    expect(fitTitle(null)).toBeNull();
    expect(fitTitle(undefined)).toBeNull();
  });

  it('the CV Fit section: each part’s score, share of the fit and what it found', () => {
    expect(fitRows(FIT)[1]).toEqual({ key: 'title', label: 'Title', score: '100%', weight: '25% of the fit', detail: 'Digital Marketing Manager · Close to the job’s title: the latest job' });
    expect(fitRows({ ...FIT, parts: [part({ key: 'title', weight: 38.5, matchedTitle: HIDDEN, detail: 'Close to the job’s title: the latest job' })] })[0]).toMatchObject({
      weight: '38.5% of the fit',
      detail: 'Close to the job’s title: the latest job',
    });
    expect(fitSummary(FIT)).toBe('72% from the parts below.');
    expect(fitSummary({ ...FIT, parts: FIT.parts.slice(1) })).toBe('72% from the parts below. The parts that couldn’t be scored are left out, the others re-weighted to 100.');
    expect(fitSummary({ percent: null, version: CV_FIT_VERSION, parts: [] })).toMatch(/^Nothing to score/);
    expect(openPositionTitle({ percent: 82, fit: null })).toBe('82%');
    expect(openPositionTitle({ percent: 72, fit: FIT })).toContain('Key skills 4 of 6');
  });

  it('a suggestion’s CV fit chip, its breakdown on hover', () => {
    const [chip] = reasonChips([{ kind: 'fit', percent: 72, parts: FIT.parts, points: 47 }]);
    expect(chip).toMatchObject({ text: 'CV fit 72%', muted: false, title: fitTitle(FIT) });
  });
});

describe('the Match cell', () => {
  it('the screening match; else, never asked the questions, the CV fit muted with "· CV"; else "—"', () => {
    expect(matchCell({ matchPercent: 64, cvMatchPercent: 72, source: 'careers' })).toEqual({ text: '64%', fromCv: false, title: null });
    expect(matchCell({ matchPercent: 0, cvMatchPercent: 72 })).toEqual({ text: '0%', fromCv: false, title: null });
    // added from the suggested CVs, or by HR: not "No answers" any more
    expect(matchCell({ matchPercent: null, cvMatchPercent: 72, source: 'earlier_applicant' })).toEqual({ text: '72% · CV', fromCv: true, title: NOT_ASKED_TITLE });
    expect(matchCell({ matchPercent: null, cvMatchPercent: 0, source: 'general' })).toEqual({ text: '0% · CV', fromCv: true, title: 'Not asked the screening questions: the CV match' });
    expect(matchCell({ matchPercent: null, cvMatchPercent: null, source: 'general_suggested' })).toEqual({ text: '—', fromCv: false, title: 'Not asked the screening questions, and the CV isn’t read yet' });
    expect(matchCell({ matchPercent: null, cvMatchPercent: null, source: 'careers' })).toEqual({ text: '—', fromCv: false, title: null });
  });
});

describe('Other Open Positions and the General CVs’ best', () => {
  const cv = (over: Partial<ScreeningCv> & Pick<ScreeningCv, 'kind' | 'id'>): ScreeningCv => ({
    reference: 'APP-2026-0001',
    title: 'General CV',
    cvFileName: 'cv.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    sentAt: '2026-10-01T09:00:00.000Z',
    key: `${over.kind}:${over.id}`,
    linkedKey: null,
    ...over,
  });
  const at = (vacancyId: string) => ({ vacancy: { id: vacancyId, number: 'VAC-2026-0002', title: 'Media Buyer' }, percent: 82, fit: null, can: { add: true } });

  it('adds from the CV that fits: an applicant’s, a general CV’s, a moved general CV’s application', () => {
    expect(recordOfCv(cv({ kind: 'application', id: 'a1' }))).toEqual({ applicationId: 'a1' });
    expect(recordOfCv(cv({ kind: 'general_cv', id: 'g1' }))).toEqual({ generalCvId: 'g1' });
    expect(recordOfCv(cv({ kind: 'general_cv', id: 'g2', linkedKey: 'application:a2' }))).toEqual({ applicationId: 'a2' });
    const cvs = [cv({ kind: 'application', id: 'a1', openPositions: [at('v1')] }), cv({ kind: 'general_cv', id: 'g1', openPositions: [at('v2')] })];
    expect(recordFor('v2', cvs)).toEqual({ generalCvId: 'g1' });
    expect(recordFor('v1', cvs)).toEqual({ applicationId: 'a1' });
    expect(recordFor('v9', cvs)).toBeNull();
    // the candidate's page: the CV the position names first, even without the CVs' own positions
    expect(recordFor('v3', [], [{ ...at('v3'), record: { kind: 'general_cv', id: 'g7' } }])).toEqual({ generalCvId: 'g7' });
    expect(recordFor('v3', [], [{ ...at('v3'), record: { kind: 'application', id: 'a7' } }])).toEqual({ applicationId: 'a7' });
  });

  it('the General CVs sort by the best fit (?sort=fit), the filters kept', () => {
    expect(readGeneralQuery({ sort: 'fit' }).sort).toBe('fit');
    expect(readGeneralQuery({ sort: 'name' }).sort).toBe('');
    expect(generalApiPath({ sort: 'fit', skill: 'SEO' })).toBe('/recruitment/general-cvs?skill=SEO&sort=fit');
    expect(generalHref({ ...readGeneralQuery({ status: 'new' }), sort: 'fit' })).toBe('/recruitment/applicants?status=new&sort=fit&tab=general');
  });
});

describe('the key skills suggested (vacancy form)', () => {
  it('the note and its link to the form, suggesting as it opens', () => {
    expect(NO_KEY_SKILLS_NOTE).toBe('No key skills listed: the CV match uses the title, years and requirements only.');
    expect(suggestKeySkillsHref('abc')).toBe('/recruitment/vacancies/abc/edit?suggest=1');
    expect(wantsSuggestion({ suggest: '1' })).toBe(true);
    expect(wantsSuggestion({ suggest: ['1'] })).toBe(true);
    expect(wantsSuggestion({})).toBe(false);
  });

  it('suggested from the form’s title, job title and texts; added to the chips each once, up to 20', () => {
    const found = suggestedFrom({
      title: 'Marketing Manager',
      jobTitle: jobTitleName('Marketing Manager — Studio · Marketing'),
      about: '',
      responsibilities: '<p>Run campaigns on Meta Ads and Google Ads</p>',
      requirements: '<ul><li>SEO and Google Analytics</li></ul>',
    });
    // the title's core term, then the dictionary's skills as first named (the requirements read before the responsibilities)
    expect(found).toEqual(['Marketing', 'SEO', 'Google Analytics', 'Meta Ads', 'Google Ads']);
    expect(withSuggested(['seo', 'Copywriting'], found)).toEqual({ skills: ['seo', 'Copywriting', 'Marketing', 'Google Analytics', 'Meta Ads', 'Google Ads'], added: 4 });
    const full = Array.from({ length: 19 }, (_, i) => `Skill ${i}`);
    expect(withSuggested(full, found)).toEqual({ skills: [...full, 'Marketing'], added: 1 });
    expect(suggestedText(4, 5)).toBe('4 key skills suggested from the title and texts: remove any that don’t fit, then save.');
    expect(suggestedText(1, 1)).toBe('1 key skill suggested from the title and texts: remove any that don’t fit, then save.');
    expect(suggestedText(0, 3)).toBe('The suggested key skills are listed already.');
    expect(suggestedText(0, 0)).toBe('Nothing to suggest from the title and texts: add the key skills yourself.');
    expect(typedKeySkills('Premiere Pro, After Effects، premiere pro\nCanva')).toEqual(['Premiere Pro', 'After Effects', 'Canva']);
    expect(jobTitleName('Video Editor — Production · Video')).toBe('Video Editor');
    expect(jobTitleName(null)).toBeNull();
  });

  it('as the form opens: suggested only when asked and none are listed', () => {
    const d = { keySkills: [] as string[], title: 'Video Editor', about: '', responsibilities: '<p>Premiere Pro</p>', requirements: '' };
    expect(openingKeySkills(d, 'Video Editor', false)).toEqual({ skills: [], note: null });
    expect(openingKeySkills(d, 'Video Editor', true)).toEqual({ skills: ['Video editing', 'Premiere Pro'], note: '2 key skills suggested from the title and texts: remove any that don’t fit, then save.' });
    expect(openingKeySkills({ ...d, keySkills: ['Canva'] }, 'Video Editor', true)).toEqual({ skills: ['Canva'], note: null });
  });
});
