import { describe, expect, it } from 'vitest';
import type { ApplicationListItem, CvUploadView, VacancyApplicantsGroup } from '@trendlix/shared';
import { APPLICATION_STAGE_LABELS } from '@trendlix/shared';
import {
  addCvApiForm,
  addCvProblems,
  batchSources,
  DEFAULT_BATCH_SOURCE,
  duplicateText,
  filtering,
  generalApiPath,
  generalHref,
  groupApplicants,
  inBatchRepeats,
  movableVacancies,
  readGeneralQuery,
  readTab,
  rowOf,
  saveRows,
  sourceFilterHref,
  stageCountsText,
  tabHref,
  uploadsApiPath,
} from './general';
import { readApplicantsQuery } from './recruitment';

// General CVs, the applicants by posted job and the bulk upload on the site (owner, 22 October 2026: "i want a proper
// viweing, what came out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from
// linkedin?" … "why not"). Every person here is made up.

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const AREA = '00000000-0000-4000-8000-000000000001';

const group = (id: string, total: number, extra: Partial<VacancyApplicantsGroup> = {}): VacancyApplicantsGroup => ({
  vacancy: { id, number: 'VAC-2026-0001', title: 'Video editor', status: 'open' },
  total,
  byStage: { applied: total, shortlisted: 0, interview: 0, offer: 0, hired: 0, rejected: 0 },
  filteredOut: 0,
  bySource: {},
  ...extra,
});

const row = (id: string, vacancyId: string) => ({ id, vacancy: { id: vacancyId } }) as unknown as ApplicationListItem;

describe('the Applicants page’s tabs', () => {
  it('reads the tab from the address, Posted jobs unless General CVs', () => {
    expect(readTab({})).toBe('posted');
    expect(readTab({ tab: 'general' })).toBe('general');
    expect(readTab({ tab: 'other' })).toBe('posted');
    expect(tabHref('general')).toBe('/recruitment/applicants?tab=general');
    expect(tabHref('posted')).toBe('/recruitment/applicants');
  });

  it('groups the applicants by vacancy in the summary’s order, leaving out those without a match while filtering', () => {
    const groups = [group(V1, 2), group(V2, 1)];
    const rows = [row('a', V2), row('b', V1), row('c', V1)];
    const out = groupApplicants(groups, rows, false);
    expect(out.map((g) => [g.group.vacancy.id, g.rows.map((r) => r.id)])).toEqual([
      [V1, ['b', 'c']],
      [V2, ['a']],
    ]);
    // all of a vacancy's filtered out: kept unless filtering
    expect(groupApplicants(groups, [row('b', V1)], false).map((g) => g.rows.length)).toEqual([1, 0]);
    expect(groupApplicants(groups, [row('b', V1)], true).map((g) => g.group.vacancy.id)).toEqual([V1]);
  });

  it('knows when a filter narrows the list', () => {
    expect(filtering(readApplicantsQuery({}))).toBe(false);
    expect(filtering(readApplicantsQuery({ source: 'linkedin' }))).toBe(true);
    expect(filtering(readApplicantsQuery({ filtered: 'only' }))).toBe(true);
  });

  it('links a source’s count to its applicants, those filtered out too', () => {
    expect(sourceFilterHref(V1, 'linkedin')).toBe(`/recruitment/applicants?vacancyId=${V1}&source=linkedin&filtered=all`);
  });

  it('says a vacancy’s stages in a line, those with none left out', () => {
    const g = group(V1, 6, { byStage: { applied: 3, shortlisted: 2, interview: 0, offer: 0, hired: 0, rejected: 0 }, filteredOut: 1 });
    expect(stageCountsText(g, APPLICATION_STAGE_LABELS)).toBe('Applied 3 · Shortlisted 2 · Filtered out 1');
  });
});

describe('the general CVs’ list', () => {
  it('reads its filters, dropping what isn’t one', () => {
    expect(readGeneralQuery({ status: 'reviewed', source: 'whatsapp', departmentId: AREA, q: ' mona ' })).toEqual({ status: 'reviewed', source: 'whatsapp', departmentId: AREA, q: 'mona' });
    expect(readGeneralQuery({ status: 'deleted', source: 'tiktok', departmentId: 'x' })).toEqual({ status: '', source: '', departmentId: '', q: '' });
    expect(readGeneralQuery({ status: 'all' }).status).toBe('all');
  });

  it('builds the API’s and the tab’s addresses', () => {
    expect(generalApiPath({})).toBe('/recruitment/general-cvs');
    expect(generalApiPath({ status: 'new', q: 'mona' })).toBe('/recruitment/general-cvs?status=new&q=mona');
    expect(generalHref({ source: 'referral' })).toBe('/recruitment/applicants?source=referral&tab=general');
  });

  it('offers the open vacancies and those on hold to add a CV to', () => {
    const list = [{ id: '1', status: 'open' }, { id: '2', status: 'draft' }, { id: '3', status: 'on_hold' }, { id: '4', status: 'closed' }] as unknown as Parameters<typeof movableVacancies>[0];
    expect(movableVacancies(list).map((v) => v.id)).toEqual(['1', '3']);
  });
});

describe('HR’s Add a CV', () => {
  const fd = (fields: Record<string, string>, cv = true) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    if (cv) f.set('cv', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'cv.pdf');
    return f;
  };
  const person = { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', area: AREA, consent: 'on' };

  it('asks how it came, who referred them, the agreement and the CV', () => {
    expect(addCvProblems(fd({ ...person, source: 'email' }))).toEqual([]);
    expect(addCvProblems(fd({ ...person, source: 'referral' }))).toEqual(['Write who referred them.']);
    expect(addCvProblems(fd({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+20 100 123 4567', area: AREA }, false))).toEqual([
      'Choose how the CV came: email, WhatsApp, LinkedIn, in person, referral or other.',
      'Tick that the person agreed to be considered.',
      'Attach the CV, as a PDF or a Word file.',
    ]);
  });

  it('is passed on with the source, the referrer (a referral’s only) and the notes', () => {
    const out = addCvApiForm(fd({ ...person, source: 'referral', referrer: 'Omar Khaled', notes: ' Strong reel ' }));
    expect(out.get('source')).toBe('referral');
    expect(out.get('referrer')).toBe('Omar Khaled');
    expect(out.get('notes')).toBe('Strong reel');
    expect(out.get('departmentId')).toBe(AREA);
    expect(out.get('cv')).toBeInstanceOf(Blob);
    expect(addCvApiForm(fd({ ...person, source: 'email', referrer: 'Omar Khaled' })).get('referrer')).toBeNull();
  });
});

describe('the bulk upload', () => {
  const upload = (over: Partial<CvUploadView> = {}): CvUploadView => ({
    id: 'u1',
    fileName: 'mona_adel_cv.pdf',
    sizeBytes: 1000,
    textFound: true,
    guess: { fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567' },
    duplicate: null,
    uploadedAt: '2026-10-22T10:00:00.000Z',
    ...over,
  });
  const vacancy = { kind: 'vacancy', vacancyId: V1 } as const;
  const general = { kind: 'general' } as const;

  it('sends a batch to its vacancy, or to the general CVs', () => {
    expect(uploadsApiPath(vacancy)).toBe(`/recruitment/cv-uploads?vacancyId=${V1}`);
    expect(uploadsApiPath(general)).toBe('/recruitment/cv-uploads');
    expect(batchSources(vacancy)).not.toContain('general');
    expect(batchSources(general)).not.toContain('careers');
  });

  it('starts a row from what the CV said, LinkedIn as the source; a scanned one empty', () => {
    expect(rowOf(upload())).toMatchObject({ fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', source: DEFAULT_BATCH_SOURCE, skip: false, keep: false });
    expect(DEFAULT_BATCH_SOURCE).toBe('linkedin');
    expect(rowOf(upload({ textFound: false, guess: { fullName: 'Scan', email: null, mobile: null } }))).toMatchObject({ fullName: 'Scan', email: '', mobile: '' });
  });

  it('saves a vacancy’s rows without a general CV’s area, and a general CV’s with it', () => {
    const r = { ...rowOf(upload()), fullName: ' Mona Adel ', departmentId: AREA, referrer: 'Omar' };
    expect(saveRows([r], vacancy)).toEqual([{ id: 'u1', fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', source: 'linkedin' }]);
    expect(saveRows([r], general)).toEqual([{ id: 'u1', fullName: 'Mona Adel', email: 'mona@mail.test', mobile: '+201001234567', source: 'linkedin', departmentId: AREA, areaOther: null, referrer: null, keep: false }]);
    expect(saveRows([{ ...r, departmentId: 'other', areaOther: ' Photography ', source: 'referral', keep: true }], general)[0]).toMatchObject({ departmentId: null, areaOther: 'Photography', referrer: 'Omar', keep: true });
    expect(saveRows([{ ...r, skip: true }], vacancy)[0]).toMatchObject({ skip: true });
  });

  it('flags an email repeated in the batch, as typed, and says what a duplicate means', () => {
    const rows = [rowOf(upload()), { ...rowOf(upload({ id: 'u2' })), email: 'MONA@mail.test ' }, { ...rowOf(upload({ id: 'u3' })), skip: true }];
    expect([...inBatchRepeats(rows)]).toEqual(['u2']);
    expect(duplicateText(null, vacancy)).toBeNull();
    expect(duplicateText({ reference: 'APP-2026-0007', inBatch: false, date: '2026-10-01' }, vacancy)).toBe('Applied for this job already (APP-2026-0007): it will be skipped.');
    expect(duplicateText({ reference: 'APP-2026-0007', inBatch: false, date: '2026-10-01' }, general)).toBe('Sent a CV in the last 30 days (APP-2026-0007): tick Keep to save it anyway.');
    expect(duplicateText({ reference: null, inBatch: true, date: null }, general)).toBe('The same email is earlier in this batch.');
  });
});
