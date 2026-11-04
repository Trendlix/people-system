import { describe, expect, it } from 'vitest';
import type { OdRequestView } from '../../../../lib/od-types';
import {
  odAskedOf,
  odCheckPath,
  odDoneText,
  odProgressText,
  odRecordForm,
  odRecordProblems,
  odSent,
  odSentText,
  odSourceText,
  odStepText,
  odWhenOf,
  RECORD_OD_PATH,
  recordOdHref,
  recordsOd,
  type TypedOd,
} from './od';

// HR records official duty for someone (owner, 26 October 2026, asked "how to apply or import official duty": "HR
// records it"), and one a leave import brought over ("Import (template + Zoho)"). Every person and place here is
// invented. 2026-11-02 is a Monday.

const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';

const typed = (t: Partial<TypedOd> = {}): TypedOd => ({ startDate: '02/11/2026', endDate: '04/11/2026', span: 'full', fromTime: '', toTime: '', place: 'The client’s office', reason: 'A site visit agreed by phone', ...t });

const fd = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

const view = (r: Partial<OdRequestView>): Pick<OdRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'confidential' | 'steps' | 'recordedByHr' | 'imported'> => ({
  status: 'approved',
  manager: null,
  rejectedStage: null,
  rejectReason: null,
  confidential: false,
  steps: [],
  ...r,
});

describe('Record official duty', () => {
  it('is HR’s and the CEO’s (a C-level person’s), under Official Duty', () => {
    expect(recordsOd({ roles: ['hr'] })).toBe(true);
    expect(recordsOd({ roles: ['ceo'] })).toBe(true);
    expect(recordsOd({ roles: ['manager', 'employee', 'finance'] })).toBe(false);
    expect(RECORD_OD_PATH).toBe('/attendance/official-duty/record');
    expect(recordOdHref(EMPLOYEE)).toBe(`/attendance/official-duty/record?employee=${EMPLOYEE}`);
    expect(recordOdHref()).toBe(RECORD_OD_PATH);
  });

  it('sends the employee with the days, a full day or part of one, where and why', () => {
    expect(odRecordForm(fd({ employeeId: EMPLOYEE, startDate: '02/11/2026', endDate: '04/11/2026', span: 'full', place: ' The client’s office ', reason: ' A site visit ' }))).toEqual({
      body: { employeeId: EMPLOYEE, startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true, place: 'The client’s office', reason: 'A site visit' },
      errors: [],
    });
    expect(odRecordForm(fd({ employeeId: EMPLOYEE, startDate: '02/11/2026', span: 'part', fromTime: '10:00 AM', toTime: '2:00 PM', place: 'Site', reason: 'Shoot' })).body).toEqual({
      employeeId: EMPLOYEE,
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      fullDay: false,
      fromTime: '10:00',
      toTime: '14:00',
      place: 'Site',
      reason: 'Shoot',
    });
    // the reason is required, as every official duty's is
    expect(odRecordForm(fd({ employeeId: EMPLOYEE, startDate: '02/11/2026', place: 'Site', reason: ' ' }))).toEqual({
      body: null,
      errors: ['Write what the official duty is for, e.g. a site visit for the client’s launch.'],
    });
    expect(odRecordForm(fd({ employeeId: 'nobody', startDate: '02/11/2026', place: 'Site', reason: 'Shoot' })).errors).toEqual(['Choose the employee first.']);
  });

  it('checks the days with the API as soon as they can be read, without the place or reason', () => {
    expect(odWhenOf(typed({ place: '', reason: '' }))).toEqual({ startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true });
    expect(odWhenOf(typed({ startDate: '2/11' }))).toBeNull();
    expect(odWhenOf(typed({ endDate: '01/11/2026' }))).toBeNull();
    expect(odWhenOf(typed({ endDate: '', span: 'part', fromTime: '10:00 AM', toTime: '' }))).toBeNull();
    expect(odCheckPath(EMPLOYEE, { startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true })).toBe(
      `/official-duty/check?employeeId=${EMPLOYEE}&startDate=2026-11-02&endDate=2026-11-04&fullDay=true`,
    );
    expect(odCheckPath(EMPLOYEE, { startDate: '2026-11-02', endDate: '2026-11-02', fullDay: false, fromTime: '10:00', toTime: '14:00' })).toBe(
      `/official-duty/check?employeeId=${EMPLOYEE}&startDate=2026-11-02&endDate=2026-11-02&fullDay=false&fromTime=10%3A00&toTime=14%3A00`,
    );
  });

  it('can’t be recorded while something can’t be read or the API refuses the days', () => {
    expect(odRecordProblems(typed({ startDate: '' }), null)).toEqual(['Enter the day of the official duty.']);
    expect(odRecordProblems(typed(), null)).toEqual([]);
    const leave = "Nour Adel has Annual leave on 03/11/2026 (approved): an official duty can't be on a day of leave.";
    expect(odRecordProblems(typed(), { problems: [leave] })).toEqual([leave]);
    // what can't be read here first, the API's after
    expect(odRecordProblems(typed({ reason: '' }), { problems: [leave] })).toEqual(['Write what the official duty is for, e.g. a site visit for the client’s launch.']);
  });

  it('says it was recorded', () => {
    expect(odSentText('approved')).toBe('Official duty recorded.');
    expect(odDoneText({ done: 'recorded' }, 'approved')).toEqual({ text: odSentText('approved'), tone: 'ok' });
  });
});

describe('how an official duty came', () => {
  it('asked, recorded by HR, or imported', () => {
    expect(odSourceText({})).toBe('Asked by the employee');
    expect(odSourceText({ recordedByHr: true })).toBe('Recorded');
    expect(odSourceText({ recordedByHr: true, imported: true })).toBe('Imported');
    expect(odProgressText(view({ recordedByHr: true }))).toEqual({ text: 'Recorded', reason: null });
    expect(odProgressText(view({ recordedByHr: true, imported: true }))).toEqual({ text: 'Imported', reason: null });
    // an API from before them: approved
    expect(odProgressText(view({}))).toEqual({ text: 'Approved', reason: null });
    // imported pending in Zoho: where it stands, as any request
    expect(odProgressText(view({ status: 'with_hr', imported: true })).text).toBe('Waiting for HR');
  });

  it('words HR’s recording and an import in the steps', () => {
    expect(odStepText({ kind: 'recorded_by_hr', decision: null, comment: null })).toBe('Recorded, approved at once');
    expect(odStepText({ kind: 'imported', decision: null, comment: 'Imported from Leave.xlsx' })).toBe('Imported, approved');
  });
});

// HR records official duty on a single rest day or official holiday with its compensation (owner, 27 October 2026: "it
// should count in the compensatories"; "One step"): the form shows the compensation while the API's check says one is
// needed, and checks again with it as it is chosen. 23/10/2026 is a Friday, 27/10/2026 a Tuesday.

describe('Record official duty on a rest day or an official holiday', () => {
  const restDay = (t: Partial<TypedOd> = {}) => typed({ startDate: '23/10/2026', endDate: '', compensation: 'day_off', dayOff: '27/10/2026', ...t });

  it('checks the compensation chosen with the days, so the check runs again as it changes', () => {
    const when = { startDate: '2026-10-23', endDate: '2026-10-23', fullDay: true };
    expect(odCheckPath(EMPLOYEE, when, odAskedOf(restDay()))).toBe(
      `/official-duty/check?employeeId=${EMPLOYEE}&startDate=2026-10-23&endDate=2026-10-23&fullDay=true&compensation=day_off&dayOff=2026-10-27`,
    );
    expect(odCheckPath(EMPLOYEE, when, odAskedOf(restDay({ compensation: 'cash' })))).toBe(
      `/official-duty/check?employeeId=${EMPLOYEE}&startDate=2026-10-23&endDate=2026-10-23&fullDay=true&compensation=cash`,
    );
    // a day off still being typed: a day off without its date (the check asks for it)
    expect(odAskedOf(restDay({ dayOff: '27/1' }))).toEqual({ compensation: 'day_off' });
    expect(odAskedOf(restDay({ compensation: '' }))).toBeNull();
    // none while none is asked for
    expect(odCheckPath(EMPLOYEE, when, null)).toBe(`/official-duty/check?employeeId=${EMPLOYEE}&startDate=2026-10-23&endDate=2026-10-23&fullDay=true`);
  });

  it('records the compensation with the duty, only while the form shows it', () => {
    const values = { employeeId: EMPLOYEE, startDate: '23/10/2026', span: 'full', place: 'Site', reason: 'Shoot' };
    const body = { employeeId: EMPLOYEE, startDate: '2026-10-23', endDate: '2026-10-23', fullDay: true, place: 'Site', reason: 'Shoot' };
    expect(odRecordForm(fd({ ...values, compensation: 'day_off', dayOff: '27/10/2026' })).body).toEqual({ ...body, compensation: 'day_off', dayOff: '2026-10-27' });
    expect(odRecordForm(fd({ ...values, compensation: 'cash', dayOff: '27/10/2026' })).body).toEqual({ ...body, compensation: 'cash' });
    expect(odRecordForm(fd(values)).body).toEqual(body);
  });

  it('says what refuses it', () => {
    const choose = "23/10/2026 is a rest day of Nour Adel's shift: official duty on it earns a whole day off, so choose the day off or cash instead.";
    expect(odRecordProblems(odSent(restDay({ compensation: '' }), true), { problems: [choose] })).toEqual([choose]);
    expect(odRecordProblems(odSent(restDay({ dayOff: '31/13/2026' }), true), null)).toEqual(['Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.']);
    // a working day: the day off left in the form isn't read
    expect(odRecordProblems(odSent(restDay({ startDate: '26/10/2026', dayOff: '31/13/2026' }), false), { problems: [] })).toEqual([]);
  });
});
