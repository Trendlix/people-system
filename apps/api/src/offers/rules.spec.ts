import { isWebOrigin } from './offers.dto.js';
import { comparableName, nameMatches, offerMissing, shownStatus, termDates } from './rules.js';

describe('job offer rules', () => {
  it('a sent offer past its last day shows as expired; the last day itself is still open', () => {
    const on = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    expect(shownStatus({ status: 'sent', expiresOn: on('2026-10-14') }, '2026-10-15')).toBe('expired');
    expect(shownStatus({ status: 'sent', expiresOn: on('2026-10-15') }, '2026-10-15')).toBe('sent');
    expect(shownStatus({ status: 'draft', expiresOn: on('2026-10-01') }, '2026-10-15')).toBe('draft');
    expect(shownStatus({ status: 'accepted', expiresOn: on('2026-10-01') }, '2026-10-15')).toBe('accepted');
  });

  it('the terms give the dates of contract version 1', () => {
    expect(termDates('2026-11-01', 12, 3)).toEqual({ endDate: '2027-10-31', probationEnd: '2027-01-31' });
    expect(termDates('2026-01-31', 1, 0)).toEqual({ endDate: '2026-02-27', probationEnd: null });
  });

  it('the name typed to accept ignores case, spaces, Arabic letter forms, diacritics and the tatweel', () => {
    expect(comparableName('  Omar   KHALED ')).toBe('omar khaled');
    expect(comparableName('أحمد إبراهيم آل مصطفى')).toBe(comparableName('احمد ابراهيم ال مصطفي'));
    expect(comparableName('فاطمة')).toBe(comparableName('فاطمه'));
    expect(comparableName('مُحَمَّد')).toBe('محمد');
    expect(comparableName('محـــمد')).toBe('محمد');
    expect(nameMatches('omar khaled mahmoud', ['Omar Khaled Mahmoud', 'عمر خالد محمود'])).toBe(true);
    expect(nameMatches('عمر  خالد محمود', ['Omar Khaled Mahmoud', 'عمر خالد محمود'])).toBe(true);
    expect(nameMatches('Omar Khaled', ['Omar Khaled Mahmoud', 'عمر خالد محمود'])).toBe(false);
    expect(nameMatches('   ', ['Omar Khaled Mahmoud'])).toBe(false);
  });

  it("an empty value points to the offer's field, the company's details to Company, anything else to the template", () => {
    const missing = offerMissing([
      { tag: 'job_title', label: 'Job title', where: { tab: 'employment', key: 'jobTitle' } },
      { tag: 'net_salary', label: 'Net salary', where: { tab: 'contracts', key: 'netSalary' } },
      { tag: 'company_name_ar', label: 'Company name (Arabic)', where: { tab: 'company', key: 'nameAr' } },
      { tag: 'national_id', label: 'National ID number', where: { tab: 'basic', key: 'nationalId' } },
    ]);
    expect(missing.map((m) => m.where)).toEqual([
      { tab: 'offer', key: 'jobTitleId' },
      { tab: 'offer', key: 'netSalary' },
      { tab: 'company', key: 'nameAr' },
      { tab: 'offer', key: 'template' },
    ]);
  });

  it("the link's origin is the web app's address alone", () => {
    expect(isWebOrigin('https://people.example.com')).toBe(true);
    expect(isWebOrigin('https://people.example.com/')).toBe(true);
    expect(isWebOrigin('http://localhost:3000')).toBe(true);
    expect(isWebOrigin('https://people.example.com/offers')).toBe(false);
    expect(isWebOrigin('https://people.example.com?x=1')).toBe(false);
    expect(isWebOrigin('javascript:alert(1)')).toBe(false);
    expect(isWebOrigin('ftp://people.example.com')).toBe(false);
    expect(isWebOrigin('people.example.com')).toBe(false);
  });
});
