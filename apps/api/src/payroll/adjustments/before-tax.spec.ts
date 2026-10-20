import { BadRequestException } from '@nestjs/common';
import { validated } from '../../common/validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ChangeRecurringDeductionDto, CreateRecurringDeductionDto, UpdateRecurringDeductionDto } from './adjustments.dto.js';
import { itemOf } from './run-adjustments.service.js';

// "Deducted before tax (lowers taxable pay)" on a recurring deduction (owner, 20 October 2026, asked whether the
// employee's medical share is taken before or after tax: "Before Tax i think"): what the forms may send, and how a
// month's Recurring deduction carries it onto the run's line. Every value is invented.

const NEW = { employeeId: '00000000-0000-4000-8000-0000000000e1', name: 'Medical subscription (family)', amount: 350, startMonth: '2026-11', consentOnFile: true };

describe('the recurring deduction forms: deducted before tax', () => {
  it('is optional on a new one, true or false, a form’s yes or no too', async () => {
    expect((await validated(CreateRecurringDeductionDto, NEW)).beforeTax).toBeUndefined();
    expect((await validated(CreateRecurringDeductionDto, { ...NEW, beforeTax: true })).beforeTax).toBe(true);
    expect((await validated(CreateRecurringDeductionDto, { ...NEW, beforeTax: false })).beforeTax).toBe(false);
    // sent as a form (multipart, with the signed consent): its text
    expect((await validated(CreateRecurringDeductionDto, { ...NEW, amount: '350', consentOnFile: 'true', beforeTax: 'true' })).beforeTax).toBe(true);
    expect((await validated(CreateRecurringDeductionDto, { ...NEW, amount: '350', consentOnFile: 'true', beforeTax: 'false' })).beforeTax).toBe(false);
  });

  it('refuses anything but true or false; a form’s text other than yes reads as no, as its consent tick does', async () => {
    await expect(validated(CreateRecurringDeductionDto, { ...NEW, beforeTax: 1 })).rejects.toMatchObject({
      response: { message: ['Send whether it is deducted before tax as true or false.'] },
    });
    await expect(validated(UpdateRecurringDeductionDto, { beforeTax: 'soon' as unknown as boolean })).resolves.toMatchObject({ beforeTax: false });
    await expect(validated(ChangeRecurringDeductionDto, { amount: 400, fromMonth: '2026-12', beforeTax: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a change of amount or an edit sends it only to change it', async () => {
    expect((await validated(ChangeRecurringDeductionDto, { amount: 400, fromMonth: '2026-12' })).beforeTax).toBeUndefined();
    expect((await validated(ChangeRecurringDeductionDto, { amount: 400, fromMonth: '2026-12', beforeTax: true })).beforeTax).toBe(true);
    expect(await validated(UpdateRecurringDeductionDto, { beforeTax: true })).toMatchObject({ beforeTax: true });
    expect((await validated(UpdateRecurringDeductionDto, { name: 'Gym' })).beforeTax).toBeUndefined();
  });
});

describe('a month’s Recurring deduction on the run’s line', () => {
  const row = { id: 'adj-1', kind: 'deduction', type: 'recurring', taxed: false, amount: new Prisma.Decimal(350), days: null, reason: 'Medical subscription (family)' };

  it('carries before tax when ticked so; every other item reads as it did, without it', () => {
    expect(itemOf({ ...row, beforeTax: true })).toEqual({ id: 'adj-1', kind: 'deduction', type: 'recurring', taxed: false, amount: 350, reason: 'Medical subscription (family)', beforeTax: true });
    expect(itemOf({ ...row, beforeTax: false })).toEqual({ id: 'adj-1', kind: 'deduction', type: 'recurring', taxed: false, amount: 350, reason: 'Medical subscription (family)' });
    expect(itemOf(row)).not.toHaveProperty('beforeTax');
    // only a Recurring deduction can be before tax
    expect(itemOf({ ...row, type: 'other', beforeTax: true })).not.toHaveProperty('beforeTax');
  });
});
