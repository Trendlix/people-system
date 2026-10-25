import {
  employmentStanding,
  END_REASON_LABELS,
  END_REASONS,
  ENDING_RULE_DEFAULTS,
  ENDING_RULES,
  INTERN_DEFAULT_MONTHS,
  INTERN_MAX_MONTHS,
  INTERN_NO_WAGE_MESSAGE,
  INTERN_NO_WAGE_TEXT,
  INTERN_TERM_MESSAGE,
  INTERNSHIP_AGREEMENT,
  isTrainingType,
  lastTrainingEnd,
  NO_PROBATION_MESSAGE,
  RENEWED_ONCE_MESSAGE,
  STANDING_LABELS,
  STANDINGS,
  TRAINING_AGAIN_AFTER_MONTHS,
  TRAINING_RENEWALS,
  TRAINING_TYPES,
  trainingAgainFrom,
  trainingEndsText,
  trainingNext,
  trainingTooSoon,
  trainingTooSoonMessage,
  type TrainingHistory,
} from '@trendlix/shared';

// Trainees and interns (owner, 19 October 2026): "interns to be labeled trainees instead of probation and their contracts
// are never renewed", then "or can be only renewed 1 time, after that it should be converted to a full time contract. a
// new trainee contract can be issued after 6 months of the expiration of the last trainee contract", and "in case of
// trainee, we are not paying them salary, its just transportation allowance" (the unpaid internship). Since 25 October
// 2026 the intern is the only one (owner: "unpaid internship and training are the same thing .. keep the unpaid
// internship with its document and delete the trainee with its documents"). packages/shared index.ts (the standings, the
// end reason), contracts.ts (the ending rule) and employment-types.ts (the rules).

describe('the standing of an intern', () => {
  it('is Intern, not Probation or Active, and there is no Trainee any more', () => {
    expect(STANDINGS).toEqual(['active', 'probation', 'intern', 'on_leave', 'notice_period', 'former', 'not_employed']);
    expect(STANDING_LABELS).toMatchObject({ intern: 'Intern', probation: 'Probation' });
    expect(employmentStanding({ status: 'active', employmentType: 'intern' })).toBe('intern');
    // an intern's Probation from before the owner's decision is shown as Intern too
    expect(employmentStanding({ status: 'probation', employmentType: 'intern' })).toBe('intern');
  });

  it('gives way to On leave and Notice period, and leaves the other types as their status', () => {
    expect(employmentStanding({ status: 'on_leave', employmentType: 'intern' })).toBe('on_leave');
    expect(employmentStanding({ status: 'notice_period', employmentType: 'intern' })).toBe('notice_period');
    expect(employmentStanding({ status: 'probation', employmentType: 'full_time' })).toBe('probation');
    expect(employmentStanding({ status: 'active', employmentType: 'part_time' })).toBe('active');
    expect(employmentStanding({ status: 'active', employmentType: 'freelance' })).toBe('active');
  });
});

describe('an internship agreement', () => {
  it('is an intern’s, named as such; a trainee is no type of its own any more', () => {
    expect(TRAINING_TYPES).toEqual(['intern']);
    expect(['full_time', 'part_time', 'trainee', 'intern', 'freelance', 'sales', null].map(isTrainingType)).toEqual([false, false, false, true, false, false, false]);
    expect(INTERNSHIP_AGREEMENT).toBe('internship agreement');
  });

  it('has no probation', () => {
    expect(NO_PROBATION_MESSAGE).toBe(
      'An intern has no probation: an internship agreement isn’t an employment contract, and probation (Labour Law Art. 90) is an employment contract’s. Leave the probation at 0.',
    );
  });

  it('is renewed once, then converted to full-time or ended', () => {
    expect(TRAINING_RENEWALS).toBe(1);
    expect(trainingNext(1)).toBe('renew_or_convert');
    expect(trainingNext(2)).toBe('convert_or_end');
    // an agreement renewed more than once before the rule (any later one) is converted or ended too
    expect(trainingNext(3)).toBe('convert_or_end');
    expect(RENEWED_ONCE_MESSAGE).toBe('An internship agreement is renewed once. Convert it to a full-time contract instead.');
  });

  it('is reminded of as "Internship ends on …", with the way forward, never as due for renewal', () => {
    expect(trainingEndsText('2027-03-31', 'renew_or_convert', '2027-01-10')).toBe('Internship ends on 31/03/2027: renew it once, or convert to full-time.');
    expect(trainingEndsText('2027-03-31', 'convert_or_end', '2027-03-31')).toBe('Internship ends on 31/03/2027: convert to full-time, or end the internship.');
    expect(trainingEndsText('2027-03-31', 'convert_or_end', '2027-04-01')).toBe('Internship ended on 31/03/2027: convert to full-time, or end the internship.');
    expect(trainingEndsText('2026-10-31', 'renew_or_convert', '2026-11-02')).toBe('Internship ended on 31/10/2026: renew it once, or convert to full-time.');
  });

  it('is ended as Training completed, an ending of its own with nobody’s notice', () => {
    expect(END_REASONS).toContain('training_completed');
    expect(END_REASON_LABELS.training_completed).toBe('Training completed');
    expect(ENDING_RULES.at(-1)).toBe('training_completed');
    expect(ENDING_RULE_DEFAULTS.training_completed).toEqual({
      label: 'Training completed',
      initiator: 'none',
      noticeAmount: 0,
      noticeUnit: 'days',
      payInLieu: false,
      endReason: 'training_completed',
      source: 'The internship agreement',
    });
  });
});

describe('a new agreement for the same person', () => {
  it('starts 6 months after the last one ended at the earliest', () => {
    expect(TRAINING_AGAIN_AFTER_MONTHS).toBe(6);
    // the owner's example: ended 31 October, possible from 1 May
    expect(trainingAgainFrom('2026-10-31')).toBe('2027-05-01');
    expect(trainingAgainFrom('2026-08-31')).toBe('2027-03-01');
    expect(trainingAgainFrom('2026-03-15')).toBe('2026-09-16');
    expect(trainingAgainFrom('2027-02-28')).toBe('2027-09-01');
    expect(trainingTooSoon('2026-10-31', '2027-04-30')).toBe(true);
    expect(trainingTooSoon('2026-10-31', '2027-05-01')).toBe(false);
    expect(trainingTooSoon(null, '2026-11-01')).toBe(false);
  });

  it('is refused before then, with the day it becomes possible', () => {
    expect(trainingTooSoonMessage('Omar Adel', '2026-10-31')).toBe(
      'A new internship agreement for Omar Adel can start from 01/05/2027, six months after their last one ended on 31/10/2026.',
    );
  });
});

describe('the last day of the person’s last agreement (lastTrainingEnd)', () => {
  type Version = TrainingHistory['contracts'][number];
  const v = (version: number, startDate: string, endDate: string | null, extra: Partial<Version> = {}): Version => ({
    version,
    kind: 'contract',
    status: 'active',
    startDate,
    endDate,
    convertsTo: null,
    ...extra,
  });
  const employment = (employmentType: string, endDate: string | null, contracts: Version[]): TrainingHistory => ({ employmentType, endDate, contracts });

  it('is null for someone who never had one', () => {
    expect(lastTrainingEnd([])).toBeNull();
    expect(lastTrainingEnd([employment('full_time', '2026-06-30', [v(1, '2025-07-01', '2026-06-30', { status: 'ended' })])])).toBeNull();
  });

  it('is the agreement’s end, or the day the employment ended when that came first', () => {
    expect(lastTrainingEnd([employment('intern', '2026-10-31', [v(1, '2026-08-01', '2026-10-31', { status: 'ended' })])])).toBe('2026-10-31');
    // ended early (e.g. the intern resigned)
    expect(lastTrainingEnd([employment('intern', '2026-09-15', [v(1, '2026-08-01', '2027-01-31', { status: 'ended' })])])).toBe('2026-09-15');
    // a current agreement: its end date
    expect(lastTrainingEnd([employment('intern', null, [v(1, '2026-08-01', '2027-01-31')])])).toBe('2027-01-31');
  });

  it('is the renewal’s end once renewed, drafts and salary amendments left out', () => {
    const renewed = employment('intern', '2027-01-31', [
      v(1, '2026-08-01', '2026-10-31', { status: 'superseded' }),
      v(2, '2026-11-01', '2027-01-31', { status: 'ended' }),
    ]);
    expect(lastTrainingEnd([renewed])).toBe('2027-01-31');
    const withDraft = employment('intern', null, [v(1, '2026-08-01', '2026-10-31'), v(2, '2026-11-01', '2027-01-31', { status: 'draft' })]);
    expect(lastTrainingEnd([withDraft])).toBe('2026-10-31');
    const amended = employment('intern', null, [v(1, '2026-01-01', '2026-12-31', { status: 'superseded' }), v(2, '2026-06-01', '2026-12-31', { kind: 'amendment' })]);
    expect(lastTrainingEnd([amended])).toBe('2026-12-31');
  });

  it('is the day before the full-time contract it was converted to, the employment full-time since', () => {
    const converted = employment('full_time', null, [
      v(1, '2026-01-01', '2026-06-30', { status: 'superseded' }),
      v(2, '2026-07-01', '2026-09-30', { status: 'superseded' }),
      v(3, '2026-09-15', '2027-09-14', { convertsTo: 'full_time' }),
    ]);
    expect(lastTrainingEnd([converted])).toBe('2026-09-14');
    // a conversion not signed yet doesn't count: the agreement's own end
    const drafted = employment('intern', null, [v(1, '2026-01-01', '2026-06-30'), v(2, '2026-07-01', '2027-06-30', { status: 'draft', convertsTo: 'full_time' })]);
    expect(lastTrainingEnd([drafted])).toBe('2026-06-30');
  });

  it('counts an intern’s employment without a signed agreement, and no agreement under another type', () => {
    expect(lastTrainingEnd([employment('intern', '2025-08-31', [])])).toBe('2025-08-31');
    expect(lastTrainingEnd([employment('intern', '2025-08-31', [v(1, '2025-06-01', '2025-08-31', { status: 'draft' })])])).toBe('2025-08-31');
    // a full-time employment never converted holds no agreement
    expect(lastTrainingEnd([employment('full_time', '2026-03-31', [v(1, '2025-10-01', '2026-03-31', { status: 'ended' })])])).toBeNull();
  });

  it('is the latest of all the person’s employments', () => {
    expect(
      lastTrainingEnd([
        employment('intern', '2025-08-31', [v(1, '2025-06-01', '2025-08-31', { status: 'ended' })]),
        employment('full_time', '2026-05-31', [v(1, '2025-09-01', '2026-08-31', { status: 'ended' })]),
        employment('intern', '2026-10-31', [v(1, '2026-07-01', '2026-12-31', { status: 'ended' })]),
      ]),
    ).toBe('2026-10-31');
  });
});

describe('the unpaid internship', () => {
  it('is a short fixed term with no wage, the allowances on top', () => {
    expect([INTERN_DEFAULT_MONTHS, INTERN_MAX_MONTHS]).toEqual([3, 12]);
    expect(INTERN_NO_WAGE_TEXT).toBe('No wage (unpaid internship)');
    expect(INTERN_NO_WAGE_MESSAGE).toBe(
      'An intern is unpaid (an unpaid internship, outside the labour law): leave the gross salary out, it is 0. Allowances, such as transportation, are paid on top.',
    );
    expect(INTERN_TERM_MESSAGE).toBe('An internship agreement is short: 1 to 12 months (3 unless you choose another).');
  });
});
