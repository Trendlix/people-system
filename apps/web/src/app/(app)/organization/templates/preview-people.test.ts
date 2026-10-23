import { describe, expect, it } from 'vitest';
import {
  choiceOption,
  choiceParam,
  dataPreviewHref,
  isOfferSlot,
  OFFER_PREVIEW_HINT,
  offerOption,
  personOption,
  PREVIEW_HINT,
  previewHint,
  previewPeopleHref,
  readPeople,
} from './preview-people';

const ID = '3f2b8c1e-5d4a-4f6b-9c7d-2a1e0b9f8d7c';
const EMP = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OFF = 'c0ffee00-1234-4abc-8def-0123456789ab';

describe('a template previewed with data', () => {
  it('opens the PDF for the best choice, or for the employee or job offer chosen; saves it when asked, never as a Word file', () => {
    expect(dataPreviewHref(ID)).toBe(`/organization/templates/versions/${ID}/preview`);
    expect(dataPreviewHref(ID, { kind: 'employee', id: EMP })).toBe(`/organization/templates/versions/${ID}/preview?employeeId=${EMP}`);
    expect(dataPreviewHref(ID, { kind: 'employee', id: EMP }, true)).toBe(`/organization/templates/versions/${ID}/preview?employeeId=${EMP}&download=1`);
    expect(dataPreviewHref(ID, { kind: 'offer', id: OFF })).toBe(`/organization/templates/versions/${ID}/preview?offerId=${OFF}`);
    expect(dataPreviewHref(ID, { kind: 'offer', id: OFF }, true)).toBe(`/organization/templates/versions/${ID}/preview?offerId=${OFF}&download=1`);
    expect(dataPreviewHref(ID, null, true)).toBe(`/organization/templates/versions/${ID}/preview?download=1`);
    expect(dataPreviewHref('a/b?c')).toBe('/organization/templates/versions/a%2Fb%3Fc/preview');
    expect(previewPeopleHref(ID)).toBe(`/organization/templates/versions/${ID}/preview-people`);
    // the "Preview as" select is named after what it lists
    expect(choiceParam('employee')).toBe('employeeId');
    expect(choiceParam('offer')).toBe('offerId');
  });

  it('offers each person by name, code and how many of the tags they have filled in', () => {
    expect(personOption({ fullNameEn: 'Omar Khaled', employeeCode: 'EMP-0001', filled: 18, total: 20 })).toBe('Omar Khaled · EMP-0001 · 18 of 20 filled');
    expect(personOption({ fullNameEn: 'Nour Ali', employeeCode: 'EMP-0002', filled: 0, total: 3 })).toBe('Nour Ali · EMP-0002 · 0 of 3 filled');
    // a version that prints no tags: nothing to count
    expect(personOption({ fullNameEn: 'Nour Ali', employeeCode: 'EMP-0002', filled: 0, total: 0 })).toBe('Nour Ali · EMP-0002');
  });

  it('offers each job offer by number, candidate, status and how many of the tags it has filled in', () => {
    expect(offerOption({ number: 'OFF-2026-0001', fullNameEn: 'test 1', status: 'draft', filled: 9, total: 10 })).toBe('OFF-2026-0001 · test 1 · Draft · 9 of 10 filled');
    expect(offerOption({ number: 'OFF-2026-0002', fullNameEn: 'Omar Khaled', status: 'expired', filled: 10, total: 10 })).toBe(
      'OFF-2026-0002 · Omar Khaled · Expired · 10 of 10 filled',
    );
    expect(offerOption({ number: 'OFF-2026-0003', fullNameEn: 'Nour Ali', status: 'sent', filled: 0, total: 0 })).toBe('OFF-2026-0003 · Nour Ali · Sent');
    // a status the web app doesn't know yet, as it is
    expect(offerOption({ number: 'OFF-2026-0004', fullNameEn: 'Nour Ali', status: 'on_hold', filled: 1, total: 2 })).toBe('OFF-2026-0004 · Nour Ali · on_hold · 1 of 2 filled');

    const offer = { kind: 'offer', id: OFF, number: 'OFF-2026-0001', fullNameEn: 'test 1', employmentType: 'full_time', status: 'draft', filled: 9, total: 10 } as const;
    const person = { kind: 'employee', id: EMP, employeeCode: 'EMP-0001', fullNameEn: 'Omar Khaled', employmentType: 'full_time', filled: 18, total: 20 } as const;
    expect(choiceOption(offer)).toBe('OFF-2026-0001 · test 1 · Draft · 9 of 10 filled');
    expect(choiceOption(person)).toBe('Omar Khaled · EMP-0001 · 18 of 20 filled');
  });

  it('reads the people and offers from the answer in its order, leaving out what isn’t one', () => {
    const omar = { kind: 'employee', id: EMP, employeeCode: 'EMP-0001', fullNameEn: 'Omar Khaled', employmentType: 'full_time', filled: 18, total: 20 };
    const nour = { kind: 'employee', id: 'n', employeeCode: 'EMP-0002', fullNameEn: 'Nour Ali', employmentType: null, filled: 2, total: 20 };
    expect(readPeople([omar, nour])).toEqual([omar, nour]);
    expect(readPeople([{ ...nour, employmentType: 7, extra: true }])).toEqual([nour]);
    expect(readPeople([null, 'x', { ...omar, id: '' }, { ...omar, filled: -1 }, { ...omar, total: 1.5 }, { ...omar, fullNameEn: undefined }, nour])).toEqual([nour]);
    expect(readPeople({ message: 'Not found.' })).toEqual([]);
    expect(readPeople(null)).toEqual([]);
    // as the API sent them before job offers: an employee
    expect(readPeople([{ ...omar, kind: undefined }])).toEqual([omar]);
    expect(readPeople([{ ...omar, kind: 'candidate' }, { ...omar, employeeCode: undefined }])).toEqual([]);

    const offer = { kind: 'offer', id: OFF, number: 'OFF-2026-0001', fullNameEn: 'test 1', employmentType: 'full_time', status: 'draft', filled: 9, total: 10 };
    expect(readPeople([offer, { ...offer, id: 'o2', employmentType: undefined, extra: 1 }])).toEqual([offer, { ...offer, id: 'o2', employmentType: null }]);
    expect(readPeople([{ ...offer, number: '' }, { ...offer, status: undefined }, { ...offer, filled: 'nine' }])).toEqual([]);
  });

  it('a job offer template says it is filled with a job offer’s data', () => {
    // an intern's is offer_internship, a trainee's offer_trainee (19 October 2026)
    for (const key of ['offer_full_time', 'offer_part_time', 'offer_freelance', 'offer_internship', 'offer_trainee', 'offer_sales']) {
      expect(isOfferSlot(key)).toBe(true);
      expect(previewHint(key)).toBe(OFFER_PREVIEW_HINT);
    }
    for (const key of ['contract_full_time', 'contract_trainee', 'hr_letter_en', 'nda', 'offer', 'offer_intern']) {
      expect(isOfferSlot(key)).toBe(false);
      expect(previewHint(key)).toBe(PREVIEW_HINT);
    }
    expect(OFFER_PREVIEW_HINT).toMatch(/^Filled with a job offer's data/);
  });
});
