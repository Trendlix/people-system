import { TEMPLATE_SLOTS } from '@trendlix/shared';
import { isVersionSlot, offered, offeredSlots, sectionOf, SECTION_SLOTS, versionSlots } from './offer.js';

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

  it('an intern gets the internship contract, offer and certificate; payslips never', () => {
    const s = { employmentType: 'internship', ending: null, ended: false } as const;
    expect(offeredSlots(s)).toMatchObject({ contract: ['contract_internship', 'contract_amendment'], letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience', 'cert_internship'] });
    expect(offered('payslip_ar', s)).toBe(false);
    expect(offered('offer_full_time', s)).toBe(false);
    expect(offered('no_such_slot', s)).toBe(false);
  });

  it('a freelancer’s contract is the freelance agreement', () => {
    expect(offeredSlots({ employmentType: 'freelance', ending: null, ended: false }).contract).toEqual(['agreement_freelance', 'contract_amendment']);
    expect(offeredSlots({ employmentType: 'sales', ending: null, ended: false }).contract).toEqual(['contract_sales', 'contract_amendment']);
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
