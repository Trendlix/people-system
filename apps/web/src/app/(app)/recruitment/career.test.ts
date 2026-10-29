import { describe, expect, it } from 'vitest';
import { careerFlag, EXPERIENCE_BASIS_FIELD, experienceBasisChoices, experienceBasisText, fitSkipperLine, skipperChip, vacancyExperienceBasisOf } from './career';
import { fitSummary } from './cv-fit';
import { vacancyForm } from './recruitment';

// A CV's career on the site (owner, 29 October 2026: "when calculating expirence in the scoring, make it career based or
// company based. and if the candidate is a skipper or no"; "Span vs time employed", "Set per job", "Short average stay",
// "Flag + lower the score").

describe('the job’s choice: experience company or career based', () => {
  it('offers both, company first; takes only those', () => {
    expect(experienceBasisChoices()).toEqual([
      { value: 'company', label: 'Company based' },
      { value: 'career', label: 'Career based' },
    ]);
    expect(vacancyExperienceBasisOf('career')).toBe('career');
    expect(vacancyExperienceBasisOf('tenure')).toBeNull();
    expect(experienceBasisText('career')).toBe('Career based · first job to latest, gaps included');
    expect(experienceBasisText('company')).toBe('Company based · the months worked, gaps left out');
    expect(experienceBasisText(undefined)).toBeNull();
  });

  it('is sent with the vacancy when chosen, left out otherwise', () => {
    const form = (extra: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ jobTitleId: '11111111-1111-4111-8111-111111111111', employmentType: 'full_time', headcount: '1', ...extra })) fd.set(k, v);
      return vacancyForm(fd, { withQuestions: false });
    };
    expect(form({ [EXPERIENCE_BASIS_FIELD]: 'career' }).body).toMatchObject({ experienceBasis: 'career' });
    expect(form({}).body).not.toHaveProperty('experienceBasis');
  });
});

describe('the skipper', () => {
  it('shows "Skipper" in the lists only when they are one, their average on hover', () => {
    expect(skipperChip({ skipper: true, averageStayMonths: 8 })).toEqual({ text: 'Skipper', title: expect.stringMatching(/^8 m a company on average: under a year a company on average \(from 3 companies\), 10 points off/) });
    expect(skipperChip({ skipper: false, averageStayMonths: 20 })).toBeNull();
    expect(skipperChip({ skipper: null, averageStayMonths: null })).toBeNull();
    expect(skipperChip(null)).toBeNull();
  });

  it('says the average stay on the CV card, a skipper or not, from 3 companies', () => {
    expect(careerFlag({ spanMonths: 26, companies: 3, averageStayMonths: 9, skipper: true })).toMatchObject({ text: 'Skipper · 9 m a company on average', skipper: true });
    expect(careerFlag({ spanMonths: 60, companies: 3, averageStayMonths: 18, skipper: false })).toMatchObject({ text: '1 y 6 m a company on average', skipper: false });
    // fewer companies: nothing to say
    expect(careerFlag({ spanMonths: 60, companies: 2, averageStayMonths: null, skipper: false })).toBeNull();
    expect(careerFlag(null)).toBeNull();
  });

  it('says the points off in the CV match', () => {
    const fit = { percent: 50, version: 3, parts: [], skipper: { penalty: 10, averageStayMonths: 9 } };
    expect(fitSkipperLine(fit)).toBe('Skipper (9 m a company on average): 10 points off');
    expect(fitSummary(fit)).toMatch(/^50% from the parts below, less a skipper’s points\. Skipper \(9 m a company on average\): 10 points off\./);
    expect(fitSkipperLine({ skipper: undefined })).toBeNull();
  });
});
