import {
  KPI_ATTENDANCE_PILLAR,
  KPI_LIBRARY,
  KPI_LIBRARY_KIND_KEYWORDS,
  KPI_LIBRARY_KINDS,
  KPI_LIBRARY_LEADERSHIP_METRIC,
  KPI_LIBRARY_UNIVERSAL,
  KPI_PILLARS,
  KPI_TEMPLATE_LIMITS,
  kpiLeadershipWord,
  kpiLibraryDraft,
  kpiLibraryMatchOf,
  kpiLibraryRoles,
  kpiLibraryTemplate,
  kpiLibraryTitleOf,
  kpiMatchText,
  kpiSample,
  kpiTemplateProblems,
  linkJdDuty,
  matchLibraryTemplate,
  topCriterionPoints,
} from '@trendlix/shared';

// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"; packages/shared
// kpi-library.ts): every template passes the rules a published version must, in the framework's four pillars with the
// automatic Attendance metric; a job title is matched by its title, then its department, then the universal template, in
// English and Arabic; a title that leads people gets "Team delivery and development"; each metric is linked to the JD duty
// row it measures by the words they share. Invented titles and duties.

const WEIGHTS = { 1: 30, 2: 25, 3: 25, 4: 20 };

describe('the role library', () => {
  it('has the agency’s roles, a general template for each kind of department and a universal one', () => {
    const roles = KPI_LIBRARY.filter((t) => !t.general);
    expect(roles.map((t) => t.key)).toEqual([
      'frontend-developer',
      'backend-developer',
      'fullstack-developer',
      'mobile-developer',
      'qa-tester',
      'devops-it',
      'data-analyst',
      'ui-ux-designer',
      'graphic-designer',
      'motion-graphics',
      'video-producer-editor',
      'photographer-videographer',
      'content-writer',
      'creative-director',
      'social-media',
      'performance-marketer',
      'seo-specialist',
      'account-manager',
      'sales-bd',
      'project-manager',
      'office-admin',
      'hr-specialist',
      'accountant',
    ]);
    const generals = KPI_LIBRARY.filter((t) => t.general);
    expect(generals.map((t) => [t.key, t.kind])).toEqual([
      ['general-development', 'development'],
      ['general-creative', 'creative'],
      ['general-marketing', 'marketing'],
      ['general-operations', 'operations'],
      ['general-hr', 'hr'],
      ['general-finance', 'finance'],
      [KPI_LIBRARY_UNIVERSAL, 'general'],
    ]);
    expect(new Set(KPI_LIBRARY.map((t) => t.key)).size).toBe(KPI_LIBRARY.length);
    expect(new Set(KPI_LIBRARY.map((t) => t.name)).size).toBe(KPI_LIBRARY.length);
    for (const t of KPI_LIBRARY) expect(KPI_LIBRARY_KINDS).toContain(t.kind);
    for (const t of roles) expect(t.keywords.length).toBeGreaterThan(3);
    for (const t of generals) expect(t.keywords).toEqual([]);
    expect(kpiLibraryRoles()).toEqual(KPI_LIBRARY.map((t) => ({ key: t.key, name: t.name, kind: t.kind })));
    expect(kpiLibraryTemplate('frontend-developer')!.name).toBe('Frontend Developer');
    expect(kpiLibraryTemplate('no-such-role')).toBeNull();
  });

  it('every template, with or without the leadership metric, passes every rule a published version must', () => {
    for (const t of KPI_LIBRARY) {
      for (const title of ['Specialist', 'Head of the Team']) {
        const drafted = kpiLibraryDraft(t.key, { title, duties: [] })!;
        expect({ key: t.key, title, problems: kpiTemplateProblems(drafted.content, { publishing: true }) }).toEqual({ key: t.key, title, problems: [] });
        expect(drafted.content.metrics.length).toBeGreaterThanOrEqual(6);
        expect(drafted.content.metrics.length).toBeLessThanOrEqual(9);
      }
    }
  });

  it('follows the framework: metrics in all four pillars, in their order, the fixed weights, Attendance worth 20 to 25', () => {
    expect(KPI_PILLARS.map((p) => p.weight)).toEqual(Object.values(WEIGHTS));
    for (const t of KPI_LIBRARY) {
      const pillars = t.metrics.map((m) => m.pillar);
      expect([...pillars].sort((a, b) => a - b)).toEqual(pillars);
      for (const p of KPI_PILLARS) expect({ key: t.key, pillar: p.id, has: pillars.includes(p.id) }).toEqual({ key: t.key, pillar: p.id, has: true });
      // Discipline & Growth has the automatic Attendance metric, as the samples, besides its own
      expect(t.attendancePoints).toBeGreaterThanOrEqual(20);
      expect(t.attendancePoints).toBeLessThanOrEqual(25);
      expect(t.metrics.some((m) => m.pillar === KPI_ATTENDANCE_PILLAR && m.name === 'Development plan')).toBe(true);
      expect(t.metrics.length).toBeGreaterThanOrEqual(6);
      expect(t.metrics.length).toBeLessThanOrEqual(8); // room for the leadership metric
    }
  });

  it('writes each metric fully: a definition, how it’s measured, the duty it measures, 2 to 6 criteria, its target its "100%" criterion', () => {
    for (const t of KPI_LIBRARY) {
      for (const m of t.metrics) {
        const which = `${t.key}: ${m.name}`;
        expect({ which, definition: !!m.definition, howMeasured: !!m.howMeasured, duty: !!m.jdDuty }).toEqual({ which, definition: true, howMeasured: true, duty: true });
        expect(m.criteria.length).toBeGreaterThanOrEqual(KPI_TEMPLATE_LIMITS.criteriaMin);
        expect(m.criteria.length).toBeLessThanOrEqual(KPI_TEMPLATE_LIMITS.criteriaMax);
        // the target is one of its criteria (the one that is 100%); only a stretch criterion is worth more
        expect({ which, isACriterion: m.criteria.some((c) => c.points === m.targetPoints) }).toEqual({ which, isACriterion: true });
        expect(topCriterionPoints(m)).toBeGreaterThanOrEqual(m.targetPoints);
        // best first, as the samples list them (a stretch criterion before the target)
        const points = m.criteria.map((c) => c.points);
        expect({ which, points }).toEqual({ which, points: [...points].sort((a, b) => b - a) });
      }
    }
    // results against a target may go beyond it: 110%+ is worth 38 of a 35-point target
    const results = kpiLibraryTemplate('performance-marketer')!.metrics.find((m) => m.name === 'Results vs target')!;
    expect(results).toMatchObject({ targetPoints: 35, criteria: [{ label: '110%+ of target', points: 38 }, { points: 35 }, { points: 25 }, { points: 10 }] });
  });

  it('keeps the samples’ own metrics for the HR specialist and the video producer', () => {
    expect(kpiLibraryTemplate('hr-specialist')!.metrics).toEqual(kpiSample('HR-SP v3')!.metrics);
    const video = kpiLibraryTemplate('video-producer-editor')!.metrics.map((m) => m.name);
    for (const name of ['Deliverables on schedule', 'Revision rounds', 'Technical & brand QC', 'Client satisfaction', 'Crew coordination', 'Development plan']) expect(video).toContain(name);
  });
});

describe('matching a job title to the library', () => {
  const cases: [title: string, department: string | null, key: string, by: 'title' | 'department' | 'none'][] = [
    // English titles: the role in the title, the longest word winning
    ['Senior Frontend Developer', 'Web Development', 'frontend-developer', 'title'],
    ['Front-End Developer', null, 'frontend-developer', 'title'],
    ['WordPress Developer', null, 'frontend-developer', 'title'],
    ['Backend Developer (Node.js)', null, 'backend-developer', 'title'],
    ['Laravel Developer', null, 'backend-developer', 'title'],
    ['Full-Stack Developer', null, 'fullstack-developer', 'title'],
    ['Software Engineer', null, 'fullstack-developer', 'title'],
    ['Web Developer', null, 'fullstack-developer', 'title'],
    ['Flutter Developer', null, 'mobile-developer', 'title'],
    ['React Native Developer', null, 'mobile-developer', 'title'],
    ['iOS Developer', null, 'mobile-developer', 'title'],
    ['QA Engineer', null, 'qa-tester', 'title'],
    ['Software Tester', null, 'qa-tester', 'title'],
    ['DevOps Engineer', null, 'devops-it', 'title'],
    ['IT Support Specialist', null, 'devops-it', 'title'],
    ['System Administrator', null, 'devops-it', 'title'],
    ['Network Administrator', null, 'devops-it', 'title'],
    ['UI/UX Designer', null, 'ui-ux-designer', 'title'],
    ['Product Designer', null, 'ui-ux-designer', 'title'],
    ['Junior Graphic Designer', 'Creative', 'graphic-designer', 'title'],
    ['Social Media Designer', null, 'graphic-designer', 'title'],
    ['Motion Graphics Designer', null, 'motion-graphics', 'title'],
    ['3D Artist', null, 'motion-graphics', 'title'],
    ['Video Editor', 'Media Production', 'video-producer-editor', 'title'],
    ['Video Producer', 'Media Production', 'video-producer-editor', 'title'],
    ['Photographer', null, 'photographer-videographer', 'title'],
    ['Videographer', null, 'photographer-videographer', 'title'],
    ['Copywriter', null, 'content-writer', 'title'],
    ['Content Editor', null, 'content-writer', 'title'],
    ['Content Moderator', null, 'social-media', 'title'],
    ['Social Media Specialist', null, 'social-media', 'title'],
    ['Community Manager', null, 'social-media', 'title'],
    ['Media Buyer', null, 'performance-marketer', 'title'],
    ['Digital Marketing Specialist', null, 'performance-marketer', 'title'],
    ['SEO Specialist', null, 'seo-specialist', 'title'],
    ['Senior Account Manager', null, 'account-manager', 'title'],
    ['Client Success Manager', null, 'account-manager', 'title'],
    ['Project Manager', null, 'project-manager', 'title'],
    ['Scrum Master', null, 'project-manager', 'title'],
    ['Digital Producer', null, 'project-manager', 'title'],
    ['Sales Executive', null, 'sales-bd', 'title'],
    ['Business Development Manager', null, 'sales-bd', 'title'],
    ['HR Specialist', 'Operations & HR', 'hr-specialist', 'title'],
    ['Recruiter', null, 'hr-specialist', 'title'],
    ['Social Insurance Specialist', null, 'hr-specialist', 'title'],
    ['Accountant', 'Finance', 'accountant', 'title'],
    ['Payroll Accountant', null, 'accountant', 'title'],
    ['Receptionist', null, 'office-admin', 'title'],
    ['Office Boy', null, 'office-admin', 'title'],
    ['Executive Assistant', null, 'office-admin', 'title'],
    ['Art Director', null, 'creative-director', 'title'],
    ['Head of Design', null, 'creative-director', 'title'],
    ['Data Analyst', null, 'data-analyst', 'title'],
    ['Database Administrator', null, 'devops-it', 'title'],
    // a kind's words in the title: its general template
    ['Senior Developer', 'Web Development', 'general-development', 'title'],
    ['Developer', 'Video Production', 'general-development', 'title'],
    ['Designer', null, 'general-creative', 'title'],
    ['Marketing Manager', 'Marketing', 'general-marketing', 'title'],
    ['Operations Manager', null, 'general-operations', 'title'],
    ['Driver', null, 'general-operations', 'title'],
    ['HR Manager', 'Human Resources', 'general-hr', 'title'],
    ['Finance Manager', null, 'general-finance', 'title'],
    // the department, when the title names no role
    ['Developer', 'Frontend Web Development', 'frontend-developer', 'department'],
    ['Team Lead', 'Backend', 'backend-developer', 'department'],
    ['Specialist', 'Social Media', 'social-media', 'department'],
    ['Coordinator', 'Human Resources', 'general-hr', 'department'],
    ['Officer', 'Finance', 'general-finance', 'department'],
    // nothing: the universal template
    ['CEO', null, KPI_LIBRARY_UNIVERSAL, 'none'],
    ['Trainee', 'Misc', KPI_LIBRARY_UNIVERSAL, 'none'],
    ['', null, KPI_LIBRARY_UNIVERSAL, 'none'],
    // Arabic titles and departments
    ['مصمم جرافيك', null, 'graphic-designer', 'title'],
    ['مطور واجهات أمامية', null, 'frontend-developer', 'title'],
    ['مهندس برمجيات', null, 'fullstack-developer', 'title'],
    ['مطور تطبيقات موبايل', null, 'mobile-developer', 'title'],
    ['مختبر برمجيات', null, 'qa-tester', 'title'],
    ['فني الدعم الفني', null, 'devops-it', 'title'],
    ['محاسب', null, 'accountant', 'title'],
    ['المحاسب الأول', null, 'accountant', 'title'],
    ['مدير حسابات', null, 'accountant', 'title'],
    ['مدير حساب العميل', null, 'account-manager', 'title'],
    ['مدير مشروع', null, 'project-manager', 'title'],
    ['مصور فوتوغرافي', null, 'photographer-videographer', 'title'],
    ['مونتير', null, 'video-producer-editor', 'title'],
    ['كاتب محتوى', null, 'content-writer', 'title'],
    ['مسؤول سوشيال ميديا', null, 'social-media', 'title'],
    ['ميديا باير', null, 'performance-marketer', 'title'],
    ['أخصائي تحسين محركات البحث', null, 'seo-specialist', 'title'],
    ['مندوب مبيعات', null, 'sales-bd', 'title'],
    ['موظف استقبال', null, 'office-admin', 'title'],
    ['أخصائي موارد بشرية', null, 'hr-specialist', 'title'],
    ['محلل بيانات', null, 'data-analyst', 'title'],
    ['مدير إبداعي', null, 'creative-director', 'title'],
    ['رئيس قسم الموارد البشرية', null, 'general-hr', 'title'],
    ['المدير المالي', null, 'general-finance', 'title'],
    ['مصمم', 'قسم التصميم', 'general-creative', 'title'],
    ['موظف', 'الحسابات', 'general-finance', 'department'],
    ['موظف', 'التسويق', 'general-marketing', 'department'],
    ['موظف', null, KPI_LIBRARY_UNIVERSAL, 'none'],
  ];

  it.each(cases)('%s (%s) → %s, by the %s', (title, department, key, by) => {
    expect(matchLibraryTemplate(title, department)).toMatchObject({ key, by });
  });

  it('says why, with the word that matched', () => {
    expect(matchLibraryTemplate('Senior Frontend Developer', 'Web Development')).toEqual({
      key: 'frontend-developer',
      name: 'Frontend Developer',
      by: 'title',
      keyword: 'frontend developer',
      reason: 'The job title says “frontend developer”.',
    });
    expect(matchLibraryTemplate('Developer', 'Frontend').reason).toBe('The department says “frontend”.');
    expect(matchLibraryTemplate('Marketing Executive', null).reason).toBe('No role matched; the job title says “marketing”: a marketing, sales or client role.');
    expect(matchLibraryTemplate('Coordinator', 'Human Resources').reason).toBe('No role matched; the department says “human resources”: an HR role.');
    expect(matchLibraryTemplate('CEO', null)).toMatchObject({ keyword: null, reason: 'Nothing in the job title or department matched, so the universal template.' });
    expect(matchLibraryTemplate('مونتير', null).reason).toBe('The job title says “مونتير”.');
  });

  it('reads both titles and the department a team is in', () => {
    expect(kpiLibraryTitleOf({ titleEn: 'Editor', titleAr: 'مونتير' })).toBe('Editor مونتير');
    expect(kpiLibraryTitleOf({ titleEn: 'Editor', titleAr: '  ' })).toBe('Editor');
    // the English title names no role; its Arabic one does
    expect(kpiLibraryMatchOf({ titleEn: 'Specialist', titleAr: 'محاسب' }).key).toBe('accountant');
    // a team's department: "Developer" in the Mobile team of Web Development
    expect(kpiLibraryMatchOf({ titleEn: 'Developer', department: { nameEn: 'Mobile', parentName: 'Web Development' } })).toMatchObject({ key: 'mobile-developer', by: 'department' });
    expect(kpiLibraryMatchOf({ titleEn: 'Officer', department: null }).key).toBe(KPI_LIBRARY_UNIVERSAL);
  });

  it('compares words, not parts of them, plural or not; Arabic letters written one way', () => {
    expect(kpiMatchText('  UI/UX  Designer & Front-End ')).toBe('ui ux designer and front end');
    expect(kpiMatchText('مُصَمِّمة إعلانات آلية')).toBe('مصممه اعلانات اليه');
    // "java" is not in "javascript"; "project" is in "projects"
    expect(matchLibraryTemplate('JavaScript Developer', null).key).toBe('frontend-developer');
    expect(matchLibraryTemplate('Projects Coordinator', null).key).toBe('project-manager');
    // "مالي" starts a word in "المالية", not in "إجمالي"
    expect(matchLibraryTemplate('موظف', 'الإدارة المالية').key).toBe('general-finance');
    expect(matchLibraryTemplate('مسؤول إجمالي', null).key).toBe(KPI_LIBRARY_UNIVERSAL);
  });

  it('gives each kind words of its own, and each role words its general template doesn’t have', () => {
    for (const t of KPI_LIBRARY.filter((x) => !x.general && x.kind !== 'general')) {
      const kindWords = new Set(KPI_LIBRARY_KIND_KEYWORDS[t.kind as keyof typeof KPI_LIBRARY_KIND_KEYWORDS].map(kpiMatchText));
      for (const k of t.keywords) expect({ role: t.key, keyword: k, alsoAKindWord: kindWords.has(kpiMatchText(k)) }).toEqual({ role: t.key, keyword: k, alsoAKindWord: false });
    }
  });
});

describe('titles that lead people', () => {
  it.each([
    ['Head of Web Development', 'head'],
    ['Frontend Team Lead', 'lead'],
    ['Team Leader', 'leader'],
    ['HR Manager', 'manager'],
    ['Creative Director', 'director'],
    ['Production Supervisor', 'supervisor'],
    ['Chief Financial Officer', 'chief'],
    ['Head of Account Management', 'head'],
    ['Account Director', 'director'],
    ['رئيس قسم التصميم', 'رئيس'],
    ['مدير التسويق', 'مدير'],
    ['مدير حسابات', 'مدير'],
    ['مشرف الإنتاج', 'مشرف'],
    ['قائد فريق', 'قائد'],
  ])('%s leads people (%s)', (title, word) => {
    expect(kpiLeadershipWord(title)).toBe(word);
  });

  it.each(['Frontend Developer', 'Account Manager', 'Senior Project Manager', 'Community Manager', 'Product Manager', 'Client Success Manager', 'Lead Generation Specialist', 'Headset Tester', 'مدير حساب', 'مدير مشروع', 'محاسب'])(
    '%s does not',
    (title) => {
      expect(kpiLeadershipWord(title)).toBeNull();
    },
  );

  it('adds "Team delivery and development" at the end of Clients & Teamwork, once', () => {
    const lead = kpiLibraryDraft('frontend-developer', { title: 'Frontend Team Lead' })!;
    const plain = kpiLibraryDraft('frontend-developer', { title: 'Frontend Developer' })!;
    expect(lead.leadership).toBe('lead');
    expect(plain.leadership).toBeNull();
    expect(lead.content.metrics).toHaveLength(plain.content.metrics.length + 1);
    const names = lead.content.metrics.map((m) => m.name);
    const at = names.indexOf(KPI_LIBRARY_LEADERSHIP_METRIC.name);
    expect(lead.content.metrics[at]).toMatchObject({ pillar: 3, targetPoints: 30 });
    expect(lead.content.metrics[at - 1].pillar).toBe(3);
    expect(lead.content.metrics[at + 1].pillar).toBe(4);
    expect(names.filter((n) => n === KPI_LIBRARY_LEADERSHIP_METRIC.name)).toHaveLength(1);
    expect(plain.content.metrics.map((m) => m.name)).not.toContain(KPI_LIBRARY_LEADERSHIP_METRIC.name);
  });
});

describe('linking metrics to the JD’s duties', () => {
  const metric = { name: 'Sprint tasks delivered on time', definition: 'Share of assigned sprint tasks closed by their due date', jdDuty: 'Deliver sprint tasks on time with accurate estimates' };
  const duties = [
    'Develop responsive web pages from Figma designs',
    'Deliver assigned sprint tasks on time',
    'Fix bugs reported by QA before release',
    'Attend client calls and update the project manager',
  ];

  it('links the duty row sharing the most meaningful words, by their stems', () => {
    expect(linkJdDuty(metric, duties)).toBe('Deliver assigned sprint tasks on time');
    expect(linkJdDuty({ name: 'Reopened bugs after QA', definition: 'Tickets sent back after being marked done', jdDuty: 'Fix bugs before release and keep reopened bugs low' }, duties)).toBe('Fix bugs reported by QA before release');
    // "delivered", "delivery" and "deliver" are one word to it
    expect(linkJdDuty({ name: 'Delivery of reports', definition: null, jdDuty: null }, ['Delivering the monthly reports', 'Answering the phone'])).toBe('Delivering the monthly reports');
  });

  it('leaves it empty when no row is close enough: one shared word, or too small a share of a long row', () => {
    expect(linkJdDuty(metric, ['Keep the office tidy', 'Plan the sprint'])).toBeNull();
    expect(linkJdDuty({ name: 'Tasks on time', definition: null, jdDuty: null }, ['Coordinate across marketing, design, video, content and accounts to plan every campaign, task and launch in time'])).toBeNull();
    expect(linkJdDuty(metric, [])).toBeNull();
    // words like "the", "and", "ensure", "monthly" don't count
    expect(linkJdDuty({ name: 'The monthly work', definition: 'Ensure the work and the duties', jdDuty: null }, ['Ensure the monthly work and duties are done'])).toBeNull();
    // Arabic duties are compared too, but an English metric shares nothing with them
    expect(linkJdDuty(metric, ['تسليم مهام السبرنت في موعدها'])).toBeNull();
  });

  it('breaks a tie by the share of the row’s words, then takes the first', () => {
    const m = { name: 'Client feedback', definition: 'Rating from the client', jdDuty: null };
    expect(linkJdDuty(m, ['Collect client feedback after every campaign and share it with the team', 'Client feedback'])).toBe('Client feedback');
    expect(linkJdDuty(m, ['Client feedback forms', 'Forms for client feedback'])).toBe('Client feedback forms');
  });

  it('cuts a row longer than a metric’s JD duty may be', () => {
    const long = `Deliver assigned sprint tasks on time ${'and keep everyone informed of progress '.repeat(10)}`.trim();
    const linked = linkJdDuty(metric, [long])!;
    expect(linked.length).toBeLessThanOrEqual(KPI_TEMPLATE_LIMITS.duty);
    expect(linked.length).toBeGreaterThan(KPI_TEMPLATE_LIMITS.duty - 10);
    expect(linked.endsWith('…')).toBe(true);
    expect(long.startsWith(linked.slice(0, -1))).toBe(true);
  });

  it('a draft keeps the rows linked, the others empty, never the library’s own words; the library is left as it is', () => {
    const drafted = kpiLibraryDraft('frontend-developer', { title: 'Frontend Developer', duties })!;
    const linked = Object.fromEntries(drafted.content.metrics.map((m) => [m.name, m.jdDuty]));
    expect(linked['Sprint tasks delivered on time']).toBe('Deliver assigned sprint tasks on time');
    expect(linked['Reopened bugs after QA']).toBe('Fix bugs reported by QA before release');
    expect(linked['PM / client feedback']).toBe('Attend client calls and update the project manager');
    expect(linked['Development plan']).toBeNull();
    for (const duty of Object.values(linked)) if (duty !== null) expect(duties).toContain(duty);
    expect(kpiLibraryDraft('frontend-developer', { title: 'Frontend Developer' })!.content.metrics.every((m) => m.jdDuty === null)).toBe(true);
    drafted.content.metrics[0].criteria[0].points = 1;
    expect(kpiLibraryTemplate('frontend-developer')!.metrics[0].criteria[0].points).toBe(35);
    expect(kpiLibraryDraft('no-such-role', { title: 'X' })).toBeNull();
  });
});
