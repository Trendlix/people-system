import { careerOf, cvFit, cvFitLine, cvFitSkipperText, skipperText, SKIPPER_PENALTY, type CareerFacts, type CvFacts, type CvWorkEntry } from '@trendlix/shared';

// A CV's career (owner, 29 October 2026: "when calculating expirence in the scoring, make it career based or company
// based. and if the candidate is a skipper or no"; he chose "Span vs time employed", "Set per job", "Short average stay"
// and "Flag + lower the score"): packages/shared career.ts and its effect on the CV fit. Every company here is invented.

const job = (pastCompany: string | null, from: string | null, to: string | null, current = false): CvWorkEntry => ({ pastTitle: 'Designer', pastCompany, from, to, current });

describe('a CV’s career from its work history', () => {
  it('spans from the first job’s start to the latest’s end, gaps included; a current job to the month read', () => {
    // 2018-01 … 2019-12, a year off, 2021-01 … now (2026-10)
    const c = careerOf([job('Nile Foods', '2018-01', '2019-12'), job('Delta Bank', '2021-01', null, true)], '2026-10-29')!;
    expect(c.spanMonths).toBe(8 * 12 + 9);
    expect(c.companies).toBe(2);
    // under 3 companies: no average, never a skipper
    expect(c).toMatchObject({ averageStayMonths: null, skipper: false });
    // a year alone: its January to its December
    expect(careerOf([job('Nile Foods', '2019', '2020')], '2026-10')!.spanMonths).toBe(23);
  });

  it('is a skipper under a year a company on average, with at least 3 companies; a promotion is one stay', () => {
    const hopper = careerOf([job('Alpha Co', '2023-01', '2023-08'), job('Beta Co', '2023-09', '2024-05'), job('Gamma Co', '2024-06', '2025-03')], '2026-10')!;
    // a stay counts its months, the first and the last both (Jan … Aug: 8)
    expect(hopper).toEqual({ spanMonths: 26, companies: 3, averageStayMonths: 9, skipper: true });
    expect(skipperText(hopper)).toBe('Skipper · 9 m a company on average');
    // the same three, but two jobs at Beta (a promotion): 2 companies, not counted
    const promoted = careerOf([job('Alpha Co', '2023-01', '2023-08'), job('Beta Co.', '2023-09', '2024-05'), job('beta  co', '2024-06', '2025-03')], '2026-10')!;
    expect(promoted).toMatchObject({ companies: 2, averageStayMonths: null, skipper: false });
    // a year or more on average: not a skipper
    const steady = careerOf([job('Alpha Co', '2019-01', '2020-12'), job('Beta Co', '2021-01', '2021-06'), job('Gamma Co', '2021-07', '2022-06')], '2026-10')!;
    expect(steady).toMatchObject({ companies: 3, averageStayMonths: 14, skipper: false });
    expect(skipperText(steady)).toBeNull();
  });

  it('tells nothing without a job read; jobs without dates add no stay', () => {
    expect(careerOf([], '2026-10')).toBeNull();
    expect(careerOf(null, '2026-10')).toBeNull();
    expect(careerOf([job('Alpha Co', null, null), job('Beta Co', null, null), job('Gamma Co', null, null)], '2026-10')).toEqual({ spanMonths: null, companies: 0, averageStayMonths: null, skipper: false });
  });
});

describe('the CV fit: experience company or career based, a skipper’s points off', () => {
  const text = 'Senior Designer. Adobe Photoshop, Illustrator, branding, social media campaigns.';
  // worked 3 years in all, over a 6-year career
  const facts = { experienceMonths: 36, workHistory: [] } as unknown as CvFacts;
  const career: CareerFacts = { spanMonths: 72, companies: 2, averageStayMonths: null, skipper: false };
  const vacancy = (experienceBasis?: 'company' | 'career') => ({
    title: 'Senior Designer',
    keySkills: [],
    requirements: '<p>At least 5 years of experience in design.</p>',
    agencyBackground: 'not_needed' as const,
    experienceBasis,
  });
  const experience = (fit: ReturnType<typeof cvFit>) => fit!.parts.find((p) => p.key === 'experience')!;

  it('counts the months worked when company based (the default), the career’s span when career based', () => {
    const company = experience(cvFit(vacancy(), { text, facts, career }));
    expect(company).toMatchObject({ years: 3, fromCv: true, basis: 'company', score: 60 });
    expect(company.detail).toBe('≈ 3 years (from the CV’s dates); the job asks 5+ years');
    const span = experience(cvFit(vacancy('career'), { text, facts, career }));
    expect(span).toMatchObject({ years: 6, fromCv: true, basis: 'career', score: 100 });
    expect(span.detail).toBe('≈ 6 years (from the CV’s dates, first job to latest, gaps included); the job asks 5+ years');
  });

  it('takes the years typed either way, and the months worked when no job’s dates were read', () => {
    expect(experience(cvFit(vacancy('career'), { text, facts, career, yearsTyped: 4 }))).toMatchObject({ years: 4, fromCv: false, score: 80 });
    expect(experience(cvFit(vacancy('career'), { text, facts, career: null }))).toMatchObject({ years: 3, fromCv: true, score: 60 });
  });

  it('takes a skipper’s points off the percent, never below 0, and says so', () => {
    const skipper: CareerFacts = { spanMonths: 27, companies: 3, averageStayMonths: 9, skipper: true };
    const plain = cvFit(vacancy(), { text, facts, career })!;
    const hopping = cvFit(vacancy(), { text, facts, career: skipper })!;
    expect(plain.skipper).toBeUndefined();
    expect(hopping.percent).toBe(plain.percent! - SKIPPER_PENALTY);
    expect(hopping.skipper).toEqual({ penalty: SKIPPER_PENALTY, averageStayMonths: 9 });
    expect(cvFitSkipperText(hopping)).toBe('Skipper (9 m a company on average): 10 points off');
    expect(cvFitLine(hopping)).toMatch(/ · Skipper −10$/);
    // a CV scoring under the points: 0, its penalty what was there to take
    const low = cvFit(vacancy(), { text, facts: { experienceMonths: 3, workHistory: [] } as unknown as CvFacts, career: skipper })!;
    expect(low.percent).toBe(0);
    expect(low.skipper!.penalty).toBeLessThan(SKIPPER_PENALTY);
  });
});
