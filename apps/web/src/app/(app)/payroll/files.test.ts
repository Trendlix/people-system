import { describe, expect, it } from 'vitest';
import {
  apiBatchFilePath,
  apiFilePath,
  bankFilesReady,
  bankLabel,
  bankLeftOut,
  batchFileHref,
  batchHiddenText,
  batchMarks,
  batchNote,
  batchTitle,
  confirmSentText,
  departmentsOf,
  discardText,
  fileHref,
  isFileKind,
  makesBankBatches,
  passSheetOn,
  payees,
  startTicks,
  tickedTotal,
  valueDateFrom,
  XLSX,
} from './files';

const RUN = '33333333-3333-4333-8333-333333333333';
const BATCH = '44444444-4444-4444-8444-444444444444';

describe('a run’s files', () => {
  it('are downloaded under the web domain, and asked of the API', () => {
    expect(fileHref(RUN, 'register')).toBe(`/payroll/${RUN}/files/register`);
    expect(apiFilePath(RUN, 'register')).toBe(`/payroll/runs/${RUN}/files/register`);
    expect(apiFilePath(RUN, 'eta')).toBe(`/payroll/runs/${RUN}/files/eta`);
    expect(fileHref(RUN, 'eta')).toBe(`/payroll/${RUN}/files/eta`);
    // the bank files are a batch's (5 November 2026)
    expect(batchFileHref(RUN, BATCH)).toBe(`/payroll/${RUN}/bank-batches/${BATCH}/file`);
    expect(apiBatchFilePath(RUN, BATCH)).toBe(`/payroll/runs/${RUN}/bank-batches/${BATCH}/file`);
  });

  it('knows the files there are: the bank files are made batch by batch', () => {
    expect(['register', 'eta'].every(isFileKind)).toBe(true);
    for (const kind of ['cib', 'ach', 'payslips']) expect(isFileKind(kind)).toBe(false);
  });

  it('makes the bank files once the CEO approved the run', () => {
    expect(bankFilesReady('draft')).toBe(false);
    expect(bankFilesReady('pending_ceo')).toBe(false);
    expect(bankFilesReady('approved')).toBe(true);
    expect(bankFilesReady('paid')).toBe(true);
  });

  it('reads the value date as typed on the page or as the API takes it, today when none', () => {
    expect(valueDateFrom('20/10/2026', '2026-10-16')).toBe('2026-10-20');
    expect(valueDateFrom('2026-10-20', '2026-10-16')).toBe('2026-10-20');
    expect(valueDateFrom('', '2026-10-16')).toBe('2026-10-16');
    expect(valueDateFrom(null, '2026-10-16')).toBe('2026-10-16');
    expect(valueDateFrom('31/02/2026', '2026-10-16')).toBeNull();
    expect(valueDateFrom('2026-02-31', '2026-10-16')).toBeNull();
    expect(valueDateFrom('soon', '2026-10-16')).toBeNull();
  });
});

describe('passing the Excel file on', () => {
  const fromApi = (body: string, headers: Record<string, string>) => new Response(body, { headers });

  it('saves it under the name the API sends, with nothing allowed to run in it', async () => {
    const res = passSheetOn(fromApi('PK', { 'content-type': XLSX, 'content-disposition': 'attachment; filename="CIB SEP 2026.xlsx"', 'content-length': '2' }), 'x.xlsx')!;
    expect(res.headers.get('content-type')).toBe(XLSX);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="CIB SEP 2026.xlsx"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('content-length')).toBe('2');
    expect(await res.text()).toBe('PK');
  });

  it('names it when the API does not, saves it even when the API says inline, and refuses anything else', () => {
    expect(passSheetOn(fromApi('PK', { 'content-type': XLSX }), 'Payroll register.xlsx')?.headers.get('content-disposition')).toBe(
      'attachment; filename="Payroll register.xlsx"',
    );
    expect(passSheetOn(fromApi('PK', { 'content-type': XLSX, 'content-disposition': 'inline; filename="a.xlsx"' }), 'x')?.headers.get('content-disposition')).toBe(
      'attachment; filename="a.xlsx"',
    );
    expect(passSheetOn(fromApi('<html>', { 'content-type': 'text/html' }), 'x')).toBeNull();
  });
});

describe('who the bank files leave out', () => {
  const line = (id: string, onHold: boolean, transfer: number, problem: string | null) => ({
    id,
    onHold,
    result: { transfer },
    bank: { file: problem ? null : ('ach' as const), bankShort: problem ? null : 'QNB', problem },
  });

  it('lists the bank details to put right among those the bank pays, and those held or with nothing to pay', () => {
    const lines = [
      line('paid', false, 5000, null),
      line('no-bank', false, 5000, 'No bank details on file.'),
      line('held', true, 5000, 'No bank details on file.'),
      line('nothing', false, 0, null),
    ];
    const out = bankLeftOut(lines);
    expect(out.problems.map((l) => l.id)).toEqual(['no-bank']);
    expect(out.held.map((l) => l.id)).toEqual(['held']);
    expect(out.nothingToPay.map((l) => l.id)).toEqual(['nothing']);
  });
});

describe('bank transfer batches (owner, 5 November 2026)', () => {
  type L = Parameters<typeof payees>[0][number] & { name: string };
  const line = (id: string, file: 'cib' | 'ach' | null, transfer: number, more: Partial<L> = {}): L => ({
    id,
    name: id,
    department: null,
    onHold: false,
    result: { transfer },
    bank: { file, bankShort: file === 'cib' ? 'CIB' : 'QNB', problem: file ? null : 'No bank details on file.' },
    ...more,
  });
  const lines = [
    line('a', 'cib', 1000.1, { department: 'Studio' }),
    line('b', 'cib', 2000.2, { department: 'Finance' }),
    line('held', 'cib', 500, { onHold: true }),
    line('nothing', 'cib', 0),
    line('c', 'ach', 3000.3, { department: 'Studio' }),
    line('w', 'ach', 400, { bank: { file: 'ach', bankShort: 'MIDG', problem: null } }),
    line('none', null, 700),
  ];
  const batch = (number: number, file: 'cib' | 'ach', lineIds: string[], sentAt: string | null) => ({
    number,
    file,
    sentAt,
    people: lineIds.length,
    total: 0,
    hidden: 0,
    lines: lineIds.map((lineId) => ({ lineId, amount: 1 })),
  });

  it('lists each file’s people: not on hold, something to transfer, details the file pays', () => {
    expect(payees(lines, 'cib').map((l) => l.id)).toEqual(['a', 'b']);
    expect(payees(lines, 'ach').map((l) => l.id)).toEqual(['c', 'w']);
    expect(payees(lines, 'ach').map(bankLabel)).toEqual(['QNB', 'Wallet']);
    expect(departmentsOf(payees(lines, 'cib'))).toEqual(['Finance', 'Studio']);
  });

  it('starts with those in no batch yet ticked; those in one say which, still pickable', () => {
    const batches = [batch(2, 'cib', ['b'], null), batch(1, 'cib', ['a'], '2026-11-05T10:00:00Z')];
    expect([...startTicks(payees(lines, 'cib'), batches)]).toEqual([]);
    expect([...startTicks(payees(lines, 'cib'), [batches[0]])]).toEqual(['a']);
    const marks = batchMarks([...batches, batch(3, 'cib', ['a'], null)]);
    expect(batchNote(marks.get('a'))).toBe('Batch 1 · sent 05/11/2026; Batch 3 · not confirmed sent yet');
    expect(batchNote(marks.get('b'))).toBe('Batch 2 · not confirmed sent yet');
    expect(batchNote(marks.get('c'))).toBeNull();
  });

  it('adds up the ticked people’s transfer to the piaster', () => {
    expect(tickedTotal(lines, new Set(['a', 'b']))).toBe(3000.3);
    expect(tickedTotal(lines, new Set(['a', 'b', 'c']))).toBe(6000.6);
    expect(tickedTotal(lines, new Set())).toBe(0);
  });

  it('names a batch, and asks before it is confirmed sent or discarded', () => {
    const b = { number: 2, file: 'ach' as const, people: 7, total: 90000, hidden: 0 };
    expect(batchTitle(b)).toBe('Batch 2 · ACH file · 7 people · EGP 90,000.00');
    expect(batchTitle({ ...b, file: 'cib', people: 1 })).toBe('Batch 2 · CIB file · 1 person · EGP 90,000.00');
    expect(confirmSentText(b)).toBe('Confirm batch 2 (ACH, 7 people, EGP 90,000.00) was sent to the bank?');
    expect(discardText(b)).toBe("Discard batch 2? Its people can be ticked again. Only when it wasn't sent to the bank.");
    expect(batchHiddenText(b)).toBeNull();
    expect(batchHiddenText({ hidden: 2 })).toBe('C-level (2 people) — hidden');
  });

  it('are made by those who see payroll (HR, Finance, the CEO); never a developer, nor someone only viewing as another', () => {
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(makesBankBatches({ roles: [role] })).toBe(true);
    expect(makesBankBatches({ roles: ['employee', 'manager'] })).toBe(false);
    expect(makesBankBatches({ roles: ['ceo', 'super_admin'], developer: true })).toBe(false);
    expect(makesBankBatches({ roles: ['hr'], viewAs: { by: { id: 'x', email: 'x@example.com' }, act: false } })).toBe(false);
    expect(makesBankBatches({ roles: ['hr'], viewAs: { by: { id: 'x', email: 'x@example.com' }, act: true } })).toBe(true);
  });
});
