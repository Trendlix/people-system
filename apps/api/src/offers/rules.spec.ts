import { isWebOrigin } from './offers.dto.js';
import { answerDayProblem, comparableName, lastDayProblem, momentOn, nameMatches, offerMissing, PAST_LAST_DAY, recordSentProblem, shownStatus, termDates } from './rules.js';

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
      { tag: 'job_duties', label: 'Duties and responsibilities', where: { tab: 'employment', key: 'jobTitle' } },
      { tag: 'net_salary', label: 'Net salary', where: { tab: 'contracts', key: 'netSalary' } },
      { tag: 'company_name_ar', label: 'Company name (Arabic)', where: { tab: 'company', key: 'nameAr' } },
      { tag: 'national_id', label: 'National ID number', where: { tab: 'basic', key: 'nationalId' } },
    ]);
    expect(missing.map((m) => m.where)).toEqual([
      { tab: 'offer', key: 'jobTitleId' },
      { tab: 'offer', key: 'jobTitleId' }, // the selected role's duties: its job title
      { tab: 'offer', key: 'netSalary' },
      { tab: 'company', key: 'nameAr' },
      { tab: 'offer', key: 'template' },
    ]);
  });

  it('the social insurance occupation and the address in its parts are never on an offer: the template needs changing', () => {
    // the occupation is the employee's own, set on their profile (owner's decision, 16 October 2026)
    const missing = [
      { tag: 'occupation_code', label: 'Occupation code (social insurance)', where: { tab: 'insurance', key: 'occupationCode' } },
      { tag: 'occupation_name', label: 'Occupation (social insurance)', where: { tab: 'insurance', key: 'occupationCode' } },
      { tag: 'building_no', label: 'Building number', where: { tab: 'basic', key: 'buildingNo' } },
      { tag: 'address_line', label: 'Street address (Arabic)', where: { tab: 'basic', key: 'addressAr' } },
      { tag: 'city', label: 'City or district (Arabic)', where: { tab: 'basic', key: 'city' } },
      { tag: 'governorate', label: 'Governorate (Arabic)', where: { tab: 'basic', key: 'governorate' } },
      { tag: 'insurance_office', label: 'Social insurance office', where: { tab: 'company', key: 'insuranceOffice' } },
    ] satisfies Parameters<typeof offerMissing>[0];
    expect(offerMissing(missing).map((m) => m.where)).toEqual([
      { tab: 'offer', key: 'template' },
      { tab: 'offer', key: 'template' },
      { tab: 'offer', key: 'template' },
      { tab: 'offer', key: 'template' },
      { tab: 'offer', key: 'template' },
      { tab: 'offer', key: 'template' },
      { tab: 'company', key: 'insuranceOffice' },
    ]);
  });

  it('the Social Insurance tab’s start date and wages stand in for the offer’s join date and gross', () => {
    const missing = offerMissing([
      { tag: 'insurance_start_date', label: 'Subscription start (social insurance)', where: { tab: 'insurance', key: 'insuranceStartDate' } },
      { tag: 'insurance_insured_salary', label: 'Insured wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
      { tag: 'insurance_total_salary', label: 'Comprehensive wage (social insurance)', where: { tab: 'insurance', key: 'insuranceComprehensiveWage' } },
    ]);
    expect(missing.map((m) => m.where)).toEqual([
      { tab: 'offer', key: 'joinDate' },
      { tab: 'offer', key: 'grossSalary' },
      { tab: 'offer', key: 'grossSalary' },
    ]);
  });

  it("the fields added on 15 October 2026 are filled in on the offer's own fields", () => {
    const fields = {
      personal_email: 'email',
      manager_name: 'managerId',
      manager_name_ar: 'managerId',
      manager_name_en: 'managerId',
      shift: 'shiftId',
      shift_ar: 'shiftId',
      shift_en: 'shiftId',
      work_arrangement: 'workArrangement',
      work_arrangement_ar: 'workArrangement',
      work_arrangement_en: 'workArrangement',
      probation_months: 'probationMonths',
      probation_months_ar: 'probationMonths',
      probation_months_en: 'probationMonths',
      grade_level: 'gradeId',
      grade_level_ar: 'gradeId',
      grade_level_en: 'gradeId',
      net_hourly_rate: 'netSalary',
      basic_percent: 'basicPercent',
    };
    const missing = offerMissing(Object.keys(fields).map((tag) => ({ tag, label: tag, where: { tab: 'basic', key: tag } })));
    expect(Object.fromEntries(missing.map((m) => [m.tag, m.where]))).toEqual(Object.fromEntries(Object.entries(fields).map(([tag, key]) => [tag, { tab: 'offer', key }])));
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

// Earlier offers (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to enter the
// previous data"): what "Entering earlier offers" allows while it is on, and what stays as before.
describe('earlier job offers', () => {
  const TODAY = '2026-10-25';

  it('a past last day only while the switch is on: for a draft, or for a sent offer that is an earlier one', () => {
    // off: as before the switch
    expect(lastDayProblem('2026-10-24', TODAY, { earlierOn: false, draft: true })).toBe(PAST_LAST_DAY);
    expect(lastDayProblem('2026-10-25', TODAY, { earlierOn: false, draft: true })).toBeNull();
    // on: a draft takes one (it is then an earlier one)
    expect(lastDayProblem('2025-03-01', TODAY, { earlierOn: true, draft: true })).toBeNull();
    // a sent offer: only an earlier one, never one sent from the system
    expect(lastDayProblem('2026-10-01', TODAY, { earlierOn: true, draft: false, recordedEarlier: false })).toBe(PAST_LAST_DAY);
    expect(lastDayProblem('2026-10-01', TODAY, { earlierOn: true, draft: false, recordedEarlier: true, sentOn: '2026-09-20' })).toBeNull();
    expect(lastDayProblem('2026-10-01', TODAY, { earlierOn: false, draft: false, recordedEarlier: true, sentOn: '2026-09-20' })).toBe(PAST_LAST_DAY);
    // never before the day it was recorded as sent
    expect(lastDayProblem('2026-09-19', TODAY, { earlierOn: true, draft: false, recordedEarlier: true, sentOn: '2026-09-20' })).toBe(
      "The offer's last day can't be before the day it was sent, 20/09/2026.",
    );
    // a later one is fine whatever the switch
    expect(lastDayProblem('2026-11-30', TODAY, { earlierOn: false, draft: false, recordedEarlier: true, sentOn: '2026-09-20' })).toBeNull();
  });

  it('recorded as sent on a day that is not in the future, nor after its last day', () => {
    expect(recordSentProblem('2026-09-20', '2026-09-27', TODAY)).toBeNull();
    expect(recordSentProblem('2026-09-27', '2026-09-27', TODAY)).toBeNull();
    expect(recordSentProblem(TODAY, '2026-11-01', TODAY)).toBeNull();
    expect(recordSentProblem('2026-10-26', '2026-11-01', TODAY)).toBe("The day it was sent can't be in the future.");
    expect(recordSentProblem('2026-09-28', '2026-09-27', TODAY)).toBe(
      "It can't have been sent after its last day, 27/09/2026. Choose an earlier day, or edit the last day first.",
    );
  });

  it("an answer dated another day only for an earlier offer while the switch is on, never in the future nor before it was sent", () => {
    expect(answerDayProblem(TODAY, TODAY, { leeway: false, sentOn: '2026-10-20' })).toBeNull();
    expect(answerDayProblem('2026-10-24', TODAY, { leeway: false, sentOn: null })).toBe(
      "Only an earlier offer's answer is dated another day than today, while entering earlier offers is on.",
    );
    expect(answerDayProblem('2026-09-22', TODAY, { leeway: true, sentOn: '2026-09-20' })).toBeNull();
    // after its last day too: a late answer of an earlier offer is entered as it was given
    expect(answerDayProblem('2026-10-10', TODAY, { leeway: true, sentOn: '2026-09-20' })).toBeNull();
    expect(answerDayProblem('2026-09-19', TODAY, { leeway: true, sentOn: '2026-09-20' })).toBe("The answer can't be before the offer was sent, on 20/09/2026.");
    expect(answerDayProblem('2026-10-26', TODAY, { leeway: true, sentOn: null })).toBe("The day of the answer can't be in the future.");
  });

  it("a day HR picked is kept as midday in Cairo, on that day, never later than now", () => {
    const now = new Date('2026-10-25T15:00:00.000Z');
    expect(momentOn('2026-09-20', now).toISOString()).toBe('2026-09-20T10:00:00.000Z');
    // Cairo's day either side of the clock change
    for (const day of ['2026-04-30', '2026-05-01', '2026-10-29', '2026-10-30']) {
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(momentOn(day, new Date('2027-01-01T00:00:00.000Z')))).toBe(day);
    }
    // today, early in the morning in Cairo: now
    const early = new Date('2026-10-24T22:30:00.000Z');
    expect(momentOn('2026-10-25', early)).toBe(early);
  });
});
