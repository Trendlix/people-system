import {
  becameOpenEnded,
  CASUAL_MAX_MONTHS,
  casualTooLong,
  COMMISSION_SLOTS,
  CONTRACT_FORM_LABELS,
  CONTRACT_FORM_LABELS_AR,
  CONTRACT_FORMS,
  EMPLOYMENT_TYPE_LABELS_AR,
  EMPLOYMENT_TYPES,
  isContractForm,
  isWorkNature,
  LABELS,
  offerSlotFor,
  offerSlotKey,
  requiredPaperwork,
  slotChosenByPay,
  TEMPLATE_SLOTS,
  TEMPLATE_TAG_NAMES,
  traineeMonths,
  traineeNotes,
  traineeProblems,
  traineeStageOn,
  traineeStagePeriods,
  underLabourLaw,
  WORK_NATURE_LABELS,
  WORK_NATURE_LABELS_AR,
  WORK_NATURES,
  WORK_PATTERN_LABELS,
  WORK_PATTERN_LABELS_AR,
  WORK_PATTERNS,
  workPatternOf,
  type TraineeInput,
  type TraineeStage,
} from '@trendlix/shared';

// Employment types by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the
// labour law?"): packages/shared employment-types.ts, index.ts (the types), contracts.ts (the contract's length) and
// templates.ts (the slots and tags).

describe('the employment types', () => {
  it('are the four the owner chose, with their labels in English and Arabic', () => {
    expect(EMPLOYMENT_TYPES).toEqual(['full_time', 'part_time', 'trainee', 'freelance']);
    expect(LABELS.employmentType).toEqual({ full_time: 'Full-time', part_time: 'Part-time', trainee: 'Trainee', freelance: 'Freelance (outside the labour law)' });
    expect(EMPLOYMENT_TYPE_LABELS_AR).toEqual({ full_time: 'دوام كامل', part_time: 'عمل بعض الوقت', trainee: 'متدرج', freelance: 'عمل حر (غير خاضع لقانون العمل)' });
  });

  it('are all under the labour law but freelance (Art. 1(1))', () => {
    expect(EMPLOYMENT_TYPES.filter(underLabourLaw)).toEqual(['full_time', 'part_time', 'trainee']);
    expect(underLabourLaw('freelance')).toBe(false);
  });

  it('keep the paperwork lists: full-time the full list, the others the national ID', () => {
    expect(requiredPaperwork('full_time', 'male')).toContain('military_certificate');
    expect(requiredPaperwork('trainee', 'male')).toEqual(['national_id_front', 'national_id_back']);
  });
});

describe('the contract’s length (Arts. 87, 88, 155)', () => {
  it('is fixed-term, open-ended or for a specific job', () => {
    expect(CONTRACT_FORMS).toEqual(['fixed', 'open_ended', 'specific_job']);
    expect(CONTRACT_FORM_LABELS).toEqual({ fixed: 'Fixed-term', open_ended: 'Open-ended', specific_job: 'For a specific job' });
    expect(CONTRACT_FORM_LABELS_AR).toEqual({ fixed: 'محدد المدة', open_ended: 'غير محدد المدة', specific_job: 'لإنجاز عمل معين' });
    expect(isContractForm('open_ended')).toBe(true);
    expect(isContractForm('open')).toBe(false);
  });

  describe('becameOpenEnded (Art. 88(3))', () => {
    const today = '2026-10-18';
    it('is true for a fixed term past its end with the employment going on and no signed renewal', () => {
      expect(becameOpenEnded({ form: 'fixed', endDate: '2026-10-17', renewedOrEnded: false }, today)).toBe(true);
    });
    it('is false on its last day, after a renewal or an ending, and for the other lengths', () => {
      expect(becameOpenEnded({ form: 'fixed', endDate: today, renewedOrEnded: false }, today)).toBe(false);
      expect(becameOpenEnded({ form: 'fixed', endDate: '2026-01-01', renewedOrEnded: true }, today)).toBe(false);
      expect(becameOpenEnded({ form: 'open_ended', endDate: null, renewedOrEnded: false }, today)).toBe(false);
      // a specific job carried on is renewed by the law (Art. 155), not made open-ended
      expect(becameOpenEnded({ form: 'specific_job', endDate: '2026-01-01', renewedOrEnded: false }, today)).toBe(false);
      expect(becameOpenEnded({ form: 'fixed', endDate: null, renewedOrEnded: false }, today)).toBe(false);
    });
  });
});

describe('the nature of the work (Art. 1(6–8))', () => {
  it('is regular, temporary, casual or seasonal', () => {
    expect(WORK_NATURES).toEqual(['regular', 'temporary', 'casual', 'seasonal']);
    expect(Object.keys(WORK_NATURE_LABELS)).toEqual([...WORK_NATURES]);
    expect(WORK_NATURE_LABELS_AR.casual).toBe('عمل عرضي');
    expect(isWorkNature('seasonal')).toBe(true);
    expect(isWorkNature('permanent')).toBe(false);
  });

  it('warns of casual work past six months', () => {
    expect(CASUAL_MAX_MONTHS).toBe(6);
    expect(casualTooLong('2026-01-01', '2026-06-30')).toBe(false);
    expect(casualTooLong('2026-01-01', '2026-07-01')).toBe(true);
    // the month's last day when the day doesn't exist: 31 August + 6 months is 28 February
    expect(casualTooLong('2025-08-31', '2026-02-27')).toBe(false);
    expect(casualTooLong('2025-08-31', '2026-02-28')).toBe(true);
    expect(casualTooLong('not a date', '2026-07-01')).toBe(false);
  });
});

describe('remote work (Art. 96(1))', () => {
  it('is worked out from the work arrangement', () => {
    expect(WORK_PATTERNS).toEqual(['on_site', 'partly_remote', 'remote']);
    expect(workPatternOf('wfh')).toBe('remote');
    expect(workPatternOf('hybrid')).toBe('partly_remote');
    for (const a of ['office', 'outdoor', 'indoor_outdoor', null, undefined]) expect(workPatternOf(a)).toBe('on_site');
    expect(WORK_PATTERN_LABELS.remote).toBe('Remote work');
    expect(WORK_PATTERN_LABELS_AR.remote).toBe('عمل عن بعد');
  });
});

describe('the training agreement (Arts. 28–30)', () => {
  const STAGES: TraineeStage[] = [
    { name: 'Basics', months: 3, pay: 4000 },
    { name: 'Practice', months: 3, pay: 5500 },
    { name: 'Practice', months: 6, pay: 7000 },
  ];
  const input = (over: Partial<TraineeInput> = {}): TraineeInput => ({ stages: STAGES, minimumWage: 7000, dateOfBirth: '2008-01-01', startDate: '2026-11-01', ...over });

  it('passes stages that rise to the minimum wage, for a trainee of 14 or more', () => {
    expect(traineeProblems(input())).toEqual([]);
    expect(traineeNotes(input())).toEqual([]);
    expect(traineeMonths(STAGES)).toBe(12);
  });

  it('needs at least one stage', () => {
    expect(traineeProblems(input({ stages: [] }))).toEqual([
      'Add at least one training stage: a training agreement sets the training’s stages and the pay of each (Labour Law Art. 29).',
    ]);
  });

  it('needs a name, whole months of 1 or more, and pay of more than 0', () => {
    expect(traineeProblems(input({ stages: [{ name: ' ', months: 1.5, pay: 0 }], minimumWage: null }))).toEqual([
      'Training stage 1 needs a name.',
      'Training stage 1’s length must be a whole number of months, 1 or more.',
      'Training stage 1’s pay must be more than 0.',
    ]);
    expect(traineeProblems(input({ stages: [{ name: 'All', months: 0, pay: 7000 }] }))).toEqual(['Training stage 1’s length must be a whole number of months, 1 or more.']);
  });

  it('needs each stage’s pay more than the one before (بصورة تصاعدية)', () => {
    const stages = [STAGES[0], { ...STAGES[1], pay: 4000 }, STAGES[2]];
    expect(traineeProblems(input({ stages }))).toEqual([
      'Training stage 2’s pay must be more than stage 1’s (4,000 EGP): the pay rises from stage to stage (Labour Law Art. 29).',
    ]);
  });

  it('needs the last stage at least the minimum wage, when it is set', () => {
    const stages = [STAGES[0], { ...STAGES[2], pay: 6999.5 }];
    expect(traineeProblems(input({ stages }))).toEqual(['The last training stage’s pay (6,999.5 EGP) must be at least the minimum wage, 7,000 EGP (Labour Law Art. 29).']);
    // not set: not checked, and a note says so
    expect(traineeProblems(input({ stages, minimumWage: null }))).toEqual([]);
    expect(traineeNotes(input({ minimumWage: null }))).toEqual([
      'The minimum wage isn’t set in Payroll Setup’s rates set by law, so the last stage’s pay can’t be checked against it (Labour Law Art. 29).',
    ]);
  });

  it('needs the trainee at least 14 on the start date (Art. 28)', () => {
    expect(traineeProblems(input({ dateOfBirth: '2012-11-02' }))).toEqual([
      'A trainee must be at least 14 years old on the start date (Labour Law Art. 28): this one would be 13.',
    ]);
    // the 14th birthday on the start date is enough
    expect(traineeProblems(input({ dateOfBirth: '2012-11-01' }))).toEqual([]);
    // no date of birth: not checked, and a note says so
    expect(traineeProblems(input({ dateOfBirth: null }))).toEqual([]);
    expect(traineeNotes(input({ dateOfBirth: null }))).toEqual(['The date of birth isn’t on the profile, so the trainee’s age (at least 14, Labour Law Art. 28) can’t be checked.']);
  });

  it('keeps the training within 60 months', () => {
    expect(traineeProblems(input({ stages: [{ name: 'A', months: 30, pay: 6000 }, { name: 'B', months: 31, pay: 7000 }] }))).toEqual([
      'The training runs for 61 months: make it 60 months or less.',
    ]);
  });

  it('lays the stages out one after the other from the start', () => {
    expect(traineeStagePeriods(STAGES, '2026-03-15').map((p) => [p.index, p.from, p.to])).toEqual([
      [0, '2026-03-15', '2026-06-14'],
      [1, '2026-06-15', '2026-09-14'],
      [2, '2026-09-15', '2027-03-14'],
    ]);
  });

  it('tells the stage in force on a date and its pay', () => {
    expect(traineeStageOn(STAGES, '2026-03-15', '2026-03-14')).toBeNull();
    expect(traineeStageOn(STAGES, '2026-03-15', '2026-03-15')).toEqual({ index: 0, name: 'Basics', pay: 4000 });
    expect(traineeStageOn(STAGES, '2026-03-15', '2026-06-14')).toEqual({ index: 0, name: 'Basics', pay: 4000 });
    expect(traineeStageOn(STAGES, '2026-03-15', '2026-06-15')).toEqual({ index: 1, name: 'Practice', pay: 5500 });
    expect(traineeStageOn(STAGES, '2026-03-15', '2027-03-14')).toEqual({ index: 2, name: 'Practice', pay: 7000 });
    // past the last stage: the last one's pay, never lower
    expect(traineeStageOn(STAGES, '2026-03-15', '2028-01-01')).toEqual({ index: 2, name: 'Practice', pay: 7000 });
    expect(traineeStageOn([], '2026-03-15', '2026-04-01')).toBeNull();
  });
});

describe('the template slots and tags', () => {
  const slot = (key: string) => TEMPLATE_SLOTS.find((s) => s.key === key)!;

  it('keep every slot key, relabelled for the new types', () => {
    expect(slot('contract_internship')).toMatchObject({ name: 'Training agreement · Trainee', appliesTo: ['trainee'] });
    expect(slot('offer_internship')).toMatchObject({ name: 'Job offer · Trainee', appliesTo: ['trainee'] });
    expect(slot('cert_internship')).toMatchObject({ name: 'Training certificate', appliesTo: ['trainee'] });
    expect(slot('agreement_freelance').name).toBe('Service agreement · Freelance (outside the labour law)');
    expect(slot('contract_sales')).toMatchObject({ appliesTo: ['full_time'], paidByCommission: true });
    expect(slot('offer_sales')).toMatchObject({ appliesTo: ['full_time'], paidByCommission: true });
    // no slot names a type that is gone
    for (const s of TEMPLATE_SLOTS) for (const t of s.appliesTo) expect(EMPLOYMENT_TYPES).toContain(t);
  });

  it('choose the commission slot for one paid by commission when it is published, else the full-time one', () => {
    expect(COMMISSION_SLOTS).toEqual({ contract_sales: 'contract_full_time', offer_sales: 'offer_full_time' });
    const published = (keys: string[]) => (key: string) => keys.includes(key);
    // paid by commission, the commission contract published: it, not the full-time one
    expect(slotChosenByPay('contract_sales', true, published(['contract_sales']))).toBe(true);
    expect(slotChosenByPay('contract_full_time', true, published(['contract_sales']))).toBe(false);
    // not published: the full-time one
    expect(slotChosenByPay('contract_sales', true, published([]))).toBe(false);
    expect(slotChosenByPay('contract_full_time', true, published([]))).toBe(true);
    // not paid by commission: never the commission one
    expect(slotChosenByPay('contract_sales', false, published(['contract_sales']))).toBe(false);
    expect(slotChosenByPay('contract_full_time', false, published(['contract_sales']))).toBe(true);
    // any other slot
    expect(slotChosenByPay('contract_full_time_insurance', true, published(['contract_sales']))).toBe(true);
  });

  it('give each type its job offer slot', () => {
    expect(offerSlotKey('full_time')).toBe('offer_full_time');
    expect(offerSlotKey('trainee')).toBe('offer_internship');
    expect(offerSlotKey('full_time', true)).toBe('offer_sales');
    expect(offerSlotKey('part_time', true)).toBe('offer_part_time');
    expect(offerSlotFor('full_time', true, (k) => k === 'offer_sales')).toBe('offer_sales');
    expect(offerSlotFor('full_time', true, () => false)).toBe('offer_full_time');
    expect(offerSlotFor('trainee', false, () => true)).toBe('offer_internship');
  });

  it('have the new tags', () => {
    for (const tag of ['contract_form', 'work_nature', 'work_pattern', 'paid_by_commission', 'trainee_stages']) {
      for (const t of [tag, `${tag}_ar`, `${tag}_en`]) expect(TEMPLATE_TAG_NAMES.has(t)).toBe(true);
    }
    expect(TEMPLATE_TAG_NAMES.has('job_to_do')).toBe(true);
  });
});
