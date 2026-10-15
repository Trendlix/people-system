import { slotArabicDigits } from '@trendlix/shared';
import { FORM_1_FIELDS, FORM_6_FIELDS } from './insurance-form-layouts.js';

// The starter layouts of social insurance Forms 1 and 6: what each of Form 1's fields prints that is now the employee's
// own on the Social Insurance tab (owner, 16 October 2026), and the forms' digits.

const tagOf = (id: string) => FORM_1_FIELDS.find((f) => f.id === id)?.tag;

describe('Form 1’s starter layout', () => {
  it('prints the subscription start, the occupation and the three wages from the Social Insurance tab', () => {
    expect(tagOf('start')).toBe('insurance_start_date');
    expect([tagOf('occupation-code'), tagOf('occupation-name')]).toEqual(['occupation_code', 'occupation_name']);
    expect([tagOf('basic-pounds'), tagOf('basic-piastres')]).toEqual(['insurance_basic_salary', 'insurance_basic_salary']);
    expect([tagOf('insured-pounds'), tagOf('insured-piastres')]).toEqual(['insurance_insured_salary', 'insurance_insured_salary']);
    expect([tagOf('total-pounds'), tagOf('total-piastres')]).toEqual(['insurance_total_salary', 'insurance_total_salary']);
    // the contract's own amounts and the join date are no longer printed on it
    const tags = FORM_1_FIELDS.map((f) => f.tag);
    for (const tag of ['join_date', 'basic_salary', 'insured_salary', 'total_salary']) expect(tags).not.toContain(tag);
  });

  it('agrees with the forms’ digit rule: ٠-٩ in every field but the email’s and the check box', () => {
    for (const [slot, fields] of [['insurance_form_1', FORM_1_FIELDS], ['insurance_form_6', FORM_6_FIELDS]] as const) {
      for (const f of fields) {
        const rule = slotArabicDigits(slot, f);
        if (rule !== null) expect(f.arabicDigits === true, `${slot} ${f.id}`).toBe(rule);
      }
    }
  });
});

describe('the digit rule of a template’s slot', () => {
  const text = { kind: 'text', tag: 'insurance_no' } as const;
  it('a social insurance form prints ٠-٩ in its text, boxes and fixed text, never in an email', () => {
    expect(slotArabicDigits('insurance_form_1', text)).toBe(true);
    expect(slotArabicDigits('insurance_form_6', { kind: 'boxes', tag: 'national_id' })).toBe(true);
    expect(slotArabicDigits('insurance_form_1', { kind: 'fixed', tag: null })).toBe(true);
    expect(slotArabicDigits('insurance_form_1', { kind: 'text', tag: 'personal_email' })).toBe(false);
    expect(slotArabicDigits('insurance_form_1', { kind: 'text', tag: 'work_email' })).toBe(false);
    // a check box prints a mark, not digits: as saved
    expect(slotArabicDigits('insurance_form_1', { kind: 'check', tag: null })).toBeNull();
  });

  it('any other template keeps what each field was saved with', () => {
    expect(slotArabicDigits('nda', text)).toBeNull();
    expect(slotArabicDigits('contract_full_time', text)).toBeNull();
    expect(slotArabicDigits('no_such_slot', text)).toBeNull();
    expect(slotArabicDigits(null, text)).toBeNull();
  });
});
