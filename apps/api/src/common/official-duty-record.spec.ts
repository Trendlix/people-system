import {
  alreadyOdText,
  defaultZohoType,
  isTemplateOdType,
  OD_IMPORT_ROW_LABEL,
  OD_STEP_KIND_LABELS,
  OD_STEP_KINDS,
  odDaysProblems,
  odFileHalfDayText,
  odHalfDaysText,
  odImportReason,
  odInputProblems,
  odLockProblem,
  odNameIsLeaveTypeText,
  odOffInZohoInsideText,
  odOverlapsRowText,
  odOverlapsText,
  odPastLimitText,
  odRecordCheck,
  odRowTooLongText,
  odSameRowText,
  odWhenProblems,
  recordsOdFor,
  TEMPLATE_OD_TYPE_NAME,
  ZOHO_OD_NOTE,
  ZOHO_OD_PENDING_NOTE,
  ZOHO_OD_TARGET,
  ZOHO_OD_TARGET_LABEL,
  ZOHO_WFH_TARGET,
  zohoTypeTarget,
  type ImportLeaveType,
  type OdDayFacts,
  type OdInput,
} from '@trendlix/shared';
import { recordedByHrText } from '../notifications/texts.js';

// Official duty recorded by HR and imported (owner, 26 October 2026, asked "how to apply or import official duty":
// "HR records it" and "Import (template + Zoho)"): packages/shared official-duty.ts and leave-import.ts. 2026-11-01 is a
// Sunday.

const TODAY = '2026-11-12';
const MORNING = { startTime: '09:00', endTime: '19:00', graceMinutes: 15 };
const input = (over: Partial<OdInput> = {}): OdInput => ({
  startDate: '2026-11-15',
  endDate: '2026-11-15',
  fullDay: true,
  fromTime: null,
  toTime: null,
  place: 'Client office, New Cairo',
  reason: 'Launch shoot',
  ...over,
});
const fact = (date: string, over: Partial<OdDayFacts> = {}): OdDayFacts => ({ date, workingDay: true, holiday: null, leave: null, wfh: null, od: [], ...over });

describe('HR records an official duty (owner, 26 October 2026: "HR records it")', () => {
  it('is HR’s; a C-level person’s the CEO’s or HR’s who sees them, as their HR stage is decided', () => {
    const hr = { roles: ['hr' as const] };
    const ceo = { roles: ['ceo' as const] };
    const owner = { roles: ['hr' as const, 'super_admin' as const] };
    const manager = { roles: ['manager' as const] };
    expect([recordsOdFor(hr, false), recordsOdFor(ceo, false), recordsOdFor(owner, false), recordsOdFor(manager, false)]).toEqual([true, false, true, false]);
    expect([recordsOdFor(hr, true), recordsOdFor(ceo, true), recordsOdFor(owner, true), recordsOdFor(manager, true)]).toEqual([false, true, true, false]);
  });

  it('is logged as recorded by HR, or imported; the employee is told', () => {
    expect(OD_STEP_KINDS).toEqual(['submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled', 'imported']);
    expect(OD_STEP_KIND_LABELS.recorded_by_hr).toBe('Recorded by HR');
    expect(OD_STEP_KIND_LABELS.imported).toBe('Imported');
    expect(recordedByHrText('od', '15/11/2026–18/11/2026', '/attendance/official-duty/1')).toEqual({
      kind: 'od_decided',
      title: 'Official duty recorded by HR',
      body: '15/11/2026–18/11/2026',
      link: '/attendance/official-duty/1',
    });
  });

  it('goes past the 3-day limit with a warning, marked so; within it, none', () => {
    expect(odPastLimitText('2026-11-09', TODAY)).toBeNull();
    expect(odPastLimitText('2026-11-20', TODAY)).toBeNull();
    expect(odPastLimitText('2026-11-02', TODAY)).toBe('02/11/2026 is 10 days ago, past the 3 days an employee may ask after: recorded by HR after the limit.');
    const past = odRecordCheck(input({ startDate: '2026-11-02', endDate: '2026-11-03' }), [fact('2026-11-02'), fact('2026-11-03')], MORNING, TODAY, 'Ben Away');
    expect(past).toEqual({ problems: [], warnings: ['02/11/2026 is 10 days ago, past the 3 days an employee may ask after: recorded by HR after the limit.'] });
    expect(odRecordCheck(input(), [fact('2026-11-15')], MORNING, TODAY, 'Ben Away')).toEqual({ problems: [], warnings: [] });
  });

  it('still needs the reason (every official duty’s), and reads the days alone for the live check', () => {
    expect(odInputProblems(input({ startDate: '2026-11-02', reason: ' ' }))).toEqual(['Write what the official duty is for, e.g. a site visit for the client’s launch.']);
    expect(odWhenProblems(input({ place: '', reason: '' }))).toEqual([]);
    expect(odWhenProblems(input({ startDate: '2026-11-15', endDate: '2026-11-14' }))).toEqual(["The last day can't be before the first."]);
    // a check of days that can't be read says only that
    expect(odRecordCheck(input({ endDate: '2026-11-14' }), [], MORNING, TODAY, 'Ben Away')).toEqual({ problems: ["The last day can't be before the first."], warnings: [] });
  });

  it('keeps every other check: the shift, a rest day or holiday on its own, leave, work from home, another official duty, a compensatory day off', () => {
    const checked = odRecordCheck(
      input({ startDate: '2026-11-15', endDate: '2026-11-18' }),
      [
        fact('2026-11-15', { leave: { type: 'Annual leave', status: 'approved', halfDay: false } }),
        fact('2026-11-16', { wfh: { status: 'with HR' } }),
        fact('2026-11-17', { od: [{ status: 'approved', fullDay: true, fromTime: null, toTime: null }] }),
        fact('2026-11-18', { compensatory: { status: 'approved' } }),
      ],
      MORNING,
      TODAY,
      'Ben Away',
    );
    expect(checked.problems).toEqual([
      "Ben Away has Annual leave on 15/11/2026 (approved): an official duty can't be on a day of leave.",
      'Ben Away has a work from home day on 16/11/2026 (with HR): ask for one or the other.',
      'Ben Away has an official duty on 17/11/2026 already (approved).',
      "Ben Away has a compensatory day off on 18/11/2026 (approved): an official duty can't be on a day off.",
    ]);
    expect(odRecordCheck(input({ fullDay: false, fromTime: '07:00', toTime: '08:00' }), [fact('2026-11-15')], MORNING, TODAY, 'Ben Away').problems).toEqual([
      "Choose times within Ben Away's shift, 9:00 AM to 7:00 PM.",
    ]);
    expect(odRecordCheck(input(), [fact('2026-11-15', { workingDay: false })], MORNING, TODAY, 'Ben Away').problems).toEqual([
      "15/11/2026 is a rest day of Ben Away's shift: there is no work that day, so no official duty.",
    ]);
    // an employee's own request meets a compensatory day off too
    expect(odDaysProblems(input(), [fact('2026-11-15', { compensatory: { status: 'with the manager' } })])).toEqual([
      "You have a compensatory day off on 15/11/2026 (with the manager): an official duty can't be on a day off.",
    ]);
  });

  it('is refused in a month whose payroll is with the CEO, approved or paid, as leave edits are', () => {
    const runs = [
      { month: '2026-10', status: 'approved' },
      { month: '2026-11', status: 'draft' },
      { month: '2026-12', status: 'pending_ceo' },
    ];
    expect(odLockProblem('2026-10-28', '2026-10-29', runs)).toBe(
      "The October 2026 payroll is approved, so its days can't change. Ask the CEO to return the payroll to HR first, or record days in another month.",
    );
    expect(odLockProblem('2026-11-28', '2026-12-02', runs)).toMatch(/^The December 2026 payroll is with the CEO, so its days can't change/);
    expect(odLockProblem('2026-11-02', '2026-11-04', runs)).toBeNull();
    expect(odLockProblem('2026-09-30', '2026-10-01', [{ month: '2026-10', status: 'paid' }])).toMatch(/payroll is paid/);
    const locked = odRecordCheck(input({ startDate: '2026-10-28', endDate: '2026-10-28' }), [fact('2026-10-28')], MORNING, TODAY, 'Ben Away', runs);
    expect(locked.problems).toEqual([expect.stringMatching(/^The October 2026 payroll is approved/)]);
    expect(locked.warnings).toHaveLength(1);
  });
});

describe('official duty in the leave import (owner, 26 October 2026: "Import (template + Zoho)")', () => {
  const TYPES: ImportLeaveType[] = [
    { id: 't-annual', key: 'annual', kind: 'law', nameEn: 'Annual leave', active: true },
    { id: 't-sick', key: 'sick', kind: 'law', nameEn: 'Sick leave', active: true },
  ];

  it('reads the template’s Official duty, in its other spellings, whatever the case', () => {
    expect(TEMPLATE_OD_TYPE_NAME).toBe('Official duty');
    for (const text of ['Official duty', 'OFFICIAL DUTY', ' od ', 'OD', 'On duty', 'On-Duty', 'مأمورية', 'مامورية']) expect(isTemplateOdType(text), text).toBe(true);
    for (const text of ['Work from home', 'Annual leave', 'Duty free', 'odd', '']) expect(isTemplateOdType(text), text).toBe(false);
    expect(OD_IMPORT_ROW_LABEL).toBe('Official duty');
  });

  it('maps Zoho’s On Duty to official duty days by default, unless a type of the system has its name; HR’s choice wins', () => {
    expect(defaultZohoType('On Duty', TYPES)).toEqual({ typeId: null, wfh: false, od: true, note: ZOHO_OD_NOTE });
    expect(defaultZohoType('Official Duty', TYPES).od).toBe(true);
    expect(defaultZohoType('OD', TYPES).od).toBe(true);
    expect(ZOHO_OD_NOTE).toBe('Imported as approved official duty (not leave): its days count as attended, and no balance is used.');
    // a real leave type named the same wins
    const own = [...TYPES, { id: 't-onduty', key: 'custom-on-duty', kind: 'custom', nameEn: 'On duty', active: true }];
    expect(defaultZohoType('On Duty', own)).toEqual({ typeId: 't-onduty', wfh: false, note: null });
    // the others as before: Working from home is work-from-home days, not official duty
    expect(defaultZohoType('Working from home', TYPES)).toMatchObject({ wfh: true, typeId: null });
    expect(defaultZohoType('Working from home', TYPES).od).toBeUndefined();

    expect(ZOHO_OD_TARGET).toBe('od');
    expect(ZOHO_OD_TARGET_LABEL).toBe('Official duty days');
    const onDuty = defaultZohoType('On Duty', TYPES);
    const annual = defaultZohoType('Annual Leave', TYPES);
    expect(zohoTypeTarget(undefined, onDuty)).toEqual({ kind: 'od' });
    expect(zohoTypeTarget('skip', onDuty)).toEqual({ kind: 'skip' });
    expect(zohoTypeTarget('t-sick', onDuty)).toEqual({ kind: 'leave', typeId: 't-sick' });
    expect(zohoTypeTarget(ZOHO_OD_TARGET, annual)).toEqual({ kind: 'od' });
    expect(zohoTypeTarget(ZOHO_WFH_TARGET, onDuty)).toEqual({ kind: 'wfh' });
  });

  it('says what a row becomes: a half day counted whole, Zoho’s days off inside it, a row too long, the name taken', () => {
    expect(odFileHalfDayText('2026-07-05')).toBe('05/07/2026 is a half day in the file: an official duty imported is a full day here, so it is counted as one.');
    expect(odHalfDaysText(['2026-07-05'])).toBe('05/07/2026 is a half day in Zoho People: an official duty imported is a full day here.');
    expect(odHalfDaysText([])).toBeNull();
    expect(odOffInZohoInsideText(['2026-07-06'])).toBe('06/07/2026 is a holiday or weekend in Zoho People but a working day here: within the official duty, it counts as a duty day.');
    expect(odOffInZohoInsideText(['2026-07-06', '2026-07-07'])).toMatch(/^06\/07\/2026 and 07\/07\/2026 are holidays or weekends in Zoho People but working days here/);
    expect(odOffInZohoInsideText([])).toBeNull();
    expect(odRowTooLongText()).toBe('An official duty row covers at most 31 days in a row: put the rest on a row of its own.');
    expect(odNameIsLeaveTypeText('Official duty')).toMatch(/^“Official duty” is a leave type of the system, so rows named so are imported as that leave, not as official duty/);
    expect(ZOHO_OD_PENDING_NOTE).toMatch(/^Pending in Zoho People: imported as an official duty request/);
  });

  it('takes the row’s notes as the reason, else where it came from; says a duplicate and an overlap', () => {
    expect(odImportReason('  Client visit in Alexandria ', 'Leave.xlsx')).toBe('Client visit in Alexandria');
    expect(odImportReason(null, 'Leave.xlsx')).toBe('Imported from Leave.xlsx');
    expect(odImportReason('x'.repeat(1200), 'Leave.xlsx')).toHaveLength(1000);
    expect(alreadyOdText('2026-07-05', '2026-07-07', 'approved')).toBe('Already an official duty on 05/07/2026–07/07/2026 (approved).');
    expect(alreadyOdText('2026-07-05', '2026-07-05', 'imported from Zoho.xlsx')).toBe('Already an official duty on 05/07/2026 (imported from Zoho.xlsx).');
    expect(odOverlapsText('2026-07-06', '2026-07-08', 'with HR')).toBe(
      "Overlaps an official duty on 06/07/2026–08/07/2026 (with HR): put the row's days right, or cancel that official duty first.",
    );
    expect(odSameRowText(4)).toBe('The same official duty as row 4 of the file.');
    expect(odOverlapsRowText(4)).toBe('Overlaps the official duty in row 4 of the file: put the days right in one of them.');
  });
});
