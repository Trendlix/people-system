'use server';

// What social insurance Form 1 prints that is the employee's own, changed one item at a time on the Social Insurance
// tab (owner, 16 October 2026): the occupation, the subscription start and the three wages (PATCH /employees/:id, HR
// only, the wages also with the right to see salaries; the API checks all of it again). An empty field clears it, and
// Form 1 then prints what stands in for it. The date is typed as DD/MM/YYYY and sent as YYYY-MM-DD; an amount is typed
// as "15,000" and sent as a number.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';
import { parseAmount } from './[id]/contracts/salary';

export type InsuranceField = 'occupationCode' | 'insuranceStartDate' | 'insuranceBasicWage' | 'insuranceInsuredWage' | 'insuranceComprehensiveWage';

const WAGES: Partial<Record<InsuranceField, { label: string; example: string }>> = {
  insuranceBasicWage: { label: 'basic wage', example: '410' },
  insuranceInsuredWage: { label: 'insured wage', example: '14,500' },
  insuranceComprehensiveWage: { label: 'comprehensive wage', example: '15,000' },
};

const FIELDS: readonly InsuranceField[] = ['occupationCode', 'insuranceStartDate', 'insuranceBasicWage', 'insuranceInsuredWage', 'insuranceComprehensiveWage'];

export async function saveInsuranceDetail(employeeId: string, field: InsuranceField, _prev: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get(field) ?? '');
  const values = { [field]: raw };
  if (!FIELDS.includes(field)) return { errors: ['This detail is not changed here.'], values };
  const errors: string[] = [];
  let value: string | number | null;
  const wage = WAGES[field];
  if (wage) {
    const amount = parseAmount(raw);
    if (amount !== null && (Number.isNaN(amount) || amount <= 0)) errors.push(`Enter the ${wage.label} as an amount in EGP, e.g. ${wage.example}.`);
    value = amount !== null && !Number.isNaN(amount) ? amount : null;
  } else if (field === 'insuranceStartDate') {
    value = dateFrom(fd, field, 'subscription start', errors) || null;
  } else {
    value = raw.trim() || null;
  }
  if (errors.length) return { errors, values };
  try {
    await apiSend('PATCH', `/employees/${employeeId}`, { [field]: value });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  return { message: 'Saved.' };
}
