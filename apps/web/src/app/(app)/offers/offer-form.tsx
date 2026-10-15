'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { PhoneInput } from '@/components/phone-input';
import { allowanceRows, allowanceTerms, type AllowanceRow } from '@/lib/allowances';
import { formatDate, parseDate } from '@/lib/format';
import type { AllowanceType, FormState } from '@/lib/types';
import type { EmploymentPickers } from '../employees/employment-fields';
import { plainAmount } from '../employees/[id]/contracts/salary';
import type { OfferDefaults } from './form-body';
import { OfferPositionFields } from './offer-position';
import { OfferTerms } from './offer-terms';
import { salaryStartFrom, switchRate, switchStart, type TermsTyped } from './terms';

// The form of the New offer and Edit draft pages, in four parts: the candidate (a candidate is not an employee: their
// names, personal email and mobile, and a former employee's profile when one is offered again), the position, the terms
// and the offer itself (its last day to accept, a few words to the candidate, a note for HR). It is saved as a draft;
// nothing reaches the candidate until HR sends it from the offer's page (owner's request, 15 October 2026).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * The lists behind the form: the employment pickers (whose `managers` is everyone HR sees, so also who can be offered a
 * job again: former employees, and people added before being hired) and the kinds of allowance.
 */
export type OfferPickers = EmploymentPickers & { allowanceTypes: AllowanceType[] };

const optional = <span className="font-normal text-muted">(optional)</span>;
const amountText = (n: number | null) => (n === null ? '' : plainAmount(n));

/** The fields the previews follow, by name (the allowance rows tell theirs through onChange). */
const TRACKED = ['joinDate', 'payBasis', 'salaryBasis', 'grossSalary', 'wantedNet', 'rateBasis', 'hourlyRate', 'netRate', 'hoursPerWeek', 'basicPercent'] as const;
type Tracked = Record<(typeof TRACKED)[number], string>;

/** One part of the form, under its heading. */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-5 border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function OfferForm({
  action,
  pickers,
  defaults,
  today,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  pickers: OfferPickers;
  defaults: OfferDefaults;
  /** YYYY-MM-DD, for the salary's year while there is no join date. */
  today: string;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  const [typed, setTyped] = useState<Tracked>(() => ({
    joinDate: valueOf(state, 'joinDate', formatDate(defaults.joinDate)),
    payBasis: valueOf(state, 'payBasis', defaults.payBasis),
    salaryBasis: valueOf(state, 'salaryBasis', 'gross'),
    grossSalary: valueOf(state, 'grossSalary', amountText(defaults.grossSalary)),
    wantedNet: valueOf(state, 'wantedNet', ''),
    rateBasis: valueOf(state, 'rateBasis', 'gross'),
    hourlyRate: valueOf(state, 'hourlyRate', amountText(defaults.hourlyRate)),
    netRate: valueOf(state, 'netRate', ''),
    hoursPerWeek: valueOf(state, 'hoursPerWeek', defaults.hoursPerWeek === null ? '' : String(defaults.hoursPerWeek)),
    basicPercent: valueOf(state, 'basicPercent', String(defaults.basicPercent)),
  }));
  const [rows, setRows] = useState<AllowanceRow[]>(() => allowanceRows(state, defaults.allowances));

  // the salary, with the insurable wage limits of the join date's year (this year while there is none)
  const join = parseDate(typed.joinDate);
  const year = Number((join || today).slice(0, 4));
  const termsTyped: TermsTyped = typed;

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    if (!(TRACKED as readonly string[]).includes(name)) return;
    if (name === 'salaryBasis') {
      // the other field starts with what this one gives, so the salary stays the same
      setTyped((v) => ({ ...v, ...switchStart(salaryStartFrom(value), v, year, allowanceTerms(rows, pickers.allowanceTypes)) }));
      return;
    }
    if (name === 'rateBasis') {
      // the same by the hour: the other rate starts with what this one gives
      setTyped((v) => ({ ...v, ...switchRate(salaryStartFrom(value), v, year, allowanceTerms(rows, pickers.allowanceTypes)) }));
      return;
    }
    setTyped((v) => ({ ...v, [name]: value }));
  }

  const people = pickers.managers.filter((p) => p.standing === 'former' || p.standing === 'not_employed' || p.id === defaults.employeeId);

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      <Section id={fid('candidate')} title="Candidate">
        <div className="grid gap-5 sm:grid-cols-2">
          <div id="field-fullNameEn" className="scroll-mt-6">
            <label htmlFor={fid('fullNameEn')} className="label">
              Full name in English
            </label>
            <input
              id={fid('fullNameEn')}
              name="fullNameEn"
              required
              maxLength={150}
              autoComplete="off"
              defaultValue={valueOf(state, 'fullNameEn', defaults.fullNameEn)}
              className="input"
            />
          </div>
          <div id="field-fullNameAr" className="scroll-mt-6">
            <label htmlFor={fid('fullNameAr')} className="label">
              Full name in Arabic
            </label>
            <input
              id={fid('fullNameAr')}
              name="fullNameAr"
              required
              maxLength={150}
              autoComplete="off"
              lang="ar"
              dir="rtl"
              aria-describedby={fid('fullNameAr-hint')}
              defaultValue={valueOf(state, 'fullNameAr', defaults.fullNameAr)}
              className="input"
            />
            <p id={fid('fullNameAr-hint')} className="hint">
              As on their national ID.
            </p>
          </div>
          <div id="field-email" className="scroll-mt-6">
            <label htmlFor={fid('email')} className="label">
              Personal email
            </label>
            <input
              id={fid('email')}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              aria-describedby={fid('email-hint')}
              defaultValue={valueOf(state, 'email', defaults.email)}
              className="input"
            />
            <p id={fid('email-hint')} className="hint">
              Where the offer is sent. Their work email comes once they join.
            </p>
          </div>
          <div id="field-mobile" className="scroll-mt-6">
            <label htmlFor={fid('mobile')} className="label">
              Mobile {optional}
            </label>
            <PhoneInput id={fid('mobile')} name="mobile" label="Mobile" defaultValue={valueOf(state, 'mobile', defaults.mobile)} />
          </div>
          {people.length > 0 && (
            <div id="field-employeeId" className="scroll-mt-6 sm:col-span-2">
              <label htmlFor={fid('employeeId')} className="label">
                Already has a profile {optional}
              </label>
              <select
                id={fid('employeeId')}
                name="employeeId"
                aria-describedby={fid('employeeId-hint')}
                defaultValue={valueOf(state, 'employeeId', defaults.employeeId)}
                onChange={(e) => {
                  // probation is allowed once per employer (Art. 90): someone employed here before gets none
                  const person = people.find((p) => p.id === e.target.value);
                  const probation = e.currentTarget.form?.elements.namedItem('probationMonths');
                  if (person?.standing === 'former' && probation instanceof HTMLInputElement) probation.value = '0';
                }}
                className="input sm:max-w-[calc(50%-0.625rem)]"
              >
                <option value="">No: a new candidate</option>
                {people
                  .slice()
                  .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullNameEn} · {p.employeeCode}
                      {p.standing === 'former' ? ' (former employee)' : ''}
                    </option>
                  ))}
              </select>
              <p id={fid('employeeId-hint')} className="hint">
                For a former employee offered a job again, or someone added before being hired: accepting adds the new employment to their profile
                instead of making another one.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section id={fid('position')} title="Position">
        <OfferPositionFields state={state} fid={fid} pickers={pickers} defaults={defaults} />
      </Section>

      <Section id={fid('terms')} title="Terms">
        <OfferTerms
          state={state}
          fid={fid}
          defaults={defaults}
          typed={termsTyped}
          basicPercent={typed.basicPercent}
          rows={rows}
          onRows={setRows}
          allowanceTypes={pickers.allowanceTypes}
          year={year}
        />
      </Section>

      <Section id={fid('offer')} title="Offer">
        <div className="grid gap-5 sm:grid-cols-2">
          <div id="field-expiresOn" className="scroll-mt-6">
            <label htmlFor={fid('expiresOn')} className="label">
              Open until
            </label>
            <DateInput
              id={fid('expiresOn')}
              name="expiresOn"
              required
              aria-describedby={fid('expiresOn-hint')}
              defaultValue={valueOf(state, 'expiresOn', formatDate(defaults.expiresOn))}
            />
            <p id={fid('expiresOn-hint')} className="hint">
              The last day the candidate can accept. It can be extended later.
            </p>
          </div>
        </div>
        <div id="field-message" className="scroll-mt-6">
          <label htmlFor={fid('message')} className="label">
            Message to the candidate {optional}
          </label>
          <textarea
            id={fid('message')}
            name="message"
            rows={4}
            maxLength={2000}
            aria-describedby={fid('message-hint')}
            defaultValue={valueOf(state, 'message', defaults.message)}
            className="input"
          />
          <p id={fid('message-hint')} className="hint">
            A few words in the email and on the candidate&apos;s page, e.g. &quot;We enjoyed meeting you and are happy to offer you the role.&quot; Up to 2,000
            characters.
          </p>
        </div>
        <div id="field-note" className="scroll-mt-6">
          <label htmlFor={fid('note')} className="label">
            Note for HR {optional}
          </label>
          <textarea
            id={fid('note')}
            name="note"
            rows={3}
            maxLength={1000}
            aria-describedby={fid('note-hint')}
            defaultValue={valueOf(state, 'note', defaults.note)}
            className="input"
          />
          <p id={fid('note-hint')} className="hint">
            Never shown to the candidate. Up to 1,000 characters.
          </p>
        </div>
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** A sent (or expired) offer: only its last day to accept and its note can change. */
export function SentOfferForm({
  action,
  expiresOn,
  note,
  cancelHref,
}: {
  action: Action;
  expiresOn: string;
  note: string | null;
  cancelHref: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />
      <p className="text-sm text-muted">
        The offer has been sent, so its terms are as the candidate read them. To change them, withdraw it and draft a new one.
      </p>
      <div className="max-w-72">
        <label htmlFor={fid('expiresOn')} className="label">
          Open until
        </label>
        <DateInput
          id={fid('expiresOn')}
          name="expiresOn"
          required
          aria-describedby={fid('expiresOn-hint')}
          defaultValue={valueOf(state, 'expiresOn', formatDate(expiresOn))}
        />
        <p id={fid('expiresOn-hint')} className="hint">
          The last day the candidate can accept.
        </p>
      </div>
      <div>
        <label htmlFor={fid('note')} className="label">
          Note for HR {optional}
        </label>
        <textarea id={fid('note')} name="note" rows={3} maxLength={1000} defaultValue={valueOf(state, 'note', note)} className="input" />
      </div>
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
