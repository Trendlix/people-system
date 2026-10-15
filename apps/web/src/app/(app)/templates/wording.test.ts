import { TEMPLATE_SLOTS, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { TemplateSlotView } from '../../../lib/types';
import {
  appliesToLabel,
  byFolder,
  draftIssues,
  draftText,
  fileProblem,
  inUseText,
  languageLabel,
  managesTemplates,
  NOT_DOCX,
  progress,
  publishConfirm,
  seesTemplates,
  sourceName,
  statusLines,
  TEMPLATE_TOO_LARGE,
  triggersLabel,
  uploadLabel,
} from './wording';

const as = (...roles: Role[]) => ({ roles });

// Midday in Cairo on 14 October 2026.
const AT = '2026-10-14T09:30:00.000Z';
const published = (version: number): TemplateSlotView['published'] => ({
  id: `p${version}`,
  version,
  fileName: 'Contract.docx',
  uploadedAt: AT,
  publishedAt: AT,
  publishedBy: { email: 'hr@trendlix.com' },
});
const draft = (version: number, unknownTags: string[] = [], broken: string[] = []): TemplateSlotView['latestDraft'] => ({
  id: `d${version}`,
  version,
  fileName: 'Contract v2.docx',
  uploadedAt: AT,
  unknownTags,
  broken,
});

/** The shared slots as the API lists them, nothing uploaded yet. */
const library = (): TemplateSlotView[] =>
  TEMPLATE_SLOTS.map((s) => ({
    ...s,
    appliesTo: [...s.appliesTo],
    triggers: [...s.triggers],
    copyOf: s.copyOf ?? null,
    overrides: s.overrides ?? null,
    status: 'missing',
    published: null,
    latestDraft: null,
    versionCount: 0,
  }));

describe('who sees and manages the library', () => {
  it('lets HR, Admin, a Super Admin and the CEO see it', () => {
    expect(seesTemplates(as('employee', 'hr'))).toBe(true);
    expect(seesTemplates(as('employee', 'admin'))).toBe(true);
    expect(seesTemplates(as('employee', 'super_admin'))).toBe(true);
    expect(seesTemplates(as('employee', 'ceo'))).toBe(true);
    expect(seesTemplates(as('employee', 'finance'))).toBe(false);
    expect(seesTemplates(as('employee', 'manager'))).toBe(false);
    expect(seesTemplates(as('employee'))).toBe(false);
  });

  it('lets HR, Admin and a Super Admin upload and publish, not the CEO', () => {
    expect(managesTemplates(as('employee', 'hr'))).toBe(true);
    expect(managesTemplates(as('employee', 'admin'))).toBe(true);
    expect(managesTemplates(as('employee', 'super_admin'))).toBe(true);
    expect(managesTemplates(as('employee', 'ceo'))).toBe(false);
  });
});

describe('a slot as the library words it', () => {
  it('names the language, or says it is chosen on upload', () => {
    expect(languageLabel('ar')).toBe('Arabic');
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel(null)).toBe('Arabic or English, chosen on upload');
  });

  it('names the employment types, or says all of them', () => {
    expect(appliesToLabel(['full_time'])).toBe('Full-time');
    expect(appliesToLabel(['part_time', 'internship'])).toBe('Part-time, Internship');
    expect(appliesToLabel(['full_time', 'part_time', 'internship', 'freelance', 'sales'])).toBe('All employment types');
  });

  it('says when it is offered', () => {
    expect(triggersLabel(['on_hire', 'renewal'])).toBe('On hiring · On renewal');
    expect(triggersLabel(['monthly_payroll'])).toBe('Each month, from payroll');
  });

  it("names a copy's source", () => {
    expect(sourceName('contract_full_time')).toBe('Contract · Full-time (official copy)');
    expect(sourceName('contract_full_time', [{ key: 'contract_full_time', name: 'Renamed' }])).toBe('Renamed');
    expect(sourceName('nothing')).toBe('nothing');
  });
});

describe('where a slot stands', () => {
  it('says there is no file yet', () => {
    expect(statusLines({ published: null, latestDraft: null })).toEqual([{ text: 'No file yet', tone: 'muted' }]);
  });

  it('says a draft is not published, and what is wrong with its tags', () => {
    expect(statusLines({ published: null, latestDraft: draft(1) })).toEqual([{ text: 'Draft v1, not published', tone: 'warn' }]);
    expect(statusLines({ published: null, latestDraft: draft(2, ['oops']) })).toEqual([{ text: 'Draft v2, not published: has unknown tags', tone: 'danger' }]);
  });

  it('says which version is in use, when and by whom it was published', () => {
    expect(statusLines({ published: published(3), latestDraft: null })).toEqual([{ text: 'In use: v3, published 14/10/2026 by hr@trendlix.com', tone: 'ok' }]);
    expect(inUseText({ ...published(1)!, publishedBy: null })).toBe('In use: v1, published 14/10/2026');
  });

  it('adds a newer draft under the version in use, and leaves out an older one', () => {
    expect(statusLines({ published: published(1), latestDraft: draft(2) }).map((l) => l.text)).toEqual([
      'In use: v1, published 14/10/2026 by hr@trendlix.com',
      'Draft v2, not published',
    ]);
    expect(statusLines({ published: published(3), latestDraft: draft(2) }).map((l) => l.text)).toEqual(['In use: v3, published 14/10/2026 by hr@trendlix.com']);
  });

  it('words what is wrong with a draft', () => {
    expect(draftIssues({ unknownTags: [], broken: [] })).toBeNull();
    expect(draftIssues({ unknownTags: ['a'], broken: [] })).toBe('has unknown tags');
    expect(draftIssues({ unknownTags: [], broken: ['{{a}'] })).toBe('has broken tags');
    expect(draftIssues({ unknownTags: ['a'], broken: ['{{a}'] })).toBe('has unknown and broken tags');
    expect(draftText({ version: 4, unknownTags: [], broken: ['{{a}'] })).toBe('Draft v4, not published: has broken tags');
  });

  it('offers Upload for a slot without a file, else Upload a new version', () => {
    expect(uploadLabel({ published: null, latestDraft: null, versionCount: 0 })).toBe('Upload');
    expect(uploadLabel({ published: null, latestDraft: draft(1), versionCount: 1 })).toBe('Upload a new version');
    expect(uploadLabel({ published: published(1), latestDraft: null, versionCount: 1 })).toBe('Upload a new version');
  });

  it('asks before publishing, saying what it replaces', () => {
    expect(publishConfirm(4, 3)).toBe('Publish v4? It replaces v3 for new documents.');
    expect(publishConfirm(1, null)).toBe('Publish v1? New documents will be made from it.');
  });
});

describe('progress', () => {
  it('counts the templates in use, not the copy slots', () => {
    const slots = library();
    expect(progress(slots)).toEqual({ inUse: 0, total: 22, text: '0 of 22 templates in use' });

    slots[0].published = published(1); // the full-time contract (official copy)
    slots[1].published = published(1); // its insurance copy follows it: not counted
    slots[5].latestDraft = draft(1); // a draft isn't in use
    expect(progress(slots).text).toBe('1 of 22 templates in use');
  });

  it('says one template in the singular', () => {
    expect(progress([{ copyOf: null, published: published(1) }]).text).toBe('1 of 1 template in use');
  });
});

describe('byFolder', () => {
  it('groups the slots in the library’s folder order, keeping their order within a folder', () => {
    const groups = byFolder([...library()].reverse());
    expect(groups.map((g) => g.folder)).toEqual(['contracts', 'job_offers', 'nda', 'certificates', 'letters', 'social_insurance', 'payslips', 'resignation']);
    expect(groups[0].slots.map((s) => s.key)[0]).toBe('agreement_freelance'); // reversed in, reversed out
  });

  it('leaves out empty folders', () => {
    expect(byFolder([{ folder: 'nda' as const }]).map((g) => g.folder)).toEqual(['nda']);
  });
});

describe('fileProblem', () => {
  it('takes a .docx up to 4 MB', () => {
    expect(fileProblem({ name: 'Contract.docx', size: 120_000 })).toBe('');
    expect(fileProblem({ name: 'CONTRACT.DOCX', size: 4 * 1024 * 1024 })).toBe('');
  });

  it('refuses another kind of file, or a larger one', () => {
    expect(fileProblem({ name: 'Contract.doc', size: 1000 })).toBe(NOT_DOCX);
    expect(fileProblem({ name: 'Contract.pdf', size: 1000 })).toBe(NOT_DOCX);
    expect(fileProblem({ name: 'Contract.docx', size: 4 * 1024 * 1024 + 1 })).toBe(TEMPLATE_TOO_LARGE);
  });
});
