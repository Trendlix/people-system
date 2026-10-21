// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"). The job
// titles live on the live system, so the library is a feature HR runs there: ready KPI templates for the roles of a
// digital and creative agency like TrendLIX (developers, designers, video, content, marketing, accounts, projects,
// sales, HR, finance, the office), one general template for each kind of department, and a universal one. Each follows
// the framework of kpis.ts as the three samples do (kpi-framework.json): metrics in the four pillars with their fixed
// weights (Delivery & Timeliness 30, Quality of Work 25, Clients & Teamwork 25, Discipline & Growth 20), each with its
// definition, how it's measured, the kind of JD duty it measures and a criteria scale whose "100%" criterion is its
// target; Discipline & Growth also has the automatic Attendance metric (20 or 25 points, as the samples).
// - "Draft templates for every job title": each job title with no template yet gets a draft from the role that matches
//   it (matchLibraryTemplate: its title, then its department, then the universal template), never published by itself.
// - A title that leads people (Head, Lead, Manager, Director, Supervisor; Chief too) also gets "Team delivery and
//   development" in Clients & Teamwork.
// - Each metric is linked to the job title's JD duty row it measures, by the words they share (linkJdDuty), else left
//   for HR to link.
// Pure code, tested in apps/api/src/common/kpi-library.spec.ts.

import { KPI_TEMPLATE_LIMITS, kpiSample, topCriterionPoints, type KpiMetric, type KpiPillarId, type KpiTemplateContent } from './kpis.js';

// ---------- the kinds of role ----------

/** The kinds of department a role belongs to; `general`: the universal template's, for any department. */
export const KPI_LIBRARY_KINDS = ['development', 'creative', 'marketing', 'operations', 'hr', 'finance', 'general'] as const;
export type KpiLibraryKind = (typeof KPI_LIBRARY_KINDS)[number];

/** The kinds as the role picker groups them (sentence case: they are labels). */
export const KPI_LIBRARY_KIND_LABELS: Record<KpiLibraryKind, string> = {
  development: 'Development and IT',
  creative: 'Creative and production',
  marketing: 'Marketing, sales and clients',
  operations: 'Operations and projects',
  hr: 'HR',
  finance: 'Finance',
  general: 'Any department',
};

/** A template of the library: a role's, a kind's general one, or the universal one. */
export interface KpiLibraryTemplate {
  /** Its key, kept on the drafts made from it (e.g. "frontend-developer"). */
  key: string;
  /** Its name, as a job title is written (e.g. "Frontend Developer"). */
  name: string;
  kind: KpiLibraryKind;
  /** A fallback: its kind's general template, or the universal one, used when no role matches. */
  general: boolean;
  /**
   * Words in a job title (or a department) that point to it, in English and Arabic. The general templates have none:
   * their kind's words (KPI_LIBRARY_KIND_KEYWORDS) point to them.
   */
  keywords: readonly string[];
  attendancePoints: number;
  /**
   * Its metrics, in pillar order. Each `jdDuty` is the kind of duty it measures, read only to link it to the job
   * title's own duty rows (a draft never keeps it as it is).
   */
  metrics: readonly KpiMetric[];
}

/** GET /kpis/templates/library: a role of the library, for the picker. */
export interface KpiLibraryRole {
  key: string;
  name: string;
  kind: KpiLibraryKind;
}

// ---------- the metrics ----------

type Scale = readonly (readonly [label: string, points: number])[];

/** A library metric: its target the points of its "100%" criterion, `target` (when a better one is a stretch), else its best. */
function metric(pillar: KpiPillarId, name: string, definition: string, howMeasured: string, duty: string, scale: Scale, target?: number): KpiMetric {
  const criteria = scale.map(([label, points]) => ({ label, points }));
  return { pillar, name, definition, howMeasured, jdDuty: duty, targetPoints: target ?? topCriterionPoints({ criteria }), criteria };
}

// the scales several roles share, as the samples write them
const ON_TIME_RATE: Scale = [['95–100%', 35], ['85–94%', 25], ['Below 85%', 10]];
const ALL_ON_TIME: Scale = [['All on time', 35], ['1 late', 25], ['2+ late', 10]];
const RATING_30: Scale = [['4.5 – 5', 30], ['4.0 – 4.4', 20], ['Below 4', 10]];
const TEAMWORK_20: Scale = [['Smooth', 20], ['Minor issues', 12], ['Escalations', 5]];
const REVISIONS_35: Scale = [['≤ 1 round', 35], ['2 rounds', 25], ['3+ rounds', 10]];
const QC_25: Scale = [['0 issues', 25], ['1 issue', 15], ['2+ issues', 5]];
const ESTIMATES_25: Scale = [['Within 10%', 25], ['10–25% off', 15], ['Over 25% off', 5]];
const OUTPUT_25: Scale = [['100%+', 25], ['85–99%', 15], ['Below 85%', 5]];
const CURRENT_20: Scale = [['Always current', 20], ['Minor gaps', 12], ['Out of date', 5]];
const ORGANISED_20: Scale = [['Organised', 20], ['Minor gaps', 12], ['Missing or messy', 5]];
const BUDGET_20: Scale = [['Within budget', 20], ['Up to 10% over', 12], ['Over 10% over', 5]];
/** Results against a target: beating it by 10% is worth more than the target (35), up to the final cap. */
const STRETCH_35: Scale = [['110%+ of target', 38], ['100–109% of target', 35], ['85–99% of target', 25], ['Below 85%', 10]];

/** The samples' development plan: courses completed from the agreed plan (kpi-framework.json). */
const DEVELOPMENT_PLAN = metric(
  4,
  'Development plan',
  'Courses completed from the agreed plan',
  'Certificates uploaded to Documents',
  'Keep skills up to date through courses and training',
  [['2 courses', 25], ['1 course', 20], ['None', 0]],
);

const SPRINT_ON_TIME = (duty: string) =>
  metric(1, 'Sprint tasks delivered on time', 'Share of assigned sprint tasks closed by their due date', '(Tasks on time ÷ tasks due) × 100, from the project board; client-blocked tasks excluded', duty, ON_TIME_RATE);
const ESTIMATE_ACCURACY = (duty: string) => metric(1, 'Estimate accuracy', 'How close actual hours are to the estimate', 'Actual ÷ estimated hours per task, monthly average', duty, ESTIMATES_25);
const REOPENED_BUGS = (scale: Scale) => metric(2, 'Reopened bugs after QA', 'Tickets sent back after being marked done', 'Count of reopened tickets in the month', 'Fix bugs before release and keep reopened bugs low', scale);
const PM_FEEDBACK = (duty: string) => metric(3, 'PM / client feedback', 'Rating from the PM, and the client where relevant', 'Monthly 1–5 rating form', duty, RATING_30);
const CLIENT_SATISFACTION = (duty: string) => metric(3, 'Client satisfaction', 'Client rating after each delivery', 'Satisfaction survey 1–5', duty, RATING_30);
const ACCOUNT_FEEDBACK = (duty: string) => metric(3, 'Account / client feedback', 'Rating from the account manager, and the client where relevant', 'Monthly 1–5 rating form', duty, RATING_30);
const REVISION_ROUNDS = (name: string, per: string, duty: string) => metric(2, name, `Average client revision rounds per ${per}`, 'From the project deliverables log', duty, REVISIONS_35);
const DESIGN_AND_BACKEND = (duty: string) =>
  metric(3, 'Collaboration with design & backend', 'Handoffs, API contracts and questions settled early, without rework or blockers', 'Feedback from the designer and the backend developers', duty, TEAMWORK_20);

/**
 * The metric a title that leads people gets in Clients & Teamwork (owner's brief, 21 October 2026: titles with Head,
 * Lead, Manager, Director or Supervisor, "e.g. Team delivery and development").
 */
export const KPI_LIBRARY_LEADERSHIP_METRIC: KpiMetric = metric(
  3,
  'Team delivery and development',
  'How the team the person leads delivers, and how its people grow: goals met, one-to-ones held, coaching and feedback given, the team’s scorecards scored on time',
  'The team’s on-time delivery and average KPI, one-to-ones logged, the team’s scorecards scored by the deadline',
  'Lead, coach and develop the team',
  [['On target, 1:1s held', 30], ['Mostly on target', 20], ['Off target or 1:1s missed', 10]],
);

// ---------- the library ----------

const role = (t: Omit<KpiLibraryTemplate, 'general'>): KpiLibraryTemplate => ({ ...t, general: false });
const general = (t: Omit<KpiLibraryTemplate, 'general' | 'keywords'>): KpiLibraryTemplate => ({ ...t, general: true, keywords: [] });

/** The roles, then each kind's general template, then the universal one (matching keeps this order on a tie). */
export const KPI_LIBRARY: readonly KpiLibraryTemplate[] = [
  // ----- development and IT -----
  role({
    key: 'frontend-developer',
    name: 'Frontend Developer',
    kind: 'development',
    keywords: ['frontend', 'front end', 'frontend developer', 'front end developer', 'ui developer', 'react', 'angular', 'vue', 'javascript developer', 'wordpress', 'shopify', 'webflow', 'html', 'واجهات أمامية', 'واجهة أمامية', 'فرونت', 'فرونت إند', 'ووردبريس', 'وورد بريس'],
    attendancePoints: 25,
    metrics: [
      SPRINT_ON_TIME('Deliver sprint tasks on time with accurate estimates'),
      ESTIMATE_ACCURACY('Estimate frontend tasks accurately'),
      REOPENED_BUGS([['0', 35], ['1–2', 25], ['3 or more', 10]]),
      metric(2, 'Design fidelity & responsiveness', 'Built pages match the approved design on desktop, tablet and mobile, in every supported browser', 'Designer and QA review against the Figma file; issues logged per page', 'Convert designs into responsive, pixel-accurate pages', [['No issues', 25], ['1–2 minor', 15], ['Major issues', 5]]),
      metric(2, 'Page performance & accessibility', 'Speed and accessibility of the pages delivered', 'Lighthouse performance and accessibility scores on mobile, at release', 'Build fast, accessible web interfaces', [['90+', 25], ['75–89', 15], ['Below 75', 5]]),
      PM_FEEDBACK('Update PMs and join client calls'),
      DESIGN_AND_BACKEND('Work with designers and backend developers on features'),
      DEVELOPMENT_PLAN,
    ],
  }),
  role({
    key: 'backend-developer',
    name: 'Backend Developer',
    kind: 'development',
    keywords: ['backend', 'back end', 'backend developer', 'back end developer', 'api developer', 'server side', 'node', 'nodejs', 'node js', 'laravel', 'php', 'django', 'python', 'java', 'dotnet', 'golang', 'ruby', 'database developer', 'باك إند', 'باك اند', 'الواجهة الخلفية', 'واجهات خلفية', 'قواعد البيانات'],
    attendancePoints: 25,
    metrics: [
      SPRINT_ON_TIME('Deliver backend tasks and APIs on time'),
      ESTIMATE_ACCURACY('Estimate backend tasks accurately'),
      metric(2, 'Bugs & production incidents', 'Bugs reopened after QA, and incidents in production caused by own code', 'Reopened tickets and the incident log, monthly', 'Write reliable, secure server-side code and fix bugs before release', [['None', 35], ['1–2 minor', 25], ['3+ or any major', 10]]),
      metric(2, 'API quality & test coverage', 'New and changed endpoints documented and covered by automated tests', 'Code review checklist: docs updated, tests passing, coverage on changed code', 'Build and document APIs with automated tests', [['All covered', 25], ['Mostly covered', 15], ['Little or none', 5]]),
      metric(3, 'Support to frontend & mobile', 'API changes announced ahead and blocking questions answered within a working day', 'Feedback from the frontend and mobile developers and the PM', 'Support frontend and mobile developers with APIs and integrations', [['Always', 30], ['Mostly', 20], ['Often blocked', 10]]),
      metric(3, 'Code review contribution', 'Teammates’ pull requests reviewed promptly and helpfully', 'Pull requests reviewed within 1 working day, from the repository', 'Review code and share knowledge with the team', [['Prompt and thorough', 20], ['Some delays', 12], ['Rarely reviews', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Security & data handling', 'Secrets, access and personal data handled as the security policy says', 'Code review and security checklist findings', 'Follow security and data protection practices', [['No findings', 20], ['1 minor', 12], ['Any major', 0]]),
    ],
  }),
  role({
    key: 'fullstack-developer',
    name: 'Full-Stack Developer / Software Engineer',
    kind: 'development',
    keywords: ['full stack', 'fullstack', 'full stack developer', 'software engineer', 'software developer', 'web developer', 'programmer', 'application developer', 'مطور ويب', 'مهندس برمجيات', 'مطور برمجيات', 'مبرمج', 'فول ستاك'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Features delivered on time', 'Features and tasks closed by their sprint or due date', '(Closed on time ÷ due) × 100, from the project board; client-blocked tasks excluded', 'Deliver features end to end on schedule', ON_TIME_RATE),
      ESTIMATE_ACCURACY('Estimate work accurately'),
      REOPENED_BUGS([['0', 35], ['1–2', 25], ['3 or more', 10]]),
      metric(2, 'Code review findings', 'Major issues raised during code review', 'Major findings logged by the reviewer', 'Write clean, maintainable, tested code', [['No major', 25], ['1 major', 15], ['2+ major', 5]]),
      PM_FEEDBACK('Update PMs and join client calls'),
      metric(3, 'Knowledge sharing & documentation', 'Setup notes, READMEs and handover documents kept current; help given to teammates', 'Manager judgement with examples', 'Document systems and mentor teammates', [['Regular, documented', 20], ['Some', 12], ['None', 5]]),
      DEVELOPMENT_PLAN,
    ],
  }),
  role({
    key: 'mobile-developer',
    name: 'Mobile Developer',
    kind: 'development',
    keywords: ['mobile', 'mobile developer', 'mobile app', 'ios', 'android', 'flutter', 'react native', 'swift', 'kotlin', 'app developer', 'موبايل', 'تطبيقات', 'تطبيقات الجوال', 'جوال', 'أندرويد', 'اندرويد', 'آيفون', 'فلاتر'],
    attendancePoints: 25,
    metrics: [
      SPRINT_ON_TIME('Deliver mobile app features on time'),
      metric(1, 'Store releases on schedule', 'App builds submitted to the App Store and Google Play by the planned date', 'Release plan vs submission date', 'Publish app releases to the stores', [['All on time', 25], ['1 late', 15], ['2+ late', 5]]),
      metric(2, 'Crash-free sessions', 'Share of user sessions without a crash in the released apps', 'Firebase Crashlytics, monthly', 'Build stable, high-performance mobile apps', [['99.5%+', 35], ['98–99.4%', 25], ['Below 98%', 10]]),
      REOPENED_BUGS([['0', 25], ['1–2', 15], ['3 or more', 5]]),
      metric(2, 'Store review rejections', 'Builds rejected by Apple or Google review', 'Store review history', 'Follow App Store and Google Play guidelines', [['None', 20], ['1', 10], ['2 or more', 0]]),
      PM_FEEDBACK('Update PMs and join client calls'),
      DESIGN_AND_BACKEND('Work with designers and backend developers on app features'),
      DEVELOPMENT_PLAN,
    ],
  }),
  role({
    key: 'qa-tester',
    name: 'QA Engineer / Software Tester',
    kind: 'development',
    keywords: ['qa', 'quality assurance', 'tester', 'test engineer', 'testing', 'software tester', 'test analyst', 'qa engineer', 'sdet', 'اختبار', 'اختبارات', 'مختبر', 'ضمان الجودة', 'ضمان جودة'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Test cycles completed on time', 'Planned test runs and regression cycles finished before the release date', 'Test plan vs completion dates', 'Plan and run test cycles before each release', ALL_ON_TIME),
      metric(1, 'Retest turnaround', 'Fixed bugs retested and closed or reopened quickly', 'Tracker: time from fixed to verified', 'Retest fixes and verify bugs', [['Within 1 working day', 25], ['Within 2 days', 15], ['Longer', 5]]),
      metric(2, 'Escaped defects', 'Bugs found by the client or users after release that testing should have caught', 'Production bug log, monthly', 'Catch defects before release', [['0', 35], ['1–2 minor', 25], ['Any major', 10]]),
      metric(2, 'Bug report quality', 'Reports with clear steps, expected and actual results, evidence and severity', 'Reports sent back by developers for more information', 'Log clear, reproducible bug reports', [['None sent back', 25], ['1–2 sent back', 15], ['3+ sent back', 5]]),
      metric(3, 'PM / team feedback', 'Rating from the PM and developers on testing support', 'Monthly 1–5 rating form', 'Work with developers and PMs on quality', RATING_30),
      metric(3, 'Release sign-off communication', 'A clear go / no-go and the known issues shared before each release', 'Sign-off checklist per release', 'Report test results and release readiness', [['Every release', 20], ['Most releases', 12], ['Missing', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Test automation progress', 'Regression cases automated against the agreed plan', 'Automated cases added vs the monthly goal', 'Build and maintain automated tests', [['Goal met', 20], ['Half or more', 12], ['Below half', 5]]),
    ],
  }),
  role({
    key: 'devops-it',
    name: 'DevOps / IT / System Administrator',
    kind: 'development',
    keywords: [
      'devops', 'dev ops', 'sysadmin', 'system administrator', 'systems administrator', 'system admin', 'it', 'it support', 'it specialist', 'it officer', 'it engineer', 'infrastructure', 'network', 'network engineer', 'cloud engineer', 'site reliability', 'sre', 'helpdesk', 'help desk', 'technical support', 'security engineer', 'cyber security', 'cybersecurity', 'information security', 'database administrator', 'dba', 'network administrator', 'it administrator',
      'تقنية المعلومات', 'تكنولوجيا المعلومات', 'نظم المعلومات', 'الدعم الفني', 'دعم فني', 'شبكات', 'مسؤول أنظمة', 'مدير أنظمة', 'ديف أوبس', 'أمن المعلومات',
    ],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Tickets resolved within SLA', 'IT, access and deployment requests closed within the agreed time', '(Closed within SLA ÷ total) × 100, from the ticket log', 'Resolve IT support and access requests', ON_TIME_RATE),
      metric(1, 'Planned maintenance on schedule', 'Backups, updates and renewals (domains, SSL, licences) done by their dates', 'Maintenance calendar checklist', 'Maintain servers, backups and renewals', [['All done', 25], ['1 missed', 15], ['2+ missed', 5]]),
      metric(2, 'Service uptime', 'Availability of client sites, servers and the office network', 'Monitoring tool uptime, monthly; planned windows excluded', 'Keep systems, servers and the network available', [['99.9%+', 35], ['99–99.8%', 25], ['Below 99%', 10]]),
      metric(2, 'Security & backup health', 'Backups verified, patches applied, access reviewed, no security incidents', 'Monthly security checklist and a restore test', 'Secure systems and verify backups', [['All green', 25], ['1 gap', 15], ['2+ gaps or an incident', 5]]),
      metric(3, 'Internal user satisfaction', 'How staff rate the IT support they got', 'Ticket feedback 1–5, monthly average', 'Support staff with devices, accounts and tools', RATING_30),
      metric(3, 'Environments ready for teams', 'Environments, pipelines and access ready when the teams need them', 'Feedback from team leads and PMs', 'Provide environments and deployment pipelines for development teams', [['Always ready', 20], ['Minor waits', 12], ['Blocked work', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Documentation & asset records', 'Runbooks, the credentials vault and the hardware and licence inventory kept current', 'Monthly spot check', 'Document systems and keep the IT inventory', [['Up to date', 20], ['Minor gaps', 12], ['Out of date', 5]]),
    ],
  }),
  role({
    key: 'data-analyst',
    name: 'Data Analyst',
    kind: 'development',
    keywords: ['data analyst', 'data', 'analyst', 'analytics', 'business intelligence', 'bi', 'bi developer', 'data scientist', 'reporting analyst', 'insights', 'محلل بيانات', 'تحليل البيانات', 'تحليل بيانات', 'بيانات', 'محلل'],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Reports & dashboards on time', 'Recurring reports and requested analyses delivered by the agreed date', '(On time ÷ due) × 100, from the request log', 'Prepare recurring reports and dashboards', ON_TIME_RATE),
      metric(1, 'Request turnaround', 'Ad-hoc data requests answered within the agreed time', 'Average turnaround, from the request log', 'Answer data requests from teams and clients', [['Within the agreed time', 25], ['Slightly over', 15], ['Far over', 5]]),
      metric(2, 'Data accuracy', 'Figures in reports correct and reconciled with the source', 'Errors found after delivery', 'Collect, clean and validate data', [['0 errors', 35], ['1 minor', 25], ['2+ or 1 major', 10]]),
      metric(2, 'Insight quality', 'Analyses end in clear findings and recommendations that are acted on', 'Stakeholder rating 1–5', 'Analyse data and recommend actions', [['4.5 – 5', 25], ['4.0 – 4.4', 15], ['Below 4', 5]]),
      metric(3, 'Stakeholder support', 'Requirements clarified up front; people shown how to use the dashboards', 'Feedback from the managers and clients using the reports', 'Work with stakeholders on their reporting needs', [['Excellent', 30], ['Good', 20], ['Poor', 10]]),
      metric(3, 'Documentation of data sources', 'Definitions, queries and dashboards documented so others can use them', 'Manager spot check', 'Document data sources and metrics', [['Documented', 20], ['Partly', 12], ['None', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Data governance', 'Access, privacy and data-handling rules followed', 'Access review and the incident log', 'Protect data and follow privacy rules', [['No issues', 20], ['Minor issue', 10], ['Breach', 0]]),
    ],
  }),

  // ----- creative and production -----
  role({
    key: 'ui-ux-designer',
    name: 'UI/UX Designer',
    kind: 'creative',
    keywords: ['ui', 'ux', 'ui ux', 'ux ui', 'ui ux designer', 'ux designer', 'ui designer', 'product designer', 'user experience', 'user interface', 'interaction designer', 'web designer', 'ux researcher', 'تجربة المستخدم', 'واجهة المستخدم', 'واجهات المستخدم', 'مصمم واجهات'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Designs delivered on schedule', 'Wireframes, prototypes and final screens delivered by the agreed dates', 'Delivered vs planned date per deliverable; client delays excluded', 'Deliver wireframes, prototypes and UI designs on time', ALL_ON_TIME),
      metric(1, 'Developer handoff readiness', 'Handoff files complete when development starts: specs, assets, states and responsive views', 'Developer checklist per handoff', 'Prepare design handoffs for developers', [['Complete', 25], ['Minor gaps', 15], ['Major gaps', 5]]),
      REVISION_ROUNDS('Client revision rounds', 'deliverable', 'Design to the brief first time'),
      metric(2, 'Usability & design-system consistency', 'Designs follow the design system and pass the usability checklist', 'Lead or Art Director review findings', 'Apply UX best practice and the design system', [['0 issues', 25], ['1–2 issues', 15], ['3+ issues', 5]]),
      CLIENT_SATISFACTION('Present designs to clients'),
      metric(3, 'Collaboration with developers', 'Questions answered and design QA done on the built pages', 'Developer and PM feedback', 'Support developers during build and review', TEAMWORK_20),
      DEVELOPMENT_PLAN,
    ],
  }),
  role({
    key: 'graphic-designer',
    name: 'Graphic Designer',
    kind: 'creative',
    keywords: ['graphic', 'graphic designer', 'graphic design', 'graphics designer', 'visual designer', 'social media designer', 'print designer', 'brand designer', 'illustrator', 'packaging designer', 'layout designer', 'جرافيك', 'جرافيكس', 'مصمم جرافيك', 'رسام', 'مصمم مطبوعات'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Designs delivered on schedule', 'Posts, campaign assets and print files delivered by the content-calendar date', 'Delivered vs planned date; client delays excluded', 'Deliver designs by the content-calendar dates', [['All on time', 35], ['1–2 late', 25], ['3+ late', 10]]),
      metric(1, 'Output vs plan', 'Approved designs delivered against the month’s planned volume', 'Content calendar: approved ÷ planned', 'Produce the month’s planned designs', OUTPUT_25),
      REVISION_ROUNDS('Client revision rounds', 'design', 'Design to the brief and brand first time'),
      metric(2, 'Brand & technical accuracy', 'Brand guidelines, spelling, sizes and export specs right first time', 'Art Director review, and issues found after delivery', 'Follow brand guidelines and print and digital specs', QC_25),
      ACCOUNT_FEEDBACK('Work with account managers on client requests'),
      metric(3, 'Teamwork with content & accounts', 'Briefs clarified early, feedback taken well, files shared on time', 'Feedback from copywriters and account managers', 'Collaborate with copywriters and the creative team', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'File organisation', 'Working files, fonts and exports saved in the shared drive by the naming rules', 'Monthly spot check', 'Organise and archive design files', ORGANISED_20),
    ],
  }),
  role({
    key: 'motion-graphics',
    name: 'Motion Graphics Designer / Animator',
    kind: 'creative',
    keywords: ['motion', 'motion graphics', 'motion graphic', 'motion designer', 'motion graphics designer', 'motion graphic designer', 'animator', 'animation', '2d animator', '3d', '3d artist', '3d designer', 'after effects', 'vfx', 'visual effects', 'موشن', 'موشن جرافيك', 'رسوم متحركة', 'أنيميشن', 'انيميشن', 'تحريك', 'مؤثرات بصرية', 'ثري دي'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Animations delivered on schedule', 'Animations and motion edits delivered by the agreed dates', 'Delivered vs planned date; client delays excluded', 'Deliver animations by the agreed dates', ALL_ON_TIME),
      metric(1, 'Storyboard sign-off before animation', 'Storyboard or animatic approved before full animation starts', 'Project log: approval date vs animation start', 'Prepare storyboards and animatics', [['Every project', 25], ['Most projects', 15], ['Skipped', 5]]),
      REVISION_ROUNDS('Client revision rounds', 'deliverable', 'Animate to the brief first time'),
      metric(2, 'Technical & brand QC', 'Issues found in internal QC: timing, sound sync, export specs, brand', 'Art Director review', 'Meet brand and technical standards', QC_25),
      CLIENT_SATISFACTION('Present animations to clients'),
      metric(3, 'Collaboration with design & video', 'Assets, project files and feedback exchanged smoothly with designers and editors', 'Team feedback', 'Work with designers and video editors', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'Project file hygiene', 'Project files, assets and renders archived by the naming rules', 'Monthly spot check', 'Organise and archive project files', ORGANISED_20),
    ],
  }),
  role({
    key: 'video-producer-editor',
    name: 'Video Producer / Editor',
    kind: 'creative',
    keywords: ['video', 'video producer', 'video editor', 'editor', 'producer', 'video production', 'post production', 'montage', 'colorist', 'colourist', 'film', 'filmmaker', 'video creator', 'مونتاج', 'مونتير', 'فيديو', 'منتج فيديو', 'محرر فيديو', 'مخرج', 'الإنتاج المرئي', 'إنتاج مرئي', 'منتج منفذ'],
    attendancePoints: 25,
    // the MED-VP v1 sample's metrics (kpi-framework.json), for producing and editing alike, and the footage archived
    metrics: [
      metric(1, 'Deliverables on schedule', 'Edits delivered by the content-calendar date', 'Delivered vs planned date; client delays excluded', 'Deliver edits by agreed dates', ALL_ON_TIME),
      metric(1, 'Shoot & edit preparation', 'Call sheet, shot list and gear ready 24 h before a shoot; footage, music and brief gathered before an edit', 'Checklist per shoot or edit', 'Plan and prepare shoots and edits', [['All ready', 25], ['1 miss', 15], ['2+ misses', 5]]),
      REVISION_ROUNDS('Revision rounds', 'deliverable', 'Produce and edit videos to brief first time'),
      metric(2, 'Technical & brand QC', 'Issues found in internal QC: audio, colour, brand', 'Art Director review', 'Meet brand and technical standards', QC_25),
      CLIENT_SATISFACTION('Represent TrendLIX with clients'),
      metric(3, 'Crew coordination', 'How smoothly the crew runs on set', 'Manager and crew feedback', 'Lead crew on set', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'Footage & project archiving', 'Footage, project files and exports backed up and archived within a week of delivery', 'Monthly archive check', 'Back up and archive footage and projects', [['All archived', 20], ['Some late', 12], ['Missing', 5]]),
    ],
  }),
  role({
    key: 'photographer-videographer',
    name: 'Photographer / Videographer',
    kind: 'creative',
    keywords: ['photographer', 'photography', 'videographer', 'camera', 'camera operator', 'cameraman', 'camerawoman', 'cinematographer', 'director of photography', 'dop', 'photo', 'photo editor', 'retoucher', 'مصور', 'تصوير', 'مصور فيديو', 'مصور فوتوغرافي', 'مدير تصوير', 'كاميرا'],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Shoots delivered on schedule', 'Selected and edited photos or footage delivered by the agreed date', 'Delivered vs planned date; client delays excluded', 'Deliver edited photos and footage on time', ALL_ON_TIME),
      metric(1, 'Shoot readiness', 'Gear checked, batteries charged, cards cleared and the shot list read before each shoot', 'Pre-shoot checklist', 'Prepare equipment and shot lists for shoots', [['All ready', 25], ['1 miss', 15], ['2+ misses', 5]]),
      metric(2, 'Technical quality', 'Focus, exposure, framing, sound and colour meet the standard', 'Art Director or producer review per shoot', 'Shoot high-quality photos and video', [['0 issues', 35], ['1 issue', 25], ['2+ issues', 10]]),
      metric(2, 'Shot list coverage', 'Every required shot and angle captured, with no reshoot needed', 'Shot list vs delivered selects; reshoots logged', 'Capture every shot on the shot list', [['Full coverage', 25], ['Minor gaps', 15], ['Reshoot needed', 5]]),
      CLIENT_SATISFACTION('Work with clients and talent on set'),
      metric(3, 'On-set conduct & teamwork', 'Professional with clients, talent and crew on set', 'Producer and client feedback', 'Work with the crew on set', [['Excellent', 20], ['Minor issues', 12], ['Complaints', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Equipment care', 'Gear returned clean, logged and undamaged; faults reported at once', 'Equipment log', 'Look after cameras, lenses and lighting equipment', [['No issues', 20], ['Minor issues', 12], ['Loss or damage by neglect', 0]]),
    ],
  }),
  role({
    key: 'content-writer',
    name: 'Content Writer / Copywriter',
    kind: 'creative',
    keywords: [
      'content', 'content writer', 'copywriter', 'copy writer', 'writer', 'content creator', 'content specialist', 'content editor', 'copy editor', 'content producer', 'content strategist', 'translator', 'blogger', 'scriptwriter', 'script writer', 'storyteller', 'technical writer', 'proofreader',
      'كاتب', 'كاتب محتوى', 'محتوى', 'كوبي رايتر', 'كتابة المحتوى', 'مترجم', 'ترجمة', 'صانع محتوى', 'صناعة المحتوى', 'كاتب سيناريو', 'مدقق لغوي',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Content delivered on schedule', 'Posts, articles, scripts and ad copy delivered by the content-calendar date', 'Delivered vs planned date; client delays excluded', 'Write content by the content-calendar dates', [['All on time', 35], ['1–2 late', 25], ['3+ late', 10]]),
      metric(1, 'Output vs plan', 'Approved pieces against the month’s planned volume', 'Content calendar: approved ÷ planned', 'Produce the month’s planned content', OUTPUT_25),
      REVISION_ROUNDS('Client revision rounds', 'piece', 'Write to the brief and tone of voice first time'),
      metric(2, 'Language & brand accuracy', 'Grammar, spelling (Arabic and English), tone of voice and facts right first time', 'Editor or account review, and errors found after publishing', 'Proofread copy in Arabic and English', [['0 errors', 25], ['1–2 minor', 15], ['Any published error', 5]]),
      metric(2, 'Content performance', 'Engagement or search results of the published pieces against the benchmark', 'Platform insights and analytics, monthly', 'Write engaging, search-friendly content', [['At or above benchmark', 20], ['Slightly below', 12], ['Well below', 5]]),
      ACCOUNT_FEEDBACK('Work with account managers on client briefs'),
      metric(3, 'Briefing & teamwork', 'Copy ready before design starts; questions raised early with designers and accounts', 'Feedback from designers and account managers', 'Collaborate with designers and the creative team', TEAMWORK_20),
      DEVELOPMENT_PLAN,
    ],
  }),
  role({
    key: 'creative-director',
    name: 'Creative Director / Art Director',
    kind: 'creative',
    keywords: ['creative director', 'art director', 'creative lead', 'creative head', 'head of creative', 'creative manager', 'head of design', 'design lead', 'design manager', 'associate creative director', 'مدير إبداعي', 'مدير ابداعي', 'مدير فني', 'المدير الفني', 'المدير الإبداعي', 'مخرج إبداعي'],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Campaigns & concepts on time', 'Concepts, campaigns and key visuals delivered by the agreed dates', 'Delivered vs planned date; client delays excluded', 'Lead creative concepts and campaigns to deadline', ALL_ON_TIME),
      metric(1, 'Review turnaround', 'Team work reviewed and approved or sent back within one working day', 'Review log or the project board', 'Review and approve the creative team’s work', [['Within 1 day', 25], ['Within 2 days', 15], ['Longer', 5]]),
      metric(2, 'Creative quality & brand consistency', 'Work leaving the studio is on brief, on brand and to the agency’s standard', 'Client first-time approvals and management review', 'Set and keep the creative standard and brand consistency', [['Consistently high', 35], ['Mostly', 25], ['Frequent issues', 10]]),
      metric(2, 'Studio revision rounds', 'Average client revision rounds across the studio’s deliverables', 'From the project deliverables log', 'Guide the studio to brief-right work first time', [['≤ 1 round', 25], ['2 rounds', 15], ['3+ rounds', 5]]),
      CLIENT_SATISFACTION('Present creative work to clients'),
      metric(3, 'Pitches & new ideas', 'Concepts presented in pitches and proactive ideas brought to clients', 'Pitch log and management feedback', 'Lead pitches and new creative ideas', [['2+ ideas or pitches', 20], ['1', 12], ['None', 5]]),
      DEVELOPMENT_PLAN,
    ],
  }),

  // ----- marketing, sales and clients -----
  role({
    key: 'social-media',
    name: 'Social Media Specialist / Community Manager',
    kind: 'marketing',
    keywords: [
      'social media', 'social', 'community manager', 'community', 'moderator', 'social media specialist', 'social media executive', 'social media manager', 'social media coordinator', 'influencer',
      'سوشيال ميديا', 'سوشال ميديا', 'السوشيال', 'التواصل الاجتماعي', 'مواقع التواصل', 'منصات التواصل', 'شبكات التواصل', 'إدارة المجتمع', 'كوميونيتي', 'مودريتور',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Content calendar on time', 'Monthly calendars sent for approval on time and posts published as scheduled', 'Calendar approval date, and the scheduled vs published log', 'Plan and publish the content calendar', [['All on time', 35], ['1–2 slips', 25], ['3+ slips', 10]]),
      metric(1, 'Community response time', 'Comments and messages on client pages answered within the agreed time', 'Average first response time, from the inbox tool', 'Manage and respond to the online community', [['Under 2 h', 25], ['2–6 h', 15], ['Over 6 h', 5]]),
      metric(2, 'Engagement vs target', 'Engagement on the managed accounts against the month’s target', 'Platform insights, monthly report', 'Grow engagement on client accounts', STRETCH_35, 35),
      metric(2, 'Publishing accuracy', 'Posts published with the right copy, visuals, tags and links', 'Errors found after publishing', 'Publish posts accurately on every platform', [['0 errors', 25], ['1 error', 15], ['2+ errors', 5]]),
      CLIENT_SATISFACTION('Communicate with clients on their social accounts'),
      metric(3, 'Monthly reporting', 'A clear monthly report with insights and next steps sent to the client on time', 'Report date and account manager review', 'Prepare monthly social media reports', [['On time, insightful', 20], ['Late or thin', 12], ['Missing', 0]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Escalation handling', 'Negative comments and sensitive issues escalated as the playbook says', 'Escalation log', 'Escalate complaints and sensitive issues', [['Always by the playbook', 20], ['1 slip', 10], ['Missed escalation', 0]]),
    ],
  }),
  role({
    key: 'performance-marketer',
    name: 'Digital Marketing / Media Buyer',
    kind: 'marketing',
    keywords: [
      'media buyer', 'media buying', 'performance marketing', 'performance marketer', 'performance specialist', 'paid media', 'paid ads', 'paid social', 'ppc', 'sem', 'google ads', 'meta ads', 'facebook ads', 'ads specialist', 'advertising specialist', 'digital marketing', 'digital marketer', 'growth marketer', 'growth hacker', 'campaign manager', 'campaign specialist',
      'ميديا باير', 'شراء الوسائط', 'إعلانات ممولة', 'إعلانات', 'تسويق رقمي', 'التسويق الرقمي', 'تسويق إلكتروني', 'التسويق الإلكتروني',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Campaigns launched on time', 'Campaigns live by the agreed start date, with tracking in place', 'Launch date vs plan', 'Launch paid campaigns on schedule', ALL_ON_TIME),
      metric(1, 'Budget pacing', 'Monthly spend within 5% of the planned budget for each client', 'Ads manager spend vs plan', 'Manage ad budgets and pacing', [['Within 5%', 25], ['5–15% off', 15], ['Over 15% off', 5]]),
      metric(2, 'Results vs target', 'Campaign results (ROAS, CPA or leads) against the client’s agreed target', 'Ads manager and analytics, monthly', 'Optimise campaigns to hit client KPIs', STRETCH_35, 35),
      metric(2, 'Tracking & setup accuracy', 'Pixels, conversions, UTMs and audiences set up right; no spend lost to setup errors', 'Setup checklist and errors found', 'Set up tracking, audiences and campaigns correctly', [['0 errors', 25], ['1 minor', 15], ['A costly error', 0]]),
      CLIENT_SATISFACTION('Communicate campaign results to clients'),
      metric(3, 'Reporting & recommendations', 'A monthly report with insights and an optimisation plan, on time', 'Report date and account manager review', 'Report on campaign performance with recommendations', [['On time, insightful', 20], ['Late or thin', 12], ['Missing', 0]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Testing & optimisation', 'A/B tests run and optimisations logged against the plan', 'Test log', 'Test creatives, audiences and bids', [['2+ tests', 20], ['1 test', 12], ['None', 5]]),
    ],
  }),
  role({
    key: 'seo-specialist',
    name: 'SEO Specialist',
    kind: 'marketing',
    keywords: ['seo', 'search engine', 'search engine optimization', 'search engine optimisation', 'organic search', 'organic growth', 'سيو', 'تحسين محركات البحث', 'محركات البحث'],
    attendancePoints: 20,
    metrics: [
      metric(1, 'SEO tasks delivered on time', 'Audits, on-page fixes, content briefs and link work done by the plan’s dates', 'Monthly SEO plan vs completion', 'Deliver the monthly SEO plan', ON_TIME_RATE),
      metric(1, 'Reports on time', 'Ranking and traffic reports sent by the agreed day', 'Report dates', 'Report rankings and organic traffic', [['On time', 25], ['1–3 days late', 15], ['Later', 5]]),
      metric(2, 'Organic growth vs target', 'Organic traffic, rankings or leads against the client’s target', 'Search Console and analytics, monthly', 'Grow organic traffic and rankings', STRETCH_35, 35),
      metric(2, 'Technical SEO health', 'Site health score and critical issues on the managed sites', 'Audit tool score, monthly', 'Run technical SEO audits and fixes', [['90+, no critical issues', 25], ['80–89', 15], ['Below 80 or critical issues', 5]]),
      CLIENT_SATISFACTION('Explain SEO results to clients'),
      metric(3, 'Guidance to content & development', 'Clear briefs and fix requests with priorities and examples', 'Feedback from writers and developers', 'Brief writers and developers on SEO', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'Guideline-safe practice', 'Only search-guideline-safe methods; no penalties or toxic links', 'Search Console manual actions and the backlink audit', 'Follow search engine guidelines', [['Clean', 20], ['Minor risk found', 10], ['Penalty or toxic links', 0]]),
    ],
  }),
  role({
    key: 'account-manager',
    name: 'Account Manager / Client Success',
    kind: 'marketing',
    keywords: [
      'account manager', 'account executive', 'key account', 'account director', 'account coordinator', 'client success', 'customer success', 'client service', 'client services', 'client servicing', 'customer service', 'customer care', 'customer support', 'client relations', 'client relationship', 'relationship manager', 'client partner', 'client',
      'مدير حساب', 'خدمة العملاء', 'نجاح العملاء', 'علاقات العملاء', 'أكونت', 'اكونت', 'أكاونت',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Client deliverables on schedule', 'Deliverables sent to clients by the agreed dates across the accounts', '(On time ÷ due) × 100, from the delivery log; client delays excluded', 'Make sure client deliverables go out on schedule', ON_TIME_RATE),
      metric(1, 'Response time to clients', 'Client emails and messages answered within one working day', 'Inbox spot checks and client feedback', 'Answer client requests promptly', [['Always', 25], ['1–2 delays', 15], ['3+ delays', 5]]),
      metric(2, 'Brief accuracy', 'Briefs to the team complete and right first time, so work isn’t redone', 'Rework caused by brief gaps, as the team logs it', 'Write clear, complete briefs for the team', [['No rework', 35], ['1 case', 25], ['2+ cases', 10]]),
      metric(2, 'Scope & billing control', 'Out-of-scope work agreed in writing and billed; invoices requested on time', 'Finance and PM review', 'Manage scope, approvals and billing', [['Fully controlled', 25], ['1 gap', 15], ['2+ gaps', 5]]),
      metric(3, 'Client satisfaction & retention', 'Client rating and renewals of the accounts managed', 'Satisfaction survey 1–5 and renewals', 'Build lasting client relationships', [['4.5 – 5, renewed', 30], ['4.0 – 4.4', 20], ['Below 4 or lost', 10]]),
      metric(3, 'Upsell & account growth', 'New scope or services sold to current clients', 'Signed upsells vs the monthly target', 'Grow accounts with new services', [['Above target', 22], ['On target', 20], ['Some', 12], ['None', 5]], 20),
      DEVELOPMENT_PLAN,
      metric(4, 'CRM & meeting notes', 'Meeting minutes, approvals and the CRM updated within a working day', 'Weekly spot check', 'Keep client records and approvals up to date', CURRENT_20),
    ],
  }),
  role({
    key: 'sales-bd',
    name: 'Sales / Business Development',
    kind: 'marketing',
    keywords: ['sales', 'sales executive', 'sales representative', 'business development', 'business developer', 'bd', 'bdm', 'bdr', 'sdr', 'lead generation', 'presales', 'pre sales', 'partnerships', 'partnership', 'telesales', 'مبيعات', 'تطوير الأعمال', 'تطوير أعمال', 'مندوب', 'مندوب مبيعات', 'بيع', 'شراكات'],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Proposals sent on time', 'Proposals and quotations sent within the agreed days of a qualified request', 'CRM: request date vs proposal date', 'Prepare proposals and quotations', [['All on time', 35], ['1–2 late', 25], ['3+ late', 10]]),
      metric(1, 'Pipeline activity', 'Qualified meetings and calls against the monthly target', 'CRM activity report', 'Generate and qualify new leads', [['100%+', 25], ['80–99%', 15], ['Below 80%', 5]]),
      metric(2, 'Revenue vs target', 'Signed contract value against the monthly sales target', 'Signed contracts in the CRM, monthly', 'Close deals and meet the sales target', [['110%+ of target', 38], ['100–109% of target', 35], ['80–99% of target', 25], ['Below 80%', 10]], 35),
      metric(2, 'Proposal accuracy', 'Scope, pricing and terms right and approved before sending; no margin lost', 'Management and finance review', 'Price and scope deals correctly', [['0 issues', 25], ['1 issue', 15], ['2+ issues', 5]]),
      metric(3, 'Client relationships', 'Prospect and client feedback on responsiveness and professionalism', 'Feedback and lost-deal reasons', 'Build relationships with prospects and clients', [['Excellent', 30], ['Good', 20], ['Complaints', 10]]),
      metric(3, 'Handover to delivery', 'Won deals handed to the account and project teams with full scope, budget and contacts', 'Delivery team feedback', 'Hand over won deals to the delivery team', [['Complete', 20], ['Minor gaps', 12], ['Major gaps', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'CRM hygiene', 'Every lead, stage and next step kept current in the CRM', 'Weekly pipeline review', 'Keep the CRM pipeline up to date', CURRENT_20),
    ],
  }),

  // ----- operations and projects -----
  role({
    key: 'project-manager',
    name: 'Project Manager / Producer / Scrum Master',
    kind: 'operations',
    keywords: [
      'project manager', 'project management', 'project coordinator', 'project lead', 'project', 'projects', 'pmo', 'pm', 'scrum master', 'scrum', 'agile coach', 'delivery manager', 'product owner', 'product manager', 'digital producer', 'web producer', 'project producer', 'traffic manager', 'traffic coordinator', 'program manager', 'programme manager',
      'مدير مشروع', 'مدير مشاريع', 'مدير المشاريع', 'إدارة المشاريع', 'منسق مشاريع', 'منسق مشروع', 'مشاريع', 'مشروع', 'سكرم ماستر',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Milestones delivered on time', 'Project milestones delivered to clients by the agreed dates', '(On time ÷ due) × 100, from the project plan; client delays excluded', 'Deliver projects on time', ON_TIME_RATE),
      metric(1, 'Plans & boards current', 'Sprints and timelines planned, tracked and closed; boards always current', 'PMO or lead review of the boards', 'Plan sprints and track project progress', [['Always current', 25], ['Minor gaps', 15], ['Out of date', 5]]),
      metric(2, 'Budget & hours control', 'Projects within the approved budget or hours', 'Hours logged vs estimate, per project', 'Control project budgets and resources', [['Within 5%', 35], ['5–15% over', 25], ['Over 15% over', 10]]),
      metric(2, 'Scope & change control', 'Changes captured as change requests and approved before work starts', 'Change log review', 'Manage scope and change requests', [['All captured', 25], ['1 missed', 15], ['2+ missed', 5]]),
      CLIENT_SATISFACTION('Manage client expectations and communication'),
      metric(3, 'Status & risk reporting', 'Weekly status to the client and management; risks raised early', 'Status reports sent and escalations on time', 'Report project status and risks', [['Every week', 20], ['1 missed', 12], ['2+ missed', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Delivery process discipline', 'Kick-offs, retrospectives and handover documents done as the delivery process says', 'Process checklist per project', 'Follow the delivery process', [['All done', 20], ['Minor gaps', 12], ['Skipped', 5]]),
    ],
  }),
  role({
    key: 'office-admin',
    name: 'Office Administrator / Receptionist / Office Assistant',
    kind: 'operations',
    keywords: [
      'office administrator', 'office admin', 'admin', 'administrator', 'administrative', 'admin assistant', 'administrative assistant', 'receptionist', 'reception', 'front desk', 'front office', 'office assistant', 'office manager', 'office coordinator', 'office boy', 'office girl', 'tea boy', 'secretary', 'executive assistant', 'personal assistant', 'data entry',
      'استقبال', 'إدخال بيانات', 'موظف استقبال', 'سكرتير', 'سكرتارية', 'سكرتيرة', 'إداري', 'مساعد إداري', 'شؤون إدارية', 'عامل بوفيه', 'بوفيه', 'ساعي', 'مساعد مكتب', 'مدير مكتب',
    ],
    attendancePoints: 25,
    metrics: [
      metric(1, 'Office requests handled on time', 'Staff requests (supplies, bookings, maintenance) closed within the agreed time', '(On time ÷ total) × 100, from the request log', 'Handle office requests from staff', ON_TIME_RATE),
      metric(1, 'Supplies & services in place', 'Office, kitchen and printing supplies never run out; vendor services renewed on time', 'Stock checks and stock-outs logged', 'Order supplies and manage vendors', [['No stock-outs', 25], ['1 stock-out', 15], ['2+ stock-outs', 5]]),
      metric(2, 'Accuracy of records', 'Petty cash, the visitor log, vendor records and filing correct and complete', 'Monthly check by HR or Finance', 'Keep office records, petty cash and filing', [['No errors', 35], ['1 error', 25], ['2+ errors', 10]]),
      metric(2, 'Office readiness', 'Reception, meeting rooms and shared areas clean and ready every day', 'Spot checks by HR or management', 'Keep the reception and meeting rooms ready', [['Always ready', 25], ['1–2 lapses', 15], ['3+ lapses', 5]]),
      metric(3, 'Visitor & caller experience', 'Guests and callers welcomed, directed and followed up professionally', 'Feedback from staff and visitors', 'Welcome visitors and answer calls', [['Excellent', 30], ['Good', 20], ['Complaints', 10]]),
      metric(3, 'Staff satisfaction with office support', 'How staff rate the office support they get', 'Quarterly 1–5 pulse, or the manager’s judgement', 'Support staff with their office needs', [['4.5 – 5', 20], ['4.0 – 4.4', 12], ['Below 4', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Cost control', 'Office spend within the monthly budget, with quotes compared before buying', 'Finance report', 'Control office expenses', BUDGET_20),
    ],
  }),

  // ----- HR -----
  role({
    key: 'hr-specialist',
    name: 'HR Specialist / Recruiter',
    kind: 'hr',
    keywords: [
      'hr specialist', 'hr generalist', 'hr coordinator', 'hr officer', 'hr executive', 'hr assistant', 'hr business partner', 'hrbp', 'recruiter', 'recruitment', 'recruiting', 'talent acquisition', 'sourcer', 'people partner', 'payroll specialist', 'payroll officer', 'social insurance', 'personnel', 'training coordinator', 'training specialist', 'learning and development', 'compensation and benefits', 'employee relations', 'hr admin', 'hr administrator', 'payroll',
      'أخصائي موارد بشرية', 'مسؤول موارد بشرية', 'إداري موارد بشرية', 'توظيف', 'استقطاب', 'شؤون الموظفين', 'شئون الموظفين', 'شؤون العاملين', 'شئون العاملين', 'تأمينات', 'رواتب', 'مرتبات',
    ],
    attendancePoints: kpiSample('HR-SP v3')!.attendancePoints,
    // the HR-SP v3 sample's metrics (kpi-framework.json), as the owner's HR KPI sheet has them
    metrics: kpiSample('HR-SP v3')!.metrics,
  }),

  // ----- finance -----
  role({
    key: 'accountant',
    name: 'Accountant / Finance',
    kind: 'finance',
    keywords: [
      'accountant', 'accounting', 'chief accountant', 'bookkeeper', 'cashier', 'treasurer', 'treasury', 'auditor', 'tax', 'billing', 'collector', 'collections', 'financial analyst', 'finance officer', 'finance specialist', 'finance executive', 'accounts payable', 'accounts receivable',
      'محاسب', 'محاسبة', 'أمين خزينة', 'خزينة', 'مراجع حسابات', 'ضرائب', 'تحصيل', 'مدير حسابات', 'محلل مالي',
    ],
    attendancePoints: 20,
    metrics: [
      metric(1, 'Month-end close on time', 'Books closed and reports issued by the agreed working day', 'Close checklist completion date', 'Close the books monthly', [['By the due day', 35], ['1–2 days late', 25], ['Later', 10]]),
      metric(1, 'Payments & filings on time', 'Supplier payments, client invoices and tax filings done by their due dates', '(On time ÷ due) × 100, from the due-date log', 'Process payments, invoices and tax filings', [['95–100%', 25], ['85–94%', 15], ['Below 85%', 5]]),
      metric(2, 'Accuracy of entries & reports', 'Postings, reconciliations and reports free of errors', 'Review findings and corrections after the close', 'Record transactions and prepare accurate reports', [['0 errors', 35], ['1–2 minor', 25], ['Any material error', 5]]),
      metric(2, 'Reconciliations complete', 'Bank, cash, receivable and payable accounts reconciled every month', 'Reconciliation checklist', 'Reconcile bank and ledger accounts', [['All reconciled', 25], ['1 open item', 15], ['2+ open items', 5]]),
      metric(3, 'Receivables follow-up', 'Overdue client balances followed up and collected', 'Aging report: share of receivables over 60 days', 'Follow up client collections', [['Under 10%', 30], ['10–20%', 20], ['Over 20%', 10]]),
      metric(3, 'Support to teams', 'Payroll, reimbursement and budget questions answered within a working day', 'Team and management feedback', 'Support teams on finance requests', [['Always', 20], ['Some delays', 12], ['Complaints', 5]]),
      DEVELOPMENT_PLAN,
      metric(4, 'Compliance & controls', 'Approvals, documents and tax rules followed; audit points closed', 'Internal and external audit findings', 'Follow financial controls and tax law', [['No findings', 20], ['Minor findings', 12], ['A major finding', 0]]),
    ],
  }),

  // ----- each kind's general template -----
  general({
    key: 'general-development',
    name: 'General Development',
    kind: 'development',
    attendancePoints: 25,
    metrics: [
      metric(1, 'Tasks delivered on time', 'Share of assigned tasks closed by their due date', '(Tasks on time ÷ tasks due) × 100, from the project board; client-blocked tasks excluded', 'Deliver assigned development tasks on time', ON_TIME_RATE),
      ESTIMATE_ACCURACY('Estimate work accurately'),
      metric(2, 'Defects after delivery', 'Bugs found by QA, the client or users in work marked done', 'Reopened tickets and the bug log, monthly', 'Deliver working, tested solutions', [['0', 35], ['1–2', 25], ['3 or more', 10]]),
      metric(2, 'Technical quality', 'Major issues found in code or technical review', 'Major findings logged by the reviewer', 'Follow coding standards and best practice', [['No major', 25], ['1 major', 15], ['2+ major', 5]]),
      PM_FEEDBACK('Communicate progress to PMs and clients'),
      metric(3, 'Teamwork & knowledge sharing', 'Help given to teammates, reviews done and knowledge documented', 'Manager judgement with examples', 'Collaborate with the team and share knowledge', [['Regular, documented', 20], ['Some', 12], ['None', 5]]),
      DEVELOPMENT_PLAN,
    ],
  }),
  general({
    key: 'general-creative',
    name: 'General Creative',
    kind: 'creative',
    attendancePoints: 25,
    metrics: [
      metric(1, 'Deliverables on schedule', 'Creative deliverables handed over by the agreed dates', 'Delivered vs planned date; client delays excluded', 'Deliver creative work on time', ALL_ON_TIME),
      metric(1, 'Output vs plan', 'Approved deliverables against the month’s planned volume', 'Content calendar or project plan: approved ÷ planned', 'Produce the month’s planned work', OUTPUT_25),
      REVISION_ROUNDS('Revision rounds', 'deliverable', 'Work to the brief first time'),
      metric(2, 'Brand & technical QC', 'Issues found in internal QC: brand, specs, spelling, technical quality', 'Art Director or lead review', 'Meet brand and technical standards', QC_25),
      ACCOUNT_FEEDBACK('Work with account managers and clients'),
      metric(3, 'Teamwork', 'Briefs clarified early, feedback taken well, files shared on time', 'Team feedback', 'Collaborate with the creative team', TEAMWORK_20),
      DEVELOPMENT_PLAN,
    ],
  }),
  general({
    key: 'general-marketing',
    name: 'General Marketing',
    kind: 'marketing',
    attendancePoints: 20,
    metrics: [
      metric(1, 'Plan delivered on time', 'Campaigns, content and marketing tasks delivered by the plan’s dates', '(On time ÷ due) × 100, from the marketing plan', 'Deliver the marketing plan on schedule', ON_TIME_RATE),
      metric(1, 'Reports on time', 'Monthly results reports sent by the agreed day', 'Report dates', 'Report marketing results', [['On time', 25], ['1–3 days late', 15], ['Later', 5]]),
      metric(2, 'Results vs target', 'Leads, engagement, reach or sales against the month’s target', 'Analytics and platform insights, monthly', 'Hit the marketing targets', STRETCH_35, 35),
      metric(2, 'Accuracy of published work', 'Campaigns and posts live with the right copy, visuals, links and tracking', 'Errors found after launch', 'Launch campaigns accurately', [['0 errors', 25], ['1 error', 15], ['2+ errors', 5]]),
      metric(3, 'Client / stakeholder satisfaction', 'Rating from the client or the internal stakeholders served', 'Monthly 1–5 rating form', 'Work with clients and stakeholders on marketing goals', RATING_30),
      metric(3, 'Insights & recommendations', 'Clear insights and next steps shared after each campaign', 'Manager review of the reports', 'Analyse campaigns and recommend improvements', [['Every campaign', 20], ['Some', 12], ['None', 5]]),
      DEVELOPMENT_PLAN,
    ],
  }),
  general({
    key: 'general-operations',
    name: 'General Operations',
    kind: 'operations',
    attendancePoints: 25,
    metrics: [
      metric(1, 'Requests handled on time', 'Requests and tasks closed within the agreed time', '(On time ÷ total) × 100, from the request or task log', 'Handle operational requests on time', ON_TIME_RATE),
      metric(1, 'Planned work completed', 'Planned recurring tasks (checks, renewals, orders) done by their dates', 'Monthly checklist', 'Complete scheduled operational tasks', [['All done', 25], ['1 missed', 15], ['2+ missed', 5]]),
      metric(2, 'Accuracy of records', 'Logs, records and documents correct and complete', 'Monthly check by the manager', 'Keep accurate operational records', [['No errors', 35], ['1 error', 25], ['2+ errors', 10]]),
      metric(2, 'Process & policy compliance', 'Procedures, approvals and safety rules followed', 'Manager spot checks and incidents', 'Follow company procedures and policies', [['Fully followed', 25], ['1 lapse', 15], ['2+ lapses', 5]]),
      metric(3, 'Internal customer satisfaction', 'How the teams served rate the support', 'Monthly 1–5 rating, or the manager’s judgement', 'Support teams across the company', RATING_30),
      metric(3, 'Teamwork & communication', 'Works well with colleagues; updates given without being chased', 'Manager and team feedback', 'Coordinate with other departments', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'Cost awareness', 'Spend within budget, with quotes compared before buying', 'Finance report', 'Control operational costs', BUDGET_20),
    ],
  }),
  general({
    key: 'general-hr',
    name: 'General HR',
    kind: 'hr',
    attendancePoints: 20,
    metrics: [
      metric(1, 'HR tasks delivered on time', 'Reliability in meeting HR deadlines', '(Completed HR tasks ÷ total tasks) × 100', 'Deliver HR operations on schedule', [['95–100%', 30], ['85–94%', 15], ['Below 85%', 5]]),
      metric(1, 'Vacancies filled on schedule', 'Open roles filled by the agreed date with well-matched people', 'Days from posting to offer, and hires passing probation', 'Run recruitment and onboarding', [['No delays', 35], ['1–2 delays', 30], ['3+ delays', 20]]),
      metric(2, 'Accuracy of HR records', 'Employee files, contracts and system data correct', 'Monthly file audit and corrections needed', 'Maintain employee files, contracts and system data', [['No errors', 25], ['1 error', 15], ['2+ major', 5]]),
      metric(2, 'Payroll inputs accuracy', 'Payroll inputs (attendance, leave, deductions) complete and correct', 'Checked by Finance before approval', 'Prepare monthly payroll inputs', [['0 errors', 35], ['1–2 errors', 25], ['3+ errors', 10]]),
      metric(3, 'Responsiveness to employees', 'Speed of answering HR requests and urgent cases', 'Average response time under 24 h', 'Handle employee requests', [['No complaints', 25], ['1 delay', 15], ['2+ delays', 5]]),
      metric(3, 'Manager & employee feedback', 'How managers and employees rate HR’s support', 'Quarterly 1–5 pulse survey', 'Advise managers and employees on HR matters', RATING_30),
      DEVELOPMENT_PLAN,
      metric(4, 'Labour law & policy compliance', 'Contracts, social insurance and HR policies kept in line with the labour law', 'Monthly compliance checklist and audit findings', 'Apply the labour law and HR policies', [['No findings', 20], ['Minor findings', 12], ['A major finding', 0]]),
    ],
  }),
  general({
    key: 'general-finance',
    name: 'General Finance',
    kind: 'finance',
    attendancePoints: 20,
    metrics: [
      metric(1, 'Finance deadlines met', 'Closings, payments, invoices and filings done by their due dates', '(On time ÷ due) × 100, from the finance calendar', 'Meet finance deadlines', ON_TIME_RATE),
      metric(1, 'Request turnaround', 'Finance requests (payments, quotes, reimbursements) handled within the agreed time', 'Request log', 'Process finance requests', [['Within the agreed time', 25], ['Slightly over', 15], ['Far over', 5]]),
      metric(2, 'Accuracy of figures', 'Entries, payments and reports free of errors', 'Review findings and corrections', 'Keep accurate financial records', [['0 errors', 35], ['1–2 minor', 25], ['Any material error', 5]]),
      metric(2, 'Controls & documentation', 'Approvals and supporting documents in place for every transaction', 'Monthly sample check and audit findings', 'Follow financial controls and approvals', [['All in place', 25], ['1–2 gaps', 15], ['3+ gaps', 5]]),
      metric(3, 'Support to teams', 'Questions from teams and management answered within a working day', 'Team and management feedback', 'Support teams and management on finance matters', [['Always', 30], ['Some delays', 20], ['Complaints', 10]]),
      metric(3, 'Management reporting', 'Monthly finance reports clear, on time and with comments on variances', 'Management review', 'Prepare management finance reports', [['On time, clear', 20], ['Late or unclear', 12], ['Missing', 0]]),
      DEVELOPMENT_PLAN,
    ],
  }),
  general({
    key: 'general',
    name: 'Universal (Any Role)',
    kind: 'general',
    attendancePoints: 20,
    metrics: [
      metric(1, 'Tasks delivered on time', 'Share of assigned tasks done by their due date', '(Tasks on time ÷ tasks due) × 100, from the task list or the manager’s log', 'Complete assigned tasks on time', ON_TIME_RATE),
      metric(1, 'Workload vs plan', 'The month’s planned work completed', 'Planned vs done, reviewed with the manager', 'Complete the month’s planned work', [['All done', 25], ['Mostly done', 15], ['Much left', 5]]),
      metric(2, 'Accuracy & quality of work', 'Work right first time and to the agreed standard', 'Manager review: errors and issues found', 'Deliver accurate, high-quality work', [['No issues', 35], ['1–2 minor', 25], ['Major issues', 10]]),
      metric(2, 'Rework needed', 'Work sent back to be redone', 'Count of items sent back in the month', 'Get work right first time', [['None', 25], ['1', 15], ['2 or more', 5]]),
      metric(3, 'Manager / stakeholder feedback', 'Rating from the manager and the people served', 'Monthly 1–5 rating form', 'Serve colleagues and clients well', RATING_30),
      metric(3, 'Teamwork & communication', 'Works well with others; updates shared without being chased', 'Manager and team feedback', 'Collaborate and communicate with the team', TEAMWORK_20),
      DEVELOPMENT_PLAN,
      metric(4, 'Process & policy compliance', 'Company procedures, tools and policies followed', 'Manager spot checks', 'Follow company policies and procedures', [['Fully followed', 20], ['1 lapse', 12], ['2+ lapses', 5]]),
    ],
  }),
];

/** The universal template's key: what matches when nothing else does. */
export const KPI_LIBRARY_UNIVERSAL = 'general';

/** A library template by its key; none for another. */
export const kpiLibraryTemplate = (key: string): KpiLibraryTemplate | null => KPI_LIBRARY.find((t) => t.key === key) ?? null;

/** The library's roles for the picker (GET /kpis/templates/library), in the library's order. */
export const kpiLibraryRoles = (): KpiLibraryRole[] => KPI_LIBRARY.map((t) => ({ key: t.key, name: t.name, kind: t.kind }));

/** A kind's general template (the universal one for `general`). */
const generalOf = (kind: KpiLibraryKind): KpiLibraryTemplate => KPI_LIBRARY.find((t) => t.general && t.kind === kind)!;

// ---------- matching a job title to a role ----------

/**
 * The words that point a job title or a department to a kind of role, when no role's own words do: its general
 * template. In the kinds' order, which wins a tie.
 */
export const KPI_LIBRARY_KIND_KEYWORDS: Record<Exclude<KpiLibraryKind, 'general'>, readonly string[]> = {
  development: ['developer', 'development', 'engineer', 'engineering', 'programming', 'software', 'tech', 'technology', 'technical', 'web', 'coding', 'تطوير', 'مطور', 'برمجة', 'برمجيات', 'مهندس', 'تقني', 'تقنية', 'تكنولوجيا'],
  creative: ['design', 'designer', 'creative', 'art', 'artist', 'studio', 'production', 'media production', 'multimedia', 'visual', 'illustration', 'تصميم', 'مصمم', 'إبداع', 'إبداعي', 'إنتاج', 'إنتاج إعلامي', 'استوديو', 'ملتيميديا', 'وسائط متعددة'],
  marketing: ['marketing', 'marketer', 'brand', 'branding', 'growth', 'communications', 'communication', 'pr', 'public relations', 'media', 'advertising', 'digital', 'campaign', 'commercial', 'event', 'events', 'تسويق', 'إعلان', 'دعاية', 'علاقات عامة', 'براند', 'ميديا'],
  operations: ['operations', 'operation', 'administration', 'office', 'facilities', 'facility', 'logistics', 'procurement', 'purchasing', 'supply chain', 'driver', 'security', 'housekeeping', 'maintenance', 'services', 'general services', 'support', 'عمليات', 'تشغيل', 'مشتريات', 'لوجستيات', 'سائق', 'حراسة', 'صيانة', 'خدمات', 'نظافة'],
  hr: ['hr', 'human resources', 'human resource', 'people', 'people operations', 'people and culture', 'talent', 'culture', 'موارد بشرية', 'الموارد البشرية', 'تدريب'],
  finance: ['finance', 'financial', 'accounts', 'audit', 'مالية', 'مالي', 'حسابات'],
};

/** How a job title was matched to the library: the template, what pointed to it and why, in words. */
export interface KpiLibraryMatch {
  key: string;
  name: string;
  /** What matched: the job title, the department, or nothing (the universal template). */
  by: 'title' | 'department' | 'none';
  /** The word that matched, as the library writes it; null for the universal template. */
  keyword: string | null;
  /** Why, as HR reads it: "The job title says “frontend”." */
  reason: string;
}

/** Arabic letters. */
const ARABIC = /[؀-ۿ]/;
/** The Arabic marks left out when comparing (the vowel marks, the dagger alef, the tatweel). */
const ARABIC_MARKS = /[ً-ٰٟـ]/g;
/** What an Arabic word may start with before the word itself: "and", "the", "with the", "for the" … */
const ARABIC_PREFIX = '(?:وال|بال|فال|كال|لل|ال|و|ب|ل|ف)?';

/**
 * A text as matching compares it: lower case, the Arabic letters written one way (أ إ آ as ا, ة as ه, ى as ي, no
 * marks), "&" as "and", and anything else that isn't a letter or a digit a space.
 */
export function kpiMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const patterns = new Map<string, RegExp>();

/**
 * Whether a text (kpiMatchText's) has a keyword: in English, as whole words, plural or not ("project" in "Projects");
 * in Arabic, at the start of a word, after a prefix like "ال" or "و" (so "محاسب" is in "المحاسبة", "مالي" is not in
 * "إجمالي").
 */
function has(text: string, keyword: string): boolean {
  let pattern = patterns.get(keyword);
  if (!pattern) {
    const k = kpiMatchText(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = ARABIC.test(k) ? new RegExp(`(?:^| )${ARABIC_PREFIX}${k}`) : new RegExp(`(?:^| )${k}(?:s|es)?(?= |$)`);
    patterns.set(keyword, pattern);
  }
  return pattern.test(text);
}

/** The longest of the keywords a text has (the most specific), the first listed on a tie; null for none. */
function longestHit<T>(text: string, candidates: readonly { item: T; keywords: readonly string[] }[]): { item: T; keyword: string } | null {
  if (!text) return null;
  let best: { item: T; keyword: string; length: number } | null = null;
  for (const c of candidates) {
    for (const keyword of c.keywords) {
      const length = kpiMatchText(keyword).length;
      if ((!best || length > best.length) && has(text, keyword)) best = { item: c.item, keyword, length };
    }
  }
  return best && { item: best.item, keyword: best.keyword };
}

/** A kind in a sentence: "No role matched; the job title says “developer”: a development or IT role." */
const KIND_IN_WORDS: Record<Exclude<KpiLibraryKind, 'general'>, string> = {
  development: 'a development or IT role',
  creative: 'a creative or production role',
  marketing: 'a marketing, sales or client role',
  operations: 'an operations role',
  hr: 'an HR role',
  finance: 'a finance role',
};

const ROLE_CANDIDATES = KPI_LIBRARY.filter((t) => !t.general).map((t) => ({ item: t, keywords: t.keywords }));
const KIND_CANDIDATES = (Object.keys(KPI_LIBRARY_KIND_KEYWORDS) as Exclude<KpiLibraryKind, 'general'>[]).map((kind) => ({ item: kind, keywords: KPI_LIBRARY_KIND_KEYWORDS[kind] }));

/**
 * The library template for a job title (owner's brief, 21 October 2026: "by keywords in English and common Arabic
 * words. First the title, then the department, then the universal generic"), with why:
 * 1. a role's words in the title ("Senior Frontend Developer": Frontend Developer); the longest word wins, so "System
 *    Administrator" is IT's, not the office's "administrator";
 * 2. a role's words in the department, when the title says no other kind of role ("Developer" in the Frontend team:
 *    Frontend Developer; but "Developer" in Video Production is not a video producer);
 * 3. a kind's words in the title: its general template ("Marketing Manager": General Marketing);
 * 4. a kind's words in the department ("Coordinator" in Human Resources: General HR);
 * 5. else the universal template.
 * `title`: the job title in English, and in Arabic if it has one; `departmentName`: its department, and the department
 * a team is in (kpiLibraryMatchOf joins them).
 */
export function matchLibraryTemplate(title: string, departmentName?: string | null): KpiLibraryMatch {
  const t = kpiMatchText(title);
  const d = kpiMatchText(departmentName ?? '');
  const found = (template: KpiLibraryTemplate, by: KpiLibraryMatch['by'], keyword: string | null, reason: string): KpiLibraryMatch => ({ key: template.key, name: template.name, by, keyword, reason });

  const titleRole = longestHit(t, ROLE_CANDIDATES);
  if (titleRole) return found(titleRole.item, 'title', titleRole.keyword, `The job title says “${titleRole.keyword}”.`);
  const titleKind = longestHit(t, KIND_CANDIDATES);
  const departmentRole = longestHit(d, titleKind ? ROLE_CANDIDATES.filter((c) => c.item.kind === titleKind.item) : ROLE_CANDIDATES);
  if (departmentRole) return found(departmentRole.item, 'department', departmentRole.keyword, `The department says “${departmentRole.keyword}”.`);
  if (titleKind) {
    return found(generalOf(titleKind.item), 'title', titleKind.keyword, `No role matched; the job title says “${titleKind.keyword}”: ${KIND_IN_WORDS[titleKind.item]}.`);
  }
  const departmentKind = longestHit(d, KIND_CANDIDATES);
  if (departmentKind) {
    return found(generalOf(departmentKind.item), 'department', departmentKind.keyword, `No role matched; the department says “${departmentKind.keyword}”: ${KIND_IN_WORDS[departmentKind.item]}.`);
  }
  return found(generalOf('general'), 'none', null, 'Nothing in the job title or department matched, so the universal template.');
}

/** A job title as matching reads it: its titles, its department (or team) and the department a team is in. */
export interface KpiLibraryJobTitle {
  titleEn: string;
  titleAr?: string | null;
  department?: { nameEn: string; parentName?: string | null } | null;
}

/** Both titles, English then Arabic, as one text. */
export const kpiLibraryTitleOf = (job: KpiLibraryJobTitle): string => [job.titleEn, job.titleAr].filter((s) => s && s.trim()).join(' ');

/** The library template for a job title, as "Draft templates for every job title" and the role picker suggest it. */
export function kpiLibraryMatchOf(job: KpiLibraryJobTitle): KpiLibraryMatch {
  const department = [job.department?.nameEn, job.department?.parentName].filter((s) => s && s.trim()).join(' ');
  return matchLibraryTemplate(kpiLibraryTitleOf(job), department);
}

// ---------- leading people ----------

/** The words of a title that leads people (owner's brief, 21 October 2026), with Chief, and their Arabic. */
const LEADERSHIP_WORDS = ['head', 'lead', 'leader', 'manager', 'director', 'supervisor', 'chief', 'رئيس', 'مدير', 'قائد', 'مشرف'];

/**
 * Titles where "manager" or "lead" names the work, not a team: an account manager manages accounts, a project manager
 * projects, "lead generation" finds sales leads. Another word still counts ("Head of Account Management").
 */
const NOT_LEADERSHIP = [
  'account manager', 'project manager', 'community manager', 'product manager', 'campaign manager', 'relationship manager', 'success manager', 'traffic manager', 'lead generation',
  'مدير حساب', 'مدير مشروع', 'مدير مشاريع', 'مدير المشاريع',
].map((phrase) => {
  const k = kpiMatchText(phrase);
  // in Arabic a whole word ("مدير حساب" is not in "مدير حسابات", a chief accountant), in English plural or not
  return ARABIC.test(k) ? new RegExp(`(?:^| )${ARABIC_PREFIX}${k}(?= |$)`, 'g') : new RegExp(`(?:^| )${k}(?:s|es)?(?= |$)`, 'g');
});

/** The word that makes a title lead people ("Head", "Manager" …), as the library writes it; null when it doesn't. */
export function kpiLeadershipWord(title: string): string | null {
  let text = kpiMatchText(title);
  for (const phrase of NOT_LEADERSHIP) text = text.replace(phrase, ' ');
  return LEADERSHIP_WORDS.find((w) => has(text, w)) ?? null;
}

// ---------- linking metrics to the JD's duties ----------

/** Words that say nothing of what a duty is about. */
const STOP_WORDS = new Set(
  [
    'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'that', 'this', 'these', 'those', 'their', 'them', 'they', 'its', 'our', 'your', 'his', 'her', 'all', 'any', 'each', 'every', 'per', 'via', 'within', 'across', 'other', 'others', 'such', 'than', 'then', 'also', 'etc', 'including', 'include', 'ensure', 'ensuring', 'make', 'making', 'responsible', 'responsibility', 'responsibilities', 'duty', 'duties', 'job', 'role', 'new', 'well', 'high', 'good', 'based', 'related', 'required', 'needed', 'using', 'use', 'daily', 'weekly', 'monthly', 'both', 'where', 'when', 'what', 'who', 'how', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'will', 'can', 'may', 'must', 'should', 'not', 'but', 'out', 'over', 'under', 'about', 'after', 'before', 'between', 'during', 'own', 'more', 'most', 'less', 'very', 'work', 'works', 'working',
    'في', 'من', 'على', 'إلى', 'عن', 'مع', 'أو', 'ثم', 'التي', 'الذي', 'هذا', 'هذه', 'ذلك', 'كل', 'بين', 'حسب', 'خلال', 'عند', 'لدى', 'وفق', 'وفقا', 'و',
  ].map(kpiMatchText),
);

/** A word as linking compares it: a plural's "s" off, then its first five letters ("delivered", "delivery": "deliv"). */
function stem(word: string): string {
  const single = word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
  return single.slice(0, 5);
}

/** The meaningful words of a text, stemmed. */
function wordsOf(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of kpiMatchText(text ?? '').split(' ')) if (w.length >= 3 && !STOP_WORDS.has(w)) out.add(stem(w));
  return out;
}

/** A duty is linked when it shares at least this many meaningful words with the metric … */
export const KPI_DUTY_LINK_MIN_WORDS = 2;
/** … and they are at least this share of the duty's own meaningful words. */
export const KPI_DUTY_LINK_MIN_SHARE = 0.25;

/**
 * The job title's JD duty row a metric measures (owner's brief, 21 October 2026: "the best-matching duty line by simple
 * word overlap, above a threshold, else leave it empty"): the row sharing the most meaningful words with the metric's
 * name, definition and the duty it measures, when they are at least two and a quarter of the row's words; on a tie the
 * row more of whose words are shared, then the first. Null when none is close enough. A row longer than a metric's JD
 * duty may be is cut to fit.
 */
export function linkJdDuty(metric: Pick<KpiMetric, 'name' | 'definition' | 'jdDuty'>, duties: readonly string[]): string | null {
  const mine = wordsOf([metric.name, metric.definition, metric.jdDuty].filter(Boolean).join(' '));
  let best: { duty: string; shared: number; share: number } | null = null;
  for (const duty of duties) {
    const theirs = wordsOf(duty);
    if (!theirs.size) continue;
    let shared = 0;
    for (const w of theirs) if (mine.has(w)) shared += 1;
    const share = shared / theirs.size;
    if (shared < KPI_DUTY_LINK_MIN_WORDS || share < KPI_DUTY_LINK_MIN_SHARE) continue;
    if (!best || shared > best.shared || (shared === best.shared && share > best.share)) best = { duty, shared, share };
  }
  if (!best) return null;
  const max = KPI_TEMPLATE_LIMITS.duty;
  const duty = best.duty.trim();
  return duty.length > max ? `${duty.slice(0, max - 1).trimEnd()}…` : duty;
}

// ---------- a draft from the library ----------

/** What a draft made from the library has: its content, the template and the word that made it a leader's (or null). */
export interface KpiLibraryDraft {
  template: KpiLibraryTemplate;
  leadership: string | null;
  content: KpiTemplateContent;
}

/**
 * A job title's draft content from a library template: its metrics (copies), "Team delivery and development" added at
 * the end of Clients & Teamwork for a title that leads people, and each metric linked to the job title's JD duty row it
 * measures (linkJdDuty), else to none. `title`: both its titles (kpiLibraryTitleOf). Null for a key not in the library.
 */
export function kpiLibraryDraft(key: string, job: { title: string; duties?: readonly string[] }): KpiLibraryDraft | null {
  const template = kpiLibraryTemplate(key);
  if (!template) return null;
  const leadership = kpiLeadershipWord(job.title);
  const metrics = template.metrics.map((m) => ({ ...m, criteria: m.criteria.map((c) => ({ ...c })) }));
  if (leadership && !metrics.some((m) => m.name === KPI_LIBRARY_LEADERSHIP_METRIC.name)) {
    const at = metrics.findLastIndex((m) => m.pillar <= KPI_LIBRARY_LEADERSHIP_METRIC.pillar) + 1;
    metrics.splice(at, 0, { ...KPI_LIBRARY_LEADERSHIP_METRIC, criteria: KPI_LIBRARY_LEADERSHIP_METRIC.criteria.map((c) => ({ ...c })) });
  }
  const duties = job.duties ?? [];
  return {
    template,
    leadership,
    content: { attendancePoints: template.attendancePoints, metrics: metrics.map((m) => ({ ...m, jdDuty: linkJdDuty(m, duties) })) },
  };
}

// ---------- the API's answers ----------

/** POST /kpis/templates/draft-all: the drafts made, each with the role it came from and why, and the job titles left. */
export interface KpiDraftAllResult {
  made: {
    jobTitleId: string;
    templateId: string;
    title: string;
    /** "Web Development", or a team as "Web Development › Frontend". */
    department: string;
    libraryKey: string;
    libraryName: string;
    /** It leads people: "Team delivery and development" was added. */
    leadership: boolean;
    reason: string;
  }[];
  skipped: { jobTitleId: string; title: string; department: string; why: string }[];
}

/** POST /kpis/templates/publish-drafts: the drafts published, and those that weren't, each with its problems. */
export interface KpiPublishDraftsResult {
  published: { templateId: string; jobTitleId: string; title: string; version: number; opensFrom: string }[];
  problems: { templateId: string; jobTitleId: string | null; title: string | null; version: number | null; problems: string[] }[];
}
