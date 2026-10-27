import { describe, expect, it } from 'vitest';
import { CV_FIT_VERSION, HIDDEN, type AgencyBackground, type CvFit, type CvFitPart } from '@trendlix/shared';
import {
  AGENCY_BACKGROUND_FIELD,
  AGENCY_BACKGROUND_HINT,
  agencyBackgroundChoices,
  agencyBackgroundText,
  agencyFlag,
  agencyJobBadge,
  agencyJobCount,
  agencyJobsFor,
  agencyMarkApiPath,
  agencyMarkForm,
  exAgencyChip,
  hasMarkableCompany,
  markActionsFor,
  markIdOf,
  markNote,
  markSavedText,
  markText,
  vacancyAgencyBackgroundOf,
} from './agency';
import { fitRows, fitSummary } from './cv-fit';
import { workHistoryHeading } from './cv-reading';
import { vacancyForm } from './recruitment';

// Marketing agency background on the site (owner, 27 October 2026: "when opening a job, can the OCR detect if his previous
// works are in agency?", then "i need a flag if the candidate is ex marketing agencies or not AND reflectin the scoring";
// asked, "Name words + your list", "Show agency years", "Set per job", "Yes or no"). Every company here is made up.

const background = (over: Partial<AgencyBackground> = {}): AgencyBackground => ({
  exAgency: true,
  months: 40,
  jobs: [
    { pastCompany: 'Bright Creative Studio', agency: true, by: 'name', months: 28 },
    { pastCompany: 'Nile Foods', agency: false, by: null, months: 24 },
    { pastCompany: 'Orbit Partners', agency: true, by: 'mark', months: 12 },
  ],
  ...over,
});

describe('the vacancy’s Agency background', () => {
  it('offers Required, Preferred and Not needed, with their weights in the hint', () => {
    expect(agencyBackgroundChoices()).toEqual([
      { value: 'required', label: 'Required' },
      { value: 'preferred', label: 'Preferred' },
      { value: 'not_needed', label: 'Not needed' },
    ]);
    expect(AGENCY_BACKGROUND_HINT).toBe('How much marketing agency experience counts in the CV match: Required weighs 20, Preferred 10, Not needed leaves it out.');
  });

  it('reads the choice, nothing else', () => {
    expect(vacancyAgencyBackgroundOf('required')).toBe('required');
    expect(vacancyAgencyBackgroundOf('not_needed')).toBe('not_needed');
    expect(vacancyAgencyBackgroundOf('')).toBeNull();
    expect(vacancyAgencyBackgroundOf('always')).toBeNull();
  });

  it('is sent with the form, and left out when the form had none', () => {
    const fd = new FormData();
    fd.set('jobTitleId', '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e');
    fd.set('employmentType', 'full_time');
    expect(vacancyForm(fd, { withQuestions: false }).body).not.toHaveProperty('agencyBackground');
    fd.set(AGENCY_BACKGROUND_FIELD, 'required');
    expect(vacancyForm(fd, { withQuestions: false }).body?.agencyBackground).toBe('required');
    fd.set(AGENCY_BACKGROUND_FIELD, 'sometimes');
    expect(vacancyForm(fd, { withQuestions: false }).body).not.toHaveProperty('agencyBackground');
  });

  it('says on the vacancy’s page what it weighs; nothing from an API before it', () => {
    expect(agencyBackgroundText('required')).toBe('Required · weighs 20 in the CV match');
    expect(agencyBackgroundText('preferred')).toBe('Preferred · weighs 10 in the CV match');
    expect(agencyBackgroundText('not_needed')).toBe('Not needed · left out of the CV match');
    expect(agencyBackgroundText(undefined)).toBeNull();
  });
});

describe('the CV card', () => {
  it('flags "Ex-agency · 3 y 4 m", "Not ex-agency", or nothing when not told', () => {
    expect(agencyFlag(background())).toEqual({ text: 'Ex-agency · 3 y 4 m', exAgency: true, title: '3 y 4 m at marketing agencies in all, each month counted once' });
    expect(agencyFlag(background({ months: 0 }))).toMatchObject({ text: 'Ex-agency', exAgency: true, title: 'At a marketing agency; its dates weren’t read' });
    expect(agencyFlag(background({ exAgency: false, months: 0 }))).toMatchObject({ text: 'Not ex-agency', exAgency: false });
    expect(agencyFlag(null)).toBeNull();
    expect(agencyFlag(undefined)).toBeNull();
  });

  it('marks each job: "Agency" by its name, HR’s mark either way, nothing for a company nothing says is one', () => {
    expect(agencyJobBadge({ agency: true, by: 'name' })).toMatchObject({ text: 'Agency', agency: true });
    expect(agencyJobBadge({ agency: true, by: 'mark' })).toMatchObject({ text: 'Agency (marked)', agency: true });
    expect(agencyJobBadge({ agency: false, by: 'mark' })).toMatchObject({ text: 'Not an agency (marked)', agency: false });
    expect(agencyJobBadge({ agency: false, by: null })).toBeNull();
    expect(agencyJobBadge(null)).toBeNull();
  });

  it('pairs the work history’s jobs with their marks, in order, only where the company is the same', () => {
    const history = [{ pastCompany: 'Bright Creative Studio' }, { pastCompany: 'Nile Foods' }, { pastCompany: 'Orbit Partners' }];
    const jobs = agencyJobsFor(history, background());
    expect(jobs.map((j) => j?.agency)).toEqual([true, false, true]);
    expect(agencyJobCount(jobs)).toBe(2);
    expect(agencyJobsFor([{ pastCompany: 'Somewhere Else' }, ...history.slice(1)], background())[0]).toBeNull();
    expect(agencyJobsFor(history, null)).toEqual([null, null, null]);
    expect(agencyJobsFor([...history, { pastCompany: 'One more' }], background())[3]).toBeNull();
  });

  it('counts the agencies on the work history’s fold', () => {
    expect(workHistoryHeading(3, 2)).toBe('Work History (3 roles, 2 at agencies)');
    expect(workHistoryHeading(3, 1)).toBe('Work History (3 roles, 1 at an agency)');
    expect(workHistoryHeading(1, 0)).toBe('Work History (1 role)');
  });

  it('gives HR the mark that changes a job, and Remove mark on one HR marked', () => {
    expect(markActionsFor('Nile Foods', { agency: false, by: null }, null)).toEqual([
      expect.objectContaining({ kind: 'set', company: 'Nile Foods', agency: true, label: 'Mark as agency' }),
    ]);
    expect(markActionsFor(' Bright Creative Studio ', { agency: true, by: 'name' }, null)).toEqual([
      expect.objectContaining({ kind: 'set', company: 'Bright Creative Studio', agency: false, label: 'Not an agency' }),
    ]);
    const marked = markActionsFor('Orbit Partners', { agency: true, by: 'mark' }, 'mark-1');
    expect(marked.map((a) => a.label)).toEqual(['Not an agency', 'Remove mark']);
    expect(marked[1]).toMatchObject({ kind: 'remove', id: 'mark-1' });
    expect(marked[0].confirm).toContain('Mark “Orbit Partners” as not a marketing agency?');
    // its mark's id not known (the list not loaded): no Remove mark
    expect(markActionsFor('Orbit Partners', { agency: true, by: 'mark' }, null)).toHaveLength(1);
  });

  it('gives none without a company, or with one hidden from a developer', () => {
    expect(markActionsFor(null, { agency: false, by: null }, null)).toEqual([]);
    expect(markActionsFor('  ', { agency: false, by: null }, null)).toEqual([]);
    expect(markActionsFor(HIDDEN, { agency: true, by: 'name' }, null)).toEqual([]);
    expect(markActionsFor('Nile Foods', null, null)).toEqual([]);
    expect(hasMarkableCompany([{ pastCompany: HIDDEN }, null, { pastCompany: null }])).toBe(false);
    expect(hasMarkableCompany([{ pastCompany: HIDDEN }, { pastCompany: 'Nile Foods' }])).toBe(true);
  });

  it('finds HR’s mark on a company by its name as compared', () => {
    const marks = [
      { id: 'm1', name: 'Orbit  Partners' },
      { id: 'm2', name: 'وكالة النور' },
    ];
    expect(markIdOf(marks, 'orbit partners')).toBe('m1');
    expect(markIdOf(marks, 'ORBIT-PARTNERS')).toBe('m1');
    expect(markIdOf(marks, 'وكاله النور')).toBe('m2');
    expect(markIdOf(marks, 'Nile Foods')).toBeNull();
    expect(markIdOf(marks, null)).toBeNull();
  });
});

describe('the lists', () => {
  it('show "Ex-agency" with its months on hover; nothing otherwise', () => {
    expect(exAgencyChip({ exAgency: true, agencyMonths: 30 })).toEqual({ text: 'Ex-agency', title: '2 y 6 m at marketing agencies in all, each month counted once' });
    expect(exAgencyChip({ exAgency: true, agencyMonths: null })?.title).toBe('At a marketing agency; its dates weren’t read');
    expect(exAgencyChip({ exAgency: false, agencyMonths: 0 })).toBeNull();
    expect(exAgencyChip({ exAgency: null, agencyMonths: null })).toBeNull();
    expect(exAgencyChip({})).toBeNull();
    expect(exAgencyChip(null)).toBeNull();
  });
});

describe('the CV match’s agency part', () => {
  const part = (over: Partial<CvFitPart>): CvFitPart => ({ key: 'skills', label: 'Key skills', score: 100, weight: 20, detail: '', ...over });
  const five: CvFitPart[] = (['skills', 'title', 'experience', 'requirements', 'education'] as const).map((key) => part({ key, label: key }));
  const agency = part({ key: 'agency', label: 'Agency background', score: 50, weight: 9.1, detail: 'Ex-agency: 4 m at marketing agencies; the job prefers it (preferred)', exAgency: true, agencyMonths: 4, agencyWanted: 'preferred' });

  it('shows like the others in the CV Fit section', () => {
    const fit: CvFit = { percent: 81, version: CV_FIT_VERSION, parts: [...five, agency] };
    expect(fitRows(fit)[5]).toEqual({ key: 'agency', label: 'Agency background', score: '50%', weight: '9.1% of the fit', detail: 'Ex-agency: 4 m at marketing agencies; the job prefers it (preferred)' });
  });

  it('isn’t a part that couldn’t be scored when its vacancy doesn’t need it', () => {
    expect(fitSummary({ percent: 80, version: CV_FIT_VERSION, parts: five })).toBe('80% from the parts below.');
    expect(fitSummary({ percent: 81, version: CV_FIT_VERSION, parts: [...five, agency] })).toBe('81% from the parts below.');
    expect(fitSummary({ percent: 70, version: CV_FIT_VERSION, parts: [...five.slice(1), agency] })).toMatch(/left out, the others re-weighted to 100\.$/);
  });
});

describe('Recruitment Settings’ Marketing Agencies', () => {
  const form = (values: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  };

  it('reads a company and whether it is a marketing agency', () => {
    expect(agencyMarkForm(form({ company: '  Orbit   Partners ', agency: 'yes' }))).toEqual({ body: { company: 'Orbit Partners', agency: true }, errors: [] });
    expect(agencyMarkForm(form({ company: 'Nile Media Shipping', agency: 'no' })).body).toEqual({ company: 'Nile Media Shipping', agency: false });
  });

  it('names what is wrong', () => {
    expect(agencyMarkForm(form({ company: ' ', agency: 'maybe' })).errors).toEqual(['Write the company’s name, e.g. Publicis Egypt.', 'Choose whether it is a marketing agency.']);
    expect(agencyMarkForm(form({ company: '--', agency: 'yes' })).errors).toEqual(['Write the company’s name, e.g. Publicis Egypt.']);
    expect(agencyMarkForm(form({ company: 'x'.repeat(201), agency: 'yes' })).errors).toEqual(['Keep the company’s name to 200 characters or fewer.']);
  });

  it('says each mark, and where the name alone would say otherwise', () => {
    expect(markText(true)).toBe('Agency');
    expect(markText(false)).toBe('Not an agency');
    expect(markNote({ agency: false, byName: true })).toBe('Its name says agency');
    expect(markNote({ agency: true, byName: false })).toBe('Its name doesn’t say agency');
    expect(markNote({ agency: true, byName: true })).toBeNull();
    expect(markSavedText('Orbit Partners', false)).toBe('Saved: “Orbit Partners” is not a marketing agency.');
    expect(agencyMarkApiPath('a b')).toBe('/recruitment/agency-marks/a%20b');
  });
});
