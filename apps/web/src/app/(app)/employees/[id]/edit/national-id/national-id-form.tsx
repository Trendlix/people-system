'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { GENDERS, LABELS, type Gender } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { EmployeeIdentity, EmployeeProfile, FormState, IdCardScan } from '@/lib/types';

type Suggestions = IdCardScan['suggestions'];

/** The profile's current values for the personal details printed on an ID card. */
export type CardProfile = Pick<EmployeeProfile, 'fullNameAr' | 'addressAr' | 'dateOfBirth' | 'gender'>;

const PERSONAL = [
  { key: 'fullNameAr', label: 'Full name (Arabic)' },
  { key: 'addressAr', label: 'Address (Arabic)' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
] as const;
type PersonalKey = (typeof PERSONAL)[number]['key'];

const FROM_CARD = 'Read from the card — check before saving.';

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim();

/** A profile value as the page shows it. */
function shown(key: PersonalKey, value: string | null): React.ReactNode {
  if (!value) return <span className="text-muted">Not set</span>;
  if (key === 'dateOfBirth') return formatDate(value);
  if (key === 'gender') return LABELS.gender[value as Gender] ?? value;
  return (
    <span lang="ar" dir="rtl">
      {value}
    </span>
  );
}

/**
 * The national ID details. After the ID card is read (`suggestions`), the fields start with what the card says and
 * are marked for checking, and the card's personal details can be ticked to save to the profile too.
 */
export function NationalIdForm({
  action,
  employeeId,
  identity,
  suggestions,
  profile,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employeeId: string;
  identity: EmployeeIdentity;
  suggestions?: Suggestions;
  profile?: CardProfile;
}) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  const s: Suggestions = suggestions ?? {};

  const read = (key: keyof Suggestions) => s[key] !== undefined;
  /** The ids describing a field: its own hint (if any) and the "read from the card" note. */
  const describedBy = (key: keyof Suggestions, hint?: string) => [hint, read(key) ? fid(`${key}-card`) : undefined].filter(Boolean).join(' ') || undefined;
  const cardNote = (key: keyof Suggestions) =>
    read(key) && (
      <p id={fid(`${key}-card`)} className="hint text-warn">
        {FROM_CARD}
      </p>
    );

  // Personal details the card gives that differ from the profile; the matching ones are only listed.
  const personal = profile ? PERSONAL.filter((f) => read(f.key)) : [];
  const differing = personal.filter((f) => !same(s[f.key], profile?.[f.key]));
  const matching = personal.filter((f) => same(s[f.key], profile?.[f.key]));
  /** Ticked: what was ticked before a failed save; at first, the details the profile does not have yet. */
  const ticked = (key: PersonalKey) => {
    if (state.values) {
      const apply = state.values.apply;
      return Array.isArray(apply) ? apply.includes(key) : apply === key;
    }
    return !profile?.[key];
  };

  function personalControl(key: PersonalKey, id: string, describedById: string) {
    const name = `card_${key}`;
    if (key === 'dateOfBirth')
      return <DateInput id={id} name={name} aria-describedby={describedById} defaultValue={valueOf(state, name, formatDate(s.dateOfBirth))} />;
    if (key === 'gender')
      return (
        <select id={id} name={name} aria-describedby={describedById} defaultValue={valueOf(state, name, s.gender)} className="input">
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {LABELS.gender[g]}
            </option>
          ))}
        </select>
      );
    const common = { id, name, lang: 'ar', dir: 'rtl' as const, 'aria-describedby': describedById, defaultValue: valueOf(state, name, s[key]), className: 'input' };
    return key === 'addressAr' ? <textarea rows={2} maxLength={300} {...common} /> : <input maxLength={150} {...common} />;
  }

  return (
    <form action={formAction} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('nationalId')} className="label">
            National ID number{' '}
            <span lang="ar" className="font-normal text-muted">
              (الرقم القومي)
            </span>
          </label>
          <input
            id={fid('nationalId')}
            name="nationalId"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            aria-describedby={describedBy('nationalId', fid('nationalId-hint'))}
            defaultValue={valueOf(state, 'nationalId', s.nationalId ?? identity.nationalId)}
            className="input tabular-nums"
          />
          <p id={fid('nationalId-hint')} className="hint">
            14 digits. It must agree with the date of birth.
          </p>
          {cardNote('nationalId')}
        </div>
        <div>
          <label htmlFor={fid('printedNo')} className="label">
            Printed number{' '}
            <span lang="ar" className="font-normal text-muted">
              (الرقم المطبوع)
            </span>
          </label>
          <input
            id={fid('printedNo')}
            name="printedNo"
            autoComplete="off"
            maxLength={20}
            aria-describedby={describedBy('printedNo')}
            defaultValue={valueOf(state, 'printedNo', s.printedNo ?? identity.printedNo)}
            className="input tabular-nums"
          />
          {cardNote('printedNo')}
        </div>
        <div>
          <label htmlFor={fid('issueDate')} className="label">
            Issue date
          </label>
          <DateInput
            id={fid('issueDate')}
            name="issueDate"
            aria-describedby={describedBy('issueDate')}
            defaultValue={valueOf(state, 'issueDate', formatDate(s.issueDate ?? identity.issueDate))}
          />
          {cardNote('issueDate')}
        </div>
        <div>
          <label htmlFor={fid('expiryDate')} className="label">
            Expiry date
          </label>
          <DateInput
            id={fid('expiryDate')}
            name="expiryDate"
            aria-describedby={describedBy('expiryDate')}
            defaultValue={valueOf(state, 'expiryDate', formatDate(s.expiryDate ?? identity.expiryDate))}
          />
          {cardNote('expiryDate')}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('issuingOffice')} className="label">
            Issuing office{' '}
            <span lang="ar" className="font-normal text-muted">
              (جهة الإصدار)
            </span>
          </label>
          <input
            id={fid('issuingOffice')}
            name="issuingOffice"
            lang="ar"
            dir="rtl"
            maxLength={150}
            aria-describedby={describedBy('issuingOffice')}
            defaultValue={valueOf(state, 'issuingOffice', s.issuingOffice ?? identity.issuingOffice)}
            className="input"
          />
          {cardNote('issuingOffice')}
        </div>
      </div>

      {personal.length > 0 && (
        <div className="border-t border-line pt-6">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Personal details on the card</legend>
            {differing.length > 0 && (
              <p className="text-sm text-muted">Tick the ones to save to the profile as well. They are saved together with the national ID.</p>
            )}
            {differing.map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-line p-4">
                <label htmlFor={fid(`card_${key}`)} className="label">
                  {label}
                </label>
                {personalControl(key, fid(`card_${key}`), fid(`card_${key}-hint`))}
                <p id={fid(`card_${key}-hint`)} className="hint">
                  <span className="text-warn">{FROM_CARD}</span> In the profile now: {shown(key, profile?.[key] ?? null)}
                </p>
                <label className="mt-3 flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
                  <input type="checkbox" name="apply" value={key} defaultChecked={ticked(key)} className="size-4 accent-accent" />
                  Save to the profile<span className="sr-only"> as the {label}</span>
                </label>
              </div>
            ))}
            {matching.length > 0 && (
              <p className="text-sm text-muted">Already the same in the profile: {matching.map((f) => f.label).join(', ')}.</p>
            )}
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton>Save national ID</SubmitButton>
        <Link href={`/employees/${employeeId}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
