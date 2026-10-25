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
  RETIRED_SLOT_NAMES,
  slotChosenByPay,
  slotName,
  TEMPLATE_SLOTS,
  TEMPLATE_TAG_NAMES,
  underLabourLaw,
  WORK_NATURE_LABELS,
  WORK_NATURE_LABELS_AR,
  WORK_NATURES,
  WORK_PATTERN_LABELS,
  WORK_PATTERN_LABELS_AR,
  WORK_PATTERNS,
  workPatternOf,
} from '@trendlix/shared';

// Employment types by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the
// labour law?"): packages/shared employment-types.ts, index.ts (the types), contracts.ts (the contract's length) and
// templates.ts (the slots and tags).

describe('the employment types', () => {
  // one internship since 25 October 2026 (owner: "unpaid internship and training are the same thing .. keep the unpaid
  // internship with its document and delete the trainee with its documents")
  it('are the ones the owner chose, with one internship, the unpaid one, and their labels in English and Arabic', () => {
    expect(EMPLOYMENT_TYPES).toEqual(['full_time', 'part_time', 'intern', 'freelance']);
    expect(LABELS.employmentType).toEqual({
      full_time: 'Full-time',
      part_time: 'Part-time',
      intern: 'Unpaid internship',
      freelance: 'Freelance (outside the labour law)',
    });
    expect(EMPLOYMENT_TYPE_LABELS_AR).toEqual({
      full_time: 'دوام كامل',
      part_time: 'عمل بعض الوقت',
      intern: 'تدريب غير مدفوع',
      freelance: 'عمل حر (غير خاضع لقانون العمل)',
    });
  });

  it('are all under the labour law but freelance (Art. 1(1)) and the unpaid internship', () => {
    expect(EMPLOYMENT_TYPES.filter(underLabourLaw)).toEqual(['full_time', 'part_time']);
    expect(underLabourLaw('freelance')).toBe(false);
    expect(underLabourLaw('intern')).toBe(false);
  });

  it('keep the paperwork lists: full-time the full list, the others the national ID', () => {
    expect(requiredPaperwork('full_time', 'male')).toContain('military_certificate');
    expect(requiredPaperwork('part_time', 'male')).toEqual(['national_id_front', 'national_id_back']);
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

describe('the template slots and tags', () => {
  const slot = (key: string) => TEMPLATE_SLOTS.find((s) => s.key === key)!;

  it('keep every slot key, relabelled for the new types', () => {
    // the owner's internship slots are the unpaid intern's again (19 October 2026)
    expect(slot('contract_internship')).toMatchObject({ name: 'Internship agreement · Unpaid internship', appliesTo: ['intern'], triggers: ['on_hire', 'renewal'] });
    expect(slot('offer_internship')).toMatchObject({ name: 'Job offer · Unpaid internship', appliesTo: ['intern'] });
    expect(slot('cert_internship')).toMatchObject({ name: 'Internship certificate', appliesTo: ['intern'] });
    expect(slot('agreement_freelance').name).toBe('Service agreement · Freelance (outside the labour law)');
    expect(slot('contract_sales')).toMatchObject({ appliesTo: ['full_time'], paidByCommission: true });
    expect(slot('offer_sales')).toMatchObject({ appliesTo: ['full_time'], paidByCommission: true });
    // no slot names a type that is gone
    for (const s of TEMPLATE_SLOTS) for (const t of s.appliesTo) expect(EMPLOYMENT_TYPES).toContain(t);
  });

  it('retire the paid trainee’s training agreement and offer (25 October 2026), named still for the documents on record', () => {
    expect(TEMPLATE_SLOTS.map((s) => s.key)).not.toContain('contract_trainee');
    expect(TEMPLATE_SLOTS.map((s) => s.key)).not.toContain('offer_trainee');
    expect(RETIRED_SLOT_NAMES).toEqual({ contract_trainee: 'Training agreement · Trainee (retired)', offer_trainee: 'Job offer · Trainee (retired)' });
    expect(slotName('contract_trainee')).toBe('Training agreement · Trainee (retired)');
    expect(slotName('offer_internship')).toBe('Job offer · Unpaid internship');
    expect(slotName('no_such_slot')).toBe('no_such_slot');
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
    expect(offerSlotKey('intern')).toBe('offer_internship');
    expect(offerSlotKey('full_time', true)).toBe('offer_sales');
    expect(offerSlotKey('part_time', true)).toBe('offer_part_time');
    expect(offerSlotFor('full_time', true, (k) => k === 'offer_sales')).toBe('offer_sales');
    expect(offerSlotFor('full_time', true, () => false)).toBe('offer_full_time');
    expect(offerSlotFor('intern', false, () => true)).toBe('offer_internship');
  });

  it('have the new tags, and the training stages’ no more (25 October 2026)', () => {
    for (const tag of ['contract_form', 'work_nature', 'work_pattern', 'paid_by_commission']) {
      for (const t of [tag, `${tag}_ar`, `${tag}_en`]) expect(TEMPLATE_TAG_NAMES.has(t)).toBe(true);
    }
    expect(TEMPLATE_TAG_NAMES.has('job_to_do')).toBe(true);
    for (const t of ['trainee_stages', 'trainee_stages_ar', 'trainee_stages_en']) expect(TEMPLATE_TAG_NAMES.has(t)).toBe(false);
  });
});
