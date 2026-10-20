import 'server-only';
import { cache } from 'react';
import type { EmployeePayslip } from '@/lib/types';
import { loadJson } from '../../../(app)/payroll/load';

// The employee's own payslips (owner, 20 October 2026: the employee app, "My attendance and payslips"): GET /me/payslips,
// the caller's months paid, newest first, as HR's list of the person (GET /employees/:id/payslips) shapes them; none
// without an employee profile. Read once a request (the list and a payslip's page). An API from before it answers 404:
// "not available yet".

export const loadMyPayslips = cache(() => loadJson<EmployeePayslip[]>('/me/payslips'));

/** One of their payslips' PDF (GET /me/payslips/:lineId/:language): their own line only; anyone else's is 404. */
export const apiMyPayslipPath = (lineId: string, language: 'en' | 'ar', download: boolean) =>
  `/me/payslips/${encodeURIComponent(lineId)}/${language}${download ? '?download=1' : ''}`;
