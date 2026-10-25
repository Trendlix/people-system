import {
  betterFitOf,
  betterFitText,
  betterFitTitle,
  CV_FIT_VERSION,
  cvFacts,
  cvFit,
  cvFitFrom,
  cvFitOf,
  cvFitLine,
  cvFitPartDetail,
  cvFitPartShort,
  educationWantedIn,
  HIDDEN,
  htmlText,
  keySkillsFound,
  openFitsFor,
  openPositionsShown,
  prepareFitCv,
  prepareFitJob,
  requirementTerms,
  scoreSuggestion,
  suggestKeySkills,
  termStem,
  titleCoreTerm,
  yearsScore,
  yearsWantedIn,
  yearsWantedOf,
  type CvFit,
  type FitVacancyInput,
  type SuggestionPerson,
  type SuggestionRecord,
  type SuggestionVacancy,
} from '@trendlix/shared';

// The CV fit (owner, 25 October 2026: "aren't you supposed to match the candidate to the job based on the CV and ATS?";
// asked, "Full CV fit score"; packages/shared cv-fit.ts): each part (the key skills, the title with its rank words aside,
// the years read in English and Arabic and their curve, the requirements' terms with the HTML and stop words out, the
// education), the parts re-weighted when some can't be scored, null without text, the version; the key skills suggested;
// the other open positions ("and if it recomended to another position based on the CV": the badge at 60% and 10 points,
// the top 3 at 50%). Every person, CV and vacancy here is invented.

const NOW = new Date(Date.UTC(2026, 9, 25)); // October 2026

const CV = [
  'Layla Invented',
  'Cairo, Egypt',
  'Experience',
  'Digital Marketing Manager, Orbit Creative Agency, Jan 2018 - Present',
  'Marketing Specialist at Nile Media Studio, Mar 2015 - Dec 2017',
  'Skills',
  'Facebook Ads, SEO, Google Analytics, HubSpot, content writing, campaign planning, budgets, reporting',
  'Education',
  'Bachelor of Commerce, Faculty of Commerce, Cairo University, 2014',
].join('\n');

const MARKETING: FitVacancyInput = {
  title: 'Marketing Manager',
  jobTitle: 'Marketing Manager',
  keySkills: ['Meta Ads', 'Google Ads', 'SEO', 'HubSpot'],
  requirements:
    '<ul><li>5+ years of experience in digital marketing</li><li>Bachelor&#39;s degree in Marketing, Commerce or a related field</li><li>Hands-on with campaigns, budgets and reporting</li></ul>',
  responsibilities: '<p>Plan and run campaigns across social media; manage the marketing budget; report on campaign performance.</p>',
};

const fitOf = (v: FitVacancyInput, text = CV, extra: { yearsTyped?: number | null; position?: string | null } = {}) => cvFit(v, { text, facts: cvFacts(text, NOW), ...extra });
const part = (fit: CvFit | null, key: string) => fit?.parts.find((p) => p.key === key);

describe('the CV fit: its parts', () => {
  it('key skills: found ÷ listed, a dictionary skill under any of its names ("Facebook Ads" for "Meta Ads")', () => {
    const fit = fitOf(MARKETING);
    expect(part(fit, 'skills')).toMatchObject({ score: 75, found: ['Meta Ads', 'SEO', 'HubSpot'], missing: ['Google Ads'], listed: 4, detail: '3 of 4: Meta Ads, SEO, HubSpot; missing Google Ads' });
    expect(keySkillsFound('I ran Facebook Ads and wrote copy', ['Meta Ads', 'Copywriting'])).toEqual({ found: ['Meta Ads'], missing: ['Copywriting'] });
    // whole words, any case, Arabic too
    expect(keySkillsFound('خبرة في فوتوشوب و إليستريتور', ['photoshop', 'Illustrator', 'Figma']).found).toEqual(['photoshop', 'Illustrator']);
  });

  it('title: the best likeness, the rank words aside, an earlier job counting less, a general CV’s position in full', () => {
    const close = part(fitOf(MARKETING), 'title');
    expect(close).toMatchObject({ score: 100, matchedTitle: 'Digital Marketing Manager', titleFrom: 'latest', sameTitle: false, detail: 'Close to the job’s title: the latest job' });
    expect(cvFitPartShort(close!)).toBe('Title close (Digital Marketing Manager)');
    // "Senior" and "Junior" aside: the same title
    const senior = part(fitOf({ ...MARKETING, title: 'Junior Marketing Specialist', jobTitle: null }), 'title');
    expect(senior).toMatchObject({ matchedTitle: 'Marketing Specialist', titleFrom: 'earlier', sameTitle: true, score: 90 });
    expect(senior!.detail).toBe('The same title: an earlier job, counted at 90% as an older job');
    // nothing like it: 0, no title named
    expect(part(fitOf({ ...MARKETING, title: 'Video Editor', jobTitle: null }), 'title')).toMatchObject({ score: 0, matchedTitle: null, detail: 'No job title in the CV like the job’s' });
    // a general CV's position counts in full
    expect(part(fitOf({ ...MARKETING, title: 'Media Buyer', jobTitle: null }, CV, { position: 'Media Buyer' }), 'title')).toMatchObject({ score: 100, titleFrom: 'position', sameTitle: true });
  });

  it('experience: the years asked read in English and Arabic', () => {
    expect(yearsWantedIn('5+ years of experience in digital marketing')).toEqual({ min: 5, max: null });
    expect(yearsWantedIn('3–5 years in a similar role')).toEqual({ min: 3, max: 5 });
    expect(yearsWantedIn('between 2 and 4 years')).toEqual({ min: 2, max: 4 });
    expect(yearsWantedIn('At least 4 years of agency experience')).toEqual({ min: 4, max: null });
    expect(yearsWantedIn('a minimum of three years')).toEqual({ min: 3, max: null });
    expect(yearsWantedIn('up to 2 years of experience; fresh graduates welcome')).toEqual({ min: 0, max: 2 });
    expect(yearsWantedIn('خبرة ٥ سنوات في التسويق')).toEqual({ min: 5, max: null });
    expect(yearsWantedIn('خبرة لا تقل عن ٣ سنوات')).toEqual({ min: 3, max: null });
    expect(yearsWantedIn('من ٣ إلى ٥ سنوات خبرة')).toEqual({ min: 3, max: 5 });
    expect(yearsWantedIn('خبرة سنتين على الأقل')).toEqual({ min: 2, max: null });
    // the largest least of several; never an age, a contract or a year
    expect(yearsWantedIn('2+ years managing a team\n6+ years of marketing experience')).toEqual({ min: 6, max: null });
    expect(yearsWantedIn('Aged 25-35 years')).toBeNull();
    expect(yearsWantedIn('a 2 years contract, renewable')).toBeNull();
    expect(yearsWantedIn('Founded in 2015, worked 2019-2024')).toBeNull();
    // its requirements, else its other texts (beside a word of experience), else the questions' least, else the grade's text
    expect(yearsWantedOf({ requirements: '<p>3-5 years</p>', minYears: 8 })).toEqual({ min: 3, max: 5, from: 'requirements' });
    expect(yearsWantedOf({ about: '<p>We have been in business for 10 years.</p>', minYears: 2 })).toEqual({ min: 2, max: null, from: 'questions' });
    expect(yearsWantedOf({ about: '<p>You bring 4 years of experience.</p>' })).toEqual({ min: 4, max: null, from: 'description' });
    expect(yearsWantedOf({ gradeText: '3-5 years' })).toEqual({ min: 3, max: 5, from: 'grade' });
    expect(yearsWantedOf({ gradeText: 'e.g. Senior Graphic Designer' })).toBeNull();
  });

  it('experience: full inside the range, the share of the least below it, 4 less a year above it (never below 70)', () => {
    const w = { min: 5, max: 8 };
    expect([5, 8, 6.5].map((y) => yearsScore(y, w))).toEqual([100, 100, 100]);
    expect([4, 2.5, 0].map((y) => yearsScore(y, w))).toEqual([80, 50, 0]);
    expect([9, 12, 30].map((y) => yearsScore(y, w))).toEqual([96, 84, 70]);
    // "5+": full up to twice the least (at least 3 more)
    expect([10, 11, 15].map((y) => yearsScore(y, { min: 5, max: null }))).toEqual([100, 96, 80]);
    expect(yearsScore(4, { min: 1, max: null })).toBe(100);
    const typed = part(fitOf(MARKETING, CV, { yearsTyped: 8 }), 'experience');
    expect(typed).toMatchObject({ score: 100, years: 8, fromCv: false, wanted: { min: 5, max: null, from: 'requirements' }, detail: '8 years; the job asks 5+ years' });
    expect(cvFitPartShort(typed!)).toBe('8 y vs 5+');
    // the CV's dates (Mar 2015 – now, about 11.5 years): above twice the least
    const dated = part(fitOf(MARKETING), 'experience');
    expect(dated).toMatchObject({ fromCv: true, score: 94, detail: '≈ 12 years (from the CV’s dates); the job asks 5+ years' });
    expect(cvFitPartShort(dated!)).toBe('≈ 12 y vs 5+');
  });

  it('requirements: the HTML out, stop words out (English and Arabic), the dictionary’s skills as one term, the key skills left to their part, at most 20', () => {
    expect(htmlText('<ul><li>Meta&nbsp;Ads &amp; SEO</li><li>Budgets</li></ul>')).toBe('Meta Ads & SEO\nBudgets');
    const terms = requirementTerms({ keySkills: ['SEO'], requirements: '<p>Strong knowledge of <b>Google Analytics</b> and SEO; excellent communication skills; plan campaigns and campaigns budgets.</p>' });
    expect(terms.map((t) => t.term)).toEqual(['Google Analytics', 'campaigns', 'plan', 'budgets']);
    expect(requirementTerms({ keySkills: [], requirements: '<p>إجادة التسويق الرقمي وإدارة الحملات الإعلانية على وسائل التواصل</p>' }).map((t) => t.term)).toEqual(
      expect.arrayContaining(['التسويق', 'الرقمي', 'الحملات']),
    );
    const many = requirementTerms({ keySkills: [], requirements: Array.from({ length: 30 }, (_, i) => `term${String.fromCharCode(97 + (i % 26))}${i}`).join(' ') });
    expect(many).toHaveLength(20);
    // plurals and forms alike on both sides
    expect(termStem('campaigns')).toBe(termStem('campaign'));
    expect(termStem('reporting')).toBe(termStem('report'));
    expect(termStem('management')).toBe(termStem('managed'));
    expect(termStem('التسويق')).toBe('تسويق');
    const req = part(fitOf(MARKETING), 'requirements')!;
    expect(req.listed).toBeGreaterThanOrEqual(3);
    expect(req.found).toEqual(expect.arrayContaining(['marketing', 'campaigns', 'budgets', 'reporting']));
    expect(req.detail).toMatch(/^\d+ of \d+ terms: /);
    expect(cvFitPartShort(req)).toMatch(/^Requirements \d+ of \d+ terms$/);
    // fewer than 3 terms: not scored
    expect(part(fitOf({ ...MARKETING, requirements: '<p>SEO</p>', responsibilities: null }), 'requirements')).toBeUndefined();
  });

  it('education: the lowest level asked, the field in the CV’s education', () => {
    expect(educationWantedIn("Bachelor's degree in Marketing, Commerce or a related field")).toEqual({ level: 'bachelor', fields: ['marketing', 'commerce'] });
    expect(educationWantedIn("A Bachelor's or Master's degree")).toEqual({ level: 'bachelor', fields: [] });
    expect(educationWantedIn('بكالوريوس تجارة أو إدارة أعمال')).toEqual({ level: 'bachelor', fields: ['تجاره', 'اداره اعمال'] });
    expect(educationWantedIn('Fluent English')).toBeNull();
    expect(part(fitOf(MARKETING), 'education')).toMatchObject({ score: 100, level: 'bachelor', wantedLevel: 'bachelor', fieldMet: true, detail: 'Bachelor; the job asks a bachelor’s degree; the field matches (marketing or commerce)' });
    // a master's asked: one below, half; and a field not theirs
    const master = part(fitOf({ ...MARKETING, requirements: "<p>Master's degree in Engineering</p>" }), 'education');
    expect(master).toMatchObject({ wantedLevel: 'master', fieldMet: false, score: Math.round(0.6 * 50) });
    expect(cvFitPartShort(master!)).toBe('Education partly');
  });
});

describe('the CV fit: the whole', () => {
  it('re-weights the parts scored to 100: the percent their weighted mean', () => {
    const fit = fitOf(MARKETING)!;
    expect(fit.version).toBe(CV_FIT_VERSION);
    expect(fit.parts.map((p) => p.key)).toEqual(['skills', 'title', 'experience', 'requirements', 'education']);
    expect(fit.parts.map((p) => p.weight)).toEqual([35, 25, 20, 15, 5]);
    expect(fit.percent).toBe(Math.round(fit.parts.reduce((n, p) => n + p.score * p.weight, 0) / 100));
    // no key skills listed: the rest re-weighted (25 + 20 + 15 + 5 = 65)
    const none = fitOf({ ...MARKETING, keySkills: [] })!;
    expect(none.parts.map((p) => p.key)).toEqual(['title', 'experience', 'requirements', 'education']);
    expect(none.parts.map((p) => p.weight)).toEqual([38.5, 30.8, 23.1, 7.7]);
    expect(none.percent).toBe(Math.round(none.parts.reduce((n, p) => n + p.score * (p.key === 'title' ? 25 : p.key === 'experience' ? 20 : p.key === 'requirements' ? 15 : 5), 0) / 65));
    // no years asked, no title found: left out too
    const bare = cvFit({ title: 'Marketing Manager', keySkills: ['SEO'] }, { text: 'Skills: SEO, writing', facts: cvFacts('Skills: SEO, writing', NOW) })!;
    expect(bare.parts.map((p) => [p.key, p.weight])).toEqual([['skills', 100]]);
    expect(bare.percent).toBe(100);
  });

  it('null without text; the percent null when nothing could be scored; read back as kept', () => {
    expect(cvFit(MARKETING, { text: null, facts: null })).toBeNull();
    expect(cvFit(MARKETING, { text: '   ', facts: null })).toBeNull();
    expect(cvFit({ title: 'Marketing Manager', keySkills: [] }, { text: 'Some words', facts: cvFacts('Some words', NOW) })).toEqual({ percent: null, version: CV_FIT_VERSION, parts: [] });
    const fit = fitOf(MARKETING)!;
    expect(cvFitFrom(JSON.parse(JSON.stringify(fit)))).toEqual(fit);
    expect(cvFitFrom({ percent: 50 })).toBeNull();
    expect(cvFitFrom(null)).toBeNull();
    expect(cvFitFrom({ percent: 40, parts: [] })).toEqual({ percent: 40, version: 0, parts: [] });
  });

  it('the breakdown in words, a developer’s masked title left out', () => {
    const fit = fitOf(MARKETING)!;
    expect(cvFitLine(fit)).toMatch(/^Key skills 3 of 4 · Title close \(Digital Marketing Manager\) · ≈ 12 y vs 5\+ · Requirements \d+ of \d+ terms · Education ✓$/);
    const masked = { ...fit, parts: fit.parts.map((p) => (p.key === 'title' ? { ...p, matchedTitle: HIDDEN } : p)) };
    expect(cvFitLine(masked)).toContain('Title close ·');
    expect(cvFitLine(masked)).not.toContain(HIDDEN);
    const title = fit.parts.find((p) => p.key === 'title')!;
    expect(cvFitPartDetail(title)).toBe('Digital Marketing Manager · Close to the job’s title: the latest job');
    expect(cvFitPartDetail({ ...title, matchedTitle: HIDDEN })).toBe('Close to the job’s title: the latest job');
    // the detail itself never names the CV's title
    for (const p of fit.parts) expect(p.detail).not.toContain('Digital Marketing Manager');
    expect(cvFitLine(null)).toBe('The CV isn’t read yet');
  });
});

describe('the key skills suggested', () => {
  it('the dictionary’s skills its texts name (the title’s first, the most named), the title’s core term, at most 20', () => {
    expect(suggestKeySkills(MARKETING)).toEqual(['Marketing']);
    expect(
      suggestKeySkills({
        title: 'Video Editor',
        requirements: '<ul><li>Premiere Pro and After Effects</li><li>DaVinci Resolve a plus</li></ul>',
        responsibilities: '<p>Edit in Premiere Pro; grade in DaVinci; motion graphics in After Effects</p>',
      }),
    ).toEqual(['Video editing', 'Premiere Pro', 'After Effects', 'DaVinci Resolve', 'Motion graphics']);
    expect(suggestKeySkills({ title: 'SEO Specialist', requirements: '<p>SEO, Google Analytics, Google Ads, Google Analytics</p>' })).toEqual(['SEO', 'Google Analytics', 'Google Ads']);
    expect(suggestKeySkills({ title: 'Content Writer', requirements: '<p>Content writing and copywriting</p>' })).toEqual(['Content writing', 'Copywriting']);
    expect(titleCoreTerm('Senior Graphic Designer')).toBe('Graphic design');
    expect(titleCoreTerm('Head of Content')).toBe('Content');
    expect(titleCoreTerm('Manager')).toBeNull();
    expect(suggestKeySkills({ title: 'Video Editor', requirements: '<p>Premiere Pro</p>' }, 1)).toEqual(['Video editing']);
  });
});

describe('other open positions', () => {
  const pos = (title: string, percent: number) => ({ vacancy: { id: title, number: 'VAC-2026-0001', title }, percent });

  it('the badge: the best at 60% or more and 10 points above this application’s fit', () => {
    expect(betterFitOf(70, [pos('Media Buyer', 82), pos('Copywriter', 90)])).toMatchObject({ vacancy: { title: 'Copywriter' } });
    expect(betterFitOf(75, [pos('Media Buyer', 82)])).toBeNull();
    expect(betterFitOf(null, [pos('Media Buyer', 59)])).toBeNull();
    expect(betterFitOf(null, [pos('Media Buyer', 60)])).toMatchObject({ percent: 60 });
    expect(betterFitOf(50, [pos('Media Buyer', 60)])).toMatchObject({ percent: 60 });
    expect(betterFitOf(51, [pos('Media Buyer', 60)])).toBeNull();
    expect(betterFitText(pos('Media Buyer', 82))).toBe('Better fit: Media Buyer 82%');
    expect(betterFitTitle({ others: [pos('Media Buyer', 82), pos('Copywriter', 64)] })).toBe('Media Buyer 82% · Copywriter 64%');
  });

  it('the section: the top 3 at 50% or more, the best first', () => {
    const shown = openPositionsShown([pos('A', 49), pos('B', 50), pos('C', 90), pos('D', 70), pos('E', 65)]);
    expect(shown.map((p) => p.vacancy.title)).toEqual(['C', 'D', 'E']);
    expect(openPositionsShown([pos('A', 49)])).toEqual([]);
  });

  it('kept for the CVs Suggested From Earlier CVs could suggest, at 50% or more, the same fit the suggestion ranks by', () => {
    const job = prepareFitJob(MARKETING);
    const person = (id: string, over: Partial<SuggestionPerson> = {}): SuggestionPerson => ({ candidateId: id, merged: false, employee: null, verdict: null, cLevelApplicant: false, inProcess: false, ...over });
    const record = (id: string, candidateId: string, text: string, over: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
      kind: 'general_cv',
      id,
      candidateId,
      at: NOW,
      status: 'new',
      verdict: null,
      departmentId: null,
      topDepartmentId: null,
      yearsTyped: null,
      cvMonths: null,
      cvLatestTitle: null,
      skillsFound: null,
      fitFor: (j) => cvFitOf(j, prepareFitCv({ text, facts: cvFacts(text, NOW) })),
      ...over,
    });
    const people = new Map([
      ['c1', person('c1')],
      ['c2', person('c2')],
      ['c3', person('c3', { inProcess: true })],
    ]);
    const records = [record('g1', 'c1', CV), record('g2', 'c2', 'Skills: knitting'), record('g3', 'c3', CV), record('g4', 'c1', CV, { status: 'archived' })];
    const found = openFitsFor({ id: 'v1', fitJob: job }, people, records, { now: NOW, appliedHere: () => false });
    expect(found.map((f) => f.record.id)).toEqual(['g1']);
    expect(found[0].fit.percent).toBeGreaterThanOrEqual(50);
    // applied there already: none
    expect(openFitsFor({ id: 'v1', fitJob: job }, people, records, { now: NOW, appliedHere: (c) => c === 'c1' })).toEqual([]);
    // the suggestion ranks by the same fit: the area, 65 × the fit, recency
    const v: SuggestionVacancy = { id: 'v1', title: 'Marketing Manager', departmentId: 'd1', topDepartmentId: 'd1', ofTeam: false, keySkills: MARKETING.keySkills, minYears: null, fitJob: job };
    const s = scoreSuggestion(v, { ...records[0], departmentId: 'd1', topDepartmentId: 'd1' }, NOW);
    expect(s.reasons.map((r) => r.kind)).toEqual(['area', 'fit', 'recency']);
    const fitReason = s.reasons.find((r) => r.kind === 'fit');
    expect(fitReason).toMatchObject({ percent: found[0].fit.percent, points: Math.round((65 * found[0].fit.percent) / 100) });
    expect(s.score).toBe(Math.min(100, 30 + Math.round((65 * found[0].fit.percent) / 100) + 5));
  });
});
