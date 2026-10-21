import {
  KPI_SAMPLE_TEMPLATES,
  KPI_SETTING_DEFAULTS,
  kpiLibraryMatchOf,
  kpiLibraryRoles,
  kpiSettingsProblems,
  type KpiDraftAllResult,
  type KpiPublishDraftsResult,
  type KpiTemplateRow,
} from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  buildsKpiTemplates,
  copyChoices,
  draftAllConfirmText,
  draftAllSummary,
  draftIdsOf,
  draftsLabel,
  draftSourceOf,
  groupTemplateRows,
  libraryChoices,
  librarySuggestion,
  madeDraftRole,
  metricsLabel,
  opensFromIfPublished,
  peopleLabel,
  publishConfirmText,
  publishDraftsConfirmText,
  publishDraftsSummary,
  publishTimingNote,
  readsKpiTemplates,
  refusedDraftName,
  sampleLabel,
  settingsChangedText,
  settingsOf,
  settingsSummary,
  settingValuesOf,
  templateCounts,
  templateRowText,
  templateIdsOf,
  wholeOf,
} from './templates';

// owner, 21 October 2026: "Templates: HR"
const row = (id: string, title: string, department: { nameEn: string; parentName: string | null }, over: Partial<KpiTemplateRow> = {}): KpiTemplateRow => ({
  jobTitle: { id, titleEn: title, department: { id: `d-${department.nameEn}`, ...department } },
  inForce: null,
  upcoming: null,
  draft: null,
  versions: 0,
  people: 0,
  ...over,
});

const WEB = { nameEn: 'Web Development', parentName: null };
const FRONTEND = { nameEn: 'Frontend', parentName: 'Web Development' };
const MEDIA = { nameEn: 'Media Production', parentName: null };

const ROWS: KpiTemplateRow[] = [
  row('j1', 'Head of Web', WEB, { inForce: { id: 't1', version: 2, metrics: 7, opensFrom: '2026-10-01' }, versions: 2, people: 1 }),
  row('j2', 'Senior Frontend Developer', FRONTEND, {
    inForce: { id: 't2', version: 1, metrics: 6, opensFrom: '2026-09-01' },
    upcoming: { id: 't3', version: 2, opensFrom: '2026-11-01' },
    draft: { id: 't4', version: 3, updatedAt: '2026-10-21T09:15:00.000Z' },
    versions: 2,
    people: 4,
  }),
  row('j3', 'Video Producer', MEDIA, { draft: { id: 't5', version: 1, updatedAt: '2026-10-20T09:15:00.000Z' } }),
  row('j4', 'Web Intern', WEB),
];

describe('who reads and builds the KPI templates', () => {
  it('lists them for HR, the CEO, Admin and the Super Admin, as the API answers', () => {
    for (const role of ['hr', 'ceo', 'admin', 'super_admin'] as const) expect(readsKpiTemplates({ roles: [role] })).toBe(true);
    for (const role of ['employee', 'manager', 'finance'] as const) expect(readsKpiTemplates({ roles: [role] })).toBe(false);
  });

  it('lets HR and the Super Admin build them ("Templates: HR"), not the CEO or an Admin', () => {
    expect(buildsKpiTemplates({ roles: ['hr'] })).toBe(true);
    expect(buildsKpiTemplates({ roles: ['super_admin'] })).toBe(true);
    for (const role of ['ceo', 'admin', 'finance', 'manager', 'employee'] as const) expect(buildsKpiTemplates({ roles: [role] })).toBe(false);
  });
});

describe('the list of job titles', () => {
  it('groups them by department, its own job titles first, then each team’s, in the order they came', () => {
    const groups = groupTemplateRows(ROWS);
    expect(groups.map((g) => [g.department, g.count, g.teams.map((t) => [t.team, t.rows.map((r) => r.jobTitle.id)])])).toEqual([
      [
        'Web Development',
        3,
        [
          [null, ['j1', 'j4']],
          ['Frontend', ['j2']],
        ],
      ],
      ['Media Production', 1, [[null, ['j3']]]],
    ]);
    // a department with teams only
    expect(groupTemplateRows([ROWS[1]])[0].teams.map((t) => t.team)).toEqual(['Frontend']);
    expect(groupTemplateRows([])).toEqual([]);
  });

  it('says the version in force, the upcoming one and the draft, dates as DD/MM/YYYY', () => {
    expect(templateRowText(ROWS[1])).toEqual({
      inForce: 'Version 1 · 6 metrics · since 01/09/2026',
      upcoming: 'Version 2 · opens from 01/11/2026',
      draft: 'Version 3 · saved 21/10/2026',
    });
    expect(templateRowText(ROWS[3])).toEqual({ inForce: null, upcoming: null, draft: null });
    expect(templateRowText(row('x', 'X', WEB, { inForce: { id: 't', version: 1, metrics: 1, opensFrom: '2026-10-01' } })).inForce).toBe('Version 1 · 1 metric · since 01/10/2026');
  });

  it('counts the job titles with each', () => {
    expect(templateCounts(ROWS)).toEqual({ jobTitles: 4, inForce: 2, upcoming: 1, drafts: 2, none: 1 });
  });

  it('counts in words', () => {
    expect([metricsLabel(1), metricsLabel(7), peopleLabel(1), peopleLabel(4)]).toEqual(['1 metric', '7 metrics', '1 person', '4 people']);
  });
});

describe('starting a draft', () => {
  it('offers the three samples of the framework by their role and department', () => {
    expect(KPI_SAMPLE_TEMPLATES.map(sampleLabel)).toEqual([
      'Senior Frontend Developer · Web Development (7 metrics)',
      'Video Producer · Media Production (7 metrics)',
      'HR Specialist · Operations & HR (8 metrics)',
    ]);
  });

  it('offers every other job title’s versions to copy, by department ("Copy from another job title")', () => {
    expect(copyChoices(ROWS, 'j1')).toEqual([
      {
        label: 'Web Development › Frontend',
        options: [
          { value: 't2', label: 'Senior Frontend Developer · version 1, in force' },
          { value: 't3', label: 'Senior Frontend Developer · version 2, from 01/11/2026' },
          { value: 't4', label: 'Senior Frontend Developer · draft' },
        ],
      },
      { label: 'Media Production', options: [{ value: 't5', label: 'Video Producer · draft' }] },
    ]);
    // its own left out, and job titles without a template
    expect(copyChoices(ROWS, 'j2').flatMap((g) => g.options.map((o) => o.value))).toEqual(['t1', 't5']);
    expect(copyChoices([ROWS[3]], 'j1')).toEqual([]);
  });

  it('reads where the draft comes from, refusing anything else', () => {
    const fd = (entries: Record<string, string>) => ({ get: (k: string) => entries[k] ?? null });
    expect(draftSourceOf(fd({ from: 'blank' }))).toEqual({ source: { from: 'blank' } });
    expect(draftSourceOf(fd({ from: 'published' }))).toEqual({ source: { from: 'published' } });
    expect(draftSourceOf(fd({ from: 'sample', sampleCode: 'FE-SR v2' }))).toEqual({ source: { from: 'sample', sampleCode: 'FE-SR v2' } });
    const id = '0b8f2c1e-1111-4222-8333-444455556666';
    expect(draftSourceOf(fd({ from: 'template', templateId: id }))).toEqual({ source: { from: 'template', templateId: id } });
    expect(draftSourceOf(fd({ from: 'sample' }))).toEqual({ error: 'Choose the sample to start from.' });
    expect(draftSourceOf(fd({ from: 'template', templateId: 'nope' }))).toEqual({ error: 'Choose the job title’s template to copy.' });
    expect(draftSourceOf(fd({ from: 'library', libraryKey: 'frontend-developer' }))).toEqual({ source: { from: 'library', libraryKey: 'frontend-developer' } });
    expect(draftSourceOf(fd({ from: 'library', libraryKey: ' ' }))).toEqual({ error: 'Choose the role to start from.' });
    expect(draftSourceOf(fd({ from: 'scan' }))).toEqual({ error: 'Choose how to start the draft.' });
    expect(draftSourceOf(fd({}))).toEqual({ error: 'Choose how to start the draft.' });
  });
});

// owner, 21 October 2026: "can you add templetes for all departments and job roles"
describe('the role library', () => {
  it('groups its roles by kind, in its order, each kind’s general template after its roles', () => {
    const groups = libraryChoices(kpiLibraryRoles());
    expect(groups.map((g) => g.label)).toEqual(['Development and IT', 'Creative and production', 'Marketing, sales and clients', 'Operations and projects', 'HR', 'Finance', 'Any department']);
    expect(groups[0].options[0]).toEqual({ value: 'frontend-developer', label: 'Frontend Developer' });
    expect(groups[0].options.at(-1)).toEqual({ value: 'general-development', label: 'General Development' });
    expect(groups.at(-1)!.options).toEqual([{ value: 'general', label: 'Universal (Any Role)' }]);
    expect(groups.flatMap((g) => g.options)).toHaveLength(kpiLibraryRoles().length);
    expect(libraryChoices([])).toEqual([]);
  });

  it('suggests the role matching the job title, saying why', () => {
    const match = kpiLibraryMatchOf({ titleEn: 'Senior Frontend Developer', department: { nameEn: 'Frontend', parentName: 'Web Development' } });
    expect(librarySuggestion(match)).toBe('Suggested: Frontend Developer. The job title says “frontend developer”.');
  });

  it('asks before drafting every job title, then says what it made and left', () => {
    expect(draftAllConfirmText(12)).toBe(
      'Make a draft for each job title with no KPI template yet (12 job titles)? Each starts from the closest role in the library, its metrics linked to the job title’s duties. Nothing is published, and the job titles with a draft or a published version stay as they are.',
    );
    expect(draftAllConfirmText(1)).toContain('(1 job title)');
    const made = (n: number): KpiDraftAllResult['made'] =>
      Array.from({ length: n }, (_, i) => ({ jobTitleId: `j${i}`, templateId: `t${i}`, title: `T${i}`, department: 'D', libraryKey: 'general', libraryName: 'Universal (Any Role)', leadership: false, reason: 'R' }));
    const skipped = (n: number): KpiDraftAllResult['skipped'] => Array.from({ length: n }, (_, i) => ({ jobTitleId: `s${i}`, title: `S${i}`, department: 'D', why: 'It has a draft already.' }));
    expect(draftAllSummary({ made: made(12), skipped: skipped(3) })).toBe('12 drafts made; 3 job titles skipped. Review each draft, then publish it.');
    expect(draftAllSummary({ made: made(1), skipped: [] })).toBe('1 draft made. Review each draft, then publish it.');
    expect(draftAllSummary({ made: [], skipped: skipped(2) })).toBe('No drafts made: each of the 2 job titles has a draft or a published version already.');
    expect(draftAllSummary({ made: [], skipped: [] })).toBe('No drafts made: there are no job titles yet.');
    expect(madeDraftRole({ libraryName: 'Frontend Developer', leadership: false })).toBe('Frontend Developer');
    expect(madeDraftRole({ libraryName: 'General HR', leadership: true })).toBe('General HR + team leadership');
    expect([draftsLabel(1), draftsLabel(2)]).toEqual(['1 draft', '2 drafts']);
  });
});

describe('publishing the drafts chosen', () => {
  const id1 = '0b8f2c1e-1111-4222-8333-444455556666';
  const id2 = '0b8f2c1e-1111-4222-8333-777788889999';

  it('offers the job titles’ drafts, and reads the ones ticked, each once', () => {
    expect(draftIdsOf(ROWS)).toEqual(['t4', 't5']);
    const fd = (values: string[]) => ({ getAll: (k: string) => (k === 'templateIds' ? values : []) });
    expect(templateIdsOf(fd([id1, ` ${id2} `, id1, 'nope', '']))).toEqual([id1, id2]);
    expect(templateIdsOf(fd([]))).toEqual([]);
  });

  it('says when what is published now applies: 1 November opens October’s scorecards', () => {
    expect(publishTimingNote('2026-10-21')).toBe('Publishing now applies from November’s scorecards, those for October: 1 November opens October’s scorecards.');
    expect(publishTimingNote('2026-12-05')).toBe('Publishing now applies from January’s scorecards, those for December: 1 January opens December’s scorecards.');
    expect(publishDraftsConfirmText(3, '2026-10-21')).toBe(
      "Publish the 3 drafts selected? Each one that passes the checks applies to the scorecards opened from 01/11/2026: October 2026's KPIs on. A draft with problems stays a draft, and you’ll see why.",
    );
    expect(publishDraftsConfirmText(1, '2026-10-21')).toMatch(/^Publish the selected draft\? /);
  });

  it('says what was published and what stopped the others', () => {
    const result: KpiPublishDraftsResult = {
      published: [
        { templateId: id1, jobTitleId: 'j1', title: 'Frontend Developer', version: 1, opensFrom: '2026-11-01' },
        { templateId: id2, jobTitleId: 'j2', title: 'Video Producer', version: 2, opensFrom: '2026-11-01' },
      ],
      problems: [
        { templateId: 't9', jobTitleId: 'j9', title: 'Copywriter', version: 1, problems: ['Add a metric to Quality of Work: every pillar is scored.'] },
        { templateId: 't0', jobTitleId: null, title: null, version: null, problems: ['This KPI template could not be found.'] },
      ],
    };
    expect(publishDraftsSummary(result)).toBe('2 drafts published, applying from 01/11/2026; 2 not published.');
    expect(publishDraftsSummary({ published: [], problems: result.problems.slice(0, 1) })).toBe('Nothing published; 1 not published.');
    expect(publishDraftsSummary({ published: result.published.slice(0, 1), problems: [] })).toBe('1 draft published, applying from 01/11/2026.');
    expect(result.problems.map(refusedDraftName)).toEqual(['Copywriter, version 1', 'A draft']);
  });
});

describe('publishing ("Publishing applies from the next month")', () => {
  it('applies to the scorecards opened from the 1st of the next month: this month’s KPIs on', () => {
    expect(opensFromIfPublished('2026-10-21')).toBe('2026-11-01');
    expect(opensFromIfPublished('2026-12-31')).toBe('2027-01-01');
    expect(publishConfirmText(2, '2026-10-21')).toBe(
      "Publish version 2? It applies to the scorecards opened from 01/11/2026: October 2026's KPIs on. The scorecards opened already keep the version they opened with.",
    );
  });
});

describe('the KPI settings: the deadlines', () => {
  it('reads whole days as typed, Arabic digits too, and nothing else', () => {
    expect([wholeOf('3'), wholeOf(' 10 '), wholeOf('٨'), wholeOf('')].map((n) => (Number.isNaN(n) ? 'NaN' : n))).toEqual([3, 10, 8, 'NaN']);
    for (const typed of ['3.5', '-1', 'abc', '1e2', null, undefined]) expect(Number.isNaN(wholeOf(typed))).toBe(true);
  });

  it('checks them as the API does: days 1 to 28, each step after the one before', () => {
    const values = settingValuesOf(KPI_SETTING_DEFAULTS);
    expect(values).toEqual({ selfRatingDay: '3', managerDay: '6', hrDay: '8', signOffDay: '10' });
    expect(kpiSettingsProblems(settingsOf(values))).toEqual([]);
    expect(kpiSettingsProblems(settingsOf({ ...values, hrDay: '' }))).toEqual(['HR’s calibration by: choose a day from 1 to 28.']);
    expect(kpiSettingsProblems(settingsOf({ ...values, managerDay: '2' }))).toEqual(['The manager’s scoring must be due after the self-rating: choose a later day.']);
  });

  it('says them in a sentence, and who changed them last', () => {
    expect(settingsSummary(KPI_SETTING_DEFAULTS)).toBe('Self-rating by the 3rd, manager’s scoring by the 6th, HR’s calibration by the 8th and sign-off by the 10th');
    expect(settingsChangedText({ updatedAt: null, updatedBy: null })).toBeNull();
    expect(settingsChangedText({ updatedAt: '2026-10-21T14:42:00.000Z', updatedBy: { email: 'hr@trendlix.com', name: 'Mona Adel' } })).toBe(
      'Last changed by Mona Adel on 21/10/2026, 5:42 PM',
    );
    expect(settingsChangedText({ updatedAt: '2026-10-21T14:42:00.000Z', updatedBy: { email: 'hr@trendlix.com', name: null } })).toBe(
      'Last changed by hr@trendlix.com on 21/10/2026, 5:42 PM',
    );
  });
});
