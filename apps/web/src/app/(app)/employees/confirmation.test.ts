import { describe, expect, it } from 'vitest';
import type { ChangeRequest, ProfileConfirmation } from '../../../lib/types';
import {
  bannerMessage,
  changedKeys,
  changeShown,
  confirmationStatus,
  fieldName,
  fieldNames,
  fieldTexts,
  mustReview,
  openDuringReview,
  parseFieldTexts,
  pendingRequest,
  profileValue,
  requestedChanges,
  reviewHref,
  shownValue,
} from './confirmation';

const confirmation = (c: Partial<ProfileConfirmation>): ProfileConfirmation => ({
  confirmedAt: null,
  confirmedBy: null,
  upToDate: false,
  changedFields: [],
  disclaimerVersion: null,
  ...c,
});

describe('fieldName', () => {
  it('names a field by its label', () => {
    expect(fieldName('mobile')).toBe('Mobile');
    expect(fieldNames(['mobile', 'city'])).toBe('Mobile, City');
  });

  it("says the emergency contact's fields are the emergency contact's", () => {
    expect(fieldName('emergencyMobile')).toBe('Emergency contact mobile');
    expect(fieldName('emergencyName')).toBe('Emergency contact name');
  });

  it('keeps a field it does not know as it came', () => {
    expect(fieldName('somethingNew')).toBe('somethingNew');
  });
});

describe('shownValue', () => {
  it('shows the label of a value from a list', () => {
    expect(shownValue('gender', 'female')).toBe('Female');
    expect(shownValue('degree', 'bachelor')).toBe("Bachelor's");
    expect(shownValue('educationGrade', 'very_good')).toBe('Very good');
    expect(shownValue('maritalStatus', 'married')).toBe('Married');
  });

  it('shows dates as DD/MM/YYYY and numbers as text', () => {
    expect(shownValue('dateOfBirth', '1994-03-07')).toBe('07/03/1994');
    expect(shownValue('graduationYear', 2016)).toBe('2016');
  });

  it('shows mobiles as kept, and nothing as empty', () => {
    expect(shownValue('mobile', '+201012345678')).toBe('+201012345678');
    expect(shownValue('mobile2', null)).toBe('');
    expect(shownValue('city', '')).toBe('');
  });

  it('keeps a value that is not on its list', () => {
    expect(shownValue('gender', 'unknown')).toBe('unknown');
  });
});

describe('profileValue', () => {
  it("shows a woman's military status as Not applicable, as the profile does", () => {
    expect(profileValue({ gender: 'female', militaryStatus: null } as never, 'militaryStatus')).toBe('Not applicable');
    expect(profileValue({ gender: 'male', militaryStatus: 'exempt' } as never, 'militaryStatus')).toBe('Exempt');
  });
});

describe('bannerMessage', () => {
  it('says nothing when up to date, or when the API has no confirmation yet', () => {
    expect(bannerMessage(undefined)).toBeNull();
    expect(bannerMessage(confirmation({ confirmedAt: '2026-10-15T08:00:00Z', upToDate: true }))).toBeNull();
  });

  it('asks to confirm when never confirmed', () => {
    expect(bannerMessage(confirmation({}))).toBe('Please review and confirm your details.');
  });

  it('names what changed since the last confirmation', () => {
    expect(bannerMessage(confirmation({ confirmedAt: '2026-10-01T08:00:00Z', changedFields: ['mobile', 'city'] }))).toBe(
      'Your details changed since you confirmed them (Mobile, City). Please review and confirm again.',
    );
  });

  it('asks again without a list when nothing is named (e.g. a new statement)', () => {
    expect(bannerMessage(confirmation({ confirmedAt: '2026-10-01T08:00:00Z' }))).toBe('Please review and confirm your details again.');
  });
});

describe('confirmationStatus', () => {
  it('is empty without a confirmation from the API', () => {
    expect(confirmationStatus(undefined)).toBeNull();
  });

  it('gives the day confirmed, in Cairo, as DD/MM/YYYY', () => {
    expect(confirmationStatus(confirmation({ confirmedAt: '2026-10-14T22:30:00Z', upToDate: true }))).toEqual({
      tone: 'ok',
      text: 'Confirmed by the employee on 15/10/2026',
    });
  });

  it('says not confirmed yet, or what changed since', () => {
    expect(confirmationStatus(confirmation({}))).toEqual({ tone: 'none', text: 'Not confirmed by the employee yet' });
    expect(confirmationStatus(confirmation({ confirmedAt: '2026-10-01T08:00:00Z', changedFields: ['mobile', 'city'] }))).toEqual({
      tone: 'changed',
      text: 'Changed since the employee confirmed: Mobile, City',
    });
  });
});

describe('pendingRequest and changeShown', () => {
  it('finds the request waiting for HR', () => {
    const requests = [{ id: 'a', status: 'rejected' }, { id: 'b', status: 'pending' }] as never;
    expect(pendingRequest(requests)?.id).toBe('b');
    expect(pendingRequest(undefined)).toBeUndefined();
  });

  it('shows a change as the profile shows the values', () => {
    expect(changeShown({ field: 'gender', label: 'Gender', from: 'male', to: 'female' })).toEqual({ name: 'Gender', from: 'Male', to: 'Female', ar: false });
    expect(changeShown({ field: 'city', label: 'City', from: null, to: 'مدينة نصر' })).toEqual({ name: 'City', from: '', to: 'مدينة نصر', ar: true });
    expect(changeShown({ field: 'other', label: 'Other thing', from: 'a', to: 'b' }).name).toBe('Other thing');
  });
});

describe('the change request form', () => {
  const start = {
    fullNameEn: 'Mona Adel',
    mobile: '+201012345678',
    dateOfBirth: '07/03/1994',
    graduationYear: '2016',
    city: 'مدينة نصر',
  };

  it('reads only the fields an employee may ask to change', () => {
    const fd = new FormData();
    fd.set('fullNameEn', 'Mona Adel');
    fd.set('employeeCode', 'EMP-0001');
    fd.set('workEmail', 'mona@trendlix.com');
    fd.set('note', 'why');
    expect(fieldTexts(fd)).toEqual({ fullNameEn: 'Mona Adel' });
  });

  it('never asks to change the work email, which the company sets', () => {
    const before = { ...start, workEmail: 'mona@trendlix.com' };
    expect(changedKeys(before, { ...before, workEmail: 'other@trendlix.com' })).toEqual([]);
    expect(requestedChanges(before, { ...before, workEmail: 'other@trendlix.com', mobile: '+201112223334' }).changes).toEqual({
      mobile: '+201112223334',
    });
  });

  it('finds no change when nothing was edited, spaces around a value aside', () => {
    expect(changedKeys(start, { ...start, fullNameEn: ' Mona Adel ' })).toEqual([]);
    expect(requestedChanges(start, start)).toEqual({ changes: {}, errors: [] });
  });

  it('sends only the changed fields, as the API takes them', () => {
    const now = { ...start, mobile: '+201112223334', dateOfBirth: '8/3/1994', graduationYear: '2017', city: '' };
    expect(changedKeys(start, now)).toEqual(['dateOfBirth', 'mobile', 'city', 'graduationYear']);
    expect(requestedChanges(start, now)).toEqual({
      changes: { dateOfBirth: '1994-03-08', mobile: '+201112223334', city: null, graduationYear: 2017 },
      errors: [],
    });
  });

  it('counts a field filled in that was empty', () => {
    expect(requestedChanges(start, { ...start, mobile2: '+201000000000' }).changes).toEqual({ mobile2: '+201000000000' });
  });

  it('leaves out fields the form does not have', () => {
    expect(changedKeys(start, { fullNameEn: 'Mona Adel' })).toEqual([]);
  });

  it('says what is wrong with a date or a year', () => {
    const { errors } = requestedChanges(start, { ...start, dateOfBirth: '31/02/1994', graduationYear: '16' });
    expect(errors).toEqual(['Enter the date of birth as DD/MM/YYYY, e.g. 14/10/2026.', 'Enter the graduation year as four digits, e.g. 2016.']);
  });

  it('reads the starting values sent with the form, and nothing else', () => {
    expect(parseFieldTexts(JSON.stringify({ ...start, employeeCode: 'X', workEmail: 'mona@trendlix.com', mobile2: 5 }))).toEqual(start);
    expect(parseFieldTexts('')).toBeNull();
    expect(parseFieldTexts('not json')).toBeNull();
    expect(parseFieldTexts('[1]')).toBeNull();
    expect(parseFieldTexts(null)).toBeNull();
  });
});

// the review at sign-in (owner, 31 October 2026: "make the data review obligatory upon the signin for employees")
describe('mustReview', () => {
  const request = (status: ChangeRequest['status']) => ({ status }) as ChangeRequest;

  it('asks for the review until the details are confirmed as they are now', () => {
    expect(mustReview(confirmation({}), [])).toBe(true);
    expect(mustReview(confirmation({ confirmedAt: '2026-10-15T08:00:00Z', changedFields: ['mobile'] }), undefined)).toBe(true);
    expect(mustReview(confirmation({ confirmedAt: '2026-10-15T08:00:00Z', upToDate: true }), [])).toBe(false);
  });

  it('lets them through while a change they asked for waits for HR, and asks again once HR decided it', () => {
    expect(mustReview(confirmation({}), [request('pending')])).toBe(false);
    expect(mustReview(confirmation({}), [request('approved'), request('rejected'), request('cancelled')])).toBe(true);
  });

  it('asks nothing of an API without confirmations', () => {
    expect(mustReview(undefined, [])).toBe(false);
  });
});

describe('openDuringReview', () => {
  it('keeps the review, the change request and the new photo open; everything else waits', () => {
    expect(reviewHref('e1')).toBe('/employees/e1/confirm');
    for (const path of ['/employees/e1/confirm', '/employees/e1/change-request', '/employees/e1/photo', '/employees/e1/confirm/']) {
      expect(openDuringReview(path, 'e1')).toBe(true);
    }
    for (const path of ['/', '/dashboard', '/employees/e1', '/employees/e2/confirm', '/employees/e1/confirm-x', '/leave', '/app']) {
      expect(openDuringReview(path, 'e1')).toBe(false);
    }
  });
});
