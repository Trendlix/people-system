import { KPI_SAMPLE_TEMPLATES, KPI_SETTING_DEFAULTS, kpiSettingsProblems, type KpiTemplateRow } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  buildsKpiTemplates,
  copyChoices,
  draftSourceOf,
  groupTemplateRows,
  metricsLabel,
  opensFromIfPublished,
  peopleLabel,
  publishConfirmText,
  readsKpiTemplates,
  sampleLabel,
  settingsChangedText,
  settingsOf,
  settingsSummary,
  settingValuesOf,
  templateCounts,
  templateRowText,
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
    expect(draftSourceOf(fd({ from: 'scan' }))).toEqual({ error: 'Choose how to start the draft.' });
    expect(draftSourceOf(fd({}))).toEqual({ error: 'Choose how to start the draft.' });
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
