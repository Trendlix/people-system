import { TEMPLATE_SLOTS, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { TemplateSlotView } from '../../../lib/types';
import {
  appliesToLabel,
  BILINGUAL_HINT,
  byFolder,
  draftIssues,
  draftText,
  fieldsHref,
  fieldsSampleHref,
  fieldsSummary,
  fileProblem,
  inUseText,
  languageLabel,
  managesTemplates,
  NOT_TEMPLATE_FILE,
  PDF_TEMPLATE_TOO_LARGE,
  pdfPublishBlock,
  progress,
  publishConfirm,
  seesTemplates,
  sourceName,
  STANDARD_LAYOUT_APPLIED,
  standardLayoutConfirm,
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
  // owner, 19 October 2026: "enable templates sidebar to super admin only"
  it('lets only a Super Admin see it', () => {
    expect(seesTemplates(as('employee', 'super_admin'))).toBe(true);
    expect(seesTemplates(as('employee', 'hr'))).toBe(false);
    expect(seesTemplates(as('employee', 'admin'))).toBe(false);
    expect(seesTemplates(as('employee', 'ceo'))).toBe(false);
    expect(seesTemplates(as('employee', 'finance'))).toBe(false);
    expect(seesTemplates(as('employee', 'manager'))).toBe(false);
    expect(seesTemplates(as('employee'))).toBe(false);
  });

  it('lets only a Super Admin upload and publish', () => {
    expect(managesTemplates(as('employee', 'super_admin'))).toBe(true);
    expect(managesTemplates(as('employee', 'hr'))).toBe(false);
    expect(managesTemplates(as('employee', 'admin'))).toBe(false);
    expect(managesTemplates(as('employee', 'ceo'))).toBe(false);
  });
});

describe('a slot as the library words it', () => {
  it('names the language, or says it is chosen on upload', () => {
    expect(languageLabel('ar')).toBe('Arabic');
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel(null)).toBe('Arabic, English or both, chosen on upload');
    expect(languageLabel('bilingual')).toBe('Arabic and English');
    expect(BILINGUAL_HINT).toContain('{{job_title_ar}} and {{job_title_en}}');
  });

  it('names the employment types, or says all of them', () => {
    expect(appliesToLabel(['full_time'])).toBe('Full-time');
    expect(appliesToLabel(['part_time', 'trainee'])).toBe('Part-time, Trainee');
    expect(appliesToLabel(['full_time', 'part_time', 'trainee', 'intern', 'freelance'])).toBe('All employment types');
    // the unpaid internship (19 October 2026) is one of them
    expect(appliesToLabel(['full_time', 'part_time', 'trainee', 'freelance'])).toBe('Full-time, Part-time, Trainee, Freelance (outside the labour law)');
    expect(appliesToLabel(['trainee', 'intern'])).toBe('Trainee, Unpaid internship (outside the labour law)');
    // the Sales slots (18 October 2026): full-time paid by commission
    expect(appliesToLabel(['full_time'], true)).toBe('Full-time, paid by commission (the full-time one until this is published)');
    expect(appliesToLabel(['freelance'])).toBe('Freelance (outside the labour law)');
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

// Use the standard layout on Place Fields (owner, 16 October 2026)
describe('the standard layout', () => {
  it('asks first, saying the fields placed or moved are replaced, and unsaved changes lost when there are some', () => {
    expect(standardLayoutConfirm(false)).toBe('Replace the fields on this form with the standard layout? Fields you placed or moved are replaced.');
    expect(standardLayoutConfirm(true)).toBe(
      'Replace the fields on this form with the standard layout? Fields you placed or moved are replaced. Your unsaved changes will be lost.',
    );
    expect(STANDARD_LAYOUT_APPLIED).toBe('Standard layout applied.');
  });
});

describe('progress', () => {
  it('counts the templates in use, not the copy slots', () => {
    // the social insurance copy of the full-time contract has its own file, so every slot counts
    const slots = library();
    // the trainee's training agreement and job offer have their own since 19 October 2026
    expect(progress(slots)).toEqual({ inUse: 0, total: 27, text: '0 of 27 templates in use' });

    slots[0].published = published(1); // the full-time contract (official copy)
    slots[1].published = published(1); // its social insurance copy, a template of its own
    slots[5].latestDraft = draft(1); // a draft isn't in use
    expect(progress(slots).text).toBe('2 of 27 templates in use');
    // a slot printed from another's file is not counted
    expect(progress([{ copyOf: 'contract_full_time', published: published(1) }, { copyOf: null, published: published(1) }]).text).toBe('1 of 1 template in use');
  });

  it('says one template in the singular', () => {
    expect(progress([{ copyOf: null, published: published(1) }]).text).toBe('1 of 1 template in use');
  });
});

describe('byFolder', () => {
  it('groups the slots in the library’s folder order, keeping their order within a folder', () => {
    const groups = byFolder([...library()].reverse());
    expect(groups.map((g) => g.folder)).toEqual(['contracts', 'job_offers', 'nda', 'certificates', 'letters', 'social_insurance', 'payslips', 'resignation']);
    expect(groups[0].slots.map((s) => s.key)[0]).toBe('contract_amendment'); // reversed in, reversed out: the salary amendment is the last contract slot
  });

  it('leaves out empty folders', () => {
    expect(byFolder([{ folder: 'nda' as const }]).map((g) => g.folder)).toEqual(['nda']);
  });
});

describe('fileProblem', () => {
  it('takes a .docx or a PDF up to 4 MB', () => {
    expect(fileProblem({ name: 'Contract.docx', size: 120_000 })).toBe('');
    expect(fileProblem({ name: 'CONTRACT.DOCX', size: 4 * 1024 * 1024 })).toBe('');
    expect(fileProblem({ name: 'Form 1.pdf', size: 700_000 })).toBe('');
    expect(fileProblem({ name: 'FORM 6.PDF', size: 4 * 1024 * 1024 })).toBe('');
  });

  it('refuses another kind of file, or a larger one', () => {
    expect(fileProblem({ name: 'Contract.doc', size: 1000 })).toBe(NOT_TEMPLATE_FILE);
    expect(fileProblem({ name: 'Form.png', size: 1000 })).toBe(NOT_TEMPLATE_FILE);
    expect(fileProblem({ name: 'Contract.docx', size: 4 * 1024 * 1024 + 1 })).toBe(TEMPLATE_TOO_LARGE);
    expect(fileProblem({ name: 'Form 1.pdf', size: 4 * 1024 * 1024 + 1 })).toBe(PDF_TEMPLATE_TOO_LARGE);
  });
});

describe('PDF templates', () => {
  it('says a PDF draft has no fields placed yet, as a step and not an error', () => {
    const draft = { id: 'd', version: 2, fileName: 'Form 1.pdf', uploadedAt: '', unknownTags: [], broken: [], format: 'pdf' as const, fieldCount: 0 };
    expect(draftText(draft)).toBe('Draft v2, not published: no fields placed yet');
    expect(statusLines({ published: null, latestDraft: draft })).toEqual([{ text: 'Draft v2, not published: no fields placed yet', tone: 'warn' }]);
    expect(draftText({ ...draft, fieldCount: 5 })).toBe('Draft v2, not published');
  });

  it('links to Place Fields and to Test print', () => {
    expect(fieldsHref('insurance_form_1', 'v-1')).toBe('/templates/insurance_form_1/versions/v-1/fields');
    expect(fieldsSampleHref('v-1')).toBe('/templates/versions/v-1/fields/sample');
  });

  it('says how many pages and fields a PDF version has', () => {
    expect(fieldsSummary({ pageCount: 2, fieldCount: 14 })).toBe('2 pages · 14 fields placed');
    expect(fieldsSummary({ pageCount: 1, fieldCount: 1 })).toBe('1 page · 1 field placed');
    expect(fieldsSummary({ pageCount: 2, fieldCount: 0 })).toBe('2 pages · No fields placed yet');
    expect(fieldsSummary({ pageCount: null, fieldCount: null })).toBe('No fields placed yet');
  });

  it('holds back publishing a PDF draft with no fields, never a Word one', () => {
    expect(pdfPublishBlock({ format: 'pdf', fieldCount: 0 })).toMatch(/no fields are placed/);
    expect(pdfPublishBlock({ format: 'pdf', fieldCount: 3 })).toBeNull();
    expect(pdfPublishBlock({ format: 'pdf', fieldCount: null })).toBeNull();
    expect(pdfPublishBlock({ format: 'docx', fieldCount: null })).toBeNull();
    expect(pdfPublishBlock({})).toBeNull();
  });
});
