import { describe, expect, it } from 'vitest';
import type { EmployeePayslip } from '../../../lib/types';
import {
  apiPayslipPath,
  apiPayslipsZipPath,
  isPayslipLanguage,
  NOT_DRAWN_YET,
  passZipOn,
  payslipHref,
  payslipRows,
  payslipsIssued,
  payslipsIssuedLabel,
  payslipsZipHref,
  ZIP,
} from './payslips';

const RUN = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';

describe('payslips', () => {
  it('are opened and downloaded under the web domain, and asked of the API', () => {
    expect(payslipsZipHref(RUN)).toBe(`/payroll/${RUN}/payslips`);
    expect(payslipHref(LINE, 'en')).toBe(`/payroll/lines/${LINE}/payslip/en`);
    expect(payslipHref(LINE, 'ar')).toBe(`/payroll/lines/${LINE}/payslip/ar`);
    expect(apiPayslipsZipPath(RUN)).toBe(`/payroll/runs/${RUN}/payslips`);
    expect(apiPayslipPath(LINE, 'ar')).toBe(`/payroll/lines/${LINE}/payslip/ar`);
  });

  it('come in English and Arabic', () => {
    expect(isPayslipLanguage('en')).toBe(true);
    expect(isPayslipLanguage('ar')).toBe(true);
    expect(isPayslipLanguage('fr')).toBe(false);
    expect(isPayslipLanguage('EN')).toBe(false);
  });

  it('are issued once the run is marked paid', () => {
    expect(payslipsIssued('draft')).toBe(false);
    expect(payslipsIssued('pending_ceo')).toBe(false);
    expect(payslipsIssued('approved')).toBe(false);
    expect(payslipsIssued('paid')).toBe(true);
  });

  it('are counted', () => {
    expect(payslipsIssuedLabel(1)).toBe('1 payslip issued');
    expect(payslipsIssuedLabel(12)).toBe('12 payslips issued');
    expect(payslipsIssuedLabel(0)).toBe('0 payslips issued');
  });
});

describe('passing the ZIP on', () => {
  const fromApi = (body: string, headers: Record<string, string>) => new Response(body, { headers });

  it('saves it under the name the API sends, with nothing allowed to run in it', async () => {
    const res = passZipOn(fromApi('PK', { 'content-type': ZIP, 'content-disposition': 'attachment; filename="Payslips 2026-10.zip"', 'content-length': '2' }), 'x.zip')!;
    expect(res.headers.get('content-type')).toBe(ZIP);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Payslips 2026-10.zip"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe('2');
    expect(await res.text()).toBe('PK');
  });

  it('names it when the API does not, saves it even when the API says inline, and refuses anything else', () => {
    expect(passZipOn(fromApi('PK', { 'content-type': ZIP }), 'Payslips.zip')?.headers.get('content-disposition')).toBe('attachment; filename="Payslips.zip"');
    expect(passZipOn(fromApi('PK', { 'content-type': ZIP, 'content-disposition': 'inline; filename="a.zip"' }), 'x')?.headers.get('content-disposition')).toBe(
      'attachment; filename="a.zip"',
    );
    expect(passZipOn(fromApi('<html>', { 'content-type': 'text/html' }), 'x')).toBeNull();
    expect(passZipOn(fromApi('%PDF', { 'content-type': 'application/pdf' }), 'x')).toBeNull();
  });

  it('leaves the length out when the body was compressed on the way', () => {
    const res = passZipOn(fromApi('PK', { 'content-type': ZIP, 'content-length': '2', 'content-encoding': 'gzip' }), 'x.zip')!;
    expect(res.headers.get('content-length')).toBeNull();
  });
});

describe('the employee file’s payslips', () => {
  const slip = (month: string, over: Partial<EmployeePayslip> = {}): EmployeePayslip => ({
    lineId: `line-${month}`,
    runId: `run-${month}`,
    month,
    paidOn: `${month}-28`,
    net: 12345.6,
    transfer: 12345.6,
    onHold: false,
    issued: { en: `${month}-28T10:00:00.000Z`, ar: null },
    ...over,
  });

  it('lists the months newest first, by name', () => {
    const rows = payslipRows([slip('2026-08'), slip('2026-10'), slip('2025-12'), slip('2026-09')]);
    expect(rows.map((r) => r.title)).toEqual(['October 2026', 'September 2026', 'August 2026', 'December 2025']);
    expect(rows[0]).toMatchObject({ lineId: 'line-2026-10', runId: 'run-2026-10', paidOn: '2026-10-28', net: 12345.6, onHold: false });
  });

  it('opens each in English and Arabic, the Arabic one made the first time it is opened', () => {
    const [row] = payslipRows([slip('2026-10')]);
    expect(row.links).toEqual([
      { language: 'en', label: 'English', note: null },
      { language: 'ar', label: 'Arabic', note: NOT_DRAWN_YET },
    ]);
    const [both] = payslipRows([slip('2026-10', { issued: { en: '2026-10-28T10:00:00.000Z', ar: '2026-10-29T09:00:00.000Z' } })]);
    expect(both.links.map((l) => l.note)).toEqual([null, null]);
  });

  it('has no payslip for a month on hold', () => {
    const [row] = payslipRows([slip('2026-10', { onHold: true, issued: { en: null, ar: null } })]);
    expect(row.onHold).toBe(true);
    expect(row.links).toEqual([]);
  });

  it('leaves the list it was given as it was', () => {
    const list = [slip('2026-08'), slip('2026-10')];
    payslipRows(list);
    expect(list.map((p) => p.month)).toEqual(['2026-08', '2026-10']);
  });
});
