import {
  AGENCY_FIT_WEIGHTS,
  agencyBackgroundOf,
  agencyOfCompany,
  agencyScore,
  companyKey,
  cvFit,
  cvFitPartShort,
  exAgencyText,
  type AgencyBackground,
  type CvWorkEntry,
} from '@trendlix/shared';

// Marketing agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not
// AND reflectin the scoring"; he chose "Name words + your list", "Show agency years", "Set per job" and "Yes or no"):
// packages/shared marketing-agencies.ts and its part of the CV fit. Every company and person here is invented.

const job = (pastCompany: string | null, from: string | null, to: string | null, current = false): CvWorkEntry => ({ pastTitle: 'Designer', pastCompany, from, to, current });

describe('a marketing agency, by its name or HR’s mark', () => {
  it('is told by its name’s words, in English and Arabic', () => {
    expect(agencyOfCompany('Orbit Creative Agency')).toEqual({ agency: true, by: 'name' });
    expect(agencyOfCompany('Nile Advertising')).toEqual({ agency: true, by: 'name' });
    expect(agencyOfCompany('Pixel Studio')).toEqual({ agency: true, by: 'name' });
    expect(agencyOfCompany('وكالة النجوم للدعاية والإعلان')).toEqual({ agency: true, by: 'name' });
    expect(agencyOfCompany('ميديا بلس')).toEqual({ agency: true, by: 'name' });
    expect(agencyOfCompany('Juhayna Food Industries')).toEqual({ agency: false, by: null });
  });

  it('is never a travel, recruitment, real estate, insurance or shipping agency', () => {
    for (const name of ['Sunrise Travel Agency', 'Top Recruitment Agency', 'Nile Real Estate Agency', 'Delta Insurance Agency', 'Blue Shipping Agency', 'وكالة سفر النيل', 'وكالة توظيف']) {
      expect(agencyOfCompany(name)).toEqual({ agency: false, by: null });
    }
  });

  it('follows HR’s mark first, either way, whatever the name’s letters and spacing', () => {
    const marks = new Map([
      [companyKey('Publicis Egypt'), true],
      [companyKey('Digital Bank'), false],
    ]);
    expect(agencyOfCompany('PUBLICIS  egypt', marks)).toEqual({ agency: true, by: 'mark' });
    expect(agencyOfCompany('Digital Bank', marks)).toEqual({ agency: false, by: 'mark' });
    expect(agencyOfCompany('Digital Bank')).toEqual({ agency: true, by: 'name' });
    expect(companyKey('  وكالةُ  الإعلان ')).toBe('وكاله الاعلان');
  });
});

describe('a CV’s agency background', () => {
  it('counts the months at agencies once where they overlap, "present" as of the month given', () => {
    const b = agencyBackgroundOf([job('Orbit Creative Agency', '2024-02', null, true), job('Juhayna', '2021-01', '2024-01'), job('Pixel Studio', '2023-11', '2024-03')], '2026-10');
    // Orbit: Feb 2024 to Oct 2026 (33 months), Pixel adds Nov 2023 to Jan 2024 (3): 36
    expect(b).toEqual({
      exAgency: true,
      months: 36,
      jobs: [
        { pastCompany: 'Orbit Creative Agency', agency: true, by: 'name', months: 33 },
        { pastCompany: 'Juhayna', agency: false, by: null, months: 37 },
        { pastCompany: 'Pixel Studio', agency: true, by: 'name', months: 5 },
      ],
    });
    expect(exAgencyText(b)).toBe('Ex-agency · 3 y');
  });

  it('a year alone runs January to December; dates not read leave its months unknown', () => {
    expect(agencyBackgroundOf([job('Nile Advertising', '2020', '2020')], '2026-10')?.months).toBe(12);
    expect(agencyBackgroundOf([job('Nile Advertising', null, null)], '2026-10')).toEqual({ exAgency: true, months: 0, jobs: [{ pastCompany: 'Nile Advertising', agency: true, by: 'name', months: null }] });
    expect(exAgencyText({ exAgency: true, months: 0 })).toBe('Ex-agency');
  });

  it('says nothing without a work history read, and "not ex-agency" with one and no agency', () => {
    expect(agencyBackgroundOf([], '2026-10')).toBeNull();
    expect(agencyBackgroundOf(null, '2026-10')).toBeNull();
    expect(agencyBackgroundOf([job('Juhayna', '2021-01', '2024-01')], '2026-10')).toMatchObject({ exAgency: false, months: 0 });
    expect(exAgencyText({ exAgency: false, months: 0 })).toBeNull();
  });

  it('scores yes or no: 6 months or more in full, less half, none 0', () => {
    expect([agencyScore({ exAgency: true, months: 6 }), agencyScore({ exAgency: true, months: 5 }), agencyScore({ exAgency: true, months: 0 }), agencyScore({ exAgency: false, months: 0 })]).toEqual([100, 50, 50, 0]);
  });
});

describe('the CV fit’s agency part (owner: "Set per job", "Yes or no")', () => {
  const text = 'Senior Designer at Orbit Creative Agency. Adobe Photoshop, Illustrator, branding, social media campaigns.';
  const ex: AgencyBackground = { exAgency: true, months: 30, jobs: [] };
  const not: AgencyBackground = { exAgency: false, months: 0, jobs: [] };
  const vacancy = (agencyBackground?: 'required' | 'preferred' | 'not_needed') => ({ title: 'Senior Designer', keySkills: ['Photoshop', 'Illustrator'], agencyBackground });

  it('weighs 10 when preferred (the default) and 20 when required, the other parts shrinking to fit', () => {
    const preferred = cvFit(vacancy(), { text, facts: null, agency: ex })!;
    const part = preferred.parts.find((p) => p.key === 'agency')!;
    expect(part).toMatchObject({ score: 100, exAgency: true, agencyMonths: 30, agencyWanted: 'preferred', detail: 'Ex-agency: 2 y 6 m at marketing agencies; the job prefers it (preferred)' });
    // key skills 35 and agency 10 of 45
    expect(part.weight).toBe(Math.round((1000 * AGENCY_FIT_WEIGHTS.preferred) / 45) / 10);
    const required = cvFit(vacancy('required'), { text, facts: null, agency: not })!;
    expect(required.parts.find((p) => p.key === 'agency')).toMatchObject({ score: 0, weight: Math.round((1000 * 20) / 55) / 10, detail: 'No marketing agency in the work history; the job requires it (required)' });
    // key skills in full, agency none: 35 of 55
    expect(required.percent).toBe(Math.round((100 * 35) / 55));
    expect(cvFitPartShort(part)).toBe('Ex-agency 2 y 6 m');
  });

  it('is left out when not needed, or when the CV’s work history wasn’t read', () => {
    expect(cvFit(vacancy('not_needed'), { text, facts: null, agency: ex })!.parts.map((p) => p.key)).not.toContain('agency');
    expect(cvFit(vacancy('required'), { text, facts: null, agency: null })!.parts.map((p) => p.key)).not.toContain('agency');
  });
});
