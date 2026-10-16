'use server';

// What social insurance Form 1 prints that is the employee's own, changed one item at a time on the Social Insurance
// tab (owner, 16 October 2026): the occupation, the subscription start and the basic and comprehensive wages (PATCH
// /employees/:id, HR only, the wages also with the right to see salaries; the API checks all of it again). The insured
// wage isn't one of them: the API works it out from the comprehensive wage (owner's decision, 16 October 2026). An empty field clears it, and
// Form 1 then prints what stands in for it. The date is typed as DD/MM/YYYY and sent as YYYY-MM-DD; an amount is typed
// as "15,000" and sent as a number. Whether the employee is registered with social insurance is changed here too
// (`socialInsured`, sent as true or false): payroll deducts social insurance only for those who are (owner's decision,
// 16 October 2026).
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';
import { parseAmount } from './[id]/contracts/salary';

export type InsuranceField = 'occupationCode' | 'insuranceStartDate' | 'insuranceBasicWage' | 'insuranceComprehensiveWage' | 'socialInsured';

const WAGES: Partial<Record<InsuranceField, { label: string; example: string }>> = {
  insuranceBasicWage: { label: 'basic wage', example: '410' },
  insuranceComprehensiveWage: { label: 'comprehensive wage', example: '15,000' },
};

const FIELDS: readonly InsuranceField[] = ['occupationCode', 'insuranceStartDate', 'insuranceBasicWage', 'insuranceComprehensiveWage', 'socialInsured'];

export async function saveInsuranceDetail(employeeId: string, field: InsuranceField, _prev: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get(field) ?? '');
  const values = { [field]: raw };
  if (!FIELDS.includes(field)) return { errors: ['This detail is not changed here.'], values };
  const errors: string[] = [];
  let value: string | number | boolean | null;
  const wage = WAGES[field];
  if (field === 'socialInsured') {
    if (raw !== 'true' && raw !== 'false') return { errors: ['Choose whether they are registered with social insurance.'], values };
    value = raw === 'true';
  } else if (wage) {
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
