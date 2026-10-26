import { agreedLastDayProblem, lastDayOf } from './agreed-last-day.js';

const base = { noticeGivenOn: '2026-10-01', employmentEnd: null, payInLieu: false };

describe('agreedLastDayProblem', () => {
  it('accepts a day before or after the notice’s end, and the notice day itself', () => {
    expect(agreedLastDayProblem({ ...base, agreed: '2026-11-30' })).toBeNull();
    expect(agreedLastDayProblem({ ...base, agreed: '2027-02-15' })).toBeNull();
    expect(agreedLastDayProblem({ ...base, agreed: '2026-10-01' })).toBeNull();
  });

  it('refuses a day before the notice day', () => {
    expect(agreedLastDayProblem({ ...base, agreed: '2026-09-30' })).toBe('The agreed last working day must be on or after the notice date, 01/10/2026.');
  });

  it('refuses a day after the employment ended, and accepts its last day', () => {
    const ended = { ...base, employmentEnd: '2026-12-31' };
    expect(agreedLastDayProblem({ ...ended, agreed: '2026-12-31' })).toBeNull();
    expect(agreedLastDayProblem({ ...ended, agreed: '2027-01-01' })).toBe("The employment already ended on 31/12/2026: the agreed last working day can't be after it.");
  });

  it('has nothing to agree when the notice is paid instead of worked', () => {
    expect(agreedLastDayProblem({ ...base, agreed: '2026-10-20', payInLieu: true })).toMatch(/paid instead of worked/);
  });
});

describe('lastDayOf', () => {
  it('is the agreed day when there is one, else the notice’s end', () => {
    expect(lastDayOf('2027-01-01', '2026-11-30')).toBe('2026-11-30');
    expect(lastDayOf('2027-01-01', null)).toBe('2027-01-01');
  });
});
