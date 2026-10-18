import { EMPTY_PAYROLL_INPUTS, payrollLine, type PayrollAdjustmentItem, type PayrollInputs, type PayrollSegment, type PayrollTerms, type SavedPayrollInputs } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  attendancePercent,
  cellText,
  columnNote,
  contractsNote,
  dayRange,
  errorLine,
  expectedCell,
  GRID_COLUMNS,
  ITEMS_AFTER,
  LEAVE_FIELDS,
  leaveFill,
  lineItems,
  linePatches,
  noShowPay,
  parseCell,
  placeApiErrors,
  tidyCell,
  unsavedCount,
  unsavedText,
  untaxedNote,
  type GridLine,
} from './grid';

// invented people and figures
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const lines: GridLine[] = [
  // a performance saved before the KPI columns came off the grid
  { id: A, name: 'Mona Farid', inputs: { ...EMPTY_PAYROLL_INPUTS, workedHours: 270.5, expectedHours: 280, performance: 90, leaveDays: 1 }, onHold: false, comments: null },
  { id: B, name: 'Karim Nabil', inputs: { ...EMPTY_PAYROLL_INPUTS, released: 1500 }, onHold: true, comments: 'Bank details pending' },
];

describe('the grid’s columns', () => {
  it('follow the owner’s sheet, every input once but the KPIs, which the KPIs module will fill (owner, 16 October 2026)', () => {
    // the leave days after the no-show days; no Penalty days, Bonus days, Commission or Settlements (owner, 17 October
    // 2026: "instead of there, i think earnings and deductions will be enough"): Earnings and Deductions after the leave
    // days, read only
    // the unpaid leave days beside the leave days (owner, 18 October 2026: "can you apply the leaves according to the
    // law?"), the Earnings and Deductions after them
    expect(GRID_COLUMNS.map((c) => c.label)).toEqual(['Worked hours', 'Expected hours', 'No-show days', 'Leave days', 'Unpaid leave days', 'Released']);
    expect(ITEMS_AFTER).toBe('unpaidLeaveDays');
    // nor the CEO's attendance waiver, ticked on the results table (17 October 2026)
    const notTyped = ['softSkills', 'performance', 'clientSatisfaction', 'attendanceWaived'];
    expect(new Set(GRID_COLUMNS.map((c) => c.field))).toEqual(new Set(Object.keys(EMPTY_PAYROLL_INPUTS).filter((k) => !notTyped.includes(k))));
  });

  it('say what a no-show day costs under its column', () => {
    expect([noShowPay(2), noShowPay(1), noShowPay(1.5)]).toEqual(["2 days' pay each", "1 day's pay each", "1.5 days' pay each"]);
  });

  it('say under the no-show and leave days that their hours come out of the expected hours (17 October 2026)', () => {
    expect(columnNote('noShowDays', 2)).toBe("2 days' pay each, out of the expected hours");
    expect(columnNote('noShowDays', 1)).toBe("1 day's pay each, out of the expected hours");
    expect(columnNote('leaveDays', 2)).toBe('Paid, out of the expected hours');
    expect(columnNote('released', 2)).toBeNull();
    expect(columnNote('expectedHours', 2)).toBeNull();
  });
});

describe('reading a cell', () => {
  const value = (kind: Parameters<typeof parseCell>[0], text: string) => {
    const parsed = parseCell(kind, text);
    return parsed.ok ? parsed.value : 'error';
  };

  it('reads hours as attendance shows them or as a number, up to 744', () => {
    expect(value('hours', '270:00')).toBe(270);
    expect(value('hours', '270:30')).toBe(270.5);
    expect(value('hours', '270.5')).toBe(270.5);
    expect(value('hours', ' 270 ')).toBe(270);
    expect(value('hours', '٢٧٠:٣٠')).toBe(270.5);
    expect(value('hours', '744')).toBe(744);
    expect(value('hours', '745')).toBe('error');
    expect(value('hours', '270:75')).toBe('error');
    expect(value('hours', 'abc')).toBe('error');
  });

  it('leaves an empty cell empty', () => {
    for (const c of GRID_COLUMNS) expect(value(c.kind, '  ')).toBeNull();
  });

  it('reads days from 0 to 31, whole or half', () => {
    expect(value('days', '2')).toBe(2);
    expect(value('days', '1.5')).toBe(1.5);
    expect(value('days', '31')).toBe(31);
    expect(value('days', '1.25')).toBe('error');
    expect(value('days', '32')).toBe('error');
  });

  it('reads what was released this month in EGP, 0 or more, within ten million', () => {
    expect(value('released', '2,000')).toBe(2000);
    expect(value('released', '1 500.5')).toBe(1500.5);
    expect(value('released', '0')).toBe(0);
    expect(value('released', '10000000')).toBe(10_000_000);
    expect(value('released', '-1')).toBe('error');
    expect(value('released', '−250')).toBe('error');
    expect(value('released', '10000000.01')).toBe('error');
    expect(value('released', '12.345')).toBe('error');
  });

  it('says how to type it when it can’t be read', () => {
    expect(parseCell('hours', 'x')).toEqual({ ok: false, error: 'Type the hours as 270:00 or 270.5, up to 744.' });
    expect(parseCell('days', '40')).toEqual({ ok: false, error: 'Type the days from 0 to 31, whole or half, e.g. 1.5.' });
  });
});

describe('showing a cell', () => {
  it('shows hours as attendance does, amounts with two decimals', () => {
    expect(cellText('hours', 270.5)).toBe('270:30');
    expect(cellText('hours', 270)).toBe('270:00');
    expect(cellText('released', 1500)).toBe('1500.00');
    expect(cellText('released', 99.5)).toBe('99.50');
    expect(cellText('days', 1.5)).toBe('1.5');
    expect(cellText('hours', null)).toBe('');
  });

  it('tidies a cell once it is left, and keeps one typed wrongly as typed', () => {
    expect(tidyCell('hours', '270.5')).toBe('270:30');
    expect(tidyCell('released', '1,500')).toBe('1500.00');
    expect(tidyCell('hours', '27o')).toBe('27o');
    expect(tidyCell('days', '')).toBe('');
  });

  it('works out the attendance from the hours: worked ÷ expected, the expected hours already without the days off', () => {
    // 270:30 of 280:00: 270.5 ÷ 280 = 0.96607…, 96.61%
    expect(attendancePercent(270.5, 280)).toBe(96.61);
    expect(attendancePercent(280, 280)).toBe(100);
    expect(attendancePercent(null, 280)).toBeNull();
    expect(attendancePercent(280, null)).toBeNull();
    // nothing expected: not counted
    expect(attendancePercent(270, 0)).toBeNull();
    // 133 of the 152 left once a no-show and a leave day of 8 hours are out of 168: 133 ÷ 152 = 87.5%
    expect(attendancePercent(133, 152)).toBe(87.5);
  });
});

describe('the expected hours filled in from the shift (owner, 17 October 2026: "prefill the expected hours, and dont count abcent days or leave days")', () => {
  // the shift's hours for the month: 22 working days less 1 holiday, × 8:00 to work a day = 168:00
  const shift = { shiftExpectedHours: 168, hoursPerDay: 8 };
  const cells = (c: Partial<PayrollInputs> = {}) => ({ expectedHours: null, noShowDays: null, leaveDays: null, ...c });

  it('are the shift’s hours less a day of the shift for each no-show and leave day typed', () => {
    expect(expectedCell(shift, cells())).toEqual({ hours: 168, fromShift: true });
    // 2 no-show days and 1 leave day: 168 − 3 × 8 = 144
    expect(expectedCell(shift, cells({ noShowDays: 2, leaveDays: 1 }))).toEqual({ hours: 144, fromShift: true });
    // half a no-show day: 168 − 0.5 × 8 = 164
    expect(expectedCell(shift, cells({ noShowDays: 0.5 }))).toEqual({ hours: 164, fromShift: true });
    // a flexible shift of 9:00 to work a day, 21 days: 189; 1.5 leave days take 13.5 out, 175:30 left
    expect(expectedCell({ shiftExpectedHours: 189, hoursPerDay: 9 }, cells({ leaveDays: 1.5 }))).toEqual({ hours: 175.5, fromShift: true });
    // more days off than the shift has: never below 0 (16 − 3 × 8)
    expect(expectedCell({ shiftExpectedHours: 16, hoursPerDay: 8 }, cells({ noShowDays: 3 }))).toEqual({ hours: 0, fromShift: true });
    // the attendance beside them follows: 133 of 144 is 92.36%
    expect(attendancePercent(133, expectedCell(shift, cells({ noShowDays: 2, leaveDays: 1 })).hours)).toBe(92.36);
  });

  it('are HR’s when typed, taken as already without the no-show and leave days: nothing more comes out', () => {
    expect(expectedCell(shift, cells({ expectedHours: 150, noShowDays: 2, leaveDays: 1 }))).toEqual({ hours: 150, fromShift: false });
    // 0 typed is HR's too
    expect(expectedCell(shift, cells({ expectedHours: 0 }))).toEqual({ hours: 0, fromShift: false });
    // 133 of HR's 150: 88.67%
    expect(attendancePercent(133, expectedCell(shift, cells({ expectedHours: 150, noShowDays: 2 })).hours)).toBe(88.67);
  });

  it('are HR’s alone without a shift (or by the hour): none filled in', () => {
    const none = { shiftExpectedHours: null, hoursPerDay: null };
    expect(expectedCell(none, cells({ noShowDays: 2 }))).toEqual({ hours: null, fromShift: false });
    expect(expectedCell(none, cells({ expectedHours: 160, leaveDays: 1 }))).toEqual({ hours: 160, fromShift: false });
  });
});

describe('a month under two contracts (owner, 17 October 2026: "take into consideration the start and end date of the contract")', () => {
  const segment = (s: Partial<PayrollSegment>): PayrollSegment => ({
    contractId: 'c1',
    number: 'CON-2025-0003',
    version: 1,
    from: '2026-10-01',
    to: '2026-10-14',
    days: 14,
    payBasis: 'monthly',
    gross: 10_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    ...s,
  });
  const renewal = segment({ contractId: 'c2', number: 'CON-2026-0012', version: 2, from: '2026-10-15', to: '2026-10-31', days: 16, gross: 12_000 });

  it('names each contract and its days by the employee', () => {
    expect(contractsNote({ segments: [segment({}), renewal] })).toBe('2 contracts this month: CON-2025-0003 v1, 1–14 October · CON-2026-0012 v2, 15–31 October');
  });

  it('says the latest alone is paid when one of them is by the hour', () => {
    expect(contractsNote({ segments: [segment({ payBasis: 'hourly', hourlyRate: 60 }), renewal] })).toBe(
      '2 contracts this month, one by the hour: paid on the latest, CON-2026-0012 v2',
    );
    expect(contractsNote({ segments: [segment({ payBasis: 'hourly', hourlyRate: 60 }), { ...renewal, payBasis: 'hourly', hourlyRate: 70 }] })).toBe(
      '2 contracts this month, both by the hour: paid on the latest, CON-2026-0012 v2',
    );
  });

  it('says nothing of a month on one contract, or a line made before then', () => {
    expect(contractsNote({ segments: [segment({ to: '2026-10-31', days: 30 })] })).toBeNull();
    expect(contractsNote({})).toBeNull();
  });

  it('names a part’s days by the month', () => {
    expect(dayRange('2026-10-01', '2026-10-14')).toBe('1–14 October');
    expect(dayRange('2026-10-15', '2026-10-31')).toBe('15–31 October');
    expect(dayRange('2026-10-31', '2026-10-31')).toBe('31 October');
    expect(dayRange('2026-02-01', '2026-02-28')).toBe('1–28 February');
    expect(dayRange('2026-09-28', '2026-10-03')).toBe('28 September–3 October');
  });
});

describe('what changed', () => {
  it('sends only the rows and the cells that changed', () => {
    const { patches, errors } = linePatches(lines, {
      [A]: { inputs: { workedHours: '271:00', expectedHours: '280', leaveDays: '' } },
    });
    expect(errors).toEqual([]);
    // the expected hours were typed as they are saved: not a change; the performance saved isn't sent
    expect(patches).toEqual([{ id: A, inputs: { workedHours: 271, leaveDays: null } }]);
  });

  it('sends the leave days typed, and reads a line saved before them as without any (17 October 2026)', () => {
    const before: Partial<PayrollInputs> = { ...EMPTY_PAYROLL_INPUTS, workedHours: 160 };
    delete before.leaveDays;
    const older: GridLine[] = [{ id: B, name: 'Karim Nabil', inputs: before as PayrollInputs, onHold: false, comments: null }];
    // an empty leave cell is what is saved: no change
    expect(unsavedCount(older, { [B]: { inputs: { leaveDays: '' } } })).toEqual({ cells: 0, rows: 0 });
    expect(linePatches(older, { [B]: { inputs: { leaveDays: '1.5' } } }).patches).toEqual([{ id: B, inputs: { leaveDays: 1.5 } }]);
  });

  it('sends HR’s expected hours cleared as none, so the shift’s come back; a cell left empty sends nothing', () => {
    // Mona's 280 typed over the shift's, cleared
    expect(linePatches(lines, { [A]: { inputs: { expectedHours: '' } } }).patches).toEqual([{ id: A, inputs: { expectedHours: null } }]);
    // Karim's, never typed: the figure filled in from the shift is only shown, never an edit
    expect(unsavedCount(lines, { [B]: { inputs: { expectedHours: '' } } })).toEqual({ cells: 0, rows: 0 });
  });

  it('never sends a KPI: a saved one stays as it is for the KPIs module', () => {
    const edits = { [A]: { inputs: { performance: '50' } } };
    expect(linePatches(lines, edits)).toEqual({ patches: [], errors: [] });
    expect(unsavedCount(lines, edits)).toEqual({ cells: 0, rows: 0 });
  });

  it('sends the hold and the comments when they changed, comments trimmed and none for empty', () => {
    const { patches } = linePatches(lines, {
      [A]: { onHold: true, comments: '  Joined late  ' },
      [B]: { onHold: true, comments: '' },
    });
    expect(patches).toEqual([
      { id: A, onHold: true, comments: 'Joined late' },
      { id: B, comments: null },
    ]);
  });

  it('sends nothing for edits that put a row back as it was', () => {
    const edits = { [A]: { inputs: { workedHours: '270.5' } }, [B]: { onHold: true, comments: 'Bank details pending ' } };
    expect(linePatches(lines, edits).patches).toEqual([]);
    expect(unsavedCount(lines, edits)).toEqual({ cells: 0, rows: 0 });
  });

  it('lists the cells typed wrongly, which count as unsaved', () => {
    const edits = { [A]: { inputs: { workedHours: 'abc', noShowDays: '1' } }, [B]: { inputs: { released: '-1' } } };
    const { errors } = linePatches(lines, edits);
    expect(errors.map((e) => [e.lineId, e.field])).toEqual([
      [A, 'workedHours'],
      [B, 'released'],
    ]);
    expect(unsavedCount(lines, edits)).toEqual({ cells: 3, rows: 2 });
  });

  it('says how many changes are not saved', () => {
    expect(unsavedText({ cells: 1, rows: 1 })).toBe('1 unsaved change');
    expect(unsavedText({ cells: 3, rows: 1 })).toBe('3 unsaved changes');
    expect(unsavedText({ cells: 5, rows: 2 })).toBe('5 unsaved changes in 2 rows');
  });
});

describe('the API’s refusals', () => {
  const sent = [{ id: A, inputs: { workedHours: 800 } }, { id: B, comments: 'x' }];

  it('puts a message naming a row of what was sent by its cell', () => {
    const { cells, general } = placeApiErrors(['lines.1.comments must be shorter than or equal to 500 characters', 'lines.0.inputs.workedHours must not be greater than 744'], sent);
    expect(general).toEqual([]);
    expect(cells).toEqual([
      { lineId: B, field: 'comments', message: 'Comments must be shorter than or equal to 500 characters.' },
      { lineId: A, field: 'workedHours', message: 'Worked hours must not be greater than 744.' },
    ]);
  });

  it('puts a message naming a line by its id with its row, and keeps the rest for the save as a whole', () => {
    const { cells, general } = placeApiErrors([`Line ${B} is not on this payroll.`, 'Enter the hours from 0 to 744, e.g. 270 or 270:30.'], sent);
    expect(cells).toEqual([{ lineId: B, field: null, message: `Line ${B} is not on this payroll.` }]);
    expect(general).toEqual(['Enter the hours from 0 to 744, e.g. 270 or 270:30.']);
  });

  it('lists a cell’s error with the employee and the column', () => {
    expect(errorLine({ lineId: A, field: 'workedHours', message: 'Type the hours as 270:00 or 270.5, up to 744.' }, 'Mona Farid')).toBe(
      'Mona Farid · Worked hours: Type the hours as 270:00 or 270.5, up to 744.',
    );
    expect(errorLine({ lineId: A, field: 'workedHours', message: 'Worked hours must not be greater than 744.' }, 'Mona Farid')).toBe(
      'Mona Farid · Worked hours must not be greater than 744.',
    );
    expect(errorLine({ lineId: A, field: null, message: 'Not on this payroll.' }, 'Mona Farid')).toBe('Mona Farid · Not on this payroll.');
  });
});

describe('the Earnings and Deductions columns (owner, 17 October 2026: "instead of there, i think earnings and deductions will be enough")', () => {
  // gross 10,000, fixed 8,000: a bonus day is 8,000 ÷ 30 = 266.67; 1.5 days 400. Invented.
  const terms: PayrollTerms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 10_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage: 10_000,
    hoursPerDay: 8,
  };
  let n = 0;
  const item = (over: Partial<PayrollAdjustmentItem>): PayrollAdjustmentItem => ({ id: `i${++n}`, kind: 'addition', type: 'commission', taxed: true, amount: 1000, reason: 'Invented', ...over });
  const lineOf = (items: PayrollAdjustmentItem[], inputs: SavedPayrollInputs = EMPTY_PAYROLL_INPUTS) => {
    const t = { ...terms, adjustments: items };
    return { terms: t, result: payrollLine(t, inputs) };
  };

  it('total the month’s additions, taxed or not, and its deductions after tax, as the line has them', () => {
    // 1.5 bonus days 400 + a commission 1,000 + a reimbursement 250 not taxed = 1,650; a correction of 300 and a
    // loan's installment of 500 taken after tax = 800
    const line = lineOf([
      item({ type: 'bonus_days', amount: null, days: 1.5 }),
      item({}),
      item({ type: 'reimbursement', taxed: false, amount: 250 }),
      item({ kind: 'deduction', type: 'correction', taxed: false, amount: 300 }),
      item({ kind: 'deduction', type: 'loan_installment', taxed: false, amount: 500 }),
    ]);
    expect(lineItems(line)).toEqual({ earnings: 1650, untaxed: 250, deductions: 800, count: 5 });
    expect(untaxedNote(lineItems(line))).toBe('EGP 250.00 not taxed');
  });

  it('count a Penalty (days) in the deductions, at a day of the contract’s net', () => {
    const line = lineOf([item({ kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1 })]);
    expect(lineItems(line)).toMatchObject({ earnings: 0, deductions: line.result.penaltyCut, count: 1 });
    expect(line.result.penaltyCut).toBeGreaterThan(0);
    expect(untaxedNote(lineItems(line))).toBeNull();
  });

  it('are none without any', () => {
    expect(lineItems(lineOf([]))).toEqual({ earnings: 0, untaxed: 0, deductions: 0, count: 0 });
  });

  it('take a line saved before then with what the grid had: its bonus, commission and settlements, its penalty days', () => {
    // 2 bonus days 533.33 + a commission 1,500 − settlements 250 = 1,783.33
    const line = lineOf([], { ...EMPTY_PAYROLL_INPUTS, bonusDays: 2, penaltyDays: 1, commission: 1500, settlements: -250 });
    expect(lineItems(line)).toMatchObject({ earnings: 1783.33, deductions: line.result.penaltyCut, count: 0 });
  });
});

describe('the leave days filled in from the leave approved (owner, 18 October 2026: "can you apply the leaves according to the law?")', () => {
  const leave = { paidDays: 3, unpaidDays: 0.25 };

  it('fill the Leave days with the paid days and the Unpaid leave days with the unpaid ones, the other cells with nothing', () => {
    expect(LEAVE_FIELDS).toEqual(['leaveDays', 'unpaidLeaveDays']);
    expect(leaveFill(leave, 'leaveDays')).toBe(3);
    // sick leave at 75% for a day: a quarter of it unpaid
    expect(leaveFill(leave, 'unpaidLeaveDays')).toBe(0.25);
    expect(leaveFill(leave, 'noShowDays')).toBeNull();
    expect(leaveFill(leave, 'expectedHours')).toBeNull();
    // none of a kind, or no leave at all (a line from before leave, or by the hour)
    expect(leaveFill({ paidDays: 0, unpaidDays: 2 }, 'leaveDays')).toBeNull();
    expect(leaveFill(null, 'leaveDays')).toBeNull();
    expect(leaveFill(undefined, 'unpaidLeaveDays')).toBeNull();
  });

  it('come out of the shift’s expected hours like typed ones, unless HR typed the leave days', () => {
    const shift = { shiftExpectedHours: 168, hoursPerDay: 8, leave: { paidDays: 2, unpaidDays: 1 } };
    const cells = (c: Partial<PayrollInputs> = {}) => ({ expectedHours: null, noShowDays: null, leaveDays: null, unpaidLeaveDays: null, ...c });
    // 2 paid and 1 unpaid day of the leave approved: 168 − 3 × 8 = 144
    expect(expectedCell(shift, cells())).toEqual({ hours: 144, fromShift: true });
    // HR typed 1 leave day: it wins over the 2 approved; the unpaid one still counts: 168 − 2 × 8 = 152
    expect(expectedCell(shift, cells({ leaveDays: 1 }))).toEqual({ hours: 152, fromShift: true });
    // HR typed 0 unpaid days: 0 is HR's too
    expect(expectedCell(shift, cells({ unpaidLeaveDays: 0 }))).toEqual({ hours: 152, fromShift: true });
    // HR's expected hours: taken as they are
    expect(expectedCell(shift, cells({ expectedHours: 150 }))).toEqual({ hours: 150, fromShift: false });
  });

  it('say an unpaid leave day costs a day’s pay, under its column', () => {
    expect(columnNote('unpaidLeaveDays', 2)).toBe("A day's pay each, out of the expected hours");
    expect(columnNote('leaveDays', 2)).toBe('Paid, out of the expected hours');
  });

  it('are typed as days, whole or half, like the other days', () => {
    expect(parseCell('days', '1.5')).toEqual({ ok: true, value: 1.5 });
    expect(linePatches([{ id: A, name: 'Mona Farid', inputs: { ...EMPTY_PAYROLL_INPUTS }, onHold: false, comments: null }], { [A]: { inputs: { unpaidLeaveDays: '2' } } }).patches).toEqual([
      { id: A, inputs: { unpaidLeaveDays: 2 } },
    ]);
  });
});

