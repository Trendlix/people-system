import { describe, expect, it } from 'vitest';
import { dataPreviewHref, personOption, previewPeopleHref, readPeople } from './preview-people';

const ID = '3f2b8c1e-5d4a-4f6b-9c7d-2a1e0b9f8d7c';
const EMP = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('a template previewed with data', () => {
  it('opens the PDF for the best person, or for the one chosen; the Word file when asked', () => {
    expect(dataPreviewHref(ID)).toBe(`/templates/versions/${ID}/preview`);
    expect(dataPreviewHref(ID, EMP)).toBe(`/templates/versions/${ID}/preview?employeeId=${EMP}`);
    expect(dataPreviewHref(ID, EMP, 'docx')).toBe(`/templates/versions/${ID}/preview?employeeId=${EMP}&format=docx`);
    expect(dataPreviewHref(ID, null, 'docx')).toBe(`/templates/versions/${ID}/preview?format=docx`);
    expect(dataPreviewHref('a/b?c')).toBe('/templates/versions/a%2Fb%3Fc/preview');
    expect(previewPeopleHref(ID)).toBe(`/templates/versions/${ID}/preview-people`);
  });

  it('offers each person by name, code and how many of the tags they have filled in', () => {
    expect(personOption({ fullNameEn: 'Omar Khaled', employeeCode: 'EMP-0001', filled: 18, total: 20 })).toBe('Omar Khaled · EMP-0001 · 18 of 20 filled');
    expect(personOption({ fullNameEn: 'Nour Ali', employeeCode: 'EMP-0002', filled: 0, total: 3 })).toBe('Nour Ali · EMP-0002 · 0 of 3 filled');
    // a version that prints no tags: nothing to count
    expect(personOption({ fullNameEn: 'Nour Ali', employeeCode: 'EMP-0002', filled: 0, total: 0 })).toBe('Nour Ali · EMP-0002');
  });

  it('reads the people from the answer in its order, leaving out what isn’t one', () => {
    const omar = { id: EMP, employeeCode: 'EMP-0001', fullNameEn: 'Omar Khaled', employmentType: 'full_time', filled: 18, total: 20 };
    const nour = { id: 'n', employeeCode: 'EMP-0002', fullNameEn: 'Nour Ali', employmentType: null, filled: 2, total: 20 };
    expect(readPeople([omar, nour])).toEqual([omar, nour]);
    expect(readPeople([{ ...nour, employmentType: 7, extra: true }])).toEqual([nour]);
    expect(readPeople([null, 'x', { ...omar, id: '' }, { ...omar, filled: -1 }, { ...omar, total: 1.5 }, { ...omar, fullNameEn: undefined }, nour])).toEqual([nour]);
    expect(readPeople({ message: 'Not found.' })).toEqual([]);
    expect(readPeople(null)).toEqual([]);
  });
});
