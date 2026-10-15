import { describe, expect, it } from 'vitest';
import type { DocumentItem, GeneratedDocument } from '../../../../../lib/types';
import {
  contractGroups,
  contractGroupTitle,
  documentFileHref,
  inputsText,
  isMissingRoute,
  itemContext,
  missingHref,
  missingLinks,
  newestFirst,
  nextSteps,
  orderedSections,
  progressSteps,
  sectionTitle,
  signedFileHref,
  signedMimeType,
  signersText,
  templateStateText,
} from './wording';

const ID = 'emp-1';

const doc = (over: Partial<GeneratedDocument> = {}): GeneratedDocument => ({
  id: 'doc-1',
  status: 'generated',
  fileName: 'Contract.docx',
  sizeBytes: 24_000,
  templateVersion: 2,
  documentDate: '2026-10-15',
  generatedBy: { email: 'hr@trendlix.com' },
  generatedAt: '2026-10-15T09:00:00.000Z',
  printedAt: null,
  signedUploadedAt: null,
  verifiedAt: null,
  verifiedBy: null,
  signedFileName: null,
  note: null,
  ...over,
});

const item = (over: Partial<DocumentItem> = {}): DocumentItem => ({
  slotKey: 'contract_full_time',
  name: 'Contract · Full-time (official copy)',
  templateStatus: 'published',
  templateVersion: 3,
  needsInputs: [],
  documents: [],
  ...over,
});

describe('where a missing detail is filled in', () => {
  it('links a profile field to its cell on its tab', () => {
    expect(missingHref(ID, { tab: 'basic', key: 'insuranceNo' })).toBe('/employees/emp-1#field-insuranceNo');
    expect(missingHref(ID, { tab: 'employment', key: 'team' })).toBe('/employees/emp-1?tab=employment#field-team');
    expect(missingHref(ID, { tab: 'education', key: 'qualificationAr' })).toBe('/employees/emp-1?tab=education#field-qualificationAr');
  });

  it('links a paper of the employee file to its row', () => {
    expect(missingHref(ID, { tab: 'documents', key: 'birth_certificate' })).toBe('/employees/emp-1?tab=documents#paper-birth_certificate');
  });

  it('sends the company’s details to the company profile, and a contract term to the contract on this tab', () => {
    expect(missingHref(ID, { tab: 'company', key: 'taxRegNo' })).toBe('/organization/company');
    expect(missingHref(ID, { tab: 'contracts', key: 'grossSalary' })).toBe('/employees/emp-1?tab=contracts#contract');
    expect(missingHref(ID, { tab: 'contracts', key: 'contract' })).toBe('/employees/emp-1?tab=contracts#contract');
  });

  it('gives no link for a place it doesn’t know, and the tab alone without a key', () => {
    expect(missingHref(ID, { tab: 'payroll', key: 'month' })).toBeNull();
    expect(missingHref(ID, { tab: 'employment', key: '' })).toBe('/employees/emp-1?tab=employment');
  });

  it('lists each missing detail with its label, place and link', () => {
    expect(
      missingLinks(ID, [
        { tag: 'insurance_no', label: 'Social insurance number', where: { tab: 'basic', key: 'insuranceNo' } },
        { tag: 'tax_reg_no', label: '', where: { tab: 'company', key: 'taxRegNo' } },
      ]),
    ).toEqual([
      { tag: 'insurance_no', label: 'Social insurance number', place: 'Basic Data', href: '/employees/emp-1#field-insuranceNo' },
      { tag: 'tax_reg_no', label: 'tax_reg_no', place: 'Company profile', href: '/organization/company' },
    ]);
  });
});

describe('the sections', () => {
  it('come in the tab’s order, unknown ones last', () => {
    const keys = orderedSections([{ key: 'leaving' }, { key: 'other' }, { key: 'contract' }, { key: 'letters' }, { key: 'insurance' }, { key: 'hiring' }]).map(
      (s) => s.key,
    );
    expect(keys).toEqual(['contract', 'hiring', 'insurance', 'letters', 'leaving', 'other']);
  });

  it('are titled for the screen', () => {
    expect(sectionTitle('insurance')).toBe('Social Insurance');
    expect(sectionTitle('letters')).toBe('Letters & Certificates');
    expect(sectionTitle('other')).toBe('other');
  });
});

describe('an item', () => {
  it('names its contract version', () => {
    expect(itemContext({ contractNumber: 'CON-2026-0001', contractVersion: 2 })).toBe('Contract CON-2026-0001, v2');
    expect(itemContext({ contractNumber: null, contractVersion: null })).toBeNull();
  });

  it('says where its template stands', () => {
    expect(templateStateText({ templateStatus: 'missing', templateVersion: null }).text).toBe('No template yet');
    expect(templateStateText({ templateStatus: 'draft', templateVersion: null }).text).toBe('Draft template only, publish it first');
    expect(templateStateText({ templateStatus: 'published', templateVersion: 3 }).text).toBe('Template v3');
  });

  it('groups a contract’s documents by version, newest first', () => {
    const groups = contractGroups([
      item({ contractId: 'c1', contractNumber: 'CON-2026-0001', contractVersion: 1 }),
      item({ contractId: 'c2', contractNumber: 'CON-2026-0002', contractVersion: 2 }),
      item({ slotKey: 'contract_full_time_insurance', contractId: 'c2', contractNumber: 'CON-2026-0002', contractVersion: 2 }),
    ]);
    expect(groups.map((g) => [g.contractId, g.items.map((i) => i.slotKey)])).toEqual([
      ['c2', ['contract_full_time', 'contract_full_time_insurance']],
      ['c1', ['contract_full_time']],
    ]);
    expect(contractGroupTitle(groups[0])).toBe('Contract CON-2026-0002 · Version 2');
  });

  it('says who signs it, from the template library', () => {
    expect(signersText('contract_full_time')).toBe('the employee and the company');
    expect(signersText('resignation_request')).toBe('the employee');
    expect(signersText('payslip_en')).toBeNull();
  });
});

describe('a generated document', () => {
  it('lists the newest first', () => {
    const older = doc({ id: 'a', generatedAt: '2026-10-14T09:00:00.000Z' });
    const newer = doc({ id: 'b', generatedAt: '2026-10-15T09:00:00.000Z' });
    expect(newestFirst([older, newer]).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('goes Generated → Printed → Signed copy uploaded → Verified, with when and who', () => {
    const steps = progressSteps(
      doc({ status: 'signed', printedAt: '2026-10-15T10:00:00.000Z', signedUploadedAt: '2026-10-16T08:00:00.000Z', signedUploadedBy: { email: 'a@b.c' } }),
    );
    expect(steps.map((s) => [s.label, Boolean(s.at), s.by])).toEqual([
      ['Generated', true, 'hr@trendlix.com'],
      ['Printed', true, null],
      ['Signed copy uploaded', true, 'a@b.c'],
      ['Verified', false, null],
    ]);
  });

  it('offers HR the next step: print, upload (again before it is verified), verify', () => {
    expect(nextSteps('generated')).toEqual({ print: true, upload: true, reupload: false, verify: false });
    expect(nextSteps('printed')).toEqual({ print: false, upload: true, reupload: false, verify: false });
    expect(nextSteps('signed')).toEqual({ print: false, upload: false, reupload: true, verify: true });
    expect(nextSteps('verified')).toEqual({ print: false, upload: false, reupload: false, verify: false });
  });

  it('is downloaded and viewed through the web server', () => {
    expect(documentFileHref(ID, 'doc-1')).toBe('/employees/emp-1/documents/doc-1/file');
    expect(signedFileHref(ID, 'doc-1')).toBe('/employees/emp-1/documents/doc-1/signed-file');
  });

  it('tells a signed PDF from a photo', () => {
    expect(signedMimeType({ signedFileName: 'x.jpg', signedMime: 'application/pdf' })).toBe('application/pdf');
    expect(signedMimeType({ signedFileName: 'Signed.PDF' })).toBe('application/pdf');
    expect(signedMimeType({ signedFileName: 'scan.png' })).toBe('image/png');
    expect(signedMimeType({ signedFileName: 'photo.jpeg' })).toBe('image/jpeg');
  });

  it('shows what was typed for a letter', () => {
    expect(inputsText({ letter_to: 'The Embassy of Italy', letter_purpose: ' Visa ' })).toBe('Addressed to: The Embassy of Italy · Purpose: Visa');
    expect(inputsText({ letter_to: '' })).toBeNull();
    expect(inputsText(null)).toBeNull();
  });
});

describe('a server without document generation', () => {
  it('is told by its own "Cannot GET" answer', () => {
    expect(isMissingRoute(['Cannot GET /api/employees/x/documents'])).toBe(true);
    expect(isMissingRoute(['There is no published template for NDA. Upload it in Templates first.'])).toBe(false);
  });
});
