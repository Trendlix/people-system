import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../../../lib/types';
import {
  CONVERSION_PROBATION_HINT,
  conversionDefaults,
  conversionStart,
  contractActions,
  convertHref,
  draftKind,
  hireTooSoonText,
  noProbationHint,
  onlyRenewalNote,
  renewalRefusal,
  trainingReminder,
  trainingWayText,
} from './training';

// Interns' agreements (owner, 19 October 2026): renewed once at most, then converted to full-time; the one internship
// since 25 October 2026 (owner: "unpaid internship and training are the same thing").

const first = { agreement: 1, next: 'renew_or_convert' } as const;
const renewal = { agreement: 2, next: 'convert_or_end' } as const;

describe('the Contract section’s actions', () => {
  const base = { canEdit: true, hasDraft: false, endingInProgress: false, active: true, employmentType: 'full_time' };

  it('renews a fixed term, never an open-ended one in force, and raises a full-time contract', () => {
    expect(contractActions({ ...base, previous: { form: 'fixed', status: 'active', training: null } })).toEqual({ renew: true, convert: false, raise: true });
    expect(contractActions({ ...base, previous: { form: 'open_ended', status: 'active', training: null } })).toEqual({ renew: false, convert: false, raise: true });
    // an API from before training agreements
    expect(contractActions({ ...base, previous: { form: 'fixed', status: 'active' } }).renew).toBe(true);
  });

  it('renews an intern’s first agreement, never its renewal, and converts either to full-time', () => {
    expect(contractActions({ ...base, employmentType: 'intern', previous: { form: 'fixed', status: 'active', training: first } })).toEqual({
      renew: true,
      convert: true,
      raise: false,
    });
    expect(contractActions({ ...base, employmentType: 'intern', previous: { form: 'fixed', status: 'active', training: renewal } })).toEqual({
      renew: false,
      convert: true,
      raise: false,
    });
  });

  it('offers nothing to anyone but HR, with a draft, or while an ending is in progress', () => {
    const previous = { form: 'fixed', status: 'active', training: first } as const;
    const none = { renew: false, convert: false, raise: false };
    expect(contractActions({ ...base, canEdit: false, previous })).toEqual(none);
    expect(contractActions({ ...base, hasDraft: true, previous })).toEqual(none);
    expect(contractActions({ ...base, endingInProgress: true, previous })).toEqual(none);
    // no contract at all: asked for below, not renewed
    expect(contractActions({ ...base, active: false, previous: undefined })).toEqual(none);
  });

  it('links the conversion to the New contract page', () => {
    expect(convertHref('e-1')).toBe('/employees/e-1/contracts/new?convert=full_time');
  });
});

describe('the reminder of an agreement’s end', () => {
  it('says when it ends and the way forward, from 60 days before', () => {
    expect(trainingReminder({ endDate: '2027-03-31', training: first }, '2027-02-01')).toEqual({
      text: 'Internship ends on 31/03/2027: renew it once, or convert to full-time.',
      way: trainingWayText('renew_or_convert'),
      passed: false,
    });
    expect(trainingReminder({ endDate: '2027-03-31', training: renewal }, '2027-03-31')).toEqual({
      text: 'Internship ends on 31/03/2027: convert to full-time, or end the internship.',
      way: trainingWayText('convert_or_end'),
      passed: false,
    });
    expect(trainingReminder({ endDate: '2027-03-31', training: renewal }, '2027-04-02')).toMatchObject({
      text: 'Internship ended on 31/03/2027: convert to full-time, or end the internship.',
      passed: true,
    });
  });

  it('waits until 60 days before, and is none for any other contract', () => {
    expect(trainingReminder({ endDate: '2027-03-31', training: first }, '2027-01-29')).toBeNull();
    expect(trainingReminder({ endDate: '2027-03-31', training: first }, '2027-01-30')).not.toBeNull();
    expect(trainingReminder({ endDate: '2027-03-31', training: null }, '2027-03-30')).toBeNull();
    expect(trainingReminder({ endDate: null, training: first }, '2027-03-30')).toBeNull();
  });

  it('words the way forward without a renewal in writing, a non-renewal notice or Art. 88', () => {
    expect(trainingWayText('renew_or_convert')).toBe(
      'Renew it once with Renew, or convert it with Convert to full-time. To end the internship, use End employment and choose Training completed.',
    );
    expect(trainingWayText('convert_or_end')).toMatch(/^It was renewed once already, so it isn’t renewed again: convert it with Convert to full-time/);
    for (const next of ['renew_or_convert', 'convert_or_end'] as const) expect(trainingWayText(next)).not.toMatch(/in writing|non-renewal|Art\. 88/);
  });
});

describe('drafts and the renewal', () => {
  it('labels a conversion, a renewal and a first contract', () => {
    expect(draftKind({ version: 2, convertsTo: 'full_time' })).toBe(' (Conversion to full-time)');
    expect(draftKind({ version: 2, convertsTo: null })).toBe(' (Renewal)');
    expect(draftKind({ version: 1 })).toBe('');
  });

  it('refuses a second renewal with the way instead', () => {
    expect(renewalRefusal({ training: renewal })).toBe('An internship agreement is renewed once. Convert it to a full-time contract instead.');
    expect(renewalRefusal({ training: first })).toBeNull();
    expect(renewalRefusal({ training: null })).toBeNull();
    expect(renewalRefusal(undefined)).toBeNull();
    expect(onlyRenewalNote()).toBe(
      'This is the internship agreement’s one renewal: when it ends, it is converted to a full-time contract or the internship ends.',
    );
  });

  it('says plainly why an intern has no probation', () => {
    expect(noProbationHint()).toMatch(/^None: an intern has no probation, as an internship agreement isn’t an employment contract/);
  });
});

describe('converting an agreement to full-time', () => {
  const settings = { probationMonths: 3, durationMonths: 12, basicPercentDefault: 75 };
  const agreement = {
    endDate: '2027-03-31',
    daysPerWeek: 5,
    basicPercent: 80,
    allowances: [{ allowanceTypeId: 'transport', nameEn: 'Transportation', nameAr: 'بدل انتقال', taxable: false, insured: false, amount: 1500 }],
  } as unknown as Contract;

  it('starts as a full-time contract the day after the agreement ends, with its allowances and the settings’ probation', () => {
    expect(conversionDefaults(settings, agreement, false)).toEqual({
      startDate: '2027-04-01',
      form: 'fixed',
      durationMonths: 12,
      jobToDo: '',
      endDate: '',
      probationMonths: 3,
      payBasis: 'monthly',
      grossSalary: null,
      hourlyRate: null,
      hoursPerWeek: null,
      hourlyMinimum: null,
      daysPerWeek: 5,
      basicPercent: 75,
      netSalary: null,
      allowances: [{ allowanceTypeId: 'transport', amount: 1500 }],
      note: '',
    });
    expect(CONVERSION_PROBATION_HINT).toMatch(/the agreement had no probation, so the full-time contract may have it/);
  });

  it('has no probation for someone who had an earlier employment here, and no start without an end', () => {
    expect(conversionDefaults(settings, agreement, true).probationMonths).toBe(0);
    expect(conversionStart({ endDate: null })).toBe('');
  });
});

describe('a new agreement six months after the last', () => {
  const nextTraining = { lastEnded: '2026-10-31', from: '2027-05-01' };
  const base = { name: 'Sara Ali', today: '2027-02-01', nextTraining };

  it('warns when the join date typed, or today, is before the six months are up', () => {
    const message = 'A new internship agreement for Sara Ali can start from 01/05/2027, six months after their last one ended on 31/10/2026.';
    expect(hireTooSoonText({ ...base, type: 'intern', joinDate: '2027-04-30' })).toBe(message);
    expect(hireTooSoonText({ ...base, type: 'intern', joinDate: null })).toBe(message);
    expect(hireTooSoonText({ ...base, type: 'intern', joinDate: '' })).toBe(message);
  });

  it('says nothing from the six months on, for another type, or for someone who never had one', () => {
    expect(hireTooSoonText({ ...base, type: 'intern', joinDate: '2027-05-01' })).toBeNull();
    expect(hireTooSoonText({ ...base, type: 'full_time', joinDate: '2027-02-01' })).toBeNull();
    expect(hireTooSoonText({ ...base, type: 'intern', joinDate: '2027-02-01', nextTraining: null })).toBeNull();
    // a trainee is no type of its own any more (25 October 2026)
    expect(hireTooSoonText({ ...base, type: 'trainee', joinDate: '2027-02-01' })).toBeNull();
    expect(hireTooSoonText({ ...base, type: '', joinDate: null })).toBeNull();
  });
});
