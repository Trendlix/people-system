import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  BASIC_PERCENT_ERROR,
  coordinateFrom,
  coordinateText,
  dayOfMonth,
  officeLocationFrom,
  officeLocationText,
  INSURANCE_BASIC_ERROR,
  PAYDAY_ERROR,
  paidOnDefault,
  paydayDate,
  payingBody,
  officeAddressesFrom,
  rulesBody,
  INSTALLMENT_LIMIT_ERROR,
  SALARY_REVIEW_ERROR,
  seesPayrollSettings,
} from './settings';

const as = (...roles: Role[]) => ({ roles });

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
};

const rules = {
  dayDivisor: '30',
  attendanceGracePercent: '90',
  kpiGracePercent: '80',
  overtimeAbovePercent: '110',
  overtimeRate: '1.5',
  noShowDayMultiplier: '2',
};

// invented account details
const paying = { cibDebitAccount: '1000 2000 3000', cibDebitAccountName: '  Example Trading Co  ', achPurpose: 'cash', payday: '25' };

describe('who sees the payroll setup', () => {
  it('is HR, Finance, the CEO and Admin (a Super Admin too)', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) expect(seesPayrollSettings(as(role))).toBe(true);
    expect(seesPayrollSettings(as('employee', 'manager'))).toBe(false);
  });
});

describe('Your Rules', () => {
  it('sends the rules as numbers, and the company defaults the form has to the contract settings', () => {
    expect(rulesBody(form({ ...rules, basicPercentDefault: '75', insuranceBasicDefault: '1,250.50' }))).toEqual({
      rules: { dayDivisor: 30, attendanceGracePercent: 90, kpiGracePercent: 80, overtimeAbovePercent: 110, overtimeRate: 1.5, noShowDayMultiplier: 2 },
      defaults: { basicPercentDefault: 75, insuranceBasicDefault: 1250.5 },
      errors: [],
    });
  });

  it('sends Pay overtime when the form has the switch: off leaves out the overtime’s percent and rate (owner, 16 October 2026)', () => {
    const withoutOvertime = Object.fromEntries(Object.entries(rules).filter(([key]) => !key.startsWith('overtime')));
    // off: the hidden "false" alone, the overtime fields disabled so not sent
    const off = form(withoutOvertime);
    off.append('payOvertime', 'false');
    expect(rulesBody(off)).toMatchObject({
      rules: { dayDivisor: 30, attendanceGracePercent: 90, kpiGracePercent: 80, payOvertime: false, noShowDayMultiplier: 2 },
      errors: [],
    });
    expect(rulesBody(off).rules).not.toHaveProperty('overtimeRate');
    // on: the hidden "false" and the checkbox's "true", with the overtime fields
    const on = form(rules);
    on.append('payOvertime', 'false');
    on.append('payOvertime', 'true');
    expect(rulesBody(on)).toMatchObject({ rules: { payOvertime: true, overtimeAbovePercent: 110, overtimeRate: 1.5 }, errors: [] });
    // on, the overtime fields are needed
    const missing = form(withoutOvertime);
    missing.append('payOvertime', 'true');
    expect(rulesBody(missing).errors).toEqual([
      'Enter the attendance overtime starts above as a percent from 100 to 200, e.g. 110.',
      'Enter the overtime rate as a number from 1 to 5, e.g. 1.5.',
    ]);
    // no switch on the form (an API from before it): none sent, the overtime fields as before
    expect(rulesBody(form(rules)).rules).not.toHaveProperty('payOvertime');
  });

  it('leaves out a default the form doesn’t have (an API from before it)', () => {
    expect(rulesBody(form(rules))).toMatchObject({ defaults: {}, errors: [] });
  });

  it('sends when a salary review is due, a whole number of months from 1 to 60, when the form has it (owner, 16 October 2026)', () => {
    expect(rulesBody(form({ ...rules, salaryReviewMonths: '18' }))).toMatchObject({ rules: { salaryReviewMonths: 18 }, errors: [] });
    expect(rulesBody(form({ ...rules, salaryReviewMonths: '١٢' })).rules.salaryReviewMonths).toBe(12);
    for (const bad of ['0', '61', '6.5', '', 'twelve']) expect(rulesBody(form({ ...rules, salaryReviewMonths: bad })).errors).toEqual([SALARY_REVIEW_ERROR]);
    // an API from before it: not on the form, not sent
    expect(rulesBody(form(rules)).rules).not.toHaveProperty('salaryReviewMonths');
  });

  it('sends the law’s limit on installments when the form has it: 1 to 10, never above the law’s, never empty (owner, 18 October 2026: "Block above 10%")', () => {
    expect(rulesBody(form({ ...rules, installmentLimitPercent: '10' }))).toMatchObject({ rules: { installmentLimitPercent: 10 }, errors: [] });
    expect(rulesBody(form({ ...rules, installmentLimitPercent: '7.5' })).rules.installmentLimitPercent).toBe(7.5);
    expect(rulesBody(form({ ...rules, installmentLimitPercent: '٨' })).rules.installmentLimitPercent).toBe(8);
    for (const bad of ['0', '10.01', '12.5', '100', '5.555', 'ten', ' ', '']) expect(rulesBody(form({ ...rules, installmentLimitPercent: bad })).errors).toEqual([INSTALLMENT_LIMIT_ERROR]);
    expect(INSTALLMENT_LIMIT_ERROR).toBe("Enter the most a month's installments may take as a percent of the wage from 1 to 10, e.g. 10: the law allows at most 10%.");
    // an API from before it: not on the form, not sent
    expect(rulesBody(form(rules)).rules).not.toHaveProperty('installmentLimitPercent');
  });

  it('reads Arabic digits', () => {
    expect(rulesBody(form({ ...rules, dayDivisor: '٣٠', overtimeRate: '١٫٥', basicPercentDefault: '٨٠' }))).toMatchObject({
      rules: { dayDivisor: 30, overtimeRate: 1.5 },
      defaults: { basicPercentDefault: 80 },
      errors: [],
    });
  });

  it('says what is out of the limits the API checks', () => {
    const { errors } = rulesBody(
      form({ ...rules, dayDivisor: '30.5', attendanceGracePercent: '120', overtimeAbovePercent: '90', overtimeRate: '6', noShowDayMultiplier: '', basicPercentDefault: '80.5', insuranceBasicDefault: '0' }),
    );
    expect(errors).toEqual([
      'Enter the days a month counts as: a whole number from 20 to 31, e.g. 30.',
      'Enter the attendance grace as a percent from 0 to 100, e.g. 90.',
      'Enter the attendance overtime starts above as a percent from 100 to 200, e.g. 110.',
      'Enter the overtime rate as a number from 1 to 5, e.g. 1.5.',
      "Enter what a no-show day costs as a number of days' pay from 0 to 10, e.g. 2.",
      BASIC_PERCENT_ERROR,
      INSURANCE_BASIC_ERROR,
    ]);
    for (const share of ['0', '101', '', 'eighty']) expect(rulesBody(form({ ...rules, basicPercentDefault: share })).errors).toEqual([BASIC_PERCENT_ERROR]);
    for (const wage of ['', '-5', '100000', '410.555']) expect(rulesBody(form({ ...rules, insuranceBasicDefault: wage })).errors).toEqual([INSURANCE_BASIC_ERROR]);
  });
});

describe('Paying Salaries', () => {
  it('sends the CIB account as its 12 digits, the ACH purpose in capitals and the payday as a number', () => {
    expect(payingBody(form(paying))).toEqual({
      body: { cibDebitAccount: '100020003000', cibDebitAccountName: 'Example Trading Co', achPurpose: 'CASH', payday: 25 },
      errors: [],
    });
  });

  it('leaves the CIB account, its name and the payday empty until they are needed', () => {
    const { body, errors } = payingBody(form({ ...paying, cibDebitAccount: '', cibDebitAccountName: ' ', payday: ' ' }));
    expect(errors).toEqual([]);
    expect([body.cibDebitAccount, body.cibDebitAccountName, body.payday]).toEqual([null, null, null]);
    expect(payingBody(form({ ...paying, payday: '٥' })).body.payday).toBe(5);
  });

  it('says what is wrong', () => {
    expect(payingBody(form({ cibDebitAccount: '12345', cibDebitAccountName: 'x'.repeat(101), achPurpose: 'CASH-1', payday: '32' })).errors).toEqual([
      'Enter the CIB account as its 12 digits.',
      'Keep the account name to 100 characters or fewer.',
      'Enter the ACH purpose in letters and digits, up to 20, e.g. CASH: the ACH file prints it on every line.',
      PAYDAY_ERROR,
    ]);
    for (const payday of ['0', '1.5', 'end']) expect(payingBody(form({ ...paying, payday })).errors).toEqual([PAYDAY_ERROR]);
  });
});

describe('the payday', () => {
  it('is in the month after the run’s, its last day when the month is shorter', () => {
    expect(paydayDate('2026-09', 5)).toBe('2026-10-05');
    expect(paydayDate('2026-12', 25)).toBe('2027-01-25');
    expect(paydayDate('2027-01', 31)).toBe('2027-02-28');
    expect(paydayDate('2028-01', 30)).toBe('2028-02-29');
    expect(paydayDate('2026-08', 31)).toBe('2026-09-30');
  });

  it('is the date Mark as paid starts with, unless it is still to come; today without one', () => {
    expect(paidOnDefault('2026-09', 5, '2026-10-16')).toBe('2026-10-05');
    // the bank paid before the payday: a payment can't be recorded in the future
    expect(paidOnDefault('2026-09', 25, '2026-10-16')).toBe('2026-10-16');
    expect(paidOnDefault('2026-09', null, '2026-10-16')).toBe('2026-10-16');
    expect(paidOnDefault('2026-09', undefined, '2026-10-16')).toBe('2026-10-16');
    // a run marked paid months later: its own payday
    expect(paidOnDefault('2026-03', 5, '2026-10-16')).toBe('2026-04-05');
  });

  it('reads as a day of the month', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25, 31].map(dayOfMonth)).toEqual([
      'the 1st',
      'the 2nd',
      'the 3rd',
      'the 4th',
      'the 11th',
      'the 12th',
      'the 13th',
      'the 21st',
      'the 22nd',
      'the 23rd',
      'the 25th',
      'the 31st',
    ]);
  });
});

describe('Your Rules: the office addresses (owner, 19 October 2026: "13 and 17 al mahrouki is also in office")', () => {
  it('sends one address a line, trimmed, the empty lines dropped', () => {
    expect(officeAddressesFrom('  Trendlix \n\n15, Al Doctor Al Mahrouqi Street\r\n')).toEqual(['Trendlix', '15, Al Doctor Al Mahrouqi Street']);
    const fd = form(rules);
    fd.set('officeAddresses', 'Trendlix\n13, Al Doctor Al Mahrouqi Street');
    expect(rulesBody(fd)).toMatchObject({ rules: { officeAddresses: ['Trendlix', '13, Al Doctor Al Mahrouqi Street'] }, errors: [] });
    // the form without the field (an API from before it) sends none
    expect(rulesBody(form(rules)).rules).not.toHaveProperty('officeAddresses');
  });

  it('refuses one twice, as the API does', () => {
    const fd = form(rules);
    fd.set('officeAddresses', 'Trendlix\ntrendlix');
    expect(rulesBody(fd).errors).toEqual(['"trendlix" is there twice: keep it once.']);
  });
});

describe('Your Rules: the office location (owner, 19 October 2026: "Check-in through the system (phone or web with the office location check, or a device) to replace Zoho")', () => {
  const LAT = "Enter the office's latitude from -90 to 90, e.g. 30.0596.";
  const LNG = "Enter the office's longitude from -180 to 180, e.g. 31.3462.";
  const BOTH = "Enter both the office's latitude and longitude, or neither.";
  const RADIUS = "Enter the office's radius in whole metres from 20 to 5,000, e.g. 150.";
  const at = (latitude: string, longitude: string, radius = '150') => officeLocationFrom({ latitude, longitude, radius });

  it('reads the point to 6 decimals and the radius in whole metres', () => {
    expect(at('30.0596', '31.3462')).toEqual({ body: { officeLatitude: 30.0596, officeLongitude: 31.3462, officeRadiusMetres: 150 }, problems: [] });
    // more decimals than the API keeps: rounded, not refused
    expect(at('30.05961234', '-31.34629876', '200').body).toEqual({ officeLatitude: 30.059612, officeLongitude: -31.346299, officeRadiusMetres: 200 });
    // Arabic digits and decimal mark, as a phone may type them
    expect(at('٣٠٫٠٥٩٦', '٣١٫٣٤٦٢', '١٥٠').body).toEqual({ officeLatitude: 30.0596, officeLongitude: 31.3462, officeRadiusMetres: 150 });
    // empty radius: 150 to start with
    expect(at('30.0596', '31.3462', '').body.officeRadiusMetres).toBe(150);
  });

  it('splits both pasted from a map into Latitude', () => {
    expect(at('30.059612, 31.346123', '').body).toMatchObject({ officeLatitude: 30.059612, officeLongitude: 31.346123 });
    expect(at(' 30.0596 ، 31.3462 ', '').problems).toEqual([]);
  });

  it('is not set with both empty, and wants both or neither', () => {
    expect(at('', '')).toEqual({ body: { officeLatitude: null, officeLongitude: null, officeRadiusMetres: 150 }, problems: [] });
    expect(at('30.0596', '').problems).toEqual([BOTH]);
    expect(at('', '31.3462').problems).toEqual([BOTH]);
  });

  it('says what is wrong, with the shared checks the API makes', () => {
    expect(at('95', '31.3462').problems).toEqual([LAT]);
    expect(at('30.0596', '181').problems).toEqual([LNG]);
    expect(at('north', '31.3462').problems).toEqual([LAT]);
    expect(at('30.0596', '31.3462', '10').problems).toEqual([RADIUS]);
    expect(at('30.0596', '31.3462', '150.5').problems).toEqual([RADIUS]);
    expect(at('30.0596', '31.3462', '6000').problems).toEqual([RADIUS]);
    expect([coordinateFrom(''), coordinateFrom('  '), coordinateFrom('−30.5'), coordinateFrom('30,5')]).toEqual([null, null, -30.5, NaN]);
  });

  it('is sent with the rules when the form has it, and refused before the API when wrong', () => {
    const fd = form({ ...rules, officeLatitude: '30.0596', officeLongitude: '31.3462', officeRadiusMetres: '150' });
    expect(rulesBody(fd)).toMatchObject({ rules: { officeLatitude: 30.0596, officeLongitude: 31.3462, officeRadiusMetres: 150 }, errors: [] });
    // cleared: both null, sent as such
    expect(rulesBody(form({ ...rules, officeLatitude: '', officeLongitude: '', officeRadiusMetres: '150' })).rules).toMatchObject({ officeLatitude: null, officeLongitude: null });
    expect(rulesBody(form({ ...rules, officeLatitude: '30.0596', officeLongitude: '', officeRadiusMetres: '150' })).errors).toEqual([BOTH]);
    // the form without it (an API from before it) sends none
    expect(rulesBody(form(rules)).rules).not.toHaveProperty('officeRadiusMetres');
  });

  it('says it in the summary, and starts the fields with it', () => {
    expect(officeLocationText({ officeLatitude: 30.0596, officeLongitude: 31.3462, officeRadiusMetres: 150 })).toBe('30.059600, 31.346200 · 150 m');
    expect(officeLocationText({ officeLatitude: 30.0596, officeLongitude: 31.3462, officeRadiusMetres: 1200 })).toBe('30.059600, 31.346200 · 1,200 m');
    expect(officeLocationText({ officeLatitude: null, officeLongitude: null, officeRadiusMetres: 150 })).toBe('Not set: check-ins are kept as location unknown');
    expect(officeLocationText({})).toBe('Not set: check-ins are kept as location unknown');
    expect([coordinateText(30.0596), coordinateText(null), coordinateText(undefined)]).toEqual(['30.059600', '', '']);
  });
});
