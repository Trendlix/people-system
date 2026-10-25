import { TEMPLATE_SLOTS } from '@trendlix/shared';
import { isVersionSlot, offered, offeredSlots, RETIRED_SECTIONS, retiredSlotsWith, sectionOf, SECTION_SLOTS, versionSlots } from './offer.js';

describe('which documents the Employment tab offers', () => {
  it('lists every slot in one section, except the payslips', () => {
    const listed = Object.values(SECTION_SLOTS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect(TEMPLATE_SLOTS.filter((s) => !listed.includes(s.key)).map((s) => s.key)).toEqual(['payslip_en', 'payslip_ar']);
    expect(sectionOf('payslip_en')).toBeNull();
  });

  it('full time: both contract copies (an amendment its letter), the offer and NDA, Forms 1 and 2, the letters; nothing to leave', () => {
    expect(offeredSlots({ employmentType: 'full_time', ending: null, ended: false })).toEqual({
      contract: ['contract_full_time', 'contract_full_time_insurance', 'contract_amendment'],
      hiring: ['offer_full_time', 'nda'],
      // Form 2 is listed for each approved raise (documents.service.ts)
      insurance: ['insurance_form_1', 'insurance_form_2'],
      letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience'],
      leaving: [],
    });
  });

  it('an ending the employee started adds Form 6, the resignation request and the clearance', () => {
    expect(offeredSlots({ employmentType: 'full_time', ending: { initiator: 'employee' }, ended: false })).toMatchObject({
      insurance: ['insurance_form_1', 'insurance_form_2', 'insurance_form_6'],
      leaving: ['resignation_request', 'clearance_dues'],
    });
  });

  it('an ending the company started: the clearance, no resignation request', () => {
    expect(offeredSlots({ employmentType: 'part_time', ending: { initiator: 'company' }, ended: false })).toEqual({
      contract: ['contract_part_time', 'contract_amendment'],
      hiring: ['offer_part_time', 'nda'],
      insurance: [],
      letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience'],
      leaving: ['clearance_dues'],
    });
  });

  it('an employment ended without an ending recorded: Form 6, but no leaving documents', () => {
    const s = { employmentType: 'full_time', ending: null, ended: true } as const;
    expect(offered('insurance_form_6', s)).toBe(true);
    expect(offered('clearance_dues', s)).toBe(false);
  });

  it('never offers the retired slots of the paid trainee (25 October 2026), whose documents on record still show', () => {
    expect(SECTION_SLOTS.contract).not.toContain('contract_trainee');
    expect(SECTION_SLOTS.hiring).not.toContain('offer_trainee');
    expect(RETIRED_SECTIONS).toEqual({ contract_trainee: 'contract', offer_trainee: 'hiring' });
    const docs = [{ slotKey: 'contract_trainee' }, { slotKey: 'offer_trainee' }, { slotKey: 'nda' }];
    expect(retiredSlotsWith('contract', docs)).toEqual(['contract_trainee']);
    expect(retiredSlotsWith('hiring', docs)).toEqual(['offer_trainee']);
    expect(retiredSlotsWith('hiring', [{ slotKey: 'offer_internship' }])).toEqual([]);
    expect(retiredSlotsWith('letters', docs)).toEqual([]);
  });

  it('an unpaid intern gets the owner’s internship agreement and offer, and the certificate; no social insurance forms (19 October 2026)', () => {
    const s = { employmentType: 'intern', ending: null, ended: false } as const;
    expect(offeredSlots(s)).toEqual({
      contract: ['contract_internship', 'contract_amendment'],
      hiring: ['offer_internship', 'nda'],
      insurance: [],
      letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience', 'cert_internship'],
      leaving: [],
    });
    expect(offered('contract_trainee', s)).toBe(false);
    expect(offered('offer_trainee', s)).toBe(false);
    expect(offered('insurance_form_1', s)).toBe(false);
    expect(offered('payslip_ar', s)).toBe(false);
    expect(offered('offer_full_time', s)).toBe(false);
    expect(offered('no_such_slot', s)).toBe(false);
    // an ending: the clearance, and Form 6 never (no company social insurance)
    expect(offeredSlots({ ...s, ending: { initiator: 'company' } })).toMatchObject({ insurance: [], leaving: ['clearance_dues'] });
  });

  it('a freelancer’s contract is the freelance agreement', () => {
    expect(offeredSlots({ employmentType: 'freelance', ending: null, ended: false }).contract).toEqual(['agreement_freelance', 'contract_amendment']);
  });

  it('a full-time employment paid by commission gets the commission contract and offer once published, else the full-time ones (owner, 18 October 2026)', () => {
    const commission = { employmentType: 'full_time', paidByCommission: true, ending: null, ended: false } as const;
    expect(offeredSlots(commission)).toMatchObject({
      contract: ['contract_full_time', 'contract_full_time_insurance', 'contract_amendment'],
      hiring: ['offer_full_time', 'nda'],
    });
    expect(offeredSlots({ ...commission, commissionPublished: ['contract_sales', 'offer_sales'] })).toMatchObject({
      // the social insurance copy stays: it is the full-time contract's second copy
      contract: ['contract_full_time_insurance', 'contract_sales', 'contract_amendment'],
      hiring: ['offer_sales', 'nda'],
    });
    // not paid by commission: never the commission ones
    expect(offeredSlots({ ...commission, paidByCommission: false, commissionPublished: ['contract_sales'] }).contract).toEqual([
      'contract_full_time',
      'contract_full_time_insurance',
      'contract_amendment',
    ]);
  });

  it('a salary amendment gets its letter, a whole contract its copies (owner’s decisions, 16 October 2026)', () => {
    const slots = offeredSlots({ employmentType: 'full_time', ending: null, ended: false }).contract;
    expect(versionSlots('amendment', slots)).toEqual(['contract_amendment']);
    expect(versionSlots('contract', slots)).toEqual(['contract_full_time', 'contract_full_time_insurance']);
  });

  it('a contract’s copies, an amendment’s letter and a raise’s Form 2 are generated for one version', () => {
    for (const key of ['contract_full_time', 'contract_amendment', 'insurance_form_2']) expect(isVersionSlot(key)).toBe(true);
    for (const key of ['insurance_form_1', 'insurance_form_6', 'nda', 'bank_letter']) expect(isVersionSlot(key)).toBe(false);
  });
});
