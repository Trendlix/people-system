import { TEMPLATE_SLOTS, type EmploymentType, type TemplateSlot, type TemplateTrigger } from '@trendlix/shared';

// Which documents the Contracts tab offers an employee (spec §8.3; owner's request, 15 October 2026): those whose
// template applies to the employment type (`appliesTo`) and whose moment has come (`triggers`), grouped in sections.
// Pure: worked out from the employment's type and whether it has an ending.

export const SECTION_KEYS = ['contract', 'hiring', 'insurance', 'letters', 'leaving'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Each section's slots, in the order the tab lists them. Payslips are in none: there is no payroll yet. */
export const SECTION_SLOTS: Record<SectionKey, readonly string[]> = {
  // one item per copy for each contract version
  contract: ['contract_full_time', 'contract_full_time_insurance', 'contract_part_time', 'contract_internship', 'contract_sales', 'agreement_freelance'],
  hiring: ['offer_full_time', 'offer_part_time', 'offer_internship', 'offer_freelance', 'offer_sales', 'nda'],
  insurance: ['insurance_form_1', 'insurance_form_6'],
  letters: ['bank_letter', 'hr_letter_ar', 'hr_letter_en', 'cert_experience', 'cert_internship'],
  leaving: ['resignation_request', 'clearance_dues'],
};

export const SLOTS: ReadonlyMap<string, TemplateSlot> = new Map(TEMPLATE_SLOTS.map((s) => [s.key, s]));

/** The section a slot is listed in; null for a slot the tab never offers (payslips). */
export function sectionOf(slotKey: string): SectionKey | null {
  return SECTION_KEYS.find((k) => SECTION_SLOTS[k].includes(slotKey)) ?? null;
}

/** A contract slot: one document per contract version, generated for that version (contractId). */
export const isContractSlot = (slotKey: string) => SECTION_SLOTS.contract.includes(slotKey);

/** The slots whose documents belong to the ending they were issued for. */
export const ENDING_SLOTS: readonly string[] = ['resignation_request', 'clearance_dues', 'insurance_form_6'];

/** The tags typed when generating, not read from the profile. */
export const TYPED_TAGS: readonly string[] = ['letter_to', 'letter_purpose'];

/** Where an employment stands, as far as which documents it is offered. */
export interface Situation {
  employmentType: EmploymentType;
  /** Its ending, unless there is none or it was rejected or withdrawn. */
  ending: { initiator: string | null } | null;
  /** The employment has ended (an end date), with or without an ending recorded. */
  ended: boolean;
}

/**
 * When each trigger's moment has come. Every document of the hire is offered for as long as the employment is there
 * (HR prints them again on request). The experience certificate (end of service, or on request) is therefore always
 * offered, and so is the internship certificate to an intern: an intern asks for it before the last day as well
 * (decisions, 15 October 2026). Form 6 once the employment is ending or has ended. The resignation request only when
 * the employee started the ending (a resignation, family reasons, or ending their own probation), and the clearance
 * whenever there is an ending. Payslips never: there is no payroll yet.
 */
const TRIGGERED: Record<TemplateTrigger, (s: Situation) => boolean> = {
  offer_stage: () => true,
  on_hire: () => true,
  renewal: () => true,
  on_request: () => true,
  end_of_internship: () => true,
  monthly_payroll: () => false,
  resignation_recorded: (s) => s.ending?.initiator === 'employee',
  last_working_day: (s) => s.ending !== null,
  end_of_service: (s) => s.ending !== null || s.ended,
};

/** Whether the tab offers this slot for the employment: its section, its employment types and one of its triggers. */
export function offered(slotKey: string, s: Situation): boolean {
  const slot = SLOTS.get(slotKey);
  if (!slot || !sectionOf(slotKey)) return false;
  if (!slot.appliesTo.includes(s.employmentType)) return false;
  // the leaving documents only while there is an ending (spec §8.3: only when a resignation is recorded)
  if (sectionOf(slotKey) === 'leaving' && !s.ending) return false;
  return slot.triggers.some((t) => TRIGGERED[t](s));
}

/** Each section's slots offered for the employment, in order. */
export function offeredSlots(s: Situation): Record<SectionKey, string[]> {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, SECTION_SLOTS[k].filter((key) => offered(key, s))])) as Record<SectionKey, string[]>;
}
