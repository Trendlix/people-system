import { TEMPLATE_SLOTS } from '@trendlix/shared';
import { isOfferSlot, MASK, placeholder, previewValues } from './preview.js';

// What a template's preview with an employee's data prints (owner's request, 15 October 2026): their values, the
// label of each empty tag in square brackets, and •••• for restricted data the caller may not see.

const ALL = { identity: true, salary: true, bank: true };
const NONE = { identity: false, salary: false, bank: false };

describe("a preview's values", () => {
  it('prints an empty tag as its label in square brackets; one the dictionary lacks as itself', () => {
    expect(placeholder('job_title')).toBe('[Job title]');
    expect(placeholder('letter_to')).toBe('[Addressed to]');
    expect(placeholder('letter_purpose')).toBe('[Purpose of the letter]');
    expect(placeholder('not_a_tag')).toBe('[not_a_tag]');
  });

  it('keeps the values there are, and counts each tag once', () => {
    const p = previewValues(
      ['full_name_en', 'job_title', 'full_name_en', 'letter_to'],
      { full_name_en: 'Omar Khaled', job_title: '', letter_to: '' },
      new Set(['job_title', 'letter_to']),
      undefined,
      ALL,
    );
    expect(p.values).toEqual({ full_name_en: 'Omar Khaled', job_title: '[Job title]', letter_to: '[Addressed to]' });
    expect([p.filled, p.total]).toEqual([1, 3]);
    expect(p.shown).toEqual([]);
    // the tags printed as their label, for a PDF form's optional fields to print blank instead
    expect(p.placeholders).toEqual(['job_title', 'letter_to']);
  });

  it('masks restricted data the caller may not see, empty or not, and counts it all the same', () => {
    const values = { national_id: '29503121234567', gross_salary: '20,000', iban: '', full_name_en: 'Omar' };
    const tags = Object.keys(values);
    const hidden = previewValues(tags, values, new Set(['iban']), undefined, NONE);
    expect(hidden.values).toEqual({ national_id: MASK, gross_salary: MASK, iban: MASK, full_name_en: 'Omar' });
    expect([hidden.filled, hidden.total]).toEqual([3, 4]);
    expect(hidden.shown).toEqual([]);
    // masked, empty or not: never left blank, which would say it is empty
    expect(hidden.placeholders).toEqual([]);

    const seen = previewValues(tags, values, new Set(['iban']), undefined, ALL);
    expect(seen.values).toEqual({ national_id: '29503121234567', gross_salary: '20,000', iban: '[IBAN]', full_name_en: 'Omar' });
    // only what was printed with its value is a view of restricted data
    expect(seen.shown).toEqual(['national_id', 'gross_salary']);

    const salaryOnly = previewValues(tags, values, new Set(['iban']), undefined, { identity: false, salary: true, bank: false });
    expect(salaryOnly.values).toMatchObject({ national_id: MASK, gross_salary: '20,000', iban: MASK });
    expect(salaryOnly.shown).toEqual(['gross_salary']);
  });

  it('reads a tag through the slot overrides, as generation does', () => {
    // a made-up override that prints a salary through a plain tag needs the salary right
    const p = previewValues(['full_name_en'], { full_name_en: '20,000' }, new Set(), { full_name_en: 'gross_salary' }, NONE);
    expect(p.values).toEqual({ full_name_en: MASK });
  });

  it('keeps a value with formatting as it is', () => {
    const duties = { html: '<p>Leads the team.</p>' };
    expect(previewValues(['job_duties'], { job_duties: duties }, new Set(), undefined, NONE).values.job_duties).toBe(duties);
  });

  it('previews the job offer templates with job offers, every other template with employees', () => {
    const offers = TEMPLATE_SLOTS.filter(isOfferSlot).map((s) => s.key);
    expect(offers.sort()).toEqual(['offer_freelance', 'offer_full_time', 'offer_internship', 'offer_part_time', 'offer_sales']);
    expect(isOfferSlot({ key: 'contract_full_time', appliesTo: ['full_time'] })).toBe(false);
    // the key must be the type's own offer slot
    expect(isOfferSlot({ key: 'offer_full_time', appliesTo: ['part_time'] })).toBe(false);
  });
});
