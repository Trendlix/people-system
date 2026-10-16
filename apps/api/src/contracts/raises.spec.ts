import { Prisma } from '../generated/prisma/client.js';
import { NO_PAY_CHANGE, payChangeStep, payTermsOf } from './contracts.service.js';
import { amendmentNumber } from './raises.service.js';

// A raise's number, and the CEO's step a new version takes (owner's decisions, 16 October 2026).

describe('an amendment’s number', () => {
  it('is the contract’s it amends with -A1, then -A2 …', () => {
    expect(amendmentNumber('CON-2026-0007')).toBe('CON-2026-0007-A1');
    expect(amendmentNumber('CON-2026-0007-A1')).toBe('CON-2026-0007-A2');
    expect(amendmentNumber('CON-2026-0007-A9')).toBe('CON-2026-0007-A10');
  });
});

describe('the CEO’s step a new version takes', () => {
  const previous = {
    version: 2,
    payBasis: 'monthly',
    grossSalary: new Prisma.Decimal(12000),
    hourlyRate: null,
    hoursPerWeek: null,
    basicPercent: 80,
    allowances: [{ allowanceTypeId: 'transport', amount: new Prisma.Decimal(500) }],
  };
  const same = payTermsOf({ ...previous, grossSalary: 12000, allowances: [{ allowanceTypeId: 'transport', amount: 500 }] });

  it('none for a renewal with the same pay, whatever reason is sent', () => {
    expect(payChangeStep(previous, same, undefined)).toBe(NO_PAY_CHANGE);
    expect(payChangeStep(previous, same, 'annual')).toBe(NO_PAY_CHANGE);
  });

  it('new pay needs a reason, and is a draft for HR to send to the CEO', () => {
    expect(payChangeStep(previous, { ...same, grossSalary: 13000 }, 'annual')).toEqual({ raiseReason: 'annual', approval: 'draft' });
    expect(payChangeStep(previous, { ...same, allowances: [] }, 'adjustment')).toEqual({ raiseReason: 'adjustment', approval: 'draft' });
    expect(() => payChangeStep(previous, { ...same, grossSalary: 13000 }, undefined)).toThrow(
      'The pay changes from version 2: choose why (annual raise, promotion, adjustment or other). The CEO approves a change of pay before it is signed.',
    );
  });
});
