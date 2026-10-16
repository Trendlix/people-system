import { describe, expect, it } from 'vitest';
import { apiFilePath, bankFilesReady, bankLeftOut, fileHref, isFileKind, passSheetOn, valueDateFrom, XLSX } from './files';

const RUN = '33333333-3333-4333-8333-333333333333';

describe('a run’s files', () => {
  it('are downloaded under the web domain, and asked of the API with the CIB file’s value date', () => {
    expect(fileHref(RUN, 'register')).toBe(`/payroll/${RUN}/files/register`);
    expect(apiFilePath(RUN, 'register', null)).toBe(`/payroll/runs/${RUN}/files/register`);
    expect(apiFilePath(RUN, 'cib', '2026-10-16')).toBe(`/payroll/runs/${RUN}/files/cib?valueDate=2026-10-16`);
    // only the CIB file has a value date
    expect(apiFilePath(RUN, 'ach', '2026-10-16')).toBe(`/payroll/runs/${RUN}/files/ach`);
  });

  it('knows the files there are', () => {
    expect(['register', 'cib', 'ach'].every(isFileKind)).toBe(true);
    expect(isFileKind('payslips')).toBe(false);
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
