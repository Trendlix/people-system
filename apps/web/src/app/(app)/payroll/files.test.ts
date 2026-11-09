import { describe, expect, it } from 'vitest';
import {
  apiBatchFilePath,
  apiFilePath,
  bankFilesReady,
  bankLabel,
  bankLeftOut,
  byName,
  batchFileHref,
  batchHiddenText,
  batchMarks,
  batchNote,
  batchPeople,
  batchTitle,
  confirmSentText,
  departmentsOf,
  discardText,
  fileHref,
  heldByLine,
  isFileKind,
  leftOf,
  makesBankBatches,
  overpaidNote,
  owedNote,
  owedOf,
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
  const batch = (number: number, file: 'cib' | 'ach', lineIds: string[], sentAt: string | null, amount = 1) => ({
    number,
    file,
    sentAt,
    people: lineIds.length,
    total: 0,
    hidden: 0,
    lines: lineIds.map((lineId) => ({ lineId, amount })),
  });

  it('lists each file’s people: not on hold, something to transfer, details the file pays', () => {
    expect(payees(lines, 'cib').map((l) => l.id)).toEqual(['a', 'b']);
    expect(payees(lines, 'ach').map((l) => l.id)).toEqual(['c', 'w']);
    expect(payees(lines, 'ach').map(bankLabel)).toEqual(['QNB', 'Wallet']);
    expect(departmentsOf(payees(lines, 'cib'))).toEqual(['Finance', 'Studio']);
  });

  it('says which batches hold a line, sent or not yet', () => {
    const marks = batchMarks([batch(2, 'cib', ['b'], null), batch(1, 'cib', ['a'], '2026-11-05T10:00:00Z'), batch(3, 'cib', ['a'], null)]);
    expect(batchNote(marks.get('a'))).toBe('Sent in batch 1 on 05/11/2026; In batch 3, not confirmed sent yet');
    expect(batchNote(marks.get('b'))).toBe('In batch 2, not confirmed sent yet');
    expect(batchNote(marks.get('c'))).toBeNull();
  });

  // owner, 5 November 2026: "batches sent to the back employees are not to be selected again instead there is an edit and
  // they have remaining payment"; asked, "if there was a problem in the employee calculation and has been edited", "No, reserved"
  it('owes each person what is left of their transfer once every batch (sent or not) is taken off, to the piaster', () => {
    const batches = [batch(1, 'cib', ['a'], '2026-11-05T10:00:00Z', 900.05), batch(2, 'cib', ['a', 'b'], null, 100.05)];
    const held = heldByLine(batches);
    expect(held.get('a')).toBe(1000.1);
    expect(held.get('b')).toBe(100.05);
    expect(leftOf(lines[0], held)).toBe(0);
    expect(leftOf(lines[1], held)).toBe(1900.15);
    expect(leftOf(lines[4], held)).toBe(3000.3);
    // a correction downwards after the batches: paid more than the line is now
    expect(leftOf({ id: 'a', result: { transfer: 900 } }, held)).toBe(-100.1);
  });

  it('ticks those still owed something; those paid in full are apart, never ticked', () => {
    const batches = [batch(1, 'cib', ['a'], '2026-11-05T10:00:00Z', 1000.1), batch(2, 'cib', ['b'], null, 500)];
    const { owed, paid } = owedOf(payees(lines, 'cib'), batches);
    expect(owed.map((p) => [p.id, p.held, p.left])).toEqual([['b', 500, 1500.2]]);
    expect(paid.map((p) => [p.id, p.held, p.left])).toEqual([['a', 1000.1, 0]]);
    expect([...startTicks(owed)]).toEqual(['b']);
    const marks = batchMarks(batches);
    expect(owedNote(owed[0], marks)).toBe('EGP 1,500.20 left · EGP 500.00 in batch 2');
    expect(owedNote({ id: 'c', held: 0, left: 3000.3 }, marks)).toBeNull();
    expect(owedNote({ id: 'b', held: 700, left: 1 }, batchMarks([...batches, batch(4, 'cib', ['b'], null, 200)]))).toBe('EGP 1.00 left · EGP 700.00 in batches 2 and 4');
    expect(overpaidNote({ left: -100.1 })).toBe('Paid EGP 100.10 more than the corrected transfer');
    expect(overpaidNote({ left: 0 })).toBeNull();
  });

  it('adds up what is left to the ticked people, to the piaster', () => {
    const owed = [
      { id: 'a', left: 1000.1 },
      { id: 'b', left: 2000.2 },
      { id: 'c', left: 3000.3 },
    ];
    expect(tickedTotal(owed, new Set(['a', 'b']))).toBe(3000.3);
    expect(tickedTotal(owed, new Set(['a', 'b', 'c']))).toBe(6000.6);
    expect(tickedTotal(owed, new Set())).toBe(0);
  });

  it('lists a batch’s people with the amount it holds for each, in the run’s order', () => {
    const b = { lines: [{ lineId: 'c', amount: 3000.3 }, { lineId: 'a', amount: 500 }] };
    expect(batchPeople(b, lines).map((l) => [l.id, l.amount])).toEqual([
      ['a', 500],
      ['c', 3000.3],
    ]);
  });

  it('names a batch, and asks before it is confirmed sent or discarded', () => {
    const b = { number: 2, file: 'ach' as const, people: 7, total: 90000, hidden: 0 };
    expect(batchTitle(b)).toBe('Batch 2 · ACH file · 7 people · EGP 90,000.00');
    expect(batchTitle({ ...b, file: 'cib', people: 1 })).toBe('Batch 2 · CIB file · 1 person · EGP 90,000.00');
    expect(confirmSentText(b)).toBe('Confirm batch 2 (ACH, 7 people, EGP 90,000.00) was sent to the bank?');
    expect(discardText(b)).toBe("Discard batch 2? What it holds can be ticked again. Only when it wasn't sent to the bank.");
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

// the CIB and ACH lists by name (owner, 9 November 2026: "sort alphabetically")
describe('a bank file’s people by name', () => {
  it('A to Z, case and accents aside, the same name by employee code', () => {
    const people = [
      { id: '1', name: 'Youssef Ramadan', employeeCode: 'EMP-0019' },
      { id: '2', name: 'ahmed Tarek', employeeCode: 'EMP-0005' },
      { id: '3', name: 'Marina Samir', employeeCode: 'EMP-0010' },
      { id: '4', name: 'Marina Samir', employeeCode: 'EMP-0002' },
      { id: '5', name: 'Émad Ali', employeeCode: null },
    ];
    expect(byName(people).map((p) => p.id)).toEqual(['2', '5', '4', '3', '1']);
    expect(people.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});
