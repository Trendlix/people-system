import { TEMPLATE_SLOTS } from '@trendlix/shared';
import { offered, offeredSlots, sectionOf, SECTION_SLOTS } from './offer.js';

describe('which documents the Employment tab offers', () => {
  it('lists every slot in one section, except the payslips', () => {
    const listed = Object.values(SECTION_SLOTS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect(TEMPLATE_SLOTS.filter((s) => !listed.includes(s.key)).map((s) => s.key)).toEqual(['payslip_en', 'payslip_ar']);
    expect(sectionOf('payslip_en')).toBeNull();
  });

  it('full time: both contract copies, the offer and NDA, Form 1, the letters; nothing to leave', () => {
    expect(offeredSlots({ employmentType: 'full_time', ending: null, ended: false })).toEqual({
      contract: ['contract_full_time', 'contract_full_time_insurance'],
      hiring: ['offer_full_time', 'nda'],
      insurance: ['insurance_form_1'],
      letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience'],
      leaving: [],
    });
  });

  it('an ending the employee started adds Form 6, the resignation request and the clearance', () => {
    expect(offeredSlots({ employmentType: 'full_time', ending: { initiator: 'employee' }, ended: false })).toMatchObject({
      insurance: ['insurance_form_1', 'insurance_form_6'],
      leaving: ['resignation_request', 'clearance_dues'],
    });
  });

  it('an ending the company started: the clearance, no resignation request', () => {
    expect(offeredSlots({ employmentType: 'part_time', ending: { initiator: 'company' }, ended: false })).toEqual({
      contract: ['contract_part_time'],
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
    expect(offeredSlots(s)).toMatchObject({ contract: ['contract_internship'], letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience', 'cert_internship'] });
    expect(offered('payslip_ar', s)).toBe(false);
    expect(offered('offer_full_time', s)).toBe(false);
    expect(offered('no_such_slot', s)).toBe(false);
  });

  it('a freelancer’s contract is the freelance agreement', () => {
    expect(offeredSlots({ employmentType: 'freelance', ending: null, ended: false }).contract).toEqual(['agreement_freelance']);
    expect(offeredSlots({ employmentType: 'sales', ending: null, ended: false }).contract).toEqual(['contract_sales']);
  });
});
